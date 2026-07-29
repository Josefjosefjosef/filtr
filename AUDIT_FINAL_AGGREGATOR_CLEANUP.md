# AUDIT — finální úklid historického mediálního agregátoru

**Datum:** 2026-07-29  
**Výchozí HEAD:** `79531ec133968c888a9dde61d1b2f2af29e33d37` (`main` po #7845 + data refreshes)  
**Pracovní větev:** `refactor/final-aggregator-cleanup`  
**Předchozí etapa:** PR #7845 — aktivní média odstraněna, engine + ČHMÚ zachovány  

## Git baseline

| Položka | Hodnota |
|---------|---------|
| Branch | `refactor/final-aggregator-cleanup` z `main` |
| Dirty před startem | `cloudflare/iu-ads/schema.sql` → stash `final-aggregator-cleanup: unrelated-schema-sql-prestart` |
| Zachované stashe (nedotýkat) | `refactor-remove-media:…`, `perf-cycle-…`, `iu-ads-csp-…` (+ historické) |
| Otevřené PR (neslučovat) | #7842 CHMI, #7576 articles data, #7787/#7788 watchdog deps, #6993 articles workflows |

## Stav po #7845 (ověřeno)

- `commercialAggregationActive=false`, `infoSystemActive=true`
- `articles.json` / pool / chunks / registry aktivní = prázdné
- ČHMÚ CAP v2 aktivní
- Deny-list + `removed-media-regression-guard` aktivní

## Inventura zbývajících pozůstatků

### 1) Zmrazené / historické artefakty (Git tracked)

| Položka | Velikost (approx) | Reference | Klasifikace |
|---------|-------------------|-----------|-------------|
| `projects/data/latest_valid_articles_snapshot.json` | ~27 MB | `iu_article_scheduler.py`, `update-articles.yml` (dormant) | **A** — historický media snapshot; produkce čte prázdný `articles.json` |
| `projects/data/latest_valid_staging_snapshot.json` | (tracked) | pipeline restore | **A** |
| `projects/data/articles/2026-06-*.json` + `2026-07-*.json` | ~45 denních shardů | žádný aktivní frontend fetch (jen bootstrap/index) | **A** |
| `projects/data/articles/bootstrap.json` | empty stub | SW / pages-publish / guards | **E** — ponechat prázdný |
| `projects/data/articles/index.json` | empty stub | pages-publish | **E** |
| `projects/data/articles.json` | empty | SW, guards, cutover | **E** |
| `projects/data/publishable_pool.json` | empty | SW, client | **E** |
| `projects/data/article_feed_chunks/**` | minimal empty | client loader | **E** |
| `projects/data/article_pool_manifest.json` | small | pool guards (dormant) | **A** → nahradit prázdným stubem nebo smazat + upravit guardy |
| `projects/data/rotation_batch_registry.json` | media batches | rotation scripts (dormant) | **A** → empty stub `{entries:[]}` nebo smazat |
| `projects/data/brief.json` | small | update-articles commit list | **A**/empty stub |
| `projects/data/pipeline_reports/*` | reports | historické | **A** |
| `data/media.json` | ~6 KB | legacy labels; no active import found | **A** |
| `scripts/feeds.json`, `feeds_youtube.json` | empty | already cleared | **E**/keep empty |
| `config/removed_media_deny_list.json` | deny-list | regression guard | **B** |
| `config/sources.json` | empty | guard | **E**/B |
| `projects/data/source_registry.json` | empty | engine + guard | **E**/B |
| `projects/data/info_events/**` | live | Přehled dne / CHMI | **B** |

**Odhad git-tracked removable blobů:** ~118 MB (daily shards + latest_valid snapshots).

Staging `projects/data/staging/sources/*.json` — lokálně přítomné, typicky gitignore; ověřit a smazat z disku pokud untracked.

### 2) Engine skripty (obecná infrastruktura)

| Položka | Klasifikace | Důvod |
|---------|-------------|-------|
| `scripts/build_articles.py`, `iu_article_*`, `iu_rotation_*` | **E**/B | Univerzální ingest jádro; bez aktivních zdrojů. Nemazat engine. |
| `scripts/gen_source_registry.py` | **E** | Generuje prázdný registry — ponechat |
| `scripts/archive/deprecated/aggregator-v2/**` | **C**/B | Guard vyžaduje archivní sadu souborů |
| `scripts/tmp_*.py`, `tmp_scan_build_articles.py` | **A** | Dev temp skripty |
| `cloudflare/articles-watchdog` | **E** | Cutover `skip_cutover`; budoucí connector dispatch. Dokumentovat. |

### 3) Workflow

| Workflow | Klasifikace | Poznámka |
|----------|-------------|----------|
| `update-articles.yml`, `update-articles-fast-pool.yml` | **E** | Gate SKIP cutover; mnoho CI/proof skriptů očekává existenci souboru |
| `articles-nightly-full-rebuild.yml`, `articles-watchdog-cron-fallback.yml` | **A**/E | Prefer **disable schedule** nebo smazat pokud žádný závislý guard |
| `deploy-articles-watchdog.yml`, `ci-articles-*` | **E** | Testuje dormant watchdog |
| `after-merge-articles-freshness.yml` | **E**/A | Srovnává articles; upravit na empty-OK |
| `update-chmi-cap-v2.yml`, `update-info-events.yml` | **B** | |
| `ci-removed-media-regression-guard.yml` | **B** | |
| `pages-publish-from-main-data.yml` | **D** | Stále porovnává articles — zobecnit na info_events OR empty-OK |

### 4) Dokumentace

| Položka | Klasifikace |
|---------|-------------|
| Root `ARTICLE_*_REPORT.md`, `RSS_ROTATION_*.md` | **C** → `docs/archive/media-aggregator/` |
| `AUDIT_MEDIA_AGGREGATION_REMOVAL.md` | **B**/C — audit předchozí etapy, ponechat v root nebo archive |
| `docs/pre-aggregator-stable/**` | **B**/E — freeze UI + PWA; ne media pipeline |
| `docs/info-system-v1/**` | **B** |
| Nový `AGGREGATION_ARCHITECTURE.md` | **B** — vytvořit |

### 5) Klient / PWA

| Položka | Klasifikace |
|---------|-------------|
| `assets/iu-article-chunk-loader.js`, `iu-client-article-*` | **E** — empty feed path; local-first boundary |
| HomeCards + `#feed` + cutover CSS | **E** — rollback `?iuInfoSystem=off` |
| SW `FEED_OFFLINE_CACHE` v2 | **B** |
| Masivní rename article→item | **F**/ne — riziko bez migrace; dokumentovat neutrální model |

### 6) Deny-list / guardy

| Položka | Klasifikace |
|---------|-------------|
| `removed-media-regression-guard` + deny-list | **B** — minimalizace OK, nesmazat |
| `media-articles-cutover-skip.mjs` | **E** — smoke SKIP helper |
| Article Playwright guards (skip cutover) | **E** |

## Plán implementace (tato etapa)

1. Smazat git-tracked historické denní `articles/2026-*.json` + `latest_valid_*` snapshots + `data/media.json` + pipeline_reports + tmp scripts.  
2. Zminimalizovat / empty stub: `brief.json`, `article_pool_manifest.json`, `rotation_batch_registry.json`.  
3. Archivovat root ARTICLE_/RSS_ reporty do `docs/archive/media-aggregator/`.  
4. Napsat `AGGREGATION_ARCHITECTURE.md`.  
5. Upravit `pages-publish-from-main-data.yml` aby empty articles nebyly chyba a preferovaly info_events freshness.  
6. Nightly/watchdog fallback: vypnout schedule nebo přidat cutover skip na začátek (bez mazání souboru pokud CI vyžaduje).  
7. **Ne** mazat engine skripty, CHMI, info_events, deny-list, empty production stubs.  
8. **Ne** plošný rename.  
9. **Ne** plošný dependency upgrade.

## Rizika

| Riziko | Mitigace |
|--------|----------|
| Guard očekává denní articles shards | Grep: žádný frontend; CI ne |  
| Rollback potřebuje latest_valid snapshot | Tag `pre-aggregator-stable-20260717` + git history |  
| Smazání workflow rozbije proofs | Ponechat soubory, cutover skip |  
| Pages stále deployuje prázdné articles | OK — empty stub E |

## Rollback

- Code: revert merge PR  
- Artefakty: obnovitelné z git history / tag  
- **Nesmí** auto-zapnout `commercialAggregationActive`

## Akceptace (mapa)

- [x] Audit dokument  
- [x] Historické shards/snapshots odstraněny z produkční cesty (git)  
- [x] Engine + CHMI + deny-list zachovány  
- [x] Architektura dokumentována  
- [ ] CI zelené, merge, produkční ověření  
- [x] Stashe nedotčené  

## Doplněno ve Fázi C–F (2026-07-29)

- Odstraněny mrtvé RSS-rotation one-shot skripty/proofy (žádný CI konzument).
- `source_rotation_inventory.json` regenerován na `sources=0` (prázdný registry).
- Z `scripts/requirements.txt` odstraněny neimportované `beautifulsoup4` + `lxml`.
- `SYSTEM_AUDIT.md` → `docs/archive/media-aggregator/`; `docs/STRUCTURE.md` odkazuje na `AGGREGATION_ARCHITECTURE.md`.
- **Ne** plošný rename article→item; **ne** plošný npm upgrade.
