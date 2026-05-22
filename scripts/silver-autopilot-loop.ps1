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
  Enables controlled autonomous mode; coerces -MaxCycles to 0 (same safety stack as -AllowInfinite with -MaxCycles 0).

.PARAMETER MaxAutonomousHardCycles
  Hard ceiling for autonomous iterations when -MaxCycles 0 (0 = use env SILVER_AUTONOMOUS_HARD_MAX_CYCLES or default 512).

.PARAMETER ControlledCapProfile
  Budget guard profile id (CAP10_SAFE default lane). CAP10_SAFE coerces controlled autonomous mode when used with -MaxAutonomousHardCycles.

.PARAMETER Cap10Safe
  Legacy alias guard only. Does NOT run CAP10_SAFE runtime. Use -ControlledCapProfile CAP10_SAFE with -MaxAutonomousHardCycles and -TotalWallSeconds for a real run.

.PARAMETER Cap10SafeEntrypointSelfTest
  Orchestration-only selftest: CursorCommand builder, token validation, and missing-command resolution (no agent invoke). Must be spelled in full (do not use -Cap10Safe alone).

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
  [string]$ControlledCapProfile = "",
  [switch]$Cap10Safe,
  [switch]$Cap10SafeEntrypointSelfTest,
  [int]$SameNextActionStopAfter = 5,
  [int]$NoProgressStopAfter = 8,
  [int]$RepeatedFailureStopAfter = 3,
  [int]$PrLoopStopAfter = 4,
  [int]$MaxCycleWallSeconds = 0,
  [int]$TotalWallSeconds = 0,
  [switch]$TimeoutArchiveSelfTest,
  [switch]$Cap50TimeoutCloseoutSelfTest,
  [switch]$Cap50Timeout124FinalPostconditionSelfTest,
  [switch]$PreflightCleanupSelfTest,
  [switch]$Cap50TimeoutUtf8SelfTest,
  [switch]$Cap50PostconditionSelfTest,
  [switch]$Cap50HardPreflight,
  [switch]$Cap50ThreeCycleProbe,
  [switch]$Cap50ThreeCycleOrchestrationProbe,
  [switch]$Cap50MojibakeRegressionSelfTest,
  [switch]$Cap50RealUtf8CaptureProbe,
  [switch]$Cap50GitNotCleanAfterRestoreSelfTest,
  [switch]$CapProductScorecardSelfTest,
  [switch]$AuditRegistrySelfTest,
  [switch]$NextActionQualityGateRegressionSelfTest,
  [switch]$AdapterMetaFreshnessSelfTest,
  [switch]$Cap50RealAutonomousLifecycleOrderingSelfTest,
  [switch]$AutonomousRearmSelfTest,
  [switch]$WslAgentModelAutoHandoffSelfTest,
  [switch]$RearmInvokeEdgeCaseSelfTest,
  [switch]$StaleInvokeWatchdogSelfTest,
  [switch]$StaleCursorInvokeHardeningSelfTest,
  [switch]$Cursor3ExecutionBridgeSelfTest,
  [switch]$ControlledBudgetGuardSelfTest
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
$SilverCapScorecardPath = Join-Path $PSScriptRoot "silver-cap-product-scorecard.ps1"
$SilverAuditRegistryPath = Join-Path $PSScriptRoot "silver-audit-registry.ps1"
$SilverControlledBudgetGuardScript = Join-Path $RepoRoot "scripts\silver-controlled-budget-guard.cjs"
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
if (Test-Path -LiteralPath $SilverCapScorecardPath) {
  . $SilverCapScorecardPath
}
if (Test-Path -LiteralPath $SilverAuditRegistryPath) {
  . $SilverAuditRegistryPath
}
$script:SilverLastScorecardOrchestrationOnly = "NO"
$script:SilverLastScorecardVerifiedProductShift = "NO"
$script:SilverScorecardRuntimeError = "NO"
$script:SilverScorecardExactError = ""
Initialize-SilverConsoleUtf8

$script:SilverCapScorecardDir = ""
$script:SilverCapScorecardBeforePath = ""
$script:SilverCapScorecardCapLabel = ""

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
    $psi.Arguments = "restore --source=HEAD --staged --worktree -- " + $ProgressRel
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

function Update-SilverTimeoutArchiveManifestCloseout {
  param(
    [string]$ArchiveDir,
    [hashtable]$ExtraFields = @{}
  )
  if (-not $ArchiveDir -or -not (Test-Path -LiteralPath $ArchiveDir)) { return }
  $manifestPath = Join-Path $ArchiveDir "manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath)) { return }
  try {
    $raw = [System.IO.File]::ReadAllText($manifestPath, [System.Text.UTF8Encoding]::new($false))
    $obj = $raw | ConvertFrom-Json
    $ht = @{}
    $obj.PSObject.Properties | ForEach-Object { $ht[$_.Name] = $_.Value }
    foreach ($k in $ExtraFields.Keys) {
      $ht[$k] = $ExtraFields[$k]
    }
    $json = $ht | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText($manifestPath, $json, [System.Text.UTF8Encoding]::new($false))
  }
  catch {
  }
}

function Invoke-SilverCap50AdapterTimeoutCloseout {
  param(
    [string]$RepoRoot,
    [string]$Reason,
    [string]$CursorExit,
    [string]$TimedOut,
    [hashtable]$ProgressLogFields,
    [string]$ProgressOutcome = "FAIL"
  )
  $archOut = Archive-SilverTimeoutRuntimeArtifacts -RepoRoot $RepoRoot -Reason $Reason -CursorExit $CursorExit -TimedOut $TimedOut
  $timeoutArchiveRel = [string]$archOut.RelativePath
  $timeoutArchivedFlag = [string]$archOut.Archived
  if ($timeoutArchiveRel -and $timeoutArchiveRel.Trim().Length -gt 0) {
    $env:SILVER_TIMEOUT_ARCHIVE_PATH = ($timeoutArchiveRel -replace "\\", "/")
    $env:SILVER_TIMEOUT_ARTIFACTS_ARCHIVED = $timeoutArchivedFlag
  }
  $archProgressPath = ""
  if ($archOut.FullPath -and (Test-Path -LiteralPath $archOut.FullPath)) {
    $archProgressPath = Join-Path $archOut.FullPath "SILVER_PROGRESS_LOG.md"
    if (-not (Test-Path -LiteralPath $archProgressPath)) {
      $repoProgress = Join-Path $RepoRoot "SILVER_PROGRESS_LOG.md"
      if (Test-Path -LiteralPath $repoProgress) {
        Copy-Item -LiteralPath $repoProgress -Destination $archProgressPath -Force
      }
    }
    Write-SilverProgressLogBlock -ProgressLogPath $archProgressPath -Outcome $ProgressOutcome -Fields $ProgressLogFields
    Update-SilverTimeoutArchiveManifestCloseout -ArchiveDir $archOut.FullPath -ExtraFields @{
      progress_log_fail_appended_to_archive = "YES"
      closeout_kind                         = "adapter_timeout"
    }
  }
  $closeoutCleanup = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot
  Write-Host ("silver-autopilot-loop: timeout_closeout_preflight_PASS_FAIL=" + [string]$closeoutCleanup.PASS_FAIL) -ForegroundColor DarkYellow
  if ([string]$closeoutCleanup.blocked_dirty_files) {
    Write-Host ("silver-autopilot-loop: timeout_closeout_blocked_dirty_files=" + [string]$closeoutCleanup.blocked_dirty_files) -ForegroundColor Red
  }
  $gitCleanAfter = [string]$closeoutCleanup.git_clean_after
  return @{
    timeout_archive_path              = $timeoutArchiveRel
    timeout_artifacts_archived        = $timeoutArchivedFlag
    PASS_FAIL                         = [string]$closeoutCleanup.PASS_FAIL
    safe_to_start_cycle               = [string]$closeoutCleanup.safe_to_start_cycle
    blocked_dirty_files               = [string]$closeoutCleanup.blocked_dirty_files
    git_status_clean_after_closeout   = $gitCleanAfter
    closeout_kind                     = "adapter_timeout"
    progress_log_written_to_archive   = $(if ($archProgressPath) { "YES" } else { "NO" })
  }
}

