<#
tools/ensure-gh-and-pr.ps1
One-shot helper: ensure GitHub CLI (gh) exists + auth + create/find PR.
Idempotent: if PR already exists for current branch, it prints the URL and checks.
NEVER merges.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
# Avoid PowerShell treating native non-zero exits as terminating errors.
try { $PSNativeCommandUseErrorActionPreference = $false } catch {}

function Write-Step($msg){ Write-Host ("`n==> " + $msg) }

$script:GhExe = $null
$script:DidAuthLogin = $false

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
  if ($script:GhExe) { return }

  Write-Step "Install GitHub CLI (gh) locally (no admin)"
  $version = "2.86.0"
  $zipUrl = "https://github.com/cli/cli/releases/download/v$version/gh_${version}_windows_amd64.zip"

  $installRoot = Join-Path $env:LOCALAPPDATA "filtr-tools\\gh\\$version"
  $extractDir = Join-Path $installRoot "gh_${version}_windows_amd64"
  $ghPath1 = Join-Path $installRoot "bin\\gh.exe"
  $ghPath2 = Join-Path $extractDir "bin\\gh.exe"

  if (-not ((Test-Path $ghPath1) -or (Test-Path $ghPath2))) {
    New-Item -ItemType Directory -Force -Path $installRoot | Out-Null

    $zipPath = Join-Path $installRoot "gh_${version}_windows_amd64.zip"
    Write-Step ("Download: " + $zipUrl)
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath

    Write-Step "Extract"
    if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
    Expand-Archive -Force -Path $zipPath -DestinationPath $installRoot
  }

  $ghPath = $null
  if (Test-Path $ghPath1) { $ghPath = $ghPath1 }
  elseif (Test-Path $ghPath2) { $ghPath = $ghPath2 }

  if (-not $ghPath) {
    $zipPath = Join-Path $installRoot "gh_${version}_windows_amd64.zip"
    $next = "New-Item -ItemType Directory -Force -Path `"$installRoot`" | Out-Null; Invoke-WebRequest -Uri `"$zipUrl`" -OutFile `"$zipPath`""
    Fail "Failed to install gh locally." $next
  }

  $script:GhExe = $ghPath
  Init-GhExe
}

function Is-GhAuthed(){
  Gh @("auth","status","--hostname","github.com") | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Ensure-GhAuth(){
  Write-Step "GitHub auth (gh)"
  if (Is-GhAuthed) { return }

  if ($script:DidAuthLogin) {
    Fail "gh auth still not ready after login attempt." "powershell -ExecutionPolicy Bypass -File .\\tools\\ensure-gh-and-pr.ps1"
  }
  $script:DidAuthLogin = $true

  Gh @("auth","login","--hostname","github.com","--git-protocol","https","--web") | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "gh auth login failed" }

  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    if (Is-GhAuthed) { return }
  }

  Fail "gh auth not completed within 120s." "powershell -ExecutionPolicy Bypass -File .\\tools\\ensure-gh-and-pr.ps1"
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
  Init-GhExe
  Ensure-GhInstalled
  Ensure-GhAuth

  Write-Step "PR"
  $url = Ensure-PrForCurrentBranch
  Write-Host ("`nPR URL: " + $url)

  Write-Step "Checks"
  $checksOut = & $script:GhExe pr checks 2>&1
  $checksExit = $LASTEXITCODE
  $checksText = ($checksOut | Out-String).TrimEnd()
  if ($checksText) { Write-Host $checksText }

  # gh can exit non-zero even when it successfully prints checks (e.g. pending/none).
  # Only treat it as a failure if it produced no output at all.
  if (($checksExit -ne 0) -and (-not $checksText)) { Fail "gh pr checks failed" }

  exit 0
} catch {
  Fail ("Unhandled error: " + $_.Exception.Message)
}

