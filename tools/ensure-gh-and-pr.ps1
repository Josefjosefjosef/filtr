<# 
One-shot helper: ensure GitHub CLI (gh) exists + auth + create/find PR.
Idempotent: if PR already exists for current branch, it prints the URL and checks.
NEVER merges.

Usage (from repo root):
  powershell -ExecutionPolicy Bypass -File .\tools\ensure-gh-and-pr.ps1
#>

$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) {
  Write-Host ("`n=== " + $msg + " ===")
}

function Has-Command([string]$name) {
  return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

function Run([string]$exe, [string[]]$args) {
  & $exe @args
  if ($LASTEXITCODE -ne 0) {
    throw ("Command failed: " + $exe + " " + ($args -join " "))
  }
}

Write-Step "Locate repo root"
$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) { throw "Not inside a git repo (git rev-parse failed)." }
Set-Location $repoRoot
Write-Host ("repoRoot=" + $repoRoot)

Write-Step "Ensure gh is installed"
if (-not (Has-Command "gh")) {
  Write-Host "gh not found. Attempting install…"

  if (Has-Command "winget") {
    Write-Host "Using winget to install GitHub CLI…"
    Run "winget" @(
      "install",
      "--id", "GitHub.cli",
      "-e",
      "--source", "winget",
      "--accept-package-agreements",
      "--accept-source-agreements"
    )
  } elseif (Has-Command "choco") {
    Write-Host "Using choco to install GitHub CLI…"
    Run "choco" @("install", "gh", "-y")
  } else {
    throw "Neither winget nor choco is available. Please install GitHub CLI manually: https://cli.github.com/"
  }
}

if (-not (Has-Command "gh")) {
  throw "gh still not available after install attempt."
}

Write-Step "Check gh auth"
& gh --version
$authOk = $true
try {
  & gh auth status
  if ($LASTEXITCODE -ne 0) { $authOk = $false }
} catch {
  $authOk = $false
}

if (-not $authOk) {
  Write-Host "Not authenticated. Starting 'gh auth login'…"
  Write-Host "Follow the interactive prompts in the terminal/browser."
  & gh auth login
  if ($LASTEXITCODE -ne 0) { throw "gh auth login failed." }
  & gh auth status
  if ($LASTEXITCODE -ne 0) { throw "gh auth status still failing after login." }
}

Write-Step "Prepare PR inputs"
$repo = "Josefjosefjosef/filtr"
$head = (& git rev-parse --abbrev-ref HEAD).Trim()
if (-not $head) { throw "Failed to detect current branch." }
if ($head -eq "main") { throw "Refusing to create PR from main. Switch to a feature branch first." }

$templatePath = Join-Path $repoRoot ".github\pull_request_template.md"
if (-not (Test-Path $templatePath)) { throw "Missing PR template: .github/pull_request_template.md" }
$body = Get-Content -Raw $templatePath

$title = (& git log -1 --pretty=%s).Trim()
if (-not $title) { $title = ("chore: PR for " + $head) }

Write-Host ("repo=" + $repo)
Write-Host ("base=main")
Write-Host ("head=" + $head)
Write-Host ("title=" + $title)

Write-Step "Find existing open PR (idempotent)"
$existingJson = & gh pr list --repo $repo --head $head --state open --json number,url,title
if ($LASTEXITCODE -ne 0) { throw "gh pr list failed." }

$existing = @()
if ($existingJson) {
  try { $existing = $existingJson | ConvertFrom-Json } catch { $existing = @() }
}

$prUrl = $null
$prNumber = $null

if ($existing -and $existing.Count -gt 0) {
  $prUrl = $existing[0].url
  $prNumber = $existing[0].number
  Write-Host ("PR already exists: #" + $prNumber + " " + $prUrl)
} else {
  Write-Step "Create PR (no merge)"
  $createOut = & gh pr create --repo $repo --base main --head $head --title $title --body $body
  if ($LASTEXITCODE -ne 0) { throw "gh pr create failed." }
  $prUrl = ($createOut | Select-Object -Last 1).Trim()

  $viewJson = & gh pr view --repo $repo --head $head --json number,url,title
  if ($LASTEXITCODE -ne 0) { throw "gh pr view failed after create." }
  $view = $viewJson | ConvertFrom-Json
  $prNumber = $view.number
  $prUrl = $view.url
  Write-Host ("Created PR: #" + $prNumber + " " + $prUrl)
}

Write-Step "Checks (current status)"
& gh pr checks --repo $repo $head

Write-Host "`nDONE"
Write-Host ("PR URL: " + $prUrl)
Write-Host "NOTE: This script does NOT merge."

