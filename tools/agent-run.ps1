<# 
tools/agent-run.ps1
One-shot runner to minimize Cursor RUN prompts.
Idempotent, fail-fast. NEVER merges.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet("preflight","ensure-gh-pr","cls-pr","pr-run-standard")]
  [string]$Task,

  [string]$RepoPath = "C:\projects\filtr"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg){ Write-Host ("`n==> " + $msg) }

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

function Require-CleanWorkingTree(){
  $st = & "C:\Program Files\Git\cmd\git.exe" status --porcelain
  if ($st) { Fail "Working tree not clean. Commit/stash first." }
}

function Switch-Branch([string]$branch){
  Write-Step ("Switch branch: " + $branch)
  Require-CleanWorkingTree
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

function Preflight(){
  Write-Step "Preflight: repo path"
  if (-not (Test-Path $RepoPath)) { Fail "RepoPath not found: $RepoPath" }
  Set-Location $RepoPath

  Require-Command "git"
  SelfCheck

  Write-Step "Preflight: fetch"
  Git @("fetch","origin","--prune")

  Write-Step "Preflight: status clean"
  Require-CleanWorkingTree

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

function EnsureGhPr(){
  Preflight
  Write-Step "Run ensure-gh-and-pr.ps1"
  $tmpScript = Export-EnsureGhAndPrToTemp
  powershell -ExecutionPolicy Bypass -File $tmpScript
  if ($LASTEXITCODE -ne 0) { Fail "ensure-gh-and-pr.ps1 failed" }
}

function RunEnsureGhPrForBranch([string]$branch){
  Preflight

  Write-Step "Fetch (task requirement)"
  Git @("fetch","origin","--prune")

  $tmpScript = Export-EnsureGhAndPrToTemp

  Switch-Branch $branch

  Write-Step "Run ensure-gh-and-pr.ps1"
  powershell -ExecutionPolicy Bypass -File $tmpScript
  if ($LASTEXITCODE -ne 0) { Fail "ensure-gh-and-pr.ps1 failed" }
}

function ClsPr(){
  RunEnsureGhPrForBranch "fix/cls-daily-weather-lock"
}

function PrRunStandard(){
  RunEnsureGhPrForBranch "chore/one-shot-runner-standard"
}

try {
  switch ($Task) {
    "preflight" { Preflight }
    "ensure-gh-pr" { EnsureGhPr }
    "cls-pr" { ClsPr }
    "pr-run-standard" { PrRunStandard }
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
