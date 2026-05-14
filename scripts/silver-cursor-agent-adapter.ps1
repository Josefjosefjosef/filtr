#requires -Version 5.1
<#
.SYNOPSIS
  Silver V1 — feed SILVER_NEXT_ACTION (or any task file) to `cursor agent` via stdin pipe; capture CLI output to a file.

.PARAMETER TaskFile
  Path to the markdown/text task (relative to repo root or absolute).

.PARAMETER OutputFile
  Path to write merged stdout/stderr capture (relative to repo root or absolute).

.PARAMETER DryRun
  Print the resolved command and paths only; do not run Cursor.

.PARAMETER TimeoutSeconds
  Max wait for the Cursor process (default 7200). Must be positive.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$TaskFile,
  [Parameter(Mandatory = $true)]
  [string]$OutputFile,
  [switch]$DryRun,
  [int]$TimeoutSeconds = 7200
)

Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$DiagReport = Join-Path $RepoRoot "scripts\silver-cursor-agent-adapter-diagnostic-report.json"

function Resolve-RepoPath {
  param([string]$P)
  if ([System.IO.Path]::IsPathRooted($P)) {
    return [System.IO.Path]::GetFullPath($P)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $P))
}

function Get-CursorCmdFromWhere {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "where.exe"
  $psi.Arguments = "cursor"
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $o = $p.StandardOutput.ReadToEnd()
  $null = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  if ($p.ExitCode -ne 0) {
    return $null
  }
  $lines = $o -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() }
  foreach ($ln in $lines) {
    if ($ln.EndsWith(".cmd", [System.StringComparison]::OrdinalIgnoreCase)) {
      return $ln
    }
  }
  foreach ($ln in $lines) {
    if ($ln.EndsWith(".exe", [System.StringComparison]::OrdinalIgnoreCase)) {
      return $ln
    }
  }
  return $null
}

function Test-DiagnosticAdapterReady {
  if (-not (Test-Path -LiteralPath $DiagReport)) {
    return $true
  }
  try {
    $raw = [System.IO.File]::ReadAllText($DiagReport)
    $j = $raw | ConvertFrom-Json
    if ($null -eq $j.adapter_ready) {
      return $true
    }
    return ($j.adapter_ready -eq "YES")
  }
  catch {
    return $true
  }
}

if (-not (Test-DiagnosticAdapterReady)) {
  Write-Error "STOP: scripts/silver-cursor-agent-adapter-diagnostic-report.json reports adapter_ready=NO. Run scripts/silver-cursor-agent-adapter-diagnostic.ps1 and use manual Cursor until stdin/pipe or --input/--output is supported."
  exit 2
}

$taskAbs = Resolve-RepoPath -P $TaskFile
$outAbs = Resolve-RepoPath -P $OutputFile

if (-not (Test-Path -LiteralPath $taskAbs)) {
  Write-Error ("TaskFile not found: " + $taskAbs)
  exit 3
}

if ($TimeoutSeconds -lt 1) {
  Write-Error "TimeoutSeconds must be >= 1."
  exit 4
}

$cursorExe = Get-CursorCmdFromWhere
if ($null -eq $cursorExe) {
  Write-Error "cursor CLI not found on PATH (where.exe cursor failed)."
  exit 5
}

$taskTmp = Join-Path $env:TEMP ("silver-adapter-task-" + [guid]::NewGuid().ToString() + ".txt")
$text = [System.IO.File]::ReadAllText($taskAbs)

$pathEsc = $cursorExe.Replace('"', '""')
$taskEsc = $taskTmp.Replace('"', '""')
$outEsc = $outAbs.Replace('"', '""')
$errAbs = $outAbs + ".stderr.txt"
$errEsc = $errAbs.Replace('"', '""')

if ($DryRun) {
  Write-Host "=== SILVER_CURSOR_AGENT_ADAPTER_DRY_RUN ==="
  Write-Host ("cursor_exe=" + $cursorExe)
  Write-Host ("task_file=" + $taskAbs)
  Write-Host ("output_file=" + $outAbs)
  Write-Host ("timeout_seconds=" + [string]$TimeoutSeconds)
  Write-Host "cmd_exe_arguments="
  $innerDry = 'type "' + $taskEsc + '" | ""' + $pathEsc + '" agent 1> "' + $outEsc + '" 2> "' + $errEsc + '"'
  Write-Host ('(task payload would be written to temp file: ' + $taskTmp + ')')
  Write-Host $innerDry
  Write-Host "=== END_SILVER_CURSOR_AGENT_ADAPTER_DRY_RUN ==="
  exit 0
}

[System.IO.File]::WriteAllText($taskTmp, $text, (New-Object System.Text.UTF8Encoding $false))
$inner = 'type "' + $taskEsc + '" | ""' + $pathEsc + '" agent 1> "' + $outEsc + '" 2> "' + $errEsc + '"'

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "cmd.exe"
$psi.Arguments = "/c " + $inner
$psi.WorkingDirectory = $RepoRoot
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi
$ms = $TimeoutSeconds * 1000
try {
  [void]$proc.Start()
  if (-not $proc.WaitForExit($ms)) {
    try {
      $proc.Kill()
    }
    catch { }
    [System.IO.File]::WriteAllText($outAbs, ("# silver-cursor-agent-adapter: TIMEOUT after " + [string]$TimeoutSeconds + "s`n"), (New-Object System.Text.UTF8Encoding $false))
    exit 124
  }
  $so = ""
  $se = ""
  if (Test-Path -LiteralPath $outAbs) {
    $so = [System.IO.File]::ReadAllText($outAbs)
  }
  if (Test-Path -LiteralPath $errAbs) {
    $se = [System.IO.File]::ReadAllText($errAbs)
  }
  $merged = "# silver-cursor-agent-adapter: captured Cursor agent CLI output`n# stdout`n" + $so + "`n# stderr`n" + $se + "`n"
  [System.IO.File]::WriteAllText($outAbs, $merged, (New-Object System.Text.UTF8Encoding $false))
  if (Test-Path -LiteralPath $errAbs) {
    Remove-Item -LiteralPath $errAbs -Force -ErrorAction SilentlyContinue
  }
  exit $proc.ExitCode
}
finally {
  if (Test-Path -LiteralPath $taskTmp) {
    Remove-Item -LiteralPath $taskTmp -Force -ErrorAction SilentlyContinue
  }
}
