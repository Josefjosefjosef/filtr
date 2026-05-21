#requires -Version 5.1
<#
.SYNOPSIS
  Silver — diagnose Cursor CLI / `cursor agent` for FULL AUTO LOOP adapter (Windows, scripts-only), plus WSL Ubuntu `agent` non-interactive wiring (`--print --mode ask --trust --workspace`).

.NOTES
  Does not run autopilot loops. Does not pass real development tasks — only a harmless probe line.
  Writes scripts/silver-cursor-agent-adapter-diagnostic-report.json next to repo root.
  Runs a WSL Ubuntu agent pack first (existence, --version, marker stdout, git dirtiness allowlist, timeout guard), then eight `cursor agent` headless-flag variants (120s each) and stdin marker probes, recording stdout/stderr, marker, git diff.
#>
Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$ReportPath = Join-Path $RepoRoot "scripts\silver-cursor-agent-adapter-diagnostic-report.json"
$HarmlessProbe = "Print exactly: CURSOR_AGENT_STDIN_OK`r`nDo not modify files.`r`n"
$ProbeOneLine = "Print exactly: CURSOR_AGENT_STDIN_OK. Do not modify files."
$Marker = "CURSOR_AGENT_STDIN_OK"
$HeadlessProbeMs = 120000
$MaxStreamCharsInJson = 65536
$SilverUtf8HandoffPath = Join-Path $PSScriptRoot "silver-utf8-handoff.ps1"
if (Test-Path -LiteralPath $SilverUtf8HandoffPath) {
  . $SilverUtf8HandoffPath
  Initialize-SilverConsoleUtf8
}

function Invoke-ExternalCapture {
  param(
    [string]$FileName,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [int]$TimeoutMs = 120000
  )
  $outF = Join-Path $env:TEMP ("scdiag-o-" + [guid]::NewGuid().ToString() + ".txt")
  $errF = Join-Path $env:TEMP ("scdiag-e-" + [guid]::NewGuid().ToString() + ".txt")
  $pathEsc = $FileName.Replace('"', '""')
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
  $psi.Arguments = '/c ' + $inner + ' 1> "' + $outF + '" 2> "' + $errF + '"'
  $psi.WorkingDirectory = $WorkingDirectory
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
      return @{ exit = $code; timedOut = $timedOut; stdout = $so; stderr = $se }
    }
    $code = $p.ExitCode
    if (Test-Path -LiteralPath $outF) { $so = [System.IO.File]::ReadAllText($outF) }
    if (Test-Path -LiteralPath $errF) { $se = [System.IO.File]::ReadAllText($errF) }
    return @{ exit = $code; timedOut = $timedOut; stdout = $so; stderr = $se }
  }
  finally {
    if (Test-Path -LiteralPath $outF) { Remove-Item -LiteralPath $outF -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $errF) { Remove-Item -LiteralPath $errF -Force -ErrorAction SilentlyContinue }
  }
}

function Invoke-ExternalWithStdin {
  param(
    [string]$FileName,
    [string[]]$Arguments,
    [string]$StdinText,
    [string]$WorkingDirectory,
    [int]$TimeoutMs
  )
  $outF = Join-Path $env:TEMP ("scdiag-o-" + [guid]::NewGuid().ToString() + ".txt")
  $errF = Join-Path $env:TEMP ("scdiag-e-" + [guid]::NewGuid().ToString() + ".txt")
  $inF = Join-Path $env:TEMP ("scdiag-i-" + [guid]::NewGuid().ToString() + ".txt")
  [System.IO.File]::WriteAllText($inF, ($StdinText + "`r`n"), (New-Object System.Text.UTF8Encoding $false))
  $quotedExe = '"' + $FileName.Replace('"', '""') + '"'
  $argParts = @()
  foreach ($a in $Arguments) {
    if ($a -match '\s') {
      $argParts += ('"' + $a.Replace('"', '""') + '"')
    }
    else {
      $argParts += $a
    }
  }
  $tail = ""
  if ($argParts.Count -gt 0) {
    $tail = " " + ($argParts -join " ")
  }
  $inner = 'type "' + $inF.Replace('"', '""') + '" | ' + $quotedExe + $tail
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "cmd.exe"
  $psi.Arguments = '/c ' + $inner + ' 1> "' + $outF + '" 2> "' + $errF + '"'
  $psi.WorkingDirectory = $WorkingDirectory
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
      return @{ exit = $code; timedOut = $timedOut; stdout = $so; stderr = $se }
    }
    $code = $p.ExitCode
    if (Test-Path -LiteralPath $outF) { $so = [System.IO.File]::ReadAllText($outF) }
    if (Test-Path -LiteralPath $errF) { $se = [System.IO.File]::ReadAllText($errF) }
    return @{ exit = $code; timedOut = $timedOut; stdout = $so; stderr = $se }
  }
  finally {
    if (Test-Path -LiteralPath $inF) { Remove-Item -LiteralPath $inF -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $outF) { Remove-Item -LiteralPath $outF -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $errF) { Remove-Item -LiteralPath $errF -Force -ErrorAction SilentlyContinue }
  }
}

function Test-HelpFlagMention {
  param([string]$Haystack, [string]$FlagToken)
  if ([string]::IsNullOrEmpty($Haystack)) { return $false }
  return $Haystack.Contains($FlagToken)
}

function Get-WhereCursorLines {
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
  return @{ exit = $p.ExitCode; text = $o }
}

function Get-WhereCursorAgentLines {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "where.exe"
  $psi.Arguments = "cursor-agent"
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $o = $p.StandardOutput.ReadToEnd()
  $null = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  return @{ exit = $p.ExitCode; text = $o }
}

function Get-GitDiffSnapshot {
  param([string]$Root)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "git.exe"
  $psi.Arguments = "diff --no-ext-diff"
  $psi.WorkingDirectory = $Root
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $o = $p.StandardOutput.ReadToEnd()
  $null = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  return $o
}

