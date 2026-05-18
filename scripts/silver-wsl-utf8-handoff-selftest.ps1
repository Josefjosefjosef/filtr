#requires -Version 5.1
<#
.SYNOPSIS
  UTF-8 / mojibake handoff selftest for Silver WSL adapter pipeline (writes only under %TEMP%).
#>
Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"

$Handoff = Join-Path $PSScriptRoot "silver-utf8-handoff.ps1"
if (-not (Test-Path -LiteralPath $Handoff)) {
  Write-Error ("Missing: " + $Handoff)
  exit 2
}
. $Handoff
Initialize-SilverConsoleUtf8

$utf8 = $script:SilverUtf8NoBom
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

function New-SilverUtf8HandoffSelftestGoodText {
  return (
    [string][char]0x00DA + "KOL PRO CURSOR " + [char]0x2014 + " kalend" +
    [char]0x00E1 + [char]0x0159 + " p" + [char]0x0159 + [char]0x00ED + "kaz Zpr" + [char]0x00E1 + "va"
  )
}

$sampleGood = New-SilverUtf8HandoffSelftestGoodText
$enc1252 = [System.Text.Encoding]::GetEncoding(1252)
$sampleBad = $enc1252.GetString($utf8.GetBytes($sampleGood))

Assert-True -Cond (Test-SilverUtf8MojibakeMarkers -Text $sampleBad) -Label "detect_mojibake_sample"
Assert-True -Cond (-not (Test-SilverUtf8MojibakeMarkers -Text $sampleGood)) -Label "clean_czech_sample"

$repairedFlag = "NO"
$fixed = Repair-SilverUtf8HandoffText -Text $sampleBad -Repaired ([ref]$repairedFlag)
Assert-True -Cond ($repairedFlag -eq "YES") -Label "repair_flag_set"
Assert-True -Cond (-not (Test-SilverUtf8MojibakeMarkers -Text $fixed)) -Label "repair_removes_markers"
Assert-True -Cond ($fixed.Contains([string][char]0x00DA + "KOL")) -Label "repair_restores_ukol"

$tempDir = Join-Path $env:TEMP ("silver-wsl-utf8-handoff-selftest-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
$nextPath = Join-Path $tempDir "SILVER_NEXT_ACTION.md"
$cursorPath = Join-Path $tempDir "SILVER_CURSOR_OUTPUT.md"
$mdBody = @"
<!-- SILVER_NEXT_ACTION: selftest -->
$sampleGood
- radek s diakritikou
"@
[System.IO.File]::WriteAllText($nextPath, $mdBody, $utf8)
$readBack = Read-TextFileUtf8NoBomShared -Path $nextPath
Assert-True -Cond ($readBack.Contains([string][char]0x00DA + "KOL")) -Label "utf8_file_roundtrip_next_action"
Assert-True -Cond (-not (Test-SilverUtf8MojibakeMarkers -Text $readBack)) -Label "utf8_file_no_mojibake"

$adapterStub = @"
# silver-cursor-agent-adapter
prompt_preview=$sampleGood
stdout_nonempty=YES
# stdout
$sampleGood
"@
[System.IO.File]::WriteAllText($cursorPath, $adapterStub, $utf8)
$cursorRead = Read-TextFileUtf8NoBomShared -Path $cursorPath
Assert-True -Cond ($cursorRead.Contains("kalend" + [char]0x00E1 + [char]0x0159)) -Label "utf8_cursor_output_shape"

$localeScript = Add-SilverWslBashLocaleToScript -BashScript 'exec /home/user/.local/bin/agent --print'
Assert-True -Cond ($localeScript.StartsWith('export LANG=C.UTF-8')) -Label "wsl_bash_locale_prefix"

try {
  Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
catch { }

Write-Host "=== SILVER_WSL_UTF8_HANDOFF_SELFTEST_RESULT ==="
if ($fail -eq 0) {
  Write-Host "SILVER_WSL_UTF8_HANDOFF_SELFTEST=PASS"
  Write-Host "failures=0"
  try { [console]::beep(880, 180) } catch { }
  exit 0
}
Write-Host "SILVER_WSL_UTF8_HANDOFF_SELFTEST=FAIL"
Write-Host ("failures=" + [string]$fail)
try { [console]::beep(220, 400) } catch { }
exit 1
