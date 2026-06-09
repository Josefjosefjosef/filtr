/* app-crash-shield.js
   infoUzel.cz – Crash Shield + Safe Data Layer
   Cíl: žádná bílá stránka, vždy fallback na cache, vždy UI shell.
*/

(() => {
  "use strict";

  // =========================
  // === CRASH SHIELD (GLOBAL)
  // =========================

  const DEBUG = new URLSearchParams(location.search).get("debug") === "1";
  const breakMode = new URLSearchParams(location.search).get("break");

  function nowISO() {
    return new Date().toISOString();
  }

  function safeJSONParse(text) {
    try { return { ok: true, value: JSON.parse(text) }; }
    catch (e) { return { ok: false, error: e }; }
  }

  function log(...args) {
    if (DEBUG) console.log("[infoUzel]", ...args);
  }

  function warn(...args) {
    console.warn("[infoUzel]", ...args);
  }

  const DIAG_NS = "iu:diag:";

  function diagSet(key, obj) {
    try { localStorage.setItem(DIAG_NS + key, JSON.stringify(obj)); } catch (_) {}
  }
  function diagGetArray(key) {
    try {
      const t = localStorage.getItem(DIAG_NS + key);
      const v = t ? JSON.parse(t) : [];
      return Array.isArray(v) ? v : [];
    } catch (_) { return []; }
  }
  function diagPushFetch(entry) {
    const arr = diagGetArray("last_fetches");
    arr.unshift(entry);
    arr.splice(30);
    try { localStorage.setItem(DIAG_NS + "last_fetches", JSON.stringify(arr)); } catch (_) {}
  }

  function saveLastCrash(errLike, context = {}) {
    try {
      const payload = {
        t: nowISO(),
        msg: String(errLike?.message || errLike),
        stack: String(errLike?.stack || ""),
        context
      };
      localStorage.setItem("crash:last", JSON.stringify(payload));
      diagSet("last_error", {
        t: nowISO(),
        type: context.type || "error",
        message: payload.msg,
        filename: context.filename || "",
        lineno: context.lineno || null,
        colno: context.colno || null,
        stack: payload.stack
      });
    } catch (_) {}
  }

  function showEmergencyOverlay(message, details) {
    try {
      let el = document.getElementById("iuEmergency");
      if (!el) {
        el = document.createElement("div");
        el.id = "iuEmergency";
        el.style.cssText = `
          position: fixed; left: 12px; right: 12px; bottom: 12px;
          z-index: 99999; padding: 12px 14px;
          border: 1px solid rgba(20,40,70,0.18);
          border-radius: 12px;
          background: rgba(255,255,255,0.92);
          backdrop-filter: blur(10px);
          font: 14px/1.35 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          color: rgba(11,27,43,0.92);
          box-shadow: 0 12px 40px rgba(0,0,0,0.10);
        `;
        document.body.appendChild(el);
      }
      el.innerHTML = `
        <div style="display:flex;gap:10px;align-items:flex-start;">
          <div style="flex:1">
            <div style="font-weight:800;margin-bottom:4px;">Nouzový režim</div>
            <div style="margin-bottom:8px;">${escapeHTML(message || "Došlo k chybě. Zobrazuji uložená data, pokud jsou k dispozici.")}</div>
            ${details ? `<pre style="white-space:pre-wrap;margin:0;padding:8px;border-radius:10px;background:rgba(20,40,70,0.06);border:1px solid rgba(20,40,70,0.10);font-size:12px;max-height:160px;overflow:auto;">${escapeHTML(details)}</pre>` : ""}
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button id="iuReloadBtn" style="padding:8px 10px;border-radius:10px;border:1px solid rgba(20,40,70,0.16);background:#fff;cursor:pointer;font-weight:700;">Obnovit</button>
            <button id="iuCopyBtn" style="padding:8px 10px;border-radius:10px;border:1px solid rgba(20,40,70,0.16);background:#fff;cursor:pointer;">Kopie chyby</button>
          </div>
        </div>
      `;
      const r = document.getElementById("iuReloadBtn");
      if (r) r.onclick = () => location.reload();
      const c = document.getElementById("iuCopyBtn");
      if (c) c.onclick = async () => {
        try {
          await navigator.clipboard.writeText(details || message || "");
        } catch (_) {}
      };
    } catch (_) {}
  }

  function escapeHTML(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  window.addEventListener("error", (ev) => {
    saveLastCrash(ev?.error || ev?.message, { type: "error", filename: ev?.filename, lineno: ev?.lineno, colno: ev?.colno });
    warn("window.error", ev?.message);
    if (DEBUG) showEmergencyOverlay("JS chyba na stránce.", `${ev?.message}\n${ev?.filename}:${ev?.lineno}:${ev?.colno}\n${ev?.error?.stack || ""}`);
  });

  window.addEventListener("unhandledrejection", (ev) => {
    saveLastCrash(ev?.reason, { type: "unhandledrejection" });
    warn("unhandledrejection", ev?.reason);
    diagSet("last_error", {
      t: nowISO(),
      type: "unhandledrejection",
      message: String(ev?.reason?.message || ev?.reason || ""),
      stack: String(ev?.reason?.stack || "")
    });
    if (DEBUG) showEmergencyOverlay("Nevyřešená Promise chyba.", String(ev?.reason?.stack || ev?.reason || ""));
  });

  // =========================
  // === UI STATUS BADGE
  // =========================

  function setStatusBadge(text, mode = "ok") {
    try {
      let el = document.getElementById("iuStatusBadge");
      if (!el) {
        el = document.createElement("div");
        el.id = "iuStatusBadge";
        el.style.cssText = `
          position: fixed; top: 10px; right: 10px; z-index: 9999;
          font: 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
          padding: 8px 10px; border-radius: 999px;
          border: 1px solid rgba(20,40,70,0.14);
          background: rgba(255,255,255,0.92);
          color: rgba(11,27,43,0.82);
          box-shadow: 0 10px 30px rgba(0,0,0,0.08);
          display: none;
        `;
        document.body.appendChild(el);
      }
      el.textContent = text;
      el.style.display = text ? "block" : "none";
      if (mode === "ok") el.style.borderColor = "rgba(20,40,70,0.14)";
      if (mode === "warn") el.style.borderColor = "rgba(200,120,0,0.45)";
      if (mode === "offline") el.style.borderColor = "rgba(200,0,0,0.35)";
      if (mode === "cache") el.style.borderColor = "rgba(0,120,200,0.35)";
    } catch (_) {}
  }

  // =========================
  // === STORAGE (ROTATING BACKUPS)
  // =========================

  const CACHE_NS = "iu";
  const ROT = ["a", "b", "c"];

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
  }
  function storageRemove(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }

  function cacheKey(name, slot) {
    return `${CACHE_NS}:cache:${name}:v1:${slot}`;
  }
  function cacheMetaKey(name) {
    return `${CACHE_NS}:cachemeta:${name}:v1`;
  }
  function cacheQuarantineKey(name) {
    return `${CACHE_NS}:quarantine:${name}:v1`;
  }

  function rotateWrite(name, jsonString) {
    const a = cacheKey(name, "a");
    const b = cacheKey(name, "b");
    const c = cacheKey(name, "c");
    const prevA = storageGet(a);
    const prevB = storageGet(b);

    if (prevB !== null) storageSet(c, prevB);
    if (prevA !== null) storageSet(b, prevA);
    storageSet(a, jsonString);

    const meta = {
      t: nowISO(),
      size: jsonString.length
    };
    storageSet(cacheMetaKey(name), JSON.stringify(meta));
  }

  function readBestCache(name) {
    const a = storageGet(cacheKey(name, "a"));
    if (a) return { ok: true, text: a, slot: "a" };
    const b = storageGet(cacheKey(name, "b"));
    if (b) return { ok: true, text: b, slot: "b" };
    const c = storageGet(cacheKey(name, "c"));
    if (c) return { ok: true, text: c, slot: "c" };
    return { ok: false };
  }

  // =========================
  // === SAFE FETCH JSON (TIMEOUT + RETRY + FALLBACK)
  // =========================

  // ✅ FIX: Odstraněn default cache:"no-store" - SW cache může fungovat
  // cache parametr je volitelný, default je "default" (respektuje SW)
  async function fetchWithTimeout(url, { timeoutMs = 8000, cache } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // Pokud cache není specifikován, použij default (SW může cachovat)
      const fetchOpts = { signal: ctrl.signal };
      if (cache !== undefined) fetchOpts.cache = cache;
      const res = await fetch(url, fetchOpts);
      return res;
    } finally {
      clearTimeout(t);
    }
  }

  function looksLikeHTML(text) {
    const s = text.trim().slice(0, 200).toLowerCase();
    return s.startsWith("<!doctype") || s.startsWith("<html") || s.includes("<head") || s.includes("<body");
  }

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
          attempt,
          fetchedAt: nowISO()
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

    // ✅ FIX: Fallback na cache
    const cached = readBestCache(name);
    if (cached.ok) {
      const parsed = safeJSONParse(cached.text);
      if (parsed.ok) {
        diagPushFetch({ t: nowISO(), name, url, ok: false, source: "cache", msg: "fallback used" });
        return {
          ok: false,  // Network selhal, ale máme cache
          data: parsed.value,
          source: "cache",
          fallbackUsed: true,
          cacheSlot: cached.slot,
          error: lastErr,
          fetchedAt: nowISO()
        };
      } else {
        storageSet(cacheQuarantineKey(name), cached.text);
      }
    }

    // ✅ FIX: Žádná data - ani network, ani cache
    return {
      ok: false,
      data: null,
      source: "none",
      fallbackUsed: false,
      error: lastErr,
      fetchedAt: nowISO()
    };
  }

  async function waitForGlobalFn(fnName, maxMs = 12000) {
    const t0 = Date.now();
    while (typeof window[fnName] !== "function") {
      if (Date.now() - t0 > maxMs) return false;
      await new Promise((r) => setTimeout(r, 20));
    }
    return true;
  }

  async function loadArticlesThroughSharedOrCache() {
    const ready = await waitForGlobalFn("__iuLoadArticlesJsonOnce", 12000);
    if (!ready) {
      const cached = readBestCache("articles");
      if (cached.ok) {
        const parsed = safeJSONParse(cached.text);
        if (parsed.ok) {
          diagPushFetch({ t: nowISO(), name: "articles", url: DATA.articlesUrl, ok: false, source: "cache", msg: "no_loader_cache_only" });
          return {
            ok: false,
            data: parsed.value,
            source: "cache",
            fallbackUsed: true,
            cacheSlot: cached.slot,
            error: new Error("articles_loader_missing"),
            fetchedAt: nowISO(),
          };
        }
        storageSet(cacheQuarantineKey("articles"), cached.text);
      }
      diagPushFetch({ t: nowISO(), name: "articles", url: DATA.articlesUrl, ok: false, source: "none", msg: "no_loader_no_network" });
      return {
        ok: false,
        data: null,
        source: "none",
        fallbackUsed: false,
        error: new Error("articles_loader_missing"),
        fetchedAt: nowISO(),
      };
    }
    try {
      const v = await window.__iuLoadArticlesJsonOnce();
      const text = JSON.stringify(v);
      rotateWrite("articles", text);
      diagPushFetch({ t: nowISO(), name: "articles", url: DATA.articlesUrl, ok: true, source: "network" });
      diagSet("last_ok", { t: nowISO(), note: "data loaded", articles: "ok" });
      return {
        ok: true,
        data: v,
        source: "network",
        attempt: 0,
        fetchedAt: nowISO(),
      };
    } catch (e) {
      log("loadArticlesThroughSharedOrCache fail", e);
      diagPushFetch({ t: nowISO(), name: "articles", url: DATA.articlesUrl, ok: false, source: "network", msg: String(e?.message || e) });
      const cached = readBestCache("articles");
      if (cached.ok) {
        const parsed = safeJSONParse(cached.text);
        if (parsed.ok) {
          diagPushFetch({ t: nowISO(), name: "articles", url: DATA.articlesUrl, ok: false, source: "cache", msg: "shared_fail_fallback" });
          return {
            ok: false,
            data: parsed.value,
            source: "cache",
            fallbackUsed: true,
            cacheSlot: cached.slot,
            error: e,
            fetchedAt: nowISO(),
          };
        }
        storageSet(cacheQuarantineKey("articles"), cached.text);
      }
      return {
        ok: false,
        data: null,
        source: "none",
        fallbackUsed: false,
        error: e,
        fetchedAt: nowISO(),
      };
    }
  }

  async function loadVideosThroughSharedOrCache() {
    const ready = await waitForGlobalFn("__iuLoadVideosJsonOnce", 12000);
    if (!ready) {
      const cached = readBestCache("videos");
      if (cached.ok) {
        const parsed = safeJSONParse(cached.text);
        if (parsed.ok) {
          diagPushFetch({ t: nowISO(), name: "videos", url: DATA.videosUrl, ok: false, source: "cache", msg: "no_loader_cache_only" });
          return {
            ok: false,
            data: parsed.value,
            source: "cache",
            fallbackUsed: true,
            cacheSlot: cached.slot,
            error: new Error("videos_loader_missing"),
            fetchedAt: nowISO(),
          };
        }
        storageSet(cacheQuarantineKey("videos"), cached.text);
      }
      diagPushFetch({ t: nowISO(), name: "videos", url: DATA.videosUrl, ok: false, source: "none", msg: "no_loader_no_network" });
      return {
        ok: false,
        data: null,
        source: "none",
        fallbackUsed: false,
        error: new Error("videos_loader_missing"),
        fetchedAt: nowISO(),
      };
    }
    try {
      const v = await window.__iuLoadVideosJsonOnce();
      const text = JSON.stringify(v);
      rotateWrite("videos", text);
      diagPushFetch({ t: nowISO(), name: "videos", url: DATA.videosUrl, ok: true, source: "network" });
      return {
        ok: true,
        data: v,
        source: "network",
        attempt: 0,
        fetchedAt: nowISO(),
      };
    } catch (e) {
      log("loadVideosThroughSharedOrCache fail", e);
      diagPushFetch({ t: nowISO(), name: "videos", url: DATA.videosUrl, ok: false, source: "network", msg: String(e?.message || e) });
      const cached = readBestCache("videos");
      if (cached.ok) {
        const parsed = safeJSONParse(cached.text);
        if (parsed.ok) {
          diagPushFetch({ t: nowISO(), name: "videos", url: DATA.videosUrl, ok: false, source: "cache", msg: "shared_fail_fallback" });
          return {
            ok: false,
            data: parsed.value,
            source: "cache",
            fallbackUsed: true,
            cacheSlot: cached.slot,
            error: e,
            fetchedAt: nowISO(),
          };
        }
        storageSet(cacheQuarantineKey("videos"), cached.text);
      }
      return {
        ok: false,
        data: null,
        source: "none",
        fallbackUsed: false,
        error: e,
        fetchedAt: nowISO(),
      };
    }
  }

  // =========================
  // === DATA LOADER (ARTICLES / VIDEOS / META / STATUS)
  // =========================

  // ✅ FIX: BASE je path-only ("/" nebo "/filtr/"), vždy s trailing slash
  function getBaseRoot(){
    let p = location.pathname;
    if (p.endsWith("index.html")) p = p.slice(0, -10);
    if (!p.endsWith("/")) p += "/";
    return p;
  }
  
  const BASE = getBaseRoot();

  const PROJECTS_DATA_BASE = "/projects/data";
  const dataVer = (typeof document !== "undefined" && document.querySelector) ? (document.querySelector('meta[name="iu-data-ver"]')?.getAttribute('content') || '').trim() : '';
  const dataVerQParam = (() => {
    const v = (dataVer && dataVer !== "iu-data-ver-placeholder") ? dataVer : "iu-data-ver-placeholder";
    return "?v=" + encodeURIComponent(v);
  })();
  const DATA = {
    articlesUrl: (typeof window !== "undefined" && window.__iuHomepageFeedDataSource === "article_feed_chunks/manifest.json")
      ? `${PROJECTS_DATA_BASE}/article_feed_chunks/manifest.json${dataVerQParam}`
      : `${PROJECTS_DATA_BASE}/publishable_pool.json${dataVerQParam}`,
    videosUrl: `${PROJECTS_DATA_BASE}/videos.json${dataVerQParam}`,
    metaUrl: `${PROJECTS_DATA_BASE}/meta.json`,
    statusUrl: `${PROJECTS_DATA_BASE}/status.json`  // status.json se generuje v workflow
  };

  if (breakMode === "articles404") DATA.articlesUrl = `${BASE}data/articles__404__.json`;
  if (breakMode === "articlesHTML") DATA.articlesUrl = `${BASE}index.html`;
  if (breakMode === "videos404") DATA.videosUrl = `${BASE}data/videos__404__.json`;

  async function loadAllData() {
    const [articles, videos, meta, status] = await Promise.all([
      loadArticlesThroughSharedOrCache(),
      loadVideosThroughSharedOrCache(),
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

  // =========================
  // === RENDER: NIKDY NEPADAT
  // =========================

  function safeArray(x) {
    return Array.isArray(x) ? x : [];
  }

  function renderAll(payload) {
    try {
      const a = payload?.articles?.data;
      const v = payload?.videos?.data;

      if (DEBUG) {
        const info = {
          articlesSource: payload?.articles?.source,
          videosSource: payload?.videos?.source,
          metaSource: payload?.meta?.source,
          statusSource: payload?.status?.source,
          articlesCount: safeArray(a?.items || a).length,
          videosCount: safeArray(v?.items || v).length
        };
        log("renderAll info", info);
      }

      // ✅ FIX: Odstraněny mrtvé querySelectory (#lastUpdate, #emptyState neexistují v HTML)
      // app.js používá #dataUpdatedAt a #emptyBox místo toho

      const breakMode2 = new URLSearchParams(location.search).get("break");
      if (breakMode2 === "domNull") {
        const x = document.querySelector("#thisElementDoesNotExist");
        if (x) x.textContent = "never";
      }

      // Napojení na existující app.js
      // app.js má vlastní loadArticlesOnly() a loadVideosOnly()
      // Crash shield jen zajistí, že data jsou k dispozici v cache
      // app.js se načte normálně a použije safe fetch z cache pokud selže síť
      
      // Exponujeme data pro případné použití v app.js (volitelné)
      window.__iuCrashShieldData = {
        articles: a || { items: [] },
        videos: v || { items: [] },
        meta: payload?.meta?.data || {},
        status: payload?.status?.data || {}
      };
      
      // Pokud app.js potřebuje použít safe fetch, může použít:
      // window.__iuSafeFetch.fetchJSON(name, url, opts)
    } catch (e) {
      saveLastCrash(e, { where: "renderAll" });
      warn("renderAll crashed", e);
      showEmergencyOverlay("Chyba při vykreslení. UI běží v nouzovém režimu.", String(e?.stack || e));
    }
  }

  // =========================
  // === SERVICE WORKER (crash-shield)
  // Registration + update live in assets/app.js (iuEnsureServiceWorkerController) to avoid
  // duplicate register/update races that surface as "Failed to update ... script ('Unknown')".
  // Here: only ?nosw=1 kill switch (unregister).
  // =========================

  async function iuUnregisterServiceWorkersIfNosw() {
    try {
      if (!("serviceWorker" in navigator)) return;
      const NOSW = new URLSearchParams(location.search).get("nosw") === "1";
      if (!NOSW) return;
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        await reg.unregister();
      }
    } catch (e) {}
  }

  // =========================
  // === EXPOSE SAFE FETCH FOR EXISTING APP.JS
  // =========================

  // =========================
  // === EXPOSE SAFE FETCH API (SJEDNOCENÉ)
  // =========================
  
  // ✅ FIX: Sjednocené API - fetchJSON je hlavní, safeFetchJSON je alias pro kompatibilitu
  window.__iuSafeFetch = window.__iuSafeFetch || {};
  window.__iuSafeFetch.fetchJSON = safeFetchJSON;     // HLAVNÍ
  window.__iuSafeFetch.safeFetchJSON = safeFetchJSON; // ALIAS pro kompatibilitu
  window.__iuSafeFetch.readCache = readBestCache;
  window.__iuSafeFetch.rotateWrite = rotateWrite;

  // =========================
  // === BOOTSTRAP (NEPADACÍ START)
  // =========================

  async function bootstrap() {
    try {
      if (window.__iuCrashShieldBootstrapStarted) return;
      window.__iuCrashShieldBootstrapStarted = true;

      await iuUnregisterServiceWorkersIfNosw();

      window.addEventListener("online", () => setStatusBadge("", "ok"));
      window.addEventListener("offline", () => setStatusBadge("Offline – zobrazuji uložená data", "offline"));

      // Načti data do cache (pro případ, že app.js selže)
      const data = await loadAllData();
      
      // Ulož data pro případné použití
      window.__iuCrashShieldData = {
        articles: data?.articles?.data || { items: [] },
        videos: data?.videos?.data || { items: [] },
        meta: data?.meta?.data || {},
        status: data?.status?.data || {}
      };

      // renderAll() je volitelné - app.js má vlastní render
      // renderAll(data);

      if (DEBUG) {
        const last = storageGet("crash:last");
        if (last) log("Last crash:", last);
      }
    } catch (e) {
      saveLastCrash(e, { where: "bootstrap" });
      warn("bootstrap failed", e);
      showEmergencyOverlay("Bootstrap selhal. UI běží v nouzovém režimu.", String(e?.stack || e));
    }
  }

  // Crash shield se načte před app.js, takže bootstrap běží hned
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