function Restore-GitWorktreeDiff {
  param([string]$Root)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "git.exe"
  $psi.Arguments = "diff --name-only"
  $psi.WorkingDirectory = $Root
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $names = $p.StandardOutput.ReadToEnd()
  $null = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  foreach ($line in ($names -split "`r?`n")) {
    $t = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($t)) { continue }
    $psi2 = New-Object System.Diagnostics.ProcessStartInfo
    $psi2.FileName = "git.exe"
    $psi2.Arguments = "restore --worktree -- " + $t
    $psi2.WorkingDirectory = $Root
    $psi2.RedirectStandardOutput = $true
    $psi2.RedirectStandardError = $true
    $psi2.UseShellExecute = $false
    $psi2.CreateNoWindow = $true
    $p2 = [System.Diagnostics.Process]::Start($psi2)
    $null = $p2.StandardOutput.ReadToEnd()
    $null = $p2.StandardError.ReadToEnd()
    $p2.WaitForExit()
  }
}

function Truncate-ForJson {
  param([string]$S, [int]$Max)
  if ($null -eq $S) { return @{ text = ""; truncated = $false } }
  if ($S.Length -le $Max) { return @{ text = $S; truncated = $false } }
  return @{ text = $S.Substring(0, $Max); truncated = $true }
}

function Test-RequiresInteractionHeuristic {
  param([string]$Combined, [bool]$TimedOut)
  if ($TimedOut) { return "YES" }
  if ([string]::IsNullOrWhiteSpace($Combined)) { return "UNKNOWN" }
  $lower = $Combined.ToLowerInvariant()
  $patterns = @(
    "password:", "sign in", "authentication", "open your browser",
    "press any key", "waiting for", "log in", "login to"
  )
  foreach ($pat in $patterns) {
    if ($lower.Contains($pat)) { return "YES" }
  }
  return "NO"
}

function Invoke-WslDiagCapture {
  param(
    [string]$Distro,
    [string[]]$LinuxArgvAfterDoubleDash,
    [string]$WorkDirWindows,
    [int]$TimeoutMs
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
  $prevWslUtf8 = ""
  if (Get-Command Set-SilverWslUtf8ProcessEnvironment -ErrorAction SilentlyContinue) {
    $prevWslUtf8 = Set-SilverWslUtf8ProcessEnvironment
  }
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
    if (Get-Command Read-ProcessPipeUtf8 -ErrorAction SilentlyContinue) {
      $so = Read-ProcessPipeUtf8 -Reader $p.StandardOutput
      $se = Read-ProcessPipeUtf8 -Reader $p.StandardError
    }
    else {
      $so = $p.StandardOutput.ReadToEnd()
      $se = $p.StandardError.ReadToEnd()
    }
  }
  catch {
    $se = "WSL_DIAG_EXCEPTION: " + $_.Exception.Message
    $code = 255
  }
  finally {
    if (Get-Command Restore-SilverWslUtf8ProcessEnvironment -ErrorAction SilentlyContinue) {
      Restore-SilverWslUtf8ProcessEnvironment -PreviousValue $prevWslUtf8
    }
    try { $p.Dispose() } catch { }
  }
  if ([string]::IsNullOrEmpty($so)) { $so = "" }
  if ([string]::IsNullOrEmpty($se)) { $se = "" }
  if (Get-Command Repair-SilverUtf8HandoffText -ErrorAction SilentlyContinue) {
    $repSo = "NO"
    $repSe = "NO"
    $so = Repair-SilverUtf8HandoffText -Text $so -Repaired ([ref]$repSo)
    $se = Repair-SilverUtf8HandoffText -Text $se -Repaired ([ref]$repSe)
  }
  return @{ exit = $code; timedOut = $timedOut; stdout = $so; stderr = $se }
}

function Get-GitStatusShortText {
  param([string]$Root)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "git.exe"
  $psi.Arguments = "status --short"
  $psi.WorkingDirectory = $Root
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $o = $p.StandardOutput.ReadToEnd()
  $null = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  return $o
}

function Test-WslStdoutMarkerExact {
  param([string]$Stdout, [string]$MarkerText)
  if ($null -eq $Stdout) { return "NO" }
  $t = $Stdout.Trim()
  if ($t -eq $MarkerText) { return "YES" }
  $norm = ($t -replace "`r`n", "`n").Trim()
  $lines = $norm -split "`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() }
  if ($lines.Count -eq 1 -and $lines[0] -eq $MarkerText) { return "YES" }
  return "NO"
}

function Test-GitStatusAllowedOnly {
  param([string]$StatusText)
  $allowedExact = New-Object "System.Collections.Generic.HashSet[string]"
  [void]$allowedExact.Add("scripts/silver-cursor-agent-adapter.ps1")
  [void]$allowedExact.Add("scripts/silver-cursor-agent-adapter-diagnostic.ps1")
  [void]$allowedExact.Add("scripts/silver-cursor-agent-adapter-diagnostic-report.json")
  [void]$allowedExact.Add("SILVER_AUTOPILOT_README.md")
  [void]$allowedExact.Add("SILVER_NEXT_ACTION.md")
  [void]$allowedExact.Add("SILVER_RUN_REPORT.md")
  [void]$allowedExact.Add("SILVER_PROGRESS_LOG.md")
  [void]$allowedExact.Add("SILVER_STRATEGY.md")
  $bad = New-Object System.Collections.Generic.List[string]
  foreach ($line in ($StatusText -split "`r?`n")) {
    $t = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($t)) { continue }
    # Porcelain: two status columns (index + worktree), then whitespace, then path.
    # Do not use Substring(3): for lines like "M path" the path begins at index 2.
    if ($t.Length -lt 3) { continue }
    $pathPart = $t.Substring(2).TrimStart()
    if ([string]::IsNullOrWhiteSpace($pathPart)) { continue }
    if ($allowedExact.Contains($pathPart)) { continue }
    if ($pathPart.StartsWith("scripts/")) { continue }
    if ($pathPart -match '^SILVER_.+\.md$') { continue }
    [void]$bad.Add($pathPart)
  }
  return $bad.ToArray()
}

