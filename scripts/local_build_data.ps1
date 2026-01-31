$ErrorActionPreference = "Stop"

Write-Host "PWD: $(Get-Location)"

# 1) Spusť build_articles.py
python scripts/build_articles.py

# 2) Najdi kandidáty na articles.json
$candidates = @(
  "projects/data/articles.json",
  "filtr/data/articles.json",
  "filtr/filtr/data/articles.json",
  "filtr/filtr/filtr/data/articles.json",
  "data/articles.json"
) | Where-Object { Test-Path $_ }

Write-Host "Found candidates:"
$candidates | ForEach-Object {
  $len = (Get-Item $_).Length
  Write-Host " - $_ ($len bytes)"
}

if (-not (Test-Path "projects/data")) {
  New-Item -ItemType Directory -Path "projects/data" | Out-Null
}

# 3) Pokud projects/data/articles.json neexistuje, zkopíruj první nalezený kandidát
if (-not (Test-Path "projects/data/articles.json")) {
  if ($candidates.Count -eq 0) { throw "No articles.json generated anywhere." }
  Copy-Item -Force $candidates[0] "projects/data/articles.json"
  Write-Host "Copied to projects/data/articles.json from $($candidates[0])"
} else {
  Write-Host "projects/data/articles.json already exists (generated directly)."
}

# 4) PROOF
$size = (Get-Item "projects/data/articles.json").Length
Write-Host "PROOF size bytes: $size"

python - <<'PY'
import json
p="projects/data/articles.json"
d=json.load(open(p,"r",encoding="utf-8"))
arts=d.get("articles",[])
print("PROOF generatedAt:", d.get("generatedAt"))
print("PROOF articles_count:", len(arts))
if arts:
    print("PROOF first_title:", arts[0].get("title"))
    print("PROOF first_publishedAt:", arts[0].get("publishedAt"))
PY
