$ErrorActionPreference = 'Stop'

Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))

Write-Host "== doctor: debug overlay =="
Write-Host ""

Write-Host "== git diff --stat =="
git diff --stat

Write-Host ""
Write-Host "== js syntax check (node --check) =="
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  node --check .\assets\app.js
  Write-Host "OK: node --check assets/app.js"
}
else {
  Write-Host "WARN: node not found; skipping node --check"
}

