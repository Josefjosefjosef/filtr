# Regresní freeze — audit hloubky (2026-10-12)

Legenda: **Required** = branch protection na `main` (`repo-guard`, `layout-guard`, `smoke`, `iu-ads-regression-freeze`). **Deploy** = Deploy IU Ads na push `cloudflare/iu-ads/**`. **PR freeze** = job `iu-ads-regression-freeze` (plný bundle při změně v ads scope).

| Oblast | Konkrétní test / guard | Co skutečně ověřuje | CI workflow | Blokuje merge | Výsledek |
|---|---|---|---|---|---|
| Objednávky | `premium-order-submit-d1.integration.test.ts` | D1 řádek `submitted`, autoritativní cena, `placement_reserved` | PR freeze, Deploy | **Ano** (PR freeze + Deploy) | B2 doplněno |
| P1–P8 | stejný + `collision`, `premium-sales-availability`, `iu-premium-selected-services-freeze-guard-v1.mjs` | Rezervace P1, obsazení kampaní, ceník | PR freeze, Deploy | **Ano** | B2 doplněno |
| Fakturace | `premium-invoice-*`, `premium-accounting-settlement`, SPAYD QR | VS, DPH, vazba na objednávku | PR freeze, Deploy | Deploy required | existující |
| PDF | layout + `premium-pdf-seven-scenarios-visual`, freeze guard skripty | geometrie/vzhled #11869/#11870 | PR freeze, Deploy PNG | Deploy | existující |
| Storno/dobropisy | `premium-order-cancellation-pdf-layout`, `premium-storno-credit-visual-proof`, `premium-order-accounting-cancel` | finanční storno, PDF | PR freeze, Deploy | Deploy | existující |
| Administrace | `admin-premium-orders-nav.e2e`, `premium-admin-lifecycle` | UI + workflow stavy | PR freeze, Deploy | smoke (částečně) | B4 doplnit |
| Vývojový reset | `premium-order-test-data-reset.integration` (+ R2 fail), reset guard | faktura/storno/dobropis cyklus, D1 purge při výpadku R2 | PR freeze, Deploy | Deploy guard | B3 doplněno |
| D1/R2 | `iu-ads-schema-migration-compat.test.ts`, `iu-ads-migration-schema-compat-guard-v1.mjs` | index pending placement, P1–P8 seed, zákaz DROP ceníku | PR freeze, Deploy | **Ano** | B3 doplněno |
| Veřejné reklamy | `public-delivery`, `delivery-engine`, render guard | po schválení / po stornu | PR freeze, smoke | smoke | B4 doplnit |
| Soukromí | `premium-security`, `iu-premium-selected-no-tracking-guard-v1.mjs` | žádné měření prokliků | PR freeze, smoke | smoke | existující |
| Layout/PWA | smoke Silver/MindMenu guards (repo root) | CLS, mobil | smoke | **Ano** | existující |

## B2 — nově v tomto PR

- **`test/premium-order-submit-d1.integration.test.ts`**: tampering `price_cents`, sekvenční i paralelní submit na stejné P1, D1 počty řádků, aktivní kampaň → 409.
- **`migrations/0024_premium_pending_placement_unique.sql`**: partial unique index + rollback konceptu objednávky při kolizi.
- **`public-premium-order.ts`**: zachyt `UNIQUE` na pending placement, rollback draft `orders`/`inquiries`.

## B3 — nově v tomto PR

- **`scripts/iu-ads-migration-schema-compat-guard-v1.mjs`**: CI + Deploy IU Ads před nasazením.
- **`test/iu-ads-schema-migration-compat.test.ts`**: sqlite migrace + index + 8 pozic.
- **Reset test**: D1 vyčištěno i když R2 `delete` hází chybu.

## Zbývá (B4)

- Admin E2E kritické operace s D1 výsledkem (schválení/storno/faktura).
- Veřejné doručování smoke + architektonické hranice PC bannerů (bez implementace).

**READY pro PC bannery:** NOT READY — dokončit B4 a ověřit produkci po merge.
