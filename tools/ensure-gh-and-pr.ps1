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

$script:GhExe = $null

function Gh([string[]]$GhArgs){
  if (-not $script:GhExe) { Fail "Internal error: gh executable not set" }
  & $script:GhExe @GhArgs
  return $LASTEXITCODE
}

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

function Git([string[]]$GitArgs){
  & "C:\Program Files\Git\cmd\git.exe" @GitArgs
  if ($LASTEXITCODE -ne 0) { Fail ("git failed: " + ($GitArgs -join " ")) }
}

function Ensure-GhInstalled(){
  $cmd = Get-Command "gh" -ErrorAction SilentlyContinue
  if ($cmd) {
    $script:GhExe = $cmd.Source
    return
  }

  Write-Step "Install GitHub CLI (gh) locally (no admin)"
  $version = "2.86.0"
  $zipUrl = "https://github.com/cli/cli/releases/download/v$version/gh_${version}_windows_amd64.zip"

  $installRoot = Join-Path $env:LOCALAPPDATA "filtr-tools\\gh\\$version"
  $extractDir = Join-Path $installRoot "gh_${version}_windows_amd64"
  $ghPath = Join-Path $extractDir "bin\\gh.exe"

  if (-not (Test-Path $ghPath)) {
    New-Item -ItemType Directory -Force -Path $installRoot | Out-Null

    $zipPath = Join-Path $installRoot "gh_${version}_windows_amd64.zip"
    Write-Step ("Download: " + $zipUrl)
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath

    Write-Step "Extract"
    if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
    Expand-Archive -Force -Path $zipPath -DestinationPath $installRoot
  }

  if (-not (Test-Path $ghPath)) {
    Fail "Failed to install gh locally." ("powershell -ExecutionPolicy Bypass -Command \"Invoke-WebRequest -Uri '$zipUrl' -OutFile '$installRoot\\gh.zip'\"")
  }

  $script:GhExe = $ghPath
}

function Ensure-GhAuth(){
  Write-Step "GitHub auth (gh)"
  Gh @("auth","status","-h","github.com") | Out-Null
  if ($LASTEXITCODE -eq 0) { return }

  Write-Step "Login (may open browser / device code)"
  Gh @("auth","login","-h","github.com","-p","https","-w") | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "gh auth login failed" }

  Gh @("auth","status","-h","github.com") | Out-Null
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
  $existing = (& $script:GhExe pr list --head $branch --state open --json url --jq ".[0].url" 2>$null)
  if ($LASTEXITCODE -ne 0) { Fail "gh pr list failed" }
  $existing = ($existing | Out-String).Trim()
  if ($existing) { return $existing }

  Write-Step "Create PR (gh pr create --fill)"
  Gh @("pr","create","--fill","--head",$branch,"--base","main") | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "gh pr create failed" }

  $url = (& $script:GhExe pr view --json url --jq ".url" 2>$null)
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
  & $script:GhExe pr checks
  if ($LASTEXITCODE -ne 0) { Fail "gh pr checks failed" }

  exit 0
} catch {
  Fail ("Unhandled error: " + $_.Exception.Message)
}

