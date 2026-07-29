# AUDIT — odstranění současných mediálních zdrojů

**Datum auditu:** 2026-07-29  
**Výchozí HEAD (před větví):** `ecfe4cb3e135e89743c6cc86b979ee459c47d01a` (`main`)  
**Pracovní větev:** `refactor/remove-current-media-sources`  
**Stav cutoveru (již v produkci):** `commercialAggregationActive=false`, `infoSystemActive=true` (od 2026-07-17)  
**Lokální stash před startem (vlastní, nedotýkat cizích):** `refactor-remove-media: unrelated-schema-sql-prestart`

Tento dokument je **Fáze A** — forenzní inventura **bez destruktivních změn**. Implementace následuje po schválení klasifikace níže.

---

## 1. Shrnutí stavu

InfoUzel má **dvě oddělené pipeline**:

| Pipeline | Účel | Produkční stav 2026-07-29 |
|----------|------|---------------------------|
| **Legacy articles aggregator** | RSS/Atom komerční + mediální feedy → `articles.json` / chunks / pool | **Sync SKIP** přes cutover gate; **data stále v main** (~21k článků) |
| **Info system / Přehled dne** | Veřejné/oficiální zdroje přes konektory → `info_events/` | **Aktivní**; jediný `productionActive` zdroj: **ČHMÚ** |

Cutover (2026-07-17) **zastavil synchronizaci a skryl UI**, ale **neodstranil** registry, produkční artefakty ani mediálně specifický kód. Tento úkol dokončuje strukturální odstranění.

---

## 2. Současné mediální zdroje

### 2.1 Kanonický runtime registr (articles)

Soubor: `projects/data/source_registry.json`  
- Celkem: **65** entries  
- `active=true`: **50** mediálních feedů  
- Neaktivní/blocked: **15**

Aktivní feedId (výběr / úplný seznam v registru):

| feedId | Label | Doména | Topic | feed_url |
|--------|-------|--------|-------|----------|
| zpr_ct24_domaci / zpr_ct24_svet | ČT24 | ct24.ceskatelevize.cz | aktualne | ct24 RSS |
| zpr_seznam_domaci | Seznam Zprávy | seznamzpravy.cz | aktualne | …/rss/domaci |
| zpr_novinky_domaci / zpr_novinky_zahranicni | Novinky | novinky.cz | aktualne | … |
| zpr_idnes_zpravy | iDNES | idnes.cz | aktualne | servis.idnes.cz/rss… |
| zpr_denik | Deník | denik.cz | aktualne | … |
| zpr_aktualne | Aktuálně | aktualne.cz | aktualne | … |
| zpr_hlidacipes, zpr_kverulant, zpr_ceskajustice, zpr_tydenikpolicie | niche | … | aktualne | … |
| spt_ctsport, spt_sportcz, spt_isport, spt_idnes, spt_tenisportal, spt_mmamag, spt_crzpravy_sport | sport | … | sport | … |
| fin_* (sz_byznys, idnes, hn, e15, ekonom, …) | finance | … | finance | … |
| zdr_* | zdraví | … | zdravi | … |
| ces_* | cestování | … | cestovani | … |
| hry_* | hry | … | hry | … |
| kul_* | kultura | … | kultura | … |
| ved_* | věda | … | veda | … |
| vzd_* | vzdělávání | … | vzdelavani | … |

Generátor: `scripts/gen_source_registry.py` → klientská dokumentace `assets/iu-sources.js`.

### 2.2 Konfigurační registr (config)

Soubor: `config/sources.json` — **23** `enabled: true` zdrojů (ČT24, iROZHLAS, ČeskéNoviny, Seznam, Novinky, iDNES, Aktuálně, Deník, sport/finance/krimi/zdravi + 2× YouTube ČT24 playlisty).

### 2.3 Dokumentační / legacy seznamy

- `assets/iu-sources.js` — export `IU_SOURCES` (desítky RSS URL)  
- `scripts/feeds.json` — **prázdné pole `[]`** (už vyčištěno)  
- `scripts/feeds_youtube.json` — 2× ČT24 playlist  

