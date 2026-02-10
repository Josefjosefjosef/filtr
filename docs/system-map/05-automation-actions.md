# 05 – Automation actions (GitHub Actions / build / deploy)

## Workflow soubory

V repu jsou tyto workflow soubory v `.github/workflows/` (doloženo `git ls-files .github/workflows`):

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

### `pages.yml`

- **triggers**: `workflow_dispatch`
- **jobs**: `deploy`
- **hlavní kroky**:
  - sanity check `projects/data/articles.json` (required, non-empty, valid JSON + `generatedAt`) a `projects/data/videos.json` (optional)
  - sanity check kořene repa (`index.html`, `assets/`, `data/`, `sw.js`, `.nojekyll`, atd.)
  - upload artefaktu `path: .` a deploy přes `actions/deploy-pages@v4`

### `update-articles.yml`

- **triggers**: `workflow_dispatch`, `schedule` (`*/15 * * * *`)
- **jobs**: `build`
- **hlavní kroky**:
  - `actions/setup-python@v5` (3.11) + `pip install -r scripts/requirements.txt`
  - spustí `python scripts/build_articles.py`
  - normalizace/validace výstupů v `projects/data/` a zápis `_probe.txt`
  - commit & push změn do `main` (safe rebase + retry)

### `update-weather.yml`

- **triggers**: `workflow_dispatch`, `schedule` (`*/15 * * * *`)
- **jobs**: `update`
- **hlavní kroky**:
  - `actions/setup-node@v4` (node 20)
  - spustí `node scripts/update-weather-namedays.js weather` s `OUTPUT_DIR=projects/data`
  - sanity check + JSON validate (python `json.load`)
  - commit & push změn do `main` (safe rebase + retry)

### `update-namedays.yml`

- **triggers**: `workflow_dispatch`, `schedule` (`5 23 * * *`)
- **jobs**: `update`
- **hlavní kroky**:
  - `actions/setup-node@v4` (node 20)
  - spustí `node scripts/update-weather-namedays.js namedays` s `OUTPUT_DIR=projects/data`
  - sanity check (počet klíčů >= 300) + JSON validate
  - commit & push změn do `main` (safe rebase + retry)

### `repo-guard.yml`

- **triggers**: `push` (jen `main`), `pull_request`, `workflow_dispatch`
- **jobs**: `guard`
- **hlavní kroky**:
  - `actions/setup-python@v5` (3.11)
  - spustí `python scripts/repo_guard.py`

### `health-check.yml`

- **triggers**: `workflow_dispatch`, `schedule` (`*/15 * * * *`)
- **jobs**: `check`
- **hlavní kroky**:
  - ověřuje existenci `projects/data/weather.json` a `projects/data/namedays.json`

### `ci-heartbeat.yml`

- **triggers**: `workflow_dispatch`, `schedule` (`*/15 * * * *`), `push` (jen změna tohoto workflow souboru)
- **jobs**: `heartbeat`
- **hlavní kroky**:
  - `curl` na produkční endpointy:
    - required: `https://infouzel.cz/projects/data/articles.json`
    - optional: `https://infouzel.cz/projects/data/videos.json`

### `ci-data-freshness.yml`

- **triggers**: `workflow_dispatch`, `schedule` (`*/15 * * * *`), `push` (jen změna tohoto workflow souboru)
- **jobs**: `freshness`
- **hlavní kroky**:
  - čte `projects/data/articles.json` (required) a `projects/data/videos.json` (optional)
  - kontroluje stáří podle timestampů v JSON (`generatedAt`/`builtAt`/`updatedAt`) nebo fallback na `mtime`

### `ci-workflow-lint.yml`

- **triggers**: `workflow_dispatch`, `schedule` (`17 3 * * *`), `push` (změny v `.github/workflows/**/*.yml|yaml`)
- **jobs**: `actionlint`
- **hlavní kroky**:
  - anti-log scan na forbidden tokeny v `.github/workflows/` (grep)
  - instalace `actionlint` přes upstream download script
  - `actionlint -color`

## Operational poznámky

- **Cache headers**: v repu není explicitní serverová konfigurace; u GitHub Pages se typicky řídí defaulty CDN/Pages. Prakticky se spoléhá na:
  - querystring cache-bust pro runtime assets v `projects/index.html` (např. `app.css?v=...`, `app.js?v=...`)
  - SW logiku (`sw.js`) + runtime hard reset při změně build stamp (`assets/app.js`)

- **Verzování assetů**
  - `projects/index.html` používá query `?v=...` pro `assets/app.css` a `assets/app.js`
  - build stamp je i v `<meta name="iu-build" ...>`

