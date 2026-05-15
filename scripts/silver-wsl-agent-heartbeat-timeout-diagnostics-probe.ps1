#requires -Version 5.1
<#
.SYNOPSIS
  Read-only regression probe: WSL adapter heartbeat/timeout diagnostics + loop per-cycle metadata (no autonomous loop).

.DESCRIPTION
  Runs silver-cursor-agent-adapter.ps1 -WslUbuntuAgent -Probe -TaskFile (stdin fixture) to %TEMP%, parses metadata keys,
  statically checks silver-autopilot-loop.ps1 for per-cycle silver_cycle_* wiring, verifies assets/app.js unchanged vs HEAD,
  and asserts command_executed stays sanitized (no embedded task/sentinel).
#>
param()

Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$TaskRel = "scripts/silver-wsl-taskfile-stdin-probe-task.md"
$TaskAbs = Join-Path $RepoRoot $TaskRel
$Adapter = Join-Path $RepoRoot "scripts\silver-cursor-agent-adapter.ps1"
$LoopPath = Join-Path $RepoRoot "scripts\silver-autopilot-loop.ps1"
$OutFile = Join-Path $env:TEMP ("silver-wsl-heartbeat-timeout-diag-probe-" + [guid]::NewGuid().ToString() + ".md")
$Sentinel = "SILVER_WSL_STDIN_PROBE_SENTINEL_9f2b"

