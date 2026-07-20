# Právní audit (v1 cutover + whitelist 2026-07-20)

**Datum cutover:** 2026-07-17  
**Aktualizace whitelist:** 2026-07-20 — viz `12-legal-whitelist-audit.md`

## Závěr

PASS pro produkční zobrazení Přehledu dne **pouze** pro zdroje se stavem `APPROVED_*` v `legal_source_registry.json`:

- odkazy na oficiální / veřejné stránky,
- bez převzatých fotek, perexů a textů článků,
- komerční provoz webu včetně reklamy je posuzován explicitně,
- kombinování schválených zdrojů v agregovaném feedu je součástí produktu.

## Aktivní zdroje (po legal gate phase-2)

Produkčně aktivní je pouze zdroj s doloženou konkrétní licencí (aktuálně **ČHMÚ — CC BY 4.0**).  
Ostatní interim schválení z phase-1 jsou `LICENSE_UNCLEAR` / review — viz `14-legal-phase2-decisions.md`.

## Pozastaveno / mimo produkci

- **ČT24**, **iROZHLAS** — `LEGAL_REVIEW_REQUIRED`
- Oficiální RSS/tiskové zdroje bez doložené licence distribuce — `LICENSE_UNCLEAR`
- Komerční média — `REJECTED`
