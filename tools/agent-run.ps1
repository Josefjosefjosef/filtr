<# 
tools/agent-run.ps1
One-shot runner to minimize Cursor RUN prompts.
Idempotent, fail-fast. NEVER merges.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet("preflight","ensure-gh-pr","cls-pr","pr-run-standard","cls-test","night")]
  [string]$Task,

  [string]$RepoPath = "C:\projects\filtr",

  [int]$IntervalMinutes = 10,
  [int]$MaxHours = 8
)

$ErrorActionPreference = "Stop"

function Write-Step($msg){ Write-Host ("`n==> " + $msg) }

$script:GhExe = $null

function Get-GhExe(){
  $localRoot = Join-Path $env:LOCALAPPDATA "filtr-tools\\gh"
  if (Test-Path $localRoot) {
    $dirs = Get-ChildItem -Directory $localRoot -ErrorAction SilentlyContinue
    $candidates = @()
    foreach ($d in $dirs) {
      $v = $null
      if ([System.Version]::TryParse($d.Name, [ref]$v)) {
        $candidates += [pscustomobject]@{ Version = $v; Path = (Join-Path $d.FullName "bin\\gh.exe") }
      }
    }
    foreach ($c in ($candidates | Sort-Object Version -Descending)) {
      if (Test-Path $c.Path) { return $c.Path }
    }
  }

  $cmd = Get-Command "gh" -CommandType Application -ErrorAction SilentlyContinue
  if ($cmd) {
    if ($cmd.Path) { return $cmd.Path }
    if ($cmd.Source) { return $cmd.Source }
  }

  return $null
}

function Init-GhExe(){
  $script:GhExe = Get-GhExe
  if (-not $script:GhExe) { return }

  $dir = Split-Path -Parent $script:GhExe
  if ($dir -and ($env:PATH -notlike "*$dir*")) {
    $env:PATH = ($dir + ";" + $env:PATH)
  }
}

function Write-NextStepBlock(
  [string]$NextStep,
  [string]$Why,
  [string]$CopyPasteOutput = "Only if the NEXT_STEP fails: paste the entire console output (first line to last line)."
){
  Write-Host ""
  Write-Host "NEXT_STEP: $NextStep"
  Write-Host ""
  Write-Host "WHY: $Why"
  Write-Host ""
  Write-Host "COPY_PASTE_OUTPUT: $CopyPasteOutput"
  Write-Host ""
}

function Throw-NextStep(
  [string]$NextStep,
  [string]$Why,
  [string]$CopyPasteOutput = "Only if the NEXT_STEP fails: paste the entire console output (first line to last line)."
){
  $ex = New-Object System.Exception($Why)
  $ex.Data["NEXT_STEP"] = $NextStep
  $ex.Data["WHY"] = $Why
  $ex.Data["COPY_PASTE_OUTPUT"] = $CopyPasteOutput
  throw $ex
}

function Fail($msg){
  Throw-NextStep -NextStep ("powershell -ExecutionPolicy Bypass -File .\tools\agent-run.ps1 -Task " + $Task) -Why $msg
}

function Require-Command($name){
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { Fail "Missing command: $name" }
}

function Git([string[]]$GitArgs){
  & "C:\Program Files\Git\cmd\git.exe" @GitArgs
  if ($LASTEXITCODE -ne 0) { Fail ("git failed: " + ($GitArgs -join " ")) }
}

function Get-RepoBranch(){
  $b = & "C:\Program Files\Git\cmd\git.exe" branch --show-current
  if (-not $b) { Fail "Cannot detect current branch" }
  return $b.Trim()
}

function Require-CleanWorkingTree([switch]$IgnoreUntracked){
  if ($IgnoreUntracked) {
    $st = & "C:\Program Files\Git\cmd\git.exe" status --porcelain --untracked-files=no
  } else {
    $st = & "C:\Program Files\Git\cmd\git.exe" status --porcelain
  }
  if ($st) { Fail "Working tree not clean. Commit/stash first." }
}

function Switch-Branch([string]$branch, [switch]$IgnoreUntracked){
  Write-Step ("Switch branch: " + $branch)
  Require-CleanWorkingTree -IgnoreUntracked:$IgnoreUntracked
  Git @("switch",$branch)
}

