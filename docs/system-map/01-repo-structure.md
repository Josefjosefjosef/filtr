# 01 – Repo structure (folders + purpose)

Zdroj pravdy pro strom souborů: `docs/system-map/_tree.txt`.

## Top-level struktura (výběr)

- **`.github/`**
  - **`.github/workflows/`**: CI, data update cron, repo guard, Pages deploy (viz `05-automation-actions.md`)
  - **`pull_request_template.md`**: PR template

- **`.cursor/`**
  - pravidla pro workflow agenta (`.cursor/rules/workflow-auto-pr.mdc`)

- **`assets/`** (runtime)
  - `app.js`: hlavní runtime logika (fetch dat, render feedu, UI init, diagnostika)
  - `app.css`: hlavní styly (CLS guards, layout, MindMenu, Daily panel)
  - `app-crash-shield.js`: ochrany/diagnostika v runtime (včetně SW operací)
  - `app-render-optimizer.js`: optimalizace renderu

- **`projects/`** (produkční web)
  - `projects/index.html`: hlavní HTML entrypoint pro návštěvníky
  - **`projects/data/`**: publikovaná data pro web (`articles.json`, `videos.json`, `brief.json`, `weather.json`, `namedays.json`, `meta.json`, `feed_health.json`, `_probe.txt`)

- **`data/`** (alternativní / podpůrná data)
  - obsahuje např. `brief.json`, `weather.json`, `namedays.json`, `meta.json` apod.
  - v runtime se preferují URL pod `https://infouzel.cz/projects/data/...` (viz `assets/app.js`)

- **`scripts/`** (build/pipeline)
  - `build_articles.py` / `build_articles_v2.py`: generování `projects/data/articles.json` (+ `brief.json`, `meta.json`, `feed_health.json`)
  - `update-weather-namedays.js`: generování `projects/data/weather.json` a `projects/data/namedays.json`
  - `repo_guard.py`: kontrola duplicit / cache-bust / integrita dat (spouští workflow `repo-guard`)
  - `scripts/requirements.txt`: Python dependencies pro pipeline

- **`tools/`** (developer tooling)
  - `agent-run.ps1`: one-shot runner pro PR/checks + noční autopilot tasky
  - `ensure-gh-and-pr.ps1`: helper (gh install/auth, create/find PR, checks)

- **`docs/`**
  - historické reporty, audity, struktura, postupy
  - **`docs/system-map/`**: tato „živá“ dokumentace

- **`sw.js`** (runtime)
  - Service Worker: caching strategie a TTL pro JSON (viz `02-runtime-architecture.md`)

## Kdo co používá (rychlá orientace)

- **Runtime (browser)**: `projects/index.html`, `assets/app.js`, `assets/app.css`, `assets/app-crash-shield.js`, `assets/app-render-optimizer.js`, `sw.js`, `debug.js`
- **Build/pipeline**: `scripts/*`, `.github/workflows/*`, `config/*`
- **Automation/ops**: `.github/workflows/*`, `scripts/repo_guard.py`, `run_infoUzel_pipeline.cmd`

