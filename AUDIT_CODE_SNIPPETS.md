# Výřezy kódu pro audit

## assets/app.js

### 1. Definice URL (řádky 51-65)

```javascript
  // ✅ FIX: Odstraněn cache-busting - SW cache může fungovat
  // URL jsou stabilní, SW zajišťuje aktualizaci přes TTL
  // BASE už obsahuje trailing slash, takže nepřidáváme další
  const ARTICLES_URL = `${BASE}data/articles.json`;
  const VIDEOS_URL = `${BASE}data/videos.json`;
  const WEATHER_URL = `${BASE}data/weather.json`;
  const NAMEDAYS_URL = `${BASE}data/namedays.json`;

  // ✅ FIX: Univerzální unwrap pro různé formáty JSON
  function unwrapToArray(data){
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.articles)) return data.articles;
    if (Array.isArray(data?.arr)) return data.arr;
    return [];
  }
```

### 2. loadArticlesOnly (řádky 1568-1624)

```javascript
  async function loadArticlesOnly({ silent = false } = {}){
    // ✅ FIX: Použití pouze window.__iuSafeFetch.fetchJSON (žádný vlastní fetch)
    const safeFetch = window.__iuSafeFetch?.fetchJSON;

    if (!safeFetch) {
      console.error("[IU] safeFetch missing - crash shield not loaded");
      return { changed:false, items:[] };
    }

    // ✅ FIX: Performance mark pro observabilitu
    if (DEBUG && performance.mark) {
      performance.mark("fetch_articles_start");
    }
    const fetchStart = performance.now();

    const result = await safeFetch("articles", ARTICLES_URL, { silent });
    
    if (!result || !result.ok) {
      if (DEBUG) {
        debugLog(`Fetch articles failed:`, result?.error || "unknown error");
      }
      if(!silent){
        setDataUpdatedAtLabel("");
      }
      return { changed:false, items:[] };
    }

    const data = result.data;

    // ✅ FIX: Performance measure
    const fetchDuration = performance.now() - fetchStart;
    if (DEBUG && performance.mark && performance.measure) {
      performance.mark("fetch_articles_end");
      performance.measure("fetch_articles", "fetch_articles_start", "fetch_articles_end");
      debugLog(`Fetch articles: ${Math.round(fetchDuration)}ms, items: ${unwrapToArray(data).length}, source: ${result?.source || "network"}`);
    }

    // ✅ FIX: Unwrap pomocí univerzální funkce
    const arr = unwrapToArray(data);
    
    // Extrahuj generatedAt pokud existuje
    const generatedAt = data?.generatedAt || data?.updatedAt || data?.generated_at || "";
    setDataUpdatedAtLabel(generatedAt);

    // Signature check pro detekci změny
    const sig = signatureOf(arr, generatedAt);
    if(sig && sig === lastDataSignature){
      return { changed:false, items: null };
    }
    lastDataSignature = sig;

    // Normalizace a merge
    let out = arr.map(normalizeArticle);
    out = mergeByExactTitle(out);

    return { changed:true, items: out };
  }
```

### 3. loadVideosOnly (řádky 1626-1681)