function SelfCheck(){
  Write-Step "Self-check: required files"

  $ensure = Join-Path $RepoPath "tools\ensure-gh-and-pr.ps1"
  if (-not (Test-Path $ensure)) {
    Throw-NextStep `
      -NextStep ("powershell -ExecutionPolicy Bypass -Command ""Set-Location '" + $RepoPath + "'; git fetch origin; git switch main; git pull --rebase origin main; git switch chore/one-shot-runner-standard""") `
      -Why "Missing tools\\ensure-gh-and-pr.ps1 in working tree."
  }

  $tpl = Join-Path $RepoPath ".github\pull_request_template.md"
  if (-not (Test-Path $tpl)) {
    Throw-NextStep `
      -NextStep ("powershell -ExecutionPolicy Bypass -Command ""Set-Location '" + $RepoPath + "'; git fetch origin; git switch main; git pull --rebase origin main""") `
      -Why "Missing .github\\pull_request_template.md in working tree."
  }
}

function Preflight([switch]$IgnoreUntracked){
  Write-Step "Preflight: repo path"
  if (-not (Test-Path $RepoPath)) { Fail "RepoPath not found: $RepoPath" }
  Set-Location $RepoPath

  Require-Command "git"
  Init-GhExe
  SelfCheck

  Write-Step "Preflight: fetch"
  Git @("fetch","origin","--prune")

  Write-Step "Preflight: status clean"
  Require-CleanWorkingTree -IgnoreUntracked:$IgnoreUntracked

  Write-Step "Preflight: remote origin"
  $remote = & "C:\Program Files\Git\cmd\git.exe" remote get-url origin
  if (-not $remote) { Fail "Remote origin missing" }

  Write-Step "Preflight: branch"
  $branch = Get-RepoBranch

  Write-Step "Preflight OK"
  Write-Host ("branch=" + $branch)
  Write-Host ("origin=" + $remote)
}

function Export-EnsureGhAndPrToTemp(){
  # Export the ensure script from the current HEAD to a temp file, so we can run it
  # even after switching to a branch that doesn't have it in the working tree yet.
  $tmp = Join-Path $env:TEMP ("filtr-ensure-gh-and-pr-" + $PID + ".ps1")
  $content = & "C:\Program Files\Git\cmd\git.exe" show "HEAD:tools/ensure-gh-and-pr.ps1"
  if ($LASTEXITCODE -ne 0) { Fail "git show HEAD:tools/ensure-gh-and-pr.ps1 failed" }
  if (-not $content) { Fail "ensure-gh-and-pr.ps1 content empty from HEAD" }
  Set-Content -Path $tmp -Value $content -Encoding UTF8
  return $tmp
}

function New-NightLogFile(){
  $logDir = Join-Path $RepoPath "logs"
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $name = "night-" + (Get-Date).ToString("yyyyMMdd-HHmmss") + ".log"
  return (Join-Path $logDir $name)
}

function Night-Log([string]$logFile, [string]$msg, [string]$level="INFO"){
  $line = ("[{0}] [{1}] {2}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $level, $msg)
  Write-Host $line
  Add-Content -Path $logFile -Value $line
}

function RunEnsureTemp([string]$tmpScript, [switch]$NightMode){
  if ($NightMode) {
    powershell -ExecutionPolicy Bypass -File $tmpScript -Night
  } else {
    powershell -ExecutionPolicy Bypass -File $tmpScript
  }
  return $LASTEXITCODE
}

function Night-WriteRaw([string]$logFile, [string]$text){
  if (-not $text) { return }
  $lines = ($text | Out-String).TrimEnd().Split("`n")
  foreach ($l in $lines) {
    $line = $l.TrimEnd("`r")
    if ($line -eq "") { continue }
    Write-Host $line
    Add-Content -Path $logFile -Value $line
  }
}

function Night-RunEnsureAndLog([string]$logFile, [string]$tmpEnsure){
  $out = powershell -ExecutionPolicy Bypass -File $tmpEnsure -Night 2>&1
  $code = $LASTEXITCODE
  Night-WriteRaw -logFile $logFile -text ($out | Out-String)
  return $code
}

function EnsureGhPr(){
  Preflight
  Write-Step "Run ensure-gh-and-pr.ps1"
  $tmpScript = Export-EnsureGhAndPrToTemp
  RunEnsureTemp -tmpScript $tmpScript | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "ensure-gh-and-pr.ps1 failed" }
}

