#requires -Version 5.1
<#
.SYNOPSIS
  Silver V1 — run `cursor … agent` with stdin from a task file (or -Probe), capture stdout/stderr reliably, write a structured log to OutputFile.

.PARAMETER TaskFile
  Path to the markdown/text task (relative to repo root or absolute). Not used with -Probe.

.PARAMETER OutputFile
  Path to write capture + adapter metadata (relative to repo root or absolute).

.PARAMETER DryRun
  Print resolved paths and invocation plan only; do not run Cursor.

.PARAMETER TimeoutSeconds
  Max wait for the Cursor process (default 120). Must be positive.

.PARAMETER Probe
  Harmless stdin-only test (no TaskFile). Exits 0 if stdout contains CURSOR_AGENT_STDIN_OK, else 1. Bypasses adapter_ready JSON gate.

.NOTES
  Resolves **cursor.cmd** / **bin\\cursor** for `agent` stdin (matches diagnostic probes); install-root **Cursor.exe** for `--version`.
  Uses **cmd.exe** `type "<task>" | "<launcher>" agent 1>stdout 2>stderr` with corrected quoting so stderr is captured.
#>
param(
  [Parameter(Mandatory = $false)]
  [string]$TaskFile = "",
  [Parameter(Mandatory = $true)]
  [string]$OutputFile,
  [switch]$DryRun,
  [int]$TimeoutSeconds = 120,
  [switch]$Probe
)

Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$DiagReport = Join-Path $RepoRoot "scripts\silver-cursor-agent-adapter-diagnostic-report.json"

$ProbeText = "Print exactly: CURSOR_AGENT_STDIN_OK`r`nDo not modify files.`r`n"

function Resolve-RepoPath {
  param([string]$P)
  if ([System.IO.Path]::IsPathRooted($P)) {
    return [System.IO.Path]::GetFullPath($P)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $P))
}

function Get-CursorPathsFromWhere {
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
    return @{ exit = $p.ExitCode; lines = @(); raw = $o }
  }
  $lines = $o -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() }
  return @{ exit = 0; lines = $lines; raw = $o }
}

function Find-CursorInstallerExe {
  param([string]$AnyPathUnderInstall)
  $d = Split-Path -LiteralPath $AnyPathUnderInstall
  for ($i = 0; $i -lt 12; $i++) {
    $cand = Join-Path $d "Cursor.exe"
    if (Test-Path -LiteralPath $cand) {
      return $cand
    }
    $parent = Split-Path -LiteralPath $d
    if ($parent -eq $d) {
      break
    }
    $d = $parent
  }
  return $null
}

function Select-CursorExeForCmdAgent {
  param([string[]]$Lines)
  foreach ($ln in $Lines) {
    $trim = $ln.Trim()
    if ($trim.EndsWith("cursor.cmd", [System.StringComparison]::OrdinalIgnoreCase)) {
      return $trim
    }
  }
  foreach ($ln in $Lines) {
    $trim = $ln.Trim()
    if ($trim -match '(?i)[\\/]resources[\\/]app[\\/]bin[\\/]cursor$') {
      return $trim
    }
  }
  return (Select-CursorExeForRedirect -Lines $Lines)
}

function Select-CursorExeForRedirect {
  param([string[]]$Lines)
  foreach ($ln in $Lines) {
    $trim = $ln.Trim()
    if ($trim -match '(?i)cursor\.exe$') {
      return $trim
    }
  }
  foreach ($ln in $Lines) {
    $trim = $ln.Trim()
    if ($trim -match '(?i)resources[\\/]app[\\/]bin') {
      $found = Find-CursorInstallerExe -AnyPathUnderInstall $trim
      if ($null -ne $found) {
        return $found
      }
    }
  }
  foreach ($ln in $Lines) {
    $trim = $ln.Trim()
    if ($trim.EndsWith(".cmd", [System.StringComparison]::OrdinalIgnoreCase)) {
      $dir = Split-Path -LiteralPath $trim
      foreach ($name in @("Cursor.exe", "cursor.exe")) {
        $c = Join-Path $dir $name
        if (Test-Path -LiteralPath $c) {
          return $c
        }
      }
    }
  }
  foreach ($ln in $Lines) {
    $trim = $ln.Trim()
    if ($trim -match '(?i)[\\/]cursor$') {
      $dir = Split-Path -LiteralPath $trim
      foreach ($name in @("Cursor.exe", "cursor.exe")) {
        $c = Join-Path $dir $name
        if (Test-Path -LiteralPath $c) {
          return $c
        }
      }
    }
  }
  $exePick = $null
  $cmdPick = $null
  foreach ($ln in $Lines) {
    $trim = $ln.Trim()
    if ($trim.EndsWith(".exe", [System.StringComparison]::OrdinalIgnoreCase)) {
      if ($null -eq $exePick) {
        $exePick = $trim
      }
    }
    elseif ($trim.EndsWith(".cmd", [System.StringComparison]::OrdinalIgnoreCase)) {
      if ($null -eq $cmdPick) {
        $cmdPick = $trim
      }
    }
  }
  if ($null -ne $exePick) {
    return $exePick
  }
  if ($null -ne $cmdPick) {
    return $cmdPick
  }
  if ($Lines.Count -gt 0) {
    return $Lines[0].Trim()
  }
  return $null
}