function Invoke-SilverCap50OrchestrationRuntimeCloseout {
  param(
    [string]$RepoRoot,
    [int]$Cycle,
    [string]$Reason,
    [hashtable]$ProgressLogFields,
    [string]$ProgressOutcome = "FAIL",
    [string]$CloseoutKind = "orchestration_fail"
  )
  $archOut = Archive-SilverCap50CycleRuntimeArtifacts -RepoRoot $RepoRoot -Cycle $Cycle -Reason $Reason
  $archiveRel = [string]$archOut.RelativePath
  $archivedFlag = [string]$archOut.Archived
  $archProgressPath = ""
  if ($archOut.FullPath -and (Test-Path -LiteralPath $archOut.FullPath)) {
    $archProgressPath = Join-Path $archOut.FullPath "SILVER_PROGRESS_LOG.md"
    if (-not (Test-Path -LiteralPath $archProgressPath)) {
      $repoProgress = Join-Path $RepoRoot "SILVER_PROGRESS_LOG.md"
      if (Test-Path -LiteralPath $repoProgress) {
        Copy-Item -LiteralPath $repoProgress -Destination $archProgressPath -Force
      }
    }
    if ($null -ne $ProgressLogFields) {
      $pf = @{}
      foreach ($k in $ProgressLogFields.Keys) { $pf[$k] = $ProgressLogFields[$k] }
      if (-not $pf.ContainsKey("closeout_kind")) { $pf["closeout_kind"] = $CloseoutKind }
      if (-not $pf.ContainsKey("timeout_artifacts_archived")) { $pf["timeout_artifacts_archived"] = $archivedFlag }
      if ($archiveRel) { $pf["timeout_archive_path"] = ($archiveRel -replace "\\", "/") }
      Write-SilverProgressLogBlock -ProgressLogPath $archProgressPath -Outcome $ProgressOutcome -Fields $pf
      Update-SilverTimeoutArchiveManifestCloseout -ArchiveDir $archOut.FullPath -ExtraFields @{
        progress_log_fail_appended_to_archive = "YES"
        closeout_kind                         = $CloseoutKind
      }
    }
  }
  $closeoutCleanup = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot
  Write-Host ("silver-autopilot-loop: orchestration_closeout_preflight_PASS_FAIL=" + [string]$closeoutCleanup.PASS_FAIL) -ForegroundColor DarkYellow
  if ([string]$closeoutCleanup.blocked_dirty_files) {
    Write-Host ("silver-autopilot-loop: orchestration_closeout_blocked_dirty_files=" + [string]$closeoutCleanup.blocked_dirty_files) -ForegroundColor Red
  }
  if ([string]$closeoutCleanup.remaining_forbidden_dirty_files) {
    Write-Host ("silver-autopilot-loop: orchestration_closeout_remaining_forbidden_dirty_files=" + [string]$closeoutCleanup.remaining_forbidden_dirty_files) -ForegroundColor Red
  }
  $gitCleanAfter = [string]$closeoutCleanup.git_clean_after
  return @{
    timeout_archive_path              = $archiveRel
    timeout_artifacts_archived        = $archivedFlag
    runtime_artifacts_archived        = $archivedFlag
    runtime_artifacts_restored        = $(if ($closeoutCleanup.PASS_FAIL -eq "PASS") { "YES" } else { "NO" })
    PASS_FAIL                         = [string]$closeoutCleanup.PASS_FAIL
    safe_to_start_cycle               = [string]$closeoutCleanup.safe_to_start_cycle
    blocked_dirty_files               = [string]$closeoutCleanup.blocked_dirty_files
    git_status_clean_after_closeout   = $gitCleanAfter
    closeout_kind                     = $(if ([string]$closeoutCleanup.closeout_kind) { [string]$closeoutCleanup.closeout_kind } else { $CloseoutKind })
    failure_class                     = [string]$closeoutCleanup.failure_class
    blocked_dirty_classification      = [string]$closeoutCleanup.blocked_dirty_classification
    restored_runtime_files            = [string]$closeoutCleanup.restored_runtime_files
    remaining_forbidden_dirty_files   = [string]$closeoutCleanup.remaining_forbidden_dirty_files
    progress_log_written_to_archive   = $(if ($archProgressPath) { "YES" } else { "NO" })
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

function Archive-SilverAdapterMetaBeforeCycleInvalidation {
  param(
    [string]$RepoRoot,
    [string]$AdapterOutputPath,
    [string]$RunId,
    [string]$CycleState
  )
  if (-not (Test-Path -LiteralPath $AdapterOutputPath)) { return "" }
  $meta = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $AdapterOutputPath
  if ($meta.Count -eq 0) { return "" }
  $state = ""
  if ($meta.ContainsKey("adapter_output_state")) { $state = [string]$meta["adapter_output_state"] }
  if ($state -eq "INVALIDATED_AWAITING_CYCLE") { return "" }
  $archRoot = Join-Path $RepoRoot ".silver-runtime\adapter-meta-archive"
  New-Item -ItemType Directory -Path $archRoot -Force -ErrorAction SilentlyContinue | Out-Null
  $tok = [guid]::NewGuid().ToString("N").Substring(0, 8)
  $runTok = if ($RunId.Trim().Length -gt 0) { $RunId.Trim().Substring(0, [Math]::Min(12, $RunId.Trim().Length)) } else { "norun" }
  $cycTok = if ($CycleState.Trim().Length -gt 0) { $CycleState.Trim() } else { "pending" }
  $archName = "cycle-" + $cycTok + "-" + $runTok + "-" + $tok + ".md"
  $archPath = Join-Path $archRoot $archName
  try {
    Copy-Item -LiteralPath $AdapterOutputPath -Destination $archPath -Force
    return $archPath
  }
  catch {
    return ""
  }
}

function Write-SilverCursorOutputInvalidatedStub {
  param(
    [string]$Path,
    [string]$RunId,
    [string]$RunStartUtcIso,
    [string]$CycleState,
    [string]$RepoRoot = ""
  )
  if ($RepoRoot -and (Test-Path -LiteralPath $Path)) {
    $null = Archive-SilverAdapterMetaBeforeCycleInvalidation -RepoRoot $RepoRoot -AdapterOutputPath $Path -RunId $RunId -CycleState $CycleState
  }
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

function Write-SilverCursorOutputOuterWallTimeoutTerminal {
  param(
    [string]$Path,
    [string]$RunId,
    [string]$RunStartUtcIso,
    [string]$CycleState,
    [string]$TaskDigest,
    [string]$OuterStdout,
    [string]$OuterStderr,
    [int]$EffectiveTimeoutSeconds,
    [string]$ProcessStartUtcIso = "",
    [string]$TaskFile = "",
    [string]$OutputFile = ""
  )
  $stdoutBody = $OuterStdout
  if ([string]::IsNullOrWhiteSpace($stdoutBody)) {
    $stdoutBody = "SILVER_OUTER_WALL_TIMEOUT terminal capture: cmd.exe wrapper exceeded outer wait; adapter_output_state forced to COMPLETED for cycle handoff."
  }
  $stderrBody = $OuterStderr
  if ([string]::IsNullOrWhiteSpace($stderrBody)) {
    $stderrBody = ""
  }
  $nowUtc = (Get-Date).ToUniversalTime().ToString("o")
  $procStartIso = $ProcessStartUtcIso.Trim()
  if ($procStartIso.Length -eq 0) { $procStartIso = $nowUtc }
  $tsLocal = (Get-Date).ToString("s")
  $meta = [ordered]@{
    timestamp_local = $tsLocal
    autonomous_run_id = $RunId
    autonomous_run_start_utc = $RunStartUtcIso
    autonomous_cycle = $CycleState
    adapter_output_state = "COMPLETED"
    pipe_capture_mode = "cmd_redirect_file"
    adapter_completion_path = "outer_wall_timeout_terminal"
    process_start_utc = $procStartIso
    process_end_utc = $nowUtc
    exit_code = "124"
    timed_out = "YES"
    effective_timeout_seconds = [string]$EffectiveTimeoutSeconds
    task_digest = $TaskDigest
    stdout_nonempty = $(if ($stdoutBody.Trim().Length -gt 0) { "YES" } else { "NO" })
    stderr_nonempty = $(if ($stderrBody.Trim().Length -gt 0) { "YES" } else { "NO" })
    can_run_full_auto_loop_maxcycles_1 = "NO"
  }
  if ($TaskFile.Trim().Length -gt 0) { $meta["task_file"] = $TaskFile.Trim() }
  if ($OutputFile.Trim().Length -gt 0) { $meta["output_file"] = $OutputFile.Trim() }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine("# silver-cursor-agent-adapter")
  foreach ($k in $meta.Keys) {
    [void]$sb.AppendLine(($k + "=" + [string]$meta[$k]))
  }
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("SILVER_OUTER_WALL_TIMEOUT_TERMINAL")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("# stdout")
  [void]$sb.Append($stdoutBody)
  if (-not $stdoutBody.EndsWith("`n")) { [void]$sb.AppendLine("") }
  [void]$sb.AppendLine("# stderr")
  [void]$sb.Append($stderrBody)
  if (-not $stderrBody.EndsWith("`n")) { [void]$sb.AppendLine("") }
  [System.IO.File]::WriteAllText($Path, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
}

function Test-SilverStaleInvokeStartedMetaState {
  param([string]$AdapterOutputPath)
  if (-not (Test-Path -LiteralPath $AdapterOutputPath)) { return $false }
  $meta = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $AdapterOutputPath
  if ($meta.Count -eq 0) { return $false }
  $state = ""
  if ($meta.ContainsKey("adapter_output_state")) { $state = [string]$meta["adapter_output_state"] }
  if ($state -ne "INVOKE_STARTED") { return $false }
  $exitPresent = ""
  if ($meta.ContainsKey("exit_code")) { $exitPresent = [string]$meta["exit_code"] }
  $elapsedPresent = ""
  if ($meta.ContainsKey("elapsed_ms")) { $elapsedPresent = [string]$meta["elapsed_ms"] }
  if ($exitPresent.Trim().Length -gt 0) { return $false }
  if ($elapsedPresent.Trim().Length -gt 0) { return $false }
  return $true
}

function Get-SilverAdapterInvokeStallFingerprint {
  param([string]$AdapterOutputPath)
  if (-not (Test-Path -LiteralPath $AdapterOutputPath)) { return "" }
  $meta = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $AdapterOutputPath
  $keys = @(
    "adapter_output_state",
    "adapter_completion_path",
    "exit_code",
    "elapsed_ms",
    "process_end_utc",
    "timed_out",
    "task_digest",
    "stdout_nonempty",
    "stderr_nonempty"
  )
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($k in $keys) {
    $v = ""
    if ($meta.ContainsKey($k)) { $v = [string]$meta[$k] }
    [void]$parts.Add($k + "=" + $v.Trim())
  }
  try {
    $fi = Get-Item -LiteralPath $AdapterOutputPath
    [void]$parts.Add("file_bytes=" + [string]$fi.Length)
  }
  catch {
    [void]$parts.Add("file_bytes=0")
  }
  return ($parts.ToArray() -join "|")
}

function Test-SilverWslAgentWorkloadPresent {
  $names = @("wsl.exe", "wslhost.exe")
  foreach ($n in $names) {
    $hits = Get-Process -Name $n -ErrorAction SilentlyContinue
    if ($null -ne $hits -and @($hits).Count -gt 0) { return $true }
  }
  return $false
}

function Get-SilverStaleInvokeWatchdogSliceMs {
  $fromEnv = Get-SilverEnvIntOrEmpty -Name "SILVER_STALE_INVOKE_SLICE_SECONDS"
  $sec = 30
  if ($null -ne $fromEnv -and $fromEnv -gt 0) { $sec = $fromEnv }
  return ([Math]::Max(5, $sec) * 1000)
}

function Get-SilverStaleInvokeWatchdogStallMs {
  $fromEnv = Get-SilverEnvIntOrEmpty -Name "SILVER_STALE_INVOKE_STALL_SECONDS"
  $sec = 120
  if ($null -ne $fromEnv -and $fromEnv -gt 0) { $sec = $fromEnv }
  return ([Math]::Max(30, $sec) * 1000)
}

function Get-SilverStaleInvokeWatchdogGraceMs {
  $fromEnv = Get-SilverEnvIntOrEmpty -Name "SILVER_STALE_INVOKE_PROCESS_ALIVE_GRACE_SECONDS"
  $sec = 180
  if ($null -ne $fromEnv -and $fromEnv -gt 0) { $sec = $fromEnv }
  return ([Math]::Max(60, $sec) * 1000)
}

function Get-SilverRepoProgressHeartbeatSnapshotLite {
  param([string]$RepoRoot)
  $items = New-Object System.Collections.Generic.List[string]
  foreach ($rel in @("SILVER_NEXT_ACTION.md", "SILVER_RUN_REPORT.md", "SILVER_PROGRESS_LOG.md")) {
    $abs = Join-Path $RepoRoot $rel
    if (Test-Path -LiteralPath $abs) {
      $fi = Get-Item -LiteralPath $abs
      $relNorm = $rel.Replace("\", "/")
      [void]$items.Add($relNorm + ":" + [string]$fi.Length + ":" + [string]$fi.LastWriteTimeUtc.Ticks)
    }
  }
  $arr = $items.ToArray()
  [Array]::Sort($arr)
  return ($arr -join "|")
}

function Get-SilverCursorInvokeCaptureProgressSnapshot {
  param(
    [string]$RepoRoot,
    [string]$StdoutTmp,
    [string]$StderrTmp
  )
  $items = Get-SilverRepoProgressHeartbeatSnapshotLite -RepoRoot $RepoRoot
  $stdoutLen = 0
  $stderrLen = 0
  if ($StdoutTmp -and (Test-Path -LiteralPath $StdoutTmp)) {
    $stdoutLen = (Get-Item -LiteralPath $StdoutTmp).Length
  }
  if ($StderrTmp -and (Test-Path -LiteralPath $StderrTmp)) {
    $stderrLen = (Get-Item -LiteralPath $StderrTmp).Length
  }
  return ($items + "|capture_stdout_bytes=" + [string]$stdoutLen + "|capture_stderr_bytes=" + [string]$stderrLen)
}

function Get-SilverStaleInvokeProgressSnapshotForCloseout {
  param([hashtable]$ProgressSnapshotBefore)
  $out = @{}
  if ($null -eq $ProgressSnapshotBefore) { return $out }
  foreach ($k in $ProgressSnapshotBefore.Keys) {
    $out[$k] = [string]$ProgressSnapshotBefore[$k]
  }
  return $out
}

function Resolve-SilverStaleInvokeClassification {
  param(
    [bool]$AdapterProgressEver,
    [bool]$CaptureProgressEver,
    [bool]$RepoHeartbeatEver,
    [bool]$WslSeenEver,
    [bool]$ProcessAlive,
    [int]$OutputLenDelta,
    [bool]$FalsePositiveBlocked
  )
  if ($FalsePositiveBlocked) { return "STALE_CURSOR_INVOKE_FALSE_POSITIVE_BLOCKED" }
  if ($CaptureProgressEver -or $RepoHeartbeatEver) { return "OUTPUT_PROGRESS_DETECTED" }
  if ($OutputLenDelta -gt 32) { return "OUTPUT_PROGRESS_DETECTED" }
  if ($ProcessAlive) { return "CURSOR_PROCESS_ALIVE_BUT_NO_OUTPUT" }
  if ($WslSeenEver -and (-not $AdapterProgressEver) -and (-not $CaptureProgressEver)) {
    return "CURSOR_PROCESS_ALIVE_BUT_NO_OUTPUT"
  }
  return "STALE_CURSOR_INVOKE_NO_PROGRESS_TRUE"
}

function Write-SilverCursorOutputStaleInvokeTerminal {
  param(
    [string]$Path,
    [string]$RunId,
    [string]$RunStartUtcIso,
    [string]$CycleState,
    [string]$TaskDigest,
    [string]$ProcessStartUtcIso = "",
    [string]$TaskFile = "",
    [string]$OutputFile = "",
    [string]$OuterStdout = "",
    [string]$OuterStderr = ""
  )
  $stdoutBody = $OuterStdout
  if ([string]::IsNullOrWhiteSpace($stdoutBody)) {
    $stdoutBody = "SILVER_STALE_INVOKE_CLOSEOUT: orchestration detected INVOKE_STARTED with no exit_code/elapsed_ms and no adapter progress; invoke terminated safely."
  }
  $stderrBody = $OuterStderr
  if ([string]::IsNullOrWhiteSpace($stderrBody)) { $stderrBody = "" }
  $nowUtc = (Get-Date).ToUniversalTime().ToString("o")
  $procStartIso = $ProcessStartUtcIso.Trim()
  if ($procStartIso.Length -eq 0) { $procStartIso = $nowUtc }
  $meta = [ordered]@{
    timestamp_local = (Get-Date).ToString("s")
    autonomous_run_id = $RunId
    autonomous_run_start_utc = $RunStartUtcIso
    autonomous_cycle = $CycleState
    adapter_output_state = "COMPLETED"
    pipe_capture_mode = "cmd_redirect_file"
    adapter_completion_path = "stale_invoke_orchestration_closeout"
    process_start_utc = $procStartIso
    process_end_utc = $nowUtc
    exit_code = "125"
    elapsed_ms = ""
    timed_out = "YES"
    task_digest = $TaskDigest
    stdout_nonempty = $(if ($stdoutBody.Trim().Length -gt 0) { "YES" } else { "NO" })
    stderr_nonempty = $(if ($stderrBody.Trim().Length -gt 0) { "YES" } else { "NO" })
    can_run_full_auto_loop_maxcycles_1 = "NO"
    stale_invoke_closeout = "YES"
  }
  if ($TaskFile.Trim().Length -gt 0) { $meta["task_file"] = $TaskFile.Trim() }
  if ($OutputFile.Trim().Length -gt 0) { $meta["output_file"] = $OutputFile.Trim() }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine("# silver-cursor-agent-adapter")
  foreach ($k in $meta.Keys) {
    [void]$sb.AppendLine(($k + "=" + [string]$meta[$k]))
  }
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("SILVER_STALE_INVOKE_ORCHESTRATION_CLOSEOUT")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("# stdout")
  [void]$sb.Append($stdoutBody)
  if (-not $stdoutBody.EndsWith("`n")) { [void]$sb.AppendLine("") }
  [void]$sb.AppendLine("# stderr")
  [void]$sb.Append($stderrBody)
  if (-not $stderrBody.EndsWith("`n")) { [void]$sb.AppendLine("") }
  [System.IO.File]::WriteAllText($Path, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
}

function Write-SilverAutopilotStaleInvokeCloseoutBlock {
  param([hashtable]$Result)
  Write-Host ""
  Write-Host "=== SILVER_AUTOPILOT_STALE_INVOKE_CLOSEOUT ===" -ForegroundColor Red
  Write-Host ("stale_invoke_detected=" + [string]$Result.stale_invoke_detected)
  Write-Host ("adapter_output_state=" + [string]$Result.adapter_output_state)
  Write-Host ("output_last_write_before=" + [string]$Result.output_last_write_before)
  Write-Host ("output_last_write_after=" + [string]$Result.output_last_write_after)
  Write-Host ("output_length_before=" + [string]$Result.output_length_before)
  Write-Host ("output_length_after=" + [string]$Result.output_length_after)
  Write-Host ("process_progress_detected=" + [string]$Result.process_progress_detected)
  Write-Host ("capture_progress_detected=" + [string]$Result.capture_progress_detected)
  Write-Host ("repo_heartbeat_progress_detected=" + [string]$Result.repo_heartbeat_progress_detected)
  Write-Host ("output_growth_detected=" + [string]$Result.output_growth_detected)
  Write-Host ("stale_invoke_classification=" + [string]$Result.stale_invoke_classification)
  Write-Host ("wsl_agent_progress_detected=" + [string]$Result.wsl_agent_progress_detected)
  Write-Host ("terminated_processes=" + [string]$Result.terminated_processes)
  Write-Host ("runtime_dirty_restored=" + [string]$Result.runtime_dirty_restored)
  Write-Host ("git_clean_after=" + [string]$Result.git_clean_after)
  Write-Host ("stop_reason=" + [string]$Result.stop_reason)
  Write-Host ("PASS_FAIL=" + [string]$Result.PASS_FAIL) -ForegroundColor Red
  Write-Host "=== END_SILVER_AUTOPILOT_STALE_INVOKE_CLOSEOUT ===" -ForegroundColor Red
  Write-Host ""
}

function Get-SilverRuntimeFailureProgressMetrics {
  return [ordered]@{
    core_engine_progress = "NOT_EVALUATED_RUNTIME_FAILURE"
    safety_progress = "NOT_EVALUATED_RUNTIME_FAILURE"
    routing_progress = "NOT_EVALUATED_RUNTIME_FAILURE"
    retrieval_progress = "NOT_EVALUATED_RUNTIME_FAILURE"
    real_human_chaos_progress = "NOT_EVALUATED_RUNTIME_FAILURE"
    multi_intent_orchestration_progress = "NOT_EVALUATED_RUNTIME_FAILURE"
    long_session_memory_progress = "NOT_EVALUATED_RUNTIME_FAILURE"
    public_ready_progress = "NOT_EVALUATED_RUNTIME_FAILURE"
    source = "runtime_failure_not_product_evaluated"
  }
}

function Test-SilverCap50StopReasonIsRuntimeFailure {
  param([string]$StopReason, [string]$Focus = "")
  $blob = ([string]$StopReason + "|" + [string]$Focus).ToLowerInvariant()
  if ($blob -match 'stale_cursor_invoke|stale_invoke|adapter_invoke_startup|adapter_invoke_process|adapter_invoke_never|cursor_exit_nonzero|cursor_outer_or_adapter_timeout|utf8_mojibake|adapter_meta_not_fresh|adapter_invoke_started_but_not_completed|cap50_postcondition_fail|cursor_temp_capture') {
    return $true
  }
  return $false
}

function Invoke-SilverStaleCursorInvokeCloseout {
  param(
    [string]$RepoRoot,
    [string]$AdapterOutputPath,
    [System.Diagnostics.Process]$Process,
    [string]$StdoutTmp,
    [string]$StderrTmp,
    [string]$TaskDigest,
    [string]$TaskFile,
    [string]$OutputFile,
    [datetime]$ProcessStartUtc,
    [hashtable]$ProgressSnapshotBefore
  )
  $terminated = ""
  if ($null -ne $Process) {
    if (-not $Process.HasExited) {
      try {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        $terminated = "pid=" + [string]$Process.Id
      }
      catch {
        $terminated = "pid=" + [string]$Process.Id + "(stop_failed)"
      }
    }
    else {
      $terminated = "pid=" + [string]$Process.Id + "(already_exited)"
    }
  }
  $so = ""
  $se = ""
  if ($StdoutTmp -and (Test-Path -LiteralPath $StdoutTmp)) {
    $soRes = Read-SilverLoopTempCaptureFileWithRetry -Path $StdoutTmp
    if ($soRes.Success) { $so = [string]$soRes.Text }
  }
  if ($StderrTmp -and (Test-Path -LiteralPath $StderrTmp)) {
    $seRes = Read-SilverLoopTempCaptureFileWithRetry -Path $StderrTmp
    if ($seRes.Success) { $se = [string]$seRes.Text }
  }
  $runCtx = Get-SilverAutonomousRunContext
  $digestClose = $TaskDigest
  if ([string]::IsNullOrWhiteSpace($digestClose)) { $digestClose = "stale_invoke_orchestration" }
  $procIso = ""
  if ($ProcessStartUtc -and ($ProcessStartUtc -ne [datetime]::MinValue)) {
    $procIso = $ProcessStartUtc.ToString("o")
  }
  Write-SilverCursorOutputStaleInvokeTerminal -Path $AdapterOutputPath `
    -RunId $runCtx.RunId -RunStartUtcIso $runCtx.RunStartUtc -CycleState $runCtx.Cycle `
    -TaskDigest $digestClose -ProcessStartUtcIso $procIso -TaskFile $TaskFile -OutputFile $OutputFile `
    -OuterStdout $so -OuterStderr $se
  $runtimeDirtyRestored = "NO"
  $gitCleanAfter = "NO"
  $metaAfter = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $AdapterOutputPath
  $stateAfter = ""
  if ($metaAfter.ContainsKey("adapter_output_state")) { $stateAfter = [string]$metaAfter["adapter_output_state"] }
  $outLenAfter = ""
  $outLwtAfter = ""
  if (Test-Path -LiteralPath $AdapterOutputPath) {
    $fiAfter = Get-Item -LiteralPath $AdapterOutputPath
    $outLenAfter = [string]$fiAfter.Length
    $outLwtAfter = $fiAfter.LastWriteTimeUtc.ToString("o")
  }
  $classClose = "STALE_CURSOR_INVOKE_NO_PROGRESS_TRUE"
  if ($ProgressSnapshotBefore.ContainsKey("stale_invoke_classification")) {
    $classClose = [string]$ProgressSnapshotBefore.stale_invoke_classification
  }
  $closeout = @{
    stale_invoke_detected = "YES"
    adapter_output_state = $(if ($stateAfter) { $stateAfter } else { "COMPLETED" })
    output_last_write_before = [string]$ProgressSnapshotBefore.output_last_write_before
    output_last_write_after = $outLwtAfter
    output_length_before = [string]$ProgressSnapshotBefore.output_length_before
    output_length_after = $outLenAfter
    process_progress_detected = [string]$ProgressSnapshotBefore.process_progress_detected
    capture_progress_detected = [string]$ProgressSnapshotBefore.capture_progress_detected
    repo_heartbeat_progress_detected = [string]$ProgressSnapshotBefore.repo_heartbeat_progress_detected
    output_growth_detected = [string]$ProgressSnapshotBefore.output_growth_detected
    stale_invoke_classification = $classClose
    wsl_agent_progress_detected = [string]$ProgressSnapshotBefore.wsl_agent_progress_detected
    terminated_processes = $terminated
    runtime_dirty_restored = $runtimeDirtyRestored
    git_clean_after = $gitCleanAfter
    stop_reason = "STALE_CURSOR_INVOKE_NO_PROGRESS"
    PASS_FAIL = "FAIL"
  }
  $archiveCycle = 0
  if ($env:SILVER_AUTONOMOUS_CYCLE) {
    $parsedCycle = 0
    if ([int]::TryParse([string]$env:SILVER_AUTONOMOUS_CYCLE, [ref]$parsedCycle)) {
      $archiveCycle = $parsedCycle
    }
  }
  if (Get-Command -Name Archive-SilverCap50Utf8FailureRuntimeArtifacts -ErrorAction SilentlyContinue) {
    $archStale = Archive-SilverCap50Utf8FailureRuntimeArtifacts -RepoRoot $RepoRoot -Cycle $archiveCycle -Reason "STALE_CURSOR_INVOKE_NO_PROGRESS" -CursorExit "125"
    if ([string]$archStale.RelativePath) {
      Write-Host ("silver-autopilot-loop: stale_invoke_failure_archive=" + [string]$archStale.RelativePath) -ForegroundColor DarkYellow
    }
  }
  if (Get-Command -Name Invoke-SilverCap50PreflightCleanup -ErrorAction SilentlyContinue) {
    $cleanupAfterArchive = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot
    if ([string]$cleanupAfterArchive.PASS_FAIL -eq "PASS") {
      $closeout.runtime_dirty_restored = "YES"
      $closeout.git_clean_after = "YES"
    }
    elseif ([string]$cleanupAfterArchive.restored_runtime_files) {
      $closeout.runtime_dirty_restored = "YES"
      $closeout.git_clean_after = [string]$cleanupAfterArchive.git_clean_after
    }
  }
  if ($closeout.git_clean_after -ne "YES") {
    $closeout.git_clean_after = if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" }
  }
  $null = Invoke-SilverStaleCursorInvokeRuntimeFinalize -RepoRoot $RepoRoot -StopReason "STALE_CURSOR_INVOKE_NO_PROGRESS"
  if (Test-GitStatusClean -Cwd $RepoRoot) {
    $closeout.git_clean_after = "YES"
    $closeout.runtime_dirty_restored = "YES"
  }
  Write-SilverAutopilotStaleInvokeCloseoutBlock -Result $closeout
  return $closeout
}

function Invoke-SilverStaleCursorInvokeRuntimeFinalize {
  param(
    [string]$RepoRoot,
    [string]$StopReason = "STALE_CURSOR_INVOKE_NO_PROGRESS"
  )
  $autopilotScript = Join-Path $RepoRoot "scripts\silver-autopilot.cjs"
  if (-not (Test-Path -LiteralPath $autopilotScript)) {
    Write-Host "silver-autopilot-loop: stale_runtime_finalize_skipped=missing_autopilot_script" -ForegroundColor DarkYellow
    return @{ PASS_FAIL = "SKIP" }
  }
  if (Get-Command -Name Invoke-SilverCap50PreflightCleanup -ErrorAction SilentlyContinue) {
    $pf = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot
    Write-Host ("silver-autopilot-loop: stale_runtime_preflight_cleanup_PASS_FAIL=" + [string]$pf.PASS_FAIL) -ForegroundColor DarkYellow
  }
  $prevStopEnv = [Environment]::GetEnvironmentVariable("SILVER_RUNTIME_STOP_REASON", "Process")
  [Environment]::SetEnvironmentVariable("SILVER_RUNTIME_STOP_REASON", $StopReason, "Process")
  try {
    $enforceArgs = @(
      $autopilotScript,
      "--enforce-runtime-next-action-md",
      ("--stop-reason=" + $StopReason)
    )
    $enforceRes = Invoke-NodeScript -WorkingDirectory $RepoRoot -Arguments $enforceArgs -PassThruExit $true
    Write-Host ("silver-autopilot-loop: enforce_runtime_next_action_exit=" + [string]$enforceRes.ExitCode) -ForegroundColor DarkCyan
    $null = Invoke-SilverOrchestrationProductHandoffBridge -RepoRoot $RepoRoot -AutopilotScript $autopilotScript
    $sanitizeRes = Invoke-NodeScript -WorkingDirectory $RepoRoot -Arguments @($autopilotScript, "--sanitize-next-action-md") -PassThruExit $true
    Write-Host ("silver-autopilot-loop: stale_runtime_sanitize_exit=" + [string]$sanitizeRes.ExitCode) -ForegroundColor DarkCyan
  }
  finally {
    if ($null -ne $prevStopEnv) {
      [Environment]::SetEnvironmentVariable("SILVER_RUNTIME_STOP_REASON", $prevStopEnv, "Process")
    }
    else {
      Remove-Item Env:\SILVER_RUNTIME_STOP_REASON -ErrorAction SilentlyContinue
    }
  }
  $nextPath = Join-Path $RepoRoot "SILVER_NEXT_ACTION.md"
  $nextText = Read-TextFileOrEmpty -Path $nextPath
  $genericStill = Test-SilverNextActionIsOrchestrationMaintenanceOnly -Text $nextText
  if ($genericStill) {
    Write-Host "silver-autopilot-loop: stale_runtime_finalize_generic_next_action_still_present=YES" -ForegroundColor Red
    return @{ PASS_FAIL = "FAIL"; generic_next_action_remaining = "YES" }
  }
  return @{
    PASS_FAIL = "PASS"
    git_clean_after = $(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })
    generic_next_action_remaining = "NO"
  }
}

function New-SilverStaleInvokeProgressSnapshot {
  param(
    [string]$OutLwtBefore,
    [string]$OutLenBefore,
    [bool]$AdapterProgressEver,
    [bool]$CaptureProgressEver,
    [bool]$RepoHeartbeatEver,
    [bool]$OutputGrowthEver,
    [bool]$WslSeenEver,
    [string]$StaleClassification = ""
  )
  $snap = @{
    output_last_write_before = $OutLwtBefore
    output_length_before = $OutLenBefore
    process_progress_detected = $(if ($AdapterProgressEver) { "YES" } else { "NO" })
    capture_progress_detected = $(if ($CaptureProgressEver) { "YES" } else { "NO" })
    repo_heartbeat_progress_detected = $(if ($RepoHeartbeatEver) { "YES" } else { "NO" })
    output_growth_detected = $(if ($OutputGrowthEver) { "YES" } else { "NO" })
    wsl_agent_progress_detected = $(if ($WslSeenEver) { "YES" } else { "NO" })
  }
  if ($StaleClassification.Trim().Length -gt 0) {
    $snap.stale_invoke_classification = $StaleClassification.Trim()
  }
  return $snap
}

function Wait-SilverCursorInvokeWithStaleWatchdog {
  param(
    [System.Diagnostics.Process]$Process,
    [string]$AdapterOutputPath,
    [string]$StdoutTmp,
    [string]$StderrTmp,
    [int]$OuterWaitMs,
    [string]$RepoRoot
  )
  $sliceMs = Get-SilverStaleInvokeWatchdogSliceMs
  $stallMs = Get-SilverStaleInvokeWatchdogStallMs
  $graceMs = Get-SilverStaleInvokeWatchdogGraceMs
  $wallStart = [DateTime]::UtcNow
  $lastAdapterFinger = Get-SilverAdapterInvokeStallFingerprint -AdapterOutputPath $AdapterOutputPath
  $lastCaptureSnap = Get-SilverCursorInvokeCaptureProgressSnapshot -RepoRoot $RepoRoot -StdoutTmp $StdoutTmp -StderrTmp $StderrTmp
  $lastRepoSnap = Get-SilverRepoProgressHeartbeatSnapshotLite -RepoRoot $RepoRoot
  $lastAdapterProgressUtc = $wallStart
  $adapterProgressEver = $false
  $captureProgressEver = $false
  $repoHeartbeatEver = $false
  $outputGrowthEver = $false
  $wslSeenEver = Test-SilverWslAgentWorkloadPresent
  $outLenBefore = ""
  $outLwtBefore = ""
  $outLenInitial = 0
  if (Test-Path -LiteralPath $AdapterOutputPath) {
    $fi0 = Get-Item -LiteralPath $AdapterOutputPath
    $outLenBefore = [string]$fi0.Length
    $outLenInitial = [int]$fi0.Length
    $outLwtBefore = $fi0.LastWriteTimeUtc.ToString("o")
  }
  while ($true) {
    if ($Process.HasExited) {
      return @{
        ExitCode = [int]$Process.ExitCode
        StaleInvokeDetected = $false
        ProgressSnapshotBefore = (New-SilverStaleInvokeProgressSnapshot -OutLwtBefore $outLwtBefore -OutLenBefore $outLenBefore `
          -AdapterProgressEver $adapterProgressEver -CaptureProgressEver $captureProgressEver -RepoHeartbeatEver $repoHeartbeatEver `
          -OutputGrowthEver $outputGrowthEver -WslSeenEver $wslSeenEver)
      }
    }
    $remainMs = $OuterWaitMs
    if ($OuterWaitMs -gt 0) {
      $elapsedWall = [int64](([DateTime]::UtcNow - $wallStart).TotalMilliseconds)
      $remainMs = $OuterWaitMs - $elapsedWall
      if ($remainMs -lt 1) { $remainMs = 1 }
    }
    $waitSlice = $sliceMs
    if ($OuterWaitMs -gt 0 -and $waitSlice -gt $remainMs) { $waitSlice = [int]$remainMs }
    $exited = $Process.WaitForExit([int]$waitSlice)
    if ($exited) {
      return @{
        ExitCode = [int]$Process.ExitCode
        StaleInvokeDetected = $false
        ProgressSnapshotBefore = (New-SilverStaleInvokeProgressSnapshot -OutLwtBefore $outLwtBefore -OutLenBefore $outLenBefore `
          -AdapterProgressEver $adapterProgressEver -CaptureProgressEver $captureProgressEver -RepoHeartbeatEver $repoHeartbeatEver `
          -OutputGrowthEver $outputGrowthEver -WslSeenEver $wslSeenEver)
      }
    }
    $progressThisSlice = $false
    $adapterFingerNow = Get-SilverAdapterInvokeStallFingerprint -AdapterOutputPath $AdapterOutputPath
    if ($adapterFingerNow -ne $lastAdapterFinger) {
      $progressThisSlice = $true
      $adapterProgressEver = $true
      $lastAdapterFinger = $adapterFingerNow
    }
    if (-not (Test-SilverStaleInvokeStartedMetaState -AdapterOutputPath $AdapterOutputPath)) {
      $progressThisSlice = $true
      $adapterProgressEver = $true
    }
    $repoSnapNow = Get-SilverRepoProgressHeartbeatSnapshotLite -RepoRoot $RepoRoot
    if ($repoSnapNow -ne $lastRepoSnap) {
      $progressThisSlice = $true
      $repoHeartbeatEver = $true
      $lastRepoSnap = $repoSnapNow
    }
    $captureSnapNow = Get-SilverCursorInvokeCaptureProgressSnapshot -RepoRoot $RepoRoot -StdoutTmp $StdoutTmp -StderrTmp $StderrTmp
    if ($captureSnapNow -ne $lastCaptureSnap) {
      $progressThisSlice = $true
      $captureProgressEver = $true
      $lastCaptureSnap = $captureSnapNow
    }
    if (Test-Path -LiteralPath $AdapterOutputPath) {
      $fiNow = Get-Item -LiteralPath $AdapterOutputPath
      $lenNow = [int]$fiNow.Length
      if ($lenNow -gt ($outLenInitial + 32)) {
        $progressThisSlice = $true
        $outputGrowthEver = $true
      }
    }
    if ($progressThisSlice) {
      $lastAdapterProgressUtc = [DateTime]::UtcNow
    }
    if (Test-SilverWslAgentWorkloadPresent) {
      $wslSeenEver = $true
    }
    if (Test-SilverStaleInvokeStartedMetaState -AdapterOutputPath $AdapterOutputPath) {
      $stallAgeMs = [int64](([DateTime]::UtcNow - $lastAdapterProgressUtc).TotalMilliseconds)
      if ($stallAgeMs -ge $stallMs) {
        $processAlive = (-not $Process.HasExited)
        $falsePositiveBlocked = $false
        if ($captureProgressEver -or $repoHeartbeatEver -or $outputGrowthEver) {
          $falsePositiveBlocked = $true
        }
        if ($processAlive -and ($stallAgeMs -lt $graceMs)) {
          $falsePositiveBlocked = $true
        }
        if ($falsePositiveBlocked) {
          if ($captureProgressEver -or $repoHeartbeatEver -or $outputGrowthEver) {
            $lastAdapterProgressUtc = [DateTime]::UtcNow
          }
          continue
        }
        $outLenDelta = 0
        if (Test-Path -LiteralPath $AdapterOutputPath) {
          $outLenDelta = [int](Get-Item -LiteralPath $AdapterOutputPath).Length - $outLenInitial
        }
        $classStale = Resolve-SilverStaleInvokeClassification -AdapterProgressEver $adapterProgressEver `
          -CaptureProgressEver $captureProgressEver -RepoHeartbeatEver $repoHeartbeatEver -WslSeenEver $wslSeenEver `
          -ProcessAlive $processAlive -OutputLenDelta $outLenDelta -FalsePositiveBlocked $false
        return @{
          ExitCode = 125
          StaleInvokeDetected = $true
          ProgressSnapshotBefore = (New-SilverStaleInvokeProgressSnapshot -OutLwtBefore $outLwtBefore -OutLenBefore $outLenBefore `
            -AdapterProgressEver $adapterProgressEver -CaptureProgressEver $captureProgressEver -RepoHeartbeatEver $repoHeartbeatEver `
            -OutputGrowthEver $outputGrowthEver -WslSeenEver $wslSeenEver -StaleClassification $classStale)
        }
      }
    }
    if ($OuterWaitMs -gt 0) {
      $elapsedWall2 = [int64](([DateTime]::UtcNow - $wallStart).TotalMilliseconds)
      if ($elapsedWall2 -ge $OuterWaitMs) {
        try { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue } catch { }
        return @{
          ExitCode = 124
          StaleInvokeDetected = $false
          ProgressSnapshotBefore = (New-SilverStaleInvokeProgressSnapshot -OutLwtBefore $outLwtBefore -OutLenBefore $outLenBefore `
            -AdapterProgressEver $adapterProgressEver -CaptureProgressEver $captureProgressEver -RepoHeartbeatEver $repoHeartbeatEver `
            -OutputGrowthEver $outputGrowthEver -WslSeenEver $wslSeenEver)
        }
      }
    }
  }
}

function Initialize-SilverAutonomousRunLifecycle {
  param(
    [string]$RunId,
    [datetime]$RunStartUtc,
    [string]$CursorOutputPath,
    [string]$RepoRoot
  )
  $runStartIso = $RunStartUtc.ToString("o")
  $script:SilverAutonomousRunId = $RunId
  $script:SilverAutonomousRunStartUtc = $RunStartUtc
  $env:SILVER_AUTONOMOUS_RUN_ID = $RunId
  $env:SILVER_AUTONOMOUS_RUN_START_UTC = $runStartIso
  Remove-Item Env:\SILVER_AUTONOMOUS_CYCLE -ErrorAction SilentlyContinue
  Write-SilverCursorOutputInvalidatedStub -Path $CursorOutputPath -RunId $RunId -RunStartUtcIso $runStartIso -CycleState "pending" -RepoRoot $RepoRoot
}

function Test-SilverAutonomousAdapterOutputNeedsLifecycleRearm {
  param(
    [string]$CursorOutputPath,
    [string]$ExpectedRunId
  )
  if ($ExpectedRunId.Trim().Length -eq 0) { return $false }
  if (-not (Test-Path -LiteralPath $CursorOutputPath)) { return $true }
  $meta = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $CursorOutputPath
  if ($meta.Count -eq 0) { return $true }
  $state = ""
  if ($meta.ContainsKey("adapter_output_state")) { $state = [string]$meta["adapter_output_state"] }
  $metaRun = ""
  if ($meta.ContainsKey("autonomous_run_id")) { $metaRun = [string]$meta["autonomous_run_id"] }
  if ($metaRun.Trim().Length -gt 0) {
    if ($metaRun.Trim() -ne $ExpectedRunId.Trim()) { return $true }
  }
  $procStart = ""
  if ($meta.ContainsKey("process_start_utc")) { $procStart = [string]$meta["process_start_utc"] }
  if ($state -eq "INVALIDATED_AWAITING_CYCLE") {
    if ($procStart.Trim().Length -eq 0) { return $true }
  }
  return $false
}

function Invoke-SilverAutonomousCycleRearm {
  param(
    [string]$RepoRoot,
    [string]$CursorOutputPath,
    [int]$Cycle
  )
  $wantRunId = [string]$script:SilverAutonomousRunId
  if ($wantRunId.Trim().Length -eq 0) {
    $wantRunId = ([guid]::NewGuid().ToString("N"))
    Initialize-SilverAutonomousRunLifecycle -RunId $wantRunId -RunStartUtc ((Get-Date).ToUniversalTime()) -CursorOutputPath $CursorOutputPath -RepoRoot $RepoRoot
  }
  elseif (Test-SilverAutonomousAdapterOutputNeedsLifecycleRearm -CursorOutputPath $CursorOutputPath -ExpectedRunId $wantRunId) {
    $wantRunId = ([guid]::NewGuid().ToString("N"))
    Initialize-SilverAutonomousRunLifecycle -RunId $wantRunId -RunStartUtc ((Get-Date).ToUniversalTime()) -CursorOutputPath $CursorOutputPath -RepoRoot $RepoRoot
  }
  $env:SILVER_AUTONOMOUS_CYCLE = [string]$Cycle
  $runStartIso = ""
  if ($script:SilverAutonomousRunStartUtc -and ($script:SilverAutonomousRunStartUtc -ne [datetime]::MinValue)) {
    $runStartIso = $script:SilverAutonomousRunStartUtc.ToString("o")
  }
  elseif ($env:SILVER_AUTONOMOUS_RUN_START_UTC) {
    $runStartIso = [string]$env:SILVER_AUTONOMOUS_RUN_START_UTC
  }
  Write-SilverCursorOutputInvalidatedStub -Path $CursorOutputPath -RunId $script:SilverAutonomousRunId -RunStartUtcIso $runStartIso -CycleState ([string]$Cycle) -RepoRoot $RepoRoot
  return @{
    PASS_FAIL               = "PASS"
    autonomous_run_id       = [string]$script:SilverAutonomousRunId
    autonomous_cycle        = [string]$Cycle
    adapter_output_state    = "INVALIDATED_AWAITING_CYCLE"
    rearm_reason            = "post_preflight_cycle_handoff"
  }
}

function Write-SilverCursorOutputAdapterInvokeStartedMeta {
  param(
    [string]$Path,
    [string]$RunId,
    [string]$RunStartUtcIso,
    [string]$CycleState,
    [string]$TaskFile,
    [string]$OutputFile,
    [string]$TaskDigest,
    [string]$ProcessStartUtcIso
  )
  $body = @"
# silver-cursor-agent-adapter
autonomous_run_id=$RunId
autonomous_run_start_utc=$RunStartUtcIso
autonomous_cycle=$CycleState
adapter_output_state=INVOKE_STARTED
adapter_completion_path=orchestration_invoke_started
process_start_utc=$ProcessStartUtcIso
task_digest=$TaskDigest
task_file=$TaskFile
output_file=$OutputFile
exit_code=
elapsed_ms=

# stdout

# stderr

"@
  [System.IO.File]::WriteAllText($Path, $body, [System.Text.UTF8Encoding]::new($false))
}

function Test-SilverAdapterInvokeStartedEvidence {
  param([string]$AdapterOutputPath)
  if (-not (Test-Path -LiteralPath $AdapterOutputPath)) { return $false }
  $meta = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $AdapterOutputPath
  if ($meta.Count -eq 0) { return $false }
  $state = ""
  if ($meta.ContainsKey("adapter_output_state")) { $state = [string]$meta["adapter_output_state"] }
  if ($state -eq "INVALIDATED_AWAITING_CYCLE") { return $false }
  $procStart = ""
  if ($meta.ContainsKey("process_start_utc")) { $procStart = [string]$meta["process_start_utc"] }
  if ($procStart.Trim().Length -eq 0) { return $false }
  return $true
}

function Wait-SilverAdapterInvokeStartupEvidence {
  param(
    [string]$AdapterOutputPath,
    [int]$MaxWaitMs = 45000,
    [int]$PollMs = 200
  )
  $attempts = 0
  $maxAttempts = [Math]::Max(1, [int]([Math]::Ceiling($MaxWaitMs / [double]$PollMs)))
  for ($i = 0; $i -lt $maxAttempts; $i++) {
    $attempts++
    if (Test-SilverAdapterInvokeStartedEvidence -AdapterOutputPath $AdapterOutputPath) {
      return @{ PASS_FAIL = "PASS"; attempts = $attempts }
    }
    if ($i -lt ($maxAttempts - 1)) {
      Start-Sleep -Milliseconds $PollMs
    }
  }
  return @{ PASS_FAIL = "FAIL"; attempts = $attempts }
}

function Write-SilverAutonomousCycleRearmResultBlock {
  param([hashtable]$Result)
  Write-Host ""
  Write-Host "=== SILVER_AUTONOMOUS_CYCLE_REARM ===" -ForegroundColor Cyan
  Write-Host ("autonomous_run_id=" + [string]$Result.autonomous_run_id)
  Write-Host ("autonomous_cycle=" + [string]$Result.autonomous_cycle)
  Write-Host ("adapter_output_state=" + [string]$Result.adapter_output_state)
  Write-Host ("rearm_reason=" + [string]$Result.rearm_reason)
  Write-Host ("PASS_FAIL=" + [string]$Result.PASS_FAIL) -ForegroundColor $(if ([string]$Result.PASS_FAIL -eq "PASS") { "Green" } else { "Red" })
  Write-Host "=== END_SILVER_AUTONOMOUS_CYCLE_REARM ===" -ForegroundColor Cyan
  Write-Host ""
}

function Get-SilverAdapterMetaMismatchDiagnostics {
  param(
    [hashtable]$Meta,
    [datetime]$ProcessStartUtc,
    [string]$AdapterOutputPath,
    [string]$ExpectedTaskDigest = "",
    [string]$ExpectedTaskFile = "",
    [string]$ExpectedOutputFile = "",
    [string]$ExpectedRunId = "",
    [string]$ExpectedCycle = "",
    [string]$ExpectedRunStartUtc = ""
  )
  $reasons = New-Object System.Collections.Generic.List[string]
  $actualTask = ""
  $actualOutput = ""
  $actualRun = ""
  $metaTs = ""
  $outTs = ""
  $staleSec = ""
  $state = ""

  if ($Meta.ContainsKey("task_file")) { $actualTask = [string]$Meta["task_file"] }
  if ($Meta.ContainsKey("output_file")) { $actualOutput = [string]$Meta["output_file"] }
  if ($Meta.ContainsKey("autonomous_run_id")) { $actualRun = [string]$Meta["autonomous_run_id"] }
  if ($Meta.ContainsKey("adapter_output_state")) { $state = [string]$Meta["adapter_output_state"] }

  if ($null -eq $Meta -or $Meta.Count -eq 0) {
    [void]$reasons.Add("missing_adapter_meta_block")
  }
  if (-not (Test-Path -LiteralPath $AdapterOutputPath)) {
    [void]$reasons.Add("missing_output_file_on_disk")
  }
  else {
    try {
      $outTs = ([System.IO.File]::GetLastWriteTimeUtc($AdapterOutputPath)).ToString("o")
    }
    catch {
      $outTs = ""
    }
  }

  $wantRunId = $ExpectedRunId.Trim()
  if ($wantRunId.Length -gt 0) {
    if ($state -eq "INVALIDATED_AWAITING_CYCLE") {
      [void]$reasons.Add("adapter_output_state_invalidated_awaiting_cycle")
    }
    if ($actualRun.Trim().Length -gt 0) {
      if ($actualRun.Trim() -ne $wantRunId) {
        [void]$reasons.Add("autonomous_run_id_mismatch")
      }
    }
    $wantCycle = $ExpectedCycle.Trim()
    if ($wantCycle.Length -gt 0) {
      $metaCycle = ""
      if ($Meta.ContainsKey("autonomous_cycle")) { $metaCycle = [string]$Meta["autonomous_cycle"] }
      if ($metaCycle.Trim().Length -gt 0) {
        if ($metaCycle.Trim() -ne $wantCycle) {
          [void]$reasons.Add("autonomous_cycle_mismatch")
        }
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
        if ($metaNorm -ne $wantNorm) {
          [void]$reasons.Add("autonomous_run_start_utc_mismatch")
        }
      }
    }
  }

  $metaPendingInvalidatedStub = ($state -eq "INVALIDATED_AWAITING_CYCLE")

  $procStartMeta = ""
  if ($Meta.ContainsKey("process_start_utc")) { $procStartMeta = [string]$Meta["process_start_utc"] }
  $metaTs = $procStartMeta
  $procEndMeta = ""
  if ($Meta.ContainsKey("process_end_utc")) { $procEndMeta = [string]$Meta["process_end_utc"] }

  if ($metaPendingInvalidatedStub) {
    if ($ExpectedTaskDigest.Trim().Length -gt 0) {
      [void]$reasons.Add("adapter_meta_invalidated_stub_pending_flush")
    }
    $exactStub = if ($reasons.Count -gt 0) { [string]::Join("|", $reasons) } else { "(none)" }
    return @{
      expected_task_file          = $ExpectedTaskFile
      actual_meta_task_file       = $actualTask
      expected_output_file        = $ExpectedOutputFile
      actual_meta_output_file     = $actualOutput
      expected_run_id             = $ExpectedRunId
      actual_meta_run_id          = $actualRun
      meta_timestamp              = $metaTs
      output_timestamp            = $outTs
      stale_by_seconds            = $staleSec
      exact_mismatch_reason       = $exactStub
      cycle_scoped_ok             = "NO"
      adapter_output_state        = $state
    }
  }

  $freshnessUtc = [datetime]::MinValue
  if ($procEndMeta.Trim().Length -gt 0) {
    try {
      $freshnessUtc = [datetime]::Parse(
        $procEndMeta,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::RoundtripKind
      ).ToUniversalTime()
    }
    catch {
      $freshnessUtc = [datetime]::MinValue
    }
  }
  if ($freshnessUtc -eq [datetime]::MinValue -and $outTs) {
    try {
      $freshnessUtc = [datetime]::Parse(
        $outTs,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::RoundtripKind
      ).ToUniversalTime()
    }
    catch {
      $freshnessUtc = [datetime]::MinValue
    }
  }

  if ($ProcessStartUtc -ne [datetime]::MinValue) {
    if ($freshnessUtc -ne [datetime]::MinValue) {
      $delta = ($ProcessStartUtc - $freshnessUtc).TotalSeconds
      if ($delta -gt 2) {
        $staleSec = [string][int][Math]::Round($delta)
        [void]$reasons.Add("output_or_process_end_before_cycle_start")
      }
    }
    elseif (Test-Path -LiteralPath $AdapterOutputPath) {
      try {
        $mtimeUtc = ([System.IO.File]::GetLastWriteTimeUtc($AdapterOutputPath))
        $deltaM = ($ProcessStartUtc - $mtimeUtc).TotalSeconds
        if ($deltaM -gt 2) {
          $staleSec = [string][int][Math]::Round($deltaM)
          [void]$reasons.Add("output_file_mtime_before_cycle_start")
        }
      }
      catch {
        [void]$reasons.Add("output_file_mtime_unreadable")
      }
    }
  }

  if ($wantRunId.Length -gt 0) {
    if ($procStartMeta.Trim().Length -eq 0) {
      [void]$reasons.Add("missing_process_start_utc")
    }
    elseif ($ProcessStartUtc -ne [datetime]::MinValue) {
      try {
        $psMeta = [datetime]::Parse(
          $procStartMeta,
          [System.Globalization.CultureInfo]::InvariantCulture,
          [System.Globalization.DateTimeStyles]::RoundtripKind
        ).ToUniversalTime()
        $deltaPs = ($ProcessStartUtc - $psMeta).TotalSeconds
        if ($deltaPs -gt 8) {
          if (-not $staleSec) { $staleSec = [string][int][Math]::Round($deltaPs) }
          [void]$reasons.Add("process_start_utc_before_cycle_start")
        }
      }
      catch {
        [void]$reasons.Add("process_start_utc_unparseable")
      }
    }
  }
  elseif ($Meta.ContainsKey("timestamp_local")) {
    try {
      $tsLocal = [datetime]::Parse(
        [string]$Meta["timestamp_local"],
        $null,
        [System.Globalization.DateTimeStyles]::AssumeLocal
      )
      if ($ProcessStartUtc -ne [datetime]::MinValue) {
        if ($tsLocal.ToUniversalTime() -lt $ProcessStartUtc.AddMinutes(-2)) {
          [void]$reasons.Add("timestamp_local_before_cycle_start")
        }
      }
    }
    catch {
      if ($ExpectedTaskDigest.Trim().Length -gt 0) {
        [void]$reasons.Add("timestamp_local_unparseable_with_digest_required")
      }
    }
  }
  elseif ($ExpectedTaskDigest.Trim().Length -gt 0) {
    [void]$reasons.Add("missing_process_start_utc_and_timestamp_local")
  }

  if ($ExpectedTaskDigest.Trim().Length -gt 0) {
    $metaDigest = ""
    if ($Meta.ContainsKey("task_digest")) { $metaDigest = [string]$Meta["task_digest"] }
    if ((-not $metaDigest) -and $Meta.ContainsKey("task_sha256_prefix")) {
      $metaDigest = [string]$Meta["task_sha256_prefix"]
    }
    $metaDigest = $metaDigest.Trim().ToLowerInvariant()
    $want = $ExpectedTaskDigest.Trim().ToLowerInvariant()
    if ((-not $metaDigest) -or ($metaDigest -ne $want)) {
      [void]$reasons.Add("task_digest_mismatch")
    }
  }

  if ($ExpectedTaskFile.Trim().Length -gt 0) {
    if ($actualTask -and ($actualTask -ne "(probe_inline)")) {
      $nMeta = Normalize-SilverPathForCompare -Path $actualTask
      $nWant = Normalize-SilverPathForCompare -Path $ExpectedTaskFile
      if (($nMeta.Length -gt 0) -and ($nWant.Length -gt 0) -and ($nMeta -ne $nWant)) {
        [void]$reasons.Add("task_file_path_mismatch")
      }
    }
    elseif (-not $actualTask) {
      [void]$reasons.Add("missing_task_file_in_meta")
    }
  }

  if ($ExpectedOutputFile.Trim().Length -gt 0) {
    if ($actualOutput) {
      $nOutMeta = Normalize-SilverPathForCompare -Path $actualOutput
      $nOutWant = Normalize-SilverPathForCompare -Path $ExpectedOutputFile
      if (($nOutMeta.Length -gt 0) -and ($nOutWant.Length -gt 0) -and ($nOutMeta -ne $nOutWant)) {
        [void]$reasons.Add("output_file_path_mismatch")
      }
    }
    else {
      [void]$reasons.Add("missing_output_file_in_meta")
    }
  }

  $exact = if ($reasons.Count -gt 0) { [string]::Join("|", $reasons) } else { "(none)" }
  return @{
    expected_task_file          = $ExpectedTaskFile
    actual_meta_task_file       = $actualTask
    expected_output_file        = $ExpectedOutputFile
    actual_meta_output_file     = $actualOutput
    expected_run_id             = $ExpectedRunId
    actual_meta_run_id          = $actualRun
    meta_timestamp              = $metaTs
    output_timestamp            = $outTs
    stale_by_seconds            = $staleSec
    exact_mismatch_reason       = $exact
    cycle_scoped_ok             = $(if ($reasons.Count -eq 0) { "YES" } else { "NO" })
    adapter_output_state        = $state
  }
}

function Test-SilverAdapterMetaCycleScoped {
  param(
    [hashtable]$Meta,
    [datetime]$ProcessStartUtc,
    [string]$AdapterOutputPath,
    [string]$ExpectedTaskDigest = "",
    [string]$ExpectedTaskFile = "",
    [string]$ExpectedOutputFile = "",
    [string]$ExpectedRunId = "",
    [string]$ExpectedCycle = "",
    [string]$ExpectedRunStartUtc = ""
  )
  $diag = Get-SilverAdapterMetaMismatchDiagnostics -Meta $Meta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedOutputFile $ExpectedOutputFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc
  return ($diag.cycle_scoped_ok -eq "YES")
}

function Test-SilverAdapterMetaReconcileEligible {
  param(
    [hashtable]$Meta,
    [datetime]$ProcessStartUtc,
    [string]$AdapterOutputPath,
    [string]$ExpectedTaskDigest = "",
    [string]$ExpectedTaskFile = "",
    [string]$ExpectedOutputFile = "",
    [string]$ExpectedRunId = "",
    [string]$ExpectedCycle = "",
    [string]$ExpectedRunStartUtc = ""
  )
  if (-not (Test-SilverAdapterMetaCycleScoped -Meta $Meta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedOutputFile $ExpectedOutputFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc)) {
    return $false
  }
  $state = ""
  if ($Meta.ContainsKey("adapter_output_state")) { $state = [string]$Meta["adapter_output_state"] }
  if ($state -ne "COMPLETED") { return $false }
  $completionPath = ""
  if ($Meta.ContainsKey("adapter_completion_path")) { $completionPath = [string]$Meta["adapter_completion_path"] }
  $to = ""
  if ($Meta.ContainsKey("timed_out")) { $to = [string]$Meta["timed_out"] }
  if ($to -eq "YES") {
    $allowTimeoutReconcile = $false
    if ($completionPath -match 'outer_wall_timeout_terminal|terminal_emergency_write') {
      $allowTimeoutReconcile = $true
    }
    if (-not $allowTimeoutReconcile) { return $false }
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
    [string]$ExpectedOutputFile = "",
    [string]$ExpectedRunId = "",
    [string]$ExpectedCycle = "",
    [string]$ExpectedRunStartUtc = ""
  )
  if (-not (Test-SilverAdapterMetaCycleScoped -Meta $Meta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedOutputFile $ExpectedOutputFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc)) {
    return $false
  }
  $state = ""
  if ($Meta.ContainsKey("adapter_output_state")) { $state = [string]$Meta["adapter_output_state"] }
  if ($state -ne "COMPLETED") { return $false }
  $to = ""
  $sen = ""
  if ($Meta.ContainsKey("timed_out")) { $to = [string]$Meta["timed_out"] }
  if ($Meta.ContainsKey("stderr_nonempty")) { $sen = [string]$Meta["stderr_nonempty"] }
  $completionPath = ""
  if ($Meta.ContainsKey("adapter_completion_path")) { $completionPath = [string]$Meta["adapter_completion_path"] }
  if ($to -eq "YES") {
    if ($completionPath -notmatch 'outer_wall_timeout_terminal|terminal_emergency_write') {
      return $false
    }
  }
  if ($sen -eq "YES") { return $false }
  return $true
}

function Wait-SilverAdapterMetaReadyForReconcile {
  param(
    [string]$AdapterOutputPath,
    [datetime]$ProcessStartUtc,
    [string]$ExpectedTaskDigest = "",
    [string]$ExpectedTaskFile = "",
    [string]$ExpectedOutputFile = "",
    [string]$ExpectedRunId = "",
    [string]$ExpectedCycle = "",
    [string]$ExpectedRunStartUtc = "",
    [int]$MaxAttempts = 30,
    [int]$SleepMilliseconds = 200
  )
  $lastMeta = @{}
  for ($attempt = 0; $attempt -lt $MaxAttempts; $attempt++) {
    if (-not (Test-Path -LiteralPath $AdapterOutputPath)) {
      if ($attempt -lt ($MaxAttempts - 1)) {
        Start-Sleep -Milliseconds $SleepMilliseconds
        continue
      }
      return @{ Meta = $lastMeta; ReconcileEligible = $false; Attempts = ($attempt + 1) }
    }
    $lastMeta = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $AdapterOutputPath
    if ($lastMeta.Count -eq 0) {
      if ($attempt -lt ($MaxAttempts - 1)) {
        Start-Sleep -Milliseconds $SleepMilliseconds
        continue
      }
      return @{ Meta = $lastMeta; ReconcileEligible = $false; Attempts = ($attempt + 1) }
    }
    $stateWait = ""
    if ($lastMeta.ContainsKey("adapter_output_state")) { $stateWait = [string]$lastMeta["adapter_output_state"] }
    if ($stateWait -eq "INVALIDATED_AWAITING_CYCLE") {
      if ($attempt -lt ($MaxAttempts - 1)) {
        Start-Sleep -Milliseconds $SleepMilliseconds
        continue
      }
      return @{ Meta = $lastMeta; ReconcileEligible = $false; Attempts = ($attempt + 1) }
    }
    if ($stateWait -eq "INVOKE_STARTED") {
      if ($attempt -lt ($MaxAttempts - 1)) {
        Start-Sleep -Milliseconds $SleepMilliseconds
        continue
      }
      return @{ Meta = $lastMeta; ReconcileEligible = $false; Attempts = ($attempt + 1) }
    }
    $eligible = Test-SilverAdapterMetaReconcileEligible -Meta $lastMeta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedOutputFile $ExpectedOutputFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc
    if ($eligible) {
      return @{ Meta = $lastMeta; ReconcileEligible = $true; Attempts = ($attempt + 1) }
    }
    $scoped = Test-SilverAdapterMetaCycleScoped -Meta $lastMeta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedOutputFile $ExpectedOutputFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc
    if ($scoped) {
      return @{ Meta = $lastMeta; ReconcileEligible = $false; Attempts = ($attempt + 1) }
    }
    if ($attempt -lt ($MaxAttempts - 1)) {
      Start-Sleep -Milliseconds $SleepMilliseconds
    }
  }
  return @{ Meta = $lastMeta; ReconcileEligible = $false; Attempts = $MaxAttempts }
}

function Write-SilverAdapterMetaMismatchDiagnosticBlock {
  param([hashtable]$Diag)
  if ($null -eq $Diag) { return }
  Write-Host ("adapter_meta_diag_expected_task_file=" + [string]$Diag.expected_task_file) -ForegroundColor DarkYellow
  Write-Host ("adapter_meta_diag_actual_meta_task_file=" + [string]$Diag.actual_meta_task_file) -ForegroundColor DarkYellow
  Write-Host ("adapter_meta_diag_expected_output_file=" + [string]$Diag.expected_output_file) -ForegroundColor DarkYellow
  Write-Host ("adapter_meta_diag_actual_meta_output_file=" + [string]$Diag.actual_meta_output_file) -ForegroundColor DarkYellow
  Write-Host ("adapter_meta_diag_expected_run_id=" + [string]$Diag.expected_run_id) -ForegroundColor DarkYellow
  Write-Host ("adapter_meta_diag_actual_meta_run_id=" + [string]$Diag.actual_meta_run_id) -ForegroundColor DarkYellow
  Write-Host ("adapter_meta_diag_meta_timestamp=" + [string]$Diag.meta_timestamp) -ForegroundColor DarkYellow
  Write-Host ("adapter_meta_diag_output_timestamp=" + [string]$Diag.output_timestamp) -ForegroundColor DarkYellow
  Write-Host ("adapter_meta_diag_stale_by_seconds=" + [string]$Diag.stale_by_seconds) -ForegroundColor DarkYellow
  Write-Host ("adapter_meta_diag_exact_mismatch_reason=" + [string]$Diag.exact_mismatch_reason) -ForegroundColor DarkYellow
}

function Test-SilverAutonomousAdapterCompletionBoundary {
  param(
    [string]$AdapterOutputPath,
    [datetime]$ProcessStartUtc,
    [string]$ExpectedTaskDigest = "",
    [string]$ExpectedTaskFile = "",
    [string]$ExpectedOutputFile = "",
    [string]$ExpectedRunId = "",
    [string]$ExpectedCycle = "",
    [string]$ExpectedRunStartUtc = ""
  )
  $result = @{
    PASS_FAIL                   = "FAIL"
    adapter_output_valid        = "NO"
    adapter_meta_fresh          = "NO"
    adapter_output_state        = "(empty)"
    lifecycle_block_reason      = "missing_output_file"
    invalidated_awaiting_cycle  = "NO"
  }
  if (-not (Test-Path -LiteralPath $AdapterOutputPath)) {
    $result.lifecycle_block_reason = "missing_output_file"
    return $result
  }
  $meta = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $AdapterOutputPath
  $state = ""
  if ($meta.ContainsKey("adapter_output_state")) { $state = [string]$meta["adapter_output_state"] }
  if ($state) { $result.adapter_output_state = $state }
  if ($state -eq "INVALIDATED_AWAITING_CYCLE") {
    $result.invalidated_awaiting_cycle = "YES"
    $result.lifecycle_block_reason = "invalidated_awaiting_cycle_non_authoritative"
    return $result
  }
  if ($state -eq "INVOKE_STARTED") {
    $result.lifecycle_block_reason = "adapter_invoke_started_but_not_completed"
    return $result
  }
  if ($state -ne "COMPLETED") {
    $result.lifecycle_block_reason = "adapter_output_state_not_completed:" + $(if ($state) { $state } else { "(empty)" })
    return $result
  }
  if (-not (Test-SilverCursorOutputHandoffValid -Path $AdapterOutputPath)) {
    $result.lifecycle_block_reason = "cursor_output_handoff_invalid_or_empty"
    return $result
  }
  $metaFresh = Test-SilverAdapterMetaFreshForCycle -Meta $meta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedOutputFile $ExpectedOutputFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc
  if (-not $metaFresh) {
    $result.adapter_meta_fresh = "NO"
    $result.lifecycle_block_reason = "adapter_meta_not_fresh_for_cycle"
    $diagBoundary = Get-SilverAdapterMetaMismatchDiagnostics -Meta $meta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedOutputFile $ExpectedOutputFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc
    if ($diagBoundary.exact_mismatch_reason -and ([string]$diagBoundary.exact_mismatch_reason -ne "(none)")) {
      $result.lifecycle_block_reason = "adapter_meta_not_fresh_for_cycle:" + [string]$diagBoundary.exact_mismatch_reason
    }
    return $result
  }
  $procStart = ""
  if ($meta.ContainsKey("process_start_utc")) { $procStart = [string]$meta["process_start_utc"] }
  if ($procStart.Trim().Length -eq 0) {
    $result.lifecycle_block_reason = "missing_process_start_utc"
    return $result
  }
  $exitPresent = ""
  if ($meta.ContainsKey("exit_code")) { $exitPresent = [string]$meta["exit_code"] }
  if ($exitPresent.Trim().Length -eq 0) {
    $result.lifecycle_block_reason = "missing_exit_code"
    return $result
  }
  $digest = ""
  if ($meta.ContainsKey("task_digest")) { $digest = [string]$meta["task_digest"] }
  if ($digest.Trim().Length -eq 0) {
    $result.lifecycle_block_reason = "missing_task_digest"
    return $result
  }
  $result.adapter_meta_fresh = "YES"
  $result.adapter_output_valid = "YES"
  $result.PASS_FAIL = "PASS"
  $result.lifecycle_block_reason = "(none)"
  return $result
}

function Resolve-SilverCursorOuterExitFromAdapterMeta {
  param(
    [int]$OuterExit,
    [string]$AdapterOutputPath,
    [datetime]$ProcessStartUtc,
    [string]$ExpectedTaskDigest = "",
    [string]$ExpectedTaskFile = "",
    [string]$ExpectedOutputFile = "",
    [string]$ExpectedRunId = "",
    [string]$ExpectedCycle = "",
    [string]$ExpectedRunStartUtc = ""
  )
  $emptyDiag = @{
    expected_task_file = $ExpectedTaskFile
    expected_output_file = $ExpectedOutputFile
    expected_run_id = $ExpectedRunId
    exact_mismatch_reason = "missing_output_file_on_disk"
    cycle_scoped_ok = "NO"
  }
  if ($OuterExit -eq 0) {
    if ($ExpectedRunId.Trim().Length -gt 0) {
      if (-not (Test-Path -LiteralPath $AdapterOutputPath)) {
        return @{ EffectiveExit = 0; Reconciled = $false; FreshMeta = $false; MismatchDiagnostics = $emptyDiag }
      }
      $metaZero = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $AdapterOutputPath
      $diagZero = Get-SilverAdapterMetaMismatchDiagnostics -Meta $metaZero -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedOutputFile $ExpectedOutputFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc
      $reconcileZero = Test-SilverAdapterMetaReconcileEligible -Meta $metaZero -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedOutputFile $ExpectedOutputFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc
      $freshZero = Test-SilverAdapterMetaFreshForCycle -Meta $metaZero -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedOutputFile $ExpectedOutputFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc
      if (-not $reconcileZero) {
        return @{ EffectiveExit = 0; Reconciled = $false; FreshMeta = $false; MismatchDiagnostics = $diagZero }
      }
      return @{ EffectiveExit = 0; Reconciled = $false; FreshMeta = $(if ($freshZero) { $true } else { $false }); MismatchDiagnostics = $diagZero }
    }
    return @{ EffectiveExit = 0; Reconciled = $false; FreshMeta = $false; MismatchDiagnostics = $emptyDiag }
  }
  if (-not (Test-Path -LiteralPath $AdapterOutputPath)) {
    return @{ EffectiveExit = $OuterExit; Reconciled = $false; FreshMeta = $false; MismatchDiagnostics = $emptyDiag }
  }
  $meta = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $AdapterOutputPath
  $diag = Get-SilverAdapterMetaMismatchDiagnostics -Meta $meta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedOutputFile $ExpectedOutputFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc
  if (-not (Test-SilverAdapterMetaReconcileEligible -Meta $meta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedOutputFile $ExpectedOutputFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc)) {
    return @{ EffectiveExit = $OuterExit; Reconciled = $false; FreshMeta = $false; MismatchDiagnostics = $diag }
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
    return @{ EffectiveExit = 0; Reconciled = $true; FreshMeta = $true; MismatchDiagnostics = $diag }
  }
  $completionPathEligible = ""
  if ($meta.ContainsKey("adapter_completion_path")) { $completionPathEligible = [string]$meta["adapter_completion_path"] }
  if ($completionPathEligible -match 'outer_wall_timeout_terminal|terminal_emergency_write') {
    $freshTerminal = Test-SilverAdapterMetaFreshForCycle -Meta $meta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedOutputFile $ExpectedOutputFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc
    return @{ EffectiveExit = $OuterExit; Reconciled = $false; FreshMeta = $freshTerminal; MismatchDiagnostics = $diag; TerminalCompletion = $true }
  }
  if (($shellNoise -eq "YES") -and ($meta.ContainsKey("stdout_nonempty")) -and ([string]$meta["stdout_nonempty"] -eq "YES")) {
    $to = ""
    if ($meta.ContainsKey("timed_out")) { $to = [string]$meta["timed_out"] }
    $completionPath = ""
    if ($meta.ContainsKey("adapter_completion_path")) { $completionPath = [string]$meta["adapter_completion_path"] }
    if ($to -ne "YES") {
      return @{ EffectiveExit = 0; Reconciled = $true; FreshMeta = $true; MismatchDiagnostics = $diag }
    }
    if ($completionPath -match 'outer_wall_timeout_terminal|terminal_emergency_write') {
      return @{ EffectiveExit = 0; Reconciled = $true; FreshMeta = $true; MismatchDiagnostics = $diag }
    }
  }
  $freshMeta = Test-SilverAdapterMetaFreshForCycle -Meta $meta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedOutputFile $ExpectedOutputFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc
  return @{ EffectiveExit = $OuterExit; Reconciled = $false; FreshMeta = $freshMeta; MismatchDiagnostics = $diag }
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
  return ($Text -match '(?i)PRODUCT_CLUSTER|NEXT PRODUCT CLUSTER|silver-rhc3|(?:node|npx)\s+scripts/silver-|cluster diagnostic|harness|audit_silver|SILVER_PRODUCT_CLUSTER|top_cluster=|rcz2_ultra_short_chaos|Public UX|public.ux')
}

function Test-SilverNextActionIsOrchestrationMaintenanceOnly {
  param([string]$Text)
  if (-not $Text) { return $false }
  if (Test-SilverNextActionSilverWorkflowContext -Text $Text) { return $false }
  $gitGhLead =
    ($Text -match '(?i)\bgit\s+status\b') -or
    ($Text -match '(?i)\bgit\s+push\s+-u\b') -or
    ($Text -match '(?i)\bgh\s+auth\b') -or
    ($Text -match '(?i)chore/silver-audit-repo-state')
  if (-not $gitGhLead) { return $false }
  $productHarness =
    ($Text -match '(?i)PRODUCT_CLUSTER|rcz2_ultra_short_chaos|NEXT PRODUCT CLUSTER') -and
    ($Text -match '(?i)(?:node|npx)\s+scripts/silver-(?:real-czech-public|rhc3-cluster|audit_silver|rcz2|real-human-chaos)')
  if ($productHarness) { return $false }
  return $true
}

function Get-SilverAuthoritativeSelectorCluster {
  param([string]$RepoRoot)
  $registryScript = Join-Path $RepoRoot "scripts\silver-audit-registry.cjs"
  if (-not (Test-Path -LiteralPath $registryScript)) { return "" }
  $registryRequirePath = ($registryScript -replace '\\', '/')
  if ($registryRequirePath.IndexOf("'") -ge 0) {
    $registryRequirePath = $registryRequirePath.Replace("'", "\'")
  }
  $lockRequirePath = (Join-Path $RepoRoot "scripts\silver-cluster-consistency-lock.cjs") -replace '\\', '/'
  if ($lockRequirePath.IndexOf("'") -ge 0) {
    $lockRequirePath = $lockRequirePath.Replace("'", "\'")
  }
  $probe = @"
const lock=require('$lockRequirePath');
process.stdout.write(lock.resolveAuthoritativeSelectorCluster(process.cwd(),''));
"@
  $probePath = Join-Path $env:TEMP ("silver-selector-cluster-probe-" + [guid]::NewGuid().ToString("N") + ".cjs")
  try {
    [System.IO.File]::WriteAllText($probePath, $probe, [System.Text.UTF8Encoding]::new($false))
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node"
    $psi.Arguments = ('"' + $probePath.Replace('"', '""') + '"')
    $psi.WorkingDirectory = $RepoRoot
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $stdout = $p.StandardOutput.ReadToEnd().Trim()
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) { return "" }
    return $stdout
  }
  catch {
    return ""
  }
  finally {
    if (Test-Path -LiteralPath $probePath) {
      Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
    }
  }
}

function Invoke-SilverOrchestrationProductHandoffBridge {
  param(
    [string]$RepoRoot,
    [string]$AutopilotScript
  )
  try {
    $bridge = Invoke-NodeScript -WorkingDirectory $RepoRoot -Arguments @($AutopilotScript, "--sanitize-next-action-md") -PassThruExit $true
    if (($null -ne $bridge) -and ($bridge.ExitCode -eq 0)) {
      Write-Host "silver-autopilot-loop: orchestration_product_handoff_bridge_sanitize=OK" -ForegroundColor DarkCyan
      return $true
    }
    Write-Host ("silver-autopilot-loop: orchestration_product_handoff_bridge_sanitize_exit=" + [string]$bridge.ExitCode) -ForegroundColor DarkYellow
  }
  catch {
    Write-Host "silver-autopilot-loop: orchestration_product_handoff_bridge_invoke_failed" -ForegroundColor DarkYellow
  }
  return $false
}

function Get-SilverHandoffClusterFromNextActionText {
  param([string]$Text)
  $t = [string]$Text
  if (-not $t) { return "" }
  if ($t -match '(?i)audit_registry_next_cluster=([^\s\r\n;]+)') { return ([string]$Matches[1]).Trim() }
  if ($t -match '(?i)target_cluster=([^\s\r\n;]+)') {
    $c = ([string]$Matches[1]).Trim()
    if ($c -and $c -ne '(none)' -and $c -ne '(unknown)') { return $c }
  }
  if ($t -match '(?i)recommended_next_task=cap_diagnostic_product_handoff:([^;\s\r\n]+)') { return ([string]$Matches[1]).Trim() }
  if ($t -match '(?i)SILVER_NEXT_ACTION_PLANNER_ENFORCE=cap_diagnostic_product_handoff\s+cluster=([^\s\r\n]+)') { return ([string]$Matches[1]).Trim() }
  if ($t -match '(?i)top_cluster=([^\s\r\n;]+)') { return ([string]$Matches[1]).Trim() }
  return ""
}

function Invoke-SilverProductHandoffContinuationEval {
  param(
    [string]$RepoRoot,
    [string]$AutopilotScript,
    [string]$NextActionText = "",
    [string]$CursorOutputPath = "",
    [string]$RunReportPath = "",
    [string]$SafetyCounters = "",
    [string]$AuthoritativeCluster = "",
    [string]$ControlledCapProfile = ""
  )
  $args = @($AutopilotScript, "--product-handoff-continuation-eval")
  if ($NextActionText) { $args += ("--next-action-text=" + $NextActionText) }
  if ($CursorOutputPath -and (Test-Path -LiteralPath $CursorOutputPath)) {
    $args += ("--cursor-output-file=" + $CursorOutputPath)
  }
  if ($RunReportPath -and (Test-Path -LiteralPath $RunReportPath)) {
    $args += ("--run-report-file=" + $RunReportPath)
  }
  if ($AuthoritativeCluster) { $args += ("--authoritative-cluster=" + $AuthoritativeCluster) }
  if ($ControlledCapProfile) { $args += ("--controlled-cap-profile=" + $ControlledCapProfile) }
  $r = Invoke-NodeScript -WorkingDirectory $RepoRoot -Arguments $args -PassThruExit $true
  $out = @{
    PASS_FAIL = "FAIL"
    continuation_ready = "NO"
    product_task_handoff_missing = "YES"
    continuation_kind = ""
    selector_cluster = ""
    expected_outcome = ""
    reason = ""
    forbidden_generic = "NO"
    stdout = ""
  }
  if ($null -ne $r) {
    $out.stdout = [string]$r.StdOut
    if ($r.ExitCode -eq 0) { $out.PASS_FAIL = "PASS" }
  }
  $txt = [string]$out.stdout
  foreach ($line in ($txt -split "`r?`n")) {
    $trim = $line.Trim()
    if ($trim -match '^continuation_ready=(.+)$') { $out.continuation_ready = $Matches[1] }
    if ($trim -match '^product_task_handoff_missing=(.+)$') { $out.product_task_handoff_missing = $Matches[1] }
    if ($trim -match '^continuation_kind=(.+)$') { $out.continuation_kind = $Matches[1] }
    if ($trim -match '^selector_cluster=(.+)$') { $out.selector_cluster = $Matches[1] }
    if ($trim -match '^expected_outcome=(.+)$') { $out.expected_outcome = $Matches[1] }
    if ($trim -match '^reason=(.+)$') { $out.reason = $Matches[1] }
    if ($trim -match '^forbidden_generic=(.+)$') { $out.forbidden_generic = $Matches[1] }
    if ($trim -match '^PASS_FAIL=(.+)$') { $out.PASS_FAIL = $Matches[1] }
  }
  return $out
}

function Test-SilverNextActionIsProductTaskHandoff {
  param(
    [string]$NextActionText,
    [string]$SelectorCluster
  )
  $cluster = ([string]$SelectorCluster).Trim()
  if (-not $cluster) {
    $cluster = Get-SilverHandoffClusterFromNextActionText -Text $NextActionText
  }
  if (Test-SilverNextActionIsOrchestrationMaintenanceOnly -Text $NextActionText) { return $false }
  if (-not $cluster) { return $false }
  if ($cluster -eq "rcz2_retrieval") { return $true }
  $clusterPat = [regex]::Escape($cluster)
  $hasExplicitProduct =
    ($NextActionText -match $clusterPat) -or
    ($NextActionText -match '(?i)PRODUCT_HANDOFF_CONTRACT') -or
    ($NextActionText -match '(?i)target_cluster=') -or
    ($NextActionText -match '(?i)expected_outcome=(?:ENGINE_FIX_TASK_READY|HARNESS_ALIGNMENT_TASK_READY|PLANNER_ALIGNMENT_TASK_READY|NO_SAFE_FIX|SAFE_BLOCKED|NEED_HUMAN_INPUT)') -or
    ($NextActionText -match '(?i)PRODUCT_CLUSTER|NEXT PRODUCT CLUSTER|(?:node|npx)\s+scripts/silver-real-czech-public-ux|(?:node|npx)\s+scripts/silver-rhc3-cluster-classifier|audit_silver_')
  if ($cluster -eq "self_correction_negation_flip") {
    if ($NextActionText -match '(?i)silver-self-correction-audit|silver-self-correction-safety-diagnostic|self_correction_negation_flip') {
      $hasExplicitProduct = $true
    }
  }
  if ($cluster -eq "self_correction_safety_note_readonly") {
    if ($NextActionText -match '(?i)silver-self-correction-audit|silver-self-correction-safety-note-readonly|self_correction_safety_note_readonly') {
      $hasExplicitProduct = $true
    }
  }
  if ($cluster -eq "self_correction_update_note") {
    if ($NextActionText -match '(?i)silver-self-correction|self_correction_update_note|HARNESS_ALIGNMENT_TASK_READY|cap_diagnostic_product_handoff') {
      $hasExplicitProduct = $true
    }
  }
  if (-not $hasExplicitProduct) {
    if ($NextActionText -match '(?i)expected_outcome=HARNESS_ALIGNMENT_TASK_READY') { $hasExplicitProduct = $true }
    if ($NextActionText -match '(?i)recommended_next_task=cap_diagnostic_product_handoff:') { $hasExplicitProduct = $true }
  }
  if (-not $hasExplicitProduct) { return $false }
  return $true
}

function Invoke-SilverEnsureRegistryClusterProductHandoff {
  param(
    [string]$RepoRoot,
    [string]$AutopilotScript
  )
  $selectorCluster = Get-SilverAuthoritativeSelectorCluster -RepoRoot $RepoRoot
  $nextPath = Join-Path $RepoRoot "SILVER_NEXT_ACTION.md"
  $nextText = Read-TextFileOrEmpty -Path $nextPath
  if (-not $selectorCluster) {
    if (Test-SilverNextActionIsOrchestrationMaintenanceOnly -Text $nextText) {
      $null = Invoke-SilverOrchestrationProductHandoffBridge -RepoRoot $RepoRoot -AutopilotScript $AutopilotScript
      $nextText = Read-TextFileOrEmpty -Path $nextPath
      return (-not (Test-SilverNextActionIsOrchestrationMaintenanceOnly -Text $nextText))
    }
    return $true
  }
  if (Test-SilverNextActionIsProductTaskHandoff -NextActionText $nextText -SelectorCluster $selectorCluster) {
    return $true
  }
  $null = Invoke-SilverOrchestrationProductHandoffBridge -RepoRoot $RepoRoot -AutopilotScript $AutopilotScript
  $nextText = Read-TextFileOrEmpty -Path $nextPath
  return (Test-SilverNextActionIsProductTaskHandoff -NextActionText $nextText -SelectorCluster $selectorCluster)
}

function Test-SilverAutonomousCycleHadProductAdvance {
  param(
    [string]$ReportText,
    [string]$NextActionText
  )
  $engineCh = Get-RunReportLineValue -ReportText $ReportText -Key "engine_changed"
  $assetsCh = Get-RunReportLineValue -ReportText $ReportText -Key "assets_app_changed"
  if ($engineCh -eq "YES" -or $assetsCh -eq "YES") { return $true }
  $prUrl = Get-RunReportLineValue -ReportText $ReportText -Key "pr_url"
  if ($prUrl -and $prUrl -match 'https?://') { return $true }
  $openPr = Get-RunReportLineValue -ReportText $ReportText -Key "open_pr"
  if ($openPr -and $openPr -match 'https?://github\.com/[^/]+/[^/]+/pull/\d+') { return $true }
  if ($NextActionText -match '(?i)===\s*SILVER_PRODUCT_CLUSTER_DIAGNOSTIC_RESULT\s*===') {
    if ($NextActionText -match '(?i)PASS_FAIL=PASS') { return $true }
  }
  return $false
}

function Invoke-SilverAutonomousProductOutcomeMidCycleGate {
  param(
    [string]$RepoRoot,
    [string]$ProgressLogPath,
    [int]$Cycle,
    [string]$MainCommit,
    [string]$ReportText,
    [string]$NextActionText,
    [string]$SelectorCluster,
    [string]$CursorExit,
    [string]$AutopilotExit,
    [string]$StatusExit,
    [string]$SafetyLine,
    [string]$GitClean,
    [switch]$NoBeep
  )
  if (Test-SilverAutonomousCycleHadProductAdvance -ReportText $ReportText -NextActionText $NextActionText) {
    $script:AutonomousOrchestrationOnlyStreak = 0
    return $true
  }
  $script:AutonomousOrchestrationOnlyStreak++
  if ($SelectorCluster -and -not (Test-SilverNextActionIsProductTaskHandoff -NextActionText $NextActionText -SelectorCluster $SelectorCluster)) {
    Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $Cycle -MainCommit $MainCommit `
      -CursorExit $CursorExit -AutopilotExit $AutopilotExit -StatusExit $StatusExit `
      -GitClean $GitClean -SafetyLine $SafetyLine -CalW "" -CalQ "" `
      -Headline (Get-NextActionHeadline -Text $NextActionText) -Focus "product_handoff_not_cluster_specific" `
      -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1 `
      -StopReason ("PRODUCT_HANDOFF_NOT_CLUSTER_SPECIFIC|selector_cluster=" + [string]$SelectorCluster + "|cycle=" + [string]$Cycle)
    return $false
  }
  if ($script:AutonomousOrchestrationOnlyStreak -ge 2) {
    Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $Cycle -MainCommit $MainCommit `
      -CursorExit $CursorExit -AutopilotExit $AutopilotExit -StatusExit $StatusExit `
      -GitClean $GitClean -SafetyLine $SafetyLine -CalW "" -CalQ "" `
      -Headline (Get-NextActionHeadline -Text $NextActionText) -Focus "product_outcome_not_advancing" `
      -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1 `
      -StopReason ("PRODUCT_OUTCOME_NOT_ADVANCING|orchestration_only_streak=" + [string]$script:AutonomousOrchestrationOnlyStreak + "|selector_cluster=" + [string]$SelectorCluster)
    return $false
  }
  return $true
}

function Get-SilverNextActionQualityForbiddenLineSample {
  param(
    [string]$Text,
    [string[]]$Reasons
  )
  if (-not $Text -or -not $Reasons -or $Reasons.Count -eq 0) { return "" }
  $lines = $Text -split "`r?`n"
  foreach ($raw in $lines) {
    $line = ([string]$raw).Trim()
    if (-not $line) { continue }
    if ($line.StartsWith("<!--")) { continue }
    foreach ($reason in $Reasons) {
      $r = [string]$reason
      if ($r -eq "mojibake_utf8" -and (Test-SilverUtf8MojibakeMarkers -Text $line)) {
        return $line
      }
      if ($r -eq "orchestration_maintenance_only") {
        if ($line -match '(?i)\bgit\s+push\s+-u\b') { return $line }
        if ($line -match '(?i)\bgh\s+auth\b') { return $line }
        if ($line -match '(?i)chore/silver-audit-repo-state') { return $line }
      }
      if ($r -eq "bare_silver_autopilot_node_use_status_subcommand" -and ($line -match '(?i)\bnode(?:\.exe)?\s+.*silver-autopilot\.cjs\b')) {
        if ($line -notmatch '(?i)silver-autopilot\.cjs\s+--') { return $line }
      }
      if ($r -eq "cat_windows_path" -and (Test-NextActionLineLooksLikeRunnableCatWindows -Line $line)) {
        return $line
      }
      if ($r -match '^generic_' -and $line -match '(?i)git\s+push\s+-u|gh\s+auth|verify-pr|sudo\s+apt') {
        return $line
      }
      if ($r -match '^banned_node_invocation' -and $line -match '(?i)\bnode\s+scripts/') {
        return $line
      }
    }
  }
  return ""
}

function Get-SilverNextActionQualityFailureDetail {
  param([string]$Text)
  $reasons = New-Object System.Collections.Generic.List[string]
  if (-not $Text) { return @() }
  if (Test-SilverUtf8MojibakeMarkers -Text $Text) {
    [void]$reasons.Add("mojibake_utf8")
  }
  if (Test-SilverNextActionIsOrchestrationMaintenanceOnly -Text $Text) {
    [void]$reasons.Add("orchestration_maintenance_only")
    [void]$reasons.Add("generic_repo_git_workflow_drift")
  }
  if ($Text -match '(?i)\bgit\s+stash\b' -and $Text -match '(?i)\bgit\s+status\b' -and -not (Test-SilverNextActionSilverWorkflowContext -Text $Text)) {
    [void]$reasons.Add("generic_repo_git_workflow_drift")
  }
  if ($Text -match '(?i)PRODUCT_HANDOFF_CONTRACT' -and (Test-SilverNextActionIsOrchestrationMaintenanceOnly -Text $Text)) {
    [void]$reasons.Add("generic_orchestration_blocked_after_cap_diagnostic")
  }
  $hasCluster = Test-SilverNextActionSilverWorkflowContext -Text $Text
  if ($Text -match '(?i)git\s+push\s+-u\s+origin') {
    if (-not $hasCluster) { [void]$reasons.Add("generic_git_push_upstream") }
  }
  if ($Text -match 'chore/silver-audit-repo-state') {
    if (-not $hasCluster) { [void]$reasons.Add("generic_chore_silver_audit_push") }
  }
  if ($Text -match '(?i)(?:--verify-pr=\d+|\bverify-pr\b)') {
    if (-not $hasCluster) { [void]$reasons.Add("generic_verify_pr_not_cluster_workflow") }
  }
  if ($Text -match '(?i)(?:sudo\s+apt\s+(?:update|install)|gh\s+auth\s+login)') {
    if (-not $hasCluster) { [void]$reasons.Add("generic_gh_sudo_not_cluster_workflow") }
  }
  if ($Text -match '(?i)--verify-pr=3794\b') {
    [void]$reasons.Add("generic_stale_verify_pr_id:3794")
  }
  if ($Text -match '(?i)full-auto-loop-openai' -and $Text -match '(?i)(?:sudo\s+apt|gh\s+auth|verify-pr)') {
    if (-not $hasCluster) { [void]$reasons.Add("generic_full_auto_infra_not_cluster_workflow") }
  }
  if (-not $hasCluster) {
    if ($Text -match '(?i)(?:sudo\s+apt|gh\s+auth|verify-pr|git\s+push\s+-u)') {
      if ($Text -notmatch '(?i)INFRA_BLOCKER_REASON:\s*\S+') {
        [void]$reasons.Add("generic_infra_without_blocker_reason")
      }
    }
  }
  if (Test-NextActionHasBareSilverAutopilotNodeInvocation -Inner $Text) {
    [void]$reasons.Add("bare_silver_autopilot_node_use_status_subcommand")
  }
  if ($Text -match '(?i)\bnode\s+scripts/silver-diagnostic\.js\b') {
    [void]$reasons.Add("banned_hallucination:silver-diagnostic.js")
  }
  if ($Text -match '(?i)\bnode\s+scripts/silver-smoke-test-maxcycles-1\.js\b') {
    [void]$reasons.Add("banned_hallucination:silver-smoke-test-maxcycles-1.js")
  }
  if (Test-NextActionHasRunnableCatWindowsInvocation -Inner $Text) {
    [void]$reasons.Add("cat_windows_path")
  }
  return @($reasons.ToArray())
}

function Test-SilverNextActionOutputQuality {
  param([string]$Text)
  if (-not $Text) { return $true }
  return (@(Get-SilverNextActionQualityFailureDetail -Text $Text).Count -eq 0)
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
    [string]$ExpectedOutputFile = "",
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
    $metaCycleScoped = Test-SilverAdapterMetaCycleScoped -Meta $meta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedOutputFile $ExpectedOutputFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc
    $metaFresh = Test-SilverAdapterMetaFreshForCycle -Meta $meta -ProcessStartUtc $ProcessStartUtc -AdapterOutputPath $AdapterOutputPath -ExpectedTaskDigest $ExpectedTaskDigest -ExpectedTaskFile $ExpectedTaskFile -ExpectedOutputFile $ExpectedOutputFile -ExpectedRunId $ExpectedRunId -ExpectedCycle $ExpectedCycle -ExpectedRunStartUtc $ExpectedRunStartUtc
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
    "timeout_artifacts_archived",
    "closeout_kind",
    "failure_class",
    "blocked_dirty_classification",
    "restored_runtime_files",
    "remaining_forbidden_dirty_files",
    "runtime_artifacts_archived",
    "runtime_artifacts_restored",
    "git_status_clean_after_closeout",
    "progress_log_written_to_archive"
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
  if ($Fields.ContainsKey("closeout_kind") -and [string]$Fields["closeout_kind"]) {
    Write-Host ("closeout_kind=" + [string]$Fields["closeout_kind"]) -ForegroundColor Cyan
  }
  if ($Fields.ContainsKey("git_status_clean_after_closeout") -and [string]$Fields["git_status_clean_after_closeout"]) {
    Write-Host ("git_status_clean_after_closeout=" + [string]$Fields["git_status_clean_after_closeout"]) -ForegroundColor Cyan
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
  $skipRepoProgressLogWrite = $false
  Write-Host ("SILVER_LOOP_SAFETY_STOP reason=" + $reasonLine) -ForegroundColor Red
  $isRuntimeFailureStop = Test-SilverCap50StopReasonIsRuntimeFailure -StopReason $StopReason -Focus $Focus
  if ($isRuntimeFailureStop -and ($DryRunText -ne "YES")) {
    $staleStop = $StopReason
    if ([string]::IsNullOrWhiteSpace($staleStop)) { $staleStop = $Focus }
    $null = Invoke-SilverStaleCursorInvokeRuntimeFinalize -RepoRoot $RepoRoot -StopReason $staleStop
  }
  $baselines = if ($isRuntimeFailureStop) { Get-SilverRuntimeFailureProgressMetrics } else { Get-BaselineProgressMetrics }
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
  if ($isTimeoutStop) {
    $fields["closeout_kind"] = "adapter_timeout"
    $timeoutCloseout = Invoke-SilverCap50AdapterTimeoutCloseout -RepoRoot $RepoRoot -Reason $reasonLine -CursorExit $CursorExit -TimedOut $metaTimed -ProgressLogFields $fields -ProgressOutcome "FAIL"
    $timeoutArchiveRel = [string]$timeoutCloseout.timeout_archive_path
    $timeoutArchivedFlag = [string]$timeoutCloseout.timeout_artifacts_archived
    $fields["timeout_archive_path"] = $timeoutArchiveRel
    $fields["timeout_artifacts_archived"] = $timeoutArchivedFlag
    $fields["closeout_kind"] = [string]$timeoutCloseout.closeout_kind
    $fields["git_status_clean_after_closeout"] = [string]$timeoutCloseout.git_status_clean_after_closeout
    $fields["progress_log_written_to_archive"] = [string]$timeoutCloseout.progress_log_written_to_archive
    if ($timeoutCloseout.safe_to_start_cycle -eq "YES") {
      $GitClean = "YES"
    }
    else {
      $GitClean = "NO"
    }
    $fields["git_status_clean"] = $GitClean
    $skipRepoProgressLogWrite = $true
  }
  $skipScorecardAfterOrchestrationCloseout = $false
  if ((-not $skipRepoProgressLogWrite) -and (-not $isTimeoutStop) -and ($DryRunText -ne "YES")) {
    $closeKindOrch = "orchestration_fail"
    if ($StopReason -match "git_not_clean") {
      $closeKindOrch = "runtime_artifact_restorable"
    }
    $orchClose = Invoke-SilverCap50OrchestrationRuntimeCloseout -RepoRoot $RepoRoot -Cycle $Cycle -Reason $reasonLine -ProgressLogFields $fields -ProgressOutcome "FAIL" -CloseoutKind $closeKindOrch
    $fields["closeout_kind"] = [string]$orchClose.closeout_kind
    $fields["failure_class"] = [string]$orchClose.failure_class
    $fields["blocked_dirty_classification"] = [string]$orchClose.blocked_dirty_classification
    $fields["restored_runtime_files"] = [string]$orchClose.restored_runtime_files
    $fields["remaining_forbidden_dirty_files"] = [string]$orchClose.remaining_forbidden_dirty_files
    $fields["timeout_archive_path"] = [string]$orchClose.timeout_archive_path
    $fields["timeout_artifacts_archived"] = [string]$orchClose.timeout_artifacts_archived
    $fields["runtime_artifacts_archived"] = [string]$orchClose.runtime_artifacts_archived
    $fields["runtime_artifacts_restored"] = [string]$orchClose.runtime_artifacts_restored
    $fields["git_status_clean_after_closeout"] = [string]$orchClose.git_status_clean_after_closeout
    $fields["progress_log_written_to_archive"] = [string]$orchClose.progress_log_written_to_archive
    if ([string]$orchClose.PASS_FAIL -eq "PASS") {
      $GitClean = "YES"
      $fields["git_status_clean"] = "YES"
      $skipRepoProgressLogWrite = $true
      $skipScorecardAfterOrchestrationCloseout = $true
    }
    else {
      $GitClean = "NO"
      $fields["git_status_clean"] = "NO"
    }
  }
  if (-not $skipRepoProgressLogWrite) {
    Write-SilverProgressLogBlock -ProgressLogPath $ProgressLogPath -Outcome "FAIL" -Fields $fields
  }
  Write-SilverColoredCycleSummary -Outcome "FAIL" -Fields $fields
  if ($controlledInfinite) {
    if (-not (Test-GitStatusClean -Cwd $RepoRoot)) {
      $null = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot
    }
    $reportFail = Read-TextFileOrEmpty -Path (Join-Path $RepoRoot "SILVER_RUN_REPORT.md")
    $safetyFail = Get-RunReportLineValue -ReportText $reportFail -Key "safety_counters"
    $finalPost = Invoke-SilverCap50FinalPostcondition -RepoRoot $RepoRoot -CyclesCompleted $Cycle -StopReason $reasonLine -NextActionPath (Join-Path $RepoRoot "SILVER_NEXT_ACTION.md") -CursorOutputPath (Join-Path $RepoRoot "SILVER_CURSOR_OUTPUT.md") -SafetyCountersLine $safetyFail
    Write-SilverCap50FinalPostconditionBlock -Result $finalPost
  }
  $cyclesForScorecard = $Cycle
  if ($script:AutonomousCyclesCompleted -gt 0) { $cyclesForScorecard = $script:AutonomousCyclesCompleted }
  if (-not $skipScorecardAfterOrchestrationCloseout) {
    $runtimeFailScore = "NO"
    if (Test-SilverCap50StopReasonIsRuntimeFailure -StopReason $StopReason -Focus $Focus) { $runtimeFailScore = "YES" }
    Invoke-SilverCapProductScorecardIfActive -RepoRoot $RepoRoot -ProgressLogPath $ProgressLogPath -CyclesCompleted $cyclesForScorecard -StopReason $reasonLine -RuntimeFailure $runtimeFailScore
  }
  else {
    Write-Host "silver-autopilot-loop: scorecard_skipped_after_orchestration_closeout_restore=YES" -ForegroundColor DarkCyan
    if (-not (Test-GitStatusClean -Cwd $RepoRoot)) {
      $null = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot
    }
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
    "scripts/silver-real-human-chaos-v3-report.json",
    "scripts/silver-self-correction-audit-report.json"
  )
}

function Restore-SilverTransientGeneratedDiagnosticReports {
  param([string]$RepoRoot)
  $scriptsDir = Join-Path $RepoRoot "scripts"
  if (-not (Test-Path -LiteralPath $scriptsDir)) { return }
  $rels = New-Object System.Collections.Generic.List[string]
  $diag = Get-ChildItem -LiteralPath $scriptsDir -Filter "silver-*-diagnostic-report.json" -File -ErrorAction SilentlyContinue
  foreach ($f in $diag) {
    [void]$rels.Add(("scripts/" + $f.Name))
  }
  if ($rels.Count -lt 1) { return }
  $argTail = ""
  foreach ($rel in $rels) {
    if ($argTail.Length -gt 0) { $argTail += " " }
    $argTail += [string]$rel
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

function Test-SilverPathIsTransientDiagnosticReportJson {
  param([string]$RelPath)
  $n = ([string]$RelPath).Trim() -replace '\\', '/'
  if (-not $n) { return $false }
  return ($n -cmatch '^scripts/silver-[a-z0-9][a-z0-9_-]*-diagnostic-report\.json$')
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
    '^scripts/silver-rhc3-mobile-voice-harness-alignment-report\.json$' { return 'runtime_rhc3_harness_alignment_json' }
    '^scripts/silver-self-correction-audit-report\.json$' { return 'runtime_self_correction_audit_json' }
    default {
      foreach ($auditRel in (Get-SilverTransientGeneratedAuditReportRelPaths)) {
        if ([string]::Equals($n, $auditRel, [System.StringComparison]::OrdinalIgnoreCase)) {
          return 'runtime_transient_audit_json'
        }
      }
      if (Test-SilverPathIsTransientClusterClassifierReport -RelPath $n) {
        return 'runtime_cluster_classifier_json'
      }
      if (Test-SilverPathIsTransientDiagnosticReportJson -RelPath $n) {
        return 'runtime_transient_diagnostic_json'
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

function Invoke-SilverValidProductWorkCloseoutClassify {
  param(
    [string]$RepoRoot,
    [string[]]$Paths,
    [string]$SelectorCluster = "",
    [string]$SafetyCounters = ""
  )
  $vpwScript = Join-Path $RepoRoot "scripts\silver-valid-product-work-closeout.cjs"
  if (-not (Test-Path -LiteralPath $vpwScript)) { return $null }
  $pathsJson = ($Paths | ForEach-Object { ([string]$_).Trim() -replace '\\', '/' }) -join "|"
  $cluster = [string]$SelectorCluster
  if (-not $cluster) {
    $cluster = Get-SilverAuthoritativeSelectorCluster -RepoRoot $RepoRoot
  }
  $scEsc = $cluster.Replace("'", "\'")
  $pathsEsc = $pathsJson.Replace("'", "\'")
  $safetyEsc = ([string]$SafetyCounters).Replace("'", "\'")
  $probe = @"
const m=require('./silver-valid-product-work-closeout.cjs');
const paths='$pathsEsc'.split('|').filter(Boolean);
const c=m.classifyValidProductWork({dirtyPaths:paths,selectorCluster:'$scEsc',repoRoot:process.cwd(),safetyCounters:'$safetyEsc'});
process.stdout.write(JSON.stringify(c));
"@
  $probePath = Join-Path $env:TEMP ("silver-vpw-classify-" + [guid]::NewGuid().ToString("N") + ".cjs")
  try {
    [System.IO.File]::WriteAllText($probePath, $probe, [System.Text.UTF8Encoding]::new($false))
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node"
    $psi.Arguments = ('"' + $probePath.Replace('"', '""') + '"')
    $psi.WorkingDirectory = $RepoRoot
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $stdout = $p.StandardOutput.ReadToEnd().Trim()
    $p.WaitForExit()
    if ($p.ExitCode -ne 0 -or -not $stdout) { return $null }
    return ($stdout | ConvertFrom-Json)
  }
  catch {
    return $null
  }
  finally {
    if (Test-Path -LiteralPath $probePath) {
      Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
    }
  }
}

function Invoke-SilverProductArtifactClassifierClassify {
  param(
    [string]$RepoRoot,
    [string[]]$Paths,
    [string]$SelectorCluster = "",
    [string]$ExpectedOutcome = "",
    [string]$SafetyCounters = "",
    [string]$AutonomousMode = "YES",
    [string]$CapRuntime = "YES",
    [string]$ProductHandoffContinuation = "YES",
    [string]$EngineChanged = "NO",
    [string]$AssetsAppChanged = "NO"
  )
  $pacScript = Join-Path $RepoRoot "scripts\silver-product-artifact-classifier.cjs"
  if (-not (Test-Path -LiteralPath $pacScript)) { return $null }
  $pathsJson = ($Paths | ForEach-Object { ([string]$_).Trim() -replace '\\', '/' }) -join "|"
  $cluster = [string]$SelectorCluster
  if (-not $cluster) {
    $cluster = Get-SilverAuthoritativeSelectorCluster -RepoRoot $RepoRoot
  }
  $scEsc = $cluster.Replace("'", "\'")
  $pathsEsc = $pathsJson.Replace("'", "\'")
  $safetyEsc = ([string]$SafetyCounters).Replace("'", "\'")
  $eoEsc = ([string]$ExpectedOutcome).Replace("'", "\'")
  $probe = @"
const m=require('./silver-product-artifact-classifier.cjs');
const paths='$pathsEsc'.split('|').filter(Boolean);
const c=m.classifyProductArtifactGovernance({
  dirtyPaths:paths,
  selectorCluster:'$scEsc',
  expectedOutcome:'$eoEsc',
  repoRoot:process.cwd(),
  safetyCounters:'$safetyEsc',
  autonomousMode:'$AutonomousMode',
  capRuntime:'$CapRuntime',
  productHandoffContinuation:'$ProductHandoffContinuation',
  engineChanged:'$EngineChanged',
  assetsAppChanged:'$AssetsAppChanged'
});
process.stdout.write(JSON.stringify(c));
"@
  $probePath = Join-Path $env:TEMP ("silver-pac-classify-" + [guid]::NewGuid().ToString("N") + ".cjs")
  try {
    [System.IO.File]::WriteAllText($probePath, $probe, [System.Text.UTF8Encoding]::new($false))
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node"
    $psi.Arguments = ('"' + $probePath.Replace('"', '""') + '"')
    $psi.WorkingDirectory = $RepoRoot
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $stdout = $p.StandardOutput.ReadToEnd().Trim()
    $p.WaitForExit()
    if ($p.ExitCode -ne 0 -or -not $stdout) { return $null }
    return ($stdout | ConvertFrom-Json)
  }
  catch {
    return $null
  }
  finally {
    if (Test-Path -LiteralPath $probePath) {
      Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
    }
  }
}

function Get-SilverExpectedOutcomeFromNextAction {
  param([string]$NextActionText)
  if (-not $NextActionText) { return "" }
  if ($NextActionText -match '(?im)^expected_outcome=(.+)$') { return ([string]$Matches[1]).Trim() }
  if ($NextActionText -match '(?i)expected_outcome=([^\s\r\n;]+)') { return ([string]$Matches[1]).Trim() }
  if ($NextActionText -match '(?i)recommended_next_task=[^;\r\n]*;[^\r\n]*expected_outcome=([^;\s\r\n]+)') {
    return ([string]$Matches[1]).Trim()
  }
  if ($NextActionText -match '(?i)SILVER_NEXT_ACTION_PLANNER_ENFORCE=[^\r\n]*expected_outcome=([^\s\r\n]+)') {
    return ([string]$Matches[1]).Trim()
  }
  return ""
}

function Get-SilverExpectedOutcomeForProductArtifact {
  param([string]$RepoRoot)
  $na = Read-TextFileOrEmpty -Path (Join-Path $RepoRoot "SILVER_NEXT_ACTION.md")
  $rr = Read-TextFileOrEmpty -Path (Join-Path $RepoRoot "SILVER_RUN_REPORT.md")
  $co = Read-TextFileOrEmpty -Path (Join-Path $RepoRoot "SILVER_CURSOR_OUTPUT.md")
  $combined = ($na + "`n" + $rr + "`n" + $co)
  $eo = Get-SilverExpectedOutcomeFromNextAction -NextActionText $combined
  if ($eo) { return $eo }
  return ""
}

function Test-SilverPathIsAutonomousSafeProductArtifact {
  param(
    [string]$RelPath,
    [string]$RepoRoot,
    [string]$SelectorCluster = "",
    [string]$ExpectedOutcome = "",
    [string]$SafetyCounters = ""
  )
  $pac = Invoke-SilverProductArtifactClassifierClassify -RepoRoot $RepoRoot -Paths @($RelPath) `
    -SelectorCluster $SelectorCluster -ExpectedOutcome $ExpectedOutcome -SafetyCounters $SafetyCounters `
    -AutonomousMode "YES" -CapRuntime "YES" -ProductHandoffContinuation "YES"
  if ($null -eq $pac) { return $false }
  return ([string]$pac.classification -eq "SAFE_PRODUCT_SCRIPT_ONLY")
}

function Invoke-SilverValidProductWorkCloseoutEval {
  param(
    [string]$RepoRoot,
    [string]$AutopilotScript,
    [string]$SafetyCounters = "",
    [switch]$RevertOnNoSafeFix
  )
  $args = @($AutopilotScript, "--valid-product-work-closeout-eval")
  if ($SafetyCounters) { $args += ("--safety-counters=" + $SafetyCounters) }
  if ($RevertOnNoSafeFix) { $args += "--revert-on-no-safe-fix" }
  $r = Invoke-NodeScript -WorkingDirectory $RepoRoot -Arguments $args -PassThruExit $true
  $out = @{
    PASS_FAIL = "FAIL"
    final_outcome = "HARD_FAIL"
    classification = ""
    closeout_kind = "forbidden_dirty"
    product_fix_created = "NO"
    scripts_only_product_work = "NO"
    stdout = ""
  }
  if ($null -ne $r) {
    $out.stdout = [string]$r.StdOut
    if ($r.ExitCode -eq 0) { $out.PASS_FAIL = "PASS" }
  }
  $txt = [string]$out.stdout
  foreach ($line in ($txt -split "`r?`n")) {
    $t = $line.Trim()
    if ($t -match '^classification=(.+)$') { $out.classification = $Matches[1] }
    if ($t -match '^closeout_kind=(.+)$') { $out.closeout_kind = $Matches[1] }
    if ($t -match '^final_outcome=(.+)$') { $out.final_outcome = $Matches[1] }
    if ($t -match '^product_fix_created=(.+)$') { $out.product_fix_created = $Matches[1] }
    if ($t -match '^scripts_only_product_work=(.+)$') { $out.scripts_only_product_work = $Matches[1] }
    if ($t -match '^PASS_FAIL=(.+)$') { $out.PASS_FAIL = $Matches[1] }
    if ($t -match '^branch_prefix=(.+)$') { $out.branch_prefix = $Matches[1] }
    if ($t -match '^pr_title=(.+)$') { $out.pr_title = $Matches[1] }
  }
  return $out
}

function Get-SilverCap50CloseoutClassificationFromDirtyPaths {
  param(
    [string[]]$Paths,
    [string]$RepoRoot = "",
    [string]$SelectorCluster = "",
    [string]$SafetyCounters = "",
    [string]$ExpectedOutcome = "",
    [string]$AutonomousMode = "",
    [string]$CapRuntime = "",
    [string]$ProductHandoffContinuation = ""
  )
  $list = New-Object System.Collections.Generic.List[string]
  foreach ($p in $Paths) {
    $n = ([string]$p).Trim() -replace '\\', '/'
    if (-not $n) { continue }
    if ($n -cmatch '^\.silver-runtime(/|$)') { continue }
    [void]$list.Add($n)
  }
  if ($list.Count -lt 1) {
    return @{
      closeout_kind                  = "clean"
      blocked_dirty_classification   = ""
      failure_class                  = "none"
    }
  }
  $repo = $RepoRoot
  if (-not $repo) { $repo = (Get-Location).Path }
  $vpw = Invoke-SilverValidProductWorkCloseoutClassify -RepoRoot $repo -Paths $list.ToArray() -SelectorCluster $SelectorCluster -SafetyCounters $SafetyCounters
  if ($null -ne $vpw) {
    $cls = [string]$vpw.classification
    $kind = [string]$vpw.closeout_kind
    if ($cls -eq "VALID_PRODUCT_WORK") {
      return @{
        closeout_kind                  = "valid_product_work"
        blocked_dirty_classification   = [string]$vpw.blocked_dirty_classification
        failure_class                  = "valid_product_work"
        valid_product_work             = $vpw
      }
    }
    if ($cls -eq "SAFE_BLOCKED") {
      return @{
        closeout_kind                  = "forbidden_product_dirty"
        blocked_dirty_classification   = [string]$vpw.blocked_dirty_classification
        failure_class                  = "forbidden_product_dirty"
      }
    }
    if ($cls -eq "PARTIAL_PRODUCT_WORK") {
      return @{
        closeout_kind                  = "partial_product_work_dirty"
        blocked_dirty_classification   = [string]$vpw.blocked_dirty_classification
        failure_class                  = "partial_product_work_dirty"
        valid_product_work             = $vpw
      }
    }
    if ($cls -eq "RUNTIME_ONLY") {
      return @{
        closeout_kind                  = "runtime_artifact_restorable"
        blocked_dirty_classification   = ($list -join ";")
        failure_class                  = "runtime_artifact_restorable"
      }
    }
    if ($cls -eq "FORBIDDEN_DIRTY") {
      $pac = Invoke-SilverProductArtifactClassifierClassify -RepoRoot $repo -Paths $list.ToArray() `
        -SelectorCluster $SelectorCluster -ExpectedOutcome $ExpectedOutcome -SafetyCounters $SafetyCounters `
        -AutonomousMode $(if ($AutonomousMode) { $AutonomousMode } else { "YES" }) `
        -CapRuntime $(if ($CapRuntime) { $CapRuntime } else { "YES" }) `
        -ProductHandoffContinuation $(if ($ProductHandoffContinuation) { $ProductHandoffContinuation } else { "YES" })
      if ($null -ne $pac -and [string]$pac.classification -eq "SAFE_PRODUCT_SCRIPT_ONLY") {
        return @{
          closeout_kind                  = "product_artifact_runtime_pending"
          blocked_dirty_classification   = [string]$pac.blocked_dirty_classification
          failure_class                  = "product_artifact_runtime_pending"
          product_artifact               = $pac
          git_status_clean               = "NO"
          safe_to_continue               = "YES"
        }
      }
      return @{
        closeout_kind                  = "forbidden_dirty"
        blocked_dirty_classification   = [string]$vpw.blocked_dirty_classification
        failure_class                  = "forbidden_dirty"
      }
    }
  }
  $pacFallback = Invoke-SilverProductArtifactClassifierClassify -RepoRoot $repo -Paths $list.ToArray() `
    -SelectorCluster $SelectorCluster -ExpectedOutcome $ExpectedOutcome -SafetyCounters $SafetyCounters `
    -AutonomousMode $(if ($AutonomousMode) { $AutonomousMode } else { "YES" }) `
    -CapRuntime $(if ($CapRuntime) { $CapRuntime } else { "YES" }) `
    -ProductHandoffContinuation $(if ($ProductHandoffContinuation) { $ProductHandoffContinuation } else { "YES" })
  if ($null -ne $pacFallback -and [string]$pacFallback.classification -eq "SAFE_PRODUCT_SCRIPT_ONLY") {
    return @{
      closeout_kind                  = "product_artifact_runtime_pending"
      blocked_dirty_classification   = [string]$pacFallback.blocked_dirty_classification
      failure_class                  = "product_artifact_runtime_pending"
      product_artifact               = $pacFallback
      git_status_clean               = "NO"
      safe_to_continue               = "YES"
    }
  }
  foreach ($n in $list) {
    if ([string]::Equals($n, "assets/app.js", [System.StringComparison]::OrdinalIgnoreCase)) {
      return @{
        closeout_kind                  = "forbidden_product_dirty"
        blocked_dirty_classification   = $n
        failure_class                  = "forbidden_product_dirty"
      }
    }
    if ($n -match '^(assets/|projects/(?!data/)|\.github/workflows/)') {
      return @{
        closeout_kind                  = "forbidden_product_dirty"
        blocked_dirty_classification   = $n
        failure_class                  = "forbidden_product_dirty"
      }
    }
  }
  $allRestorable = $true
  foreach ($n in $list) {
    if (-not (Test-SilverPathIsCap50RuntimeRestorable -RelPath $n)) {
      $allRestorable = $false
      break
    }
  }
  if ($allRestorable) {
    return @{
      closeout_kind                  = "runtime_artifact_restorable"
      blocked_dirty_classification   = ($list -join ";")
      failure_class                  = "runtime_artifact_restorable"
    }
  }
  return @{
    closeout_kind                  = "forbidden_dirty"
    blocked_dirty_classification   = ($list -join ";")
    failure_class                  = "forbidden_dirty"
  }
}

function Test-SilverPathIsCap50IgnorableUntrackedRuntime {
  param([string]$RelPath)
  $n = ([string]$RelPath).Trim() -replace '\\', '/'
  if (-not $n) { return $false }
  if ($n -cmatch '^\.silver-runtime(/|$)') { return $true }
  return $false
}

function Test-SilverCap50RuntimeEphemeralsClean {
  param([string]$Cwd)
  foreach ($rel in (Get-GitStatusShortPaths -Cwd $Cwd)) {
    $n = ($rel -replace '\\', '/')
    if (Test-SilverPathIsCap50IgnorableUntrackedRuntime -RelPath $n) { continue }
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
    if ($n -eq 'SILVER_NEXT_ACTION.md' -or $n -eq 'SILVER_RUN_REPORT.md' -or $n -eq 'SILVER_PROGRESS_LOG.md') { continue }
    if (Test-SilverPathIsCap50IgnorableUntrackedRuntime -RelPath $n) { continue }
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
    $psi.Arguments = "restore --source=HEAD --staged --worktree -- " + $argTail
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
    [switch]$AllowValidProductWork,
    [switch]$AllowProductArtifactRuntimePending,
    [string]$SelectorCluster = "",
    [string]$ExpectedOutcome = "",
    [string]$SafetyCounters = "",
    [string[]]$ExcludeRestoreRelPaths = @()
  )
  $archivePath = ""
  if (-not $DryRunOnly) {
    $arch = Archive-SilverCap50CycleRuntimeArtifacts -RepoRoot $RepoRoot -Cycle $Cycle -Reason $Reason
    if ($arch.Archived -eq "YES") {
      $archivePath = [string]$arch.RelativePath
    }
  }
  $cleanup = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot -DryRunOnly:$DryRunOnly -AllowForeignDirty:$AllowForeignDirty -AllowHandoffDirty:$AllowHandoffDirty -AllowValidProductWork:$AllowValidProductWork -AllowProductArtifactRuntimePending:$AllowProductArtifactRuntimePending -SelectorCluster $SelectorCluster -ExpectedOutcome $ExpectedOutcome -SafetyCounters $SafetyCounters -ExcludeRestoreRelPaths $ExcludeRestoreRelPaths
  $cleanup.archive_path = $archivePath
  return $cleanup
}

function Invoke-SilverCap50PreflightCleanup {
  param(
    [string]$RepoRoot,
    [switch]$DryRunOnly,
    [switch]$AllowForeignDirty,
    [switch]$AllowHandoffDirty,
    [switch]$AllowValidProductWork,
    [switch]$AllowProductArtifactRuntimePending,
    [string]$SelectorCluster = "",
    [string]$ExpectedOutcome = "",
    [string]$SafetyCounters = "",
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
  $productArtifactPendingCount = 0
  $eoPreflight = [string]$ExpectedOutcome
  if (-not $eoPreflight -and $AllowProductArtifactRuntimePending) {
    $eoPreflight = Get-SilverExpectedOutcomeForProductArtifact -RepoRoot $RepoRoot
  }
  foreach ($ent in $entries) {
    $p = [string]$ent.path
    if (-not $p) { continue }
    [void]$dirtyBefore.Add($p)
    $pNorm = $p -replace '\\', '/'
    if ($excludeNorm.Contains($pNorm)) { continue }
    if ($ent.untracked -and (Test-SilverPathIsCap50IgnorableUntrackedRuntime -RelPath $p)) { continue }
    $reason = Get-SilverCap50RuntimeRestoreAllowReason -RelPath $p
    if ($ent.untracked) {
      if ($AllowProductArtifactRuntimePending -and (Test-SilverPathIsAutonomousSafeProductArtifact -RelPath $pNorm -RepoRoot $RepoRoot -SelectorCluster $SelectorCluster -ExpectedOutcome $eoPreflight -SafetyCounters $SafetyCounters)) {
        $productArtifactPendingCount++
        $allowCount++
        continue
      }
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
      if ($AllowProductArtifactRuntimePending -and (Test-SilverPathIsAutonomousSafeProductArtifact -RelPath $pNorm -RepoRoot $RepoRoot -SelectorCluster $SelectorCluster -ExpectedOutcome $eoPreflight -SafetyCounters $SafetyCounters)) {
        $productArtifactPendingCount++
        $allowCount++
        continue
      }
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
  $remainingPaths = Get-GitStatusShortPaths -Cwd $RepoRoot
  $classAfter = Get-SilverCap50CloseoutClassificationFromDirtyPaths -Paths $remainingPaths -RepoRoot $RepoRoot -SelectorCluster $SelectorCluster -SafetyCounters $SafetyCounters -ExpectedOutcome $eoPreflight -AutonomousMode $(if ($AllowProductArtifactRuntimePending) { "YES" } else { "NO" }) -CapRuntime $(if ($AllowProductArtifactRuntimePending) { "YES" } else { "NO" }) -ProductHandoffContinuation $(if ($AllowProductArtifactRuntimePending) { "YES" } else { "NO" })
  $closeoutKind = [string]$classAfter.closeout_kind
  $failureClass = [string]$classAfter.failure_class
  $blockedClass = [string]$classAfter.blocked_dirty_classification
  if (
    (-not $DryRunOnly) -and
    ($blocked.Count -eq 0) -and
    ($cleanAfter -eq "NO") -and
    ($closeoutKind -eq "runtime_artifact_restorable")
  ) {
    $retryRestore = New-Object System.Collections.Generic.List[string]
    foreach ($rp in $remainingPaths) {
      $rn = ([string]$rp).Trim() -replace '\\', '/'
      if (-not $rn) { continue }
      if ($excludeNorm.Contains($rn)) { continue }
      if (Test-SilverPathIsCap50RuntimeRestorable -RelPath $rn) {
        [void]$retryRestore.Add($rn)
      }
    }
    if ($retryRestore.Count -gt 0) {
      Invoke-SilverGitRestoreWorktreePaths -RepoRoot $RepoRoot -RelPaths $retryRestore.ToArray()
      foreach ($rp in $retryRestore) {
        if ($restored -notcontains $rp) { [void]$restored.Add($rp) }
      }
      $cleanAfter = if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" }
      $remainingPaths = Get-GitStatusShortPaths -Cwd $RepoRoot
      $classAfter = Get-SilverCap50CloseoutClassificationFromDirtyPaths -Paths $remainingPaths -RepoRoot $RepoRoot -SelectorCluster $SelectorCluster -SafetyCounters $SafetyCounters -ExpectedOutcome $eoPreflight -AutonomousMode $(if ($AllowProductArtifactRuntimePending) { "YES" } else { "NO" }) -CapRuntime $(if ($AllowProductArtifactRuntimePending) { "YES" } else { "NO" }) -ProductHandoffContinuation $(if ($AllowProductArtifactRuntimePending) { "YES" } else { "NO" })
      $closeoutKind = [string]$classAfter.closeout_kind
      $failureClass = [string]$classAfter.failure_class
      $blockedClass = [string]$classAfter.blocked_dirty_classification
    }
  }
  $runtimeClean = if (Test-SilverCap50RuntimeEphemeralsClean -Cwd $RepoRoot) { "YES" } else { "NO" }
  $safe = "NO"
  if ($blocked.Count -eq 0) {
    if ($cleanAfter -eq "YES") { $safe = "YES" }
    elseif ($DryRunOnly -and $toRestore.Count -gt 0 -and $dirtyBefore.Count -eq $toRestore.Count) { $safe = "YES" }
    elseif ($AllowHandoffDirty -and (Test-Cap50GitCleanExceptHandoffArtifacts -Cwd $RepoRoot)) { $safe = "YES" }
    elseif ($AllowValidProductWork -and $closeoutKind -eq "valid_product_work") { $safe = "YES" }
    elseif ($AllowProductArtifactRuntimePending -and $closeoutKind -eq "product_artifact_runtime_pending") { $safe = "YES" }
  }
  elseif ($AllowForeignDirty -and $runtimeClean -eq "YES") {
    $safe = "YES"
  }
  elseif ($AllowValidProductWork -and $closeoutKind -eq "valid_product_work") {
    $safe = "YES"
  }
  elseif ($AllowProductArtifactRuntimePending -and $closeoutKind -eq "product_artifact_runtime_pending") {
    $safe = "YES"
  }
  $passFail = if ($safe -eq "YES") { "PASS" } else { "FAIL" }
  $sep = [char]59
  $forbiddenRemaining = New-Object System.Collections.Generic.List[string]
  foreach ($rp in $remainingPaths) {
    $rn = ([string]$rp).Trim() -replace '\\', '/'
    if (-not $rn) { continue }
    if (Test-SilverPathIsCap50IgnorableUntrackedRuntime -RelPath $rn) { continue }
    if (Test-SilverPathIsCap50RuntimeRestorable -RelPath $rn) { continue }
    [void]$forbiddenRemaining.Add($rn)
  }
  return @{
    dirty_before                      = ($dirtyBefore -join $sep)
    allowlisted_runtime_dirty_count   = [string]$allowCount
    product_artifact_runtime_pending_count = [string]$productArtifactPendingCount
    restored_runtime_files            = ($restored -join $sep)
    blocked_dirty_files               = ($blocked -join $sep)
    git_clean_after                   = $cleanAfter
    safe_to_start_cycle               = $safe
    safe_to_continue                  = $safe
    PASS_FAIL                         = $passFail
    closeout_kind                     = $closeoutKind
    failure_class                     = $failureClass
    blocked_dirty_classification      = $blockedClass
    remaining_forbidden_dirty_files   = ($forbiddenRemaining -join $sep)
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
  if ($Result.ContainsKey("closeout_kind")) {
    Write-Host ("closeout_kind=" + [string]$Result.closeout_kind)
  }
  if ($Result.ContainsKey("failure_class")) {
    Write-Host ("failure_class=" + [string]$Result.failure_class)
  }
  if ($Result.ContainsKey("blocked_dirty_classification")) {
    Write-Host ("blocked_dirty_classification=" + [string]$Result.blocked_dirty_classification)
  }
  if ($Result.ContainsKey("remaining_forbidden_dirty_files")) {
    Write-Host ("remaining_forbidden_dirty_files=" + [string]$Result.remaining_forbidden_dirty_files)
  }
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
  Test-OneCase -Name "dirty_SILVER_PROGRESS_LOG" -RelPath "SILVER_PROGRESS_LOG.md" -ExpectPass $true
  Test-OneCase -Name "dirty_cluster_classifier_json" -RelPath "scripts/silver-rhc3-cluster-classifier-v1-report.json" -ExpectPass $true
  Test-OneCase -Name "dirty_mobile_voice_harness_alignment_json" -RelPath "scripts/silver-rhc3-mobile-voice-harness-alignment-report.json" -ExpectPass $true
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

function Invoke-SilverCap50TimeoutCloseoutSelfTest {
  param([string]$RepoRoot)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $failures = New-Object System.Collections.Generic.List[string]
  $td = Join-Path $env:TEMP ("silver-timeout-closeout-selftest-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $td -Force | Out-Null
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    Set-Location -LiteralPath $td
    & git init 2>$null | Out-Null
    & git config user.email "silver-closeout-selftest@local" 2>$null
    & git config user.name "silver-closeout-selftest" 2>$null
    [System.IO.File]::WriteAllText((Join-Path $td ".gitignore"), ".silver-runtime/`n", $utf8)
    $names = @("SILVER_PROGRESS_LOG.md", "SILVER_NEXT_ACTION.md", "SILVER_CURSOR_OUTPUT.md", "SILVER_RUN_REPORT.md")
    foreach ($n in $names) {
      [System.IO.File]::WriteAllText((Join-Path $td $n), "# " + $n + "`n", $utf8)
    }
    & git add .gitignore SILVER_PROGRESS_LOG.md SILVER_NEXT_ACTION.md SILVER_CURSOR_OUTPUT.md SILVER_RUN_REPORT.md 2>$null
    & git commit -m "init" 2>$null | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $td "SILVER_CURSOR_OUTPUT.md"), "# silver-cursor-agent-adapter`ntimed_out=YES`nexit_code=124`n", $utf8)
    [System.IO.File]::WriteAllText((Join-Path $td "SILVER_PROGRESS_LOG.md"), "# progress`n---`n", $utf8)
    $fields = @{
      timestamp                         = (Get-Date).ToString("s")
      cycle                             = "7"
      main_commit                       = "deadbeef"
      last_task_exit                    = "1"
      cursor_exit                       = "124"
      autopilot_exit                    = "N/A"
      autopilot_status_exit             = "N/A"
      git_status_clean                  = "NO"
      safety_counters                   = "dangerous_write_count=0;false_write_count=0;query_created_write_count=0;write_when_negated_count=0"
      calendar_write_20k                = "SKIPPED"
      calendar_query_20k              = "SKIPPED"
      core_engine_progress              = "94%"
      safety_progress                   = "98%"
      routing_progress                  = "95%"
      retrieval_progress                = "87%"
      real_human_chaos_progress         = "83%"
      multi_intent_orchestration_progress = "65%"
      long_session_memory_progress      = "50%"
      public_ready_progress             = "87%"
      source                            = "selftest"
      current_focus                     = "cursor_exit_nonzero"
      next_action_headline              = "selftest"
      dry_run                           = "NO"
      stop_reason                       = "cursor_outer_or_adapter_timeout_exit_124"
      closeout_kind                     = "adapter_timeout"
    }
    $close = Invoke-SilverCap50AdapterTimeoutCloseout -RepoRoot $td -Reason "selftest_timeout" -CursorExit "124" -TimedOut "YES" -ProgressLogFields $fields -ProgressOutcome "FAIL"
    if ($close.PASS_FAIL -ne "PASS") {
      [void]$failures.Add("timeout_closeout_preflight:" + [string]$close.blocked_dirty_files)
    }
    if (-not (Test-GitStatusClean -Cwd $td)) {
      [void]$failures.Add("repo_not_clean_after_timeout_closeout")
    }
    $stillProgressDirty = $false
    foreach ($sp in (Get-GitStatusShortPaths -Cwd $td)) {
      if ([string]::Equals(($sp -replace '\\', '/'), "SILVER_PROGRESS_LOG.md", [System.StringComparison]::OrdinalIgnoreCase)) {
        $stillProgressDirty = $true
      }
    }
    if ($stillProgressDirty) {
      [void]$failures.Add("SILVER_PROGRESS_LOG_still_dirty_after_closeout")
    }
    if ([string]$close.timeout_archive_path -eq "") {
      [void]$failures.Add("timeout_archive_missing")
    }
    else {
      $archFull = Join-Path $td (($close.timeout_archive_path -replace '/', '\'))
      $archProg = Join-Path $archFull "SILVER_PROGRESS_LOG.md"
      if (-not (Test-Path -LiteralPath $archProg)) {
        [void]$failures.Add("archived_progress_log_missing")
      }
      else {
        $archText = [System.IO.File]::ReadAllText($archProg, $utf8)
        if ($archText -notmatch 'outcome=FAIL') {
          [void]$failures.Add("archived_progress_fail_block_missing")
        }
        if ($archText -notmatch 'closeout_kind=adapter_timeout') {
          [void]$failures.Add("archived_progress_closeout_kind_missing")
        }
      }
    }
    [System.IO.File]::WriteAllText((Join-Path $td "SILVER_CAP50_TIMEOUT_CLOSEOUT_SELFTEST_BLOCK.txt"), "forbidden`n", $utf8)
    $resBlock = Invoke-SilverCap50PreflightCleanup -RepoRoot $td
    if ($resBlock.PASS_FAIL -ne "FAIL") {
      [void]$failures.Add("forbidden_dirty_should_fail_preflight")
    }
    Invoke-SilverGitRestoreWorktreePaths -RepoRoot $td -RelPaths @("SILVER_CAP50_TIMEOUT_CLOSEOUT_SELFTEST_BLOCK.txt")
    if (Test-Path -LiteralPath (Join-Path $td "SILVER_CAP50_TIMEOUT_CLOSEOUT_SELFTEST_BLOCK.txt")) {
      Remove-Item -LiteralPath (Join-Path $td "SILVER_CAP50_TIMEOUT_CLOSEOUT_SELFTEST_BLOCK.txt") -Force -ErrorAction SilentlyContinue
    }
    $assetsRel = "assets"
    $assetsDir = Join-Path $td $assetsRel
    New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $assetsDir "app.js"), "// selftest`n", $utf8)
    & git add assets/app.js 2>$null
    & git commit -m "assets" 2>$null | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $assetsDir "app.js"), "// dirty`n", $utf8)
    $resAssets = Invoke-SilverCap50PreflightCleanup -RepoRoot $td
    if ($resAssets.PASS_FAIL -ne "FAIL") {
      [void]$failures.Add("assets_app_dirty_should_fail_preflight")
    }
    if ([string]$resAssets.blocked_dirty_files -notmatch 'assets/app\.js') {
      [void]$failures.Add("assets_app_missing_from_blocked_dirty_files")
    }
  }
  finally {
    $ErrorActionPreference = $prevEa
    Set-Location -LiteralPath $RepoRoot
    Remove-Item -LiteralPath $td -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($failures.Count -gt 0) {
    Write-Host "SILVER_CAP50_TIMEOUT_CLOSEOUT_SELFTEST=FAIL" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host $f -ForegroundColor Red }
    return $false
  }
  Write-Host "SILVER_CAP50_TIMEOUT_CLOSEOUT_SELFTEST=PASS" -ForegroundColor Green
  return $true
}

function Invoke-SilverCap50Timeout124FinalPostconditionSelfTest {
  param([string]$RepoRoot)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $failures = New-Object System.Collections.Generic.List[string]
  $td = Join-Path $env:TEMP ("silver-timeout124-final-post-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $td -Force | Out-Null
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    Set-Location -LiteralPath $td
    & git init 2>$null | Out-Null
    & git config user.email "silver-timeout124-post@local" 2>$null
    & git config user.name "silver-timeout124-post" 2>$null
    [System.IO.File]::WriteAllText((Join-Path $td ".gitignore"), ".silver-runtime/`n", $utf8)
    $diagJson = "scripts/silver-rhc3-negation-cal-readonly-diagnostic-report.json"
    $diagDir = Join-Path $td "scripts"
    New-Item -ItemType Directory -Path $diagDir -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $td $diagJson), "{`"selftest`":true}`n", $utf8)
    foreach ($n in @("SILVER_PROGRESS_LOG.md", "SILVER_NEXT_ACTION.md", "SILVER_CURSOR_OUTPUT.md", "SILVER_RUN_REPORT.md")) {
      [System.IO.File]::WriteAllText((Join-Path $td $n), "# " + $n + "`n", $utf8)
    }
    & git add .gitignore SILVER_PROGRESS_LOG.md SILVER_NEXT_ACTION.md SILVER_CURSOR_OUTPUT.md SILVER_RUN_REPORT.md $diagJson 2>$null
    & git commit -m "init" 2>$null | Out-Null
    $adapterBody = @"
# silver-cursor-agent-adapter
timed_out=YES
exit_code=124
adapter_authoritative_exit_code=124
autonomous_cycle=1
autonomous_run_id=timeout124-selftest
process_start_utc=2026-05-19T19:26:32.4149789Z
process_end_utc=2026-05-19T20:23:12.4540978Z
task_digest=6b51824d04c91eb0
stdout_nonempty=YES
# stdout
partial work before wall clock timeout

SILVER_TIMEOUT_CLOSEOUT_REMINDER
read_before_git_restore_or_clean=YES
"@
    [System.IO.File]::WriteAllText((Join-Path $td "SILVER_CURSOR_OUTPUT.md"), $adapterBody, $utf8)
    [System.IO.File]::WriteAllText((Join-Path $td "SILVER_NEXT_ACTION.md"), "# dirty next action`n", $utf8)
    [System.IO.File]::WriteAllText((Join-Path $td $diagJson), "{`"dirty`":true}`n", $utf8)
    $rtArch = Join-Path $td ".silver-runtime/timeouts/selftest-timeout124"
    New-Item -ItemType Directory -Path $rtArch -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $rtArch "manifest.json"), "{`"selftest`":true}`n", $utf8)
    $fields = @{
      timestamp             = (Get-Date).ToString("s")
      cycle                 = "1"
      main_commit           = "deadbeef"
      last_task_exit        = "1"
      cursor_exit           = "124"
      autopilot_exit        = "N/A"
      autopilot_status_exit = "N/A"
      git_status_clean      = "NO"
      safety_counters       = "dangerous_write_count=0;false_write_count=0;query_created_write_count=0;write_when_negated_count=0"
      stop_reason           = "cursor_outer_or_adapter_timeout_exit_124"
      closeout_kind         = "adapter_timeout"
    }
    $close = Invoke-SilverCap50AdapterTimeoutCloseout -RepoRoot $td -Reason "selftest_timeout124_final_post" -CursorExit "124" -TimedOut "YES" -ProgressLogFields $fields -ProgressOutcome "FAIL"
    if ($close.PASS_FAIL -ne "PASS") {
      [void]$failures.Add("timeout_closeout_preflight:" + [string]$close.blocked_dirty_files)
    }
    if ([string]$close.git_status_clean_after_closeout -ne "YES") {
      [void]$failures.Add("closeout_git_clean_expected_YES")
    }
    $finalPost = Invoke-SilverCap50FinalPostcondition -RepoRoot $td -CyclesCompleted 1 -StopReason "cursor_exit_nonzero|stop_reason=cursor_outer_or_adapter_timeout_exit_124" -NextActionPath (Join-Path $td "SILVER_NEXT_ACTION.md") -CursorOutputPath (Join-Path $td "SILVER_CURSOR_OUTPUT.md") -SafetyCountersLine "dangerous_write_count=0;false_write_count=0;query_created_write_count=0;write_when_negated_count=0"
    if ([string]$finalPost.git_status_clean_after_cleanup -ne "YES") {
      [void]$failures.Add("final_post_git_clean_expected_YES_got=" + [string]$finalPost.git_status_clean_after_cleanup)
    }
    if ([string]$finalPost.dirty_runtime_leftovers -ne "NO") {
      [void]$failures.Add("final_post_dirty_runtime_leftovers_expected_NO_got=" + [string]$finalPost.dirty_runtime_leftovers + " blocked=" + [string]$finalPost.blocked_dirty_files)
    }
    if ([string]$finalPost.PASS_FAIL -ne "PASS") {
      [void]$failures.Add("final_post_PASS_FAIL_expected_PASS")
    }
    if (-not (Test-GitStatusClean -Cwd $td)) {
      [void]$failures.Add("repo_not_clean_after_final_postcondition")
    }
  }
  finally {
    $ErrorActionPreference = $prevEa
    Set-Location -LiteralPath $RepoRoot
    Remove-Item -LiteralPath $td -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($failures.Count -gt 0) {
    Write-Host "SILVER_CAP50_TIMEOUT124_FINAL_POSTCONDITION_SELFTEST=FAIL" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host $f -ForegroundColor Red }
    return $false
  }
  Write-Host "SILVER_CAP50_TIMEOUT124_FINAL_POSTCONDITION_SELFTEST=PASS" -ForegroundColor Green
  return $true
}

