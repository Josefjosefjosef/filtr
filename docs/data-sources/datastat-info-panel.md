# DataStat API — PC informační panel (InfoUzel.cz)

**Datum revize:** 2026-06-28  
**Verze panelu:** 4.0

## Oficiální API

| Položka | Hodnota |
|---------|---------|
| **Base URL** | https://data.csu.gov.cz/api/ |
| **Katalog výběrů** | `GET /katalog/v1/vybery` |
| **CSV data výběru** | `GET /dotaz/v1/data/vybery/{KOD}?format=CSV` |
| **Podmínky** | https://csu.gov.cz/zakladni-informace-pro-pouziti-api-datastatu |

## Implementace v InfoUzel

- Frontend **nevolá** DataStat přímo — pouze same-origin snapshot `projects/data/info_panel_snapshot.json`.
- Snapshot generuje `scripts/build_info_panel_snapshot.mjs` v CI workflow `.github/workflows/update-info-panel-snapshot.yml` (cron hodinově `:15`).
- Každá karta má vlastní `fetchBucket`, `maxAgeMs`, matcher a error bucket.
- Při výpadku jednoho zdroje ostatní karty zůstávají funkční.

## Použité předdefinované výběry (vybery)

| Karta | Kód | Periodicita zdroje |
|-------|-----|-------------------|
| Natural 95 / nafta | CENPHMTT01 | týdenní |
| Energie (COICOP) | CEN0101ET03 | měsíční |
| Inflace | CEN0101HT02 | měsíční |
| Nezaměstnanost / volná místa / uchazeči | *(přesunuto)* MPSV portal API | měsíční | viz [info-panel-audit-2026-07.md](./info-panel-audit-2026-07.md) |
| Průměrná mzda (Q) | WPRACECRQT3 | čtvrtletní |
| Hrubá mzda (rok) | WREG0303 | roční |
| HDP | WNUC01T01 | čtvrtletní |
| Průmysl | PRU01BT1 | měsíční |
| Stavebnictví | STA04BT1 | měsíční |
| Maloobchod | OBC01BT1 | měsíční |
| Zemědělství | CEN02031T03 | měsíční |
| Zaměstnanost (VŠPS) | WVSPSAT1 | roční |
| Obyvatelstvo | WOBYNEJ | kvartální |
| Narození | WOBY03 | roční |
| Úmrtí | WOBY04A | roční |
| Sňatky / rozvody | WOBY05A / WOBY05B | roční |
| Cizinci | CIZ003T003 | roční |
| Senioři 65+ | WOBY02M2 | roční |
| Stěhování | OBY06T01 | roční |
| Vzdělávání | VZD07T02 | školní rok |
| Zdraví | WFIN02A | čtvrtletní |
| Kriminalita | KRI10T01 | roční |
| Volby | VOLPST2 | po volbách |
| Životní prostředí | WZPR05T01 | roční |

## Cache a fallback

| Pravidlo | Chování |
|----------|---------|
| **Cache** | Snapshot JSON v repozitáři; frontend `cache: no-cache` |
| **Stale** | Po `maxAgeMs` od `generatedAt` → stav „Data nejsou aktuální“ |
| **Výpadek fetch** | Karta → „Data nyní nejsou dostupná“; ostatní beze změny |
| **Scraping** | **NEPOUŽITO** |

## Nepoužité položky (v4)

Viz `IU_INFO_PANEL_EXCLUDED` v `assets/iu-desktop-info-panel-catalog.js` a sekci „Nepoužité položky“ v `legal-review-info-panel.md`.
