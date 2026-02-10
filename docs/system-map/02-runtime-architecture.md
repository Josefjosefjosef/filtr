# 02 – Runtime architecture (browser)

## Entrypointy

- **Hlavní entry HTML (produkce)**: `projects/index.html`
  - CSS: `projects/index.html:18` → `/assets/app.css?v=NOICONS_20260208_01`
  - JS: `projects/index.html:1538` → `/assets/app.js?v=ff57115` (`type="module"`)
- **Root entry + redirect**: `index.html`
  - meta refresh: `index.html:6` → `content="0; url=/projects/"`
  - JS redirect: `index.html:17` → `location.replace("/projects/");`
- **Service Worker skript (soubor)**: `sw.js`
  - cache versioning + TTL jsou definované v `sw.js` (např. `sw.js:8` a `sw.js:14`)
  - registrace SW je implementovaná v `assets/app-crash-shield.js`, ale aktuálně je v té funkci early-return (viz `assets/app-crash-shield.js:449-454`)

## Startovní tok (high-level)

1. Prohlížeč otevře `/projects/index.html`.
2. HTML nastaví debug flag podle `?debug=1` (`projects/index.html:24-33`) a vykreslí skeleton layoutu.
3. Na konci HTML se načte `/assets/app.js` jako `type="module"` (bundle runtime logiky).
4. `assets/app.js`:
   - načte build stamp (`<meta name="iu-build" ...>`) a ukládá ho do storage
   - při změně buildu provede „hard“ reset caches + odregistruje SW a reloadne stránku
   - fetchuje JSON data a renderuje feed + UI panely
5. Diagnostické logy pro načítání dat a runtime jsou v `assets/app.js` (např. `assets/app.js:2527+` používá `debugBoxSet(...)`).

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

`sw.js` definuje (doloženo v kódu):

- cache versioning: `sw.js:8` → `const CACHE_VERSION = ...`
- cache names: `sw.js:9-11` → `APP_SHELL_CACHE`, `DATA_CACHE`, `DATA_META_CACHE`
- TTL per typ: `sw.js:14-21` → `const TTL = { ... }`
- install caching app shell: `sw.js:74-85`
- activate „hard reset“ caches: `sw.js:87-94`
- fetch handling (data/app-shell/JSON): `sw.js:96+` (větvení podle pathname a `.json`)

### Debug režim `?debug=1`

Aktuální entrypoint (`projects/index.html`) nastavuje `data-iu-debug` podle `?debug=1` (`projects/index.html:24-33`).

`assets/app.js` má SW diagnostiku přes `navigator.serviceWorker.getRegistration()` a `.ready`:

- `assets/app.js:3240-3247`

