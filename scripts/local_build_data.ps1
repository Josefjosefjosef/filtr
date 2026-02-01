$ErrorActionPreference = "Stop"

Write-Host "PWD: $(Get-Location)"

# 1) Spusť build_articles.py
python scripts/build_articles.py

# 2) Ensure projects/data/articles.json exists (built directly)
if (-not (Test-Path "projects/data")) {
  New-Item -ItemType Directory -Path "projects/data" | Out-Null
}

if (-not (Test-Path "projects/data/articles.json")) {
  throw "projects/data/articles.json missing; build must produce it directly."
}

Write-Host "projects/data/articles.json ready"

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
