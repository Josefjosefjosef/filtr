# Regresní freeze — audit hloubky (2026-10-12, B5 dokončeno)

**Required checks (branch protection):** `repo-guard`, `layout-guard`, `smoke`, `iu-ads-regression-freeze`.

| Oblast | Konkrétní test / guard | Co ověřuje | CI / Deploy | Blokuje merge | Stav |
|---|---|---|---|---|---|
| Objednávky | `premium-order-submit-d1.integration.test.ts` | D1 submit, cena, rezervace | PR freeze | **Ano** | **PASS** |
| P1–P8 / rezervace | migrace `0024`, submit D1, collision guards | paralelní kolize, ceník | PR freeze, Deploy | **Ano** | **PASS** |
| Storno po zveřejnění | `premium-admin-publish-storno-d1.integration.test.ts` | publish → delivery → turn-off → storno, dobropis | PR freeze | **Ano** | **PASS** |
| Admin auth (HTTP) | `premium-admin-auth-d1.integration.test.ts` | 401/403, RBAC, bez změn D1 | PR freeze | **Ano** | **PASS** |
| D1 produkce index 0024 | `scripts/iu-ads-prod-d1-index-0024-verify-v1.mjs` | read-only prod D1 | Deploy IU Ads | **Ano** (deploy fail) | **PASS** (run `38295799371`) |
| Veřejné reklamy / admin approve | `premium-public-delivery-d1.integration.test.ts`, `premium-admin-approve-d1.integration.test.ts` | izolovaná D1 | PR freeze | **Ano** | **PASS** |
| PC banner hranice | `future-pc-banner-boundary.test.ts` + guard | oddělení od P1–P8 | PR freeze, Deploy | **Ano** | **PASS** |
| CNB info panel | `iu-info-panel-cnb-rates-guard-v1.mjs` | živá ČNB + committed snapshot | smoke | **Ano** | **PASS** (po refresh snapshot 12.10.2026) |

## Produční D1 — index migrace 0024 (read-only, doklad)

**Worker:** `infouzel-ads` · **Binding:** `DB` · **D1:** `iu-ads`

**Deploy:** [38295799371](https://github.com/Josefjosefjosef/filtr/actions/runs/38295799371) · krok *Production D1 read-only verify index 0024*

```
IU_ADS_PROD_D1_VERIFY=PASS
PROD_D1_DATABASE_NAME=iu-ads
PROD_D1_BINDING=DB
PROD_INDEX_PRESENT=true
PROD_SCHEMA_VERSION=0024
PENDING_PLACEMENT_COLLISIONS=0
```

Index `idx_premium_selected_orders_pending_placement`: UNIQUE partial index na `premium_selected_orders(placement_id)` pro `workflow_status IN ('submitted','under_review')` — soulad s migrací `0024_premium_pending_placement_unique.sql`.

**Read-only SQL (stejné jako deploy skript):**

```sql
SELECT name, type, tbl_name, sql FROM sqlite_master
WHERE type = 'index' AND name = 'idx_premium_selected_orders_pending_placement';

SELECT value FROM system_settings WHERE key = 'SCHEMA_VERSION' LIMIT 1;

SELECT placement_id, COUNT(*) AS pending_count
FROM premium_selected_orders
WHERE workflow_status IN ('submitted', 'under_review')
GROUP BY placement_id HAVING COUNT(*) > 1;
```

| Kontrola | Výsledek |
|---|---|
| Přímý prod SQL (GitHub Deploy secrets) | **PASS** |
| `/health.schemaVersion` (2026-10-12) | **PASS** — `0024` |
| Kolize pending rezervací | **PASS** — `0` |

## Merge / deploy (B5)

| PR | Merge commit |
|---|---|
| [#11876](https://github.com/Josefjosefjosef/filtr/pull/11876) B5 tests + CNB snapshot | `c6b0e86bc4d37804ca6036c97ee70970ae1b9e35` |
| [#11878](https://github.com/Josefjosefjosef/filtr/pull/11878) D1 verify script path fix | `8f7968645d3d6170ce1be2696b5c6e22fc2474d7` |

## READY pro vývoj PC bannerů

**READY** — regresní freeze aktivní (required checks + deploy D1 verify). Vývoj nových PC bannerů pouze v rámci `future-pc-banner-boundary` guardů; **neměnit** P1–P8, ceník, vydané dokumenty; **ne** zapínat `publicDeliveryEnabled` v produkci bez schválení.