if (-not (Test-Path -LiteralPath $Adapter)) {
  Write-Error ("Missing adapter: " + $Adapter)
  exit 2
}
if (-not (Test-Path -LiteralPath $TaskAbs)) {
  Write-Error ("Missing probe task: " + $TaskAbs)
  exit 2
}
if (-not (Test-Path -LiteralPath $LoopPath)) {
  Write-Error ("Missing loop script: " + $LoopPath)
  exit 2
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "powershell.exe"
$psi.Arguments = (
  "-NoProfile -ExecutionPolicy Bypass -File """ + $Adapter.Replace('"', '""') + """ " +
  "-WslUbuntuAgent -Probe -TaskFile """ + ($TaskRel.Replace('"', '""')) + """ " +
  "-OutputFile """ + $OutFile.Replace('"', '""') + """ -TimeoutSeconds 120"
)
$psi.WorkingDirectory = $RepoRoot
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$p = [System.Diagnostics.Process]::Start($psi)
$null = $p.StandardOutput.ReadToEnd()
$null = $p.StandardError.ReadToEnd()
$p.WaitForExit()
$adapterExit = $p.ExitCode

function Get-MetaValue {
  param([string]$Text, [string]$Key)
  if (-not $Text) { return "" }
  foreach ($raw in $Text -split "`r?`n") {
    $line = $raw.Trim()
    if ($line.StartsWith($Key + "=", [System.StringComparison]::OrdinalIgnoreCase)) {
      return $line.Substring($Key.Length + 1).Trim()
    }
  }
  return ""
}

$body = ""
if (Test-Path -LiteralPath $OutFile) {
  $utf8Read = New-Object System.Text.UTF8Encoding $false
  $body = [System.IO.File]::ReadAllText($OutFile, $utf8Read)
}

$chars = Get-MetaValue -Text $body -Key "task_chars"
$lines = Get-MetaValue -Text $body -Key "task_lines"
$bytes = Get-MetaValue -Text $body -Key "task_bytes_utf8"
$digest = Get-MetaValue -Text $body -Key "task_digest"
$elapsed = Get-MetaValue -Text $body -Key "elapsed_ms"
$tsec = Get-MetaValue -Text $body -Key "timeout_seconds"
$timedOut = Get-MetaValue -Text $body -Key "timed_out"
$exitCode = Get-MetaValue -Text $body -Key "exit_code"
$soB = Get-MetaValue -Text $body -Key "stdout_bytes"
$seB = Get-MetaValue -Text $body -Key "stderr_bytes"
$streamSup = Get-MetaValue -Text $body -Key "streaming_output_supported"
$lastOutUtc = Get-MetaValue -Text $body -Key "last_output_utc"
$cmdEx = Get-MetaValue -Text $body -Key "command_executed"

$metaKeysOk = "NO"
if (
  ($chars.Length -gt 0) -and ($lines.Length -gt 0) -and ($bytes.Length -gt 0) -and
  ($digest.Length -gt 0) -and ($elapsed.Length -gt 0) -and ($tsec.Length -gt 0) -and
  ($timedOut.Length -gt 0) -and ($exitCode.Length -gt 0) -and ($soB.Length -gt 0) -and ($seB.Length -gt 0) -and
  ($streamSup.Length -gt 0)
) {
  $metaKeysOk = "YES"
}

$cmdSan = "NO"
if ($cmdEx.Contains("TASK_OMITTED") -and (-not $cmdEx.Contains($Sentinel)) -and ($cmdEx.Length -lt 8000)) {
  $cmdSan = "YES"
}

$metaLongLeak = "NO"
$marker = "# stdout"
$idx = $body.IndexOf($marker, [System.StringComparison]::Ordinal)
$head = if ($idx -ge 0) { $body.Substring(0, $idx) } else { $body }
foreach ($raw in $head -split "`r?`n") {
  $line = $raw.Trim()
  if ($line.Length -le 0) { continue }
  if ($line.StartsWith("task_file=", [System.StringComparison]::OrdinalIgnoreCase)) { continue }
  if ($line.StartsWith("prompt_preview=", [System.StringComparison]::OrdinalIgnoreCase)) { continue }
  if ($line.Length -gt 520) {
    $metaLongLeak = "YES"
    break
  }
}

$streamBlock = ($body | Select-String -Pattern "SILVER_WSL_ADAPTER_STREAMING_AND_HEARTBEAT" -Quiet)
$streamBlockStr = if ($streamBlock) { "YES" } else { "NO" }

$loopRaw = [System.IO.File]::ReadAllText($LoopPath, (New-Object System.Text.UTF8Encoding $false))
$loopHasSilverCycle = ($loopRaw | Select-String -SimpleMatch "silver_cycle_task_digest" -Quiet)
$loopHasMergeFn = ($loopRaw | Select-String -SimpleMatch "Add-SilverCycleFieldsFromAdapterOutput" -Quiet)
$loopPerCycleMeta = "NO"
if ($loopHasSilverCycle -and $loopHasMergeFn) {
  $loopPerCycleMeta = "YES"
}

$prevEa = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$gitDiffOut = ""
try {
  $gpsi = New-Object System.Diagnostics.ProcessStartInfo
  $gpsi.FileName = "git"
  $gpsi.Arguments = "diff --name-only HEAD -- assets/app.js"
  $gpsi.WorkingDirectory = $RepoRoot
  $gpsi.RedirectStandardOutput = $true
  $gpsi.RedirectStandardError = $true
  $gpsi.UseShellExecute = $false
  $gpsi.CreateNoWindow = $true
  $gp = [System.Diagnostics.Process]::Start($gpsi)
  $gitDiffOut = $gp.StandardOutput.ReadToEnd().Trim()
  $null = $gp.StandardError.ReadToEnd()
  $gp.WaitForExit()
}
finally {
  $ErrorActionPreference = $prevEa
}

$assetsClean = "NO"
if ($gitDiffOut.Length -eq 0) {
  $assetsClean = "YES"
}

$aggregate = "NO"
if (
  ($adapterExit -eq 0) -and ($metaKeysOk -eq "YES") -and ($cmdSan -eq "YES") -and ($metaLongLeak -eq "NO") -and
  ($streamBlockStr -eq "YES") -and ($loopPerCycleMeta -eq "YES") -and ($assetsClean -eq "YES")
) {
  $aggregate = "YES"
}

Write-Host "=== SILVER_WSL_AGENT_HEARTBEAT_TIMEOUT_DIAGNOSTICS_PROBE ==="
Write-Host ("repo_root=" + $RepoRoot)
Write-Host ("adapter_exit=" + [string]$adapterExit)
Write-Host ("adapter_meta_keys_ok=" + $metaKeysOk)
Write-Host ("task_digest=" + $digest)
Write-Host ("elapsed_ms=" + $elapsed)
Write-Host ("streaming_output_supported=" + $streamSup)
Write-Host ("last_output_utc=" + $lastOutUtc)
Write-Host ("streaming_block_present=" + $streamBlockStr)
Write-Host ("command_executed_sanitized=" + $cmdSan)
Write-Host ("meta_header_long_line_leak=" + $metaLongLeak)
Write-Host ("loop_per_cycle_silver_cycle_wiring=" + $loopPerCycleMeta)
Write-Host ("assets_app_js_diff_empty=" + $assetsClean)
Write-Host ("capture_file=" + $OutFile)
Write-Host ("SILVER_WSL_AGENT_HEARTBEAT_TIMEOUT_DIAGNOSTICS_PROBE_AGGREGATE=" + $aggregate)
Write-Host "=== END_SILVER_WSL_AGENT_HEARTBEAT_TIMEOUT_DIAGNOSTICS_PROBE ==="

if (Test-Path -LiteralPath $OutFile) {
  Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
}

try {
  [console]::beep(880, 200)
}
catch { }

if ($aggregate -ne "YES") {
  exit 1
}
exit 0