function Invoke-SilverAdapterMetaFreshnessSelfTest {
  param([string]$RepoRoot)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $failures = New-Object System.Collections.Generic.List[string]
  $td = Join-Path $env:TEMP ("silver-adapter-meta-freshness-selftest-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $td -Force | Out-Null
  try {
    $taskPath = Join-Path $td "SILVER_NEXT_ACTION.md"
    $outPath = Join-Path $td "SILVER_CURSOR_OUTPUT.md"
    [System.IO.File]::WriteAllText($taskPath, "# task selftest`n", $utf8)
    [System.IO.File]::WriteAllText($outPath, "# placeholder`n", $utf8)
    $taskDigest = Get-SilverTaskUtf8Sha256HexPrefix -Text "# task selftest`n"
    $taskAbs = (Resolve-Path -LiteralPath $taskPath).Path
    $outAbs = (Resolve-Path -LiteralPath $outPath).Path
    $runId = "adapter-meta-selftest-run"
    $cycle = "7"
    $runStart = (Get-Date).ToUniversalTime().ToString("o")
    $procStart = (Get-Date).ToUniversalTime()

    function Write-TestAdapterMeta {
      param(
        [string]$Path,
        [string]$State,
        [string]$TaskFile,
        [string]$OutputFile,
        [string]$Digest,
        [string]$ProcStartIso,
        [string]$ProcEndIso
      )
      $body = @"
# silver-cursor-agent-adapter
autonomous_run_id=$runId
autonomous_run_start_utc=$runStart
autonomous_cycle=$cycle
adapter_output_state=$State
task_file=$TaskFile
output_file=$OutputFile
task_digest=$Digest
process_start_utc=$ProcStartIso
process_end_utc=$ProcEndIso
adapter_authoritative_exit_code=0
exit_code=0
timed_out=NO
stderr_nonempty=NO
stdout_nonempty=YES

# stdout
ok

# stderr

"@
      [System.IO.File]::WriteAllText($Path, $body, $utf8)
    }

    $endIso = $procStart.AddSeconds(30).ToString("o")
    $startIso = $procStart.ToString("o")
    Write-TestAdapterMeta -Path $outAbs -State "COMPLETED" -TaskFile $taskAbs -OutputFile $outAbs -Digest $taskDigest -ProcStartIso $startIso -ProcEndIso $endIso
    $metaFresh = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $outAbs
    if (-not (Test-SilverAdapterMetaReconcileEligible -Meta $metaFresh -ProcessStartUtc $procStart -AdapterOutputPath $outAbs -ExpectedTaskDigest $taskDigest -ExpectedTaskFile $taskAbs -ExpectedOutputFile $outAbs -ExpectedRunId $runId -ExpectedCycle $cycle -ExpectedRunStartUtc $runStart)) {
      [void]$failures.Add("A_fresh_meta_reconcile_expected_PASS")
    }
    $reconFresh = Resolve-SilverCursorOuterExitFromAdapterMeta -OuterExit 1 -AdapterOutputPath $outAbs -ProcessStartUtc $procStart -ExpectedTaskDigest $taskDigest -ExpectedTaskFile $taskAbs -ExpectedOutputFile $outAbs -ExpectedRunId $runId -ExpectedCycle $cycle -ExpectedRunStartUtc $runStart
    if (-not $reconFresh.Reconciled) {
      [void]$failures.Add("A_fresh_outer_exit1_should_reconcile_to_0")
    }

    $staleStart = $procStart.AddHours(-2).ToString("o")
    $staleEnd = $procStart.AddHours(-1).ToString("o")
    Write-TestAdapterMeta -Path $outAbs -State "COMPLETED" -TaskFile $taskAbs -OutputFile $outAbs -Digest $taskDigest -ProcStartIso $staleStart -ProcEndIso $staleEnd
    $metaStale = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $outAbs
    $diagStale = Get-SilverAdapterMetaMismatchDiagnostics -Meta $metaStale -ProcessStartUtc $procStart -AdapterOutputPath $outAbs -ExpectedTaskDigest $taskDigest -ExpectedTaskFile $taskAbs -ExpectedOutputFile $outAbs -ExpectedRunId $runId -ExpectedCycle $cycle -ExpectedRunStartUtc $runStart
    if ($diagStale.cycle_scoped_ok -eq "YES") {
      [void]$failures.Add("B_stale_meta_expected_FAIL")
    }
    if ([string]$diagStale.exact_mismatch_reason -eq "(none)") {
      [void]$failures.Add("B_stale_meta_expected_exact_reason")
    }

    Write-TestAdapterMeta -Path $outAbs -State "COMPLETED" -TaskFile $taskAbs -OutputFile $outAbs -Digest "deadbeef00000000" -ProcStartIso $startIso -ProcEndIso $endIso
    $metaDigestBad = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $outAbs
    $diagDigest = Get-SilverAdapterMetaMismatchDiagnostics -Meta $metaDigestBad -ProcessStartUtc $procStart -AdapterOutputPath $outAbs -ExpectedTaskDigest $taskDigest -ExpectedTaskFile $taskAbs -ExpectedOutputFile $outAbs -ExpectedRunId $runId -ExpectedCycle $cycle -ExpectedRunStartUtc $runStart
    if ($diagDigest.exact_mismatch_reason -notmatch "task_digest_mismatch") {
      [void]$failures.Add("C_task_digest_mismatch_reason_expected")
    }

    $wrongOut = Join-Path $td "OTHER_OUTPUT.md"
    [System.IO.File]::WriteAllText($wrongOut, "# other`n", $utf8)
    $wrongOutAbs = (Resolve-Path -LiteralPath $wrongOut).Path
    Write-TestAdapterMeta -Path $outAbs -State "COMPLETED" -TaskFile $taskAbs -OutputFile $wrongOutAbs -Digest $taskDigest -ProcStartIso $startIso -ProcEndIso $endIso
    $metaOutBad = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $outAbs
    $diagOut = Get-SilverAdapterMetaMismatchDiagnostics -Meta $metaOutBad -ProcessStartUtc $procStart -AdapterOutputPath $outAbs -ExpectedTaskDigest $taskDigest -ExpectedTaskFile $taskAbs -ExpectedOutputFile $outAbs -ExpectedRunId $runId -ExpectedCycle $cycle -ExpectedRunStartUtc $runStart
    if ($diagOut.exact_mismatch_reason -notmatch "output_file_path_mismatch") {
      [void]$failures.Add("C_output_file_mismatch_reason_expected")
    }

    Write-SilverCursorOutputInvalidatedStub -Path $outAbs -RunId $runId -RunStartUtcIso $runStart -CycleState $cycle -RepoRoot $td
    $invMeta = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $outAbs
    if (-not $invMeta.ContainsKey("adapter_output_state")) {
      [void]$failures.Add("D_invalidated_stub_missing_state")
    }
    elseif ([string]$invMeta["adapter_output_state"] -ne "INVALIDATED_AWAITING_CYCLE") {
      [void]$failures.Add("D_invalidated_stub_state_expected")
    }
    Write-TestAdapterMeta -Path $outAbs -State "COMPLETED" -TaskFile $taskAbs -OutputFile $outAbs -Digest $taskDigest -ProcStartIso $startIso -ProcEndIso $endIso
    $metaAfterInv = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $outAbs
    if (-not (Test-SilverAdapterMetaReconcileEligible -Meta $metaAfterInv -ProcessStartUtc $procStart -AdapterOutputPath $outAbs -ExpectedTaskDigest $taskDigest -ExpectedTaskFile $taskAbs -ExpectedOutputFile $outAbs -ExpectedRunId $runId -ExpectedCycle $cycle -ExpectedRunStartUtc $runStart)) {
      [void]$failures.Add("D_post_invalidation_fresh_meta_expected_PASS")
    }

    $archDir = Join-Path $td ".silver-runtime\adapter-meta-archive"
    if (-not (Test-Path -LiteralPath $archDir)) {
      Write-TestAdapterMeta -Path $outAbs -State "COMPLETED" -TaskFile $taskAbs -OutputFile $outAbs -Digest $taskDigest -ProcStartIso $startIso -ProcEndIso $endIso
      $null = Archive-SilverAdapterMetaBeforeCycleInvalidation -RepoRoot $td -AdapterOutputPath $outAbs -RunId $runId -CycleState $cycle
      Write-SilverCursorOutputInvalidatedStub -Path $outAbs -RunId $runId -RunStartUtcIso $runStart -CycleState $cycle -RepoRoot $td
      if (-not (Test-Path -LiteralPath $archDir)) {
        [void]$failures.Add("D_archive_dir_expected_after_invalidation_with_prior_completed_meta")
      }
    }

    Write-SilverCursorOutputInvalidatedStub -Path $outAbs -RunId $runId -RunStartUtcIso $runStart -CycleState $cycle -RepoRoot $td
    $diagInvStub = Get-SilverAdapterMetaMismatchDiagnostics -Meta (Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $outAbs) -ProcessStartUtc $procStart -AdapterOutputPath $outAbs -ExpectedTaskDigest $taskDigest -ExpectedTaskFile $taskAbs -ExpectedOutputFile $outAbs -ExpectedRunId $runId -ExpectedCycle $cycle -ExpectedRunStartUtc $runStart
    if ([string]$diagInvStub.exact_mismatch_reason -match "output_or_process_end_before_cycle_start") {
      [void]$failures.Add("E_invalidated_stub_must_not_flag_output_before_cycle_start")
    }
    if ([string]$diagInvStub.exact_mismatch_reason -match "missing_task_file_in_meta") {
      [void]$failures.Add("E_invalidated_stub_must_not_flag_missing_task_file")
    }

    $outerStartIso = $procStart.ToString("o")
    Write-SilverCursorOutputOuterWallTimeoutTerminal -Path $outAbs -RunId $runId -RunStartUtcIso $runStart -CycleState $cycle -TaskDigest $taskDigest -OuterStdout "partial" -OuterStderr "" -EffectiveTimeoutSeconds 3000 -ProcessStartUtcIso $outerStartIso -TaskFile $taskAbs -OutputFile $outAbs
    $metaOuter = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $outAbs
    if (-not (Test-SilverAdapterMetaReconcileEligible -Meta $metaOuter -ProcessStartUtc $procStart -AdapterOutputPath $outAbs -ExpectedTaskDigest $taskDigest -ExpectedTaskFile $taskAbs -ExpectedOutputFile $outAbs -ExpectedRunId $runId -ExpectedCycle $cycle -ExpectedRunStartUtc $runStart)) {
      [void]$failures.Add("E_outer_wall_terminal_meta_expected_reconcile_eligible")
    }
    $diagOuter = Get-SilverAdapterMetaMismatchDiagnostics -Meta $metaOuter -ProcessStartUtc $procStart -AdapterOutputPath $outAbs -ExpectedTaskDigest $taskDigest -ExpectedTaskFile $taskAbs -ExpectedOutputFile $outAbs -ExpectedRunId $runId -ExpectedCycle $cycle -ExpectedRunStartUtc $runStart
    if ([string]$diagOuter.cycle_scoped_ok -ne "YES") {
      [void]$failures.Add("E_outer_wall_terminal_expected_cycle_scoped_ok")
    }
    $reconOuter = Resolve-SilverCursorOuterExitFromAdapterMeta -OuterExit 124 -AdapterOutputPath $outAbs -ProcessStartUtc $procStart -ExpectedTaskDigest $taskDigest -ExpectedTaskFile $taskAbs -ExpectedOutputFile $outAbs -ExpectedRunId $runId -ExpectedCycle $cycle -ExpectedRunStartUtc $runStart
    if ([string]$reconOuter.MismatchDiagnostics.exact_mismatch_reason -match "missing_task_file|missing_output_file|output_or_process_end_before") {
      [void]$failures.Add("E_outer_wall_exit124_must_not_false_stale_mismatch")
    }
  }
  finally {
    Remove-Item -LiteralPath $td -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($failures.Count -gt 0) {
    Write-Host "SILVER_ADAPTER_META_FRESHNESS_SELFTEST=FAIL" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host $f -ForegroundColor Red }
    return $false
  }
  Write-Host "SILVER_ADAPTER_META_FRESHNESS_SELFTEST=PASS" -ForegroundColor Green
  Write-Host "engine_changed=NO"
  Write-Host "assets_app_changed=NO"
  return $true
}

function Invoke-SilverCap50RealAutonomousLifecycleOrderingSelfTest {
  $failures = New-Object System.Collections.Generic.List[string]
  $loopPath = Join-Path $PSScriptRoot "silver-autopilot-loop.ps1"
  if (-not (Test-Path -LiteralPath $loopPath)) {
    [void]$failures.Add("loop_script_missing")
  }
  else {
    $lines = Get-Content -LiteralPath $loopPath
    $cleanupIdx = -1
    $rearmIdx = -1
    $invokeIdx = -1
    $handoffIdx = -1
    $bridgeIdx = -1
    $outerTerminalIdx = -1
    $metaWaitIdx = -1
    $reconcileIdx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
      $line = [string]$lines[$i]
      if ($line -match 'Reason = "after_autopilot_full_auto_loop"') { $cleanupIdx = $i }
      if ($line -match 'Invoke-SilverAutonomousCycleRearm -RepoRoot \$RepoRoot') { $rearmIdx = $i }
      if ($line -match 'Write-SilverCursorOutputAdapterInvokeStartedMeta') { $invokeIdx = $i }
      if ($line -match 'Invoke-SilverOrchestrationProductHandoffBridge') { $bridgeIdx = $i }
      if ($line -match 'product_task_handoff_missing') { $handoffIdx = $i }
      if ($line -match 'Write-SilverCursorOutputOuterWallTimeoutTerminal -Path \$CursorOutputPath') { $outerTerminalIdx = $i }
      if ($line -match 'Wait-SilverAdapterMetaReadyForReconcile -AdapterOutputPath \$outAbs') { $metaWaitIdx = $i }
      if ($line -match '\$reconcile = Resolve-SilverCursorOuterExitFromAdapterMeta -OuterExit \$ce') { $reconcileIdx = $i }
    }
    if ($cleanupIdx -lt 0) {
      [void]$failures.Add("post_autopilot_cleanup_marker_missing")
    }
    if ($rearmIdx -lt 0) {
      [void]$failures.Add("post_preflight_autonomous_rearm_marker_missing")
    }
    if ($invokeIdx -lt 0) {
      [void]$failures.Add("adapter_invoke_started_meta_marker_missing")
    }
    if (($rearmIdx -ge 0) -and ($invokeIdx -ge 0) -and ($invokeIdx -lt $rearmIdx)) {
      [void]$failures.Add("invoke_started_meta_before_post_preflight_rearm")
    }
    if ($handoffIdx -lt 0) {
      [void]$failures.Add("product_task_handoff_marker_missing")
    }
    if (($cleanupIdx -ge 0) -and ($handoffIdx -ge 0) -and ($handoffIdx -lt $cleanupIdx)) {
      [void]$failures.Add("handoff_guard_before_post_autopilot_cleanup")
    }
    if (($bridgeIdx -ge 0) -and ($handoffIdx -ge 0) -and ($bridgeIdx -gt $handoffIdx)) {
      [void]$failures.Add("handoff_bridge_after_handoff_stop")
    }
    if (($bridgeIdx -ge 0) -and ($cleanupIdx -ge 0) -and ($bridgeIdx -lt $cleanupIdx)) {
      [void]$failures.Add("handoff_bridge_before_post_autopilot_cleanup")
    }
    if (($outerTerminalIdx -ge 0) -and ($metaWaitIdx -ge 0) -and ($metaWaitIdx -lt $outerTerminalIdx)) {
      [void]$failures.Add("meta_wait_before_outer_wall_terminal")
    }
    if (($metaWaitIdx -ge 0) -and ($reconcileIdx -ge 0) -and ($reconcileIdx -lt $metaWaitIdx)) {
      [void]$failures.Add("reconcile_before_meta_wait")
    }
    if (($outerTerminalIdx -ge 0) -and ($reconcileIdx -ge 0) -and ($reconcileIdx -lt $outerTerminalIdx)) {
      [void]$failures.Add("reconcile_before_outer_wall_terminal")
    }
    $policyPath = Join-Path $PSScriptRoot "silver-cap50-orchestration-policy.ps1"
    if (-not (Test-Path -LiteralPath $policyPath)) {
      [void]$failures.Add("orchestration_policy_missing")
    }
    else {
      $policyText = Get-Content -LiteralPath $policyPath -Raw
      if ($policyText -notmatch 'silver-self-correction-audit-report\.json') {
        [void]$failures.Add("audit_report_not_in_runtime_generated_archive_list")
      }
    }
  }
  if ($failures.Count -gt 0) {
    Write-Host "SILVER_CAP50_REAL_AUTONOMOUS_LIFECYCLE_ORDERING_SELFTEST=FAIL" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host $f -ForegroundColor Red }
    return $false
  }
  Write-Host "SILVER_CAP50_REAL_AUTONOMOUS_LIFECYCLE_ORDERING_SELFTEST=PASS" -ForegroundColor Green
  return $true
}

