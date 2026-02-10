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
function Fail($msg){ Write-Error $msg; exit 1 }

function Require-Command($name){
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { Fail "Missing command: $name" }
}

function Git([string[]]$args){
  & "C:\Program Files\Git\cmd\git.exe" @args
  if ($LASTEXITCODE -ne 0) { Fail ("git failed: " + ($args -join " ")) }
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

function Preflight(){
  Write-Step "Preflight: repo path"
  if (-not (Test-Path $RepoPath)) { Fail "RepoPath not found: $RepoPath" }
  Set-Location $RepoPath

  Require-Command "git"

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

function Ensure-GhInstalled(){
  if (Get-Command "gh" -ErrorAction SilentlyContinue) { return }

  Write-Step "Install GitHub CLI (gh)"
  if (Get-Command "winget" -ErrorAction SilentlyContinue) {
    winget install --id GitHub.cli -e --source winget
    if ($LASTEXITCODE -ne 0) { Fail "winget failed installing gh" }
  } elseif (Get-Command "choco" -ErrorAction SilentlyContinue) {
    choco install gh -y
    if ($LASTEXITCODE -ne 0) { Fail "choco failed installing gh" }
  } else {
    Fail "Missing gh and no installer found (winget/choco). Install GitHub CLI and rerun."
  }

  if (-not (Get-Command "gh" -ErrorAction SilentlyContinue)) { Fail "gh still missing after install attempt" }
}

function Ensure-GhAuth(){
  Write-Step "GitHub auth (gh)"
  gh auth status -h github.com | Out-Null
  if ($LASTEXITCODE -eq 0) { return }

  gh auth login -h github.com -p https -w
  if ($LASTEXITCODE -ne 0) { Fail "gh auth login failed" }

  gh auth status -h github.com | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "gh auth status failed after login" }
}

function Ensure-PrForCurrentBranch(){
  $branch = Get-RepoBranch

  Write-Step "Find existing open PR (idempotent)"
  $existing = (gh pr list --head $branch --state open --json url --jq ".[0].url" 2>$null)
  if ($LASTEXITCODE -ne 0) { Fail "gh pr list failed" }
  $existing = ($existing | Out-String).Trim()
  if ($existing) { return $existing }

  Write-Step "Create PR (gh pr create --fill)"
  gh pr create --fill --head $branch --base main
  if ($LASTEXITCODE -ne 0) { Fail "gh pr create failed" }

  $url = (gh pr view --json url --jq ".url" 2>$null)
  if ($LASTEXITCODE -ne 0) { Fail "gh pr view failed after create" }
  $url = ($url | Out-String).Trim()
  if (-not $url) { Fail "PR URL missing after create" }
  return $url
}

function EnsureGhAndPr(){
  Preflight
  Ensure-GhInstalled
  Ensure-GhAuth

  $url = Ensure-PrForCurrentBranch
  Write-Host ("`nPR URL: " + $url)

  Write-Step "Checks"
  gh pr checks
  if ($LASTEXITCODE -ne 0) { Fail "gh pr checks failed" }
}

function EnsureGhPr(){
  EnsureGhAndPr
}

function RunEnsureGhPrForBranch([string]$branch){
  Preflight

  Write-Step "Fetch (task requirement)"
  Git @("fetch","origin","--prune")

  Switch-Branch $branch

  EnsureGhAndPr
}

function ClsPr(){
  RunEnsureGhPrForBranch "fix/cls-daily-weather-lock"
}

function PrRunStandard(){
  RunEnsureGhPrForBranch "chore/one-shot-runner-standard"
}

switch ($Task) {
  "preflight" { Preflight }
  "ensure-gh-pr" { EnsureGhPr }
  "cls-pr" { ClsPr }
  "pr-run-standard" { PrRunStandard }
  default { Fail "Unknown Task: $Task" }
}
