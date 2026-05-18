#requires -Version 5.1
<#
.SYNOPSIS
  CAP50 / autonomous orchestration policy (timeout + CursorCommand normalization). Scripts-only.
#>
Set-StrictMode -Version 2

if (-not (Get-Variable -Name SilverCap50AutonomousEffectiveTimeoutSeconds -Scope Script -ErrorAction SilentlyContinue)) {
  $script:SilverCap50AutonomousEffectiveTimeoutSeconds = 3400
  $script:SilverCap50LegacyForbiddenTimeoutSeconds = 120
}

function Resolve-SilverAutonomousAdapterTimeoutSeconds {
  param(
    [int]$RequestedTimeoutSeconds,
    [switch]$Probe,
    [switch]$ProductTaskRun
  )
  $effective = $RequestedTimeoutSeconds
  $adjusted = "NO"
  $reason = "unchanged"
  if ($Probe) {
    return @{
      TimeoutSeconds            = $RequestedTimeoutSeconds
      EffectiveTimeoutSeconds   = $RequestedTimeoutSeconds
      TimeoutAdjusted           = $adjusted
      TimeoutAdjustReason       = "probe_unchanged"
    }
  }
  if ($ProductTaskRun -and ($RequestedTimeoutSeconds -eq $script:SilverCap50LegacyForbiddenTimeoutSeconds)) {
    $effective = $script:SilverCap50AutonomousEffectiveTimeoutSeconds
    $adjusted = "YES"
    $reason = "cap50_forbidden_120_bumped_to_3400"
  }
  return @{
    TimeoutSeconds            = $effective
    EffectiveTimeoutSeconds   = $effective
    TimeoutAdjusted           = $adjusted
    TimeoutAdjustReason       = $reason
  }
}

function Resolve-SilverCursorCommandAutonomousTimeout {
  param(
    [string]$CursorCommand,
    [bool]$AutonomousOrCap50
  )
  $cmd = [string]$CursorCommand
  if ([string]::IsNullOrWhiteSpace($cmd)) {
    return @{
      Command                   = ""
      EffectiveTimeoutSeconds   = 0
      TimeoutAdjusted           = "NO"
      TimeoutAdjustReason       = "empty_command"
    }
  }
  $effective = $script:SilverCap50AutonomousEffectiveTimeoutSeconds
  $adjusted = "NO"
  $reason = "unchanged"
  if ($cmd -match '(?i)-TimeoutSeconds\s+(\d+)') {
    $current = [int]$Matches[1]
    if ($AutonomousOrCap50 -and ($current -eq $script:SilverCap50LegacyForbiddenTimeoutSeconds)) {
      $cmd = [regex]::Replace($cmd, '(?i)-TimeoutSeconds\s+120\b', ('-TimeoutSeconds ' + [string]$effective))
      $adjusted = "YES"
      $reason = "cursor_command_forbidden_120_bumped_to_3400"
    }
    else {
      $effective = $current
    }
  }
  elseif ($AutonomousOrCap50 -and ($cmd -match '(?i)silver-cursor-agent-adapter\.ps1')) {
    $cmd = $cmd.TrimEnd() + ' -TimeoutSeconds ' + [string]$effective
    $adjusted = "YES"
    $reason = "cursor_command_missing_timeout_defaulted_3400"
  }
  return @{
    Command                   = $cmd
    EffectiveTimeoutSeconds   = $effective
    TimeoutAdjusted           = $adjusted
    TimeoutAdjustReason       = $reason
  }
}

function Test-SilverCap50Utf8ProbeStrings {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return $false }
  $need = @(
    ([string][char]0x00DA + "KOL PRO CURSOR"),
    ("Aktu" + [char]0x00E1 + "ln" + [char]0x00ED),
    "pozn" + [char]0x00E1 + "mka",
    "zm" + [char]0x011B + "nil",
    "klasifik" + [char]0x00E1 + "tor",
    ([char]0x0161 + "pinav")
  )
  foreach ($frag in $need) {
    if ($Text.IndexOf($frag, [System.StringComparison]::Ordinal) -lt 0) {
      return $false
    }
  }
  return $true
}

