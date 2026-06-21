# Internal Image Gallery — Pexels Import Governance

> **Status:** Plán V1 · dry-run only · žádné API volání · žádné stahování fotografií

## Princip

Galerie je **knihovna**, ne zásobník. Fotografie se po použití **neodstraňují** a lze je **znovu použít**.

Initial import je **jednorázová manuální operace** prováděná operátorem z backendu / publish pipeline. Nikdy při načtení webu.

**Pexels API se volá výhradně z backendu** při manuálním importu operátorem. Frontend ani feed pipeline Pexels nevolají.

## Výběr fotografií a fallback

- Výběr fotografie pro článek probíhá **výhradně z interní galerie** (`projects/data/image_gallery/`).
- **Žádné automatické hádání** osob, míst, objektů, firem, značek ani produktů (`AUTO_GUESSING=NO`).
- Ověřené osoby a místa vyžadují **exact match** dle dat v galerii; bez shody se použije ilustrativní fallback nebo `no_image`.
- **Fallback do interní galerie** — pokud není exact match, ilustrativní vrstva nebo `general_fallback`; nikdy externí API za běhu webu.

## Právní bezpečnost

- Každý záznam musí projít `iuPhotoArticleSafetyAudit` (`assets/iu-photo-article-safety.js`).
- Ilustrativní fotografie ve feedu mají vždy label **Ilustrační foto**.
- Exact match vyžaduje `imageExactMatchVerified: true` a shodu entity v titulku.
- Import z Pexels ukládá metadata licence (`imageLicenseSource: "Pexels License"`) a zdrojové URL autora.

## Sledování použití (usageCount / lastUsedAt)

Každý záznam v interní galerii nese povinná pole:

- `usageCount` — kolikrát byla fotografie vybrána pro článek (knihovna, ne zásobník; **neodečítá se** po použití).
- `lastUsedAt` — ISO timestamp posledního výběru; prázdné/null pokud ještě nebyla použita.

Import inicializuje `usageCount: 0` a `lastUsedAt: null`. Aktualizace probíhá až při publish pipeline, ne při dry-run.

## Zakázáno (absolutní)

| Guard | Hodnota |
|-------|---------|
| `FRONTEND_PEXELS_API_CALL` | NO |
| `USER_PAGE_LOAD_PEXELS_CALL` | NO |
| `AUTOMATIC_DAILY_REFILL` | NO |
| `AUTOMATIC_WEEKLY_REFILL` | NO |
| `AUTOMATIC_GALLERY_TOPUP` | NO |
| `AUTOMATIC_PEXELS_SYNC` | NO |
| `CRON_IMPORT_ALLOWED` | NO |

## Povoleno

| Guard | Hodnota |
|-------|---------|
| `PEXELS_ONLY_MANUAL_BACKEND_IMPORT` | YES |
| `IMAGE_REMOVED_AFTER_USE` | NO |
| `IMAGE_REUSED_ALLOWED` | YES |

## Struktura galerií

Plán V1 používá sekce InfoUzelu definované v `docs/pexels-initial-import-plan.json`:

- **SECTION_GALLERIES** (10): zpravy, sport, finance, zdravi, cestovani, hry, kultura-akce, veda-historie, vzdelavani, prehled-dne
- **SUPPLEMENTAL_GALLERIES** (12): doprava, priroda, pocasi, politika, ekonomika, technologie, bezpecnost, kriminalita, energetika, prumysl, bydleni, zemedelstvi
- **SPECIAL_GALLERIES** (3): verified_persons, verified_places_objects, general_fallback

Import zapisuje do existujícího datového modelu (`projects/data/image_gallery/`) s `imageProvider: "internal_gallery"`.

## Povinné označení ve feedu

Každá fotografie zobrazená ve feedu musí mít viditelný label:

**Ilustrační foto**

Platí i pro ověřené osoby a místa — fotografie je doprovodná k článku, nikoliv důkaz konkrétní události.