### 2.4 Info-events: deaktivovaná komerční média

`projects/data/info_events/source_registry.json` → `deactivatedCommercialMedia`:  
`seznamzpravy`, `novinky`, `idnes`, `aktualne`, `denik`, `blesk`, `hn`, `e15`, `sportcz`, `isport`

Právní registr: 10× `REJECTED` (komerční).  
`ct24` / `irozhlas` v info_events: `productionActive=false`, `REQUIRES_MANUAL_LEGAL_REVIEW` — **neprodukční**.

### 2.5 Jediný aktivní veřejný zdroj (zachovat)

| id | Label | Connector | Sync |
|----|-------|-----------|------|
| `chmi` | ČHMÚ | CAP opendata | `update-chmi-cap-v2.yml` cron `*/15` + `scripts/chmi-cap-v2/*` |

`info_events/feed.json`: pouze položky `sourceId=chmi`.

---

## 3. Datové toky

### 3.1 Legacy media (ODSTRANIT aktivaci + data)

```
config/sources.json + projects/data/source_registry.json
        │
        ▼
cloudflare/articles-watchdog (cron) ──dispatch──► update-articles.yml
        │                                              │
        │                                    (gate: cutover → SKIP)
        ▼                                              ▼
  decideWatchdog(skip_cutover)              build_articles.py / pool / chunks
                                                   │
                                                   ▼
                    projects/data/articles.json (~28 MB, 21227 items, generatedAt 2026-07-17)
                    projects/data/publishable_pool.json (~29 MB)
                    projects/data/article_feed_chunks/** (442 files, ~44 MB)
                                                   │
                                                   ▼
                    Pages publish / SW FEED_OFFLINE_CACHE / klientský chunk loader
```

Poslední `update-articles` běhy po cutoveru: **pipeline_gate SUCCESS + ingest/aggregate SKIPPED** (neprodukují nová data).

### 3.2 Info system + ČHMÚ (ZACHOVAT)

```
source_registry + legal_source_registry
        │
        ▼
iu-info-events-refresh.mjs / chmi-cap-v2-prod-sync.mjs
        │
        ▼
projects/data/info_events/{feed,lanes,manifest,monitoring}.json
        │
        ▼
assets/iu-info-system-core-v1.js + iu-prehled-dne-ui-v1.js (local-first)
```

---

## 4. Klasifikace komponent

### A — Odstranit (výhradně současná média / mrtvá media data)

| Komponenta | Poznámka |
|------------|----------|
| Aktivní entries v `projects/data/source_registry.json` | 50 aktivních mediálních feedů |
| `config/sources.json` sources | 23 enabled |
| Obsah `assets/iu-sources.js` (mediální URL) | nahradit prázdným/neutrálním stubem |
| `scripts/feeds_youtube.json` CT24 playlisty | articles YouTube path |
| Produkční `articles.json` / `publishable_pool.json` / `article_feed_chunks/**` | historická mediální data |
| Media-only fixture/snapshot reporty vázané na konkrétní feedId (kde neověřují engine) | po náhradě syntetikou |
| UI texty tvrdící aktivní agregaci konkrétních médií | `zdroje-a-licence` apod. |

### B — Zachovat beze změny

| Komponenta | Důvod |
|------------|-------|
| `scripts/chmi-cap-v2/**` + `update-chmi-cap-v2.yml` | CAP v2 |
| `projects/data/info_events/**` (mimo media texty) | Přehled dne |
| `assets/iu-info-system-core-v1.js`, `iu-prehled-dne-*` | UI Přehledu dne |
| Local-first klíče `iu.infoEvents.*` | uživatelské stavy |
| Ads / Analytics / nesouvisející tools | mimo scope |
| Obecný SW app-shell / PWA infrastruktura | B + částečně C (verze cache) |

### C — Zachovat a zobecnit / upravit

