# infoUzel.cz — project structure & audit

## Single Source of Truth

- **HTML entrypoint:** `projects/index.html` is the production page served to visitors; it loads `/assets/app.css` and `/assets/app.js` with explicit cache-bust `?v=` parameters. Root `index.html` exists as a simple landing page but only talks to the same `/assets/` bundle. The only HTML allowed to boot the SPA is `projects/index.html`; others (root or docs copies) are maintenance/preview helpers and **must not** embed alternate pipelines.
- **Assets:** `/assets/app.js`, `/assets/app.css` are the canonical scripts/styles. They are the only bundles referenced anywhere in production HTML.
- **Data:** `/projects/data/articles.json` and `/projects/data/videos.json` are the authoritative data feeds. Every fetch target in `assets/app.js` (probe URLs, `timeoutFetch`, `fetchArticlesStatus`, etc.) resolves to `/projects/data/...` endpoints, and the build ensures only this folder contains the live JSON.
- **Service worker:** `sw.js` lives at repo root and is referenced via the `BASE`-aware loader inside `assets/app-crash-shield.js`. The register call is currently gated (the file still exists, but bootstrapping is temporarily skipped to avoid blank-screen regressions). SW caching is still orchestrated from `assets/app.js` via `nukeCachesAndSwOnBuildChange()` and `scheduleSWReload()`; `sw.js` enumerates caches and respond to fetch; tie-ins are documented in the crash shield script.
- **Workflows:** `.github/workflows/update-articles.yml` owns the data pipeline (build articles/videos, normalize, push to `projects/data`). `.github/workflows/repo-guard.yml` (new) enforces duplication, data, and cache-bust rules.

## Production tree (depth ≥ 5)

```
/
├── docs/
│   ├── STRUCTURE.md
│   ├── MAINTENANCE.md
│   ├── CHANGELOG.md
│   ├── ... (existing reports, verification guides)
├── .github/
│   └── workflows/
│       ├── update-articles.yml
│       ├── repo-guard.yml
│       └── ... (health-check, pages, etc.)
├── assets/
│   ├── app.css
│   ├── app.js
│   └── app-crash-shield.js
├── projects/
│   ├── index.html
│   └── data/
│       ├── articles.json
│       ├── videos.json
│       └── _probe.txt
├── scripts/
│   ├── build_articles.py
│   ├── build_articles_v2.py
│   ├── local_build_data.ps1
│   ├── repo_guard.py
│   ├── update-weather-namedays.js
│   └── ... (data layer, validators, helpers)
├── sw.js
└── projects/data/
    ├── articles.json
    ├── videos.json
    └── _probe.txt
```

Focus directories:

- `.github/workflows/` — update & guard pipelines.
- `assets/` — single-source bundle + crash shield loader.
- `projects/`/`projects/data/` — served HTML + canonical JSON.
- `scripts/` — data generators, backups, repo guard, validators.

## Duplicity audit

| Group | Paths | Size | SHA256 | Active usage |
| --- | --- | --- | --- | --- |
| `index.html` | `index.html` (root, landing) vs. `projects/index.html` (production) | 48 152 / 954 bytes | `3FA3…F927` / `4E29…E1B6` | Production HTML is `projects/index.html` (it loads `/assets/app.js`, `/assets/app.css`). Root `index.html` only renders a lightweight landing and does not trigger the `projects/` pipeline. |
| `app.js` / `app.css` | `assets/app.js`, `assets/app.css` | 96 712 / 43 128 bytes | `858A…CD854` / `AD6E…A47B` | Both files are referenced exclusively from `projects/index.html` (see the `<link>` and `<script>` tags) and no other copies exist. |
| Service worker | `sw.js` | 9 572 bytes | `0830…7B47` | `assets/app-crash-shield.js` (lines 440‑485) prepares registration via `${BASE}sw.js`. Registration is currently gated (`registerSW()` returns early), but the file remains the SW entry point for future use. No `service-worker.js` duplicates exist. |
| Data JSON | `projects/data/articles.json` / `projects/data/videos.json` | 105 284 / 5 388 bytes | `4C07…7CB7` / `8E28…6E0F` | `assets/app.js` fetches them via `/projects/data/...` (lines 1768‑2016). No other JSON copies exist (root `data/` or `filtr/data/` were removed). |
| Feeds | `scripts/feeds.json`, `scripts/feeds_youtube.json` | 2 059 / 241 bytes | `6846…480F` / `E40D…23FD1` | `scripts/build_articles.py` reads both files (`FEEDS_PATH`, `FEEDS_YOUTUBE_PATH`). |
| Crash / shield / backup | `assets/app-crash-shield.js` (19 667 bytes, `B393…E96C`), `scripts/make_backup.py` (1 480 bytes, `2EF1…1831`) | Not duplicated | `app-crash-shield.js` wraps `assets/app.js` with emergency rendering logic; `make_backup.py` rotates snapshots from `projects/data`. |
| Manifests | `manifest.webmanifest`, `manifest.json` | Not present | N/A | These files are not in the repo; no references exist (search returns no matches). |