```javascript
  async function loadVideosOnly(){
    // ✅ FIX: Použití pouze window.__iuSafeFetch.fetchJSON (žádný vlastní fetch)
    const safeFetch = window.__iuSafeFetch?.fetchJSON;

    if (!safeFetch) {
      console.error("[IU] safeFetch missing - crash shield not loaded");
      return { changed:false, items:[] };
    }

    // ✅ FIX: Performance mark pro observabilitu
    if (DEBUG && performance.mark) {
      performance.mark("fetch_videos_start");
    }
    const fetchStart = performance.now();

    const result = await safeFetch("videos", VIDEOS_URL, { silent: true });
    
    if (!result || !result.ok) {
      if (DEBUG) {
        debugLog(`Fetch videos failed:`, result?.error || "unknown error");
      }
      return { changed:false, items:[] };
    }

    const data = result.data;

    // ✅ FIX: Performance measure a log
    const fetchDuration = performance.now() - fetchStart;
    if (DEBUG && performance.mark && performance.measure) {
      performance.mark("fetch_videos_end");
      performance.measure("fetch_videos", "fetch_videos_start", "fetch_videos_end");
      debugLog(`Fetch videos: ${Math.round(fetchDuration)}ms, items: ${unwrapToArray(data).length}, source: ${result?.source || "network"}`);
    }

    // ✅ FIX: Unwrap pomocí univerzální funkce
    const arr = unwrapToArray(data);
    
    // Extrahuj generatedAt pokud existuje
    const gen = data?.generatedAt || data?.updatedAt || data?.generated_at || "";

    // Signature check pro detekci změny
    const sig = signatureOfVideos(arr, gen);
    if(sig && sig === lastVideosSignature){
      return { changed:false, items: null };
    }
    lastVideosSignature = sig;

    // Normalizace videí
    const items = [];
    for(const v of arr){
      const it = normalizeVideoAsItem(v);
      if(it) items.push(it);
    }

    return { changed:true, items };
  }
```

### 4. applyFilter (řádky 1196-1270)

```javascript
  /* ===== FILTR (ÚKOL 4t: multi-select) ===== */
  function applyFilter(){
    const noneSelected = !activeSections || activeSections.size === 0;

    const activeLabels = noneSelected
      ? ["Vše"]
      : Array.from(activeSections)
          .map(k => SECTIONS.find(s => s.key === k)?.label || k)
          .filter(Boolean);

    const qLabel = activeQuery ? ` · Hledání: „${activeQuery}"` : "";

    const secLabel = $("sectionLabel");
    if(secLabel){
      const joined = activeLabels.join(" + ");
      secLabel.textContent = `Sekce: ${joined}${qLabel}`;
    }

    updateSectionsBarActive();

    // ZÁKLAD
    let base = [];

    if(noneSelected){
      // Default: "Vše"
      if(!activeQuery){
        // pevné video sloty mezi články + bannery
        const articles = Array.isArray(allArticles) ? allArticles : [];
        base = buildDisplayFeedFromBase(articles.slice(), { injectSlots: true });
      }else{
        // při hledání chceme hledat i ve videích i článcích, a pak do toho vložit bannery
        const items = Array.isArray(allItems) ? allItems : [];
        base = buildDisplayFeedFromBase([...items], { injectSlots: false });
      }
    }else{
      // vybrané sekce: články + videa dohromady
      const items = Array.isArray(allItems) ? allItems : [];
      const picked = items.filter(a => {
        if(!a || typeof a !== "object") return false;
        const s = norm(a.section);
        for(const k of activeSections){
          if(s === k) return true;
        }
        return false;
      });

      base = buildDisplayFeedFromBase(picked, { injectSlots: false });
    }

    // Vyhledávání
    if(activeQuery){
      const q = norm(activeQuery);
      filtered = base.filter(a => {
        const ct  = norm(a?.contentType || "article");

        if(ct === "ad"){
          // reklamu při hledání necháme (stabilita layoutu)
          return true;
        }

        const title = norm(a?.title);
        const sec = norm(a?.section);
        const sources = Array.isArray(a?.sources) ? a.sources : [];
        const sourceNames = sources.map(s => norm(s?.name)).join(" ");

        return title.includes(q) || sec.includes(q) || sourceNames.includes(q);
      });
    }else{
      filtered = base;
    }

    displayFeed = filtered;

    // reset renderu
    renderedItems = 0;
    renderedLimit = Math.min(displayFeed.length, initialLimitForCurrentView());

    const list = $("newsList");
    // ✅ FIX: Použití replaceChildren() místo innerHTML="" (rychlejší, bez reflow)
    if(list) {
      // Zruš probíhající render pokud existuje
      if(currentRenderCancel) {
        currentRenderCancel.cancel();
        currentRenderCancel = null;
      }
      list.replaceChildren();
    }

    const empty = $("emptyBox");
    if(empty) empty.style.display = (displayFeed.length === 0) ? "block" : "none";

    ensureLoadMoreUI();
    // ✅ FIX: Render přes requestAnimationFrame (ne synchronně)
    requestAnimationFrame(() => {
      renderUpToLimit();
      updateLoadMoreVisibility();
    });
  }