function Invoke-WslPrintAskTrustProbePack {
  param(
    [string]$RepoRoot,
    [string]$Distro,
    [string]$AgentPath,
    [string]$WorkspacePath,
    [string]$ProbeOneLine,
    [string]$Marker,
    [int]$TimeoutMs
  )
  $pack = [ordered]@{
    adapter_mode = "wsl_agent_print_ask_trust_workspace"
    wsl_distro = $Distro
    agent_path = $AgentPath
    workspace = $WorkspacePath
    agent_exists_executable = "NO"
    agent_exists_exit_code = $null
    agent_version = ""
    agent_version_exit_code = $null
    workspace_mount_ok = "NO"
    workspace_check_exit_code = $null
    marker_probe_exit_code = $null
    marker_probe_timed_out = "NO"
    marker_probe_stdout_contains_marker = "NO"
    marker_probe_stdout_marker_exact = "NO"
    marker_probe_requires_interaction = "UNKNOWN"
    marker_probe_modifies_tracked_files = "NO"
    marker_probe_stdout_sample = ""
    marker_probe_stderr_sample = ""
    timeout_guard_ms = $TimeoutMs
    timeout_guard = "NO"
    repo_git_status_after_probe = ""
    repo_dirty_unexpected_paths = @()
    repo_dirty_unexpected = "YES"
    adapter_ready = "NO"
    safe_for_maxcycles_1 = "NO"
    safe_for_maxcycles_0 = "NO"
    recommended_wsl_adapter_probe = ""
  }
  $pack.recommended_wsl_adapter_probe = 'powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -WslUbuntuAgent -Probe -OutputFile SILVER_CURSOR_OUTPUT.md -TimeoutSeconds 120'

  $ex = Invoke-WslDiagCapture -Distro $Distro -LinuxArgvAfterDoubleDash @("test", "-x", $AgentPath) -WorkDirWindows $RepoRoot -TimeoutMs 30000
  $pack.agent_exists_exit_code = $ex.exit
  if ($ex.exit -eq 0) {
    $pack.agent_exists_executable = "YES"
  }

  $ws = Invoke-WslDiagCapture -Distro $Distro -LinuxArgvAfterDoubleDash @("test", "-d", $WorkspacePath) -WorkDirWindows $RepoRoot -TimeoutMs 30000
  $pack.workspace_check_exit_code = $ws.exit
  if ($ws.exit -eq 0) {
    $pack.workspace_mount_ok = "YES"
  }

  $ver = Invoke-WslDiagCapture -Distro $Distro -LinuxArgvAfterDoubleDash @($AgentPath, "--version") -WorkDirWindows $RepoRoot -TimeoutMs 60000
  $pack.agent_version_exit_code = $ver.exit
  $pack.agent_version = ($ver.stdout + $ver.stderr).Trim()

  $diffBefore = Get-GitDiffSnapshot -Root $RepoRoot
  $statusBefore = (Get-GitStatusShortText -Root $RepoRoot).TrimEnd()

  $linuxFull = @(
    $AgentPath,
    "--print",
    "--mode", "ask",
    "--trust",
    "--workspace", $WorkspacePath,
    $ProbeOneLine
  )
  $pr = Invoke-WslDiagCapture -Distro $Distro -LinuxArgvAfterDoubleDash $linuxFull -WorkDirWindows $RepoRoot -TimeoutMs $TimeoutMs
  $pack.marker_probe_exit_code = $pr.exit
  if ($pr.timedOut) {
    $pack.marker_probe_timed_out = "YES"
  }
  $so = $pr.stdout
  if ($null -eq $so) { $so = "" }
  $se = $pr.stderr
  if ($null -eq $se) { $se = "" }
  $combined = $so + "`n" + $se
  if ($so.Contains($Marker)) {
    $pack.marker_probe_stdout_contains_marker = "YES"
  }
  $pack.marker_probe_stdout_marker_exact = (Test-WslStdoutMarkerExact -Stdout $so -MarkerText $Marker)
  $pack.marker_probe_requires_interaction = (Test-RequiresInteractionHeuristic -Combined $combined -TimedOut $pr.timedOut)
  $soT = Truncate-ForJson -S $so -Max $MaxStreamCharsInJson
  $seT = Truncate-ForJson -S $se -Max 8192
  $pack.marker_probe_stdout_sample = $soT.text
  $pack.marker_probe_stderr_sample = $seT.text

  $diffAfter = Get-GitDiffSnapshot -Root $RepoRoot
  if ($diffBefore -ne $diffAfter) {
    $pack.marker_probe_modifies_tracked_files = "YES"
    Restore-GitWorktreeDiff -Root $RepoRoot
  }

  $statusAfter = (Get-GitStatusShortText -Root $RepoRoot).TrimEnd()
  $pack.repo_git_status_after_probe = $statusAfter
  $unexpected = Test-GitStatusAllowedOnly -StatusText $statusAfter
  $pack.repo_dirty_unexpected_paths = @($unexpected)
  if (@($unexpected).Count -eq 0) {
    $pack.repo_dirty_unexpected = "NO"
  }

  $ok = $true
  if ($pack.agent_exists_executable -ne "YES") { $ok = $false }
  if ($pack.workspace_mount_ok -ne "YES") { $ok = $false }
  if ($pack.marker_probe_stdout_contains_marker -ne "YES") { $ok = $false }
  if ($pack.marker_probe_stdout_marker_exact -ne "YES") { $ok = $false }
  if ($pack.marker_probe_exit_code -ne 0) { $ok = $false }
  if ($pr.timedOut) { $ok = $false }
  if ($pack.marker_probe_modifies_tracked_files -eq "YES") { $ok = $false }
  if ($pack.marker_probe_requires_interaction -eq "YES") { $ok = $false }
  if ($pack.repo_dirty_unexpected -ne "NO") { $ok = $false }

  if ($ok) {
    $pack.adapter_ready = "YES"
    $pack.safe_for_maxcycles_1 = "YES"
  }
  else {
    $pack.adapter_ready = "NO"
    $pack.safe_for_maxcycles_1 = "NO"
  }
  $pack.safe_for_maxcycles_0 = "NO"

  $pack["marker_probe_pass"] = if ($pack.marker_probe_stdout_contains_marker -eq "YES") { "YES" } else { "NO" }
  $pack["exit_code_zero"] = if (($null -ne $pack.marker_probe_exit_code) -and ($pack.marker_probe_exit_code -eq 0)) { "YES" } else { "NO" }
  $pack["timeout_guard"] = if ($pack.marker_probe_timed_out -eq "NO") { "YES" } else { "NO" }

  return $pack
}

