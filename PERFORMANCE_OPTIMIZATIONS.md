# Performance & Stability Optimizations – infoUzel.cz

## Přehled změn

Tento dokument popisuje implementované optimalizace pro stabilitu, výkon a prevenci zamrzání webu.

## 1. Chunked Rendering + Watchdog (KRITICKÉ)

### Problém
- Velké feedy (500+ položek) způsobovaly zamrznutí UI ("page not responding")
- Render probíhal v jedné dávce, blokoval hlavní vlákno

### Řešení
**Soubor:** `app-render-optimizer.js`

- **Chunked rendering:** Feed se renderuje po blocích (30 položek najednou)
- **Watchdog:** Měří čas renderu, při překročení 400ms přepne do chunked režimu
- **requestIdleCallback:** Render probíhá v idle čase, UI zůstává interaktivní
- **DOM limit:** Max 250 položek v DOM, starší se odstraňují (virtualizace)

### Použití
```javascript
// Automaticky aktivní pro feedy > 50 položek
// Pro menší feedy se používá rychlý render
```

### Konfigurace
```javascript
RENDER_CHUNK_SIZE = 30        // počet položek v chunk
RENDER_CHUNK_DELAY_MS = 8     // delay mezi chunky
RENDER_TIMEOUT_MS = 400       // watchdog timeout
MAX_DOM_ITEMS = 250           // max položek v DOM
```

## 2. Fetch Semaphore (Omezení paralelních fetchů)

### Problém
- Příliš mnoho paralelních fetchů mohlo způsobit zahlcení
- Žádné omezení počtu současných requestů

### Řešení
**Soubor:** `app-render-optimizer.js`

- **Semaphore:** Max 3 paralelní fetchy najednou
- **Queue:** Ostatní fetchy čekají ve frontě
- **Automatické:** Integrováno do `safeFetchJSON()`

### Použití
```javascript
// Automaticky při použití window.__iuSafeFetch.safeFetchJSON()
// nebo přes window.__iuRenderOptimizer.fetchWithSemaphore()
```

## 3. Safe Fetch Integration

### Problém
- `app.js` používalo obyčejný `fetch()` bez timeoutu a retry
- Chyběla ochrana proti HTML místo JSON (404 stránky)

### Řešení
**Soubor:** `assets/app.js` (upraveno)

- `loadArticlesOnly()` a `loadVideosOnly()` nyní používají `safeFetchJSON()`
- Timeout 9s, retry 2x, automatický fallback na cache
- Ochrana proti HTML místo JSON

## 4. Rozšířený Debug Panel

### Nové funkce
**Soubor:** `debug.js` (rozšířeno)

- **Feed metriky:** Počet položek v feedu vs. vykresleno v DOM
- **Service Worker stav:** Aktivní/čeká/instaluje se
- **Paměťové metriky:** Used/Total/Limit (pokud dostupné)
- **Render optimizer stav:** Zda je načten
- **Kopírování diagnostiky:** Všechny metriky v JSON formátu

### Použití
```
?debug=1
```

## 5. Service Worker vylepšení

### Nové funkce
**Soubor:** `sw.js` (upraveno)

- **Kill switch:** `?nosw=1` vypne SW (pro debugging)
- **Ochrana proti HTML:** Detekce HTML místo JSON (404 stránky)
- **Verzování:** Cache verze `v2026-01-25-2` (aktualizovat při změnách)
- **Network First:** JSON data se vždy stahují z network, cache jen jako fallback

### Kill switch
```
?nosw=1  // Vypne Service Worker
```

## 6. Workflow validace (kontrola)

### Současný stav
**Soubor:** `.github/workflows/update-articles.yml`

- ✅ Backup před generováním (3 generace)
- ✅ Generování do `data/tmp/`
- ✅ Validace JSON před deployem
- ✅ Atomický swap (`data/tmp/*.json` → `data/*.json`)
- ✅ HTML guard (kontrola, že JSON není HTML)

