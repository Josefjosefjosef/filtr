#requires -Version 5.1
<#
.SYNOPSIS
  Regression: WSL adapter async pipe drain completes high-volume stdout without hang (repo stays clean).
#>
Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$adapter = Join-Path $RepoRoot "scripts\silver-cursor-agent-adapter.ps1"
if (-not (Test-Path -LiteralPath $adapter)) {
  Write-Host "SILVER_WSL_ADAPTER_PIPE_DRAIN_SELFTEST=FAIL"
  Write-Host "reason=adapter_script_missing"
  exit 1
}
$outFile = Join-Path $env:TEMP ("silver-wsl-pipe-drain-selftest-out-" + [guid]::NewGuid().ToString() + ".md")
& powershell -NoProfile -ExecutionPolicy Bypass -File $adapter -WslPipeDrainSelfTest -OutputFile $outFile
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  Write-Host "SILVER_WSL_ADAPTER_PIPE_DRAIN_SELFTEST=FAIL"
  Write-Host ("exit_code=" + [string]$exitCode)
  if (Test-Path -LiteralPath $outFile) {
    Remove-Item -LiteralPath $outFile -Force -ErrorAction SilentlyContinue
  }
  exit 1
}
if (Test-Path -LiteralPath $outFile) {
  Remove-Item -LiteralPath $outFile -Force -ErrorAction SilentlyContinue
}
Write-Host "SILVER_WSL_ADAPTER_PIPE_DRAIN_SELFTEST=PASS"
exit 0
