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
  [switch]$TimeoutArchiveSelfTest,
  [switch]$PreflightCleanupSelfTest,
  [switch]$Cap50TimeoutUtf8SelfTest,
  [switch]$Cap50PostconditionSelfTest,
  [switch]$Cap50HardPreflight,
  [switch]$Cap50ThreeCycleProbe,
  [switch]$Cap50ThreeCycleOrchestrationProbe,
  [switch]$Cap50MojibakeRegressionSelfTest,
  [switch]$Cap50RealUtf8CaptureProbe
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
$SilverUtf8HandoffPath = Join-Path $PSScriptRoot "silver-utf8-handoff.ps1"
$SilverCap50PolicyPath = Join-Path $PSScriptRoot "silver-cap50-orchestration-policy.ps1"
if (-not (Test-Path -LiteralPath $SilverUtf8HandoffPath)) {
  Write-Error ("Missing UTF-8 handoff module: " + $SilverUtf8HandoffPath)
  exit 2
}
if (-not (Test-Path -LiteralPath $SilverCap50PolicyPath)) {
  Write-Error ("Missing CAP50 orchestration policy: " + $SilverCap50PolicyPath)
  exit 2
}
. $SilverUtf8HandoffPath
. $SilverCap50PolicyPath
Initialize-SilverConsoleUtf8

$script:CycleIndex = 0
$script:LastCursorExit = "N/A"
$script:LastAutopilotExit = "N/A"
$script:LastStatusExit = "N/A"
$script:LastTaskExit = 0
$script:SilverCycleCursorProcessStartUtc = [datetime]::MinValue
$script:SilverCycleExpectedTaskDigest = ""
$script:SilverCycleExpectedTaskFile = ""
$script:SilverAutonomousRunId = ""
$script:SilverAutonomousRunStartUtc = [datetime]::MinValue

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
  return Read-TextFileUtf8Handoff -Path $Path
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

function Update-SilverAutonomousReportingHygieneAccumulator {
  param(
    [string]$ReportText,
    [hashtable]$CycleFields
  )
  if ($CycleFields.ContainsKey("silver_cycle_real_stale_adapter_meta_issue")) {
    if ([string]$CycleFields["silver_cycle_real_stale_adapter_meta_issue"] -eq "YES") {
      $script:AutonomousRealStaleMetaIssueSeen = "YES"
    }
  }
  $emb = Get-RunReportLineValue -ReportText $ReportText -Key "stale_embedded_hint_seen"
  if ($emb -eq "YES") {
    $script:AutonomousStaleEmbeddedHintSeen = "YES"
    $na = Get-RunReportLineValue -ReportText $ReportText -Key "stale_embedded_hint_non_authoritative"
    if ($na -eq "YES") {
      $script:AutonomousStaleEmbeddedNonAuth = "YES"
    }
  }
  $authPass = Get-RunReportLineValue -ReportText $ReportText -Key "authoritative_runtime_pass"
  if ($authPass -eq "YES") {
    $script:AutonomousAuthoritativeRuntimePass = "YES"
  }
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

function Test-NextActionLineIndicatesCatWindowsDocContext {
  param([string]$NonemptyLine)
  $p = ([string]$NonemptyLine).Trim()
  if (-not $p) { return $false }
  if (Test-NextActionLineIndicatesDocumentaryContext -NonemptyLine $p) { return $true }
  return ($p -match '(?i)Nepoužívej|nepoužívej|never\s+(suggest|use)|don''?t\s+use|not\s+use|zakázan|Zakáz|použij\s+`Get-Content|use\s+Get-Content|Get-Content\s+-LiteralPath|místo\s+`?cat|instead\s+of\s+`?cat|`cat\s+C:\\[^`]*\.\.\.')
}

function Test-NextActionLineLooksLikeRunnableCatWindows {
  param([string]$Line)
  $t = ([string]$Line).Trim()
  if (-not $t) { return $false }
  if (Test-NextActionLineIndicatesCatWindowsDocContext -NonemptyLine $t) { return $false }
  if ($t -match '(?i)`cat\s+C:\\[^`]*\.\.\.') { return $false }
  if ($t -match '(?i)Nepoužívej[^\n]*`?cat\s+C:') { return $false }
  if ($t -match '(?i)never\s+suggest[^\n]*`?cat\s+C:') { return $false }
  if ($t -match '(?im)^\s*cat\s+C:\\') { return $true }
  if ($t -match '(?i)\bCommand:\s*`?cat\s+C:\\') { return $true }
  if ($t -match '(?i)`cat\s+C:\\') { return $true }
  return $false
}

function Test-NextActionHasRunnableCatWindowsInvocation {
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
    $prevNonEmpty = ""
    foreach ($fline in ($body -split "`n")) {
      $trimmed = ([string]$fline).Trim()
      if (-not $trimmed) { continue }
      if (-not (Test-NextActionLineLooksLikeRunnableCatWindows -Line $trimmed)) {
        $prevNonEmpty = $trimmed
        continue
      }
      $docAllowed =
        (Test-NextActionLineIndicatesCatWindowsDocContext -NonemptyLine $prevNonEmpty) -or
        (Test-NextActionLineIndicatesCatWindowsDocContext -NonemptyLine $trimmed)
      if (-not $docAllowed) { return $true }
      $prevNonEmpty = $trimmed
    }
  }

  $prevNonEmpty = ""
  foreach ($oline in $outsideLines) {
    $trimmed = ([string]$oline).Trim()
    if (-not $trimmed) { continue }
    if (-not (Test-NextActionLineLooksLikeRunnableCatWindows -Line $trimmed)) {
      $prevNonEmpty = $trimmed
      continue
    }
    $docAllowed =
      (Test-NextActionLineIndicatesCatWindowsDocContext -NonemptyLine $prevNonEmpty) -or
      (Test-NextActionLineIndicatesCatWindowsDocContext -NonemptyLine $trimmed)
    if (-not $docAllowed) { return $true }
    $prevNonEmpty = $trimmed
  }
  return $false
}

function Get-SilverTaskUtf8Sha256HexPrefix {
  param(
    [string]$Text,
    [int]$HexChars = 16
  )
  if ($null -eq $Text) { $Text = "" }
  $enc = New-Object System.Text.UTF8Encoding $false
  $bytes = $enc.GetBytes($Text)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash($bytes)
  }
  finally {
    if ($null -ne $sha) { $sha.Dispose() }
  }
  $hex = [System.BitConverter]::ToString($hash).Replace("-", "").ToLowerInvariant()
  if ($hex.Length -le $HexChars) { return $hex }
  return $hex.Substring(0, $HexChars)
}

