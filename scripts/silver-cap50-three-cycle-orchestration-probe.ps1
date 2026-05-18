#requires -Version 5.1
<#
.SYNOPSIS
  Three-cycle CAP50 orchestration probe wrapper (no product CAP50).
#>
Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"

$loop = Join-Path $PSScriptRoot "silver-autopilot-loop.ps1"
if (-not (Test-Path -LiteralPath $loop)) {
  Write-Host "SILVER_CAP50_THREE_CYCLE_ORCHESTRATION_PROBE=FAIL missing_loop"
  exit 1
}
& powershell -NoProfile -ExecutionPolicy Bypass -File $loop -Cap50ThreeCycleOrchestrationProbe
exit $LASTEXITCODE
