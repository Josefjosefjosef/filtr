# Systém ikon pro články

## Cíl

Deterministický, auditovatelný a bezpečný systém přiřazování ikon k článkům s **nulovou tolerancí chybného přiřazení**.

## Zásady

### 1. Nulová tolerance chyb
- **Ikona se zobrazí pouze při vysoké jistotě** (confidence ≥ 0.95)
- **Při jakékoli pochybnosti se ikona nezobrazí** (žádná "default" ikona)
- **Lepší žádná ikona než špatná ikona**

### 2. Determinismus
- Přiřazení musí být **reprodukovatelné** (stejný článek = stejná ikona)
- Pravidla musí být **explicitní a auditovatelná**
- Žádné náhodné nebo nedeterministické rozhodování

### 3. Priorita spolehlivosti
- **P1 (Priorita 1)**: Přímá rubrika (`topic`/`section`) - nejspolehlivější
- **P2 (Priorita 2)**: Feed/zdroj s garantovanou rubrikou (`config/sources.json`)
- **P3 (Priorita 3)**: Striktní keyword pravidla (pouze jednoznačné případy)

## Audit dat (přesné četnosti)

**Zdroj dat**: `projects/data/articles.json`  
**Datum auditu**: 2026-02-08  
**Celkový počet článků**: 220

### TOP 20 hodnot `topic` (sestupně podle četnosti)

| Hodnota | Počet | Procento |
|---------|-------|----------|
| `aktualne` | 95 | 43.2% |
| `sport` | 76 | 34.5% |
| `finance` | 21 | 9.5% |
| `zdravi` | 15 | 6.8% |
| `krimi` | 6 | 2.7% |
| `doprava` | 5 | 2.3% |
| `pocasi` | 2 | 0.9% |

**Celkem unikátních hodnot**: 7  
**Prázdné hodnoty**: 0 (100% pokrytí)

### TOP 20 hodnot `section` (sestupně podle četnosti)

| Hodnota | Počet | Procento |
|---------|-------|----------|
| `aktualne` | 95 | 43.2% |
| `sport` | 76 | 34.5% |
| `finance` | 21 | 9.5% |
| `zdravi` | 15 | 6.8% |
| `krimi` | 6 | 2.7% |
| `doprava` | 5 | 2.3% |
| `pocasi` | 2 | 0.9% |

**Celkem unikátních hodnot**: 7  
**Prázdné hodnoty**: 0 (100% pokrytí)  
**Shoda s `topic`**: 100% (všechny hodnoty `section` jsou shodné s `topic`)

### Závěr auditu

- **Spolehlivost `topic`**: VYSOKÁ (100% pokrytí, žádné prázdné hodnoty)
- **Spolehlivost `section`**: VYSOKÁ (100% pokrytí, 100% shoda s `topic`)
- **Doporučení**: `topic` je primární pole pro P1 prioritu, `section` je redundantní fallback

## Struktura dat

### Pole relevantní pro přiřazení ikon

#### `topic` (stabilní, spolehlivé)
- **Typ**: string
- **Spolehlivost**: VYSOKÁ (vždy přítomno, normalizováno)
- **Použití**: P1 priorita
- **Četnosti** (z `projects/data/articles.json`, celkem 220 článků):
  - `"aktualne"`: 95 článků (43.2%)
  - `"sport"`: 76 článků (34.5%)
  - `"finance"`: 21 článků (9.5%)
  - `"zdravi"`: 15 článků (6.8%)
  - `"krimi"`: 6 článků (2.7%)
  - `"doprava"`: 5 článků (2.3%)
  - `"pocasi"`: 2 články (0.9%)
- **Prázdné hodnoty**: 0 (100% pokrytí)

#### `section` (stabilní, spolehlivé)
- **Typ**: string
- **Spolehlivost**: VYSOKÁ (obvykle shodné s `topic`)
- **Použití**: P1 priorita (fallback pokud `topic` chybí)
- **Četnosti** (z `projects/data/articles.json`, celkem 220 článků):
  - `"aktualne"`: 95 článků (43.2%)
  - `"sport"`: 76 článků (34.5%)
  - `"finance"`: 21 článků (9.5%)
  - `"zdravi"`: 15 článků (6.8%)
  - `"krimi"`: 6 článků (2.7%)
  - `"doprava"`: 5 článků (2.3%)
  - `"pocasi"`: 2 články (0.9%)
- **Prázdné hodnoty**: 0 (100% pokrytí)
- **Poznámka**: `section` je vždy shodné s `topic` (100% shoda v datech)

#### `sources[]` (stabilní, spolehlivé)
- **Typ**: array of objects
- **Struktura**: `[{ "name": "ČT24", "url": "..." }]`
- **Spolehlivost**: VYSOKÁ (vždy přítomno, alespoň jeden zdroj)
- **Použití**: P2 priorita (mapování na `config/sources.json`)

