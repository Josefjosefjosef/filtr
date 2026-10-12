# InfoUzel Ads — regresní freeze (inventura)

**Účel:** Mapa současné implementace a automatických ochran před rozšířením o PC bannery v pravém sloupci.  
**Zdroj pravdy pro CI manifest:** `src/regression-freeze-manifest.ts`  
**Poslední aktualizace:** 2026-10-12 (po merge PR #11870)

## Produkční body

| URL | Role |
|-----|------|
| `https://ads.infouzel.cz` | Worker (admin, client, veřejné premium API) |
| `https://ads.infouzel.cz/admin` | Administrace |
| `https://infouzel.cz` | Veřejný web + vložené reklamní tlačítka (assets + delivery API) |
| `/health` | Stav služby, schema, privacy flags |

## Veřejný objednávkový tok (premium selected P1–P8)

- **HTML:** `/premium/order`, `/premium/terms`, `/premium/terms/v1|v2` (`premium-order-ui.ts`, `premium-terms.ts`)
- **API:** `POST /v1/public/premium/orders`, upload, GET stav; `GET /v1/public/premium/selected-services/catalog|render`
- **Katalog & ceny:** `premium-selected-services.ts` — autoritativní cena `resolveAuthoritativePriceCents`, ID `selected_services.{section}.premium.{01-08}`
- **ARES / IČO:** `GET /v1/public/ares/ico`
- **Testy:** viz manifest `public_order_forms`, `catalog_p1_p8`

## Administrace a oprávnění

- **Auth:** `admin-auth.ts`, session cookies, role v D1 (`0003_admin_auth.sql`)
- **Premium admin API:** `/v1/admin/premium/orders/*` — schválení, storno, fakturace, dokumenty, reset (`premium-order-test-data-reset.ts`)
- **UI:** `admin-ui.ts`, `admin-ui-script.ts`, `admin-nav.ts`
- **Reset:** „Vyčistit všechny testovací záznamy“ — `PREMIUM_DEV_OPERATIONAL_RESET_ENABLED`, `PREMIUM_COMMERCIAL_LIVE`, guard v `premium-dev-operational-reset-guard.ts`
- **Testy:** `admin_ui`, `dev_reset`

## Kampaně, rezervace, zveřejnění

- **Tabulky:** `campaigns`, `campaign_placements`, `placement_reservations` (migrace `0005`, premium migrace `0011–0022`)
- **Workflow:** `premium-order-workflow.ts`, `premium-publish.ts`, `premium-admin-order-lifecycle.ts`
- **Kolize pozic:** `collision.test.ts`, `reservations.test.ts`
- **Veřejné doručení:** `public-delivery-route.ts`, `delivery-engine.ts`, asset `iu-premium-selected-services-v1.js`

## Fakturace a PDF

- **Generování:** `premium-order-documents.ts`, PDF moduly (`premium-invoice-pdf.ts`, `premium-order-confirmation-pdf.ts`, `premium-order-cancellation-pdf.ts`, `premium-credit-note-pdf.ts`)
- **R2:** bucket `DOCUMENTS`, archiv verzí (`0020_document_content_revisions.sql`)
- **Terminologie zákazník:** PDF storno používá „storno“ (viz `premium-order-cancellation-pdf.ts`)
- **Deploy důkaz:** PNG/PDF artefakty v workflow Deploy IU Ads (7 scénářů + freeze testy)

## D1 / R2

- **Schéma:** `cloudflare/iu-ads/migrations/` (aktuální verze v `/health` → `schemaVersion`)
- **R2:** creatives, documents, backups — binding v `/health` → `r2.*`
- **Testy:** `d1_r2`, integrační reset/purge

## Veřejný web (infoUzel.cz)

- **Inject / sloty:** `public-inject.test.ts`, CSS/JS freeze guardy v `scripts/iu-premium-selected-services-freeze-guard-v1.mjs`
- **MindMenu / layout:** chráněno smoke `layout-guard` + premium display compaction guard
- **Produkce:** k 2026-10-12 `publicDeliveryEnabled: false` na `/health` — reklamy na webu podléhají samostatnému zapnutí a prod smoke workflow

## Soukromí

- `/health`: `storesIp`, `storesFingerprint`, `personalizedAds`, `retargeting`, `profiling` = false; `contextualAdsOnly` = true
- Guard skripty: žádný click endpoint, žádné impressions/clicks v public API JSON

## Budoucí PC bannery (pouze hranice)

- **Oddělení od P1–P8:** placement ID prefix `selected_services.*`; banner produkt nesmí upravovat `premium_selected_placements` ceníky existujících pozic
- **Admin placeholder:** `handleAdminBannerPcPlaceholder` — bez prodejní logiky
- **Společné služby:** auth, R2, generování dokumentů — bez změny obchodních pravidel selected services

## CI a guardy

### Required checks (celé repo, branch protection)

- `layout-guard`, `repo-guard`, `smoke`

### Deploy IU Ads (push `main`, paths `cloudflare/iu-ads/**`)

- `npm test` (celý vitest)
- PDF visual suite + artefakty
- Skripty v `DEPLOY_IU_ADS_GUARD_SCRIPTS` (manifest)

### PR workflow `iu-ads-regression-freeze` (cloudflare/iu-ads + freeze skripty)

- Manifest test + vitest bundle z manifestu + guard skripty z manifestu

### Manuální / prod (workflow_dispatch)

- `iu-ads-admin-e2e-prod.yml`, `iu-ads-client-e2e-prod.yml`, `iu-premium-order-documents-prod-proof.yml`, `iu-premium-test-data-reset-prod.yml`

## Dosud nechráněná / riziková místa

1. **Produkční E2E** — mimo required checks; spouštět vědomě po deployi.
2. **publicDeliveryEnabled** — vypnuté na prod; regrese veřejného zobrazení vyžaduje zapnutí + bounded prod smoke.
3. **Mobilní admin UI** — částečně e2e; bez plné Playwright matice na všech viewportech v required checks.
4. **PC banner produkt** — neexistuje; pouze architektonická hranice v manifestu.

## Navazující PR (doporučené dělení)

1. ✅ Inventura + manifest + PR workflow (tento dokument)
2. Rozšíření integračního testu reset cyklu (paid → storno → dobropis) pokud chybí v prod diagnostice
3. Povinný status `iu-ads-regression-freeze` v branch protection (GitHub UI)
4. Schema migration compatibility test šablona před každou novou migrací
