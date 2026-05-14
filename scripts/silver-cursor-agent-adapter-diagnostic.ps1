#requires -Version 5.1
<#
.SYNOPSIS
  Silver — diagnose Cursor CLI / `cursor agent` for FULL AUTO LOOP adapter (Windows, scripts-only).

.NOTES
  Does not run autopilot loops. Does not pass real development tasks — only a harmless probe line.
  Writes scripts/silver-cursor-agent-adapter-diagnostic-report.json next to repo root.
#>
Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$ReportPath = Join-Path $RepoRoot "scripts\silver-cursor-agent-adapter-diagnostic-report.json"
$HarmlessProbe = "Print version/help only. Do not modify files."

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
  try {
    [void]$p.Start()
    if (-not $p.WaitForExit($TimeoutMs)) {
      try { $p.Kill() } catch { }
      $code = -1
      if (Test-Path -LiteralPath $outF) { $so = [System.IO.File]::ReadAllText($outF) }
      if (Test-Path -LiteralPath $errF) { $se = [System.IO.File]::ReadAllText($errF) }
      return @{ exit = $code; timedOut = $true; stdout = $so; stderr = $se }
    }
    $code = $p.ExitCode
    if (Test-Path -LiteralPath $outF) { $so = [System.IO.File]::ReadAllText($outF) }
    if (Test-Path -LiteralPath $errF) { $se = [System.IO.File]::ReadAllText($errF) }
    return @{ exit = $code; timedOut = $false; stdout = $so; stderr = $se }
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
  try {
    [void]$p.Start()
    if (-not $p.WaitForExit($TimeoutMs)) {
      try { $p.Kill() } catch { }
      $code = -1
      if (Test-Path -LiteralPath $outF) { $so = [System.IO.File]::ReadAllText($outF) }
      if (Test-Path -LiteralPath $errF) { $se = [System.IO.File]::ReadAllText($errF) }
      return @{ exit = $code; timedOut = $true; stdout = $so; stderr = $se }
    }
    $code = $p.ExitCode
    if (Test-Path -LiteralPath $outF) { $so = [System.IO.File]::ReadAllText($outF) }
    if (Test-Path -LiteralPath $errF) { $se = [System.IO.File]::ReadAllText($errF) }
    return @{ exit = $code; timedOut = $false; stdout = $so; stderr = $se }
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

$report = [ordered]@{
  schema = "silver-cursor-agent-adapter-diagnostic-v1"
  timestamp_utc = (Get-Date).ToUniversalTime().ToString("o")
  repo_root = $RepoRoot
  cursor_where_exit = $null
  cursor_where_text = ""
  cursor_exe_path = ""
  cursor_cli_found = "NO"
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
  adapter_ready = "NO"
  adapter_ready_reason = ""
  recommended_cursor_command = ""
  diagnostic_exit = 0
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
    if ($ln.EndsWith(".cmd", [System.StringComparison]::OrdinalIgnoreCase)) {
      $picked = $ln
      break
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

$h = Invoke-ExternalCapture -FileName $cursorExe -Arguments @("--help") -WorkingDirectory $RepoRoot -TimeoutMs 60000
$report.cursor_help_exit = $h.exit
$helpMain = $h.stdout + "`n" + $h.stderr
if ($null -eq $helpMain) { $helpMain = "" }
$report.cursor_help_bytes = [System.Text.Encoding]::UTF8.GetByteCount($helpMain)

if ($helpMain.Contains("append '-'") -or $helpMain.Contains("cursor.exe -") -or $helpMain.Contains("| cursor")) {
  $report.main_help_pipe_dash_mentioned = "YES"
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
  "--print", "--prompt", "--input", "--output", "--headless",
  "--non-interactive", "--yes", "--force", "--cwd", "--workspace"
)
$report.flag_mentions = [ordered]@{}
foreach ($f in $flags) {
  $key = $f.TrimStart("-")
  if (Test-HelpFlagMention -Haystack $combinedHelp -FlagToken $f) {
    $report.flag_mentions[$key] = "YES"
  }
  else {
    $report.flag_mentions[$key] = "NO"
  }
}

$ioYes = ((Test-HelpFlagMention -Haystack $combinedHelp -FlagToken "--input") -and (Test-HelpFlagMention -Haystack $combinedHelp -FlagToken "--output"))
if ($ioYes) { $report.cursor_agent_supports_input_output = "YES" }

# Safe probes: short timeout, harmless stdin line only where stdin is used.
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
$stdinWorkedAgent = (-not $pa.timedOut) -and ($totalAgentOut -gt 0)

$report.cursor_agent_supports_stdin = "UNKNOWN"
if ($pa.timedOut) { $report.cursor_agent_supports_stdin = "NO" }
elseif ($totalAgentOut -gt 0) { $report.cursor_agent_supports_stdin = "YES" }
else { $report.cursor_agent_supports_stdin = "UNKNOWN" }

$headlessMention = (Test-HelpFlagMention -Haystack $combinedHelp -FlagToken "--headless")
$report.cursor_agent_supports_headless = if ($headlessMention) { "YES" } else { "NO" }

$report.cursor_agent_interactive_only = if ($interactiveAgent) { "YES" } else { "NO" }

# Adapter: require documented --input/--output OR proven non-interactive stdin capture with exit (not timeout).
$adapterOk = $false
if ($report.cursor_agent_supports_input_output -eq "YES") {
  $adapterOk = $true
  $report.adapter_ready_reason = "help_lists_input_output"
}
elseif ($stdinWorkedAgent -and -not $interactiveAgent) {
  $adapterOk = $true
  $report.adapter_ready_reason = "agent_stdin_probe_completed_without_timeout"
}

if (-not $adapterOk) {
  if ($interactiveAgent) {
    $report.adapter_ready_reason = "interactive_only_no_input_output"
  }
  elseif (-not [string]::IsNullOrWhiteSpace($report.adapter_ready_reason)) { }
  else {
    $report.adapter_ready_reason = "no_noninteractive_channel_detected"
  }
}

$report.adapter_ready = if ($adapterOk) { "YES" } else { "NO" }

if ($adapterOk) {
  $report.recommended_cursor_command = 'powershell -ExecutionPolicy Bypass -File scripts/silver-cursor-agent-adapter.ps1 -TaskFile {TASK_FILE} -OutputFile {OUTPUT_FILE}'
}
else {
  $report.recommended_cursor_command = ""
}

$sl = [ordered]@{
  note = "No real development tasks; harmless probe line only for stdin probes."
  cursor_agent = "stdin_probe_5s_harmless_prompt_only"
  cursor_minus = "stdin_probe_5s_harmless_prompt_only"
  cursor_chat = "help_only_cursor_--chat_--help_full_window_chat_skipped_intentionally"
}
if ($interactiveAgent) {
  $sl["repo_safe_unattended_cursor_agent"] = "NO_probe_timed_out_interactive_or_blocked"
}
elseif ($totalAgentOut -gt 0) {
  $sl["repo_safe_unattended_cursor_agent"] = "UNKNOWN_exit_with_output_automation_not_verified"
}
else {
  $sl["repo_safe_unattended_cursor_agent"] = "UNKNOWN_no_cli_output_under_probe_window"
}
$report["safe_launch_assessment"] = $sl

$json = $report | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($ReportPath, $json, (New-Object System.Text.UTF8Encoding $false))

Write-Host "=== SILVER_CURSOR_AGENT_ADAPTER_DIAGNOSTIC ==="
Write-Host ("report_path=" + $ReportPath)
Write-Host ("adapter_ready=" + $report.adapter_ready)
Write-Host ("adapter_ready_reason=" + $report.adapter_ready_reason)
Write-Host "=== END_SILVER_CURSOR_AGENT_ADAPTER_DIAGNOSTIC ==="

exit 0
