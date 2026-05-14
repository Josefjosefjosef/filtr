#requires -Version 5.1
<#
.SYNOPSIS
  Silver FULL AUTO LOOP TRIGGER V1 — orchestrates SILVER_NEXT_ACTION.md → Cursor CLI → Autopilot → reports.

.PARAMETER DryRun
  Skips Cursor and node --full-auto-loop; still runs guards, --status, progress log, colored summary (exit 0 if guards pass).

.PARAMETER MaxCycles
  Default 1. Use 0 for infinite loop (explicit only).

.PARAMETER SleepSeconds
  Pause between cycles (default 5).

.PARAMETER CursorCommand
  Template with {TASK_FILE} and {OUTPUT_FILE} tokens. If empty: DryRun PASS; non-DryRun STOP.

.PARAMETER NoBeep
  Disable console beeps.
#>
param(
  [switch]$DryRun,
  [int]$MaxCycles = 1,
  [int]$SleepSeconds = 5,
  [string]$CursorCommand = "",
  [switch]$NoBeep
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

function Get-GitStatusShortText {
  param([string]$Cwd)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "git"
    $psi.Arguments = "status --short"
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

function Test-GitStatusClean {
  param([string]$Cwd)
  $t = (Get-GitStatusShortText -Cwd $Cwd).Trim()
  return ($t -eq "")
}

function Test-AssetsAppJsInStatus {
  param([string]$GitShort)
  if (-not $GitShort) { return $false }
  $lines = $GitShort -split "`r?`n"
  foreach ($line in $lines) {
    $trim = $line.Trim()
    if ($trim -match "assets/app\.js") { return $true }
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
  [void]$sb.AppendLine(("main_commit=" + $Fields["main_commit"]))
  [void]$sb.AppendLine(("last_task_exit=" + $Fields["last_task_exit"]))
  [void]$sb.AppendLine(("cursor_exit=" + $Fields["cursor_exit"]))
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
    [int]$LastTaskExitCode
  )
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
  }
  Write-SilverProgressLogBlock -ProgressLogPath $ProgressLogPath -Outcome "FAIL" -Fields $fields
  Write-SilverColoredCycleSummary -Outcome "FAIL" -Fields $fields
  Invoke-SilverBeepFail -NoBeep:$NoBeep
  exit 1
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

$infinite = ($MaxCycles -eq 0)
if ($MaxCycles -lt 0) {
  Write-Host "STOP: MaxCycles must be >= 0 (0 = infinite)." -ForegroundColor Red
  exit 1
}

$cycle = 0
while ($true) {
  $cycle++
  $script:CycleIndex = $cycle
  $script:LastCursorExit = "N/A"
  $script:LastAutopilotExit = "N/A"
  $script:LastStatusExit = "N/A"
  $script:LastTaskExit = 0

  if (-not $infinite -and $cycle -gt $MaxCycles) { break }

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
        $so = ""
        $se = ""
        if (Test-Path -LiteralPath $stdoutTmp) { $so = [System.IO.File]::ReadAllText($stdoutTmp) }
        if (Test-Path -LiteralPath $stderrTmp) { $se = [System.IO.File]::ReadAllText($stderrTmp) }
        $soTrim = $so.Trim()
        $seTrim = $se.Trim()
        if (($soTrim.Length -gt 0) -or ($seTrim.Length -gt 0)) {
          $merged = "# silver-autopilot-loop: captured Cursor CLI output`n# stdout`n" + $so + "`n# stderr`n" + $se + "`n"
          [System.IO.File]::WriteAllText($CursorOutputPath, $merged, [System.Text.UTF8Encoding]::new($false))
        }
        else {
          if (-not (Test-Path -LiteralPath $CursorOutputPath)) {
            $stub = "# silver-autopilot-loop: no outer stdout/stderr; child wrote only to OutputFile or produced no file.`n"
            [System.IO.File]::WriteAllText($CursorOutputPath, $stub, [System.Text.UTF8Encoding]::new($false))
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
          -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1
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
  }
  Write-SilverProgressLogBlock -ProgressLogPath $ProgressLogPath -Outcome "PASS" -Fields $fieldsPass
  Write-SilverColoredCycleSummary -Outcome "PASS" -Fields $fieldsPass
  Invoke-SilverBeepPass -NoBeep:$NoBeep

  if (-not $infinite -and $cycle -ge $MaxCycles) { break }
  if ($infinite -or $cycle -lt $MaxCycles) {
    Start-Sleep -Seconds $SleepSeconds
  }
}

exit 0