function Invoke-SilverWslAgentModelAutoHandoffSelfTest {
  param([string]$RepoRoot)
  $failures = New-Object System.Collections.Generic.List[string]
  $adapterScript = Join-Path $RepoRoot "scripts\silver-cursor-agent-adapter.ps1"
  if (-not (Test-Path -LiteralPath $adapterScript)) {
    [void]$failures.Add("missing_adapter_script")
  }
  else {
    $adapterSrc = [System.IO.File]::ReadAllText($adapterScript, (New-Object System.Text.UTF8Encoding $false))
    if ($adapterSrc -notmatch '--model\s') {
      [void]$failures.Add("adapter_wsl_bash_script_missing_model_flag")
    }
    if ($adapterSrc -notmatch 'WslAgentModel\s*=\s*"auto"') {
      [void]$failures.Add("adapter_default_wsl_agent_model_not_auto")
    }
  }
  $dryOut = Join-Path $env:TEMP ("silver-wsl-model-handoff-dry-" + [guid]::NewGuid().ToString("N") + ".md")
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $dry = & powershell -NoProfile -ExecutionPolicy Bypass -File $adapterScript -WslUbuntuAgent -DryRun -TaskFile "SILVER_NEXT_ACTION.md" -OutputFile $dryOut -WslAgentModel auto 2>&1
    $dryText = ($dry | ForEach-Object { [string]$_ }) -join "`n"
    if ($dryText -notmatch 'wsl_agent_model=auto') {
      [void]$failures.Add("dry_run_missing_wsl_agent_model_auto")
    }
  }
  catch {
    [void]$failures.Add("dry_run_exception:" + $_.Exception.Message)
  }
  finally {
    $ErrorActionPreference = $prevEa
    if (Test-Path -LiteralPath $dryOut) {
      Remove-Item -LiteralPath $dryOut -Force -ErrorAction SilentlyContinue
    }
  }
  $diagPath = Join-Path $RepoRoot "scripts\silver-cursor-agent-adapter-diagnostic-report.json"
  $liveOk = "SKIPPED"
  if (Test-Path -LiteralPath $diagPath) {
    try {
      $diagJson = [System.IO.File]::ReadAllText($diagPath, (New-Object System.Text.UTF8Encoding $false)) | ConvertFrom-Json
      $wslReady = [string]$diagJson.wsl_cursor_agent_print_ask_trust.adapter_ready
      if ($wslReady -eq "YES") {
        $utf8 = $script:SilverUtf8NoBom
        if ($null -eq $utf8) {
          $utf8 = New-Object System.Text.UTF8Encoding $false
        }
        $taskPath = Join-Path $env:TEMP ("silver-wsl-model-handoff-live-task-" + [guid]::NewGuid().ToString("N") + ".md")
        $outPath = Join-Path $env:TEMP ("silver-wsl-model-handoff-live-out-" + [guid]::NewGuid().ToString("N") + ".md")
        $taskBody = "Print exactly: SILVER_WSL_MODEL_AUTO_HANDOFF_OK`r`nDo not modify files.`r`n"
        [System.IO.File]::WriteAllText($taskPath, $taskBody, $utf8)
        $prevEa2 = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
          $liveExit = 255
          & powershell -NoProfile -ExecutionPolicy Bypass -File $adapterScript -WslUbuntuAgent -TaskFile $taskPath -OutputFile $outPath -TimeoutSeconds 180 -WslAgentModel auto 2>$null
          if ($null -ne $LASTEXITCODE) { $liveExit = [int]$LASTEXITCODE }
          $liveMeta = @{}
          if (Test-Path -LiteralPath $outPath) {
            $liveMeta = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $outPath
          }
          $liveBody = ""
          if (Test-Path -LiteralPath $outPath) {
            $liveBody = [System.IO.File]::ReadAllText($outPath, $utf8)
          }
          if ($liveExit -ne 0) {
            [void]$failures.Add("live_handoff_exit_expected_0_got_" + [string]$liveExit)
          }
          if ($liveBody -notmatch 'SILVER_WSL_MODEL_AUTO_HANDOFF_OK') {
            [void]$failures.Add("live_handoff_stdout_missing_marker")
          }
          if ($liveBody -match 'Named models unavailable|Free plans can only use Auto') {
            [void]$failures.Add("live_handoff_stderr_plan_model_restriction")
          }
          if ([string]$liveMeta["wsl_agent_model"] -ne "auto") {
            [void]$failures.Add("live_handoff_meta_wsl_agent_model_not_auto")
          }
          if ([string]$liveMeta["adapter_output_state"] -ne "COMPLETED") {
            [void]$failures.Add("live_handoff_meta_not_completed")
          }
          $liveOk = "PASS"
        }
        catch {
          [void]$failures.Add("live_handoff_exception:" + $_.Exception.Message)
          $liveOk = "FAIL"
        }
        finally {
          $ErrorActionPreference = $prevEa2
          foreach ($p in @($taskPath, $outPath)) {
            if ($p -and (Test-Path -LiteralPath $p)) {
              Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
            }
          }
        }
      }
    }
    catch {
      [void]$failures.Add("diag_json_read_failed")
    }
  }
  if ($failures.Count -gt 0) {
    Write-Host "SILVER_WSL_AGENT_MODEL_AUTO_HANDOFF_SELFTEST=FAIL" -ForegroundColor Red
    foreach ($f in $failures) {
      Write-Host ("failure=" + [string]$f) -ForegroundColor Red
    }
    Write-Host ("live_probe=" + $liveOk) -ForegroundColor Red
    return $false
  }
  Write-Host "SILVER_WSL_AGENT_MODEL_AUTO_HANDOFF_SELFTEST=PASS" -ForegroundColor Green
  Write-Host ("live_probe=" + $liveOk) -ForegroundColor Green
  return $true
}

