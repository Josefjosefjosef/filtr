# 02 – Runtime architecture (browser)

## Entrypointy

- **Hlavní entry HTML**: `projects/index.html`
  - načítá CSS: `/assets/app.css?v=...`
  - načítá JS: `/assets/app.js?v=...` (module)
- **Root `index.html`**: pouze redirect na `/projects/` (bez načítání assetů)
- **Service Worker**: `sw.js`
- **Diagnostics overlay**: `debug.js` (zapíná se `?debug=1`)

## Startovní tok (high-level)

1. Prohlížeč otevře `/projects/index.html`.
2. HTML nastaví `debug` režim (podle query `?debug=1`) a vykreslí skeleton layoutu.
3. Na konci HTML se načte `/assets/app.js` jako `type="module"` (bundle runtime logiky).
4. `assets/app.js`:
   - načte build stamp (`<meta name="iu-build" ...>`) a ukládá ho do storage
   - při změně buildu provede „hard“ reset caches + odregistruje SW a reloadne stránku
   - fetchuje JSON data a renderuje feed + UI panely
5. (Volitelně) `debug.js` vytváří overlay panel a sbírá diagnostiku (SW stav, poslední fetch, metriky feedu).

## Kde je definovaný init webu (DOMContentLoaded / readyState)

- `projects/index.html` obsahuje několik `DOMContentLoaded` handlerů (např. debug render diagnostika, lokální počítadlo hvězdiček, a další UI init pro overlaye).
- `assets/app.js` používá pattern „pokud `document.readyState === 'loading'` → připoj `DOMContentLoaded`, jinak zavolej hned“ (např. `initAiPanel`).

## Kde se bere feed (kódové reference)

V `assets/app.js` jsou klíčové funkce pro přípravu feedu:

- normalizace a validace článků:

```2009:2033:C:\projects\filtr\assets\app.js
  function normalizeArticleList(items) {
    return items.filter((it) => {
      const hasTitle = Boolean(it?.title || it?.headline || it?.name);
      const link = it?.url || it?.link || it?.href;
      let validLink = false;
      if (link) {
        try {
          new URL(link, location.origin);
          validLink = true;
        } catch {
          debugWarn("[DATA] invalid URL", link);
        }
      }
      if (!hasTitle && !loggedEmptyTitle) {
        debugWarn("[DATA] missing article title, substituting fallback");
        loggedEmptyTitle = true;
      }
      if (!hasTitle) {
        if (it) {
          it.title = "Bez názvu";
        }
      }
      return hasTitle && validLink;
    });
  }
```

- kombinace článků + videí: `buildCombinedFeed(...)` (viz výsledky grep: `assets/app.js:1024`)
- hlavní „orchestrátor“: `loadData()` (viz výsledky grep: `assets/app.js:2477`)

Data endpointy v runtime jsou typicky pod `projects/data/*.json` (viz `03-data-pipeline.md`).

## Cache / SW (co přesně se děje)

### Build stamp a „hard reset“

`assets/app.js` při detekci změny buildu maže Cache Storage a odregistruje Service Workery:

```1954:1990:C:\projects\filtr\assets\app.js
  async function nukeCachesAndSwOnBuildChange() {
    const build = getBuildStamp() || "no-build";
    const prev = localStorage.getItem("iu:lastBuildHard") || "";
    if (prev === build) return;
    try {
      localStorage.setItem("iu:lastBuildHard", build);
    } catch (_) {}
    debugWarn("[BUILD] change detected -> clearing caches + SW", prev, "->", build);

    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        debugLog("[BUILD] caches cleared", keys);
      }
    } catch (err) {
      debugWarn("[BUILD] caches clear failed", err);
    }

    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        debugLog("[BUILD] service workers unregistered", regs.length);
      }
    } catch (err) {
      debugWarn("[BUILD] sw unregister failed", err);
    }

    window.location.reload();
  }
```

### `sw.js` strategie

`sw.js` definuje:

- cache versioning (`CACHE_VERSION`)
- app shell caching (Cache First)
- JSON data caching s TTL per typ (articles/videos/weather/namedays/...)

Konkrétní TTL a cache názvy jsou v `sw.js` (řádky ~8–21).

### Debug režim `?debug=1`

`debug.js` v `?debug=1`:
- ukazuje metriky feedu (`#newsList` children vs `window.allItems`)
- zjišťuje stav SW přes `navigator.serviceWorker.getRegistration()` a vykreslí ho v overlay

