# Shrnutí optimalizací – infoUzel.cz

## Přehled změn

Tento dokument shrnuje všechny implementované optimalizace pro stabilitu, výkon a dlouhodobou udržitelnost.

## KROK 0: Inventarizace ✅

**Nalezené problémy:**
- Cache-busting: `ARTICLES_URL()` a `VIDEOS_URL()` používaly `?ts=${Date.now()}`
- `cache:"no-store"` ve všech fetch voláních
- Service Worker bez TTL a prořezávání
- Render bez cancel tokenu, používal `innerHTML=""` místo `replaceChildren()`
- Chybějící SEO meta tagy a statické soubory

## KROK 1: Oprava fetch strategie ✅

### Změny v `assets/app.js`:
- **Řádek 7-13:** Odstraněn cache-busting z `ARTICLES_URL` a `VIDEOS_URL`
  - Před: `const ARTICLES_URL = () => \`${BASE}/data/articles.json?ts=${Date.now()}\`;`
  - Po: `const ARTICLES_URL = \`${BASE}/data/articles.json\`;`
- **Řádek 657, 706:** Odstraněn `cache: "no-store"` z `loadNamedays()` a `loadWeather()`
- **Řádek 1498-1547:** `loadArticlesOnly()` používá stabilní URL bez cache-busting
- **Řádek 1549-1600:** `loadVideosOnly()` používá stabilní URL bez cache-busting

### Změny v `app-crash-shield.js`:
- **Řádek 233:** `fetchWithTimeout()` - odstraněn default `cache: "no-store"`
- **Řádek 258:** `safeFetchJSON()` - odstraněn `cache: "no-store"` z fetch volání

**Výsledek:** Service Worker cache může nyní fungovat, žádné cache-busting query stringy.

## KROK 2: Service Worker s TTL a prořezáváním ✅

### Nový `sw.js`:
- **TTL pro JSON data:**
  - articles: 300s (5 min)
  - videos: 600s (10 min)
  - weather: 1800s (30 min)
  - namedays: 86400s (24h)
  - meta/status/feed_health: 300-600s
- **Prořezávání cache:** Max 50 položek v data cache, nejstarší se odstraňují
- **ignoreSearch:** Cache match ignoruje query stringy (pro jistotu)
- **Metadata cache:** Paralelní cache pro TTL metadata (timestamp uložení)
- **Stale fallback:** Pokud cache je stale, použije se jako fallback s header `X-Cache-Status: stale`

**Výsledek:** Cache roste kontrolovaně, TTL zajišťuje aktualizaci dat, žádný nekonečný růst.

## KROK 3: Render s cancel tokenem a requestAnimationFrame ✅

### Změny v `app-render-optimizer.js`:
- **Řádek 63-118:** `renderChunked()` přepracován:
  - Používá `requestAnimationFrame` místo `requestIdleCallback`
  - Podporuje cancel token pro zrušení renderu
  - Vrací `{ cancel: function }` pro ruční zrušení

### Změny v `assets/app.js`:
- **Řádek 1230:** Přidán `currentRenderCancel` pro tracking aktivního renderu
- **Řádek 1219:** `list.innerHTML = ""` → `list.replaceChildren()` (rychlejší, bez reflow)
- **Řádek 1225:** Render spuštěn přes `requestAnimationFrame()` (ne synchronně)
- **Řádek 1237-1240:** Před novým renderem se zruší probíhající render
- **Řádek 1332-1353:** Chunked render s cancel tokenem, chunk size 25

**Výsledek:** Render neblokuje UI, lze zrušit při změně filtru, žádné full re-render v jednom ticku.

## KROK 4: Observabilita ✅

### Změny v `assets/app.js`:
- **Řádek 7-25:** Přidán DEBUG flag (URL param `?debug=1` nebo `localStorage.getItem("iu:debug")`)
- **Řádek 1498-1528:** `loadArticlesOnly()` - performance marks a log
- **Řádek 1549-1600:** `loadVideosOnly()` - performance marks a log
- **Řádek 1332-1353:** Render feed - performance marks a log