$report = [ordered]@{
  schema = "silver-cursor-agent-adapter-diagnostic-v2"
  timestamp_utc = (Get-Date).ToUniversalTime().ToString("o")
  repo_root = $RepoRoot
  cursor_where_exit = $null
  cursor_where_text = ""
  cursor_exe_path = ""
  cursor_cli_found = "NO"
  cursor_agent_where_exit = $null
  cursor_agent_where_text = ""
  cursor_agent_standalone_available = "NO"
  legacy_agent_bridge_available = "NO"
  cursor3_detected = "NO"
  cursor_agent_subcommand_documented = "NO"
  cursor_version = ""
  cursor_version_exit = $null
  cursor_help_exit = $null
  cursor_help_bytes = 0
  cursor_agent_argv_help_exit = $null
  cursor_agent_argv_help_stdout_sample = ""
  cursor_agent_help_exit = $null
  cursor_agent_help_stdout_sample = ""
  cursor_help_subcommand_agent_exit = $null
  cursor_help_subcommand_agent_stdout_sample = ""
  cursor_agent_supports_input_output = "NO"
  flag_mentions = [ordered]@{}
  main_help_pipe_dash_mentioned = "NO"
  safe_probe = [ordered]@{}
  headless_probe_timeout_ms = $HeadlessProbeMs
  headless_probe_variants = @()
  tested_headless_variant_count = 8
  tested_stdin_marker_variant_count = 5
  tested_variant_count_total = 13
  preferred_headless_variant_id = $null
  preferred_headless_argv = $null
  preferred_headless_command = ""
  preferred_output_format = ""
  preferred_exit = $null
  preferred_contains_marker = "NO"
  preferred_timeout = "NO"
  preferred_invocation_kind = ""
  preferred_stdin_argv = $null
  stdin_marker_probe_variants = @()
  supports_print_flag = "NO"
  supports_dash_p_flag = "NO"
  supports_yolo_flag = "NO"
  supports_yes_flag = "NO"
  supports_output_format_text = "NO"
  supports_output_format_json = "NO"
  adapter_ready = "NO"
  adapter_ready_reason = ""
  recommended_cursor_command = ""
  recommended_cursor_command_full_loop = ""
  diagnostic_exit = 0
}

$WslDistroProbe = "Ubuntu"
$WslAgentProbePath = "/home/spedk/.local/bin/agent"
$WslWorkspaceProbePath = "/mnt/c/projects/filtr"
$wslPrintAskTrustPack = Invoke-WslPrintAskTrustProbePack -RepoRoot $RepoRoot -Distro $WslDistroProbe -AgentPath $WslAgentProbePath -WorkspacePath $WslWorkspaceProbePath -ProbeOneLine $ProbeOneLine -Marker $Marker -TimeoutMs $HeadlessProbeMs
$report["wsl_cursor_agent_print_ask_trust"] = $wslPrintAskTrustPack
if ($wslPrintAskTrustPack.adapter_ready -ne "YES") {
  $report.diagnostic_exit = 1
}

$w = Get-WhereCursorLines
$report.cursor_where_exit = $w.exit
$report.cursor_where_text = ($w.text.TrimEnd())

if ($w.exit -eq 0 -and -not [string]::IsNullOrWhiteSpace($w.text)) {
  $report.cursor_cli_found = "YES"
}

$cursorExe = "cursor"
if ($w.exit -eq 0) {
  $lines = $w.text -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() }
  $picked = $null
  foreach ($ln in $lines) {
    if ($ln.EndsWith("cursor.cmd", [System.StringComparison]::OrdinalIgnoreCase)) {
      $picked = $ln
      break
    }
  }
  if ($null -eq $picked) {
    foreach ($ln in $lines) {
      if ($ln -match '(?i)[\\/]resources[\\/]app[\\/]bin[\\/]cursor$') {
        $picked = $ln
        break
      }
    }
  }
  if ($null -eq $picked) {
    foreach ($ln in $lines) {
      if ($ln.EndsWith(".exe", [System.StringComparison]::OrdinalIgnoreCase)) {
        $picked = $ln
        break
      }
    }
  }
  if ($null -ne $picked) {
    $cursorExe = $picked
  }
}
$report["cursor_exe_path"] = $cursorExe

$cv = Invoke-ExternalCapture -FileName $cursorExe -Arguments @("--version") -WorkingDirectory $RepoRoot -TimeoutMs 60000
$report.cursor_version_exit = $cv.exit
$report.cursor_version = ($cv.stdout + $cv.stderr).Trim()

$caWhere = Get-WhereCursorAgentLines
$report.cursor_agent_where_exit = $caWhere.exit
$report.cursor_agent_where_text = ($caWhere.text.TrimEnd())
$report.cursor_agent_standalone_available = if ($caWhere.exit -eq 0 -and -not [string]::IsNullOrWhiteSpace($caWhere.text)) { "YES" } else { "NO" }
$report.legacy_agent_bridge_available = $report.cursor_agent_standalone_available
$verFirstLine = ($report.cursor_version -split "`r?`n" | Select-Object -First 1).Trim()
if ($verFirstLine -match '^Cursor\s+3\b' -or $verFirstLine -match '^3\.\d+') {
  $report.cursor3_detected = "YES"
}
else {
  $report.cursor3_detected = "NO"
}
$diagMajor = ""
if ($report.cursor3_detected -eq "YES") {
  if ($verFirstLine -match '^Cursor\s+(\d+)') {
    $diagMajor = $Matches[1]
  }
  else {
    $diagMajor = "3"
  }
}
elseif ($verFirstLine -match '^Cursor\s+(\d+)') {
  $diagMajor = $Matches[1]
}
elseif ($verFirstLine -match '^(\d+)\.') {
  $diagMajor = $Matches[1]
}
$report["diagnostic_cursor_major"] = $diagMajor