function Test-SilverCap50Utf8HardFailRaw {
  param(
    [string]$Text,
    [string]$SurfaceLabel
  )
  if ([string]::IsNullOrEmpty($Text)) {
    return @{ detected = "NO"; locations = ""; surface = $SurfaceLabel; sample = "" }
  }
  if (Test-SilverUtf8MojibakeMarkersStrict -Text $Text) {
    $locs = Get-SilverUtf8MojibakeHitLocations -Text $Text
    return @{
      detected  = "YES"
      locations = ($locs -join ";")
      surface   = $SurfaceLabel
      sample    = (Get-SilverUtf8MojibakeFirstSample -Text $Text)
    }
  }
  return @{ detected = "NO"; locations = ""; surface = $SurfaceLabel; sample = "" }
}

function Test-SilverCap50Utf8HardFailAfterRepair {
  param(
    [string]$Text,
    [string]$SurfaceLabel
  )
  return (Test-SilverCap50Utf8HardFailRaw -Text $Text -SurfaceLabel $SurfaceLabel)
}

function Test-SilverCap50ManualOnlyRecommendedNextTask {
  param([string]$Text)
  $t = ([string]$Text).Trim()
  if (-not $t) { return $false }
  if ($t -match '(?i)^Execute\s+steps\s+in\s+SILVER_NEXT_ACTION\.md\s+in\s+Cursor\.?\s*$') { return $true }
  if ($t -match '(?i)^SILVER_NEXT_ACTION\.md\s+written.*execute\s+in\s+Cursor\.?\s*$') { return $true }
  if ($t -match '(?i)execute\s+in\s+Cursor\.?\s*$' -and $t -notmatch '(?i)silver-|diagnostic|cluster|scripts/') { return $true }
  return $false
}

function Test-SilverCap50NextActionIsAutonomousHandoff {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  if ($Text -match '(?i)^\s*STOP\b') { return $false }
  if (Test-SilverUtf8MojibakeMarkersCore -Text $Text) { return $false }
  if ($Text.Trim().Length -lt 40) { return $false }
  if ($Text -match '(?i)ÚKOL PRO CURSOR|PRODUCT_CLUSTER|scripts/silver-|silver-rhc3') { return $true }
  if ($Text -match '(?i)powershell|node\s+scripts/|\.ps1\b') { return $true }
  return $false
}

function Get-SilverCap50NextActionMode {
  param(
    [string]$NextActionText,
    [string]$RecommendedNextTask,
    [bool]$ControlledInfinite
  )
  if (-not $ControlledInfinite) { return "STOP" }
  if ($NextActionText -match '(?i)^\s*STOP\b|STOP_MANUAL_REQUIRED|MANUAL_REQUIRED|human\s+decision') {
    return "MANUAL_REQUIRED"
  }
  if (Test-SilverCap50NextActionIsAutonomousHandoff -Text $NextActionText) {
    return "AUTONOMOUS_CONTINUE"
  }
  if (Test-SilverCap50ManualOnlyRecommendedNextTask -Text $RecommendedNextTask) {
    return "MANUAL_REQUIRED"
  }
  return "MANUAL_REQUIRED"
}

function Get-SilverCap50AdapterStdoutSection {
  param([string]$FullText)
  if ([string]::IsNullOrEmpty($FullText)) { return "" }
  $stdoutMarker = "# stdout"
  $idx = $FullText.IndexOf($stdoutMarker, [System.StringComparison]::Ordinal)
  if ($idx -lt 0) { return "" }
  $tail = $FullText.Substring($idx + $stdoutMarker.Length)
  $stderrMarker = "# stderr"
  $stderrIdx = $tail.IndexOf($stderrMarker, [System.StringComparison]::Ordinal)
  if ($stderrIdx -ge 0) { $tail = $tail.Substring(0, $stderrIdx) }
  return $tail
}

