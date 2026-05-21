#requires -Version 5.1
<#
.SYNOPSIS
  Silver V1 â€” run `cursor agent` headless (Windows, preferred argv from diagnostic JSON) or WSL Ubuntu `agent` non-interactive (--print --trust --workspace), capture stdout/stderr, write structured log to OutputFile.

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
  Use verified non-interactive WSL path: write the task to a UTF-8 temp file under Windows, then run `wsl.exe -d <WslDistro> -- /bin/bash -c 'exec <WslAgentLinuxPath> --print --trust --workspace <WslWorkspaceLinuxPath> < <temp-path-in-wsl>'` so the **shell one-liner contains only paths**, never raw markdown/task text. No `bash -lc` (non-login `-c` only). No PowerShell `PATH` export for the agent. Absolute agent path inside WSL.

.PARAMETER WslDistro
  WSL distribution name (default Ubuntu).

.PARAMETER WslAgentLinuxPath
  Absolute path to the Cursor agent binary inside WSL (default /home/spedk/.local/bin/agent).

.PARAMETER WslWorkspaceLinuxPath
  Absolute workspace path inside WSL (default /mnt/c/projects/filtr).

.NOTES
  Windows: Resolves **cursor.cmd** / **bin\\cursor** for `agent` (matches diagnostic); install-root **Cursor.exe** for `--version`.
  WSL: **wsl.exe** runs **`/bin/bash -c`** with a one-liner that **only** contains `exec <agent> â€¦ < /mnt/c/â€¦/temp.md` (task never embedded in argv or shell string). Diagnostic JSON key **wsl_cursor_agent_print_ask_trust.adapter_ready** gates non-probe runs.
#>
param(
  [Parameter(Mandatory = $false)]
  [string]$TaskFile = "",
  [Parameter(Mandatory = $true)]
  [string]$OutputFile,
  [switch]$DryRun,
  [int]$TimeoutSeconds = 600,
  [switch]$Probe,
  [switch]$Utf8CaptureProbe,
  [switch]$WslUbuntuAgent,
  [string]$WslDistro = "Ubuntu",
  [string]$WslAgentLinuxPath = "/home/spedk/.local/bin/agent",
  [string]$WslWorkspaceLinuxPath = "/mnt/c/projects/filtr",
  [string]$WslAgentModel = "auto",
  [int]$MaxTimeoutSeconds = 0,
  [int]$StagedWatchdogSliceSeconds = 0,
  [int]$StagedWatchdogExtensionSeconds = 1800,
  [int]$StagedWatchdogMaxExtensions = 2,
  [int]$StagedWatchdogStallSeconds = 1200,
  [string]$TimeoutClass = "WALL_CLOCK",
  [switch]$WslPipeDrainSelfTest
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

# WSL: task body is never passed as wsl argv; a UTF-8 temp file is opened via /bin/bash -c exec â€¦ <path (path only, no task text in the shell string).
$SilverWslTaskArgvSafeCharLimit = 8192
$SilverUtf8HandoffPath = Join-Path $PSScriptRoot "silver-utf8-handoff.ps1"
if (-not (Test-Path -LiteralPath $SilverUtf8HandoffPath)) {
  Write-Error ("Missing UTF-8 handoff module: " + $SilverUtf8HandoffPath)
  exit 2
}
. $SilverUtf8HandoffPath
Initialize-SilverConsoleUtf8
$SilverUtf8NoBom = $script:SilverUtf8NoBom
$SilverCap50PolicyPath = Join-Path $PSScriptRoot "silver-cap50-orchestration-policy.ps1"
if (-not (Test-Path -LiteralPath $SilverCap50PolicyPath)) {
  Write-Error ("Missing CAP50 orchestration policy: " + $SilverCap50PolicyPath)
  exit 2
}
. $SilverCap50PolicyPath
$script:SilverEffectiveTimeoutSeconds = $TimeoutSeconds

function Read-TextFileUtf8NoBom {
  param([string]$Path)
  return Read-TextFileUtf8Raw -Path $Path
}

function Get-TaskTextLineCount {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return 0 }
  return @(($Text -split "`r?`n", [StringSplitOptions]::None)).Count
}

function Get-SilverAutonomousRunMetaFromEnv {
  $rid = [Environment]::GetEnvironmentVariable("SILVER_AUTONOMOUS_RUN_ID", "Process")
  if ([string]::IsNullOrWhiteSpace($rid)) { $rid = "" }
  $cyc = [Environment]::GetEnvironmentVariable("SILVER_AUTONOMOUS_CYCLE", "Process")
  if ([string]::IsNullOrWhiteSpace($cyc)) { $cyc = "" }
  $rs = [Environment]::GetEnvironmentVariable("SILVER_AUTONOMOUS_RUN_START_UTC", "Process")
  if ([string]::IsNullOrWhiteSpace($rs)) { $rs = "" }
  return @{
    run_id = $rid.Trim()
    cycle = $cyc.Trim()
    run_start_utc = $rs.Trim()
  }
}

function Get-TaskUtf8Sha256HexPrefix {
  param(
    [string]$Text,
    [int]$HexChars = 16
  )
  if ($null -eq $Text) { $Text = "" }
  $enc = New-Object System.Text.UTF8Encoding $false
  $bytes = $enc.GetBytes($Text)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash($bytes)
  }
  finally {
    if ($null -ne $sha) { $sha.Dispose() }
  }
  $hex = [System.BitConverter]::ToString($hash).Replace("-", "").ToLowerInvariant()
  if ($hex.Length -le $HexChars) { return $hex }
  return $hex.Substring(0, $HexChars)
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
    [string]$TaskPathWsl,
    [string]$Model = "auto"
  )
  $modelTok = ([string]$Model).Trim()
  if ([string]::IsNullOrWhiteSpace($modelTok)) { $modelTok = "auto" }
  if ($modelTok -match '[\s"''\\]') {
    Write-Error ("WslAgentModel contains unsafe shell characters: " + $modelTok)
    exit 4
  }
  $tq = '"' + ($TaskPathWsl.Replace('"', '\"')) + '"'
  $core = 'exec ' + $AgentPath + ' --print --trust --force --model ' + $modelTok + ' --workspace ' + $WorkspacePath + ' <' + $tq
  return Add-SilverWslBashLocaleToScript -BashScript $core
}

function Get-WslCursorAgentFailureClassFromStderr {
  param(
    [string]$Stderr,
    [int]$ExitCode
  )
  if ($ExitCode -eq 0) { return "" }
  $s = ([string]$Stderr).ToLowerInvariant()
  if ($s.Contains("named models unavailable") -or $s.Contains("free plans can only use auto")) {
    return "cursor_plan_model_restriction"
  }
  return "cursor_agent_runtime"
}

function Resolve-RepoPath {
  param([string]$P)
  if ([System.IO.Path]::IsPathRooted($P)) {
    return [System.IO.Path]::GetFullPath($P)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $P))
}

