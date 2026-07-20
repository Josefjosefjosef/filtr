# Právní audit (v1 cutover + whitelist 2026-07-20)

**Datum cutover:** 2026-07-17  
**Aktualizace whitelist:** 2026-07-20 — viz `12-legal-whitelist-audit.md`

## Závěr

PASS pro produkční zobrazení Přehledu dne **pouze** pro zdroje se stavem `APPROVED_*` v `legal_source_registry.json`:

- odkazy na oficiální / veřejné stránky,
- bez převzatých fotek, perexů a textů článků,
- komerční provoz webu včetně reklamy je posuzován explicitně,
- kombinování schválených zdrojů v agregovaném feedu je součástí produktu.

## Aktivní zdroje (po legal gate)

Oficiální instituce schválené jako `APPROVED_WITH_SPECIFIC_CONDITIONS` (link-only) + ČHMÚ CAP jako `APPROVED_OPEN_DATA` (interim).  
Aktuální seznam: `productionActive=true` ∩ `canPublishFromSource()=ok`.

## Pozastaveno 2026-07-20

- **ČT24**, **iROZHLAS** — `LEGAL_REVIEW_REQUIRED` (veřejnoprávní média bez doložené open licence pro komerční agregaci).

## Deaktivované komerční zdroje (UI + legal REJECTED)

Seznam Zprávy, Novinky, iDNES, Aktuálně, Deník, Blesk, HN, E15, Sport.cz, iSport — důvod: komerční média bez open licence / smlouvy; InfoUzel nepoužívá placené licence.