function Invoke-SilverCap50Utf8SurfacesHardGate {
  param(
    [string]$RepoRoot,
    [string]$NextActionPath,
    [string]$CursorOutputPath
  )
  $surfaces = New-Object System.Collections.Generic.List[hashtable]
  if (Test-Path -LiteralPath $NextActionPath) {
    $nextRaw = Read-TextFileUtf8Raw -Path $NextActionPath
    $hit = Test-SilverCap50Utf8HardFailRaw -Text $nextRaw -SurfaceLabel "SILVER_NEXT_ACTION"
    if ($hit.detected -eq "YES") { [void]$surfaces.Add($hit) }
  }
  if (Test-Path -LiteralPath $CursorOutputPath) {
    $cursorFull = Read-TextFileUtf8Raw -Path $CursorOutputPath
    $hitFull = Test-SilverCap50Utf8HardFailRaw -Text $cursorFull -SurfaceLabel "SILVER_CURSOR_OUTPUT_full"
    if ($hitFull.detected -eq "YES") { [void]$surfaces.Add($hitFull) }
    $metaPreview = ""
    foreach ($raw in $cursorFull -split "`r?`n") {
      $line = $raw.Trim()
      if ($line.StartsWith("prompt_preview=")) {
        $metaPreview = $line.Substring("prompt_preview=".Length)
        break
      }
    }
    if ($metaPreview) {
      $hitP = Test-SilverCap50Utf8HardFailRaw -Text $metaPreview -SurfaceLabel "prompt_preview"
      if ($hitP.detected -eq "YES") { [void]$surfaces.Add($hitP) }
    }
    $stdoutSec = Get-SilverCap50AdapterStdoutSection -FullText $cursorFull
    if ($stdoutSec) {
      $hitO = Test-SilverCap50Utf8HardFailRaw -Text $stdoutSec -SurfaceLabel "stdout"
      if ($hitO.detected -eq "YES") { [void]$surfaces.Add($hitO) }
    }
    $stderrMarker = "# stderr"
    $stderrIdx = $cursorFull.IndexOf($stderrMarker, [System.StringComparison]::Ordinal)
    if ($stderrIdx -ge 0) {
      $stderrSec = $cursorFull.Substring($stderrIdx + $stderrMarker.Length)
      $hitE = Test-SilverCap50Utf8HardFailRaw -Text $stderrSec -SurfaceLabel "stderr"
      if ($hitE.detected -eq "YES") { [void]$surfaces.Add($hitE) }
    }
  }
  if ($surfaces.Count -gt 0) {
    $locParts = New-Object System.Collections.Generic.List[string]
    $sampleParts = New-Object System.Collections.Generic.List[string]
    foreach ($s in $surfaces) {
      [void]$locParts.Add([string]$s.surface + ":" + [string]$s.locations)
      if ([string]$s.sample) {
        [void]$sampleParts.Add([string]$s.surface + "=" + [string]$s.sample)
      }
    }
    return @{
      PASS_FAIL                   = "FAIL"
      utf8_mojibake_detected      = "YES"
      utf8_mojibake_locations     = ($locParts -join " | ")
      utf8_mojibake_first_sample  = ($sampleParts -join " | ")
      ready_for_product_cap50     = "NO"
      reason                      = "utf8_mojibake_detected"
    }
  }
  return @{
    PASS_FAIL                   = "PASS"
    utf8_mojibake_detected      = "NO"
    utf8_mojibake_locations     = ""
    utf8_mojibake_first_sample  = ""
    ready_for_product_cap50     = "YES"
    reason                      = ""
  }
}

function Get-SilverCap50RuntimeEphemeralRelPaths {
  return @(
    "SILVER_CURSOR_OUTPUT.md",
    "SILVER_NEXT_ACTION.md",
    "SILVER_PROGRESS_LOG.md",
    "SILVER_RUN_REPORT.md"
  )
}

function Get-SilverCap50RuntimeGeneratedReportRelPaths {
  param([string]$RepoRoot)
  $out = New-Object System.Collections.Generic.List[string]
  [void]$out.Add("scripts/silver-cursor-agent-adapter-diagnostic-report.json")
  [void]$out.Add("scripts/silver-rhc3-negation-cal-readonly-diagnostic-report.json")
  $scriptsDir = Join-Path $RepoRoot "scripts"
  if (Test-Path -LiteralPath $scriptsDir) {
    foreach ($f in [System.IO.Directory]::EnumerateFiles($scriptsDir, "silver-*-cluster-classifier-v*-report.json")) {
      $rel = "scripts/" + [System.IO.Path]::GetFileName($f)
      [void]$out.Add(($rel -replace '\\', '/'))
    }
  }
  return $out.ToArray()
}

