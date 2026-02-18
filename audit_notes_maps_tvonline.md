# audit_notes_maps_tvonline.md

Repo: `filtr` (infoUzel.cz)  
Větev auditu: `audit/notes-maps-tvonline`  
Datum: 2026-02-18

---

## 1️⃣ Duplicity notes implementací

### Nálezy (soubory)
- `assets/app.js` – unified Notes komponent:
  - `iuNotesKey()` `assets/app.js:7969`
  - `iuRenderNotesHost()` `assets/app.js:7976`
  - `iuInitNotes()` `assets/app.js:8133`
  - mount per aktuální sekci `iuMountNotesForCurrentSection()` `assets/app.js:8141`
  - volání při změně sekce `assets/app.js:9489–9497`
- `assets/app.css` – unified Notes styl:
  - `.iuNotes` block `assets/app.css:8359+`
  - Mapy spacing `.iuNotesHost` `assets/app.css:8430–8431`
- `projects/index.html` – Notes hosty:
  - Travel hosty `projects/index.html:929, 939, 949, ...`
  - Mapy podsekce hosty `projects/index.html:1109, 1122, 1135`

### Kolik implementací Notes existuje?
- **1× hlavní implementace**: `.iuNotes` + `.iuNotesHost` (`assets/app.js` + `assets/app.css`)

### „Poznámky“ mimo sekce (potenciální matení uživatele)
- V HTML existují tlačítka „Poznámky“ v pravém sloupci:
  - `projects/index.html:176`
  - `projects/index.html:1431`
- **V `assets/*.js` není dohledaný handler** na `.iu-right-tool` (grep našel jen CSS), takže to vypadá jako **UI placeholder** oddělený od sekčních notes.

### Legacy implementace (měly by být pryč)
- Nebyly nalezeny výskyty `iuTravelNotes`, `iuMapsNotes`, `iuNotesBox/iuNotesArea/iuNotesClear`, `iuRenderTravelNotes`, `iuRenderMapsNotes`, `iuSectionNotes`, `iuMyUzelNotes` v aktuálním kódu (grep bez match).

---

## 2️⃣ Chyby localStorage

### Notes klíče (jednotnost)
- Notes prefix je definovaný jako `IU_NOTES_PREFIX = "iu_notes_v1_"` uvnitř Notes modulu (`assets/app.js` – viz grep okolí `iuNotesKey()` na `assets/app.js:7969`).
- `iuNotesKey(scope, name)` skládá key z normalizovaných slugů (scope + name), takže:
  - Mapy podsekce: `iu_notes_v1_maps_<slug>` (např. `iu_notes_v1_maps_navigace`)
  - Travel podsekce: `iu_notes_v1_travel_<slug>`
  - Sekční notes (radio/mapy/…): `iu_notes_v1_section_<slug>`
  - MyUzel: `iu_notes_v1_myuzel_slot-<n>`

### Automatické mazání / TTL / cleanup
- V Notes modulu **není** `removeItem` ani TTL.
- V repu ale existují `removeItem` na jiné věci (ne Notes):
  - `assets/app-crash-shield.js:188` (crash diagnostika)
  - `assets/app.js:6264–6265` (clear `iu:lastError*`)

### Migrace / kompatibilita (rizika)
- Pro sekční notes existuje legacy JSON storage `IU_SECTION_NOTES_KEY = "iu_section_notes_v1"` (`assets/app.js:7940`) + loader/saver (`assets/app.js:7943`, `assets/app.js:7955`).
  - Riziko: legacy klíč může „žít“ paralelně (pokud se rozhodne nemigrovat do `iu_notes_v1_section_*`).
- V Notes modulu je vidět logika migrace (grep: `assets/app.js:7995+`, `assets/app.js:8008+`).

---

## 3️⃣ Chyby render lifecycle

