# Právní přehled zdrojů — PC informační panel (InfoUzel.cz)

Dokumentace interního ověření zdrojů pro horizontální informační panel v prostředním feedu (pouze PC).

**Datum revize:** 2026-06-28  
**Verze panelu:** 3.0  
**Zásada:** Nebyly použity neověřené živé zdroje. Scraping komerčních webů nebyl použit.

---

## Obecná pravidla implementace

| Pravidlo | Stav |
|----------|------|
| Scraping cizích webů | **NE** — nepoužito |
| Loga poskytovatelů | **NE** — pouze emoji ikony panelu |
| Osobní údaje / tracking třetích stran | **NE** |
| API klíče ve frontendu | **NE** — snapshot generován v CI |
| Uvedení zdroje u položky | **ANO** — ⓘ tooltip + detail |
| iCentrum „Zdroje dat“ | **ANO** |

---

## Položky panelu

### 1. EUR / CZK

| Pole | Hodnota |
|------|---------|
| **Poskytovatel** | Česká národní banka (ČNB) |
| **URL zdroje** | https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt |
| **URL podmínek** | https://www.cnb.cz/cs/verejnost/pro-media/informace-pro-media/pravidla-pro-pouzivani-informaci-cnb/ |
| **Typ dat** | Oficiální denní fixace devizového kurzu |
| **Aktualizace** | 1× denně (pracovní dny), snapshot v CI |
| **Požadavek na citaci** | **ANO** — uvedení ČNB jako zdroje |
| **Komerční použití** | Povoleno s uvedením zdroje dle pravidel ČNB |
| **Ukládání / redistribuce** | Snapshot agregovaných hodnot v repozitáři (`projects/data/info_panel_snapshot.json`) |
| **Závěr** | **Lze použít** (`verified_requires_attribution`) |

---

### 2. USD / CZK

| Pole | Hodnota |
|------|---------|
| **Poskytovatel** | Česká národní banka (ČNB) |
| **URL zdroje** | stejné jako EUR / CZK |
| **URL podmínek** | stejné jako EUR / CZK |
| **Typ dat** | Oficiální denní fixace devizového kurzu |
| **Závěr** | **Lze použít** (`verified_requires_attribution`) |

---

### 3. Bitcoin (BTC / CZK)

| Pole | Hodnota |
|------|---------|
| **Poskytovatel** | CoinGecko |
| **URL zdroje** | https://api.coingecko.com/api/v3/simple/price |
| **URL podmínek** | https://www.coingecko.com/en/api_terms |
| **Typ dat** | Orientační tržní cena kryptoměny (agregovaná) |
| **Aktualizace** | Snapshot v CI (max. hodinově) |
| **Požadavek na citaci** | **ANO** — odkaz na CoinGecko |
| **Komerční použití** | Free API tier s limity; zobrazení ceny povoleno s uvedením zdroje |
| **Ukládání** | Agregovaná hodnota v snapshot JSON |
| **Závěr** | **Lze použít** (`verified_requires_attribution`) — informativní, ne investiční rada |

---

### 4. Benzín (Natural 95)

| Pole | Hodnota |
|------|---------|
| **Poskytovatel** | Český statistický úřad (DataStat) |
| **URL zdroje** | https://data.csu.gov.cz/api/dotaz/v1/data/vybery/CENPHMTT01?format=CSV |
| **URL podmínek** | https://csu.gov.cz/zakladni-informace-pro-pouziti-api-datastatu |
| **Typ dat** | Průměrná týdenní cena Natural 95 |
| **Aktualizace** | Týdně, snapshot v CI |
| **Požadavek na citaci** | **ANO** — uvedení ČSÚ |
| **Závěr** | **Lze použít** (`verified_requires_attribution`) |

---

### 5. Doprava (motorová nafta)