$h = Invoke-ExternalCapture -FileName $cursorExe -Arguments @("--help") -WorkingDirectory $RepoRoot -TimeoutMs 60000
$report.cursor_help_exit = $h.exit
$helpMain = $h.stdout + "`n" + $h.stderr
if ($null -eq $helpMain) { $helpMain = "" }
$report.cursor_help_bytes = [System.Text.Encoding]::UTF8.GetByteCount($helpMain)

if ($helpMain.Contains("append '-'") -or $helpMain.Contains("cursor.exe -") -or $helpMain.Contains("| cursor")) {
  $report.main_help_pipe_dash_mentioned = "YES"
}
if ($helpMain -match 'agent\s+Start the Cursor agent') {
  $report.cursor_agent_subcommand_documented = "YES"
}

$ah = Invoke-ExternalCapture -FileName $cursorExe -Arguments @("agent", "--help") -WorkingDirectory $RepoRoot -TimeoutMs 60000
$report.cursor_agent_argv_help_exit = $ah.exit
$report.cursor_agent_help_exit = $ah.exit
$samp = ($ah.stdout + $ah.stderr)
if ($samp.Length -gt 2000) { $samp = $samp.Substring(0, 2000) }
$report.cursor_agent_argv_help_stdout_sample = $samp
$report.cursor_agent_help_stdout_sample = $samp

$ah2 = Invoke-ExternalCapture -FileName $cursorExe -Arguments @("help", "agent") -WorkingDirectory $RepoRoot -TimeoutMs 60000
$report.cursor_help_subcommand_agent_exit = $ah2.exit
$samp2 = ($ah2.stdout + $ah2.stderr)
if ($samp2.Length -gt 2000) { $samp2 = $samp2.Substring(0, 2000) }
$report.cursor_help_subcommand_agent_stdout_sample = $samp2

$combinedHelp = $helpMain + "`n" + ($ah.stdout + $ah.stderr) + "`n" + ($ah2.stdout + $ah2.stderr)
$flags = @(
  "-p", "--print", "--prompt", "--input", "--output", "--headless",
  "--non-interactive", "--yes", "--yolo", "--output-format", "--cwd", "--workspace"
)
$report.flag_mentions = [ordered]@{}
foreach ($f in $flags) {
  $key = $f.TrimStart("-").Replace("-", "_")
  if (Test-HelpFlagMention -Haystack $combinedHelp -FlagToken $f) {
    $report.flag_mentions[$key] = "YES"
  }
  else {
    $report.flag_mentions[$key] = "NO"
  }
}

$ioYes = ((Test-HelpFlagMention -Haystack $combinedHelp -FlagToken "--input") -and (Test-HelpFlagMention -Haystack $combinedHelp -FlagToken "--output"))
if ($ioYes) { $report.cursor_agent_supports_input_output = "YES" }

$probeMs = 5000
$report.safe_probe = [ordered]@{}

$pa = Invoke-ExternalWithStdin -FileName $cursorExe -Arguments @("agent") -StdinText $HarmlessProbe -WorkingDirectory $RepoRoot -TimeoutMs $probeMs
$report.safe_probe["cursor_agent_stdin_5s"] = [ordered]@{
  exit = $pa.exit; timedOut = $pa.timedOut; stdout_len = ($pa.stdout).Length; stderr_len = ($pa.stderr).Length
}

$pc = Invoke-ExternalCapture -FileName $cursorExe -Arguments @("--chat", "--help") -WorkingDirectory $RepoRoot -TimeoutMs 60000
$report.safe_probe["cursor_chat_help"] = [ordered]@{ exit = $pc.exit; timedOut = $pc.timedOut }

$pd = Invoke-ExternalWithStdin -FileName $cursorExe -Arguments @("-") -StdinText $HarmlessProbe -WorkingDirectory $RepoRoot -TimeoutMs $probeMs
$report.safe_probe["cursor_dash_stdin_5s"] = [ordered]@{
  exit = $pd.exit; timedOut = $pd.timedOut; stdout_len = ($pd.stdout).Length; stderr_len = ($pd.stderr).Length
}

$interactiveAgent = [bool]$pa.timedOut
$totalAgentOut = ($pa.stdout).Length + ($pa.stderr).Length

$report.cursor_agent_supports_stdin = "UNKNOWN"
if ($pa.timedOut) { $report.cursor_agent_supports_stdin = "NO" }
elseif ($totalAgentOut -gt 0) { $report.cursor_agent_supports_stdin = "YES" }
else { $report.cursor_agent_supports_stdin = "UNKNOWN" }

$headlessMention = (Test-HelpFlagMention -Haystack $combinedHelp -FlagToken "--headless")
$report.cursor_agent_supports_headless = if ($headlessMention) { "YES" } else { "NO" }

$report.cursor_agent_interactive_only = if ($interactiveAgent) { "YES" } else { "NO" }

$variantDefs = @(
  @{ id = 1; label = "agent -p"; args = @("agent", "-p", $ProbeOneLine) }
  @{ id = 2; label = "agent --print"; args = @("agent", "--print", $ProbeOneLine) }
  @{ id = 3; label = "agent --output-format text -p"; args = @("agent", "--output-format", "text", "-p", $ProbeOneLine) }
  @{ id = 4; label = "agent --output-format json -p"; args = @("agent", "--output-format", "json", "-p", $ProbeOneLine) }
  @{ id = 5; label = "agent --yolo --output-format text -p"; args = @("agent", "--yolo", "--output-format", "text", "-p", $ProbeOneLine) }
  @{ id = 6; label = "agent --yes --output-format text -p"; args = @("agent", "--yes", "--output-format", "text", "-p", $ProbeOneLine) }
  @{ id = 7; label = "agent --yolo --output-format json -p"; args = @("agent", "--yolo", "--output-format", "json", "-p", $ProbeOneLine) }
  @{ id = 8; label = "agent --yes --output-format json -p"; args = @("agent", "--yes", "--output-format", "json", "-p", $ProbeOneLine) }
)

