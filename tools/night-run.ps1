<#
tools/night-run.ps1
Night autopilot runner: single RUN, long-running loop.
Safe, idempotent, no merges, no pulls. Logs to console + file.
#>

[CmdletBinding()]
param(
  [int]$IntervalMinutes = 10,
  [string]$RepoPath = "C:\projects\filtr"
)

$ErrorActionPreference = "Stop"

function NowStamp(){ (Get-Date).ToString("yyyy-MM-dd HH:mm:ss") }

$logDir = Join-Path $env:LOCALAPPDATA "filtr-tools\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("night-run-" + (Get-Date).ToString("yyyyMMdd") + ".log")

function Log([string]$level, [string]$msg){
  $line = ("[{0}] [{1}] {2}" -f (NowStamp), $level.ToUpperInvariant(), $msg)
  Write-Host $line
  Add-Content -Path $logFile -Value $line
}

function Info([string]$m){ Log "info" $m }
function Warn([string]$m){ Log "warn" $m }
function Err([string]$m){ Log "error" $m }

function Require-Repo(){
  if (-not (Test-Path $RepoPath)) { throw "RepoPath not found: $RepoPath" }
  Set-Location $RepoPath
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Missing git in PATH" }
  $origin = & "C:\Program Files\Git\cmd\git.exe" remote get-url origin 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $origin) { throw "Missing git remote 'origin'" }
}

function Git([string[]]$GitArgs){
  & "C:\Program Files\Git\cmd\git.exe" @GitArgs
  $code = $LASTEXITCODE
  return [pscustomobject]@{ Code = $code; Output = $null }
}

function GitOut([string[]]$GitArgs){
  $out = & "C:\Program Files\Git\cmd\git.exe" @GitArgs 2>&1
  $code = $LASTEXITCODE
  return [pscustomobject]@{ Code = $code; Output = ($out | Out-String).TrimEnd() }
}

function Is-Clean(){
  $st = & "C:\Program Files\Git\cmd\git.exe" status --porcelain
  return (-not $st)
}

function Current-Branch(){
  $b = & "C:\Program Files\Git\cmd\git.exe" branch --show-current
  return ($b | Out-String).Trim()
}

function Switch-BranchSafe([string]$branch){
  $res = GitOut @("switch",$branch)
  if ($res.Code -eq 0) { return $true }

  # Try to create tracking branch if it only exists on origin.
  $res2 = GitOut @("switch","--track","-c",$branch,("origin/" + $branch))
  if ($res2.Code -eq 0) { return $true }

  Err ("git switch failed for '" + $branch + "': " + ($res2.Output ?? $res.Output))
  return $false
}

function Export-EnsureToTemp(){
  $tmp = Join-Path $env:TEMP ("filtr-ensure-gh-and-pr-night-" + $PID + ".ps1")
  $content = & "C:\Program Files\Git\cmd\git.exe" show "HEAD:tools/ensure-gh-and-pr.ps1" 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $content) { throw "Cannot read HEAD:tools/ensure-gh-and-pr.ps1" }
  Set-Content -Path $tmp -Value $content -Encoding UTF8
  return $tmp
}

function Run-Ensure([string]$tmpEnsure){
  $out = powershell -ExecutionPolicy Bypass -File $tmpEnsure 2>&1
  $code = $LASTEXITCODE
  $text = ($out | Out-String).TrimEnd()
  if ($text) { $text.Split("`n") | ForEach-Object { Info $_ } }
  return $code
}

function Run-Flow([string]$flowName, [string]$branch, [string]$tmpEnsure){
  Info ("FLOW start: " + $flowName + " (" + $branch + ")")

  if (-not (Switch-BranchSafe $branch)) { return }

  $code = Run-Ensure $tmpEnsure
  if ($code -ne 0) { Warn ("FLOW error: " + $flowName + " exit_code=" + $code) }

  Info ("FLOW end: " + $flowName)
}

function Sleep-Interval(){
  if ($IntervalMinutes -lt 1) { $IntervalMinutes = 1 }
  Info ("Sleep " + $IntervalMinutes + " minutes")
  Start-Sleep -Seconds ($IntervalMinutes * 60)
}

try {
  Require-Repo
} catch {
  Err ("FATAL: " + $_.Exception.Message)
  exit 1
}

Info ("night-run started; repo=" + $RepoPath + "; intervalMinutes=" + $IntervalMinutes + "; logFile=" + $logFile)

while ($true) {
  try {
    Require-Repo

    if (-not (Is-Clean)) {
      Warn "Working tree not clean; skipping cycle (no stash/pull)."
      Sleep-Interval
      continue
    }

    $startBranch = Current-Branch
    if (-not $startBranch) { $startBranch = "(detached)" }

    Info ("Cycle start; branch=" + $startBranch)

    $fetch = GitOut @("fetch","origin","--prune")
    if ($fetch.Code -ne 0) {
      Warn ("git fetch failed; skipping cycle. " + $fetch.Output)
      Sleep-Interval
      continue
    }

    $tmpEnsure = Export-EnsureToTemp

    Run-Flow -flowName "cls-pr" -branch "fix/cls-daily-weather-lock" -tmpEnsure $tmpEnsure
    Run-Flow -flowName "pr-run-standard" -branch "chore/one-shot-runner-standard" -tmpEnsure $tmpEnsure

    if ($startBranch -and ($startBranch -ne "(detached)")) {
      Info ("Restore branch: " + $startBranch)
      [void](Switch-BranchSafe $startBranch)
    }

    Info "Cycle end"
  } catch {
    Warn ("Cycle error: " + $_.Exception.Message)
  }

  Sleep-Interval
}

