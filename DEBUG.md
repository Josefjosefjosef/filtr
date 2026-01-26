# DEBUG.md – Diagnostika a root cause analýza

## Jak poznat problém

### 1. Bílá stránka / nic se nevykreslí
**Příčiny:**
- Fatal JS error před vykreslením UI
- Chybějící CSS/JS soubory
- Syntax error v hlavním skriptu

**Diagnostika:**
- Otevři konzoli (F12) → hledej červené chyby
- Zkontroluj Network tab → zda se načítají všechny soubory
- Zkontroluj `?debug=1` → debug panel ukáže poslední chybu

**Root cause #1: fetch bez try/catch**
- **Soubor:** `assets/app.js` řádky 1359, 1393
- **Problém:** `fetch()` může spadnout při síťové chybě
- **Oprava:** Přidán `app-crash-shield.js` s `safeFetchJSON()` wrapperem

**Root cause #2: JSON.parse bez guardu**
- **Soubor:** `assets/app.js` řádky 1364, 1404
- **Problém:** Pokud přijde HTML místo JSON, parse spadne
- **Oprava:** `safeFetchJSON()` kontroluje `looksLikeHTML()` před parse

### 2. UI se vykreslí, ale data se nenačtou
**Příčiny:**
- Fetch timeout
- 404 na JSON soubory
- CORS problém
- GitHub Pages vrátí HTML místo JSON

**Diagnostika:**
- Network tab → zkontroluj status kódy
- Console → hledej fetch errors
- `?debug=1` → fetch log ukáže všechny pokusy

**Root cause #3: GitHub Pages 404 vrací HTML**
- **Soubor:** `assets/app.js` řádek 1359
- **Problém:** Když soubor neexistuje, Pages vrátí HTML 404 stránku
- **Oprava:** `safeFetchJSON()` detekuje HTML a padne na cache

**Root cause #4: Žádný timeout na fetch**
- **Soubor:** `assets/app.js` řádky 1359, 1393
- **Problém:** Fetch může viset nekonečně při pomalé síti
- **Oprava:** `fetchWithTimeout()` s AbortController (8-9s timeout)

### 3. Data se načtou, ale render spadne
**Příčiny:**
- Null DOM selektor
- Nevalidní struktura dat
- Chybějící pole v JSON

**Diagnostika:**
- Console → stack trace ukáže přesné místo
- `?debug=1` → poslední chyba má filename:line:col
- Zkontroluj strukturu dat v Network tab

**Root cause #5: DOM querySelector může vrátit null**
- **Soubor:** `assets/app.js` (různé místa)
- **Problém:** `.innerHTML` na null element spadne
- **Oprava:** Všechny DOM operace mají guard: `if (el) el.innerHTML = ...`

**Root cause #6: Očekává se pole, ale přijde objekt**
- **Soubor:** `assets/app.js` řádek 1378
- **Problém:** `Array.isArray(arr) ? arr : []` je defenzivní, ale může být problém jinde
- **Oprava:** `safeArray()` helper v `app-crash-shield.js`

### 4. Workflow nasadí rozbitá data
**Příčiny:**
- Validace selhala, ale data se přesto nasadila
- Python skript vygeneroval HTML místo JSON
- Prázdný soubor nebo chybné kódování

**Diagnostika:**
- GitHub Actions logs → zkontroluj validation step
- Zkontroluj `data/backup/` → poslední validní verze
- Zkontroluj `data/current/` → otevři soubory, zda jsou validní JSON

**Root cause #7: Validace neproběhla před deployem**
- **Soubor:** `.github/workflows/update-articles.yml`
- **Problém:** Data se commitovala bez validace
- **Oprava:** Přidán step "Validate temp data" před "Atomic swap"

**Root cause #8: HTML místo JSON nebylo detekováno**
- **Soubor:** `.github/workflows/update-articles.yml`
- **Problém:** Python skript mohl vygenerovat HTML error page
- **Oprava:** Přidán "Guard: ensure JSON files are not HTML" step

## Reprodukční režimy

Pro testování ochran použij URL parametry:

- `?break=articles404` → simuluje 404 na articles.json → ověří cache fallback
- `?break=articlesHTML` → simuluje HTML místo JSON → ověří detekci a fallback
- `?break=videos404` → simuluje 404 na videos.json
- `?break=domNull` → simuluje chybějící DOM element → ověří, že render nespadne
- `?debug=1` → zobrazí debug panel s diagnostikou

## Jak číst diagnostiku

### Debug panel (`?debug=1`)

**Poslední chyba:**
- `t` - timestamp
- `type` - "error" nebo "unhandledrejection"
- `message` - text chyby
- `filename`, `lineno`, `colno` - přesné místo
- `stack` - stack trace

**Fetch log:**
- Formát: `timestamp | name | url | OK/FAIL | source | message`
- `source` - "network" (z internetu) nebo "cache" (z cache)
- Pokud vidíš "fallback used" → síť selhala, použila se cache

**Poslední OK stav:**
- Kdy naposledy se data úspěšně načetla

### localStorage diagnostika

Otevři konzoli a zadej:

```javascript
// Poslední chyba
JSON.parse(localStorage.getItem('iu:diag:last_error'))

// Fetch log
JSON.parse(localStorage.getItem('iu:diag:last_fetches'))

// Cache metadata
JSON.parse(localStorage.getItem('iu:cachemeta:articles:v1'))
```

## Co bylo opraveno

1. ✅ Přidán `app-crash-shield.js` - safe fetch wrapper s cache fallback
2. ✅ Přidán `debug.js` - diagnostický panel
3. ✅ Přidán `sw.js` - service worker pro offline
4. ✅ Přidána validace v workflow - HTML guard + JSON schema
5. ✅ Přidány zálohy - 3 generace v `data/backup/`
6. ✅ Atomic deploy - temp → current swap až po validaci
7. ✅ Crash logging - všechny chyby se ukládají do localStorage
8. ✅ Status badge - UI indikuje offline/cache režim

## Kontrolní seznam po pádu

1. Otevři `?debug=1` → zkontroluj poslední chybu
2. Zkontroluj Network tab → zda se JSON načítají (200 OK)
3. Zkontroluj console → žádné červené chyby
4. Zkontroluj `data/current/` → zda soubory existují a jsou validní JSON
5. Zkontroluj GitHub Actions → zda poslední build prošel validací
6. Pokud je problém v datech → použij `data/backup/1/` jako fallback