function Invoke-SilverAutonomousRearmSelfTest {
  param([string]$RepoRoot)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $failures = New-Object System.Collections.Generic.List[string]
  $td = Join-Path $env:TEMP ("silver-autonomous-rearm-selftest-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $td -Force | Out-Null
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    Set-Location -LiteralPath $td
    & git init 2>$null | Out-Null
    & git config user.email "silver-rearm-selftest@local" 2>$null
    & git config user.name "silver-rearm-selftest" 2>$null
    [System.IO.File]::WriteAllText((Join-Path $td ".gitignore"), ".silver-runtime/`n", $utf8)
    foreach ($n in @("SILVER_PROGRESS_LOG.md", "SILVER_NEXT_ACTION.md", "SILVER_CURSOR_OUTPUT.md", "SILVER_RUN_REPORT.md")) {
      [System.IO.File]::WriteAllText((Join-Path $td $n), "# " + $n + "`n", $utf8)
    }
    & git add .gitignore SILVER_PROGRESS_LOG.md SILVER_NEXT_ACTION.md SILVER_CURSOR_OUTPUT.md SILVER_RUN_REPORT.md 2>$null
    & git commit -m "init" 2>$null | Out-Null
    $staleRun = "stale-run-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    $staleStart = "2026-05-18T09:48:28.3854633Z"
    Write-SilverCursorOutputInvalidatedStub -Path (Join-Path $td "SILVER_CURSOR_OUTPUT.md") -RunId $staleRun -RunStartUtcIso $staleStart -CycleState "38" -RepoRoot $td
    $script:SilverAutonomousRunId = ""
    $script:SilverAutonomousRunStartUtc = [datetime]::MinValue
    Remove-Item Env:\SILVER_AUTONOMOUS_RUN_ID -ErrorAction SilentlyContinue
    Remove-Item Env:\SILVER_AUTONOMOUS_RUN_START_UTC -ErrorAction SilentlyContinue
    Remove-Item Env:\SILVER_AUTONOMOUS_CYCLE -ErrorAction SilentlyContinue
    $pf = Invoke-SilverCap50PreflightCleanup -RepoRoot $td
    if ($pf.safe_to_start_cycle -ne "YES") {
      [void]$failures.Add("preflight_safe_to_start_expected_YES")
    }
    $cursorOut = Join-Path $td "SILVER_CURSOR_OUTPUT.md"
    $rearm = Invoke-SilverAutonomousCycleRearm -RepoRoot $td -CursorOutputPath $cursorOut -Cycle 1
    if ([string]$rearm.PASS_FAIL -ne "PASS") {
      [void]$failures.Add("rearm_PASS_FAIL_expected_PASS")
    }
    $metaRearm = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $cursorOut
    if ([string]$metaRearm["adapter_output_state"] -ne "INVALIDATED_AWAITING_CYCLE") {
      [void]$failures.Add("rearm_state_expected_INVALIDATED_AWAITING_CYCLE")
    }
    if ([string]$metaRearm["autonomous_cycle"] -ne "1") {
      [void]$failures.Add("rearm_cycle_expected_1")
    }
    if ([string]$metaRearm["autonomous_run_id"] -eq $staleRun) {
      [void]$failures.Add("rearm_run_id_must_not_remain_stale")
    }
    if ([string]$metaRearm["process_start_utc"].Trim().Length -gt 0) {
      [void]$failures.Add("rearm_stub_process_start_must_be_empty_before_adapter")
    }
    $procStart = (Get-Date).ToUniversalTime()
    $taskPath = Join-Path $td "SILVER_NEXT_ACTION.md"
    $taskAbs = (Resolve-Path -LiteralPath $taskPath).Path
    $outAbs = (Resolve-Path -LiteralPath $cursorOut).Path
    $digest = Get-SilverTaskUtf8Sha256HexPrefix -Text "# SILVER_NEXT_ACTION.md`n"
    $startIso = $procStart.ToString("o")
    $endIso = $procStart.AddSeconds(5).ToString("o")
    $completedBody = @"
# silver-cursor-agent-adapter
autonomous_run_id=$([string]$metaRearm["autonomous_run_id"])
autonomous_run_start_utc=$([string]$metaRearm["autonomous_run_start_utc"])
autonomous_cycle=1
adapter_output_state=COMPLETED
task_file=$taskAbs
output_file=$outAbs
task_digest=$digest
process_start_utc=$startIso
process_end_utc=$endIso
exit_code=0
timed_out=NO
stdout_nonempty=YES

# stdout
selftest adapter flush ok

# stderr

"@
    [System.IO.File]::WriteAllText($cursorOut, $completedBody, $utf8)
    $boundary = Test-SilverAutonomousAdapterCompletionBoundary -AdapterOutputPath $outAbs -ProcessStartUtc $procStart -ExpectedTaskDigest $digest -ExpectedTaskFile $taskAbs -ExpectedOutputFile $outAbs -ExpectedRunId ([string]$metaRearm["autonomous_run_id"]) -ExpectedCycle "1" -ExpectedRunStartUtc ([string]$metaRearm["autonomous_run_start_utc"])
    if ($boundary.PASS_FAIL -ne "PASS") {
      [void]$failures.Add("post_flush_boundary_expected_PASS:" + [string]$boundary.lifecycle_block_reason)
    }
  }
  finally {
    $ErrorActionPreference = $prevEa
    Set-Location -LiteralPath $RepoRoot
    Remove-Item -LiteralPath $td -Recurse -Force -ErrorAction SilentlyContinue
    $script:SilverAutonomousRunId = ""
    $script:SilverAutonomousRunStartUtc = [datetime]::MinValue
    Remove-Item Env:\SILVER_AUTONOMOUS_RUN_ID -ErrorAction SilentlyContinue
    Remove-Item Env:\SILVER_AUTONOMOUS_RUN_START_UTC -ErrorAction SilentlyContinue
    Remove-Item Env:\SILVER_AUTONOMOUS_CYCLE -ErrorAction SilentlyContinue
  }
  if ($failures.Count -gt 0) {
    Write-Host "SILVER_AUTONOMOUS_REARM_SELFTEST=FAIL" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host $f -ForegroundColor Red }
    return $false
  }
  Write-Host "SILVER_AUTONOMOUS_REARM_SELFTEST=PASS" -ForegroundColor Green
  Write-Host "engine_changed=NO"
  Write-Host "assets_app_changed=NO"
  return $true
}

function Invoke-SilverStaleInvokeWatchdogSelfTest {
  param([string]$RepoRoot)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $failures = New-Object System.Collections.Generic.List[string]
  $td = Join-Path $env:TEMP ("silver-stale-invoke-watchdog-selftest-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $td -Force | Out-Null
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    Set-Location -LiteralPath $td
    & git init 2>$null | Out-Null
    & git config user.email "silver-stale-invoke-selftest@local" 2>$null
    & git config user.name "silver-stale-invoke-selftest" 2>$null
    [System.IO.File]::WriteAllText((Join-Path $td ".gitignore"), ".silver-runtime/`n", $utf8)
    foreach ($n in @("SILVER_PROGRESS_LOG.md", "SILVER_NEXT_ACTION.md", "SILVER_CURSOR_OUTPUT.md", "SILVER_RUN_REPORT.md")) {
      [System.IO.File]::WriteAllText((Join-Path $td $n), "# " + $n + "`n", $utf8)
    }
    & git add .gitignore SILVER_PROGRESS_LOG.md SILVER_NEXT_ACTION.md SILVER_CURSOR_OUTPUT.md SILVER_RUN_REPORT.md 2>$null
    & git commit -m "init" 2>$null | Out-Null
    $cursorOut = Join-Path $td "SILVER_CURSOR_OUTPUT.md"
    $taskPath = Join-Path $td "SILVER_NEXT_ACTION.md"
    $taskAbs = (Resolve-Path -LiteralPath $taskPath).Path
    $outAbs = (Resolve-Path -LiteralPath $cursorOut).Path
    $digest = Get-SilverTaskUtf8Sha256HexPrefix -Text "# SILVER_NEXT_ACTION.md`n"
    $invokeIso = (Get-Date).ToUniversalTime().ToString("o")
    $env:SILVER_AUTONOMOUS_RUN_ID = "stale-watchdog-run"
    $env:SILVER_AUTONOMOUS_RUN_START_UTC = $invokeIso
    $env:SILVER_AUTONOMOUS_CYCLE = "1"
    Write-SilverCursorOutputAdapterInvokeStartedMeta -Path $cursorOut `
      -RunId "stale-watchdog-run" -RunStartUtcIso $invokeIso -CycleState "1" `
      -TaskFile $taskAbs -OutputFile $outAbs -TaskDigest $digest -ProcessStartUtcIso $invokeIso
    if (-not (Test-SilverStaleInvokeStartedMetaState -AdapterOutputPath $cursorOut)) {
      [void]$failures.Add("stale_meta_state_expected_INVOKE_STARTED_empty_exit_elapsed")
    }
    $fi0 = Get-Item -LiteralPath $cursorOut
    $snap = @{
      output_last_write_before = $fi0.LastWriteTimeUtc.ToString("o")
      output_length_before = [string]$fi0.Length
      process_progress_detected = "NO"
      wsl_agent_progress_detected = "NO"
    }
    $close = Invoke-SilverStaleCursorInvokeCloseout -RepoRoot $td -AdapterOutputPath $outAbs -Process $null `
      -StdoutTmp "" -StderrTmp "" -TaskDigest $digest -TaskFile $taskAbs -OutputFile $outAbs `
      -ProcessStartUtc ([datetime]::Parse($invokeIso, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)) `
      -ProgressSnapshotBefore $snap
    if ([string]$close.PASS_FAIL -ne "FAIL") {
      [void]$failures.Add("closeout_PASS_FAIL_expected_FAIL")
    }
    if ([string]$close.stop_reason -ne "STALE_CURSOR_INVOKE_NO_PROGRESS") {
      [void]$failures.Add("closeout_stop_reason_expected_STALE_CURSOR_INVOKE_NO_PROGRESS")
    }
    if ([string]$close.adapter_output_state -ne "COMPLETED") {
      [void]$failures.Add("closeout_adapter_output_state_expected_COMPLETED")
    }
    if (-not (Test-GitStatusClean -Cwd $td)) {
      [void]$failures.Add("repo_not_clean_after_stale_closeout")
    }
    $archHit = Get-ChildItem -LiteralPath (Join-Path $td ".silver-runtime\failures") -Recurse -Filter "SILVER_CURSOR_OUTPUT.md" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $archHit) {
      [void]$failures.Add("stale_invoke_archive_missing_cursor_output")
    }
    else {
      $archMeta = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $archHit.FullName
      if ([string]$archMeta["exit_code"] -ne "125") {
        [void]$failures.Add("archived_closeout_exit_code_expected_125")
      }
    }
    $prevSlice = $env:SILVER_STALE_INVOKE_SLICE_SECONDS
    $prevStall = $env:SILVER_STALE_INVOKE_STALL_SECONDS
    $env:SILVER_STALE_INVOKE_SLICE_SECONDS = "2"
    $env:SILVER_STALE_INVOKE_STALL_SECONDS = "4"
    $watchOut = Join-Path $td "SILVER_CURSOR_OUTPUT_watchdog.md"
    $watchDigest = Get-SilverTaskUtf8Sha256HexPrefix -Text "# SILVER_NEXT_ACTION.md`nwatchdog`n"
    $watchIso = (Get-Date).ToUniversalTime().ToString("o")
    Write-SilverCursorOutputAdapterInvokeStartedMeta -Path $watchOut `
      -RunId "stale-watchdog-run" -RunStartUtcIso $watchIso -CycleState "1" `
      -TaskFile $taskAbs -OutputFile $watchOut -TaskDigest $watchDigest -ProcessStartUtcIso $watchIso
    $psiWatch = New-Object System.Diagnostics.ProcessStartInfo
    $psiWatch.FileName = "powershell.exe"
    $psiWatch.Arguments = "-NoProfile -Command Start-Sleep -Seconds 600"
    $psiWatch.UseShellExecute = $false
    $psiWatch.CreateNoWindow = $true
    $pWatch = [System.Diagnostics.Process]::Start($psiWatch)
    if ($null -eq $pWatch) {
      [void]$failures.Add("watchdog_hung_process_start_failed")
    }
    else {
      try {
        $watchWait = Wait-SilverCursorInvokeWithStaleWatchdog -Process $pWatch -AdapterOutputPath $watchOut `
          -StdoutTmp "" -StderrTmp "" -OuterWaitMs 120000 -RepoRoot $td
        if (-not [bool]$watchWait.StaleInvokeDetected) {
          [void]$failures.Add("watchdog_wait_expected_StaleInvokeDetected_with_wsl_present")
        }
        if ([int]$watchWait.ExitCode -ne 125) {
          [void]$failures.Add("watchdog_wait_exit_code_expected_125")
        }
        if ($pWatch -and (-not $pWatch.HasExited)) {
          try { Stop-Process -Id $pWatch.Id -Force -ErrorAction SilentlyContinue } catch { }
        }
      }
      finally {
        if ($pWatch -and (-not $pWatch.HasExited)) {
          try { Stop-Process -Id $pWatch.Id -Force -ErrorAction SilentlyContinue } catch { }
        }
      }
    }
    if ($null -ne $prevSlice) { $env:SILVER_STALE_INVOKE_SLICE_SECONDS = $prevSlice } else { Remove-Item Env:\SILVER_STALE_INVOKE_SLICE_SECONDS -ErrorAction SilentlyContinue }
    if ($null -ne $prevStall) { $env:SILVER_STALE_INVOKE_STALL_SECONDS = $prevStall } else { Remove-Item Env:\SILVER_STALE_INVOKE_STALL_SECONDS -ErrorAction SilentlyContinue }
    $mojibakeSample = ([string][char]0x0102 + [char]0x0161 + "KOL PRO CURSOR")
    [System.IO.File]::WriteAllText($taskPath, $mojibakeSample + "`n", $utf8)
    $gate = Invoke-SilverCap50Utf8SurfacesHardGate -RepoRoot $td -NextActionPath $taskPath -CursorOutputPath $cursorOut
    if ($gate.PASS_FAIL -ne "FAIL") {
      [void]$failures.Add("mojibake_pre_invoke_gate_expected_FAIL")
    }
    & git restore --source=HEAD --worktree -- SILVER_NEXT_ACTION.md 2>$null
  }
  finally {
    $ErrorActionPreference = $prevEa
    Set-Location -LiteralPath $RepoRoot
    Remove-Item -LiteralPath $td -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item Env:\SILVER_AUTONOMOUS_RUN_ID -ErrorAction SilentlyContinue
    Remove-Item Env:\SILVER_AUTONOMOUS_RUN_START_UTC -ErrorAction SilentlyContinue
    Remove-Item Env:\SILVER_AUTONOMOUS_CYCLE -ErrorAction SilentlyContinue
  }
  if ($failures.Count -gt 0) {
    Write-Host "SILVER_STALE_INVOKE_WATCHDOG_SELFTEST=FAIL" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host $f -ForegroundColor Red }
    return $false
  }
  Write-Host "SILVER_STALE_INVOKE_WATCHDOG_SELFTEST=PASS" -ForegroundColor Green
  Write-Host "engine_changed=NO"
  Write-Host "assets_app_changed=NO"
  return $true
}

