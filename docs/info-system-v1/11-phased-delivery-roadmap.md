# Fázovaná dodávka — cílová architektura ověřených zdrojů

**Zásady (ze zadání §3, §29, §34):**

- Neměnit baseline `5647bb3fe3` ani tag `pre-aggregator-stable-20260717`.
- Žádný 48hodinový **veřejný** paralelní provoz.
- Každý PR musí být samostatně bezpečný; **žádný PR nesmí veřejně aktivovat nekompletní architekturu**.
- Atomické produkční přepnutí až v **posledním** PR po shadow ověření.
- Nevypínat fungující zdroje před náhradou + rollbackem.

---

## Fáze 0 — Tento PR (SAFE)

**Cíl:** pravdivý rozdílový audit + roadmapa + foundation bez aktivace nové SoT.

| Dodávka | Veřejná aktivace? |
|---------|-------------------|
| `10-differential-audit-*.md/json` | ne (docs) |
| `11-phased-delivery-roadmap.md` | ne (docs) |
| Atom `time_source` oddělení v parseru | ano až po běžném Data Bot refreshi (labeling only) |
| Guard na Atom label | CI only |

**Výstup:** audit verdikt `PHASE_0_AUDIT_ONLY_NOT_FULL_ARCHITECTURE`.

---

## Fáze 1 — Legal registry schema (shadow)

- Schema: `providers`, `institutions`, `source_distributions`, `source_legal_reviews`, terms snapshots (JSON nebo PG shadow DB).
- Enum právních stavů dle zadání.
- Per-distribution karty pro **existujících 39** entries + kandidáti.
- Gate v kódu: publish pouze `approved_for_production` (mapovat ze současného `productionApproved` bez změny veřejného feedu dokud nejsou karty hotové).
- **NO-GO:** auto-schválení z NKOD.

PR series: `feat/iu-legal-registry-schema` → `feat/iu-legal-cards-existing-39`.

---

## Fáze 2 — Raw ingest + terms monitor (shadow)

- Raw payload reference + hash + headers (retenční politika).
- Terms snapshot + diff + `terms_changed` → suspend publish.
- Replay path pro parser opravy.
- **NO-GO:** raw veřejně; credentials v repo.

---

## Fáze 3 — PostgreSQL/PostGIS SoT (shadow, neveřejné)

- Migrace schématu (source_items, canonical_events, event_source_links, locations, …).
- Shadow ingest z existujících adapterů.
- Cache/feed builder čte PG; **veřejný Pages feed zatím zůstává** ze stávající cesty.
- Integrační testy + fixture multi-source event (označeno non-prod pokud přirozený nevznikne).

---

## Fáze 4 — Dedup / localization / lifecycle / filters

- 5 úrovní deduplikace + relation types.
- Filtry přes `event_source_links`; režim source-items.
- Lokalizace (RÚIAN kódy → souřadnice → text).
- Lifecycle guards.
- **Důkaz:** alespoň 1 multi-source canonical (prod nebo označený fixture).

---

## Fáze 5 — Public API + SSE + delta (neveřejný staging)

- `/api/feed`, `/api/events`, `/api/sync/delta`, SSE gateway.
- Rate limit, ETag, contracts.
- FE ještě na starém JSON dokud cutover.

---

## Fáze 6 — Local-first / offline migrace ID

- Mapování starých item ID → source_item / canonical_event.
- Idempotentní migrace LS; nesmí rozbít V4→V5→V6 důkazy.
- Offline: cached feed + delta po online.

---

## Fáze 7 — Atomické přepnutí + cleanup

1. Rollback bod (nový tag **až** těsně před cutover).
2. Krátké zastavení relevantních workflow.
3. Atomický cutover Pages/API.
4. Regenerace + produkční ověření (§35).
5. Obnova workflow + první successful run IDs.
6. Teprve poté odstranění staré mediální agregace (§28).

---

## Pořadí PR (bezpečnost)

```text
0  docs/iu-info-system-differential-audit-roadmap     ← TENTO
1  feat/iu-legal-registry-schema
2  feat/iu-legal-cards-batch-existing
3  feat/iu-raw-ingest-shadow
4  feat/iu-terms-change-monitor
5  feat/iu-pg-postgis-shadow-schema
6  feat/iu-shadow-ingest-workers
7  feat/iu-canonical-dedup-filters
8  feat/iu-public-api-sse-staging
9  feat/iu-localfirst-id-migration
10 feat/iu-atomic-cutover-production   ← jediné veřejné přepnutí
11 chore/iu-remove-legacy-media-agg    ← až po ověření cutoveru
```

Mezi PR 5–9: pouze shadow / feature flags OFF na produkci.

---

## Blokery (pravdivě)

| Bloker | Dopad |
|--------|-------|
| GitHub Pages + git JSON jako SoT | PG SoT vyžaduje hosting/runtime mimo čistý static publish |
| Absence raw storage | nelze auditní replay |
| Absence legal cards per distribution | nelze poctivě `approved_for_production` pro nové endpointy |
| Fyzická zařízení nedostupná | §33 = NESPLNĚNO |
| Fronta Cursor / Data Bot race | cutover jen s řízeným stop/start workflow |

---

## Co tento dokument **není**

- Není produkční ověření Postgres/API/SSE.
- Není schválení všech institucí §7.
- Není důvod tvrdit, že akceptační kritéria 1–30 jsou splněna.