$variantResults = New-Object System.Collections.ArrayList
$preferredArgs = $null
$preferredId = $null
$preferredLabel = ""

foreach ($vd in $variantDefs) {
  $diffBefore = Get-GitDiffSnapshot -Root $RepoRoot
  $r = Invoke-ExternalCapture -FileName $cursorExe -Arguments $vd.args -WorkingDirectory $RepoRoot -TimeoutMs $HeadlessProbeMs
  $diffAfter = Get-GitDiffSnapshot -Root $RepoRoot
  $combined = ($r.stdout + "`n" + $r.stderr)
  $markerStdout = $false
  if ($null -ne $r.stdout) { $markerStdout = $r.stdout.Contains($Marker) }
  $markerCombined = $combined.Contains($Marker)
  $modifies = "NO"
  if ($diffBefore -ne $diffAfter) {
    $modifies = "YES"
    Restore-GitWorktreeDiff -Root $RepoRoot
  }
  $req = Test-RequiresInteractionHeuristic -Combined $combined -TimedOut $r.timedOut
  $to = if ($r.timedOut) { "YES" } else { "NO" }
  $soT = Truncate-ForJson -S $r.stdout -Max $MaxStreamCharsInJson
  $seT = Truncate-ForJson -S $r.stderr -Max $MaxStreamCharsInJson
  $entry = [ordered]@{
    variant_id = $vd.id
    variant_label = $vd.label
    argv = $vd.args
    exit_code = $r.exit
    timed_out = $to
    timeout_ms = $HeadlessProbeMs
    stdout = $soT.text
    stdout_truncated = if ($soT.truncated) { "YES" } else { "NO" }
    stderr = $seT.text
    stderr_truncated = if ($seT.truncated) { "YES" } else { "NO" }
    contains_marker_stdout = if ($markerStdout) { "YES" } else { "NO" }
    contains_marker_combined = if ($markerCombined) { "YES" } else { "NO" }
    requires_interaction = $req
    modifies_files = $modifies
  }
  [void]$variantResults.Add($entry)

  $win = (-not $r.timedOut) -and ($r.exit -eq 0) -and $markerStdout
  if ($win -and ($null -eq $preferredArgs)) {
    $preferredArgs = @()
    foreach ($a in $vd.args) { $preferredArgs += [string]$a }
    $preferredId = $vd.id
    $preferredLabel = $vd.label
  }
}

$stdinProbeDefs = @(
  @{ id = "S0"; label = "stdin_pipe - (cli stdin)"; args = @("-") }
  @{ id = "S1"; label = "stdin_pipe agent"; args = @("agent") }
  @{ id = "S2"; label = "stdin_pipe agent --output-format text"; args = @("agent", "--output-format", "text") }
  @{ id = "S3"; label = "stdin_pipe agent --yolo --output-format text"; args = @("agent", "--yolo", "--output-format", "text") }
  @{ id = "S4"; label = "stdin_pipe agent --yes --output-format text"; args = @("agent", "--yes", "--output-format", "text") }
)
$stdinResults = New-Object System.Collections.ArrayList
$preferredStdinArgs = $null
$preferredStdinRowId = ""

foreach ($sd in $stdinProbeDefs) {
  $diffBefore = Get-GitDiffSnapshot -Root $RepoRoot
  $r = Invoke-ExternalWithStdin -FileName $cursorExe -Arguments $sd.args -StdinText $HarmlessProbe -WorkingDirectory $RepoRoot -TimeoutMs $HeadlessProbeMs
  $diffAfter = Get-GitDiffSnapshot -Root $RepoRoot
  $combined = ($r.stdout + "`n" + $r.stderr)
  $markerStdout = $false
  if ($null -ne $r.stdout) { $markerStdout = $r.stdout.Contains($Marker) }
  $markerCombined = $combined.Contains($Marker)
  $modifies = "NO"
  if ($diffBefore -ne $diffAfter) {
    $modifies = "YES"
    Restore-GitWorktreeDiff -Root $RepoRoot
  }
  $req = Test-RequiresInteractionHeuristic -Combined $combined -TimedOut $r.timedOut
  $to = if ($r.timedOut) { "YES" } else { "NO" }
  $soT = Truncate-ForJson -S $r.stdout -Max $MaxStreamCharsInJson
  $seT = Truncate-ForJson -S $r.stderr -Max $MaxStreamCharsInJson
  $sEntry = [ordered]@{
    variant_id = $sd.id
    variant_label = $sd.label
    argv = $sd.args
    exit_code = $r.exit
    timed_out = $to
    timeout_ms = $HeadlessProbeMs
    stdout = $soT.text
    stdout_truncated = if ($soT.truncated) { "YES" } else { "NO" }
    stderr = $seT.text
    stderr_truncated = if ($seT.truncated) { "YES" } else { "NO" }
    contains_marker_stdout = if ($markerStdout) { "YES" } else { "NO" }
    contains_marker_combined = if ($markerCombined) { "YES" } else { "NO" }
    requires_interaction = $req
    modifies_files = $modifies
  }
  [void]$stdinResults.Add($sEntry)
  $winS = (-not $r.timedOut) -and ($r.exit -eq 0) -and $markerStdout
  if ($winS -and ($null -eq $preferredStdinArgs)) {
    $preferredStdinArgs = @()
    foreach ($a in $sd.args) { $preferredStdinArgs += [string]$a }
    $preferredStdinRowId = [string]$sd.id
  }
}

$report.headless_probe_variants = $variantResults.ToArray()
$report.stdin_marker_probe_variants = $stdinResults.ToArray()

