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
    "pozn" + [char]0x00E1 + "mka"
  )
  foreach ($frag in $need) {
    if ($Text.IndexOf($frag, [System.StringComparison]::Ordinal) -lt 0) {
      return $false
    }
  }
  return $true
}