| Komponenta | Úprava |
|------------|--------|
| `scripts/build_articles.py`, `iu_article_*.py`, scheduler, fetch/retry | engine zůstává; běží nad **prázdným** registrem |
| `update-articles.yml` / fast-pool / watchdog | ponechat gate + **permanent ban guard** (ne smazat engine) |
| `cloudflare/articles-watchdog` | cutover skip zůstává; banlist |
| Guards očekávající min_articles / source coverage | SKIP nebo empty-OK při cutover / empty registry |
| `pages-publish-from-main-data.yml` | nesmí blokovat deploy jen kvůli prázdným articles |
| `sw.js` `FEED_OFFLINE_CACHE` + `CACHE_VERSION` | bump → invalidace starých mediálních feedů |
| `iu-client-article-*` | zachovat vrstvu; prázdný feed = empty state |
| Dedup / normalizace obecná | odstranit jen media-only výjimky po reference check |
| Testy s media fixtures | nahradit neutrální fixture |

### D — Dočasně ponechat (kompatibilita)

| Komponenta | Důvod | Exit kritérium |
|------------|-------|----------------|
| `cutover_state.json` + `commercialAggregationActive=false` | kill switch + rollback kontrakt | po ověření produkce + ban guard; později lze zjednodušit |
| `deactivatedCommercialMedia` + REJECTED legal rows | auditní evidence + banlist seed | zůstat jako deny-list konkrétních ID |
| `?iuInfoSystem=off` cesta | rollback UI | dokumentovat; nepoužívat k obnově media sync |
| Tag `pre-aggregator-stable-20260717` | rollback baseline | nemazat |
| Smoke/layout guardy s `iuInfoSystem=off` | měří legacy HomeCards | postupně přepnout na info-system; neblokovat merge pokud PASS s off |

### E — Nejasné (nemazat bez dalšího ověření)

| Komponenta | Proč |
|------------|------|
| `videos.json` / video pipeline | není articles RSS; aktuálně 2 neutrální kanály — **nemazat** v této etapě |
| Info panel / CNB / trh snapshoty | veřejná data, ne media aggregator |
| `assets/iu-info-panel-source-registry.js` | jiné zdroje (trhy), ne articles media |
| Agregované Analytics historické součty | anonymní; nemazat |
| Obecné názvy `article` / `feed` / `source` v engine | zdrojově neutrální |

---

## 5. Plán odstranění (implementační pořadí)

1. **B — Stop sync:** ověřit cutover + watchdog skip; zakázat reaktivaci bez změny ban guardu.  
2. **C — Registry:** vyprázdnit aktivní media registry (`source_registry`, `config/sources.json`, `iu-sources.js`, youtube feeds).  
3. **D — Data dry-run → wipe:** spočítat položky → nahradit articles/pool/chunks prázdnými artefakty; **netknout** `info_events` CHMI.  
4. **E — Cache:** bump `CACHE_VERSION` + `FEED_OFFLINE_CACHE`; klient ignoruje orphan media.  
5. **F — UI/docs:** empty states, zdroje-a-licence, audit docs; neutrální jazyk (ne „jen instituce“).  
6. **G — Guardy/testy:** nový `removed-media-regression-guard`; upravit health/coverage.  
7. **H — PR → CI → merge → produkční ověření.**

---

## 6. Závislosti a rizika