if ($null -ne $preferredArgs) {
  $report.preferred_invocation_kind = "headless_argv"
  $report.preferred_headless_variant_id = $preferredId
  $report.preferred_headless_argv = $preferredArgs
  $report.preferred_headless_command = ($cursorExe + " " + ($preferredArgs -join " "))
  $report.preferred_contains_marker = "YES"
  $report.preferred_exit = 0
  $report.preferred_timeout = "NO"
  $paStr = $preferredArgs -join " "
  if ($paStr.Contains("--output-format json")) { $report.preferred_output_format = "json" }
  elseif ($paStr.Contains("--output-format text")) { $report.preferred_output_format = "text" }
  else { $report.preferred_output_format = "" }
}
elseif ($null -ne $preferredStdinArgs) {
  $report.preferred_invocation_kind = "stdin_pipe"
  $report.preferred_headless_variant_id = $preferredStdinRowId
  $report.preferred_stdin_argv = $preferredStdinArgs
  $report.preferred_headless_argv = $null
  $report.preferred_headless_command = ('type "<TASKFILE>" | "' + $cursorExe + '" ' + ($preferredStdinArgs -join " "))
  $report.preferred_contains_marker = "YES"
  $report.preferred_exit = 0
  $report.preferred_timeout = "NO"
  $paStr = $preferredStdinArgs -join " "
  if ($paStr.Contains("--output-format json")) { $report.preferred_output_format = "json" }
  elseif ($paStr.Contains("--output-format text")) { $report.preferred_output_format = "text" }
  else { $report.preferred_output_format = "" }
}

function Variant-Passed {
  param($List, [int]$Id)
  foreach ($x in $List) {
    $vid = [int]$x['variant_id']
    if ($vid -ne $Id) { continue }
    return (($x['exit_code'] -eq 0) -and ($x['timed_out'] -eq "NO") -and ($x['contains_marker_stdout'] -eq "YES"))
  }
  return $false
}

if (Variant-Passed -List $variantResults -Id 1) { $report.supports_dash_p_flag = "YES" }
if (Variant-Passed -List $variantResults -Id 2) { $report.supports_print_flag = "YES" }
if ((Variant-Passed -List $variantResults -Id 5) -or (Variant-Passed -List $variantResults -Id 7)) { $report.supports_yolo_flag = "YES" }
if ((Variant-Passed -List $variantResults -Id 6) -or (Variant-Passed -List $variantResults -Id 8)) { $report.supports_yes_flag = "YES" }
if ((Variant-Passed -List $variantResults -Id 3) -or (Variant-Passed -List $variantResults -Id 5) -or (Variant-Passed -List $variantResults -Id 6)) {
  $report.supports_output_format_text = "YES"
}
if ((Variant-Passed -List $variantResults -Id 4) -or (Variant-Passed -List $variantResults -Id 7) -or (Variant-Passed -List $variantResults -Id 8)) {
  $report.supports_output_format_json = "YES"
}

foreach ($row in $stdinResults) {
  if (($row['exit_code'] -ne 0) -or ($row['timed_out'] -ne "NO") -or ($row['contains_marker_stdout'] -ne "YES")) { continue }
  $aj = ""
  foreach ($p in $row['argv']) {
    $aj = $aj + " " + [string]$p
  }
  $aj = $aj.Trim()
  if ($aj.Contains("--yolo")) { $report.supports_yolo_flag = "YES" }
  if ($aj.Contains("--yes")) { $report.supports_yes_flag = "YES" }
  if ($aj.Contains("--output-format text")) { $report.supports_output_format_text = "YES" }
  if ($aj.Contains("--output-format json")) { $report.supports_output_format_json = "YES" }
}

$headlessChannelOk = ($null -ne $preferredArgs)
$stdinChannelOk = ($null -ne $preferredStdinArgs)
$adapterOkWinCursor = $false
$adapterOk = $false
if ($report.cursor_agent_supports_input_output -eq "YES") {
  $adapterOk = $true
  $adapterOkWinCursor = $true
  $report.adapter_ready_reason = "help_lists_input_output"
}
elseif ($headlessChannelOk) {
  $adapterOk = $true
  $adapterOkWinCursor = $true
  $report.adapter_ready_reason = "headless_probe_marker_exit0_stdout"
}
elseif ($stdinChannelOk) {
  $adapterOk = $true
  $adapterOkWinCursor = $true
  $report.adapter_ready_reason = "stdin_pipe_marker_exit0_stdout"
}
elseif (($null -ne $wslPrintAskTrustPack) -and ($wslPrintAskTrustPack.adapter_ready -eq "YES")) {
  # Same strict gates already enforced in Invoke-WslPrintAskTrustProbePack (marker, exit 0,
  # timeout, no dirty unexpected paths, no file modifications, etc.); unify root gate for orchestrators.
  $adapterOk = $true
  $report.adapter_ready_reason = "wsl_agent_print_ask_trust_workspace_all_guards"
}

if (-not $adapterOk) {
  if ($interactiveAgent) {
    $report.adapter_ready_reason = "interactive_only_no_input_output_no_headless_marker"
  }
  else {
    $report.adapter_ready_reason = "no_headless_marker_stdout_exit0_and_no_input_output"
  }
}

$report.adapter_ready = if ($adapterOk) { "YES" } else { "NO" }

if ($adapterOk) {
  if ($adapterOkWinCursor) {
    $report.recommended_cursor_command = 'powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -Probe -OutputFile SILVER_CURSOR_OUTPUT.md -TimeoutSeconds 120'
    $report.recommended_cursor_command_full_loop = 'powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -TaskFile {TASK_FILE} -OutputFile {OUTPUT_FILE} -TimeoutSeconds 120'
  }
  else {
    $wc = $wslPrintAskTrustPack.recommended_wsl_adapter_probe
    if ([string]::IsNullOrWhiteSpace($wc)) {
      $wc = 'powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -WslUbuntuAgent -Probe -OutputFile SILVER_CURSOR_OUTPUT.md -TimeoutSeconds 120'
    }
    $report.recommended_cursor_command = $wc
    $report.recommended_cursor_command_full_loop = 'powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -WslUbuntuAgent -TaskFile {TASK_FILE} -OutputFile {OUTPUT_FILE} -TimeoutSeconds 120'
  }
}
else {
  $report.recommended_cursor_command = 'powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -Probe -OutputFile SILVER_CURSOR_OUTPUT.md -TimeoutSeconds 120'
  $report.recommended_cursor_command_full_loop = ""
}