```

### 5. renderUpToLimit (řádky 1272-1512)

```javascript
  /* ===== RENDER (CHUNKED PROTI ZAMRZNUTÍ) ===== */
  let renderInProgress = false;
  let currentRenderCancel = null; // Cancel token pro aktuální render

  function renderUpToLimit(){
    const list = $("newsList");
    if(!list) return;

    // ✅ FIX: Zruš probíhající render před spuštěním nového
    if(renderInProgress && currentRenderCancel) {
      currentRenderCancel.cancel();
      currentRenderCancel = null;
      renderInProgress = false;
    }

    const totalToRender = Math.min(displayFeed.length, renderedLimit);
    const alreadyRendered = renderedItems;
    
    if(alreadyRendered >= totalToRender) return;

    const itemsToRender = totalToRender - alreadyRendered;

    // Pro malé množství (< 50) použij původní rychlý render
    // Pro větší použij chunked rendering
    const useChunked = itemsToRender > 50 || (window.__iuRenderOptimizer && window.__iuRenderOptimizer.RENDER_CHUNK_SIZE);

    if(useChunked && window.__iuRenderOptimizer) {
      renderInProgress = true;
      
      // ✅ FIX: Cancel token pro možnost zrušení renderu
      const cancelToken = { cancelled: false };
      
      // Funkce pro render jedné položky
      function renderSingleItem(index) {
        const actualIndex = alreadyRendered + index;
        if(actualIndex >= displayFeed.length || actualIndex >= renderedLimit) return null;

        const a = displayFeed[actualIndex];
        if(!a || typeof a !== "object") return null;

        const ct = norm(a?.contentType || "article");

        if(ct === "ad"){
          const pause = buildFeedPauseNode();
          const ad = createAdCard(a?.adLabel || "Partner");
          const wrapper = document.createDocumentFragment();
          wrapper.appendChild(pause);
          wrapper.appendChild(ad);
          return wrapper;
        }

        if(ct === "video"){
          const pause = buildFeedPauseNode();
          const video = buildVideoNodeFromItem(a);
          const wrapper = document.createDocumentFragment();
          wrapper.appendChild(pause);
          wrapper.appendChild(video);
          return wrapper;
        }

        // ARTICLE
        const card = document.createElement("article");
        card.className = "news-card";

        const time = fmtTime(a.publishedAt);
        const rawTitle = String(a.title || "").trim();
        const titleText = rawTitle.trim();
        const titleHtml = escapeHtml(titleText);
        const sourcesAll = Array.isArray(a.sources) ? a.sources : [];
        const sources = sourcesAll;
        const primaryUrl = safeUrl(sources?.[0]?.url || "");

        const domainsHtml = (sources && sources.length)
          ? sources.map(s => {
              const u = safeUrl(s?.url || "");
              const dom = domainFromUrl(u);
              const label = escapeHtml(dom || "www");
              const href = escapeHtml(u || "#");
              return `<a class="sourceDomain" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
            }).join(`<span class="srcSep"> · </span>`)
          : `<span style="color:rgba(11,27,43,0.55);font-weight:600;font-size:11.5px;">—</span>`;

        const titleLinkHref = escapeHtml(primaryUrl || "#");
        const titleAttr = escapeAttr(titleText || "");

        card.innerHTML = `
          <h3 class="news-title">
            <a class="news-titleLink"
               href="${titleLinkHref}"
               target="_blank"
               rel="noopener noreferrer"
               title="${titleAttr}"
               aria-label="${titleAttr}">
              ${titleHtml || "—"}
            </a>
          </h3>

          <div class="news-row2">
            <span class="meta-time">${escapeHtml(time)}</span>
            <span class="news-sourceLabel">Zdroj:</span>
            <div class="news-sources">${domainsHtml}</div>
          </div>
        `;

        return card;
      }

      // ✅ FIX: Performance mark pro render
      if (DEBUG && performance.mark) {
        performance.mark("render_feed_start");
      }
      const renderStart = performance.now();

      // ✅ FIX: Chunked render s cancel tokenem přes requestAnimationFrame
      currentRenderCancel = window.__iuRenderOptimizer.renderChunked(
        renderSingleItem,
        itemsToRender,
        list,
        {
          chunkSize: 25, // ✅ FIX: Menší chunk pro lepší responsivitu
          cancelToken: cancelToken,
          onProgress: (current, total) => {
            if(!cancelToken.cancelled) {
              renderedItems = alreadyRendered + current;
              updateLoadMoreVisibility();
            }
          },
          onComplete: (total) => {
            if(!cancelToken.cancelled) {
              renderedItems = alreadyRendered + total;
              renderInProgress = false;
              currentRenderCancel = null;
              
              // ✅ FIX: Performance measure a log
              const renderDuration = performance.now() - renderStart;
              if (DEBUG && performance.mark && performance.measure) {
                performance.mark("render_feed_end");
                performance.measure("render_feed", "render_feed_start", "render_feed_end");
                debugLog(`Render feed: ${Math.round(renderDuration)}ms, items: ${total}`);
              }

              updateLoadMoreVisibility();
              
              // Enforce DOM limit
              if(window.__iuRenderOptimizer) {
                window.__iuRenderOptimizer.enforceDOMLimit(list);
              }
            }
          }
        }
      );
    } else {
      // Původní rychlý render pro malé feedy
      const frag = document.createDocumentFragment();

      while(renderedItems < displayFeed.length && renderedItems < renderedLimit){
        const a = displayFeed[renderedItems];
        if(!a || typeof a !== "object"){
          renderedItems += 1;
          continue;
        }
        const ct = norm(a?.contentType || "article");

        if(ct === "ad"){
          frag.appendChild(buildFeedPauseNode());
          frag.appendChild(createAdCard(a?.adLabel || "Partner"));
          renderedItems += 1;
          continue;
        }

        if(ct === "video"){
          frag.appendChild(buildFeedPauseNode());
          frag.appendChild(buildVideoNodeFromItem(a));
          renderedItems += 1;
          continue;
        }

        // ARTICLE
        const card = document.createElement("article");
        card.className = "news-card";

        const time = fmtTime(a.publishedAt);
        const rawTitle = String(a.title || "").trim();
        const titleText = rawTitle.trim();
        const titleHtml = escapeHtml(titleText);
        const sourcesAll = Array.isArray(a.sources) ? a.sources : [];
        const sources = sourcesAll;
        const primaryUrl = safeUrl(sources?.[0]?.url || "");

        const domainsHtml = (sources && sources.length)
          ? sources.map(s => {
              const u = safeUrl(s?.url || "");
              const dom = domainFromUrl(u);
              const label = escapeHtml(dom || "www");
              const href = escapeHtml(u || "#");
              return `<a class="sourceDomain" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
            }).join(`<span class="srcSep"> · </span>`)
          : `<span style="color:rgba(11,27,43,0.55);font-weight:600;font-size:11.5px;">—</span>`;

        const titleLinkHref = escapeHtml(primaryUrl || "#");
        const titleAttr = escapeAttr(titleText || "");

        card.innerHTML = `
          <h3 class="news-title">
            <a class="news-titleLink"
               href="${titleLinkHref}"
               target="_blank"
               rel="noopener noreferrer"
               title="${titleAttr}"
               aria-label="${titleAttr}">
              ${titleHtml || "—"}
            </a>
          </h3>

          <div class="news-row2">
            <span class="meta-time">${escapeHtml(time)}</span>
            <span class="news-sourceLabel">Zdroj:</span>
            <div class="news-sources">${domainsHtml}</div>
          </div>
        `;

        frag.appendChild(card);
        renderedItems += 1;
      }

      list.appendChild(frag);
    }
  }
