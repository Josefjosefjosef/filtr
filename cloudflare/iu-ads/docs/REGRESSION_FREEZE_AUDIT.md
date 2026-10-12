# Regresní freeze — audit hloubky (2026-10-12)

Legenda: **Required** = branch protection na `main` (`repo-guard`, `layout-guard`, `smoke`). **Deploy** = Deploy IU Ads na push `cloudflare/iu-ads/**`. **PR freeze** = job `iu-ads-regression-freeze`.

| Oblast | Test / guard | CI workflow | Required | Poznámka |
|---|---|---|---|---|
| Objednávky | `premium-order-form-e2e`, `premium-order-chain`, `public-premium-order` (via form guard) | PR freeze, Deploy (full vitest) | smoke (částečně) | D1 stav: integrační testy s D1 sqlite |
| P1–P8 | `premium-security`, `collision`, `iu-premium-selected-services-freeze-guard-v1.mjs` | PR freeze, Deploy | smoke (premium guards) | Ceny autoritativní v workeru |
| Fakturace | `premium-invoice-*`, `premium-accounting-settlement` | PR freeze, Deploy | Deploy | |
| PDF | layout + `premium-pdf-seven-scenarios-visual`, freeze guard skripty | PR freeze, Deploy PNG | Deploy | Vzhled #11869/#11870 |
| Storno/dobropisy | `premium-order-cancellation-pdf-layout`, `premium-storno-credit-visual-proof` | PR freeze, Deploy | Deploy | |
| Administrace | `admin-premium-orders-nav.e2e`, `iu-ads-admin-menu-guard-v1.mjs` | PR freeze, Deploy | smoke (menu guard) | Plná admin E2E = workflow_dispatch prod |
| Vývojový reset | `premium-order-test-data-reset.integration`, reset guard | PR freeze, Deploy | Deploy guard | Prod reset jen manuálně |
| D1/R2 | `r2-security`, `isolated-restore-drill`, purge integration | PR freeze | Ne | Migrace: post-migration prod verify |
| Veřejné reklamy | `public-delivery`, `delivery-engine`, render guard | PR freeze, smoke premium guards | smoke | Prod delivery vypnuto v /health |
| Soukromí | `premium-security`, no-tracking guard | PR freeze, Deploy, smoke | smoke | /health privacy flags |
| Layout/PWA | smoke Silver/MindMenu guards (mimo iu-ads) | smoke | **Ano** | Nesouvisí s #11871 |

**PR #11871** přidává manifest + **iu-ads-regression-freeze** (po merge doplnit do required checks).
