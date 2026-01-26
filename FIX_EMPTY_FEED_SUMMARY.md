# Oprava prázdného feedu - Shrnutí změn

## Příčina problému "0 z 240"

**Hlavní problémy:**
1. **Nekonzistentní API:** `window.__iuSafeFetch` měl jen `fetchJSON`, ale kód někde očekával `safeFetchJSON`
2. **Špatné zpracování fallbacku:** `app.js` kontrolovalo `result.ok`, ale při cache fallbacku je `ok: false` i když `data` existuje
3. **BASE duplikace:** BASE detekce byla v obou souborech, ale mohla být nekonzistentní
4. **Kill switch na špatném místě:** Byl jen komentář v sw.js, ne implementace v registraci

## Implementované opravy

### 1. Sjednocené Safe Fetch API (`app-crash-shield.js`)

**Řádek 500-506:**
```javascript
// ✅ FIX: Sjednocené API - fetchJSON je hlavní, safeFetchJSON je alias pro kompatibilitu
window.__iuSafeFetch = window.__iuSafeFetch || {};
window.__iuSafeFetch.fetchJSON = safeFetchJSON;     // HLAVNÍ
window.__iuSafeFetch.safeFetchJSON = safeFetchJSON; // ALIAS pro kompatibilitu
window.__iuSafeFetch.readCache = readBestCache;
window.__iuSafeFetch.rotateWrite = rotateWrite;
```

**Výsledek:** Oba názvy fungují (`fetchJSON` i `safeFetchJSON`).

### 2. Opraveno zpracování fallbacku (`assets/app.js`)

**Řádek 1583-1595 (loadArticlesOnly):**
```javascript
const result = await safeFetch("articles", ARTICLES_URL, { silent });

// ✅ FIX: result.ok může být false, ale result.data může existovat (cache fallback)
if (!result) {
  console.error("[IU] safeFetch articles returned null/undefined");
  return { changed:false, items:[] };
}

// ✅ FIX: Pokud není data ani v fallbacku, vrať prázdné pole
if (!result.data) {
  // ... error handling
  return { changed:false, items:[] };
}

const data = result.data; // Použij data i když ok: false (cache fallback)
```

**Výsledek:** Feed se načte i z cache (když `ok: false` ale `data` existuje).

### 3. BASE je path-only (oba soubory)

**`assets/app.js` řádek 26:**
```javascript
// ✅ FIX: BASE je path-only (ne origin+path) - pro správný SW scope
const BASE = getBaseRoot(); // Vrací "/filtr/" nebo "/"
```

**`app-crash-shield.js` řádek 354:**
```javascript
const BASE = getBaseRoot(); // Stejná logika, path-only
```

**Výsledek:** BASE je konzistentní path-only, SW scope funguje správně.

### 4. Kill switch v registraci (`app-crash-shield.js`)

**Řádek 473-483:**
```javascript
// ✅ FIX: Kill switch ?nosw=1 - vypne registraci SW (musí být zde, ne v sw.js)
const NOSW = new URLSearchParams(location.search).get("nosw") === "1";
if (NOSW) {
  log("SW kill switch aktivní (?nosw=1), SW se neregistruje");
  // Odregistruj existující SW pokud existuje
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      await reg.unregister();
    }
  } catch (e) {
    // Ignoruj chyby při odregistrování
  }
  return;
}
```

**Výsledek:** Kill switch funguje správně v registraci, ne v sw.js.

### 5. Debug log při ?debug=1 (`assets/app.js`)

**Řádek 28-42:**
```javascript
// ✅ FIX: Debug log při ?debug=1
if (DEBUG) {
  console.log("[infoUzel] DEBUG MODE");
  console.log("[infoUzel] BASE:", BASE);
  console.log("[infoUzel] ARTICLES_URL:", `${BASE}data/articles.json`);
  console.log("[infoUzel] VIDEOS_URL:", `${BASE}data/videos.json`);
  console.log("[infoUzel] window.__iuSafeFetch:", window.__iuSafeFetch);
  console.log("[infoUzel] window.__iuSafeFetch?.fetchJSON:", typeof window.__iuSafeFetch?.fetchJSON);
  console.log("[infoUzel] window.__iuSafeFetch?.safeFetchJSON:", typeof window.__iuSafeFetch?.safeFetchJSON);
}
```

**Výsledek:** Při `?debug=1` vidíš všechny kritické hodnoty.

### 6. Přidán fetchedAt do safeFetchJSON (`app-crash-shield.js`)

**Řádek 283-288, 305-312:**
```javascript
return {
  ok: true,
  data: v,
  source: "network",
  attempt,
  fetchedAt: nowISO()  // ✅ FIX: Přidán timestamp
};

// Cache fallback:
return {
  ok: false,
  data: parsed.value,
  source: "cache",
  fallbackUsed: true,
  fetchedAt: nowISO()  // ✅ FIX: Přidán timestamp
};
```

**Výsledek:** Konzistentní API s timestampem.

## Pořadí scriptů v index.html

**Řádek 2403-2407:**
```html
<!-- ===== CRASH SHIELD: musí být před app.js ===== -->
<script src="app-crash-shield.js"></script>
<!-- ===== RENDER OPTIMIZER: chunked rendering + watchdog ===== -->
<script src="app-render-optimizer.js"></script>
<script src="assets/app.js"></script>
```

**Výsledek:** ✅ Správné pořadí - crash-shield je načten před app.js.

## Testování

### Ověření funkčnosti:

1. **Otevři web:** `https://infouzel.github.io/filtr/`
2. **Zkontroluj konzoli:** Měly by se načíst články (ne 0)
3. **Debug režim:** `?debug=1` → zobrazí BASE, URL, safeFetch dostupnost
4. **Kill switch:** `?nosw=1` → SW se neregistruje

### Očekávaný výstup:

- Feed se načte a zobrazí položky (ne 0)
- V konzoli žádná chyba "safeFetch missing" (pokud crash-shield je načten)
- V konzoli žádná chyba "ARTICLES_URL is not a function"
- URL jsou správně složené bez dvojitých lomítek

## Shrnutí změn

**Co bylo příčinou prázdného feedu:**
1. `app.js` kontrolovalo `result.ok` a ignorovalo cache fallback (když `ok: false` ale `data` existuje)
2. Nekonzistentní API - někde `fetchJSON`, někde `safeFetchJSON`

**Co se sjednotilo:**
1. ✅ **API:** `fetchJSON` + alias `safeFetchJSON` pro kompatibilitu
2. ✅ **URL:** Stabilní stringy bez cache-busting (`ARTICLES_URL`, ne `ARTICLES_URL()`)
3. ✅ **BASE:** Path-only v obou souborech (`/filtr/` nebo `/`)
4. ✅ **SW registrace:** Kill switch `?nosw=1` v registraci, ne v sw.js
5. ✅ **Fallback handling:** `app.js` kontroluje `result.data`, ne jen `result.ok`

---

**Datum opravy:** 2026-01-25  
**Verze:** 2.1
