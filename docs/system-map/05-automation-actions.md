# 05 – Automation actions (GitHub Actions / build / deploy)

## Workflow soubory

V repu jsou tyto workflow soubory v `.github/workflows/`:

- `pages.yml`
- `update-articles.yml`
- `update-weather.yml`
- `update-namedays.yml`
- `repo-guard.yml`
- `health-check.yml`
- `ci-heartbeat.yml`
- `ci-data-freshness.yml`
- `ci-workflow-lint.yml`

## Co který workflow dělá

### Deploy

- **`pages.yml`**
  - **trigger**: `workflow_dispatch`
  - **účel**: deploy repa na GitHub Pages
  - **guardrails**: sanity check `projects/data/articles.json` (required, non-empty, valid JSON + `generatedAt`), `videos.json` optional
  - **artefakt**: uploaduje celý repo obsah jako Pages artefakt

### Data pipeline (writers)

- **`update-articles.yml`**
  - **trigger**: `schedule` každých 15 minut + `workflow_dispatch`
  - **spouští**: Python pipeline (`scripts/build_articles.py`)
  - **mění**: `projects/data/*` (včetně `_probe.txt`)
  - **publikace**: commit/push do `main`

- **`update-weather.yml`**
  - **trigger**: `schedule` každých 15 minut + `workflow_dispatch`
  - **spouští**: Node updater (`scripts/update-weather-namedays.js weather`)
  - **mění**: `projects/data/weather.json`
  - **publikace**: commit/push do `main`

- **`update-namedays.yml`**
  - **trigger**: denně + `workflow_dispatch`
  - **spouští**: Node updater (`scripts/update-weather-namedays.js namedays`)
  - **mění**: `projects/data/namedays.json`
  - **publikace**: commit/push do `main`

### Guard / CI

- **`repo-guard.yml`**
  - **trigger**: `push` na `main`, `pull_request`, `workflow_dispatch`
  - **spouští**: `python scripts/repo_guard.py`
  - **účel**: detekce duplicit, integrita dat, pravidla pro cache-bust a strukturu

- **`health-check.yml`**
  - **trigger**: `schedule` každých 15 minut + `workflow_dispatch`
  - **účel**: kontrola existence `projects/data/weather.json` a `projects/data/namedays.json`

- **`ci-heartbeat.yml`**
  - **trigger**: `schedule` každých 15 minut + `workflow_dispatch` + `push` (jen na změny workflow souboru)
  - **účel**: ověří, že endpoints `https://infouzel.cz/projects/data/articles.json` (required) a `videos.json` (optional) jsou dostupné

- **`ci-data-freshness.yml`**
  - **trigger**: `schedule` každých 15 minut + `workflow_dispatch` + `push` (jen na změny workflow souboru)
  - **účel**: kontrola „stáří“ dat (default max age 120 min) podle timestampů v JSON nebo fallback podle mtime

- **`ci-workflow-lint.yml`**
  - **trigger**: `schedule` + `workflow_dispatch` + `push` (konkrétní cesty)
  - **účel**: lint/validace workflow definic (viz soubor pro detaily)

## Operational poznámky

- **Cache headers**: v repu není explicitní serverová konfigurace; u GitHub Pages se typicky řídí defaulty CDN/Pages. Prakticky se spoléhá na:
  - querystring cache-bust pro runtime assets v `projects/index.html` (např. `app.css?v=...`, `app.js?v=...`)
  - SW logiku (`sw.js`) + runtime hard reset při změně build stamp (`assets/app.js`)

- **Verzování assetů**
  - `projects/index.html` používá query `?v=...` pro `assets/app.css` a `assets/app.js`
  - build stamp je i v `<meta name="iu-build" ...>`

