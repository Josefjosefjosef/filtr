# UI SOUBORY - CHRÁNĚNÉ (DESIGN JE SVATÝ)

**Datum vytvoření:** 2026-01-25  
**Účel:** Dokumentace všech UI souborů, které NESMÍ být změněny (kromě minimálních bezpečnostních úprav)

---

## CHRÁNĚNÉ SOUBORY

### 1. `filtr/index.html`
**Status:** ⚠️ **CHRÁNĚNO**  
**Popis:** Hlavní HTML soubor s inline CSS (ř. 8-1845)  
**Co NESMÍ být změněno:**
- Layout struktura (topbar, container, layout, mainCol, sideCol)
- CSS proměnné (`:root` sekce)
- CSS třídy a ID
- Pořadí bloků (časovač, anketa, sidebar bloky, rozcestník)
- Texty prvků
- DOM struktura

**Povolené změny:**
- Minimální úpravy v JS připojení (ř. 2310-2311)
- Přidání bezpečných fallbacků (bez změny DOM struktury)
- Opt-in UI prvky (např. "Nouzový režim" badge) - pouze pokud lze vypnout a nezmění layout

**Snapshot:** `docs/ui-snapshots/index.html.baseline`

---

### 2. `filtr/assets/app.js`
**Status:** ⚠️ **CHRÁNĚNO** (ale je to zjednodušená verze - možná není finální)  
**Popis:** Hlavní JavaScript aplikace  
**Co NESMÍ být změněno:**
- DOM selektory (ID, třídy) - musí zůstat stejné
- Renderování do existujících containerů (`#newsList`, `#sectionLabel`, atd.)
- Struktura renderovaných elementů (musí odpovídat CSS třídám)

**Povolené změny:**
- Přidání fallback logiky (next/prod/lkg/emergency)
- Přidání timeout/retry pro fetch
- Přidání null checks
- Přidání error handling (bez změny UI struktury)

---

### 3. `filtr/assets/app-crash-shield.js`
**Status:** ⚠️ **CHRÁNĚNO**  
**Popis:** Crash shield + safe data layer  
**Co NESMÍ být změněno:**
- UI overlay struktura (pokud existuje)
- DOM manipulace (musí respektovat existující selektory)

**Povolené změny:**
- Vylepšení fetch logiky
- Přidání fallback strategií

---

### 4. `filtr/assets/app-render-optimizer.js`
**Status:** ⚠️ **CHRÁNĚNO**  
**Popis:** Render optimizer pro chunked rendering  
**Co NESMÍ být změněno:**
- API (`renderChunked`, `enforceDOMLimit`)
- Chování (chunked rendering, DOM limit)

**Povolené změny:**
- Optimalizace výkonu
- Přidání progress callbacks

---

## CSS PROMĚNNÉ (NESMÍ BÝT ZMĚNĚNY)

Všechny CSS proměnné v `:root` sekci `index.html` (ř. 9-72):
- `--pageBg`, `--cardBg`
- `--text`, `--muted`, `--muted2`, `--hair`
- `--titleGreen`
- `--accent`, `--accentSoft`, `--accentBorder`
- `--divider`
- `--adBg`, `--adStroke`
- `--shadow`, `--shadow2`
- `--radius`, `--radius2`
- `--topbarOffset`
- `--titleLineHeight`, `--titleLinesDesktop`, `--titleLinesMobile`
- `--readWidth`
- `--chipRadius`
- `--videoSoft`
- `--rcTile`, `--rcGap`, `--rcLabel`, `--rcLabelColor`
- `--frameBarH`, `--frameBarColor`
- `--vipGold`

---

## DOM SELEKTORY (NESMÍ BÝT ZMĚNĚNY)

Kritické ID a třídy, které JS používá:
- `#topbarWrap`, `#topbarInfo`, `#menuBtn`, `#searchForm`, `#searchInput`
- `#sectionLabel`, `#dataUpdatedAt`, `#sectionsBar`, `#newsList`
- `#emptyBox`, `#btnResetFilters`
- `#workTimer`, `#timerStatus`, `#timerBig`, `#timerStart`, `#timerStop`
- `#pollBlock`, `#dailyPoll`, `#pollClose`
- `#toolPanel`, `#paneWeather`, `#paneHoro`
- `#todayHistory`, `#emailChips`
- `.news-card`, `.videoRow`, `.news-titleLink`, `.news-sources`
- `.block`, `.sideCol`, `.mainCol`, `.layout`

---

## TEMPLATES (NESMÍ BÝT ZMĚNĚNY)

- `#tplFeedPause` (ř. 1920-1922)
- `#tplVideoBlock` (ř. 1924-1953)

**Poznámka:** Template pro video může být upraven pro "safe mode" (thumbnail first), ale struktura musí zůstat kompatibilní s CSS.

---

## VALIDACE PO ZMĚNÁCH

Po každé změně v UI souborech:
1. Porovnat `filtr/index.html` s `docs/ui-snapshots/index.html.baseline`
2. Ověřit, že CSS proměnné nebyly změněny
3. Ověřit, že DOM selektory nebyly změněny
4. Ověřit, že layout struktura nebyly změněna
5. Otestovat renderování v prohlížeči

**Potvrzení:** "UI unchanged" (kromě povolených minimálních změn)

---

## POVOLENÉ MINIMÁLNÍ ZMĚNY

1. **Přidání fallback logiky v JS:**
   - `app.js`: Přidání fallback strategií (next/prod/lkg/emergency)
   - Bez změny DOM selektorů nebo struktury

2. **Opt-in UI prvky:**
   - Např. badge "Nouzový režim" v existujícím containeru
   - Musí být opt-in (lze vypnout)
   - Nesmí změnit layout

3. **Bezpečnostní úpravy:**
   - Timeout pro fetch
   - Retry mechanismus
   - Null checks
   - Error handling (bez změny UI struktury)

---

**KONEC DOKUMENTACE**
