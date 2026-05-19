#requires -Version 5.1
<#
.SYNOPSIS
  PowerShell helpers for Silver audit registry (orchestration only).
#>
Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"

function Invoke-SilverAuditRegistryReport {
  param(
    [string]$RepoRoot
  )
  $registryScript = Join-Path $RepoRoot "scripts\silver-audit-registry.cjs"
  if (-not (Test-Path -LiteralPath $registryScript)) {
    Write-Host "SILVER_AUDIT_REGISTRY=FAIL missing_script" -ForegroundColor Red
    return $false
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = ($registryScript + " report --repo-root """ + $RepoRoot.Replace('"', '""') + """")
  $psi.WorkingDirectory = $RepoRoot
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  if ($stdout) { Write-Host $stdout }
  if ($stderr) { Write-Host $stderr -ForegroundColor DarkYellow }
  return ($p.ExitCode -eq 0)
}

function Invoke-SilverAuditRegistrySelfTest {
  param([string]$RepoRoot)
  $registryScript = Join-Path $RepoRoot "scripts\silver-audit-registry.cjs"
  if (-not (Test-Path -LiteralPath $registryScript)) {
    Write-Host "SILVER_AUDIT_REGISTRY_SELFTEST=FAIL missing_script" -ForegroundColor Red
    return $false
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = ($registryScript + " selftest")
  $psi.WorkingDirectory = $RepoRoot
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  if ($stdout) { Write-Host $stdout }
  if ($stderr) { Write-Host $stderr -ForegroundColor DarkYellow }
  return ($p.ExitCode -eq 0)
}

function Invoke-SilverCapOutcomeEnforcement {
  param(
    [string]$RepoRoot,
    [string]$ProgressLogPath,
    [int]$CyclesCompleted,
    [string]$CapLabel,
    [string]$OrchestrationOnly,
    [int]$PrCreatedCount,
    [string]$ProductFixCreated
  )
  $registryScript = Join-Path $RepoRoot "scripts\silver-audit-registry.cjs"
  if (-not (Test-Path -LiteralPath $registryScript)) { return $false }
  $argList = @(
    $registryScript,
    "cap-outcome",
    "--repo-root", $RepoRoot,
    ("--cycles=" + [string]$CyclesCompleted),
    ("--cap-label=" + [string]$CapLabel)
  )
  if ($OrchestrationOnly -eq "YES") { $argList += "--orchestration-only" }
  if ($PrCreatedCount -gt 0) { $argList += "--pr-created" }
  if ($ProductFixCreated -eq "YES") { $argList += "--product-fix" }
  $parts = New-Object System.Collections.ArrayList
  foreach ($arg in $argList) {
    $a = [string]$arg
    if ($a.IndexOf(" ") -ge 0) {
      [void]$parts.Add(('"' + $a.Replace('"', '""') + '"'))
    } else {
      [void]$parts.Add($a)
    }
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = [string]::Join(" ", $parts.ToArray())
  $psi.WorkingDirectory = $RepoRoot
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  if ($stdout) {
    Write-Host $stdout
    if ($ProgressLogPath -and (Test-Path -LiteralPath (Split-Path -Parent $ProgressLogPath))) {
      $entry = "`n## " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " UTC cap_outcome`n`n" + $stdout.Trim() + "`n"
      Add-Content -LiteralPath $ProgressLogPath -Value $entry -Encoding UTF8
    }
  }
  if ($stderr) { Write-Host $stderr -ForegroundColor DarkYellow }
  return ($p.ExitCode -eq 0)
}
