# 03 – Data pipeline (generování dat)

## Výstupy (co runtime načítá)

Primární publikovaná data jsou v `projects/data/`:

- `projects/data/articles.json` (required)
- `projects/data/videos.json` (optional)
- `projects/data/brief.json`
- `projects/data/meta.json`
- `projects/data/feed_health.json`
- `projects/data/weather.json`
- `projects/data/namedays.json`
- `projects/data/_probe.txt` (heartbeat marker)

## Transformace (jak se data „čistí“)

### Runtime normalizace (browser)

V `assets/app.js` je validace/filtrace položek feedu (např. URL validace + fallback title) – viz `normalizeArticleList()` v `02-runtime-architecture.md`.

### Build normalizace (pipeline)

Repo obsahuje skripty pro generování a validaci JSON:

- `scripts/build_articles.py` / `scripts/build_articles_v2.py`
  - generuje `articles.json` + vedlejší soubory jako `brief.json`, `meta.json`, `feed_health.json`
- `scripts/update-weather-namedays.js`
  - generuje `weather.json` a `namedays.json` (node)
- `scripts/json_validator.py`, `scripts/validate_json.py`
  - validační utility (schéma, required keys, URL, title)

## Spouštění (kdy a kde)

### GitHub Actions (cron/dispatch)

- `update-articles.yml`
  - **trigger**: `schedule` každých 15 minut + `workflow_dispatch`
  - **spouští**: `python scripts/build_articles.py`
  - **commit/push**: změny v `projects/data/` commitne a pushne na `main`

- `update-weather.yml`
  - **trigger**: `schedule` každých 15 minut + `workflow_dispatch`
  - **spouští**: `node scripts/update-weather-namedays.js weather`
  - **commit/push**: změny commitne a pushne na `main`

- `update-namedays.yml`
  - **trigger**: denně (cron `"5 23 * * *"`) + `workflow_dispatch`
  - **spouští**: `node scripts/update-weather-namedays.js namedays`
  - **commit/push**: změny commitne a pushne na `main`

### Lokálně

- `scripts/local_build_data.ps1`: lokální build + sanity proof pro `projects/data/articles.json`
- `run_infoUzel_pipeline.cmd`: wrapper pro lokální pipeline (ops)

## Freshness (jak poznat, že data jsou „čerstvá“)

- **`generatedAt`** v JSON (minimálně `articles.json` je kontrolováno v Pages sanity check).
- CI workflow `ci-data-freshness.yml`:
  - čte `generatedAt`/`updatedAt`/`builtAt` (nebo fallback na mtime) a hlídá max age (default 120 minut).
- `_probe.txt` v `projects/data/`:
  - zapisuje se při update pipeline běhu (`update-articles.yml`) jako marker.

