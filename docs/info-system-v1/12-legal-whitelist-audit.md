# Právní whitelist audit — datové zdroje Přehledu dne

**Datum:** 2026-07-20  
**Verze registru:** `projects/data/info_events/legal_source_registry.json` v1.0.0  
**Produkt:** InfoUzel.cz jako **komerční** web s možností reklamy a agregace více zdrojů.

## Cíl

Zachovat stávající strukturu Přehledu dne a naplnit ji pouze zdroji s doložitelným právním titulem pro:

- bezplatné použití,
- komerční použití,
- web financovaný reklamou,
- automatické získávání, ukládání, veřejné zobrazení,
- úpravu/normalizaci metadat,
- kombinování s jinými schválenými zdroji,
- deduplikaci, řazení, filtrování a personalizaci,
- dlouhodobý provoz bez placené licence.

## Produktový režim (neměnit UI)

- Link-only: název položky + identifikace zdroje + odkaz na originál.
- Bez těla článku, perexu, fotografií a videí.
- Komerční média zůstávají mimo produkci (`REJECTED`).

## Centrální registr

Soubor: `projects/data/info_events/legal_source_registry.json`

Sestavení: `node scripts/iu-info-events-legal-registry-build.mjs`  
Knihovna gate: `scripts/iu-info-events-legal-registry-lib.mjs`  
Guard: `npm run iu-info-events-legal-whitelist-guard`

### Povinné stavy

Používají se stavy ze zadání (`DISCOVERED` … `REMOVED`).

**Do produkce smí pouze:**

- `APPROVED_CC0`
- `APPROVED_CC_BY`
- `APPROVED_OPEN_DATA`
- `APPROVED_WITH_ATTRIBUTION`
- `APPROVED_WITH_SPECIFIC_CONDITIONS`

### Automatické vyřazení

Např. CC BY-NC*, non-commercial, personal-only, research-only, zákaz úprav/kombinování/ukládání/automatizace, placená licence, nejasné podmínky.

## Publish gate

`scripts/iu-info-events-refresh.mjs` před ingestem volá `canPublishFromSource()`.

Každá publikovaná položka nese blok `legal` (providerId, datasetId, distributionId, legalRecordVersion, approvalStatus, attributionTemplateId, fetchedAt, sourceUrl, modifications).

## Výsledek auditu 2026-07-20 (fáze 1)

### Schválené (APPROVED_*)

Oficiální veřejné subjekty v **link-only** režimu jako `APPROVED_WITH_SPECIFIC_CONDITIONS` (interim), ČHMÚ CAP jako `APPROVED_OPEN_DATA` (interim — doplnit přesné NKOD/SPDX při reauditu).

Podmínky schválení:

1. pouze odkaz + název + zdroj,
2. atribuce instituce,
3. komerční provoz + reklama povoleny při absenci NC zákazu,
4. kombinování metadat ve feedu povoleno,
5. reaudit do `reauditDue`.

### Pozastaveno / neprošlo whitelistem

| Zdroj | Stav | Důvod |
|-------|------|--------|
| ČT24 | `LEGAL_REVIEW_REQUIRED` | Veřejnoprávní médium — bez doložené open licence vypnuto z produkce |
| iROZHLAS | `LEGAL_REVIEW_REQUIRED` | Stejně |
| Komerční média (10) | `REJECTED` | Systematické přebírání zakázáno |
| NDIC, eSbírka, Registr smluv, … | `TECHNICAL_REVIEW_REQUIRED` / `LEGAL_COMPATIBILITY_REVIEW_REQUIRED` | Technika nebo licence/GDPR |

### NKOD

NKOD je **výchozí katalog**, ne automatické schválení. Seed kandidátů je v `legal_source_registry.json` → `nkodDiscovery`.

Další fáze: projít relevantní sady v NKOD (doprava, počasí, registry, kraje) a pro každou distribuci doplnit `licenseUrl`, `nkodUrl`, atribuci a stav.

## Atribuce

Šablony v registru (`attributionTemplates`). Centrální zobrazení: stránka „Zdroje a licence“ + u položky identifikace instituce (stávající UI).

## Pravidelná kontrola

Minimálně každé `reauditDue` (90 dní) a při změně podmínek zdroje:

- dostupnost, licence, podmínky, vlastník, API, formát, atribuce, rate limit, osobní údaje.

## Co tento úkol nemění

- strukturu sekcí Přehledu dne,
- personalizaci / lokalitu / filtry,
- redesign UI.

## Gate proof (lokální)

```
node scripts/iu-info-events-legal-registry-build.mjs
npm run iu-info-events-legal-whitelist-guard
npm run iu-info-system-v1-guard
```
