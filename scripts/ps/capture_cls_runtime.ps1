$ErrorActionPreference = 'Stop'

$urlDebug = "https://infouzel.cz/projects/?debug=1"
$urlProd  = "https://infouzel.cz/projects/"

Write-Host "Opening URLs..."
Start-Process $urlDebug
Start-Process $urlProd

Write-Host ""
Write-Host "Manual step (only):"
Write-Host "- In each tab: open DevTools -> Console -> Clear"
Write-Host "- Reload (Ctrl+F5 then F5)"
Write-Host "- Copy/paste last ~30 console lines to chat"
Write-Host ""
Write-Host "Copy only lines starting with:"
Write-Host "- [IU][CLS]"
Write-Host "- [IU][CLS][debug-only]"
Write-Host "- [IU][CLS][real-total]"
Write-Host "- [IU][topbar-links]"