function RunEnsureGhPrForBranch([string]$branch, [switch]$NightMode){
  Preflight -IgnoreUntracked:$NightMode

  Write-Step "Fetch (task requirement)"
  Git @("fetch","origin","--prune")

  $tmpScript = Export-EnsureGhAndPrToTemp

  Switch-Branch $branch -IgnoreUntracked:$NightMode

  Write-Step "Run ensure-gh-and-pr.ps1"
  RunEnsureTemp -tmpScript $tmpScript -NightMode:$NightMode | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "ensure-gh-and-pr.ps1 failed" }
}

function ClsPr(){
  RunEnsureGhPrForBranch "fix/cls-daily-weather-lock"
}

function PrRunStandard(){
  RunEnsureGhPrForBranch "chore/one-shot-runner-standard"
}

function ClsTest(){
  RunEnsureGhPrForBranch "fix/cls-daily-weather-lock"
  Write-Host ""
  Write-Host "DONE"
}

function Night(){
  $logFile = New-NightLogFile
  Night-Log $logFile ("night started; intervalMinutes=$IntervalMinutes; maxHours=$MaxHours; repo=$RepoPath")

  $startTime = Get-Date
  $origBranch = $null
  try { $origBranch = Get-RepoBranch } catch { $origBranch = $null }
  if ($origBranch) { Night-Log $logFile ("origBranch=" + $origBranch) }

  while ($true) {
    $elapsedHours = ((Get-Date) - $startTime).TotalHours
    if ($MaxHours -gt 0 -and $elapsedHours -ge $MaxHours) {
      Night-Log $logFile ("maxHours reached (" + [math]::Round($elapsedHours,2) + "); exiting")
      return
    }

    try {
      Night-Log $logFile "cycle start"

      # Preflight for night: ignore untracked (logs) and never hard-fail the whole run.
      try {
        Preflight -IgnoreUntracked
      } catch {
        Night-Log $logFile ("preflight error: " + $_.Exception.Message) "ERROR"
        throw
      }

      # cls-test (same core logic, but in NightMode to avoid interactive auth/install)
      try {
        Night-Log $logFile "run cls-test"
        RunEnsureGhPrForBranch "fix/cls-daily-weather-lock" -NightMode
        Night-Log $logFile "DONE"
      } catch {
        Night-Log $logFile ("cls-test error: " + $_.Exception.Message) "ERROR"
      }

      # restore
      if ($origBranch) {
        try {
          Night-Log $logFile ("restore branch: " + $origBranch)
          Switch-Branch $origBranch -IgnoreUntracked
        } catch {
          Night-Log $logFile "restore branch failed" "WARN"
        }
      }

      Night-Log $logFile "cycle end"
    } catch {
      Night-Log $logFile ("cycle runtime error: " + $_.Exception.Message) "ERROR"
    }

    if ($IntervalMinutes -lt 1) { $IntervalMinutes = 1 }
    Start-Sleep -Seconds ($IntervalMinutes * 60)
  }
}

try {
  switch ($Task) {
    "preflight" { Preflight }
    "ensure-gh-pr" { EnsureGhPr }
    "cls-pr" { ClsPr }
    "pr-run-standard" { PrRunStandard }
    "cls-test" { ClsTest }
    "night" { Night }
    default { Fail "Unknown Task: $Task" }
  }
} catch {
  $ex = $_.Exception
  $next = $ex.Data["NEXT_STEP"]
  $why = $ex.Data["WHY"]
  $copy = $ex.Data["COPY_PASTE_OUTPUT"]

  if ($next -and $why) {
    Write-NextStepBlock -NextStep $next -Why $why -CopyPasteOutput $copy
    exit 1
  }

  Write-NextStepBlock `
    -NextStep ("powershell -ExecutionPolicy Bypass -File .\tools\agent-run.ps1 -Task " + $Task) `
    -Why ("Unhandled error: " + ($ex.Message)) `
    -CopyPasteOutput "Paste the entire console output (first line to last line)."
  exit 1
}