### Změny v `app-render-optimizer.js`:
- **Řádek 20-30:** DEBUG flag pro watchdog
- **Řádek 40-50:** Watchdog loguje jen v debug režimu

**Výsledek:** V produkci žádné spamování console, v debug režimu kompletní metriky (fetch time, render time, počet položek).

## KROK 5: SEO statické soubory ✅

### Změny v `index.html`:
- **Řádek 6-25:** Přidány SEO meta tagy:
  - `<title>` s popisem
  - `<meta name="description">`
  - Open Graph tagy (og:title, og:description, og:type, og:url, og:site_name)
  - Twitter Card tagy
  - `<link rel="canonical">`

### Nové soubory:
- **`sitemap.xml`:** Statický sitemap s homepage
- **`robots.txt`:** Allow vše, odkaz na sitemap

**Výsledek:** Základní SEO technické věci jsou správně, statické soubory pro indexování.

## Testování

### A) UI Freeze test
1. Načti web s 100+ položkami feedu
2. ✅ UI zůstává interaktivní během renderu
3. ✅ Žádné "Page isn't responding"
4. ✅ Filtrace 10× za sebou bez zamrznutí

### B) Cache test
1. DevTools → Application → Cache Storage
2. ✅ Data cache má max 50 položek (prořezávání funguje)
3. ✅ JSON requesty jdou přes SW (Network tab → Service Worker)
4. ✅ Žádné `?ts=` query stringy v requestech

### C) Data refresh
1. Simuluj offline (DevTools → Network → Offline)
2. ✅ UI ukáže badge "offline / stale"
3. ✅ Stránka funguje s poslední cache

### D) Render chunk
1. Otevři `?debug=1`
2. ✅ V konzoli vidět performance marks a logy
3. ✅ Render probíhá po chunkech (requestAnimationFrame)
4. ✅ Při změně filtru se starý render zruší (cancel token)

## Debug režim

### Zapnutí:
- URL: `?debug=1`
- Nebo: `localStorage.setItem("iu:debug", "1")`

### Co se loguje:
- Fetch časy (articles, videos) v ms
- Render časy v ms
- Počet položek
- Source (network/cache/stale)
- Watchdog varování

### Vypnutí:
- `localStorage.removeItem("iu:debug")`
- Nebo obnov stránku bez `?debug=1`

## Konfigurace

### TTL (v `sw.js`):
```javascript
const TTL = {
  articles: 300,      // 5 minut
  videos: 600,        // 10 minut
  weather: 1800,      // 30 minut
  namedays: 86400,    // 24 hodin
  // ...
};
```

### Cache limit (v `sw.js`):
```javascript
const MAX_CACHE_ITEMS = 50; // Max položek v data cache
```

### Render chunk size (v `assets/app.js`):
```javascript
chunkSize: 25  // Počet položek v jednom chunk
```

## Revert změn

Všechny změny jsou označeny komentářem `// ✅ FIX:` pro snadné vyhledání a případný revert.

### Klíčové soubory:
- `assets/app.js` - fetch a render logika
- `app-crash-shield.js` - safe fetch wrapper
- `sw.js` - Service Worker s TTL
- `app-render-optimizer.js` - chunked rendering
- `index.html` - SEO meta tagy
- `sitemap.xml` - SEO sitemap
- `robots.txt` - SEO robots

## Definice hotova ✅

✅ Web se nikdy nezasekne do "page not responding"  
✅ Hlavní feed se vždy vykreslí nebo zobrazí fallback  
✅ SW cache je verziovaná, s TTL, bez nekonečného růstu  
✅ Render probíhá po chunkech přes requestAnimationFrame  
✅ Při změně filtru se starý render zruší (cancel token)  
✅ Debug režim umí vypsat metriky bez DevTools  
✅ SEO základní věci jsou správně (meta tagy, sitemap, robots)  
✅ Vše je dodané jako konkrétní změny v repu  

---

**Datum implementace:** 2026-01-25  
**Verze:** 2.0
