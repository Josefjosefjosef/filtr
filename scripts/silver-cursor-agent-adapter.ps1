#requires -Version 5.1
<#
.SYNOPSIS
  Silver V1 — run `cursor agent` headless (Windows, preferred argv from diagnostic JSON) or WSL Ubuntu `agent` non-interactive (--print --mode ask --trust --workspace), capture stdout/stderr, write structured log to OutputFile.

.PARAMETER TaskFile
  Path to the markdown/text task (relative to repo root or absolute). Not used with -Probe.

.PARAMETER OutputFile
  Path to write capture + adapter metadata (relative to repo root or absolute).

.PARAMETER DryRun
  Print resolved paths and invocation plan only; do not run Cursor/WSL agent.

.PARAMETER TimeoutSeconds
  Max wait for the Cursor/WSL process (default 600). Must be positive.

.PARAMETER Probe
  Harmless test. Without -TaskFile: stdin marker probe (stdout contains CURSOR_AGENT_STDIN_OK). With -WslUbuntuAgent and -TaskFile: WSL stdin regression probe (markdown-safe; stderr shell-leak gate). Exits 0 on pass, else 1. Bypasses adapter_ready JSON gate for execution, but can_run metadata requires adapter_ready=YES (Windows) or wsl_cursor_agent_print_ask_trust.adapter_ready=YES (WSL).

.PARAMETER WslUbuntuAgent
  Use verified non-interactive WSL path: write the task to a UTF-8 temp file under Windows, then run `wsl.exe -d <WslDistro> -- /bin/bash -c 'exec <WslAgentLinuxPath> --print --mode ask --trust --workspace <WslWorkspaceLinuxPath> < <temp-path-in-wsl>'` so the **shell one-liner contains only paths**, never raw markdown/task text. No `bash -lc` (non-login `-c` only). No PowerShell `PATH` export for the agent. Absolute agent path inside WSL.

.PARAMETER WslDistro
  WSL distribution name (default Ubuntu).

.PARAMETER WslAgentLinuxPath
  Absolute path to the Cursor agent binary inside WSL (default /home/spedk/.local/bin/agent).

.PARAMETER WslWorkspaceLinuxPath
  Absolute workspace path inside WSL (default /mnt/c/projects/filtr).

.NOTES
  Windows: Resolves **cursor.cmd** / **bin\\cursor** for `agent` (matches diagnostic); install-root **Cursor.exe** for `--version`.
  WSL: **wsl.exe** runs **`/bin/bash -c`** with a one-liner that **only** contains `exec <agent> … < /mnt/c/…/temp.md` (task never embedded in argv or shell string). Diagnostic JSON key **wsl_cursor_agent_print_ask_trust.adapter_ready** gates non-probe runs.
#>
param(
  [Parameter(Mandatory = $false)]
  [string]$TaskFile = "",
  [Parameter(Mandatory = $true)]
  [string]$OutputFile,
  [switch]$DryRun,
  [int]$TimeoutSeconds = 600,
  [switch]$Probe,
  [switch]$WslUbuntuAgent,
  [string]$WslDistro = "Ubuntu",
  [string]$WslAgentLinuxPath = "/home/spedk/.local/bin/agent",
  [string]$WslWorkspaceLinuxPath = "/mnt/c/projects/filtr"
)

Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$DiagReport = Join-Path $RepoRoot "scripts\silver-cursor-agent-adapter-diagnostic-report.json"

$ProbeText = "Print exactly: CURSOR_AGENT_STDIN_OK`r`nDo not modify files.`r`n"
$ProbeOneLine = "Print exactly: CURSOR_AGENT_STDIN_OK. Do not modify files."
$Marker = "CURSOR_AGENT_STDIN_OK"
$WslTaskfileStdinProbeSentinel = "SILVER_WSL_STDIN_PROBE_SENTINEL_9f2b"
$WslTaskfileStdinProbeOkToken = "SILVER_WSL_TASKFILE_STDIN_PROBE_OK"

# WSL: task body is never passed as wsl argv; a UTF-8 temp file is opened via /bin/bash -c exec … <path (path only, no task text in the shell string).
$SilverWslTaskArgvSafeCharLimit = 8192
$SilverUtf8NoBom = New-Object System.Text.UTF8Encoding $false

function Read-TextFileUtf8NoBom {
  param([string]$Path)
  return [System.IO.File]::ReadAllText($Path, $SilverUtf8NoBom)
}

function Get-TaskTextLineCount {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return 0 }
  return @(($Text -split "`r?`n", [StringSplitOptions]::None)).Count
}

function Get-PromptPreviewLimited {
  param([string]$Text, [int]$MaxLen = 300)
  if ([string]::IsNullOrEmpty($Text)) { return "" }
  $oneLine = ($Text -replace "`r?`n", " ").Trim()
  if ($oneLine.Length -le $MaxLen) { return $oneLine }
  return ($oneLine.Substring(0, $MaxLen) + "...")
}

