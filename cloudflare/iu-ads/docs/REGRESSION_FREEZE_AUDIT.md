# Regresní freeze — audit hloubky (2026-10-12, finální B3/B4)

**Required checks (branch protection):** `repo-guard`, `layout-guard`, `smoke`, `iu-ads-regression-freeze`.

| Oblast | Konkrétní test / guard | Co ověřuje | CI | Blokuje merge | Stav |
|---|---|---|---|---|---|
| Objednávky | `premium-order-submit-d1.integration.test.ts` | D1 submit, cena, rezervace | PR freeze, Deploy | **Ano** | hotovo |
| P1–P8 / rezervace | + migrace `0024`, collision guards | paralelní kolize, ceník | PR freeze, Deploy | **Ano** | hotovo |
| Fakturace / PDF | invoice layout, seven-scenarios visual, freeze guards | VS, DPH, layout PDF | PR freeze, Deploy | Deploy | hotovo |
| Storno/dobropisy | cancellation layout, accounting-cancel, storno-credit visual | účetní dopady + PDF | PR freeze, Deploy | Deploy | hotovo |
| Administrace | `premium-admin-approve-d1.integration.test.ts`, admin nav e2e | D1 schválení → kampaň + faktura | PR freeze, Deploy | **Ano** | B4 |
| D1 | `iu-ads-schema-migration-compat.test.ts`, migration guard | index 0024, zákaz DROP ceníku | PR freeze, Deploy | **Ano** | B3 |
| R2 / reset | reset integration (+ R2 fail), r2-security | purge, katalog zachován | PR freeze, Deploy | Deploy guard | B3 |
| Veřejné reklamy | `premium-public-delivery-d1.integration.test.ts`, delivery-engine | neschválená/ukončená reklama | PR freeze | **Ano** | B4 |
| Soukromí | premium-security, no-tracking guard | žádné prokliky / cookies | PR freeze, smoke | smoke | hotovo |
| Layout/PWA | smoke Silver/MindMenu | CLS | smoke | **Ano** | hotovo |
| PC banner hranice | `future-pc-banner-boundary.test.ts`, boundary guard | oddělení od P1–P8 | PR freeze, Deploy | **Ano** | B4 |

## Produční `/health` a SCHEMA_VERSION

- **Příčina rozdílu 0015 vs repo 0024:** `/health` dříve vracel **hardcoded** `schemaVersion: "0015"` (`index.ts`), ne hodnotu z D1.
- **Oprava (B4):** `schemaVersion` se čte z `system_settings.SCHEMA_VERSION` (read-only).
- **Ověření migrace 0024 v produkci:** po deployi porovnat `/health.schemaVersion` s existencí indexu `idx_premium_selected_orders_pending_placement` (D1 read-only / post-migration verify workflow). **Neaplikovat migrace na produkci bez schválení.**

## Infra testů D1

- `test/helpers/d1-sqlite-shim.ts` — podpora `prepare().first()` (jako worker D1) a `meta.changes` pro publish/rollback.

**READY pro vývoj PC bannerů:** až po merge B3+B4, deploy a produkční smoke s novým `/health` (viz závěrečný report).