function Build-WslExeArgumentLine {
  param(
    [string]$Distro,
    [string[]]$LinuxArgvAfterDoubleDash
  )
  $argList = New-Object System.Collections.Generic.List[string]
  [void]$argList.Add("-d")
  [void]$argList.Add($Distro)
  [void]$argList.Add("--")
  foreach ($x in $LinuxArgvAfterDoubleDash) {
    [void]$argList.Add([string]$x)
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
  return $argLine
}

function Get-SilverWslCaptureRedirectSnapshot {
  param(
    [string]$RepoRoot,
    [string]$StdoutFile,
    [string]$StderrFile
  )
  $items = Get-SilverRepoProgressHeartbeatSnapshot -RepoRoot $RepoRoot
  $stdoutLen = 0
  $stderrLen = 0
  if (Test-Path -LiteralPath $StdoutFile) {
    $stdoutLen = (Get-Item -LiteralPath $StdoutFile).Length
  }
  if (Test-Path -LiteralPath $StderrFile) {
    $stderrLen = (Get-Item -LiteralPath $StderrFile).Length
  }
  return ($items + "|wsl_stdout_bytes=" + [string]$stdoutLen + "|wsl_stderr_bytes=" + [string]$stderrLen)
}

function Invoke-WslAgentCapture {
  param(
    [string]$Distro,
    [string[]]$LinuxArgvAfterDoubleDash,
    [string]$WorkDirWindows,
    [int]$TimeoutMs,
    [string]$StdinPayload = ""
  )
  $useStdin = (-not [string]::IsNullOrEmpty($StdinPayload))
  if ($useStdin) {
    return Invoke-WslAgentCapturePipe -Distro $Distro -LinuxArgvAfterDoubleDash $LinuxArgvAfterDoubleDash -WorkDirWindows $WorkDirWindows -TimeoutMs $TimeoutMs -StdinPayload $StdinPayload
  }
  $outF = Join-Path $env:TEMP ("silver-wsl-o-" + [guid]::NewGuid().ToString() + ".txt")
  $errF = Join-Path $env:TEMP ("silver-wsl-e-" + [guid]::NewGuid().ToString() + ".txt")
  $wslArgLine = Build-WslExeArgumentLine -Distro $Distro -LinuxArgvAfterDoubleDash $LinuxArgvAfterDoubleDash
  $inner = "wsl.exe " + $wslArgLine
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "cmd.exe"
  $psi.Arguments = '/c ' + $inner + ' 1> "' + $outF.Replace('"', '""') + '" 2> "' + $errF.Replace('"', '""') + '"'
  $psi.WorkingDirectory = $WorkDirWindows
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  $timedOut = $false
  $code = 0
  $so = ""
  $se = ""
  $prevWslUtf8 = Set-SilverWslUtf8ProcessEnvironment
  try {
    [void]$p.Start()
    if (-not $p.WaitForExit($TimeoutMs)) {
      try { $p.Kill() } catch { }
      $timedOut = $true
      $code = 124
    }
    else {
      $code = [int]$p.ExitCode
    }
    if (Test-Path -LiteralPath $outF) { $so = Read-CmdRedirectCaptureFileUtf8 -Path $outF }
    if (Test-Path -LiteralPath $errF) { $se = Read-CmdRedirectCaptureFileUtf8 -Path $errF }
  }
  catch {
    $se = "WSL_ADAPTER_EXCEPTION: " + $_.Exception.Message
    $code = 255
  }
  finally {
    Restore-SilverWslUtf8ProcessEnvironment -PreviousValue $prevWslUtf8
    if (Test-Path -LiteralPath $outF) { Remove-Item -LiteralPath $outF -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $errF) { Remove-Item -LiteralPath $errF -Force -ErrorAction SilentlyContinue }
    try { $p.Dispose() } catch { }
  }
  if ([string]::IsNullOrEmpty($so)) { $so = "" }
  if ([string]::IsNullOrEmpty($se)) { $se = "" }
  return @{ exit = $code; timedOut = $timedOut; stdout = $so; stderr = $se; pipe_capture_mode = "cmd_redirect_file" }
}

function Invoke-WslAgentCapturePipe {
  param(
    [string]$Distro,
    [string[]]$LinuxArgvAfterDoubleDash,
    [string]$WorkDirWindows,
    [int]$TimeoutMs,
    [string]$StdinPayload
  )
  $argLine = Build-WslExeArgumentLine -Distro $Distro -LinuxArgvAfterDoubleDash $LinuxArgvAfterDoubleDash
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "wsl.exe"
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WorkingDirectory = $WorkDirWindows
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = $true
  Set-SilverProcessStartInfoUtf8Streams -Psi $psi
  $psi.Arguments = $argLine
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  $timedOut = $false
  $code = 0
  $so = ""
  $se = ""
  $prevWslUtf8 = Set-SilverWslUtf8ProcessEnvironment
  $pipeCapture = $null
  try {
    [void]$p.Start()
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    $bytes = $utf8NoBom.GetBytes($StdinPayload)
    $bs = $p.StandardInput.BaseStream
    $bs.Write($bytes, 0, $bytes.Length)
    $bs.Flush()
    $p.StandardInput.Close()
    $pipeCapture = Start-SilverProcessAsyncPipeCapture -Process $p
    if (-not $p.WaitForExit($TimeoutMs)) {
      try { $p.Kill() } catch { }
      $timedOut = $true
      $code = 124
    }
    else {
      $code = [int]$p.ExitCode
    }
    $drain = Complete-SilverProcessAsyncPipeCapture -Capture $pipeCapture -Process $p
    $so = [string]$drain.stdout
    $se = [string]$drain.stderr
    $pipeCapture = $null
  }
  catch {
    $se = "WSL_ADAPTER_EXCEPTION: " + $_.Exception.Message
    $code = 255
  }
  finally {
    if ($null -ne $pipeCapture) {
      $drainFinally = Complete-SilverProcessAsyncPipeCapture -Capture $pipeCapture -Process $p
      if ([string]::IsNullOrEmpty($so)) { $so = [string]$drainFinally.stdout }
      if ([string]::IsNullOrEmpty($se)) { $se = [string]$drainFinally.stderr }
    }
    Restore-SilverWslUtf8ProcessEnvironment -PreviousValue $prevWslUtf8
    try { $p.Dispose() } catch { }
  }
  if ([string]::IsNullOrEmpty($so)) { $so = "" }
  if ([string]::IsNullOrEmpty($se)) { $se = "" }
  return @{ exit = $code; timedOut = $timedOut; stdout = $so; stderr = $se; pipe_capture_mode = "stdin_pipe_async_drain" }
}

function Get-SilverRepoProgressHeartbeatSnapshot {
  param([string]$RepoRoot)
  $items = New-Object System.Collections.Generic.List[string]
  $rootFiles = @(
    "SILVER_NEXT_ACTION.md",
    "SILVER_RUN_REPORT.md",
    "SILVER_PROGRESS_LOG.md"
  )
  foreach ($rel in $rootFiles) {
    $abs = Join-Path $RepoRoot $rel
    if (Test-Path -LiteralPath $abs) {
      $fi = Get-Item -LiteralPath $abs
      $relNorm = $rel.Replace("\", "/")
      [void]$items.Add($relNorm + ":" + [string]$fi.Length + ":" + [string]$fi.LastWriteTimeUtc.Ticks)
    }
  }
  $scriptsDir = Join-Path $RepoRoot "scripts"
  if (Test-Path -LiteralPath $scriptsDir) {
    $diag = Get-ChildItem -LiteralPath $scriptsDir -Filter "silver-*-diagnostic-report.json" -File -ErrorAction SilentlyContinue
    foreach ($f in $diag) {
      [void]$items.Add(("scripts/" + $f.Name + ":" + [string]$f.Length + ":" + [string]$f.LastWriteTimeUtc.Ticks))
    }
    $cls = Get-ChildItem -LiteralPath $scriptsDir -Filter "silver-*-cluster-classifier*-report.json" -File -ErrorAction SilentlyContinue
    foreach ($f in $cls) {
      [void]$items.Add(("scripts/" + $f.Name + ":" + [string]$f.Length + ":" + [string]$f.LastWriteTimeUtc.Ticks))
    }
  }
  $arr = $items.ToArray()
  [Array]::Sort($arr)
  return ($arr -join "|")
}

function Invoke-WslAgentCaptureStaged {
  param(
    [string]$Distro,
    [string[]]$LinuxArgvAfterDoubleDash,
    [string]$WorkDirWindows,
    [int]$TimeoutMs,
    [int]$MaxTimeoutMs,
    [int]$SliceMs,
    [int]$ExtensionMs,
    [int]$MaxExtensions,
    [int]$StallMs,
    [string]$StdinPayload = ""
  )
  $useStdin = (-not [string]::IsNullOrEmpty($StdinPayload))
  if ($useStdin) {
    return Invoke-WslAgentCapturePipe -Distro $Distro -LinuxArgvAfterDoubleDash $LinuxArgvAfterDoubleDash -WorkDirWindows $WorkDirWindows -TimeoutMs $TimeoutMs -StdinPayload $StdinPayload
  }
  $outF = Join-Path $env:TEMP ("silver-wsl-staged-o-" + [guid]::NewGuid().ToString() + ".txt")
  $errF = Join-Path $env:TEMP ("silver-wsl-staged-e-" + [guid]::NewGuid().ToString() + ".txt")
  $wslArgLine = Build-WslExeArgumentLine -Distro $Distro -LinuxArgvAfterDoubleDash $LinuxArgvAfterDoubleDash
  $inner = "wsl.exe " + $wslArgLine
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "cmd.exe"
  $psi.Arguments = '/c ' + $inner + ' 1> "' + $outF.Replace('"', '""') + '" 2> "' + $errF.Replace('"', '""') + '"'
  $psi.WorkingDirectory = $WorkDirWindows
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  $timedOut = $false
  $code = 0
  $so = ""
  $se = ""
  $extensionsUsed = 0
  $progressEver = $false
  $lastProgressUtc = ""
  $stopReason = "completed"
  $lastProgressUtcDt = [DateTime]::UtcNow
  $prevWslUtf8Staged = Set-SilverWslUtf8ProcessEnvironment
  try {
    [void]$p.Start()
    $wallStart = [DateTime]::UtcNow
    $lastProgressUtcDt = $wallStart
    $lastSnap = Get-SilverWslCaptureRedirectSnapshot -RepoRoot $WorkDirWindows -StdoutFile $outF -StderrFile $errF
    $budgetMs = $TimeoutMs
    if ($MaxTimeoutMs -lt $budgetMs) { $MaxTimeoutMs = $budgetMs }
    if ($SliceMs -lt 1000) { $SliceMs = 1000 }
    while ($true) {
      $elapsedMs = [int64](([DateTime]::UtcNow - $wallStart).TotalMilliseconds)
      $remainBudgetMs = $budgetMs - $elapsedMs
      if ($remainBudgetMs -lt 1) { $remainBudgetMs = 1 }
      $waitMs = $SliceMs
      if ($waitMs -gt $remainBudgetMs) { $waitMs = [int]$remainBudgetMs }
      if ($p.WaitForExit([int]$waitMs)) {
        $code = [int]$p.ExitCode
        $stopReason = "completed"
        break
      }
      $snapNow = Get-SilverWslCaptureRedirectSnapshot -RepoRoot $WorkDirWindows -StdoutFile $outF -StderrFile $errF
      if ($snapNow -ne $lastSnap) {
        $progressEver = $true
        $lastSnap = $snapNow
        $lastProgressUtcDt = [DateTime]::UtcNow
        $lastProgressUtc = $lastProgressUtcDt.ToString("o")
      }
      $elapsedMs = [int64](([DateTime]::UtcNow - $wallStart).TotalMilliseconds)
      $stallAgeMs = [int64](([DateTime]::UtcNow - $lastProgressUtcDt).TotalMilliseconds)
      if ($elapsedMs -ge $TimeoutMs -and $stallAgeMs -ge $StallMs) {
        try { $p.Kill() } catch { }
        $timedOut = $true
        $code = 124
        $stopReason = "stalled_no_repo_progress"
        break
      }
      if ($elapsedMs -ge $MaxTimeoutMs) {
        try { $p.Kill() } catch { }
        $timedOut = $true
        $code = 124
        $stopReason = "max_timeout_cap"
        break
      }
      if ($elapsedMs -ge $TimeoutMs -and $progressEver -and $extensionsUsed -lt $MaxExtensions) {
        $extensionsUsed += 1
        $budgetMs = $budgetMs + $ExtensionMs
        if ($budgetMs -gt $MaxTimeoutMs) { $budgetMs = $MaxTimeoutMs }
        $stopReason = "extended_for_progress"
      }
    }
    if (Test-Path -LiteralPath $outF) { $so = Read-CmdRedirectCaptureFileUtf8 -Path $outF }
    if (Test-Path -LiteralPath $errF) { $se = Read-CmdRedirectCaptureFileUtf8 -Path $errF }
  }
  catch {
    $se = "WSL_ADAPTER_EXCEPTION: " + $_.Exception.Message
    $code = 255
    $stopReason = "exception"
  }
  finally {
    Restore-SilverWslUtf8ProcessEnvironment -PreviousValue $prevWslUtf8Staged
    if (Test-Path -LiteralPath $outF) { Remove-Item -LiteralPath $outF -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $errF) { Remove-Item -LiteralPath $errF -Force -ErrorAction SilentlyContinue }
    try { $p.Dispose() } catch { }
  }
  if ([string]::IsNullOrEmpty($so)) { $so = "" }
  if ([string]::IsNullOrEmpty($se)) { $se = "" }
  if ([string]::IsNullOrEmpty($lastProgressUtc)) {
    $lastProgressUtc = $lastProgressUtcDt.ToString("o")
  }
  return @{
    exit = $code
    timedOut = $timedOut
    stdout = $so
    stderr = $se
    extensionsUsed = $extensionsUsed
    progressEver = $progressEver
    lastProgressUtc = $lastProgressUtc
    watchdogStopReason = $stopReason
    pipe_capture_mode = "cmd_redirect_file_staged"
  }
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
  # Root adapter_ready may be YES when only the WSL workspace lane qualifies; gate Windows invocations off the Windows lane reasons only.
  if (-not (Test-Path -LiteralPath $DiagReport)) {
    return $true
  }
  try {
    $raw = [System.IO.File]::ReadAllText($DiagReport)
    $j = $raw | ConvertFrom-Json
    if ($null -eq $j.adapter_ready) {
      return $true
    }
    if ($j.adapter_ready -ne "YES") {
      return $false
    }
    $why = ""
    if ($null -ne $j.adapter_ready_reason) { $why = [string]$j.adapter_ready_reason }
    if ([string]::IsNullOrWhiteSpace($why)) {
      return $true
    }
    $winLanes = @{
      help_lists_input_output = $true
      headless_probe_marker_exit0_stdout = $true
      stdin_pipe_marker_exit0_stdout = $true
    }
    return $winLanes.ContainsKey($why)
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
      if (Test-Path -LiteralPath $outF) { $so = Read-CmdRedirectCaptureFileUtf8 -Path $outF }
      if (Test-Path -LiteralPath $errF) { $se = Read-CmdRedirectCaptureFileUtf8 -Path $errF }
      return @{ exit = $code; timedOut = $timedOut; stdout = $so; stderr = $se; inner_cmd = $inner }
    }
    $code = [int]$p.ExitCode
    if (Test-Path -LiteralPath $outF) { $so = Read-CmdRedirectCaptureFileUtf8 -Path $outF }
    if (Test-Path -LiteralPath $errF) { $se = Read-CmdRedirectCaptureFileUtf8 -Path $errF }
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
    $so = Read-TextFileUtf8NoBom -Path $StdoutFile
  }
  if (Test-Path -LiteralPath $StderrFile) {
    $se = Read-TextFileUtf8NoBom -Path $StderrFile
  }
  $modeTok = "agent"
  if ($ArgvAfterExe.Count -gt 0) {
    $modeTok = [string]$ArgvAfterExe[0]
  }
  return @{ exit = $code; timedOut = $timedOut; stdout = $so; stderr = $se; inner_cmd = $inner; mode = $modeTok }
}

function Write-SilverAdapterCycleStartedEarlyMeta {
  param(
    [string]$Path,
    [string]$TaskFile,
    [string]$OutputFile,
    [string]$TaskDigest,
    [string]$ProcessStartUtcIso
  )
  $autoRunMeta = Get-SilverAutonomousRunMetaFromEnv
  $meta = [ordered]@{
    autonomous_run_id = $autoRunMeta.run_id
    autonomous_cycle = $autoRunMeta.cycle
    autonomous_run_start_utc = $autoRunMeta.run_start_utc
    adapter_output_state = "INVOKE_STARTED"
    adapter_completion_path = "adapter_process_started"
    process_start_utc = $ProcessStartUtcIso
    task_digest = $TaskDigest
    task_file = $TaskFile
    output_file = $OutputFile
    exit_code = ""
    elapsed_ms = ""
  }
  Write-AdapterOutputFile -Path $Path -Meta $meta -Stdout "" -Stderr "" -ExtraBlock ""
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

function Test-WslAdapterShellExitNoise {
  param(
    [int]$WslExit,
    [bool]$TimedOut,
    [int]$StdoutBytes,
    [int]$StderrBytes,
    [bool]$StderrShellLeak
  )
  if ($TimedOut) { return $false }
  if ($WslExit -eq 0) { return $false }
  if ($StderrShellLeak) { return $false }
  if ($StdoutBytes -lt 64) { return $false }
  if ($StderrBytes -gt 4096) { return $false }
  return $true
}

function Resolve-WslAdapterAuthoritativeExitCode {
  param(
    [int]$WslExit,
    [bool]$ShellExitNoise,
    [bool]$TimedOut
  )
  if ($TimedOut) { return $WslExit }
  if ($WslExit -eq 0) { return 0 }
  if ($ShellExitNoise) { return 0 }
  return $WslExit
}

if ($Probe -and -not [string]::IsNullOrWhiteSpace($TaskFile)) {
  if (-not $WslUbuntuAgent) {
    Write-Error "-TaskFile with -Probe requires -WslUbuntuAgent (WSL stdin regression probe only)."
    exit 6
  }
}

if (-not $Probe -and -not $Utf8CaptureProbe -and -not $WslPipeDrainSelfTest) {
  if ([string]::IsNullOrWhiteSpace($TaskFile)) {
    if (-not ($WslUbuntuAgent -and $DryRun)) {
      Write-Error "TaskFile is required unless -Probe or -Utf8CaptureProbe is set."
      exit 6
    }
  }
}

if ($TimeoutSeconds -lt 1) {
  Write-Error "TimeoutSeconds must be >= 1."
  exit 4
}
if ($MaxTimeoutSeconds -gt 0 -and $MaxTimeoutSeconds -lt $TimeoutSeconds) {
  Write-Error "MaxTimeoutSeconds must be >= TimeoutSeconds when set."
  exit 4
}
if ($StagedWatchdogSliceSeconds -lt 0) {
  Write-Error "StagedWatchdogSliceSeconds must be >= 0."
  exit 4
}
if ($StagedWatchdogMaxExtensions -lt 0) {
  Write-Error "StagedWatchdogMaxExtensions must be >= 0."
  exit 4
}

$productTaskRun = (-not $Probe) -and (-not $Utf8CaptureProbe) -and (-not [string]::IsNullOrWhiteSpace($TaskFile))
$autoMetaForTimeout = Get-SilverAutonomousRunMetaFromEnv
if ($autoMetaForTimeout.run_id.Trim().Length -gt 0) {
  $productTaskRun = $true
}
$timeoutResolve = Resolve-SilverAutonomousAdapterTimeoutSeconds -RequestedTimeoutSeconds $TimeoutSeconds -Probe:($Probe -or $Utf8CaptureProbe) -ProductTaskRun:$productTaskRun
if ($timeoutResolve.TimeoutAdjusted -eq "YES") {
  Write-Host ("silver-cursor-agent-adapter: timeout_adjusted=YES effective_timeout_seconds=" + [string]$timeoutResolve.EffectiveTimeoutSeconds + " reason=" + [string]$timeoutResolve.TimeoutAdjustReason)
}
$TimeoutSeconds = [int]$timeoutResolve.TimeoutSeconds
$script:SilverEffectiveTimeoutSeconds = [int]$timeoutResolve.EffectiveTimeoutSeconds

$outAbs = Resolve-RepoPath -P $OutputFile
$cwdActual = [System.IO.Directory]::GetCurrentDirectory()
$tsLocal = (Get-Date).ToString("o")
$ms = $TimeoutSeconds * 1000
$maxMs = $ms
if ($MaxTimeoutSeconds -gt 0) {
  $maxMs = $MaxTimeoutSeconds * 1000
}
$stagedWatchdogEnabled = ($StagedWatchdogSliceSeconds -gt 0 -and $maxMs -gt $ms)
$sliceMs = 0
if ($stagedWatchdogEnabled) {
  $sliceMs = $StagedWatchdogSliceSeconds * 1000
}
$extensionMs = $StagedWatchdogExtensionSeconds * 1000
$stallMs = $StagedWatchdogStallSeconds * 1000
$watchdogExtensionsUsed = 0
$watchdogProgressEver = $false
$watchdogLastProgressUtc = "UNAVAILABLE"
$watchdogStopReason = "wall_clock_only"

if ($Utf8CaptureProbe) {
  if (-not $WslUbuntuAgent) {
    Write-Error "-Utf8CaptureProbe requires -WslUbuntuAgent (same WSL capture path as production)."
    exit 6
  }
  $probePhrases = Get-SilverUtf8CaptureProbeRequiredPhrases
  $probeTaskBody = ($probePhrases -join "`n") + "`n"
  $probeTaskWindows = Join-Path $env:TEMP ("silver-utf8-capture-probe-task-" + [guid]::NewGuid().ToString() + ".md")
  if ([System.IO.Path]::IsPathRooted($OutputFile)) {
    $probeOutAbs = [System.IO.Path]::GetFullPath($OutputFile)
  }
  else {
    $probeOutAbs = Resolve-RepoPath -P $OutputFile
  }
  [System.IO.File]::WriteAllText($probeTaskWindows, $probeTaskBody, $SilverUtf8NoBom)
  $textProbe = Read-TextFileUtf8Raw -Path $probeTaskWindows
  $textProbeRepaired = "NO"
  $textProbe = Repair-SilverUtf8HandoffText -Text $textProbe -Repaired ([ref]$textProbeRepaired)
  $promptPreviewProbe = Get-PromptPreviewLimited -Text $textProbe -MaxLen 300
  $wslTaskProbe = Convert-WindowsPathToWslPath -WindowsPath $probeTaskWindows
  $tqProbe = '"' + ($wslTaskProbe.Replace('"', '\"')) + '"'
  $bashProbe = Add-SilverWslBashLocaleToScript -BashScript ('cat ' + $tqProbe)
  $rProbe = Invoke-WslAgentCapture -Distro $WslDistro -LinuxArgvAfterDoubleDash @("/bin/bash", "-c", $bashProbe) -WorkDirWindows $RepoRoot -TimeoutMs 60000
  $soProbe = $rProbe.stdout
  if ($null -eq $soProbe) { $soProbe = "" }
  $seProbe = $rProbe.stderr
  if ($null -eq $seProbe) { $seProbe = "" }
  $stdoutProbePass = if (Test-SilverRealUtf8CaptureProbeText -Text $soProbe) { "PASS" } else { "FAIL" }
  $previewProbePass = if (Test-SilverPromptPreviewUtf8ProbeText -Text $promptPreviewProbe) { "PASS" } else { "FAIL" }
  $metaProbe = [ordered]@{
    timestamp_local = $tsLocal
    adapter_mode = "utf8_capture_probe"
    probe_task_file = $probeTaskWindows
    prompt_preview = $promptPreviewProbe
    real_stdout_utf8_capture_probe = $stdoutProbePass
    prompt_preview_utf8_probe = $previewProbePass
    utf8_mojibake_detected = $(if ((Test-SilverRealUtf8CaptureProbeText -Text $soProbe) -and (Test-SilverPromptPreviewUtf8ProbeText -Text $promptPreviewProbe)) { "NO" } else { "YES" })
    exit_code = [string]$rProbe.exit
  }
  Write-AdapterOutputFile -Path $probeOutAbs -Meta $metaProbe -Stdout $soProbe -Stderr $seProbe -ExtraBlock "SILVER_UTF8_CAPTURE_PROBE"
  try { Remove-Item -LiteralPath $probeTaskWindows -Force -ErrorAction SilentlyContinue } catch { }
  Write-Host "=== SILVER_REAL_STDOUT_UTF8_CAPTURE_PROBE ==="
  Write-Host ("real_stdout_utf8_capture_probe=" + $stdoutProbePass)
  Write-Host ("prompt_preview_utf8_probe=" + $previewProbePass)
  Write-Host ("PASS_FAIL=" + $(if (($stdoutProbePass -eq "PASS") -and ($previewProbePass -eq "PASS")) { "PASS" } else { "FAIL" }))
  Write-Host "=== END_SILVER_REAL_STDOUT_UTF8_CAPTURE_PROBE ==="
  if (($stdoutProbePass -eq "PASS") -and ($previewProbePass -eq "PASS")) { exit 0 }
  exit 1
}

if ($WslPipeDrainSelfTest) {
  $drainBashCore = 'yes SILVER_PIPE_DRAIN_TEST | head -n 2500'
  $drainBash = Add-SilverWslBashLocaleToScript -BashScript $drainBashCore
  $swDrain = [System.Diagnostics.Stopwatch]::StartNew()
  $rDrain = Invoke-WslAgentCapture -Distro $WslDistro -LinuxArgvAfterDoubleDash @("/bin/bash", "-c", $drainBash) -WorkDirWindows $RepoRoot -TimeoutMs 120000
  $swDrain.Stop()
  $stdoutLen = 0
  if ($null -ne $rDrain.stdout) { $stdoutLen = $rDrain.stdout.Length }
  $passDrain = "NO"
  if ((-not $rDrain.timedOut) -and ($rDrain.exit -eq 0) -and ($stdoutLen -ge 30000) -and ($swDrain.Elapsed.TotalSeconds -lt 110)) {
    $passDrain = "YES"
  }
  Write-Host "=== SILVER_WSL_ADAPTER_PIPE_DRAIN_SELFTEST ==="
  Write-Host ("pipe_drain_selftest=" + $passDrain)
  Write-Host ("stdout_chars=" + [string]$stdoutLen)
  Write-Host ("elapsed_seconds=" + [string]([int]$swDrain.Elapsed.TotalSeconds))
  Write-Host ("exit_code=" + [string]$rDrain.exit)
  Write-Host ("timed_out=" + $(if ($rDrain.timedOut) { "YES" } else { "NO" }))
  Write-Host ("pipe_capture_mode=" + [string]$rDrain.pipe_capture_mode)
  Write-Host "=== END_SILVER_WSL_ADAPTER_PIPE_DRAIN_SELFTEST ==="
  if ($passDrain -eq "YES") { exit 0 }
  exit 1
}

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
  $textRepairedFlag = "NO"
  $text = Repair-SilverUtf8HandoffText -Text $text -Repaired ([ref]$textRepairedFlag)
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
    Write-Host ("wsl_agent_model=" + $WslAgentModel)
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
    Write-Host ("effective_timeout_seconds=" + [string]$script:SilverEffectiveTimeoutSeconds)
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

  $processStartUtcEarly = (Get-Date).ToUniversalTime().ToString("o")
  $taskDigestEarly = Get-TaskUtf8Sha256HexPrefix -Text $text -HexChars 16
  Write-SilverAdapterCycleStartedEarlyMeta -Path $outAbs -TaskFile $taskAbs -OutputFile $outAbs -TaskDigest $taskDigestEarly -ProcessStartUtcIso $processStartUtcEarly

  $tempPayloadWindows = Join-Path $env:TEMP ("silver-wsl-agent-payload-" + [guid]::NewGuid().ToString() + ".md")
  [System.IO.File]::WriteAllText($tempPayloadWindows, $text, $SilverUtf8NoBom)
  $wslTaskUnix = Convert-WindowsPathToWslPath -WindowsPath $tempPayloadWindows
  $bashScript = Build-WslBashCExecRedirectScript -AgentPath $WslAgentLinuxPath -WorkspacePath $WslWorkspaceLinuxPath -TaskPathWsl $wslTaskUnix -Model $WslAgentModel
  $linuxArgv = @("/bin/bash", "-c", $bashScript)
  $r = @{ exit = 255; timedOut = $false; stdout = ""; stderr = "" }
  $verLine = ""
  $processStartUtc = ""
  $processEndUtc = ""
  $elapsedMs = 0
  $wslAdapterOutputWritten = $false
  $wslCaptureException = ""
  try {
    $verR = Invoke-WslAgentCapture -Distro $WslDistro -LinuxArgvAfterDoubleDash @($WslAgentLinuxPath, "--version") -WorkDirWindows $RepoRoot -TimeoutMs 60000
    $verLine = ($verR.stdout + $verR.stderr).Trim()

    $processStartUtc = (Get-Date).ToUniversalTime().ToString("o")
    $wallSw = [System.Diagnostics.Stopwatch]::StartNew()
    if ($stagedWatchdogEnabled) {
      $r = Invoke-WslAgentCaptureStaged -Distro $WslDistro -LinuxArgvAfterDoubleDash $linuxArgv -WorkDirWindows $RepoRoot -TimeoutMs $ms -MaxTimeoutMs $maxMs -SliceMs $sliceMs -ExtensionMs $extensionMs -MaxExtensions $StagedWatchdogMaxExtensions -StallMs $stallMs
      $watchdogExtensionsUsed = [int]$r.extensionsUsed
      $watchdogProgressEver = [bool]$r.progressEver
      if ($r.lastProgressUtc) { $watchdogLastProgressUtc = [string]$r.lastProgressUtc }
      $watchdogStopReason = [string]$r.watchdogStopReason
    }
    else {
      $r = Invoke-WslAgentCapture -Distro $WslDistro -LinuxArgvAfterDoubleDash $linuxArgv -WorkDirWindows $RepoRoot -TimeoutMs $ms
    }
    $wallSw.Stop()
    $processEndUtc = (Get-Date).ToUniversalTime().ToString("o")
    $elapsedMs = [int64]$wallSw.ElapsedMilliseconds
  }
  catch {
    $wslCaptureException = $_.Exception.Message
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
  $soRaw = $so
  $seRaw = $se
  $stdoutMojibakeRepaired = "NO"
  $stderrMojibakeRepaired = "NO"
  $so = Repair-SilverUtf8HandoffText -Text $so -Repaired ([ref]$stdoutMojibakeRepaired)
  $se = Repair-SilverUtf8HandoffText -Text $se -Repaired ([ref]$stderrMojibakeRepaired)
  $utf8MojibakeRepaired = "NO"
  if (($stdoutMojibakeRepaired -eq "YES") -or ($stderrMojibakeRepaired -eq "YES") -or ($textRepairedFlag -eq "YES")) {
    $utf8MojibakeRepaired = "YES"
  }
  $wslShellExit = [int]$r.exit
  $toFlag = $r.timedOut

  $stdoutBytes = $SilverUtf8NoBom.GetByteCount($so)
  $stderrBytes = $SilverUtf8NoBom.GetByteCount($se)
  $stderrShellLeak = (Test-WslTaskfileProbeStderrShellLeak -Stderr $se)
  $shellExitNoise = Test-WslAdapterShellExitNoise -WslExit $wslShellExit -TimedOut $toFlag -StdoutBytes $stdoutBytes -StderrBytes $stderrBytes -StderrShellLeak $stderrShellLeak
  $authoritativeExit = Resolve-WslAdapterAuthoritativeExitCode -WslExit $wslShellExit -ShellExitNoise $shellExitNoise -TimedOut $toFlag
  $exitCode = $authoritativeExit
  $cursorAgentFailureClass = Get-WslCursorAgentFailureClassFromStderr -Stderr $se -ExitCode $exitCode
  $shellNoiseReconciled = $(if ($shellExitNoise) { "YES" } else { "NO" })
  $stdoutNonempty = $(if ($stdoutBytes -gt 0) { "YES" } else { "NO" })
  $stderrNonempty = $(if ($stderrBytes -gt 0) { "YES" } else { "NO" })
  $taskDigestHex = Get-TaskUtf8Sha256HexPrefix -Text $text -HexChars 16
  $outputTotalBytes = $stdoutBytes + $stderrBytes
  $stallHint = "UNKNOWN"
  if ($toFlag) {
    if ($outputTotalBytes -eq 0) {
      $stallHint = "timed_out_zero_output_bytes_suspect_hard_stall_or_auth_prompt_stuck"
    }
    elseif ($outputTotalBytes -lt 256) {
      $stallHint = "timed_out_minimal_output_suspect_slow_or_near_stall"
    }
    else {
      $stallHint = "timed_out_with_substantial_output_possible_legit_long_work_or_truncated_streams"
    }
  }
  else {
    if ($outputTotalBytes -eq 0) {
      $stallHint = "exit_without_stream_bytes_check_invoke_stderr_and_exit_code"
    }
    else {
      $stallHint = "completed_with_stream_bytes_present"
    }
  }

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
effective_timeout_seconds=$($script:SilverEffectiveTimeoutSeconds)
recommendation=Increase -TimeoutSeconds if the task is legitimately long-running; otherwise investigate agent hang or auth (prompt is delivered via bash file redirect, not argv).
"@
    if ([string]::IsNullOrWhiteSpace($extraWsl)) {
      $extraWsl = $timeoutNote
    }
    else {
      $extraWsl = $extraWsl.TrimEnd() + "`r`n`r`n" + $timeoutNote
    }
  }

  $timeoutSemantics = "wall_clock_only"
  if ($stagedWatchdogEnabled) {
    $timeoutSemantics = "staged_repo_progress_heartbeat"
  }
  $streamDiag = @"
SILVER_WSL_ADAPTER_STREAMING_AND_HEARTBEAT
streaming_output_supported=NO
last_output_utc=$watchdogLastProgressUtc
last_stdout_bytes=UNAVAILABLE
last_stderr_bytes=UNAVAILABLE
adapter_wall_clock_note=Staged watchdog polls repo progress and WSL redirect file growth between WaitForExit slices; capture uses cmd_redirect_file (no pipe-buffer deadlock).
timeout_semantics=$timeoutSemantics
timeout_class=$TimeoutClass
watchdog_max_timeout_seconds=$(if ($MaxTimeoutSeconds -gt 0) { [string]$MaxTimeoutSeconds } else { [string]$TimeoutSeconds })
watchdog_extensions_used=$watchdogExtensionsUsed
watchdog_progress_detected=$(if ($watchdogProgressEver) { "YES" } else { "NO" })
watchdog_stop_reason=$watchdogStopReason
"@
  if ([string]::IsNullOrWhiteSpace($extraWsl)) {
    $extraWsl = $streamDiag
  }
  else {
    $extraWsl = $extraWsl.TrimEnd() + "`r`n`r`n" + $streamDiag
  }

  $utf8HardFail = "NO"
  $utf8HardFailLocations = ""
  $utf8HardFailReason = ""
  $utf8Surfaces = @(
    @{ text = $text; label = "task_text" },
    @{ text = $promptPreview; label = "prompt_preview" },
    @{ text = $soRaw; label = "stdout_raw" },
    @{ text = $seRaw; label = "stderr_raw" },
    @{ text = $so; label = "stdout" },
    @{ text = $se; label = "stderr" }
  )
  $utf8LocParts = New-Object System.Collections.Generic.List[string]
  foreach ($surf in $utf8Surfaces) {
    $hit = Test-SilverCap50Utf8HardFailAfterRepair -Text ([string]$surf.text) -SurfaceLabel ([string]$surf.label)
    if ($hit.detected -eq "YES") {
      $utf8HardFail = "YES"
      [void]$utf8LocParts.Add([string]$hit.surface + ":" + [string]$hit.locations)
    }
  }
  if ($utf8HardFail -eq "YES") {
    $utf8HardFailLocations = ($utf8LocParts -join " | ")
    $utf8HardFailReason = "utf8_mojibake_detected"
    $canLoop = "NO"
    $exitCode = 12
    $authoritativeExit = 12
  }

  $autoRunMeta = Get-SilverAutonomousRunMetaFromEnv
  $meta = [ordered]@{
    timestamp_local = $tsLocal
    cwd_powershell = $cwdActual
    repo_root = $RepoRoot
    autonomous_run_id = $autoRunMeta.run_id
    autonomous_cycle = $autoRunMeta.cycle
    autonomous_run_start_utc = $autoRunMeta.run_start_utc
    adapter_output_state = "COMPLETED"
    pipe_capture_mode = "cmd_redirect_file"
    adapter_mode = "wsl_agent_print_ask_trust_workspace"
    wsl_distro = $WslDistro
    wsl_agent_linux_path = $WslAgentLinuxPath
    wsl_workspace_linux_path = $WslWorkspaceLinuxPath
    wsl_agent_model = ([string]$WslAgentModel).Trim()
    cursor_agent_failure_class = $cursorAgentFailureClass
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
    task_digest = $taskDigestHex
    task_sha256_prefix = $taskDigestHex
    task_argv_safe_char_limit = [string]$SilverWslTaskArgvSafeCharLimit
    task_too_large_for_argv = $taskTooLargeStr
    prompt_preview = $promptPreview
    process_start_utc = $processStartUtc
    process_end_utc = $processEndUtc
    elapsed_ms = [string]$elapsedMs
    timeout_seconds = [string]$TimeoutSeconds
    effective_timeout_seconds = [string]$script:SilverEffectiveTimeoutSeconds
    watchdog_max_timeout_seconds = $(if ($MaxTimeoutSeconds -gt 0) { [string]$MaxTimeoutSeconds } else { [string]$TimeoutSeconds })
    timeout_class = [string]$TimeoutClass
    watchdog_extensions_used = [string]$watchdogExtensionsUsed
    watchdog_progress_detected = $(if ($watchdogProgressEver) { "YES" } else { "NO" })
    watchdog_stop_reason = [string]$watchdogStopReason
    wsl_shell_exit_code = [string]$wslShellExit
    adapter_authoritative_exit_code = [string]$authoritativeExit
    shell_exit_noise_reconciled = $shellNoiseReconciled
    exit_code = [string]$exitCode
    timed_out = $(if ($toFlag) { "YES" } else { "NO" })
    stdout_bytes = [string]$stdoutBytes
    stderr_bytes = [string]$stderrBytes
    stdout_nonempty = $stdoutNonempty
    stderr_nonempty = $stderrNonempty
    streaming_output_supported = "NO"
    last_output_utc = "UNAVAILABLE"
    last_stdout_bytes = "UNAVAILABLE"
    last_stderr_bytes = "UNAVAILABLE"
    post_timeout_output_interpretation = $stallHint
    adapter_probe_pass = $probePass
    adapter_stdout_marker_exact = $stdoutExact
    stderr_shell_leak_probe_pattern = $(if ($stderrShellLeak) { "YES" } else { "NO" })
    sentinel_present_in_command_executed = $(if ($sentinelInCmd) { "YES" } else { "NO" })
    czech_backtick_parentheses_probe_pass = $czechProbe
    wsl_locale_utf8 = "YES"
    wsl_utf8_env = "YES"
    utf8_mojibake_repaired = $utf8MojibakeRepaired
    stdout_mojibake_repaired = $stdoutMojibakeRepaired
    stderr_mojibake_repaired = $stderrMojibakeRepaired
    task_text_mojibake_repaired = $textRepairedFlag
    utf8_mojibake_detected = $utf8HardFail
    utf8_mojibake_locations = $utf8HardFailLocations
    utf8_hard_fail_reason = $utf8HardFailReason
    ready_for_product_cap50 = $(if ($utf8HardFail -eq "YES") { "NO" } else { "YES" })
    adapter_subcommand_used = "wsl_agent"
    long_task_argv_recommendation = $longTaskRec
    can_run_full_auto_loop_maxcycles_1 = $canLoop
  }

  Write-AdapterOutputFile -Path $outAbs -Meta $meta -Stdout $so -Stderr $se -ExtraBlock $extraWsl
  $wslAdapterOutputWritten = $true

  $postWriteGate = Invoke-SilverCap50Utf8SurfacesHardGate -RepoRoot $RepoRoot -NextActionPath $taskAbs -CursorOutputPath $outAbs
  if ($postWriteGate.PASS_FAIL -ne "PASS") {
    $utf8HardFail = "YES"
    $utf8HardFailLocations = [string]$postWriteGate.utf8_mojibake_locations
    if ([string]$postWriteGate.utf8_mojibake_first_sample) {
      $utf8HardFailLocations = $utf8HardFailLocations + " | sample=" + [string]$postWriteGate.utf8_mojibake_first_sample
    }
    $utf8HardFailReason = "utf8_mojibake_detected_post_write"
    $canLoop = "NO"
    $exitCode = 12
    $authoritativeExit = 12
    $meta["utf8_mojibake_detected"] = "YES"
    $meta["utf8_mojibake_locations"] = $utf8HardFailLocations
    $meta["utf8_hard_fail_reason"] = $utf8HardFailReason
    $meta["ready_for_product_cap50"] = "NO"
    $meta["can_run_full_auto_loop_maxcycles_1"] = "NO"
    $meta["adapter_authoritative_exit_code"] = "12"
    $meta["exit_code"] = "12"
    Write-AdapterOutputFile -Path $outAbs -Meta $meta -Stdout $so -Stderr $se -ExtraBlock $extraWsl
    $wslAdapterOutputWritten = $true
  }

  if (-not $wslAdapterOutputWritten) {
    if ([string]::IsNullOrWhiteSpace($processStartUtc)) {
      $processStartUtc = (Get-Date).ToUniversalTime().ToString("o")
    }
    if ([string]::IsNullOrWhiteSpace($processEndUtc)) {
      $processEndUtc = (Get-Date).ToUniversalTime().ToString("o")
    }
    $termDigest = Get-TaskUtf8Sha256HexPrefix -Text $text -HexChars 16
    $termAuto = Get-SilverAutonomousRunMetaFromEnv
    $termExit = [string]$exitCode
    if ([string]::IsNullOrWhiteSpace($termExit)) { $termExit = "255" }
    $termStdout = $so
    if ([string]::IsNullOrWhiteSpace($termStdout)) {
      $termStdout = "SILVER_WSL_ADAPTER_TERMINAL_CAPTURE adapter did not complete normal Write-AdapterOutputFile."
    }
    $termStderr = $se
    if (-not [string]::IsNullOrWhiteSpace($wslCaptureException)) {
      $termStderr = ($termStderr + "`r`nWSL_CAPTURE_EXCEPTION: " + $wslCaptureException).Trim()
    }
    $termMeta = [ordered]@{
      timestamp_local = $tsLocal
      cwd_powershell = $cwdActual
      repo_root = $RepoRoot
      autonomous_run_id = $termAuto.run_id
      autonomous_cycle = $termAuto.cycle
      autonomous_run_start_utc = $termAuto.run_start_utc
      adapter_output_state = "COMPLETED"
      pipe_capture_mode = "cmd_redirect_file"
      adapter_mode = "wsl_agent_print_ask_trust_workspace"
      adapter_completion_path = "terminal_emergency_write"
      task_digest = $termDigest
      process_start_utc = $processStartUtc
      process_end_utc = $processEndUtc
      elapsed_ms = [string]$elapsedMs
      exit_code = $termExit
      timed_out = $(if ($toFlag) { "YES" } else { "NO" })
      stdout_nonempty = $(if ($termStdout.Trim().Length -gt 0) { "YES" } else { "NO" })
      stderr_nonempty = $(if ($termStderr.Trim().Length -gt 0) { "YES" } else { "NO" })
      can_run_full_auto_loop_maxcycles_1 = "NO"
    }
    Write-AdapterOutputFile -Path $outAbs -Meta $termMeta -Stdout $termStdout -Stderr $termStderr -ExtraBlock "SILVER_WSL_ADAPTER_TERMINAL_CAPTURE"
    $wslAdapterOutputWritten = $true
  }

  if ($Probe) {
    if ($probePass -eq "YES") {
      exit 0
    }
    exit 1
  }
  exit ([int]$exitCode)
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
  Write-Host ("effective_timeout_seconds=" + [string]$script:SilverEffectiveTimeoutSeconds)
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
$processStartUtcWin = (Get-Date).ToUniversalTime().ToString("o")
$processEndUtcWin = ""
$elapsedMsWin = 0
$wallSwWin = [System.Diagnostics.Stopwatch]::StartNew()
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

  $wallSwWin.Stop()
  $processEndUtcWin = (Get-Date).ToUniversalTime().ToString("o")
  $elapsedMsWin = [int64]$wallSwWin.ElapsedMilliseconds
  $stdoutBytesWin = $SilverUtf8NoBom.GetByteCount($so)
  $stderrBytesWin = $SilverUtf8NoBom.GetByteCount($se)
  $stdoutNonemptyWin = $(if ($stdoutBytesWin -gt 0) { "YES" } else { "NO" })
  $stderrNonemptyWin = $(if ($stderrBytesWin -gt 0) { "YES" } else { "NO" })
  $taskDigestHexWin = Get-TaskUtf8Sha256HexPrefix -Text $text -HexChars 16
  $taskCharsWin = [string]$text.Length
  $taskLinesWin = [string](Get-TaskTextLineCount -Text $text)

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
  $windowsLaneReadyGate = Test-DiagnosticAdapterReady
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
    if (($probePass -eq "YES") -and $windowsLaneReadyGate) {
      $canLoop = "YES"
    }
    else {
      $canLoop = "NO"
    }
  }
  else {
    if ($windowsLaneReadyGate -and ($exitCode -eq 0) -and (-not $toFlag)) {
      $canLoop = "YES"
    }
    else {
      $canLoop = "NO"
    }
  }

  $autoRunMetaWin = Get-SilverAutonomousRunMetaFromEnv
  $meta = [ordered]@{
    timestamp_local = $tsLocal
    cwd_powershell = $cwdActual
    repo_root = $RepoRoot
    autonomous_run_id = $autoRunMetaWin.run_id
    autonomous_cycle = $autoRunMetaWin.cycle
    autonomous_run_start_utc = $autoRunMetaWin.run_start_utc
    adapter_output_state = "COMPLETED"
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
    task_chars = $taskCharsWin
    task_lines = $taskLinesWin
    task_digest = $taskDigestHexWin
    task_sha256_prefix = $taskDigestHexWin
    process_start_utc = $processStartUtcWin
    process_end_utc = $processEndUtcWin
    elapsed_ms = [string]$elapsedMsWin
    stdout_bytes = [string]$stdoutBytesWin
    stderr_bytes = [string]$stderrBytesWin
    stdout_nonempty = $stdoutNonemptyWin
    stderr_nonempty = $stderrNonemptyWin
    task_bytes_utf8 = [string]$taskLen
    timeout_seconds = [string]$TimeoutSeconds
    effective_timeout_seconds = [string]$script:SilverEffectiveTimeoutSeconds
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
  exit ([int]$exitCode)
}
finally {
  if (Test-Path -LiteralPath $taskTmp) { Remove-Item -LiteralPath $taskTmp -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $stdoutTmp) { Remove-Item -LiteralPath $stdoutTmp -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $stderrTmp) { Remove-Item -LiteralPath $stderrTmp -Force -ErrorAction SilentlyContinue }
}