function Invoke-SilverStaleCursorInvokeHardeningSelfTest {
  param([string]$RepoRoot)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $failures = New-Object System.Collections.Generic.List[string]
  $td = Join-Path $env:TEMP ("silver-stale-cursor-hardening-selftest-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $td -Force | Out-Null
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    Set-Location -LiteralPath $td
    & git init 2>$null | Out-Null
    & git config user.email "silver-stale-hardening-selftest@local" 2>$null
    & git config user.name "silver-stale-hardening-selftest" 2>$null
    [System.IO.File]::WriteAllText((Join-Path $td ".gitignore"), ".silver-runtime/`n", $utf8)
    foreach ($n in @("SILVER_PROGRESS_LOG.md", "SILVER_NEXT_ACTION.md", "SILVER_CURSOR_OUTPUT.md", "SILVER_RUN_REPORT.md")) {
      [System.IO.File]::WriteAllText((Join-Path $td $n), "# " + $n + "`n", $utf8)
    }
    & git add .gitignore SILVER_PROGRESS_LOG.md SILVER_NEXT_ACTION.md SILVER_CURSOR_OUTPUT.md SILVER_RUN_REPORT.md 2>$null
    & git commit -m "init" 2>$null | Out-Null
    $cursorOut = Join-Path $td "SILVER_CURSOR_OUTPUT.md"
    $taskPath = Join-Path $td "SILVER_NEXT_ACTION.md"
    $taskAbs = (Resolve-Path -LiteralPath $taskPath).Path
    $outAbs = (Resolve-Path -LiteralPath $cursorOut).Path
    $digest = Get-SilverTaskUtf8Sha256HexPrefix -Text "# SILVER_NEXT_ACTION.md`n"
    $invokeIso = (Get-Date).ToUniversalTime().ToString("o")
    $env:SILVER_AUTONOMOUS_RUN_ID = "stale-hardening-run"
    $env:SILVER_AUTONOMOUS_RUN_START_UTC = $invokeIso
    $env:SILVER_AUTONOMOUS_CYCLE = "1"
    $prevSlice = $env:SILVER_STALE_INVOKE_SLICE_SECONDS
    $prevStall = $env:SILVER_STALE_INVOKE_STALL_SECONDS
    $prevGrace = $env:SILVER_STALE_INVOKE_PROCESS_ALIVE_GRACE_SECONDS
    $env:SILVER_STALE_INVOKE_SLICE_SECONDS = "1"
    $env:SILVER_STALE_INVOKE_STALL_SECONDS = "3"
    $env:SILVER_STALE_INVOKE_PROCESS_ALIVE_GRACE_SECONDS = "30"
    Write-SilverCursorOutputAdapterInvokeStartedMeta -Path $cursorOut `
      -RunId "stale-hardening-run" -RunStartUtcIso $invokeIso -CycleState "1" `
      -TaskFile $taskAbs -OutputFile $outAbs -TaskDigest $digest -ProcessStartUtcIso $invokeIso
    $stdoutTmp = Join-Path $env:TEMP ("silver-stale-hardening-o-" + [guid]::NewGuid().ToString("N") + ".txt")
    $stderrTmp = Join-Path $env:TEMP ("silver-stale-hardening-e-" + [guid]::NewGuid().ToString("N") + ".txt")
    [System.IO.File]::WriteAllText($stdoutTmp, "", $utf8)
    [System.IO.File]::WriteAllText($stderrTmp, "", $utf8)
    $psiHung = New-Object System.Diagnostics.ProcessStartInfo
    $psiHung.FileName = "powershell.exe"
    $psiHung.Arguments = "-NoProfile -Command Start-Sleep -Seconds 600"
    $psiHung.UseShellExecute = $false
    $psiHung.CreateNoWindow = $true
    $pHung = [System.Diagnostics.Process]::Start($psiHung)
    if ($null -eq $pHung) {
      [void]$failures.Add("hung_process_start_failed")
    }
    else {
      try {
        $waitHung = Wait-SilverCursorInvokeWithStaleWatchdog -Process $pHung -AdapterOutputPath $outAbs `
          -StdoutTmp $stdoutTmp -StderrTmp $stderrTmp -OuterWaitMs 60000 -RepoRoot $td
        if (-not [bool]$waitHung.StaleInvokeDetected) {
          [void]$failures.Add("no_output_hung_expected_stale_invoke")
        }
        if ([int]$waitHung.ExitCode -ne 125) {
          [void]$failures.Add("no_output_hung_exit_code_expected_125")
        }
        $classHung = ""
        if ($waitHung.ProgressSnapshotBefore.ContainsKey("stale_invoke_classification")) {
          $classHung = [string]$waitHung.ProgressSnapshotBefore.stale_invoke_classification
        }
        if ($classHung -ne "CURSOR_PROCESS_ALIVE_BUT_NO_OUTPUT" -and $classHung -ne "STALE_CURSOR_INVOKE_NO_PROGRESS_TRUE") {
          [void]$failures.Add("no_output_hung_classification_expected_alive_or_true_stale")
        }
      }
      finally {
        if ($pHung -and (-not $pHung.HasExited)) {
          try { Stop-Process -Id $pHung.Id -Force -ErrorAction SilentlyContinue } catch { }
        }
      }
    }
    $watchOut = Join-Path $td "SILVER_CURSOR_OUTPUT_growth.md"
    $watchIso = (Get-Date).ToUniversalTime().ToString("o")
    Write-SilverCursorOutputAdapterInvokeStartedMeta -Path $watchOut `
      -RunId "stale-hardening-run" -RunStartUtcIso $watchIso -CycleState "1" `
      -TaskFile $taskAbs -OutputFile $watchOut -TaskDigest $digest -ProcessStartUtcIso $watchIso
    $stdoutGrow = Join-Path $env:TEMP ("silver-stale-hardening-grow-o-" + [guid]::NewGuid().ToString("N") + ".txt")
    $stderrGrow = Join-Path $env:TEMP ("silver-stale-hardening-grow-e-" + [guid]::NewGuid().ToString("N") + ".txt")
    [System.IO.File]::WriteAllText($stdoutGrow, "seed`n", $utf8)
    [System.IO.File]::WriteAllText($stderrGrow, "", $utf8)
    $growScript = 'for ($i = 0; $i -lt 8; $i++) { Add-Content -LiteralPath ''' + $stdoutGrow + ''' -Value (''grow'' + [string]$i); Start-Sleep -Seconds 1 }'
    $psiGrow = New-Object System.Diagnostics.ProcessStartInfo
    $psiGrow.FileName = "powershell.exe"
    $psiGrow.Arguments = "-NoProfile -Command " + $growScript
    $psiGrow.UseShellExecute = $false
    $psiGrow.CreateNoWindow = $true
    $pGrow = [System.Diagnostics.Process]::Start($psiGrow)
    if ($null -eq $pGrow) {
      [void]$failures.Add("growth_process_start_failed")
    }
    else {
      try {
        $waitGrow = Wait-SilverCursorInvokeWithStaleWatchdog -Process $pGrow -AdapterOutputPath $watchOut `
          -StdoutTmp $stdoutGrow -StderrTmp $stderrGrow -OuterWaitMs 45000 -RepoRoot $td
        if ([bool]$waitGrow.StaleInvokeDetected) {
          [void]$failures.Add("capture_growth_expected_not_stale")
        }
        if ($waitGrow.ProgressSnapshotBefore.capture_progress_detected -ne "YES") {
          [void]$failures.Add("capture_growth_expected_capture_progress_detected_YES")
        }
      }
      finally {
        if ($pGrow -and (-not $pGrow.HasExited)) {
          try { Stop-Process -Id $pGrow.Id -Force -ErrorAction SilentlyContinue } catch { }
        }
      }
    }
    $graceOut = Join-Path $td "SILVER_CURSOR_OUTPUT_grace.md"
    $graceIso = (Get-Date).ToUniversalTime().ToString("o")
    Write-SilverCursorOutputAdapterInvokeStartedMeta -Path $graceOut `
      -RunId "stale-hardening-run" -RunStartUtcIso $graceIso -CycleState "1" `
      -TaskFile $taskAbs -OutputFile $graceOut -TaskDigest $digest -ProcessStartUtcIso $graceIso
    $stdoutGrace = Join-Path $env:TEMP ("silver-stale-hardening-grace-o-" + [guid]::NewGuid().ToString("N") + ".txt")
    $stderrGrace = Join-Path $env:TEMP ("silver-stale-hardening-grace-e-" + [guid]::NewGuid().ToString("N") + ".txt")
    [System.IO.File]::WriteAllText($stdoutGrace, "", $utf8)
    [System.IO.File]::WriteAllText($stderrGrace, "", $utf8)
    $env:SILVER_STALE_INVOKE_STALL_SECONDS = "2"
    $env:SILVER_STALE_INVOKE_PROCESS_ALIVE_GRACE_SECONDS = "60"
    $psiGrace = New-Object System.Diagnostics.ProcessStartInfo
    $psiGrace.FileName = "powershell.exe"
    $psiGrace.Arguments = "-NoProfile -Command Start-Sleep -Seconds 8"
    $psiGrace.UseShellExecute = $false
    $psiGrace.CreateNoWindow = $true
    $pGrace = [System.Diagnostics.Process]::Start($psiGrace)
    if ($null -eq $pGrace) {
      [void]$failures.Add("grace_process_start_failed")
    }
    else {
      try {
        $waitGrace = Wait-SilverCursorInvokeWithStaleWatchdog -Process $pGrace -AdapterOutputPath $graceOut `
          -StdoutTmp $stdoutGrace -StderrTmp $stderrGrace -OuterWaitMs 20000 -RepoRoot $td
        if ([bool]$waitGrace.StaleInvokeDetected) {
          [void]$failures.Add("alive_grace_window_expected_not_stale")
        }
      }
      finally {
        if ($pGrace -and (-not $pGrace.HasExited)) {
          try { Stop-Process -Id $pGrace.Id -Force -ErrorAction SilentlyContinue } catch { }
        }
      }
    }
    $classFp = Resolve-SilverStaleInvokeClassification -AdapterProgressEver $false -CaptureProgressEver $true `
      -RepoHeartbeatEver $false -WslSeenEver $false -ProcessAlive $true -OutputLenDelta 0 -FalsePositiveBlocked $true
    if ($classFp -ne "STALE_CURSOR_INVOKE_FALSE_POSITIVE_BLOCKED") {
      [void]$failures.Add("classification_false_positive_blocked_expected")
    }
    $classOut = Resolve-SilverStaleInvokeClassification -AdapterProgressEver $false -CaptureProgressEver $true `
      -RepoHeartbeatEver $false -WslSeenEver $false -ProcessAlive $false -OutputLenDelta 64 -FalsePositiveBlocked $false
    if ($classOut -ne "OUTPUT_PROGRESS_DETECTED") {
      [void]$failures.Add("classification_output_progress_expected")
    }
    if ($null -ne $prevSlice) { $env:SILVER_STALE_INVOKE_SLICE_SECONDS = $prevSlice } else { Remove-Item Env:\SILVER_STALE_INVOKE_SLICE_SECONDS -ErrorAction SilentlyContinue }
    if ($null -ne $prevStall) { $env:SILVER_STALE_INVOKE_STALL_SECONDS = $prevStall } else { Remove-Item Env:\SILVER_STALE_INVOKE_STALL_SECONDS -ErrorAction SilentlyContinue }
    if ($null -ne $prevGrace) { $env:SILVER_STALE_INVOKE_PROCESS_ALIVE_GRACE_SECONDS = $prevGrace } else { Remove-Item Env:\SILVER_STALE_INVOKE_PROCESS_ALIVE_GRACE_SECONDS -ErrorAction SilentlyContinue }
  }
  finally {
    $ErrorActionPreference = $prevEa
    Set-Location -LiteralPath $RepoRoot
    Remove-Item -LiteralPath $td -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item Env:\SILVER_AUTONOMOUS_RUN_ID -ErrorAction SilentlyContinue
    Remove-Item Env:\SILVER_AUTONOMOUS_RUN_START_UTC -ErrorAction SilentlyContinue
    Remove-Item Env:\SILVER_AUTONOMOUS_CYCLE -ErrorAction SilentlyContinue
  }
  if ($failures.Count -gt 0) {
    Write-Host "SILVER_STALE_CURSOR_INVOKE_HARDENING_SELFTEST=FAIL" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host $f -ForegroundColor Red }
    return $false
  }
  Write-Host "SILVER_STALE_CURSOR_INVOKE_HARDENING_SELFTEST=PASS" -ForegroundColor Green
  Write-Host "engine_changed=NO"
  Write-Host "assets_app_changed=NO"
  Write-Host "orchestration_only=YES"
  return $true
}

function Invoke-SilverRearmInvokeEdgeCaseSelfTest {
  param([string]$RepoRoot)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $failures = New-Object System.Collections.Generic.List[string]
  $loopPath = Join-Path $RepoRoot "scripts\silver-autopilot-loop.ps1"
  if (-not (Test-Path -LiteralPath $loopPath)) {
    [void]$failures.Add("loop_script_missing")
  }
  else {
    $loopText = [System.IO.File]::ReadAllText($loopPath, $utf8)
    if ($loopText -notmatch 'Write-SilverCursorOutputAdapterInvokeStartedMeta') {
      [void]$failures.Add("invoke_started_meta_writer_missing")
    }
    if ($loopText -notmatch 'adapter_invoke_blocked_cursor_command_missing_after_rearm') {
      [void]$failures.Add("post_rearm_cursor_command_guard_missing")
    }
    if ($loopText -notmatch 'SilverCycleAutonomousRearmPassed') {
      [void]$failures.Add("rearm_pass_cycle_flag_missing")
    }
    $invokeIdx = -1
    $startIdx = -1
    $lines = Get-Content -LiteralPath $loopPath
    for ($i = 0; $i -lt $lines.Count; $i++) {
      $line = [string]$lines[$i]
      if ($line -match 'Write-SilverCursorOutputAdapterInvokeStartedMeta') { $invokeIdx = $i }
      if ($line -match '\$p = \[System\.Diagnostics\.Process\]::Start\(\$psi\)') { $startIdx = $i }
    }
    if (($invokeIdx -lt 0) -or ($startIdx -lt 0) -or ($invokeIdx -gt $startIdx)) {
      [void]$failures.Add("invoke_started_meta_must_precede_process_start")
    }
  }
  $adapterPath = Join-Path $RepoRoot "scripts\silver-cursor-agent-adapter.ps1"
  if (-not (Test-Path -LiteralPath $adapterPath)) {
    [void]$failures.Add("adapter_script_missing")
  }
  else {
    $adapterText = [System.IO.File]::ReadAllText($adapterPath, $utf8)
    if ($adapterText -notmatch 'Write-SilverAdapterCycleStartedEarlyMeta') {
      [void]$failures.Add("adapter_early_invoke_started_meta_missing")
    }
  }
  $td = Join-Path $env:TEMP ("silver-rearm-invoke-edgecase-selftest-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $td -Force | Out-Null
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    Set-Location -LiteralPath $td
    & git init 2>$null | Out-Null
    & git config user.email "silver-rearm-invoke-edgecase@local" 2>$null
    & git config user.name "silver-rearm-invoke-edgecase" 2>$null
    [System.IO.File]::WriteAllText((Join-Path $td ".gitignore"), ".silver-runtime/`n", $utf8)
    foreach ($n in @("SILVER_PROGRESS_LOG.md", "SILVER_NEXT_ACTION.md", "SILVER_CURSOR_OUTPUT.md")) {
      [System.IO.File]::WriteAllText((Join-Path $td $n), "# " + $n + "`n", $utf8)
    }
    & git add .gitignore SILVER_PROGRESS_LOG.md SILVER_NEXT_ACTION.md SILVER_CURSOR_OUTPUT.md 2>$null
    & git commit -m "init" 2>$null | Out-Null
    $cursorOut = Join-Path $td "SILVER_CURSOR_OUTPUT.md"
    $script:SilverAutonomousRunId = "rearm-invoke-edge-run"
    $script:SilverAutonomousRunStartUtc = (Get-Date).ToUniversalTime()
    $env:SILVER_AUTONOMOUS_RUN_ID = $script:SilverAutonomousRunId
    $env:SILVER_AUTONOMOUS_RUN_START_UTC = $script:SilverAutonomousRunStartUtc.ToString("o")
    $env:SILVER_AUTONOMOUS_CYCLE = "1"
    $pf = Invoke-SilverCap50PreflightCleanup -RepoRoot $td
    if ([string]$pf.safe_to_start_cycle -ne "YES") {
      [void]$failures.Add("preflight_safe_to_start_expected_YES")
    }
    $rearm = Invoke-SilverAutonomousCycleRearm -RepoRoot $td -CursorOutputPath $cursorOut -Cycle 1
    if ([string]$rearm.PASS_FAIL -ne "PASS") {
      [void]$failures.Add("rearm_PASS_FAIL_expected_PASS")
    }
    $metaRearm = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $cursorOut
    if ([string]$metaRearm["adapter_output_state"] -ne "INVALIDATED_AWAITING_CYCLE") {
      [void]$failures.Add("post_rearm_state_expected_INVALIDATED_AWAITING_CYCLE")
    }
    if ([string]$metaRearm["process_start_utc"].Trim().Length -gt 0) {
      [void]$failures.Add("post_rearm_process_start_must_be_empty")
    }
    $taskPath = Join-Path $td "SILVER_NEXT_ACTION.md"
    $taskAbs = (Resolve-Path -LiteralPath $taskPath).Path
    $outAbs = (Resolve-Path -LiteralPath $cursorOut).Path
    $digest = Get-SilverTaskUtf8Sha256HexPrefix -Text "# SILVER_NEXT_ACTION.md`n"
    $invokeIso = (Get-Date).ToUniversalTime().ToString("o")
    $runCtx = Get-SilverAutonomousRunContext
    Write-SilverCursorOutputAdapterInvokeStartedMeta -Path $cursorOut `
      -RunId $runCtx.RunId -RunStartUtcIso $runCtx.RunStartUtc -CycleState $runCtx.Cycle `
      -TaskFile $taskAbs -OutputFile $outAbs -TaskDigest $digest -ProcessStartUtcIso $invokeIso
    if (-not (Test-SilverAdapterInvokeStartedEvidence -AdapterOutputPath $cursorOut)) {
      [void]$failures.Add("invoke_started_evidence_expected_PASS")
    }
    $metaInvoke = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $cursorOut
    if ([string]$metaInvoke["adapter_output_state"] -ne "INVOKE_STARTED") {
      [void]$failures.Add("invoke_started_state_expected_INVOKE_STARTED")
    }
    if ([string]$metaInvoke["process_start_utc"].Trim().Length -eq 0) {
      [void]$failures.Add("invoke_started_process_start_utc_missing")
    }
    if ([string]$metaInvoke["task_digest"] -ne $digest) {
      [void]$failures.Add("invoke_started_task_digest_mismatch")
    }
    $boundaryPending = Test-SilverAutonomousAdapterCompletionBoundary -AdapterOutputPath $outAbs -ProcessStartUtc ([datetime]::Parse($invokeIso, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)) -ExpectedTaskDigest $digest -ExpectedTaskFile $taskAbs -ExpectedOutputFile $outAbs -ExpectedRunId $runCtx.RunId -ExpectedCycle "1" -ExpectedRunStartUtc $runCtx.RunStartUtc
    if ($boundaryPending.PASS_FAIL -eq "PASS") {
      [void]$failures.Add("invoke_started_boundary_must_not_PASS_before_adapter_completion")
    }
    if ([string]$boundaryPending.lifecycle_block_reason -notmatch 'adapter_invoke_started_but_not_completed') {
      [void]$failures.Add("invoke_started_boundary_reason_expected_not_completed")
    }
    $capLabel = ""
    if (Get-Command -Name Get-SilverCapRunLabel -ErrorAction SilentlyContinue) {
      $capLabel = Get-SilverCapRunLabel -ControlledInfinite $true -MaxCycles 0 -MaxAutonomousHardCycles 10 -RepoRoot $td
    }
    if ($capLabel -ne "CAP10") {
      [void]$failures.Add("product_cap_path_label_expected_CAP10_got_" + [string]$capLabel)
    }
  }
  finally {
    $ErrorActionPreference = $prevEa
    Set-Location -LiteralPath $RepoRoot
    Remove-Item -LiteralPath $td -Recurse -Force -ErrorAction SilentlyContinue
    $script:SilverAutonomousRunId = ""
    $script:SilverAutonomousRunStartUtc = [datetime]::MinValue
    Remove-Item Env:\SILVER_AUTONOMOUS_RUN_ID -ErrorAction SilentlyContinue
    Remove-Item Env:\SILVER_AUTONOMOUS_RUN_START_UTC -ErrorAction SilentlyContinue
    Remove-Item Env:\SILVER_AUTONOMOUS_CYCLE -ErrorAction SilentlyContinue
  }
  if ($failures.Count -gt 0) {
    Write-Host "SILVER_REARM_INVOKE_EDGECASE_SELFTEST=FAIL" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host $f -ForegroundColor Red }
    return $false
  }
  Write-Host "SILVER_REARM_INVOKE_EDGECASE_SELFTEST=PASS" -ForegroundColor Green
  Write-Host "engine_changed=NO"
  Write-Host "assets_app_changed=NO"
  return $true
}

function Invoke-SilverCap50GitNotCleanAfterRestoreSelfTest {
  param([string]$RepoRoot)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $failures = New-Object System.Collections.Generic.List[string]
  $td = Join-Path $env:TEMP ("silver-git-not-clean-restore-selftest-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $td -Force | Out-Null
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    Set-Location -LiteralPath $td
    & git init 2>$null | Out-Null
    & git config user.email "silver-git-clean-selftest@local" 2>$null
    & git config user.name "silver-git-clean-selftest" 2>$null
    [System.IO.File]::WriteAllText((Join-Path $td ".gitignore"), ".silver-runtime/`n", $utf8)
    $names = @("SILVER_PROGRESS_LOG.md", "SILVER_NEXT_ACTION.md", "SILVER_CURSOR_OUTPUT.md", "SILVER_RUN_REPORT.md")
    foreach ($n in $names) {
      [System.IO.File]::WriteAllText((Join-Path $td $n), "# " + $n + "`n", $utf8)
    }
    & git add .gitignore SILVER_PROGRESS_LOG.md SILVER_NEXT_ACTION.md SILVER_CURSOR_OUTPUT.md SILVER_RUN_REPORT.md 2>$null
    & git commit -m "init" 2>$null | Out-Null
    foreach ($n in $names) {
      [System.IO.File]::WriteAllText((Join-Path $td $n), "# dirty " + $n + "`n", $utf8)
    }
    & git add SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md 2>$null
    [System.IO.File]::WriteAllText((Join-Path $td "SILVER_RUN_REPORT.md"), "# dirty staged+worktree`n", $utf8)
    if (Test-GitStatusClean -Cwd $td) {
      [void]$failures.Add("repo_should_be_dirty_before_orchestration_closeout")
    }
    $pfFirst = Invoke-SilverCap50PreflightCleanup -RepoRoot $td
    if ($pfFirst.PASS_FAIL -ne "PASS") {
      [void]$failures.Add("preflight_runtime_only_should_pass_after_staged_worktree_restore")
    }
    foreach ($n in $names) {
      foreach ($sp in (Get-GitStatusShortPaths -Cwd $td)) {
        if ([string]::Equals(($sp -replace '\\', '/'), $n, [System.StringComparison]::OrdinalIgnoreCase)) {
          [void]$failures.Add("preflight_left_runtime_dirty:" + $n)
        }
      }
    }
    foreach ($n in $names) {
      [System.IO.File]::WriteAllText((Join-Path $td $n), "# dirty again " + $n + "`n", $utf8)
    }
    & git add SILVER_PROGRESS_LOG.md SILVER_RUN_REPORT.md 2>$null
    [System.IO.File]::WriteAllText((Join-Path $td "SILVER_RUN_REPORT.md"), "# dirty staged+worktree again`n", $utf8)
    if (Test-GitStatusClean -Cwd $td) {
      [void]$failures.Add("repo_should_be_dirty_before_orchestration_closeout_retry")
    }
    $baselines = Get-BaselineProgressMetrics
    $closeFields = @{
      timestamp = (Get-Date).ToString("s")
      cycle = "20"
      main_commit = "deadbeef"
      last_task_exit = "1"
      cursor_exit = "N/A"
      autopilot_exit = "N/A"
      autopilot_status_exit = "N/A"
      git_status_clean = "NO"
      safety_counters = "dangerous_write_count=0;false_write_count=0;query_created_write_count=0;write_when_negated_count=0"
      calendar_write_20k = "SKIPPED"
      calendar_query_20k = "SKIPPED"
      core_engine_progress = $baselines.core_engine_progress
      safety_progress = $baselines.safety_progress
      routing_progress = $baselines.routing_progress
      retrieval_progress = $baselines.retrieval_progress
      real_human_chaos_progress = $baselines.real_human_chaos_progress
      multi_intent_orchestration_progress = $baselines.multi_intent_orchestration_progress
      long_session_memory_progress = $baselines.long_session_memory_progress
      public_ready_progress = $baselines.public_ready_progress
      source = "selftest"
      current_focus = "cap50_preflight_cleanup_blocked"
      next_action_headline = "selftest"
      dry_run = "NO"
      stop_reason = "git_not_clean_after_restore"
    }
    $close = Invoke-SilverCap50OrchestrationRuntimeCloseout -RepoRoot $td -Cycle 20 -Reason "selftest_git_not_clean_after_restore" -ProgressLogFields $closeFields -ProgressOutcome "FAIL" -CloseoutKind "runtime_artifact_restorable"
    if ($close.PASS_FAIL -ne "PASS") {
      [void]$failures.Add("orchestration_closeout_runtime_only:" + [string]$close.blocked_dirty_files + "|" + [string]$close.remaining_forbidden_dirty_files)
    }
    if (-not (Test-GitStatusClean -Cwd $td)) {
      [void]$failures.Add("repo_not_clean_after_orchestration_closeout")
    }
    foreach ($n in $names) {
      foreach ($sp in (Get-GitStatusShortPaths -Cwd $td)) {
        if ([string]::Equals(($sp -replace '\\', '/'), $n, [System.StringComparison]::OrdinalIgnoreCase)) {
          [void]$failures.Add("runtime_file_still_dirty:" + $n)
        }
      }
    }
    if ([string]$close.closeout_kind -ne "clean") {
      [void]$failures.Add("closeout_kind_expected_clean_got_" + [string]$close.closeout_kind)
    }
    $archFull = ""
    if ([string]$close.timeout_archive_path) {
      $archFull = Join-Path $td (($close.timeout_archive_path -replace '/', '\'))
    }
    if (-not $archFull -or -not (Test-Path -LiteralPath (Join-Path $archFull "SILVER_PROGRESS_LOG.md"))) {
      [void]$failures.Add("archived_progress_log_missing")
    }
    $staleFields = @{}
    Add-SilverCycleFieldsFromAdapterOutput -Fields $staleFields -AdapterOutputPath (Join-Path $td "SILVER_CURSOR_OUTPUT.md") -CursorInvoked $false -ExpectedRunId "run-selftest" -ExpectedCycle "20"
    if ([string]$staleFields["silver_cycle_adapter_meta_fresh"] -ne "NO") {
      [void]$failures.Add("stale_meta_adapter_fresh_expected_NO")
    }
    if ([string]$staleFields["silver_cycle_stale_meta_skipped"] -ne "YES") {
      [void]$failures.Add("stale_meta_skipped_expected_YES")
    }
    if ($staleFields.ContainsKey("silver_cycle_real_stale_adapter_meta_issue")) {
      [void]$failures.Add("stale_meta_must_not_set_real_stale_issue_when_cursor_not_invoked")
    }
    New-Item -ItemType Directory -Path (Join-Path $td "assets") -Force -ErrorAction SilentlyContinue | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $td "assets/app.js"), "// dirty`n", $utf8)
    & git add assets/app.js 2>$null
    & git commit -m "assets" 2>$null | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $td "assets/app.js"), "// dirty2`n", $utf8)
    $resAssets = Invoke-SilverCap50PreflightCleanup -RepoRoot $td
    if ($resAssets.PASS_FAIL -ne "FAIL") {
      [void]$failures.Add("assets_app_dirty_should_fail_preflight")
    }
    if ([string]$resAssets.failure_class -ne "forbidden_product_dirty") {
      [void]$failures.Add("assets_app_failure_class_expected_forbidden_product_dirty")
    }
    Invoke-SilverGitRestoreWorktreePaths -RepoRoot $td -RelPaths @("assets/app.js")
    [System.IO.File]::WriteAllText((Join-Path $td "SILVER_CAP50_GIT_CLEAN_SELFTEST_BLOCK.txt"), "forbidden`n", $utf8)
    $resUnknown = Invoke-SilverCap50PreflightCleanup -RepoRoot $td
    if ($resUnknown.PASS_FAIL -ne "FAIL") {
      [void]$failures.Add("unknown_dirty_should_fail_preflight")
    }
    if ([string]$resUnknown.failure_class -ne "forbidden_dirty") {
      [void]$failures.Add("unknown_failure_class_expected_forbidden_dirty")
    }
    if (Test-Path -LiteralPath (Join-Path $td "SILVER_CAP50_GIT_CLEAN_SELFTEST_BLOCK.txt")) {
      Remove-Item -LiteralPath (Join-Path $td "SILVER_CAP50_GIT_CLEAN_SELFTEST_BLOCK.txt") -Force -ErrorAction SilentlyContinue
    }
    $safetyLine = "dangerous_write_count=1;false_write_count=0;query_created_write_count=0;write_when_negated_count=0"
    if (-not (Test-SafetyCountersBlocked -SafetyCountersLine $safetyLine)) {
      [void]$failures.Add("safety_guard_must_still_block_nonzero_dangerous_write")
    }
  }
  finally {
    $ErrorActionPreference = $prevEa
    Set-Location -LiteralPath $RepoRoot
    Remove-Item -LiteralPath $td -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($failures.Count -gt 0) {
    Write-Host "SILVER_CAP50_GIT_NOT_CLEAN_AFTER_RESTORE_SELFTEST=FAIL" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host $f -ForegroundColor Red }
    return $false
  }
  Write-Host "SILVER_CAP50_GIT_NOT_CLEAN_AFTER_RESTORE_SELFTEST=PASS" -ForegroundColor Green
  return $true
}

function Invoke-SilverCap10SafeEntrypointSelfTest {
  param([string]$RepoRoot)
  $failures = New-Object System.Collections.Generic.List[string]
  $defaultWsl = Build-SilverDefaultWslCursorCommandTemplate
  $chkDefault = Test-SilverCursorCommandTemplateValid -CursorCommand $defaultWsl
  if (-not $chkDefault.valid) {
    [void]$failures.Add("default_wsl_template_invalid:" + [string]$chkDefault.reason)
  }
  if ($chkDefault.has_task_file_token -ne "YES" -or $chkDefault.has_output_file_token -ne "YES") {
    [void]$failures.Add("default_wsl_template_missing_tokens")
  }
  $resolvedEmpty = Resolve-SilverCursorCommandForControlledEntrypoint -RepoRoot $RepoRoot -CursorCommand "" -PreferWslLane
  if ([string]::IsNullOrWhiteSpace([string]$resolvedEmpty.command)) {
    [void]$failures.Add("resolve_empty_cursor_command_failed:" + [string]$resolvedEmpty.validation.reason)
  }
  $malformed = 'powershell -File scripts/silver-cursor-agent-adapter.ps1 -TaskFile {TASK_FILE}'
  $chkBad = Test-SilverCursorCommandTemplateValid -CursorCommand $malformed
  if ($chkBad.valid) {
    [void]$failures.Add("malformed_cursor_command_should_fail_validation")
  }
  $loopRecurse = 'powershell -File scripts/silver-autopilot-loop.ps1 -TaskFile {TASK_FILE} -OutputFile {OUTPUT_FILE}'
  $chkLoop = Test-SilverCursorCommandTemplateValid -CursorCommand $loopRecurse
  if ($chkLoop.valid) {
    [void]$failures.Add("recursive_loop_command_should_fail_validation")
  }
  $explicitGood = Resolve-SilverCursorCommandForControlledEntrypoint -RepoRoot $RepoRoot -CursorCommand $defaultWsl -PreferWslLane
  if ([string]$explicitGood.source -ne "explicit_parameter") {
    [void]$failures.Add("explicit_good_command_source_expected_explicit_parameter")
  }
  if ($failures.Count -gt 0) {
    Write-Host "SILVER_CAP10_SAFE_ENTRYPOINT_SELFTEST=FAIL" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host $f -ForegroundColor Red }
    return $false
  }
  Write-Host "SILVER_CAP10_SAFE_ENTRYPOINT_SELFTEST=PASS" -ForegroundColor Green
  Write-Host ("cursor_command_builder_default=" + $defaultWsl)
  Write-Host ("cursor_command_resolved_empty_source=" + [string]$resolvedEmpty.source)
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
  if (-not (Test-SilverPathIsCap50RuntimeRestorable -RelPath "scripts/silver-self-correction-audit-report.json")) {
    [void]$failures.Add("allowlist_missing_self_correction_audit_json")
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
  $pfx = "SILVER_CAP50"
  if (Get-Command -Name Get-SilverCapRuntimeBlockPrefix -ErrorAction SilentlyContinue) {
    $pfx = Get-SilverCapRuntimeBlockPrefix
  }
  Write-Host ""
  Write-Host ("=== " + $pfx + "_CYCLE_POSTCONDITION ===") -ForegroundColor Cyan
  if (Get-Command -Name Get-SilverCapRuntimeBlockPrefix -ErrorAction SilentlyContinue) {
    Write-Host ("cap_runtime_label=" + [string]$script:SilverCapRuntimeLabel)
  }
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
  Write-Host ("=== END_" + $pfx + "_CYCLE_POSTCONDITION ===") -ForegroundColor Cyan
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
    $cleanupRes = Invoke-SilverCap50PostCycleRuntimeCleanup -RepoRoot $RepoRoot -Cycle $Cycle -Reason "cap50_cycle_postcondition" -ExcludeRestoreRelPaths @("SILVER_NEXT_ACTION.md", "SILVER_CURSOR_OUTPUT.md", "SILVER_RUN_REPORT.md", "SILVER_PROGRESS_LOG.md") -AllowHandoffDirty
    $cleanupDone = if ($cleanupRes.PASS_FAIL -eq "PASS") { "YES" } else { "NO" }
    $gitCleanAfter = [string]$cleanupRes.git_clean_after
    if ([string]$cleanupRes.blocked_dirty_files) {
      $runtimeDirty = [string]$cleanupRes.blocked_dirty_files
    }
  }
  $nextMode = Get-SilverCap50NextActionMode -NextActionText $nextAfter -RecommendedNextTask $recommended -ControlledInfinite $ControlledInfinite
  $safetyBlocked = Test-SafetyCountersBlocked -SafetyCountersLine $SafetyCountersLine
  $productArtifactHandoffOk = $false
  if ($gitCleanAfter -ne "YES") {
    $remainingDirty = Get-GitStatusShortPaths -Cwd $RepoRoot
    $selectorPost = Get-SilverAuthoritativeSelectorCluster -RepoRoot $RepoRoot
    $expectedPost = Get-SilverExpectedOutcomeFromNextAction -NextActionText $nextAfter
    $pacPost = Invoke-SilverProductArtifactClassifierClassify -RepoRoot $RepoRoot -Paths $remainingDirty -SelectorCluster $selectorPost -ExpectedOutcome $expectedPost -SafetyCounters $SafetyCountersLine
    if ($null -ne $pacPost -and [string]$pacPost.classification -eq "SAFE_PRODUCT_SCRIPT_ONLY") {
      $productArtifactHandoffOk = $true
    }
  }
  $gitHandoffOk = ($gitCleanAfter -eq "YES") -or (Test-Cap50GitCleanExceptHandoffArtifacts -Cwd $RepoRoot) -or $productArtifactHandoffOk
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
  elseif (-not $gitHandoffOk) {
    $reason = "git_not_clean_after_runtime_cleanup"
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

function Invoke-SilverNextActionQualityGateRegressionSelfTest {
  param([string]$RepoRoot)
  $failures = New-Object System.Collections.Generic.List[string]
  $archived = Join-Path $RepoRoot ".silver-runtime\cycles\20260520-044929Z-c1\SILVER_NEXT_ACTION.md"
  if (Test-Path -LiteralPath $archived) {
    $archText = Read-TextFileOrEmpty -Path $archived
    if (-not (Test-SilverNextActionOutputQuality -Text $archText)) {
      [void]$failures.Add("archived_rhc3_cluster_handoff_must_pass")
    }
    if (Test-SilverNextActionIsOrchestrationMaintenanceOnly -Text $archText) {
      [void]$failures.Add("archived_rhc3_cluster_handoff_not_orch_maintenance")
    }
  }
  else {
    $ukolHeadline = ([string][char]0x00DA + "KOL PRO CURSOR") + " - infoUzel.cz / Silver - NEXT PRODUCT CLUSTER DIAGNOSTIC"
    $syntheticCluster = @(
      "<!-- SILVER_NEXT_ACTION: silver-auto-dev V1 deterministic handoff; not auto-applied -->"
      ""
      $ukolHeadline
      ""
      "### Diagnostika top clusteru (disk)"
      ""
      "- **Top cluster:** ``rhc3_negation_cal_readonly``"
      ""
      '1) git status --short'
      '2) node scripts/silver-autopilot.cjs --status'
      '3) node scripts/silver-real-human-chaos-v3.cjs'
      ''
      '```text'
      'top_cluster=rhc3_negation_cal_readonly'
      '```'
    ) -join "`n"
    if (-not (Test-SilverNextActionOutputQuality -Text $syntheticCluster)) {
      [void]$failures.Add("synthetic_rhc3_cluster_handoff_must_pass")
    }
  }
  $badGeneric = @"
<!-- SILVER_NEXT_ACTION: full-auto-loop-openai -->

git push -u origin chore/silver-audit-repo-state
gh auth login
"@
  if (Test-SilverNextActionOutputQuality -Text $badGeneric) {
    [void]$failures.Add("generic_git_gh_push_must_fail")
  }
  $badBare = @'
Run autopilot:

```powershell
node scripts/silver-autopilot.cjs
```
'@
  if (Test-SilverNextActionOutputQuality -Text $badBare) {
    [void]$failures.Add("bare_autopilot_must_fail")
  }
  $badCat = @'
```powershell
cat C:\projects\filtr\SILVER_NEXT_ACTION.md
```
'@
  if (Test-SilverNextActionOutputQuality -Text $badCat) {
    [void]$failures.Add("cat_windows_must_fail")
  }
  $detail = @(Get-SilverNextActionQualityFailureDetail -Text $badGeneric)
  if ($detail.Count -eq 0) {
    [void]$failures.Add("generic_git_gh_must_emit_failure_detail")
  }
  $sample = Get-SilverNextActionQualityForbiddenLineSample -Text $badGeneric -Reasons $detail
  if (-not $sample) {
    [void]$failures.Add("generic_git_gh_must_emit_forbidden_line_sample")
  }
  if ($failures.Count -gt 0) {
    Write-Host "SILVER_NEXT_ACTION_QUALITY_GATE_REGRESSION_SELFTEST=FAIL" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host $f -ForegroundColor Red }
    return $false
  }
  Write-Host "SILVER_NEXT_ACTION_QUALITY_GATE_REGRESSION_SELFTEST=PASS" -ForegroundColor Green
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
  if (-not (Invoke-SilverCap50TimeoutCloseoutSelfTest -RepoRoot $RepoRoot)) {
    [void]$failures.Add("timeout_closeout_selftest")
  }
  if (-not (Invoke-SilverCap50Timeout124FinalPostconditionSelfTest -RepoRoot $RepoRoot)) {
    [void]$failures.Add("timeout124_final_postcondition_selftest")
  }
  if (-not (Invoke-SilverCap50GitNotCleanAfterRestoreSelfTest -RepoRoot $RepoRoot)) {
    [void]$failures.Add("git_not_clean_after_restore_selftest")
  }
  if (-not (Invoke-SilverCap50RealAutonomousLifecycleOrderingSelfTest)) {
    [void]$failures.Add("real_autonomous_lifecycle_ordering_selftest")
  }
  foreach ($synthetic in @(
      @("SILVER_NEXT_ACTION.md", "SILVER_RUN_REPORT.md", "SILVER_PROGRESS_LOG.md"),
      @("SILVER_PROGRESS_LOG.md"),
      @("SILVER_NEXT_ACTION.md", "SILVER_RUN_REPORT.md", "SILVER_PROGRESS_LOG.md", "SILVER_CURSOR_OUTPUT.md")
    )) {
    $handoffSyntheticOk = $true
    foreach ($n in $synthetic) {
      $norm = ($n -replace '\\', '/').Trim()
      if (-not $norm) { continue }
      if ($norm -eq 'SILVER_NEXT_ACTION.md' -or $norm -eq 'SILVER_RUN_REPORT.md' -or $norm -eq 'SILVER_PROGRESS_LOG.md') { continue }
      if (Test-SilverPathIsCap50RuntimeRestorable -RelPath $norm) { continue }
      $handoffSyntheticOk = $false
      break
    }
    if (-not $handoffSyntheticOk) {
      [void]$failures.Add("handoff_allowlist_synthetic:" + ($synthetic -join ","))
    }
  }
  if (Test-SilverPathIsCap50RuntimeRestorable -RelPath "SILVER_CAP50_PREFLIGHT_SELFTEST_BLOCK.txt") {
    [void]$failures.Add("handoff_allowlist_must_not_broaden_unknown_md")
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
  $selectorCluster = Get-SilverAuthoritativeSelectorCluster -RepoRoot $Cwd
  $nextText = Read-TextFileOrEmpty -Path (Join-Path $Cwd "SILVER_NEXT_ACTION.md")
  $expectedOutcome = Get-SilverExpectedOutcomeFromNextAction -NextActionText $nextText
  $reportText = Read-TextFileOrEmpty -Path (Join-Path $Cwd "SILVER_RUN_REPORT.md")
  $safetyLine = Get-RunReportLineValue -ReportText $reportText -Key "safety_counters"
  $paths = Get-GitStatusShortPaths -Cwd $Cwd
  foreach ($rel in $paths) {
    $n = ($rel -replace "\\", "/").Trim()
    if (-not $n) { continue }
    if ($allowed.Contains($n)) { continue }
    if (Test-SilverPathIsCap50RuntimeRestorable -RelPath $n) { continue }
    if (Test-SilverPathIsAutonomousSafeProductArtifact -RelPath $n -RepoRoot $Cwd -SelectorCluster $selectorCluster -ExpectedOutcome $expectedOutcome -SafetyCounters $safetyLine) {
      continue
    }
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

function Invoke-SilverCapProductScorecardIfActive {
  param(
    [string]$RepoRoot,
    [string]$ProgressLogPath,
    [int]$CyclesCompleted,
    [string]$StopReason,
    [string]$RuntimeFailure = "NO"
  )
  if (-not (Get-Command -Name Complete-SilverCapProductScorecard -ErrorAction SilentlyContinue)) { return }
  if (-not $script:SilverCapScorecardBeforePath) { return }
  $reportText = Read-TextFileOrEmpty -Path (Join-Path $RepoRoot "SILVER_RUN_REPORT.md")
  $engineCh = Get-RunReportLineValue -ReportText $reportText -Key "engine_changed"
  $assetsCh = Get-RunReportLineValue -ReportText $reportText -Key "assets_app_changed"
  $prUrlBefore = ""
  if (Test-Path -LiteralPath $script:SilverCapScorecardBeforePath) {
    try {
      $beforeRaw = Get-Content -LiteralPath $script:SilverCapScorecardBeforePath -Raw -Encoding UTF8
      if ($beforeRaw -match '"pr_url"\s*:\s*"([^"]*)"') {
        $prUrlBefore = $Matches[1]
      }
    } catch { }
  }
  $prUrlAfter = Get-RunReportLineValue -ReportText $reportText -Key "pr_url"
  if (-not $prUrlAfter) {
    $openPrLine = Get-RunReportLineValue -ReportText $reportText -Key "open_pr"
    if ($openPrLine -match 'https?://[^\s]+') {
      $prUrlAfter = $Matches[0]
    }
  }
  $prCreated = "0"
  if ($prUrlAfter -and $prUrlAfter -ne $prUrlBefore) { $prCreated = "1" }
  $productFix = "NO"
  if ($engineCh -eq "YES" -or $assetsCh -eq "YES") { $productFix = "YES" }
  $runtimeFailFlag = [string]$RuntimeFailure
  if ($runtimeFailFlag -ne "YES") {
    if (Test-SilverCap50StopReasonIsRuntimeFailure -StopReason $StopReason) {
      $runtimeFailFlag = "YES"
    }
  }
  $scOk = Complete-SilverCapProductScorecard -RepoRoot $RepoRoot -ProgressLogPath $ProgressLogPath -CyclesCompleted $CyclesCompleted -StopReason $StopReason -PrCreatedCount $prCreated -ProductFixCreated $productFix -RuntimeFailure $runtimeFailFlag
  if (Get-Command -Name Invoke-SilverCapOutcomeEnforcement -ErrorAction SilentlyContinue) {
    $capLbl = [string]$script:SilverCapScorecardCapLabel
    if (-not $capLbl) { $capLbl = "CAPX" }
    $orch = [string]$script:SilverLastScorecardOrchestrationOnly
    if (-not $orch) { $orch = "NO" }
    $verifiedShift = "NO"
    if ($script:SilverLastScorecardVerifiedProductShift) {
      $verifiedShift = [string]$script:SilverLastScorecardVerifiedProductShift
    }
    $scorecardErr = "NO"
    $exactErr = ""
    if (-not $scOk) { $scorecardErr = "YES" }
    if ($script:SilverScorecardRuntimeError -eq "YES") { $scorecardErr = "YES" }
    if ($script:SilverScorecardExactError) { $exactErr = [string]$script:SilverScorecardExactError }
    $null = Invoke-SilverCapOutcomeEnforcement -RepoRoot $RepoRoot -ProgressLogPath $ProgressLogPath -CyclesCompleted $CyclesCompleted -CapLabel $capLbl -OrchestrationOnly $orch -PrCreatedCount ([int]$prCreated) -ProductFixCreated $productFix -VerifiedProductShift $verifiedShift -ScorecardRuntimeError $scorecardErr -ExactError $exactErr
  }
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

function Get-SilverControlledBudgetGuardRunId {
  if ($script:SilverAutonomousRunId) {
    return [string]$script:SilverAutonomousRunId
  }
  return "cap-loop-" + [string](Get-Date -Format "yyyyMMddHHmmss")
}

function Invoke-SilverControlledBudgetGuardNode {
  param(
    [string]$SubCommand,
    [string]$RepoRoot,
    [string]$RunId,
    [string]$CapLabel = "",
    [string]$ProfileId = "",
    [string]$FinalOutcome = "",
    [string]$TextFile = "",
    [string]$StopReason = "",
    [string]$Cluster = "",
    [string]$OutputHash = "",
    [string]$CounterName = ""
  )
  if (-not (Test-Path -LiteralPath $SilverControlledBudgetGuardScript)) {
    Write-Host "CONTROLLED_BUDGET_GUARD_STOP=SCRIPT_MISSING" -ForegroundColor Red
    return @{ exit = 2; stdout = "" }
  }
  $nodeArgs = @($SilverControlledBudgetGuardScript, $SubCommand, "--repo", $RepoRoot, "--run-id", $RunId)
  if ($CapLabel) { $nodeArgs += @("--cap-label", $CapLabel) }
  if ($ProfileId) { $nodeArgs += @("--profile", $ProfileId) }
  if ($FinalOutcome) { $nodeArgs += @("--final-outcome", $FinalOutcome) }
  if ($TextFile) { $nodeArgs += @("--text-file", $TextFile) }
  if ($StopReason) { $nodeArgs += @("--stop-reason", $StopReason) }
  if ($Cluster) { $nodeArgs += @("--cluster", $Cluster) }
  if ($OutputHash) { $nodeArgs += @("--output-hash", $OutputHash) }
  if ($CounterName) { $nodeArgs += @("--counter", $CounterName) }
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $stdout = & node @nodeArgs 2>&1 | Out-String
  $exit = 0
  if ($null -ne $LASTEXITCODE) { $exit = [int]$LASTEXITCODE }
  $ErrorActionPreference = $prevEa
  return @{ exit = $exit; stdout = $stdout }
}

function Initialize-SilverControlledBudgetGuardSession {
  param(
    [string]$RepoRoot,
    [string]$CapLabel,
    [string]$RunId,
    [string]$ProfileIdOverride = ""
  )
  if (-not $CapLabel) { return $true }
  $profileId = ""
  if (-not [string]::IsNullOrWhiteSpace($ProfileIdOverride)) {
    $profileId = ([string]$ProfileIdOverride).Trim().ToUpper()
  }
  elseif ($CapLabel -eq "CAP25") { $profileId = "CAP25_SAFE" }
  elseif ($CapLabel -eq "CAP50") { $profileId = "CAP50_SAFE" }
  else { $profileId = "CAP10_SAFE" }
  $r = Invoke-SilverControlledBudgetGuardNode -SubCommand "init" -RepoRoot $RepoRoot -RunId $RunId -CapLabel $CapLabel -ProfileId $profileId
  if ($r.exit -ne 0) {
    Write-Host "=== CONTROLLED_BUDGET_GUARD_INIT ===" -ForegroundColor Red
    Write-Host $r.stdout
    Write-Host "=== END_CONTROLLED_BUDGET_GUARD_INIT ===" -ForegroundColor Red
    return $false
  }
  Write-Host ("silver-autopilot-loop: controlled_budget_guard_init=OK profile=" + $profileId + " cap=" + $CapLabel) -ForegroundColor DarkCyan
  return $true
}

function Test-SilverControlledBudgetGuardInvokeAllowed {
  param(
    [string]$RepoRoot,
    [string]$RunId,
    [string]$NextActionPath
  )
  if ($NextActionPath -and (Test-Path -LiteralPath $NextActionPath)) {
    $chkText = Invoke-SilverControlledBudgetGuardNode -SubCommand "check-text" -RepoRoot $RepoRoot -RunId $RunId -TextFile $NextActionPath
    if ($chkText.exit -ne 0) {
      Write-Host $chkText.stdout -ForegroundColor Red
      return $false
    }
  }
  $rec = Invoke-SilverControlledBudgetGuardNode -SubCommand "record-invoke" -RepoRoot $RepoRoot -RunId $RunId
  if ($rec.exit -ne 0) {
    Write-Host $rec.stdout -ForegroundColor Red
    return $false
  }
  return $true
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
  Invoke-SilverCapProductScorecardIfActive -RepoRoot $RepoRoot -ProgressLogPath $ProgressLogPath -CyclesCompleted $cyclesDone -StopReason $Reason
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
if ($AutonomousMode -and $MaxCycles -ne 0) {
  Write-Host ("silver-autopilot-loop: AutonomousMode_implies_MaxCycles_0 coerced_from=" + [string]$MaxCycles) -ForegroundColor DarkCyan
  $MaxCycles = 0
}
if ($MaxCycles -lt 0) {
  Write-Host "STOP: MaxCycles must be >= 0." -ForegroundColor Red
  exit 1
}
if ($MaxCycles -eq 0 -and -not $autonomousOptIn) {
  Write-SilverSafetyConsoleStop -Reason "maxcycles_zero_requires_allowinfinite_or_autonomousmode"
  exit 1
}
$controlledCapProfileNorm = ([string]$ControlledCapProfile).Trim().ToUpper()
if ($Cap10Safe -and $controlledCapProfileNorm -ne "CAP10_SAFE") {
  Write-Host "CAP10_SAFE_RUNTIME_REQUIRES_CONTROLLED_PROFILE=YES" -ForegroundColor Red
  Write-Host "STOP: -Cap10Safe is a legacy alias and does NOT run CAP10_SAFE entrypoint selftest or full CAP10 runtime." -ForegroundColor Red
  Write-Host "recommended_command=powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\silver-autopilot-loop.ps1 -AutonomousMode -ControlledCapProfile CAP10_SAFE -MaxAutonomousHardCycles 10 -TotalWallSeconds 900" -ForegroundColor Yellow
  exit 2
}
if ($Cap10Safe -and $controlledCapProfileNorm -eq "CAP10_SAFE") {
  Write-Host "silver-autopilot-loop: Cap10Safe_legacy_alias_ok ControlledCapProfile=CAP10_SAFE (use -ControlledCapProfile explicitly in automation)" -ForegroundColor DarkCyan
}
if ($controlledCapProfileNorm -eq "CAP10_SAFE") {
  if ($MaxAutonomousHardCycles -lt 1) {
    Write-Host "STOP: CAP10_SAFE requires -MaxAutonomousHardCycles >= 1 (recommended 10)." -ForegroundColor Red
    exit 1
  }
  if (-not $autonomousOptIn) {
    Write-Host "silver-autopilot-loop: ControlledCapProfile=CAP10_SAFE coerced MaxCycles=0 AllowInfinite" -ForegroundColor DarkCyan
    $AllowInfinite = $true
    $MaxCycles = 0
    $autonomousOptIn = $true
  }
}
elseif ($controlledCapProfileNorm -match '^(CAP25_SAFE|CAP50_SAFE)$') {
  Write-Host ("STOP: forbidden ControlledCapProfile=" + $controlledCapProfileNorm + " (CAP10_SAFE entrypoint only).") -ForegroundColor Red
  exit 1
}
elseif (-not [string]::IsNullOrWhiteSpace($controlledCapProfileNorm)) {
  Write-Host ("STOP: unknown ControlledCapProfile=" + $controlledCapProfileNorm) -ForegroundColor Red
  exit 1
}
$controlledInfinite = ($MaxCycles -eq 0 -and $autonomousOptIn)
$infinite = $controlledInfinite
$hardCap = if ($controlledInfinite) { Get-SilverAutonomousHardMax -ParamMax $MaxAutonomousHardCycles } else { [int32]::MaxValue }
if ($controlledInfinite) {
  $cursorEntryResolve = Resolve-SilverCursorCommandForControlledEntrypoint -RepoRoot $RepoRoot -CursorCommand $CursorCommand -PreferWslLane
  if ([string]::IsNullOrWhiteSpace($CursorCommand) -and (-not [string]::IsNullOrWhiteSpace([string]$cursorEntryResolve.command))) {
    $CursorCommand = [string]$cursorEntryResolve.command
    Write-Host ("silver-autopilot-loop: cursor_command_resolved=YES source=" + [string]$cursorEntryResolve.source) -ForegroundColor DarkCyan
    Write-Host ("silver-autopilot-loop: cursor_command_lane wsl_ready=" + [string]$cursorEntryResolve.wsl_lane_ready + " adapter_ready=" + [string]$cursorEntryResolve.adapter_ready) -ForegroundColor DarkCyan
  }
  elseif ([string]::IsNullOrWhiteSpace($CursorCommand)) {
    Write-Host ("silver-autopilot-loop: cursor_command_resolved=NO reason=" + [string]$cursorEntryResolve.validation.reason) -ForegroundColor Yellow
  }
  else {
    $cursorExplicitChk = Test-SilverCursorCommandTemplateValid -CursorCommand $CursorCommand
    if (-not $cursorExplicitChk.valid) {
      Write-Host ("STOP: explicit -CursorCommand rejected: " + [string]$cursorExplicitChk.reason) -ForegroundColor Red
      exit 1
    }
    Write-Host ("silver-autopilot-loop: cursor_command_explicit=YES tokens task=" + [string]$cursorExplicitChk.has_task_file_token + " output=" + [string]$cursorExplicitChk.has_output_file_token) -ForegroundColor DarkCyan
  }
}
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
$script:SilverCycleAutonomousRearmPassed = $false
$script:SilverCycleAdapterInvokeCommitted = $false
$script:AutonomousCyclesCompleted = 0
$script:AutonomousCyclesPass = 0
$script:AutonomousOrchestrationOnlyStreak = 0
$script:AutonomousRealStaleMetaIssueSeen = "NO"
$script:AutonomousStaleEmbeddedHintSeen = "NO"
$script:AutonomousStaleEmbeddedNonAuth = "NO"
$script:AutonomousAuthoritativeRuntimePass = "NO"

if ($controlledInfinite) {
  $newRunId = ([guid]::NewGuid().ToString("N"))
  Initialize-SilverAutonomousRunLifecycle -RunId $newRunId -RunStartUtc ((Get-Date).ToUniversalTime()) -CursorOutputPath $CursorOutputPath -RepoRoot $RepoRoot
  Write-Host ("silver-autopilot-loop: autonomous_run_id=" + $script:SilverAutonomousRunId + " runtime_cursor_output_invalidated=YES") -ForegroundColor DarkCyan
}

if ($CapProductScorecardSelfTest) {
  if (-not (Get-Command -Name Invoke-SilverCapProductScorecardSelfTest -ErrorAction SilentlyContinue)) {
    Write-Host "SILVER_CAP_PRODUCT_SCORECARD_SELFTEST=FAIL missing_scorecard_module" -ForegroundColor Red
    exit 1
  }
  $stSc = Invoke-SilverCapProductScorecardSelfTest -RepoRoot $RepoRoot
  if (-not $stSc) { exit 1 }
  exit 0
}

if ($AuditRegistrySelfTest) {
  if (-not (Get-Command -Name Invoke-SilverAuditRegistrySelfTest -ErrorAction SilentlyContinue)) {
    Write-Host "SILVER_AUDIT_REGISTRY_SELFTEST=FAIL missing_registry_module" -ForegroundColor Red
    exit 1
  }
  $stAr = Invoke-SilverAuditRegistrySelfTest -RepoRoot $RepoRoot
  if (-not $stAr) { exit 1 }
  exit 0
}

if ($AdapterMetaFreshnessSelfTest) {
  $stMeta = Invoke-SilverAdapterMetaFreshnessSelfTest -RepoRoot $RepoRoot
  if (-not $stMeta) { exit 1 }
  exit 0
}

if ($Cap50RealAutonomousLifecycleOrderingSelfTest) {
  if (-not (Invoke-SilverCap50RealAutonomousLifecycleOrderingSelfTest)) { exit 1 }
  exit 0
}

if ($AutonomousRearmSelfTest) {
  $stRearm = Invoke-SilverAutonomousRearmSelfTest -RepoRoot $RepoRoot
  if (-not $stRearm) { exit 1 }
  exit 0
}

if ($RearmInvokeEdgeCaseSelfTest) {
  $stRearmInvoke = Invoke-SilverRearmInvokeEdgeCaseSelfTest -RepoRoot $RepoRoot
  if (-not $stRearmInvoke) { exit 1 }
  exit 0
}

if ($Cursor3ExecutionBridgeSelfTest) {
  $prevEaC3 = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & node (Join-Path $RepoRoot "scripts\silver-autopilot.cjs") --cursor3-execution-bridge-selftest
  $c3Exit = 1
  if ($null -ne $LASTEXITCODE) { $c3Exit = [int]$LASTEXITCODE }
  $ErrorActionPreference = $prevEaC3
  if ($c3Exit -ne 0) { exit 1 }
  exit 0
}

if ($ControlledBudgetGuardSelfTest) {
  $prevEaBg = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & node (Join-Path $RepoRoot "scripts\silver-autopilot.cjs") --controlled-budget-guard-selftest
  $bgExit = 1
  if ($null -ne $LASTEXITCODE) { $bgExit = [int]$LASTEXITCODE }
  $ErrorActionPreference = $prevEaBg
  if ($bgExit -ne 0) { exit 1 }
  exit 0
}

if ($Cap10SafeEntrypointSelfTest) {
  $stCap10Ep = Invoke-SilverCap10SafeEntrypointSelfTest -RepoRoot $RepoRoot
  if (-not $stCap10Ep) { exit 1 }
  exit 0
}

if ($StaleInvokeWatchdogSelfTest) {
  $stStaleWd = Invoke-SilverStaleInvokeWatchdogSelfTest -RepoRoot $RepoRoot
  if (-not $stStaleWd) { exit 1 }
  exit 0
}

if ($StaleCursorInvokeHardeningSelfTest) {
  $stStaleHard = Invoke-SilverStaleCursorInvokeHardeningSelfTest -RepoRoot $RepoRoot
  if (-not $stStaleHard) { exit 1 }
  exit 0
}

if ($WslAgentModelAutoHandoffSelfTest) {
  $stWslModel = Invoke-SilverWslAgentModelAutoHandoffSelfTest -RepoRoot $RepoRoot
  if (-not $stWslModel) { exit 1 }
  exit 0
}

if ($NextActionQualityGateRegressionSelfTest) {
  $stNa = Invoke-SilverNextActionQualityGateRegressionSelfTest -RepoRoot $RepoRoot
  if (-not $stNa) { exit 1 }
  exit 0
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

if ($Cap50TimeoutCloseoutSelfTest) {
  $stClose = Invoke-SilverCap50TimeoutCloseoutSelfTest -RepoRoot $RepoRoot
  if (-not $stClose) { exit 1 }
  exit 0
}

if ($Cap50Timeout124FinalPostconditionSelfTest) {
  $stT124 = Invoke-SilverCap50Timeout124FinalPostconditionSelfTest -RepoRoot $RepoRoot
  if (-not $stT124) { exit 1 }
  exit 0
}

if ($Cap50GitNotCleanAfterRestoreSelfTest) {
  $stGitClean = Invoke-SilverCap50GitNotCleanAfterRestoreSelfTest -RepoRoot $RepoRoot
  if (-not $stGitClean) { exit 1 }
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

if ($controlledInfinite -and (Get-Command -Name Invoke-SilverAuditRegistryReport -ErrorAction SilentlyContinue)) {
  $null = Invoke-SilverAuditRegistryReport -RepoRoot $RepoRoot
}

if ($controlledInfinite -and (-not $DryRun) -and (-not [string]::IsNullOrWhiteSpace($CursorCommand))) {
  $prevEaC3Pf = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $c3StatusOut = & node (Join-Path $RepoRoot "scripts\silver-autopilot.cjs") --cursor3-execution-status 2>&1 | Out-String
  $c3BridgeUsable = "NO"
  if ($c3StatusOut -match 'powershell_execution_bridge_usable=YES') { $c3BridgeUsable = "YES" }
  $ErrorActionPreference = $prevEaC3Pf
  if ($c3BridgeUsable -ne "YES") {
    Write-Host "=== SILVER_CURSOR3_EXECUTION_BRIDGE_GUARD ===" -ForegroundColor Red
    Write-Host "powershell_execution_bridge_usable=NO" -ForegroundColor Red
    Write-Host "STOP=CURSOR3_EXECUTION_BRIDGE_UNAVAILABLE controlled CAP blocked" -ForegroundColor Red
    Write-Host "recommended=node scripts/silver-autopilot.cjs --cursor3-execution-status" -ForegroundColor Yellow
    Write-Host "=== END_SILVER_CURSOR3_EXECUTION_BRIDGE_GUARD ===" -ForegroundColor Red
    if (-not $NoBeep) {
      try { [console]::beep(440, 400) } catch { }
    }
    exit 2
  }
  $hardPf = Invoke-SilverCap50HardPreflight -RepoRoot $RepoRoot -CursorCommand $CursorCommand
  Write-SilverCap50HardPreflightBlock -Result $hardPf
  if ($hardPf.PASS_FAIL -ne "PASS") {
    Write-SilverSafetyConsoleStop -Reason "cap50_hard_preflight_fail"
    exit 1
  }
}

$capRunLabel = ""
if (Get-Command -Name Get-SilverCapRunLabel -ErrorAction SilentlyContinue) {
  $capRunLabel = Get-SilverCapRunLabel -ControlledInfinite $controlledInfinite -MaxCycles $MaxCycles -MaxAutonomousHardCycles $MaxAutonomousHardCycles -RepoRoot $RepoRoot
}
if ($capRunLabel -and (Get-Command -Name Set-SilverCapRuntimeLabel -ErrorAction SilentlyContinue)) {
  Set-SilverCapRuntimeLabel -Label $capRunLabel
  Write-Host ("silver-autopilot-loop: cap_runtime_label=" + $capRunLabel) -ForegroundColor DarkCyan
}
if ($capRunLabel -and (Get-Command -Name Initialize-SilverCapProductScorecardSession -ErrorAction SilentlyContinue)) {
  $beforeOut = Initialize-SilverCapProductScorecardSession -CapLabel $capRunLabel
  $capCapOk = Invoke-SilverCapProductScorecardCapture -RepoRoot $RepoRoot -CapLabel $capRunLabel -OutPath $beforeOut
  if (-not $capCapOk) {
    Write-Host ("silver-autopilot-loop: cap_scorecard_before_capture=WARN cap_label=" + $capRunLabel) -ForegroundColor DarkYellow
  } else {
    Write-Host ("silver-autopilot-loop: cap_scorecard_before_capture=OK cap_label=" + $capRunLabel) -ForegroundColor DarkCyan
  }
}
$script:SilverControlledBudgetGuardActive = $false
if ($capRunLabel) {
  $budgetRunId = Get-SilverControlledBudgetGuardRunId
  $script:SilverControlledBudgetGuardRunId = $budgetRunId
  $profileForGuard = ""
  if ($controlledCapProfileNorm) { $profileForGuard = $controlledCapProfileNorm }
  $script:SilverControlledBudgetGuardActive = Initialize-SilverControlledBudgetGuardSession -RepoRoot $RepoRoot -CapLabel $capRunLabel -RunId $budgetRunId -ProfileIdOverride $profileForGuard
  if (-not $script:SilverControlledBudgetGuardActive) {
    Write-SilverSafetyConsoleStop -Reason "controlled_budget_guard_init_fail"
    exit 2
  }
}

$cycle = 0
while ($true) {
  $cycle++
  $script:CycleIndex = $cycle
  $script:SilverCycleAutonomousRearmPassed = $false
  $script:SilverCycleAdapterInvokeCommitted = $false
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

  $selectorPreflight = ""
  $expectedPreflight = ""
  if ($controlledInfinite) {
    $selectorPreflight = Get-SilverAuthoritativeSelectorCluster -RepoRoot $RepoRoot
    $expectedPreflight = Get-SilverExpectedOutcomeForProductArtifact -RepoRoot $RepoRoot
  }
  $preflightCap50 = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot -DryRunOnly:$DryRun -AllowProductArtifactRuntimePending:$controlledInfinite -SelectorCluster $selectorPreflight -ExpectedOutcome $expectedPreflight
  Write-SilverCap50PreflightCleanupResultBlock -Result $preflightCap50
  if ($preflightCap50.safe_to_start_cycle -ne "YES") {
    if (-not $DryRun) {
      $mcPfPre = ""
      try {
        $prevEaPf0 = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $mcPfPre = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
        $ErrorActionPreference = $prevEaPf0
      } catch {
        $mcPfPre = ""
      }
      $nextPeekPf0 = Read-TextFileOrEmpty -Path $NextActionPath
      $baselinesPf = Get-BaselineProgressMetrics
      $pfCloseFields = @{
        timestamp = (Get-Date).ToString("s")
        cycle = [string]$cycle
        main_commit = $mcPfPre
        last_task_exit = "1"
        cursor_exit = "N/A"
        autopilot_exit = "N/A"
        autopilot_status_exit = "N/A"
        git_status_clean = [string]$preflightCap50.git_clean_after
        safety_counters = ""
        calendar_write_20k = ""
        calendar_query_20k = ""
        core_engine_progress = $baselinesPf.core_engine_progress
        safety_progress = $baselinesPf.safety_progress
        routing_progress = $baselinesPf.routing_progress
        retrieval_progress = $baselinesPf.retrieval_progress
        real_human_chaos_progress = $baselinesPf.real_human_chaos_progress
        multi_intent_orchestration_progress = $baselinesPf.multi_intent_orchestration_progress
        long_session_memory_progress = $baselinesPf.long_session_memory_progress
        public_ready_progress = $baselinesPf.public_ready_progress
        source = $baselinesPf.source
        current_focus = "cap50_preflight_cleanup_blocked"
        next_action_headline = (Get-NextActionHeadline -Text $nextPeekPf0)
        dry_run = "NO"
        stop_reason = "git_not_clean_after_restore"
      }
      $pfCloseKind = "runtime_artifact_restorable"
      if ([string]$preflightCap50.closeout_kind) { $pfCloseKind = [string]$preflightCap50.closeout_kind }
      $null = Invoke-SilverCap50OrchestrationRuntimeCloseout -RepoRoot $RepoRoot -Cycle $cycle -Reason "cap50_preflight_cleanup_blocked" -ProgressLogFields $pfCloseFields -ProgressOutcome "FAIL" -CloseoutKind $pfCloseKind
      $preflightCap50 = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot
      Write-SilverCap50PreflightCleanupResultBlock -Result $preflightCap50
    }
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

  if ($controlledInfinite -and ($preflightCap50.safe_to_start_cycle -eq "YES") -and (-not $DryRun)) {
    $rearmPostPf = Invoke-SilverAutonomousCycleRearm -RepoRoot $RepoRoot -CursorOutputPath $CursorOutputPath -Cycle $cycle
    Write-SilverAutonomousCycleRearmResultBlock -Result $rearmPostPf
    if ([string]$rearmPostPf.PASS_FAIL -eq "PASS") {
      $script:SilverCycleAutonomousRearmPassed = $true
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

  if ($controlledInfinite) {
    $selectorPre = Get-SilverAuthoritativeSelectorCluster -RepoRoot $RepoRoot
    if ($selectorPre) {
      Write-Host ("silver-autopilot-loop: pre_cycle_selector_cluster=" + $selectorPre) -ForegroundColor DarkCyan
      if (-not (Invoke-SilverEnsureRegistryClusterProductHandoff -RepoRoot $RepoRoot -AutopilotScript $AutopilotScript)) {
        Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
          -CursorExit "N/A" -AutopilotExit "N/A" -StatusExit "N/A" `
          -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine "" -CalW "" -CalQ "" `
          -Headline (Get-NextActionHeadline -Text $nextText) -Focus "product_handoff_not_cluster_specific_precycle" `
          -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1 `
          -StopReason ("PRODUCT_HANDOFF_NOT_CLUSTER_SPECIFIC|selector_cluster=" + [string]$selectorPre)
      }
      $nextText = Read-TextFileOrEmpty -Path $NextActionPath
    }
  }

  if ($controlledInfinite -and -not (Test-SilverNextActionOutputQuality -Text $nextText)) {
    $qualityFailures = Get-SilverNextActionQualityFailureDetail -Text $nextText
    $qualitySample = Get-SilverNextActionQualityForbiddenLineSample -Text $nextText -Reasons $qualityFailures
    $qualityStop =
      "SILVER_NEXT_ACTION.md failed quality gate (" +
      ($qualityFailures -join "; ") +
      ")"
    if ($qualitySample) {
      $qualityStop = $qualityStop + " | forbidden_line=" + $qualitySample
    }
    Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
      -CursorExit "N/A" -AutopilotExit "N/A" -StatusExit "N/A" `
      -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine "" -CalW "" -CalQ "" `
      -Headline (Get-NextActionHeadline -Text $nextText) -Focus "autonomous_bad_next_action_quality_precycle" `
      -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1 `
      -StopReason $qualityStop
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
  if ($controlledInfinite -and $script:SilverCycleAutonomousRearmPassed -and (-not $DryRun)) {
    if ([string]::IsNullOrWhiteSpace($CursorCommand)) {
      Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
        -CursorExit "MISSING" -AutopilotExit "N/A" -StatusExit "N/A" `
        -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
        -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
        -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
        -Headline (Get-NextActionHeadline -Text $nextText) -Focus "adapter_invoke_blocked_after_rearm" `
        -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1 `
        -StopReason "adapter_invoke_blocked_cursor_command_missing_after_rearm"
    }
  }
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
      $c3BridgeUsableCycle = "NO"
      $prevEaC3Cy = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      $c3CyOut = & node (Join-Path $RepoRoot "scripts\silver-autopilot.cjs") --cursor3-execution-status 2>&1 | Out-String
      if ($c3CyOut -match 'powershell_execution_bridge_usable=YES') { $c3BridgeUsableCycle = "YES" }
      $ErrorActionPreference = $prevEaC3Cy
      if ($c3BridgeUsableCycle -ne "YES") {
        Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
          -CursorExit "BRIDGE_UNAVAILABLE" -AutopilotExit "N/A" -StatusExit "N/A" `
          -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
          -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
          -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
          -Headline (Get-NextActionHeadline -Text $nextText) -Focus "cursor3_execution_bridge_unavailable" `
          -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 2 `
          -StopReason "CURSOR3_EXECUTION_BRIDGE_UNAVAILABLE"
      }
      if (Test-SilverStaleInvokeStartedMetaState -AdapterOutputPath $CursorOutputPath) {
        $outAbsStale = $CursorOutputPath
        if (Test-Path -LiteralPath $CursorOutputPath) {
          $outAbsStale = (Resolve-Path -LiteralPath $CursorOutputPath).Path
        }
        $fiStale = $null
        $snapStale = @{
          output_last_write_before = ""
          output_length_before = ""
          process_progress_detected = "NO"
          wsl_agent_progress_detected = "NO"
        }
        if (Test-Path -LiteralPath $outAbsStale) {
          $fiStale = Get-Item -LiteralPath $outAbsStale
          $snapStale.output_last_write_before = $fiStale.LastWriteTimeUtc.ToString("o")
          $snapStale.output_length_before = [string]$fiStale.Length
        }
        $digestStale = ""
        if (Test-Path -LiteralPath $NextActionPath) {
          $digestStale = Get-SilverTaskUtf8Sha256HexPrefix -Text ([System.IO.File]::ReadAllText($NextActionPath, [System.Text.UTF8Encoding]::new($false)))
        }
        $taskAbsStale = ""
        if (Test-Path -LiteralPath $NextActionPath) {
          $taskAbsStale = (Resolve-Path -LiteralPath $NextActionPath).Path
        }
        $procStale = [datetime]::MinValue
        if ($script:SilverCycleCursorProcessStartUtc -and ($script:SilverCycleCursorProcessStartUtc -ne [datetime]::MinValue)) {
          $procStale = $script:SilverCycleCursorProcessStartUtc
        }
        $null = Invoke-SilverStaleCursorInvokeCloseout -RepoRoot $RepoRoot -AdapterOutputPath $outAbsStale -Process $null `
          -StdoutTmp "" -StderrTmp "" -TaskDigest $digestStale -TaskFile $taskAbsStale -OutputFile $outAbsStale `
          -ProcessStartUtc $procStale -ProgressSnapshotBefore $snapStale
        Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
          -CursorExit "125" -AutopilotExit "N/A" -StatusExit "N/A" `
          -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
          -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
          -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
          -Headline (Get-NextActionHeadline -Text $nextText) -Focus "stale_cursor_invoke_precycle" `
          -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1 `
          -StopReason "STALE_CURSOR_INVOKE_NO_PROGRESS"
      }
      $utf8PreInvoke = Invoke-SilverCap50Utf8SurfacesHardGate -RepoRoot $RepoRoot -NextActionPath $NextActionPath -CursorOutputPath $CursorOutputPath
      if ($utf8PreInvoke.PASS_FAIL -ne "PASS") {
        Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
          -CursorExit "N/A" -AutopilotExit "N/A" -StatusExit "N/A" `
          -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
          -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
          -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
          -Headline (Get-NextActionHeadline -Text $nextText) -Focus "utf8_mojibake_hard_fail_pre_adapter_invoke" `
          -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1 `
          -StopReason "utf8_mojibake_detected_pre_adapter_invoke"
      }
      $taskAbs = (Resolve-Path -LiteralPath $NextActionPath).Path
      $outAbs = (Resolve-Path -LiteralPath $CursorOutputPath).Path
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
      $ce = -1
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = "cmd.exe"
      $psi.Arguments = "/c " + $resolvedCmd + " 1> """ + $stdoutTmp + """ 2> """ + $stderrTmp + """"
      $psi.WorkingDirectory = $RepoRoot
      $psi.UseShellExecute = $false
      $psi.CreateNoWindow = $true
      try {
        $cursorProcStartUtc = (Get-Date).ToUniversalTime()
        $script:SilverCycleCursorProcessStartUtc = $cursorProcStartUtc
        $runCtxInvoke = Get-SilverAutonomousRunContext
        $invokeStartIso = $cursorProcStartUtc.ToString("o")
        if ($script:SilverControlledBudgetGuardActive) {
          $budgetRunIdInvoke = [string]$script:SilverControlledBudgetGuardRunId
          if (-not (Test-SilverControlledBudgetGuardInvokeAllowed -RepoRoot $RepoRoot -RunId $budgetRunIdInvoke -NextActionPath $NextActionPath)) {
            Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
              -CursorExit "BUDGET_GUARD" -AutopilotExit "N/A" -StatusExit "N/A" `
              -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
              -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
              -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
              -Headline (Get-NextActionHeadline -Text $nextText) -Focus "controlled_budget_guard_invoke_blocked" `
              -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 2 `
              -StopReason "CONTROLLED_BUDGET_GUARD_STOP"
          }
          $null = Invoke-SilverControlledBudgetGuardNode -SubCommand "record-counter" -RepoRoot $RepoRoot -RunId $budgetRunIdInvoke -CounterName "autonomous_decisions"
        }
        Write-SilverCursorOutputAdapterInvokeStartedMeta -Path $CursorOutputPath `
          -RunId $runCtxInvoke.RunId -RunStartUtcIso $runCtxInvoke.RunStartUtc -CycleState $runCtxInvoke.Cycle `
          -TaskFile $expectedTaskFile -OutputFile $outAbs -TaskDigest $expectedTaskDigest -ProcessStartUtcIso $invokeStartIso
        $script:SilverCycleAdapterInvokeCommitted = $true
        Write-Host ("silver-autopilot-loop: adapter_invoke_started=YES process_start_utc=" + $invokeStartIso) -ForegroundColor DarkCyan
        $p = [System.Diagnostics.Process]::Start($psi)
        if ($null -eq $p) {
          throw [System.InvalidOperationException]::new("Process.Start returned null for cursor adapter wrapper")
        }
        $startupWait = Wait-SilverAdapterInvokeStartupEvidence -AdapterOutputPath $outAbs -MaxWaitMs 45000 -PollMs 200
        Write-Host ("silver-autopilot-loop: adapter_invoke_startup_wait_PASS_FAIL=" + [string]$startupWait.PASS_FAIL + " attempts=" + [string]$startupWait.attempts) -ForegroundColor DarkCyan
        if ([string]$startupWait.PASS_FAIL -ne "PASS") {
          try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
          Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
            -CursorExit "STARTUP" -AutopilotExit "N/A" -StatusExit "N/A" `
            -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
            -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
            -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
            -Headline (Get-NextActionHeadline -Text $nextText) -Focus "adapter_invoke_startup_evidence_missing" `
            -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1 `
            -StopReason "adapter_invoke_startup_evidence_missing_after_rearm"
        }
        $outerWaitMs = 0
        if ($effectiveCap50TimeoutSeconds -gt 0) {
          $outerWaitMs = ($effectiveCap50TimeoutSeconds + 180) * 1000
        }
        $outerWallTimedOut = $false
        $staleInvokeDetected = $false
        $staleSnapBefore = @{
          output_last_write_before = ""
          output_length_before = ""
          process_progress_detected = "NO"
          wsl_agent_progress_detected = "NO"
        }
        if ($outerWaitMs -gt 0) {
          $watchWait = Wait-SilverCursorInvokeWithStaleWatchdog -Process $p -AdapterOutputPath $outAbs -StdoutTmp $stdoutTmp -StderrTmp $stderrTmp -OuterWaitMs $outerWaitMs -RepoRoot $RepoRoot
          $ce = [int]$watchWait.ExitCode
          $staleInvokeDetected = [bool]$watchWait.StaleInvokeDetected
          if ($watchWait.ContainsKey("ProgressSnapshotBefore")) {
            $staleSnapBefore = $watchWait.ProgressSnapshotBefore
          }
          if ($ce -eq 124) { $outerWallTimedOut = $true }
        }
        else {
          $watchWait = Wait-SilverCursorInvokeWithStaleWatchdog -Process $p -AdapterOutputPath $outAbs -StdoutTmp $stdoutTmp -StderrTmp $stderrTmp -OuterWaitMs 0 -RepoRoot $RepoRoot
          $ce = [int]$watchWait.ExitCode
          $staleInvokeDetected = [bool]$watchWait.StaleInvokeDetected
          if ($watchWait.ContainsKey("ProgressSnapshotBefore")) {
            $staleSnapBefore = $watchWait.ProgressSnapshotBefore
          }
        }
        if ($staleInvokeDetected) {
          $null = Invoke-SilverStaleCursorInvokeCloseout -RepoRoot $RepoRoot -AdapterOutputPath $outAbs -Process $p `
            -StdoutTmp $stdoutTmp -StderrTmp $stderrTmp -TaskDigest $expectedTaskDigest -TaskFile $expectedTaskFile `
            -OutputFile $outAbs -ProcessStartUtc $cursorProcStartUtc -ProgressSnapshotBefore $staleSnapBefore
          Invoke-SilverBeepComplete -NoBeep:$NoBeep
          $script:LastCursorExit = "125"
          $cursorExitStr = "125"
          Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
            -CursorExit $cursorExitStr -AutopilotExit "N/A" -StatusExit "N/A" `
            -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
            -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
            -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
            -Headline (Get-NextActionHeadline -Text $nextText) -Focus "stale_cursor_invoke_no_progress" `
            -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1 `
            -StopReason "STALE_CURSOR_INVOKE_NO_PROGRESS"
        }
        $runCtxReconcile = Get-SilverAutonomousRunContext
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
        if ($outerWallTimedOut) {
          $writeOuterTerminal = $true
          if (Test-Path -LiteralPath $CursorOutputPath) {
            $metaOuterCheck = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $CursorOutputPath
            if ($metaOuterCheck.ContainsKey("adapter_output_state")) {
              if ([string]$metaOuterCheck["adapter_output_state"] -eq "COMPLETED") {
                $writeOuterTerminal = $false
              }
            }
          }
          if ($writeOuterTerminal) {
            $runCtxOuter = Get-SilverAutonomousRunContext
            $digestOuter = $expectedTaskDigest
            if ([string]::IsNullOrWhiteSpace($digestOuter)) { $digestOuter = "outer_wall_timeout" }
            $procStartIsoOuter = $cursorProcStartUtc.ToString("o")
            Write-SilverCursorOutputOuterWallTimeoutTerminal -Path $CursorOutputPath `
              -RunId $runCtxOuter.RunId -RunStartUtcIso $runCtxOuter.RunStartUtc -CycleState $runCtxOuter.Cycle `
              -TaskDigest $digestOuter -OuterStdout $so -OuterStderr $se -EffectiveTimeoutSeconds $effectiveCap50TimeoutSeconds `
              -ProcessStartUtcIso $procStartIsoOuter -TaskFile $expectedTaskFile -OutputFile $outAbs
            Write-Host ("silver-autopilot-loop: outer_wall_timeout=YES effective_timeout_seconds=" + [string]$effectiveCap50TimeoutSeconds) -ForegroundColor DarkYellow
          }
        }
        $metaWait = Wait-SilverAdapterMetaReadyForReconcile -AdapterOutputPath $outAbs -ProcessStartUtc $cursorProcStartUtc -ExpectedTaskDigest $expectedTaskDigest -ExpectedTaskFile $expectedTaskFile -ExpectedOutputFile $outAbs -ExpectedRunId $runCtxReconcile.RunId -ExpectedCycle $runCtxReconcile.Cycle -ExpectedRunStartUtc $runCtxReconcile.RunStartUtc
        Write-Host ("silver-autopilot-loop: adapter_meta_reconcile_wait_attempts=" + [string]$metaWait.Attempts + " reconcile_eligible=" + $(if ($metaWait.ReconcileEligible) { "YES" } else { "NO" })) -ForegroundColor DarkYellow
        $reconcile = Resolve-SilverCursorOuterExitFromAdapterMeta -OuterExit $ce -AdapterOutputPath $outAbs -ProcessStartUtc $cursorProcStartUtc -ExpectedTaskDigest $expectedTaskDigest -ExpectedTaskFile $expectedTaskFile -ExpectedOutputFile $outAbs -ExpectedRunId $runCtxReconcile.RunId -ExpectedCycle $runCtxReconcile.Cycle -ExpectedRunStartUtc $runCtxReconcile.RunStartUtc
        if ($reconcile.Reconciled) {
          Write-Host ("silver-autopilot-loop: outer_cmd_exit=" + [string]$ce + " reconciled_to_adapter_exit_code=0 (reconcile_eligible=YES)") -ForegroundColor DarkYellow
          $ce = [int]$reconcile.EffectiveExit
        }
        elseif (($ce -ne 0) -and (-not $reconcile.Reconciled)) {
          $reconcileNote = "adapter_meta_stale_or_mismatch"
          if ($reconcile.ContainsKey("TerminalCompletion") -and $reconcile.TerminalCompletion) {
            $reconcileNote = "adapter_meta_terminal_completion_exit_preserved"
          }
          elseif ($reconcile.MismatchDiagnostics) {
            $diagReason = [string]$reconcile.MismatchDiagnostics.exact_mismatch_reason
            if ($diagReason -and ($diagReason -ne "(none)")) {
              if ($diagReason -match 'adapter_meta_invalidated_stub_pending_flush|adapter_output_state_invalidated_awaiting_cycle') {
                $reconcileNote = "adapter_meta_pending_flush:" + $diagReason
              }
              else {
                $reconcileNote = "adapter_meta_stale_or_mismatch:" + $diagReason
              }
            }
          }
          if (Test-Path -LiteralPath $outAbs) {
            $metaReconcile = Get-SilverAdapterMetaKeyValuesFromMarkdown -Path $outAbs
            $stateRec = ""
            if ($metaReconcile.ContainsKey("adapter_output_state")) { $stateRec = [string]$metaReconcile["adapter_output_state"] }
            if (($stateRec -ne "INVALIDATED_AWAITING_CYCLE") -and $metaReconcile.ContainsKey("timed_out") -and ([string]$metaReconcile["timed_out"] -eq "YES")) {
              $completionRec = ""
              if ($metaReconcile.ContainsKey("adapter_completion_path")) { $completionRec = [string]$metaReconcile["adapter_completion_path"] }
              if ($completionRec -notmatch 'outer_wall_timeout_terminal|terminal_emergency_write') {
                if (Test-SilverAdapterMetaCycleScoped -Meta $metaReconcile -ProcessStartUtc $cursorProcStartUtc -AdapterOutputPath $outAbs -ExpectedTaskDigest $expectedTaskDigest -ExpectedTaskFile $expectedTaskFile -ExpectedOutputFile $outAbs -ExpectedRunId $runCtxReconcile.RunId -ExpectedCycle $runCtxReconcile.Cycle -ExpectedRunStartUtc $runCtxReconcile.RunStartUtc) {
                  $reconcileNote = "adapter_meta_timeout_blocks_reconcile"
                }
              }
            }
          }
          Write-Host ("silver-autopilot-loop: outer_cmd_exit=" + [string]$ce + " not_reconciled (" + $reconcileNote + ")") -ForegroundColor DarkYellow
          if ($reconcile.MismatchDiagnostics) {
            Write-SilverAdapterMetaMismatchDiagnosticBlock -Diag $reconcile.MismatchDiagnostics
          }
        }
        $script:LastCursorExit = [string]$ce
        $cursorExitStr = [string]$ce
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
      }
      catch {
        $invokeFailReason = "adapter_invoke_process_exception|" + $_.Exception.Message
        if (-not $script:SilverCycleAdapterInvokeCommitted) {
          $invokeFailReason = "adapter_invoke_never_committed_after_rearm|" + $_.Exception.Message
        }
        Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
          -CursorExit "EXCEPTION" -AutopilotExit "N/A" -StatusExit "N/A" `
          -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
          -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
          -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
          -Headline (Get-NextActionHeadline -Text $nextText) -Focus "adapter_invoke_process_exception" `
          -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1 `
          -StopReason $invokeFailReason
      }
      finally {
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
      if ($script:SilverCycleCursorProcessStartUtc -ne [datetime]::MinValue) {
        $runCtxBoundary = Get-SilverAutonomousRunContext
        $boundaryProcStart = $script:SilverCycleCursorProcessStartUtc
        $boundaryOutAbs = $CursorOutputPath
        if (Test-Path -LiteralPath $CursorOutputPath) {
          $boundaryOutAbs = (Resolve-Path -LiteralPath $CursorOutputPath).Path
        }
        $adapterBoundary = Test-SilverAutonomousAdapterCompletionBoundary `
          -AdapterOutputPath $boundaryOutAbs `
          -ProcessStartUtc $boundaryProcStart `
          -ExpectedTaskDigest $script:SilverCycleExpectedTaskDigest `
          -ExpectedTaskFile $script:SilverCycleExpectedTaskFile `
          -ExpectedOutputFile $boundaryOutAbs `
          -ExpectedRunId $runCtxBoundary.RunId `
          -ExpectedCycle $runCtxBoundary.Cycle `
          -ExpectedRunStartUtc $runCtxBoundary.RunStartUtc
        Write-Host ("silver-autopilot-loop: adapter_completion_boundary_PASS_FAIL=" + [string]$adapterBoundary.PASS_FAIL + " adapter_output_valid=" + [string]$adapterBoundary.adapter_output_valid + " adapter_meta_fresh=" + [string]$adapterBoundary.adapter_meta_fresh + " reason=" + [string]$adapterBoundary.lifecycle_block_reason) -ForegroundColor DarkCyan
        if ($adapterBoundary.PASS_FAIL -ne "PASS") {
          $boundaryReason = "adapter_completion_boundary_fail|" + [string]$adapterBoundary.lifecycle_block_reason
          if ([string]$adapterBoundary.invalidated_awaiting_cycle -eq "YES") {
            $boundaryReason = $boundaryReason + "|hint=adapter_never_flushed_after_rearm"
          }
          Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
            -CursorExit $cursorExitStr -AutopilotExit "N/A" -StatusExit "N/A" `
            -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
            -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
            -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
            -Headline (Get-NextActionHeadline -Text $nextText) -Focus "adapter_completion_boundary_fail" `
            -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1 `
            -StopReason $boundaryReason
        }
      }
      $utf8AfterCursor = Invoke-SilverCap50Utf8SurfacesHardGate -RepoRoot $RepoRoot -NextActionPath $NextActionPath -CursorOutputPath $CursorOutputPath
      $nextAfterCursor = Read-TextFileOrEmpty -Path $NextActionPath
      if (-not (Test-SilverNextActionOutputQuality -Text $nextAfterCursor)) {
        try {
          $sanitizePostCursor = Invoke-NodeScript -WorkingDirectory $RepoRoot -Arguments @($AutopilotScript, "--sanitize-next-action-md") -PassThruExit $true
          if (($null -ne $sanitizePostCursor) -and ($sanitizePostCursor.ExitCode -eq 0)) {
            $nextAfterCursor = Read-TextFileOrEmpty -Path $NextActionPath
            Write-Host "silver-autopilot-loop: post_cursor_next_action_sanitize=OK" -ForegroundColor DarkCyan
          }
        }
        catch {
          Write-Host "silver-autopilot-loop: post_cursor_next_action_sanitize_invoke_failed" -ForegroundColor DarkYellow
        }
      }
      if (-not (Test-SilverNextActionOutputQuality -Text $nextAfterCursor)) {
        $postCursorFailures = Get-SilverNextActionQualityFailureDetail -Text $nextAfterCursor
        Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
          -CursorExit $cursorExitStr -AutopilotExit "N/A" -StatusExit "N/A" `
          -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
          -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
          -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
          -Headline (Get-NextActionHeadline -Text $nextAfterCursor) -Focus "next_action_quality_post_cursor" `
          -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1 `
          -StopReason ("next_action_quality_post_cursor|failures=" + ($postCursorFailures -join ";"))
      }
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
    Restore-SilverTransientGeneratedDiagnosticReports -RepoRoot $RepoRoot
    Restore-SilverTransientGeneratedAuditReports -RepoRoot $RepoRoot
    $auto = Invoke-NodeScript -WorkingDirectory $RepoRoot -Arguments @($AutopilotScript, "--full-auto-loop", "--max-steps=1") -PassThruExit $false
    $ae = $auto.ExitCode
    $script:LastAutopilotExit = [string]$ae
    $autoExitStr = [string]$ae
    $autopilotHandoffPreserve = @("SILVER_NEXT_ACTION.md", "SILVER_CURSOR_OUTPUT.md", "SILVER_RUN_REPORT.md", "SILVER_PROGRESS_LOG.md")
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
    $selectorForCloseout = Get-SilverAuthoritativeSelectorCluster -RepoRoot $RepoRoot
    $expectedForCloseout = Get-SilverExpectedOutcomeForProductArtifact -RepoRoot $RepoRoot
    if (-not $expectedForCloseout) {
      $expectedForCloseout = Get-SilverExpectedOutcomeFromNextAction -NextActionText $nextAfterAuto
    }
    $postAutoCleanup = Invoke-SilverCap50PostCycleRuntimeCleanup -RepoRoot $RepoRoot -Cycle $cycle -Reason "after_autopilot_full_auto_loop" -ExcludeRestoreRelPaths $autopilotHandoffPreserve -AllowHandoffDirty -AllowValidProductWork -AllowProductArtifactRuntimePending:$controlledInfinite -SelectorCluster $selectorForCloseout -ExpectedOutcome $expectedForCloseout -SafetyCounters $safetyPre
    Write-Host ("silver-autopilot-loop: post_autopilot_cleanup_PASS_FAIL=" + [string]$postAutoCleanup.PASS_FAIL) -ForegroundColor DarkCyan
    Write-Host ("silver-autopilot-loop: post_autopilot_closeout_kind=" + [string]$postAutoCleanup.closeout_kind) -ForegroundColor DarkCyan
    if ($postAutoCleanup.PASS_FAIL -ne "PASS") {
      $vpwEval = Invoke-SilverValidProductWorkCloseoutEval -RepoRoot $RepoRoot -AutopilotScript $AutopilotScript -SafetyCounters $safetyPre
      Write-Host ("silver-autopilot-loop: valid_product_work_closeout_PASS_FAIL=" + [string]$vpwEval.PASS_FAIL) -ForegroundColor DarkCyan
      Write-Host ("silver-autopilot-loop: valid_product_work_final_outcome=" + [string]$vpwEval.final_outcome) -ForegroundColor DarkCyan
      if ([string]$vpwEval.PASS_FAIL -eq "PASS" -and [string]$vpwEval.final_outcome -eq "PR_READY") {
        $postAutoCleanup.PASS_FAIL = "PASS"
        $postAutoCleanup.closeout_kind = "valid_product_work"
        $postAutoCleanup.failure_class = "valid_product_work"
        Write-Host "silver-autopilot-loop: post_autopilot_valid_product_work_closeout=PR_READY" -ForegroundColor Green
      }
      elseif ([string]$vpwEval.PASS_FAIL -eq "PASS" -and ([string]$vpwEval.final_outcome -eq "NO_SAFE_FIX" -or [string]$vpwEval.final_outcome -eq "SAFE_BLOCKED")) {
        $postAutoCleanup.PASS_FAIL = "PASS"
        $postAutoCleanup.closeout_kind = [string]$vpwEval.final_outcome
        Write-Host ("silver-autopilot-loop: post_autopilot_valid_product_work_closeout=" + [string]$vpwEval.final_outcome) -ForegroundColor DarkYellow
      }
      elseif ([string]$postAutoCleanup.closeout_kind -eq "product_artifact_runtime_pending") {
        $postAutoCleanup.PASS_FAIL = "PASS"
        $postAutoCleanup.failure_class = "product_artifact_runtime_pending"
        Write-Host "silver-autopilot-loop: post_autopilot_product_artifact_runtime_pending=YES git_status_clean=NO safe_to_continue=YES" -ForegroundColor DarkCyan
      }
      else {
        Write-Host ("silver-autopilot-loop: post_autopilot_blocked_dirty_files=" + [string]$postAutoCleanup.blocked_dirty_files) -ForegroundColor Red
        Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
          -CursorExit $cursorExitStr -AutopilotExit $autoExitStr -StatusExit "N/A" `
          -GitClean ([string]$postAutoCleanup.git_clean_after) -SafetyLine $safetyPre `
          -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
          -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
          -Headline (Get-NextActionHeadline -Text $nextAfterAuto) -Focus "post_autopilot_runtime_cleanup_blocked" `
          -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1 `
          -StopReason ("post_autopilot_runtime_cleanup_blocked|closeout_kind=" + [string]$postAutoCleanup.closeout_kind + "|blocked=" + [string]$postAutoCleanup.blocked_dirty_files)
      }
    }
    if ($controlledInfinite) {
      $selectorCluster = Get-SilverAuthoritativeSelectorCluster -RepoRoot $RepoRoot
      $capProfileHandoff = ""
      if ($ControlledCapProfile) { $capProfileHandoff = [string]$ControlledCapProfile }
      $handoffEval = Invoke-SilverProductHandoffContinuationEval -RepoRoot $RepoRoot -AutopilotScript $AutopilotScript `
        -NextActionText $nextAfterAuto -CursorOutputPath $CursorOutputPath -RunReportPath $RunReportPath `
        -AuthoritativeCluster $selectorCluster -ControlledCapProfile $capProfileHandoff
      if ($handoffEval.selector_cluster) {
        $selectorCluster = [string]$handoffEval.selector_cluster
      }
      if ($selectorCluster) {
        Write-Host ("silver-autopilot-loop: selector_cluster=" + $selectorCluster) -ForegroundColor DarkCyan
      }
      Write-Host ("silver-autopilot-loop: product_handoff_continuation_ready=" + [string]$handoffEval.continuation_ready + " kind=" + [string]$handoffEval.continuation_kind) -ForegroundColor DarkCyan
      if ([string]$handoffEval.continuation_ready -ne "YES") {
        $null = Invoke-SilverOrchestrationProductHandoffBridge -RepoRoot $RepoRoot -AutopilotScript $AutopilotScript
        $nextAfterAuto = Read-TextFileOrEmpty -Path $NextActionPath
        $handoffEval = Invoke-SilverProductHandoffContinuationEval -RepoRoot $RepoRoot -AutopilotScript $AutopilotScript `
          -NextActionText $nextAfterAuto -CursorOutputPath $CursorOutputPath -RunReportPath $RunReportPath `
          -AuthoritativeCluster $selectorCluster -ControlledCapProfile $capProfileHandoff
        if ($handoffEval.selector_cluster) { $selectorCluster = [string]$handoffEval.selector_cluster }
      }
      if ([string]$handoffEval.continuation_ready -ne "YES") {
        $handoffReason = [string]$handoffEval.reason
        if (-not $handoffReason) { $handoffReason = "product_task_handoff_missing" }
        Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
          -CursorExit $cursorExitStr -AutopilotExit $autoExitStr -StatusExit "N/A" `
          -GitClean ($(if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" })) -SafetyLine $safetyPre `
          -CalW (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_write_20k") `
          -CalQ (Get-RunReportLineValue -ReportText $reportPre -Key "calendar_query_20k") `
          -Headline (Get-NextActionHeadline -Text $nextAfterAuto) -Focus $handoffReason `
          -DryRunText "NO" -NoBeep:$NoBeep -LastTaskExitCode 1 `
          -StopReason ($handoffReason + "|selector_cluster=" + [string]$selectorCluster + "|continuation_kind=" + [string]$handoffEval.continuation_kind)
      }
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
    Restore-SilverTransientGeneratedDiagnosticReports -RepoRoot $RepoRoot
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
  $passOutAbs = $CursorOutputPath
  if (Test-Path -LiteralPath $CursorOutputPath) {
    $passOutAbs = (Resolve-Path -LiteralPath $CursorOutputPath).Path
  }
  Add-SilverCycleFieldsFromAdapterOutput -Fields $fieldsPass -AdapterOutputPath $passOutAbs -ProcessStartUtc $passProcStart -ExpectedTaskDigest $passDigest -ExpectedTaskFile $passTaskFile -ExpectedOutputFile $passOutAbs -ExpectedRunId $passRunCtx.RunId -ExpectedCycle $passRunCtx.Cycle -ExpectedRunStartUtc $passRunCtx.RunStartUtc -CursorInvoked $passCursorInvoked
  if ($controlledInfinite -and $passCursorInvoked) {
    if ([string]$fieldsPass["silver_cycle_adapter_meta_fresh"] -ne "YES") {
      $staleReason = "adapter_meta_not_fresh_at_cycle_pass"
      if ($fieldsPass.ContainsKey("silver_cycle_real_stale_adapter_meta_issue")) {
        $staleReason = "adapter_meta_stale_cycle_scoped_mismatch"
      }
      Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
        -CursorExit $cursorExitStr -AutopilotExit $autoExitStr -StatusExit ([string]$se) `
        -GitClean $gitCleanFinal -SafetyLine $safetyPost `
        -CalW (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_write_20k") `
        -CalQ (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_query_20k") `
        -Headline (Get-NextActionHeadline -Text $nextAfter) -Focus "adapter_meta_fresh_cycle_pass_guard" `
        -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 1 `
        -StopReason $staleReason
    }
  }
  if ($controlledInfinite) {
    $script:AutonomousCyclesCompleted++
    $cycleProductPass = ($se -eq 0) -and ($cursorExitStr -eq "0") -and ([string]$fieldsPass["silver_cycle_adapter_meta_fresh"] -eq "YES")
    if ($cycleProductPass) {
      $script:AutonomousCyclesPass++
    }
    Update-SilverAutonomousReportingHygieneAccumulator -ReportText $reportPost -CycleFields $fieldsPass
    $selectorMid = Get-SilverAuthoritativeSelectorCluster -RepoRoot $RepoRoot
    if ($script:SilverControlledBudgetGuardActive) {
      $outHashMid = ""
      if (Test-Path -LiteralPath $CursorOutputPath) {
        $outHashMid = (Get-FileHash -LiteralPath $CursorOutputPath -Algorithm SHA256).Hash
      }
      $auditSumMid = ""
      $reportMid = Read-TextFileOrEmpty -Path $RunReportPath
      if ($reportMid -match 'PASS_FAIL=([A-Z_]+)') { $auditSumMid = $Matches[1] }
      $stagMid = Invoke-SilverControlledBudgetGuardNode -SubCommand "record-stagnation" -RepoRoot $RepoRoot `
        -RunId ([string]$script:SilverControlledBudgetGuardRunId) -Cluster $selectorMid -OutputHash $outHashMid -AuditSummary $auditSumMid
      if ($stagMid.exit -ne 0) {
        Stop-LoopWithFail -ProgressLogPath $ProgressLogPath -RepoRoot $RepoRoot -Cycle $cycle -MainCommit $mainCommit `
          -CursorExit $cursorExitStr -AutopilotExit $autoExitStr -StatusExit ([string]$se) `
          -GitClean $gitCleanFinal -SafetyLine $safetyPost `
          -CalW (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_write_20k") `
          -CalQ (Get-RunReportLineValue -ReportText $reportPost -Key "calendar_query_20k") `
          -Headline (Get-NextActionHeadline -Text $nextAfter) -Focus "controlled_budget_guard_stagnation" `
          -DryRunText ($(if ($DryRun) { "YES" } else { "NO" })) -NoBeep:$NoBeep -LastTaskExitCode 2 `
          -StopReason "CONTROLLED_BUDGET_GUARD_STAGNATION"
      }
    }
    $null = Invoke-SilverAutonomousProductOutcomeMidCycleGate -RepoRoot $RepoRoot -ProgressLogPath $ProgressLogPath `
      -Cycle $cycle -MainCommit $mainCommit -ReportText $reportPost -NextActionText $nextAfter `
      -SelectorCluster $selectorMid -CursorExit $cursorExitStr -AutopilotExit $autoExitStr -StatusExit ([string]$se) `
      -SafetyLine $safetyPost -GitClean $gitCleanFinal -NoBeep:$NoBeep
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
    $null = Invoke-SilverEnsureRegistryClusterProductHandoff -RepoRoot $RepoRoot -AutopilotScript $AutopilotScript
    $nextExit = Read-TextFileOrEmpty -Path $NextActionPath
    if (-not (Test-SilverNextActionOutputQuality -Text $nextExit)) {
      $null = Invoke-SilverOrchestrationProductHandoffBridge -RepoRoot $RepoRoot -AutopilotScript $AutopilotScript
      $nextExit = Read-TextFileOrEmpty -Path $NextActionPath
    }
    $null = Invoke-SilverCap50PostCycleRuntimeCleanup -RepoRoot $RepoRoot -Cycle $finalCycle -Reason "loop_exit_final_runtime_restore"
    $reportEnd = Read-TextFileOrEmpty -Path $RunReportPath
    $safetyEnd = Get-RunReportLineValue -ReportText $reportEnd -Key "safety_counters"
    $finalOk = Invoke-SilverCap50FinalPostcondition -RepoRoot $RepoRoot -CyclesCompleted $script:AutonomousCyclesCompleted -StopReason "loop_exit" -NextActionPath $NextActionPath -CursorOutputPath $CursorOutputPath -SafetyCountersLine $safetyEnd
    Write-SilverCap50FinalPostconditionBlock -Result $finalOk
    if ($finalOk.PASS_FAIL -eq "PASS") {
      Invoke-SilverBeepPass -NoBeep:$NoBeep
    }
  }
}

$finalCyclesForScorecard = $cycle
if ($script:AutonomousCyclesCompleted -gt 0) { $finalCyclesForScorecard = $script:AutonomousCyclesCompleted }
$finalScorecardRuntimeFailure = "NO"
if ($controlledInfinite -and $script:AutonomousCyclesCompleted -gt 0) {
  if ($script:AutonomousCyclesPass -lt $script:AutonomousCyclesCompleted) {
    $finalScorecardRuntimeFailure = "YES"
  }
}
Invoke-SilverCapProductScorecardIfActive -RepoRoot $RepoRoot -ProgressLogPath $ProgressLogPath -CyclesCompleted $finalCyclesForScorecard -StopReason "loop_exit" -RuntimeFailure $finalScorecardRuntimeFailure
if ($script:SilverControlledBudgetGuardActive) {
  $finalOutcome = "NO_CHANGE"
  if ($script:AutonomousCyclesPass -gt 0 -and $finalScorecardRuntimeFailure -ne "YES") { $finalOutcome = "PR_READY" }
  if ($finalScorecardRuntimeFailure -eq "YES") { $finalOutcome = "SAFE_BLOCKED" }
  $finBg = Invoke-SilverControlledBudgetGuardNode -SubCommand "finalize" -RepoRoot $RepoRoot `
    -RunId ([string]$script:SilverControlledBudgetGuardRunId) -FinalOutcome $finalOutcome
  if ($finBg.exit -ne 0) {
    Write-Host $finBg.stdout -ForegroundColor Yellow
  } else {
    Write-Host ("silver-autopilot-loop: controlled_budget_guard_finalize=OK outcome=" + $finalOutcome) -ForegroundColor DarkCyan
  }
}
if (Get-Command -Name Invoke-SilverAuditRegistryReport -ErrorAction SilentlyContinue) {
  $null = Invoke-SilverAuditRegistryReport -RepoRoot $RepoRoot
}
Invoke-SilverBeepComplete -NoBeep:$NoBeep

exit 0
