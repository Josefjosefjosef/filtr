# Regresní freeze — audit hloubky (2026-10-12, B5 finální pojistky)

**Required checks (branch protection):** `repo-guard`, `layout-guard`, `smoke`, `iu-ads-regression-freeze`.

| Oblast | Konkrétní test / guard | Co ověřuje | CI | Blokuje merge | Stav |
|---|---|---|---|---|---|
| Objednávky | `premium-order-submit-d1.integration.test.ts` | D1 submit, cena, rezervace | PR freeze | **Ano** | **PASS** |
| P1–P8 / rezervace | migrace `0024`, submit D1, collision guards | paralelní kolize, ceník | PR freeze, Deploy | **Ano** | **PASS** (lokální schéma) |
| Fakturace / PDF | invoice/cancellation layout, accounting-cancel unit | účetní dopady + PDF | PR freeze, Deploy | Deploy | **PASS** |
| Storno po zveřejnění | `premium-admin-publish-storno-d1.integration.test.ts` | publish → delivery → turn-off → accounting storno, dobropis, idempotence | PR freeze | **Ano** | **PASS** (izolovaná D1) |
| Administrace schválení | `premium-admin-approve-d1.integration.test.ts` | D1 schválení → kampaň + faktura | PR freeze | **Ano** | **PASS** |
| Admin auth (HTTP) | `premium-admin-auth-d1.integration.test.ts` | 401/403 bez session, neplatná/revokovaná session, RBAC | PR freeze | **Ano** | **PASS** (izolovaná D1) |
| D1 schéma (lokální) | `iu-ads-schema-migration-compat.test.ts`, migration guard | index 0024, zákaz DROP ceníku | PR freeze, Deploy | **Ano** | **PASS** |
| D1 produkce index 0024 | `scripts/iu-ads-prod-d1-index-0024-verify-v1.mjs` | read-only `sqlite_master`, SCHEMA_VERSION, kolize pending | **Deploy IU Ads** | **Ano** (deploy fail) | viz níže |
| R2 / reset | reset integration (+ R2 fail) | purge, katalog zachován | PR freeze | Deploy | **PASS** |
| Veřejné reklamy | `premium-public-delivery-d1.integration.test.ts` | neschválená/ukončená/storno delivery | PR freeze | **Ano** | **PASS** |
| Soukromí / layout | smoke, no-tracking guard | CLS, tracking | smoke | **Ano** | **PASS** (poslední B4 deploy) |
| PC banner hranice | `future-pc-banner-boundary.test.ts`, boundary guard | oddělení od P1–P8 | PR freeze, Deploy | **Ano** | **PASS** |

## Produční D1 — index migrace 0024 (read-only)

**Worker / binding:** `infouzel-ads` → D1 binding `DB`, databáze **`iu-ads`** (`wrangler.toml`, deploy workflow resolve `database_id`).

**Read-only SQL (stejné jako deploy skript):**

```sql
SELECT name, type, tbl_name, sql
FROM sqlite_master
WHERE type = 'index'
  AND name = 'idx_premium_selected_orders_pending_placement';

SELECT value FROM system_settings WHERE key = 'SCHEMA_VERSION' LIMIT 1;

SELECT placement_id, COUNT(*) AS pending_count
FROM premium_selected_orders
WHERE workflow_status IN ('submitted', 'under_review')
GROUP BY placement_id
HAVING COUNT(*) > 1;
```

| Kontrola | Výsledek |
|---|---|
| Index 0024 v produkční D1 (přímý SQL) | **NOT VERIFIED** lokálně (chybí `CLOUDFLARE_API_TOKEN`); po merge B5 povinný deploy krok **Production D1 read-only verify index 0024** → očekáváno `IU_ADS_PROD_D1_VERIFY=PASS` |
| `/health.schemaVersion` | **PASS** — `0024` (D1 `system_settings`, nasazeno B4) |
| Kolize pending rezervací | **NOT VERIFIED** lokálně; deploy skript **FAIL** pokud `HAVING COUNT(*) > 1` vrátí řádky |

**Bezpečný postup bez tokenu:** Dashboard → D1 → `iu-ads` → Console → pouze SELECT výše; nebo spustit Deploy IU Ads (GitHub Actions secrets).

## Integrační scénáře B5

| Scénář | Soubor | Výsledek |
|---|---|---|
| Storno po publish + uvolnění pozice + dobropis + idempotence | `premium-admin-publish-storno-d1.integration.test.ts` | **PASS** (vitest) |
| Neoprávněné approve / storno / turn-off / PATCH kampaně / dokumenty | `premium-admin-auth-d1.integration.test.ts` | **PASS** (vitest) |

## READY pro vývoj PC bannerů

**READY** — po merge B5, úspěšném `iu-ads-regression-freeze` + required checks, deploy s **PASS** prod D1 verify krokem. Nové PC bannery pouze za hranicemi guardů; **neměnit** P1–P8, ceník, vydané dokumenty.
