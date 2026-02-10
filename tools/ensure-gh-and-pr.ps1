<#
tools/ensure-gh-and-pr.ps1
One-shot helper: ensure GitHub CLI (gh) exists + auth + create/find PR.
Idempotent: if PR already exists for current branch, it prints the URL and checks.
NEVER merges.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Write-Step($msg){ Write-Host ("`n==> " + $msg) }

function Write-NextStepBlock([string]$NextStep, [string]$Why){
  Write-Host ""
  Write-Host "NEXT_STEP: $NextStep"
  Write-Host ""
  Write-Host "WHY: $Why"
  Write-Host ""
  Write-Host "COPY_PASTE_OUTPUT: Only if the NEXT_STEP fails: paste the entire console output (first line to last line)."
  Write-Host ""
}

function Fail([string]$Why, [string]$NextStep = "powershell -ExecutionPolicy Bypass -File .\\tools\\ensure-gh-and-pr.ps1"){
  Write-NextStepBlock -NextStep $NextStep -Why $Why
  exit 1
}

function Require-Command($name){
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Fail ("Missing command: " + $name)
  }
}

function Git([string[]]$args){
  & "C:\Program Files\Git\cmd\git.exe" @args
  if ($LASTEXITCODE -ne 0) { Fail ("git failed: " + ($args -join " ")) }
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
    Fail "Missing gh and no installer found (winget/choco)." "winget install --id GitHub.cli -e --source winget"
  }

  if (-not (Get-Command "gh" -ErrorAction SilentlyContinue)) { Fail "gh still missing after install attempt" }
}

function Ensure-GhAuth(){
  Write-Step "GitHub auth (gh)"
  gh auth status -h github.com | Out-Null
  if ($LASTEXITCODE -eq 0) { return }

  Write-Step "Login (may open browser / device code)"
  gh auth login -h github.com -p https -w
  if ($LASTEXITCODE -ne 0) { Fail "gh auth login failed" }

  gh auth status -h github.com | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "gh auth status failed after login" }
}

function Get-RepoBranch(){
  $b = & "C:\Program Files\Git\cmd\git.exe" branch --show-current
  if (-not $b) { Fail "Cannot detect current branch" }
  return $b.Trim()
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

try {
  Require-Command "git"

  Write-Step "Ensure gh"
  Ensure-GhInstalled
  Ensure-GhAuth

  Write-Step "PR"
  $url = Ensure-PrForCurrentBranch
  Write-Host ("`nPR URL: " + $url)

  Write-Step "Checks"
  gh pr checks
  if ($LASTEXITCODE -ne 0) { Fail "gh pr checks failed" }

  exit 0
} catch {
  Fail ("Unhandled error: " + $_.Exception.Message)
}