function Archive-SilverCap50CycleRuntimeArtifacts {
  param(
    [string]$RepoRoot,
    [int]$Cycle,
    [string]$Reason
  )
  $archived = "NO"
  $relOut = ""
  $fullDir = ""
  try {
    $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss") + "Z-c" + [string]$Cycle
    $destDir = Join-Path (Join-Path (Join-Path $RepoRoot ".silver-runtime") "cycles") $stamp
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    $copied = New-Object System.Collections.Generic.List[string]
    $missing = New-Object System.Collections.Generic.List[string]
    $names = New-Object System.Collections.Generic.List[string]
    foreach ($n in (Get-SilverCap50RuntimeEphemeralRelPaths)) { [void]$names.Add($n) }
    foreach ($n in (Get-SilverCap50RuntimeGeneratedReportRelPaths -RepoRoot $RepoRoot)) { [void]$names.Add($n) }
    foreach ($name in $names) {
      $src = Join-Path $RepoRoot $name
      if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination (Join-Path $destDir ([System.IO.Path]::GetFileName($name))) -Force
        [void]$copied.Add($name)
      }
      else {
        [void]$missing.Add($name)
      }
    }
    $head = ""
    try { $head = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim() } catch { $head = "" }
    $relSlash = ".silver-runtime/cycles/" + $stamp
    $manifest = [ordered]@{
      utc_timestamp = $stamp
      cycle           = $Cycle
      main_commit_head = $head
      reason          = $Reason
      copied_files    = $copied.ToArray()
      missing_files   = $missing.ToArray()
      archive_path    = $relSlash
    }
    [System.IO.File]::WriteAllText((Join-Path $destDir "manifest.json"), ($manifest | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
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

function Invoke-SilverCap50HardPreflight {
  param(
    [string]$RepoRoot,
    [string]$CursorCommand,
    [switch]$SkipThreeCycleProbe
  )
  $failures = New-Object System.Collections.Generic.List[string]
  $mainCommit = ""
  try { $mainCommit = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim() } catch { $mainCommit = "" }
  $gitCleanBefore = if (Test-Path -LiteralPath (Join-Path $RepoRoot ".git")) {
    $po = ""
    try { $po = (& git -C $RepoRoot status --porcelain 2>$null) } catch { $po = "DIRTY_UNKNOWN" }
    if ($po -eq "") { "YES" } else { "NO" }
  } else { "NO" }
  $cursorPresent = if ([string]::IsNullOrWhiteSpace($CursorCommand)) { "NO" } else { "YES" }
  $tok = Resolve-SilverCursorCommandAutonomousTimeout -CursorCommand $CursorCommand -AutonomousOrCap50 $true
  $effectiveTimeout = [string]$tok.EffectiveTimeoutSeconds
  if ([int]$effectiveTimeout -ne $script:SilverCap50AutonomousEffectiveTimeoutSeconds) {
    [void]$failures.Add("effective_timeout_not_3400")
  }
  $utf8Real = "FAIL"
  $selftestScript = Join-Path $RepoRoot "scripts\silver-wsl-utf8-handoff-selftest.ps1"
  if (Test-Path -LiteralPath $selftestScript) {
    $prevEa = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & powershell -NoProfile -ExecutionPolicy Bypass -File $selftestScript 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $utf8Real = "PASS" } else { [void]$failures.Add("utf8_real_path_probe") }
    $ErrorActionPreference = $prevEa
  }
  else {
    [void]$failures.Add("utf8_selftest_missing")
  }
  $mojReg = "FAIL"
  $regScript = Join-Path $RepoRoot "scripts\silver-cap50-mojibake-regression-selftest.ps1"
  if (Test-Path -LiteralPath $regScript) {
    $prevEa2 = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & powershell -NoProfile -ExecutionPolicy Bypass -File $regScript 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $mojReg = "PASS" } else { [void]$failures.Add("mojibake_regression") }
    $ErrorActionPreference = $prevEa2
  }
  else {
    [void]$failures.Add("mojibake_regression_script_missing")
  }
  $cleanupProbe = "FAIL"
  $loopScript = Join-Path $RepoRoot "scripts\silver-autopilot-loop.ps1"
  if (Test-Path -LiteralPath $loopScript) {
    $prevEa3 = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & powershell -NoProfile -ExecutionPolicy Bypass -File $loopScript -PreflightCleanupSelfTest 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $cleanupProbe = "PASS" } else { [void]$failures.Add("runtime_cleanup_probe") }
    $ErrorActionPreference = $prevEa3
  }
  $threeCycle = "SKIP"
  if (-not $SkipThreeCycleProbe) {
    $loopScript3 = Join-Path $RepoRoot "scripts\silver-autopilot-loop.ps1"
    if (Test-Path -LiteralPath $loopScript3) {
      $prevEa4 = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      & powershell -NoProfile -ExecutionPolicy Bypass -File $loopScript3 -Cap50ThreeCycleOrchestrationProbe 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) { $threeCycle = "PASS" } else { [void]$failures.Add("three_cycle_probe"); $threeCycle = "FAIL" }
      $ErrorActionPreference = $prevEa4
    }
    else {
      [void]$failures.Add("three_cycle_probe_script_missing")
      $threeCycle = "FAIL"
    }
  }
  $safe = if ($failures.Count -eq 0) { "YES" } else { "NO" }
  $passFail = if ($safe -eq "YES") { "PASS" } else { "FAIL" }
  return @{
    main_commit                         = $mainCommit
    git_status_clean_before             = $gitCleanBefore
    cursor_command_present              = $cursorPresent
    effective_timeout_seconds           = $effectiveTimeout
    utf8_real_path_probe                = $utf8Real
    mojibake_detector_regression        = $mojReg
    runtime_cleanup_probe               = $cleanupProbe
    three_cycle_orchestration_probe     = $threeCycle
    safe_to_start_product_cap50         = $safe
    PASS_FAIL                           = $passFail
    failures                            = ($failures -join ";")
  }
}