| Pole | Hodnota |
|------|---------|
| **Poskytovatel** | Český statistický úřad (DataStat) |
| **URL zdroje** | https://data.csu.gov.cz/api/dotaz/v1/data/vybery/CENPHMTT01?format=CSV |
| **Typ dat** | Průměrná týdenní cena motorové nafty (orientační ukazatel dopravy) |
| **Závěr** | **Lze použít** (`verified_requires_attribution`) |

---

### 6. Elektřina (index energie)

| Pole | Hodnota |
|------|---------|
| **Poskytovatel** | Český statistický úřad (DataStat) |
| **URL zdroje** | https://data.csu.gov.cz/api/dotaz/v1/data/vybery/CEN0101ET03?format=CSV |
| **Typ dat** | Index spotřebitelských cen COICOP — bydlení, energie a paliva |
| **Poznámka** | Ne spotová cena kWh; oficiální statistický index |
| **Závěr** | **Lze použít** (`verified_requires_attribution`) |

---

### 7. Zlato (PAX Gold)

| Pole | Hodnota |
|------|---------|
| **Poskytovatel** | CoinGecko |
| **URL zdroje** | https://api.coingecko.com/api/v3/simple/price (id: pax-gold) |
| **Typ dat** | Orientační tržní cena tokenizovaného zlata v CZK |
| **Závěr** | **Lze použít** (`verified_requires_attribution`) — informativní |

---

### 8. Vlaky (index dopravy)

| Pole | Hodnota |
|------|---------|
| **Poskytovatel** | Český statistický úřad (DataStat) |
| **URL zdroje** | https://data.csu.gov.cz/api/dotaz/v1/data/vybery/CEN0101ET03?format=CSV |
| **Typ dat** | Index spotřebitelských cen COICOP — doprava / železniční doprava |
| **Poznámka** | Ne live zpoždění vlaků; statistický index jako legální náhrada |
| **Závěr** | **Lze použít** (`verified_requires_attribution`) |

---

### 9. Letecká doprava

| Pole | Hodnota |
|------|---------|
| **Poskytovatel** | Český statistický úřad (DataStat) |
| **URL zdroje** | https://data.csu.gov.cz/api/dotaz/v1/data/vybery/CEN0101ET03?format=CSV (případně WCEN01MT01 pro inflaci) |
| **Typ dat** | Index spotřebitelských cen COICOP — letecká doprava |
| **Závěr** | **Lze použít** (`verified_requires_attribution`) |

---

## Shrnutí stavu panelu

| Položka | Stav v UI |
|---------|-----------|
| EUR / CZK | **Živě** (snapshot ČNB) |
| USD / CZK | **Živě** (snapshot ČNB) |
| Bitcoin | **Živě** (snapshot CoinGecko) |
| Benzín | **Živě** (snapshot ČSÚ) |
| Doprava | **Živě** (snapshot ČSÚ) |
| Elektřina | **Živě** (snapshot ČSÚ COICOP) |
| Zlato | **Živě** (snapshot CoinGecko PAXG) |
| Vlaky | **Živě** (snapshot ČSÚ COICOP) |
| Letecká doprava | **Živě** (snapshot ČSÚ COICOP) |

---

## Technická architektura dat

- **Snapshot:** `projects/data/info_panel_snapshot.json` — generován skriptem `scripts/build_info_panel_snapshot.mjs` v CI (`.github/workflows/update-info-panel-snapshot.yml`). Zdroje: ČNB, CoinGecko (BTC, PAX Gold), ČSÚ DataStat (paliva, COICOP, inflace).
- **Frontend:** `assets/iu-desktop-info-panel-data.js` + `assets/iu-desktop-info-panel.js` — čte pouze same-origin snapshot; nevolá třetí strany z prohlížeče.
- **Fallback:** Při chybě snapshotu placeholder „Data nyní nejsou dostupná“; stará data nejsou prezentována jako aktuální.

---

## Prohlášení

InfoUzel.cz nevydává zobrazované údaje za vlastní primární data. Údaje jsou přebírány z uvedených zdrojů v rozsahu povoleném jejich podmínkami. Data slouží pouze pro rychlou orientaci.