function Normalize-SilverPathForCompare {
  param([string]$Path)
  if (-not $Path) { return "" }
  try {
    return [System.IO.Path]::GetFullPath($Path).Trim().ToLowerInvariant()
  }
  catch {
    return ([string]$Path).Trim().ToLowerInvariant().Replace("\", "/")
  }
}

function Get-SilverAutonomousRunContext {
  $rid = ""
  if ((Get-Variable -Name SilverAutonomousRunId -Scope Script -ErrorAction SilentlyContinue) -and $script:SilverAutonomousRunId) {
    $rid = [string]$script:SilverAutonomousRunId
  }
  if (-not $rid.Trim()) {
    $rid = [Environment]::GetEnvironmentVariable("SILVER_AUTONOMOUS_RUN_ID", "Process")
  }
  if (-not $rid) { $rid = "" }
  $rs = ""
  if ((Get-Variable -Name SilverAutonomousRunStartUtc -Scope Script -ErrorAction SilentlyContinue) -and $script:SilverAutonomousRunStartUtc -and ($script:SilverAutonomousRunStartUtc -ne [datetime]::MinValue)) {
    $rs = $script:SilverAutonomousRunStartUtc.ToString("o")
  }
  if (-not $rs.Trim()) {
    $rs = [Environment]::GetEnvironmentVariable("SILVER_AUTONOMOUS_RUN_START_UTC", "Process")
  }
  if (-not $rs) { $rs = "" }
  $cyc = [Environment]::GetEnvironmentVariable("SILVER_AUTONOMOUS_CYCLE", "Process")
  if (-not $cyc) { $cyc = "" }
  return @{
    RunId = $rid.Trim()
    RunStartUtc = $rs.Trim()
    Cycle = $cyc.Trim()
  }
}

function Write-SilverCursorOutputInvalidatedStub {
  param(
    [string]$Path,
    [string]$RunId,
    [string]$RunStartUtcIso,
    [string]$CycleState
  )
  $stub = @"
# silver-cursor-agent-adapter
autonomous_run_id=$RunId
autonomous_run_start_utc=$RunStartUtcIso
autonomous_cycle=$CycleState
adapter_output_state=INVALIDATED_AWAITING_CYCLE
process_start_utc=
task_digest=
exit_code=
elapsed_ms=

# stdout

# stderr

"@
  [System.IO.File]::WriteAllText($Path, $stub, [System.Text.UTF8Encoding]::new($false))
}

function Initialize-SilverAutonomousRunLifecycle {
  param(
    [string]$RunId,
    [datetime]$RunStartUtc,
    [string]$CursorOutputPath
  )
  $runStartIso = $RunStartUtc.ToString("o")
  $script:SilverAutonomousRunId = $RunId
  $script:SilverAutonomousRunStartUtc = $RunStartUtc
  $env:SILVER_AUTONOMOUS_RUN_ID = $RunId
  $env:SILVER_AUTONOMOUS_RUN_START_UTC = $runStartIso
  Remove-Item Env:\SILVER_AUTONOMOUS_CYCLE -ErrorAction SilentlyContinue
  Write-SilverCursorOutputInvalidatedStub -Path $CursorOutputPath -RunId $RunId -RunStartUtcIso $runStartIso -CycleState "pending"
}

function Test-SilverAdapterMetaCycleScoped {
  param(
    [hashtable]$Meta,
    [datetime]$ProcessStartUtc,
    [string]$AdapterOutputPath,
    [string]$ExpectedTaskDigest = "",
    [string]$ExpectedTaskFile = "",
    [string]$ExpectedRunId = "",
    [string]$ExpectedCycle = "",
    [string]$ExpectedRunStartUtc = ""
  )
  if ($null -eq $Meta -or $Meta.Count -eq 0) { return $false }
  if (-not (Test-Path -LiteralPath $AdapterOutputPath)) { return $false }

  $wantRunId = $ExpectedRunId.Trim()
  if ($wantRunId.Length -gt 0) {
    $metaState = ""
    if ($Meta.ContainsKey("adapter_output_state")) { $metaState = [string]$Meta["adapter_output_state"] }
    if ($metaState -eq "INVALIDATED_AWAITING_CYCLE") { return $false }
    $metaRun = ""
    if ($Meta.ContainsKey("autonomous_run_id")) { $metaRun = [string]$Meta["autonomous_run_id"] }
    if ($metaRun.Trim().Length -gt 0) {
      if ($metaRun.Trim() -ne $wantRunId) { return $false }
    }
    $wantCycle = $ExpectedCycle.Trim()
    if ($wantCycle.Length -gt 0) {
      $metaCycle = ""
      if ($Meta.ContainsKey("autonomous_cycle")) { $metaCycle = [string]$Meta["autonomous_cycle"] }
      if ($metaCycle.Trim().Length -gt 0) {
        if ($metaCycle.Trim() -ne $wantCycle) { return $false }
      }
    }
    $wantRunStart = $ExpectedRunStartUtc.Trim()
    if ($wantRunStart.Length -gt 0) {
      $metaRunStart = ""
      if ($Meta.ContainsKey("autonomous_run_start_utc")) { $metaRunStart = [string]$Meta["autonomous_run_start_utc"] }
      if ($metaRunStart.Trim().Length -gt 0) {
        $wantNorm = $wantRunStart
        $metaNorm = $metaRunStart.Trim()
        try {
          $wantNorm = ([datetime]::Parse($wantRunStart, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)).ToUniversalTime().ToString("o")
          $metaNorm = ([datetime]::Parse($metaRunStart.Trim(), [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)).ToUniversalTime().ToString("o")
        }
        catch {
        }
        if ($metaNorm -ne $wantNorm) { return $false }
      }
    }
  }

  try {
    $mtimeUtc = ([System.IO.File]::GetLastWriteTimeUtc($AdapterOutputPath))
    if ($mtimeUtc -lt $ProcessStartUtc.AddSeconds(-2)) { return $false }
  }
  catch {
    return $false
  }

  $procStartMeta = ""
  if ($Meta.ContainsKey("process_start_utc")) { $procStartMeta = [string]$Meta["process_start_utc"] }
  if ($wantRunId.Length -gt 0) {
    if ($procStartMeta.Trim().Length -eq 0) { return $false }
  }
  if ($procStartMeta.Trim().Length -gt 0) {
    try {
      $psMeta = [datetime]::Parse(
        $procStartMeta,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::RoundtripKind
      ).ToUniversalTime()
      if ($psMeta -lt $ProcessStartUtc.AddSeconds(-5)) { return $false }
    }
    catch {
      return $false
    }
  }
  elseif ($Meta.ContainsKey("timestamp_local")) {
    try {
      $tsLocal = [datetime]::Parse(
        [string]$Meta["timestamp_local"],
        $null,
        [System.Globalization.DateTimeStyles]::AssumeLocal
      )
      if ($tsLocal.ToUniversalTime() -lt $ProcessStartUtc.AddMinutes(-2)) { return $false }
    }
    catch {
      if ($ExpectedTaskDigest.Trim().Length -gt 0) { return $false }
    }
  }
  elseif ($ExpectedTaskDigest.Trim().Length -gt 0) {
    return $false
  }

  if ($ExpectedTaskDigest.Trim().Length -gt 0) {
    $metaDigest = ""
    if ($Meta.ContainsKey("task_digest")) { $metaDigest = [string]$Meta["task_digest"] }
    if ((-not $metaDigest) -and $Meta.ContainsKey("task_sha256_prefix")) {
      $metaDigest = [string]$Meta["task_sha256_prefix"]
    }
    $metaDigest = $metaDigest.Trim().ToLowerInvariant()
    $want = $ExpectedTaskDigest.Trim().ToLowerInvariant()
    if ((-not $metaDigest) -or ($metaDigest -ne $want)) { return $false }
  }

  if ($ExpectedTaskFile.Trim().Length -gt 0) {
    $metaTask = ""
    if ($Meta.ContainsKey("task_file")) { $metaTask = [string]$Meta["task_file"] }
    if ($metaTask -and ($metaTask -ne "(probe_inline)")) {
      $nMeta = Normalize-SilverPathForCompare -Path $metaTask
      $nWant = Normalize-SilverPathForCompare -Path $ExpectedTaskFile
      if (($nMeta.Length -gt 0) -and ($nWant.Length -gt 0) -and ($nMeta -ne $nWant)) { return $false }
    }
  }

  return $true
}

function Test-SilverAdapterMetaFreshForCycle {
  param(
    [hashtable]$Meta,
    [datetime]$ProcessStartUtc,
    [string]$AdapterOutputPath,
    [string]$ExpectedTaskDigest = "",
    [string]$ExpectedTaskFile = "",
    [string]$ExpectedRunId = "",
    [string]$ExpectedCycle = "",
    [string]$ExpectedRunStartUtc = ""
  )
  if (-not (Test-SilverAdapterMetaCycleScoped -Meta $Meta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc)) {
    return $false
  }
  $to = ""
  $sen = ""
  if ($Meta.ContainsKey("timed_out")) { $to = [string]$Meta["timed_out"] }
  if ($Meta.ContainsKey("stderr_nonempty")) { $sen = [string]$Meta["stderr_nonempty"] }
  if ($to -eq "YES") { return $false }
  if ($sen -eq "YES") { return $false }
  return $true
}

function Resolve-SilverCursorOuterExitFromAdapterMeta {
  param(
    [int]$OuterExit,
    [string]$AdapterOutputPath,
    [datetime]$ProcessStartUtc,
    [string]$ExpectedTaskDigest = "",
    [string]$ExpectedTaskFile = "",
    [string]$ExpectedRunId = "",
    [string]$ExpectedCycle = "",
    [string]$ExpectedRunStartUtc = ""
  )
  if ($OuterExit -eq 0) {
    return @{ EffectiveExit = 0; Reconciled = $false; FreshMeta = $false }
  }
  if (-not (Test-Path -LiteralPath $AdapterOutputPath)) {
    return @{ EffectiveExit = $OuterExit; Reconciled = $false; FreshMeta = $false }
  }
  $meta = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $AdapterOutputPath
  if (-not (Test-SilverAdapterMetaFreshForCycle -Meta $meta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc)) {
    return @{ EffectiveExit = $OuterExit; Reconciled = $false; FreshMeta = $false }
  }
  $adapterEx = ""
  if ($meta.ContainsKey("adapter_authoritative_exit_code")) {
    $adapterEx = [string]$meta["adapter_authoritative_exit_code"]
  }
  if (-not $adapterEx) {
    if ($meta.ContainsKey("exit_code")) { $adapterEx = [string]$meta["exit_code"] }
  }
  $shellNoise = ""
  if ($meta.ContainsKey("shell_exit_noise_reconciled")) {
    $shellNoise = [string]$meta["shell_exit_noise_reconciled"]
  }
  if ($adapterEx -eq "0") {
    return @{ EffectiveExit = 0; Reconciled = $true; FreshMeta = $true }
  }
  if (($shellNoise -eq "YES") -and ($meta.ContainsKey("stdout_nonempty")) -and ([string]$meta["stdout_nonempty"] -eq "YES")) {
    $to = ""
    if ($meta.ContainsKey("timed_out")) { $to = [string]$meta["timed_out"] }
    if ($to -ne "YES") {
      return @{ EffectiveExit = 0; Reconciled = $true; FreshMeta = $true }
    }
  }
  return @{ EffectiveExit = $OuterExit; Reconciled = $false; FreshMeta = $true }
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

function Test-SilverNextActionSilverWorkflowContext {
  param([string]$Text)
  return ($Text -match '(?i)PRODUCT_CLUSTER|NEXT PRODUCT CLUSTER|silver-rhc3|scripts/silver-|cluster diagnostic|harness|audit_silver|SILVER_PRODUCT_CLUSTER|top_cluster=')
}

function Test-SilverNextActionOutputQuality {
  param([string]$Text)
  if (-not $Text) { return $true }
  if (Test-SilverUtf8MojibakeMarkers -Text $Text) { return $false }
  $hasCluster = Test-SilverNextActionSilverWorkflowContext -Text $Text
  if ($Text -match '(?i)git\s+push\s+-u\s+origin') {
    if (-not $hasCluster) { return $false }
  }
  if ($Text -match 'chore/silver-audit-repo-state') { return $false }
  if ($Text -match '(?i)(?:--verify-pr=\d+|\bverify-pr\b)') {
    if (-not $hasCluster) { return $false }
  }
  if ($Text -match '(?i)(?:sudo\s+apt\s+(?:update|install)|gh\s+auth\s+login)') {
    if (-not $hasCluster) { return $false }
  }
  if ($Text -match '(?i)--verify-pr=3794\b') { return $false }
  if ($Text -match '(?i)full-auto-loop-openai' -and $Text -match '(?i)(?:sudo\s+apt|gh\s+auth|verify-pr)') {
    if (-not $hasCluster) { return $false }
  }
  if (-not $hasCluster) {
    if ($Text -match '(?i)(?:sudo\s+apt|gh\s+auth|verify-pr|git\s+push\s+-u)') {
      if ($Text -notmatch '(?i)INFRA_BLOCKER_REASON:\s*\S+') { return $false }
    }
  }
  if (Test-NextActionHasBareSilverAutopilotNodeInvocation -Inner $Text) { return $false }
  if ($Text -match '(?i)\bnode\s+scripts/silver-diagnostic\.js\b') { return $false }
  if ($Text -match '(?i)\bnode\s+scripts/silver-smoke-test-maxcycles-1\.js\b') { return $false }
  if (Test-NextActionHasRunnableCatWindowsInvocation -Inner $Text) { return $false }
  return $true
}

function Test-SilverCursorOutputHandoffValid {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $full = [System.IO.File]::ReadAllText($Path, $utf8)
  if ($full.IndexOf("# silver-cursor-agent-adapter", [System.StringComparison]::Ordinal) -lt 0) {
    return $false
  }
  $meta = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $Path
  if ($meta.ContainsKey("adapter_output_state")) {
    if ([string]$meta["adapter_output_state"] -eq "INVALIDATED_AWAITING_CYCLE") { return $false }
  }
  $stdoutMarker = "# stdout"
  $idx = $full.IndexOf($stdoutMarker, [System.StringComparison]::Ordinal)
  if ($idx -lt 0) { return $false }
  $tail = $full.Substring($idx + $stdoutMarker.Length)
  $stderrMarker = "# stderr"
  $stderrIdx = $tail.IndexOf($stderrMarker, [System.StringComparison]::Ordinal)
  if ($stderrIdx -ge 0) { $tail = $tail.Substring(0, $stderrIdx) }
  $stdoutCompact = ($tail -replace '\s', '')
  if ($stdoutCompact.Length -ge 20) { return $true }
  $stdoutNonempty = ""
  if ($meta.ContainsKey("stdout_nonempty")) { $stdoutNonempty = [string]$meta["stdout_nonempty"] }
  return ($stdoutNonempty.Trim().ToUpperInvariant() -eq "YES")
}

function Stop-LoopOnHandoffPersistenceGuard {
  param(
    [string]$ProgressLogPath,
    [string]$RepoRoot,
    [int]$Cycle,
    [string]$MainCommit,
    [string]$DryRunText,
    [switch]$NoBeep
  )
  $nextPath = Join-Path $RepoRoot "SILVER_NEXT_ACTION.md"
  $cursorPath = Join-Path $RepoRoot "SILVER_CURSOR_OUTPUT.md"
  $nextText = Read-TextFileOrEmpty -Path $nextPath
  $nextOk = Test-SilverNextActionOutputQuality -Text $nextText
  $cursorOk = Test-SilverCursorOutputHandoffValid -Path $cursorPath
  if ($nextOk -and $cursorOk) { return $true }
  $focus = "handoff_persistence_guard_fail"
  if (-not $nextOk) { $focus = $focus + "|next_action_quality" }
  if (-not $cursorOk) { $focus = $focus + "|cursor_output_invalidated_or_empty" }
  Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $MainCommit `
    -CursorExit "N/A" -AutopilotExit "N/A" -StatusExit "N/A" `
    -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine "" -CalW "" -CalQ "" `
    -Headline (Get-NextActionHeadline -Text $nextText) -Focus $focus `
    -DryRunText $DryRunText -NoBeep:$NoBeep -LastTaskExitCode 1 `
    -StopReason "HANDOFF_PERSISTENCE_GUARD_FAIL"
  return $false
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
    [string]$AdapterOutputPath,
    [datetime]$ProcessStartUtc = [datetime]::MinValue,
    [string]$ExpectedTaskDigest = "",
    [string]$ExpectedTaskFile = "",
    [string]$ExpectedRunId = "",
    [string]$ExpectedCycle = "",
    [string]$ExpectedRunStartUtc = "",
    [bool]$CursorInvoked = $true
  )
  $runScoped = ($ExpectedRunId.Trim().Length -gt 0)
  if (-not $CursorInvoked) {
    if ($runScoped) {
      $Fields["silver_cycle_adapter_meta_fresh"] = "NO"
      $Fields["silver_cycle_stale_meta_skipped"] = "YES"
      $Fields["silver_cycle_autonomous_run_id"] = $ExpectedRunId
      if ($ExpectedCycle.Trim().Length -gt 0) {
        $Fields["silver_cycle_autonomous_cycle"] = $ExpectedCycle
      }
    }
    return
  }
  $meta = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $AdapterOutputPath
  if ($meta.Count -eq 0) { return }
  if ($runScoped) {
    $Fields["silver_cycle_autonomous_run_id"] = $ExpectedRunId
    if ($ExpectedCycle.Trim().Length -gt 0) {
      $Fields["silver_cycle_autonomous_cycle"] = $ExpectedCycle
    }
  }
  if ($ProcessStartUtc -ne [datetime]::MinValue) {
    $metaCycleScoped = Test-SilverAdapterMetaCycleScoped -Meta $meta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc
    $metaFresh = Test-SilverAdapterMetaFreshForCycle -Meta $meta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc
    if ($metaFresh) {
      $Fields["silver_cycle_adapter_meta_fresh"] = "YES"
    }
    else {
      $Fields["silver_cycle_adapter_meta_fresh"] = "NO"
    }
    if ($runScoped -and (-not $metaCycleScoped)) {
      $Fields["silver_cycle_real_stale_adapter_meta_issue"] = "YES"
      return
    }
    if (-not $metaFresh) {
      $toOnly = ""
      if ($meta.ContainsKey("timed_out")) { $toOnly = [string]$meta["timed_out"] }
      if ($toOnly -eq "YES") {
        $Fields["silver_cycle_adapter_meta_timeout_blocks_reconcile"] = "YES"
      }
    }
  }
  elseif ($runScoped) {
    $Fields["silver_cycle_adapter_meta_fresh"] = "NO"
    return
  }
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
  SetIf "silver_cycle_effective_timeout_seconds" (Take "effective_timeout_seconds")
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
    "silver_cycle_autonomous_run_id",
    "silver_cycle_autonomous_cycle",
    "silver_cycle_stale_meta_skipped",
    "silver_cycle_real_stale_adapter_meta_issue",
    "silver_cycle_adapter_meta_fresh",
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
  $isUtf8Stop = ($CursorExit -eq "12") -or ($Focus -match 'utf8_mojibake') -or ($StopReason -match 'utf8_mojibake')
  $timeoutArchiveRel = ""
  $timeoutArchivedFlag = "NO"
  if ($isUtf8Stop) {
    $utf8Arch = Archive-SilverCap50Utf8FailureRuntimeArtifacts -RepoRoot $RepoRoot -Cycle $Cycle -Reason $reasonLine -CursorExit $CursorExit
    if ([string]$utf8Arch.RelativePath) {
      Write-Host ("silver-autopilot-loop: utf8_failure_archive=" + [string]$utf8Arch.RelativePath) -ForegroundColor DarkYellow
    }
    $utf8Cleanup = Invoke-SilverCap50PostCycleRuntimeCleanup -RepoRoot $RepoRoot -Cycle $Cycle -Reason $reasonLine
    Write-Host ("silver-autopilot-loop: utf8_failure_cleanup_PASS_FAIL=" + [string]$utf8Cleanup.PASS_FAIL) -ForegroundColor DarkYellow
    if ($utf8Cleanup.safe_to_start_cycle -eq "YES") {
      $GitClean = "YES"
    }
    elseif ([string]$utf8Cleanup.blocked_dirty_files) {
      Write-Host ("silver-autopilot-loop: utf8_failure_blocked_dirty_files=" + [string]$utf8Cleanup.blocked_dirty_files) -ForegroundColor Red
    }
  }
  if ($isTimeoutStop) {
    $archOut = Archive-SilverTimeoutRuntimeArtifacts -RepoRoot $RepoRoot -Reason $reasonLine -CursorExit $CursorExit -TimedOut $metaTimed
    $timeoutArchiveRel = [string]$archOut.RelativePath
    $timeoutArchivedFlag = [string]$archOut.Archived
    if ($timeoutArchiveRel -and $timeoutArchiveRel.Trim().Length -gt 0) {
      $env:SILVER_TIMEOUT_ARCHIVE_PATH = ($timeoutArchiveRel -replace "\\", "/")
      $env:SILVER_TIMEOUT_ARTIFACTS_ARCHIVED = $timeoutArchivedFlag
    }
    $closeoutCleanup = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot
    Write-Host ("silver-autopilot-loop: timeout_closeout_preflight_PASS_FAIL=" + [string]$closeoutCleanup.PASS_FAIL) -ForegroundColor DarkYellow
    if ($closeoutCleanup.safe_to_start_cycle -eq "YES") {
      $GitClean = "YES"
    }
    elseif ([string]$closeoutCleanup.blocked_dirty_files) {
      Write-Host ("silver-autopilot-loop: timeout_closeout_blocked_dirty_files=" + [string]$closeoutCleanup.blocked_dirty_files) -ForegroundColor Red
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
  $failProcStart = [datetime]::MinValue
  $failDigest = ""
  $failTaskFile = ""
  if ($script:SilverCycleCursorProcessStartUtc -and ($script:SilverCycleCursorProcessStartUtc -ne [datetime]::MinValue)) {
    $failProcStart = $script:SilverCycleCursorProcessStartUtc
    $failDigest = [string]$script:SilverCycleExpectedTaskDigest
    $failTaskFile = [string]$script:SilverCycleExpectedTaskFile
  }
  $failRunCtx = Get-SilverAutonomousRunContext
  $failCursorInvoked = ($failProcStart -ne [datetime]::MinValue)
  Add-SilverCycleFieldsFromAdapterOutput -Fields $fields -AdapterOutputPath $adapterOutForCycle -ProcessStartUtc $failProcStart -ExpectedTaskDigest $failDigest -ExpectedTaskFile $failTaskFile -ExpectedRunId $failRunCtx.RunId -ExpectedCycle $failRunCtx.Cycle -ExpectedRunStartUtc $failRunCtx.RunStartUtc -CursorInvoked $failCursorInvoked
  Write-SilverProgressLogBlock -ProgressLogPath $ProgressLogPath -Outcome "FAIL" -Fields $fields
  Write-SilverColoredCycleSummary -Outcome "FAIL" -Fields $fields
  if ($controlledInfinite) {
    $reportFail = Read-TextFileOrEmpty -Path (Join-Path $RepoRoot "SILVER_RUN_REPORT.md")
    $safetyFail = Get-RunReportLineValue -ReportText $reportFail -Key "safety_counters"
    $finalPost = Invoke-SilverCap50FinalPostcondition -RepoRoot $RepoRoot -CyclesCompleted $Cycle -StopReason $reasonLine -NextActionPath (Join-Path $RepoRoot "SILVER_NEXT_ACTION.md") -CursorOutputPath (Join-Path $RepoRoot "SILVER_CURSOR_OUTPUT.md") -SafetyCountersLine $safetyFail
    Write-SilverCap50FinalPostconditionBlock -Result $finalPost
  }
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

function Get-SilverTransientGeneratedAuditReportRelPaths {
  return @(
    "scripts/silver-quality-v2-report.json",
    "scripts/silver-realistic-mobile-corpus-report.json",
    "scripts/silver-real-czech-corpus-v1-report.json",
    "scripts/silver-real-czech-public-ux-corpus-v2-report.json",
    "scripts/silver-deep-product-real-ux-v2-report.json",
    "scripts/silver-real-human-chaos-v3-report.json"
  )
}

function Restore-SilverTransientGeneratedAuditReports {
  param([string]$RepoRoot)
  $rels = Get-SilverTransientGeneratedAuditReportRelPaths
  if (-not $rels -or $rels.Count -lt 1) { return }
  $argTail = ""
  foreach ($rel in $rels) {
    if ($argTail.Length -gt 0) { $argTail += " " }
    $argTail += $rel
  }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "git"
    $psi.Arguments = "restore --worktree -- " + $argTail
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

function Test-SilverPathIsTransientClusterClassifierReport {
  param([string]$RelPath)
  $n = ([string]$RelPath).Trim() -replace '\\', '/'
  if (-not $n) { return $false }
  return ($n -cmatch '^scripts/silver-[a-z0-9][a-z0-9_-]*-cluster-classifier-v\d+-report\.json$')
}

function Get-SilverCap50RuntimeRestoreAllowReason {
  param([string]$RelPath)
  $n = ([string]$RelPath).Trim() -replace '\\', '/'
  if (-not $n) { return "" }
  switch -Regex ($n) {
    '^SILVER_CURSOR_OUTPUT\.md$' { return 'runtime_reporting_md' }
    '^SILVER_NEXT_ACTION\.md$' { return 'runtime_reporting_md' }
    '^SILVER_PROGRESS_LOG\.md$' { return 'runtime_reporting_md' }
    '^SILVER_RUN_REPORT\.md$' { return 'runtime_reporting_md' }
    '^scripts/silver-cursor-agent-adapter-diagnostic-report\.json$' { return 'runtime_adapter_diagnostic_json' }
    '^scripts/silver-rhc3-negation-cal-readonly-diagnostic-report\.json$' { return 'runtime_rhc3_diagnostic_json' }
    default {
      foreach ($auditRel in (Get-SilverTransientGeneratedAuditReportRelPaths)) {
        if ([string]::Equals($n, $auditRel, [System.StringComparison]::OrdinalIgnoreCase)) {
          return 'runtime_transient_audit_json'
        }
      }
      if (Test-SilverPathIsTransientClusterClassifierReport -RelPath $n) {
        return 'runtime_cluster_classifier_json'
      }
      return ''
    }
  }
}

function Test-SilverPathIsCap50RuntimeRestorable {
  param([string]$RelPath)
  $reason = Get-SilverCap50RuntimeRestoreAllowReason -RelPath $RelPath
  return ($reason.Length -gt 0)
}

function Test-SilverCap50RuntimeEphemeralsClean {
  param([string]$Cwd)
  foreach ($rel in (Get-GitStatusShortPaths -Cwd $Cwd)) {
    $n = ($rel -replace '\\', '/')
    if (Test-SilverPathIsCap50RuntimeRestorable -RelPath $n) {
      return $false
    }
  }
  return $true
}

function Test-Cap50GitCleanExceptHandoffArtifacts {
  param([string]$Cwd)
  foreach ($rel in (Get-GitStatusShortPaths -Cwd $Cwd)) {
    $n = ($rel -replace '\\', '/').Trim()
    if (-not $n) { continue }
    if ($n -eq 'SILVER_NEXT_ACTION.md' -or $n -eq 'SILVER_RUN_REPORT.md') { continue }
    if (Test-SilverPathIsCap50RuntimeRestorable -RelPath $n) { continue }
    return $false
  }
  return $true
}

function Invoke-SilverGitRestoreWorktreePaths {
  param([string]$RepoRoot, [string[]]$RelPaths)
  if (-not $RelPaths -or $RelPaths.Count -lt 1) { return }
  $argTail = ""
  foreach ($rel in $RelPaths) {
    if (-not $rel) { continue }
    if ($argTail.Length -gt 0) { $argTail += " " }
    $argTail += ([string]$rel).Trim() -replace '\\', '/'
  }
  if (-not $argTail) { return }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "git"
    $psi.Arguments = "restore --worktree -- " + $argTail
    $psi.WorkingDirectory = $RepoRoot
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $null = $p.StandardOutput.ReadToEnd()
    $null = $p.StandardError.ReadToEnd()
    $p.WaitForExit() | Out-Null
    if ($p.ExitCode -ne 0) {
      Start-Sleep -Milliseconds 150
      $p2 = [System.Diagnostics.Process]::Start($psi)
      $null = $p2.StandardOutput.ReadToEnd()
      $null = $p2.StandardError.ReadToEnd()
      $p2.WaitForExit() | Out-Null
    }
  }
  catch {
  }
  finally {
    $ErrorActionPreference = $prev
  }
}

function Get-GitStatusShortDirtyEntries {
  param([string]$Cwd)
  $txt = (Get-GitStatusShortText -Cwd $Cwd)
  $entries = New-Object System.Collections.Generic.List[object]
  if (-not $txt) { return $entries.ToArray() }
  foreach ($raw in $txt -split "`r?`n") {
    $line = $raw.Trim()
    if (-not $line) { continue }
    $st = ""
    if ($line.Length -ge 2) { $st = $line.Substring(0, 2) }
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
    if (-not $norm) { continue }
    $untracked = ($st -eq "??")
    [void]$entries.Add(@{
        path      = ($norm -replace '\\', '/')
        untracked = $untracked
        status    = $st
      })
  }
  return $entries.ToArray()
}

function Invoke-SilverCap50PostCycleRuntimeCleanup {
  param(
    [string]$RepoRoot,
    [int]$Cycle,
    [string]$Reason,
    [switch]$DryRunOnly,
    [switch]$AllowForeignDirty,
    [switch]$AllowHandoffDirty,
    [string[]]$ExcludeRestoreRelPaths = @()
  )
  $archivePath = ""
  if (-not $DryRunOnly) {
    $arch = Archive-SilverCap50CycleRuntimeArtifacts -RepoRoot $RepoRoot -Cycle $Cycle -Reason $Reason
    if ($arch.Archived -eq "YES") {
      $archivePath = [string]$arch.RelativePath
    }
  }
  $cleanup = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot -DryRunOnly:$DryRunOnly -AllowForeignDirty:$AllowForeignDirty -AllowHandoffDirty:$AllowHandoffDirty -ExcludeRestoreRelPaths $ExcludeRestoreRelPaths
  $cleanup.archive_path = $archivePath
  return $cleanup
}

function Invoke-SilverCap50PreflightCleanup {
  param(
    [string]$RepoRoot,
    [switch]$DryRunOnly,
    [switch]$AllowForeignDirty,
    [switch]$AllowHandoffDirty,
    [string[]]$ExcludeRestoreRelPaths = @()
  )
  $excludeNorm = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($ex in $ExcludeRestoreRelPaths) {
    $exN = ([string]$ex).Trim() -replace '\\', '/'
    if ($exN) { [void]$excludeNorm.Add($exN) }
  }
  $entries = Get-GitStatusShortDirtyEntries -Cwd $RepoRoot
  $dirtyBefore = New-Object System.Collections.Generic.List[string]
  $toRestore = New-Object System.Collections.Generic.List[string]
  $blocked = New-Object System.Collections.Generic.List[string]
  $allowCount = 0
  foreach ($ent in $entries) {
    $p = [string]$ent.path
    if (-not $p) { continue }
    [void]$dirtyBefore.Add($p)
    $pNorm = $p -replace '\\', '/'
    if ($excludeNorm.Contains($pNorm)) { continue }
    $reason = Get-SilverCap50RuntimeRestoreAllowReason -RelPath $p
    if ($ent.untracked) {
      if ($reason) {
        [void]$blocked.Add($p + '(untracked_runtime_unknown)')
      }
      else {
        [void]$blocked.Add($p + '(untracked_unknown)')
      }
      continue
    }
    if ($reason) {
      $allowCount++
      [void]$toRestore.Add($p)
    }
    else {
      [void]$blocked.Add($p)
    }
  }
  $restored = New-Object System.Collections.Generic.List[string]
  if ((-not $DryRunOnly) -and ($toRestore.Count -gt 0)) {
    Invoke-SilverGitRestoreWorktreePaths -RepoRoot $RepoRoot -RelPaths $toRestore.ToArray()
    foreach ($rp in $toRestore) { [void]$restored.Add($rp) }
  }
  elseif ($DryRunOnly) {
    foreach ($rp in $toRestore) { [void]$restored.Add($rp + '(dry_run)') }
  }
  $cleanAfter = if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" }
  $runtimeClean = if (Test-SilverCap50RuntimeEphemeralsClean -Cwd $RepoRoot) { "YES" } else { "NO" }
  $safe = "NO"
  if ($blocked.Count -eq 0) {
    if ($cleanAfter -eq "YES") { $safe = "YES" }
    elseif ($DryRunOnly -and $toRestore.Count -gt 0 -and $dirtyBefore.Count -eq $toRestore.Count) { $safe = "YES" }
    elseif ($AllowHandoffDirty -and (Test-Cap50GitCleanExceptHandoffArtifacts -Cwd $RepoRoot)) { $safe = "YES" }
  }
  elseif ($AllowForeignDirty -and $runtimeClean -eq "YES") {
    $safe = "YES"
  }
  $passFail = if ($safe -eq "YES") { "PASS" } else { "FAIL" }
  $sep = [char]59
  return @{
    dirty_before                      = ($dirtyBefore -join $sep)
    allowlisted_runtime_dirty_count   = [string]$allowCount
    restored_runtime_files            = ($restored -join $sep)
    blocked_dirty_files               = ($blocked -join $sep)
    git_clean_after                   = $cleanAfter
    safe_to_start_cycle               = $safe
    PASS_FAIL                         = $passFail
  }
}

function Write-SilverCap50PreflightCleanupResultBlock {
  param([hashtable]$Result)
  $rb = [string]$Result.dirty_before
  $rac = [string]$Result.allowlisted_runtime_dirty_count
  $rrf = [string]$Result.restored_runtime_files
  $bdf = [string]$Result.blocked_dirty_files
  $gca = [string]$Result.git_clean_after
  $sts = [string]$Result.safe_to_start_cycle
  $pff = [string]$Result.PASS_FAIL
  Write-Host ""
  Write-Host "=== SILVER_CAP50_PREFLIGHT_CLEANUP_RESULT ===" -ForegroundColor Cyan
  Write-Host ("dirty_before=" + $rb)
  Write-Host ("allowlisted_runtime_dirty_count=" + $rac)
  Write-Host ("restored_runtime_files=" + $rrf)
  Write-Host ("blocked_dirty_files=" + $bdf)
  Write-Host ("git_clean_after=" + $gca)
  Write-Host ("safe_to_start_cycle=" + $sts)
  $pfCol = "Red"
  if ($pff -eq "PASS") { $pfCol = "Green" }
  Write-Host ("PASS_FAIL=" + $pff) -ForegroundColor $pfCol
  Write-Host "=== END_SILVER_CAP50_PREFLIGHT_CLEANUP_RESULT ===" -ForegroundColor Cyan
  Write-Host ""
}

function Invoke-SilverCap50PreflightCleanupSelfTest {
  param([string]$RepoRoot)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $failures = New-Object System.Collections.Generic.List[string]
  function Test-OneCase {
    param([string]$Name, [string]$RelPath, [bool]$ExpectPass)
    $full = Join-Path $RepoRoot $RelPath
    $backup = ""
    if (Test-Path -LiteralPath $full) {
      $backup = [System.IO.File]::ReadAllText($full, $utf8)
    }
    try {
      [System.IO.File]::WriteAllText($full, "# cap50-preflight-selftest " + $Name + "`n", $utf8)
      $res = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot
      $restoredTxt = [string]$res.restored_runtime_files
      $stillDirty = Get-GitStatusShortPaths -Cwd $RepoRoot
      $stillHasTarget = $false
      foreach ($sp in $stillDirty) {
        if ([string]::Equals(($sp -replace '\\', '/'), $RelPath, [System.StringComparison]::OrdinalIgnoreCase)) {
          $stillHasTarget = $true
        }
      }
      if ($ExpectPass) {
        if ($restoredTxt.IndexOf($RelPath, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
          [void]$failures.Add($Name + ": target not in restored_runtime_files")
        }
        if ($stillHasTarget) {
          [void]$failures.Add($Name + ": target still dirty after restore")
        }
      }
      else {
        if ($res.PASS_FAIL -ne "FAIL") {
          [void]$failures.Add($Name + ": expected FAIL got " + $res.PASS_FAIL)
        }
        if ([string]$res.blocked_dirty_files.Length -lt 1) {
          [void]$failures.Add($Name + ": expected blocked_dirty_files")
        }
      }
    }
    finally {
      if ($backup.Length -gt 0) {
        try {
          [System.IO.File]::WriteAllText($full, $backup, $utf8)
        }
        catch {
          Invoke-SilverGitRestoreWorktreePaths -RepoRoot $RepoRoot -RelPaths @($RelPath)
        }
      }
      else {
        Invoke-SilverGitRestoreWorktreePaths -RepoRoot $RepoRoot -RelPaths @($RelPath)
      }
      $null = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot
    }
  }
  Test-OneCase -Name "dirty_SILVER_RUN_REPORT" -RelPath "SILVER_RUN_REPORT.md" -ExpectPass $true
  Test-OneCase -Name "dirty_SILVER_NEXT_ACTION" -RelPath "SILVER_NEXT_ACTION.md" -ExpectPass $true
  Test-OneCase -Name "dirty_cluster_classifier_json" -RelPath "scripts/silver-rhc3-cluster-classifier-v1-report.json" -ExpectPass $true
  $blockRel = "SILVER_CAP50_PREFLIGHT_SELFTEST_BLOCK.txt"
  $blockFull = Join-Path $RepoRoot $blockRel
  try {
    [System.IO.File]::WriteAllText($blockFull, "block`n", $utf8)
    $resBlock = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot
    if ($resBlock.PASS_FAIL -ne "FAIL") {
      [void]$failures.Add("non_allowlist: expected FAIL")
    }
  }
  finally {
    if (Test-Path -LiteralPath $blockFull) {
      Remove-Item -LiteralPath $blockFull -Force -ErrorAction SilentlyContinue
    }
  }
  if ($failures.Count -gt 0) {
    Write-Host "SILVER_CAP50_PREFLIGHT_CLEANUP_SELFTEST=FAIL" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host $f -ForegroundColor Red }
    return $false
  }
  Write-Host "SILVER_CAP50_PREFLIGHT_CLEANUP_SELFTEST=PASS" -ForegroundColor Green
  return $true
}

function Invoke-SilverCap50TimeoutUtf8OrchestrationSelfTest {
  param([string]$RepoRoot)
  $utf8 = $script:SilverUtf8NoBom
  $failures = New-Object System.Collections.Generic.List[string]

  $tok120 = Resolve-SilverCursorCommandAutonomousTimeout -CursorCommand 'powershell -File scripts/silver-cursor-agent-adapter.ps1 -WslUbuntuAgent -TaskFile {TASK_FILE} -OutputFile {OUTPUT_FILE} -TimeoutSeconds 120' -AutonomousOrCap50 $true
  if ($tok120.EffectiveTimeoutSeconds -ne $script:SilverCap50AutonomousEffectiveTimeoutSeconds) {
    [void]$failures.Add("cursor_command_120_not_bumped_to_3400")
  }
  if ($tok120.TimeoutAdjusted -ne "YES") {
    [void]$failures.Add("cursor_command_120_timeout_adjusted_expected_YES")
  }

  $adapterPol = Resolve-SilverAutonomousAdapterTimeoutSeconds -RequestedTimeoutSeconds 120 -ProductTaskRun $true
  if ($adapterPol.EffectiveTimeoutSeconds -ne $script:SilverCap50AutonomousEffectiveTimeoutSeconds) {
    [void]$failures.Add("adapter_120_not_bumped_to_3400")
  }
  $probePol = Resolve-SilverAutonomousAdapterTimeoutSeconds -RequestedTimeoutSeconds 120 -Probe
  if ($probePol.EffectiveTimeoutSeconds -ne 120) {
    [void]$failures.Add("probe_120_should_remain_120")
  }

  $enc1252 = [System.Text.Encoding]::GetEncoding(1252)
  $good = ([string][char]0x00DA + "KOL PRO CURSOR") + " Aktu" + [char]0x00E1 + "ln" + [char]0x00ED + " pozn" + [char]0x00E1 + "mka zm" + [char]0x011B + "nil klasifik" + [char]0x00E1 + "tor p" + [char]0x0161 + "pinav" + [char]0x00E9 + "m"
  $bad = $enc1252.GetString($utf8.GetBytes($good))
  $repairedFlag = "NO"
  $fixed = Repair-SilverUtf8HandoffText -Text $bad -Repaired ([ref]$repairedFlag)
  if (-not (Test-SilverCap50Utf8ProbeStrings -Text $fixed)) {
    [void]$failures.Add("utf8_probe_strings_after_repair")
  }
  $badEmOnly = [char]0x00E2 + [char]0x20AC + [char]0x0094
  $hitEm = Test-SilverCap50Utf8HardFailAfterRepair -Text $badEmOnly -SurfaceLabel "stdout"
  if ($hitEm.detected -ne "YES") {
    [void]$failures.Add("hard_fail_em_dash_mojibake")
  }
  $hitClean = Test-SilverCap50Utf8HardFailAfterRepair -Text $fixed -SurfaceLabel "repaired"
  if ($hitClean.detected -ne "NO") {
    [void]$failures.Add("hard_fail_clean_after_repair")
  }

  $tempDir = Join-Path $env:TEMP ("silver-cap50-utf8-selftest-" + [guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  try {
    $nextPath = Join-Path $tempDir "SILVER_NEXT_ACTION.md"
    [System.IO.File]::WriteAllText($nextPath, $good + "`n", $utf8)
    $readBack = Read-TextFileUtf8Handoff -Path $nextPath
    if (-not (Test-SilverCap50Utf8ProbeStrings -Text $readBack)) {
      [void]$failures.Add("utf8_file_roundtrip_probe")
    }
  }
  finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  $assetsRel = "assets/app.js"
  $assetsFull = Join-Path $RepoRoot $assetsRel
  $assetsBackup = ""
  if (Test-Path -LiteralPath $assetsFull) {
    $assetsBackup = [System.IO.File]::ReadAllText($assetsFull, $utf8)
  }
  try {
    [System.IO.File]::WriteAllText($assetsFull, "/* cap50-selftest */`n", $utf8)
    $resAssets = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot
    if ($resAssets.PASS_FAIL -ne "FAIL") {
      [void]$failures.Add("assets_app_js_should_block_preflight")
    }
    if ([string]$resAssets.blocked_dirty_files -notmatch 'assets/app\.js') {
      [void]$failures.Add("assets_app_js_missing_from_blocked_dirty_files")
    }
  }
  finally {
    if ($assetsBackup.Length -gt 0) {
      [System.IO.File]::WriteAllText($assetsFull, $assetsBackup, $utf8)
    }
    else {
      Invoke-SilverGitRestoreWorktreePaths -RepoRoot $RepoRoot -RelPaths @($assetsRel)
    }
    $null = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot
  }

  if (-not (Test-SilverPathIsCap50RuntimeRestorable -RelPath "SILVER_CURSOR_OUTPUT.md")) {
    [void]$failures.Add("allowlist_missing_SILVER_CURSOR_OUTPUT")
  }
  if (-not (Test-SilverPathIsCap50RuntimeRestorable -RelPath "scripts/silver-rhc3-cluster-classifier-v1-report.json")) {
    [void]$failures.Add("allowlist_missing_cluster_classifier_json")
  }
  if (Test-SilverPathIsCap50RuntimeRestorable -RelPath "assets/app.js") {
    [void]$failures.Add("allowlist_must_not_include_assets_app_js")
  }

  $knownRel = "SILVER_CURSOR_OUTPUT.md"
  $knownFull = Join-Path $RepoRoot $knownRel
  $knownBackup = ""
  if (Test-Path -LiteralPath $knownFull) {
    $knownBackup = [System.IO.File]::ReadAllText($knownFull, $utf8)
  }
  try {
    $preEntries = Get-GitStatusShortDirtyEntries -Cwd $RepoRoot
    $foreignDirty = New-Object System.Collections.Generic.List[string]
    foreach ($ent in $preEntries) {
      if (-not (Test-SilverPathIsCap50RuntimeRestorable -RelPath ([string]$ent.path))) {
        [void]$foreignDirty.Add([string]$ent.path)
      }
    }
    if ($foreignDirty.Count -gt 0) {
      Write-Host ("silver-cap50-selftest: known_runtime_cleanup_skipped_foreign_dirty=" + ($foreignDirty -join ";")) -ForegroundColor DarkYellow
    }
    else {
      [System.IO.File]::WriteAllText($knownFull, "# cap50-known-runtime-selftest`n", $utf8)
      $resKnown = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot
      if ($resKnown.PASS_FAIL -ne "PASS") {
        [void]$failures.Add("known_runtime_SILVER_CURSOR_OUTPUT_not_cleaned")
      }
      $stillDirty = Get-GitStatusShortPaths -Cwd $RepoRoot
      $stillHas = $false
      foreach ($sp in $stillDirty) {
        if ([string]::Equals(($sp -replace '\\', '/'), $knownRel, [System.StringComparison]::OrdinalIgnoreCase)) {
          $stillHas = $true
        }
      }
      if ($stillHas) {
        [void]$failures.Add("known_runtime_still_dirty_after_restore")
      }
    }
  }
  finally {
    if ($knownBackup.Length -gt 0) {
      [System.IO.File]::WriteAllText($knownFull, $knownBackup, $utf8)
    }
    else {
      Invoke-SilverGitRestoreWorktreePaths -RepoRoot $RepoRoot -RelPaths @($knownRel)
    }
  }

  if (Test-SilverPathIsCap50RuntimeRestorable -RelPath "SILVER_CAP50_TIMEOUT_UTF8_SELFTEST_BLOCK.txt") {
    [void]$failures.Add("unknown_file_must_not_be_cap50_restorable")
  }
  $unknownRel = "SILVER_CAP50_TIMEOUT_UTF8_SELFTEST_BLOCK.txt"
  $unknownFull = Join-Path $RepoRoot $unknownRel
  try {
    [System.IO.File]::WriteAllText($unknownFull, "block`n", $utf8)
    $resUnknown = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot
    if ($resUnknown.PASS_FAIL -ne "FAIL") {
      [void]$failures.Add("unknown_dirty_should_fail_preflight")
    }
    if ([string]$resUnknown.blocked_dirty_files -notmatch [regex]::Escape($unknownRel)) {
      [void]$failures.Add("unknown_dirty_missing_from_blocked_dirty_files")
    }
  }
  finally {
    if (Test-Path -LiteralPath $unknownFull) {
      Remove-Item -LiteralPath $unknownFull -Force -ErrorAction SilentlyContinue
    }
  }

  if ($failures.Count -gt 0) {
    Write-Host "SILVER_CAP50_TIMEOUT_UTF8_ORCHESTRATION_SELFTEST=FAIL" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host $f -ForegroundColor Red }
    return $false
  }
  Write-Host "SILVER_CAP50_TIMEOUT_UTF8_ORCHESTRATION_SELFTEST=PASS" -ForegroundColor Green
  return $true
}

function Write-SilverCap50CyclePostconditionBlock {
  param([hashtable]$Result)
  Write-Host ""
  Write-Host "=== SILVER_CAP50_CYCLE_POSTCONDITION ===" -ForegroundColor Cyan
  Write-Host ("cycle=" + [string]$Result.cycle)
  Write-Host ("cursor_exit=" + [string]$Result.cursor_exit)
  Write-Host ("autopilot_exit=" + [string]$Result.autopilot_exit)
  Write-Host ("effective_timeout_seconds=" + [string]$Result.effective_timeout_seconds)
  Write-Host ("utf8_mojibake_detected=" + [string]$Result.utf8_mojibake_detected)
  Write-Host ("runtime_dirty_files=" + [string]$Result.runtime_dirty_files)
  Write-Host ("runtime_cleanup_done=" + [string]$Result.runtime_cleanup_done)
  Write-Host ("git_status_clean_after_cleanup=" + [string]$Result.git_status_clean_after_cleanup)
  Write-Host ("next_action_mode=" + [string]$Result.next_action_mode)
  Write-Host ("safe_to_continue=" + [string]$Result.safe_to_continue)
  $pfCol = "Red"
  if ([string]$Result.PASS_FAIL -eq "PASS") { $pfCol = "Green" }
  Write-Host ("PASS_FAIL=" + [string]$Result.PASS_FAIL) -ForegroundColor $pfCol
  if ([string]$Result.utf8_mojibake_locations) {
    Write-Host ("utf8_mojibake_locations=" + [string]$Result.utf8_mojibake_locations)
  }
  if ([string]$Result.postcondition_reason) {
    Write-Host ("postcondition_reason=" + [string]$Result.postcondition_reason)
  }
  Write-Host "=== END_SILVER_CAP50_CYCLE_POSTCONDITION ===" -ForegroundColor Cyan
  Write-Host ""
}

function Invoke-SilverCap50EvaluateCyclePostcondition {
  param(
    [string]$RepoRoot,
    [int]$Cycle,
    [string]$CursorExit,
    [string]$AutopilotExit,
    [int]$EffectiveTimeoutSeconds,
    [bool]$ControlledInfinite,
    [string]$SafetyCountersLine,
    [switch]$DryRunOnly
  )
  $nextPath = Join-Path $RepoRoot "SILVER_NEXT_ACTION.md"
  $cursorPath = Join-Path $RepoRoot "SILVER_CURSOR_OUTPUT.md"
  $runReportPath = Join-Path $RepoRoot "SILVER_RUN_REPORT.md"
  $recommended = ""
  if (Test-Path -LiteralPath $runReportPath) {
    $reportText = Read-TextFileOrEmpty -Path $runReportPath
    $recommended = Get-RunReportLineValue -ReportText $reportText -Key "recommended_next_task"
  }
  $nextAfter = Read-TextFileOrEmpty -Path $nextPath
  $utf8Gate = Invoke-SilverCap50Utf8SurfacesHardGate -RepoRoot $RepoRoot -NextActionPath $nextPath -CursorOutputPath $cursorPath
  $runtimeDirty = (Get-GitStatusShortPaths -Cwd $RepoRoot) -join ";"
  $cleanupDone = "NO"
  $gitCleanAfter = if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" }
  if (-not $DryRunOnly) {
    $cleanupRes = Invoke-SilverCap50PostCycleRuntimeCleanup -RepoRoot $RepoRoot -Cycle $Cycle -Reason "cap50_cycle_postcondition" -ExcludeRestoreRelPaths @("SILVER_NEXT_ACTION.md", "SILVER_RUN_REPORT.md")
    $cleanupDone = if ($cleanupRes.PASS_FAIL -eq "PASS") { "YES" } else { "NO" }
    $gitCleanAfter = [string]$cleanupRes.git_clean_after
    if ([string]$cleanupRes.blocked_dirty_files) {
      $runtimeDirty = [string]$cleanupRes.blocked_dirty_files
    }
  }
  $nextMode = Get-SilverCap50NextActionMode -NextActionText $nextAfter -RecommendedNextTask $recommended -ControlledInfinite $ControlledInfinite
  $safetyBlocked = Test-SafetyCountersBlocked -SafetyCountersLine $SafetyCountersLine
  $safe = "NO"
  $passFail = "FAIL"
  $reason = ""
  if ($utf8Gate.utf8_mojibake_detected -eq "YES") {
    $reason = "utf8_mojibake_detected"
  }
  elseif ($CursorExit -ne "0") {
    $reason = "cursor_exit_nonzero"
  }
  elseif ($AutopilotExit -ne "0") {
    $reason = "autopilot_exit_nonzero"
  }
  elseif ($safetyBlocked) {
    $reason = "safety_counters_nonzero"
  }
  elseif ($gitCleanAfter -ne "YES") {
    if (-not (Test-Cap50GitCleanExceptHandoffArtifacts -Cwd $RepoRoot)) {
      $reason = "git_not_clean_after_runtime_cleanup"
    }
  }
  elseif ($ControlledInfinite -and $nextMode -eq "MANUAL_REQUIRED") {
    $reason = "manual_next_action_required"
  }
  elseif ($ControlledInfinite -and $nextMode -ne "AUTONOMOUS_CONTINUE") {
    $reason = "next_action_not_autonomous"
  }
  else {
    $safe = "YES"
    $passFail = "PASS"
  }
  return @{
    cycle                           = [string]$Cycle
    cursor_exit                     = [string]$CursorExit
    autopilot_exit                  = [string]$AutopilotExit
    effective_timeout_seconds       = [string]$EffectiveTimeoutSeconds
    utf8_mojibake_detected          = [string]$utf8Gate.utf8_mojibake_detected
    utf8_mojibake_locations         = [string]$utf8Gate.utf8_mojibake_locations
    runtime_dirty_files             = $runtimeDirty
    runtime_cleanup_done            = $cleanupDone
    git_status_clean_after_cleanup  = $gitCleanAfter
    next_action_mode                = $nextMode
    safe_to_continue                = $safe
    PASS_FAIL                       = $passFail
    postcondition_reason            = $reason
    ready_for_product_cap50         = $(if ($passFail -eq "PASS") { "YES" } else { "NO" })
  }
}

function Invoke-SilverCap50ThreeCycleOrchestrationProbe {
  param([string]$RepoRoot)
  $utf8 = $script:SilverUtf8NoBom
  $failures = New-Object System.Collections.Generic.List[string]
  $goodTask = ([string][char]0x00DA + "KOL PRO CURSOR") + " cycle handoff " + [char]0x0159 + "ablona"
  for ($i = 1; $i -le 3; $i++) {
    $nextPath = Join-Path $RepoRoot "SILVER_NEXT_ACTION.md"
    $cursorPath = Join-Path $RepoRoot "SILVER_CURSOR_OUTPUT.md"
    $progressPath = Join-Path $RepoRoot "SILVER_PROGRESS_LOG.md"
    $reportPath = Join-Path $RepoRoot "SILVER_RUN_REPORT.md"
    $body = $goodTask + " cycle=" + [string]$i + "`nnode scripts/silver-rhc3-cluster-classifier-v1.cjs`n"
    [System.IO.File]::WriteAllText($nextPath, $body, $utf8)
    [System.IO.File]::WriteAllText($cursorPath, ("# silver-cursor-agent-adapter`nprompt_preview=" + $goodTask + "`n# stdout`n" + $goodTask + "`n"), $utf8)
    [System.IO.File]::WriteAllText($progressPath, ("# cycle " + [string]$i + "`n"), $utf8)
    [System.IO.File]::WriteAllText($reportPath, ("recommended_next_task=continue`ncycle=" + [string]$i + "`n"), $utf8)
    $gate = Invoke-SilverCap50Utf8SurfacesHardGate -RepoRoot $RepoRoot -NextActionPath $nextPath -CursorOutputPath $cursorPath
    if ($gate.PASS_FAIL -ne "PASS") {
      [void]$failures.Add("cycle" + [string]$i + "_utf8_gate")
    }
    $cleanup = Invoke-SilverCap50PostCycleRuntimeCleanup -RepoRoot $RepoRoot -Cycle $i -Reason "three_cycle_probe" -AllowForeignDirty
    if ($cleanup.PASS_FAIL -ne "PASS") {
      $orchOnlyBlocked = Test-SilverCap50OrchestrationScriptsOnlyBlockedDirty -BlockedDirtyFiles ([string]$cleanup.blocked_dirty_files)
      if (-not $orchOnlyBlocked) {
        [void]$failures.Add("cycle" + [string]$i + "_cleanup:" + [string]$cleanup.blocked_dirty_files)
      }
    }
    if (-not (Test-SilverCap50RuntimeEphemeralsClean -Cwd $RepoRoot)) {
      $dirtyRt = New-Object System.Collections.Generic.List[string]
      foreach ($rel in (Get-GitStatusShortPaths -Cwd $RepoRoot)) {
        $n = ($rel -replace '\\', '/')
        if (Test-SilverPathIsCap50RuntimeRestorable -RelPath $n) {
          [void]$dirtyRt.Add($n)
        }
      }
      [void]$failures.Add("cycle" + [string]$i + "_runtime_still_dirty=" + ($dirtyRt -join ","))
    }
    $mode = Get-SilverCap50NextActionMode -NextActionText $body -RecommendedNextTask "Execute steps in SILVER_NEXT_ACTION.md in Cursor." -ControlledInfinite $true
    if ($i -lt 3 -and $mode -ne "AUTONOMOUS_CONTINUE") {
      [void]$failures.Add("cycle" + [string]$i + "_next_action_not_autonomous")
    }
  }
  $tok = Resolve-SilverCursorCommandAutonomousTimeout -CursorCommand 'powershell -File scripts/silver-cursor-agent-adapter.ps1 -TimeoutSeconds 120' -AutonomousOrCap50 $true
  if ($tok.EffectiveTimeoutSeconds -ne $script:SilverCap50AutonomousEffectiveTimeoutSeconds) {
    [void]$failures.Add("effective_timeout_not_3400")
  }
  $null = Invoke-SilverCap50PostCycleRuntimeCleanup -RepoRoot $RepoRoot -Cycle 3 -Reason "three_cycle_probe_final" -AllowForeignDirty
  if ($failures.Count -gt 0) {
    Write-Host "SILVER_CAP50_THREE_CYCLE_ORCHESTRATION_PROBE=FAIL" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host $f -ForegroundColor Red }
    return $false
  }
  Write-Host "SILVER_CAP50_THREE_CYCLE_ORCHESTRATION_PROBE=PASS" -ForegroundColor Green
  return $true
}

function Invoke-SilverCap50PostconditionSelfTest {
  param([string]$RepoRoot)
  $utf8 = $script:SilverUtf8NoBom
  $failures = New-Object System.Collections.Generic.List[string]
  $enc1252 = [System.Text.Encoding]::GetEncoding(1252)
  $good = ([string][char]0x00DA + "KOL PRO CURSOR") + " Aktu" + [char]0x00E1 + "ln" + [char]0x00ED + " pozn" + [char]0x00E1 + "mka zm" + [char]0x011B + "nil klasifik" + [char]0x00E1 + "tor p" + [char]0x0161 + "pinav" + [char]0x00E9 + "m"
  $badPreviewLiteral = [string][char]0x0102 + [char]0x0161 + "KOL PRO CURSOR"
  if (-not (Test-SilverUtf8MojibakeMarkers -Text $badPreviewLiteral)) {
    [void]$failures.Add("mojibake_ukol_prompt_detect")
  }
  $realFailSample = @(
    ([string][char]0x0102 + [char]0x0161 + "KOL PRO CURSOR"),
    ("Aktu" + [char]0x0102 + [char]0x02C1 + "ln" + [char]0x0102 + [char]0x00AD),
    ("Shrnut" + [char]0x0102 + [char]0x00AD),
    ("Orchestr" + [char]0x0102 + [char]0x00A1 + "tor"),
    ("dob" + [char]0x00C4 + [char]0x203A),
    ([char]0x017D + [char]0x02C1 + "pinav"),
    ("bezpe" + [char]0x00C4 + [char]0x0165 + "nostn" + [char]0x0102 + [char]0x00AD)
  ) -join " "
  if (-not (Test-SilverUtf8MojibakeMarkers -Text $realFailSample)) {
    [void]$failures.Add("real_run_mojibake_sample_must_detect")
  }
  $realGate = Test-SilverCap50Utf8HardFailRaw -Text $realFailSample -SurfaceLabel "real_fail_regression"
  if ($realGate.detected -ne "YES") {
    [void]$failures.Add("real_run_mojibake_sample_hard_fail")
  }
  $badEmOnly = [string][char]0x00E2 + [char]0x20AC + [char]0x0094
  $hitStdout = Test-SilverCap50Utf8HardFailAfterRepair -Text $badEmOnly -SurfaceLabel "stdout"
  if ($hitStdout.detected -ne "YES") {
    [void]$failures.Add("mojibake_stdout_em_dash_must_fail")
  }
  $hitGood = Test-SilverCap50Utf8HardFailAfterRepair -Text $good -SurfaceLabel "clean"
  if ($hitGood.detected -ne "NO") {
    [void]$failures.Add("clean_utf8_must_pass")
  }
  if (-not (Test-SilverCap50Utf8ProbeStrings -Text $good)) {
    [void]$failures.Add("utf8_probe_strings_clean")
  }
  if (-not (Test-SilverCap50ManualOnlyRecommendedNextTask -Text "Execute steps in SILVER_NEXT_ACTION.md in Cursor.")) {
    [void]$failures.Add("manual_recommended_detect")
  }
  $modeCont = Get-SilverCap50NextActionMode -NextActionText ($good + "`nnode scripts/silver-rhc3-cluster-classifier-v1.cjs") -RecommendedNextTask "Execute steps in SILVER_NEXT_ACTION.md in Cursor." -ControlledInfinite $true
  if ($modeCont -ne "AUTONOMOUS_CONTINUE") {
    [void]$failures.Add("autonomous_continue_with_safe_next_action")
  }
  $modeManual = Get-SilverCap50NextActionMode -NextActionText 'STOP - needs human' -RecommendedNextTask "Execute steps in SILVER_NEXT_ACTION.md in Cursor." -ControlledInfinite $true
  if ($modeManual -ne "MANUAL_REQUIRED") {
    [void]$failures.Add("manual_required_on_stop")
  }
  $tempDir = Join-Path $env:TEMP ("silver-cap50-postcondition-selftest-" + [guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  try {
    $nextPath = Join-Path $tempDir "SILVER_NEXT_ACTION.md"
    [System.IO.File]::WriteAllText($nextPath, $good + "`n", $utf8)
    $cursorPath = Join-Path $tempDir "SILVER_CURSOR_OUTPUT.md"
    $cursorBody = "# silver-cursor-agent-adapter`nprompt_preview=" + $good + "`n# stdout`n" + $good + "`n"
    [System.IO.File]::WriteAllText($cursorPath, $cursorBody, $utf8)
    $gateOk = Invoke-SilverCap50Utf8SurfacesHardGate -RepoRoot $tempDir -NextActionPath $nextPath -CursorOutputPath $cursorPath
    if ($gateOk.PASS_FAIL -ne "PASS") {
      [void]$failures.Add("utf8_surfaces_gate_clean_path")
    }
    $cursorBad = "# silver-cursor-agent-adapter`nprompt_preview=" + $badEmOnly + "`n# stdout`nfail`n"
    [System.IO.File]::WriteAllText($cursorPath, $cursorBad, $utf8)
    $gateBad = Invoke-SilverCap50Utf8SurfacesHardGate -RepoRoot $tempDir -NextActionPath $nextPath -CursorOutputPath $cursorPath
    if ($gateBad.PASS_FAIL -ne "FAIL") {
      [void]$failures.Add("utf8_surfaces_gate_mojibake_must_fail")
    }
  }
  finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (-not (Invoke-SilverCap50PreflightCleanupSelfTest -RepoRoot $RepoRoot)) {
    [void]$failures.Add("preflight_cleanup_selftest")
  }
  if ($failures.Count -gt 0) {
    Write-Host "SILVER_CAP50_POSTCONDITION_SELFTEST=FAIL" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host $f -ForegroundColor Red }
    return $false
  }
  Write-Host "SILVER_CAP50_POSTCONDITION_SELFTEST=PASS" -ForegroundColor Green
  return $true
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
  foreach ($p in (Get-SilverTransientGeneratedAuditReportRelPaths)) {
    [void]$allowed.Add($p)
  }
  $paths = Get-GitStatusShortPaths -Cwd $Cwd
  foreach ($rel in $paths) {
    $n = ($rel -replace "\\", "/").Trim()
    if (-not $n) { continue }
    if ($allowed.Contains($n)) { continue }
    if (Test-SilverPathIsCap50RuntimeRestorable -RelPath $n) { continue }
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

function Write-SilverAutonomousRunSummary {
  param(
    [string]$RepoRoot,
    [int]$CyclesCompleted,
    [int]$CyclesPass,
    [string]$StopReason,
    [string]$DryRunText
  )
  $reportText = Read-TextFileOrEmpty -Path (Join-Path $RepoRoot "SILVER_RUN_REPORT.md")
  $safetyLine = Get-RunReportLineValue -ReportText $reportText -Key "safety_counters"
  $engineCh = Get-RunReportLineValue -ReportText $reportText -Key "engine_changed"
  $assetsCh = Get-RunReportLineValue -ReportText $reportText -Key "assets_app_changed"
  if (-not $engineCh) { $engineCh = "NO" }
  if (-not $assetsCh) { $assetsCh = "NO" }
  $allPass = "NO"
  if ($CyclesCompleted -gt 0 -and $CyclesPass -eq $CyclesCompleted) { $allPass = "YES" }
  $realStale = "NO"
  if ($script:AutonomousRealStaleMetaIssueSeen -eq "YES") { $realStale = "YES" }
  $embSeen = "NO"
  if ($script:AutonomousStaleEmbeddedHintSeen -eq "YES") { $embSeen = "YES" }
  $embNonAuth = "NO"
  if ($script:AutonomousStaleEmbeddedNonAuth -eq "YES") { $embNonAuth = "YES" }
  $authRuntime = "NO"
  if ($script:AutonomousAuthoritativeRuntimePass -eq "YES") { $authRuntime = "YES" }
  $safeStop = "NO"
  if ($StopReason -match "hard_cycle_budget_exhausted|total_wall_seconds_exhausted|emergency_stop") {
    $safeStop = "YES"
  }
  Write-Host ""
  Write-Host "=== SILVER_AUTONOMOUS_RUN_SUMMARY ===" -ForegroundColor Cyan
  Write-Host ("cycles_completed=" + [string]$CyclesCompleted)
  Write-Host ("cycles_pass=" + [string]$CyclesPass)
  Write-Host ("all_cycles_pass=" + $allPass)
  Write-Host ("stop_reason=" + $StopReason)
  Write-Host ("SAFE_STOP=" + $safeStop)
  Write-Host ("dry_run=" + $DryRunText)
  Write-Host ("real_stale_meta_issue_seen=" + $realStale)
  Write-Host ("stale_embedded_hint_seen=" + $embSeen)
  Write-Host ("stale_embedded_hint_non_authoritative=" + $embNonAuth)
  Write-Host ("authoritative_runtime_pass=" + $authRuntime)
  Write-Host ("engine_changed=" + $engineCh)
  Write-Host ("assets_app_changed=" + $assetsCh)
  Write-Host ("safety_counters=" + $safetyLine)
  Write-Host "=== END_SILVER_AUTONOMOUS_RUN_SUMMARY ===" -ForegroundColor Cyan
  Write-Host ""
}

function Write-SilverAutonomousBudgetExit {
  param(
    [string]$ProgressLogPath,
    [string]$RepoRoot,
    [int]$Cycle,
    [string]$MainCommit,
    [string]$Reason,
    [string]$DryRunText,
    [int]$HardCap = 0,
    [switch]$NoBeep
  )
  $cyclesDone = 0
  if ($HardCap -gt 0 -and $Reason -eq "hard_cycle_budget_exhausted") {
    $cyclesDone = $HardCap
  }
  elseif ($script:AutonomousCyclesCompleted -gt 0) {
    $cyclesDone = $script:AutonomousCyclesCompleted
  }
  elseif ($Cycle -gt 0) {
    $cyclesDone = $Cycle - 1
  }
  $cyclesPass = $script:AutonomousCyclesPass
  if ($cyclesPass -lt 0) { $cyclesPass = 0 }
  Write-SilverAutonomousRunSummary -RepoRoot $RepoRoot -CyclesCompleted $cyclesDone -CyclesPass $cyclesPass -StopReason $Reason -DryRunText $DryRunText
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
$script:SilverAutonomousRunId = ""
$script:SilverAutonomousRunStartUtc = [datetime]::MinValue
$script:AutonomousCyclesCompleted = 0
$script:AutonomousCyclesPass = 0
$script:AutonomousRealStaleMetaIssueSeen = "NO"
$script:AutonomousStaleEmbeddedHintSeen = "NO"
$script:AutonomousStaleEmbeddedNonAuth = "NO"
$script:AutonomousAuthoritativeRuntimePass = "NO"

if ($controlledInfinite) {
  $newRunId = ([guid]::NewGuid().ToString("N"))
  Initialize-SilverAutonomousRunLifecycle -RunId $newRunId -RunStartUtc ((Get-Date).ToUniversalTime()) -CursorOutputPath $CursorOutputPath
  Write-Host ("silver-autopilot-loop: autonomous_run_id=" + $script:SilverAutonomousRunId + " runtime_cursor_output_invalidated=YES") -ForegroundColor DarkCyan
}

if ($PreflightCleanupSelfTest) {
  $stOk = Invoke-SilverCap50PreflightCleanupSelfTest -RepoRoot $RepoRoot
  if (-not $stOk) { exit 1 }
  exit 0
}

if ($Cap50TimeoutUtf8SelfTest) {
  $stCap = Invoke-SilverCap50TimeoutUtf8OrchestrationSelfTest -RepoRoot $RepoRoot
  if (-not $stCap) { exit 1 }
  exit 0
}

if ($Cap50PostconditionSelfTest) {
  $stPost = Invoke-SilverCap50PostconditionSelfTest -RepoRoot $RepoRoot
  if (-not $stPost) { exit 1 }
  exit 0
}

if ($Cap50MojibakeRegressionSelfTest) {
  $regScript = Join-Path $RepoRoot "scripts\silver-cap50-mojibake-regression-selftest.ps1"
  if (-not (Test-Path -LiteralPath $regScript)) {
    Write-Host "SILVER_CAP50_MOJIBAKE_REGRESSION_SELFTEST=FAIL missing_script" -ForegroundColor Red
    exit 1
  }
  & powershell -NoProfile -ExecutionPolicy Bypass -File $regScript
  exit $LASTEXITCODE
}

if ($Cap50RealUtf8CaptureProbe) {
  $capScript = Join-Path $RepoRoot "scripts\silver-real-stdout-utf8-capture-probe.ps1"
  if (-not (Test-Path -LiteralPath $capScript)) {
    Write-Host "SILVER_REAL_STDOUT_UTF8_CAPTURE_PROBE=FAIL missing_script" -ForegroundColor Red
    exit 1
  }
  & powershell -NoProfile -ExecutionPolicy Bypass -File $capScript
  exit $LASTEXITCODE
}

if ($Cap50ThreeCycleProbe -or $Cap50ThreeCycleOrchestrationProbe) {
  $st3 = Invoke-SilverCap50ThreeCycleOrchestrationProbe -RepoRoot $RepoRoot
  if (-not $st3) { exit 1 }
  exit 0
}

if ($Cap50HardPreflight) {
  $hp = Invoke-SilverCap50HardPreflight -RepoRoot $RepoRoot -CursorCommand $CursorCommand
  Write-SilverCap50HardPreflightBlock -Result $hp
  if ($hp.PASS_FAIL -ne "PASS") { exit 1 }
  exit 0
}

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

if ($controlledInfinite -and (-not $DryRun) -and (-not [string]::IsNullOrWhiteSpace($CursorCommand))) {
  $hardPf = Invoke-SilverCap50HardPreflight -RepoRoot $RepoRoot -CursorCommand $CursorCommand
  Write-SilverCap50HardPreflightBlock -Result $hardPf
  if ($hardPf.PASS_FAIL -ne "PASS") {
    Write-SilverSafetyConsoleStop -Reason "cap50_hard_preflight_fail"
    exit 1
  }
}

$cycle = 0
while ($true) {
  $cycle++
  $script:CycleIndex = $cycle
  $script:LastCursorExit = "N/A"
  $script:LastAutopilotExit = "N/A"
  $script:LastStatusExit = "N/A"
  $script:LastTaskExit = 0
  $script:SilverCycleCursorProcessStartUtc = [datetime]::MinValue
  $script:SilverCycleExpectedTaskDigest = ""
  $script:SilverCycleExpectedTaskFile = ""
  Remove-Item Env:\SILVER_TIMEOUT_ARCHIVE_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:\SILVER_TIMEOUT_ARTIFACTS_ARCHIVED -ErrorAction SilentlyContinue
  if ($script:SilverAutonomousRunId) {
    $env:SILVER_AUTONOMOUS_CYCLE = [string]$cycle
  }

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
      -Reason "hard_cycle_budget_exhausted" -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -HardCap $hardCap -NoBeep:$NoBeep
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

  $preflightCap50 = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot -DryRunOnly:$DryRun
  Write-SilverCap50PreflightCleanupResultBlock -Result $preflightCap50
  if ($preflightCap50.safe_to_start_cycle -ne "YES") {
    $mcPf = ""
    try {
      $prevEaPf = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      $mcPf = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
      $ErrorActionPreference = $prevEaPf
    } catch {
      $mcPf = ""
    }
    $nextPeekPf = Read-TextFileOrEmpty -Path $NextActionPath
    $pfStop = "blocked=" + [string]$preflightCap50.blocked_dirty_files
    if (-not $preflightCap50.blocked_dirty_files) {
      $pfStop = "git_not_clean_after_restore"
    }
    Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mcPf `
      -CursorExit "N/A" -AutopilotExit "N/A" -StatusExit "N/A" `
      -GitClean ([string]$preflightCap50.git_clean_after) -SafetyLine "" -CalW "" -CalQ "" `
      -Headline (Get-NextActionHeadline -Text $nextPeekPf) -Focus "cap50_preflight_cleanup_blocked" `
      -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1 `
      -StopReason $pfStop
  }

  if ($controlledInfinite) {
    Restore-SilverTransientGeneratedAuditReports -RepoRoot $RepoRoot
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
  $cursorCommandEffective = $CursorCommand
  $effectiveCap50TimeoutSeconds = 0
  if (-not [string]::IsNullOrWhiteSpace($CursorCommand)) {
    $tokCmd = Resolve-SilverCursorCommandAutonomousTimeout -CursorCommand $CursorCommand -AutonomousOrCap50 ($controlledInfinite -or ($MaxCycles -ge 1))
    $cursorCommandEffective = [string]$tokCmd.Command
    $effectiveCap50TimeoutSeconds = [int]$tokCmd.EffectiveTimeoutSeconds
    if ([string]$tokCmd.TimeoutAdjusted -eq "YES") {
      Write-Host ("silver-autopilot-loop: effective_timeout_seconds=" + [string]$effectiveCap50TimeoutSeconds + " cursor_command_timeout_adjusted=YES reason=" + [string]$tokCmd.TimeoutAdjustReason) -ForegroundColor DarkYellow
    }
    elseif ($effectiveCap50TimeoutSeconds -gt 0) {
      Write-Host ("silver-autopilot-loop: effective_timeout_seconds=" + [string]$effectiveCap50TimeoutSeconds) -ForegroundColor DarkCyan
    }
  }
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
      $resolvedCmd = $cursorCommandEffective.Replace("{TASK_FILE}", $quotedTask).Replace("{OUTPUT_FILE}", $quotedOut)

      $outerCaptureToken = [guid]::NewGuid().ToString("N")
      if ($script:SilverAutonomousRunId) {
        $runTok = ([string]$script:SilverAutonomousRunId).Trim()
        if ($runTok.Length -gt 8) { $runTok = $runTok.Substring(0, 8) }
        $outerCaptureToken = $runTok + "-c" + [string]$cycle + "-" + $outerCaptureToken.Substring(0, 8)
      }
      $stdoutTmp = Join-Path $env:TEMP ("silver-loop-cursor-out-" + $outerCaptureToken + ".txt")
      $stderrTmp = Join-Path $env:TEMP ("silver-loop-cursor-err-" + $outerCaptureToken + ".txt")
      foreach ($staleCap in @($stdoutTmp, $stderrTmp)) {
        if (Test-Path -LiteralPath $staleCap) {
          Remove-Item -LiteralPath $staleCap -Force -ErrorAction SilentlyContinue
        }
      }

      $utf8Log = [System.Text.UTF8Encoding]::new($false)
      $expectedTaskDigest = ""
      $expectedTaskFile = ""
      if (Test-Path -LiteralPath $NextActionPath) {
        $expectedTaskFile = (Resolve-Path -LiteralPath $NextActionPath).Path
        $taskTextForDigest = [System.IO.File]::ReadAllText($expectedTaskFile, $utf8Log)
        $expectedTaskDigest = Get-SilverTaskUtf8Sha256HexPrefix -Text $taskTextForDigest
      }
      $script:SilverCycleCursorProcessStartUtc = [datetime]::MinValue
      $script:SilverCycleExpectedTaskDigest = $expectedTaskDigest
      $script:SilverCycleExpectedTaskFile = $expectedTaskFile
      if ($script:SilverAutonomousRunId) {
        $runStartIsoInv = [string]$env:SILVER_AUTONOMOUS_RUN_START_UTC
        Write-SilverCursorOutputInvalidatedStub -Path $CursorOutputPath -RunId $script:SilverAutonomousRunId -RunStartUtcIso $runStartIsoInv -CycleState ([string]$cycle)
      }

      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = "cmd.exe"
      $psi.Arguments = "/c " + $resolvedCmd + " 1> """ + $stdoutTmp + """ 2> """ + $stderrTmp + """"
      $psi.WorkingDirectory = $RepoRoot
      $psi.UseShellExecute = $false
      $psi.CreateNoWindow = $true
      try {
        $cursorProcStartUtc = (Get-Date).ToUniversalTime()
        $script:SilverCycleCursorProcessStartUtc = $cursorProcStartUtc
        $p = [System.Diagnostics.Process]::Start($psi)
        $p.WaitForExit()
        $ce = $p.ExitCode
        $runCtxReconcile = Get-SilverAutonomousRunContext
        $reconcile = Resolve-SilverCursorOuterExitFromAdapterMeta -OuterExit $ce -AdapterOutputPath $CursorOutputPath -ProcessStartUtc $cursorProcStartUtc -ExpectedTaskDigest $expectedTaskDigest -ExpectedTaskFile $expectedTaskFile -ExpectedRunId $runCtxReconcile.RunId -ExpectedCycle $runCtxReconcile.Cycle -ExpectedRunStartUtc $runCtxReconcile.RunStartUtc
        if ($reconcile.Reconciled) {
          Write-Host ("silver-autopilot-loop: outer_cmd_exit=" + [string]$ce + " reconciled_to_adapter_exit_code=0 (fresh_meta=YES)") -ForegroundColor DarkYellow
          $ce = [int]$reconcile.EffectiveExit
        }
        elseif (($ce -ne 0) -and (-not $reconcile.FreshMeta)) {
          Write-Host ("silver-autopilot-loop: outer_cmd_exit=" + [string]$ce + " not_reconciled (adapter_meta_stale_or_mismatch)") -ForegroundColor DarkYellow
        }
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
        $handoffUtf8 = Join-Path $PSScriptRoot "silver-utf8-handoff.ps1"
        if (Test-Path -LiteralPath $handoffUtf8) {
          . $handoffUtf8
          $soRep = "NO"
          $seRep = "NO"
          $so = Repair-SilverUtf8HandoffText -Text $so -Repaired ([ref]$soRep)
          $se = Repair-SilverUtf8HandoffText -Text $se -Repaired ([ref]$seRep)
        }
        $soTrim = $so.Trim()
        $seTrim = $se.Trim()
        $postCursorBody = ""
        if (Test-Path -LiteralPath $CursorOutputPath) {
          $postCursorBody = [System.IO.File]::ReadAllText($CursorOutputPath, $utf8Log)
        }
        $adapterBodyWritten = ($postCursorBody.IndexOf("# silver-cursor-agent-adapter", [System.StringComparison]::Ordinal) -ge 0)
        if (($soTrim.Length -gt 0) -or ($seTrim.Length -gt 0)) {
          if ($adapterBodyWritten) {
            $wrapNote = "outer cmd.exe wrapper (exit " + [string]$ce + "; adapter body preserved above)"
            $merged = $postCursorBody.TrimEnd() + "`n`n# silver-autopilot-loop: " + $wrapNote + "`n# stdout`n" + $so + "`n# stderr`n" + $se + "`n"
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
        $cursorStopReason = ""
        if ($ce -eq 124) { $cursorStopReason = "cursor_outer_or_adapter_timeout_exit_124" }
        elseif ($ce -eq 12) { $cursorStopReason = "utf8_mojibake_detected" }
        Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
          -CursorExit $cursorExitStr -AutopilotExit "N/A" -StatusExit "N/A" `
          -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
          -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
          -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
          -Headline (Get-NextActionHeadline -Text $nextText) -Focus $(if ($ce -eq 12) { "utf8_mojibake_hard_fail" } else { "cursor_exit_nonzero" }) `
          -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1 `
          -StopReason $cursorStopReason
      }
      $utf8AfterCursor = Invoke-SilverCap50Utf8SurfacesHardGate -RepoRoot $RepoRoot -NextActionPath $NextActionPath -CursorOutputPath $CursorOutputPath
      if ($utf8AfterCursor.PASS_FAIL -ne "PASS") {
        Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
          -CursorExit $cursorExitStr -AutopilotExit "N/A" -StatusExit "N/A" `
          -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
          -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
          -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
          -Headline (Get-NextActionHeadline -Text $nextText) -Focus "utf8_mojibake_post_cursor" `
          -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1 `
          -StopReason ([string]$utf8AfterCursor.reason)
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
    $autopilotHandoffPreserve = @("SILVER_NEXT_ACTION.md", "SILVER_RUN_REPORT.md")
    $nextAfterAuto = Read-TextFileOrEmpty -Path $NextActionPath
    if (-not (Test-SilverNextActionOutputQuality -Text $nextAfterAuto)) {
      try {
        $sanitizePreCleanup = Invoke-NodeScript -WorkingDirectory $RepoRoot -Arguments @($AutopilotScript, "--sanitize-next-action-md") -PassThruExit $true
        if (($null -ne $sanitizePreCleanup) -and ($sanitizePreCleanup.ExitCode -eq 0)) {
          $nextAfterAuto = Read-TextFileOrEmpty -Path $NextActionPath
        }
      }
      catch {
        Write-Host "silver-autopilot-loop: pre_cleanup_sanitize_invoke_failed continuing=STOP" -ForegroundColor DarkYellow
      }
    }
    if (-not (Test-SilverNextActionOutputQuality -Text $nextAfterAuto)) {
      Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
        -CursorExit $cursorExitStr -AutopilotExit $autoExitStr -StatusExit "N/A" `
        -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
        -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
        -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
        -Headline (Get-NextActionHeadline -Text $nextAfterAuto) -Focus "next_action_quality_post_guard" `
        -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1
    }
    $postAutoCleanup = Invoke-SilverCap50PostCycleRuntimeCleanup -RepoRoot $RepoRoot -Cycle $cycle -Reason "after_autopilot_full_auto_loop" -ExcludeRestoreRelPaths $autopilotHandoffPreserve -AllowHandoffDirty
    Write-Host ("silver-autopilot-loop: post_autopilot_cleanup_PASS_FAIL=" + [string]$postAutoCleanup.PASS_FAIL) -ForegroundColor DarkCyan
    if ($postAutoCleanup.PASS_FAIL -ne "PASS") {
      Write-Host ("silver-autopilot-loop: post_autopilot_blocked_dirty_files=" + [string]$postAutoCleanup.blocked_dirty_files) -ForegroundColor Red
    }
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
    Restore-SilverTransientGeneratedAuditReports -RepoRoot $RepoRoot
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
  $passProcStart = [datetime]::MinValue
  $passDigest = ""
  $passTaskFile = ""
  if ($script:SilverCycleCursorProcessStartUtc -and ($script:SilverCycleCursorProcessStartUtc -ne [datetime]::MinValue)) {
    $passProcStart = $script:SilverCycleCursorProcessStartUtc
    $passDigest = [string]$script:SilverCycleExpectedTaskDigest
    $passTaskFile = [string]$script:SilverCycleExpectedTaskFile
  }
  $passRunCtx = Get-SilverAutonomousRunContext
  $passCursorInvoked = ($passProcStart -ne [datetime]::MinValue)
  Add-SilverCycleFieldsFromAdapterOutput -Fields $fieldsPass -AdapterOutputPath $CursorOutputPath -ProcessStartUtc $passProcStart -ExpectedTaskDigest $passDigest -ExpectedTaskFile $passTaskFile -ExpectedRunId $passRunCtx.RunId -ExpectedCycle $passRunCtx.Cycle -ExpectedRunStartUtc $passRunCtx.RunStartUtc -CursorInvoked $passCursorInvoked
  if ($controlledInfinite) {
    $script:AutonomousCyclesCompleted++
    if ($se -eq 0) {
      $script:AutonomousCyclesPass++
    }
    Update-SilverAutonomousReportingHygieneAccumulator -ReportText $reportPost -CycleFields $fieldsPass
  }
  $postCond = Invoke-SilverCap50EvaluateCyclePostcondition `
    -RepoRoot $RepoRoot -Cycle $cycle -CursorExit $cursorExitStr -AutopilotExit $autoExitStr `
    -EffectiveTimeoutSeconds $effectiveCap50TimeoutSeconds -ControlledInfinite $controlledInfinite `
    -SafetyCountersLine $safetyPost -DryRunOnly:$DryRun
  Write-SilverCap50CyclePostconditionBlock -Result $postCond
  if ($postCond.PASS_FAIL -ne "PASS") {
    $pcReason = [string]$postCond.postcondition_reason
    if (-not $pcReason) { $pcReason = "cap50_postcondition_fail" }
    Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
      -CursorExit $cursorExitStr -AutopilotExit $autoExitStr -StatusExit ([string]$se) `
      -GitClean ([string]$postCond.git_status_clean_after_cleanup) -SafetyLine $safetyPost `
      -CalW (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_write_20k") `
      -CalQ (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_query_20k") `
      -Headline (Get-NextActionHeadline -Text $nextAfter) -Focus "cap50_postcondition_fail" `
      -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1 `
      -StopReason $pcReason
  }
  $fieldsPass["cap50_postcondition"] = "PASS"
  $fieldsPass["utf8_mojibake_detected"] = [string]$postCond.utf8_mojibake_detected
  $fieldsPass["next_action_mode"] = [string]$postCond.next_action_mode
  $fieldsPass["git_status_clean_after_cleanup"] = [string]$postCond.git_status_clean_after_cleanup
  Write-SilverProgressLogBlock -ProgressLogPath $ProgressLogPath -Outcome "PASS" -Fields $fieldsPass
  Write-SilverColoredCycleSummary -Outcome "PASS" -Fields $fieldsPass
  Invoke-SilverBeepPass -NoBeep:$NoBeep

  if (-not $infinite -and $cycle -ge $MaxCycles) { break }
  if ($infinite -or $cycle -lt $MaxCycles) {
    Start-Sleep -Seconds $SleepSeconds
  }
}

if (-not $DryRun) {
  $finalCycle = $cycle
  if ($finalCycle -lt 1) { $finalCycle = 1 }
  $null = Stop-LoopOnHandoffPersistenceGuard -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $finalCycle -MainCommit $mainCommit -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep
  if ($controlledInfinite) {
    $reportEnd = Read-TextFileOrEmpty -Path $RunReportPath
    $safetyEnd = Get-RunReportLineValue -ReportText $reportEnd -Key "safety_counters"
    $finalOk = Invoke-SilverCap50FinalPostcondition -RepoRoot $RepoRoot -CyclesCompleted $script:AutonomousCyclesCompleted -StopReason "loop_exit" -NextActionPath $NextActionPath -CursorOutputPath $CursorOutputPath -SafetyCountersLine $safetyEnd
    Write-SilverCap50FinalPostconditionBlock -Result $finalOk
    if ($finalOk.PASS_FAIL -eq "PASS") {
      Invoke-SilverBeepPass -NoBeep:$NoBeep
    }
  }
}

exit 0
