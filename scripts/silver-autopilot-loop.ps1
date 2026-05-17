#requires -Version 5.1
<#
.SYNOPSIS
  Silver FULL AUTO LOOP TRIGGER V1 — orchestrates SILVER_NEXT_ACTION.md → Cursor CLI → Autopilot → reports.

.PARAMETER DryRun
  Skips Cursor and node --full-auto-loop; still runs guards, --status, progress log, colored summary (exit 0 if guards pass).

.PARAMETER MaxCycles
  Default 1. Value 0 is **blocked** unless `-AllowInfinite` or `-AutonomousMode` enables controlled autonomous mode (hard caps + breakers still apply).

.PARAMETER SleepSeconds
  Pause between cycles (default 5).

.PARAMETER CursorCommand
  Template with {TASK_FILE} and {OUTPUT_FILE} tokens. If empty: DryRun PASS; non-DryRun STOP.

.PARAMETER NoBeep
  Disable console beeps.

.PARAMETER AllowInfinite
  With -MaxCycles 0, opts into controlled autonomous mode (still capped by hard max + other breakers).

.PARAMETER AutonomousMode
  Alias intent for -MaxCycles 0 (same as -AllowInfinite; both enable controlled autonomous mode).

.PARAMETER MaxAutonomousHardCycles
  Hard ceiling for autonomous iterations when -MaxCycles 0 (0 = use env SILVER_AUTONOMOUS_HARD_MAX_CYCLES or default 512).

.PARAMETER SameNextActionStopAfter
  Consecutive identical normalized next-action bodies before autonomous stop (default 5).

.PARAMETER NoProgressStopAfter
  Consecutive cycles with unchanged real (non-baseline) core_engine_progress before autonomous stop (default 8). Values containing baseline_pending_precise_measurement are not treated as a progress heartbeat (streak does not advance; see SILVER_AUTOPILOT_README.md).

.PARAMETER RepeatedFailureStopAfter
  Consecutive non-zero autopilot --status exits before autonomous stop (default 3).

.PARAMETER PrLoopStopAfter
  Consecutive cycles referencing the same PR number before autonomous stop (default 4).

.PARAMETER MaxCycleWallSeconds
  Per-cycle wall budget in autonomous mode (0 = use env SILVER_AUTONOMOUS_MAX_CYCLE_WALL_SECONDS or default 7200; set -1 to disable).

.PARAMETER TotalWallSeconds
  Total wall budget for autonomous run (0 = use env SILVER_AUTONOMOUS_MAX_TOTAL_WALL_SECONDS or default 86400; set -1 to disable).
#>
param(
  [switch]$DryRun,
  [int]$MaxCycles = 1,
  [int]$SleepSeconds = 5,
  [string]$CursorCommand = "",
  [switch]$NoBeep,
  [switch]$AllowInfinite,
  [switch]$AutonomousMode,
  [int]$MaxAutonomousHardCycles = 0,
  [int]$SameNextActionStopAfter = 5,
  [int]$NoProgressStopAfter = 8,
  [int]$RepeatedFailureStopAfter = 3,
  [int]$PrLoopStopAfter = 4,
  [int]$MaxCycleWallSeconds = 0,
  [int]$TotalWallSeconds = 0,
  [switch]$TimeoutArchiveSelfTest
)

Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
} catch { }

$ExpectedRepoRoot = "C:\projects\filtr"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$NextActionPath = Join-Path $RepoRoot "SILVER_NEXT_ACTION.md"
$RunReportPath = Join-Path $RepoRoot "SILVER_RUN_REPORT.md"
$ProgressLogPath = Join-Path $RepoRoot "SILVER_PROGRESS_LOG.md"
$CursorOutputPath = Join-Path $RepoRoot "SILVER_CURSOR_OUTPUT.md"
$AutopilotScript = Join-Path $RepoRoot "scripts\silver-autopilot.cjs"
$EmergencyStopPath = Join-Path $RepoRoot "SILVER_STOP_AUTOPILOT"

$script:CycleIndex = 0
$script:LastCursorExit = "N/A"
$script:LastAutopilotExit = "N/A"
$script:LastStatusExit = "N/A"
$script:LastTaskExit = 0

function Invoke-SilverBeepPass {
  param([switch]$NoBeep)
  if ($NoBeep) { return }
  try {
    [console]::beep(880, 180)
    [console]::beep(988, 180)
  } catch { }
}

function Invoke-SilverBeepFail {
  param([switch]$NoBeep)
  if ($NoBeep) { return }
  try { [console]::beep(220, 900) } catch { }
}

function Invoke-SilverBeepComplete {
  param([switch]$NoBeep)
  if ($NoBeep) { return }
  try {
    [console]::beep(880, 180)
    [console]::beep(988, 180)
    [console]::beep(1175, 250)
  } catch { }
}