#### `title` (nestabilní, nespolehlivé)
- **Typ**: string
- **Spolehlivost**: NÍZKÁ (variabilní, může obsahovat chyby)
- **Použití**: P3 priorita (pouze striktní keyword matching)

#### `url` (částečně spolehlivé)
- **Typ**: string
- **Spolehlivost**: STŘEDNÍ (struktura URL může být nestabilní)
- **Použití**: P3 priorita (pouze pro jednoznačné případy)

## Kaskáda priorit přiřazení

### P1: Přímá rubrika (`topic`/`section`)

**Podmínka**: `topic` nebo `section` je v mapě ikon a má confidence ≥ 0.95

**Příklad**:
```json
{
  "topic": "sport",
  "section": "sport"
}
→ ikona: "sport" (confidence: 1.0)
```

**Kdy se nezobrazí**:
- `topic` není v mapě ikon
- `topic` je prázdný nebo `null`
- Confidence < 0.95

### P2: Feed/zdroj s garantovanou rubrikou

**Podmínka**: První zdroj (`sources[0].name`) je v `config/sources.json` a má `topic` s confidence ≥ 0.95

**Příklad**:
```json
{
  "sources": [{"name": "Sport.cz", "url": "..."}],
  "topic": "aktualne"  // ale zdroj je sportovní
}
→ ikona: "sport" (confidence: 0.95) // pokud Sport.cz má topic="sport" v config
```

**Kdy se nezobrazí**:
- Zdroj není v `config/sources.json`
- Zdroj nemá `topic` v configu
- Confidence < 0.95

### P3: Striktní keyword pravidla

**Podmínka**: `title` obsahuje jednoznačné klíčové slovo s confidence ≥ 0.95

**Příklad**:
```json
{
  "title": "Předpověď počasí na víkend: Sníh a mráz",
  "topic": "aktualne"  // ale obsah je jednoznačně o počasí
}
→ ikona: "weather" (confidence: 0.95) // pokud keyword matching je striktní
```

**Kdy se nezobrazí**:
- Keyword není jednoznačný
- Více možných interpretací
- Confidence < 0.95

## Confidence scoring

### Vysoká confidence (≥ 0.95) - ikona se zobrazí
- Přímá shoda `topic`/`section` s mapou ikon: **1.0**
- Zdroj s garantovanou rubrikou: **0.95**
- Striktní keyword match (jednoznačný): **0.95**

### Střední confidence (0.80 - 0.94) - ikona se **nezobrazí**
- Nepřímá shoda nebo nejednoznačnost
- **Záměrně potlačeno** - lepší žádná ikona než špatná

### Nízká confidence (< 0.80) - ikona se **nezobrazí**
- Nejistota nebo chybějící data
- **Záměrně potlačeno**

## Auditovatelnost

Každé přiřazení ikony musí být:
1. **Reprodukovatelné** - stejný článek = stejná ikona
2. **Zdokumentované** - pravidlo je v `ICON_TAXONOMY.json`
3. **Ověřitelné** - lze ručně ověřit logiku

## Implementace

### Vstupní data
- `projects/data/articles.json` - články
- `config/sources.json` - konfigurace zdrojů

### Výstup
- Ikona se zobrazí pouze pokud:
  - Existuje pravidlo v `ICON_TAXONOMY.json`
  - Confidence ≥ 0.95
  - Všechny podmínky jsou splněny

### Fallback
- **Žádná ikona** (žádný fallback na "default" ikonu)
- **Lepší žádná ikona než špatná ikona**

## Příklady správného použití

### ✅ Správně: Vysoká confidence
```json
{
  "topic": "sport",
  "section": "sport"
}
→ ikona: "sport" (confidence: 1.0) ✅ ZOBRAZIT
```

### ✅ Správně: Záměrně potlačeno
```json
{
  "topic": "aktualne",
  "section": "aktualne",
  "title": "Nějaký obecný článek"
}
→ ikona: null (confidence: < 0.95) ✅ NEZOBRAZIT (správně)
```

### ❌ Špatně: Nízká confidence
```json
{
  "topic": "aktualne",
  "title": "Možná sport, možná ne"
}
→ ikona: "sport" (confidence: 0.60) ❌ NESMÍ SE ZOBRAZIT
```

## Vizuální specifikace (závazné)

### Umístění
- **Pozice**: Ikona vlevo od titulku na první řádek
- **Kontejner**: Součást klikací oblasti titulku (ikona je uvnitř `<a class="news-titleLink">`)
- **Specifikace**: Design system specifikace, ne implementace (implementace bude v render pipeline)

