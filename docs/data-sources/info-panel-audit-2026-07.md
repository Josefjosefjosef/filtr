# Audit Informační lišty — 2026-07-16 (varianta A / kritické opravy)

**Rozsah PR:** kompletní auditní evidence + bezpečné kritické opravy (MPSV labour, výpočet změn, freshness `school_year`, ČNB ověření beze změny API).  
**Není** formální právní stanovisko.  
**Follow-up PR:** zbytek zdrojů dle registru `assets/iu-info-panel-source-registry.js`.

## Kritické nálezy (opraveno v tomto PR)

| Ukazatel | Problém | Nový/potvrzený zdroj | Oprava |
|----------|---------|----------------------|--------|
| Podíl nezaměstnaných | Roční ČSÚ `WREG01CT4` (2023) | MPSV `evid_pno_up_agr_frz_odata` JSON | Měsíční PNO % z celostátní agregace |
| Uchazeči o zaměstnání | Stejný archiv | Stejný endpoint (součet evidence) | Měsíční absolutní počet |
| Volná pracovní místa | Stejný archiv | MPSV `vm_stav_vm_stat_agr_frz_odata_vp` CSV | Součet `volna_mista_rozhodne_datum` |
| Výpočty změn | Absolutní `toFixed(2)` bez jednotek / proti 0 | `iu-info-panel-change-utils.js` | p. b. / Kč / nedostupná změna |
| Freshness school_year | Chybělo ve whitelistu periodik | `iu-desktop-info-panel-data.js` | Roční/školní data nejsou falešně stale |
| EUR/USD ČNB | Již opraveno (#7497) | Oficiální `denni_kurz.txt` | Ověřeno — endpoint + calendar freshness ponechány |

## Odstraněné endpointy

- `https://data.csu.gov.cz/api/dotaz/v1/data/vybery/WREG01CT4?format=CSV` jako zdroj aktuální MPSV nezaměstnanosti / VPM / uchazečů

## Nové endpointy

- `https://data.mpsv.cz/portal/api/reports/by-table/evid_pno_up_agr_frz_odata/data/json`
- `https://data.mpsv.cz/portal/api/reports/by-table/vm_stav_vm_stat_agr_frz_odata_vp/data/csv?fileName=volna_mista_posledni_data`

## Právní rizika

| Zdroj | Riziko | Verdikt |
|-------|--------|---------|
| MPSV portal API | Není klasický NKOD downloadURL; podmínky přes open-data odkazy portálu | Použitelné s atribucí MPSV/ÚP; monitorovat změnu tableName |
| CoinGecko | Komerční/redistribuce API terms | Dočasně OK s atribucí; follow-up PR |
| HTML scraping kurzy.cz / Power BI | Zakázáno úkolem | Nepoužito |

## Technická rizika

| Riziko | Mitigace |
|--------|----------|
| VPM last-month CSV ≈ 7 MB | Bucket `mpsv_labor` denní check; cache snapshot |
| VPM history CSV ≈ 119 MB | Nepoužívat; MoM z předchozího snapshot období |
| Změna schema tableName | Guard + error `mpsv_*` zachová last valid |

## MPSV kandidáti

- **Doporučeno později:** uchazeči na 1 VPM; MoM změny (částečně už v secondaryValue)
- **Nedoporučeno do hlavní lišty:** regionální žebříčky, věková/vzdělanostní struktura
- **K rozhodnutí:** podíl dlouhodobě nezaměstnaných

## Stav ostatních 29 karet

Zůstávají na ČSÚ DataStat / ČNB / CoinGecko dle stávajícího katalogu. Centrální formátování změn platí pro všechny `putItem` volání. Detailní endpoint-by-endpoint právní re-audit ČSÚ položek → follow-up PR (nesmí bločit frontu).