function Test-RepoRootMatch {
  param([string]$Expected, [string]$Actual)
  $e = [System.IO.Path]::GetFullPath($Expected.TrimEnd('\', '/'))
  $a = [System.IO.Path]::GetFullPath($Actual.TrimEnd('\', '/'))
  return [string]::Equals($e, $a, [System.StringComparison]::OrdinalIgnoreCase)
}

function Read-TextFileOrEmpty {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return "" }
  return [System.IO.File]::ReadAllText($Path)
}

function Read-SilverLoopTempCaptureFileWithRetry {
  <#
  .SYNOPSIS
    Read temp stdout/stderr capture after cmd.exe redirect; tolerates brief exclusive locks.
  #>
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [int]$MaxAttempts = 20,
    [int]$SleepMilliseconds = 200
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    return @{ Success = $true; Text = ""; FailureReason = "" }
  }
  $lastExMsg = ""
  for ($attempt = 0; $attempt -lt $MaxAttempts; $attempt++) {
    try {
      $fs = New-Object System.IO.FileStream(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::ReadWrite
      )
      try {
        $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8, $true)
        try {
          $txt = $sr.ReadToEnd()
          return @{ Success = $true; Text = $txt; FailureReason = "" }
        } finally {
          $sr.Dispose()
        }
      } finally {
        $fs.Dispose()
      }
    } catch {
      $lastExMsg = $_.Exception.Message
      if ($attempt -lt $MaxAttempts - 1) {
        Start-Sleep -Milliseconds $SleepMilliseconds
      }
    }
  }
  $reason = "temp_capture_read_failed_after_" + [string]$MaxAttempts + "_attempts: " + $lastExMsg + "; path=" + $Path
  return @{ Success = $false; Text = ""; FailureReason = $reason }
}

function Get-GitStatusShortText {
  param([string]$Cwd)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "git"
    $psi.Arguments = "-c core.quotePath=false status --short"
    $psi.WorkingDirectory = $Cwd
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEnd()
    $null = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    return $out
  } catch {
    return "GIT_ERROR"
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Restore-SilverProgressLogForAutopilotGuard {
  param([string]$RepoRoot, [string]$ProgressRel)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "git"
    $psi.Arguments = "restore --worktree -- " + $ProgressRel
    $psi.WorkingDirectory = $RepoRoot
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $null = $p.StandardOutput.ReadToEnd()
    $null = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
  } catch {
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Get-GitRevParseHead {
  param([string]$Cwd)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "git"
    $psi.Arguments = "rev-parse HEAD"
    $psi.WorkingDirectory = $Cwd
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEnd()
    $null = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    return $out.Trim()
  } catch {
    return ""
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Archive-SilverTimeoutRuntimeArtifacts {
  param(
    [string]$RepoRoot,
    [string]$Reason,
    [string]$CursorExit = "",
    [string]$TimedOut = ""
  )
  $archived = "NO"
  $relOut = ""
  $fullDir = ""
  try {
    $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss") + "Z"
    $baseDir = Join-Path $RepoRoot ".silver-runtime"
    $timeoutsRoot = Join-Path $baseDir "timeouts"
    $destDir = Join-Path $timeoutsRoot $stamp
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    $names = @(
      "SILVER_CURSOR_OUTPUT.md",
      "SILVER_NEXT_ACTION.md",
      "SILVER_PROGRESS_LOG.md",
      "SILVER_RUN_REPORT.md"
    )
    $copied = New-Object System.Collections.Generic.List[string]
    $missing = New-Object System.Collections.Generic.List[string]
    foreach ($name in $names) {
      $src = Join-Path $RepoRoot $name
      if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination (Join-Path $destDir $name) -Force
        [void]$copied.Add($name)
      }
      else {
        [void]$missing.Add($name)
      }
    }
    $head = Get-GitRevParseHead -Cwd $RepoRoot
    $relSlash = ".silver-runtime/timeouts/" + $stamp
    $manifest = [ordered]@{
      utc_timestamp = $stamp
      main_commit_head = $head
      reason_timeout = $Reason
      cursor_exit = $CursorExit
      timed_out = $TimedOut
      copied_files = $copied.ToArray()
      missing_files = $missing.ToArray()
      archive_path = $relSlash
    }
    $json = $manifest | ConvertTo-Json -Depth 8
    $manifestPath = Join-Path $destDir "manifest.json"
    [System.IO.File]::WriteAllText($manifestPath, $json, [System.Text.UTF8Encoding]::new($false))
    $archived = "YES"
    $relOut = $relSlash
    $fullDir = $destDir
  }
  catch {
    $archived = "NO"
    $relOut = ""
    $fullDir = ""
  }
  return @{ RelativePath = $relOut; Archived = $archived; FullPath = $fullDir }
}

function Test-GitStatusClean {
  param([string]$Cwd)
  $t = (Get-GitStatusShortText -Cwd $Cwd).Trim()
  return ($t -eq "")
}

function Test-AssetsAppJsInStatus {
  param([string]$GitShort)
  if (-not $GitShort) { return $false }
  foreach ($p in Get-GitStatusShortPathsFromText -Txt $GitShort) {
    $n = ($p -replace '\\', '/').Trim()
    if ([string]::Equals($n, "assets/app.js", [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }
  return $false
}

function Get-RunReportLineValue {
  param([string]$ReportText, [string]$Key)
  if (-not $ReportText) { return "" }
  foreach ($raw in $ReportText -split "`r?`n") {
    $line = $raw.Trim()
    if ($line.StartsWith($Key + "=", [System.StringComparison]::OrdinalIgnoreCase)) {
      return $line.Substring($Key.Length + 1).Trim()
    }
  }
  return ""
}

function Test-SafetyCountersBlocked {
  param([string]$SafetyCountersLine)
  if (-not $SafetyCountersLine) { return $false }
  $pairs = $SafetyCountersLine -split ";"
  foreach ($pair in $pairs) {
    $kv = $pair -split "=", 2
    if ($kv.Count -lt 2) { continue }
    $k = $kv[0].Trim()
    $vNum = 0
    if (-not [int]::TryParse($kv[1].Trim(), [ref]$vNum)) { continue }
    if ($k -match "^(dangerous_write_count|false_write_count|query_created_write_count|write_when_negated_count)$" -and $vNum -gt 0) {
      return $true
    }
  }
  return $false
}

function Test-EngineTaskPolicyViolation {
  param([string]$Text)
  $t = [string]$Text
  if (-not $t.Trim()) { return $false }
  if ($t -match "ENGINE_ALLOWED") { return $false }
  $engineish =
    ($t -match "(?i)\bassets/app\.js\b") -or
    ($t -match "(?i)\bengine\b.*\b(edit|chang|patch|refactor|rewrite)\b") -or
    ($t -match "(?i)\brouting\b.*\b(edit|chang|patch|refactor|rewrite)\b") -or
    ($t -match "(?i)\bnormalizer\b.*\b(edit|chang|patch|refactor|rewrite)\b")
  $diagnosticish =
    ($t -match "(?i)\bdiagnostic\b") -or
    ($t -match "(?i)\bscripts-only\b") -or
    ($t -match "(?i)\bnode\s+scripts/silver-") -or
    ($t -match "(?i)\baudit_") -or
    ($t -match "(?i)\bharness\b")
  return ($engineish -and -not $diagnosticish)
}

function Test-IsScriptsSilverAutopilotPathSlice {
  param([string]$PathSlice)
  $p = ([string]$PathSlice).Trim() -replace '\\', '/'
  if (-not $p) { return $false }
  return ($p -match '^(?:\./)?scripts/silver-autopilot\.cjs$')
}

function Test-SegmentHasBareSilverAutopilotInvocation {
  param([string]$RawSegment)
  $raw = ([string]$RawSegment).Replace("`r`n", "`n")
  $reNode = [regex]::new('\bnode(?:\.exe)?\s+', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  $m = $reNode.Match($raw)
  while ($m.Success) {
    $i = $m.Index + $m.Length
    if ($i -ge $raw.Length) { break }

    $pathSlice = ""
    $qc = $raw[$i]
    if (($qc -eq '"') -or ($qc -eq "'") -or ($qc -eq '`')) {
      $j = $i + 1
      while ($j -lt $raw.Length) {
        $c = $raw[$j]
        if (($qc -ne '`') -and ($c -eq '\')) {
          $j += 2
          continue
        }
        if ($c -eq $qc) { break }
        $j++
      }
      $pathSlice = $raw.Substring($i + 1, $j - $i - 1)
      $i = $j + 1
    }
    else {
      $j = $i
      while ($j -lt $raw.Length) {
        $c = $raw[$j]
        if (($c -eq ' ') -or ($c -eq "`t") -or ($c -eq "`n") -or ($c -eq "`r")) { break }
        $j++
      }
      $pathSlice = $raw.Substring($i, $j - $i)
      $i = $j
    }

    if (Test-IsScriptsSilverAutopilotPathSlice -PathSlice $pathSlice) {
      while (($i -lt $raw.Length) -and (($raw[$i] -eq ' ') -or ($raw[$i] -eq "`t"))) { $i++ }
      $aft = if ($i -ge $raw.Length) { "" } else { $raw.Substring($i) }
      if (-not ($aft -match '^--\s*\S')) {
        return $true
      }
    }

    $m = $reNode.Match($raw, $m.Index + 1)
  }
  return $false
}

function Test-NextActionLineIndicatesDocumentaryContext {
  param([string]$NonemptyLine)
  $p = ([string]$NonemptyLine).Trim()
  if (-not $p) { return $false }
  return ($p -match '(?i)\binvalid\b|\bincorrect\b|\bwrong\b|ROOT\s+CAUSE|MUST\b|SILVER_NEXT_ACTION\.MD\s+GENERATED|GENERATED.{0,80}\binvalid\b|EXPLICIT\s+ARGS|WITHOUT\s+ARGS|bez[^\n]{0,20}(args|argument)|^TASK:|^GOAL:|^SCOPE:|^NO-GO:|^REQUIRED:|\*\*DO\s+NOT\b|ANTI[-\s]?PATTERN|PŘÍKLAD|NEPOUŽ|\breject\b')
}

function Test-NextActionHasBareSilverAutopilotNodeInvocation {
  param([string]$Inner)
  $text = ([string]$Inner).Replace("`r`n", "`n")
  $fenceBodies = New-Object System.Collections.Generic.List[string]
  $outsideLines = New-Object System.Collections.Generic.List[string]
  $inFence = $false
  $curFence = New-Object System.Collections.Generic.List[string]

  foreach ($line in ($text -split "`n")) {
    if ($line -match '^\s*```') {
      if ($inFence) {
        [void]$fenceBodies.Add(($curFence -join "`n"))
        $curFence.Clear()
        $inFence = $false
      }
      else {
        $inFence = $true
      }
      continue
    }
    if ($inFence) {
      [void]$curFence.Add($line)
      continue
    }
    [void]$outsideLines.Add($line)
  }
  if ($inFence) {
    [void]$fenceBodies.Add(($curFence -join "`n"))
  }

  foreach ($body in $fenceBodies) {
    if (Test-SegmentHasBareSilverAutopilotInvocation -RawSegment $body) {
      return $true
    }
  }

  $prevNonEmpty = ""
  foreach ($oline in $outsideLines) {
    $trimmed = ([string]$oline).Trim()
    if (-not $trimmed) { continue }
    if ($trimmed -notmatch '(?i)\bnode(?:\.exe)?\s+') {
      $prevNonEmpty = $trimmed
      continue
    }
    if (-not (Test-SegmentHasBareSilverAutopilotInvocation -RawSegment $trimmed)) {
      $prevNonEmpty = $trimmed
      continue
    }
    $docAllowed =
      (Test-NextActionLineIndicatesDocumentaryContext -NonemptyLine $prevNonEmpty) -or
      (Test-NextActionLineIndicatesDocumentaryContext -NonemptyLine $trimmed)
    if (-not $docAllowed) { return $true }
    $prevNonEmpty = $trimmed
  }
  return $false
}

function Test-SilverNextActionOutputQuality {
  param([string]$Text)
  if (-not $Text) { return $true }
  if ($Text -match "Ă") { return $false }
  if ($Text -match "â€") { return $false }
  if (Test-NextActionHasBareSilverAutopilotNodeInvocation -Inner $Text) { return $false }
  if ($Text -match '(?i)\bnode\s+scripts/silver-diagnostic\.js\b') { return $false }
  if ($Text -match '(?i)\bnode\s+scripts/silver-smoke-test-maxcycles-1\.js\b') { return $false }
  if ($Text -match '(?i)`cat\s+C:\\') { return $false }
  if ($Text -match '(?i)Command:\s*`?cat\s+C:\\') { return $false }
  if ($Text -match '(?im)^\s*cat\s+C:\\') { return $false }
  return $true
}

function Get-NextActionHeadline {
  param([string]$Text)
  foreach ($raw in $Text -split "`r?`n") {
    $line = $raw.Trim()
    if (-not $line) { continue }
    if ($line.StartsWith("<!--")) { continue }
    if ($line.StartsWith("#")) {
      $h = $line.TrimStart("#").Trim()
      if ($h.Length -gt 120) { return $h.Substring(0, 120) }
      return $h
    }
  }
  $flat = ($Text -replace "`r?`n", " ").Trim()
  if ($flat.Length -gt 120) { return $flat.Substring(0, 120) }
  return $flat
}

function Get-SilverAdapterMetaKeyValuesFromMarkdown {
  param([string]$Path)
  $out = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $out
  }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $full = [System.IO.File]::ReadAllText($Path, $utf8)
  if ($full.IndexOf("# silver-cursor-agent-adapter", [System.StringComparison]::Ordinal) -lt 0) {
    return $out
  }
  $marker = "# stdout"
  $idx = $full.IndexOf($marker, [System.StringComparison]::Ordinal)
  $head = if ($idx -ge 0) { $full.Substring(0, $idx) } else { $full }
  foreach ($raw in $head -split "`r?`n") {
    $line = $raw.Trim()
    if ($line.Length -eq 0) { continue }
    if (-not $line.Contains("=")) { continue }
    $eq = $line.IndexOf("=")
    if ($eq -le 0) { continue }
    $k = $line.Substring(0, $eq).Trim()
    $v = $line.Substring($eq + 1)
    if ($k -match '^[a-zA-Z0-9_]+$') {
      $out[$k] = $v
    }
  }
  return $out
}

function Add-SilverCycleFieldsFromAdapterOutput {
  param(
    [hashtable]$Fields,
    [string]$AdapterOutputPath
  )
  $meta = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $AdapterOutputPath
  if ($meta.Count -eq 0) { return }
  function Take([string]$adapterKey) {
    if (-not $meta.ContainsKey($adapterKey)) { return "" }
    return [string]$meta[$adapterKey]
  }
  function SetIf([string]$fieldKey, [string]$val) {
    if (-not $val) { return }
    if ($val.Trim().Length -eq 0) { return }
    $Fields[$fieldKey] = $val
  }
  SetIf "silver_cycle_task_file" (Take "task_file")
  SetIf "silver_cycle_task_chars" (Take "task_chars")
  SetIf "silver_cycle_task_lines" (Take "task_lines")
  SetIf "silver_cycle_task_bytes_utf8" (Take "task_bytes_utf8")
  $digest = Take "task_digest"
  if (-not $digest) { $digest = Take "task_sha256_prefix" }
  SetIf "silver_cycle_task_digest" $digest
  SetIf "silver_cycle_timed_out" (Take "timed_out")
  SetIf "silver_cycle_elapsed_ms" (Take "elapsed_ms")
  SetIf "silver_cycle_timeout_seconds" (Take "timeout_seconds")
  SetIf "silver_cycle_adapter_exit_code" (Take "exit_code")
  $soB = Take "stdout_bytes"
  $seB = Take "stderr_bytes"
  $son = Take "stdout_nonempty"
  $sen = Take "stderr_nonempty"
  SetIf "silver_cycle_stdout_bytes" $soB
  SetIf "silver_cycle_stderr_bytes" $seB
  $sum = "stdout_bytes=" + $soB + ";stderr_bytes=" + $seB + ";stdout_nonempty=" + $son + ";stderr_nonempty=" + $sen
  if ($sum.Replace("=", "").Trim(";").Length -gt 0) {
    $Fields["silver_cycle_output_bytes_summary"] = $sum
  }
  SetIf "silver_cycle_streaming_output_supported" (Take "streaming_output_supported")
  SetIf "silver_cycle_last_output_utc" (Take "last_output_utc")
  SetIf "silver_cycle_post_timeout_output_interpretation" (Take "post_timeout_output_interpretation")
  if ($meta.Count -gt 0) {
    $to = Take "timed_out"
    $ex = Take "exit_code"
    if ($to -eq "YES") {
      $Fields["silver_cycle_stop_reason"] = "adapter_wall_clock_timeout"
    }
    elseif ($ex -ne "" -and $ex -ne "0") {
      if (-not ($Fields.ContainsKey("silver_cycle_stop_reason"))) {
        $Fields["silver_cycle_stop_reason"] = "adapter_exit_nonzero"
      }
    }
    else {
      if (-not ($Fields.ContainsKey("silver_cycle_stop_reason"))) {
        $Fields["silver_cycle_stop_reason"] = "adapter_completed"
      }
    }
  }
}

function Test-SilverCoreEngineProgressIsBaselinePlaceholderOnly {
  param([string]$Value)
  if (-not $Value) { return $false }
  return ($Value.IndexOf("baseline_pending_precise_measurement", [System.StringComparison]::Ordinal) -ge 0)
}

function Get-BaselineProgressMetrics {
  return [ordered]@{
    core_engine_progress = "94% baseline_pending_precise_measurement"
    safety_progress = "98.5% baseline_pending_precise_measurement"
    routing_progress = "95% baseline_pending_precise_measurement"
    retrieval_progress = "87.5% baseline_pending_precise_measurement"
    real_human_chaos_progress = "83.5% baseline_pending_precise_measurement"
    multi_intent_orchestration_progress = "65% baseline_pending_precise_measurement"
    long_session_memory_progress = "50% baseline_pending_precise_measurement"
    public_ready_progress = "87.5% baseline_pending_precise_measurement"
    source = "baseline_spec_v1"
  }
}

function Write-SilverProgressLogBlock {
  param(
    [string]$ProgressLogPath,
    [string]$Outcome,
    [hashtable]$Fields
  )
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("---")
  [void]$sb.AppendLine(("timestamp=" + $Fields["timestamp"]))
  [void]$sb.AppendLine(("cycle=" + $Fields["cycle"]))
  [void]$sb.AppendLine(("outcome=" + $Outcome))
  if ($Fields.ContainsKey("stop_reason") -and $Fields["stop_reason"]) {
    [void]$sb.AppendLine(("stop_reason=" + $Fields["stop_reason"]))
  }
  [void]$sb.AppendLine(("main_commit=" + $Fields["main_commit"]))
  [void]$sb.AppendLine(("last_task_exit=" + $Fields["last_task_exit"]))
  [void]$sb.AppendLine(("cursor_exit=" + $Fields["cursor_exit"]))
  $cycleExtraKeys = @(
    "silver_cycle_task_file",
    "silver_cycle_task_chars",
    "silver_cycle_task_lines",
    "silver_cycle_task_bytes_utf8",
    "silver_cycle_task_digest",
    "silver_cycle_timed_out",
    "silver_cycle_elapsed_ms",
    "silver_cycle_timeout_seconds",
    "silver_cycle_adapter_exit_code",
    "silver_cycle_stdout_bytes",
    "silver_cycle_stderr_bytes",
    "silver_cycle_output_bytes_summary",
    "silver_cycle_streaming_output_supported",
    "silver_cycle_last_output_utc",
    "silver_cycle_post_timeout_output_interpretation",
    "silver_cycle_stop_reason",
    "timeout_archive_path",
    "timeout_artifacts_archived"
  )
  foreach ($ck in $cycleExtraKeys) {
    if ($Fields.ContainsKey($ck)) {
      $vv = [string]$Fields[$ck]
      if ($vv.Trim().Length -gt 0) {
        [void]$sb.AppendLine(($ck + "=" + $vv))
      }
    }
  }
  [void]$sb.AppendLine(("autopilot_exit=" + $Fields["autopilot_exit"]))
  [void]$sb.AppendLine(("autopilot_status_exit=" + $Fields["autopilot_status_exit"]))
  [void]$sb.AppendLine(("git_status_clean=" + $Fields["git_status_clean"]))
  [void]$sb.AppendLine(("safety_counters=" + $Fields["safety_counters"]))
  [void]$sb.AppendLine(("calendar_write_20k=" + $Fields["calendar_write_20k"]))
  [void]$sb.AppendLine(("calendar_query_20k=" + $Fields["calendar_query_20k"]))
  [void]$sb.AppendLine(("core_engine_progress=" + $Fields["core_engine_progress"]))
  [void]$sb.AppendLine(("safety_progress=" + $Fields["safety_progress"]))
  [void]$sb.AppendLine(("routing_progress=" + $Fields["routing_progress"]))
  [void]$sb.AppendLine(("retrieval_progress=" + $Fields["retrieval_progress"]))
  [void]$sb.AppendLine(("real_human_chaos_progress=" + $Fields["real_human_chaos_progress"]))
  [void]$sb.AppendLine(("multi_intent_orchestration_progress=" + $Fields["multi_intent_orchestration_progress"]))
  [void]$sb.AppendLine(("long_session_memory_progress=" + $Fields["long_session_memory_progress"]))
  [void]$sb.AppendLine(("public_ready_progress=" + $Fields["public_ready_progress"]))
  [void]$sb.AppendLine(("source=" + $Fields["source"]))
  [void]$sb.AppendLine(("current_focus=" + $Fields["current_focus"]))
  [void]$sb.AppendLine(("next_action_headline=" + $Fields["next_action_headline"]))
  [void]$sb.AppendLine(("dry_run=" + $Fields["dry_run"]))
  [void]$sb.AppendLine("---")
  $block = $sb.ToString()
  if (-not (Test-Path -LiteralPath $ProgressLogPath)) {
    $header = "# SILVER progress log`n`nAppend-only entries from ``scripts/silver-autopilot-loop.ps1`` (V1). Do not paste secrets or API keys.`n`n"
    [System.IO.File]::WriteAllText($ProgressLogPath, $header + $block, [System.Text.UTF8Encoding]::new($false))
  } else {
    [System.IO.File]::AppendAllText($ProgressLogPath, $block, [System.Text.UTF8Encoding]::new($false))
  }
}

function Write-SilverColoredCycleSummary {
  param(
    [string]$Outcome,
    [hashtable]$Fields
  )
  Write-Host ""
  Write-Host "--- SILVER development status (full auto loop v1) ---" -ForegroundColor Cyan
  Write-Host ("timestamp=" + $Fields["timestamp"]) -ForegroundColor Cyan
  Write-Host ("cycle=" + $Fields["cycle"]) -ForegroundColor Cyan
  Write-Host ("main_commit=" + $Fields["main_commit"]) -ForegroundColor Cyan
  Write-Host ("git_status_clean=" + $Fields["git_status_clean"]) -ForegroundColor Cyan
  Write-Host ("cursor_exit=" + $Fields["cursor_exit"]) -ForegroundColor Cyan
  Write-Host ("autopilot_exit=" + $Fields["autopilot_exit"]) -ForegroundColor Cyan
  Write-Host ("autopilot_status_exit=" + $Fields["autopilot_status_exit"]) -ForegroundColor Cyan
  Write-Host ("safety_counters=" + $Fields["safety_counters"]) -ForegroundColor Cyan
  if ($Outcome -eq "FAIL") {
    Write-Host "STATUS: FAIL" -ForegroundColor Red
  } elseif ($Outcome -eq "COMPLETE") {
    Write-Host "STATUS: COMPLETE" -ForegroundColor Green
  } elseif ($Outcome -eq "PASS") {
    Write-Host "STATUS: PASS (cycle)" -ForegroundColor Green
  } else {
    Write-Host ("STATUS: " + $Outcome) -ForegroundColor Yellow
  }
  Write-Host ("next_action_headline=" + $Fields["next_action_headline"]) -ForegroundColor Cyan
  if ($Fields.ContainsKey("timeout_artifacts_archived")) {
    Write-Host ("timeout_artifacts_archived=" + [string]$Fields["timeout_artifacts_archived"]) -ForegroundColor Cyan
  }
  if ($Fields.ContainsKey("timeout_archive_path")) {
    $tap = [string]$Fields["timeout_archive_path"]
    if ($tap.Trim().Length -gt 0) {
      Write-Host ("timeout_archive_path=" + $tap) -ForegroundColor Cyan
    }
  }
  Write-Host "------------------------------------" -ForegroundColor Cyan
  Write-Host ""
}

function Invoke-NodeScript {
  param(
    [string]$WorkingDirectory,
    [string[]]$Arguments,
    [bool]$PassThruExit
  )
  $parts = New-Object System.Collections.ArrayList
  foreach ($arg in $Arguments) {
    $a = [string]$arg
    if ($a.IndexOf(" ") -ge 0) {
      [void]$parts.Add(('"' + $a.Replace('"', '""') + '"'))
    } else {
      [void]$parts.Add($a)
    }
  }
  $argLine = [string]::Join(" ", $parts.ToArray())
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = $argLine
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  if (-not $PassThruExit) {
    Write-Host $stdout
    if ($stderr) { Write-Host $stderr }
  }
  return @{ ExitCode = $p.ExitCode; StdOut = $stdout; StdErr = $stderr }
}

function Stop-LoopWithFail {
  param(
    [string]$ProgressLogPath,
    [string]$RepoRoot,
    [int]$Cycle,
    [string]$MainCommit,
    [string]$CursorExit,
    [string]$AutopilotExit,
    [string]$StatusExit,
    [string]$GitClean,
    [string]$SafetyLine,
    [string]$CalW,
    [string]$CalQ,
    [string]$Headline,
    [string]$Focus,
    [string]$DryRunText,
    [switch]$NoBeep,
    [int]$LastTaskExitCode,
    [string]$StopReason = ""
  )
  $reasonLine = $Focus
  if ($StopReason -and $StopReason.Trim()) {
    $reasonLine = $Focus + "|stop_reason=" + $StopReason.Trim()
  }
  $adapterEarly = Join-Path $RepoRoot "SILVER_CURSOR_OUTPUT.md"
  $metaTimed = ""
  $metaEarly = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $adapterEarly
  if ($metaEarly.ContainsKey("timed_out")) {
    $metaTimed = [string]$metaEarly["timed_out"]
  }
  $isTimeoutStop = ($CursorExit -eq "124") -or ($metaTimed -eq "YES")
  $timeoutArchiveRel = ""
  $timeoutArchivedFlag = "NO"
  if ($isTimeoutStop) {
    $archOut = Archive-SilverTimeoutRuntimeArtifacts -RepoRoot $RepoRoot -Reason $reasonLine -CursorExit $CursorExit -TimedOut $metaTimed
    $timeoutArchiveRel = [string]$archOut.RelativePath
    $timeoutArchivedFlag = [string]$archOut.Archived
    if ($timeoutArchiveRel -and $timeoutArchiveRel.Trim().Length -gt 0) {
      $env:SILVER_TIMEOUT_ARCHIVE_PATH = ($timeoutArchiveRel -replace "\\", "/")
      $env:SILVER_TIMEOUT_ARTIFACTS_ARCHIVED = $timeoutArchivedFlag
    }
  }
  Write-Host ("SILVER_LOOP_SAFETY_STOP reason=" + $reasonLine) -ForegroundColor Red
  $baselines = Get-BaselineProgressMetrics
  $fields = @{
    timestamp = (Get-Date).ToString("s")
    cycle = [string]$Cycle
    main_commit = $MainCommit
    last_task_exit = [string]$LastTaskExitCode
    cursor_exit = $CursorExit
    autopilot_exit = $AutopilotExit
    autopilot_status_exit = $StatusExit
    git_status_clean = $GitClean
    safety_counters = $SafetyLine
    calendar_write_20k = $CalW
    calendar_query_20k = $CalQ
    core_engine_progress = $baselines.core_engine_progress
    safety_progress = $baselines.safety_progress
    routing_progress = $baselines.routing_progress
    retrieval_progress = $baselines.retrieval_progress
    real_human_chaos_progress = $baselines.real_human_chaos_progress
    multi_intent_orchestration_progress = $baselines.multi_intent_orchestration_progress
    long_session_memory_progress = $baselines.long_session_memory_progress
    public_ready_progress = $baselines.public_ready_progress
    source = $baselines.source
    current_focus = $Focus
    next_action_headline = $Headline
    dry_run = $DryRunText
    stop_reason = $(if ($StopReason) { $StopReason } else { $Focus })
    timeout_archive_path = $timeoutArchiveRel
    timeout_artifacts_archived = $timeoutArchivedFlag
  }
  $adapterOutForCycle = Join-Path $RepoRoot "SILVER_CURSOR_OUTPUT.md"
  Add-SilverCycleFieldsFromAdapterOutput -Fields $fields -AdapterOutputPath $adapterOutForCycle
  Write-SilverProgressLogBlock -ProgressLogPath $ProgressLogPath -Outcome "FAIL" -Fields $fields
  Write-SilverColoredCycleSummary -Outcome "FAIL" -Fields $fields
  Invoke-SilverBeepFail -NoBeep:$NoBeep
  exit 1
}

function Write-SilverSafetyConsoleStop {
  param([string]$Reason)
  Write-Host ("SILVER_LOOP_SAFETY_STOP reason=" + $Reason) -ForegroundColor Yellow
}

function Get-SilverEnvIntOrEmpty {
  param([string]$Name)
  $raw = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($raw)) { $raw = [Environment]::GetEnvironmentVariable($Name, "User") }
  if ([string]::IsNullOrWhiteSpace($raw)) { $raw = [Environment]::GetEnvironmentVariable($Name, "Machine") }
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  $n = 0
  if (-not [int]::TryParse($raw.Trim(), [ref]$n)) { return $null }
  return $n
}

function Get-SilverAutonomousHardMax {
  param([int]$ParamMax)
  if ($ParamMax -gt 0) { return $ParamMax }
  $fromEnv = Get-SilverEnvIntOrEmpty -Name "SILVER_AUTONOMOUS_HARD_MAX_CYCLES"
  if ($null -ne $fromEnv -and $fromEnv -gt 0) { return $fromEnv }
  return 512
}

function Get-SilverAutonomousCycleWallCap {
  param([int]$ParamWall)
  if ($ParamWall -eq -1) { return 0 }
  if ($ParamWall -gt 0) { return $ParamWall }
  $fromEnv = Get-SilverEnvIntOrEmpty -Name "SILVER_AUTONOMOUS_MAX_CYCLE_WALL_SECONDS"
  if ($null -ne $fromEnv -and $fromEnv -gt 0) { return $fromEnv }
  return 7200
}

function Get-SilverAutonomousTotalWallCap {
  param([int]$ParamWall)
  if ($ParamWall -eq -1) { return 0 }
  if ($ParamWall -gt 0) { return $ParamWall }
  $fromEnv = Get-SilverEnvIntOrEmpty -Name "SILVER_AUTONOMOUS_MAX_TOTAL_WALL_SECONDS"
  if ($null -ne $fromEnv -and $fromEnv -gt 0) { return $fromEnv }
  return 86400
}

function Test-SilverEmergencyStopFilePresent {
  param([string]$Path)
  return (Test-Path -LiteralPath $Path)
}

function Decode-GitQuotedInnerSilver {
  param([string]$Inner)
  if ([string]::IsNullOrEmpty($Inner)) { return "" }
  $chars = $Inner.ToCharArray()
  $sb = New-Object System.Text.StringBuilder
  $i = 0
  while ($i -lt $chars.Length) {
    $c = $chars[$i]
    if ($c -ne '\') {
      [void]$sb.Append($c)
      $i++
      continue
    }
    $i++
    if ($i -ge $chars.Length) { break }
    $esc = $chars[$i]
    if ($esc -eq '\') {
      [void]$sb.Append('\')
      $i++
      continue
    }
    if ($esc -eq '"') {
      [void]$sb.Append('"')
      $i++
      continue
    }
    if ($esc -eq 'n') {
      [void]$sb.Append("`n")
      $i++
      continue
    }
    if ($esc -eq 't') {
      [void]$sb.Append("`t")
      $i++
      continue
    }
    $rest = $Inner.Substring($i)
    $m = [regex]::Match($rest, '^([0-7]{1,3})')
    if ($m.Success) {
      $octVal = $m.Groups[1].Value
      $code = ([Convert]::ToInt32($octVal, 8) -band 255)
      [void]$sb.Append([char]$code)
      $i += $octVal.Length
      continue
    }
    [void]$sb.Append($esc)
    $i++
  }
  return $sb.ToString()
}

function Normalize-SilverGitStatusWorkingTreeRel {
  param([string]$ExtractedField)
  $s = ([string]$ExtractedField).Trim() -replace '\\', '/'
  while ($s.StartsWith("./")) {
    $s = $s.Substring(2).Trim() -replace '\\', '/'
  }
  if (
    ($s.Length -ge 2) -and (
      (($s.StartsWith('"')) -and ($s.EndsWith('"'))) -or
      (($s.StartsWith("'")) -and ($s.EndsWith("'")))
    )
  ) {
    $innerPart = $s.Substring(1, $s.Length - 2)
    $decoded = Decode-GitQuotedInnerSilver -Inner $innerPart
    $s = ($decoded.Trim() -replace '\\', '/').Trim()
    while ($s.StartsWith("./")) {
      $s = $s.Substring(2).Trim() -replace '\\', '/'
    }
  }
  return $s
}

function Restore-SilverAdapterDiagnosticReportJson {
  param([string]$RepoRoot)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "git"
    $psi.Arguments = "restore --worktree -- scripts/silver-cursor-agent-adapter-diagnostic-report.json"
    $psi.WorkingDirectory = $RepoRoot
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $null = $p.StandardOutput.ReadToEnd()
    $null = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
  }
  catch {
  }
  finally {
    $ErrorActionPreference = $prev
  }
}

function Get-GitStatusShortPathsFromText {
  param([string]$Txt)
  if (-not $Txt) { return @() }
  $outList = New-Object System.Collections.Generic.List[string]
  foreach ($raw in $Txt -split "`r?`n") {
    $line = $raw.Trim()
    if (-not $line) { continue }
    $relField = ""
    if ($line.Length -ge 3 -and $line.Substring(2, 1) -eq " ") {
      $relField = $line.Substring(3).Trim()
    }
    else {
      $parts = $line -split "\s+", 2
      if ($parts.Count -ge 2) { $relField = $parts[1].Trim() } else { $relField = $line }
    }
    $norm = Normalize-SilverGitStatusWorkingTreeRel -ExtractedField $relField
    $arrowRen = " -> "
    $ai = $norm.LastIndexOf($arrowRen)
    if ($ai -ge 0) {
      $norm = Normalize-SilverGitStatusWorkingTreeRel -ExtractedField ($norm.Substring($ai + $arrowRen.Length).Trim())
    }
    if ($norm) { [void]$outList.Add($norm) }
  }
  return $outList.ToArray()
}

function Get-GitStatusShortPaths {
  param([string]$Cwd)
  $txt = (Get-GitStatusShortText -Cwd $Cwd)
  return Get-GitStatusShortPathsFromText -Txt $txt
}

function Test-AutonomousUnexpectedDirtyTree {
  param([string]$Cwd)
  $allowed = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($p in @(
      "SILVER_STRATEGY.md",
      "SILVER_NEXT_ACTION.md",
      "SILVER_RUN_REPORT.md",
      "SILVER_PROGRESS_LOG.md",
      "SILVER_AUTOPILOT_README.md",
      "SILVER_PR_ORCHESTRATOR_README.md",
      "SILVER_CURSOR_OUTPUT.md",
      "SILVER_STOP_AUTOPILOT",
      "scripts/silver-autopilot.cjs",
      "scripts/silver-autopilot-loop.ps1",
      "scripts/silver-autonomous-loop-safety-diagnostic.ps1",
      "scripts/silver-cursor-agent-adapter.ps1",
      "scripts/silver-cursor-agent-adapter-diagnostic.ps1",
      "scripts/silver-cursor-agent-adapter-diagnostic-report.json"
    )) {
    [void]$allowed.Add($p)
  }
  $paths = Get-GitStatusShortPaths -Cwd $Cwd
  foreach ($rel in $paths) {
    $n = ($rel -replace "\\", "/").Trim()
    if (-not $n) { continue }
    if ($allowed.Contains($n)) { continue }
    return @{ pass = $false; firstUnexpected = $n }
  }
  return @{ pass = $true; firstUnexpected = "" }
}

function Get-SafetyCounterTotalsFromLine {
  param([string]$SafetyCountersLine)
  $out = @{
    dangerous_write_count = 0
    false_write_count = 0
    query_created_write_count = 0
    write_when_negated_count = 0
  }
  if (-not $SafetyCountersLine) { return $out }
  $pairs = $SafetyCountersLine -split ";"
  foreach ($pair in $pairs) {
    $kv = $pair -split "=", 2
    if ($kv.Count -lt 2) { continue }
    $k = $kv[0].Trim()
    $vNum = 0
    if (-not [int]::TryParse($kv[1].Trim(), [ref]$vNum)) { continue }
    if ($out.ContainsKey($k)) { $out[$k] = $vNum }
  }
  return $out
}

function Test-SafetyCountersRegression {
  param([hashtable]$Prev, [hashtable]$Curr)
  if (-not $Prev -or -not $Curr) { return @{ regress = $false; detail = "" } }
  foreach ($k in @("dangerous_write_count", "false_write_count", "query_created_write_count", "write_when_negated_count")) {
    $p = 0
    $c = 0
    try { $p = [int]$Prev[$k] } catch { $p = 0 }
    try { $c = [int]$Curr[$k] } catch { $c = 0 }
    if ($c -gt $p) {
      return @{ regress = $true; detail = ($k + ":" + [string]$p + "->" + [string]$c) }
    }
  }
  return @{ regress = $false; detail = "" }
}

function Get-FirstPrNumberToken {
  param([string]$Text)
  if (-not $Text) { return "" }
  $m = [regex]::Match($Text, '(?i)(?:--verify-pr=|--merge-pr=|verify-pr\s*=\s*|merge-pr\s*=\s*|\bPR\s*#)\s*(\d{2,7})\b')
  if ($m.Success) { return $m.Groups[1].Value }
  return ""
}

function Normalize-SilverNextBodyForStreak {
  param([string]$Text)
  if (-not $Text) { return "" }
  $t = $Text -replace "`r`n", "`n"
  $t = $t.Trim()
  return $t
}

function Write-SilverAutonomousBudgetExit {
  param(
    [string]$ProgressLogPath,
    [string]$RepoRoot,
    [int]$Cycle,
    [string]$MainCommit,
    [string]$Reason,
    [string]$DryRunText,
    [switch]$NoBeep
  )
  $baselines = Get-BaselineProgressMetrics
  $gitCleanFinal = if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" }
  $fields = @{
    timestamp = (Get-Date).ToString("s")
    cycle = [string]$Cycle
    main_commit = $MainCommit
    last_task_exit = "0"
    cursor_exit = "N/A"
    autopilot_exit = "N/A"
    autopilot_status_exit = "N/A"
    git_status_clean = $gitCleanFinal
    safety_counters = ""
    calendar_write_20k = ""
    calendar_query_20k = ""
    core_engine_progress = $baselines.core_engine_progress
    safety_progress = $baselines.safety_progress
    routing_progress = $baselines.routing_progress
    retrieval_progress = $baselines.retrieval_progress
    real_human_chaos_progress = $baselines.real_human_chaos_progress
    multi_intent_orchestration_progress = $baselines.multi_intent_orchestration_progress
    long_session_memory_progress = $baselines.long_session_memory_progress
    public_ready_progress = $baselines.public_ready_progress
    source = $baselines.source
    current_focus = "autonomous_safety_budget_exit"
    next_action_headline = (Get-NextActionHeadline -Text (Read-TextFileOrEmpty -Path (Join-Path $RepoRoot "SILVER_NEXT_ACTION.md")))
    dry_run = $DryRunText
    stop_reason = $Reason
  }
  Write-SilverSafetyConsoleStop -Reason $Reason
  Write-SilverProgressLogBlock -ProgressLogPath $ProgressLogPath -Outcome "SAFETY_STOP" -Fields $fields
  Write-Host ("STATUS: SAFETY_STOP (" + $Reason + ")") -ForegroundColor Yellow
  Invoke-SilverBeepComplete -NoBeep:$NoBeep
  exit 0
}

# --- entry validation ---
if (-not (Test-RepoRootMatch -Expected $ExpectedRepoRoot -Actual $RepoRoot)) {
  Write-Host ("STOP: repo root mismatch. Expected: " + $ExpectedRepoRoot + " Actual: " + $RepoRoot) -ForegroundColor Red
  exit 1
}

if (-not (Test-Path -LiteralPath $AutopilotScript)) {
  Write-Host "STOP: missing scripts/silver-autopilot.cjs" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path -LiteralPath $NextActionPath)) {
  Write-Host "STOP: missing SILVER_NEXT_ACTION.md" -ForegroundColor Red
  $baselines = Get-BaselineProgressMetrics
  $failFields = @{
    timestamp = (Get-Date).ToString("s")
    cycle = "0"
    main_commit = ""
    last_task_exit = "1"
    cursor_exit = "N/A"
    autopilot_exit = "N/A"
    autopilot_status_exit = "N/A"
    git_status_clean = "NO"
    safety_counters = ""
    calendar_write_20k = ""
    calendar_query_20k = ""
    core_engine_progress = $baselines.core_engine_progress
    safety_progress = $baselines.safety_progress
    routing_progress = $baselines.routing_progress
    retrieval_progress = $baselines.retrieval_progress
    real_human_chaos_progress = $baselines.real_human_chaos_progress
    multi_intent_orchestration_progress = $baselines.multi_intent_orchestration_progress
    long_session_memory_progress = $baselines.long_session_memory_progress
    public_ready_progress = $baselines.public_ready_progress
    source = $baselines.source
    current_focus = "guard_missing_next_action"
    next_action_headline = "(missing file)"
    dry_run = ($(if ($DryRun) { "YES" } else { "NO" }))
  }
  Write-SilverProgressLogBlock -ProgressLogPath $ProgressLogPath -Outcome "FAIL" -Fields $failFields
  Invoke-SilverBeepFail -NoBeep:$NoBeep
  exit 1
}

$autonomousOptIn = ($AllowInfinite -or $AutonomousMode)
if ($MaxCycles -lt 0) {
  Write-Host "STOP: MaxCycles must be >= 0." -ForegroundColor Red
  exit 1
}
if ($MaxCycles -eq 0 -and -not $autonomousOptIn) {
  Write-SilverSafetyConsoleStop -Reason "maxcycles_zero_requires_allowinfinite_or_autonomousmode"
  exit 1
}
$controlledInfinite = ($MaxCycles -eq 0 -and $autonomousOptIn)
$infinite = $controlledInfinite
$hardCap = if ($controlledInfinite) { Get-SilverAutonomousHardMax -ParamMax $MaxAutonomousHardCycles } else { [int32]::MaxValue }
$cycleWallCapAuto = if ($controlledInfinite) { Get-SilverAutonomousCycleWallCap -ParamWall $MaxCycleWallSeconds } else { 0 }
$totalWallCapAuto = if ($controlledInfinite) { Get-SilverAutonomousTotalWallCap -ParamWall $TotalWallSeconds } else { 0 }
$autonomousRunStart = if ($controlledInfinite) { Get-Date } else { $null }
$script:AutonomousStatusFailStreak = 0
$script:AutonomousSameNextStreak = 0
$script:AutonomousNoProgStreak = 0
$script:AutonomousPrKey = ""
$script:AutonomousPrStreak = 0
$script:LastNextNormalized = ""
$script:LastCoreProgress = ""
$script:LastSafetyMap = $null

if ($TimeoutArchiveSelfTest) {
  $td = Join-Path $env:TEMP ("silver-timeout-selftest-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $td -Force | Out-Null
  $utfSe = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText((Join-Path $td "SILVER_CURSOR_OUTPUT.md"), "# silver-cursor-agent-adapter`r`ntimed_out=YES`r`n", $utfSe)
  [System.IO.File]::WriteAllText((Join-Path $td "SILVER_NEXT_ACTION.md"), "# t`r`n", $utfSe)
  $ar = Archive-SilverTimeoutRuntimeArtifacts -RepoRoot $td -Reason "selftest" -CursorExit "124" -TimedOut "YES"
  $ok = $false
  if ($ar.Archived -eq "YES" -and $ar.FullPath -and (Test-Path -LiteralPath (Join-Path $ar.FullPath "manifest.json"))) {
    $ok = $true
  }
  Remove-Item -LiteralPath $td -Recurse -Force -ErrorAction SilentlyContinue
  if (-not $ok) {
    Write-Host "SILVER_TIMEOUT_ARCHIVE_SELFTEST=FAIL" -ForegroundColor Red
    exit 1
  }
  Write-Host "SILVER_TIMEOUT_ARCHIVE_SELFTEST=PASS"
  exit 0
}

$cycle = 0
while ($true) {
  $cycle++
  $script:CycleIndex = $cycle
  $script:LastCursorExit = "N/A"
  $script:LastAutopilotExit = "N/A"
  $script:LastStatusExit = "N/A"
  $script:LastTaskExit = 0
  Remove-Item Env:\SILVER_TIMEOUT_ARCHIVE_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:\SILVER_TIMEOUT_ARTIFACTS_ARCHIVED -ErrorAction SilentlyContinue

  if (-not $infinite -and $cycle -gt $MaxCycles) { break }

  if ($null -ne $autonomousRunStart -and $totalWallCapAuto -gt 0) {
    $elapsedTotal = ((Get-Date) - $autonomousRunStart).TotalSeconds
    if ($elapsedTotal -gt $totalWallCapAuto) {
      Write-SilverAutonomousBudgetExit -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit "" `
        -Reason "total_wall_seconds_exhausted" -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep
    }
  }

  if ($controlledInfinite -and $cycle -gt $hardCap) {
    $mcEarly = ""
    try {
      $prevEaMc = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      $mcEarly = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
      $ErrorActionPreference = $prevEaMc
    } catch {
      $mcEarly = ""
    }
    Write-SilverAutonomousBudgetExit -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mcEarly `
      -Reason "hard_cycle_budget_exhausted" -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep
  }

  if (Test-SilverEmergencyStopFilePresent -Path $EmergencyStopPath) {
    $mcStop = ""
    try {
      $prevEaSt = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      $mcStop = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
      $ErrorActionPreference = $prevEaSt
    } catch {
      $mcStop = ""
    }
    Write-SilverAutonomousBudgetExit -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mcStop `
      -Reason "emergency_stop_file_present" -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep
  }

  if ($controlledInfinite) {
    $dirtyGuardAuto = Test-AutonomousUnexpectedDirtyTree -Cwd $RepoRoot
    if (-not $dirtyGuardAuto.pass) {
      $mcDirty = ""
      try {
        $prevEaDi = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $mcDirty = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
        $ErrorActionPreference = $prevEaDi
      } catch {
        $mcDirty = ""
      }
      $nextPeek = Read-TextFileOrEmpty -Path $NextActionPath
      Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mcDirty `
        -CursorExit "N/A" -AutopilotExit "N/A" -StatusExit "N/A" `
        -GitClean "NO" -SafetyLine "" -CalW "" -CalQ "" `
        -Headline (Get-NextActionHeadline -Text $nextPeek) -Focus "autonomous_unexpected_dirty_tree" `
        -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1 `
        -StopReason ("unexpected_path=" + $dirtyGuardAuto.firstUnexpected)
    }
  }

  $cycleT0 = Get-Date

  $mainCommit = ""
  try {
    $prevEa = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $mainCommit = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
    $ErrorActionPreference = $prevEa
  } catch {
    $mainCommit = ""
  }

  $nextText = Read-TextFileOrEmpty -Path $NextActionPath
  if ($nextText -match "SILVER_DEVELOPMENT_COMPLETE") {
    $baselines = Get-BaselineProgressMetrics
    $gitClean = if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" }
    $reportText = Read-TextFileOrEmpty -Path $RunReportPath
    $safetyLine = Get-RunReportLineValue -ReportText $reportText -Key "safety_counters"
    $calW = Get-RunReportLineValue -ReportText $reportText -Key "calendar_write_20k"
    $calQ = Get-RunReportLineValue -ReportText $reportText -Key "calendar_query_20k"
    $fields = @{
      timestamp = (Get-Date).ToString("s")
      cycle = [string]$cycle
      main_commit = $mainCommit
      last_task_exit = "0"
      cursor_exit = "N/A"
      autopilot_exit = "N/A"
      autopilot_status_exit = "N/A"
      git_status_clean = $gitClean
      safety_counters = $safetyLine
      calendar_write_20k = $calW
      calendar_query_20k = $calQ
      core_engine_progress = $baselines.core_engine_progress
      safety_progress = $baselines.safety_progress
      routing_progress = $baselines.routing_progress
      retrieval_progress = $baselines.retrieval_progress
      real_human_chaos_progress = $baselines.real_human_chaos_progress
      multi_intent_orchestration_progress = $baselines.multi_intent_orchestration_progress
      long_session_memory_progress = $baselines.long_session_memory_progress
      public_ready_progress = $baselines.public_ready_progress
      source = $baselines.source
      current_focus = "SILVER_DEVELOPMENT_COMPLETE"
      next_action_headline = "SILVER_DEVELOPMENT_COMPLETE"
      dry_run = ($(if ($DryRun) { "YES" } else { "NO" }))
    }
    Write-SilverProgressLogBlock -ProgressLogPath $ProgressLogPath -Outcome "COMPLETE" -Fields $fields
    Write-SilverColoredCycleSummary -Outcome "COMPLETE" -Fields $fields
    Invoke-SilverBeepComplete -NoBeep:$NoBeep
    exit 0
  }

  if (-not $nextText.Trim()) {
    Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
      -CursorExit "N/A" -AutopilotExit "N/A" -StatusExit "N/A" `
      -GitClean "NO" -SafetyLine "" -CalW "" -CalQ "" `
      -Headline "(empty SILVER_NEXT_ACTION.md)" -Focus "guard_empty_next_action" `
      -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1
  }

  # Rewrites SILVER_NEXT_ACTION.md when autopilot NEXT_ACTION inner quality gates fail (e.g. bare `node scripts/silver-autopilot.cjs`).
  if (-not $DryRun) {
    try {
      $sanitizeRes = Invoke-NodeScript -WorkingDirectory $RepoRoot -Arguments @($AutopilotScript, "--sanitize-next-action-md") -PassThruExit $true
      if (($null -ne $sanitizeRes) -and ($sanitizeRes.ExitCode -ne 0)) {
        Write-Host ("silver-autopilot-loop: sanitize-next-action-md_exit=" + [string]$sanitizeRes.ExitCode + " continuing=YES") -ForegroundColor DarkYellow
      }
    }
    catch {
      Write-Host "silver-autopilot-loop: sanitize-next-action-md_invoke_failed continuing=YES" -ForegroundColor DarkYellow
    }
    $nextText = Read-TextFileOrEmpty -Path $NextActionPath
  }

  $gitShort = Get-GitStatusShortText -Cwd $RepoRoot
  if (Test-AssetsAppJsInStatus -GitShort $gitShort) {
    if ($nextText -notmatch "ENGINE_ALLOWED") {
      Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
        -CursorExit "N/A" -AutopilotExit "N/A" -StatusExit "N/A" `
        -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine "" -CalW "" -CalQ "" `
        -Headline (Get-NextActionHeadline -Text $nextText) -Focus "guard_assets_app_without_engine_allow" `
        -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1
    }
  }

  if (Test-EngineTaskPolicyViolation -Text $nextText) {
    Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
      -CursorExit "N/A" -AutopilotExit "N/A" -StatusExit "N/A" `
      -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine "" -CalW "" -CalQ "" `
      -Headline (Get-NextActionHeadline -Text $nextText) -Focus "guard_engine_task_policy" `
      -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1
  }

  if ($controlledInfinite -and -not (Test-SilverNextActionOutputQuality -Text $nextText)) {
    Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
      -CursorExit "N/A" -AutopilotExit "N/A" -StatusExit "N/A" `
      -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine "" -CalW "" -CalQ "" `
      -Headline (Get-NextActionHeadline -Text $nextText) -Focus "autonomous_bad_next_action_quality_precycle" `
      -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1 `
      -StopReason "SILVER_NEXT_ACTION.md failed quality gate (UTF-8/hallucination/cat-windows/bare node scripts/silver-autopilot.cjs)"
  }

  $reportPre = Read-TextFileOrEmpty -Path $RunReportPath
  $safetyPre = Get-RunReportLineValue -ReportText $reportPre -Key "safety_counters"
  if (Test-SafetyCountersBlocked -SafetyCountersLine $safetyPre) {
    Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
      -CursorExit "N/A" -AutopilotExit "N/A" -StatusExit "N/A" `
      -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre -CalW "" -CalQ "" `
      -Headline (Get-NextActionHeadline -Text $nextText) -Focus "guard_safety_counters_nonzero" `
      -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1
  }

  # Cursor adapter
  $cursorExitStr = "SKIPPED"
  if ([string]::IsNullOrWhiteSpace($CursorCommand)) {
    Write-Host "CursorCommand is not set - no destructive CLI will be launched." -ForegroundColor Yellow
    Write-Host "Set -CursorCommand with {TASK_FILE} and {OUTPUT_FILE} tokens for real loops." -ForegroundColor Yellow
    if (-not $DryRun) {
      Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
        -CursorExit "MISSING" -AutopilotExit "N/A" -StatusExit "N/A" `
        -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
        -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
        -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
        -Headline (Get-NextActionHeadline -Text $nextText) -Focus "cursor_command_required" `
        -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1
    }
    $cursorExitStr = "SKIPPED_DRY_RUN_NO_CURSOR_COMMAND"
  } else {
    if (-not $DryRun) {
      $taskAbs = (Resolve-Path -LiteralPath $NextActionPath).Path
      $outAbs = $CursorOutputPath
      $quotedTask = '"' + $taskAbs.Replace('"', '""') + '"'
      $quotedOut = '"' + $outAbs.Replace('"', '""') + '"'
      $resolvedCmd = $CursorCommand.Replace("{TASK_FILE}", $quotedTask).Replace("{OUTPUT_FILE}", $quotedOut)

      $stdoutTmp = Join-Path $env:TEMP ("silver-loop-cursor-out-" + $cycle + ".txt")
      $stderrTmp = Join-Path $env:TEMP ("silver-loop-cursor-err-" + $cycle + ".txt")

      $utf8Log = [System.Text.UTF8Encoding]::new($false)
      $preCursorBody = ""
      if (Test-Path -LiteralPath $CursorOutputPath) {
        $preCursorBody = [System.IO.File]::ReadAllText($CursorOutputPath, $utf8Log)
      }

      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = "cmd.exe"
      $psi.Arguments = "/c " + $resolvedCmd + " 1> """ + $stdoutTmp + """ 2> """ + $stderrTmp + """"
      $psi.WorkingDirectory = $RepoRoot
      $psi.UseShellExecute = $false
      $psi.CreateNoWindow = $true
      try {
        $p = [System.Diagnostics.Process]::Start($psi)
        $p.WaitForExit()
        $ce = $p.ExitCode
        $script:LastCursorExit = [string]$ce
        $cursorExitStr = [string]$ce
        $soRes = Read-SilverLoopTempCaptureFileWithRetry -Path $stdoutTmp
        $seRes = Read-SilverLoopTempCaptureFileWithRetry -Path $stderrTmp
        if ((-not $soRes.Success) -or (-not $seRes.Success)) {
          $failParts = @()
          if (-not $soRes.Success) { $failParts += $soRes.FailureReason }
          if (-not $seRes.Success) { $failParts += $seRes.FailureReason }
          $captureReadStop = [string]::Join(" | ", $failParts)
          Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
            -CursorExit $cursorExitStr -AutopilotExit "N/A" -StatusExit "N/A" `
            -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
            -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
            -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
            -Headline (Get-NextActionHeadline -Text $nextText) -Focus "cursor_temp_capture_read_lock" `
            -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1 `
            -StopReason $captureReadStop
        }
        $so = [string]$soRes.Text
        $se = [string]$seRes.Text
        $soTrim = $so.Trim()
        $seTrim = $se.Trim()
        $adapterHeaderPresent = ($preCursorBody.IndexOf("# silver-cursor-agent-adapter", [System.StringComparison]::Ordinal) -ge 0)
        if (($soTrim.Length -gt 0) -or ($seTrim.Length -gt 0)) {
          if (($ce -eq 124) -and $adapterHeaderPresent) {
            $merged = $preCursorBody.TrimEnd() + "`n`n# silver-autopilot-loop: outer cmd.exe wrapper (exit 124; adapter body preserved above)" + "`n# stdout`n" + $so + "`n# stderr`n" + $se + "`n"
            [System.IO.File]::WriteAllText($CursorOutputPath, $merged, $utf8Log)
          }
          else {
            $merged = "# silver-autopilot-loop: captured Cursor CLI output`n# stdout`n" + $so + "`n# stderr`n" + $se + "`n"
            [System.IO.File]::WriteAllText($CursorOutputPath, $merged, $utf8Log)
          }
        }
        else {
          if (-not (Test-Path -LiteralPath $CursorOutputPath)) {
            $stub = "# silver-autopilot-loop: no outer stdout/stderr; child wrote only to OutputFile or produced no file.`n"
            [System.IO.File]::WriteAllText($CursorOutputPath, $stub, $utf8Log)
          }
        }
        if ($ce -eq 124) {
          $closeBlk = "`n`nSILVER_TIMEOUT_CLOSEOUT_REMINDER`nread_before_git_restore_or_clean=YES`npreserve_paths_first=SILVER_NEXT_ACTION.md;SILVER_CURSOR_OUTPUT.md`nnote=Wall-clock timeout (exit 124). Read SILVER_NEXT_ACTION.md and SILVER_CURSOR_OUTPUT.md before discard, git restore, or clean.`n"
          if (Test-Path -LiteralPath $CursorOutputPath) {
            [System.IO.File]::AppendAllText($CursorOutputPath, $closeBlk, $utf8Log)
          }
        }
      } finally {
        if (Test-Path -LiteralPath $stdoutTmp) { Remove-Item -LiteralPath $stdoutTmp -Force -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $stderrTmp) { Remove-Item -LiteralPath $stderrTmp -Force -ErrorAction SilentlyContinue }
      }

      if ($ce -ne 0) {
        Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
          -CursorExit $cursorExitStr -AutopilotExit "N/A" -StatusExit "N/A" `
          -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
          -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
          -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
          -Headline (Get-NextActionHeadline -Text $nextText) -Focus "cursor_exit_nonzero" `
          -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1 `
          -StopReason $(if ($ce -eq 124) { "cursor_outer_or_adapter_timeout_exit_124" } else { "" })
      }
    } else {
      $cursorExitStr = "SKIPPED_DRY_RUN"
    }
  }

  # OPENAI_API_KEY guard for real autonomous step
  if (-not $DryRun) {
    $apiKey = [Environment]::GetEnvironmentVariable("OPENAI_API_KEY", "Process")
    if ([string]::IsNullOrWhiteSpace($apiKey)) {
      $apiKey = [Environment]::GetEnvironmentVariable("OPENAI_API_KEY", "User")
    }
    if ([string]::IsNullOrWhiteSpace($apiKey)) {
      $apiKey = [Environment]::GetEnvironmentVariable("OPENAI_API_KEY", "Machine")
    }
    if ([string]::IsNullOrWhiteSpace($apiKey)) {
      Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
        -CursorExit $cursorExitStr -AutopilotExit "N/A" -StatusExit "N/A" `
        -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
        -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
        -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
        -Headline (Get-NextActionHeadline -Text $nextText) -Focus "OPENAI_API_KEY_MISSING_non_dry_run_stop" `
        -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1
    }
  }

  $autoExitStr = "SKIPPED_DRY_RUN"
  if (-not $DryRun) {
    $metaForRestore = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $CursorOutputPath
    $timedForRestore = ""
    if ($metaForRestore.ContainsKey("timed_out")) {
      $timedForRestore = [string]$metaForRestore["timed_out"]
    }
    if ($timedForRestore -eq "YES") {
      $archR = Archive-SilverTimeoutRuntimeArtifacts -RepoRoot $RepoRoot -Reason "adapter_timed_out_before_progress_git_restore" -CursorExit $cursorExitStr -TimedOut $timedForRestore
      $tr = [string]$archR.RelativePath
      if ($tr -and $tr.Trim().Length -gt 0) {
        $env:SILVER_TIMEOUT_ARCHIVE_PATH = ($tr -replace "\\", "/")
        $env:SILVER_TIMEOUT_ARTIFACTS_ARCHIVED = [string]$archR.Archived
      }
    }
    Restore-SilverProgressLogForAutopilotGuard -RepoRoot $RepoRoot -ProgressRel "SILVER_PROGRESS_LOG.md"
    $auto = Invoke-NodeScript -WorkingDirectory $RepoRoot -Arguments @($AutopilotScript, "--full-auto-loop", "--max-steps=1") -PassThruExit $false
    $ae = $auto.ExitCode
    $script:LastAutopilotExit = [string]$ae
    $autoExitStr = [string]$ae
    if ($ae -ne 0) {
      Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
        -CursorExit $cursorExitStr -AutopilotExit $autoExitStr -StatusExit "N/A" `
        -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
        -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
        -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
        -Headline (Get-NextActionHeadline -Text $nextText) -Focus "autopilot_exit_nonzero" `
        -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1
    }
    Restore-SilverAdapterDiagnosticReportJson -RepoRoot $RepoRoot
    $nextAfterAuto = Read-TextFileOrEmpty -Path $NextActionPath
    if (-not (Test-SilverNextActionOutputQuality -Text $nextAfterAuto)) {
      Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
        -CursorExit $cursorExitStr -AutopilotExit $autoExitStr -StatusExit "N/A" `
        -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
        -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
        -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
        -Headline (Get-NextActionHeadline -Text $nextAfterAuto) -Focus "next_action_quality_post_guard" `
        -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1
    }
  }

  $st = Invoke-NodeScript -WorkingDirectory $RepoRoot -Arguments @($AutopilotScript, "--status") -PassThruExit $false
  $se = $st.ExitCode
  $script:LastStatusExit = [string]$se

  $reportPost = Read-TextFileOrEmpty -Path $RunReportPath
  $safetyPost = Get-RunReportLineValue -ReportText $reportPost -Key "safety_counters"
  if (Test-SafetyCountersBlocked -SafetyCountersLine $safetyPost) {
    Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
      -CursorExit $cursorExitStr -AutopilotExit $autoExitStr -StatusExit ([string]$se) `
      -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPost `
      -CalW (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_write_20k") `
      -CalQ (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_query_20k") `
      -Headline (Get-NextActionHeadline -Text (Read-TextFileOrEmpty -Path $NextActionPath)) -Focus "guard_safety_after_status" `
      -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1
  }

  $gitCleanFinal = if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" }
  $baselines = Get-BaselineProgressMetrics
  $progressSource = [string]$baselines["source"]
  $coreEngineProgress = [string]$baselines["core_engine_progress"]
  $m = Get-RunReportLineValue -ReportText $reportPost -Key "core_engine_progress"
  if ($m) {
    $coreEngineProgress = [string]$m
    $progressSource = "SILVER_RUN_REPORT.md"
  }

  $nextAfter = Read-TextFileOrEmpty -Path $NextActionPath

  if ($controlledInfinite) {
    if ($cycleWallCapAuto -gt 0) {
      $elapsedCycleSec = ((Get-Date) - $cycleT0).TotalSeconds
      if ($elapsedCycleSec -gt $cycleWallCapAuto) {
        Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
          -CursorExit $cursorExitStr -AutopilotExit $autoExitStr -StatusExit ([string]$se) `
          -GitClean $gitCleanFinal -SafetyLine $safetyPost `
          -CalW (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_write_20k") `
          -CalQ (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_query_20k") `
          -Headline (Get-NextActionHeadline -Text $nextAfter) -Focus "autonomous_cycle_wall_timeout" `
          -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1 `
          -StopReason ("elapsed_sec=" + [string][math]::Round($elapsedCycleSec, 1) + ";cap=" + [string]$cycleWallCapAuto)
      }
    }
    if ($se -ne 0) {
      $script:AutonomousStatusFailStreak++
    } else {
      $script:AutonomousStatusFailStreak = 0
    }
    if ($script:AutonomousStatusFailStreak -ge $RepeatedFailureStopAfter) {
      Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
        -CursorExit $cursorExitStr -AutopilotExit $autoExitStr -StatusExit ([string]$se) `
        -GitClean $gitCleanFinal -SafetyLine $safetyPost `
        -CalW (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_write_20k") `
        -CalQ (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_query_20k") `
        -Headline (Get-NextActionHeadline -Text $nextAfter) -Focus "autonomous_repeated_status_nonzero" `
        -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1 `
        -StopReason ("streak=" + [string]$script:AutonomousStatusFailStreak)
    }
    $normAfter = Normalize-SilverNextBodyForStreak -Text $nextAfter
    if ($normAfter -eq "" -or -not $normAfter) {
      $script:AutonomousSameNextStreak = 0
    } elseif ($normAfter -eq $script:LastNextNormalized) {
      $script:AutonomousSameNextStreak++
    } else {
      $script:AutonomousSameNextStreak = 1
    }
    $script:LastNextNormalized = $normAfter
    if ($script:AutonomousSameNextStreak -ge $SameNextActionStopAfter) {
      Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
        -CursorExit $cursorExitStr -AutopilotExit $autoExitStr -StatusExit ([string]$se) `
        -GitClean $gitCleanFinal -SafetyLine $safetyPost `
        -CalW (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_write_20k") `
        -CalQ (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_query_20k") `
        -Headline (Get-NextActionHeadline -Text $nextAfter) -Focus "autonomous_same_next_action_streak" `
        -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1 `
        -StopReason ("streak=" + [string]$script:AutonomousSameNextStreak)
    }
    $coreNpBaselineOnly = Test-SilverCoreEngineProgressIsBaselinePlaceholderOnly -Value $coreEngineProgress
    if ($coreNpBaselineOnly) {
      Write-Host ("SILVER_NO_PROGRESS_CHECK_SKIPPED reason=baseline_only_metric_not_dynamic_heartbeat token=baseline_pending_precise_measurement autonomous_no_progress_streak_unchanged=YES") -ForegroundColor DarkYellow
    } else {
      if ($script:LastCoreProgress -ne "" -and $coreEngineProgress -eq $script:LastCoreProgress -and ($coreEngineProgress.Trim())) {
        $script:AutonomousNoProgStreak++
      } else {
        if ($coreEngineProgress.Trim()) { $script:AutonomousNoProgStreak = 0 }
      }
      $script:LastCoreProgress = $coreEngineProgress
    }
    if ($script:AutonomousNoProgStreak -ge $NoProgressStopAfter) {
      Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
        -CursorExit $cursorExitStr -AutopilotExit $autoExitStr -StatusExit ([string]$se) `
        -GitClean $gitCleanFinal -SafetyLine $safetyPost `
        -CalW (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_write_20k") `
        -CalQ (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_query_20k") `
        -Headline (Get-NextActionHeadline -Text $nextAfter) -Focus "autonomous_no_progress_streak" `
        -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1 `
        -StopReason ("core_engine_progress=" + $coreEngineProgress + ";streak=" + [string]$script:AutonomousNoProgStreak)
    }
    $prTok2 = Get-FirstPrNumberToken -Text $nextAfter
    if ($prTok2 -and $prTok2 -eq $script:AutonomousPrKey) {
      $script:AutonomousPrStreak++
    } elseif ($prTok2) {
      $script:AutonomousPrKey = $prTok2
      $script:AutonomousPrStreak = 1
    } else {
      $script:AutonomousPrKey = ""
      $script:AutonomousPrStreak = 0
    }
    if ($script:AutonomousPrStreak -ge $PrLoopStopAfter) {
      Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
        -CursorExit $cursorExitStr -AutopilotExit $autoExitStr -StatusExit ([string]$se) `
        -GitClean $gitCleanFinal -SafetyLine $safetyPost `
        -CalW (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_write_20k") `
        -CalQ (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_query_20k") `
        -Headline (Get-NextActionHeadline -Text $nextAfter) -Focus "autonomous_pr_instruction_loop" `
        -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1 `
        -StopReason ("pr=" + $script:AutonomousPrKey + ";streak=" + [string]$script:AutonomousPrStreak)
    }
    $currMap = Get-SafetyCounterTotalsFromLine -SafetyCountersLine $safetyPost
    if ($null -ne $script:LastSafetyMap) {
      $reg = Test-SafetyCountersRegression -Prev $script:LastSafetyMap -Curr $currMap
      if ($reg.regress) {
        Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
          -CursorExit $cursorExitStr -AutopilotExit $autoExitStr -StatusExit ([string]$se) `
          -GitClean $gitCleanFinal -SafetyLine $safetyPost `
          -CalW (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_write_20k") `
          -CalQ (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_query_20k") `
          -Headline (Get-NextActionHeadline -Text $nextAfter) -Focus "autonomous_safety_counters_regression" `
          -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1 `
          -StopReason $reg.detail
      }
    }
    $script:LastSafetyMap = $currMap
  }

  $fieldsPass = @{
    timestamp = (Get-Date).ToString("s")
    cycle = [string]$cycle
    main_commit = $mainCommit
    last_task_exit = "0"
    cursor_exit = $cursorExitStr
    autopilot_exit = $autoExitStr
    autopilot_status_exit = [string]$se
    git_status_clean = $gitCleanFinal
    safety_counters = $safetyPost
    calendar_write_20k = (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_write_20k")
    calendar_query_20k = (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_query_20k")
    core_engine_progress = $coreEngineProgress
    safety_progress = [string]$baselines["safety_progress"]
    routing_progress = [string]$baselines["routing_progress"]
    retrieval_progress = [string]$baselines["retrieval_progress"]
    real_human_chaos_progress = [string]$baselines["real_human_chaos_progress"]
    multi_intent_orchestration_progress = [string]$baselines["multi_intent_orchestration_progress"]
    long_session_memory_progress = [string]$baselines["long_session_memory_progress"]
    public_ready_progress = [string]$baselines["public_ready_progress"]
    source = $progressSource
    current_focus = "silver_full_auto_loop_trigger_v1"
    next_action_headline = (Get-NextActionHeadline -Text $nextAfter)
    dry_run = ($(if ($DryRun) { "YES" } else { "NO" }))
    stop_reason = "silver_full_auto_cycle_pass"
  }
  Add-SilverCycleFieldsFromAdapterOutput -Fields $fieldsPass -AdapterOutputPath $CursorOutputPath
  Write-SilverProgressLogBlock -ProgressLogPath $ProgressLogPath -Outcome "PASS" -Fields $fieldsPass
  Write-SilverColoredCycleSummary -Outcome "PASS" -Fields $fieldsPass
  Invoke-SilverBeepPass -NoBeep:$NoBeep

  if (-not $infinite -and $cycle -ge $MaxCycles) { break }
  if ($infinite -or $cycle -lt $MaxCycles) {
    Start-Sleep -Seconds $SleepSeconds
  }
}

exit 0