| Riziko | Dopad | Mitigace |
|--------|-------|----------|
| Guards `min_articles` / section-coverage FAIL | CI červené | SKIP/empty-OK při cutover + empty registry |
| `pages-publish-from-main-data` čte `articles.json` | falešný stale/error | upravit podmínku na info_events health |
| SW durable `FEED_OFFLINE_CACHE` vrací stará media | UX regrese | bump cache name + wipe seed articles |
| `?iuInfoSystem=off` znovu ukáže HomeCards | dočasná viditelnost legacy UI | CSS/empty data → prázdný feed; sync stále SKIP |
| Smazání engine skriptů omylem | rozbití budoucích konektorů | **nemazat** `build_articles` / scheduler / fetch jádro |
| Zásah do CHMI ID / local-first | ztráta uložených stavů | whitelist wipe jen articles paths; info_events beze změny |
| Obří git diff (70+ MB data) | review / CI timeout | dedikovaný data commit; sparse checks |
| Otevřené PR automation (#7576 articles, #7842 CHMI) | konflikt | neslučovat; CHMI nechat běžet |

---

## 7. Plán čištění produkčních dat

| Úložiště | Akce | Počet (audit) |
|----------|------|----------------|
| `articles.json` | nahradit `articles: []` + metadata | 21227 → 0 |
| `publishable_pool.json` | prázdný pool | ~21k → 0 |
| `article_feed_chunks/**` | smazat chunks; minimální manifest | 442 souborů / ~44 MB |
| `info_events/feed.json` | **beze změny** | 3× chmi |
| D1/R2/KV articles | N/A v této pipeline (Pages JSON) | — |
| SW / Cache Storage | invalidace bumpem verze | — |
| IndexedDB infoEvents | **zachovat** | — |
| Uživatelské stavy media článků | orphan OK / ignorovat při renderu | preferovat nebourat celé local-first DB |

**Dry-run výstup (před wipe):** spočítat `articles.length` by `feedId` / `sourceLabel` (viz §2 + inventura níže).  
**Selektor:** pouze articles pipeline soubory; **nikdy** wipe podle titulku/URL napříč info_events.

---

## 8. Cache invalidace

| Klíč | Akce |
|------|------|
| `CACHE_VERSION` v `sw.js` | bump (nový deploy wipe versioned caches) |
| `FEED_OFFLINE_CACHE` | přejmenovat `iu-feed-offline-v2` (stará media last-good se nepoužije) |
| CDN/Pages | standardní Pages deploy po merge |
| Klientský in-memory store | session reset při load; prázdná data |

---

## 9. Rollback

| Vrstva | Postup | Poznámka |
|--------|--------|----------|
| Aplikační kód | revert merge PR / checkout předchozí tag | **nesmí** automaticky zapnout media sync |
| Data articles | obnovit z pre-change commit / tag `pre-aggregator-stable-20260717` | jen vědomě |
| Cutover | `commercialAggregationActive` zůstává `false` i při code rollback, dokud se výslovně nezmění | oddělené rozhodnutí |
| Cache | případný další bump | |
| Opětovná aktivace zdroje | **nový PR** + úprava ban guardu + legal review | zákaz slepého rollback sync |

---

## 10. Akceptační kritéria (mapa na §28 zadání)

- [ ] Žádný současný mediální sourceId/feedId není `active` v produkčním registru  
- [ ] Žádný media sync (watchdog/workflow) nepublikuje nové položky  
- [ ] `articles.json` / pool / chunks bez mediálních položek  
- [ ] SW/cache nevrací stará media  
- [ ] Engine skripty + info_events + ČHMÚ CAP v2 funkční  
- [ ] Architektura bez obecného zákazu `sourceType=media`  
- [ ] Local-first Přehled dne / CHMI stavy zachovány  
- [ ] CI zelené; merge; produkční ověření  
- [ ] Cizí stashe nedotčeny; pracovní strom čistý  

---

## 11. Inventura gitu (Fáze A)

| Položka | Hodnota |
|---------|---------|
| Branch start | `main` @ `ecfe4cb3e1…` |
| Dirty před startem | `cloudflare/iu-ads/schema.sql` → stash `refactor-remove-media: unrelated-schema-sql-prestart` |
| Cizí stashe | desítky historických — **nedotýkat** |
| Otevřené relevantní PR | #7842 CHMI data; #7576 articles data; #6993 articles workflows guard — **neslučovat** |

---

## 12. Explicitní rozhodnutí architektury

1. **Jeden engine** — legacy articles pipeline zůstává jako **zdrojově neutrální** generátor nad prázdným registrem; info_events zůstává konektorová vrstva pro veřejné zdroje.  
2. **Žádný druhý „jen-instituce“ agregátor.**  
3. **Žádný obecný ban médií** v datovém modelu — pouze **konkrétní deny-list** odstraněných sourceId/domén.  
4. **Budoucí médium** = nový konektor/config + legal + úprava guardu + stínový režim (samostatný PR).

---

*Konec auditu Fáze A. Implementace = Fáze B–H dle zadání.*
