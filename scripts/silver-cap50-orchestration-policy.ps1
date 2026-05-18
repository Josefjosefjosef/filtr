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

function Test-SilverCap50Utf8HardFailAfterRepair {
  param(
    [string]$Text,
    [string]$SurfaceLabel
  )
  if ([string]::IsNullOrEmpty($Text)) {
    return @{ detected = "NO"; locations = ""; surface = $SurfaceLabel }
  }
  $repairedFlag = "NO"
  $fixed = Repair-SilverUtf8HandoffText -Text $Text -Repaired ([ref]$repairedFlag)
  if (Test-SilverUtf8MojibakeMarkersCore -Text $fixed) {
    $locs = Get-SilverUtf8MojibakeHitLocations -Text $fixed
    return @{
      detected  = "YES"
      locations = ($locs -join ";")
      surface   = $SurfaceLabel
    }
  }
  return @{ detected = "NO"; locations = ""; surface = $SurfaceLabel }
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
    $nextText = Read-TextFileUtf8Handoff -Path $NextActionPath
    $hit = Test-SilverCap50Utf8HardFailAfterRepair -Text $nextText -SurfaceLabel "SILVER_NEXT_ACTION"
    if ($hit.detected -eq "YES") { [void]$surfaces.Add($hit) }
  }
  if (Test-Path -LiteralPath $CursorOutputPath) {
    $cursorFull = Read-TextFileUtf8Handoff -Path $CursorOutputPath
    $metaPreview = ""
    foreach ($raw in $cursorFull -split "`r?`n") {
      $line = $raw.Trim()
      if ($line.StartsWith("prompt_preview=")) {
        $metaPreview = $line.Substring("prompt_preview=".Length)
        break
      }
    }
    if ($metaPreview) {
      $hitP = Test-SilverCap50Utf8HardFailAfterRepair -Text $metaPreview -SurfaceLabel "prompt_preview"
      if ($hitP.detected -eq "YES") { [void]$surfaces.Add($hitP) }
    }
    $stdoutSec = Get-SilverCap50AdapterStdoutSection -FullText $cursorFull
    if ($stdoutSec) {
      $hitO = Test-SilverCap50Utf8HardFailAfterRepair -Text $stdoutSec -SurfaceLabel "stdout"
      if ($hitO.detected -eq "YES") { [void]$surfaces.Add($hitO) }
    }
    $stderrMarker = "# stderr"
    $stderrIdx = $cursorFull.IndexOf($stderrMarker, [System.StringComparison]::Ordinal)
    if ($stderrIdx -ge 0) {
      $stderrSec = $cursorFull.Substring($stderrIdx + $stderrMarker.Length)
      $hitE = Test-SilverCap50Utf8HardFailAfterRepair -Text $stderrSec -SurfaceLabel "stderr"
      if ($hitE.detected -eq "YES") { [void]$surfaces.Add($hitE) }
    }
  }
  if ($surfaces.Count -gt 0) {
    $locParts = New-Object System.Collections.Generic.List[string]
    foreach ($s in $surfaces) {
      [void]$locParts.Add([string]$s.surface + ":" + [string]$s.locations)
    }
    return @{
      PASS_FAIL                   = "FAIL"
      utf8_mojibake_detected      = "YES"
      utf8_mojibake_locations     = ($locParts -join " | ")
      ready_for_product_cap50     = "NO"
      reason                      = "utf8_mojibake_detected"
    }
  }
  return @{
    PASS_FAIL                   = "PASS"
    utf8_mojibake_detected      = "NO"
    utf8_mojibake_locations     = ""
    ready_for_product_cap50     = "YES"
    reason                      = ""
  }
}
