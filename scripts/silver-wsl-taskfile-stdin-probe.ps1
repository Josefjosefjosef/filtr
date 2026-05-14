#requires -Version 5.1
<#
.SYNOPSIS
  Regression probe: WSL Cursor agent receives markdown task via stdin (adapter -WslUbuntuAgent), never as raw shell-expanded argv.

.DESCRIPTION
  Runs silver-cursor-agent-adapter.ps1 with -WslUbuntuAgent -Probe -TaskFile scripts/silver-wsl-taskfile-stdin-probe-task.md
  and writes capture to %TEMP% (repo stays clean). Parses adapter metadata and prints SILVER_WSL_TASKFILE_STDIN_PROBE_RESULT.
#>
Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$TaskRel = "scripts/silver-wsl-taskfile-stdin-probe-task.md"
$TaskAbs = Join-Path $RepoRoot $TaskRel
$Adapter = Join-Path $RepoRoot "scripts\silver-cursor-agent-adapter.ps1"
$OutFile = Join-Path $env:TEMP ("silver-wsl-taskfile-stdin-probe-out-" + [guid]::NewGuid().ToString() + ".md")
$Sentinel = "SILVER_WSL_STDIN_PROBE_SENTINEL_9f2b"
$OkToken = "SILVER_WSL_TASKFILE_STDIN_PROBE_OK"

if (-not (Test-Path -LiteralPath $Adapter)) {
  Write-Error ("Missing adapter: " + $Adapter)
  exit 2
}
if (-not (Test-Path -LiteralPath $TaskAbs)) {
  Write-Error ("Missing probe task: " + $TaskAbs)
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
$outerOut = $p.StandardOutput.ReadToEnd()
$outerErr = $p.StandardError.ReadToEnd()
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

$stderrBlock = ""
$parts = $body -split "# stderr", 2
if ($parts.Count -ge 2) {
  $stderrBlock = $parts[1].Trim()
}

$cmdEx = Get-MetaValue -Text $body -Key "command_executed"
$tooLarge = Get-MetaValue -Text $body -Key "task_too_large_for_argv"
$czech = Get-MetaValue -Text $body -Key "czech_backtick_parentheses_probe_pass"
$taskUsed = Get-MetaValue -Text $body -Key "task_file_used"
$chars = Get-MetaValue -Text $body -Key "task_chars"
$lines = Get-MetaValue -Text $body -Key "task_lines"
$bytes = Get-MetaValue -Text $body -Key "task_bytes_utf8"
$preview = Get-MetaValue -Text $body -Key "prompt_preview"
$probePassMeta = Get-MetaValue -Text $body -Key "adapter_probe_pass"
$stderrLeak = Get-MetaValue -Text $body -Key "stderr_shell_leak_probe_pattern"

$cmdHasFullTask = $false
if ($cmdEx.Contains($Sentinel)) {
  $cmdHasFullTask = $true
}
if ($cmdEx.Length -gt 8000) {
  $cmdHasFullTask = $true
}

$stderrBad = $false
$lowerSe = ($stderrBlock + $outerErr).ToLowerInvariant()
$badToks = @(
  "command substitution",
  "syntax error near unexpected token",
  "set-location: command not found",
  "get-content: command not found",
  "powershell: command not found",
  "-maxcycles: command not found"
)
foreach ($bt in $badToks) {
  if ($lowerSe.Contains($bt)) {
    $stderrBad = $true
    break
  }
}

$pass = "NO"
if (($adapterExit -eq 0) -and ($tooLarge -eq "NO") -and (-not $cmdHasFullTask) -and (-not $stderrBad) -and ($czech -eq "YES") -and ($probePassMeta -eq "YES")) {
  $pass = "YES"
}

Write-Host "=== SILVER_WSL_TASKFILE_STDIN_PROBE_RESULT ==="
Write-Host ("adapter_exit=" + [string]$adapterExit)
Write-Host ("adapter_probe_pass=" + $probePassMeta)
Write-Host ("czech_backtick_parentheses_probe_pass=" + $czech)
Write-Host ("task_too_large_for_argv=" + $tooLarge)
Write-Host ("task_file_used=" + $taskUsed)
Write-Host ("task_chars=" + $chars)
Write-Host ("task_lines=" + $lines)
Write-Host ("task_bytes_utf8=" + $bytes)
Write-Host ("prompt_preview=" + $preview)
Write-Host ("command_executed_contains_sentinel=" + $(if ($cmdHasFullTask) { "YES" } else { "NO" }))
Write-Host ("stderr_shell_leak_pattern=" + $(if ($stderrBad) { "YES" } else { "NO" }))
Write-Host ("stderr_shell_leak_meta=" + $stderrLeak)
Write-Host ("capture_file=" + $OutFile)
Write-Host ("SILVER_WSL_TASKFILE_STDIN_PROBE_AGGREGATE=" + $pass)
Write-Host "=== END_SILVER_WSL_TASKFILE_STDIN_PROBE_RESULT ==="

try {
  [console]::beep(880, 200)
}
catch { }

if ($pass -ne "YES") {
  exit 1
}
exit 0