function Build-WslSanitizedCommandExecuted {
  param([string]$Distro)
  return (
    "wsl.exe -d " + $Distro +
    " -- /bin/bash -c <TASK_OMITTED:exec_agent_stdin_from_temp_file_path_only_no_task_text_in_shell_string>"
  )
}

function Convert-WindowsPathToWslPath {
  param([string]$WindowsPath)
  $full = [System.IO.Path]::GetFullPath($WindowsPath)
  if ($full.Length -lt 3) {
    return $full.Replace('\', '/')
  }
  if ($full.Substring(1, 2) -ne ':\') {
    return $full.Replace('\', '/')
  }
  $dl = $full.Substring(0, 1).ToLowerInvariant()
  return '/mnt/' + $dl + $full.Substring(2).Replace('\', '/')
}

function Build-WslBashCExecRedirectScript {
  param(
    [string]$AgentPath,
    [string]$WorkspacePath,
    [string]$TaskPathWsl
  )
  $tq = '"' + ($TaskPathWsl.Replace('"', '\"')) + '"'
  return 'exec ' + $AgentPath + ' --print --mode ask --trust --workspace ' + $WorkspacePath + ' <' + $tq
}

function Resolve-RepoPath {
  param([string]$P)
  if ([System.IO.Path]::IsPathRooted($P)) {
    return [System.IO.Path]::GetFullPath($P)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $P))
}

function Invoke-WslAgentCapture {
  param(
    [string]$Distro,
    [string[]]$LinuxArgvAfterDoubleDash,
    [string]$WorkDirWindows,
    [int]$TimeoutMs,
    [string]$StdinPayload = ""
  )
  $argList = New-Object System.Collections.Generic.List[string]
  [void]$argList.Add("-d")
  [void]$argList.Add($Distro)
  [void]$argList.Add("--")
  foreach ($x in $LinuxArgvAfterDoubleDash) {
    [void]$argList.Add([string]$x)
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "wsl.exe"
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WorkingDirectory = $WorkDirWindows
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  $useStdin = (-not [string]::IsNullOrEmpty($StdinPayload))
  if ($useStdin) {
    $psi.RedirectStandardInput = $true
  }
  $argLine = ""
  foreach ($a in $argList) {
    if ($argLine.Length -gt 0) { $argLine += " " }
    if ($a -match '[\s"]') {
      $argLine += '"' + ($a.Replace('"', '\"')) + '"'
    }
    else {
      $argLine += $a
    }
  }
  $psi.Arguments = $argLine
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  $timedOut = $false
  $code = 0
  $so = ""
  $se = ""
  try {
    [void]$p.Start()
    if ($useStdin) {
      $utf8NoBom = New-Object System.Text.UTF8Encoding $false
      $bytes = $utf8NoBom.GetBytes($StdinPayload)
      $bs = $p.StandardInput.BaseStream
      $bs.Write($bytes, 0, $bytes.Length)
      $bs.Flush()
      $p.StandardInput.Close()
    }
    if (-not $p.WaitForExit($TimeoutMs)) {
      try { $p.Kill() } catch { }
      $timedOut = $true
      $code = 124
    }
    else {
      $code = [int]$p.ExitCode
    }
    $so = $p.StandardOutput.ReadToEnd()
    $se = $p.StandardError.ReadToEnd()
  }
  catch {
    $se = "WSL_ADAPTER_EXCEPTION: " + $_.Exception.Message
    $code = 255
  }
  finally {
    try { $p.Dispose() } catch { }
  }
  if ([string]::IsNullOrEmpty($so)) { $so = "" }
  if ([string]::IsNullOrEmpty($se)) { $se = "" }
  return @{ exit = $code; timedOut = $timedOut; stdout = $so; stderr = $se }
}

function Read-WslAdapterReadyFromDisk {
  if (-not (Test-Path -LiteralPath $DiagReport)) {
    return "UNKNOWN"
  }
  try {
    $raw = [System.IO.File]::ReadAllText($DiagReport)
    $j = $raw | ConvertFrom-Json
    if ($null -eq $j.wsl_cursor_agent_print_ask_trust) { return "UNKNOWN" }
    $w = $j.wsl_cursor_agent_print_ask_trust
    if ($null -eq $w.adapter_ready) { return "UNKNOWN" }
    return [string]$w.adapter_ready
  }
  catch {
    return "UNKNOWN"
  }
}

function Test-WslDiagnosticAdapterReady {
  $s = Read-WslAdapterReadyFromDisk
  if ($s -eq "UNKNOWN") {
    return $true
  }
  return ($s -eq "YES")
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

function Read-PreferredHeadlessArgvFromDisk {
  if (-not (Test-Path -LiteralPath $DiagReport)) {
    return $null
  }
  try {
    $raw = [System.IO.File]::ReadAllText($DiagReport)
    $j = $raw | ConvertFrom-Json
    if ($null -eq $j.preferred_headless_argv) { return $null }
    $arr = @()
    foreach ($x in $j.preferred_headless_argv) {
      $arr += [string]$x
    }
    if ($arr.Count -lt 2) { return $null }
    if ($arr[0] -ne "agent") { return $null }
    return $arr
  }
  catch {
    return $null
  }
}

function Read-PreferredHeadlessMetaFromDisk {
  if (-not (Test-Path -LiteralPath $DiagReport)) {
    return @{ variant_id = ""; command = "" }
  }
  try {
    $raw = [System.IO.File]::ReadAllText($DiagReport)
    $j = $raw | ConvertFrom-Json
    $vid = ""
    if ($null -ne $j.preferred_headless_variant_id) { $vid = [string]$j.preferred_headless_variant_id }
    $cmd = ""
    if ($null -ne $j.preferred_headless_command) { $cmd = [string]$j.preferred_headless_command }
    return @{ variant_id = $vid; command = $cmd }
  }
  catch {
    return @{ variant_id = ""; command = "" }
  }
}

function Read-PreferredStdinArgvFromDisk {
  if (-not (Test-Path -LiteralPath $DiagReport)) {
    return @("agent")
  }
  try {
    $raw = [System.IO.File]::ReadAllText($DiagReport)
    $j = $raw | ConvertFrom-Json
    $kind = ""
    if ($null -ne $j.preferred_invocation_kind) { $kind = [string]$j.preferred_invocation_kind }
    if ($kind -ne "stdin_pipe") { return @("agent") }
    if ($null -eq $j.preferred_stdin_argv) { return @("agent") }
    $arr = @()
    foreach ($x in $j.preferred_stdin_argv) {
      $arr += [string]$x
    }
    if ($arr.Count -lt 1) { return @("agent") }
    if (($arr[0] -ne "agent") -and ($arr[0] -ne "-")) {
      return @("agent")
    }
    return $arr
  }
  catch {
    return @("agent")
  }
}

function Read-PreferredInvocationKindFromDisk {
  if (-not (Test-Path -LiteralPath $DiagReport)) {
    return ""
  }
  try {
    $raw = [System.IO.File]::ReadAllText($DiagReport)
    $j = $raw | ConvertFrom-Json
    if ($null -eq $j.preferred_invocation_kind) { return "" }
    return [string]$j.preferred_invocation_kind
  }
  catch {
    return ""
  }
}

function Invoke-CursorAgentHeadlessCapture {
  param(
    [string]$CursorExe,
    [string[]]$Arguments,
    [string]$WorkDir,
    [int]$TimeoutMs
  )
  $outF = Join-Path $env:TEMP ("silver-adapt-o-" + [guid]::NewGuid().ToString() + ".txt")
  $errF = Join-Path $env:TEMP ("silver-adapt-e-" + [guid]::NewGuid().ToString() + ".txt")
  $pathEsc = $CursorExe.Replace('"', '""')
  $argTail = ""
  if ($Arguments.Count -gt 0) {
    $bits = @()
    foreach ($a in $Arguments) {
      if ($a -match '\s') {
        $bits += ('"' + $a.Replace('"', '""') + '"')
      }
      else {
        $bits += $a
      }
    }
    $argTail = " " + ($bits -join " ")
  }
  $inner = '""' + $pathEsc + '"' + $argTail
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "cmd.exe"
  $psi.Arguments = '/c ' + $inner + ' 1> "' + $outF.Replace('"', '""') + '" 2> "' + $errF.Replace('"', '""') + '"'
  $psi.WorkingDirectory = $WorkDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  $so = ""
  $se = ""
  $code = 0
  $timedOut = $false
  try {
    [void]$p.Start()
    if (-not $p.WaitForExit($TimeoutMs)) {
      try { $p.Kill() } catch { }
      $timedOut = $true
      $code = 124
      if (Test-Path -LiteralPath $outF) { $so = [System.IO.File]::ReadAllText($outF) }
      if (Test-Path -LiteralPath $errF) { $se = [System.IO.File]::ReadAllText($errF) }
      return @{ exit = $code; timedOut = $timedOut; stdout = $so; stderr = $se; inner_cmd = $inner }
    }
    $code = [int]$p.ExitCode
    if (Test-Path -LiteralPath $outF) { $so = [System.IO.File]::ReadAllText($outF) }
    if (Test-Path -LiteralPath $errF) { $se = [System.IO.File]::ReadAllText($errF) }
    return @{ exit = $code; timedOut = $timedOut; stdout = $so; stderr = $se; inner_cmd = $inner }
  }
  catch {
    $se = "ADAPTER_EXCEPTION: " + $_.Exception.Message
    return @{ exit = 255; timedOut = $false; stdout = ""; stderr = $se; inner_cmd = $inner }
  }
  finally {
    if (Test-Path -LiteralPath $outF) { Remove-Item -LiteralPath $outF -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $errF) { Remove-Item -LiteralPath $errF -Force -ErrorAction SilentlyContinue }
    try { $p.Dispose() } catch { }
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
    [string[]]$ArgvAfterExe = @("agent")
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
  $bits = @()
  foreach ($a in $ArgvAfterExe) {
    if ($a -match '\s') {
      $bits += ('"' + $a.Replace('"', '""') + '"')
    }
    else {
      $bits += $a
    }
  }
  $tail = $bits -join " "
  $inner = 'type "' + $sinEsc + '" | ' + $quotedExe + ' ' + $tail + ' 1> "' + $outEsc + '" 2> "' + $errEsc + '"'
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
  $modeTok = "agent"
  if ($ArgvAfterExe.Count -gt 0) {
    $modeTok = [string]$ArgvAfterExe[0]
  }
  return @{ exit = $code; timedOut = $timedOut; stdout = $so; stderr = $se; inner_cmd = $inner; mode = $modeTok }
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

function Test-StdoutMarkerExact {
  param([string]$Stdout, [string]$MarkerText)
  if ($null -eq $Stdout) { return "NO" }
  $t = $Stdout.Trim()
  if ($t -eq $MarkerText) { return "YES" }
  $norm = ($t -replace "`r`n", "`n").Trim()
  $lines = @($norm -split "`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() })
  if ($lines.Count -eq 1 -and $lines[0] -eq $MarkerText) { return "YES" }
  return "NO"
}

function Test-WslTaskfileProbeStderrShellLeak {
  param([string]$Stderr)
  if ($null -eq $Stderr) { return $false }
  $lower = $Stderr.ToLowerInvariant()
  $patterns = @(
    "command substitution",
    "syntax error near unexpected token",
    "set-location: command not found",
    "get-content: command not found",
    "powershell: command not found",
    "-maxcycles: command not found"
  )
  foreach ($pat in $patterns) {
    if ($lower.Contains($pat)) {
      return $true
    }
  }
  return $false
}

if ($Probe -and -not [string]::IsNullOrWhiteSpace($TaskFile)) {
  if (-not $WslUbuntuAgent) {
    Write-Error "-TaskFile with -Probe requires -WslUbuntuAgent (WSL stdin regression probe only)."
    exit 6
  }
}

if (-not $Probe) {
  if ([string]::IsNullOrWhiteSpace($TaskFile)) {
    if (-not ($WslUbuntuAgent -and $DryRun)) {
      Write-Error "TaskFile is required unless -Probe is set."
      exit 6
    }
  }
}

if ($TimeoutSeconds -lt 1) {
  Write-Error "TimeoutSeconds must be >= 1."
  exit 4
}

$outAbs = Resolve-RepoPath -P $OutputFile
$cwdActual = [System.IO.Directory]::GetCurrentDirectory()
$tsLocal = (Get-Date).ToString("o")
$ms = $TimeoutSeconds * 1000

if ($WslUbuntuAgent) {
  $wslAdapterReadyDisk = Read-WslAdapterReadyFromDisk
  $taskAbs = ""
  $taskLen = 0
  $text = ""
  $wslStdinTaskfileProbe = $false
  if ($Probe -and -not [string]::IsNullOrWhiteSpace($TaskFile)) {
    $wslStdinTaskfileProbe = $true
    $taskAbs = Resolve-RepoPath -P $TaskFile
    if (-not (Test-Path -LiteralPath $taskAbs)) {
      Write-Error ("TaskFile not found: " + $taskAbs)
      exit 3
    }
    $text = Read-TextFileUtf8NoBom -Path $taskAbs
    $taskLen = ([System.Text.Encoding]::UTF8.GetByteCount($text))
  }
  elseif ($Probe) {
    $text = $ProbeOneLine
    $taskLen = ([System.Text.Encoding]::UTF8.GetByteCount($text))
  }
  elseif ($DryRun -and -not [string]::IsNullOrWhiteSpace($TaskFile)) {
    $taskAbs = Resolve-RepoPath -P $TaskFile
    if (-not (Test-Path -LiteralPath $taskAbs)) {
      Write-Error ("TaskFile not found: " + $taskAbs)
      exit 3
    }
    $text = Read-TextFileUtf8NoBom -Path $taskAbs
    $taskLen = ([System.Text.Encoding]::UTF8.GetByteCount($text))
  }
  elseif ($DryRun) {
    $text = $ProbeOneLine
    $taskLen = ([System.Text.Encoding]::UTF8.GetByteCount($text))
  }
  else {
    $taskAbs = Resolve-RepoPath -P $TaskFile
    if (-not (Test-Path -LiteralPath $taskAbs)) {
      Write-Error ("TaskFile not found: " + $taskAbs)
      exit 3
    }
    $text = Read-TextFileUtf8NoBom -Path $taskAbs
    $taskLen = ([System.Text.Encoding]::UTF8.GetByteCount($text))
  }

  $taskChars = $text.Length
  $taskLines = Get-TaskTextLineCount -Text $text
  $promptPreview = Get-PromptPreviewLimited -Text $text -MaxLen 300
  $taskTooLargeForArgv = $false
  $taskTooLargeStr = "NO"
  $commandExecutedSanitized = Build-WslSanitizedCommandExecuted -Distro $WslDistro
  $longTaskRec = "(none)"
  $taskFileUsedStr = "NO"
  if ((-not $Probe) -or $wslStdinTaskfileProbe) {
    $taskFileUsedStr = "YES"
  }

  if ($DryRun) {
    Write-Host "=== SILVER_CURSOR_AGENT_ADAPTER_DRY_RUN ==="
    Write-Host ("timestamp=" + $tsLocal)
    Write-Host ("adapter_mode=wsl_agent_print_ask_trust_workspace")
    Write-Host ("cwd_powershell=" + $cwdActual)
    Write-Host ("repo_root=" + $RepoRoot)
    Write-Host ("wsl_distro=" + $WslDistro)
    Write-Host ("wsl_agent_path=" + $WslAgentLinuxPath)
    Write-Host ("wsl_workspace=" + $WslWorkspaceLinuxPath)
    Write-Host ("invocation_mode=wsl_bash_c_file_redirect")
    Write-Host ("argv_mode=wsl_bash_c_exec_redirect")
    Write-Host ("wsl_prompt_delivery=bash_file_redirect")
    Write-Host ("task_file_used=" + $taskFileUsedStr)
    Write-Host ("diagnostic_wsl_adapter_ready=" + $wslAdapterReadyDisk)
    Write-Host ("command_plan_sanitized=" + $commandExecutedSanitized)
    Write-Host ("task_file=" + $(if ($wslStdinTaskfileProbe) { $taskAbs } elseif ($Probe) { "(probe_inline)" } elseif (-not [string]::IsNullOrWhiteSpace($taskAbs)) { $taskAbs } else { "(dryrun_preview)" }))
    Write-Host ("output_file=" + $outAbs)
    Write-Host ("task_chars=" + [string]$taskChars)
    Write-Host ("task_lines=" + [string]$taskLines)
    Write-Host ("task_bytes_utf8=" + [string]$taskLen)
    Write-Host ("prompt_preview=" + $promptPreview)
    Write-Host ("task_argv_safe_char_limit=" + [string]$SilverWslTaskArgvSafeCharLimit)
    Write-Host ("task_too_large_for_argv=" + $taskTooLargeStr)
    Write-Host ("timeout_seconds=" + [string]$TimeoutSeconds)
    Write-Host ("probe=" + $(if ($Probe) { "YES" } else { "NO" }))
    Write-Host "=== END_SILVER_CURSOR_AGENT_ADAPTER_DRY_RUN ==="
    exit 0
  }

  if (-not $Probe) {
    if (-not (Test-WslDiagnosticAdapterReady)) {
      Write-Error "STOP: scripts/silver-cursor-agent-adapter-diagnostic-report.json reports wsl_cursor_agent_print_ask_trust.adapter_ready=NO. Run scripts/silver-cursor-agent-adapter-diagnostic.ps1 or use -Probe."
      exit 2
    }
  }

  $tempPayloadWindows = Join-Path $env:TEMP ("silver-wsl-agent-payload-" + [guid]::NewGuid().ToString() + ".md")
  [System.IO.File]::WriteAllText($tempPayloadWindows, $text, $SilverUtf8NoBom)
  $wslTaskUnix = Convert-WindowsPathToWslPath -WindowsPath $tempPayloadWindows
  $bashScript = Build-WslBashCExecRedirectScript -AgentPath $WslAgentLinuxPath -WorkspacePath $WslWorkspaceLinuxPath -TaskPathWsl $wslTaskUnix
  $linuxArgv = @("/bin/bash", "-c", $bashScript)
  $r = @{ exit = 255; timedOut = $false; stdout = ""; stderr = "" }
  try {
    $verR = Invoke-WslAgentCapture -Distro $WslDistro -LinuxArgvAfterDoubleDash @($WslAgentLinuxPath, "--version") -WorkDirWindows $RepoRoot -TimeoutMs 60000
    $verLine = ($verR.stdout + $verR.stderr).Trim()

    $r = Invoke-WslAgentCapture -Distro $WslDistro -LinuxArgvAfterDoubleDash $linuxArgv -WorkDirWindows $RepoRoot -TimeoutMs $ms
  }
  finally {
    if (Test-Path -LiteralPath $tempPayloadWindows) {
      Remove-Item -LiteralPath $tempPayloadWindows -Force -ErrorAction SilentlyContinue
    }
  }
  $so = $r.stdout
  if ($null -eq $so) { $so = "" }
  $se = $r.stderr
  if ($null -eq $se) { $se = "" }
  $exitCode = $r.exit
  $toFlag = $r.timedOut

  $stderrShellLeak = (Test-WslTaskfileProbeStderrShellLeak -Stderr $se)
  $sentinelInCmd = $false
  if ($commandExecutedSanitized.Contains($WslTaskfileStdinProbeSentinel)) {
    $sentinelInCmd = $true
  }

  $probePass = "N/A"
  $stdoutExact = "N/A"
  $czechProbe = "N/A"
  if ($Probe) {
    if ($wslStdinTaskfileProbe) {
      $stdoutExact = $(if ($so.Contains($WslTaskfileStdinProbeOkToken)) { "YES" } else { "NO" })
      $czechProbe = "NO"
      if ((-not $stderrShellLeak) -and (-not $sentinelInCmd) -and ($so.Contains($WslTaskfileStdinProbeOkToken)) -and ($exitCode -eq 0) -and (-not $toFlag)) {
        $czechProbe = "YES"
        $probePass = "YES"
      }
      else {
        $probePass = "NO"
      }
    }
    else {
      $stdoutExact = Test-StdoutMarkerExact -Stdout $so -MarkerText $Marker
      if ($so.Contains($Marker)) {
        $probePass = "YES"
      }
      else {
        $probePass = "NO"
      }
    }
  }
  else {
    $stdoutExact = Test-StdoutMarkerExact -Stdout $so -MarkerText $Marker
  }

  $canLoop = "UNKNOWN"
  if ($Probe) {
    if (($probePass -eq "YES") -and ($wslAdapterReadyDisk -eq "YES")) {
      $canLoop = "YES"
    }
    else {
      $canLoop = "NO"
    }
  }
  else {
    if (($wslAdapterReadyDisk -eq "YES") -and ($exitCode -eq 0) -and (-not $toFlag)) {
      $canLoop = "YES"
    }
    else {
      $canLoop = "NO"
    }
  }

  $extraWsl = ""
  if ($wslStdinTaskfileProbe -and ($stderrShellLeak -or $sentinelInCmd -or ($probePass -eq "NO"))) {
    $extraWsl = @"
SILVER_WSL_STDIN_PROBE_FAILURE_DETAIL
stderr_shell_leak_pattern=$(if ($stderrShellLeak) { "YES" } else { "NO" })
sentinel_present_in_command_executed=$(if ($sentinelInCmd) { "YES" } else { "NO" })
adapter_probe_pass=$probePass
czech_backtick_parentheses_probe_pass=$czechProbe
"@
  }
  if ($toFlag) {
    $timeoutNote = @"
SILVER_WSL_ADAPTER_TIMEOUT_NOTE
timed_out=YES
timeout_seconds=$TimeoutSeconds
recommendation=Increase -TimeoutSeconds if the task is legitimately long-running; otherwise investigate agent hang or auth (prompt is delivered via bash file redirect, not argv).
"@
    if ([string]::IsNullOrWhiteSpace($extraWsl)) {
      $extraWsl = $timeoutNote
    }
    else {
      $extraWsl = $extraWsl.TrimEnd() + "`r`n`r`n" + $timeoutNote
    }
  }

  $meta = [ordered]@{
    timestamp_local = $tsLocal
    cwd_powershell = $cwdActual
    repo_root = $RepoRoot
    adapter_mode = "wsl_agent_print_ask_trust_workspace"
    wsl_distro = $WslDistro
    wsl_agent_linux_path = $WslAgentLinuxPath
    wsl_workspace_linux_path = $WslWorkspaceLinuxPath
    cursor_agent_exe = "wsl.exe"
    cursor_version_exe = $WslAgentLinuxPath
    cursor_version = $verLine
    command_executed = $commandExecutedSanitized
    invocation_mode = "wsl_bash_c_file_redirect"
    argv_mode = "wsl_bash_c_exec_redirect"
    wsl_prompt_delivery = "bash_file_redirect"
    task_file_used = $taskFileUsedStr
    diagnostic_wsl_adapter_ready = $wslAdapterReadyDisk
    task_file = $(if ($wslStdinTaskfileProbe) { $taskAbs } elseif ($Probe) { "(probe_inline)" } else { $taskAbs })
    output_file = $outAbs
    task_chars = [string]$taskChars
    task_lines = [string]$taskLines
    task_bytes_utf8 = [string]$taskLen
    task_argv_safe_char_limit = [string]$SilverWslTaskArgvSafeCharLimit
    task_too_large_for_argv = $taskTooLargeStr
    prompt_preview = $promptPreview
    timeout_seconds = [string]$TimeoutSeconds
    exit_code = [string]$exitCode
    timed_out = $(if ($toFlag) { "YES" } else { "NO" })
    adapter_probe_pass = $probePass
    adapter_stdout_marker_exact = $stdoutExact
    stderr_shell_leak_probe_pattern = $(if ($stderrShellLeak) { "YES" } else { "NO" })
    sentinel_present_in_command_executed = $(if ($sentinelInCmd) { "YES" } else { "NO" })
    czech_backtick_parentheses_probe_pass = $czechProbe
    adapter_subcommand_used = "wsl_agent"
    long_task_argv_recommendation = $longTaskRec
    can_run_full_auto_loop_maxcycles_1 = $canLoop
  }

  Write-AdapterOutputFile -Path $outAbs -Meta $meta -Stdout $so -Stderr $se -ExtraBlock $extraWsl

  if ($Probe) {
    if ($probePass -eq "YES") {
      exit 0
    }
    exit 1
  }
  exit $exitCode
}

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

$verLine = Get-CursorVersionLine -CursorExe $cursorAgentExe -WorkDir $RepoRoot

$preferredArgvTemplate = Read-PreferredHeadlessArgvFromDisk
$preferredMeta = Read-PreferredHeadlessMetaFromDisk
$invocationKindDisk = Read-PreferredInvocationKindFromDisk
$pipeArgv = Read-PreferredStdinArgvFromDisk
$useHeadless = ($null -ne $preferredArgvTemplate) -and (@($preferredArgvTemplate).Count -ge 2) -and (@($preferredArgvTemplate)[0] -eq "agent")

$taskAbs = ""
$taskLen = 0
$text = ""
if ($Probe) {
  if ($useHeadless) {
    $text = $ProbeOneLine
  }
  else {
    $text = $ProbeText
  }
  $taskLen = ([System.Text.Encoding]::UTF8.GetByteCount($text))
}
else {
  $taskAbs = Resolve-RepoPath -P $TaskFile
  if (-not (Test-Path -LiteralPath $taskAbs)) {
    Write-Error ("TaskFile not found: " + $taskAbs)
    exit 3
  }
  $text = Read-TextFileUtf8NoBom -Path $taskAbs
  $taskLen = ([System.Text.Encoding]::UTF8.GetByteCount($text))
}

$taskTmp = Join-Path $env:TEMP ("silver-adapter-task-" + [guid]::NewGuid().ToString() + ".txt")
$stdoutTmp = Join-Path $env:TEMP ("silver-adapter-out-" + [guid]::NewGuid().ToString() + ".txt")
$stderrTmp = Join-Path $env:TEMP ("silver-adapter-err-" + [guid]::NewGuid().ToString() + ".txt")

$cmdExecuted = ""
$innerCmd = ""
$invocationMode = "stdin_pipe"

if ($useHeadless) {
  $argvLive = @()
  foreach ($a in @($preferredArgvTemplate)) {
    $argvLive += [string]$a
  }
  $argvLive[$argvLive.Count - 1] = $text
  $invocationMode = "headless_argv"
  $previewInner = ($argvLive -join " ")
  if ($previewInner.Length -gt 400) {
    $previewInner = $previewInner.Substring(0, 400) + "..."
  }
  $innerCmd = "cmd.exe /c """ + $cursorAgentExe + """ " + $previewInner
}
else {
  $taskEsc = $taskTmp.Replace('"', '""')
  $pathEsc = $cursorAgentExe.Replace('"', '""')
  $outEsc = $stdoutTmp.Replace('"', '""')
  $errEsc = $stderrTmp.Replace('"', '""')
  $quotedExe = '"' + $pathEsc + '"'
  $bits = @()
  foreach ($a in $pipeArgv) {
    if ($a -match '\s') {
      $bits += ('"' + $a.Replace('"', '""') + '"')
    }
    else {
      $bits += $a
    }
  }
  $tailPreview = $bits -join " "
  if ($invocationKindDisk -eq "stdin_pipe") {
    $invocationMode = "stdin_pipe_configured"
  }
  $innerCmd = 'type "' + $taskEsc + '" | ' + $quotedExe + ' ' + $tailPreview + ' 1> "' + $outEsc + '" 2> "' + $errEsc + '"'
}
$cmdLine = if ($useHeadless) { "headless via cmd.exe redirect" } else { "cmd.exe /c " + $innerCmd }

if ($DryRun) {
  Write-Host "=== SILVER_CURSOR_AGENT_ADAPTER_DRY_RUN ==="
  Write-Host ("timestamp=" + $tsLocal)
  Write-Host ("cwd_powershell=" + $cwdActual)
  Write-Host ("repo_root=" + $RepoRoot)
  Write-Host ("cursor_agent_exe=" + $cursorAgentExe)
  Write-Host ("cursor_version_exe=" + $cursorVersionExe)
  Write-Host ("cursor_version_line=" + ($verLine -replace "`r`n", " | "))
  Write-Host ("invocation_mode=" + $invocationMode)
  Write-Host ("diagnostic_invocation_kind=" + $invocationKindDisk)
  Write-Host ("stdin_pipe_argv=" + ($pipeArgv -join " "))
  Write-Host ("preferred_headless_variant_id=" + $preferredMeta.variant_id)
  Write-Host ("preferred_headless_command_disk=" + $preferredMeta.command)
  Write-Host ("command_plan=" + $innerCmd)
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
  $toFlag = $false
  $so = ""
  $se = ""
  $exitCode = 0
  $rMode = "agent"

  if ($useHeadless) {
    $argvLive = @()
    foreach ($a in @($preferredArgvTemplate)) {
      $argvLive += [string]$a
    }
    $argvLive[$argvLive.Count - 1] = $text
    $r = Invoke-CursorAgentHeadlessCapture -CursorExe $cursorAgentExe -Arguments $argvLive -WorkDir $RepoRoot -TimeoutMs $ms
    $cmdExecuted = $r.inner_cmd
    $so = $r.stdout
    if ($null -eq $so) { $so = "" }
    $se = $r.stderr
    if ($null -eq $se) { $se = "" }
    $exitCode = $r.exit
    $toFlag = $r.timedOut
    $rMode = "headless"
  }
  else {
    $r = Invoke-CursorAgentCmdPipe -CursorExe $cursorAgentExe -StdinFile $taskTmp -StdoutFile $stdoutTmp -StderrFile $stderrTmp -WorkDir $RepoRoot -TimeoutMs $ms -ArgvAfterExe $pipeArgv
    if ((-not $r.timedOut) -and (@($pipeArgv).Count -gt 0) -and (@($pipeArgv)[0] -eq "agent") -and ($r.stdout -match "Run with 'cursor -'")) {
      if (Test-Path -LiteralPath $stdoutTmp) {
        Remove-Item -LiteralPath $stdoutTmp -Force -ErrorAction SilentlyContinue
      }
      if (Test-Path -LiteralPath $stderrTmp) {
        Remove-Item -LiteralPath $stderrTmp -Force -ErrorAction SilentlyContinue
      }
      [System.IO.File]::WriteAllText($stdoutTmp, "", (New-Object System.Text.UTF8Encoding $false))
      [System.IO.File]::WriteAllText($stderrTmp, "", (New-Object System.Text.UTF8Encoding $false))
      $argvDash = @()
      foreach ($x in $pipeArgv) {
        $argvDash += [string]$x
      }
      if ($argvDash.Count -gt 0 -and $argvDash[0] -eq "agent") {
        $argvDash[0] = "-"
      }
      $r = Invoke-CursorAgentCmdPipe -CursorExe $cursorAgentExe -StdinFile $taskTmp -StdoutFile $stdoutTmp -StderrFile $stderrTmp -WorkDir $RepoRoot -TimeoutMs $ms -ArgvAfterExe $argvDash
    }
    $cmdExecuted = $r.inner_cmd
    $so = $r.stdout
    if ($null -eq $so) { $so = "" }
    $se = $r.stderr
    if ($null -eq $se) { $se = "" }
    $exitCode = $r.exit
    $toFlag = $r.timedOut
    $rMode = [string]$r.mode
  }

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
    if (($probePass -eq "YES") -and ($adapterReadyDisk -eq "YES")) {
      $canLoop = "YES"
    }
    else {
      $canLoop = "NO"
    }
  }
  else {
    if (($adapterReadyDisk -eq "YES") -and ($exitCode -eq 0) -and (-not $toFlag)) {
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
    invocation_mode = $invocationMode
    diagnostic_invocation_kind = $invocationKindDisk
    stdin_pipe_argv = ($pipeArgv -join " ")
    preferred_headless_variant_id = $preferredMeta.variant_id
    task_file = $(if ($Probe) { "(probe_inline)" } else { $taskAbs })
    output_file = $outAbs
    task_bytes_utf8 = [string]$taskLen
    exit_code = [string]$exitCode
    timed_out = $(if ($toFlag) { "YES" } else { "NO" })
    adapter_probe_pass = $probePass
    adapter_stdin_pipe_ack = $stdinPipeAck
    adapter_subcommand_used = $rMode
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
