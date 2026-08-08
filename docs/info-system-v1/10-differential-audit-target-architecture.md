# Rozdílový audit — cílová architektura ověřených zdrojů

**Audited at:** 2026-07-19  
**Baseline (neměnit):** commit `5647bb3fe365a12feb4bb4d2830c6957de73c853`, tag `pre-aggregator-stable-20260717`  
**Aktuální main (po #7615):** `41829ebf5e` (Přehled dne V6)  
**Stabilizace dat (#7614):** uzavřela 96h / chronologii / evidence guard — **ne** cílovou architekturu.

Tento dokument je rozdílový audit mezi původním kompletním zadáním a skutečným stavem repozitáře + produkční cesty (GitHub Pages + statický JSON).  
**Není** důkazem dokončení cílové architektury.

Stavy: `implemented_and_proven` | `implemented_but_not_proven` | `partially_implemented` | `documentation_only` | `test_only` | `not_implemented` | `not_applicable_with_reason` | `blocked`

---

## A) Již vyřešené (neopakovat)

| Požadavek | Stav | Důkaz |
|-----------|------|-------|
| Klientská ochrana >96h u starého/stale feedu | `implemented_and_proven` | `assets/iu-info-system-core-v1.js` `filterEvents`; PR #7614 |
| Produkční feed bez běžné položky >96h po refreshi | `implemented_and_proven` | `docs/info-system-v1/09-data-stabilization-evidence.*` |
| Oddělení `published_at` / `first_seen_at` | `implemented_and_proven` | `applyChronology` v `scripts/iu-info-events-v2.mjs`; evidence items |
| Evidence guard (~30 kontrol) | `implemented_and_proven` | `scripts/iu-info-events-data-stab-evidence-guard.mjs` |
| Metriky fallbackTime / lowConfidence / futureTime / missing URL/instituce/skupina | `implemented_and_proven` | `monitoring.json` + doc 09 |
| Local-first pohledy / read / saved / scroll při V4→V5 (a V6 schema) | `implemented_and_proven` | core LS migrace; V6 zachovává read/saved/hidden/scroll |
| Fyzická zařízení | `not_implemented` → reportovat **NESPLNĚNO** | Playwright ≠ fyzické zařízení |

---

## B) Produkční cesta (současná pravda)

```text
Registry (JSON entries)
→ GitHub Action Update info events
→ scripts/iu-info-events-refresh.mjs (+ lib + v2)
→ atomický publish projects/data/info_events/*.json
→ FE fetch same-origin JSON (iu-info-system-core-v1.js)
→ localStorage local-first
```

**Není** produkční cestou: PostgreSQL, PostGIS, veřejné `/api/*`, SSE, raw object storage, admin audit UI.

Soubory pipeline:  
`scripts/iu-info-events-refresh.mjs`, `iu-info-events-lib.mjs`, `iu-info-events-v2.mjs`,  
`.github/workflows/update-info-events.yml`,  
`projects/data/info_events/{feed,manifest,metadata,monitoring,source_registry,taxonomy}.json` + `lanes/`,  
`assets/iu-info-system-core-v1.js`, `iu-prehled-dne-ui-v1.js`, `iu-prehled-dne-v1.css`.

---

## C) Kompletní tabulka požadavků (sekce 4–35 zadání)

| ID | Požadavek | Původní stav | Provedená změna v tomto PR | Finální stav | Důkaz |
|----|-----------|--------------|----------------------------|--------------|-------|
| 4.1 | Právní karta **každé** distribuce | částečné `legalStatus=approved` na entry | žádná plná karta | `partially_implemented` | registry entries; chybí per-endpoint legal card entity |
| 4.2 | Plná sada právních stavů vč. `approved_for_production` | zjednodušené `approved` + `productionApproved` | — | `partially_implemented` | refresh gate; enum ≠ zadání |
| 4.3 | 39 povinných právních auditních polí | documentation-only | — | `documentation_only` | `03-legal-audit.md` |
| 4.4 | NKOD = kandidát, ne auto-schválení | dokumentováno | — | `documentation_only` | docs; žádný NkodDatasetAdapter |
| 4.5 | RSS≠licence; Atom≠`rss_pub_date` | Atom collapsován do RSS label | **Atom `atom_published`/`atom_updated`** | `partially_implemented` | `extractFeedItems` v lib; production ještě bez Atom labelů dokud neproběhne refresh |
| 4.6 | HTML jen last resort + quarantine | html-list existuje | — | `partially_implemented` | refresh html path; žádná schema quarantine |
| 4.7 | Minimalizace osobních údajů | princip v docs | — | `documentation_only` | žádný PII pipeline gate |
| 4.8 | terms_unclear → ne produkce | částečně přes pending | — | `partially_implemented` | pending entries |
| 5 | Centrální registry tabulky (providers…credentials) | flat JSON entries | — | `not_implemented` | žádné DB entity |
| 5 | Registry jako jediný gatekeeper | JSON + `productionApproved` | — | `implemented_and_proven` (v rámci JSON modelu) | refresh skipuje neschválené |
| 6 | Automatická kontrola změn podmínek | `structureChange:"none"` hardcode | — | `not_implemented` | refresh monitoring |
| 7 | Kompletní zdrojová mapa (7.1–7.21) | ~39 entries, 28 active | — | `partially_implemented` | registry; většina kategorií chybí |
| 8 | Priorita A/B/C konektorů | preferováno v docs | — | `partially_implemented` | rss/html/cap; bez DATEX/GTFS |
| 9 | 20 modulů cílové architektury | JSON pipeline | — | `partially_implemented` | viz sekce D |
| 10 | Adaptery DATEX/GTFS/RDF/… | rss/atom/html/cap | Atom label fix | `partially_implemented` | lib+refresh |
| 10.1 | Přesné time_source enum | collaps Atom | Atom oddělen v parseru | `partially_implemented` | lib + applyChronology |
| 10.2 | Adaptivní polling | periodicityMin v registry | — | `partially_implemented` | jedno workflow cadence |
| 10.3–10.5 | ETag/backoff/idempotence | částečně fetch retry | — | `partially_implemented` | lib fetch |
| 11 | Raw ingest audit trail | — | — | `not_implemented` | grep raw_ingest=0 |
| 12 | PostgreSQL/PostGIS SoT | statický JSON | — | `not_implemented` / `blocked` (Pages model) | žádné `.sql`/PostGIS |
| 13 | source_item × canonical_event | flat feed items + groupKey | — | `not_implemented` | multiSourcePublications=0 |
| 14 | Centrální lokalizace PostGIS | region text/level | — | `partially_implemented` | region object; bez RÚIAN/PostGIS |
| 15 | Podrobná taxonomie | taxonomy.json + sections | — | `partially_implemented` | `01-sections.md`, taxonomy.json |
| 16 | Lifecycle enum + guards | lifecycle fields | — | `partially_implemented` | resolveLifecycle; ne plný enum |
| 17 | 5úrovňová deduplikace | URL + groupKey | — | `partially_implemented` | `dedupeByUrlAndGroup` |
| 18 | Filtry přes event links + source-items mode | FE filtry na flat items | — | `partially_implemented` | core filterEvents; bez event_source_links |
| 19 | Public API | static JSON | — | `not_implemented` | žádné `/api/feed` |
| 20 | SSE + delta sync | poll/reload JSON | — | `not_implemented` | EventSource=0 |
| 21 | Local-first | LS prefs/views/read/saved | V6 UI | `implemented_and_proven` (LS model) | core v6 |
| 22 | Offline nové architektury | PWA + LS cache feed | — | `partially_implemented` | SW existuje; ne delta/IDB events |
| 23 | Feed builder z Postgres | JSON publish | — | `not_implemented` | v2 atomic JSON |
| 24 | Publikační brána (legal/content) | productionApproved + quality | — | `partially_implemented` | refresh gates |
| 25 | Admin audit UI | monitoring.json only | — | `not_implemented` | — |
| 26 | Rozšířený monitoring | quality metrics | — | `partially_implemented` | monitoring.json |
| 27 | Security (SSRF allowlist, raw protect…) | částečně same-origin FE | — | `partially_implemented` | FE nevolá cizí weby |
| 28 | Odstranění starého nepořádku | cutover skryje HomeCards | — | `partially_implemented` | starý articles pipeline stále existuje |
| 29 | Atomické přepnutí bez 48h public parallel | cutover flag | — | `implemented_and_proven` (V1 cutover) | `06-parallel-cutover.md` |
| 30 | Data bot discipline | workflows | — | `implemented_and_proven` (proces) | update-info-events.yml |
| 31 | Test suites dle zadání | evidence + guards | Atom guard | `partially_implemented` | npm guards |
| 32 | Regrese celého InfoUzlu | smoke/guards | — | `partially_implemented` | CI |
| 33 | Fyzická zařízení | — | — | `not_implemented` | **NESPLNĚNO** |
| 34–35 | PR/merge/deploy + prod verify cílové arch | — | tento PR = audit+foundation | `blocked` pro plný scope | vyžaduje multi-epic |

---

## D) Klasifikace současných zdrojů (skupiny)

| Skupina | Příklady / pravidlo |
|---------|---------------------|
| `keep` | Produkční úřední/veřejnoprávní s `PRODUCTION_ACTIVE` + `productionApproved` (např. policie, CHMI CAP, SŽ, iROZHLAS po právním režimu feedu) |
| `migrate` | Aktivní RSS/HTML → budoucí adapter + legal card + raw ingest |
| `temporarily_keep` | Fungující zdroje bez plné legal karty (dokud není náhrada) |
| `requires_legal_review` | pending / `NO_STABLE_ITEM_SOURCE` / `TECHNICALLY_BLOCKED` (mdcr, ndic, cnb, csu, …) |
| `disable` / `remove` | Komerční media (`deactivatedCommercialMedia`); až po náhradě |
| `unknown` | Instituce ze zadání 7.x bez registry entry |

**Pravidlo:** nevypínat fungující zdroj před ověřenou náhradou + rollbackem (výjimka: právní/security stop).

---

## E) Akceptační kritéria 1–30 (pravda)

| # | Kritérium | Stav |
|---|-----------|------|
| 1 | Úplný rozdílový audit | **splněno tímto dokumentem** |
| 2 | Všechny nesplněné části implementovány nebo blocked | **blocked / phased** — viz roadmapa 11 |
| 3–8 | Registry gate + legal cards + terms monitor + raw + PG | **ne** (3 částečně v JSON; 4–8 ne) |
| 9–16 | canonical model, filtry, lokalizace, taxonomie, lifecycle, dedup | **částečně** / ne |
| 17–21 | API, SSE, delta, local-first, offline | API/SSE/delta **ne**; local-first **ano** (LS); offline **částečně** |
| 22–25 | 96h, starý systém pryč, baseline, bez 48h parallel | 96h **ano**; starý systém **ne plně**; baseline **zachován**; 48h parallel **neběžel** |
| 26–29 | CI green + merge + deploy + prod verify cílové arch | platí jen pro **tento foundation PR**, ne pro celý epic |
| 30 | Report s důkazy | tento audit + PR report |

**Verdikt:** Úkol jako celek (**kompletní cílová architektura**) **NENÍ SPLNĚN**.  
Splněna je **Fáze 0**: rozdílový audit + roadmapa + korekce Atom `time_source` v parseru.