### Velikosti
- **Default**: `16px × 16px` (standardní články)
- **Compact**: `14px × 14px` (hustší režim, mobilní varianty)
- **Featured**: `18px × 18px` (volitelně pro featured články, pokud bude potřeba)

### Odsazení
- **Gap mezi ikonou a textem**: `8px` (desktop i mobile)
- **Kontejner**: `display: inline-flex`, `align-items: baseline`, `gap: 8px`

### Zarovnání
- **Baseline-optické zarovnání**:
  - Default (16px): `vertical-align: -2px`
  - Compact (14px): `vertical-align: -1px`
  - Featured (18px): `vertical-align: -3px` (volitelně)

### Barva
- **Base**: `currentColor` navázaná na meta/secondary text
- **Opacity**: `0.85` (default)
- **Hover/focus**: Ikona dědí barvu titulku při hoveru odkazu (bez samostatných efektů)
- **Kontrast**: Ikona nesmí mít vlastní pozadí, rámeček ani fill

### SVG pravidla (závazná)
Všechny ikony musí mít jednotné parametry:
- `fill="none"` (žádná výplň)
- `stroke="currentColor"` (barva z CSS)
- `stroke-width="1.5"` (konzistentní tloušťka)
- `stroke-linecap="round"` (kulaté konce)
- `stroke-linejoin="round"` (kulaté spoje)
- `viewBox="0 0 24 24"` (standardní viewBox)

### Zákaz "default" ikony
- Při nejistotě (confidence < 0.95) se ikona **nezobrazuje**
- **Lepší žádná ikona než špatná ikona**
- Žádná fallback ikona, žádná "unknown" ikona

## Mobil a responsivita (závazné)

### Breakpoints (referenční)
- **Mobile**: `max-width: 640px`
- **Desktop**: `min-width: 641px`

### Velikost ikon na mobilu
- **Mobile**: `14px × 14px` (`.iu-ico--sm`)
- **Desktop**: `16px × 16px` (`.iu-ico`)

### Mezera mezi ikonou a textem
- **Mobile**: `6px`
- **Desktop**: `8px`

### Zarovnání na mobilu
- **Mobile**: `vertical-align: -1px`
- **Desktop**: `vertical-align: -2px`

### Zalamování titulku
- **Pravidlo**: Titulek se může zalamovat na více řádků, ale ikona vždy zůstává přilepená k prvnímu řádku (vlevo)
- **Zakázané**: Ikona se nikdy nesmí přesunout na samostatný řádek
- **Implementace**: Kontejner je `inline-flex` s `align-items: baseline`, ikona má `flex-shrink: 0`

### Klikací plocha (ergonomie)
- **Pravidlo**: Ikona je uvnitř odkazu titulku (součást klikací oblasti)
- **Minimální výška klikatelného řádku titulku**: `44px` (touch guideline)
- **Zakázané**: Samostatně klikací ikona mimo odkaz

### Ochrana proti rozbití layoutu
- **Ikona**: `flex-shrink: 0` (zabrání zmenšení ikony)
- **Kontejner**: `inline-flex`, `align-items: baseline`, `gap` (drží ikonu + text v jednom toku)
- **Zakázané**:
  - Absolutní pozicování ikony
  - Plovoucí badge
  - Pravé zarovnání ikony
  - Ikona mimo tok titulku

### Mobile QA (checklist)
- ✅ **iPhone SE šířka**: Ikona + titulek drží, žádný overflow
- ✅ **Titulek na 2–3 řádky**: Ikona zůstává na 1. řádku vlevo
- ✅ **Meta řádek**: Nesmí se posunout doprava kvůli ikoně mimo titulek

## Spuštění audit příkazů (PowerShell)

### Správný způsob
- **Zásada**: `Set-Location` na samostatném řádku
- **Pak teprve**: `git ...` na další řádky
- **Zakázané**: `&&`, `Set-Location ...; git ...` v jedné řádce

**Příklad správného spuštění:**
```powershell
Set-Location "C:\projects\filtr"
git status --short
git diff --name-only
```

**Poznámka**: Chyba `Get-ChildItem : ArgumentException` je post-run wrapper z Cursor terminálu, ne skutečná chyba příkazů. Příkazy fungují správně navzdory této chybě.

## Poznámky

- Systém je **read-only** pro data (`projects/data/articles.json`)
- **Žádné změny** v render pipeline (`assets/app.js`)
- **Pouze CSS utility třídy** (volitelně, bez použití v DOM)
- **SVG ikony** v `assets/icons/` (konzistentní outline styl)
- **Counts soubory** (`docs/_topic_counts.txt`, `docs/_section_counts.txt`) jsou generované lokálně a necommitují se do repa
