$ErrorActionPreference = 'Stop'

$urlDebug = "https://infouzel.cz/projects/?debug=1"
$urlProd  = "https://infouzel.cz/projects/"

function Get-RepoRoot {
  try {
    $here = $PSScriptRoot
    if (-not $here) { return (Get-Location).Path }
    return (Resolve-Path (Join-Path $here "..\..")).Path
  } catch {
    return (Get-Location).Path
  }
}

Write-Host "Opening URLs..."
Start-Process $urlDebug
Start-Process $urlProd

try {
  $repoRoot = Get-RepoRoot
  Set-Location $repoRoot
} catch {}

$tmpDir = Join-Path (Get-Location).Path "tmp"
New-Item -ItemType Directory -Force $tmpDir | Out-Null

$outPath = Join-Path $tmpDir "cls_runtime_main.txt"
$ts = (Get-Date).ToString("s")

$content = @"
timestamp: $ts
debugUrl: $urlDebug
prodUrl: $urlProd

Opened both URLs in the default browser.

DEBUG (/projects/?debug=1)
- Open DevTools -> Console
- Reload (Ctrl+F5 then F5)
- Run:
  copy(JSON.stringify(window.__iuDumpCLS(), null, 2))
- Paste the clipboard JSON below:
--- BEGIN DEBUG DUMP ---
--- END DEBUG DUMP ---

PROD (/projects/)
- Open DevTools -> Console
- Reload (Ctrl+F5 then F5)
- Optional (expected to be absent in prod):
  copy(JSON.stringify(window.__iuDumpCLS ? window.__iuDumpCLS() : { note: '__iuDumpCLS not present (expected in prod)' }, null, 2))
- Paste below:
--- BEGIN PROD DUMP ---
--- END PROD DUMP ---
"@

Set-Content -Encoding UTF8 -Path $outPath -Value $content
Write-Host ("Wrote " + $outPath)

try { Start-Process notepad.exe $outPath } catch {}