```

### 6. loadAllItems (řádky 1683-1725)

```javascript
  async function loadAllItems({ silent = false } = {}){
    const [aRes, vRes] = await Promise.all([
      loadArticlesOnly({ silent }),
      loadVideosOnly()
    ]);

    if(aRes.changed === false && vRes.changed === false){
      return false;
    }

    const articles = (aRes.items !== null) ? aRes.items : null;
    const videos   = (vRes.items !== null) ? vRes.items : null;

    let currentArticles = [];
    let currentVideos = [];

    for(const it of (Array.isArray(allItems) ? allItems : [])){
      if(norm(it.contentType) === "video") currentVideos.push(it);
      else currentArticles.push(it);
    }

    const nextArticles = (articles !== null) ? articles : currentArticles;
    const nextVideos   = (videos !== null) ? videos : currentVideos;

    allArticles = nextArticles.slice().filter(x => norm(x.contentType) !== "video");
    allVideos   = nextVideos.slice().filter(x => norm(x.contentType) === "video");

    let combined = [...nextArticles, ...nextVideos];

    combined.sort((a,b) => {
      const ta = new Date(a.publishedAt || 0).getTime();
      const tb = new Date(b.publishedAt || 0).getTime();
      if(!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
      if(!Number.isFinite(ta)) return 1;
      if(!Number.isFinite(tb)) return -1;
      return tb - ta;
    });

    allItems = combined;

    if(!silent){
      applyFilter();
    }

    return true;
  }
```

---

## app-crash-shield.js

### 1. safeFetchJSON - hlavní fetch funkce (řádky 254-325)

```javascript
  async function safeFetchJSON(name, url, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 9000;
    const retries = opts.retries ?? 2;
    const allowHTML = false;

    let lastErr = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // ✅ FIX: Odstraněn cache:"no-store" - SW cache může fungovat
        const res = await fetchWithTimeout(url, { timeoutMs });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

        const text = await res.text();
        if (!allowHTML && looksLikeHTML(text)) {
          throw new Error("Místo JSON přišlo HTML (pravděpodobně 404/redirect/Pages chyba).");
        }

        const parsed = safeJSONParse(text);
        if (!parsed.ok) throw new Error(`JSON parse error: ${parsed.error?.message || parsed.error}`);

        const v = parsed.value;
        const isOkType = (typeof v === "object" && v !== null);
        if (!isOkType) throw new Error("JSON není objekt/array.");

        rotateWrite(name, text);
        diagPushFetch({ t: nowISO(), name, url, ok: true, source: "network" });
        diagSet("last_ok", { t: nowISO(), note: "data loaded", articles: name === "articles" ? "ok" : undefined });

        return {
          ok: true,
          data: v,
          source: "network",
          attempt
        };
      } catch (e) {
        lastErr = e;
        log(`safeFetchJSON fail [${name}] attempt=${attempt}`, e);
        diagPushFetch({ t: nowISO(), name, url, ok: false, source: "network", msg: String(e?.message || e) });

        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
        }
      }
    }

    const cached = readBestCache(name);
    if (cached.ok) {
      const parsed = safeJSONParse(cached.text);
      if (parsed.ok) {
        diagPushFetch({ t: nowISO(), name, url, ok: false, source: "cache", msg: "fallback used" });
        return {
          ok: false,
          data: parsed.value,
          source: "cache",
          fallbackUsed: true,
          cacheSlot: cached.slot,
          error: lastErr
        };
      } else {
        storageSet(cacheQuarantineKey(name), cached.text);
      }
    }

    return {
      ok: false,
      data: null,
      source: "none",
      fallbackUsed: false,
      error: lastErr
    };
  }
