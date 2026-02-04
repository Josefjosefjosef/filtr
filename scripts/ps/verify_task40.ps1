# verify_task40.ps1 - Ověření Task 40: Pages deploy po update-articles
# Usage: .\scripts\ps\verify_task40.ps1

$h = @{ "Accept"="application/vnd.github+json"; "User-Agent"="iu-debug" }

Write-Host "=== newest SUCCESSFUL update-articles run ===" -ForegroundColor Cyan
$uA = "https://api.github.com/repos/Josefjosefjosef/filtr/actions/workflows/update-articles.yml/runs?per_page=30"
$rA = Invoke-RestMethod -Uri $uA -Headers $h -Method Get
$ua = $rA.workflow_runs | Where-Object { $_.conclusion -eq "success" } | Select-Object -First 1

if (-not $ua) {
    Write-Host "ERROR: No successful update-articles run found" -ForegroundColor Red
    Write-Host "VERDICT: FAIL (no successful update-articles run)" -ForegroundColor Red
    exit 1
}

Write-Host ("{0} | {1} | {2} | {3} | {4}" -f $ua.created_at, $ua.status, $ua.conclusion, $ua.head_sha.Substring(0,7), $ua.event) -ForegroundColor Green

Write-Host "`n=== pages runs created after that update-articles run ===" -ForegroundColor Cyan
$uP = "https://api.github.com/repos/Josefjosefjosef/filtr/actions/workflows/pages.yml/runs?per_page=50"
$rP = Invoke-RestMethod -Uri $uP -Headers $h -Method Get
$after = $ua.created_at
$pr = $rP.workflow_runs | Where-Object { $_.created_at -gt $after }

Write-Host "count(after): $($pr.Count)" -ForegroundColor Yellow

if ($pr) {
    Write-Host "`nPages runs:" -ForegroundColor Cyan
    $pr | ForEach-Object { 
        Write-Host ("  {0} | {1} | {2} | {3} | {4}" -f $_.created_at, $_.status, $_.conclusion, $_.head_sha.Substring(0,7), $_.event) 
    }
} else {
    Write-Host "none" -ForegroundColor Yellow
}

Write-Host "`n=== Verification ===" -ForegroundColor Cyan

$verdict = "PASS"
$reason = @()

if ($pr.Count -ne 1) {
    $verdict = "FAIL"
    $reason += "count(after)=$($pr.Count) (expected 1)"
}

if ($pr.Count -gt 0) {
    $pagesRun = $pr | Select-Object -First 1
    
    if ($pagesRun.event -ne "workflow_dispatch") {
        $verdict = "FAIL"
        $reason += "event=$($pagesRun.event) (expected workflow_dispatch)"
    }
    
    if ($pagesRun.conclusion -ne "success") {
        $verdict = "FAIL"
        $reason += "conclusion=$($pagesRun.conclusion) (expected success)"
    }
}

Write-Host "`n=== RAW vs PAGES generatedAt ===" -ForegroundColor Cyan
$ts = [Uri]::EscapeDataString((Get-Date -Format o))
$raw = "https://raw.githubusercontent.com/Josefjosefjosef/filtr/main/projects/data/articles.json"
$pages = "https://josefjosefjosef.github.io/filtr/projects/data/articles.json?ts=$ts"

try {
    $jRaw = (Invoke-WebRequest -Uri $raw -UseBasicParsing).Content | ConvertFrom-Json
    $jPages = (Invoke-WebRequest -Uri $pages -UseBasicParsing).Content | ConvertFrom-Json
    
    Write-Host ("RAW  generatedAt: {0}" -f $jRaw.generatedAt) -ForegroundColor Green
    Write-Host ("PAGES generatedAt: {0}" -f $jPages.generatedAt) -ForegroundColor Green
    
    if ($jRaw.generatedAt -ne $jPages.generatedAt) {
        $verdict = "FAIL"
        $reason += "generatedAt mismatch (RAW=$($jRaw.generatedAt) vs PAGES=$($jPages.generatedAt))"
    }
} catch {
    $verdict = "FAIL"
    $reason += "failed to fetch/parse JSON: $_"
}

Write-Host "`n" -NoNewline
if ($verdict -eq "PASS") {
    Write-Host "VERDICT: PASS" -ForegroundColor Green
} else {
    Write-Host "VERDICT: FAIL" -ForegroundColor Red
    Write-Host "Reason: $($reason -join ', ')" -ForegroundColor Red
}

exit ($verdict -eq "PASS" ? 0 : 1)