function Write-SilverCap50HardPreflightBlock {
  param([hashtable]$Result)
  Write-Host ""
  Write-Host "=== SILVER_CAP50_HARD_PREFLIGHT ===" -ForegroundColor Cyan
  Write-Host ("main_commit=" + [string]$Result.main_commit)
  Write-Host ("git_status_clean_before=" + [string]$Result.git_status_clean_before)
  Write-Host ("cursor_command_present=" + [string]$Result.cursor_command_present)
  Write-Host ("effective_timeout_seconds=" + [string]$Result.effective_timeout_seconds)
  Write-Host ("utf8_real_path_probe=" + [string]$Result.utf8_real_path_probe)
  Write-Host ("mojibake_detector_regression=" + [string]$Result.mojibake_detector_regression)
  Write-Host ("runtime_cleanup_probe=" + [string]$Result.runtime_cleanup_probe)
  Write-Host ("three_cycle_orchestration_probe=" + [string]$Result.three_cycle_orchestration_probe)
  Write-Host ("safe_to_start_product_cap50=" + [string]$Result.safe_to_start_product_cap50)
  Write-Host ("PASS_FAIL=" + [string]$Result.PASS_FAIL) -ForegroundColor $(if ($Result.PASS_FAIL -eq "PASS") { "Green" } else { "Red" })
  Write-Host "=== END_SILVER_CAP50_HARD_PREFLIGHT ===" -ForegroundColor Cyan
  Write-Host ""
}

