#requires -Version 5.1
<#
.SYNOPSIS
  Regression selftest for real CAP50 mojibake fail samples (scripts-only).
#>
Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"

$Handoff = Join-Path $PSScriptRoot "silver-utf8-handoff.ps1"
$Policy = Join-Path $PSScriptRoot "silver-cap50-orchestration-policy.ps1"
. $Handoff
. $Policy

$fail = 0
function Assert-True {
  param([bool]$Cond, [string]$Label)
  if (-not $Cond) {
    Write-Host ("FAIL " + $Label)
    $script:fail++
  }
  else {
    Write-Host ("PASS " + $Label)
  }
}

$realFailSample = @(
  ([string][char]0x0102 + [char]0x0161 + "KOL PRO CURSOR"),
  ("Aktu" + [char]0x0102 + [char]0x02C1 + "ln" + [char]0x0102 + [char]0x00AD),
  ("Shrnut" + [char]0x0102 + [char]0x00AD),
  ("Orchestr" + [char]0x0102 + [char]0x00A1 + "tor"),
  ("dob" + [char]0x00C4 + [char]0x203A),
  ([char]0x017D + [char]0x02C1 + "pinav"),
  ("bezpe" + [char]0x00C4 + [char]0x0165 + "nostn" + [char]0x0102 + [char]0x00AD),
  ("po" + [char]0x0102 + [char]0x00A1 + "tadla"),
  ("ko" + [char]0x017D + [char]0x0159 + "eni"),
  ([char]0x017D + [char]0x017E + [char]0x0102 + [char]0x00BD + "dn")
) -join " "

Assert-True -Cond (Test-SilverUtf8MojibakeMarkers -Text $realFailSample) -Label "strict_detect_real_fail_sample"
$hit = Test-SilverCap50Utf8HardFailRaw -Text $realFailSample -SurfaceLabel "regression"
Assert-True -Cond ($hit.detected -eq "YES") -Label "hard_fail_real_sample"
Assert-True -Cond ([string]$hit.sample.Length -gt 0) -Label "first_sample_nonempty"

$utf8 = $script:SilverUtf8NoBom
$tempDir = Join-Path $env:TEMP ("silver-cap50-mojibake-regression-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
try {
  $cursorPath = Join-Path $tempDir "SILVER_CURSOR_OUTPUT.md"
  $cursorBody = "# silver-cursor-agent-adapter`nprompt_preview=" + $realFailSample + "`nutf8_mojibake_detected=NO`n# stdout`n" + $realFailSample + "`n"
  [System.IO.File]::WriteAllText($cursorPath, $cursorBody, $utf8)
  $gate = Invoke-SilverCap50Utf8SurfacesHardGate -RepoRoot $tempDir -NextActionPath (Join-Path $tempDir "SILVER_NEXT_ACTION.md") -CursorOutputPath $cursorPath
  Assert-True -Cond ($gate.PASS_FAIL -eq "FAIL") -Label "surfaces_gate_must_fail_on_disk_sample"
  Assert-True -Cond ($gate.utf8_mojibake_detected -eq "YES") -Label "gate_not_false_negative"
}
finally {
  Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "=== SILVER_CAP50_MOJIBAKE_REGRESSION_SELFTEST_RESULT ==="
if ($fail -eq 0) {
  Write-Host "SILVER_CAP50_MOJIBAKE_REGRESSION_SELFTEST=PASS"
  Write-Host "failures=0"
  try { [console]::beep(880, 180) } catch { }
  exit 0
}
Write-Host "SILVER_CAP50_MOJIBAKE_REGRESSION_SELFTEST=FAIL"
Write-Host ("failures=" + [string]$fail)
try { [console]::beep(220, 400) } catch { }
exit 1