`FEED_IMAGE_LABEL_ALWAYS_VISIBLE=YES`

## Rate limit governance

Pexels default limity:

- `PEXELS_DEFAULT_HOURLY_LIMIT=200`
- `PEXELS_DEFAULT_MONTHLY_LIMIT=20000`

Při budoucím importu musí pipeline:

1. **Logovat hlavičky** `X-Ratelimit-Limit`, `X-Ratelimit-Remaining`, `X-Ratelimit-Reset` (`RATE_LIMIT_HEADERS_LOGGED=YES`)
2. **Počítat request budget** před startem (`REQUEST_BUDGET_REQUIRED=YES`)
3. **Cachovat odpovědi** včetně duplicitních dotazů (`CACHE_REQUIRED=YES`, `DUPLICATE_QUERY_CACHE_REQUIRED=YES`)
4. **Zastavit běh** při dosažení hodinového limitu (`STOP_ON_RATE_LIMIT_REACHED=YES`)
5. **Zastavit běh** při dosažení měsíčního budgetu (`STOP_ON_MONTHLY_BUDGET_REACHED=YES`)

Doporučený postup initial importu:

- Max ~180 requestů na běh (rezerva pod hodinovým limitem)
- Pauza ≥500 ms mezi requesty
- Vícedenní rozložení pokud celkový plán přesahuje měsíční budget

## Dry-run proof

```powershell
npm run iu:pexels-initial-import-plan-proof
```

Skript **nevolá Pexels**, **nestahuje fotky**, pouze:

- spočítá cílové počty položek
- odhadne počet API requestů
- ověří, že plán se vejde do limitů (s doporučeným batchingem)
- ověří absenci cron/scheduler pro gallery import
- ověří, že frontend nevolá Pexels API

## Import queue (plánovaná fronta)

Fronta je generována z plánu bez API volání:

```powershell
npm run pexels-initial-import-queue-build
npm run pexels-initial-import-queue-proof
```

Každá položka fronty obsahuje: `galleryId`, `galleryType`, `targetCount`, `query`, `locale`, `orientation`, `photosPerPage`, `estimatedRequests`, `status=planned`, `dryRunOnly=true`.

Metadata fronty zachovává:

| Guard | Hodnota |
|-------|---------|
| `PEXELS_MANUAL_INITIAL_IMPORT_ONLY` | YES |
| `QUEUE_DRY_RUN_ONLY` | YES |
| `IMAGE_REMOVED_AFTER_USE` | NO |
| `IMAGE_REUSED_ALLOWED` | YES |
| `USAGE_COUNT_SUPPORTED` | YES |
| `LAST_USED_AT_SUPPORTED` | YES |
| `FEED_IMAGE_LABEL_ALWAYS_VISIBLE` | YES |
| `RATE_LIMIT_BYPASS_ALLOWED` | NO |
| `STOP_ON_RATE_LIMIT_REACHED` | YES |
| `STOP_ON_MONTHLY_BUDGET_REACHED` | YES |

Pokud `ESTIMATED_QUEUE_REQUESTS` > 200: `IMPORT_BATCHING_REQUIRED=YES`, `MAX_REQUESTS_PER_BATCH=200`.

## Související soubory

| Soubor | Účel |
|--------|------|
| `docs/pexels-initial-import-plan.json` | Cílové počty a search dotazy V1 |
| `docs/pexels-initial-import-queue.json` | Plánovaná importní fronta V1 (dry-run) |
| `scripts/iu-pexels-initial-import-plan-proof.mjs` | Dry-run proof skript (plán) |
| `scripts/iu-pexels-initial-import-queue-build.mjs` | Builder fronty z plánu |
| `scripts/iu-pexels-initial-import-queue-proof.mjs` | Dry-run proof skript (fronta) |
| `assets/iu-internal-image-gallery.js` | Datový model a výběr z interní galerie |
| `assets/iu-photo-article-safety.js` | Právní safety + ilustrační label audit |
