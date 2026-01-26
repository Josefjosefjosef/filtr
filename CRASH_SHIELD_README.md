# Crash Shield System – Implementace ochrany proti pádům

## Přehled změn

### Nové soubory

1. **`app-crash-shield.js`** - Hlavní runtime ochrana
   - Global error handlers (window.onerror, unhandledrejection)
   - Safe fetch wrapper s timeout, retry, cache fallback
   - Rotující cache (3 generace: a, b, c)
   - Status badge (offline/cache/ok)
   - Emergency overlay při kritických chybách

2. **`debug.js`** - Diagnostický panel
   - Zobrazí se při `?debug=1`
   - Ukazuje poslední chybu, fetch log, OK stav
   - Kopírování diagnostiky do schránky

3. **`sw.js`** - Service Worker
   - Network First + Cache Fallback pro JSON data
   - Cache First pro App Shell
   - Offline support

4. **`scripts/validate_json.py`** - Build-time validace
   - Kontrola struktury articles.json, videos.json, meta.json
   - Validace typů, délek, URL
   - Fail při nevalidních datech

5. **`scripts/make_backup.py`** - Rotace záloh
   - 3 generace: backup/1, backup/2, backup/3
   - Automatická rotace před deployem

6. **`scripts/write_status.py`** - Status monitoring
   - Generuje status.json s timestamp a počty položek

7. **`DEBUG.md`** - Diagnostická dokumentace
   - Root cause analýza
   - Reprodukční režimy
   - Jak číst diagnostiku

8. **`RECOVERY.md`** - Návod na obnovu
   - Rychlá obnova pro uživatele
   - Obnova dat pro adminy
   - Kontrolní seznamy

### Upravené soubory

1. **`index.html`**
   - Přidán `<script src="app-crash-shield.js"></script>` před `app.js`
   - Přidán `<script src="debug.js"></script>`
   - Přidány volitelné elementy: `#lastUpdate`, `#emptyState`

2. **`.github/workflows/update-articles.yml`**
   - Přidán step: Backup current data
   - Přidán step: Generate into temp dir
   - Přidán step: Guard (HTML místo JSON)
   - Přidán step: Validate temp data
   - Přidán step: Atomic swap (temp → current)
   - Přidán step: Write status.json

## Jak to funguje

### Runtime ochrana

1. **Crash Shield se načte první** (před app.js)
2. **Registruje global error handlers** → zachytí všechny JS chyby
3. **Načte data do cache** → pokud app.js selže, data jsou k dispozici
4. **Exponuje safe fetch funkce** → `window.__iuSafeFetch` pro použití v app.js

### Safe Fetch

- **Timeout**: 8-9 sekund
- **Retry**: 2 pokusy s exponenciálním backoffem
- **HTML detection**: Detekuje, pokud přijde HTML místo JSON
- **Cache fallback**: Pokud síť selže, použije cache (3 generace)
- **Logging**: Všechny fetch pokusy se logují do localStorage

### Cache rotace

- **3 generace**: `iu:cache:articles:v1:a`, `:b`, `:c`
- **Rotace**: Nová data → a, stará a → b, stará b → c
- **Quarantine**: Rozbitá cache se ukládá do quarantine pro debug

### Build-time ochrana

1. **Backup** před generováním (3 generace)
2. **Generování do temp** složky
3. **HTML guard** - kontrola, že soubory nejsou HTML
4. **Validace** - schema kontrola JSON
5. **Atomic swap** - temp → current až po úspěšné validaci

## Použití

### Pro uživatele

- **Normální použití**: Žádné změny, vše funguje automaticky
- **Offline**: Web se načte z cache, zobrazí badge "Offline"
- **Chyba**: Zobrazí se emergency overlay s tlačítkem "Obnovit"

### Pro developery

**Debug režim:**
```
?debug=1
```
Zobrazí debug panel s diagnostikou.

**Reprodukční režimy:**
```
?break=articles404    # Simuluje 404 na articles.json
?break=articlesHTML   # Simuluje HTML místo JSON
?break=videos404      # Simuluje 404 na videos.json
?break=domNull        # Simuluje chybějící DOM element
```

**Kontrola cache:**
```javascript
// V konzoli
JSON.parse(localStorage.getItem('iu:cachemeta:articles:v1'))
```

## Testování

### 1. Test offline režimu

1. DevTools (F12) → Network → Offline
2. Obnovit stránku
3. ✅ Web se načte z cache
4. ✅ Zobrazí badge "Offline – zobrazuji uložená data"

### 2. Test rozbitých dat

1. Otevři `?break=articles404`
2. ✅ Web použije cache
3. ✅ Zobrazí badge "Síť kolísá – zobrazuji uložená data"

### 3. Test HTML místo JSON

1. Otevři `?break=articlesHTML`
2. ✅ Web detekuje HTML
3. ✅ Použije cache místo rozbitých dat

### 4. Test validace v workflow

1. Zkontroluj GitHub Actions → poslední běh
2. ✅ "Validate temp data" step musí projít
3. ✅ Pokud selže, "Atomic swap" se nespustí

## Root Cause Analýza

Viz `DEBUG.md` pro detailní analýzu konkrétních problémů a jejich oprav.

## Obnova po pádu

Viz `RECOVERY.md` pro návod na obnovu dat a diagnostiku.

## Kontrolní seznam po nasazení

- [ ] Crash shield se načítá (Network tab → app-crash-shield.js 200 OK)
- [ ] Service Worker se registruje (Application → Service Workers)
- [ ] Cache se ukládá (Application → Local Storage → klíče `iu:cache:*`)
- [ ] Debug panel funguje (`?debug=1`)
- [ ] Reprodukční režimy fungují (`?break=*`)
- [ ] Workflow validuje data před deployem
- [ ] Backup rotace funguje (`data/backup/1`, `/2`, `/3`)
- [ ] Status.json se generuje (`data/current/status.json`)

## Poznámky

- Crash shield **neinterferuje** s existujícím app.js
- Pokud app.js spadne, crash shield to zachytí a zobrazí emergency overlay
- Cache je **redundantní** s Service Worker cache (obě vrstvy)
- Build-time validace **zabrání** nasazení rozbitých dat
- Zálohy umožňují **okamžitou obnovu** bez čekání na nový build