### Přepínání view (kritická místa)
- `showView()` přepíná `hidden` jen pro:
  - `#feed`, `#iuRadioView`, `#iuJrEmptyView`, `#iuMapyView`, `#iuMyUzelView1..5` (`assets/app.js:9375+`)
- `tvonline` a `travel` view nejsou v `showView()` explicitně unhide → spoléhají na CSS, které přebije `[hidden]`:
  - `#iuTvOnlineView` scoping je v CSS (`assets/app.css:2791–2792`)
  - `#iuTravelView` scoping je v CSS (`assets/app.css:4782–4789`)
  - **Riziko**: pokud by někde byla globální `[hidden]{display:none !important}`, view zůstane skryté.

### Kdy se renderují notes
- Notes init je volaný při každém `applySectionFromURL()`:
  - `iuMountNotesForCurrentSection()` + `iuInitNotes()` (`assets/app.js:9489–9497`)
- To znamená:
  - sekční notes (host vytvářený mountem) se přidají při vstupu do sekce
  - všechny deklarované `.iuNotesHost` v DOM (Travel/Mapy podsekce) se zrenderují při vstupu do jakékoli sekce (ne jen Travel/Mapy)
    - Riziko: zbytečná práce při přepnutí (malé, ale existuje).

---

## 4️⃣ Chyby sdílení

### Kolik implementací sdílení existuje?
- **1×** sdílení pro sekční notes (unified): `navigator.share` + fallback clipboard + Email + WhatsApp (`assets/app.js` grep na `navigator.share` / `mailto:?subject=` / `wa.me` u `.iuNotes*`).
- Další `mailto:` helper existuje i jinde (`assets/app.js:9761`), ale to není Notes komponent.

### Možné UX riziko
- `Sdílet` fallback: když není `navigator.share`, jde do clipboard+alertu (podle grep kontextu u `.iuNotesShare`).
  - Pokud cílem je 1:1 „Sdílet“ jako MyUzel, je to konzistentní; jen pozor na prostředí bez clipboard permissions.

---

## 5️⃣ Mapy – konkrétní problémy

### HTML hosty – umístění / duplicity
V `#iuMapyView` jsou hosty přesně pod gridy v podsekcích:
- Navigace: `projects/index.html:1109` (pod `aria-label="Navigace (odkazy)"`)
- Auto & Mobilita: `projects/index.html:1122`
- Výlety & Outdoor: `projects/index.html:1135`

Nevidím duplicity hostů v jedné podsekci (načtený výřez `projects/index.html:1079–1136`).

### Pozn.: sekční notes navíc
- Pro sekci `mapy` se zároveň mountuje **sekční notes** host (`scope="section", name="mapy"`) do `#iuMapyView` (`assets/app.js:8141+`), obvykle hned za první grid/chip.
  - To je samostatný notes box navíc k 3 podsekčním.

---

## 6️⃣ Travel – konkrétní problémy

### Hosty podsekcí
- Letenky a plánování trasy má host: `projects/index.html:929`
- Dále hosty pro všechny vypsané podsekce (grep: `projects/index.html:939, 949, 959, 974, 989, 1000, 1010, 1057, 1067, 1077`)

### Render Travel view
- Travel view je primárně zobrazované CSS scopingem na `body[data-section="travel"]` (`assets/app.css:4782–4789`), ne přes `showView()`.
  - Riziko stejné jako u TV Online: spoléhání na přebití `[hidden]`.

---

## 7️⃣ TV Online – zdroj tlačítek

### Odkud se generují tlačítka?
- **Staticky v HTML**: `projects/index.html` obsahuje `#iuTvOnlineView` (`projects/index.html:1196+`) a grid `.iuTvOnlineGrid` (`projects/index.html:1204+`).
- V auditu nenalezen žádný JSON/JS generátor pro TV Online chipy (grep jen CSS/ID reference).

### Nechtěná tlačítka/kanály
Grep na zakázané položky našel jen:
- „YouTube“ jako MindMenu rychlý odkaz (není součást TV Online gridu):
  - `projects/index.html:155–157`
  - `projects/index.html:1327–1329`
