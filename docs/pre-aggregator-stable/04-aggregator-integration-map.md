# Mapa integračních bodů agregátoru (pro budoucí přestavbu)

Tato mapa **nemění** runtime. Slouží jako kontrakt: co musí nový agregátor zachovat nebo migrovat.

## 1) Autoritativní data (GitHub Pages)

| Cesta | Role |
|-------|------|
| `projects/data/articles.json` | Legacy/compat bundle (stále čteno některými guardy/diagnostikou) |
| `projects/data/article_feed_chunks/manifest.json` | Homepage feed entry (`IU_HOMEPAGE_FEED_DATA_FILE` v `assets/app.js`) |
| `projects/data/article_feed_chunks/<section>/<NNN>.json` | Sharded chunks (load-more / BG preload) |
| `projects/data/publishable_pool.json` | Fast-pool publish surface |
| `projects/data/videos.json` | Video feed |
| `projects/data/weather.json` / `namedays.json` / `feed_health.json` | Související panely |

Frontend **nesmí** číst `data/` ani `filtr/data/` (legacy odstraněno).

## 2) Klientské načítání

| Bod | Soubor | Poznámka |
|-----|--------|----------|
| Feed file resolve | `assets/app.js` | `article_feed_chunks/` preferováno; articles/videos/publishable_pool whitelist |
| Chunk loader | `assets/iu-article-chunk-loader.js` | Memory buffer + DOM reveal; test hook `__IU_GUARD_PAUSE_BG_PRELOAD` |
| Offline last-good | `sw.js` → `FEED_OFFLINE_CACHE` | Durable napříč deployi |
| Image offline | `sw.js` → `IMG_OFFLINE_CACHE` | Cap entries |

## 3) Pipeline / Data Bot

| Workflow | Účel |
|----------|------|
| `update-articles.yml` | Hlavní generace článků → `projects/data/*` |
| `update-articles-fast-pool.yml` | Fast publish pool |
| concurrency | `data-writers-${{ github.ref }}` — žádné kolize push |

## 4) Guardy agregátoru (ponechat)

- `articles-aggregator-freshness-guard`
- `articles-aggregator-infra-guard`
- `articles-continuous-update-guard` / schedule / watchdog
- `active-article-trace-guard`, `dedupe-loss-guard`, `section-coverage-guard`
- `article-entrypoint-parity-guard`
- `service-worker-articles-cache-guard`

## 5) Local-first (nesouvisí s feed JSON, ale s migrací UX)

| Key / store | Modul |
|-------------|-------|
| `iu.notes.store.v1` | Poznámky |
| `iu.tasks.mvp.v1` | Úkoly |
| `iu.calendar.store.v1` + IDB `iu.calendar.idb` | Kalendář |
| Backup export/import | `iu-user-data-backup-core.js` |

## 6) Paralelní provoz starý/nový agregátor

Při rebuild:
1. Zachovat chunk URL schéma nebo poskytnout adaptér.
2. Zachovat offline durable cache klíče nebo dual-read.
3. Neměnit `version.json` / SW wipe strategii bez plánu (viz SW v4: wipe versioned, keep durable).
4. Data Bot PR (#7550/#7551) nechat běžet — nejsou UI freeze.