```

### 2. DATA mapping a loadAllData (řádky 331-397)

```javascript
  // ✅ FIX: Robustní detekce BASE z pathname (automaticky detekuje /filtr/ nebo /)
  function getBaseRoot(){
    // Vrací root projektu, ne aktuální podstránku
    // Např:
    // - https://infoUzel.cz/            -> "/"
    // - https://xxx.github.io/filtr/    -> "/filtr/"
    // - https://xxx.github.io/filtr/#   -> "/filtr/"
    const path = location.pathname;
    
    // Pokud máš projekt v podsložce repo (nejčastěji /filtr/), nech ji tam.
    // Pokud jsi na rootu, zůstane "/"
    // Důležité: vždy ukončit lomítkem.
    const root = path.endsWith("/") ? path : (path + "/");
    
    // Normalizuj: pokud jsme na /filtr/index.html, vrať /filtr/
    // Pokud jsme na /index.html, vrať /
    if (root.includes("/index.html")) {
      return root.split("/index.html")[0] + "/";
    }
    
    return root;
  }
  
  const BASE = getBaseRoot();

  // BASE už obsahuje trailing slash, takže nepřidáváme další
  const DATA = {
    articlesUrl: `${BASE}data/articles.json`,
    videosUrl: `${BASE}data/videos.json`,
    metaUrl: `${BASE}data/meta.json`,
    statusUrl: `${BASE}data/status.json`  // status.json se generuje v workflow
  };

  if (breakMode === "articles404") DATA.articlesUrl = `${BASE}data/articles__404__.json`;
  if (breakMode === "articlesHTML") DATA.articlesUrl = `${BASE}index.html`;
  if (breakMode === "videos404") DATA.videosUrl = `${BASE}data/videos__404__.json`;

  async function loadAllData() {
    const [articles, videos, meta, status] = await Promise.all([
      safeFetchJSON("articles", DATA.articlesUrl, { timeoutMs: 9000, retries: 2 }),
      safeFetchJSON("videos", DATA.videosUrl, { timeoutMs: 9000, retries: 2 }),
      safeFetchJSON("meta", DATA.metaUrl, { timeoutMs: 7000, retries: 1 }),
      safeFetchJSON("status", DATA.statusUrl, { timeoutMs: 5000, retries: 1 })
    ]);

    const anyCache = [articles, videos, meta, status].some(x => x && x.source === "cache");
    const anyFailNoData = [articles, videos].some(x => x && !x.ok && !x.data);

    if (!navigator.onLine) {
      setStatusBadge("Offline – zobrazuji uložená data", "offline");
    } else if (anyCache) {
      setStatusBadge("Síť kolísá – zobrazuji uložená data", "cache");
    } else {
      setStatusBadge("", "ok");
    }

    if (anyFailNoData) {
      const e1 = articles?.error?.message || "";
      const e2 = videos?.error?.message || "";
      showEmergencyOverlay(
        "Nepodařilo se načíst data a v cache nic není. UI běží v prázdném režimu.",
        `articles: ${e1}\nvideos: ${e2}`
      );
    }

    return { articles, videos, meta, status };
  }