- „BBC/NASA/Bloomberg“ v `projects/data/videos*.json` jsou **YouTube zdroje pro video feed**, ne TV Online chipy:
  - např. `projects/data/videos.json:458–459` (`Bloomberg Quicktake`)
  - `projects/data/videos.json:849–850` (`BBC News`)

### Duplicity typu „Bloomberg 2×“
- V `projects/index.html` (TV Online view) audit grep nenašel `Bloomberg TV` ani `bloomberg.com/live`.
- Bloomberg zůstává jen ve videos zdrojích jako `BloombergQuicktake` (OK, jiný modul).

---

## 8️⃣ CSS konflikty

### Notes styly
- Je vidět pouze 1 sada stylů pro `.iuNotes*` (`assets/app.css:8359+`).
- Nevidím paralelní `.iuNotesBox/.iuNotesArea` (legacy) v CSS.

### Dead selectors / historická kompatibilita
- CSS stále obsahuje selektory pro `#iuMapsView` (např. `.iuRadioChip` styling `assets/app.css:8240+`, notes spacing `assets/app.css:8431`), ale v HTML je primární `#iuMapyView` (`projects/index.html:1079`).
  - Nevadí funkčně, ale zvyšuje „šum“ a riziko budoucích konfliktů.

---

## 9️⃣ CLS rizika

### Notes textarea autosize
- Notes používají autosize (height podle `scrollHeight`) → při prvním renderu s existujícím textem z localStorage může dojít k posunu layoutu v rámci sekce.
  - Čistě UX: očekávané, ale při měření CLS záleží na timing + zda to nastane bez user input.

### Skryté view přes `[hidden]` + CSS override
- `travel` a `tvonline` view spoléhají na CSS override `display:block !important` (scoped na `body[data-section=...]`).
  - Pokud by prohlížeč/stylesheet měl přísnější `hidden` pravidla, view by zůstalo skryté a následné „dohánění“ by mohlo způsobit skoky.

### Debug token
- `/projects?debug=1` nastavuje `data-iu-debug="1"` (viditelné v HTML přes curl), ale bez browser runtime nelze z terminálu potvrdit CLS metriky ani vizuální skoky.

---

## 🔟 Doporučený fix plan (konkrétní soubory a řádky)

> POZOR: toto je jen plán; v tomto auditu nic neopravujeme.

1) **Stabilizovat lifecycle view pro Travel/TV Online (nejen CSS override)**
   - soubor: `assets/app.js`
   - místo: `showView()` (`assets/app.js:9375+`)
   - návrh: explicitně přidat `const tvonlineEl = ...`, `const travelEl = ...` a přepínat `hidden` stejně jako u mapy/radio/jr.

2) **Rozhodnout o legacy storage pro sekční notes (`iu_section_notes_v1`)**
   - soubor: `assets/app.js`
   - místo: `IU_SECTION_NOTES_KEY` + `iuLoadLegacySectionNotes()` (`assets/app.js:7940+`)
   - návrh: buď ponechat navždy (OK), nebo přidat jednorázovou migraci (ale pouze s explicitní akcí / nebo při 100% jistotě, že je to bezpečné).

3) **Zredukovat dead CSS selektory `#iuMapsView`**
   - soubor: `assets/app.css`
   - místa: `assets/app.css:8240+`, `assets/app.css:8431`
   - návrh: pokud `#iuMapsView` už nikde reálně neexistuje, odstranit duplicitní selektory pro snížení rizika konfliktů.

4) **Vyjasnit UI „Poznámky“ v pravém sloupci**
   - soubor: `projects/index.html` (`projects/index.html:176`, `projects/index.html:1431`)
   - návrh: buď doplnit JS handler (samostatný modul), nebo přejmenovat, aby se nepletlo se sekčními poznámkami.