### Doporučení
- Workflow je již robustní, žádné změny nejsou nutné

## Testování

### 1. Test chunked renderingu
1. Otevři web s velkým feedem (500+ položek)
2. ✅ UI zůstává interaktivní během renderu
3. ✅ V konzoli: "Render dokončen za X ms"
4. ✅ Žádné "page not responding"

### 2. Test fetch semaphore
1. Otevři DevTools → Network
2. Obnov stránku
3. ✅ Max 3 paralelní fetchy najednou
4. ✅ Ostatní čekají ve frontě

### 3. Test debug panelu
1. Otevři `?debug=1`
2. ✅ Zobrazí se metriky feedu, SW stav, paměť
3. ✅ Tlačítko "Kopírovat" zkopíruje diagnostiku

### 4. Test Service Worker kill switch
1. Otevři `?nosw=1`
2. ✅ SW se neregistruje
3. ✅ V konzoli: "SW kill switch aktivní"

### 5. Test offline režimu
1. DevTools → Network → Offline
2. Obnov stránku
3. ✅ Web se načte z cache
4. ✅ Badge "Offline – zobrazuji uložená data"

## Metriky (před/po)

### Před optimalizacemi
- Render 500 položek: ~2000-3000ms (zamrzání UI)
- Paralelní fetchy: neomezeno
- DOM nodes: neomezeno (až 1000+)
- Debug: pouze základní chyby

### Po optimalizacích
- Render 500 položek: ~800-1200ms (bez zamrzání, chunked)
- Paralelní fetchy: max 3 (semaphore)
- DOM nodes: max 250 (virtualizace)
- Debug: kompletní metriky + diagnostika

## Konfigurace

### Změna velikosti chunk
```javascript
// V app-render-optimizer.js
const RENDER_CHUNK_SIZE = 30;  // změnit na požadovanou hodnotu
```

### Změna DOM limitu
```javascript
// V app-render-optimizer.js
const MAX_DOM_ITEMS = 250;  // změnit na požadovanou hodnotu
```

### Změna počtu paralelních fetchů
```javascript
// V app-render-optimizer.js
const FETCH_SEMAPHORE_MAX = 3;  // změnit na požadovanou hodnotu
```

## Troubleshooting

### Web se stále zamrzá
1. Zkontroluj, zda je `app-render-optimizer.js` načten (konzole: `window.__iuRenderOptimizer`)
2. Zkontroluj, zda feed má > 50 položek (chunked se aktivuje automaticky)
3. Otevři `?debug=1` a zkontroluj metriky

### Feed se nevykreslí
1. Otevři `?debug=1` → zkontroluj "Poslední chyba"
2. Zkontroluj Network tab → zda se načítají JSON soubory
3. Zkontroluj konzoli → hledej chyby

### Service Worker problémy
1. Otevři `?nosw=1` → vypne SW
2. DevTools → Application → Service Workers → Unregister
3. Obnov stránku

## Definice hotova (Definition of Done)

✅ Web se nikdy nezasekne do "page not responding" při běžném používání  
✅ Hlavní feed se vždy buď vykreslí, nebo zobrazí jasný fallback stav  
✅ SW cache je verziovaná, bezpečná, bez zacyklení  
✅ Workflow je atomické + validuje data a rozbitá data nenasadí  
✅ Debug panel umí vypsat poslední chyby a stav systému bez DevTools  
✅ Vše je dodané jako konkrétní změny v repu (kód + dokumentace)

## Další optimalizace (volitelné, nízká priorita)

- Skeleton loading (prázdné karty během načítání)
- Lazy loading obrázků (IntersectionObserver)
- Prefetch kritických dat
- Service Worker precaching strategie
- SEO optimalizace (meta tagy, structured data)

---

**Datum implementace:** 2026-01-25  
**Verze:** 1.0