```

### 3. window.__iuSafeFetch export (řádky 500-505)

```javascript
  // Exponujeme safe fetch funkce pro použití v existujícím app.js
  window.__iuSafeFetch = {
    fetchJSON: safeFetchJSON,
    readCache: readBestCache,
    rotateWrite: rotateWrite
  };
```

---

## Poznámky k auditu

### Duplicity a možné problémy:

1. **BASE detekce je duplikovaná** - v `app.js` i `app-crash-shield.js` (oba mají `getBaseRoot()`)
2. **loadAllData v crash-shield** - načítá data, ale app.js má vlastní `loadAllItems()` - možná duplicita
3. **renderAll v crash-shield** - možná není používán, pokud app.js má vlastní render
4. **Signature check** - v `loadArticlesOnly` a `loadVideosOnly` kontroluje změnu dat, ale crash-shield to nedělá

### Kritické řádky pro "0 z 240":

- `loadArticlesOnly` řádek 1583: `const result = await safeFetch("articles", ARTICLES_URL, { silent });`
- `loadVideosOnly` řádek 1639: `const result = await safeFetch("videos", VIDEOS_URL, { silent: true });`
- `unwrapToArray` - pokud data nejsou v očekávaném formátu, může vrátit prázdné pole
- `applyFilter` řádek 1244-1270 - pokud `displayFeed` je prázdný, render nic nevykreslí
