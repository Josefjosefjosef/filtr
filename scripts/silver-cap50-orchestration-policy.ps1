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

if (-not (Get-Variable -Name SilverCapRuntimeLabel -Scope Script -ErrorAction SilentlyContinue)) {
  $script:SilverCapRuntimeLabel = "CAP50"
}

function Set-SilverCapRuntimeLabel {
  param([string]$Label)
  $norm = ([string]$Label).Trim().ToUpper()
  if ($norm -match '^CAP\d+$') {
    $script:SilverCapRuntimeLabel = $norm
  }
}

function Get-SilverCapRuntimeBlockPrefix {
  return ("SILVER_" + [string]$script:SilverCapRuntimeLabel)
}

function Get-SilverCapRuntimeSafeToStartFieldName {
  $lbl = [string]$script:SilverCapRuntimeLabel
  if ($lbl -eq "CAP50") { return "safe_to_start_product_cap50" }
  return ("safe_to_start_product_" + $lbl.ToLower())
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

function Get-SilverAdapterDiagnosticReportPath {
  param([string]$RepoRoot)
  return (Join-Path $RepoRoot "scripts\silver-cursor-agent-adapter-diagnostic-report.json")
}

function Read-SilverAdapterDiagnosticReportJson {
  param([string]$RepoRoot)
  $diagPath = Get-SilverAdapterDiagnosticReportPath -RepoRoot $RepoRoot
  if (-not (Test-Path -LiteralPath $diagPath)) {
    return $null
  }
  try {
    $raw = [System.IO.File]::ReadAllText($diagPath)
    return ($raw | ConvertFrom-Json)
  }
  catch {
    return $null
  }
}

function Get-SilverDiagnosticCursorMajorFromVersionText {
  param(
    [string]$VersionText,
    [string]$Cursor3Detected = "NO"
  )
  $first = ($VersionText -split "`r?`n" | Select-Object -First 1).Trim()
  if ($Cursor3Detected -eq "YES") {
    if ($first -match '^Cursor\s+(\d+)') { return $Matches[1] }
    return "3"
  }
  if ($first -match '^Cursor\s+(\d+)') { return $Matches[1] }
  if ($first -match '^(\d+)\.') { return $Matches[1] }
  return ""
}

function Build-SilverDefaultWslCursorCommandTemplate {
  return 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -WslUbuntuAgent -TaskFile {TASK_FILE} -OutputFile {OUTPUT_FILE} -TimeoutSeconds 120'
}

function Test-SilverCursorCommandTemplateValid {
  param([string]$CursorCommand)
  $cmd = ([string]$CursorCommand).Trim()
  if ([string]::IsNullOrWhiteSpace($cmd)) {
    return @{
      valid = $false
      reason = "cursor_command_empty"
      has_task_file_token = "NO"
      has_output_file_token = "NO"
    }
  }
  $hasTask = if ($cmd.Contains("{TASK_FILE}")) { "YES" } else { "NO" }
  $hasOut = if ($cmd.Contains("{OUTPUT_FILE}")) { "YES" } else { "NO" }
  if ($hasTask -ne "YES" -or $hasOut -ne "YES") {
    return @{
      valid = $false
      reason = "cursor_command_missing_task_or_output_token"
      has_task_file_token = $hasTask
      has_output_file_token = $hasOut
    }
  }
  if ($cmd -notmatch '(?i)silver-cursor-agent-adapter\.ps1') {
    return @{
      valid = $false
      reason = "cursor_command_must_invoke_silver_cursor_agent_adapter"
      has_task_file_token = $hasTask
      has_output_file_token = $hasOut
    }
  }
  if ($cmd -match '(?i)silver-autopilot-loop\.ps1') {
    return @{
      valid = $false
      reason = "cursor_command_must_not_invoke_silver_autopilot_loop"
      has_task_file_token = $hasTask
      has_output_file_token = $hasOut
    }
  }
  if ($cmd -match '(?i)-ControlledCapProfile\s+(CAP25|CAP50)') {
    return @{
      valid = $false
      reason = "cursor_command_forbidden_cap_profile"
      has_task_file_token = $hasTask
      has_output_file_token = $hasOut
    }
  }
  return @{
    valid = $true
    reason = "ok"
    has_task_file_token = $hasTask
    has_output_file_token = $hasOut
  }
}

function Resolve-SilverCursorCommandForControlledEntrypoint {
  param(
    [string]$RepoRoot,
    [string]$CursorCommand,
    [switch]$PreferWslLane
  )
  $explicit = ([string]$CursorCommand).Trim()
  if (-not [string]::IsNullOrWhiteSpace($explicit)) {
    $chkExplicit = Test-SilverCursorCommandTemplateValid -CursorCommand $explicit
    if ($chkExplicit.valid) {
      return @{
        command = $explicit
        source = "explicit_parameter"
        adapter_ready = "UNKNOWN"
        wsl_lane_ready = "UNKNOWN"
        validation = $chkExplicit
      }
    }
    return @{
      command = ""
      source = "explicit_parameter_rejected"
      adapter_ready = "UNKNOWN"
      wsl_lane_ready = "UNKNOWN"
      validation = $chkExplicit
    }
  }
  $diag = Read-SilverAdapterDiagnosticReportJson -RepoRoot $RepoRoot
  $adapterReady = "UNKNOWN"
  $wslReady = "NO"
  $fromDiag = ""
  if ($null -ne $diag) {
    if ($null -ne $diag.adapter_ready) { $adapterReady = [string]$diag.adapter_ready }
    if ($null -ne $diag.wsl_cursor_agent_print_ask_trust -and $null -ne $diag.wsl_cursor_agent_print_ask_trust.adapter_ready) {
      $wslReady = [string]$diag.wsl_cursor_agent_print_ask_trust.adapter_ready
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$diag.recommended_cursor_command_full_loop)) {
      $fromDiag = [string]$diag.recommended_cursor_command_full_loop
    }
  }
  $resolved = ""
  $source = ""
  if ($PreferWslLane -or ($wslReady -eq "YES")) {
    if ($fromDiag -match '(?i)-WslUbuntuAgent') {
      $resolved = $fromDiag
      $source = "diagnostic_recommended_full_loop_wsl"
    }
    else {
      $resolved = Build-SilverDefaultWslCursorCommandTemplate
      $source = "default_wsl_template"
    }
  }
  elseif (-not [string]::IsNullOrWhiteSpace($fromDiag)) {
    $resolved = $fromDiag
    $source = "diagnostic_recommended_full_loop"
  }
  else {
    $resolved = Build-SilverDefaultWslCursorCommandTemplate
    $source = "default_wsl_template_fallback"
  }
  $chk = Test-SilverCursorCommandTemplateValid -CursorCommand $resolved
  if (-not $chk.valid) {
    return @{
      command = ""
      source = $source
      adapter_ready = $adapterReady
      wsl_lane_ready = $wslReady
      validation = $chk
    }
  }
  return @{
    command = $resolved
    source = $source
    adapter_ready = $adapterReady
    wsl_lane_ready = $wslReady
    validation = $chk
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

function Test-SilverCap50OrchestrationScriptsOnlyBlockedDirty {
  param([string]$BlockedDirtyFiles)
  if ([string]::IsNullOrWhiteSpace($BlockedDirtyFiles)) { return $false }
  $any = $false
  foreach ($raw in $BlockedDirtyFiles -split ';') {
    $part = $raw.Trim()
    if (-not $part) { continue }
    $any = $true
    $p = $part
    $paren = $p.LastIndexOf('(')
    if ($paren -gt 0) { $p = $p.Substring(0, $paren).Trim() }
    $p = ($p -replace '\\', '/')
    if ($p -notmatch '^scripts/silver-') { return $false }
  }
  return $any
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
  [void]$out.Add("scripts/silver-self-correction-audit-report.json")
  $scriptsDir = Join-Path $RepoRoot "scripts"
  if (Test-Path -LiteralPath $scriptsDir) {
    foreach ($f in [System.IO.Directory]::EnumerateFiles($scriptsDir, "silver-*-cluster-classifier-v*-report.json")) {
      $rel = "scripts/" + [System.IO.Path]::GetFileName($f)
      [void]$out.Add(($rel -replace '\\', '/'))
    }
  }
  return $out.ToArray()
}

function Archive-SilverCap50Utf8FailureRuntimeArtifacts {
  param(
    [string]$RepoRoot,
    [int]$Cycle,
    [string]$Reason,
    [string]$CursorExit = ""
  )
  $archived = "NO"
  $relOut = ""
  $fullDir = ""
  try {
    $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss") + "Z-c" + [string]$Cycle
    $destDir = Join-Path (Join-Path (Join-Path $RepoRoot ".silver-runtime") "failures") $stamp
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
    $relSlash = ".silver-runtime/failures/" + $stamp
    $manifest = [ordered]@{
      utc_timestamp = $stamp
      cycle = $Cycle
      main_commit_head = $head
      reason = $Reason
      cursor_exit = $CursorExit
      copied_files = $copied.ToArray()
      missing_files = $missing.ToArray()
      archive_path = $relSlash
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
  $realStdoutUtf8Capture = "FAIL"
  $promptPreviewUtf8 = "FAIL"
  $realCaptureScript = Join-Path $RepoRoot "scripts\silver-real-stdout-utf8-capture-probe.ps1"
  if (Test-Path -LiteralPath $realCaptureScript) {
    $prevEaCap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $capOut = & powershell -NoProfile -ExecutionPolicy Bypass -File $realCaptureScript 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) { $realStdoutUtf8Capture = "PASS" } else { [void]$failures.Add("real_stdout_utf8_capture_probe") }
    if ($capOut -match 'prompt_preview_utf8_probe=PASS') { $promptPreviewUtf8 = "PASS" }
    elseif ($capOut -match 'prompt_preview_utf8_probe=FAIL') {
      $promptPreviewUtf8 = "FAIL"
      if ($realStdoutUtf8Capture -eq "PASS") { [void]$failures.Add("prompt_preview_utf8_probe") }
    }
    else {
      [void]$failures.Add("prompt_preview_utf8_probe")
    }
    $ErrorActionPreference = $prevEaCap
  }
  else {
    [void]$failures.Add("real_stdout_utf8_capture_probe_script_missing")
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
    real_stdout_utf8_capture_probe      = $realStdoutUtf8Capture
    prompt_preview_utf8_probe           = $promptPreviewUtf8
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
  $pfx = Get-SilverCapRuntimeBlockPrefix
  $safeField = Get-SilverCapRuntimeSafeToStartFieldName
  $safeVal = [string]$Result.safe_to_start_product_cap50
  if (-not $safeVal) { $safeVal = [string]$Result.safe_to_start_product_cap }
  Write-Host ""
  Write-Host ("=== " + $pfx + "_HARD_PREFLIGHT ===") -ForegroundColor Cyan
  Write-Host ("cap_runtime_label=" + [string]$script:SilverCapRuntimeLabel)
  Write-Host ("main_commit=" + [string]$Result.main_commit)
  Write-Host ("git_status_clean_before=" + [string]$Result.git_status_clean_before)
  Write-Host ("cursor_command_present=" + [string]$Result.cursor_command_present)
  Write-Host ("effective_timeout_seconds=" + [string]$Result.effective_timeout_seconds)
  Write-Host ("utf8_real_path_probe=" + [string]$Result.utf8_real_path_probe)
  Write-Host ("real_stdout_utf8_capture_probe=" + [string]$Result.real_stdout_utf8_capture_probe)
  Write-Host ("prompt_preview_utf8_probe=" + [string]$Result.prompt_preview_utf8_probe)
  Write-Host ("mojibake_detector_regression=" + [string]$Result.mojibake_detector_regression)
  Write-Host ("runtime_cleanup_probe=" + [string]$Result.runtime_cleanup_probe)
  Write-Host ("three_cycle_orchestration_probe=" + [string]$Result.three_cycle_orchestration_probe)
  Write-Host ($safeField + "=" + $safeVal)
  if ([string]$script:SilverCapRuntimeLabel -ne "CAP50") {
    Write-Host ("safe_to_start_product_cap50=LEGACY_ALIAS cap_runtime_label=" + [string]$script:SilverCapRuntimeLabel)
  }
  Write-Host ("PASS_FAIL=" + [string]$Result.PASS_FAIL) -ForegroundColor $(if ($Result.PASS_FAIL -eq "PASS") { "Green" } else { "Red" })
  Write-Host ("=== END_" + $pfx + "_HARD_PREFLIGHT ===") -ForegroundColor Cyan
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
  if ((-not $DryRunOnly) -and (Get-Command -Name Invoke-SilverCap50PreflightCleanup -ErrorAction SilentlyContinue)) {
    if (-not (Test-GitStatusClean -Cwd $RepoRoot)) {
      $null = Invoke-SilverCap50PreflightCleanup -RepoRoot $RepoRoot
    }
  }
  $forbiddenLeft = New-Object System.Collections.Generic.List[string]
  $restorableLeft = New-Object System.Collections.Generic.List[string]
  if (Get-Command -Name Get-GitStatusShortDirtyEntries -ErrorAction SilentlyContinue) {
    foreach ($ent in (Get-GitStatusShortDirtyEntries -Cwd $RepoRoot)) {
      $p = [string]$ent.path
      if (-not $p) { continue }
      if (Get-Command -Name Test-SilverPathIsCap50IgnorableUntrackedRuntime -ErrorAction SilentlyContinue) {
        if (Test-SilverPathIsCap50IgnorableUntrackedRuntime -RelPath $p) { continue }
      }
      elseif ($p -cmatch '^\.silver-runtime(/|$)') { continue }
      if ((Get-Command -Name Test-SilverPathIsCap50RuntimeRestorable -ErrorAction SilentlyContinue) -and (Test-SilverPathIsCap50RuntimeRestorable -RelPath $p)) {
        [void]$restorableLeft.Add($p)
        continue
      }
      [void]$forbiddenLeft.Add($p)
    }
  }
  else {
    foreach ($p in (Get-GitStatusShortPaths -Cwd $RepoRoot)) {
      $n = ([string]$p).Trim() -replace '\\', '/'
      if (-not $n) { continue }
      if ($n -cmatch '^\.silver-runtime(/|$)') { continue }
      [void]$forbiddenLeft.Add($n)
    }
  }
  $gitClean = if (Test-GitStatusClean -Cwd $RepoRoot) { "YES" } else { "NO" }
  $dirtyLeft = if ($forbiddenLeft.Count -gt 0) { "YES" } else { "NO" }
  $blockedParts = New-Object System.Collections.Generic.List[string]
  foreach ($fp in $forbiddenLeft) { [void]$blockedParts.Add([string]$fp) }
  foreach ($rp in $restorableLeft) { [void]$blockedParts.Add([string]$rp + "(restorable_unrestored)") }
  $blocked = ($blockedParts -join ";")
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
  $pfx = Get-SilverCapRuntimeBlockPrefix
  Write-Host ""
  Write-Host ("=== " + $pfx + "_FINAL_POSTCONDITION ===") -ForegroundColor Cyan
  Write-Host ("cap_runtime_label=" + [string]$script:SilverCapRuntimeLabel)
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
  Write-Host ("=== END_" + $pfx + "_FINAL_POSTCONDITION ===") -ForegroundColor Cyan
  Write-Host ""
}