## Data flow (end-to-end)

1. **Generation:** `scripts/build_articles.py` (invoked by `.github/workflows/update-articles.yml`) writes to `projects/data/articles.json`, `videos.json`, `meta.json`, `brief.json`, `feed_health.json` and feeds `_probe.txt`. `update-weather-namedays.js` supplements `projects/data/weather.json` and `namedays.json`. The workflow runs on schedule/dispatch, normalizes the outputs, verifies non-empty payloads, commits, and pushes changes.
2. **Consumption:** `assets/app.js` loads `/projects/data/articles.json` and `/projects/data/videos.json` (and optionally `feed_health`/`probe`). Several helpers (`fetchArticlesStatus`, `fetchVideosStatus`, `timeoutFetch`, `withCacheBust`) target `/projects/data/...` exclusively; there are no `/data/` or `/filtr/data/` fetches anymore.
3. **Cache bust:** `projects/index.html` appends `?v=` to `/assets/app.css` and `/assets/app.js`. `assets/app.js` also applies `withCacheBust()` and `withTs()` before invoking `fetch`. The repo guard enforces the presence of `?v=` tags.
4. **SW impact:** `assets/app.js` monitors the service worker via `nukeCachesAndSwOnBuildChange()`, `watchForSWUpdates()`, and status badges. Crash shield loads before `assets/app.js` and can unregister/kill the SW for emergency rendering.

## Workflows & automation

- `.github/workflows/update-articles.yml` — authoritative data build/deploy. It runs the Python builders, ensures `projects/data/*.json` exist and are non-empty, and commits the results.
- `.github/workflows/repo-guard.yml` — enforces duplication/data/cache-bust rules via `scripts/repo_guard.py`.
- (Other workflows such as `pages.yml` or `health-check.yml` are monitoring/preview helpers.)

## Maintenance checklist

1. After every JS/CSS change: bump the `?v=` on `/assets/app.css` and `/assets/app.js` inside `projects/index.html`.
2. After every data pipeline change: ensure `/projects/data/articles.json` and `/projects/data/videos.json` exist, contain the expected keys (`articles`/`videos` as arrays plus `generatedAt`), and are non-empty.
3. After any `sw.js` change: run a hard refresh (Ctrl+F5), disable cache, and/or update the service worker via the debug panel to confirm the new worker installs.
4. Run `scripts/repo_guard.py` locally (or rely on the `repo-guard` workflow) to confirm duplication/data/cache rules pass before pushing.
5. When troubleshooting `assets/app.js`, open `?debug=1`; the debug panel emits `[LOAD]`, `[FILTER]`, `[RENDER]`, `[ERR]` prefixes to prove the render path runs once and data fetch logs show status/200.

## Ambiguity / Decisions

- There are two `index.html` variants. `projects/index.html` is the production SPA entry and references `/projects/data`. The root `/index.html` serves as a minimal landing/diagnostic page — it intentionally loads the same `/assets/app.js` bundle but is **not** considered part of the `projects/` pipeline. `repo_guard.py` treats `projects/index.html` as the canonical SPA loader and flags any additional `projects/index.html` copies; the root `index.html` is documented here as a deliberate landing page.