$sl = [ordered]@{
  note = "No real development tasks; harmless probe line only for stdin probes."
  cursor_agent = "stdin_probe_5s_harmless_prompt_only"
  cursor_minus = "stdin_probe_5s_harmless_prompt_only"
  cursor_chat = "help_only_cursor_--chat_--help_full_window_chat_skipped_intentionally"
}
if ($headlessChannelOk) {
  $sl["repo_safe_unattended_cursor_agent"] = "YES_headless_marker_probe"
}
elseif ($stdinChannelOk) {
  $sl["repo_safe_unattended_cursor_agent"] = "YES_stdin_pipe_marker_probe"
}
elseif (($null -ne $wslPrintAskTrustPack) -and ($wslPrintAskTrustPack.adapter_ready -eq "YES")) {
  $sl["repo_safe_unattended_cursor_agent"] = "YES_wsl_workspace_agent_print_probe"
}
elseif ($interactiveAgent) {
  $sl["repo_safe_unattended_cursor_agent"] = "NO_probe_timed_out_interactive_or_blocked"
}
elseif ($totalAgentOut -gt 0) {
  $sl["repo_safe_unattended_cursor_agent"] = "UNKNOWN_no_headless_marker"
}
else {
  $sl["repo_safe_unattended_cursor_agent"] = "UNKNOWN_no_cli_output_under_probe_window"
}
$report["safe_launch_assessment"] = $sl

$json = $report | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($ReportPath, $json, (New-Object System.Text.UTF8Encoding $false))

Write-Host "=== SILVER_CURSOR_AGENT_ADAPTER_DIAGNOSTIC ==="
Write-Host ("report_path=" + $ReportPath)
Write-Host ("adapter_ready=" + $report.adapter_ready)
Write-Host ("adapter_ready_reason=" + $report.adapter_ready_reason)
Write-Host ("cursor3_detected=" + $report.cursor3_detected)
Write-Host ("cursor_agent_standalone_available=" + $report.cursor_agent_standalone_available)
Write-Host ("cursor_agent_subcommand_documented=" + $report.cursor_agent_subcommand_documented)
Write-Host ("preferred_headless_variant_id=" + $(if ($null -eq $preferredId -and $null -eq $preferredStdinRowId) { "" } elseif ($null -ne $preferredId) { [string]$preferredId } else { $preferredStdinRowId }))
Write-Host ("preferred_invocation_kind=" + $report.preferred_invocation_kind)
Write-Host "=== END_SILVER_CURSOR_AGENT_ADAPTER_DIAGNOSTIC ==="

$wp = $report.wsl_cursor_agent_print_ask_trust
$changedJoin = ""
if ($null -ne $wp.repo_dirty_unexpected_paths -and $wp.repo_dirty_unexpected_paths.Length -gt 0) {
  $changedJoin = [string]::Join(",", @($wp.repo_dirty_unexpected_paths))
}
Write-Host "=== SILVER_WSL_CURSOR_AGENT_ADAPTER_WIRING_RESULT ==="
Write-Host ("agent_version=" + $wp.agent_version)
Write-Host "adapter_mode=wsl_agent_print_ask_trust_workspace"
Write-Host ("agent_path=" + $wp.agent_path)
Write-Host ("workspace=" + $wp.workspace)
Write-Host ("marker_probe_pass=" + $wp.marker_probe_pass)
Write-Host ("stdout_marker_exact=" + $wp.marker_probe_stdout_marker_exact)
Write-Host ("exit_code_zero=" + $wp.exit_code_zero)
Write-Host ("timeout_guard=" + $wp.timeout_guard)
Write-Host ("repo_dirty_unexpected=" + $wp.repo_dirty_unexpected)
Write-Host ("adapter_ready=" + $wp.adapter_ready)
Write-Host ("safe_for_maxcycles_1=" + $wp.safe_for_maxcycles_1)
Write-Host ("safe_for_maxcycles_0=" + $wp.safe_for_maxcycles_0)
Write-Host ("changed_files=" + $changedJoin)
Write-Host ("next_recommended_command=" + $wp.recommended_wsl_adapter_probe)
Write-Host "=== END_SILVER_WSL_CURSOR_AGENT_ADAPTER_WIRING_RESULT ==="

$changedFilesOutputFixed = "YES"
if ($null -ne $wp.repo_dirty_unexpected_paths) {
  foreach ($ux in @($wp.repo_dirty_unexpected_paths)) {
    if ([string]::IsNullOrEmpty($ux)) { continue }
    if ($ux -match '^(ILVER_|cripts/)') {
      $changedFilesOutputFixed = "NO"
      break
    }
  }
}

Write-Host "=== SILVER_WSL_ADAPTER_ALLOWLIST_FIX_RESULT ==="
Write-Host ("marker_probe_pass=" + $wp.marker_probe_pass)
Write-Host ("stdout_marker_exact=" + $wp.marker_probe_stdout_marker_exact)
Write-Host ("exit_code_zero=" + $wp.exit_code_zero)
Write-Host ("timeout_guard=" + $wp.timeout_guard)
Write-Host ("repo_dirty_unexpected=" + $wp.repo_dirty_unexpected)
Write-Host ("changed_files_output_fixed=" + $changedFilesOutputFixed)
Write-Host ("adapter_ready=" + $wp.adapter_ready)
Write-Host ("safe_for_maxcycles_1=" + $wp.safe_for_maxcycles_1)
Write-Host ("safe_for_maxcycles_0=" + $wp.safe_for_maxcycles_0)
Write-Host ("changed_files=" + $changedJoin)
Write-Host ("next_recommended_command=" + $wp.recommended_wsl_adapter_probe)
Write-Host "=== END_SILVER_WSL_ADAPTER_ALLOWLIST_FIX_RESULT ==="

try {
  [console]::beep(880, 200)
}
catch { }

exit $report.diagnostic_exit
