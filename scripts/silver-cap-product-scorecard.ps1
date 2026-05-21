#requires -Version 5.1
<#
.SYNOPSIS
  PowerShell helpers for Silver CAP BEFORE/AFTER product scorecard (orchestration/metrics only).
#>
Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"

function Get-SilverAuditRegistryRecommendedCap {
  param([string]$RepoRoot)
  $registryScript = Join-Path $RepoRoot "scripts\silver-audit-registry.cjs"
  if (-not (Test-Path -LiteralPath $registryScript)) { return "" }
  $registryRequirePath = ($registryScript -replace '\\', '/')
  if ($registryRequirePath.IndexOf("'") -ge 0) {
    $registryRequirePath = $registryRequirePath.Replace("'", "\'")
  }
  $probe = @"
const m=require('$registryRequirePath');
const h=m.resolveCapRuntimeHandoff(process.cwd(),{});
process.stdout.write(String(h.cap_label||''));
"@
  $probePath = Join-Path $env:TEMP ("silver-cap-label-probe-" + [guid]::NewGuid().ToString("N") + ".cjs")
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
    if ($stdout -match '^CAP\d+$') { return $stdout }
    return ""
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

function Get-SilverCapRunLabel {
  param(
    [bool]$ControlledInfinite,
    [int]$MaxCycles,
    [int]$MaxAutonomousHardCycles = 0,
    [string]$RepoRoot = ""
  )
  if ($ControlledInfinite) {
    if ($RepoRoot) {
      $fromRegistry = Get-SilverAuditRegistryRecommendedCap -RepoRoot $RepoRoot
      if ($fromRegistry) { return $fromRegistry }
    }
    if ($MaxAutonomousHardCycles -gt 0) {
      return ("CAP" + [string]$MaxAutonomousHardCycles)
    }
    return "CAP50"
  }
  if ($MaxCycles -ge 1) { return ("CAP" + [string]$MaxCycles) }
  return ""
}

function Initialize-SilverCapProductScorecardSession {
  param(
    [string]$CapLabel
  )
  $dir = Join-Path $env:TEMP ("silver-cap-scorecard-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $script:SilverCapScorecardDir = $dir
  $script:SilverCapScorecardBeforePath = Join-Path $dir "before.json"
  $script:SilverCapScorecardCapLabel = $CapLabel
  return $script:SilverCapScorecardBeforePath
}

function Invoke-SilverCapProductScorecardCapture {
  param(
    [string]$RepoRoot,
    [string]$CapLabel,
    [string]$OutPath
  )
  $scorecardScript = Join-Path $RepoRoot "scripts\silver-cap-product-scorecard.cjs"
  if (-not (Test-Path -LiteralPath $scorecardScript)) {
    Write-Host "SILVER_CAP_PRODUCT_SCORECARD=FAIL missing_script" -ForegroundColor Red
    return $false
  }
  $argList = @(
    $scorecardScript,
    "capture",
    "--repo-root", $RepoRoot,
    "--cap-label", $CapLabel,
    "--out", $OutPath
  )
  $parts = New-Object System.Collections.ArrayList
  foreach ($arg in $argList) {
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

function Write-SilverCapScorecardToProgressLog {
  param(
    [string]$ProgressLogPath,
    [string]$CzechText,
    [string]$CapLabel,
    [string]$StopReason,
    [int]$CyclesCompleted
  )
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("---")
  [void]$sb.AppendLine("timestamp=" + (Get-Date).ToString("s"))
  [void]$sb.AppendLine("outcome=CAP_SCORECARD")
  [void]$sb.AppendLine(("cap_label=" + $CapLabel))
  [void]$sb.AppendLine(("cycles_completed=" + [string]$CyclesCompleted))
  [void]$sb.AppendLine(("stop_reason=" + $StopReason))
  [void]$sb.AppendLine("")
  foreach ($line in ($CzechText -split "`r?`n")) {
    [void]$sb.AppendLine($line)
  }
  [void]$sb.AppendLine("---")
  $block = $sb.ToString()
  if (-not (Test-Path -LiteralPath $ProgressLogPath)) {
    $header = "# SILVER progress log`n`nAppend-only entries from ``scripts/silver-autopilot-loop.ps1`` (V1). Do not paste secrets or API keys.`n`n"
    [System.IO.File]::WriteAllText($ProgressLogPath, $header + $block, [System.Text.UTF8Encoding]::new($false))
  } else {
    [System.IO.File]::AppendAllText($ProgressLogPath, $block, [System.Text.UTF8Encoding]::new($false))
  }
}

function Complete-SilverCapProductScorecard {
  param(
    [string]$RepoRoot,
    [string]$ProgressLogPath,
    [int]$CyclesCompleted,
    [string]$StopReason,
    [string]$PrCreatedCount = "0",
    [string]$ProductFixCreated = "NO",
    [string]$RuntimeFailure = "NO"
  )
  if (-not $script:SilverCapScorecardBeforePath) { return $false }
  if (-not (Test-Path -LiteralPath $script:SilverCapScorecardBeforePath)) { return $false }

  $scorecardScript = Join-Path $RepoRoot "scripts\silver-cap-product-scorecard.cjs"
  if (-not (Test-Path -LiteralPath $scorecardScript)) {
    Write-Host "SILVER_CAP_PRODUCT_SCORECARD=FAIL missing_script" -ForegroundColor Red
    return $false
  }

  $capLabel = [string]$script:SilverCapScorecardCapLabel
  if (-not $capLabel) { $capLabel = "CAPX" }

  $argList = @(
    $scorecardScript,
    "finalize",
    "--repo-root", $RepoRoot,
    "--before", $script:SilverCapScorecardBeforePath,
    "--cap-label", $capLabel,
    "--cycles", [string]$CyclesCompleted,
    "--stop-reason", $StopReason,
    "--pr-created-count", $PrCreatedCount,
    "--product-fix", $ProductFixCreated,
    "--runtime-failure", $RuntimeFailure
  )
  $parts = New-Object System.Collections.ArrayList
  foreach ($arg in $argList) {
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
  $psi.WorkingDirectory = $RepoRoot
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  if ($stderr) { Write-Host $stderr -ForegroundColor DarkYellow }

  $script:SilverScorecardRuntimeError = "NO"
  $script:SilverScorecardExactError = ""
  if ($p.ExitCode -ne 0) {
    $script:SilverScorecardRuntimeError = "YES"
    $exactErr = ""
    if ($stderr -match 'ReferenceError:\s*(.+)$') {
      $exactErr = $Matches[1].Trim()
    }
    elseif ($stderr -match 'Error:\s*(.+)$') {
      $exactErr = $Matches[1].Trim()
    }
    elseif ($stdout -match 'exact_error=(.+)') {
      $exactErr = $Matches[1].Trim()
    }
    if (-not $exactErr) { $exactErr = "scorecard finalize exit " + [string]$p.ExitCode }
    $script:SilverScorecardExactError = $exactErr
    Write-Host "=== SILVER_SCORECARD_RUNTIME_HARD_STOP ===" -ForegroundColor Red
    Write-Host "SCORECARD_RUNTIME_ERROR=YES"
    Write-Host "HARD_STOP_FORCED_OUTCOME_REQUIRED=YES"
    Write-Host "next_cap_blind_retry_blocked=YES"
    Write-Host ("exact_error=" + $exactErr)
    Write-Host "recommended_next_task=fix scorecard runtime error before any CAP retry"
    Write-Host "=== END_SILVER_SCORECARD_RUNTIME_HARD_STOP ===" -ForegroundColor Red
  }

  $czechBlock = ""
  if ($stdout) {
    $idxStart = $stdout.IndexOf("SILVER_CAP_BEFORE_AFTER_SCORECARD")
    if ($idxStart -ge 0) {
      $idxEnd = $stdout.IndexOf("=== SILVER_CAP_PRODUCT_SCORECARD_FINALIZE ===")
      if ($idxEnd -gt $idxStart) {
        $czechBlock = $stdout.Substring($idxStart, $idxEnd - $idxStart).Trim()
      } else {
        $czechBlock = $stdout.Trim()
      }
    }
    Write-Host $stdout
  }

  if ($czechBlock) {
    Write-SilverCapScorecardToProgressLog -ProgressLogPath $ProgressLogPath -CzechText $czechBlock -CapLabel $capLabel -StopReason $StopReason -CyclesCompleted $CyclesCompleted
  }

  $script:SilverLastScorecardOrchestrationOnly = "NO"
  $script:SilverLastScorecardVerifiedProductShift = "NO"
  if ($stdout -match 'orchestration_only_run=YES') {
    $script:SilverLastScorecardOrchestrationOnly = "YES"
  }
  if ($stdout -match 'verified_product_shift=YES') {
    $script:SilverLastScorecardVerifiedProductShift = "YES"
  }
  elseif ($stdout -match 'verified_product_shift=PARTIAL') {
    $script:SilverLastScorecardVerifiedProductShift = "PARTIAL"
  }

  return ($p.ExitCode -eq 0)
}

function Invoke-SilverCapLabelProbeFromTempSelfTest {
  param([string]$RepoRoot)
  if (-not $RepoRoot) {
    Write-Host "SILVER_CAP_LABEL_PROBE_SELFTEST=FAIL missing_repo_root" -ForegroundColor Red
    return $false
  }
  $label = Get-SilverAuditRegistryRecommendedCap -RepoRoot $RepoRoot
  if ($label -ne "CAP15") {
    Write-Host ("SILVER_CAP_LABEL_PROBE_SELFTEST=FAIL cap_label=" + $label) -ForegroundColor Red
    return $false
  }
  $fallbackCap3 = Get-SilverCapRunLabel -ControlledInfinite $true -MaxCycles 0 -MaxAutonomousHardCycles 3 -RepoRoot $RepoRoot
  if ($fallbackCap3 -ne "CAP15") {
    Write-Host ("SILVER_CAP_LABEL_PROBE_SELFTEST=FAIL cap3_fallback_seen=" + $fallbackCap3) -ForegroundColor Red
    return $false
  }
  $fallbackCap50 = Get-SilverCapRunLabel -ControlledInfinite $true -MaxCycles 0 -MaxAutonomousHardCycles 0 -RepoRoot $RepoRoot
  if ($fallbackCap50 -ne "CAP15") {
    Write-Host ("SILVER_CAP_LABEL_PROBE_SELFTEST=FAIL cap50_fallback_seen=" + $fallbackCap50) -ForegroundColor Red
    return $false
  }
  Write-Host "SILVER_CAP_LABEL_PROBE_SELFTEST=PASS"
  Write-Host "cap_label=CAP15"
  Write-Host "temp_probe_absolute_require=YES"
  return $true
}

function Invoke-SilverCapProductScorecardSelfTest {
  param([string]$RepoRoot)
  if (-not (Invoke-SilverCapLabelProbeFromTempSelfTest -RepoRoot $RepoRoot)) {
    return $false
  }
  $scorecardScript = Join-Path $RepoRoot "scripts\silver-cap-product-scorecard.cjs"
  if (-not (Test-Path -LiteralPath $scorecardScript)) {
    Write-Host "SILVER_CAP_PRODUCT_SCORECARD_SELFTEST=FAIL missing_script" -ForegroundColor Red
    return $false
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = ($scorecardScript + " selftest")
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
  if ($stderr) { Write-Host $stderr }
  return ($p.ExitCode -eq 0)
}
