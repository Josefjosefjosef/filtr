<# 
tools/agent-run.ps1
One-shot runner to minimize Cursor RUN prompts.
Idempotent, fail-fast. NEVER merges.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet("preflight","ensure-gh-pr")]
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

function Preflight(){
  Write-Step "Preflight: repo path"
  if (-not (Test-Path $RepoPath)) { Fail "RepoPath not found: $RepoPath" }
  Set-Location $RepoPath

  Require-Command "git"

  Write-Step "Preflight: fetch"
  Git @("fetch","origin","--prune")

  Write-Step "Preflight: status clean"
  $st = & "C:\Program Files\Git\cmd\git.exe" status --porcelain
  if ($st) { Fail "Working tree not clean. Commit/stash first." }

  Write-Step "Preflight: remote origin"
  $remote = & "C:\Program Files\Git\cmd\git.exe" remote get-url origin
  if (-not $remote) { Fail "Remote origin missing" }

  Write-Step "Preflight: branch"
  $branch = & "C:\Program Files\Git\cmd\git.exe" branch --show-current
  if (-not $branch) { Fail "Cannot detect current branch" }

  Write-Step "Preflight OK"
  Write-Host ("branch=" + $branch)
  Write-Host ("origin=" + $remote)
}

function EnsureGhPr(){
  Preflight
  Write-Step "Run ensure-gh-and-pr.ps1"
  $script = Join-Path (Get-Location) "tools\ensure-gh-and-pr.ps1"
  if (-not (Test-Path $script)) { Fail "Missing tools\ensure-gh-and-pr.ps1 (pull main first)" }

  powershell -ExecutionPolicy Bypass -File $script
  if ($LASTEXITCODE -ne 0) { Fail "ensure-gh-and-pr.ps1 failed" }
}

switch ($Task) {
  "preflight" { Preflight }
  "ensure-gh-pr" { EnsureGhPr }
  default { Fail "Unknown Task: $Task" }
}
