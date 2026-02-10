# 03 – Data pipeline (generování dat)

## Výstupy (co runtime načítá)

Primární publikovaná data jsou v `projects/data/` (doloženo `git ls-files projects/data`):

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

- `scripts/build_articles.py`
  - default output dir: `scripts/build_articles.py:26-28` → `projects/data`
  - výstupy: `scripts/build_articles.py:30-36` → `articles.json`, `feed_health.json`, `brief.json`, `meta.json`, `videos.json`
- `scripts/update-weather-namedays.js`
  - output dir: `scripts/update-weather-namedays.js:141-145` (`weather.json`) a `scripts/update-weather-namedays.js:178-183` (`namedays.json`)
- `scripts/json_validator.py`, `scripts/validate_json.py`
  - validační utility (schéma, required keys, URL, title)

## Spouštění (kdy a kde)

### GitHub Actions (cron/dispatch)

- `update-articles.yml`
  - **trigger**: `schedule` každých 15 minut + `workflow_dispatch`
  - **spouští**: `python scripts/build_articles.py` (`.github/workflows/update-articles.yml:43-44`)
  - **commit/push**: změny v `projects/data/` commitne a pushne na `main`

- `update-weather.yml`
  - **trigger**: `schedule` každých 15 minut + `workflow_dispatch`
  - **spouští**: `node scripts/update-weather-namedays.js weather` (`.github/workflows/update-weather.yml:41-45`)
  - **commit/push**: změny commitne a pushne na `main`

- `update-namedays.yml`
  - **trigger**: denně (cron `"5 23 * * *"`) + `workflow_dispatch`
  - **spouští**: `node scripts/update-weather-namedays.js namedays` (`.github/workflows/update-namedays.yml:41-45`)
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

## Vstupy (zdroje) – doloženo v kódu

- feeds pro články/video pipeline:
  - `scripts/build_articles.py:21-24` → `scripts/feeds.json` a `scripts/feeds_youtube.json`
- počasí:
  - `scripts/update-weather-namedays.js:71-78` → Open-Meteo endpoint (Praha)
- svátky / namedays (pipeline):
  - `scripts/update-weather-namedays.js:156-164` → offline dataset `scripts/data/namedays-cz.json`

## Poznámka k runtime zdrojům (oddělené od pipeline)

- Denní panel v runtime fetchuje nameday i z externího endpointu:
  - `assets/app.js:3320` → `fetch("https://svatky.adresa.info/json", ...)`

