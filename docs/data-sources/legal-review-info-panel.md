# Právní přehled zdrojů — PC informační panel (InfoUzel.cz)

Dokumentace interního ověření zdrojů pro horizontální informační panel v prostředním feedu (pouze PC, ≥1025 px).

**Datum revize:** 2026-06-28  
**Verze panelu:** 4.0  
**Zásada:** Nebyly použity neověřené živé zdroje. Scraping komerčních webů nebyl použit.

Detail API DataStat: [datastat-info-panel.md](./datastat-info-panel.md)

---

## Obecná pravidla implementace

| Pravidlo | Stav |
|----------|------|
| Scraping cizích webů | **NE** — nepoužito |
| Neoficiální API | **NE** — nepoužito |
| Loga poskytovatelů | **NE** — pouze emoji ikony panelu |
| API klíče ve frontendu | **NE** — snapshot generován v CI |
| Uvedení zdroje u položky | **ANO** — dialog ⓘ Zdroj |
| Cache snapshotu | **ANO** — `projects/data/info_panel_snapshot.json` |
| Strojové načítání | **ANO** — GitHub Actions hodinově |

---

## Verdikt zdrojů (souhrn)

| Zdroj | Verdikt | Poznámka |
|-------|---------|----------|
| ČNB devizové kurzy | ✅ POVOLENO S PODMÍNKAMI | Povinná atribuce ČNB |
| CoinGecko (BTC, PAX Gold) | ✅ POVOLENO S PODMÍNKAMI | Orientační tržní ceny; follow-up re-check terms |
| ČSÚ DataStat (ostatní ukazatele) | ✅ POVOLENO S PODMÍNKAMI | Povinná atribuce ČSÚ |
| MPSV Portál otevřených dat (PNO, uchazeči, VPM) | ✅ POVOLENO S PODMÍNKAMI | Od 2025 oficiální měsíční zdroj; atribuce MPSV/ÚP |
| ČSÚ WREG01CT4 jako „aktuální MPSV“ | ❌ NEPOUŽÍVAT | Archivní roční řada; ČSÚ přesměrovává na MPSV portal |
| CHMU / povodně / sucho / požáry | ❌ NEPOUŽÍVAT | Chybí embed API |
| Dopravní omezení (live) | ❌ NEPOUŽÍVAT | Chybí ověřené API |
| Vlaky / letecká doprava (live) | ❌ NEPOUŽÍVAT | COICOP nemá samostatné indexy |
| Reálné mzdy | ❌ NEPOUŽÍVAT | Nenalezen spolehlivý samostatný ukazatel |

---

## Položky panelu v4 (32 karet)

### Denní ukazatele (1–7)

| # | Karta | Poskytovatel | Aktualizace | Stale limit |
|---|-------|--------------|-------------|-------------|
| 1 | Natural 95 | ČSÚ DataStat CENPHMTT01 | týdně | 14 dní |
| 2 | Motorová nafta | ČSÚ DataStat CENPHMTT01 | týdně | 14 dní |
| 3 | EUR/CZK | ČNB | pracovní dny | 2 dny |
| 4 | USD/CZK | ČNB | pracovní dny | 2 dny |
| 5 | Elektřina (COICOP energie) | ČSÚ CEN0101ET03 | měsíčně | 45 dní |
| 6 | Zlato (PAX Gold) | CoinGecko | hodinově | 2 hodiny |
| 7 | Bitcoin | CoinGecko | hodinově | 2 hodiny |

### Ekonomika (16–25, bez reálných mezd)

| # | Karta | DataStat kód | Periodicita |
|---|-------|--------------|-------------|
| 16 | Inflace | CEN0101HT02 | měsíčně |
| 17 | Nezaměstnanost | MPSV evid_pno_up_agr_frz_odata | měsíčně |
| 18 | Průměrná mzda | WPRACECRQT3 | čtvrtletně |
| 19 | Průměrná hrubá mzda | WREG0303 | ročně |
| 21 | HDP | WNUC01T01 | čtvrtletně |
| 22 | Průmysl | PRU01BT1 | měsíčně |
| 23 | Stavebnictví | STA04BT1 | měsíčně |
| 24 | Maloobchod | OBC01BT1 | měsíčně |
| 25 | Zemědělství | CEN02031T03 | měsíčně |

### Trh práce (26–28)

| # | Karta | DataStat kód |
|---|-------|--------------|
| 26 | Volná pracovní místa | MPSV vm_stav_vm_stat_agr_frz_odata_vp |
| 27 | Zaměstnanost | WVSPSAT1 |
| 28 | Registrovaná nezaměstnanost | MPSV evid_pno_up_agr_frz_odata |

### Obyvatelstvo (29–36)

| # | Karta | DataStat kód |
|---|-------|--------------|
| 29 | Počet obyvatel | WOBYNEJ |
| 30 | Narození | WOBY03 |
| 31 | Úmrtí | WOBY04A |
| 32 | Sňatky | WOBY05A |
| 33 | Rozvody | WOBY05B |
| 34 | Počet cizinců | CIZ003T003 |
| 35 | Senioři 65+ | WOBY02M2 |
| 36 | Stěhování | OBY06T01 |

### Společnost (37–41)

| # | Karta | DataStat kód |
|---|-------|--------------|
| 37 | Vzdělávání | VZD07T02 |
| 38 | Zdraví | WFIN02A |
| 39 | Kriminalita | KRI10T01 |
| 40 | Volby | VOLPST2 |
| 41 | Životní prostředí | WZPR05T01 |

Všechny položky: `verified_requires_attribution`, dialog ⓘ obsahuje poskytovatele, licenci, odkaz na API, periodicitu a disclaimer orientačního charakteru.

---

## Nepoužité položky ze specifikace

| Položka | Důvod |
|---------|-------|
| Dopravní omezení | ❌ Chybí oficiální embed API |
| Vlaky (live) | ❌ COICOP bez samostatného železničního indexu |
| Letecká doprava (live) | ❌ COICOP bez samostatného leteckého indexu |
| Kvalita ovzduší, výstrahy ČHMÚ | ❌ Chybí ověřené API |
| Povodně, sucho, požáry | ❌ Chybí ověřené API |
| Reálné mzdy | ❌ Nenalezen spolehlivý DataStat výběr |

---

## Technická architektura dat

- **Katalog:** `assets/iu-desktop-info-panel-catalog.js` — id, pořadí, skupina, právní metadata, fetchBucket, maxAgeMs.
- **Merge vrstva:** `assets/iu-desktop-info-panel-data.js` — stale/error/placeholder stavy.
- **Snapshot build:** `scripts/build_info_panel_snapshot.mjs` — ČNB, CoinGecko, ČSÚ CSV.
- **CI refresh:** `.github/workflows/update-info-panel-snapshot.yml` — hodinově `:15`.
- **Frontend:** `assets/iu-desktop-info-panel.js` — pouze same-origin snapshot; vizuál V3 beze změny.

---

## Prohlášení

InfoUzel.cz nevydává zobrazované údaje za vlastní primární data. Údaje slouží pouze pro rychlou orientaci. Před důležitým rozhodnutím doporučujeme ověřit informace přímo u oficiálního poskytovatele.
