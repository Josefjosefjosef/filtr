# Právní přehled zdrojů — PC informační panel (InfoUzel.cz)

Dokumentace interního ověření zdrojů pro horizontální informační panel v prostředním feedu (pouze PC).

**Datum revize:** 2026-06-29  
**Verze panelu:** 1.0  
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
| **Poskytovatel** | — |
| **Ověřený bezplatný zdroj** | **Nenalezen** (komerční ceníky a portály vyloučeny) |
| **Závěr** | **Zatím placeholder** (`placeholder_only`) — text „Zdroj se ověřuje“ |

---

### 5. Doprava (silniční stav)

| Pole | Hodnota |
|------|---------|
| **Poskytovatel** | — |
| **Poznámka** | V repu existuje inventura dopravních zdrojů (`docs/transport-data-sources.md`); live agregace stavu D1 bez jasné licence pro embed **nebyla** napojena |
| **Závěr** | **Zatím placeholder** (`placeholder_only`) |

---

### 6. Elektřina

| Pole | Hodnota |
|------|---------|
| **Poskytovatel** | — |
| **Poznámka** | Burzovní/spotové ceny (OTE apod.) vyžadují samostatné licenční posouzení; bez ověření **ne** zobrazeno jako živý údaj |
| **Závěr** | **Zatím placeholder** (`placeholder_only`) |

---

### 7. Zlato

| Pole | Hodnota |
|------|---------|
| **Poskytovatel** | — |
| **Poznámka** | Finanční portály bez API licence vyloučeny; bez ověřeného free API **ne** jako live |
| **Závěr** | **Zatím placeholder** (`placeholder_only`) |

---

### 8. Vlaky (zpoždění)

| Pole | Hodnota |
|------|---------|
| **Poskytovatel** | — |
| **Poznámka** | CIS JŘ v repu = pouze seznam zastávek (open data), ne live zpoždění; scraping IDOS/dopravců **zakázán** |
| **Závěr** | **Zatím placeholder** (`placeholder_only`) |

---

### 9. Letecká doprava

| Pole | Hodnota |
|------|---------|
| **Poskytovatel** | — |
| **Poznámka** | Komerční flight trackery bez licence vyloučeny |
| **Závěr** | **Zatím placeholder** (`placeholder_only`) |

---

## Shrnutí stavu panelu

| Položka | Stav v UI |
|---------|-----------|
| EUR / CZK | **Živě** (snapshot ČNB) |
| USD / CZK | **Živě** (snapshot ČNB) |
| Bitcoin | **Živě** (snapshot CoinGecko) |
| Benzín | Placeholder |
| Doprava | Placeholder |
| Elektřina | Placeholder |
| Zlato | Placeholder |
| Vlaky | Placeholder |
| Letecká doprava | Placeholder |

---

## Technická architektura dat

- **Snapshot:** `projects/data/info_panel_snapshot.json` — generován skriptem `scripts/build_info_panel_snapshot.mjs` v CI (`.github/workflows/update-info-panel-snapshot.yml`).
- **Frontend:** `assets/iu-desktop-info-panel-data.js` + `assets/iu-desktop-info-panel.js` — čte pouze same-origin snapshot; nevolá třetí strany z prohlížeče.
- **Fallback:** Při chybě snapshotu placeholder „Data nyní nejsou dostupná“; stará data nejsou prezentována jako aktuální.

---

## Prohlášení

InfoUzel.cz nevydává zobrazované údaje za vlastní primární data. Údaje jsou přebírány z uvedených zdrojů v rozsahu povoleném jejich podmínkami. Data slouží pouze pro rychlou orientaci.
