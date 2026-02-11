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

function Write-NormalizedUtf8File {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Text
  )

  # Normalize helper names (must be __iu*)
  $raw = $Text
  $raw = $raw -replace "window\.(?:_)?iuDumpCLS", "window.__iuDumpCLS"
  $raw = $raw -replace "window\.(?:_)?iuClearCLS", "window.__iuClearCLS"

  # Fail-fast validation
  if ($raw -match "window\.(?:_)?iu(DumpCLS|ClearCLS)") {
    throw "capture output still contains iu*/_iu* helper names after normalization"
  }

  # Single write
  Set-Content -Encoding UTF8 -Path $Path -Value $raw
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

$outPath = Join-Path $tmpDir "cls_runtime_capture.txt"
$ts = (Get-Date).ToString("s")

$content = @"
timestamp: $ts
debugUrl: $urlDebug
prodUrl: $urlProd

Opened both URLs in the default browser.

NOTE: THE COMMANDS BELOW MUST BE RUN IN BROWSER DEVTOOLS CONSOLE (JS), NOT IN POWERSHELL

DEBUG (/projects/?debug=1)
- Open DevTools -> Console
- Hard reload: Ctrl+F5

DevTools Console:
if (window.__iuClearCLS) window.__iuClearCLS();
location.reload();

(after reload)
window.__iuDumpCLS()

clipboard variant:
copy(JSON.stringify(window.__iuDumpCLS(), null, 2))

Paste DEBUG JSON below:
--- BEGIN DEBUG DUMP ---
--- END DEBUG DUMP ---

PROD (/projects/)
- Open DevTools -> Console
- Hard reload: Ctrl+F5

DevTools Console:
window.__iuDumpCLS ? window.__iuDumpCLS() : { note: "__iuDumpCLS not present (expected in prod)" }

clipboard variant:
copy(JSON.stringify(window.__iuDumpCLS ? window.__iuDumpCLS() : { note: "__iuDumpCLS not present (expected in prod)" }, null, 2))

Paste PROD JSON below:
--- BEGIN PROD DUMP ---
--- END PROD DUMP ---

WHAT TO PASTE BACK INTO CHATGPT
- Paste DEBUG JSON
- Paste PROD JSON
- Then check Console filter: [IU][CLS][real-total] and report YES/NO + count
"@

Write-NormalizedUtf8File -Path $outPath -Text $content

Write-Host ("Wrote " + $outPath)

try { Start-Process notepad.exe $outPath } catch {}