function Get-CursorVersionLine {
  param([string]$CursorExe, [string]$WorkDir)
  $outF = Join-Path $env:TEMP ("silver-adapt-ver-" + [guid]::NewGuid().ToString() + ".txt")
  $errF = Join-Path $env:TEMP ("silver-adapt-ver-e-" + [guid]::NewGuid().ToString() + ".txt")
  $pathEsc = $CursorExe.Replace('"', '""')
  $outEsc = $outF.Replace('"', '""')
  $errEsc = $errF.Replace('"', '""')
  $inner = '""' + $pathEsc + '" --version'
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "cmd.exe"
  $psi.Arguments = '/c ' + $inner + ' 1> "' + $outEsc + '" 2> "' + $errEsc + '"'
  $psi.WorkingDirectory = $WorkDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  try {
    [void]$proc.Start()
    $null = $proc.WaitForExit(60000)
  }
  finally {
    try {
      $proc.Dispose()
    }
    catch { }
  }
  $v = ""
  if (Test-Path -LiteralPath $outF) {
    $v = [System.IO.File]::ReadAllText($outF)
  }
  if (Test-Path -LiteralPath $errF) {
    $v = $v + [System.IO.File]::ReadAllText($errF)
  }
  if (Test-Path -LiteralPath $outF) {
    Remove-Item -LiteralPath $outF -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $errF) {
    Remove-Item -LiteralPath $errF -Force -ErrorAction SilentlyContinue
  }
  return ($v.Trim())
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

function Read-AdapterReadyFromDisk {
  if (-not (Test-Path -LiteralPath $DiagReport)) {
    return "UNKNOWN"
  }
  try {
    $raw = [System.IO.File]::ReadAllText($DiagReport)
    $j = $raw | ConvertFrom-Json
    if ($null -eq $j.adapter_ready) { return "UNKNOWN" }
    return [string]$j.adapter_ready
  }
  catch {
    return "UNKNOWN"
  }
}

function Invoke-CursorAgentCmdPipe {
  param(
    [string]$CursorExe,
    [string]$StdinFile,
    [string]$StdoutFile,
    [string]$StderrFile,
    [string]$WorkDir,
    [int]$TimeoutMs,
    [string]$AgentOrDash = "agent"
  )
  $timedOut = $false
  $so = ""
  $se = ""
  $code = 0
  $sinEsc = $StdinFile.Replace('"', '""')
  $pathEsc = $CursorExe.Replace('"', '""')
  $outEsc = $StdoutFile.Replace('"', '""')
  $errEsc = $StderrFile.Replace('"', '""')
  $quotedExe = '"' + $pathEsc + '"'
  $inner = 'type "' + $sinEsc + '" | ' + $quotedExe + ' ' + $AgentOrDash + ' 1> "' + $outEsc + '" 2> "' + $errEsc + '"'
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "cmd.exe"
  $psi.Arguments = "/c " + $inner
  $psi.WorkingDirectory = $WorkDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  try {
    [void]$proc.Start()
    if (-not $proc.WaitForExit($TimeoutMs)) {
      try {
        $proc.Kill()
      }
      catch { }
      $timedOut = $true
      $code = 124
    }
    else {
      $code = [int]$proc.ExitCode
    }
  }
  catch {
    $se = "ADAPTER_EXCEPTION: " + $_.Exception.Message
    $code = 255
  }
  finally {
    try {
      $proc.Dispose()
    }
    catch { }
  }
  if (Test-Path -LiteralPath $StdoutFile) {
    $so = [System.IO.File]::ReadAllText($StdoutFile)
  }
  if (Test-Path -LiteralPath $StderrFile) {
    $se = [System.IO.File]::ReadAllText($StderrFile)
  }
  return @{ exit = $code; timedOut = $timedOut; stdout = $so; stderr = $se; inner_cmd = $inner; mode = $AgentOrDash }
}

function Write-AdapterOutputFile {
  param(
    [string]$Path,
    [hashtable]$Meta,
    [string]$Stdout,
    [string]$Stderr,
    [string]$ExtraBlock
  )
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine("# silver-cursor-agent-adapter")
  foreach ($k in $Meta.Keys) {
    [void]$sb.AppendLine(($k + "=" + [string]$Meta[$k]))
  }
  if (-not [string]::IsNullOrWhiteSpace($ExtraBlock)) {
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine($ExtraBlock.TrimEnd())
  }
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("# stdout")
  [void]$sb.Append($Stdout)
  if (-not $Stdout.EndsWith("`n")) { [void]$sb.AppendLine("") }
  [void]$sb.AppendLine("# stderr")
  [void]$sb.Append($Stderr)
  if (-not $Stderr.EndsWith("`n")) { [void]$sb.AppendLine("") }
  [System.IO.File]::WriteAllText($Path, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))
}

