#requires -Version 5.1
<#
.SYNOPSIS
  Real UTF-8 stdout capture probe: WSL bash -> adapter capture -> SILVER_CURSOR_OUTPUT (under %TEMP% only).
#>
Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$Adapter = Join-Path $RepoRoot "scripts\silver-cursor-agent-adapter.ps1"
$Handoff = Join-Path $RepoRoot "scripts\silver-utf8-handoff.ps1"
$OutFile = Join-Path $env:TEMP ("silver-real-stdout-utf8-capture-probe-" + [guid]::NewGuid().ToString() + ".md")

if (-not (Test-Path -LiteralPath $Adapter)) {
  Write-Error ("Missing adapter: " + $Adapter)
  exit 2
}
if (-not (Test-Path -LiteralPath $Handoff)) {
  Write-Error ("Missing handoff: " + $Handoff)
  exit 2
}
. $Handoff
Initialize-SilverConsoleUtf8

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "powershell.exe"
$psi.Arguments = (
  "-NoProfile -ExecutionPolicy Bypass -File """ + $Adapter.Replace('"', '""') + """ " +
  "-WslUbuntuAgent -Utf8CaptureProbe -OutputFile """ + $OutFile.Replace('"', '""') + """ -TimeoutSeconds 120"
)
$psi.WorkingDirectory = $RepoRoot
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
Set-SilverProcessStartInfoUtf8Streams -Psi $psi
$p = [System.Diagnostics.Process]::Start($psi)
$outerOut = $p.StandardOutput.ReadToEnd()
$outerErr = $p.StandardError.ReadToEnd()
$p.WaitForExit()
$adapterExit = $p.ExitCode

$stdoutProbe = "FAIL"
$previewProbe = "FAIL"
$passFail = "FAIL"
if ($outerOut -match 'real_stdout_utf8_capture_probe=PASS') { $stdoutProbe = "PASS" }
if ($outerOut -match 'prompt_preview_utf8_probe=PASS') { $previewProbe = "PASS" }
if (($adapterExit -eq 0) -and ($stdoutProbe -eq "PASS") -and ($previewProbe -eq "PASS")) {
  $passFail = "PASS"
}

if (Test-Path -LiteralPath $OutFile) {
  $utf8 = $script:SilverUtf8NoBom
  $body = [System.IO.File]::ReadAllText($OutFile, $utf8)
  $stdoutSec = ""
  $idx = $body.IndexOf("# stdout", [System.StringComparison]::Ordinal)
  if ($idx -ge 0) {
    $stdoutSec = $body.Substring($idx + "# stdout".Length)
    $stderrIdx = $stdoutSec.IndexOf("# stderr", [System.StringComparison]::Ordinal)
    if ($stderrIdx -ge 0) { $stdoutSec = $stdoutSec.Substring(0, $stderrIdx) }
  }
  if ($stdoutProbe -eq "PASS") {
    if (-not (Test-SilverRealUtf8CaptureProbeText -Text $stdoutSec)) {
      $stdoutProbe = "FAIL"
      $passFail = "FAIL"
    }
  }
  if ($previewProbe -eq "PASS") {
    $previewLine = ""
    foreach ($raw in $body -split "`r?`n") {
      $line = $raw.Trim()
      if ($line.StartsWith("prompt_preview=", [System.StringComparison]::Ordinal)) {
        $previewLine = $line.Substring("prompt_preview=".Length)
        break
      }
    }
    if (-not (Test-SilverPromptPreviewUtf8ProbeText -Text $previewLine)) {
      $previewProbe = "FAIL"
      $passFail = "FAIL"
    }
  }
  try { Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue } catch { }
}

Write-Host "=== SILVER_REAL_STDOUT_UTF8_CAPTURE_PROBE ==="
Write-Host ("real_stdout_utf8_capture_probe=" + $stdoutProbe)
Write-Host ("prompt_preview_utf8_probe=" + $previewProbe)
Write-Host ("adapter_exit=" + [string]$adapterExit)
if ($outerErr -and $outerErr.Trim().Length -gt 0) {
  Write-Host ("outer_stderr_bytes=" + [string]($script:SilverUtf8NoBom.GetByteCount($outerErr)))
}
Write-Host ("PASS_FAIL=" + $passFail)
Write-Host "=== END_SILVER_REAL_STDOUT_UTF8_CAPTURE_PROBE ==="

if ($passFail -eq "PASS") {
  try { [console]::beep(880, 180) } catch { }
  exit 0
}
try { [console]::beep(220, 400) } catch { }
exit 1
