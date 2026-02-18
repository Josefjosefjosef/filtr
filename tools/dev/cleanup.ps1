Set-Location C:\projects\filtr

Write-Host "Cleaning RAM-heavy artifacts..."

# stop common long-running local processes (safe best-effort)
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# move gate screenshots out of repo root (keep repo small)
$gate = "C:\projects\filtr-gate-artifacts\auto"
if (!(Test-Path $gate)) { New-Item -ItemType Directory -Path $gate | Out-Null }
Get-ChildItem -File -Filter "gate-*.png" -ErrorAction SilentlyContinue |
  Move-Item -Destination $gate -Force -ErrorAction SilentlyContinue

# git housekeeping (safe)
git gc --auto

Write-Host "Cleanup done."