if (-not $Probe) {
  if ([string]::IsNullOrWhiteSpace($TaskFile)) {
    Write-Error "TaskFile is required unless -Probe is set."
    exit 6
  }
}

if ($TimeoutSeconds -lt 1) {
  Write-Error "TimeoutSeconds must be >= 1."
  exit 4
}

$outAbs = Resolve-RepoPath -P $OutputFile
$whereInfo = Get-CursorPathsFromWhere
if ($whereInfo.exit -ne 0) {
  Write-Error ("where.exe cursor failed exit=" + [string]$whereInfo.exit)
  exit 5
}
$cursorVersionExe = Select-CursorExeForRedirect -Lines $whereInfo.lines
$cursorAgentExe = Select-CursorExeForCmdAgent -Lines $whereInfo.lines
if ($null -eq $cursorVersionExe) {
  Write-Error "cursor CLI not found on PATH (where.exe cursor returned no paths)."
  exit 5
}
if ($null -eq $cursorAgentExe) {
  Write-Error "cursor agent launcher not resolved from PATH."
  exit 5
}

$cwdActual = [System.IO.Directory]::GetCurrentDirectory()
$tsLocal = (Get-Date).ToString("o")
$verLine = Get-CursorVersionLine -CursorExe $cursorAgentExe -WorkDir $RepoRoot

$taskAbs = ""
$taskLen = 0
$text = ""
if ($Probe) {
  $text = $ProbeText
  $taskLen = ([System.Text.Encoding]::UTF8.GetByteCount($text))
}
else {
  $taskAbs = Resolve-RepoPath -P $TaskFile
  if (-not (Test-Path -LiteralPath $taskAbs)) {
    Write-Error ("TaskFile not found: " + $taskAbs)
    exit 3
  }
  $text = [System.IO.File]::ReadAllText($taskAbs)
  $taskLen = ([System.Text.Encoding]::UTF8.GetByteCount($text))
}

$taskTmp = Join-Path $env:TEMP ("silver-adapter-task-" + [guid]::NewGuid().ToString() + ".txt")
$stdoutTmp = Join-Path $env:TEMP ("silver-adapter-out-" + [guid]::NewGuid().ToString() + ".txt")
$stderrTmp = Join-Path $env:TEMP ("silver-adapter-err-" + [guid]::NewGuid().ToString() + ".txt")

$taskEsc = $taskTmp.Replace('"', '""')
$pathEsc = $cursorAgentExe.Replace('"', '""')
$outEsc = $stdoutTmp.Replace('"', '""')
$errEsc = $stderrTmp.Replace('"', '""')
$quotedExe = '"' + $pathEsc + '"'
$innerCmd = 'type "' + $taskEsc + '" | ' + $quotedExe + ' agent 1> "' + $outEsc + '" 2> "' + $errEsc + '"'
$cmdLine = "cmd.exe /c " + $innerCmd

if ($DryRun) {
  Write-Host "=== SILVER_CURSOR_AGENT_ADAPTER_DRY_RUN ==="
  Write-Host ("timestamp=" + $tsLocal)
  Write-Host ("cwd_powershell=" + $cwdActual)
  Write-Host ("repo_root=" + $RepoRoot)
  Write-Host ("cursor_agent_exe=" + $cursorAgentExe)
  Write-Host ("cursor_version_exe=" + $cursorVersionExe)
  Write-Host ("cursor_version_line=" + ($verLine -replace "`r`n", " | "))
  Write-Host ("command_executed=" + $cmdLine)
  Write-Host ("task_file=" + $(if ($Probe) { "(probe_inline)" } else { $taskAbs }))
  Write-Host ("output_file=" + $outAbs)
  Write-Host ("task_bytes_utf8=" + [string]$taskLen)
  Write-Host ("timeout_seconds=" + [string]$TimeoutSeconds)
  Write-Host ("probe=" + $(if ($Probe) { "YES" } else { "NO" }))
  Write-Host "=== END_SILVER_CURSOR_AGENT_ADAPTER_DRY_RUN ==="
  exit 0
}

