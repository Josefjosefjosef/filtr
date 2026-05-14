#requires -Version 5.1
<#
.SYNOPSIS
  Read-only summary of Silver outer-loop MaxCycles 0 safety orchestrator (does not run the loop).

.DESCRIPTION
  Prints effective caps from parameters / environment variable names. Does not invoke
  silver-autopilot-loop.ps1 with MaxCycles 0 (validation-only helper).
#>
param()

Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"

function Get-SilverEnvIntOrEmptyDiag {
  param([string]$Name)
  $raw = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($raw)) { $raw = [Environment]::GetEnvironmentVariable($Name, "User") }
  if ([string]::IsNullOrWhiteSpace($raw)) { $raw = [Environment]::GetEnvironmentVariable($Name, "Machine") }
  if ([string]::IsNullOrWhiteSpace($raw)) { return "(unset)" }
  return $raw.Trim()
}

Write-Host "=== SILVER_AUTONOMOUS_LOOP_SAFETY_DIAGNOSTIC ==="
Write-Host "note=This script does not run MaxCycles 0; it only echoes policy and env hints."
Write-Host "stop_file=SILVER_STOP_AUTOPILOT (repo root; create to request clean stop on next cycle boundary)"
Write-Host "maxcycles_zero_requires=-AllowInfinite or -AutonomousMode on silver-autopilot-loop.ps1"
Write-Host ("env_SILVER_AUTONOMOUS_HARD_MAX_CYCLES=" + (Get-SilverEnvIntOrEmptyDiag -Name "SILVER_AUTONOMOUS_HARD_MAX_CYCLES"))
Write-Host ("env_SILVER_AUTONOMOUS_MAX_CYCLE_WALL_SECONDS=" + (Get-SilverEnvIntOrEmptyDiag -Name "SILVER_AUTONOMOUS_MAX_CYCLE_WALL_SECONDS"))
Write-Host ("env_SILVER_AUTONOMOUS_MAX_TOTAL_WALL_SECONDS=" + (Get-SilverEnvIntOrEmptyDiag -Name "SILVER_AUTONOMOUS_MAX_TOTAL_WALL_SECONDS"))
Write-Host "default_hard_cap_cycles=512 (if env unset and -MaxAutonomousHardCycles 0)"
Write-Host "default_cycle_wall_sec=7200 (if -MaxCycleWallSeconds 0 and env unset; -1 disables)"
Write-Host "default_total_wall_sec=86400 (if -TotalWallSeconds 0 and env unset; -1 disables)"
Write-Host "=== END_SILVER_AUTONOMOUS_LOOP_SAFETY_DIAGNOSTIC ==="