function Invoke-SilverCap50FinalPostcondition {
  param(
    [string]$RepoRoot,
    [int]$CyclesCompleted,
    [string]$StopReason,
    [string]$NextActionPath,
    [string]$CursorOutputPath,
    [string]$SafetyCountersLine,
    [switch]$DryRunOnly
  )
  $utf8Gate = Invoke-SilverCap50Utf8SurfacesHardGate -RepoRoot $RepoRoot -NextActionPath $NextActionPath -CursorOutputPath $CursorOutputPath
  $dirtyLeft = "NO"
  $blocked = ""
  $gitClean = "NO"
  $po = ""
  try { $po = (& git -C $RepoRoot status --porcelain 2>$null) } catch { $po = "DIRTY_UNKNOWN" }
  if ($po -eq "") { $gitClean = "YES" }
  else {
    $gitClean = "NO"
    $dirtyLeft = "YES"
    $blockedParts = New-Object System.Collections.Generic.List[string]
    foreach ($raw in $po -split "`r?`n") {
      $line = $raw.Trim()
      if (-not $line) { continue }
      $rel = ""
      if ($line.Length -ge 3 -and $line.Substring(2, 1) -eq " ") { $rel = $line.Substring(3).Trim() }
      else {
        $parts = $line -split "\s+", 2
        if ($parts.Count -ge 2) { $rel = $parts[1].Trim() } else { $rel = $line }
      }
      $rel = ($rel -replace '\\', '/')
      $arrow = " -> "
      $ai = $rel.LastIndexOf($arrow)
      if ($ai -ge 0) { $rel = $rel.Substring($ai + $arrow.Length).Trim() }
      if ($rel) { [void]$blockedParts.Add($rel) }
    }
    $blocked = ($blockedParts -join ";")
  }
  $manual = "NO"
  $nextText = ""
  if (Test-Path -LiteralPath $NextActionPath) {
    $nextText = Read-TextFileUtf8Raw -Path $NextActionPath
    if ($nextText -match '(?i)MANUAL_REQUIRED|STOP\s*[-—]') { $manual = "YES" }
  }
  $engineCh = "NO"
  $assetsCh = "NO"
  $paths = Get-GitStatusShortPaths -Cwd $RepoRoot
  foreach ($p in $paths) {
    $n = ($p -replace '\\', '/')
    if ($n -ieq "assets/app.js") { $assetsCh = "YES" }
    if ($n -ieq "assets/app.js") { continue }
    if ($n -match '^(assets/|projects/(?!data/)|\.github/workflows/)') { $engineCh = "YES" }
  }
  $safeFinal = "NO"
  if ($utf8Gate.utf8_mojibake_detected -eq "NO" -and $dirtyLeft -eq "NO" -and $gitClean -eq "YES" -and $engineCh -eq "NO" -and $assetsCh -eq "NO") {
    $safeFinal = "YES"
  }
  $passFail = if ($safeFinal -eq "YES") { "PASS" } else { "FAIL" }
  return @{
    cycles_completed                = [string]$CyclesCompleted
    stop_reason                     = $StopReason
    utf8_mojibake_detected          = [string]$utf8Gate.utf8_mojibake_detected
    dirty_runtime_leftovers         = $dirtyLeft
    blocked_dirty_files             = $blocked
    git_status_clean_after_cleanup  = $gitClean
    manual_required                 = $manual
    safety_counters                 = [string]$SafetyCountersLine
    engine_changed                  = $engineCh
    assets_app_changed              = $assetsCh
    safe_final_state                = $safeFinal
    PASS_FAIL                       = $passFail
  }
}

function Write-SilverCap50FinalPostconditionBlock {
  param([hashtable]$Result)
  Write-Host ""
  Write-Host "=== SILVER_CAP50_FINAL_POSTCONDITION ===" -ForegroundColor Cyan
  Write-Host ("cycles_completed=" + [string]$Result.cycles_completed)
  Write-Host ("stop_reason=" + [string]$Result.stop_reason)
  Write-Host ("utf8_mojibake_detected=" + [string]$Result.utf8_mojibake_detected)
  Write-Host ("dirty_runtime_leftovers=" + [string]$Result.dirty_runtime_leftovers)
  Write-Host ("blocked_dirty_files=" + [string]$Result.blocked_dirty_files)
  Write-Host ("git_status_clean_after_cleanup=" + [string]$Result.git_status_clean_after_cleanup)
  Write-Host ("manual_required=" + [string]$Result.manual_required)
  Write-Host ("safety_counters=" + [string]$Result.safety_counters)
  Write-Host ("engine_changed=" + [string]$Result.engine_changed)
  Write-Host ("assets_app_changed=" + [string]$Result.assets_app_changed)
  Write-Host ("safe_final_state=" + [string]$Result.safe_final_state)
  Write-Host ("PASS_FAIL=" + [string]$Result.PASS_FAIL) -ForegroundColor $(if ($Result.PASS_FAIL -eq "PASS") { "Green" } else { "Red" })
  Write-Host "=== END_SILVER_CAP50_FINAL_POSTCONDITION ===" -ForegroundColor Cyan
  Write-Host ""
}