if (-not $Probe) {
  if (-not (Test-DiagnosticAdapterReady)) {
    Write-Error "STOP: scripts/silver-cursor-agent-adapter-diagnostic-report.json reports adapter_ready=NO. Run scripts/silver-cursor-agent-adapter-diagnostic.ps1 or use -Probe."
    exit 2
  }
}

[System.IO.File]::WriteAllText($taskTmp, $text, (New-Object System.Text.UTF8Encoding $false))
try {
  $ms = $TimeoutSeconds * 1000
  $r = Invoke-CursorAgentCmdPipe -CursorExe $cursorAgentExe -StdinFile $taskTmp -StdoutFile $stdoutTmp -StderrFile $stderrTmp -WorkDir $RepoRoot -TimeoutMs $ms -AgentOrDash "agent"
  if ((-not $r.timedOut) -and ($r.stdout -match "Run with 'cursor -'")) {
    if (Test-Path -LiteralPath $stdoutTmp) {
      Remove-Item -LiteralPath $stdoutTmp -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $stderrTmp) {
      Remove-Item -LiteralPath $stderrTmp -Force -ErrorAction SilentlyContinue
    }
    [System.IO.File]::WriteAllText($stdoutTmp, "", (New-Object System.Text.UTF8Encoding $false))
    [System.IO.File]::WriteAllText($stderrTmp, "", (New-Object System.Text.UTF8Encoding $false))
    $r = Invoke-CursorAgentCmdPipe -CursorExe $cursorAgentExe -StdinFile $taskTmp -StdoutFile $stdoutTmp -StderrFile $stderrTmp -WorkDir $RepoRoot -TimeoutMs $ms -AgentOrDash "-"
  }
  $cmdExecuted = $r.inner_cmd
  $so = $r.stdout
  if ($null -eq $so) { $so = "" }
  $se = $r.stderr
  if ($null -eq $se) { $se = "" }
  $exitCode = $r.exit
  $toFlag = $r.timedOut

  $emptyStreams = (($so.Trim().Length -eq 0) -and ($se.Trim().Length -eq 0))
  $extra = ""
  if ($emptyStreams -and ($exitCode -ne 0)) {
    $extra = @"
ADAPTER_FAIL_EMPTY_STDOUT_STDERR
possible_causes=
- cursor agent is interactive/TUI only
- stdin pipe not accepted in this environment
- authentication/session missing
- workspace/cwd issue
- command invocation issue (e.g. cursor.cmd vs cursor.exe redirection)
"@
  }

  $adapterReadyDisk = Read-AdapterReadyFromDisk
  $stdinPipeAck = "NO"
  if ($so -match "Reading from stdin") {
    $stdinPipeAck = "YES"
  }
  $probePass = "N/A"
  $canLoop = "UNKNOWN"
  if ($Probe) {
    if ($so.Contains("CURSOR_AGENT_STDIN_OK")) {
      $probePass = "YES"
    }
    else {
      $probePass = "NO"
    }
    if ($probePass -eq "YES") {
      $canLoop = "YES"
    }
    else {
      $canLoop = "NO"
    }
  }

  $meta = [ordered]@{
    timestamp_local = $tsLocal
    cwd_powershell = $cwdActual
    repo_root = $RepoRoot
    cursor_agent_exe = $cursorAgentExe
    cursor_version_exe = $cursorVersionExe
    cursor_version = $verLine
    command_executed = ("cmd.exe /c " + $cmdExecuted)
    task_file = $(if ($Probe) { "(probe_inline)" } else { $taskAbs })
    output_file = $outAbs
    task_bytes_utf8 = [string]$taskLen
    exit_code = [string]$exitCode
    timed_out = $(if ($toFlag) { "YES" } else { "NO" })
    adapter_probe_pass = $probePass
    adapter_stdin_pipe_ack = $stdinPipeAck
    adapter_subcommand_used = [string]$r.mode
    diagnostic_adapter_ready = $adapterReadyDisk
    can_run_full_auto_loop_maxcycles_1 = $canLoop
  }

  Write-AdapterOutputFile -Path $outAbs -Meta $meta -Stdout $so -Stderr $se -ExtraBlock $extra

  if ($Probe) {
    if ($probePass -eq "YES") {
      exit 0
    }
    exit 1
  }
  exit $exitCode
}
finally {
  if (Test-Path -LiteralPath $taskTmp) { Remove-Item -LiteralPath $taskTmp -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $stdoutTmp) { Remove-Item -LiteralPath $stdoutTmp -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $stderrTmp) { Remove-Item -LiteralPath $stderrTmp -Force -ErrorAction SilentlyContinue }
}
