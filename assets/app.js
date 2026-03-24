/* SEV1: iuIsProjectsRoute — global + window for safe scope (module/global) */
var iuIsProjectsRoute = function iuIsProjectsRoute(){
  try{
    var p = (typeof location !== "undefined" && location && location.pathname ? String(location.pathname) : "").replace(/\\/g, '/');
    return p === '/projects/' || p === '/projects' || p.indexOf('/projects/') === 0 || p === '/filtr/projects' || p === '/filtr/projects/';
  }catch(e){
    return false;
  }
};
try { if (typeof window !== "undefined") window.iuIsProjectsRoute = iuIsProjectsRoute; } catch(e){}

/** P0: production host — debug UI and ?debug=1 tooling must never activate on infouzel.cz */
function iuIsProdHost() {
  try {
    var h = String(location.hostname || "").toLowerCase();
    return h === "infouzel.cz" || h === "www.infouzel.cz";
  } catch (_) {
    return false;
  }
}
try { if (typeof window !== "undefined") window.iuIsProdHost = iuIsProdHost; } catch (e) {}

/* P0: reload always returns to top (like seznam.cz) */
try {
  if (typeof history !== "undefined" && "scrollRestoration" in history) history.scrollRestoration = "manual";
  if (typeof window !== "undefined") {
    window.scrollTo(0, 0);
    window.addEventListener("load", function(){ window.scrollTo(0, 0); });
    window.addEventListener("pageshow", function(){ window.scrollTo(0, 0); });
  }
} catch(e){}

// === MAINTENANCE
// ::contentReference[oaicite:0]{index=0}
// REŽIM: MAINTENANCE
// Stav: FEED STABLE
// Povolené zásahy:
// - drobné UI úpravy mimo feed
// - přidání nových funkcí mimo render pipeline
// Zakázané zásahy:
// - loadData / applyFilter / renderFeed
// - state.cachedItems / state.filteredItems logika
// - změny routování přes contentType
// === INFOUZEL FEED INVARIANTS (NO-GO ZONE) ===
// - jediný zdroj pravdy: state.*
// - jediná render pipeline: loadData → state.cachedItems → applyFilter → renderFeed
// - render výhradně do #feed (safeTarget)
// - routování výhradně přes item.contentType
// Porušení = BUG (ne warning)

window.addEventListener("error", (e) => {
  try {
    console.error("[WINERROR]", e?.message, e?.filename, e?.lineno, e?.colno, e?.error);
    if (typeof window.persistLastError === "function") {
      window.persistLastError(`${e?.message || "error"} (${e?.filename || ""}:${e?.lineno || ""})`);
    }
  } catch {}
});

window.addEventListener("unhandledrejection", (e) => {
  try {
    console.error("[UNHANDLED]", e?.reason);
    if (typeof window.persistLastError === "function") {
      const r = e?.reason;
      window.persistLastError(`Promise: ${r?.message || String(r || "unknown")}`);
    }
  } catch {}
});

if (!iuIsProdHost() && new URLSearchParams(location.search || "").get("debug") === "1") {
  document.documentElement.classList.add("iu-debug-on");
}

try {
(() => {
  function iuStripEmptyHash(){
    try{
      if(window.location.hash === '#'){
        const u = new URL(window.location.href);
        u.hash = '';
        history.replaceState(null, '', u.toString());
      }
    }catch(e){}
  }
  iuStripEmptyHash();

  document.documentElement.setAttribute("data-iu-js","loaded");
  try { document.documentElement.setAttribute("data-iu-path", location.pathname + location.search); } catch {}
  try { document.documentElement.setAttribute("data-iu-buildstamp", document.querySelector('meta[name="iu-build"]')?.content || "no-meta"); } catch {}
  const $ = (sel) => document.querySelector(sel);

  /** P0: banner když je nový SW nainstalovaný, ale starý ještě řídí stránku (PWA update UX) */
  function iuShowSwUpdateBanner() {
    try {
      if (document.getElementById("iu-update-banner")) return;
      var el = document.createElement("div");
      el.id = "iu-update-banner";
      el.setAttribute("role", "status");
      el.style.cssText =
        "position:fixed;bottom:0;left:0;right:0;z-index:2147483646;padding:12px 16px;background:#0B1F33;color:#fff;font:14px/1.4 system-ui,-apple-system,sans-serif;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:12px;box-shadow:0 -4px 24px rgba(0,0,0,.2);box-sizing:border-box;";
      el.innerHTML =
        '<span>Nová verze je připravena.</span><button type="button" id="iu-update-btn" style="padding:8px 14px;border-radius:8px;border:0;background:#fff;color:#0B1F33;font:inherit;font-weight:600;cursor:pointer;">Aktualizovat</button>';
      document.body.appendChild(el);
      var btn = document.getElementById("iu-update-btn");
      if (btn) {
        btn.addEventListener("click", function () {
          location.reload();
        });
      }
    } catch (e) {}
  }

  /** P0: shell vs CSS build mismatch → unregister SW, smazat iu-* caches, jeden hard navigation (bez nekonečné smyčky) */
  function iuMaybeShellStaleRecovery(onContinue) {
    try {
      var p =
        typeof location !== "undefined" && location && location.pathname
          ? String(location.pathname)
          : "";
      if (p !== "/projects/" && p !== "/projects" && p.indexOf("/projects/") !== 0) {
        onContinue();
        return;
      }
      if (sessionStorage.getItem("iu_shell_recovery_done") === "1") {
        onContinue();
        return;
      }
      var meta = document.querySelector('meta[name="iu-data-ver"]');
      var dataVer = meta ? String(meta.getAttribute("content") || "").trim() : "";
      if (!dataVer || dataVer === "iu-data-ver-placeholder") {
        onContinue();
        return;
      }
      var link = document.querySelector('link[rel="stylesheet"][href*="assets/app"]');
      var href = link ? String(link.getAttribute("href") || "") : "";
      if (href && href.indexOf("http") !== 0) {
        try {
          href = new URL(href, document.baseURI).href;
        } catch (e) {}
      }
      var m = href.match(/app\.([a-f0-9]{8})\.css/i);
      var cssHash = m ? m[1] : null;
      if (!cssHash) {
        onContinue();
        return;
      }
      if (String(cssHash).toLowerCase() === String(dataVer).toLowerCase()) {
        onContinue();
        return;
      }
      sessionStorage.setItem("iu_shell_recovery_done", "1");
      if (!("serviceWorker" in navigator) || !("caches" in window)) {
        try {
          var u0 = new URL(location.href);
          u0.searchParams.set("iu_recovered", "1");
          location.replace(u0.toString());
        } catch (e) {
          location.reload();
        }
        return;
      }
      Promise.all([
        navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(
            regs.map(function (r) {
              return r.unregister();
            })
          );
        }),
        caches.keys().then(function (keys) {
          return Promise.all(
            keys.map(function (k) {
              if (k.indexOf("iu-") === 0) {
                return caches.delete(k);
              }
            })
          );
        }),
      ])
        .then(function () {
          var u = new URL(location.href);
          u.searchParams.set("iu_recovered", "1");
          location.replace(u.toString());
        })
        .catch(function () {
          try {
            sessionStorage.removeItem("iu_shell_recovery_done");
          } catch (e) {}
          onContinue();
        });
    } catch (e) {
      onContinue();
    }
  }

  function iuBootServiceWorker() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", iuEnsureServiceWorkerController);
    } else {
      iuEnsureServiceWorkerController();
    }
  }

  function iuEnsureServiceWorkerController() {
    try {
      var p = (typeof location !== "undefined" && location && location.pathname) ? String(location.pathname) : "";
      if (p !== "/projects/" && p !== "/projects" && p.indexOf("/projects/") !== 0) return;
      if (!("serviceWorker" in navigator)) return;
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then(function (reg) {
          try {
            reg.addEventListener("updatefound", function () {
              var nw = reg.installing;
              if (!nw) return;
              nw.addEventListener("statechange", function () {
                if (nw.state === "installed" && navigator.serviceWorker.controller) {
                  iuShowSwUpdateBanner();
                }
              });
            });
            if (reg.waiting && navigator.serviceWorker.controller) {
              iuShowSwUpdateBanner();
            }
            reg.update();
          } catch (e) {}
          return navigator.serviceWorker.ready;
        })
        .then(function () {
          if (navigator.serviceWorker.controller) return;
          sessionStorage.setItem("iu_sw_reload_done", "1");
          location.reload();
        })
        .catch(function () {});
    } catch (e) {}
  }

  iuMaybeShellStaleRecovery(iuBootServiceWorker);

  function iuBasePath() {
    const p = location.pathname.toLowerCase();
    if (p.includes("/filtr/")) return "/filtr/projects/";
    if (p.includes("/projects/")) return "/projects/";
    return "/projects/";
  }

  function iuDataUrl(file) {
    const base = iuBasePath() + "data/" + file;
    const ver = (typeof document !== "undefined" && document.querySelector) ? (document.querySelector('meta[name="iu-data-ver"]')?.getAttribute('content') || '').trim() : '';
    if (ver && ver !== "iu-data-ver-placeholder" && (file === "articles.json" || file === "videos.json")) return base + "?v=" + ver;
    return base;
  }

  function iuGetMindMenuRoot(){
    try{
      return (
        document.querySelector(".mindMenu") ||
        document.querySelector("aside.accordionCol") ||
        null
      );
    }catch{
      return null;
    }
  }

  function iuRailApplyTheme(){
    try{
      const root = document.documentElement;
      const bg = localStorage.getItem("iuRailBg");
      const btnBg = localStorage.getItem("iuRailBtnBg");
      const btnFg = localStorage.getItem("iuRailBtnFg");
      if(bg) root.style.setProperty("--iuRailBg", bg);
      if(btnBg) root.style.setProperty("--iuRailBtnBg", btnBg);
      if(btnFg) root.style.setProperty("--iuRailBtnFg", btnFg);
    }catch{}
  }

  function iuPickColor(initial, onPick){
    const inp = document.createElement("input");
    inp.type = "color";
    try{
      const v = String(initial || "").trim();
      if (/^#[0-9a-f]{6}$/i.test(v)) inp.value = v;
    }catch{}
    inp.style.position = "fixed";
    inp.style.left = "-9999px";
    document.body.appendChild(inp);
    inp.addEventListener("input", () => { try{ onPick(inp.value); }catch{} });
    inp.addEventListener("change", () => { try{ onPick(inp.value); }catch{} setTimeout(()=>{ try{ inp.remove(); }catch{} }, 0); });
    try{ inp.click(); }catch{ try{ inp.remove(); }catch{} }
  }

  function iuInitRailThemeControls(){
    const bgBtn = document.getElementById("iuRailBgBtn");
    const btnBgBtn = document.getElementById("iuRailBtnBgBtn");
    const btnFgBtn = document.getElementById("iuRailBtnFgBtn");
    if(!bgBtn || !btnBgBtn || !btnFgBtn) return;

    function normHex(cur, fallback){
      const t = String(cur || "").trim();
      if (/^#[0-9a-f]{6}$/i.test(t)) return t;
      if (/^#[0-9a-f]{3}$/i.test(t)) return ("#" + t[1] + t[1] + t[2] + t[2] + t[3] + t[3]).toLowerCase();
      return String(fallback || "#000000");
    }

    bgBtn.addEventListener("click", () => {
      const cur = getComputedStyle(document.documentElement).getPropertyValue("--iuRailBg").trim();
      iuPickColor(normHex(cur || "#121826", "#121826"), (hex)=>{
        try{ localStorage.setItem("iuRailBg", hex); }catch{}
        iuRailApplyTheme();
      });
    });

    btnBgBtn.addEventListener("click", () => {
      const cur = getComputedStyle(document.documentElement).getPropertyValue("--iuRailBtnBg").trim();
      iuPickColor(normHex(cur || "#1f2937", "#1f2937"), (hex)=>{
        try{ localStorage.setItem("iuRailBtnBg", hex); }catch{}
        iuRailApplyTheme();
      });
    });

    btnFgBtn.addEventListener("click", () => {
      const cur = getComputedStyle(document.documentElement).getPropertyValue("--iuRailBtnFg").trim();
      iuPickColor(normHex(cur || "#ffffff", "#ffffff"), (hex)=>{
        try{ localStorage.setItem("iuRailBtnFg", hex); }catch{}
        iuRailApplyTheme();
      });
    });
  }

  // Apply saved rail theme ASAP (before layout paint).
  iuRailApplyTheme();
  try{
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iuInitRailThemeControls);
    else iuInitRailThemeControls();
  }catch{}

  function iuHasExplicitNavInUrl(){
    try{
      const u = new URL(window.location.href);
      const hasSection = u.searchParams.has('section');
      // důležité: samotné "#" je prázdný hash -> nebrat jako explicitní navigaci
      const hasMeaningfulHash = !!u.hash && u.hash.length > 1;
      return hasSection || hasMeaningfulHash;
    }catch(e){
      return false;
    }
  }
  try { window.iuHasExplicitNavInUrl = iuHasExplicitNavInUrl; } catch(e){}

  // === PERSIST SCROLL (reload keeps position, same URL only) ===
  window.addEventListener("beforeunload", () => {
    try{
      sessionStorage.setItem("iu:lastUrl", window.location.href);
      sessionStorage.setItem("iu:lastScrollY", String(window.scrollY || 0));
    }catch(e){}
  });
  window.addEventListener("load", () => {
    try{
      const lastUrl = sessionStorage.getItem("iu:lastUrl") || "";
      if (lastUrl !== window.location.href) return;
      const y = parseInt(sessionStorage.getItem("iu:lastScrollY") || "0", 10);
      if (Number.isFinite(y) && y > 0) setTimeout(() => window.scrollTo(0, y), 50);
    }catch(e){}
  }, { once: true });
  const _iuPersistScrollDone = new Set();
  function persistScroll(el, key) {
    if (!el || !key || _iuPersistScrollDone.has(key)) return;
    _iuPersistScrollDone.add(key);
    el.addEventListener("scroll", () => {
      try { localStorage.setItem(key, String(el.scrollTop)); } catch {}
    });
    try {
      const y = parseInt(localStorage.getItem(key) || "0", 10);
      if (y > 0) el.scrollTop = y;
    } catch {}
  }
  function iuPersistScrollPanels() {
    persistScroll(document.querySelector(".iu-aiPanelBody"), "iuAiScroll");
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iuPersistScrollPanels);
  } else {
    iuPersistScrollPanels();
  }
  try { window.iuPersistScrollPanels = iuPersistScrollPanels; } catch {}

  /*
  Release summary (UI/data):

  Render zapisuje pouze do ověřeného #feed přes safeTarget.

  Routing je řízen jen item.contentType ("article"/"video").

  Veškerý stav je ve state.* (bez globálních proměnných).

  Produkce je tichá: diagnostika běží jen při ?debug=1.

  Chyby se propisují přes persistLastError + #lastErrInline, bez potřeby debug režimu.
  */
  function qsSafe(selector) {
    try {
      const el = document.querySelector(selector);
      if (!el) {
        debugWarn("[DOM] missing", selector);
      }
      return el;
    } catch (err) {
      debugWarn("[DOM] missing", selector, err);
      return null;
    }
  }

  const elStatus = $("#dataStatus");
  const elDebugPanel = $("#debugPanel");
  const elDebugOut = $("#debugOut");
  const elDataCount = $("#dataCount");
  const btnToggleDebug = $("#toggleDebugBtn");
  const elNewsList = document.getElementById("newsList");
  const elFeed = document.getElementById("feed");
  const emptyBox = document.getElementById("emptyBox");
  const sectionLabel = document.getElementById("sectionLabel");
  const sectionsBar = document.getElementById("sectionsBar");
  // hotfix topbar search toggle: canonical search form/input binding (no feed pipeline change)
  const searchFormEl =
    document.getElementById("searchForm") ||
    document.getElementById("iuTopbarSearchForm");
  const searchInputEl =
    document.getElementById("searchInput") ||
    document.getElementById("iuTopbarSearchInput");
  const searchModal = document.getElementById("searchModal");
  const modalGoogle = document.getElementById("modalGoogle");
  const modalCancel = document.getElementById("modalCancel");

  const SECTION_KEYS = ["vse", "aktualne", "doprava", "pocasi", "sport", "finance", "krimi", "zdravi", "video"];
  let activeSections = ["vse"];
  const state = {
    cachedItems: [],
    filteredItems: [],
    hasLoadedData: false,
    loadRequestId: 0,
    stats: { articlesCount: 0, videosCount: 0 },
    lastArticlesGeneratedAt: null,
    lastVideosGeneratedAt: null,
    lastArticlesKeys: null,
    lastVideosKeys: null,
    lastArticlesUpdatedAt: null,
    lastVideosUpdatedAt: null,
    lastProbe: null,
    isLoadingData: false,
    consecutiveLoadFailures: 0,
    activeTopic: null,
    activeSection: null,
    activeFilter: null,
    searchQuery: "",
    sections: new Set(activeSections),
    // FEED pagination (render-only; no pipeline touch)
    pageSize: 200,
    page: 1,
    // DATA retention (optional sharded history under /projects/data/articles/)
    retentionDays: [],
    retentionCursor: 0,
    retentionLoadedDays: new Set(),
    retentionIsLoading: false,
  };
  state.cachedItems ??= [];
  state.filteredItems ??= [];
  const ALLOWED_CONTENT_TYPES = new Set(["article", "video"]);
  const isDebugLogging = !iuIsProdHost() && location.search.includes("debug=1");

  // ============================================================
  // DEBUG (forensic) — VIDEO PIPELINE COUNTERS (?debug=1 only)
  // ============================================================
  function iuDbg(){
    try { return /[?&]debug=1\b/.test(location.search); } catch { return false; }
  }
  function iuDbgInc(map, key){
    try { map[key] = (map[key] || 0) + 1; } catch {}
  }
  const IU_VIDEO_DBG = { counts:{}, drops:{}, posters:{}, samples:[], posterSamples:[] };
  try { if (iuDbg()) window.IU_VIDEO_DBG = IU_VIDEO_DBG; } catch {}
  function iuDbgVideoSample(v, reason, idOverride){
    if (!iuDbg()) return;
    try{
      iuDbgInc(IU_VIDEO_DBG.drops, String(reason || "unknown"));
      if (!Array.isArray(IU_VIDEO_DBG.samples)) IU_VIDEO_DBG.samples = [];
      if (IU_VIDEO_DBG.samples.length >= 30) return;
      const id = String(idOverride || v?.videoId || v?.id || "").trim();
      IU_VIDEO_DBG.samples.push({
        id: id || null,
        reason: String(reason || "unknown"),
        title: String(v?.title || v?.name || "").slice(0, 140) || null,
        lang: String(v?.lang || v?.langClass || "").trim() || null,
        channel: String(v?.channel || v?.sourceTitle || v?.channelTitle || "").trim() || null,
      });
    }catch{}
  }

  function iuDbgPosterInc(reason, url){
    if (!iuDbg()) return;
    try{
      iuDbgInc(IU_VIDEO_DBG.posters, String(reason || "poster_unknown"));
      if (!Array.isArray(IU_VIDEO_DBG.posterSamples)) IU_VIDEO_DBG.posterSamples = [];
      if (IU_VIDEO_DBG.posterSamples.length >= 20) return;
      IU_VIDEO_DBG.posterSamples.push({ reason: String(reason || "poster_unknown"), url: String(url || "") });
    }catch{}
  }

  async function iuDbgCheckPoster(url){
    const u = String(url || "").trim();
    if (!u) return { ok: false, status: 0, reason: "poster_missing" };
    try{
      const r = await timeoutFetch(u, { method: "HEAD", cache: "no-store" }, 4500);
      if (r && r.ok) return { ok: true, status: r.status, reason: "poster_ok_head" };
      return { ok: false, status: r ? r.status : 0, reason: "poster_head_not_ok" };
    }catch(e){
      try{
        const r2 = await timeoutFetch(u, { cache: "no-store" }, 4500);
        if (r2 && r2.ok) return { ok: true, status: r2.status, reason: "poster_ok_get" };
        return { ok: false, status: r2 ? r2.status : 0, reason: "poster_get_not_ok" };
      }catch(e2){
        // Fallback without CORS: <img> onload/onerror.
        try{
          const ok = await new Promise((resolve) => {
            const img = new Image();
            let done = 0;
            const finish = (val) => { if (done) return; done = 1; resolve(Boolean(val)); };
            const t = setTimeout(() => finish(false), 5000);
            img.onload = () => { clearTimeout(t); finish(true); };
            img.onerror = () => { clearTimeout(t); finish(false); };
            img.referrerPolicy = "no-referrer";
            img.src = u;
          });
          return { ok, status: 0, reason: ok ? "poster_ok_img" : "poster_img_error" };
        }catch{
          return { ok: false, status: 0, reason: "poster_network" };
        }
      }
    }
  }

  function iuDbgPosterUrlFromVideo(v){
    try{
      const t = String(v?.thumb || "").trim();
      if (t) return t;
      const id = String(v?.videoId || "").trim();
      if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      return "";
    }catch{
      return "";
    }
  }

  function iuDbgRunPosterAudit(videoItems){
    if (!iuDbg()) return;
    try{
      if (window.__iu_videoPosterAuditDone) return;
      window.__iu_videoPosterAuditDone = 1;
    }catch{}
    const list = Array.isArray(videoItems) ? videoItems.slice(0, 30) : [];
    (async () => {
      try{
        IU_VIDEO_DBG.counts.posterAuditPlanned = list.length;
      }catch{}
      for (const v of list) {
        const url = iuDbgPosterUrlFromVideo(v);
        const res = await iuDbgCheckPoster(url);
        iuDbgPosterInc(res.reason, url);
      }
    })();
  }

  function iuDbgPrettyJson(obj){
    try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
  }

  function iuDbgSelectPre(preEl){
    try{
      if (!preEl) return;
      const sel = window.getSelection ? window.getSelection() : null;
      if (!sel || !document.createRange) return;
      const range = document.createRange();
      range.selectNodeContents(preEl);
      sel.removeAllRanges();
      sel.addRange(range);
    }catch{}
  }

  function iuDbgEnsureVideoDumpPanel(){
    if (!iuDbg()) return null;
    try{
      const existing = document.getElementById("iuVideoDbgDump");
      if (existing) return existing;

      const wrap = document.createElement("div");
      wrap.id = "iuVideoDbgDump";
      wrap.style.cssText = [
        "position:fixed",
        "right:12px",
        "bottom:12px",
        "z-index:2147483647",
        "max-width:min(560px, calc(100vw - 24px))",
        "width:560px",
        "font:12px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
        "background:rgba(6,10,18,0.92)",
        "color:#e8eefc",
        "border:1px solid rgba(255,255,255,0.14)",
        "border-radius:10px",
        "box-shadow:0 10px 30px rgba(0,0,0,0.35)",
      ].join(";");

      const head = document.createElement("div");
      head.style.cssText = [
        "display:flex",
        "gap:8px",
        "align-items:center",
        "justify-content:space-between",
        "padding:10px 10px 8px 10px",
        "border-bottom:1px solid rgba(255,255,255,0.10)",
      ].join(";");

      const title = document.createElement("div");
      title.textContent = "DEBUG ?debug=1 — IU_VIDEO_DBG";
      title.style.cssText = "font-weight:700;letter-spacing:0.2px;opacity:0.95;";

      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;";

      function mkBtn(label){
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.style.cssText = [
          "cursor:pointer",
          "border:1px solid rgba(255,255,255,0.18)",
          "background:rgba(255,255,255,0.06)",
          "color:inherit",
          "padding:4px 8px",
          "border-radius:8px",
          "font:inherit",
        ].join(";");
        b.onmouseenter = () => { b.style.background = "rgba(255,255,255,0.10)"; };
        b.onmouseleave = () => { b.style.background = "rgba(255,255,255,0.06)"; };
        return b;
      }

      const btnSelectSummary = mkBtn("Select summary");
      const btnSelectFull = mkBtn("Select full");
      const btnHide = mkBtn("Hide");

      btnRow.appendChild(btnSelectSummary);
      btnRow.appendChild(btnSelectFull);
      btnRow.appendChild(btnHide);

      head.appendChild(title);
      head.appendChild(btnRow);

      const body = document.createElement("div");
      body.style.cssText = "padding:10px;max-height:40vh;overflow:auto;";

      const secSummaryLabel = document.createElement("div");
      secSummaryLabel.textContent = "SUMMARY";
      secSummaryLabel.style.cssText = "font-weight:800;margin:0 0 6px 0;opacity:0.9;";

      const preSummary = document.createElement("pre");
      preSummary.id = "iuVideoDbgDumpSummary";
      preSummary.style.cssText = [
        "white-space:pre",
        "margin:0 0 10px 0",
        "padding:8px",
        "background:rgba(255,255,255,0.06)",
        "border:1px solid rgba(255,255,255,0.12)",
        "border-radius:10px",
        "overflow:auto",
      ].join(";");
      preSummary.textContent = "{\n  \"pending\": true\n}";
      preSummary.addEventListener("click", () => iuDbgSelectPre(preSummary));

      const secFullLabel = document.createElement("div");
      secFullLabel.textContent = "FULL IU_VIDEO_DBG";
      secFullLabel.style.cssText = "font-weight:800;margin:0 0 6px 0;opacity:0.9;";

      const preFull = document.createElement("pre");
      preFull.id = "iuVideoDbgDumpFull";
      preFull.style.cssText = [
        "white-space:pre",
        "margin:0",
        "padding:8px",
        "background:rgba(255,255,255,0.04)",
        "border:1px solid rgba(255,255,255,0.12)",
        "border-radius:10px",
        "overflow:auto",
      ].join(";");
      preFull.textContent = "{\n  \"pending\": true\n}";
      preFull.addEventListener("click", () => iuDbgSelectPre(preFull));

      body.appendChild(secSummaryLabel);
      body.appendChild(preSummary);
      body.appendChild(secFullLabel);
      body.appendChild(preFull);

      wrap.appendChild(head);
      wrap.appendChild(body);

      btnSelectSummary.addEventListener("click", () => iuDbgSelectPre(preSummary));
      btnSelectFull.addEventListener("click", () => iuDbgSelectPre(preFull));
      btnHide.addEventListener("click", () => { try { wrap.style.display = "none"; } catch {} });

      document.body.appendChild(wrap);
      return wrap;
    }catch{
      return null;
    }
  }

  function iuDbgUpdateVideoDumpPanel(){
    if (!iuDbg()) return;
    try{
      const panel = iuDbgEnsureVideoDumpPanel();
      if (!panel) return;
      // If user hid it, don't force-show; just update if visible.
      if (String(panel.style.display || "") === "none") return;

      const summary = {
        loaded_count: IU_VIDEO_DBG?.counts?.loaded_count ?? null,
        normalized_count: IU_VIDEO_DBG?.counts?.normalized_count ?? null,
        slotCount: IU_VIDEO_DBG?.counts?.slotCount ?? null,
        injectedVideosCount: IU_VIDEO_DBG?.counts?.injectedVideosCount ?? null,
        domVideoCardsTotal: IU_VIDEO_DBG?.counts?.domVideoCardsTotal ?? null,
        domVideoCardsSlots: IU_VIDEO_DBG?.counts?.domVideoCardsSlots ?? null,
        visibleItems: IU_VIDEO_DBG?.counts?.visibleItems ?? null,
        totalItems: IU_VIDEO_DBG?.counts?.totalItems ?? null,
        hasVideoSection: IU_VIDEO_DBG?.counts?.ui?.hasVideoSection ?? null,
        drops: IU_VIDEO_DBG?.drops ?? null,
        posters: IU_VIDEO_DBG?.posters ?? null,
        posterSamples: Array.isArray(IU_VIDEO_DBG?.posterSamples) ? IU_VIDEO_DBG.posterSamples.slice(0,10) : null,
        samples: Array.isArray(IU_VIDEO_DBG?.samples) ? IU_VIDEO_DBG.samples.slice(0,10) : null,
      };

      const preSummary = document.getElementById("iuVideoDbgDumpSummary");
      const preFull = document.getElementById("iuVideoDbgDumpFull");
      if (preSummary) preSummary.textContent = iuDbgPrettyJson(summary);
      if (preFull) preFull.textContent = iuDbgPrettyJson(IU_VIDEO_DBG);
    }catch{}
  }

  // Feature flags
  const IU_ENABLE_NAMEDAY = true; // P0: topbar "Kdo má dnes svátek"
  // FEED VIDEO EVERY 8 (YouTube preview card, lazy embed)
  const IU_FEED_VIDEO_ENABLED = true;
  const IU_FEED_VIDEO_EVERY = 8;
  const IU_FEED_VIDEO_MAX_PER_PAGE = 25;
  const IU_VIDEO_PICK_WINDOW = 240;
  const IU_VIDEO_QUEUE_PREFIX = "iu_video_queue_v1:";
  const IU_VIDEO_SEEN_KEY_V1 = "iu_video_seen_v1";
  const AGE_STEPS_H = [48, 72, 96, 168, 336]; // progressive fill (max 14 dní)

  function debugLog(...args) {
    if (!isDebugLogging) return;
    // Output only to iuDebugBox (debugBoxSet), not console
  }
  function debugWarn(...args) {
    if (!isDebugLogging) return;
    // Output only to iuDebugBox, not console
  }
  const DEBUG =
    !iuIsProdHost() &&
    (location.search.includes("debug=1") || localStorage.getItem("iu_debug") === "1");
  if (!iuIsProdHost() && location.search.includes("debug=1")) {
    localStorage.setItem("iu_debug", "1");
  }
  const diagScriptSrc =
    document.querySelector('script[src*="app.js"]')?.getAttribute("src") || "";
  const diagMeta = {
    articlesUrl: "",
    videosUrl: "",
    articlesStatus: "?",
    videosStatus: "?",
  };
  let diagBarEl = null;
  let diagStartInfo = null;

  function ensureDiagBar() {
    if (!DEBUG) return null;
    if (diagBarEl) return diagBarEl;
    diagBarEl = document.createElement("div");
    diagBarEl.id = "iuDiagBar";
    diagBarEl.style.cssText =
      "font-size:12px;padding:6px;background:#f5f5ff;border-bottom:1px solid rgba(0,0,0,0.1);font-family:inherit;display:flex;gap:10px;align-items:center;";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "copy";
    copyBtn.style.cssText =
      "font-size:12px;padding:2px 8px;background:#1f3557;color:white;border:none;border-radius:2px;cursor:pointer;";
    copyBtn.addEventListener("click", () => {
      const text = diagBarEl.textContent || "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {
          const range = document.createRange();
          range.selectNodeContents(diagBarEl);
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(range);
        });
      } else {
        const range = document.createRange();
        range.selectNodeContents(diagBarEl);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.execCommand("copy");
      }
    });
    diagBarEl.appendChild(copyBtn);
    document.body.prepend(diagBarEl);
    return diagBarEl;
  }

  function updateDiagBar(text) {
    const bar = ensureDiagBar();
    if (!bar) return;
    const copyBtn = bar.querySelector("button");
    if (copyBtn) {
      bar.textContent = text;
      bar.appendChild(copyBtn);
    } else {
      bar.textContent = text;
    }
  }

  function ensureDebugBox() {
    try {
      if (iuIsProdHost()) return null;
      const params = new URLSearchParams(location.search || "");
      if (params.get("debug") !== "1") return null;
      let box = document.getElementById("iuDebugBox");
      if (box) return box;
      box = document.createElement("div");
      box.id = "iuDebugBox";
      box.style.cssText = [
        "position:fixed",
        "left:12px",
        "bottom:12px",
        "z-index:99999",
        "max-width:420px",
        "background:rgba(0,0,0,0.85)",
        "color:#fff",
        "padding:10px 12px",
        "border-radius:10px",
        "font:12px/1.35 system-ui, -apple-system, Segoe UI, Roboto, Arial",
        "box-shadow:0 8px 22px rgba(0,0,0,0.35)",
        "white-space:pre-wrap",
      ].join(";");
      box.textContent = "iu debug: init…";
      document.body.appendChild(box);
      return box;
    } catch (err) {
      return null;
    }
  }

  function iuCopyTextToClipboard(text) {
    try {
      const s = String(text ?? "");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(s).catch(() => {
          try {
            const ta = document.createElement("textarea");
            ta.value = s;
            ta.setAttribute("readonly", "readonly");
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            ta.style.top = "-9999px";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
          } catch (_) {}
        });
      }
      const ta = document.createElement("textarea");
      ta.value = s;
      ta.setAttribute("readonly", "readonly");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return Promise.resolve();
    } catch (_) {
      try {
        const ta = document.createElement("textarea");
        ta.value = String(text ?? "");
        ta.setAttribute("readonly", "readonly");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch (_) {}
      return Promise.resolve();
    }
  }

  function ensureDebugBoxUi(box) {
    try {
      if (!box) return null;
      const hasUi = box.querySelector("[data-iu-debug-actions]") && box.querySelector("[data-iu-debug-text]");
      if (!hasUi) {
        const existingText = String(box.textContent || "");
        box.textContent = "";

        const actions = document.createElement("div");
        actions.setAttribute("data-iu-debug-actions", "1");
        actions.style.cssText = [
          "display:flex",
          "gap:8px",
          "align-items:center",
          "margin-bottom:8px",
          "flex-wrap:wrap",
        ].join(";");

        const btnDump = document.createElement("button");
        btnDump.type = "button";
        btnDump.textContent = "Copy CLS dump";
        btnDump.style.cssText = [
          "font-size:12px",
          "padding:4px 8px",
          "background:#1f3557",
          "color:#fff",
          "border:none",
          "border-radius:6px",
          "cursor:pointer",
        ].join(";");
        btnDump.addEventListener("click", () => {
          try {
            const payload =
              typeof window.__iuDumpCLS === "function"
                ? window.__iuDumpCLS()
                : {
                    realTotal: window.__iuCLSRealTotal || 0,
                    log: window.__iuCLSLog || [],
                  };
            const json = JSON.stringify(payload, null, 2);
            iuCopyTextToClipboard(json);
          } catch (_) {}
        });

        const btnLines = document.createElement("button");
        btnLines.type = "button";
        btnLines.textContent = "Copy last [IU] lines";
        btnLines.style.cssText = btnDump.style.cssText;
        btnLines.addEventListener("click", () => {
          try {
            const full = Array.isArray(window.__iuCLSLog) ? window.__iuCLSLog : [];
            const tail = full.slice(Math.max(0, full.length - 50));
            const realTotal =
              typeof window.__iuCLSRealTotal === "number"
                ? window.__iuCLSRealTotal
                : window.__iuCLSRealTotal || 0;
            const header = [
              `[IU] href=${String(location.href || "")}`,
              `[IU] __iuCLSRealTotal=${String(realTotal)}`,
              `[IU] __iuCLSLog.len=${String(full.length)}`,
            ].join("\n");
            const lines = tail.map((r) => {
              try {
                const t = r && r.t ? String(r.t) : "";
                const v = typeof r?.value === "number" ? r.value : 0;
                const recent = r?.hadRecentInput ? "1" : "0";
                const debugOnly = r?.debugOnly ? "1" : "0";
                const sc = typeof r?.sourceCount === "number" ? r.sourceCount : (Array.isArray(r?.sources) ? r.sources.length : 0);
                const nodes = (Array.isArray(r?.sources) ? r.sources : [])
                  .map((s) => (s && s.node ? String(s.node) : ""))
                  .filter(Boolean)
                  .slice(0, 2)
                  .join(", ");
                return `[IU][CLS] t=${t} shift=${v.toFixed(4)} recentInput=${recent} debugOnly=${debugOnly} sources=${sc} nodes=${nodes || "(none)"}`;
              } catch (_) {
                return "[IU][CLS] (unparseable entry)";
              }
            });
            iuCopyTextToClipboard([header, ...lines].join("\n"));
          } catch (_) {}
        });

        const btnReal = document.createElement("button");
        btnReal.type = "button";
        btnReal.textContent = "Copy REAL CLS (top10)";
        btnReal.style.cssText = btnDump.style.cssText;
        btnReal.addEventListener("click", () => {
          try {
            const dump = typeof window.__iuDumpCLS === "function" ? window.__iuDumpCLS() : null;
            const payload = dump
              ? {
                  ts: dump.ts,
                  href: dump.href,
                  realTotal: dump.realTotal,
                  realTopShifts: dump.realTopShifts || [],
                }
              : {
                  realTotal: window.__iuCLSRealTotal || 0,
                  realTopShifts: [],
                };
            iuCopyTextToClipboard(JSON.stringify(payload, null, 2));
          } catch (_) {}
        });

        actions.appendChild(btnDump);
        actions.appendChild(btnLines);
        actions.appendChild(btnReal);

        const pre = document.createElement("pre");
        pre.setAttribute("data-iu-debug-text", "1");
        pre.style.cssText = [
          "margin:0",
          "white-space:pre-wrap",
          "max-height:260px",
          "overflow:auto",
        ].join(";");
        pre.textContent = existingText || "";

        box.appendChild(actions);
        box.appendChild(pre);
      }
      return box.querySelector("[data-iu-debug-text]");
    } catch (_) {
      return null;
    }
  }

  function debugBoxSet(msg) {
    const box = ensureDebugBox();
    if (!box) return;
    const textEl = ensureDebugBoxUi(box);
    if (textEl) textEl.textContent = String(msg ?? "");
    else box.textContent = String(msg ?? "");
  }

  function appendDebugLine(msg) {
    if (!isDebugLogging) return;
    const box = ensureDebugBox();
    if (!box) return;
    const textEl = ensureDebugBoxUi(box);
    if (textEl) textEl.textContent += `\n${String(msg ?? "")}`;
    else box.textContent += `\n${String(msg ?? "")}`;
  }

  // ===== CLS / Layout Shift Debug (debug=1 only) =====
  function installCLSObserver() {
    try {
      const iuIsDebug = !!isDebugLogging;
      if (!iuIsDebug) return;
      if (window.__iuCLSObserverInstalled) return;
      if (window.__iuCLSObserverInstalling) return;

      if (typeof PerformanceObserver === "undefined") {
        debugWarn("[CLS] PerformanceObserver not available");
        return;
      }

      window.__iuCLSObserverInstalling = true;

      const MAX = 10;
      window.__iuCLSLog = Array.isArray(window.__iuCLSLog) ? window.__iuCLSLog : [];

      function rectToObj(r) {
        if (!r) return null;
        return {
          x: Math.round(r.x || 0),
          y: Math.round(r.y || 0),
          width: Math.round(r.width || 0),
          height: Math.round(r.height || 0),
          top: Math.round(r.top || 0),
          left: Math.round(r.left || 0),
          bottom: Math.round(r.bottom || 0),
          right: Math.round(r.right || 0),
        };
      }

      function nodeLabel(node) {
        try {
          if (!node) return "(null)";
          if (!(node instanceof Element)) return "(non-element)";
          const tag = (node.tagName || "").toLowerCase() || "(tag)";
          const id = node.id ? `#${node.id}` : "";
          const cls =
            node.classList && node.classList.length
              ? `.${Array.from(node.classList).slice(0, 4).join(".")}`
              : "";

          // best-effort data-* hints (keep short)
          const attrs = [];
          if (node.attributes) {
            for (let i = 0; i < node.attributes.length; i++) {
              const a = node.attributes[i];
              if (!a || !a.name) continue;
              if (a.name.indexOf("data-") !== 0) continue;
              attrs.push(
                `${a.name}=${JSON.stringify(String(a.value || "").slice(0, 40))}`
              );
              if (attrs.length >= 3) break;
            }
          }
          const data = attrs.length ? ` [${attrs.join(" ")}]` : "";
          return `${tag}${id}${cls}${data}`;
        } catch (_) {
          return "(err)";
        }
      }

      function pushLog(entry) {
        window.__iuCLSLog.push(entry);
        if (window.__iuCLSLog.length > MAX) {
          window.__iuCLSLog.splice(0, window.__iuCLSLog.length - MAX);
        }
      }

      function isDebugOverlayNode(node) {
        try {
          if (!node) return false;
          if (!(node instanceof Element)) return false;
          return node.id === "iuDebugBox" || node.id === "iuLayoutShiftBox" || node.id === "iuVideoDebugPanel";
        } catch (_) {
          return false;
        }
      }

      // Debug-only: keep layout-shift attribution evidence for post-mortem.
      window.__iuCLSShiftEntries = Array.isArray(window.__iuCLSShiftEntries)
        ? window.__iuCLSShiftEntries
        : [];
      window.__iuCLSShiftEntriesTotal =
        typeof window.__iuCLSShiftEntriesTotal === "number"
          ? window.__iuCLSShiftEntriesTotal
          : 0;
      const MAX_SHIFT_ENTRIES = 200;

      function round1(n) {
        const x = typeof n === "number" ? n : 0;
        return Math.round(x * 10) / 10;
      }

      function rectToObj1(r) {
        if (!r) return null;
        return {
          x: round1(r.x || 0),
          y: round1(r.y || 0),
          width: round1(r.width || 0),
          height: round1(r.height || 0),
          top: round1(r.top || 0),
          left: round1(r.left || 0),
          bottom: round1(r.bottom || 0),
          right: round1(r.right || 0),
        };
      }

      function safeCssIdent(s) {
        return String(s || "")
          .replace(/[^a-zA-Z0-9_-]/g, "")
          .slice(0, 64);
      }

      function selectorForNode(node) {
        try {
          if (!node) return "__unresolved__";
          if (!(node instanceof Element)) return "__unresolved__";
          if (node.id) return `#${safeCssIdent(node.id)}`;

          const parts = [];
          let el = node;
          let depth = 0;
          while (el && el instanceof Element && depth < 6) {
            const tag = (el.tagName || "").toLowerCase() || "div";
            if (el.id) {
              parts.unshift(`#${safeCssIdent(el.id)}`);
              break;
            }
            const classes =
              el.classList && el.classList.length
                ? Array.from(el.classList)
                    .map((c) => safeCssIdent(c))
                    .filter(Boolean)
                    .slice(0, 3)
                : [];
            let part = tag;
            if (classes.length) part += `.${classes.join(".")}`;

            let nth = 1;
            try {
              const parent = el.parentElement;
              if (parent) {
                const sibs = Array.from(parent.children || []).filter(
                  (c) =>
                    c &&
                    c.tagName &&
                    String(c.tagName).toLowerCase() === tag
                );
                if (sibs.length > 1) {
                  nth = sibs.indexOf(el) + 1;
                } else {
                  nth = 0;
                }
              }
            } catch (_) {
              nth = 0;
            }
            if (nth > 0) part += `:nth-of-type(${nth})`;

            parts.unshift(part);
            if (tag === "body" || tag === "html") break;
            el = el.parentElement;
            depth++;
          }

          return parts.join(" > ") || "__unresolved__";
        } catch (_) {
          return "__unresolved__";
        }
      }

      // Debug-only: aggregate "real" CLS total (excluding debug overlays and recent input)
      let realTotal = 0;
      let lastRealLogAt = 0;
      let lastRealTotalLogged = -1;
      let lastRealValue = 0;
      let lastRealSources = [];

      const observer = new PerformanceObserver((list) => {
        try {
          const entries = list.getEntries() || [];
          for (const e of entries) {
            const sources = Array.isArray(e.sources) ? e.sources : [];
            const debugOnly =
              sources.length > 0 &&
              sources.every((s) => isDebugOverlayNode(s && s.node));
            // Debug-only evidence: store layout shift entries + attribution sources.
            try {
              const shiftEntry = {
                t: new Date().toISOString(),
                value: typeof e.value === "number" ? e.value : 0,
                hadRecentInput: !!e.hadRecentInput,
                startTime: typeof e.startTime === "number" ? e.startTime : null,
                debugOnly,
                sources: sources.map((s) => {
                  const prev = rectToObj1(s && s.previousRect);
                  const cur = rectToObj1(s && s.currentRect);
                  const dx =
                    prev && cur && typeof prev.x === "number" && typeof cur.x === "number"
                      ? round1(cur.x - prev.x)
                      : null;
                  const dy =
                    prev && cur && typeof prev.y === "number" && typeof cur.y === "number"
                      ? round1(cur.y - prev.y)
                      : null;
                  return {
                    node: nodeLabel(s && s.node),
                    selector: selectorForNode(s && s.node),
                    previousRect: prev,
                    currentRect: cur,
                    deltaX: dx,
                    deltaY: dy,
                  };
                }),
              };
              window.__iuCLSShiftEntriesTotal =
                (typeof window.__iuCLSShiftEntriesTotal === "number"
                  ? window.__iuCLSShiftEntriesTotal
                  : 0) + 1;
              window.__iuCLSShiftEntries.push(shiftEntry);
              if (window.__iuCLSShiftEntries.length > MAX_SHIFT_ENTRIES) {
                window.__iuCLSShiftEntries.splice(
                  0,
                  window.__iuCLSShiftEntries.length - MAX_SHIFT_ENTRIES
                );
              }
            } catch (_) {}

            const rec = {
              t: new Date().toISOString(),
              value: typeof e.value === "number" ? e.value : 0,
              hadRecentInput: !!e.hadRecentInput,
              sourceCount: sources.length,
              debugOnly,
              sources: sources.map((s) => ({
                node: nodeLabel(s && s.node),
                previousRect: rectToObj(s && s.previousRect),
                currentRect: rectToObj(s && s.currentRect),
              })),
            };
            pushLog(rec);

            // Update real-only total and log occasionally when it changes.
            try {
              if (iuIsDebug) {
                const isRealShift = !rec.hadRecentInput && !rec.debugOnly;
                if (isRealShift) {
                  realTotal += rec.value || 0;
                  window.__iuCLSRealTotal = realTotal;
                  lastRealValue = rec.value || 0;
                  lastRealSources = (rec.sources || [])
                    .map((s) => s && s.node)
                    .filter(
                      (lbl) =>
                        lbl &&
                        lbl.indexOf("iuDebugBox") === -1 &&
                        lbl.indexOf("iuLayoutShiftBox") === -1 &&
                        lbl.indexOf("iuVideoDebugPanel") === -1
                    )
                    .slice(0, 2);
                }

                const now = Date.now();
                const shouldLog =
                  now - lastRealLogAt > 500 && realTotal !== lastRealTotalLogged;
                if (shouldLog) {
                  lastRealLogAt = now;
                  lastRealTotalLogged = realTotal;
                }
              }
            } catch (_) {}
          }
        } catch (_) {}
      });

      observer.observe({ type: "layout-shift", buffered: true });
      window.__iuCLSObserverInstalled = true;
      window.__iuCLSObserverInstalling = false;

      // Debug-only helper for one-shot runtime capture (no prod impact).
      try {
        if (iuIsDebug && typeof window.__iuDumpCLS !== "function") {
          window.__iuClearCLS = function () {
            try {
              window.__iuCLSShiftEntries = [];
              window.__iuCLSShiftEntriesTotal = 0;
              window.__iuCLSLog = [];
              realTotal = 0;
              lastRealLogAt = 0;
              lastRealTotalLogged = -1;
              lastRealValue = 0;
              lastRealSources = [];
              window.__iuCLSRealTotal = 0;
              return { ok: true };
            } catch (err) {
              return { ok: false, error: String((err && err.message) || err) };
            }
          };
          window.__iuDumpCLS = function () {
            try {
              const fullLog = Array.isArray(window.__iuCLSLog) ? window.__iuCLSLog : [];
              const log = fullLog.slice(Math.max(0, fullLog.length - 30));
              const fullShift = Array.isArray(window.__iuCLSShiftEntries)
                ? window.__iuCLSShiftEntries
                : [];
              const kept = fullShift.slice(Math.max(0, fullShift.length - 200));
              const topShifts = kept
                .slice()
                .sort((a, b) => (b?.value || 0) - (a?.value || 0))
                .slice(0, 20)
                .map((e) => ({
                  value: e?.value || 0,
                  startTime: e?.startTime,
                  sources: Array.isArray(e?.sources) ? e.sources : [],
                }));
              const realTopShifts = kept
                .filter((e) => e && !e.debugOnly && !e.hadRecentInput)
                .slice()
                .sort((a, b) => (b?.value || 0) - (a?.value || 0))
                .slice(0, 10)
                .map((e) => ({
                  value: e?.value || 0,
                  t: e?.t || null,
                  startTime: e?.startTime,
                  sources: Array.isArray(e?.sources) ? e.sources : [],
                }));
              const withSources = kept.filter((e) => (e?.sources || []).length > 0).length;
              const withoutSources = kept.length - withSources;

              function probeRightHeight() {
                try {
                  const el =
                    document.getElementById("iuRight") ||
                    iuGetMindMenuRoot();
                  if (!el || !el.getBoundingClientRect) return null;
                  return round1(el.getBoundingClientRect().height || 0);
                } catch (_) {
                  return null;
                }
              }

              function probeFeedCount() {
                try {
                  const feed = document.getElementById("feed");
                  const scope = feed || document;
                  const n = scope.querySelectorAll(".news-card").length;
                  return typeof n === "number" ? n : null;
                } catch (_) {
                  return null;
                }
              }

              let debugBoxTail = [];
              try {
                const el = document.getElementById("iuDebugBox");
                const txt = el && el.textContent ? String(el.textContent) : "";
                debugBoxTail = txt ? txt.split("\n").slice(-30) : [];
              } catch (_) {}
              return {
                ts: new Date().toISOString(),
                href: String(location.href || ""),
                context: {
                  url: String(location.href || ""),
                  vw: typeof innerWidth === "number" ? innerWidth : null,
                  vh: typeof innerHeight === "number" ? innerHeight : null,
                  dpr: typeof devicePixelRatio === "number" ? devicePixelRatio : null,
                },
                observerInstalled: !!window.__iuCLSObserverInstalled,
                realTotal:
                  typeof window.__iuCLSRealTotal === "number"
                    ? window.__iuCLSRealTotal
                    : window.__iuCLSRealTotal || 0,
                log,
                debugBoxTail,
                topShifts,
                realTopShifts,
                counts: {
                  entriesTotal:
                    typeof window.__iuCLSShiftEntriesTotal === "number"
                      ? window.__iuCLSShiftEntriesTotal
                      : kept.length,
                  entriesKept: kept.length,
                  withSources,
                  withoutSources,
                },
                layoutProbes: {
                  rightHeight: probeRightHeight(),
                  feedItemCount: probeFeedCount(),
                },
              };
            } catch (err) {
              return { error: String((err && err.message) || err) };
            }
          };
        }
      } catch (_) {}

      debugLog("[CLS] observer installed");
    } catch (_) {
      try {
        window.__iuCLSObserverInstalling = false;
      } catch (_) {}
    }
  }

  const lastFetchDiag = {
    articles: null,
    videos: null,
    health: null,
    probe: null,
  };

  async function fetchDiag(url, kind) {
    if (!isDebugLogging) {
      return fetchJsonNoCache(url);
    }
    try {
      const response = await fetch(url, { cache: "no-store" });
      const status = response.status;
      const ok = response.ok;
      const redirected = response.redirected;
      const finalUrl = response.url;
      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();
      const head = text.slice(0, 200).replace(/\s+/g, " ");
      const length = text.length;
      const diag = {
        kind,
        url,
        finalUrl,
        status,
        ok,
        redirected,
        contentType,
        length,
        head,
      };
      if (kind in lastFetchDiag) {
        lastFetchDiag[kind] = diag;
      }
      const infoLine = `[FETCHDIAG] kind=${kind} url=${url} status=${status} ok=${ok} redirected=${redirected} finalUrl=${finalUrl} contentType=${contentType}`;
      const headLine = `[FETCHDIAG] kind=${kind} head=${head}`;
      const lengthLine = `[FETCHDIAG] kind=${kind} length=${length}`;
      debugLog(infoLine);
      debugLog(headLine);
      appendDebugLine(infoLine);
      appendDebugLine(headLine);
      appendDebugLine(lengthLine);
      const isLikelyJson =
        contentType.includes("application/json") ||
        text.trim().startsWith("{") ||
        text.trim().startsWith("[");
      if (!isLikelyJson) {
        debugWarn(`[FETCHDIAG] kind=${kind} not JSON`, contentType, head);
        appendDebugLine(`[FETCHDIAG] kind=${kind} not JSON`);
        return null;
      }
      try {
        return JSON.parse(text);
      } catch (parseErr) {
        debugWarn(`[FETCHDIAG] kind=${kind} parse error`, parseErr);
        appendDebugLine(`[FETCHDIAG] kind=${kind} parse error ${parseErr.message || parseErr}`);
        return null;
      }
    } catch (err) {
      debugWarn(`[FETCHDIAG] kind=${kind} fetch failed`, err);
      appendDebugLine(`[FETCHDIAG] kind=${kind} fetch failed ${err.message || err}`);
      return null;
    }
  }

  function formatDiagLine(kind) {
    const diag = lastFetchDiag[kind];
    if (!diag) return `${kind}: (no diag)`;
    return `${kind}: status=${diag.status} ok=${diag.ok} ct=${diag.contentType} final=${diag.finalUrl} len=${diag.length} head="${diag.head}"`;
  }

  // === STATUS HELPERS EXTENSION (maintenance-safe) ===
  window.iuSetDataStatus = function(articlesCount, videosCount){
    const el = document.getElementById("dataStatus");
    if (!el) return;
    el.textContent = `Načteno: ${articlesCount} článků, ${videosCount} videí`;
  };

  window.iuSetDataError = function(msg){
    const el = document.getElementById("lastErrInline");
    if (!el) return;
    el.style.display = "block";
    el.textContent = msg;
  };

  function formatDiagText(itemsLen, typeCounts, feedExists, before, after, renderedCount) {
    const hrefValue = location.href;
    const aUrl = diagMeta.articlesUrl || "-";
    const vUrl = diagMeta.videosUrl || "-";
    const aSt = diagMeta.articlesStatus || "?";
    const vSt = diagMeta.videosStatus || "?";
    return `DIAG | href=${hrefValue} | js=${diagScriptSrc} | aUrl=${aUrl} aSt=${aSt} | vUrl=${vUrl} vSt=${vSt} | items=${itemsLen} | a=${typeCounts.article} v=${typeCounts.video} u=${typeCounts.unknown} | feed=${feedExists} | before=${before} after=${after} rendered=${renderedCount}`;
  }

  function diagLog(tag, info) {
    if (!DEBUG) return;
    // Diagnostic output via iuDebugBox only
  }
  // DEBUG KONTRAKT:
  // debug se aktivuje pouze location.search.includes("debug=1")
  // debug je pouze console logging
  // v UI nesmí existovat #debugPanel ani žádný debug box
  // debug nesmí blokovat render ani měnit state.*
  if (isDebugLogging && document.getElementById("debugPanel")) {
    debugWarn("[DEBUG] Unexpected #debugPanel present in DOM (should not exist).");
  }
  const BASE_ROOT = iuBasePath();
  const DATA_URL = iuDataUrl("articles.json");
  const VIDEOS_URL = iuDataUrl("videos.json");
  const SECTION_LABELS = {
    vse: "Vše",
    aktualne: "Aktuálně",
    doprava: "Doprava",
    pocasi: "Počasí",
    sport: "Sport",
    finance: "Finance",
    krimi: "Krimi",
    zdravi: "Zdraví",
    video: "Video",
  };

  function makeDataUrl(relativePath) {
    if (!relativePath) {
      return BASE_ROOT;
    }
    const sanitized = String(relativePath).replace(/\\/g, "/").replace(/^\/+/, "");
    const base = BASE_ROOT.endsWith("/") ? BASE_ROOT : `${BASE_ROOT}/`;
    return sanitized ? `${base}${sanitized}` : base;
  }

  function withCacheBust(url) {
    const candidate = String(url || "");
    if (!candidate) return "";
    if (!/(articles|videos)\.json/.test(candidate)) return candidate;
    const separator = candidate.includes("?") ? "&" : "?";
    return `${candidate}${separator}v=${Date.now()}`;
  }

  function withTs(url) {
    const u = new URL(url, location.href);
    u.searchParams.set("ts", String(Date.now()));
    return `${u.pathname}?${u.searchParams.toString()}`;
  }

  async function fetchJsonNoCache(url, opts = {}) {
    const {
      timeoutMs = 9000,
      retries = 2,
      backoffMs = 600,
      maxBackoffMs = 2500,
    } = opts;

    let lastErr = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(withTs(url), {
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
          signal: controller.signal,
        });
        clearTimeout(timer);

        const ct = res.headers.get("content-type") || "";
        debugBoxSet(`[FETCH] ${url}\nstatus=${res.status}\nct=${ct}`);

        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        try {
          return await res.json();
        } catch (err) {
          const txt = await res.text().catch(() => "");
          debugWarn("[JSON PARSE FAIL]", url, "head=", txt.slice(0, 120));
          throw err;
        }
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;

        const msg = (e && e.message) ? e.message : String(e);
        const is4xx = msg.startsWith("HTTP_4");
        const isAbort = msg.includes("AbortError");
        const is5xx = msg.startsWith("HTTP_5");
        if (is4xx || (attempt === retries && !is5xx && !isAbort)) {
          break;
        }

        if (attempt === retries) break;

        const wait = Math.min(maxBackoffMs, backoffMs * Math.pow(2, attempt));
        await new Promise((r) => setTimeout(r, wait));
      }
    }

    throw lastErr || new Error("FETCH_FAILED");
  }

  function assertFreshGeneratedAt(data, maxAgeMs = 24 * 60 * 60 * 1000) {
    if (!data || !data.generatedAt) return;
    const t = Date.parse(data.generatedAt);
    if (!Number.isFinite(t)) return;
    if (Date.now() - t > maxAgeMs) {
      // P0: never abort loadData — STALE_FEED left feed empty while JSON was valid (SW fixed).
      try {
        debugWarn("[DATA] generatedAt older than maxAge (warn only)", data.generatedAt);
      } catch (_) {}
    }
  }

  function isSuspiciousTitle(title) {
    if (!title || typeof title !== "string") return false;

    const t = title.trim();

    const deathPatterns = [
      /\bzemřel[ai]\b/i,
      /\bskonal[ai]\b/i,
      /\bumřel[ai]\b/i,
      /\btragick[ýá]\b/i,
    ];

    const oddSuffixPatterns = [
      /O'Haraov[áa]/i,
      /[A-Za-z]\bov[áa]\b/i,
    ];

    const clickbaitPatterns = [
      /\bšok\b/i,
      /\bneuvěřiteln[ěý]\b/i,
      /\btohle\b/i,
      /\bnikdo\b.*\bnečekal\b/i,
    ];

    const hit = (arr) => arr.some((re) => re.test(t));

    if (hit(deathPatterns)) return true;
    if (hit(oddSuffixPatterns) && hit(clickbaitPatterns)) return true;
    if (hit(oddSuffixPatterns)) return true;

    return false;
  }

  function parseProbeTimestamp(raw) {
    if (!raw) return null;
    const str = String(raw).trim();
    const isoMatch = str.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
    if (isoMatch) {
      const parsed = Date.parse(isoMatch[0]);
      if (Number.isFinite(parsed)) return parsed;
    }
    const fallback = Date.parse(str);
    return Number.isFinite(fallback) ? fallback : null;
  }

  function withBust(url) {
    const candidate = String(url || "");
    if (!candidate) return "";
    const separator = candidate.includes("?") ? "&" : "?";
    return `${candidate}${separator}v=${Date.now()}`;
  }

  const PREFERRED_TTL_MS = 48 * 60 * 60 * 1000;
  const PREFERRED_STORAGE_KEY = "iu.preferredUrls";

  function loadPreferredPair() {
    if (typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem(PREFERRED_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.articlesUrl !== "string" || typeof parsed.videosUrl !== "string") {
        return null;
      }
      return {
        articlesUrl: parsed.articlesUrl,
        videosUrl: parsed.videosUrl,
        preferredAt: Number(parsed.preferredAt) || 0,
      };
    } catch {
      return null;
    }
  }

  function savePreferredPair(articlesUrl, videosUrl) {
    if (!articlesUrl || !videosUrl) return false;
    if (typeof localStorage === "undefined") return false;
    try {
      localStorage.setItem(
        PREFERRED_STORAGE_KEY,
        JSON.stringify({ articlesUrl, videosUrl, preferredAt: Date.now() })
      );
      return true;
    } catch {
      return false;
    }
  }

  async function evaluatePreferredPair() {
    const entry = loadPreferredPair();
    if (!entry) {
      return { articlesUrl: null, videosUrl: null, status: "missing" };
    }
    if (!entry.preferredAt || Date.now() - entry.preferredAt > PREFERRED_TTL_MS) {
      return { articlesUrl: entry.articlesUrl, videosUrl: entry.videosUrl, status: "expired" };
    }
    const [articlesOk, videosOk] = await Promise.all([
      quickCheckUrl(entry.articlesUrl),
      quickCheckUrl(entry.videosUrl),
    ]);
    if (articlesOk && videosOk) {
      return { articlesUrl: entry.articlesUrl, videosUrl: entry.videosUrl, status: "ok" };
    }
    if (!articlesOk) {
      return { articlesUrl: entry.articlesUrl, videosUrl: entry.videosUrl, status: "articles-unreachable" };
    }
    return { articlesUrl: entry.articlesUrl, videosUrl: entry.videosUrl, status: "videos-unreachable" };
  }

  function buildCandidateListFromPair(preferredEntry, type, baseSequence) {
    const seen = new Set();
    const list = [];
    const push = (value) => {
      if (!value) return;
      if (seen.has(value)) return;
      seen.add(value);
      list.push(value);
    };
    const preferredUrl = preferredEntry?.[`${type}Url`];
    if (preferredEntry?.status === "ok" && preferredUrl) {
      push(preferredUrl);
    }
    baseSequence.forEach(push);
    if (preferredUrl && preferredEntry?.status !== "ok") {
      push(preferredUrl);
    }
    return list;
  }

  async function quickCheckUrl(url) {
    if (!url) return false;
    const testUrl = withCacheBust(url);
    try {
      const headRes = await timeoutFetch(testUrl, { method: "HEAD", cache: "no-store" }, 2800);
      if (headRes.ok) return true;
      if (headRes.status === 405) {
        const fallback = await timeoutFetch(testUrl, { cache: "no-store" }, 2800);
        return fallback.ok;
      }
      return false;
    } catch {
      return false;
    }
  }

  async function probeRootPaths() {
    const rootArticlesPath = iuDataUrl("articles.json");
    const rootVideosPath = iuDataUrl("videos.json");
    const [articlesOk, videosOk] = await Promise.all([
      quickCheckUrl(rootArticlesPath),
      quickCheckUrl(rootVideosPath),
    ]);
    return {
      ok: articlesOk && videosOk,
      articlesOk,
      videosOk,
      articlesPath: rootArticlesPath,
      videosPath: rootVideosPath,
    };
  }

  // === DATA ENDPOINT OVERRIDE (maintenance-safe) ===
  (function(){
    const ARTICLES_ENDPOINT = iuDataUrl("articles.json");
    const VIDEOS_ENDPOINT   = iuDataUrl("videos.json");
    const hasWithCacheBust = typeof window.withCacheBust === "function";

    if (typeof window.makeDataUrl === "function") {
      const _makeDataUrl = window.makeDataUrl;
      window.makeDataUrl = function(type, ...rest){
        if (type === "articles" || type === "article") {
          return hasWithCacheBust ? window.withCacheBust(ARTICLES_ENDPOINT) : ARTICLES_ENDPOINT;
        }
        if (type === "videos" || type === "video") {
          return hasWithCacheBust ? window.withCacheBust(VIDEOS_ENDPOINT) : VIDEOS_ENDPOINT;
        }
        return _makeDataUrl.call(this, type, ...rest);
      };
    }
  })();

  // === PREFLIGHT CHECK FOR DATA ENDPOINTS ===
  (async function preflightDataEndpoints(){
    const endpoints = [
      iuDataUrl("articles.json"),
      iuDataUrl("videos.json")
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, { method: "GET", credentials: "same-origin", cache: "no-store" });
        if (!res.ok && typeof window.persistLastError === "function") {
          window.persistLastError(`Preflight ${url} → ${res.status}`);
        }
      } catch {
        // Preflight: do not call persistLastError (avoids console.error); fail silently.
      }
    }
  })();

  async function tryFetchJson(url, timeoutMs = 9000) {
    const requestUrl = withBust(url);
    try {
      const res = await timeoutFetch(
        requestUrl,
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "cache-control": "no-cache",
          },
        },
        timeoutMs,
      );
      const text = await res.text();
      if (!res.ok) {
        const preview = text ? text.slice(0, 200) : "";
        return {
          ok: false,
          url: requestUrl,
          json: null,
          status: res.status,
          error: `HTTP ${res.status} ${preview ? `| ${preview}` : ""}`,
        };
      }
      try {
        const json = JSON.parse(text);
        return { ok: true, url: requestUrl, json, status: res.status, error: null };
      } catch {
        return { ok: false, url: requestUrl, json: null, status: res.status, error: "Invalid JSON" };
      }
    } catch (err) {
      return {
        ok: false,
        url: requestUrl,
        json: null,
        status: 0,
        error: `Fetch failed: ${err && err.message ? err.message : "unknown"}`,
      };
    }
  }

  async function pickFirstWorkingJson(urls, timeoutMs = 9000) {
    let lastError = "";
    for (const url of urls) {
      if (!url) continue;
      const result = await tryFetchJson(url, timeoutMs);
      if (result.ok) {
        return { url: result.url, json: result.json };
      }
      lastError = `[${result.url}] ${result.error}`;
    }
    persistLastError(`DATA fetch failed: ${lastError} | tried ${urls.join(", ")}`);
    return null;
  }

  function normalizeFeedJson(json) {
    if (Array.isArray(json)) return json;
    if (json && Array.isArray(json.articles)) return json.articles;
    if (json && Array.isArray(json.videos)) return json.videos;
    if (json && Array.isArray(json.items)) return json.items;
    return [];
  }

  // === DATA RETENTION (sharded articles history) ===
  function dayKeyFromPublished(it){
    const s = String(it?.publishedAt || it?.published || it?.date || it?.time || "").trim();
    return s.length >= 10 ? s.slice(0, 10) : "";
  }

  function canonicalizeUrlForKey(url){
    try{
      const u = new URL(String(url || ""), location.href);
      u.hash = "";
      // remove tracking params
      const drop = new Set(["fbclid","gclid","yclid","cmpid","pk_campaign","pk_source"]);
      for (const [k] of Array.from(u.searchParams.entries())){
        const lk = String(k || "").toLowerCase();
        if (lk.startsWith("utm_") || drop.has(lk)) {
          u.searchParams.delete(k);
        }
      }
      // keep pathname + sanitized query
      return u.toString();
    }catch{
      return String(url || "");
    }
  }

  function retentionKey(it){
    const url = String(it?.url || "").trim();
    if (url) return "url:" + canonicalizeUrlForKey(url);
    const src0 = Array.isArray(it?.sources) ? (it.sources[0] || null) : null;
    const su = String(src0?.url || "").trim();
    if (su) return "url:" + canonicalizeUrlForKey(su);
    const host = (() => { try { return new URL(su).hostname || ""; } catch { return ""; } })();
    const pub = String(it?.publishedAt || "").trim();
    const title = String(it?.title || "").trim();
    return "h:" + [host, pub, title].join("|");
  }

  async function initRetentionIndex(){
    if (state.retentionIsLoading) return;
    state.retentionIsLoading = true;
    try{
      // mark already-loaded days from current cache
      try{
        state.retentionLoadedDays = new Set(
          (Array.isArray(state.cachedItems) ? state.cachedItems : [])
            .filter((x) => x && String(x.contentType || "article").toLowerCase() === "article")
            .map(dayKeyFromPublished)
            .filter(Boolean)
        );
      }catch{
        state.retentionLoadedDays = new Set();
      }

      const indexUrl = iuDataUrl("articles/index.json");
      const idx = await fetchDiag(indexUrl, "articles");
      const days = Array.isArray(idx?.days) ? idx.days : [];
      const dates = days
        .map((d) => String(d?.date || "").trim())
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));

      state.retentionDays = dates;
      // advance cursor past already loaded days
      let c = 0;
      while (c < state.retentionDays.length && state.retentionLoadedDays.has(state.retentionDays[c])) c++;
      state.retentionCursor = c;
    }catch{
      state.retentionDays = [];
      state.retentionCursor = 0;
    }finally{
      state.retentionIsLoading = false;
    }
  }

  async function loadRetentionUntilVisibleCount(targetVisibleCount){
    if (!Array.isArray(state.retentionDays) || state.retentionDays.length === 0) return false;
    if (state.retentionIsLoading) return false;
    state.retentionIsLoading = true;
    try{
      const seen = new Set(
        (Array.isArray(state.cachedItems) ? state.cachedItems : [])
          .filter((x) => x && String(x.contentType || "article").toLowerCase() === "article")
          .map(retentionKey)
      );

      while (state.retentionCursor < state.retentionDays.length) {
        // Stop early if we already have enough after filtering
        const curLen = Array.isArray(state.filteredItems) ? state.filteredItems.length : 0;
        if (curLen >= targetVisibleCount) break;

        const day = state.retentionDays[state.retentionCursor++];
        if (!day) continue;
        if (state.retentionLoadedDays.has(day)) continue;
        state.retentionLoadedDays.add(day);

        const dayUrl = iuDataUrl("articles/" + day + ".json");
        const dayJson = await fetchDiag(dayUrl, "articles");
        const dayItems = normalizeFeedJson(dayJson);
        if (!Array.isArray(dayItems) || dayItems.length === 0) continue;

        for (const it of dayItems) {
          if (!it || typeof it !== "object") continue;
          // ensure contentType stays stable
          if (!it.contentType) it.contentType = "article";
          const k = retentionKey(it);
          if (seen.has(k)) continue;
          seen.add(k);
          state.cachedItems.push(it);
        }

        // keep cachedItems sorted by time desc (matches existing behavior)
        state.cachedItems = (state.cachedItems || []).map((item) => {
          const published =
            (item && String(item.publishedAt || item.published || item.date || item.createdAt || item.uploadedAt || item.time)) ||
            "";
          return { ...item, _ts: published ? Date.parse(published) || 0 : 0 };
        }).sort((a, b) => (b._ts || 0) - (a._ts || 0));

        // recompute filteredItems without resetting page and without rendering
        applyFilter({ resetPage: false, render: false });
      }

      return true;
    } finally {
      state.retentionIsLoading = false;
    }
  }

  function getBaseRoot() {
    let p = location.pathname.replace(/\\/g, "/");
    if (p.endsWith("index.html")) {
      p = p.slice(0, -10);
    }
    if (!p.endsWith("/")) {
      p += "/";
    }
    return p || "/";
  }

  function getBuildStamp() {
    const meta = document.querySelector('meta[name="iu-build"]');
    const value = meta ? (meta.getAttribute("content") || "").trim() : "";
    return value || null;
  }

  const BUILD_STAMP = getBuildStamp();
  debugLog("[BUILD]", BUILD_STAMP || "no-build-stamp");

  function freezeScroll() {
    if (freezeScroll.lock) return;
    freezeScroll.lock = { x: window.scrollX, y: window.scrollY };
    window.requestAnimationFrame(() => {
      window.scrollTo(freezeScroll.lock.x, freezeScroll.lock.y);
      window.requestAnimationFrame(() => window.scrollTo(freezeScroll.lock.x, freezeScroll.lock.y));
    });
  }
  freezeScroll.lock = null;

  function restoreScroll() {
    if (!freezeScroll.lock || restoreScroll.pending) return;
    restoreScroll.pending = true;
    const { x, y } = freezeScroll.lock;
    window.requestAnimationFrame(() => {
      window.scrollTo(x, y);
      window.requestAnimationFrame(() => {
        window.scrollTo(x, y);
        freezeScroll.lock = null;
        restoreScroll.pending = false;
      });
    });
  }
  restoreScroll.pending = false;

  function withScrollLock(fn) {
    freezeScroll();
    try {
      fn();
    } finally {
      restoreScroll();
    }
  }

  function isDebugOn() {
    return isDebugLogging;
  }

  function setDebug(on) {
    const params = new URLSearchParams(location.search);
    if (on) {
      params.set("debug", "1");
    } else {
      params.delete("debug");
    }
    const search = params.toString();
    const next = `${location.pathname}${search ? `?${search}` : ""}`;
    location.replace(next);
  }

  function renderDebugVisibility() {
    const on = isDebugOn();
    if (elDebugPanel) {
      elDebugPanel.style.display = on ? "block" : "none";
    }
    if (btnToggleDebug) {
      btnToggleDebug.textContent = on ? "Vypnout debug" : "Zapnout debug";
    }
  }

  let iuLastStatusLine = "";
  function setStatus(text) {
    if (elStatus) {
      elStatus.textContent = text;
    }
  }
  function iuWriteStatus(line) {
    iuLastStatusLine = String(line || "");
    setStatus(iuLastStatusLine);
  }
  function iuHasStatusPlaceholders(line) {
    const s = String(line || "");
    if (!s) return true;
    const placeholders = [
      "YES|NO",
      "preferred|fallback",
      "OK|NEOK",
      "…",
      "articles=…",
      "videos=…",
      "articles=<…>",
      "videos=<…>",
      "Načteno: články X, videa Y",
      "#feed children: N",
    ];
    if (placeholders.some((token) => s.includes(token))) return true;
    if (s.includes("<") || s.includes(">")) return true;
    if (/\bX\b/.test(s) || /\bY\b/.test(s) || /\bN\b/.test(s)) return true;
    return false;
  }

  function safeText(value) {
    if (value == null) return "";
    return String(value);
  }

  function safeUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value, location.origin);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.href;
      }
    } catch {
      return null;
    }
    return null;
  }

  /** P0: safe-fallback for iRozhlas links — strip tracking params to avoid 404 */
  function normalizeArticleUrl(url) {
    if (!url || typeof url !== "string") return url;
    try {
      const u = new URL(url.trim(), location.origin);
      if (u.hostname.toLowerCase().replace(/^www\./, "") !== "irozhlas.cz") return url;
      u.search = "";
      return u.href;
    } catch {
      return url;
    }
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return safeText(iso);
    return d.toLocaleString("cs-CZ");
  }

  function normalizeItems(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") {
      if (Array.isArray(data.items)) return data.items;
      if (Array.isArray(data.articles)) return data.articles;
    }
    return [];
  }

  function iuExtractYouTubeId(item) {
    // Accept either a URL string or a metadata object.
    if (typeof item === "string") {
      const s = item.trim();
      if (!s) return null;
      const patterns = [
        /(?:v=)([A-Za-z0-9_-]{11})/,
        /(?:\/embed\/)([A-Za-z0-9_-]{11})/,
        /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
        /(?:\/shorts\/)([A-Za-z0-9_-]{11})/,
        /(?:\/live\/)([A-Za-z0-9_-]{11})/,
      ];
      for (const pattern of patterns) {
        const match = s.match(pattern);
        if (match && match[1]) return match[1];
      }
      return null;
    }
    if (!item || typeof item !== "object") return null;
    const candidates = [];
    const directId = item.videoId;
    if (typeof directId === "string" && /^[A-Za-z0-9_-]{11}$/.test(directId.trim())) {
      return directId.trim();
    }
    const pushUrl = (value) => {
      if (!value) return;
      try {
        const normalized = new URL(value, location.origin).href;
        candidates.push(normalized);
      } catch {
        candidates.push(String(value));
      }
    };
    if (item.url) pushUrl(item.url);
    if (item.link) {
      if (typeof item.link === "string") pushUrl(item.link);
      else if (item.link.href) pushUrl(item.link.href);
    }
    if (item.canonicalUrl) pushUrl(item.canonicalUrl);
    if (Array.isArray(item.sources)) {
      for (const source of item.sources) {
        if (!source) continue;
        if (typeof source === "string") pushUrl(source);
        else if (source.url) pushUrl(source.url);
        else if (source.href) pushUrl(source.href);
      }
    }
    const patterns = [
      /(?:v=)([A-Za-z0-9_-]{11})/,
      /(?:\/embed\/)([A-Za-z0-9_-]{11})/,
      /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
      /(?:\/shorts\/)([A-Za-z0-9_-]{11})/,
      /(?:\/live\/)([A-Za-z0-9_-]{11})/,
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      for (const pattern of patterns) {
        const match = candidate.match(pattern);
        if (match && match[1]) return match[1];
      }
    }
    return null;
  }

  function iuBuildYouTubeThumb(id) {
    const vid = String(id || "").trim();
    if (!vid) return "";
    return `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
  }

  function iuBuildYouTubeEmbedUrl(id) {
    const vid = String(id || "").trim();
    if (!vid) return "";
    const origin = encodeURIComponent(window.location.origin);
    return `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0&playsinline=1&mute=1&controls=1&enablejsapi=1&origin=${origin}`;
  }

  function iuSafeParseDate(value) {
    try {
      if (!value) return null;
      const d = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(d.getTime())) return null;
      return d;
    } catch {
      return null;
    }
  }

  function iuGetVideoSeenMap() {
    try {
      // legacy key (migration fallback)
      const raw = localStorage.getItem("iuVideoSeen");
      if (!raw) return {};
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return {};
      return obj;
    } catch {
      return {};
    }
  }

  function iuGetVideoSeenMapV1() {
    try {
      const raw = localStorage.getItem(IU_VIDEO_SEEN_KEY_V1);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object") return obj;
      }
    } catch {}
    // migrate from legacy map
    try {
      const legacy = iuGetVideoSeenMap();
      if (legacy && typeof legacy === "object" && Object.keys(legacy).length) {
        localStorage.setItem(IU_VIDEO_SEEN_KEY_V1, JSON.stringify(legacy));
        return legacy;
      }
    } catch {}
    return {};
  }

  function iuSaveVideoSeenMap(map) {
    try {
      localStorage.setItem("iuVideoSeen", JSON.stringify(map || {}));
    } catch {}
  }

  function iuSaveVideoSeenMapV1(map) {
    try {
      localStorage.setItem(IU_VIDEO_SEEN_KEY_V1, JSON.stringify(map || {}));
    } catch {}
  }

  function iuPruneVideoSeen(map, dedupeDays) {
    try {
      const days = Number(dedupeDays) > 0 ? Number(dedupeDays) : 30;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      let changed = false;
      for (const k of Object.keys(map || {})) {
        const ts = Number(map[k] || 0);
        if (!Number.isFinite(ts) || ts <= 0 || ts < cutoff) {
          delete map[k];
          changed = true;
        }
      }
      return changed;
    } catch {
      return false;
    }
  }

  function iuQueueKey(sectionKey) {
    const key = String(sectionKey || "vse").trim() || "vse";
    return IU_VIDEO_QUEUE_PREFIX + key;
  }

  function iuReadQueue(sectionKey) {
    try {
      const raw = localStorage.getItem(iuQueueKey(sectionKey));
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return null;
      if (!Array.isArray(obj.slots)) return null;
      return obj;
    } catch {
      return null;
    }
  }

  function iuInitQueue(slotCount) {
    const n = Math.max(0, Math.min(25, Number(slotCount) || 0));
    return {
      updatedAt: Date.now(),
      slots: Array.from({ length: n }).map((_, i) => ({
        slot: i + 1,
        videoId: "",
        publishedAt: "",
        source: "",
        lang: "",
        cat: "",
      })),
    };
  }

  function iuNormalizeQueue(queue, slotCount) {
    const n = Math.max(0, Math.min(25, Number(slotCount) || 0));
    const q = queue && typeof queue === "object" ? queue : {};
    const slots = Array.isArray(q.slots) ? q.slots.slice(0, n) : [];
    while (slots.length < n) {
      slots.push({
        slot: slots.length + 1,
        videoId: "",
        publishedAt: "",
        source: "",
        lang: "",
        cat: "",
      });
    }
    // normalize slot numbers
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i] || typeof slots[i] !== "object") {
        slots[i] = {
          slot: i + 1,
          videoId: "",
          publishedAt: "",
          source: "",
          lang: "",
          cat: "",
        };
      }
      slots[i].slot = i + 1;
    }
    return { updatedAt: Number(q.updatedAt) || Date.now(), slots };
  }

  function iuWriteQueue(sectionKey, queue) {
    try {
      localStorage.setItem(iuQueueKey(sectionKey), JSON.stringify(queue || {}));
    } catch {}
  }

  function iuQueueIds(queue) {
    try {
      return (queue?.slots || [])
        .map((s) => String(s?.videoId || "").trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function iuSafeIso(value) {
    try {
      const d = iuSafeParseDate(value);
      return d ? d.toISOString() : "";
    } catch {
      return "";
    }
  }

  function iuBuildQueueSlotFromVideo(v, slotNumber) {
    const id = String(v?.videoId || "").trim();
    return {
      slot: Number(slotNumber) || 0,
      videoId: id,
      publishedAt: iuSafeIso(v?.publishedAt || ""),
      source: String(v?.sourceUrl || v?.sourceKey || v?.channel || "").trim(),
      lang: String(v?.lang || "").trim(),
      cat: String(v?.category || "").trim(),
    };
  }

  function iuUniqueQueueSlots(slots) {
    const out = [];
    const seen = new Set();
    for (const s of slots || []) {
      const id = String(s?.videoId || "").trim();
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(s);
    }
    return out;
  }

  function iuUpdateVideoQueue(sectionKey, slotCount, videoPool, cfg) {
    const iuDebug = !iuIsProdHost() && Boolean(location.search.includes("debug=1"));
    const n = Math.max(0, Math.min(25, Number(slotCount) || 0));
    if (n <= 0) return iuInitQueue(0);

    const insertEveryN = Number(cfg?.insertEveryN) > 0 ? Number(cfg.insertEveryN) : 8;
    const maxVideosPerPage = Number(cfg?.maxVideosPerPage) > 0 ? Number(cfg.maxVideosPerPage) : 25;
    const effectiveSlots = Math.min(n, maxVideosPerPage);

    const queue0 = iuNormalizeQueue(iuReadQueue(sectionKey) || iuInitQueue(effectiveSlots), effectiveSlots);
    const beforeIds = iuQueueIds(queue0);

    const pool = Array.isArray(videoPool) ? videoPool : [];
    if (!pool.length) return queue0;

    const dropped = [];
    const poolRawLen = pool.length;

    const seen = iuGetVideoSeenMapV1();
    iuPruneVideoSeen(seen, Number(cfg?.dedupeDays) || 30);

    // Determine "new arrivals": videos newer than current head (slot #1).
    const headIso = String(queue0?.slots?.[0]?.publishedAt || "").trim();
    const headDt = iuSafeParseDate(headIso);
    const headMs = headDt ? headDt.getTime() : 0;

    const queueIdSet = new Set(beforeIds);
    const cfgTitleBlock = Array.isArray(state?.videosRaw?.titleBlocklist) ? state.videosRaw.titleBlocklist : [];
    const durMinSec = Number(state?.videosRaw?.durationMinSec) || 0;
    const durMaxSec = Number(state?.videosRaw?.durationMaxSec) || 0;

    function titleBlocked(t) {
      try {
        const s = String(t || "").toLowerCase();
        for (const token of cfgTitleBlock) {
          const x = String(token || "").trim().toLowerCase();
          if (!x) continue;
          if (s.includes(x.toLowerCase())) return true;
        }
      } catch {}
      return false;
    }

    function isAllowedBase(v) {
      const id = String(v?.videoId || "").trim();
      if (!id) {
        iuDbgVideoSample(v, "missing_id");
        if (iuDebug && dropped.length < 10) dropped.push({ id: "", reason: "no_id" });
        return false;
      }
      const dt = iuSafeParseDate(v?.publishedAt || "");
      if (!dt) {
        iuDbgVideoSample(v, "bad_publishedAt", id);
        if (iuDebug && dropped.length < 10) dropped.push({ id, reason: "bad_publishedAt" });
        return false;
      }
      const title = String(v?.title || "");
      if (cfgTitleBlock.length && title && titleBlocked(title)) {
        iuDbgVideoSample(v, "title_blocklist", id);
        if (iuDebug && dropped.length < 10) dropped.push({ id, reason: "title_blocklist" });
        return false;
      }
      const dur = Number(v?.durationSec || 0) || 0;
      if (durMinSec > 0 && dur > 0 && dur < durMinSec) {
        iuDbgVideoSample(v, "duration_too_short", id);
        if (iuDebug && dropped.length < 10) dropped.push({ id, reason: "duration_too_short" });
        return false;
      }
      if (durMaxSec > 0 && dur > 0 && dur > durMaxSec) {
        iuDbgVideoSample(v, "duration_too_long", id);
        if (iuDebug && dropped.length < 10) dropped.push({ id, reason: "duration_too_long" });
        return false;
      }
      return true;
    }

    function filterByAgeHours(videos, ageH) {
      const out = [];
      const cutoff = Date.now() - Number(ageH) * 3600 * 1000;
      for (const v of videos) {
        if (!isAllowedBase(v)) continue;
        const dt = iuSafeParseDate(v?.publishedAt || "");
        const ms = dt ? dt.getTime() : 0;
        if (!ms || ms < cutoff) {
          if (iuDebug && dropped.length < 10) {
            const id = String(v?.videoId || "").trim();
            dropped.push({ id, reason: `age_gt_${ageH}h` });
          }
          iuDbgVideoSample(v, `age_gt_${ageH}h`, String(v?.videoId || "").trim());
          continue;
        }
        out.push(v);
      }
      return out;
    }

    // Progressive fill: start strict (48h) and widen until we can fill slots.
    let usedAgeH = AGE_STEPS_H[AGE_STEPS_H.length - 1];
    let candidates = [];
    for (const ageH of AGE_STEPS_H) {
      usedAgeH = ageH;
      candidates = filterByAgeHours(pool, ageH);
      if (candidates.length >= effectiveSlots + 20) break;
    }

    const poolAfterAgeLen = candidates.length;
    const poolAfterDedupeLen = candidates.filter((v) => !seen[String(v?.videoId || "").trim()]).length;

    // If queue has empty slots, allow filling from newest candidates (not only "newer than head").
    const hasEmptySlots = (queue0?.slots || []).some((s) => !s || !String(s.videoId || "").trim());
    const fillMode = hasEmptySlots || beforeIds.length < effectiveSlots;

    const newOnly = candidates.filter((v) => {
      const id = String(v?.videoId || "").trim();
      const dt = iuSafeParseDate(v?.publishedAt || "");
      const ms = dt ? dt.getTime() : 0;
      if (!id || !ms) return false;
      if (queueIdSet.has(id)) return false;
      if (fillMode) return true;
      return headMs === 0 ? true : ms > headMs;
    });

    // Build a single newest-first candidate stream and pick all slots once.
    // This avoids mixing "old tail" items that could be newer than some newly-picked head items.
    const poolById = new Map();
    for (const v of pool) {
      try {
        const id = String(v?.videoId || "").trim();
        if (id && !poolById.has(id)) poolById.set(id, v);
      } catch {}
    }

    const oldSlotsNonEmpty = (queue0.slots || []).filter((s) => s && s.videoId);
    const oldAsVideos = oldSlotsNonEmpty.map((s) => {
      const id = String(s?.videoId || "").trim();
      return (
        poolById.get(id) || {
          videoId: id,
          publishedAt: s.publishedAt,
          sourceUrl: s.source,
          lang: s.lang,
          category: s.cat,
        }
      );
    });

    const buffer = Math.max(20, effectiveSlots);
    const eligibleWindow = candidates.slice(0, effectiveSlots + buffer);

    const streamRaw = [...newOnly, ...oldAsVideos, ...eligibleWindow];
    const stream = [];
    const streamIds = new Set();
    for (const v of streamRaw) {
      const id = String(v?.videoId || "").trim();
      if (!id || streamIds.has(id)) continue;
      streamIds.add(id);
      stream.push(v);
    }

    const forceAllowIds = new Set(beforeIds);
    const pickedVideos = iuPickVideosForSlots(stream, effectiveSlots, { seen, forceAllowIds });

    // Mark seen for any video entering the queue.
    for (const v of pickedVideos) {
      try {
        const id = String(v?.videoId || "").trim();
        if (id) seen[id] = Date.now();
      } catch {}
    }

    const normalizedSlots = iuNormalizeQueue(
      { updatedAt: Date.now(), slots: pickedVideos.map((v, idx) => iuBuildQueueSlotFromVideo(v, idx + 1)) },
      effectiveSlots
    ).slots;

    const queue1 = { updatedAt: Date.now(), slots: normalizedSlots };
    iuWriteQueue(sectionKey, queue1);
    iuSaveVideoSeenMapV1(seen);

    const poolEligibleLen = stream.length;
    return queue1;
  }

  // ============================================================
  // FEED VIDEO EVERY 8 — DOM re-anchor pass (incremental renders)
  // ============================================================
  function iuIsVideoCardLoaded(card) {
    try {
      if (!card || !(card instanceof HTMLElement)) return false;
      if (card.getAttribute("data-iu-loaded") === "1") return true;
      const iframe = card.querySelector("iframe.iuVideoIframe, .iuVideoFrame iframe");
      return !!iframe;
    } catch {
      return false;
    }
  }

  function iuMarkVideoCardFrozen(card) {
    try {
      if (!card || !(card instanceof HTMLElement)) return;
      card.setAttribute("data-iu-frozen", "1");
    } catch {}
  }

  function iuEnsureVideoAnchors(sectionKey) {
    const iuDebug = !iuIsProdHost() && Boolean(location.search.includes("debug=1"));
    const container = document.getElementById("feed");
    if (!container) return;

    const isHome = Boolean(document.body && document.body.classList && document.body.classList.contains("iu-home"));
    const hasVideoSection = Array.isArray(activeSections) && activeSections.includes("video");
    const shouldInjectVideos =
      Boolean(IU_FEED_VIDEO_ENABLED) && Number(IU_FEED_VIDEO_EVERY) > 0 && !isHome && !hasVideoSection;

    // In standard feed, video cards are allowed ONLY via fixed slots (.iuVideoCard[data-slot]).
    if (!shouldInjectVideos) {
      // Clean up any leftover anchored cards if we are not in the standard feed.
      try {
        for (const el of Array.from(container.querySelectorAll(".iuVideoCard[data-slot]"))) {
          el.remove();
        }
      } catch {}
      return;
    }

    function pickArticleElements() {
      // Prefer explicit typed articles.
      const primarySel = '.news-card[data-feed-type="article"]';
      const primary = Array.from(container.querySelectorAll(primarySel));
      if (primary.length >= 20) return { selectorUsed: primarySel, articles: primary };

      // Fallback: any .news-card that looks like a real article card (has a[href], not a video card).
      const fallbackSel = ".news-card";
      const all = Array.from(container.querySelectorAll(fallbackSel));
      const filtered = all.filter((el) => {
        try {
          if (!el || !(el instanceof HTMLElement)) return false;
          if (el.classList.contains("iuVideoCard")) return false;
          const t = String(el.getAttribute("data-feed-type") || "").toLowerCase();
          if (t === "video" || t === "video-preview") return false;
          // must have at least one link (article target)
          const a = el.querySelector('a[href]');
          if (!a) return false;
          // avoid placeholders/empty boxes
          const text = String(el.textContent || "").trim();
          if (!text || text.length < 8) return false;
          return true;
        } catch {
          return false;
        }
      });
      // Prefer the larger set (helps when data-feed-type is missing).
      if (filtered.length > primary.length) {
        return { selectorUsed: `${fallbackSel} (filtered: not .iuVideoCard + has a[href])`, articles: filtered };
      }
      return { selectorUsed: primarySel, articles: primary };
    }

    const picked = pickArticleElements();
    const articleSelectorUsed = picked.selectorUsed;
    const articles = picked.articles;

    const insertEveryN = Number(IU_FEED_VIDEO_EVERY) || 8;
    const maxVideosPerPage =
      Number(state?.videosRaw?.maxVideosPerPage) || Number(IU_FEED_VIDEO_MAX_PER_PAGE) || 25;
    const slotCount = Math.min(maxVideosPerPage, Math.floor(articles.length / insertEveryN));

    // Ensure queue is updated to the current slotCount (important for incremental append).
    const videoPool = normalizeVideoList(state.videosRaw || {});
    const queue = iuUpdateVideoQueue(sectionKey || "vse", slotCount, videoPool, {
      insertEveryN,
      maxVideosPerPage,
      articleTotal: articles.length,
      dedupeDays: Number(state?.videosRaw?.dedupeDays) || 30,
      minGapSameSource: Number(state?.videosRaw?.minGapSameSource) || 5,
      maxSameLangStreak: Number(state?.videosRaw?.maxSameLangStreak) || 2,
      maxSameCategoryStreak: Number(state?.videosRaw?.maxSameCategoryStreak) || 2,
    });

    // Remove any stray non-anchored video cards in standard feed.
    try {
      for (const el of Array.from(container.querySelectorAll(".iuVideoCard:not([data-slot])"))) {
        // Never remove a loaded card: keep it stable for iOS/YT.
        if (iuIsVideoCardLoaded(el) || String(el.getAttribute("data-iu-frozen") || "") === "1") {
          iuMarkVideoCardFrozen(el);
          continue;
        }
        el.remove();
      }
    } catch {}

    function buildPlaceholderCard(slotIndex) {
      const el = document.createElement("article");
      el.className = "news-card iuVideoCard";
      el.setAttribute("data-feed-type", "video-preview");
      el.setAttribute("data-slot", String(slotIndex));
      el.setAttribute("data-iu-placeholder", "1");
      el.removeAttribute("data-ytid");
      el.innerHTML = `
        <div class="iuVideoFrame">
          <button type="button" class="iuVideoPoster" disabled aria-label="Načítám video…">
            <span class="iuVideoPlay" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="24" height="24" focusable="false" aria-hidden="true">
                <path d="M9 7.5v9l8-4.5-8-4.5z" fill="currentColor"></path>
              </svg>
            </span>
            <span class="iuVideoBadge" aria-hidden="true">Video</span>
          </button>
        </div>
        <div class="iuVideoMeta">
          <div class="iuVideoTitle">Načítám video…</div>
          <div class="iuVideoSub">
            <span class="iuVideoChannel">Video se načítá…</span>
          </div>
        </div>
      `.trim();
      return el;
    }

    // Anchor/move cards to exact 8/16/24... article positions.
    const videosExistingBefore = container.querySelectorAll(".iuVideoCard[data-slot]").length;
    let videosCreated = 0;
    let videosMoved = 0;
    const missingVideoSlots = [];
    try {
      window.__iuVideoAnchorPassRunning = true;

      for (let slotIndex = 0; slotIndex < slotCount; slotIndex++) {
        const anchorArticleIndex = (slotIndex + 1) * insertEveryN - 1; // 0-based
        const anchorEl = articles[anchorArticleIndex];
        if (!anchorEl) continue;

        const slot = queue?.slots?.[slotIndex];
        const hasSlotVideo = Boolean(slot && String(slot.videoId || "").trim());

        let card = container.querySelector(`.iuVideoCard[data-slot="${slotIndex}"]`);
        if (!card) {
          card = buildPlaceholderCard(slotIndex);
          videosCreated += 1;
        } else {
          // Never re-slot a frozen/loaded card.
          if (!iuIsVideoCardLoaded(card) && String(card.getAttribute("data-iu-frozen") || "") !== "1") {
            card.setAttribute("data-slot", String(slotIndex));
          } else {
            iuMarkVideoCardFrozen(card);
          }
        }

        // Try to fill/refresh content from queue slot (but never skip creating/moving the card).
        if (hasSlotVideo) {
          const isFrozen = iuIsVideoCardLoaded(card) || String(card.getAttribute("data-iu-frozen") || "") === "1";
          if (isFrozen) {
            iuMarkVideoCardFrozen(card);
          }
          const currentId = String(card.getAttribute("data-ytid") || "").trim();
          if (!isFrozen && currentId !== String(slot.videoId || "").trim()) {
            const vMarkup = buildYouTubeVideoPreviewCard({
              videoId: slot.videoId,
              publishedAt: slot.publishedAt,
              sourceUrl: slot.source,
              lang: slot.lang,
              category: slot.cat,
            });
            if (vMarkup) {
              const t = document.createElement("template");
              t.innerHTML = vMarkup.trim();
              const node = t.content.firstElementChild;
              if (node && node instanceof HTMLElement) {
                node.setAttribute("data-slot", String(slotIndex));
                // Keep position stable: replace card node, then re-insert after anchor.
                try { card.replaceWith(node); } catch {}
                card = node;
              }
            }
          }
          try { card.removeAttribute("data-iu-placeholder"); } catch {}
        } else {
          if (iuDebug && missingVideoSlots.length < 10) missingVideoSlots.push(slotIndex);
        }

        // DOM move/insert: immediately after the anchor article (counts as "moved"/positioned).
        try {
          // HARD rule: loaded/frozen cards must never move/reparent (iOS/YT stability).
          if (iuIsVideoCardLoaded(card) || String(card.getAttribute("data-iu-frozen") || "") === "1") {
            iuMarkVideoCardFrozen(card);
          } else {
            // Avoid no-op moves: only move when not already right after anchor.
            const alreadyPlaced =
              card.parentElement === container && card.previousElementSibling === anchorEl;
            if (!alreadyPlaced) {
              anchorEl.insertAdjacentElement("afterend", card);
              videosMoved += 1;
            }
          }
        } catch {}
      }

      // Remove extra anchored cards outside of slotCount.
      for (const el of Array.from(container.querySelectorAll(".iuVideoCard[data-slot]"))) {
        const n = Number(el.getAttribute("data-slot"));
        if (iuIsVideoCardLoaded(el) || String(el.getAttribute("data-iu-frozen") || "") === "1") {
          iuMarkVideoCardFrozen(el);
          continue;
        }
        if (!Number.isFinite(n) || n < 0 || n >= slotCount) el.remove();
      }
    } catch {} finally {
      try { window.__iuVideoAnchorPassRunning = false; } catch {}
    }

  }

  function iuInitVideoAnchorObserver() {
    if (window.__iu_videoAnchorObsInit) return;
    window.__iu_videoAnchorObsInit = true;

    const container = document.getElementById("feed");
    if (!container || !("MutationObserver" in window)) return;

    let t = 0;
    const obs = new MutationObserver((mutations) => {
      try {
        if (window.__iuVideoAnchorPassRunning) return;
      } catch {}

      // Ignore DOM mutations that happen fully inside a video card (e.g. iframe embed).
      // Prevents reruns triggered by user click embed changes.
      try {
        const muts = Array.isArray(mutations) ? mutations : [];
        if (muts.length) {
          let inVideo = 0;
          for (const m of muts) {
            try {
              const tgt = m && m.target ? m.target : null;
              const el = (tgt instanceof Element) ? tgt : (tgt && tgt.parentElement ? tgt.parentElement : null);
              if (el && el.closest && el.closest(".iuVideoCard")) inVideo += 1;
            } catch {}
          }
          if (inVideo === muts.length) return;
        }
      } catch {}

      if (t) return;
      t = window.setTimeout(() => {
        t = 0;
        const key = String(window.__iuVideoAnchorSectionKey || "");
        iuEnsureVideoAnchors(key || "vse");
      }, 50);
    });

    try {
      obs.observe(container, { childList: true, subtree: true });
      window.__iu_videoAnchorObs = obs;
    } catch {}
  }

  function iuVideoAgeDays(item) {
    try {
      const d = iuSafeParseDate(item?.publishedAt || item?.published || item?.date || "");
      if (!d) return 999999;
      return Math.floor((Date.now() - d.getTime()) / 86400000);
    } catch {
      return 999999;
    }
  }

  function iuPickVideoForSlot(videoPool, cfg) {
    try {
      const pool = Array.isArray(videoPool) ? videoPool : [];
      if (!pool.length) return null;

      const primaryDays = Number(cfg?.primaryDays) > 0 ? Number(cfg.primaryDays) : 14;
      const fallbackDays = Number(cfg?.fallbackDays) > 0 ? Number(cfg.fallbackDays) : 60;
      const targetShare = Number(cfg?.targetShare) > 0 ? Number(cfg.targetShare) : 0.7;
      const dedupeDays = Number(cfg?.dedupeDays) > 0 ? Number(cfg.dedupeDays) : 30;
      const langTargetCz = Number(cfg?.langTargetCz) > 0 ? Number(cfg.langTargetCz) : 0.5;
      const langTargetEn = Number(cfg?.langTargetEn) > 0 ? Number(cfg.langTargetEn) : 0.5;
      const minGapSameSource = Number(cfg?.minGapSameSource) > 0 ? Number(cfg.minGapSameSource) : 5;
      const maxSameLangStreak = Number(cfg?.maxSameLangStreak) > 0 ? Number(cfg.maxSameLangStreak) : 2;
      const maxSameCategoryStreak = Number(cfg?.maxSameCategoryStreak) > 0 ? Number(cfg.maxSameCategoryStreak) : 2;

      // strict newest-first: keep a stable cursor per bucket & dataset
      const datasetKey =
        String(state?.videosRaw?.generatedAt || state?.videosRaw?.generated_at || "nogenerated") +
        "|" +
        String(pool.length);

      const pickState = (window.__iuVideoPickState =
        window.__iuVideoPickState || { key: "", cursors: { primary: 0, fallback: 0, older: 0 } });
      if (pickState.key !== datasetKey) {
        pickState.key = datasetKey;
        pickState.cursors = { primary: 0, fallback: 0, older: 0 };
        try { window.__iuVideoSeq = { lastLangs: [], lastCats: [], lastSources: [] }; } catch {}
        try {
          window.__iuVideoPickStats = { total: 0, primary: 0, fallback: 0, older: 0, cz: 0, en: 0 };
        } catch {}
      }

      const seen = iuGetVideoSeenMap();
      iuPruneVideoSeen(seen, dedupeDays);

      const stats = (window.__iuVideoPickStats =
        window.__iuVideoPickStats || { total: 0, primary: 0, fallback: 0, older: 0, cz: 0, en: 0 });

      const seq = (window.__iuVideoSeq =
        window.__iuVideoSeq || { lastLangs: [], lastCats: [], lastSources: [] });

      function normLang(v) {
        const x = String(v?.lang || "").toLowerCase();
        return x === "cz" ? "cz" : "en";
      }
      function normCat(v) {
        return String(v?.category || "").trim() || "other";
      }
      function normSrc(v) {
        return String(v?.sourceUrl || v?.sourceKey || v?.channel || "").trim() || "unknown";
      }
      function wouldBreakStreak(arr, value, maxStreak) {
        const tail = arr.slice(-Math.max(0, maxStreak - 1));
        return tail.length === (maxStreak - 1) && tail.every((x) => x === value);
      }
      function hasRecentSource(src) {
        return seq.lastSources.slice(-minGapSameSource).includes(src);
      }
      function preferLang() {
        // keep close to 50/50 (targets provided)
        const cz = Number(stats.cz) || 0;
        const en = Number(stats.en) || 0;
        const total = cz + en;
        if (total <= 0) return "cz";
        const curCzShare = cz / total;
        const targetCz = langTargetCz;
        return curCzShare > targetCz ? "en" : "cz";
      }

      function commitPickToHistory(best) {
        try {
          const lang = normLang(best);
          const cat = normCat(best);
          const src = normSrc(best);
          seq.lastLangs = [...seq.lastLangs.slice(-1), lang];
          seq.lastCats = [...seq.lastCats.slice(-1), cat];
          seq.lastSources = [...seq.lastSources, src].slice(-Math.max(10, minGapSameSource));
          if (lang === "cz") stats.cz += 1;
          else stats.en += 1;
        } catch {}
      }

      function pickWithinWindow(list, bucketName, windowSize, ignoreGap) {
        const start = Number(pickState?.cursors?.[bucketName] || 0);
        const slice = list.slice(start, start + windowSize);
        if (!slice.length) return null;

        const preferred = preferLang();
        for (let i = 0; i < slice.length; i++) {
          const cand = slice[i];
          if (!cand || !cand.videoId) continue;
          const lang = normLang(cand);
          const cat = normCat(cand);
          const src = normSrc(cand);

          if (wouldBreakStreak(seq.lastLangs, lang, maxSameLangStreak)) continue;
          if (wouldBreakStreak(seq.lastCats, cat, maxSameCategoryStreak)) continue;
          if (!ignoreGap && hasRecentSource(src)) continue;

          // newest-first rule: select first passing candidate in time order,
          // with only a small preference for desired language inside the window.
          // If the first passing isn't preferred language, we still accept it (no jumping).
          // (preference handled by scanning; we do not reorder)
          const chosenIndex = i;
          const chosen = cand;
          const ageDays = iuVideoAgeDays(chosen);
          pickState.cursors[bucketName] = start + chosenIndex + 1;
          commitPickToHistory(chosen);
          return { chosen, chosenIndex, window: windowSize, ageDays };
        }
        return null;
      }

      // Pool must already be sorted newest-first from dataset.
      const unseen = pool.filter((v) => v && v.videoId && !seen[String(v.videoId)]);
      const primary = unseen.filter((v) => iuVideoAgeDays(v) <= primaryDays);
      const fallback = unseen.filter((v) => {
        const a = iuVideoAgeDays(v);
        return a > primaryDays && a <= fallbackDays;
      });
      const older = unseen.filter((v) => iuVideoAgeDays(v) > fallbackDays);

      const primaryShare = stats.total > 0 ? stats.primary / stats.total : 0;
      const wantPrimary = primaryShare < targetShare;

      function pickFromBucket(bucketName, list) {
        // Window pick (strict newest-first): only within the newest window.
        const w1 = Number(IU_VIDEO_PICK_WINDOW) > 0 ? Number(IU_VIDEO_PICK_WINDOW) : 40;
        const w2 = 80;

        // 1) window 40 (or configured), full rules
        let res = pickWithinWindow(list, bucketName, w1, false);
        if (res) return res;

        // 2) window 80, full rules
        res = pickWithinWindow(list, bucketName, w2, false);
        if (res) return res;

        // 3) window 80, ignore only minGapSameSource
        res = pickWithinWindow(list, bucketName, w2, true);
        if (res) return res;

        // 4) last resort: pick newest available (first element from cursor)
        const start = Number(pickState?.cursors?.[bucketName] || 0);
        const cand = list[start] || null;
        if (!cand || !cand.videoId) return null;
        const chosenIndex = 0;
        const chosen = cand;
        const ageDays = iuVideoAgeDays(chosen);
        pickState.cursors[bucketName] = start + 1;
        commitPickToHistory(chosen);
        return { chosen, chosenIndex, window: w2, ageDays };
      }

      let bucket = "";
      let pick = null;
      let meta = null;

      // Rule: never switch to older bucket if primary still has candidates (even beyond window).
      if (primary.length > Number(pickState?.cursors?.primary || 0)) {
        bucket = "primary";
        meta = pickFromBucket("primary", primary);
        pick = meta?.chosen || null;
      } else if (fallback.length > Number(pickState?.cursors?.fallback || 0)) {
        bucket = "fallback";
        meta = pickFromBucket("fallback", fallback);
        pick = meta?.chosen || null;
      } else if (older.length > Number(pickState?.cursors?.older || 0)) {
        bucket = "older";
        meta = pickFromBucket("older", older);
        pick = meta?.chosen || null;
      }

      // If nothing unseen, prune and retry once (spec requirement).
      if (!pick) {
        const changed = iuPruneVideoSeen(seen, dedupeDays);
        if (changed) iuSaveVideoSeenMap(seen);
        const unseen2 = pool.filter((v) => v && v.videoId && !seen[String(v.videoId)]);
        if (!unseen2.length) return null;
        const p2 = unseen2.filter((v) => iuVideoAgeDays(v) <= primaryDays);
        const f2 = unseen2.filter((v) => {
          const a = iuVideoAgeDays(v);
          return a > primaryDays && a <= fallbackDays;
        });
        const o2 = unseen2.filter((v) => iuVideoAgeDays(v) > fallbackDays);
        // Reset cursors for retry (keep strict newest-first).
        try { pickState.cursors = { primary: 0, fallback: 0, older: 0 }; } catch {}
        if (p2.length) {
          bucket = "primary";
          meta = pickFromBucket("primary", p2);
          pick = meta?.chosen || null;
        } else if (f2.length) {
          bucket = "fallback";
          meta = pickFromBucket("fallback", f2);
          pick = meta?.chosen || null;
        } else if (o2.length) {
          bucket = "older";
          meta = pickFromBucket("older", o2);
          pick = meta?.chosen || null;
        } else {
          bucket = "older";
          pick = unseen2[0] || null;
          meta = { window: Number(IU_VIDEO_PICK_WINDOW) || 40, chosenIndex: 0, ageDays: iuVideoAgeDays(pick) };
        }
      }

      if (!pick || !pick.videoId) return null;
      const id = String(pick.videoId);
      const ageDays = Number(meta?.ageDays) >= 0 ? Number(meta.ageDays) : iuVideoAgeDays(pick);

      // mark seen immediately (dedupe window)
      seen[id] = Date.now();
      iuSaveVideoSeenMap(seen);

      stats.total += 1;
      if (bucket === "primary") stats.primary += 1;
      else if (bucket === "fallback") stats.fallback += 1;
      else stats.older += 1;

      try {
        const lang = String(pick?.lang || "en");
        const cat = String(pick?.category || "");
        const src = String(pick?.sourceUrl || pick?.sourceKey || pick?.channel || "");
        const w = Number(meta?.window) || Number(IU_VIDEO_PICK_WINDOW) || 40;
      } catch {}

      return pick;
    } catch {
      return null;
    }
  }

  function normalizeVideoList(input) {
    const source =
      Array.isArray(input) ? input
      : (input && Array.isArray(input.videos) ? input.videos
      : (input && Array.isArray(input.items) ? input.items : []));

    return source
      .map((video) => {
        if (!video || typeof video !== "object") {
          iuDbgVideoSample(video, "invalid_item");
          return null;
        }
        const inferredId = iuExtractYouTubeId(video);
        if (!video.videoId && inferredId) {
          video.videoId = inferredId;
        }
        const id = video.videoId || inferredId;
        if (!id) {
          iuDbgVideoSample(video, "missing_id");
          return null;
        }
        const published = safeText(video.publishedAt || video.date || video.published || "");
        const publishedDt = iuSafeParseDate(published);
        const publishedAtTs =
          Number(video.publishedAtTs || video.published_at_ts || 0) ||
          (publishedDt ? publishedDt.getTime() : 0);
        const url = safeUrl(video.url) || safeUrl(`https://www.youtube.com/watch?v=${id}`);
        if (!url) {
          iuDbgVideoSample(video, "missing_url", id);
          return null;
        }
        const hadTitle = Boolean(video.title || video.name || video.headline);
        const title = safeText(video.title || video.name || video.headline || "Video");
        if (!hadTitle) iuDbgVideoSample(video, "missing_title", id);
        const rawLang = safeText(video.lang || "");
        if (!rawLang) iuDbgVideoSample(video, "lang_miss", id);
        const langNorm = rawLang.toLowerCase() === "cz" || rawLang.toLowerCase() === "cs" ? "cz" : "en";
        const hasCzSubtitles = Boolean(video.hasCzSubtitles || video.has_cz_subtitles || false);
        const rawLangClass = safeText(video.langClass || video.lang_class || "").toLowerCase();
        const langClass =
          rawLangClass === "cz" || rawLangClass === "en" || rawLangClass === "bilingual"
            ? rawLangClass
            : (langNorm === "cz" ? "cz" : (hasCzSubtitles ? "bilingual" : "en"));
        const region = safeText(video.region || (langNorm === "cz" ? "cz" : "world"));
        const topics = Array.isArray(video.topics) ? video.topics.map((t) => safeText(t)).filter(Boolean) : [];
        const topic0 = topics[0] || safeText(video.topic || "") || "";
        if (!topic0) iuDbgVideoSample(video, "topic_miss", id);
        return {
          ...video,
          contentType: "video",
          videoId: id,
          title,
          publishedAt: published,
          publishedAtTs,
          url,
          channel: safeText(video.channel || video.source || ""),
          sourceUrl: safeText(video.sourceUrl || video.source_url || ""),
          sourceKey: safeText(video.sourceKey || video.source_key || ""),
          sourceId: safeText(video.sourceId || video.source_id || ""),
          sourceTitle: safeText(video.sourceTitle || video.source_title || ""),
          channelId: safeText(video.channelId || video.channel_id || ""),
          lang: langNorm,
          langClass,
          hasCzSubtitles,
          region,
          topics,
          topic: topic0,
          weight: Number(video.weight || 1) || 1,
          maxPerDay: Number(video.maxPerDay || 2) || 2,
          category: safeText(video.category || ""),
          categoryWeight: Number(video.categoryWeight || 0) || 0,
          thumb: safeText(video.thumb || ""),
          durationSec: Number(video.durationSec || 0) || 0,
          section: "video",
          summary: safeText(video.summary || video.description || ""),
        };
      })
      .filter(Boolean);
  }

  function iuComputeMixTargets(N) {
    const n = Math.max(0, Number(N) || 0);
    const czTarget = Math.round(n * 0.5);
    const worldTarget = n - czTarget;
    const science_tech = Math.round(n * 0.30);
    const practical = Math.round(n * 0.20);
    const finance = Math.round(n * 0.15);
    const interviews = Math.round(n * 0.15);
    const history = Math.round(n * 0.10);
    const used = science_tech + practical + finance + interviews + history;
    const explainer = Math.max(0, n - used);
    return {
      N: n,
      region: { cz: czTarget, world: worldTarget },
      topics: { science_tech, practical, finance, interviews, history, explainer },
    };
  }

  function iuGetVideoTopic(it) {
    const t0 = String(it?.topic || (Array.isArray(it?.topics) ? it.topics[0] : "") || "").trim();
    if (t0) {
      const x = t0.toLowerCase();
      if (x === "tech_science") return "science_tech";
      if (x === "explainers") return "explainer";
      if (x === "science_tech" || x === "practical" || x === "finance" || x === "interviews" || x === "history" || x === "explainer") return x;
    }
    const cat = String(it?.category || "").trim().toLowerCase();
    const m = {
      science_tech_ai: "science_tech",
      practical_life_city_travel: "practical",
      finance_economy: "finance",
      business_startups: "finance",
      interviews_people: "interviews",
      history_culture: "history",
      transport_infra: "practical",
      health_psychology: "practical",
      law_politics_explained: "explainer",
      smart_fun_short: "explainer",
    };
    return m[cat] || "explainer";
  }

  function iuGetVideoRegion(it) {
    const r = String(it?.region || "").trim().toLowerCase();
    if (r === "cz" || r === "world") return r;
    const lang = String(it?.lang || "").trim().toLowerCase();
    return (lang === "cz" || lang === "cs") ? "cz" : "world";
  }

  function iuGetVideoSourceId(it) {
    return (
      String(it?.sourceId || "").trim() ||
      String(it?.sourceKey || "").trim() ||
      String(it?.sourceUrl || "").trim() ||
      String(it?.channelId || "").trim() ||
      String(it?.channel || "").trim() ||
      "unknown"
    );
  }

  function iuPickVideosForSlots(videoPool, slotCount, cfg) {
    const pool0 = Array.isArray(videoPool) ? videoPool : [];
    const N = Math.max(0, Math.min(25, Number(slotCount) || 0));
    if (!pool0.length || N <= 0) return [];

    const iuDebug = !iuIsProdHost() && Boolean(location.search.includes("debug=1"));
    const seen = cfg && cfg.seen ? cfg.seen : null;

    function tsOf(it) {
      const ts = Number(it?.publishedAtTs || 0) || 0;
      if (ts > 0) return ts;
      const d = iuSafeParseDate(it?.publishedAt || "");
      return d ? d.getTime() : 0;
    }

    function langClassOf(it) {
      const lc = String(it?.langClass || "").trim().toLowerCase();
      if (lc === "cz" || lc === "en" || lc === "bilingual") return lc;
      const lang = String(it?.lang || "").trim().toLowerCase();
      if (lang === "cz" || lang === "cs") return "cz";
      return Boolean(it?.hasCzSubtitles) ? "bilingual" : "en";
    }

    function expectedLang(slotIdx) {
      return (Number(slotIdx) || 0) % 2 === 0 ? "cz" : "en";
    }

    function matchesExpected(it, expected) {
      const lc = langClassOf(it);
      if (expected === "cz") return lc === "cz" || lc === "bilingual";
      return lc === "en" || lc === "bilingual";
    }

    const pool = [...pool0].sort((a, b) => tsOf(b) - tsOf(a));
    const targets = iuComputeMixTargets(N);
    const picked = [];
    const usedIds = new Set();

    const counts = {
      region: { cz: 0, world: 0 },
      topics: { science_tech: 0, practical: 0, finance: 0, interviews: 0, history: 0, explainer: 0 },
      perSource: {},
    };
    function perSourceLimit(src, maxPerDay) {
      const lim = Math.max(1, Number(maxPerDay) || 2);
      return (counts.perSource[src] || 0) >= lim;
    }

    let capTs = 0;
    let lastPickedTs = Number.POSITIVE_INFINITY;
    let slot0_not_cz_or_bilingual = 0;
    let bad_alternation = 0;
    let newer_than_first = 0;

    function scoreCandidate(cand, expected, st, lastLang) {
      let score = 0;
      try {
        const topic = iuGetVideoTopic(cand);
        const region = iuGetVideoRegion(cand);
        const lc = langClassOf(cand);

        // Prefer matching the expected language even in fallback.
        if (matchesExpected(cand, expected)) score += 2;
        else score -= 2;

        // Soft quotas: reward filling deficits; mild penalty for exceeding.
        if ((counts.region[region] || 0) < (targets.region[region] || 0)) score += 2;
        else score -= 0.5;

        if ((counts.topics[topic] || 0) < (targets.topics[topic] || 0)) score += 2;
        else score -= 0.25;

        // Slightly prefer bilingual as a universal filler when quotas are tight.
        if (lc === "bilingual") score += 0.25;

        // In strict stages, don't over-favor quota at the expense of recency.
        if (!st.relaxQuotas) score += 0.1;
      } catch {}
      return score;
    }

    for (let i = 0; i < N; i++) {
      const expected = expectedLang(i);
      const last = picked[picked.length - 1] || null;
      const lastSource = last ? iuGetVideoSourceId(last) : "";
      const lastLang = last ? langClassOf(last) : "";

      const stages = [
        { enforceExpectedLang: true, relaxQuotas: false, allowAnyLang: false, reason: "" },
        { enforceExpectedLang: true, relaxQuotas: true, allowAnyLang: false, reason: "" },
        { enforceExpectedLang: false, relaxQuotas: true, allowAnyLang: true, reason: "allow_any_lang" },
      ];

      let chosen = null;
      let chosenReason = "";
      for (const st of stages) {
        if (i === 0 && st.allowAnyLang) continue; // slot0 must be CZ or bilingual
        let bestScore = Number.NEGATIVE_INFINITY;
        let bestTs = 0;
        const pickWindow = 240;
        const scan = pool.slice(0, pickWindow);
        for (const cand of scan) {
          if (!cand) continue;
          const id = String(cand.videoId || "").trim();
          if (!id || usedIds.has(id)) continue;
          const forceAllow = Boolean(cfg && cfg.forceAllowIds && cfg.forceAllowIds.has(id));
          if (!forceAllow && seen && seen[id]) continue;

          const ts = tsOf(cand);
          if (!ts) continue;
          if (capTs && ts > capTs) continue; // never newer than first
          if (ts > lastPickedTs) continue; // monotonic newest-first (non-increasing)

          const src = iuGetVideoSourceId(cand);
          if (src && lastSource && src === lastSource) continue; // never 2 same source in a row

          const topic = iuGetVideoTopic(cand);
          const region = iuGetVideoRegion(cand);

          // maxPerDay per source (within this pick window)
          if (perSourceLimit(src, cand.maxPerDay || (cfg && cfg.maxPerDay))) continue;

          if (i === 0) {
            if (!matchesExpected(cand, "cz")) continue;
          } else if (st.enforceExpectedLang) {
            if (!matchesExpected(cand, expected)) continue;
          }

          // In allowAnyLang fallback, enforce maxLangStreak=2.
          if (st.allowAnyLang && lastLang) {
            const curLang = langClassOf(cand);
            if (curLang !== "bilingual" && lastLang !== "bilingual" && curLang === lastLang) {
              const prev = picked.slice(-1)[0];
              const prev2 = picked.slice(-2)[0];
              if (prev && prev2) {
                const l1 = langClassOf(prev);
                const l2 = langClassOf(prev2);
                if (l1 === curLang && l2 === curLang) continue;
              }
            }
          }

          const sc = scoreCandidate(cand, expected, st, lastLang);
          if (sc > bestScore || (sc === bestScore && ts > bestTs)) {
            bestScore = sc;
            bestTs = ts;
            chosen = cand;
            chosenReason = st.reason || "";
          }
        }
        if (chosen) break;
      }

      if (!chosen) break;

      const chosenTs = tsOf(chosen);
      if (i === 0) {
        capTs = chosenTs;
        lastPickedTs = chosenTs;
      } else {
        lastPickedTs = chosenTs;
      }

      const id = String(chosen.videoId || "").trim();
      usedIds.add(id);
      picked.push(chosen);

      const region = iuGetVideoRegion(chosen);
      const topic = iuGetVideoTopic(chosen);
      const src = iuGetVideoSourceId(chosen);

      counts.region[region] = (counts.region[region] || 0) + 1;
      counts.topics[topic] = (counts.topics[topic] || 0) + 1;
      counts.perSource[src] = (counts.perSource[src] || 0) + 1;

      const expectedNow = expectedLang(i);
      const isAltOk = matchesExpected(chosen, expectedNow);
      if (i === 0 && !matchesExpected(chosen, "cz")) slot0_not_cz_or_bilingual += 1;
      if (!isAltOk) {
        bad_alternation += 1;
        if (iuDebug) console.warn("[iuVideoMix] WARN fallback_slot=%d reason=%s", i, chosenReason || "bad_alternation");
      }
      if (capTs && chosenTs > capTs) newer_than_first += 1;
    }

    if (iuDebug) {
      try {
        const first10 = picked.slice(0, 10).map((x, idx) => ({
          slot: idx,
          expected: expectedLang(idx),
          pickedLangClass: langClassOf(x),
          hasCzSubtitles: Boolean(x?.hasCzSubtitles),
          region: iuGetVideoRegion(x),
          topic0: iuGetVideoTopic(x),
          sourceKey: String(x?.sourceKey || ""),
          publishedAtTs: tsOf(x),
          videoId: x?.videoId,
        }));

        // max source streak sanity (should be 1 with anti-cluster)
        let maxSourceStreak = 0;
        let cur = 0;
        let lastSrc = "";
        for (const x of picked) {
          const s = iuGetVideoSourceId(x);
          if (s && s === lastSrc) cur += 1;
          else { lastSrc = s; cur = 1; }
          if (cur > maxSourceStreak) maxSourceStreak = cur;
        }

        // monotonic sanity check (non-increasing)
        let non_monotonic = 0;
        for (let i = 1; i < picked.length; i++) {
          if (tsOf(picked[i]) > tsOf(picked[i - 1])) non_monotonic += 1;
        }
        if (non_monotonic) console.warn("[iuVideoMix] WARN non_monotonic=%d", non_monotonic);
        if (slot0_not_cz_or_bilingual) console.warn("[iuVideoMix] WARN slot0_not_cz_or_bilingual=%d", slot0_not_cz_or_bilingual);
        if (bad_alternation) console.warn("[iuVideoMix] WARN bad_alternation=%d", bad_alternation);
        if (newer_than_first) console.warn("[iuVideoMix] WARN newer_than_first=%d", newer_than_first);
      } catch {}
    }

    return picked.slice(0, N);
  }

  function buildCombinedFeed(articles, videos) {
    const normalizedArticles = Array.isArray(articles)
      ? articles.map((item) => ({
          ...item,
          contentType: String(item.contentType || "article").toLowerCase(),
        }))
      : [];

    const normalizedVideos = Array.isArray(videos) ? videos : [];

    const combined = [...normalizedArticles, ...normalizedVideos];
    combined.sort((a, b) => {
      const ta = Number(new Date(a?.publishedAt || a?.date || a?.published || 0));
      const tb = Number(new Date(b?.publishedAt || b?.date || b?.published || 0));
      if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
      if (!Number.isFinite(ta)) return 1;
      if (!Number.isFinite(tb)) return -1;
      return tb - ta;
    });

    return combined;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatDateShort(value) {
    if (!value) return "";
    let date;
    if (value instanceof Date) {
      date = value;
    } else {
      date = new Date(value);
    }
    if (Number.isNaN(date.getTime())) return "";
    const iso = date.toISOString();
    return iso.replace("T", " ").split(".")[0];
  }

  function getJsonTimestamp(json) {
    if (!json || typeof json !== "object") return "";
    const fields = ["updatedAt", "generatedAt", "buildAt"];
    for (const field of fields) {
      const value = json[field];
      const label = formatDateShort(value);
      if (label) return label;
    }
    return "";
  }

  function getSectionLabelText(keys) {
    const names = keys
      .map((key) => SECTION_LABELS[key] || key)
      .filter(Boolean);
    return names.length ? names.join(", ") : SECTION_LABELS.vse;
  }

  function updateSectionLabel() {
    if (!sectionLabel) return;
    const labelText = getSectionLabelText(activeSections);
    sectionLabel.textContent = `Sekce: ${labelText}`;
  }

  function renderSectionsBar() {
    if (!sectionsBar) return;
    sectionsBar.innerHTML = "";
    SECTION_KEYS.forEach((key) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secBtn";
      btn.dataset.section = key;
      btn.textContent = SECTION_LABELS[key] || key;
      btn.addEventListener("click", () => handleSectionClick(key));
      sectionsBar.appendChild(btn);
    });
    updateSectionButtons();
  }

  function updateSectionButtons() {
    if (!sectionsBar) return;
    sectionsBar.querySelectorAll(".secBtn").forEach((btn) => {
      const key = btn.dataset.section;
      btn.classList.toggle("isActive", activeSections.includes(key));
    });
  }

  function handleSectionClick(key) {
    if (key === "vse") {
      if (location.hash.replace(/^#/, "") === "vse") {
        setSectionsFromHash();
        applyFilter();
        return;
      }
      location.hash = "#vse";
      return;
    }

    const current = new Set(activeSections.filter((k) => k !== "vse"));
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    const next = SECTION_KEYS.filter((k) => current.has(k));
    const finalSections = next.length ? next : ["vse"];
    const hashValue = finalSections.join(",");
    if (location.hash.replace(/^#/, "") === hashValue) {
      setSectionsFromHash();
      applyFilter();
      return;
    }
    location.hash = `#${hashValue}`;
  }

  function setSectionsFromHash() {
    const hash = location.hash.replace(/^#/, "");
    const parsed = hash
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && SECTION_KEYS.includes(s));

    activeSections = parsed.length ? parsed : ["vse"];
    state.sections = new Set(activeSections);
    if (!state.sections || state.sections.size === 0) {
      state.sections = new Set(["aktualne"]);
      activeSections = ["aktualne"];
    }
    updateSectionLabel();
    updateSectionButtons();
  }

  function matchesSections(item, sections = activeSections) {
    if (!item) return false;
    const type = String(item.contentType || "article").toLowerCase();
    if (type === "ad") return true;
    const effectiveSections = sections && sections.length ? sections : ["vse"];
    if (effectiveSections.includes("vse")) return true;
    const sectionValue = ((item.section || item.topic) || "").toLowerCase();
    return effectiveSections.some((section) => section === sectionValue);
  }

  function ensureFeedTarget() {
    let feed = document.getElementById("feed");
    if (feed) return feed;

    const newsList = document.getElementById("newsList");
    if (newsList) {
      feed = document.createElement("div");
      feed.id = "feed";
      newsList.appendChild(feed);
      return feed;
    }

    return null;
  }

  function getFeedTarget() {
    return ensureFeedTarget();
  }

  function insideTarget(target, fallback) {
    return target || fallback;
  }

  const STATUS_SCROLL_KEY = "iu:scrolledToStatus";

  function scrollToStatusOnce() {
    if (!("sessionStorage" in window)) return;
    if (sessionStorage.getItem(STATUS_SCROLL_KEY)) return;
    const el = document.getElementById("dataStatusArticles");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    sessionStorage.setItem(STATUS_SCROLL_KEY, "1");
  }

  function renderEmpty(message, extraHtml = "") {
    try {
      const fr = document.getElementById("feed");
      if (fr && fr.id === "feed") fr.setAttribute("data-feed-ready", "true");
    } catch {}
    const target = getFeedTarget();
    if (target) {
      withScrollLock(() => {
        // CLS mitigation: avoid mezistav "prázdný feed" (clear a až pak další DOM).
        // Zachovat #sectionsBar jako reálný DOM node, stejně jako v renderFeed().
        const sectionsBar = document.getElementById("sectionsBar");
        if (sectionsBar) target.replaceChildren(sectionsBar);
        else target.replaceChildren();
      });
    }
    if (isDebugLogging) {
      debugLog("[RENDER EMPTY]", { message, cached: state.cachedItems.length });
    }
    if (emptyBox) {
      emptyBox.innerHTML = `<p>${escapeHtml(message)}</p>${extraHtml ? extraHtml : ""}`;
      emptyBox.style.display = "block";
    }
    if (elDataCount) elDataCount.textContent = "0";
  }

  // ============================================================
  // ALERT TITLES — only middle feed (#feed)
  // ============================================================
  function iuEscapeRegexLiteral(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function iuRegexFromPhrases(phrases) {
    const parts = (Array.isArray(phrases) ? phrases : [])
      .map((p) => String(p || "").trim())
      .filter(Boolean)
      .map((p) => iuEscapeRegexLiteral(p).replace(/\s+/g, "\\s+"));
    if (!parts.length) return /$^/i;
    return new RegExp(`(?:${parts.join("|")})`, "i");
  }

  const IU_ALERT_PHRASES = [
    // 🚨 bezpečnost / policie
    "policie varuje",
    "policie pátrá",
    "policie hleda svedky",
    "policie hledá svědky",
    "vyhlásila pátrání",
    "ozbrojený pachatel",
    "střelba",
    "bombová hrozba",
    "evakuace",
    "pachatel na útěku",
    // 🚗 doprava
    "silničáři varují",
    "dálnice uzavřena",
    "tunel uzavřen",
    "most uzavřen",
    "dopravní kolaps",
    "hromadná nehoda",
    "nehoda s oběťmi",
    "vlak vykolejil",
    "metro zastaveno",
    // 🏥 zdravotnictví
    "zdravotníci varují",
    "záchranná služba varuje",
    "epidemie",
    "nebezpečný virus",
    "kontaminace vody",
    "stažení potravin",
    "otrava",
    "nebezpečný lék",
    // 🌧 počasí
    "čhmú varuje",
    "meteorologové varují",
    "extrémní bouře",
    "povodně",
    "ledovka",
    "sněhová kalamita",
    "tornádo",
    "extrémní horko",
    "silný vítr",
    // ⚡ energie / stát
    "výpadek elektřiny",
    "blackout",
    "odstávka plynu",
    "omezení vody",
    "nouzový stav",
    "kyberútok",
    "evakuační plán",
    // 🛒 potraviny
    "nebezpečná potravina",
    "stažení výrobku",
    "salmonela",
    "listerie",
    "kontaminace",
    // 💰 podvody
    "podvodníci",
    "banka varuje",
    "nový scam",
    "phishing",
    "hack účtů",
    "unik dat",
    "únik dat",
    // 🧒 školy / děti
    "nebezpečná hračka",
    "stažení léků",
    "uzavření škol",
    "závadná voda ve škole",
  ];

  const IU_WARN_PHRASES = ["doporučení", "pozor na", "omezení dopravy", "možné omezení", "hrozí zpoždění"];

  const IU_ALERT_REGEX = iuRegexFromPhrases(IU_ALERT_PHRASES);
  const IU_WARN_REGEX = iuRegexFromPhrases(IU_WARN_PHRASES);

  function iuStripDiacritics(s) {
    try {
      return String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    } catch {
      return String(s || "");
    }
  }

  // Authority + phrase matching (robust, diacritics-insensitive; only for middle feed articles).
  const IU_ALERT_AUTHORITY =
    /\b(policie|pcr|policie\s*cr|hzs|hasici|zachranka|zzs|zdravotnicka\s*zachranna\s*sluzba|chmu|cesky\s*hydrometeorologicky\s*ustav|silnicari|rsd|reditelstvi\s*silnic\s*a\s*d(alnic)?|mdcr|mzcr|mvcr|szpi|szu|sukl|hygien(a|ici)|krajska\s*hygien(a|e))\b/i;

  const IU_ALERT_PHRASE =
    /\b(varuje|vyhlasu(j|je)\s*vystrah|vystrah(a|y|u)|evakuac(e|i)|zakaz|uzavirk(a|y)|patran(i|i)|hleda\s*se|pohresovan(a|y|i)|ohrozen(i|i)|nebezpec(i|i)|akutn(i|e)|jedovat(e|y)|kontaminac(e|i)|stahuje\s*z\s*prodeje|stazeni\s*z\s*prodeje|epidemi(e|i)|vybuch|pozar|strelb(a|y)|utok|povod(e|en)|extremn(i|e)\s*vitr|tornado)\b/i;

  const IU_WARN_PHRASE =
    /\b(upozornuje|upozorneni|apeluje|vyzyva|doporucuje|prosime|pozor|riziko|ledovk(a|y)|namraz(a|y)|kluzk(o|y)|mlh(a|y)|kolon(y|a)|zdrzen(i|i)|omezen(i|i)|komplikac(e|i))\b/i;

  // EXTRA (only if source is official)
  const IU_ALERT_EXTRA_TITLE_REGEX = iuRegexFromPhrases(["varování", "výstraha", "nouzový stav", "evakuace"]);
  const IU_ALERT_EXTRA_SOURCE_REGEX = iuRegexFromPhrases(["policie", "hasiči", "čhmú", "ministerstvo", "krajský úřad"]);

  // Not allowed to be red (sports/celebrity/bulvar/political commentaries)
  const IU_ALERT_EXCLUDE_REGEX = iuRegexFromPhrases([
    "sport",
    "fotbal",
    "hokej",
    "tenis",
    "bulvár",
    "bulvar",
    "celebrity",
    "showbiz",
    "komentář",
    "komentar",
    "glosa",
    "názor",
    "nazor",
    "opinion",
  ]);

  // Icon buckets (optional, stable — applied before DOM insertion)
  const IU_ICON_SECURITY_REGEX = iuRegexFromPhrases([
    "policie varuje",
    "policie pátrá",
    "policie hleda svedky",
    "policie hledá svědky",
    "vyhlásila pátrání",
    "ozbrojený pachatel",
    "střelba",
    "bombová hrozba",
    "evakuace",
    "pachatel na útěku",
  ]);
  const IU_ICON_WEATHER_REGEX = iuRegexFromPhrases([
    "čhmú varuje",
    "meteorologové varují",
    "extrémní bouře",
    "povodně",
    "ledovka",
    "sněhová kalamita",
    "tornádo",
    "extrémní horko",
    "silný vítr",
  ]);
  const IU_ICON_TRANSPORT_REGEX = iuRegexFromPhrases([
    "silničáři varují",
    "dálnice uzavřena",
    "tunel uzavřen",
    "most uzavřen",
    "dopravní kolaps",
    "hromadná nehoda",
    "nehoda s oběťmi",
    "vlak vykolejil",
    "metro zastaveno",
    "omezení dopravy",
    "hrozí zpoždění",
  ]);
  const IU_ICON_ENERGY_REGEX = iuRegexFromPhrases([
    "výpadek elektřiny",
    "blackout",
    "odstávka plynu",
    "omezení vody",
    "nouzový stav",
    "kyberútok",
    "evakuační plán",
  ]);
  const IU_ICON_FRAUD_REGEX = iuRegexFromPhrases(["podvodníci", "banka varuje", "nový scam", "phishing", "hack účtů", "unik dat", "únik dat"]);

  function iuExtractSourcesText(item) {
    try {
      const src = Array.isArray(item?.sources) ? item.sources : [];
      const names = src.map((s) => String(s?.name || "")).filter(Boolean).join(" ");
      const urls = src.map((s) => String(s?.url || "")).filter(Boolean).join(" ");
      return `${names} ${urls}`.trim();
    } catch {
      return "";
    }
  }

  function iuShouldSkipAlertForItem(item) {
    try {
      const section = String(item?.section || item?.category || "").trim();
      const srcText = iuExtractSourcesText(item);
      const hay = `${section} ${srcText}`.trim();
      if (!hay) return false;
      return IU_ALERT_EXCLUDE_REGEX.test(hay);
    } catch {
      return false;
    }
  }

  function iuPickAlertIcon(titleLc) {
    if (!titleLc) return "";
    if (IU_ICON_SECURITY_REGEX.test(titleLc)) return "🚨";
    if (IU_ICON_WEATHER_REGEX.test(titleLc)) return "🌧";
    if (IU_ICON_TRANSPORT_REGEX.test(titleLc)) return "🚗";
    if (IU_ICON_ENERGY_REGEX.test(titleLc)) return "⚡";
    if (IU_ICON_FRAUD_REGEX.test(titleLc)) return "💰";
    return "";
  }

  function iuApplyAlertTitle(card, item) {
    try {
      if (!card || !(card instanceof HTMLElement)) return;
      // Only middle feed: #feed .news-card[data-feed-type="article"]
      if (!card.matches('.news-card[data-feed-type="article"]')) return;
      if (String(item?.contentType || "").toLowerCase() !== "article") return;

      const titleEl = card.querySelector(".iuCardTitle") || card.querySelector(".news-titleLink");
      if (!titleEl) return;

      const titleRaw = String(item?.title || titleEl.textContent || "");
      const titleLc = titleRaw.toLowerCase();
      const titleNoDia = iuStripDiacritics(titleLc);
      if (!titleLc) return;

      // Never colorize excluded categories/sources.
      if (iuShouldSkipAlertForItem(item)) return;

      const sourcesText = iuExtractSourcesText(item).toLowerCase();

      const isExtraOfficialAlert =
        IU_ALERT_EXTRA_TITLE_REGEX.test(titleLc) && IU_ALERT_EXTRA_SOURCE_REGEX.test(sourcesText);
      const isAlertByKeywords = IU_ALERT_REGEX.test(titleLc);
      const isWarnByKeywords = IU_WARN_REGEX.test(titleLc);

      const startsWithAuthorityColon = /^\s*(policie|pcr|hzs|hasici|zachranka|zzs|chmu|rsd|silnicari)\s*:\s*/i.test(titleNoDia);
      const authority = IU_ALERT_AUTHORITY.test(titleNoDia) || startsWithAuthorityColon;
      const alertPhrase = IU_ALERT_PHRASE.test(titleNoDia);
      const warnPhrase = IU_WARN_PHRASE.test(titleNoDia);

      const isAlertByAuthority = alertPhrase && authority;
      const isWarnByAuthority = (warnPhrase && authority) || (startsWithAuthorityColon && !alertPhrase);

      // Priority:
      // - EXTRA official alert always wins (red)
      // - Otherwise, if WARN matches too, treat it as WARN (orange) to avoid over-alerting
      //   for mild phrasing like "Pozor na ..." (even if it contains alert tokens).
      const level = isExtraOfficialAlert
        ? "alert"
        : (isAlertByAuthority ? "alert"
        : (isWarnByAuthority ? "warn"
        : (isWarnByKeywords ? "warn" : (isAlertByKeywords ? "alert" : ""))));

      if (level === "alert") {
        titleEl.classList.add("iuTitle--alert");
        // optional icon (no CLS: applied before insert)
        const icon = iuPickAlertIcon(titleLc);
        if (icon && !titleEl.querySelector(".iuTitleIcon")) {
          const span = document.createElement("span");
          span.className = "iuTitleIcon";
          span.setAttribute("aria-hidden", "true");
          span.textContent = icon + " ";
          titleEl.insertBefore(span, titleEl.firstChild);
        }
      } else if (level === "warn") {
        titleEl.classList.add("iuTitle--warn");
      }
    } catch {}
  }

  // === LOCKED PIPELINE ===
  // Jakákoli změna této funkce MUSÍ respektovat invarianty feedu.
  // Druhá render cesta je zakázaná.
  function renderFeed(target, items) {
    const feedEl = document.getElementById("feed");
    const feedExists = !!(feedEl && feedEl.id === "feed");
    const feedChildrenBefore = feedEl ? feedEl.childElementCount : 0;
    const targetSelector = feedEl ? "#feed" : "(missing)";
    diagStartInfo = {
      itemsLen: items ? items.length : 0,
      feedExists,
      childrenBefore: feedChildrenBefore,
    };
    diagLog("renderFeed:start", {
      itemsLen: items ? items.length : 0,
      target: targetSelector,
      feedExists,
      feedChildrenBefore,
    });
    if (!feedEl || feedEl.id !== "feed") {
      if (iuDbg()) { try { iuDbgInc(IU_VIDEO_DBG.drops, "render_target_missing"); } catch {} }
      persistLastError("Invariant breach: invalid render target");
      return;
    }
    const safeTarget = insideTarget(target, feedEl);
    if (emptyBox) {
      emptyBox.style.display = "none";
      emptyBox.innerHTML = "";
    }
    const beforeChildren = safeTarget.childElementCount;
    // Zachovat #sectionsBar jako reálný DOM node před clear
    const sectionsBar = document.getElementById("sectionsBar");
    if (!items || items.length === 0) {
      feedEl.setAttribute("data-feed-ready", "true");
      renderEmpty("Žádné články k zobrazení. Zkontroluj Stav dat.");
      return;
    }
    feedEl.setAttribute("data-feed-ready", "false");

    // Render-only paging: show at most pageSize*page items, no other slicing elsewhere
    const pageSize = Number(state.pageSize) > 0 ? Number(state.pageSize) : 200;
    const page = Number(state.page) >= 1 ? Number(state.page) : 1;
    const visibleCount = page * pageSize;
    const visibleItems = items.slice(0, visibleCount);
    const hasMore = visibleItems.length < items.length;
    // debug/gate-friendly snapshot (read-only)
    try{ window.__iuFeedPaging = { pageSize, page, visibleCount, totalCount: items.length, visibleCountRendered: visibleItems.length, hasMore }; }catch{}

    // CLS mitigation: žádný mezistav "prázdný feed" (clear + append v cyklu).
    // Postav nový obsah mimo DOM a jednorázově ho vyměň přes replaceChildren().
    const nextNodes = [];
    const iuAlertDemo = Boolean(location.search.includes("debug=1") && location.search.includes("alertDemo=1"));
    const isHome = Boolean(document.body && document.body.classList && document.body.classList.contains("iu-home"));
    const hasVideoSection = Array.isArray(activeSections) && activeSections.includes("video");
    const shouldInjectVideos =
      Boolean(IU_FEED_VIDEO_ENABLED) &&
      Number(IU_FEED_VIDEO_EVERY) > 0 &&
      !isHome &&
      !hasVideoSection;
    const videoPool = shouldInjectVideos ? normalizeVideoList(state.videosRaw || {}) : [];
    const insertEveryN = Number(IU_FEED_VIDEO_EVERY) || 8;
    const maxVideosPerPage = Number(state?.videosRaw?.maxVideosPerPage) || Number(IU_FEED_VIDEO_MAX_PER_PAGE) || 25;
    const videoCfg = {
      primaryDays: Number(state?.videosRaw?.freshDaysPrimary) || Number(state?.videosRaw?.freshness?.primaryDays) || 14,
      fallbackDays: Number(state?.videosRaw?.freshDaysFallback) || Number(state?.videosRaw?.freshness?.fallbackDays) || 60,
      targetShare: Number(state?.videosRaw?.freshTargetShare) || 0.7,
      dedupeDays: Number(state?.videosRaw?.dedupeDays) || 30,
      langTargetCz: Number(state?.videosRaw?.langTargetCz) || 0.5,
      langTargetEn: Number(state?.videosRaw?.langTargetEn) || 0.5,
      minGapSameSource: Number(state?.videosRaw?.minGapSameSource) || 5,
      maxSameLangStreak: Number(state?.videosRaw?.maxSameLangStreak) || 2,
      maxSameCategoryStreak: Number(state?.videosRaw?.maxSameCategoryStreak) || 2,
    };
    let injectedVideosCount = 0;

    // Fixed slot queue (v1): stable positions, newest-only head replacement.
    // Sloty se počítají jen podle počtu článků (ne podle indexu pole).
    const totalArticlesVisible = visibleItems.reduce(
      (acc, it) => acc + (String(it?.contentType || "").toLowerCase() === "article" ? 1 : 0),
      0
    );
    const slotCount = shouldInjectVideos
      ? Math.min(maxVideosPerPage, Math.floor(totalArticlesVisible / (Number(IU_FEED_VIDEO_EVERY) || insertEveryN)))
      : 0;
    const sectionKey =
      Array.isArray(activeSections) && activeSections.length === 1 ? String(activeSections[0]) : "vse";
    const queue = shouldInjectVideos
      ? iuUpdateVideoQueue(sectionKey, slotCount, videoPool, {
          insertEveryN,
          maxVideosPerPage,
          articleTotal: totalArticlesVisible,
          dedupeDays: videoCfg.dedupeDays,
          minGapSameSource: videoCfg.minGapSameSource,
          maxSameLangStreak: videoCfg.maxSameLangStreak,
          maxSameCategoryStreak: videoCfg.maxSameCategoryStreak,
        })
      : iuInitQueue(0);
    if (iuDbg()) {
      try{
        IU_VIDEO_DBG.counts.ui = IU_VIDEO_DBG.counts.ui || {};
        IU_VIDEO_DBG.counts.ui.activeSections = Array.isArray(activeSections) ? activeSections.slice() : [];
        IU_VIDEO_DBG.counts.ui.hasVideoSection = hasVideoSection ? 1 : 0;
        IU_VIDEO_DBG.counts.ui.isHome = isHome ? 1 : 0;
        IU_VIDEO_DBG.counts.ui.shouldInjectVideos = shouldInjectVideos ? 1 : 0;
        IU_VIDEO_DBG.counts.ui.videoPool = Array.isArray(videoPool) ? videoPool.length : 0;
        IU_VIDEO_DBG.counts.ui.slotCount = slotCount;
        IU_VIDEO_DBG.counts.ui.queueSlots = Array.isArray(queue?.slots) ? queue.slots.length : 0;
      }catch{}
    }

    // Optional visual gate: inject 3 demo alert titles only in debug mode (never in normal prod view)
    if (iuAlertDemo) {
      const demos = [
        {
          contentType: "article",
          title: "Policie: Upozornění pro veřejnost",
          url: "https://example.com/demo-policie",
          publishedAt: new Date().toISOString(),
          sources: [{ name: "Policie ČR", url: "https://www.policie.cz/" }],
          __iuAlertDemo: true,
        },
        {
          contentType: "article",
          title: "Varování policie: pachatel na útěku",
          url: "https://example.com/demo-varovani-policie",
          publishedAt: new Date().toISOString(),
          sources: [{ name: "Policie ČR", url: "https://www.policie.cz/" }],
          __iuAlertDemo: true,
        },
        {
          contentType: "article",
          title: "Silničáři varují před ledovkou",
          url: "https://example.com/demo-silnicari",
          publishedAt: new Date().toISOString(),
          sources: [{ name: "ŘSD", url: "https://www.rsd.cz/" }],
          __iuAlertDemo: true,
        },
        {
          contentType: "article",
          title: "ČHMÚ vydal výstrahu před silným větrem",
          url: "https://example.com/demo-chmu",
          publishedAt: new Date().toISOString(),
          sources: [{ name: "ČHMÚ", url: "https://www.chmi.cz/" }],
          __iuAlertDemo: true,
        },
        {
          contentType: "article",
          title: "Záchranka vyzývá: uvolněte cestu záchranářům",
          url: "https://example.com/demo-zzs",
          publishedAt: new Date().toISOString(),
          sources: [{ name: "ZZS", url: "https://example.com/" }],
          __iuAlertDemo: true,
        },
      ];
      for (const demo of demos) {
        try {
          const markup = buildArticleHtml(demo);
          if (!markup) continue;
          const template = document.createElement("template");
          template.innerHTML = markup.trim();
          const node = template.content.firstElementChild;
          if (!node || !(node instanceof HTMLElement)) continue;
          iuApplyAlertTitle(node, demo);
          nextNodes.push(node);
        } catch {}
      }
    }

    for (let i = 0; i < visibleItems.length; i++) {
      const item = visibleItems[i];
      const kind = String(item.contentType || "").toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.has(kind)) {
        feedEl.setAttribute("data-feed-ready", "true");
        persistLastError("Invariant breach: neznámý contentType");
        renderInlineError("Obsah dočasně nedostupný.");
        return;
      }

      // Ve standardním feedu jsou video karty povolené pouze přes pevné sloty po 8 článcích.
      // Pipeline contentType=video položky tedy nesmí být renderované "kdekoliv" (jinak by video nebylo přesně po 8).
      if (shouldInjectVideos && kind === "video") {
        continue;
      }

      const markup = kind === "video" ? buildVideoAsArticleCard(item) : buildArticleHtml(item);
      if (!markup) {
        persistLastError("Invariant breach: builder returned falsy markup");
        renderInlineError("Obsah se nepodařilo zobrazit. Zkus stránku obnovit.");
        continue;
      }
      const template = document.createElement("template");
      template.innerHTML = markup.trim();
      const node = template.content.firstElementChild;
      if (!node || !(node instanceof HTMLElement)) {
        persistLastError("Invariant breach: builder returned invalid node");
        renderInlineError("Obsah se nepodařilo zobrazit. Zkus stránku obnovit.");
        continue;
      }

      // ALERT TITLES: only for middle feed (#feed), only for article cards.
      // Apply before insertion to avoid CLS.
      try {
        if (safeTarget && safeTarget.id === "feed") iuApplyAlertTitle(node, item);
      } catch {}

      nextNodes.push(node);
    }

    // "Load more" button (no infinite auto-load)
    let loadMoreWrap = null;
    const canLoadRetention =
      Boolean(state.retentionIsLoading) ||
      (Array.isArray(state.retentionDays) && state.retentionCursor < state.retentionDays.length);
    if (hasMore || canLoadRetention) {
      const wrap = document.createElement("div");
      wrap.className = "iuLoadMoreWrap";
      wrap.innerHTML = `
        <button type="button" class="iuLoadMoreBtn" aria-label="Načíst další stránku">
          Načíst další stránku
        </button>
        <div class="iuLoadMoreMeta">${visibleItems.length} / ${items.length}${canLoadRetention ? "+" : ""}</div>
      `.trim();
      loadMoreWrap = wrap;
    }

    if (sectionsBar) {
      if (loadMoreWrap) safeTarget.replaceChildren(sectionsBar, ...nextNodes, loadMoreWrap);
      else safeTarget.replaceChildren(sectionsBar, ...nextNodes);
    } else {
      if (loadMoreWrap) safeTarget.replaceChildren(...nextNodes, loadMoreWrap);
      else safeTarget.replaceChildren(...nextNodes);
    }

    // DOM re-anchor pass: ensure video cards are exactly after 8/16/24... rendered articles.
    try {
      window.__iuVideoAnchorSectionKey = sectionKey;
      iuInitVideoAnchorObserver();
      iuEnsureVideoAnchors(sectionKey);
      injectedVideosCount = safeTarget.querySelectorAll(".iuVideoCard[data-slot]").length;
    } catch {}

    const feedChildrenAfter = safeTarget.childElementCount;
    const renderedCount = nextNodes.length;
    const typeCounts = visibleItems.reduce(
      (acc, entry) => {
        const kind = String(entry.contentType || "").toLowerCase();
        if (kind === "article") acc.article += 1;
        else if (kind === "video") acc.video += 1;
        else acc.unknown += 1;
        return acc;
      },
      { article: 0, video: 0, unknown: 0 }
    );
    diagLog("renderFeed:end", {
      itemsCount: items.length,
      visibleCount: visibleItems.length,
      pageSize,
      page,
      renderedCount,
      injectedVideosCount,
      feedChildrenAfter,
      typeCounts,
      hasMore,
    });
    if (diagStartInfo) {
      updateDiagBar(
        formatDiagText(
          diagStartInfo.itemsLen,
          typeCounts,
          diagStartInfo.feedExists,
          diagStartInfo.childrenBefore,
          feedChildrenAfter,
          renderedCount
        )
      );
    }
    if (items.length > 0 && renderedCount === 0) {
      safeTarget.insertAdjacentHTML(
        "beforeend",
        `<div class="empty" style="margin-top:10px;color:rgba(11,27,43,0.7);font-weight:600;">Data načtena, ale nic se nevykreslilo. Obnov stránku.<br /><small>${items.length} položek</small></div>`
      );
      const preview = items.slice(0, 3).map((it) => `${it.contentType || "unknown"}:${it.title || it.name || "(bez názvu)"}`);
      diagLog("renderFeed:fallback", {
        preview,
        feedChildrenAfter,
      });
      persistLastError("Data existují, ale nic nebylo vykresleno");
      renderInlineError("Obsah se nepodařilo zobrazit. Zkus stránku obnovit.");
      setStatus("Stav dat: chyba (viz feed)");
      feedEl.setAttribute("data-feed-ready", "true");
      return;
    }
    if (elDataCount) elDataCount.textContent = String(items.length);

    // Forensic video pipeline report (debug-only): emit aggregated object.
    if (iuDbg()) {
      try{
        IU_VIDEO_DBG.counts.rendered = renderedCount;
        IU_VIDEO_DBG.counts.injectedVideosCount = injectedVideosCount;
        IU_VIDEO_DBG.counts.visibleItems = visibleItems.length;
        IU_VIDEO_DBG.counts.totalItems = items.length;
        IU_VIDEO_DBG.counts.typeCounts = typeCounts;
        IU_VIDEO_DBG.counts.totalArticlesVisible = totalArticlesVisible;
        IU_VIDEO_DBG.counts.slotCount = slotCount;
        IU_VIDEO_DBG.counts.domVideoCardsTotal = safeTarget ? safeTarget.querySelectorAll(".iuVideoCard").length : 0;
        IU_VIDEO_DBG.counts.domVideoCardsSlots = safeTarget ? safeTarget.querySelectorAll(".iuVideoCard[data-slot]").length : 0;
        IU_VIDEO_DBG.counts.domVideoPosters = safeTarget ? safeTarget.querySelectorAll(".iuVideoPoster").length : 0;
        try { iuDbgUpdateVideoDumpPanel(); } catch {}
      }catch{}
    }

    // wire load more click (new node each render, safe)
    if (loadMoreWrap) {
      const btn = loadMoreWrap.querySelector(".iuLoadMoreBtn");
      if (btn) {
        btn.addEventListener("click", () => {
          const nextPage = (Number(state.page) >= 1 ? Number(state.page) : 1) + 1;
          state.page = nextPage;
          const desiredVisible = nextPage * pageSize;
          (async () => {
            // If we need older data beyond the current cache, fetch day-shards lazily (no auto-load).
            if (desiredVisible > (state.filteredItems?.length ?? 0)) {
              const prevText = btn.textContent;
              try{
                btn.disabled = true;
                btn.textContent = "Načítám…";
                await loadRetentionUntilVisibleCount(desiredVisible);
              }catch{}
              btn.disabled = false;
              btn.textContent = prevText;
            }
            renderFeed(safeTarget, state.filteredItems);
          })();
        });
      }
    }
    if (!Array.isArray(state.cachedItems)) {
      feedEl.setAttribute("data-feed-ready", "true");
      persistLastError("Invariant breach: state.cachedItems není pole");
      renderInlineError("Obsah dočasně nedostupný.");
      return;
    }
    for (const it of state.cachedItems) {
      if (!it || !it.contentType) {
        feedEl.setAttribute("data-feed-ready", "true");
        persistLastError("Invariant breach: položka bez contentType");
        renderInlineError("Obsah dočasně nedostupný.");
        break;
      }
    }
    feedEl.setAttribute("data-feed-ready", "true");
  }

  function renderInlineError(message) {
    const inline = document.getElementById("lastErrInline");
    if (!inline) return;
    inline.textContent = message;
    inline.style.display = "block";
    inline.style.opacity = "1";
  }

  function renderItems(items) {
    const target = getFeedTarget();
    renderFeed(target, items);
  }

  function renderFeedItemHtml(item) {
    if (!item) return "";
    const type = String(item.contentType || "article").toLowerCase();
    if (type === "video") return buildVideoAsArticleCard(item);
    if (type === "ad") return buildAdHtml(item);
    return buildArticleHtml(item);
  }

  function normalizeMediaName(name) {
    if (!name || typeof name !== "string") return "";
    const normalized = name.toLowerCase().trim();
    
    // Mapování variant názvů médií na canonical tvar
    const mediaMap = {
      "česká televize": "ct24",
      "ceska televize": "ct24",
      "ct24": "ct24",
      "irozhlas": "irozhlas",
      "irozhlas.cz": "irozhlas",
      "irozhlas sport": "irozhlas-sport",
      "idnes": "idnes",
      "idnes.cz": "idnes",
      "seznam zpravy": "seznamzpravy",
      "seznam zprávy": "seznamzpravy",
      "seznamzpravy": "seznamzpravy",
    };
    
    return mediaMap[normalized] || normalized;
  }

  function renderSourcesMetaLine(it) {
    const srcRaw = Array.isArray(it.sources) ? it.sources : [];
    const seen = new Set();
    const src = [];

    for (const s of srcRaw) {
      const name = (s?.name || "").trim();
      const url = (s?.url || "").trim();
      if (!name || !url) continue;

      // Normalizace URL: base URL bez query params a hash
      const urlBase = url.split('?')[0].split('#')[0].toLowerCase();
      
      // Normalizace názvu média
      const canonicalName = normalizeMediaName(name);
      
      // Klíč pro deduplikaci: base URL + canonical name
      const key = `${urlBase}||${canonicalName}`;
      
      if (seen.has(key)) continue;
      seen.add(key);
      src.push({ name, url });
    }

    if (!src.length) return "";

    const primary = src[0];
    const others = src.slice(1);

    const dateText = fmtDate(it.publishedAt || it.date || it.published || "");
    const datePart = dateText ? `<span class="iu-meta-date">${escapeHtml(dateText)}</span>` : "";
    const primaryUrl = normalizeArticleUrl(primary.url) || primary.url;
    const primaryPart = `<span class="iu-meta-src">Zdroj: <a class="iu-meta-link" href="${escapeHtml(primaryUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(primary.name)}</a></span>`;

    const othersPart = others.length
      ? `<span class="iu-meta-others">Píší také: ${others.map(o => {
          const ou = normalizeArticleUrl(o.url) || o.url;
          return `<a class="iu-meta-link iu-meta-link-secondary" href="${escapeHtml(ou)}" target="_blank" rel="noopener noreferrer">${escapeHtml(o.name)}</a>`;
        }).join(", ")}</span>`
      : "";

    const sep = datePart ? `<span class="iu-meta-sep"> | </span>` : "";
    const sep2 = othersPart ? `<span class="iu-meta-sep"> | </span>` : "";

    return `<div class="iu-meta-line">${datePart}${sep}${primaryPart}${sep2}${othersPart}</div>`;
  }

  function buildArticleHtml(it) {
    const title = safeText(it.title || it.name || "(bez názvu)");
    let linkUrl =
      it.url ||
      (Array.isArray(it.sources) ? (it.sources.find((s) => s && s.url && s.url.trim())?.url || "") : "") ||
      (it.canonicalUrl || "") ||
      (typeof it.link === "string"
        ? it.link
        : (it.link && typeof it.link === "object" ? (it.link.href || it.link.url || "") : ""));
    if (!linkUrl) {
      persistLastError("Article without URL skipped");
      return "";
    }
    linkUrl = normalizeArticleUrl(linkUrl);
    const titleMarkup = linkUrl
      ? `<a class="news-titleLink iuCardTitle" href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
      : `<span class="news-titleLink iuCardTitle">${escapeHtml(title)}</span>`;

    const suspiciousFlag = it?.suspiciousTitle
      ? `<span class="iuSuspicious" title="Titulek doporučeno ověřit u zdroje" aria-label="Titulek doporučeno ověřit u zdroje">⚑</span>`
      : "";

    const sourcesMetaLine = renderSourcesMetaLine(it);

    debugLog("[RENDER ARTICLE]", title);
    return `
      <article class="news-card" data-feed-type="article">
        <h2 class="news-title">${titleMarkup}${suspiciousFlag}</h2>
        ${sourcesMetaLine}
      </article>
    `;
  }

function buildVideoAsArticleCard(it) {
    // Render video as the same preview card (not just a link).
    return buildYouTubeVideoPreviewCard(it);
  }

  function buildYouTubeVideoPreviewCard(it) {
    try {
      const id = (it && it.videoId) ? String(it.videoId).trim() : (iuExtractYouTubeId(it) || iuExtractYouTubeId(it?.url || "") || "");
      if (!id) return "";
      const title = safeText(it?.title || "Video");
      const channel = safeText(it?.channel || "YouTube");
      const publishedAt = fmtDate(it?.publishedAt || it?.date || it?.published || "");
      const category = safeText(it?.category || "");
      const thumb = safeText(it?.thumb || "") || iuBuildYouTubeThumb(id);
      const aria = `Přehrát video: ${title}`;
      const noExternalOpen = Boolean(it && it.noExternalOpen);
      const noOpenAttr = noExternalOpen ? ` data-iu-no-external-open="1"` : "";
      return `
        <article class="news-card iuVideoCard" data-feed-type="video-preview" data-ytid="${escapeHtml(id)}"${noOpenAttr}>
          <div class="iuVideoFrame">
            <button type="button" class="iuVideoPoster" style="--iuVideoThumb: url('${escapeHtml(thumb)}');" aria-label="${escapeHtml(aria)}">
              <span class="iuVideoPlay" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="24" height="24" focusable="false" aria-hidden="true">
                  <path d="M9 7.5v9l8-4.5-8-4.5z" fill="currentColor"></path>
                </svg>
              </span>
              ${category ? `<span class="iuVideoBadge" aria-hidden="true">${escapeHtml(category)}</span>` : ""}
            </button>
          </div>
          <div class="iuVideoMeta">
            <div class="iuVideoTitle">${escapeHtml(title)}</div>
            <div class="iuVideoSub">
              <span class="iuVideoChannel">${escapeHtml(channel)}</span>
              ${publishedAt ? `<span class="iuVideoDot">•</span><span class="iuVideoTime">${escapeHtml(publishedAt)}</span>` : ""}
            </div>
          </div>
        </article>
      `;
    } catch {
      return "";
    }
  }

  function buildAdHtml(it) {
    const label = escapeHtml(it.adLabel || "Reklamní okýnko");
    const slot = escapeHtml(it.adSlot || "slot");
    return `
      <article class="ad-card" aria-hidden="true">
        <div class="ad-head">
          <span class="pos">${slot}</span>
          <span class="ad-label">${label}</span>
        </div>
      </article>
    `;
  }

  function ensureFallbackMessage() {
    const target = getFeedTarget();
    if (!target) return;
    if (target.children.length > 0) return;
    if (emptyBox && emptyBox.textContent.trim()) return;
    renderEmpty("Žádná data k zobrazení. Zkontroluj Stav dat.");
  }

  function iuComputeTopbarStackH(){
    // CLS hard rule: do not measure DOM and set layout-affecting CSS at runtime.
    // `--topbarStackH` is driven purely by CSS (`--iuTopbarHeight`).
  }

  function iuInitTopbarWatcher(){
    // Intentionally disabled (see `iuComputeTopbarStackH`).
  }

  // === UI: Topbar icon-search toggle + day/nameday text + Google fallback ===
  // Requirements:
  // - NO changes to loadData / applyFilter / renderFeed logic (feed pipeline untouched)
  // - Only call existing applyFilter() and read state.filteredItems for not-found evidence
  function iuInitTopbarSearchToggle(){
    try{
      try{
        if (window.__iu_topbarSearchToggleInit) return;
        window.__iu_topbarSearchToggleInit = 1;
      }catch{}
      const dayInfo =
        document.getElementById("iuTopbarToday") ||
        document.getElementById("iuTodayInfo") ||
        document.getElementById("iuTopbarDayInfo");
      const searchContainer = document.getElementById("iuTopSearch");
      const btn = document.getElementById("iuTopbarSearchBtn");
      const overlay = document.getElementById("iuTopbarSearchOverlay");
      const form = document.getElementById("iuTopbarSearchForm");
      const input = document.getElementById("iuTopbarSearchInput");
      const notFound = document.getElementById("iuTopbarSearchNotFound");
      const googleBtn = document.getElementById("iuTopbarSearchGoogleBtn");

      if (!btn || !overlay || !form || !input) return;

      let isOpen = false;
      let scrollHidden = false;
      let scrollTimer = 0;

      function setDayHidden(hidden){
        try{ if (dayInfo) dayInfo.classList.toggle("iuTopbarDayInfo--hidden", !!hidden); }catch{}
      }

      function setSearchOpen(open){
        try{ document.body.classList.toggle("iuSearchOpen", !!open); }catch{}
      }

      function openOverlay(){
        try{ overlay.hidden = false; }catch{}
        try{ if (searchContainer) searchContainer.classList.add("is-open"); }catch{}
        isOpen = true;
        setSearchOpen(true);
        setDayHidden(true);
        try{ if (notFound) notFound.hidden = true; }catch{}
        try{
          input.focus({ preventScroll: true });
          if (typeof input.select === "function") input.select();
        }catch{}
      }

      function closeOverlay(){
        try{ overlay.hidden = true; }catch{}
        try{ if (searchContainer) searchContainer.classList.remove("is-open"); }catch{}
        isOpen = false;
        setSearchOpen(false);
        try{ if (notFound) notFound.hidden = true; }catch{}
        if (!scrollHidden) setDayHidden(false);
      }

      function fmtDateNow(){
        try{
          const TZ = "Europe/Prague";
          return new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).format(new Date());
        }catch{
          return String(new Date().toLocaleDateString("cs-CZ"));
        }
      }

      function readNamedayFromUI(){
        try{
          const el = document.getElementById("iuDailyNameday");
          if (!el) return "";
          const t = String(el.textContent || "").trim();
          if (!t) return "";
          if (t === "—") return "";
          if (/^svátek\s+má\s*[—-]?\s*$/i.test(t)) return "";
          if (/^svátek\s+má\s+načítám/i.test(t)) return "";
          return t;
        }catch{
          return "";
        }
      }

      function updateDayInfo(){
        try{
          if (!dayInfo) return;
          // v3: topbar today is a structured component; keep its children intact.
          if (dayInfo.id === "iuTopbarToday") return;
          const dateStr = fmtDateNow();
          const namedayStr = readNamedayFromUI();
          const full = namedayStr ? `${dateStr} · ${namedayStr}` : dateStr;
          dayInfo.textContent = full;
          try{ dayInfo.setAttribute("title", full); }catch{}
        }catch{}
      }

      // initial + delayed updates (nameday/weather can arrive later)
      updateDayInfo();
      setTimeout(updateDayInfo, 400);
      setTimeout(updateDayInfo, 1500);

      btn.addEventListener("click", () => {
        if (!isOpen) openOverlay();
        else closeOverlay();
      });

      // ESC closes overlay
      document.addEventListener("keydown", (e) => {
        try{
          if (!isOpen) return;
          if (!e || e.key !== "Escape") return;
          e.preventDefault();
          closeOverlay();
        }catch{}
      });

      // click outside closes overlay
      document.addEventListener("click", (e) => {
        try{
          if (!isOpen) return;
          const t = e && e.target;
          if (t && searchContainer && searchContainer.contains(t)) return;
          if (t && (btn.contains(t) || overlay.contains(t))) return;
          closeOverlay();
        }catch{}
      });

      // hide not-found prompt when user edits query
      input.addEventListener("input", () => {
        try{ if (notFound) notFound.hidden = true; }catch{}
      });

      // Scroll hide after 5s (only when overlay is closed)
      window.addEventListener("scroll", () => {
        try{
          if (isOpen) return;
          clearTimeout(scrollTimer);
          scrollTimer = setTimeout(() => {
            if (isOpen) return;
            scrollHidden = true;
            setDayHidden(true);
          }, 5000);
        }catch{}
      }, { passive: true });

      form.addEventListener("submit", (e) => {
        try{ e.preventDefault(); }catch{}
        const q = String(input.value || "").trim();
        try{ if (notFound) notFound.hidden = true; }catch{}

        // Ensure the feed pipeline reads the correct query (applyFilter reads searchInputEl).
        try{
          if (searchInputEl && searchInputEl !== input) {
            searchInputEl.value = q;
          }
        }catch{}

        try{ applyFilter(); }catch{}

        // Evidence: filteredItems length (no DOM probing, no pipeline changes)
        try{
          const n = Array.isArray(state.filteredItems) ? state.filteredItems.length : null;
          if (q && n === 0 && notFound) {
            notFound.hidden = false;
          }
        }catch{}
      });

      if (googleBtn) {
        googleBtn.addEventListener("click", () => {
          const q = String(input.value || "").trim();
          if (!q) return;
          const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
          window.open(url, "_blank", "noopener");
        });
      }
    }catch{}
  }

  function iuSetTopbarNameday(name){
    try{
      const el = document.getElementById("iuTopbarNameday");
      if (!el) return;
      const clean = (name ?? "").toString().trim();
      if (clean) {
        el.textContent = "Svátek má " + clean;
        el.hidden = false;
      } else {
        el.textContent = "Svátek má —";
        el.hidden = false;
      }
    }catch{}
  }

  function iuMirrorTodayToTopbar(){
    try{
      const elDay = document.getElementById("iuTopbarDay");
      const elDate = document.getElementById("iuTopbarDate");
      const elName = document.getElementById("iuTopbarNameday");
      const elWrap = document.getElementById("iuTopbarToday");
      if(!elDay || !elDate || !elName || !elWrap) return;

      const srcName = document.getElementById("iuDailyNameday");

      function fmtDayNow(){
        try{
          const TZ = "Europe/Prague";
          const day = new Intl.DateTimeFormat("cs-CZ", { weekday: "long", timeZone: TZ }).format(new Date());
          return day.charAt(0).toUpperCase() + day.slice(1);
        }catch{
          return "";
        }
      }

      function fmtDateNowLong(){
        try{
          const TZ = "Europe/Prague";
          return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: "numeric", timeZone: TZ }).format(new Date());
        }catch{
          return String(new Date().toLocaleDateString("cs-CZ"));
        }
      }

      function normalizeNameday(t){
        const s = String(t || "").trim();
        if(!s || s === "—") return "";
        const m = s.match(/svátek\s+má\s+(.+)/i);
        if (m && m[1]) return "Svátek má " + String(m[1]).trim();
        const m2 = s.match(/svátek\s*:\s*(.+)/i);
        if (m2 && m2[1]) return "Svátek má " + String(m2[1]).trim();
        if (/^svátek\s+má\s*$/i.test(s)) return "";
        return "Svátek má " + s;
      }

      function sync(){
        try{ elDay.textContent = fmtDayNow(); }catch{}
        try{ elDate.textContent = fmtDateNowLong(); }catch{}
        try{
          const nRaw = (srcName && String(srcName.textContent || "").trim()) || "";
          const n = normalizeNameday(nRaw);
          elName.textContent = n || "Svátek má —";
        }catch{}
        try{
          const full = `${elDay.textContent} ${elDate.textContent}${elName.textContent ? " • " + elName.textContent : ""}`;
          elWrap.setAttribute("title", full);
        }catch{}
      }

      sync();
      try{ if (srcName) new MutationObserver(sync).observe(srcName, { childList:true, characterData:true, subtree:true }); }catch{}
      setInterval(sync, 60000);
    }catch{}
  }

  /** Stejné pravidlo jako welcome meta: text za „svátek má …“. */
  function iuParseNamedayTailFromRaw(raw){
    if (!raw || raw === "—") return "";
    const t = String(raw).trim();
    if (!t) return "";
    const m = t.match(/^svátek\s+má\s+(.+)$/i);
    if (m && m[1]) {
      const name = String(m[1]).trim();
      if (!name || /^[—\-\s]+$/i.test(name)) return "";
      return name;
    }
    const m2 = t.match(/^svátek\s*:\s*(.+)$/i);
    if (m2 && m2[1]) {
      const name = String(m2[1]).trim();
      if (!name || /^[—\-\s]+$/i.test(name)) return "";
      return name;
    }
    const rest = t.replace(/^svátek\s+má\s*/i, "").trim();
    if (!rest || /^[—\-\s]+$/i.test(rest)) return "";
    return rest;
  }

  /** Jedno křestní jméno → bezpečné oslovení (jen spolehlivá -a → -o); jinak "". */
  function iuSafeVocativeSingleFirstName(tail){
    const tail0 = String(tail || "").trim();
    if (!tail0 || tail0 === "—") return "";
    if (/[;,]/.test(tail0)) return "";
    if (/\s+a\s+/i.test(tail0)) return "";
    if (/\s{2,}/.test(tail0)) return "";
    const parts = tail0.split(/\s+/).filter(Boolean);
    if (parts.length !== 1) return "";
    let w = parts[0].replace(/[.,;:]+$/g, "");
    if (w.indexOf("-") >= 0) return "";
    if (!/^[\p{L}]{2,40}$/u.test(w)) return "";
    const low = w.toLowerCase();
    if (/načítám|svátek|dnes|nikdo|—/.test(low)) return "";
    if (/ia$/i.test(w)) return "";
    if (/a$/i.test(w) && w.length >= 3) {
      return w.slice(0, -1) + "o";
    }
    return "";
  }

  window.getNamedayPersonFromWelcomeBox = function(){
    try{
      const meta = document.getElementById("iuSilverWelcomeMeta");
      if (!meta) return "";
      const full = String(meta.textContent || "").trim();
      const dotIdx = full.lastIndexOf("·");
      const seg = (dotIdx >= 0 ? full.slice(dotIdx + 1) : full).trim();
      const rawTail = iuParseNamedayTailFromRaw(seg);
      const v = iuSafeVocativeSingleFirstName(rawTail);
      return v ? String(v) : "";
    }catch{
      return "";
    }
  };

  /** P0 Silver: sticky welcome card — date + svátek reuse stejného zdroje jako topbar (#iuDailyNameday / #iuTopbarNameday + projects/data/namedays.json přes iuDailyPanelInit). */
  function iuSilverWelcomeInit(){
    try{
      if (window.__iuSilverWelcomeInit) return;
      window.__iuSilverWelcomeInit = 1;
    }catch{}

    const TZ = "Europe/Prague";
    const headlineEl = document.getElementById("iuSilverWelcomeHeadline");
    const greetEl = document.getElementById("iuSilverWelcomeGreet");
    const userEl = document.getElementById("iuSilverWelcomeUser");
    const metaEl = document.getElementById("iuSilverWelcomeMeta");
    const cardEl = document.getElementById("iuSilverWelcomeCard");
    const stackEl = document.getElementById("iuSilverWelcomeStack");
    if (!headlineEl || !metaEl || !cardEl) return;

    function fmtDayForMeta(d){
      try{
        const day = new Intl.DateTimeFormat("cs-CZ", { weekday: "long", timeZone: TZ }).format(d);
        return day.charAt(0).toUpperCase() + day.slice(1);
      }catch{
        return "";
      }
    }
    function fmtDateLong(d){
      try{
        return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", year: "numeric", timeZone: TZ }).format(d);
      }catch{
        return String(d.toLocaleDateString("cs-CZ"));
      }
    }
    function readNamedaySuffixForMeta(){
      try{
        const g =
          typeof window.__iuNamedaySuffixFromSource === "string"
            ? String(window.__iuNamedaySuffixFromSource || "").trim()
            : "";
        if (g && g !== "—" && g !== "-"){
          return "svátek má " + g;
        }
      }catch{}
      const src = document.getElementById("iuDailyNameday");
      const top = document.getElementById("iuTopbarNameday");
      let raw = (src && String(src.textContent || "").trim()) || "";
      if (!raw) raw = (top && String(top.textContent || "").trim()) || "";
      const candidate = iuParseNamedayTailFromRaw(raw);
      return candidate ? "svátek má " + candidate : "svátek má —";
    }
    function greetingKeyFromHour(h){
      if (h >= 5 && h < 9) return "morning";
      if (h >= 9 && h < 12) return "lateMorning";
      if (h >= 12 && h < 18) return "afternoon";
      return "evening";
    }
    function phraseFromKey(k){
      if (k === "morning") return "Dobré ráno";
      if (k === "lateMorning") return "Hezké dopoledne";
      if (k === "afternoon") return "Příjemné odpoledne";
      return "Dobrý večer";
    }
    /** Žádný samostatný profil — pokud později přibude zdroj jména v appce, doplnit zde. */
    function readSilverDisplayName(){
      try{
        return "";
      }catch{
        return "";
      }
    }
    /** P0 CLS: na mobile/tablet (≤900px) nepoužívat iterativní měření fontu — každý krok mění layout-shift; CSS clamp v app.css. */
    function silverWelcomeUseJsMetaFit(){
      try{
        if (typeof window.matchMedia === "function") {
          return window.matchMedia("(min-width: 901px)").matches;
        }
      }catch{}
      return (typeof window.innerWidth === "number" ? window.innerWidth : 1024) > 900;
    }
    function fitMetaFont(){
      try{
        if (!metaEl) return;
        if (!silverWelcomeUseJsMetaFit()) {
          try{ metaEl.style.removeProperty("font-size"); }catch{}
          return;
        }
        const w = typeof window.innerWidth === "number" ? window.innerWidth : 1024;
        const maxPx = w <= 480 ? 12 : w <= 900 ? 13 : 14;
        const minPx = 10;
        /* P0 CLS: max 2 přepočty (maxPx → případně poměr → minPx); bez staré smyčky po 0.25px. */
        metaEl.style.fontSize = maxPx + "px";
        try{ void metaEl.offsetWidth; }catch{}
        if (metaEl.scrollWidth <= metaEl.clientWidth + 0.75) return;
        const ratio = (metaEl.clientWidth - 1) / metaEl.scrollWidth;
        let fs = Math.max(minPx, Math.min(maxPx, maxPx * ratio));
        fs = Math.round(fs * 100) / 100;
        metaEl.style.fontSize = fs + "px";
        try{ void metaEl.offsetWidth; }catch{}
        if (metaEl.scrollWidth > metaEl.clientWidth + 0.75) {
          metaEl.style.fontSize = minPx + "px";
        }
      }catch{}
    }
    function scheduleSilverWelcomeFit(){
      try{
        if (!silverWelcomeUseJsMetaFit()) {
          try{ if (metaEl) metaEl.style.removeProperty("font-size"); }catch{}
          return;
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            try{ fitMetaFont(); }catch{}
          });
        });
      }catch{}
    }
    function applyVariantClass(k){
      try{
        const variants = ["morning", "lateMorning", "afternoon", "evening"];
        const prefix = "silver-welcome-stack--";
        if (stackEl) {
          for (let i = 0; i < variants.length; i++) {
            stackEl.classList.remove(prefix + variants[i]);
          }
          stackEl.classList.add(prefix + k);
          stackEl.setAttribute("data-iu-silver-welcome-variant", k);
        }
        cardEl.setAttribute("data-iu-silver-welcome-variant", k);
      }catch{}
    }
    function refresh(opts){
      try{
        opts = opts || {};
        const refDate = opts.now instanceof Date ? opts.now : new Date();
        const h = typeof opts.hour === "number" ? opts.hour : refDate.getHours();
        const k = greetingKeyFromHour(h);
        applyVariantClass(k);
        const phrase = phraseFromKey(k);
        try{ window.__iuSilverWelcomeLastPhrase = phrase; }catch{}
        const displayName = readSilverDisplayName();
        if (greetEl && userEl) {
          const nm = String(displayName || "").trim();
          if (nm) {
            greetEl.textContent = phrase + ",";
            userEl.textContent = " " + nm;
            try{ userEl.hidden = false; }catch{}
          } else {
            greetEl.textContent = phrase;
            userEl.textContent = "";
            try{ userEl.hidden = true; }catch{}
          }
        } else {
          headlineEl.textContent = phrase;
        }
        const w = fmtDayForMeta(refDate);
        const wLower = w ? w.charAt(0).toLowerCase() + w.slice(1) : "";
        const dlong = fmtDateLong(refDate);
        /* P0: Nemazat window.__iuNamedaySuffixFromSource v welcome — vlastní iuDailyPanelInit; mazání způsobovalo závod a ořez plného textu. */
        const nd = readNamedaySuffixForMeta();
        metaEl.textContent = "Dnes je " + wLower + " " + dlong + " · " + nd;
        if (silverWelcomeUseJsMetaFit()) {
          try{ fitMetaFont(); }catch{}
          /* Jedno fitMetaFont výše; další schedule jen při resize (ResizeObserver) — duplicitní 2× RAF dřív přidávalo CLS. */
        } else {
          try{ metaEl.style.removeProperty("font-size"); }catch{}
        }
      }catch{}
    }

    window.iuSilverWelcomeRefresh = refresh;
    window.iuSilverWelcomeScheduleFit = scheduleSilverWelcomeFit;

    refresh();
    try{
      const obsSrc = document.getElementById("iuDailyNameday");
      const obsTop = document.getElementById("iuTopbarNameday");
      [obsSrc, obsTop].forEach((el) => {
        if (!el) return;
        try{ new MutationObserver(() => refresh()).observe(el, { childList: true, characterData: true, subtree: true }); }catch{}
      });
    }catch{}
    try{ setInterval(() => refresh(), 60000); }catch{}
    try{
      document.addEventListener("visibilitychange", () => {
        try{ if (document.visibilityState === "visible") refresh(); }catch{}
      });
    }catch{}
    /* P0 CLS: na ≤900px neopakujeme refresh zbytečně po 400/1500 ms — MutationObserver + fetch callback stačí; méně layout passů. */
    try{
      if (silverWelcomeUseJsMetaFit()) {
        setTimeout(() => refresh(), 400);
        setTimeout(() => refresh(), 1500);
      }
    }catch{}
    try{
      if (typeof ResizeObserver !== "undefined" && cardEl && silverWelcomeUseJsMetaFit()) {
        const ro = new ResizeObserver(() => {
          try{ scheduleSilverWelcomeFit(); }catch{}
        });
        ro.observe(cardEl);
      }
    }catch{}
    try{
      let t = 0;
      window.addEventListener(
        "resize",
        () => {
          try{
            clearTimeout(t);
            t = setTimeout(() => scheduleSilverWelcomeFit(), 80);
          }catch{}
        },
        { passive: true }
      );
    }catch{}
  }

  /** Silver welcome: přání k svátku — overlay Tykat/Vykat, kopírování, bez zásahu do weather/map. */
  function iuNamedayWishInit(){
    try{
      if (window.__iuNamedayWishInit) return;
      window.__iuNamedayWishInit = 1;
    }catch{}

    const overlay = document.getElementById("iuNamedayWishOverlay");
    const btnWish = document.querySelector(".iu-nameday-wish");
    const btnFlowers = document.querySelector(".iu-nameday-flowers");
    const btnTykat = document.querySelector(".iu-nameday-wish-mode--tykat");
    const btnVykat = document.querySelector(".iu-nameday-wish-mode--vykat");
    const ta = document.getElementById("iuNamedayWishTextarea");
    const btnCopy = document.getElementById("iuNamedayWishCopy");
    if (!overlay || !btnWish || !btnTykat || !btnVykat || !ta || !btnCopy) return;

    let mode = "tykat";

    function readSilverSignatureForWish(){
      try{
        const el = document.getElementById("iuSilverWelcomeUser");
        if (!el || el.hidden) return "";
        const s = String(el.textContent || "").replace(/\s+/g, " ").trim();
        return s || "";
      }catch{
        return "";
      }
    }

    function greetingFromWelcomeBox(){
      try{
        const g = typeof window.__iuSilverWelcomeLastPhrase === "string" ? window.__iuSilverWelcomeLastPhrase.trim() : "";
        if (g) return g;
      }catch{}
      const h = new Date().getHours();
      if (h >= 5 && h < 9) return "Dobré ráno";
      if (h >= 9 && h < 12) return "Hezké dopoledne";
      if (h >= 12 && h < 18) return "Příjemné odpoledne";
      return "Dobrý večer";
    }

    function buildFinalText(m){
      const greeting = greetingFromWelcomeBox();
      const name =
        typeof window.getNamedayPersonFromWelcomeBox === "function"
          ? String(window.getNamedayPersonFromWelcomeBox() || "").trim()
          : "";
      const greetingLine = name ? `${greeting}, ${name},` : `${greeting},`;
      const baseText =
        m === "tykat"
          ? "přeju ti krásný svátek, hodně radosti, pohody a ať se ti dneska všechno daří. 🎉"
          : "přeji Vám krásný sváteční den, hodně zdraví, pohody a spokojenosti.";
      const signature = readSilverSignatureForWish();
      if (signature) {
        return `${greetingLine}\n${baseText}\n\n${signature}`;
      }
      return `${greetingLine}\n${baseText}`;
    }

    function syncTextarea(){
      try{
        ta.value = buildFinalText(mode);
      }catch{}
    }

    function setMode(m){
      mode = m === "vykat" ? "vykat" : "tykat";
      try{
        btnTykat.setAttribute("aria-pressed", mode === "tykat" ? "true" : "false");
        btnVykat.setAttribute("aria-pressed", mode === "vykat" ? "true" : "false");
      }catch{}
      syncTextarea();
    }

    function openOverlay(){
      try{
        setMode("tykat");
        try{ overlay.style.display = ""; }catch{}
        overlay.removeAttribute("hidden");
        overlay.setAttribute("aria-hidden", "false");
        try{ ta.focus(); }catch{}
      }catch{}
    }

    function closeOverlay(){
      try{
        overlay.setAttribute("hidden", "");
        overlay.setAttribute("aria-hidden", "true");
      }catch{}
    }

    btnWish.addEventListener("click", (e) => {
      try{ e.preventDefault(); }catch{}
      openOverlay();
    });

    if (btnFlowers) {
      btnFlowers.addEventListener("click", (e) => {
        try{ e.preventDefault(); }catch{}
      });
    }

    btnTykat.addEventListener("click", () => setMode("tykat"));
    btnVykat.addEventListener("click", () => setMode("vykat"));

    btnCopy.addEventListener("click", async () => {
      try{
        const text = String(ta.value || "");
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          ta.select();
          document.execCommand("copy");
        }
      }catch{}
    });

    try{
      overlay.addEventListener("click", (e) => {
        try{
          const t = e.target;
          if (t === overlay) {
            closeOverlay();
          }
        }catch{}
      });
    }catch{}

    try{
      const dlg = overlay.querySelector("#iuNamedayWishCard");
      if (dlg) {
        dlg.addEventListener("click", (e) => {
          try{ e.stopPropagation(); }catch{}
        });
      }
    }catch{}

    try{
      document.addEventListener(
        "keydown",
        (e) => {
          try{
            if (!overlay || overlay.hasAttribute("hidden")) return;
            if (e.key === "Escape") {
              e.preventDefault();
              closeOverlay();
            }
          }catch{}
        },
        true
      );
    }catch{}

    try{
      const obs = document.getElementById("iuSilverWelcomeMeta");
      if (obs) {
        new MutationObserver(() => {
          try{
            if (!overlay.hasAttribute("hidden")) syncTextarea();
          }catch{}
        }).observe(obs, { childList: true, characterData: true, subtree: true });
      }
    }catch{}

    try{
      document.addEventListener("visibilitychange", () => {
        try{
          if (document.visibilityState === "visible" && !overlay.hasAttribute("hidden")) syncTextarea();
        }catch{}
      });
    }catch{}
  }

  /** Silver weather strip: čte jen z existujícího `window.__iuWeatherState` / `iuWeatherEnsureState()` — žádný vlastní fetch. */
  function iuSilverWeatherInit(){
    try{
      if (window.__iuSilverWeatherInit) return;
      window.__iuSilverWeatherInit = 1;
    }catch{}

    const card = document.getElementById("iuSilverWeatherCard");
    const line1 = document.getElementById("iuSilverWeatherLine1");
    const line2 = document.getElementById("iuSilverWeatherLine2");
    const privacyEl = document.getElementById("iuSilverWeatherPrivacy");
    const actionsFirst = document.getElementById("iuSilverWeatherActions");
    const btnGeo = document.getElementById("iuSilverWeatherBtnGeo");
    const btnCity = document.getElementById("iuSilverWeatherBtnCity");
    if (!card || !line1 || !line2) return;

    function iuSilverWeatherNavigateToWeather(){
      try{
        const el = document.querySelector('.iu-leftNavItem[data-accent="pocasi"]');
        if (el) { el.click(); return; }
      }catch{}
      try{
        const u = new URL(window.location.href);
        u.searchParams.set("section", "pocasi");
        window.location.href = u.toString();
      }catch{}
    }

    function iuSilverWeatherHasPersonalizedLocation(){
      try{
        return !!iuWeatherReadGpsSelected() || !!iuWeatherReadManualLocation();
      }catch{
        return false;
      }
    }

    function iuSilverWeatherGeoDeniedVisible(){
      try{
        const fb = window.__iuWeatherGeoFlowFeedback;
        if (!fb || String(fb.kind || "") !== "error") return false;
        const m = String(fb.message || "");
        if (m.indexOf("povolte") !== -1) return true;
        if (m.indexOf("Nelze získat polohu") !== -1) return true;
        if (m.indexOf("geolokace") !== -1) return true;
        return true;
      }catch{
        return false;
      }
    }

    function iuSilverWeatherComputePhase(){
      try{
        if (iuSilverWeatherGeoDeniedVisible() && iuWeatherReadLocationMode() === IU_WEATHER_MODE_GPS && !iuWeatherReadGpsSelected()) return "denied";
      }catch{}
      try{
        if (!iuSilverWeatherHasPersonalizedLocation()) return "firstVisit";
      }catch{}
      try{
        const st = window.__iuWeatherState;
        if (st && iuWeatherStateMatchesActiveCity(st) && st.current) return "data";
      }catch{}
      return "loading";
    }

    function iuSilverWeatherBestPrecipSoon(st){
      try{
        const nh = st && Array.isArray(st.nextHours) ? st.nextHours : [];
        let best = null;
        for (let i = 0; i < nh.length; i++){
          const it = nh[i];
          if (!it) continue;
          const p = it.precipProbability;
          if (typeof p !== "number" || !isFinite(p) || p < 25) continue;
          if (!best || p > best.p) best = { p, code: it.weatherCode, time: it.time };
        }
        if (!best || !best.time) return null;
        const now = new Date();
        const dt = best.time instanceof Date ? best.time : new Date(best.time);
        if (isNaN(dt.getTime())) return null;
        const dh = Math.max(0, (dt - now) / 3600000);
        if (dh > 12) return null;
        return { h: Math.max(1, Math.round(dh)), code: best.code };
      }catch{
        return null;
      }
    }

    function iuSilverWeatherGustMaxNext(st){
      try{
        const nh = st && Array.isArray(st.nextHours) ? st.nextHours : [];
        let g = null;
        for (let i = 0; i < nh.length; i++){
          const it = nh[i];
          if (!it) continue;
          const v = typeof it.windGustKph === "number" ? it.windGustKph : it.windKph;
          if (typeof v === "number" && isFinite(v)){
            if (g == null || v > g) g = v;
          }
        }
        return g;
      }catch{
        return null;
      }
    }

    function iuSilverWeatherDayPartIcon(st){
      try{
        const now = new Date();
        const daily = st.rawDaily;
        const { sr, ss } = iuWxFindDailySunriseSunsetForDate(daily, now);
        if (sr && ss){
          const tSr = new Date(String(sr)).getTime();
          const tSs = new Date(String(ss)).getTime();
          const tN = now.getTime();
          if (!isNaN(tSr) && !isNaN(tSs) && tSr < tSs){
            if (tN < tSr || tN >= tSs) return "🌙";
            const msH = 60 * 60 * 1000;
            if (tN >= tSr && tN < tSr + msH) return "🌅";
            if (tN >= tSs - msH && tN < tSs) return "🌅";
          }
        }
      }catch{}
      const c = st.current.weatherCode;
      const id = st.current.isDay;
      if (id === false) return "🌙";
      if (c === 0) return "☀️";
      if (c === 1 || c === 2) return "🌤";
      if (c === 3) return "⛅";
      return iuWxResolveWeatherIcon(c, true);
    }

    function iuSilverWeatherStatusShort(st){
      const c = Number(st.current.weatherCode);
      const soon = iuSilverWeatherBestPrecipSoon(st);
      const gustM = iuSilverWeatherGustMaxNext(st);
      if (isFinite(c) && c >= 95) return { icon: "⛈️", text: "Bouřky" };
      if (soon && soon.h){
        const ic = iuWxResolveWeatherIcon(soon.code != null ? soon.code : c, st.current.isDay);
        const what = iuWxInferPrecipText(soon.code != null ? soon.code : c);
        return { icon: ic, text: `${what} za ~${soon.h} h` };
      }
      if (isFinite(c) && ((c >= 51 && c <= 67) || (c >= 80 && c <= 82))) return { icon: "🌧️", text: "Déšť" };
      if (isFinite(c) && c >= 71 && c <= 77) return { icon: "❄️", text: "Sníh" };
      if (typeof gustM === "number" && isFinite(gustM) && gustM >= 45) return { icon: "🌬️", text: "Silný vítr" };
      if (isFinite(c) && ((c >= 45 && c <= 48) || c === 56)) return { icon: "🌫️", text: "Mlha / vlhko" };
      if (c === 0) return { icon: "☀️", text: "Beze srážek" };
      if (c === 1 || c === 2) return { icon: "🌤", text: "Proměnlivo" };
      if (c === 3) return { icon: "⛅", text: "Oblačno" };
      return { icon: iuWxResolveWeatherIcon(c, st.current.isDay), text: "Počasí" };
    }

    function iuSilverWeatherTipCategory(st){
      const c = Number(st.current.weatherCode);
      const soon = iuSilverWeatherBestPrecipSoon(st);
      const gustM = iuSilverWeatherGustMaxNext(st);
      const t = typeof st.current.temperatureC === "number" ? st.current.temperatureC : null;
      const fl = typeof st.current.feelsLikeC === "number" ? st.current.feelsLikeC : null;
      if (isFinite(c) && c >= 95) return "storm";
      if (soon && soon.h) return "rain";
      if (isFinite(c) && ((c >= 51 && c <= 67) || (c >= 80 && c <= 82))) return "rain";
      if (isFinite(c) && c >= 71 && c <= 77) return "snow";
      if (typeof gustM === "number" && isFinite(gustM) && gustM >= 45) return "wind";
      if ((typeof fl === "number" && fl <= 5) || (typeof t === "number" && t <= 2)) return "cold";
      if ((typeof t === "number" && t >= 28) || (typeof fl === "number" && fl >= 28)) return "heat";
      return "nice";
    }

    function iuSilverWeatherPickTip(st){
      const cat = iuSilverWeatherTipCategory(st);
      const seed = Math.abs(iuHashStr(String(iuDayKeyLocal()) + "|" + cat + "|" + String(st.lat) + "|" + String(st.lon)));
      const variants = {
        storm: ["💡⛈️ Hrozí bouřky, buď opatrný.", "💡⚡ Bouřky mohou být silné.", "💡⛈️ Počítej s bouřkami."],
        rain: ["💡☂️ Vezmi si deštník, bude se hodit.", "💡☂️ Pokud půjdeš ven, vezmi si deštník.", "💡🌧️ Vypadá to na déšť, vezmi si deštník."],
        snow: ["💡❄️ Může sněžit, počítej s tím.", "💡🧊 Pozor na kluzko.", "💡❄️ Sníh může komplikovat pohyb."],
        wind: ["💡🌬️ Foukat bude víc, raději se obleč tepleji.", "💡🌬️ Pozor na silný vítr.", "💡🌬️ Vítr může být nepříjemný."],
        cold: ["💡🧥 Je docela chladno, vezmi si bundu.", "💡🥶 Obleč se tepleji.", "💡🧥 Bez bundy to nepůjde."],
        heat: ["💡🥵 Je horko, nezapomeň na pitný režim.", "💡🥤 Dbej na dostatek tekutin.", "💡☀️ Vysoké teploty, chraň se před sluncem."],
        nice: ["💡☀️ Dnes to venku vypadá moc dobře.", "💡☀️ Ideální počasí na venek.", "💡🌤️ Bez nepříjemností."],
      };
      const list = variants[cat] || variants.nice;
      return list[seed % list.length];
    }

    function iuSilverWeatherRenderData(st){
      const dp = iuSilverWeatherDayPartIcon(st);
      const t = typeof st.current.temperatureC === "number" ? Math.round(st.current.temperatureC) : null;
      const fl = typeof st.current.feelsLikeC === "number" ? Math.round(st.current.feelsLikeC) : null;
      const stat = iuSilverWeatherStatusShort(st);
      const tip = iuSilverWeatherPickTip(st);
      const tStr = t != null ? `Venku je ${t} °C` : "Venku je —°C";
      const flStr = fl != null ? `Pocitově ${fl} °C` : "Pocitově —°C";
      line1.innerHTML =
        `<span class="silver-weather-dpart" aria-hidden="true">${escapeHtml(dp)}</span> ` +
        `<span data-iu-silver-weather-hook="temp">${escapeHtml(tStr)}</span>` +
        `<span class="silver-weather-line__sep" aria-hidden="true"> | </span>` +
        `<span data-iu-silver-weather-hook="feels">${escapeHtml(flStr)}</span>` +
        `<span class="silver-weather-line__sep" aria-hidden="true"> | </span>` +
        `<span class="silver-weather-stat" aria-hidden="true">${escapeHtml(stat.icon)}</span>` +
        `<span data-iu-silver-weather-hook="status"> ${escapeHtml(stat.text)}</span>`;
      line2.innerHTML = `<span data-iu-silver-weather-hook="tip">${escapeHtml(tip)}</span>`;
      try{
        card.setAttribute("data-iu-silver-wx-phase", "data");
        card.setAttribute("data-iu-silver-wx-tip", iuSilverWeatherTipCategory(st));
      }catch{}
    }

    function iuSilverWeatherRenderLoading(){
      line1.innerHTML =
        `<span class="silver-weather-dpart" aria-hidden="true">🌤️</span> ` +
        `<span data-iu-silver-weather-hook="summary">Počasí se načítá…</span>`;
      line2.innerHTML = `<span data-iu-silver-weather-hook="tip">💡 Za chvíli ho ukážeme tady.</span>`;
      try{ card.setAttribute("data-iu-silver-wx-phase", "loading"); }catch{}
    }

    function iuSilverWeatherRenderFirstVisit(){
      line1.innerHTML =
        `<span class="silver-weather-dpart" aria-hidden="true">🌤️</span> ` +
        `<span>Zobrazit počasí pro tvoji polohu?</span>`;
      line2.innerHTML = `<span>💡📍 Povolit polohu a ukážeme ti počasí hned tady.</span>`;
      try{
        card.setAttribute("data-iu-silver-wx-phase", "firstVisit");
        if (privacyEl) privacyEl.hidden = false;
        if (actionsFirst) actionsFirst.hidden = false;
        if (btnGeo) btnGeo.hidden = false;
        if (btnCity) btnCity.hidden = false;
      }catch{}
    }

    function iuSilverWeatherRenderDenied(){
      line1.innerHTML =
        `<span class="silver-weather-dpart" aria-hidden="true">🌤️</span> ` +
        `<span>Počasí ještě není nastavené</span>`;
      line2.innerHTML = `<span>💡🏙️ Vyber si svoje město a budeme ho ukazovat tady.</span>`;
      try{
        card.setAttribute("data-iu-silver-wx-phase", "denied");
        if (privacyEl) privacyEl.hidden = true;
        if (actionsFirst) actionsFirst.hidden = false;
        if (btnGeo) btnGeo.hidden = true;
        if (btnCity) btnCity.hidden = false;
      }catch{}
    }

    function iuSilverWeatherHideAllActions(){
      try{
        if (privacyEl) privacyEl.hidden = true;
        if (actionsFirst) actionsFirst.hidden = true;
        if (btnGeo) btnGeo.hidden = false;
        if (btnCity) btnCity.hidden = false;
      }catch{}
    }

    function iuSilverWeatherRefresh(){
      try{
        const phase = iuSilverWeatherComputePhase();
        iuSilverWeatherHideAllActions();
        if (phase === "denied"){
          iuSilverWeatherRenderDenied();
          return;
        }
        if (phase === "firstVisit"){
          iuSilverWeatherRenderFirstVisit();
          return;
        }
        if (phase === "loading"){
          iuSilverWeatherRenderLoading();
          if (typeof window.iuWeatherEnsureState !== "function") return;
          window.iuWeatherEnsureState()
            .then((st) => {
              if (!st || !iuWeatherStateMatchesActiveCity(st)) return;
              iuSilverWeatherRenderData(st);
            })
            .catch(() => {
              try{ iuSilverWeatherRenderLoading(); }catch{}
            });
          return;
        }
        if (phase === "data"){
          const st = window.__iuWeatherState;
          if (st && st.current) iuSilverWeatherRenderData(st);
          else iuSilverWeatherRenderLoading();
        }
      }catch{}
    }

    try{
      card.addEventListener("click", (ev) => {
        try{
          if (ev.target && ev.target.closest && ev.target.closest("button, a")) return;
          const ph = String(card.getAttribute("data-iu-silver-wx-phase") || "");
          if (ph === "data") iuSilverWeatherNavigateToWeather();
        }catch{}
      });
    }catch{}

    function wireBtn(el, fn){
      if (!el) return;
      el.addEventListener("click", (e) => {
        try{
          e.preventDefault();
          e.stopPropagation();
        }catch{}
        try{ fn(); }catch{}
      });
    }
    wireBtn(btnGeo, () => {
      try{
        iuSilverWeatherNavigateToWeather();
        setTimeout(() => {
          try{
            if (typeof window.iuWeatherActivateGpsViaGeolocation === "function") window.iuWeatherActivateGpsViaGeolocation();
          }catch{}
        }, 180);
      }catch{}
    });
    wireBtn(btnCity, () => {
      try {
        iuSilverWeatherNavigateToWeather();
        setTimeout(() => {
          try{
            if (typeof window.iuWeatherOpenMapPicker === "function") window.iuWeatherOpenMapPicker();
          }catch{}
        }, 180);
      }catch{}
    });

    try{
      const orig = window.iuWeatherLoadAndRender;
      if (typeof orig === "function" && !window.__iuSilverWeatherHookedLoadRender) {
        window.__iuSilverWeatherHookedLoadRender = 1;
        window.iuWeatherLoadAndRender = async function(){
          const r = await orig.apply(this, arguments);
          try{ iuSilverWeatherRefresh(); }catch{}
          return r;
        };
      }
    }catch{}

    try{
      window.addEventListener("storage", (e) => {
        const k = String(e.key || "");
        if (k === "iu_location_mode" || k === "iu_manual_location" || k.indexOf("iuWeather") !== -1) {
          try{ iuSilverWeatherRefresh(); }catch{}
        }
      });
    }catch{}

    try{
      window.addEventListener("iu-silver-wx-refresh", () => {
        try{ iuSilverWeatherRefresh(); }catch{}
      });
    }catch{}

    window.iuSilverWeatherRefresh = iuSilverWeatherRefresh;
    iuSilverWeatherRefresh();
    try{ setInterval(() => { try{ iuSilverWeatherRefresh(); }catch{} }, 45000); }catch{}
  }

  /** P0 Mobile gate: on mobile move Silver + rail + MindMenu into gate; on desktop restore. Tab state: nav | tools | none. */
  function iuMobileGateReorder() {
    try {
      var wrap = document.getElementById("iuMobileGateWrap");
      var silverSlot = document.getElementById("iuMobileSilverSlot");
      var panelNav = document.getElementById("iuMobileGatePanelNav");
      var panelTools = document.getElementById("iuMobileGatePanelTools");
      var silver = document.getElementById("silver-slot");
      var topCardsStack = document.getElementById("iuSilverTopCardsStack");
      var rail = document.getElementById("iuLeftRail");
      var mindMenuFlow = document.getElementById("iuMobileMindMenuFlow");
      var newsList = document.getElementById("newsList");
      var feed = document.getElementById("feed");
      var accordion = document.querySelector(".layout > aside.accordionCol");
      if (!wrap || !silverSlot || !panelNav || !panelTools || !silver || !rail || !newsList || !feed) return;
      var mq = window.matchMedia && window.matchMedia("(max-width: 900px)");
      var mobile = mq ? mq.matches : (window.innerWidth <= 900);
      var mqMind = window.matchMedia && window.matchMedia("(max-width: 1023px)");
      var mobileMind = mqMind ? mqMind.matches : (window.innerWidth < 1024);
      var flowHomeId = "iuMobileMindMenuFlowHome";
      var flowHome = document.getElementById(flowHomeId);
      if (!flowHome && mindMenuFlow && mindMenuFlow.parentElement) {
        flowHome = document.createElement("div");
        flowHome.id = flowHomeId;
        flowHome.hidden = true;
        flowHome.setAttribute("aria-hidden", "true");
        mindMenuFlow.parentElement.insertBefore(flowHome, mindMenuFlow);
      }
      if (mobile) {
        wrap.setAttribute("aria-hidden", "false");
        if (!silverSlot.contains(silver)) {
          var articlesStage = feed && feed.parentNode;
          if (articlesStage) {
            silverSlot.appendChild(silver);
          }
        }
        if (!panelNav.contains(rail)) {
          panelNav.appendChild(rail);
        }
        if (mobileMind && mindMenuFlow) {
          if (!panelTools.contains(mindMenuFlow)) {
            panelTools.appendChild(mindMenuFlow);
          }
          mindMenuFlow.style.setProperty("display", "block", "important");
          mindMenuFlow.style.width = "100%";
          mindMenuFlow.style.maxWidth = "100%";
          mindMenuFlow.style.minWidth = "0";
          var mindMenu = document.querySelector(".mindMenu");
          if (mindMenu && !mindMenuFlow.style.minHeight) {
            var reserveH = Math.ceil(mindMenu.getBoundingClientRect().height || mindMenu.offsetHeight || 0);
            if (reserveH > 0) mindMenuFlow.style.minHeight = reserveH + "px";
          }
          if (mindMenu && mindMenu.parentElement !== mindMenuFlow) {
            mindMenuFlow.insertBefore(mindMenu, mindMenuFlow.firstChild || null);
          }
          var toolsSection = mindMenu ? mindMenu.querySelector("section.iu-mmQuickLinks") : null;
          if (toolsSection) {
            var gridInTools = toolsSection.querySelector(".iu-mmQuickGrid");
            if (gridInTools) {
              gridInTools.style.display = "grid";
              gridInTools.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
              gridInTools.style.gap = "10px 12px";
            }
          }
          var topTools = mindMenu ? mindMenu.querySelector(".iu-mmTopTools") : null;
          if (topTools) {
            topTools.style.removeProperty("min-height");
            topTools.style.removeProperty("height");
          }
          var mailboxList = mindMenu ? mindMenu.querySelector("#iuMailboxList") : null;
          if (mailboxList) mailboxList.style.minHeight = "262px";
          var mailboxesSection = mindMenu ? mindMenu.querySelector("section.iu-mailboxes") : null;
          if (mailboxesSection) mailboxesSection.style.minHeight = "340px";
          var staleWrapper = mindMenuFlow.querySelector(".mindMenu-scroll-wrapper");
          if (staleWrapper && !staleWrapper.querySelector(".mindMenu")) {
            staleWrapper.remove();
          }
        }
      } else {
        wrap.setAttribute("aria-hidden", "true");
        if (silverSlot.contains(silver)) {
          if (topCardsStack) {
            topCardsStack.appendChild(silver);
          } else {
            var stage = feed && feed.parentNode;
            if (stage) {
              stage.insertBefore(silver, feed);
            }
          }
        }
        if (panelNav.contains(rail)) {
          var afterEmpty = document.getElementById("emptyBox");
          newsList.insertBefore(rail, afterEmpty ? afterEmpty.nextSibling : newsList.firstChild);
        }
        var mindMenuDesktop = document.querySelector(".mindMenu");
        if (mindMenuDesktop && accordion && !accordion.contains(mindMenuDesktop)) {
          var wrapper = accordion.querySelector(".mindMenu-scroll-wrapper");
          var afterPwa = accordion.querySelector("#iuPwaDesktopFallbackOverlay");
          if (wrapper) {
            if (!wrapper.contains(mindMenuDesktop)) wrapper.appendChild(mindMenuDesktop);
            accordion.insertBefore(wrapper, afterPwa ? afterPwa.nextSibling : accordion.firstChild);
          } else {
            accordion.insertBefore(mindMenuDesktop, afterPwa ? afterPwa.nextSibling : accordion.firstChild);
          }
        }
        if (mindMenuFlow && flowHome && mindMenuFlow.parentElement !== flowHome.parentElement) {
          flowHome.parentElement.insertBefore(mindMenuFlow, flowHome.nextSibling);
        }
      }
      if (!mobileMind && accordion) {
        if (mindMenuFlow) {
          mindMenuFlow.style.minHeight = "";
          mindMenuFlow.style.removeProperty("display");
          mindMenuFlow.style.width = "";
          mindMenuFlow.style.maxWidth = "";
          mindMenuFlow.style.minWidth = "";
        }
        var mindMenuDesktopAlways = document.querySelector(".mindMenu");
        if (mindMenuDesktopAlways && !accordion.contains(mindMenuDesktopAlways)) {
          var wrapperAlways = accordion.querySelector(".mindMenu-scroll-wrapper");
          var afterPwaDesktop = accordion.querySelector("#iuPwaDesktopFallbackOverlay");
          if (wrapperAlways) {
            if (!wrapperAlways.contains(mindMenuDesktopAlways)) wrapperAlways.appendChild(mindMenuDesktopAlways);
            var toolsSectionDesktop = accordion.querySelector("section.iu-mmQuickLinks");
            if (toolsSectionDesktop && !mindMenuDesktopAlways.contains(toolsSectionDesktop)) {
              mindMenuDesktopAlways.appendChild(toolsSectionDesktop);
            }
            var gridDesktop = toolsSectionDesktop ? toolsSectionDesktop.querySelector(".iu-mmQuickGrid") : null;
            if (gridDesktop) {
              gridDesktop.style.display = "";
              gridDesktop.style.gridTemplateColumns = "";
              gridDesktop.style.gap = "";
            }
            var topToolsDesktop = mindMenuDesktopAlways.querySelector(".iu-mmTopTools");
            if (topToolsDesktop) {
              topToolsDesktop.style.minHeight = "";
              topToolsDesktop.style.height = "";
            }
            var mailboxListDesktop = mindMenuDesktopAlways.querySelector("#iuMailboxList");
            if (mailboxListDesktop) mailboxListDesktop.style.minHeight = "";
            var mailboxesSectionDesktop = mindMenuDesktopAlways.querySelector("section.iu-mailboxes");
            if (mailboxesSectionDesktop) mailboxesSectionDesktop.style.minHeight = "";
            accordion.insertBefore(wrapperAlways, afterPwaDesktop ? afterPwaDesktop.nextSibling : accordion.firstChild);
          } else {
            accordion.insertBefore(mindMenuDesktopAlways, afterPwaDesktop ? afterPwaDesktop.nextSibling : accordion.firstChild);
          }
        }
      }
    } catch (_) {}
  }

  /** P0 Mobile gate: tab click — only one section open; use existing left rail / MindMenu; back button. */
  function iuMobileGateTabInit() {
    try {
      var wrap = document.getElementById("iuMobileGateWrap");
      var tabNav = document.getElementById("iuMobileGateTabNav");
      var tabTools = document.getElementById("iuMobileGateTabTools");
      var panelNav = document.getElementById("iuMobileGatePanelNav");
      var panelTools = document.getElementById("iuMobileGatePanelTools");
      var content = document.getElementById("iuMobileGateContent");
      var backBar = document.getElementById("iuMobileGateBackBar");
      var backBtn = document.getElementById("iuMobileGateBack");
      var mainBackBtn = document.getElementById("iuMobileMainBack");
      if (!wrap || !tabNav || !tabTools || !panelNav || !panelTools || !content) return;
      function setTab(value) {
        wrap.setAttribute("data-iu-mobile-gate", value || "");
        var bar = document.getElementById("iuMobileGateBackBar");
        if (bar) bar.hidden = !value;
        if (panelTools && panelTools.classList) {
          if (value === "tools") panelTools.classList.add("accordionCol");
          else panelTools.classList.remove("accordionCol");
        }
        if (value === "nav") {
          tabNav.setAttribute("aria-selected", "true");
          tabTools.setAttribute("aria-selected", "false");
          content.setAttribute("aria-hidden", "false");
          panelNav.hidden = false;
          panelTools.hidden = true;
        } else if (value === "tools") {
          tabNav.setAttribute("aria-selected", "false");
          tabTools.setAttribute("aria-selected", "true");
          content.setAttribute("aria-hidden", "false");
          panelNav.hidden = true;
          panelTools.hidden = false;
        } else {
          tabNav.setAttribute("aria-selected", "false");
          tabTools.setAttribute("aria-selected", "false");
          content.setAttribute("aria-hidden", "true");
          panelNav.hidden = true;
          panelTools.hidden = true;
          try { document.body.classList.remove("iu-mobileMainVisible"); } catch (_) {}
          var mb = document.getElementById("iuMobileMainBackBar");
          if (mb) mb.hidden = true;
        }
      }
      if (backBtn) {
        backBtn.addEventListener("click", function () {
          setTab("");
        });
      }
      if (mainBackBtn) {
        mainBackBtn.addEventListener("click", function () {
          try { document.body.classList.remove("iu-mobileMainVisible"); } catch (_) {}
          setTab("");
        });
      }
      tabNav.addEventListener("click", function () {
        var cur = wrap.getAttribute("data-iu-mobile-gate");
        setTab(cur === "nav" ? "" : "nav");
      });
      var lastToolsToggleTs = 0;
      function iuMindMenuDebugEnabled() {
        try {
          if (typeof window.iuIsProdHost === "function" && window.iuIsProdHost()) return false;
          if (window.IU_MINDMENU_DEBUG === true) return true;
          var qs = new URLSearchParams(window.location.search || "");
          return qs.get("iuMindMenuDebug") === "1";
        } catch (_) {
          return false;
        }
      }
      function iuMindMenuNodeLabel(node) {
        try {
          if (!node) return "null";
          if (node === window) return "window";
          if (node === document) return "document";
          if (node === document.scrollingElement) return "document.scrollingElement";
          var tag = (node.tagName || "node").toLowerCase();
          var id = node.id ? ("#" + node.id) : "";
          var cls = "";
          if (node.classList && node.classList.length) cls = "." + Array.from(node.classList).slice(0, 3).join(".");
          return tag + id + cls;
        } catch (_) {
          return "unknown";
        }
      }
      function iuEnsureMindMenuDebugPanel() {
        try {
          if (!iuMindMenuDebugEnabled()) return null;
          var existing = document.getElementById("iuMindMenuDebugPanel");
          if (existing) return existing;
          var panel = document.createElement("div");
          panel.id = "iuMindMenuDebugPanel";
          panel.setAttribute("aria-label", "MindMenu debug panel");
          panel.style.position = "fixed";
          panel.style.left = "8px";
          panel.style.right = "8px";
          panel.style.bottom = "8px";
          panel.style.zIndex = "2147483646";
          panel.style.background = "#0f172a";
          panel.style.color = "#e2e8f0";
          panel.style.border = "1px solid rgba(148,163,184,0.45)";
          panel.style.borderRadius = "10px";
          panel.style.padding = "8px";
          panel.style.maxHeight = "44vh";
          panel.style.overflow = "auto";
          panel.style.boxShadow = "0 8px 24px rgba(0,0,0,0.35)";
          panel.style.font = "12px/1.35 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace";
          var controls = document.createElement("div");
          controls.style.display = "flex";
          controls.style.gap = "6px";
          controls.style.flexWrap = "wrap";
          controls.style.marginBottom = "6px";
          var btnShow = document.createElement("button");
          btnShow.type = "button";
          btnShow.id = "iuMindMenuDebugShow";
          btnShow.textContent = "Zobraz debug";
          var btnCopy = document.createElement("button");
          btnCopy.type = "button";
          btnCopy.id = "iuMindMenuDebugCopy";
          btnCopy.textContent = "Kopírovat JSON";
          var btnClose = document.createElement("button");
          btnClose.type = "button";
          btnClose.id = "iuMindMenuDebugClose";
          btnClose.textContent = "Zavřít";
          [btnShow, btnCopy, btnClose].forEach(function (b) {
            b.style.border = "1px solid rgba(148,163,184,0.55)";
            b.style.background = "#1e293b";
            b.style.color = "#e2e8f0";
            b.style.borderRadius = "8px";
            b.style.padding = "6px 8px";
            b.style.cursor = "pointer";
          });
          var pre = document.createElement("pre");
          pre.id = "iuMindMenuDebugPre";
          pre.hidden = true;
          pre.style.margin = "0";
          pre.style.whiteSpace = "pre-wrap";
          pre.style.wordBreak = "break-word";
          pre.style.maxHeight = "28vh";
          pre.style.overflow = "auto";
          pre.style.padding = "8px";
          pre.style.borderRadius = "8px";
          pre.style.background = "#020617";
          var toast = document.createElement("div");
          toast.id = "iuMindMenuDebugToast";
          toast.hidden = true;
          toast.textContent = "Zkopirovano";
          toast.style.marginTop = "6px";
          toast.style.fontWeight = "600";
          toast.style.color = "#86efac";
          controls.appendChild(btnShow);
          controls.appendChild(btnCopy);
          controls.appendChild(btnClose);
          panel.appendChild(controls);
          panel.appendChild(pre);
          panel.appendChild(toast);
          function render() {
            try {
              pre.textContent = JSON.stringify(window.__iuDumpMindMenuDebug ? window.__iuDumpMindMenuDebug() : null, null, 2) || "{}";
            } catch (_) {
              pre.textContent = "{}";
            }
          }
          function showToast() {
            toast.hidden = false;
            window.setTimeout(function () { toast.hidden = true; }, 1200);
          }
          btnShow.addEventListener("click", function () {
            render();
            pre.hidden = false;
          });
          btnCopy.addEventListener("click", function () {
            render();
            var txt = pre.textContent || "{}";
            var p = navigator && navigator.clipboard && navigator.clipboard.writeText
              ? navigator.clipboard.writeText(txt)
              : Promise.reject(new Error("no-clipboard"));
            p.catch(function () {
              try {
                pre.hidden = false;
                var sel = window.getSelection && window.getSelection();
                if (!sel) return;
                var range = document.createRange();
                range.selectNodeContents(pre);
                sel.removeAllRanges();
                sel.addRange(range);
                document.execCommand("copy");
                sel.removeAllRanges();
              } catch (_) {}
            }).finally(showToast);
          });
          btnClose.addEventListener("click", function () {
            panel.remove();
          });
          panel.__iuRender = render;
          document.body.appendChild(panel);
          return panel;
        } catch (_) {
          return null;
        }
      }
      function iuMindMenuDebugRenderIfOpen() {
        try {
          if (!iuMindMenuDebugEnabled()) return;
          var panel = document.getElementById("iuMindMenuDebugPanel") || iuEnsureMindMenuDebugPanel();
          if (!panel || typeof panel.__iuRender !== "function") return;
          var pre = document.getElementById("iuMindMenuDebugPre");
          if (pre && !pre.hidden) panel.__iuRender();
        } catch (_) {}
      }
      try {
        window.__iuDumpMindMenuDebug = function () {
          return window.__iuMindMenuDebug || null;
        };
      } catch (_) {}
      try {
        if (iuMindMenuDebugEnabled()) {
          if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", iuEnsureMindMenuDebugPanel, { once: true });
          } else {
            iuEnsureMindMenuDebugPanel();
          }
        }
      } catch (_) {}
      function iuHandleToolsTabClick(ev) {
        var now = Date.now();
        if (now - lastToolsToggleTs < 120) return;
        lastToolsToggleTs = now;
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
        var cur = wrap.getAttribute("data-iu-mobile-gate");
        setTab(cur === "tools" ? "" : "tools");
      }
      tabTools.addEventListener("click", iuHandleToolsTabClick);
      setTab("");
    } catch (_) {}
  }

  /** P0 Mobile layout: reorder — on mobile use gate (Silver first + 2-tab); on desktop restore. */
  function iuMobileLayoutReorder() {
    try {
      iuMobileGateReorder();
      var mq = window.matchMedia && window.matchMedia("(max-width: 900px)");
      var mobile = mq ? mq.matches : (window.innerWidth <= 900);
      if (mobile) return;
      var accordion = document.querySelector(".layout > aside.accordionCol");
      var mainCol = document.querySelector(".layout > .mainCol");
      var leftContent = document.getElementById("leftContent");
      var block = document.getElementById("iuMobileFirstBlock");
      var rail = document.getElementById("iuLeftRail");
      if (!accordion || !mainCol) return;
      if (block && block.contains(rail)) {
        var newsList = document.getElementById("newsList");
        if (newsList) {
          var afterEmpty = document.getElementById("emptyBox");
          newsList.insertBefore(rail, afterEmpty ? afterEmpty.nextSibling : newsList.firstChild);
        }
      }
      if (mainCol.contains(accordion)) {
        var layout = document.querySelector(".layout");
        if (layout) layout.appendChild(accordion);
      }
    } catch (_) {}
  }
  try { window.iuMobileLayoutReorder = iuMobileLayoutReorder; } catch (_) {}

  function iuInitMobileFocusAccordion() {
    try {
      const root = document.getElementById("iuMobileFocus");
      if (!root) return;

      const elActive = root.querySelector(".iuMobileFocusActive");
      const elTiles = root.querySelector(".iuMobileFocusTiles");
      if (!elActive || !elTiles) return;

      const mq = window.matchMedia ? window.matchMedia("(max-width: 900px)") : null;
      const isMobile = () => (mq ? Boolean(mq.matches) : (window.innerWidth <= 900));
      if (!isMobile()) return;

      if (window.__iu_mobileFocusInit) return;
      window.__iu_mobileFocusInit = 1;

      const mindMenuEl = iuGetMindMenuRoot();
      const mindMenuTargetKey = "__iu_mindmenu__";

      const railToTarget = {
        media: "#feed",
        radio: "#iuRadioView",
        tvonline: "#iuTvOnlineView",
        jr: "#iuJrEmptyView",
        maps: "#iuMapyView",
        travel: "#iuTravelView",
        weather: "#iuWeatherView",
        tvprogram: "#iuTvProgramView",
      };

      function readSectionsFromLeftRail() {
        const out = [];
        // 1) MindMenu is always first
        out.push({ label: "MindMenu", target: mindMenuTargetKey, accent: "mindmenu" });

        // 2) Others in the same order as PC left rail
        const items = Array.from(document.querySelectorAll(".iu-leftNavItem[data-rail][data-accent]"));
        for (const it of items) {
          try {
            const rail = String(it.getAttribute("data-rail") || "").trim();
            const accent = String(it.getAttribute("data-accent") || "").trim();
            const labelEl = it.querySelector(".iu-leftNavLabel");
            const label = String(labelEl ? labelEl.textContent : it.textContent || "").trim();
            if (!label) continue;
            const target = railToTarget[rail];
            if (target) {
              out.push({ label, target, accent: accent || rail });
              continue;
            }
            // Culture / Ads: tiles exist but view not yet implemented → placeholder panel
            if (rail === "culture" || rail === "ads") {
              out.push({ label, placeholder: true, accent: accent || rail });
              continue;
            }
          } catch {}
        }

        // Ensure Culture + Ads tiles exist even if rail changes.
        try{
          const have = new Set(out.map((s) => String(s && s.accent || "")));
          if (!have.has("culture")) out.push({ label: "Kultura / Akce", placeholder: true, accent: "culture" });
          if (!have.has("ads")) out.push({ label: "Inzerce", placeholder: true, accent: "ads" });
        }catch{}

        return out;
      }

      const sections = readSectionsFromLeftRail();

      const state = {
        isOpen: false,
        active: null,
        movedEl: null,
        movedFrom: null,
        movedNext: null,
        hiddenBefore: null,
      };

      function resolveTarget(sel) {
        try {
          if (sel === mindMenuTargetKey) return (mindMenuEl && mindMenuEl instanceof HTMLElement) ? mindMenuEl : null;
          const el = document.querySelector(sel);
          return (el && el instanceof HTMLElement) ? el : null;
        } catch {
          return null;
        }
      }

      function render() {
        const tilesHtml = sections.map((s) => {
          const isPlaceholder = !!(s && s.placeholder);
          const target = String((s && s.target) || "");
          const hasTarget = !isPlaceholder && !!resolveTarget(target);
          const disabled = isPlaceholder ? "" : (hasTarget ? "" : " disabled");
          const dataTarget = isPlaceholder ? "" : ` data-target="${escapeHtml(target)}"`;
          const dataPlaceholder = isPlaceholder ? ` data-placeholder="1"` : "";
          return `<button type="button" class="iuMobileTile"${dataTarget}${dataPlaceholder} data-accent="${escapeHtml(s.accent)}" aria-expanded="false"${disabled}>${escapeHtml(s.label)}</button>`;
        }).join("");

        elTiles.innerHTML = tilesHtml;

        if (!state.active) {
          elActive.innerHTML = "";
          return;
        }

        const activeBtn = `<button type="button" class="iuMobileFocusBtn iuMobileFocusBtn--active" data-target="${escapeHtml(state.active.target || "")}" data-placeholder="${state.active.placeholder ? "1" : ""}" data-accent="${escapeHtml(state.active.accent)}" aria-expanded="true">${escapeHtml(state.active.label)}</button>`;
        elActive.innerHTML = `${activeBtn}<div class="iuMobileFocusPanel" id="iuMobileFocusPanel"></div>`;
      }

      function openSection(s) {
        state.isOpen = true;
        state.active = s;
        root.classList.add("is-open");
        render();

        const panel = document.getElementById("iuMobileFocusPanel");
        if (!panel) return;

        // Placeholder sections (culture/ads) — no view yet.
        if (s && s.placeholder) {
          try{
            const ph = document.createElement("div");
            ph.className = "iuMobileFocusPlaceholder";
            ph.textContent = "Připravujeme";
            panel.appendChild(ph);
            state.placeholderEl = ph;
          }catch{}
          return;
        }

        const el = resolveTarget(s.target);
        if (!el) return;

        // Move the target DOM under the active button (safe reparent with restore).
        state.movedEl = el;
        state.movedFrom = el.parentElement;
        state.movedNext = el.nextSibling;
        try { state.movedWasHidden = Boolean(el.hidden); } catch {}
        try { panel.appendChild(el); } catch {}
        try { el.hidden = false; } catch {}
      }

      function closeSection() {
        root.classList.remove("is-open");
        state.isOpen = false;

        // Remove placeholder if used.
        try{
          if (state.placeholderEl && state.placeholderEl.remove) state.placeholderEl.remove();
        }catch{}

        // Restore moved view back to original parent/position.
        try {
          const el = state.movedEl;
          if (el && state.movedFrom) {
            if (state.movedNext && state.movedNext.parentNode === state.movedFrom) {
              state.movedFrom.insertBefore(el, state.movedNext);
            } else {
              state.movedFrom.appendChild(el);
            }
            try { el.hidden = !!state.movedWasHidden; } catch {}
          }
        } catch {}

        state.active = null;
        state.movedEl = null;
        state.movedFrom = null;
        state.movedNext = null;
        state.hiddenBefore = null;
        state.placeholderEl = null;
        state.movedWasHidden = null;
        render();
      }

      function onClick(e) {
        const t = e && e.target;
        const focusBtn = t && t.closest ? t.closest(".iuMobileFocusBtn") : null;
        if (focusBtn && root.contains(focusBtn)) {
          // second click on active button closes
          closeSection();
          return;
        }

        const tile = t && t.closest ? t.closest(".iuMobileTile") : null;
        if (!tile || !root.contains(tile)) return;
        const target = String(tile.getAttribute("data-target") || "").trim();
        const isPlaceholder = String(tile.getAttribute("data-placeholder") || "") === "1";
        const accent = String(tile.getAttribute("data-accent") || "").trim();
        const label = String(tile.textContent || "").trim();

        if (root.classList.contains("is-open")) return;
        if (isPlaceholder) {
          openSection({ label, placeholder: true, accent });
          return;
        }
        if (!target) return;
        openSection({ label, target, accent });
      }

      render();
      root.addEventListener("click", onClick);

      // On breakpoint change, always restore DOM to avoid desktop breakage.
      try{
        const onMq = () => {
          if (!isMobile()) {
            try{ closeSection(); }catch{}
            return;
          }
          // entering mobile: reset to tiles (no content)
          try{ closeSection(); }catch{}
        };
        if (mq && typeof mq.addEventListener === "function") mq.addEventListener("change", onMq);
        else if (mq && typeof mq.addListener === "function") mq.addListener(onMq);
      }catch{}
    } catch {}
  }

  function writeDebug(obj) {
    if (!elDebugOut) return;
    try {
      elDebugOut.textContent = safeStringify(obj, null, 2);
    } catch {
      elDebugOut.textContent = String(obj);
    }
  }

  function openSearchModal() {
    if (searchModal) searchModal.classList.add("show");
  }

  function hideSearchModal() {
    if (searchModal) searchModal.classList.remove("show");
  }

  function resetSearchAndReload() {
    if (searchInputEl) searchInputEl.value = "";
    hideSearchModal();
    applyFilter();
  }

  // === LOCKED PIPELINE ===
  // Jakákoli změna této funkce MUSÍ respektovat invarianty feedu.
  // Druhá render cesta je zakázaná.
  function applyFilter(opts) {
    const options = opts && typeof opts === "object" ? opts : {};
    const resetPage = options.resetPage !== false; // default: reset
    const doRender = options.render !== false;     // default: render
    if (!state.hasLoadedData) return;
    state.searchQuery = (searchInputEl && searchInputEl.value.trim()) || "";
    // paging reset on any filter/search change (render-only)
    if (resetPage) state.page = 1;

    // SAFETY: pokud není aktivní žádné téma/sekce/filtr ani hledání, zobraz rovnou celý cache feed
    const hasTopic = !!(state && state.activeTopic);
    const hasSection = !!(state && state.activeSection);
    const hasFilter = !!(state && state.activeFilter);
    const hasQuery = !!(state && typeof state.searchQuery === "string" && state.searchQuery.trim().length);

    if (!hasTopic && !hasSection && !hasFilter && !hasQuery) {
      state.filteredItems = Array.isArray(state.cachedItems) ? state.cachedItems.slice() : [];
      if (doRender) renderItems(state.filteredItems);
      return;
    }

    if (
      !state.activeSection &&
      !state.activeTopic &&
      !state.activeFilter
    ) {
      state.filteredItems = Array.isArray(state.cachedItems)
        ? state.cachedItems.slice()
        : [];
      if (doRender) renderItems(state.filteredItems);
      return;
    }

    if (
      !state.activeSection &&
      !state.activeTopic &&
      !state.activeFilter
    ) {
      state.filteredItems = Array.isArray(state.cachedItems)
        ? state.cachedItems.slice()
        : [];
      if (doRender) renderItems(state.filteredItems);
      return;
    }

    debugLog(
      "[FILTER]",
      "section:", state.activeSection,
      "topic:", state.activeTopic,
      "filter:", state.activeFilter,
      "cached:", state.cachedItems?.length,
      "filtered:", state.filteredItems?.length
    );
    const query = state.searchQuery || "";
    const normalizedQuery = query.toLowerCase();
    const sectionsToUse = activeSections && activeSections.length ? activeSections : ["vse"];
    let filtered = state.cachedItems.filter((item) => matchesSections(item, sectionsToUse));
    if (normalizedQuery) {
      filtered = filtered.filter((item) => {
        const type = String(item.contentType || "article").toLowerCase();
        if (type === "ad") return true;
        const haystackData = [
          item.title,
          item.name,
          item.summary,
          item.section,
          item.topic,
          item.channel,
          ...(Array.isArray(item.sources) ? item.sources.map((s) => s.name || s.title || s) : []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystackData.includes(normalizedQuery);
      });
    }
    state.filteredItems = filtered;

    if (filtered.length === 0) {
      if (query) {
        if (doRender) openSearchModal();
      } else {
        if (doRender) hideSearchModal();
        renderInlineError("Filtry nenašly žádné články.");
      }
      if (doRender) setStatus(`Stav dat: OK (zobrazeno: 0 / celkem: ${state.cachedItems.length})`);
      if (isDebugOn()) {
        writeDebug({
          sections: activeSections,
          hash: location.hash,
          search: query,
          totalItems: state.cachedItems.length,
          filtered: 0,
        });
      }
      return;
    }
    if (!Array.isArray(state.filteredItems)) {
      persistLastError("Invariant breach: filteredItems is not array");
      state.filteredItems = [];
    }

    if (doRender) {
      hideSearchModal();
      renderItems(filtered);
      setStatus(`Stav dat: OK (zobrazeno: ${filtered.length} / celkem: ${state.cachedItems.length})`);
    }
    if (isDebugOn()) {
      writeDebug({
        sections: activeSections,
        hash: location.hash,
        search: query,
        totalItems: state.cachedItems.length,
        filtered: filtered.length,
      });
    }
  }

    ensureFallbackMessage();


  let firstLoadQuiet = false;

  function safeNumber(value, fallback = 0) {
    const num = Number(value);
    if (Number.isNaN(num)) {
      debugWarn("[SAFE] invalid number", value);
      return fallback;
    }
    return num;
  }

  const selfDiag = {
    build: getBuildStamp() || "no-build",
    articlesState: "INIT",
    articlesCount: "-",
    videosState: "INIT",
    videosCount: "-",
    swController: "no",
    swWaiting: "no"
  };

  let refreshInProgress = false;

  async function softRefreshData() {
    if (refreshInProgress) return;
    refreshInProgress = true;
    debugLog("[REFRESH] start");
    try {
      await Promise.all([fetchArticlesStatus(), fetchVideosStatus()]);
      await loadData();
    } catch (error) {
      debugWarn("[REFRESH] error", error && error.message ? error.message : error);
    } finally {
      refreshInProgress = false;
      debugLog("[REFRESH] done");
    }
  }

  function safeDateParse(value) {
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        debugWarn("[DATE] invalid", value);
        return null;
      }
      return date;
    } catch {
      debugWarn("[DATE] invalid", value);
      return null;
    }
  }

  function logSelfStatus() {
    debugLog(`[SELF] build=${selfDiag.build}`);
    debugLog(`[SELF] articles=${selfDiag.articlesState} count=${selfDiag.articlesCount}`);
    debugLog(`[SELF] videos=${selfDiag.videosState} count=${selfDiag.videosCount}`);
    debugLog(`[SELF] swController=${selfDiag.swController} swWaiting=${selfDiag.swWaiting}`);
  }

  function renderDiagBox() {
    const isDiag = new URLSearchParams(location.search).get("diag") === "1";
    if (!isDiag) return;
    const box = document.createElement("div");
    box.id = "iuDiagBox";
    const updatedLabel = document.getElementById("dataStatusUpdated")?.textContent || "Aktualizace: —";
    const swLabel = document.getElementById("dataStatusSW")?.textContent || "SW: —";
    const lastError = localStorage.getItem("iu:lastError") || "—";
    const lastOkAt = localStorage.getItem("iu:lastArticlesOkAt") || "—";
    const lastOkCount = localStorage.getItem("iu:lastArticlesCount") || "—";
    box.innerHTML = `
      <div style="padding:8px;border:1px solid rgba(0,0,0,0.14);background:#fff;margin:6px;">
        <p><strong>diag</strong></p>
        <p>build: ${selfDiag.build}</p>
        <p>articles: ${selfDiag.articlesState} count=${selfDiag.articlesCount}</p>
        <p>videos: ${selfDiag.videosState} count=${selfDiag.videosCount}</p>
        <p>${updatedLabel}</p>
        <p>${swLabel}</p>
        <p>lastError: ${lastError}</p>
        <p>last OK: ${lastOkAt} / ${lastOkCount}</p>
      </div>
    `;
    document.body.insertBefore(box, document.body.firstChild);
  }

  const eventThrottleMs = 500;
  const eventLastTs = new Map();

  function addTelemetryEvent(name, detail = "") {
    try {
      const raw = localStorage.getItem("iu:events");
      const parsed = raw ? JSON.parse(raw) : [];
      const arr = Array.isArray(parsed) ? parsed : [];
      const now = Date.now();
      const last = eventLastTs.get(name) || 0;
      if (now - last < eventThrottleMs) {
        debugLog("[EVENT] throttled", name);
        return;
      }
      eventLastTs.set(name, now);
      arr.push({ t: new Date().toISOString(), name, detail });
      while (arr.length > 10) arr.shift();
      localStorage.setItem("iu:events", safeStringify(arr));
      updateEventsUI();
    } catch {
      // ignore
    }
  }

  function safeStringify(value, replacer = null, space = 0) {
    try {
      return JSON.stringify(value, replacer, space);
    } catch {
      return "";
    }
  }

  function updateEventsUI() {
    const el = document.getElementById("dataStatusEvents");
    if (!el) return;
    try {
      const raw = localStorage.getItem("iu:events");
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr) || !arr.length) {
        el.textContent = "Události: —";
        return;
      }
      const latest = arr.slice(-5);
      el.innerHTML = "Události:<br />" + latest.map((item) => `${new Date(item.t).toLocaleTimeString("cs-CZ")} ${item.name}`).join("<br />");
    } catch {
      el.textContent = "Události: chybné data";
    }
  }

  function updateLastArticlesInfo(count, updatedAt) {
    const prevCount = localStorage.getItem("iu:lastArticlesCount");
    const now = new Date().toISOString();
    try {
      localStorage.setItem("iu:lastArticlesOkAt", now);
      localStorage.setItem("iu:lastArticlesCount", String(count));
      localStorage.setItem("iu:lastArticlesUpdatedAt", updatedAt || "");
      if (prevCount !== null && prevCount !== String(count)) {
        debugLog("[DIFF] articles count", prevCount, "->", count);
        localStorage.setItem("iu:lastArticlesDiffAt", now);
      }
    } catch {
      // ignore
    }
    const label = document.getElementById("dataStatusUpdated");
    if (!label) return;
    const lastOkTime = new Date(now).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
    const updatedText = updatedAt ? fmtTime(updatedAt) : "neznámá";
    let ageWarning = "";
    if (updatedAt) {
      const parsed = safeDateParse(updatedAt);
      if (parsed) {
        const ageMinutes = Math.floor((Date.now() - parsed.getTime()) / 60000);
        if (ageMinutes > 360) {
          const hours = Math.floor(ageMinutes / 60);
          ageWarning = ` Zastaralé (${hours} h)`;
        }
      }
    }
    label.textContent = `Aktualizace: ${updatedText} (last OK: ${lastOkTime}, count: ${count})${ageWarning}`;
  }

  function finalStateReport() {
    const updatedAt = localStorage.getItem("iu:lastArticlesUpdatedAt") || "—";
    const parsedUpdated = safeDateParse(updatedAt);
    const dataAgeMin = parsedUpdated
      ? Math.round((Date.now() - parsedUpdated.getTime()) / 60000)
      : null;
    const report = {
      build: selfDiag.build || "no-build",
      online: navigator.onLine ? "yes" : "no",
      articlesStatus: selfDiag.articlesState,
      articlesCount: selfDiag.articlesCount,
      videosStatus: selfDiag.videosState,
      videosCount: selfDiag.videosCount,
      updatedAt: updatedAt === "" ? "—" : updatedAt,
      dataAgeMin,
      swController: selfDiag.swController,
      swWaiting: selfDiag.swWaiting,
      lastErrorAt: localStorage.getItem("iu:lastErrorAt") || "—",
      lastError: localStorage.getItem("iu:lastError") || "—"
    };
    debugLog("[STATE]", report);
  }

  logSelfStatus();

  function updateBuildStatusLabel() {
    const build = getBuildStamp() || "no-build";
    const seen = localStorage.getItem("iu:lastBuildSeen") || "";
    const label = document.getElementById("dataStatusBuild");
    if (!label) return;
    if (seen && seen !== build) {
      debugWarn("[BUILD] mismatch seen/current", seen, build);
      label.textContent = `Build: ${build} (změna)`;
    } else {
      label.textContent = `Build: ${build}`;
    }
  }

  function recordBuildSeen() {
    const build = getBuildStamp();
    if (!build) return;
    const prev = localStorage.getItem("iu:lastBuildSeen");
    const now = new Date().toISOString();
    try {
      localStorage.setItem("iu:lastBuildSeen", build);
      localStorage.setItem("iu:lastBuildSeenAt", now);
    } catch {
      // ignore
    }
    if (prev && prev !== build) {
      debugLog("[BUILD] changed", prev, "->", build);
    }
  }

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

    try {
      sessionStorage.removeItem("iu:swReloaded");
      sessionStorage.removeItem("iu:swReloadedAt");
      sessionStorage.removeItem("iu:scrolledToStatus");
    } catch (_) {}

    window.location.reload();
  }

  function timeoutFetch(url, options = {}, ms = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
  }

  function resolveArray(data, fields) {
    if (Array.isArray(data)) return data;
    for (const field of fields) {
      if (Array.isArray(data?.[field])) return data[field];
    }
    return null;
  }

  const ARTICLE_RETRY_DELAYS = [2000, 6000];

  let loggedEmptyTitle = false;
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

  async function fetchArticlesStatus(attempt = 1) {
    const el = document.getElementById("dataStatusArticles");
    if (!el) return;
    try {
      const res = await timeoutFetch(iuDataUrl("articles.json"), { cache: "no-store" }, 9000);
      if (!res.ok) {
        el.textContent = `Články: chyba (${res.status})`;
        selfDiag.articlesState = "FAIL";
        selfDiag.articlesCount = "-";
        logSelfStatus();
        return;
      }
      const data = await res.json();
      const size = safeStringify(data).length;
      debugLog("[DATA] size=", size);
      const items = resolveArray(data, ["items", "articles"]);
      const validItems = items ? normalizeArticleList(items) : [];
      if (items && validItems.length < items.length) {
        debugWarn("[DATA] filtered invalid items", items.length, "->", validItems.length);
      }
      if (!items) {
        el.textContent = "Články: chyba formátu";
        debugWarn("[DATA] articles schema unexpected", Object.keys(data || {}));
        selfDiag.articlesState = "FAIL";
        selfDiag.articlesCount = "-";
        logSelfStatus();
        return;
      }
      const updatedAtValue = data?.updatedAt ?? data?.updated_at ?? null;
      const count = safeNumber(validItems.length);
      const ageMinutes = updatedAtValue ? Math.floor((Date.now() - new Date(updatedAtValue).getTime()) / 60000) : 0;
      if (!items.length || !count) {
        el.textContent = "Články: prázdné";
        selfDiag.articlesState = "EMPTY";
        selfDiag.articlesCount = "0";
        logSelfStatus();
        updateLastArticlesInfo(count, updatedAtValue);
        addTelemetryEvent("articles", `EMPTY count=${count}`);
        return;
      }
      if (ageMinutes > 1440 && !firstLoadQuiet) {
        el.textContent = "Články: zastaralé (24h+)";
        debugWarn("[DATA] articles too old");
      } else {
        el.textContent = `Články: OK (${count})`;
      }
      selfDiag.articlesState = "OK";
      selfDiag.articlesCount = String(count);
      logSelfStatus();
      updateLastArticlesInfo(count, updatedAtValue);
      addTelemetryEvent("articles", `OK count=${count} updated=${updatedAtValue || "—"}`);
      const firstItem = validItems[0] || {};
      const firstTitle = firstItem.title || firstItem.headline || firstItem.name || "—";
      debugLog("[SELF] firstTitle=", firstTitle);
      const dates = validItems
        .map((item) => item.publishedAt || item.date || item.published || "")
        .map((value) => new Date(value))
        .filter((d) => !Number.isNaN(d.getTime()))
        .map((d) => d.getTime());
      for (let i = 1; i < dates.length; i += 1) {
        if (dates[i] > dates[i - 1]) {
          debugWarn("[DATA] articles not sorted");
          break;
        }
      }
    } catch (err) {
      el.textContent = "Články: chyba";
      selfDiag.articlesState = "FAIL";
      selfDiag.articlesCount = "-";
      logSelfStatus();
      if (attempt <= ARTICLE_RETRY_DELAYS.length) {
        const delay = ARTICLE_RETRY_DELAYS[attempt - 1];
        debugWarn("[RETRY] articles attempt", attempt);
        el.textContent = `Články: retry (${attempt})`;
        setTimeout(() => fetchArticlesStatus(attempt + 1), delay);
      }
      if (err?.name === "AbortError") {
        addTelemetryEvent("timeout", "articles");
        if (!firstLoadQuiet) {
          el.textContent = "Články: timeout";
        }
      }
      addTelemetryEvent("articles", `FAIL attempt=${attempt} err=${err && err.message ? err.message : "timeout"}`);
    }
  }

  async function fetchVideosStatus() {
    const el = document.getElementById("dataStatusVideos");
    if (!el) return;
    try {
      const res = await timeoutFetch(iuDataUrl("videos.json"), { cache: "no-store" }, 9000);
      if (res.status === 404) {
        el.textContent = "Videa: není k dispozici";
        selfDiag.videosState = "404";
        selfDiag.videosCount = "-";
        logSelfStatus();
        addTelemetryEvent("videos", "404");
        return;
      }
      if (!res.ok) {
        el.textContent = `Videa: chyba (${res.status})`;
        selfDiag.videosState = "FAIL";
        selfDiag.videosCount = "-";
        logSelfStatus();
        addTelemetryEvent("videos", `FAIL status=${res.status}`);
        return;
      }
      const data = await res.json();
      const size = safeStringify(data).length;
      debugLog("[DATA] size=", size);
      const items = resolveArray(data, ["items", "videos"]);
      if (!items) {
        el.textContent = "Videa: chyba formátu";
        debugWarn("[DATA] videos schema unexpected", Object.keys(data || {}));
        selfDiag.videosState = "FAIL";
        selfDiag.videosCount = "-";
        logSelfStatus();
        return;
      }
      if (!items.length) {
        el.textContent = "Videa: prázdná";
        selfDiag.videosState = "EMPTY";
        selfDiag.videosCount = "0";
        logSelfStatus();
        addTelemetryEvent("videos", "EMPTY");
        return;
      }
      el.textContent = `Videa: OK (${items.length})`;
      selfDiag.videosState = "OK";
      selfDiag.videosCount = String(items.length);
      logSelfStatus();
      addTelemetryEvent("videos", `OK count=${items.length}`);
    } catch (err) {
      el.textContent = "Videa: chyba";
      selfDiag.videosState = "FAIL";
      selfDiag.videosCount = "-";
      logSelfStatus();
      addTelemetryEvent("videos", "FAIL timeout");
      if (err?.name === "AbortError") {
        addTelemetryEvent("timeout", "videos");
        if (!firstLoadQuiet) {
          el.textContent = "Videa: timeout";
        }
      }
    }
  }

  function isLatestLoadRequest(id) {
    return id === state.loadRequestId;
  }

  function iuBuildDiagStatusLine({
    preferredSaved,
    preferredModeUsed,
    articlesOk,
    videosOk,
    chosenArticlesUrl,
    chosenVideosUrl,
    countArticles,
    countVideos,
    feedChildren,
    generatedAtArticles,
    generatedAtVideos,
    articlesKeys,
    videosKeys,
    effectiveUpdatedAtArticles,
    effectiveUpdatedAtVideos,
  }) {
    const ps = preferredSaved ? "YES" : "NO";
    const pm = preferredModeUsed === "preferred" ? "preferred" : "fallback";
    const as = articlesOk ? "OK" : "NEOK";
    const vs = videosOk ? "OK" : "NEOK";
    const au = chosenArticlesUrl || "-";
    const vu = chosenVideosUrl || "-";
    const ca = Number.isFinite(countArticles) ? countArticles : 0;
    const cv = Number.isFinite(countVideos) ? countVideos : 0;
    const fc = Number.isFinite(feedChildren) ? feedChildren : 0;
    const ga = generatedAtArticles || "none";
    const gv = generatedAtVideos || "none";
    return [
      `preferred saved: ${ps}`,
      `preferred mode used: ${pm}`,
      `articles status: ${as} | videos status: ${vs}`,
      `Vybrané URL: articles=${au} , videos=${vu}`,
      `Načteno: články ${ca}, videa ${cv}`,
      `#feed children: ${fc}`,
      `generatedAt articles: ${ga}`,
      `generatedAt videos: ${gv}`,
      `effective updatedAt articles: ${effectiveUpdatedAtArticles}`,
      `effective updatedAt videos: ${effectiveUpdatedAtVideos}`,
      `articles keys: ${articlesKeys || "none"}`,
      `videos keys: ${videosKeys || "none"}`,
    ].join("\n");
  }

  function iuHasStatusPlaceholders(s) {
    if (!s) return true;
    const bad = [
      "YES|NO",
      "preferred|fallback",
      "OK|NEOK",
      "…",
      "articles=…",
      "videos=…",
      "Načteno: články X, videa Y",
      "#feed children: N",
    ];
    return bad.some((t) => s.includes(t));
  }

  // === TOPIC GROUPING FEATURE ===
  const ENABLE_TOPIC_GROUPING = true;
  const TOPIC_GROUPING_TIME_WINDOW_HOURS = 12;
  const TOPIC_GROUPING_MAX_OTHERS = 999; // žádný limit na počet sloučených článků

  function normalizeTitleForKey(title) {
    if (!title || typeof title !== "string") return "";
    
    let normalized = title
      .toLowerCase()
      // Odstranění diakritiky (základní)
      .replace(/[áàä]/g, "a")
      .replace(/[éèě]/g, "e")
      .replace(/[íì]/g, "i")
      .replace(/[óòö]/g, "o")
      .replace(/[úùůü]/g, "u")
      .replace(/[ý]/g, "y")
      .replace(/[č]/g, "c")
      .replace(/[ď]/g, "d")
      .replace(/[ň]/g, "n")
      .replace(/[ř]/g, "r")
      .replace(/[š]/g, "s")
      .replace(/[ť]/g, "t")
      .replace(/[ž]/g, "z")
      // Odstranění interpunkce a speciálních znaků
      .replace(/[^\w\s]/g, " ")
      // Odstranění čísel (konzervativně - jen samostatné)
      .replace(/\b\d+\b/g, " ")
      // Redukce whitespace
      .replace(/\s+/g, " ")
      .trim();
    
    // Odstranění "měkkých" stop slov (konzervativně)
    const softStopWords = ["video", "zive", "aktualne", "live", "breaking"];
    const words = normalized.split(/\s+/);
    const filtered = words.filter(w => w.length > 2 && !softStopWords.includes(w));
    
    return filtered.join(" ");
  }

  function computeTopicKey(article) {
    if (!article) return null;
    
    const title = article.title || article.headline || article.name || "";
    const normalizedTitle = normalizeTitleForKey(title);
    
    // Pokud normalizovaný title je příliš krátký (< 10 znaků), použij fallback
    if (normalizedTitle.length < 10) {
      const topic = (article.topic || "").toLowerCase().trim();
      const section = (article.section || "").toLowerCase().trim();
      if (topic || section) {
        return `${topic}||${section}`;
      }
    }
    
    return normalizedTitle || null;
  }

  function jaccardSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const tokens1 = new Set(str1.toLowerCase().split(/\s+/).filter(t => t.length > 2));
    const tokens2 = new Set(str2.toLowerCase().split(/\s+/).filter(t => t.length > 2));
    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  function getTitleTokens(title) {
    if (!title) return [];
    return normalizeTitleForKey(title).split(/\s+/).filter(t => t.length > 2);
  }

  function mergeSourcesDedup(sourcesArrayList) {
    const seen = new Set();
    const merged = [];
    
    for (const sources of sourcesArrayList) {
      if (!Array.isArray(sources)) continue;
      
      for (const source of sources) {
        if (!source || typeof source !== "object") continue;
        
        const name = String(source.name || source.title || "").trim();
        const url = String(source.url || source.link || "").trim();
        
        if (!name || !url) continue;
        
        // Normalizace URL: base URL bez query params a hash
        const urlBase = url.split('?')[0].split('#')[0].toLowerCase();
        
        // Normalizace názvu média
        const canonicalName = normalizeMediaName(name);
        
        // Klíč pro deduplikaci: base URL + canonical name
        const key = `${urlBase}||${canonicalName}`;
        
        if (seen.has(key)) continue;
        seen.add(key);
        
        merged.push({ name, url });
      }
    }
    
    return merged;
  }

  function groupArticlesByTopic(articles, hours) {
    if (!Array.isArray(articles) || articles.length === 0) return articles;
    if (!Number.isFinite(hours) || hours <= 0) return articles;
    
    // Mapování: topicKey -> skupina článků
    const groups = new Map();
    
    // Krok 1: Seřadit články podle publishedAt (ASC - nejstarší první)
    const sorted = [...articles].sort((a, b) => {
      const ta = new Date(a.publishedAt || a.date || a.published || 0).getTime();
      const tb = new Date(b.publishedAt || b.date || b.published || 0).getTime();
      return ta - tb; // ASC
    });
    
    // Krok 2: Seskupit články podle topicKey s pojistkami
    const groupedArticles = new Set(); // Sledovat, které články byly seskupeny
    
    for (const article of sorted) {
      const topicKey = computeTopicKey(article);
      if (!topicKey) {
        // Pokud nelze vypočítat klíč, ponechat článek samostatně
        continue;
      }
      
      const articleTitle = article.title || article.headline || article.name || "";
      const articleTokens = getTitleTokens(articleTitle);
      const articleTopic = (article.topic || "").toLowerCase().trim();
      const articleSection = (article.section || "").toLowerCase().trim();
      
      if (!groups.has(topicKey)) {
        // Nová skupina - první článek je hlavní
        const publishedAt = article.publishedAt || article.date || article.published || "";
        const firstTime = new Date(publishedAt).getTime();
        
        groups.set(topicKey, {
          primary: article,
          related: [],
          firstTime: firstTime,
          timeWindowEnd: firstTime + (hours * 60 * 60 * 1000), // +hours v ms
          primaryTitle: articleTitle,
          primaryTokens: articleTokens,
          primaryTopic: articleTopic,
          primarySection: articleSection,
        });
        groupedArticles.add(article);
      } else {
        // Existující skupina - zkontrolovat časové okno a podobnost
        const group = groups.get(topicKey);
        const articleTime = new Date(article.publishedAt || article.date || article.published || 0).getTime();
        
        if (articleTime <= group.timeWindowEnd) {
          // Časové okno OK - zkontrolovat tokenovou podobnost
          const similarity = jaccardSimilarity(group.primaryTitle, articleTitle);
          const minTokens = 3;
          const minSimilarity = 0.55;
          
          let shouldGroup = false;
          
          // Pokud má title málo tokenů (< 3), vyžaduj navíc shodu topic||section
          if (articleTokens.length < minTokens || group.primaryTokens.length < minTokens) {
            const topicMatch = articleTopic && group.primaryTopic && articleTopic === group.primaryTopic;
            const sectionMatch = articleSection && group.primarySection && articleSection === group.primarySection;
            if (topicMatch || sectionMatch) {
              shouldGroup = true;
            }
          } else if (similarity >= minSimilarity) {
            // Dostatečná tokenová podobnost
            shouldGroup = true;
          }
          
          if (shouldGroup) {
            group.related.push(article);
            groupedArticles.add(article);
          }
          // Pokud nesplní podobnost, článek zůstane samostatně (bude přidán v kroku 4)
        }
        // Pokud je mimo okno, ignorovat (jiná událost, jen podobný title)
      }
    }
    
    // Krok 3: Vytvořit výstupní články ze skupin
    const result = [];
    
    for (const [topicKey, group] of groups.entries()) {
      const primary = group.primary;
      
      // Sloučit sources z primary + related
      const allSources = [
        Array.isArray(primary.sources) ? primary.sources : [],
        ...group.related.map(a => Array.isArray(a.sources) ? a.sources : [])
      ];
      const mergedSources = mergeSourcesDedup(allSources);
      
      // Validace výstupního článku
      if (!primary.title || !primary.url || !Array.isArray(mergedSources)) {
        debugWarn("[GROUP] Invalid grouped article, skipping", { topicKey, primary });
        // Fallback: přidat primary samostatně
        result.push(primary);
        continue;
      }
      
      // Vytvořit seskupený článek
      const groupedArticle = {
        ...primary,
        sources: mergedSources,
        // Volitelné metadata pro debug
        _groupMeta: {
          relatedCount: group.related.length,
          timeWindow: `${hours}h`,
          topicKey: topicKey,
        },
      };
      
      result.push(groupedArticle);
    }
    
    // Krok 4: Přidat články, které nebyly seskupeny (nemají topicKey nebo nesplnily podobnost)
    for (const article of sorted) {
      if (!groupedArticles.has(article)) {
        result.push(article);
      }
    }
    
    return result;
  }

  async function loadData() {
    const startedAt = new Date();
    if (state.isLoadingData) return;
    state.isLoadingData = true;
    const requestToken = ++state.loadRequestId;
    state.cachedItems = [];
    state.hasLoadedData = false;
    const lastErrInline = document.getElementById("lastErrInline");
    if (lastErrInline) {
      lastErrInline.style.display = "none";
    }
    if (emptyBox) {
      emptyBox.style.display = "block";
      emptyBox.innerHTML = "<p>Načítám data…</p>";
    }
    const preferredEntry = await evaluatePreferredPair();
    const baseArticleUrls = [iuDataUrl("articles.json")];
    const baseVideoUrls = [iuDataUrl("videos.json")];
    const articleUrls = buildCandidateListFromPair(preferredEntry, "articles", baseArticleUrls);
    const videoUrls = buildCandidateListFromPair(preferredEntry, "videos", baseVideoUrls);
    let preferredSaved = false;
    let preferredSavedReason = "";
    let preferredUpdatedToRoot = false;
    let chosenArticlesUrl = "";
    let chosenVideosUrl = "";
    let articleFetchResult = null;
    let videoFetchResult = null;
    let normalizedVideoSource = [];
    let articleStatusCode = null;
    let videoStatusCode = null;
    let articleStatusLabel = "404";
    let videoStatusLabel = "404";
    let articlesOk = false;
    let videosOk = false;
    let data = null;
    setStatus("Stav dat: načítám…");
    debugBoxSet(`iu debug: loading…\nhref=${location.href}\nstatus=loading`);

    try {
      const probeUrl = iuDataUrl("_probe.txt");
      const ARTICLES_URL = iuDataUrl("articles.json");
      const VIDEOS_URL = iuDataUrl("videos.json");
      const articlesUrl = ARTICLES_URL;
      const videosUrl = VIDEOS_URL;

      debugBoxSet(
        `iu debug: fetching…\nhref=${location.href}\narticlesUrl=${articlesUrl}\nvideosUrl=${videosUrl}`
      );

      const probePromise = fetch(withTs(probeUrl), {
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
      }).then((res) => {
        if (!res.ok) throw new Error(`PROBE_HTTP_${res.status}`);
        return res.text();
      });

      const probeText = await probePromise.catch(() => null);
      state.lastProbe = probeText;

      const articlesData = await fetchDiag(articlesUrl, "articles");
      const videosData = await fetchDiag(videosUrl, "videos");

      const articlesArr = Array.isArray(articlesData)
        ? articlesData
        : Array.isArray(articlesData?.articles)
          ? articlesData.articles
          : [];

      const videosArr = Array.isArray(videosData)
        ? videosData
        : Array.isArray(videosData?.videos)
          ? videosData.videos
          : [];

      const articlesOk = Boolean(articlesData);
      let videosOk = Boolean(videosData);
      if (articlesOk && videosOk) {
        setStatus("Stav dat: OK");
      } else if (articlesOk && !videosOk) {
        setStatus("Stav dat: částečně (videa se teď nenačetla, obnova běží)");
      } else if (!articlesOk && videosOk) {
        setStatus("Stav dat: částečně (články se teď nenačetly, obnova běží)");
      }

      if (articlesData) assertFreshGeneratedAt(articlesData);
      if (videosData) assertFreshGeneratedAt(videosData);

      if (articlesData) {
        articleStatusCode = 200;
        articleStatusLabel = "OK";
        chosenArticlesUrl = articlesUrl;
        articleFetchResult = { json: articlesData, status: 200 };
        data = articlesData;
      }

      const articlesGeneratedAt = articlesData?.generatedAt || articlesData?.meta?.generatedAt || null;
      const articleGeneratedTs = articlesGeneratedAt ? Date.parse(articlesGeneratedAt) : null;
      const probeStamp = parseProbeTimestamp(state.lastProbe);
      if (
        Number.isFinite(probeStamp) &&
        Number.isFinite(articleGeneratedTs) &&
        articleGeneratedTs + 10 * 60 * 1000 < probeStamp
      ) {
        debugWarn("PROBE_JSON_MISMATCH (non-fatal)", { probeStamp, articleGeneratedTs });
      }
      state.lastArticlesGeneratedAt = articlesGeneratedAt ? String(articlesGeneratedAt) : null;
      const articlesKeys = articlesData && typeof articlesData === "object" ? Object.keys(articlesData).sort().join(",") : "none";
      state.lastArticlesKeys = articlesKeys;
      const articlesUpdatedAt = typeof articlesData?.updatedAt === "string" ? articlesData.updatedAt : null;
      state.lastArticlesUpdatedAt = articlesUpdatedAt;
      state.articlesRaw = articlesData;

      const safeArticlesArray = Array.isArray(articlesArr) ? articlesArr : [];
      if (isDebugLogging) {
        debugLog("[LOADDATA] articlesArr isArray=", Array.isArray(articlesArr), "len=", (articlesArr?.length ?? -1));
        debugLog("[LOADDATA] videosArr  isArray=", Array.isArray(videosArr),  "len=", (videosArr?.length ?? -1));
        debugLog("[LOADDATA] safeArticlesArray isArray=", Array.isArray(safeArticlesArray), "len=", safeArticlesArray.length);
      }
      const totalArticles = Array.isArray(safeArticlesArray) ? safeArticlesArray.length : 0;
      let sanitizedArticles = normalizeArticleList(Array.isArray(safeArticlesArray) ? safeArticlesArray : []).map((item) => ({
        ...item,
        contentType: "article",
        suspiciousTitle: isSuspiciousTitle(item.title),
      }));
      if (DEBUG) {
        sanitizedArticles.forEach((item) => {
          if (!item.contentType) {
            console.warn("[normalize] Missing contentType:", item);
            debugWarn("[normalize] Missing contentType:", item);
          }
        });
      }
      sanitizedArticles.forEach((item) => {
        if (!item.contentType) {
          debugWarn("Missing contentType", item);
        }
      });
      debugLog("[ARTICLES NORMALIZED]", sanitizedArticles.length);
      if (sanitizedArticles.length < totalArticles) {
        debugWarn("[DATA] filtered invalid items", totalArticles, "->", sanitizedArticles.length);
      }

      debugLog("[DATA] articles loaded count=", sanitizedArticles.length);
      debugLog("[DATA] articles first=", sanitizedArticles[0]?.title, sanitizedArticles[0]?.url);
      if (isDebugLogging) {
      debugLog("[ARTICLES] loaded", sanitizedArticles.length, sanitizedArticles.slice(0, 3));
      }

      const safeVideosArray = Array.isArray(videosArr) ? videosArr : [];
      if (isDebugLogging) {
        debugLog("[LOADDATA] safeVideosArray  isArray=", Array.isArray(safeVideosArray), "len=", safeVideosArray.length);
      }
      normalizedVideoSource = Array.isArray(safeVideosArray) ? safeVideosArray : [];
      if (iuDbg()) {
        try{
          IU_VIDEO_DBG.counts.loaded_count = normalizedVideoSource.length;
        }catch{}
      }
      let videoItems = normalizeVideoList(Array.isArray(normalizedVideoSource) ? normalizedVideoSource : []);
      if (iuDbg()) {
        try{
          IU_VIDEO_DBG.counts.normalized_count = Array.isArray(videoItems) ? videoItems.length : 0;
          IU_VIDEO_DBG.counts.normalized_cz = Array.isArray(videoItems)
            ? videoItems.filter((v) => String(v?.lang || "").toLowerCase() === "cz" || String(v?.region || "").toLowerCase() === "cz").length
            : 0;
          IU_VIDEO_DBG.counts.normalized_world = Math.max(0, (IU_VIDEO_DBG.counts.normalized_count || 0) - (IU_VIDEO_DBG.counts.normalized_cz || 0));
          IU_VIDEO_DBG.counts.normalized_thumb_missing = Array.isArray(videoItems) ? videoItems.filter((v) => !String(v?.thumb || "").trim()).length : 0;

          // duplicate ids in normalized list
          const seen = new Set();
          let dup = 0;
          for (const v of (Array.isArray(videoItems) ? videoItems : [])) {
            const id = String(v?.videoId || "").trim();
            if (!id) continue;
            if (seen.has(id)) { dup += 1; iuDbgVideoSample(v, "duplicate", id); }
            else seen.add(id);
          }
          IU_VIDEO_DBG.counts.duplicate = dup;
        }catch{}
      }
      try { iuDbgRunPosterAudit(videoItems); } catch {}

      const videosKeys =
        videosData && typeof videosData === "object" ? Object.keys(videosData).sort().join(",") : "none";
      state.lastVideosKeys = videosKeys;
      const videosUpdatedAt = typeof videosData?.updatedAt === "string" ? videosData.updatedAt : null;
      state.lastVideosUpdatedAt = videosUpdatedAt;
      state.videosRaw = videosData;
      if (iuDbg()) {
        try{
          IU_VIDEO_DBG.counts.videos_keys = state.lastVideosKeys || null;
          IU_VIDEO_DBG.counts.videos_generatedAt = videosData?.generatedAt || videosData?.meta?.generatedAt || null;
          IU_VIDEO_DBG.counts.videos_sourcesMeta = Array.isArray(videosData?.sourcesMeta) ? videosData.sourcesMeta.length : 0;
          IU_VIDEO_DBG.counts.videos_categories = Array.isArray(videosData?.categories) ? videosData.categories.length : 0;
        }catch{}
      }
      const videosGeneratedAt = videosData?.generatedAt || videosData?.meta?.generatedAt || null;
      state.lastVideosGeneratedAt = videosGeneratedAt ? String(videosGeneratedAt) : null;

      chosenVideosUrl = videosUrl;
      videoStatusLabel = "OK";
      videoStatusCode = 200;
      videoFetchResult = { json: videosData, status: 200 };
      videosOk = true;
      diagMeta.articlesUrl = chosenArticlesUrl || "";
      diagMeta.articlesStatus = articleStatusLabel || "404";
      diagMeta.videosUrl = chosenVideosUrl || "";
      diagMeta.videosStatus = videoStatusLabel || "404";
      try {
        if (typeof window.iuSetDataStatus === "function") {
          window.iuSetDataStatus(sanitizedArticles.length, videoItems.length);
        }
      } catch (_) {}
      const articlesJson = articleFetchResult?.json;
      const videosJson = videoFetchResult?.json;
      const normalizedArticles = Array.isArray(articlesArr) ? articlesArr : [];
      const hasArticlesField = Array.isArray(articlesJson?.articles);
      const hasNormalizedArticles = normalizedArticles.length > 0;
      const hasVideosField = Array.isArray(videosJson?.videos);
      const hasNormalizedVideos = Array.isArray(normalizedVideoSource) && normalizedVideoSource.length > 0;
      if (chosenArticlesUrl && chosenVideosUrl) {
        if ((hasArticlesField || hasNormalizedArticles) && (hasVideosField || hasNormalizedVideos)) {
          const storedPair = savePreferredPair(chosenArticlesUrl, chosenVideosUrl);
          if (storedPair) {
            preferredSaved = true;
            preferredSavedReason = "";
          } else if (!preferredSaved) {
            preferredSavedReason = "localStorage blocked";
          }
        } else if (!preferredSaved) {
          preferredSavedReason = "missing expected JSON arrays";
        }
      } else if (!preferredSaved && !preferredSavedReason) {
        preferredSavedReason = "no URLs to store";
      }

      if (!isLatestLoadRequest(requestToken)) {
        debugLog("[DATA] request canceled, token", requestToken);
        return;
      }
      
      // === TOPIC GROUPING ===
      let articlesForFeed = sanitizedArticles;
      if (ENABLE_TOPIC_GROUPING) {
        try {
          const grouped = groupArticlesByTopic(sanitizedArticles, TOPIC_GROUPING_TIME_WINDOW_HOURS);
          
          // Validace výstupu
          const isValid = Array.isArray(grouped) && grouped.every(item => 
            item && 
            typeof item.title === "string" && 
            typeof item.url === "string" && 
            Array.isArray(item.sources)
          );
          
          if (isValid) {
            articlesForFeed = grouped;
            
            // Debug telemetrie pro seskupování (jen v debug režimu)
            if (isDebugLogging) {
              debugLog("[GROUP] articles grouped:", sanitizedArticles.length, "->", grouped.length);
              const groupsWithMeta = grouped.filter(a => a._groupMeta && a._groupMeta.relatedCount > 0);
              const topGroups = groupsWithMeta
                .sort((a, b) => (b._groupMeta.relatedCount || 0) - (a._groupMeta.relatedCount || 0))
                .slice(0, 10);
              
              debugLog(`[GROUP] === TOP ${topGroups.length} GROUPS ===`);
              topGroups.forEach((g, idx) => {
                const sources = Array.isArray(g.sources) ? g.sources.map(s => s.name).filter(Boolean) : [];
                const primaryTime = g.publishedAt || g.date || g.published || "";
                const relatedCount = g._groupMeta.relatedCount || 0;
                const timeWindow = g._groupMeta.timeWindow || "12h";
                const keyDisplay = g._groupMeta.topicKey.substring(0, 60) + (g._groupMeta.topicKey.length > 60 ? "..." : "");
                
                debugLog(`[GROUP] #${idx + 1}: key="${keyDisplay}"`);
                debugLog(`[GROUP]   count: ${relatedCount + 1} articles, timeWindow: ${timeWindow}, primaryTime: ${primaryTime}`);
                debugLog(`[GROUP]   sources (${sources.length}): ${sources.slice(0, 8).join(", ")}${sources.length > 8 ? "..." : ""}`);
              });
              debugLog(`[GROUP] === END TOP GROUPS ===`);
            }
          } else {
            debugWarn("[GROUP] Validation failed, using original articles");
            articlesForFeed = sanitizedArticles;
          }
        } catch (err) {
          debugWarn("[GROUP] Error during grouping:", err);
          articlesForFeed = sanitizedArticles; // Fallback na původní
        }
      }
      
      const combined = buildCombinedFeed(articlesForFeed, videoItems);
      const enriched = combined.map((item) => {
        const published =
          (item && String(item.publishedAt || item.published || item.date || item.createdAt || item.uploadedAt || item.time)) ||
          "";
        return {
          ...item,
          _ts: published ? Date.parse(published) || 0 : 0,
        };
      });
      const sorted = enriched.sort((a, b) => (b._ts || 0) - (a._ts || 0));
      const articlesOnly = sorted.filter((entry) => entry?.contentType === "article");
      const videosOnly = sorted.filter((entry) => entry?.contentType === "video");
      const mixed = [];
      let videoIndex = 0;
      for (let i = 0; i < articlesOnly.length; i++) {
        mixed.push(articlesOnly[i]);
        if ((i + 1) % 10 === 0 && videoIndex < videosOnly.length) {
          mixed.push(videosOnly[videoIndex++]);
        }
      }
      while (videoIndex < videosOnly.length) {
        mixed.push(videosOnly[videoIndex++]);
      }
      state.stats.articlesCount = articlesOnly.length;
      state.stats.videosCount = videosOnly.length;
      state.cachedItems = mixed.length ? mixed : combined;
      const combinedSources = [];
      if (articlesOk) combinedSources.push("articles");
      if (videosOk) combinedSources.push("videos");
      if (isDebugLogging) {
        debugLog("[LOADDATA] combined count", combined.length);
        debugLog("[LOADDATA] rendering from", combinedSources.length ? combinedSources.join(",") : "none");
      }

      if (combined.length === 0) {
        renderEmpty("Obsah se teď nenačetl (žádná data z backendu)");
        return;
      }

      state.cachedItems = combined;
      if (!Array.isArray(state.cachedItems)) state.cachedItems = [];
      state.hasLoadedData = true;
      state.consecutiveLoadFailures = 0;
      state.filteredItems = Array.isArray(state.cachedItems) ? state.cachedItems.slice() : [];
      renderItems(state.filteredItems);
      if (isDebugLogging) {
        debugLog(
          "[CACHE] total",
          combined.length,
          "articles",
          sanitizedArticles.length,
          "videos",
          videoItems.length,
        );
        debugLog(
          "[ARTICLES] sample",
          sanitizedArticles.slice(0, 3).map((item) => ({
            title: item.title,
            url: item.url,
          })),
        );
        debugLog(
          "[VIDEOS] sample",
          videoItems.slice(0, 3).map((item) => ({
            title: item.title,
            url: item.url,
          })),
        );
      }
      // Non-blocking: load retention index for historical day-shards
      initRetentionIndex();
      applyFilter();
      const countArticles = state.cachedItems.filter((entry) => entry?.contentType === "article").length;
      const countVideos = state.cachedItems.filter((entry) => entry?.contentType === "video").length;
      const feedChildren = elFeed?.children?.length ?? 0;
      const preferredUsed = Boolean(
        preferredEntry?.status === "ok" &&
          chosenArticlesUrl === preferredEntry.articlesUrl &&
          chosenVideosUrl === preferredEntry.videosUrl
      );
      const preferredModeUsed = preferredUsed ? "preferred" : "fallback";
      const effectiveUpdatedAtArticles =
        state.lastArticlesGeneratedAt || state.lastArticlesUpdatedAt || "none";
      const effectiveUpdatedAtVideos =
        state.lastVideosGeneratedAt || state.lastVideosUpdatedAt || "none";
      
      // === FIX: Odvodit articlesStamp a videosStamp z generatedAt ===
      const articlesStamp = state.lastArticlesGeneratedAt 
        ? state.lastArticlesGeneratedAt.substring(0, 16).replace(/T/, " ")
        : null;
      const videosStamp = state.lastVideosGeneratedAt
        ? state.lastVideosGeneratedAt.substring(0, 16).replace(/T/, " ")
        : null;
      
      const statusLine = iuBuildDiagStatusLine({
        preferredSaved,
        preferredModeUsed,
        articlesOk,
        videosOk,
        chosenArticlesUrl,
        chosenVideosUrl,
        countArticles,
        countVideos,
        feedChildren,
        generatedAtArticles: state.lastArticlesGeneratedAt,
        generatedAtVideos: state.lastVideosGeneratedAt,
        articlesKeys: state.lastArticlesKeys,
        videosKeys: state.lastVideosKeys,
        effectiveUpdatedAtArticles,
        effectiveUpdatedAtVideos,
      });
      if (iuHasStatusPlaceholders(statusLine)) {
        persistLastError("DIAG PLACEHOLDER DETECTED: " + statusLine.slice(0, 180));
        setStatus("Stav dat: načítám…");
      } else {
        persistLastError(null);
        persistLastOk({
          at: new Date().toISOString(),
          build: articlesStamp || videosStamp || "",
          articles: countArticles,
          videos: countVideos,
        });
        const feedSegment = feedChildren ? ` • feed ${feedChildren}` : "";
        let statusParts = ["Stav dat: OK"];
        if (articlesStamp && videosStamp && articlesStamp === videosStamp) {
          statusParts.push(`build ${articlesStamp}`);
          statusParts.push(`články ${countArticles}`);
          statusParts.push(`videa ${countVideos}`);
        } else {
          statusParts.push(`články ${countArticles}${articlesStamp ? ` (build ${articlesStamp})` : ""}`);
          statusParts.push(`videa ${countVideos}${videosStamp ? ` (build ${videosStamp})` : ""}`);
        }
        if (feedSegment.trim()) statusParts.push(feedSegment.replace(/^ • /, ""));
        if (state.lastProbe) {
          statusParts.push(`probe ${state.lastProbe}`);
        }
        setStatus(statusParts.join(" • "));
      }
      const elUpdated = document.getElementById("dataUpdatedAt");
      if (elUpdated && (state.lastArticlesGeneratedAt || state.lastVideosGeneratedAt)) {
        const stamp = state.lastArticlesGeneratedAt || state.lastVideosGeneratedAt;
        const displayDate = stamp.substring(0, 16).replace("T", " ");
        elUpdated.textContent = "Poslední aktualizace dat: " + displayDate;
        elUpdated.classList.remove("iu-date-pending");
      }
      updateLastArticlesInfo(sanitizedArticles.length, data?.updatedAt ?? data?.updated_at ?? null);

      debugLog("[DATA] combined count=", state.cachedItems.length);
      debugLog("[DATA] combined first type=", state.cachedItems[0]?.contentType, state.cachedItems[0]?.title);

      debugBoxSet(
        `iu debug: parsed\narticlesCountRaw=${Array.isArray(articlesData?.articles) ? articlesData.articles.length : -1}\nvideosCountRaw=${Array.isArray(videosData?.videos) ? videosData.videos.length : -1}\narticlesCountSanitized=${Array.isArray(sanitizedArticles) ? sanitizedArticles.length : -1}\nvideosCountSanitized=${Array.isArray(normalizedVideoSource) ? normalizedVideoSource.length : -1}`
      );

      setTimeout(() => {
        const feed = document.getElementById("feed");
        const cards = feed ? feed.querySelectorAll("article, .card, .newsCard, .iuCard").length : -1;
        const prev = document.getElementById("iuDebugBox")?.textContent || "";
        debugBoxSet(`${prev}\niu debug: DOM\nfeedExists=${Boolean(feed)}\ncardsInDom=${cards}`);
        if (feed) {
          const hasData = (state.cachedItems?.length || 0) > 0;
          if (hasData && cards === 0) {
            const warning = document.createElement("div");
            warning.style.cssText = "padding:12px;margin:12px 0;border:1px dashed #999;border-radius:10px;";
            warning.textContent = "IU: DATA JSOU NAČTENÁ, ALE NIC SE NERENDERUJE (debug=1). Zkontroluj konzoli a iuDebugBox.";
            feed.appendChild(warning);
          }
        }
      }, 0);

      if (isDebugOn()) {
        writeDebug({
          ok: true,
          url: chosenArticlesUrl || articleUrls[0] || "",
          fetchedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          rawType: Array.isArray(data) ? "array" : typeof data,
          keys:
            data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data) : [],
          itemsCount: state.cachedItems.length,
          sample: state.cachedItems.slice(0, 3),
        });
      }
    } catch (err) {
      if (!isLatestLoadRequest(requestToken)) {
        debugLog("[DATA] failure ignored, token", requestToken);
        return;
      }

      state.consecutiveLoadFailures = (state.consecutiveLoadFailures || 0) + 1;
      debugWarn("[loadData] error", err);

      const hasLast = Array.isArray(state.cachedItems) && state.cachedItems.length > 0;
      const feedChildren = elFeed?.children?.length ?? 0;
      
      // === FIX: Pokud máme data a feed je vykreslen, neukazovat "výpadek" ===
      if (hasLast && feedChildren > 0) {
        // Data jsou OK, feed je vykreslen → jen warning, ne "výpadek"
        debugWarn("[loadData] error during processing, but feed is rendered", err);
        setStatus("Stav dat: OK (částečná chyba při zpracování)");
      } else {
        setStatus("Stav dat: výpadek (automatický pokus o obnovení)");
      }

      if (hasLast) {
        const box = document.querySelector("#emptyBox") || document.querySelector("#empty");
        if (box) {
          box.style.display = "";
          box.textContent = "Dočasný výpadek načtení dat. Zobrazuji poslední úspěšná data, probíhá obnova.";
        }
      } else {
        const feed = document.querySelector("#feed");

        const msg = "Obsah se teď nenačetl (chyba načtení dat). Zkus obnovit stránku.";
        const details = [
          "DETAIL (auto):",
          formatDiagLine("articles"),
          formatDiagLine("videos"),
        ].join("\n");
        const box = document.querySelector("#emptyBox") || document.querySelector("#empty");
        if (box) {
          box.style.display = "";
          box.textContent = `${msg}\n${details}`;
        } else if (feed) {
          // CLS mitigation: postav nový obsah mimo DOM a jednorázově ho vyměň.
          const div = document.createElement("div");
          div.className = "iuErrorBox";
          div.textContent = `${msg}\n${details}`;
          const sectionsBar = document.getElementById("sectionsBar");
          if (sectionsBar) feed.replaceChildren(sectionsBar, div);
          else feed.replaceChildren(div);
          feed.setAttribute("data-feed-ready", "true");
        }
      }

      const delay =
        state.consecutiveLoadFailures >= 10 ? 180000 :
        state.consecutiveLoadFailures >= 5 ? 60000 :
        15000;
      setTimeout(() => {
        if (document.visibilityState === "visible") {
          loadData();
        }
      }, delay);
    } finally {
      state.isLoadingData = false;
    }
  }

  let iuRefreshTimer = null;
  function startAutoRefresh() {
    if (iuRefreshTimer) clearInterval(iuRefreshTimer);
    iuRefreshTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (document.body && document.body.classList && document.body.classList.contains("iu-home")) return;
      loadData();
    }, 7 * 60 * 1000);
  }

  // Safe public shims for UI-only routers (do not expose pipeline internals).
  // These are used to guarantee that navigating from Home -> any feed section triggers data load immediately.
  try{
    window.__iuLoadData = function(){ try{ return loadData(); }catch{} };
    window.__iuStartAutoRefresh = function(){ try{ return startAutoRefresh(); }catch{} };
    window.__iuStopAutoRefresh = function(){
      try{
        if (iuRefreshTimer) clearInterval(iuRefreshTimer);
        iuRefreshTimer = null;
      }catch{}
    };
  }catch{}

  async function fetchFeedHealth() {
    try {
      const res = await timeoutFetch(iuDataUrl("feed_health.json"), { cache: "no-store" }, 5000);
      if (res.status === 404) {
        debugWarn("[HEALTH] feed_health not found");
        return;
      }
      if (!res.ok) {
        debugWarn("[HEALTH] feed_health error", res.status);
        return;
      }
      const data = await res.json();
      const updated = data?.updatedAt ?? data?.updated_at;
      debugLog("[HEALTH] feed_health OK", updated ? `updatedAt=${updated}` : "updatedAt=—");
    } catch (err) {
      debugWarn("[HEALTH] feed_health fetch failed", err && err.message ? err.message : err);
    }
  }

  function persistLastOk(data) {
    try {
      localStorage.setItem("iu:lastOkAt", new Date().toISOString());
      localStorage.setItem("iu:lastOk", JSON.stringify(data));
    } catch {
      // ignore
    }
  }

  function persistLastError(message) {
    try {
      if (!message) {
        localStorage.removeItem("iu:lastErrorAt");
        localStorage.removeItem("iu:lastError");
      } else {
        localStorage.setItem("iu:lastErrorAt", new Date().toISOString());
        localStorage.setItem("iu:lastError", message);
      }
    } catch {
      // ignore
    }
    const el = document.getElementById("dataStatusLastError");
    if (el) {
      if (message) {
        el.textContent = "Poslední chyba: " + message;
        el.style.display = "";
      } else {
        el.textContent = "";
        el.style.display = "none";
      }
    }
    const inline = document.getElementById("lastErrInline");
    if (inline) {
      if (message) {
        inline.textContent = "Poslední chyba: " + message;
        inline.style.display = "block";
      } else {
        inline.textContent = "";
        inline.style.display = "none";
      }
    }
    if (message && message !== "Data existují, ale nic nebylo vykresleno") console.error("[ERR]", message);
  }
  try { window.persistLastError = persistLastError; } catch {}

  function handleMissingFeedContainer() {
    const msg = "[DOM] feed container missing";
    persistLastError(msg);
    const articlesEl = document.getElementById("dataStatusArticles");
    if (articlesEl) {
      articlesEl.textContent = "Články: chyba DOM";
    }
    return;
  }

  window.addEventListener("error", (event) => {
    try {
      const info = `${event.message} (${event.filename}:${event.lineno})`;
      console.error("[ERR]", info);
      persistLastError(info);
    } catch (err) {
      console.error("[ERR]", "error handler failed", err);
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event.reason ? event.reason.message || String(event.reason) : "unknown";
      console.error("[ERR]", "Promise rejection:", reason);
      persistLastError(`Promise rejection: ${reason}`);
    } catch (err) {
      console.error("[ERR]", "rejection handler failed", err);
    }
  });

  function updateNetworkStatus() {
    const el = document.getElementById("dataStatusNet");
    if (!el) return;
    el.textContent = `Síť: ${navigator.onLine ? "online" : "offline"}`;
  }

  function initAccordion() {
    const headers = document.querySelectorAll(".accordionCol .accHeader");
    if (!headers || headers.length === 0) {
      // No accordion markup in DOM — skip init safely
      return;
    }
    headers.forEach((header) => {
      const targetId = header.getAttribute("aria-controls");
      const content = targetId ? document.getElementById(targetId) : header.nextElementSibling;
      if (!content) return;
      content.style.maxHeight = "0px";
      content.style.overflow = "hidden";
      header.setAttribute("aria-expanded", "false");
      header.addEventListener("click", () => {
        const isExpanded = header.classList.toggle("is-open");
        header.setAttribute("aria-expanded", isExpanded ? "true" : "false");
        if (isExpanded) {
          content.style.maxHeight = `${content.scrollHeight}px`;
        } else {
          content.style.maxHeight = "0px";
        }
      });
    });
  }

  function updateSwStatusLabel() {
    const el = document.getElementById("dataStatusSW");
    if (!el) return;
    if (!("serviceWorker" in navigator)) {
      el.textContent = "SW: nepodporováno";
      return;
    }
    const controller = navigator.serviceWorker.controller ? "controller=ANO" : "controller=NE";
    const waiting = selfDiag.swWaiting === "yes" ? " waiting=ANO" : "";
    el.textContent = `SW: ${controller}${waiting}`;
  }

  function buildReportText() {
    const build = selfDiag.build || "no-build";
    const articles = `${selfDiag.articlesState} count=${selfDiag.articlesCount}`;
    const videos = `${selfDiag.videosState} count=${selfDiag.videosCount}`;
    const swController = navigator.serviceWorker?.controller ? "controller=ANO" : "controller=NE";
    const swWaiting = selfDiag.swWaiting === "yes" ? " waiting=ANO" : "";
    const updatedEl = document.getElementById("dataStatusUpdated");
    const updated = updatedEl ? updatedEl.textContent.trim() : "Aktualizace: —";
    const lastErrorAt = localStorage.getItem("iu:lastErrorAt") || "—";
    const lastError = localStorage.getItem("iu:lastError") || "—";
    const lastOkAt = localStorage.getItem("iu:lastArticlesOkAt") || "—";
    const lastOkCount = localStorage.getItem("iu:lastArticlesCount") || "—";
    return [
      `[REPORT] build=${build}`,
      `[REPORT] articles=${articles}`,
      `[REPORT] videos=${videos}`,
      `[REPORT] updated=${updated}`,
      `[REPORT] sw=${swController}${swWaiting}`,
      `[REPORT] lastErrorAt=${lastErrorAt}`,
      `[REPORT] lastError=${lastError}`,
      `[REPORT] lastOkAt=${lastOkAt}`,
      `[REPORT] lastOkCount=${lastOkCount}`,
    ].join("\n");
  }

  async function copyReportToClipboard() {
    const text = buildReportText();
    try {
      await navigator.clipboard.writeText(text);
      debugLog("[REPORT] copied");
    } catch {
      try {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "absolute";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
        debugLog("[REPORT] clipboard fallback used");
        debugLog("[REPORT] copied");
      } catch (fallbackErr) {
        const fallback = window.prompt("Copy report (Ctrl+C)", text);
        if (fallback !== null) {
          debugLog("[REPORT] copied");
        }
      }
    }
  }

  function refreshDebugPanelText() {
    const label = document.getElementById("dataDebugLabel");
    if (!label) return;
    label.textContent = `Debug: ${isDebugOn() ? "ON" : "OFF"}`;
  }

  const SW_RELOAD_KEY = "iu:swReloaded";
  const SW_RELOAD_AT_KEY = "iu:swReloadedAt";

  function clearStaleReloadGuard() {
    const at = Number(sessionStorage.getItem(SW_RELOAD_AT_KEY) || "0");
    if (!at) return false;
    if (Date.now() - at > 10 * 60 * 1000) {
      sessionStorage.removeItem(SW_RELOAD_KEY);
      sessionStorage.removeItem(SW_RELOAD_AT_KEY);
      debugLog("[SW] reload guard cleared");
      return false;
    }
    return Boolean(sessionStorage.getItem(SW_RELOAD_KEY));
  }

  function scheduleSWReload(worker) {
    if (!worker || !("sessionStorage" in window)) return;
    if (clearStaleReloadGuard()) return;
    try {
      worker.postMessage({ type: "SKIP_WAITING" });
      addTelemetryEvent("sw", "skip waiting");
    } catch (error) {
      debugWarn("[SW]", "skip waiting message failed", error);
    }
    sessionStorage.setItem(SW_RELOAD_KEY, "1");
    sessionStorage.setItem(SW_RELOAD_AT_KEY, Date.now().toString());
    window.location.reload();
  }

  function watchForSWUpdates() {
    if (!("serviceWorker" in navigator)) return;
    const handleRegistration = (reg) => {
      if (!reg) return;
      selfDiag.swController = navigator.serviceWorker?.controller ? "yes" : "no";
      if (reg.waiting) {
      addTelemetryEvent("sw", "waiting");
        selfDiag.swWaiting = "yes";
        logSelfStatus();
        scheduleSWReload(reg.waiting);
        return;
      }
      selfDiag.swWaiting = "no";
      logSelfStatus();
    updateSwStatusLabel();
      if (reg.waiting) {
        scheduleSWReload(reg.waiting);
        return;
      }
      const onUpdateFound = () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && reg.waiting) {
            scheduleSWReload(reg.waiting);
          }
        });
      };
      reg.addEventListener("updatefound", onUpdateFound);
      onUpdateFound();
    };

    navigator.serviceWorker
      .getRegistration()
      .then(handleRegistration)
      .catch(() => {});
    navigator.serviceWorker
      .ready
      .then(handleRegistration)
      .catch(() => {});
  }

  function auditLog() {
    const loadMoreEl = document.querySelector("[data-load-more], .loadMore");
    const loadMoreState = loadMoreEl && !loadMoreEl.hidden ? "visible" : "hidden";
    const swState = selfDiag.swWaiting === "yes"
      ? "waiting"
      : (selfDiag.swController === "yes" ? "controller" : "none");
    debugLog(`[AUDIT] build=${selfDiag.build}`);
    debugLog(`[AUDIT] articles=${selfDiag.articlesState} count=${selfDiag.articlesCount}`);
    debugLog(`[AUDIT] videos=${selfDiag.videosState} count=${selfDiag.videosCount}`);
    debugLog(`[AUDIT] loadMore=${loadMoreState}`);
    debugLog(`[AUDIT] sw=${swState}`);
  }

  // ============================================================
  // WEATHER (mobile funnel + "Moje město") — UI/UX only
  // ============================================================

  const IU_WEATHER_CITY_KEY = "iuWeatherCity";
  const IU_WEATHER_CITY_PIN_KEY = "iuWeatherCityPinned";
  const IU_WEATHER_CITY_SELECTED_KEY = "iuWeatherCitySelectedV1";
  const IU_WEATHER_LOCATION_MODE_LEGACY_KEY = "iuWeatherLocationModeV1";

  const IU_WEATHER_MODE_KEY = "iu_location_mode";
  const IU_MANUAL_LOCATION_KEY = "iu_manual_location";
  const IU_WEATHER_MODE_GPS = "gps";
  const IU_WEATHER_MODE_MANUAL = "manual";

  const IU_WEATHER_GPS_SELECTED_KEY = "iuWeatherGpsSelectedV1";

  const IU_WEATHER_DEFAULT_CITY = { name: "Praha", lat: 50.0755, lon: 14.4378 };

  function iuWeatherIsValidGeoCoords(lat, lon){
    const la = Number(lat);
    const lo = Number(lon);
    return (
      Number.isFinite(la) &&
      Number.isFinite(lo) &&
      la >= -90 &&
      la <= 90 &&
      lo >= -180 &&
      lo <= 180
    );
  }

  const IU_CITY_FALLBACK = [
    ["Praha","Hlavní město Praha",50.0755,14.4378],
    ["Brno","Brno-město",49.1951,16.6068],
    ["Ostrava","Ostrava-město",49.8209,18.2625],
    ["Plzeň","Plzeň-město",49.7384,13.3736],
  ];

  async function iuLoadCitiesSafe(){
    try{
      const r = await fetch(iuDataUrl("cz_cities_min.json"), { cache: "force-cache" });
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d) && d.length) return d;
      }
    }catch{}
    return IU_CITY_FALLBACK;
  }

  function iuCityLabel(c){ return c && c[1] ? `${c[0]} (${c[1]})` : String(c && c[0] || ""); }

  const IU_DAYS_FULL = ["Neděle","Pondělí","Úterý","Středa","Čtvrtek","Pátek","Sobota"];

  // ============================================================
  // WEATHER — History (daily deterministic YouTube pick, no API)
  // ============================================================

  function iuPad2(n){ return String(Number(n) || 0).padStart(2,"0"); }

  function iuDayKeyLocal(){
    const d = new Date();
    return `${d.getFullYear()}-${iuPad2(d.getMonth() + 1)}-${iuPad2(d.getDate())}`;
  }

  function iuHashStr(s){
    let h = 0;
    const t = String(s || "");
    for (let i = 0; i < t.length; i++){
      h = (((h << 5) - h) + t.charCodeAt(i)) | 0;
    }
    return h;
  }

  function iuValidYtId(id){
    return typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id);
  }

  function iuMsToNextMidnightLocal(){
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    return Math.max(1000, next.getTime() - now.getTime());
  }

  async function iuLoadWeatherHistorySafe(){
    try{
      // IMPORTANT: This page lives under /projects/ so the dataset URL must work there.
      // Try multiple deterministic candidates (no runtime API; repo file only).
      const urls = [iuDataUrl("weather_history_videos.json")];
      let lastOk = null;
      for (const u of urls){
        try{
          const r = await fetch(String(u), { cache: "force-cache" });
          if (!r || !r.ok) continue;
          const d = await r.json();
          if (!d || typeof d !== "object") continue;
          lastOk = d;
          break;
        }catch{
          // keep trying
        }
      }
      if (!lastOk) return null;

      const items = Array.isArray(lastOk.items) ? lastOk.items : [];
      if (!items.length) return { title: String(lastOk.title || ""), items: [] };
      const usable = items.filter((x) => x && iuValidYtId(String(x.id || "").trim()));
      return { title: String(lastOk.title || ""), items: usable };
    }catch{
      return null;
    }
  }

  function iuWeatherHistoryPick(items){
    try{
      if (!Array.isArray(items) || !items.length) return null;
      const key = iuDayKeyLocal();
      const idx = Math.abs(iuHashStr(key)) % items.length;
      return items[idx] || items[0] || null;
    }catch{
      return null;
    }
  }

  function iuWeatherHistoryRenderPick(pick){
    const card = document.getElementById("iuWeatherHistoryCard");
    const fallback = document.getElementById("iuWeatherHistoryFallback");
    const host = document.getElementById("iuWeatherHistoryPlayerHost");
    if (!card || !fallback || !host) return;

    if (!pick || !iuValidYtId(String(pick.id || "").trim())) {
      card.hidden = true;
      fallback.hidden = false;
      try{ host.replaceChildren(); }catch{}
      try{ host.hidden = true; }catch{}
      return;
    }

    const img = document.getElementById("iuWeatherHistoryThumb");
    const t = document.getElementById("iuWeatherHistoryTitle");
    const line = document.getElementById("iuWeatherHistoryLine");
    const note = document.getElementById("iuWeatherHistoryNote");

    if (!img || !t || !line || !note){
      card.hidden = true;
      fallback.hidden = false;
      return;
    }

    const id = String(pick.id || "").trim();
    const year = (typeof pick.year === "number" && isFinite(pick.year)) ? pick.year : null;
    const source = pick.source ? String(pick.source) : "";
    const title = pick.title ? String(pick.title) : "Historická předpověď počasí";
    const noteTxt = pick.note ? String(pick.note) : "";

    img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    img.onerror = () => {
      try{
        img.onerror = null;
        img.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
      }catch{}
    };

    t.textContent = title;
    line.textContent = [year ? `Rok ${year}` : "", source].filter(Boolean).join(" • ");
    note.textContent = noteTxt;

    // Reset player host on every render (prevents stale embeds).
    try{ host.replaceChildren(); }catch{}
    try{ host.hidden = true; }catch{}

    card.hidden = false;
    fallback.hidden = true;
  }

  function iuWeatherHistoryOpenPreview(pick){
    const host = document.getElementById("iuWeatherHistoryPlayerHost");
    if (!host) return;
    if (!pick || !iuValidYtId(String(pick.id || "").trim())) return;

    try{ host.replaceChildren(); }catch{}

    try{
      const markup = buildYouTubeVideoPreviewCard({
        videoId: String(pick.id || "").trim(),
        title: String(pick.title || "Historická předpověď počasí"),
        channel: String(pick.source || "YouTube"),
        publishedAt: "",
        category: "",
        thumb: `https://i.ytimg.com/vi/${String(pick.id || "").trim()}/hqdefault.jpg`,
        noExternalOpen: true,
      });
      const t = document.createElement("template");
      t.innerHTML = String(markup || "").trim();
      const node = t.content.firstElementChild;
      if (!node || !(node instanceof HTMLElement)) throw new Error("bad preview node");
      host.appendChild(node);
      host.hidden = false;

      // Trigger existing Media-like inline embed handler.
      const poster = node.querySelector(".iuVideoPoster");
      if (poster) {
        try{ poster.click(); }catch{}
      }
      // no debug logs in production
    }catch{
      try{ host.hidden = true; }catch{}
    }
  }

  function iuInitWeatherHistory(){
    // Init only when Weather section is active (keeps minimal load for other sections).
    try{
      const sec = String((document.body && document.body.dataset && document.body.dataset.section) || "");
      if (sec !== "pocasi") return;
    }catch{
      return;
    }
    try{
      if (window.__iu_weatherHistoryInit) return;
      window.__iu_weatherHistoryInit = 1;
    }catch{}

    const card = document.getElementById("iuWeatherHistoryCard");
    const fallback = document.getElementById("iuWeatherHistoryFallback");
    const btn = document.getElementById("iuWeatherHistoryPlay");
    const host = document.getElementById("iuWeatherHistoryPlayerHost");
    if (!card || !fallback || !btn || !host) return;

    let usable = [];
    let currentPick = null;
    let midnightTimer = 0;

    function scheduleMidnight(){
      try{ if (midnightTimer) clearTimeout(midnightTimer); }catch{}
      midnightTimer = setTimeout(() => {
        try{
          if (!usable.length) return;
          currentPick = iuWeatherHistoryPick(usable);
          try{ host.replaceChildren(); }catch{}
          try{ host.hidden = true; }catch{}
          iuWeatherHistoryRenderPick(currentPick);

          // optional: auto-open only when explicit URL param is set (no surprises)
          try{
            const params = new URLSearchParams(location.search || "");
            if (params.get("weatherHistoryPlay") === "1") {
              iuWeatherHistoryOpenPreview(currentPick);
              try{ history.replaceState({}, "", location.pathname + "?section=pocasi"); }catch{}
            }
          }catch{}
        }catch{
          // do not break Weather view
        }finally{
          scheduleMidnight();
        }
      }, iuMsToNextMidnightLocal());
    }

    (async () => {
      try{
        const d = await iuLoadWeatherHistorySafe();
        const items = d && Array.isArray(d.items) ? d.items : [];
        usable = items;
        if (!usable.length) {
          card.hidden = true;
          fallback.hidden = false;
          return;
        }

        currentPick = iuWeatherHistoryPick(usable);
        iuWeatherHistoryRenderPick(currentPick);

        btn.addEventListener("click", () => {
          try{
            if (!currentPick) return;
            iuWeatherHistoryOpenPreview(currentPick);
          }catch{
            try{ host.hidden = true; }catch{}
          }
        });

        // auto-play for headless proof only
        try{
          const params = new URLSearchParams(location.search || "");
          if (params.get("weatherHistoryPlay") === "1") {
            iuWeatherHistoryOpenPreview(currentPick);
            try{ history.replaceState({}, "", location.pathname + "?section=pocasi"); }catch{}
          }
        }catch{}

        scheduleMidnight();
      }catch{
        card.hidden = true;
        fallback.hidden = false;
      }
    })();
  }

  // Expose init for router/diagnostics (safe: function remains idempotent).
  try{ window.iuInitWeatherHistory = iuInitWeatherHistory; }catch{}

  function iuWeatherNorm(s){
    try{
      return String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
    }catch{
      return String(s || "").toLowerCase().trim();
    }
  }

  function iuWeatherMigrateLegacyOnce(){
    try{
      if (window.__iuWeatherLegacyMigrated) return;
      window.__iuWeatherLegacyMigrated = 1;
      if (localStorage.getItem(IU_WEATHER_MODE_KEY)) return;
      localStorage.setItem(IU_WEATHER_MODE_KEY, IU_WEATHER_MODE_GPS);
    }catch{}
  }

  function iuWeatherReadManualLocation(){
    try{
      const raw = localStorage.getItem(IU_MANUAL_LOCATION_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      const lat = Number(o.lat);
      const lon = Number(o.lon);
      const label = String(o.label || "").trim();
      if (!isFinite(lat) || !isFinite(lon) || !label) return null;
      if (!iuWeatherIsValidGeoCoords(lat, lon)) {
        try{ localStorage.removeItem(IU_MANUAL_LOCATION_KEY); }catch{}
        return null;
      }
      return { lat, lon, label };
    }catch{}
    return null;
  }

  function iuWeatherWriteManualLocation(m){
    try{
      if (!m || !iuWeatherIsValidGeoCoords(m.lat, m.lon)) return;
      localStorage.setItem(
        IU_MANUAL_LOCATION_KEY,
        JSON.stringify({
          lat: Number(m.lat),
          lon: Number(m.lon),
          label: String(m.label || "").trim(),
        }),
      );
    }catch{}
  }

  function iuWeatherReadLocationMode(){
    try{
      iuWeatherMigrateLegacyOnce();
      const m = String(localStorage.getItem(IU_WEATHER_MODE_KEY) || IU_WEATHER_MODE_GPS).trim().toLowerCase();
      return m === IU_WEATHER_MODE_MANUAL ? IU_WEATHER_MODE_MANUAL : IU_WEATHER_MODE_GPS;
    }catch{}
    return IU_WEATHER_MODE_GPS;
  }

  function iuWeatherWriteLocationMode(mode){
    try{
      const m = mode === IU_WEATHER_MODE_MANUAL ? IU_WEATHER_MODE_MANUAL : IU_WEATHER_MODE_GPS;
      localStorage.setItem(IU_WEATHER_MODE_KEY, m);
    }catch{}
  }

  function iuWeatherReadGpsSelected(){
    try{
      const raw = localStorage.getItem(IU_WEATHER_GPS_SELECTED_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      const name = String(obj && obj.name || "").trim();
      const lat = Number(obj && obj.lat);
      const lon = Number(obj && obj.lon);
      if (!name || !isFinite(lat) || !isFinite(lon)) return null;
      return { name, lat, lon };
    }catch{
      return null;
    }
  }

  function iuWeatherWriteGpsSelected(city){
    try{
      if (!city) return;
      localStorage.setItem(IU_WEATHER_GPS_SELECTED_KEY, JSON.stringify({
        name: String(city.name || "").trim(),
        lat: Number(city.lat),
        lon: Number(city.lon),
      }));
    }catch{}
  }

  function iuWeatherClearRuntimeCity(){
    try{
      if (window.__iuWeatherRuntimeCity) window.__iuWeatherRuntimeCity = null;
      try{ delete window.__iuWeatherRuntimeCity; }catch{}
    }catch{}
  }

  function iuWeatherGetRuntime(){
    try{
      const c = window.__iuWeatherRuntimeCity;
      if (c && typeof c === "object" && c.name && isFinite(Number(c.lat)) && isFinite(Number(c.lon))) {
        return { name: String(c.name), lat: Number(c.lat), lon: Number(c.lon) };
      }
    }catch{}
    return null;
  }

  function iuWeatherGetActiveCity(){
    const runtime = iuWeatherGetRuntime();
    if (runtime) return runtime;
    const mode = iuWeatherReadLocationMode();
    if (mode === IU_WEATHER_MODE_MANUAL) {
      const man = iuWeatherReadManualLocation();
      if (man) return { name: man.label, lat: man.lat, lon: man.lon, key: null };
    }
    const gps = iuWeatherReadGpsSelected();
    if (gps) return { name: gps.name, lat: gps.lat, lon: gps.lon, key: null };
    return IU_WEATHER_DEFAULT_CITY;
  }

  function iuWeatherSetRuntime(city){
    try{ window.__iuWeatherRuntimeCity = { name: city.name, lat: city.lat, lon: city.lon }; }catch{}
  }

  function iuWeatherBumpDailyPanelWeatherToken(){
    try{ window.__iuDailyPanelWxToken = (window.__iuDailyPanelWxToken || 0) + 1; }catch{}
  }

  function iuWeatherStateMatchesActiveCity(st){
    try{
      if (!st || typeof st.lat !== "number" || typeof st.lon !== "number" || !isFinite(st.lat) || !isFinite(st.lon)) return false;
      const cur = iuWeatherGetActiveCity();
      if (!cur || typeof cur.lat !== "number" || typeof cur.lon !== "number") return false;
      return Math.abs(st.lat - cur.lat) < 0.00002 && Math.abs(st.lon - cur.lon) < 0.00002;
    }catch{ return false; }
  }

  function iuWeatherCityKeyFromRow(c, idx){
    try{
      const nm = c && c[0] ? String(c[0]).trim() : "";
      const la = Number(c && c[2]);
      const lo = Number(c && c[3]);
      const i = typeof idx === "number" ? idx : 0;
      return `cz-${i}-${iuWeatherNorm(nm)}-${la.toFixed(4)}-${lo.toFixed(4)}`.replace(/\s+/g, "-");
    }catch{
      return "cz-unknown";
    }
  }

  function iuWeatherResetMapView(root){
    try{
      if (IU_DISABLE_WEATHER_MAIN_MAP) return;
      if (!root) return;
      root.innerHTML = "";
      root.removeAttribute("data-view-key");
      root.removeAttribute("data-source-key");
      root.removeAttribute("data-layer-key");
    }catch{}
  }

  function iuWeatherSetMapState(mapUiState){
    try{
      if (IU_DISABLE_WEATHER_MAIN_MAP) return;
      const sk = document.getElementById("iuWxMapSkeleton");
      const ok = document.getElementById("iuWxMapSuccess");
      const fail = document.getElementById("iuWxMapFail");
      if (!sk || !ok || !fail) return;
      const loading = mapUiState === "loading";
      const success = mapUiState === "success";
      const failSt = mapUiState === "fail";
      sk.hidden = !loading;
      sk.setAttribute("aria-hidden", loading ? "false" : "true");
      ok.hidden = !success;
      ok.setAttribute("aria-hidden", success ? "false" : "true");
      fail.hidden = !failSt;
      fail.setAttribute("aria-hidden", failSt ? "false" : "true");
    }catch{}
  }

  function iuWeatherApplySharedStateMeta(state){
    try{
      if (!state || typeof state !== "object") return;
      const mode = iuWeatherReadLocationMode();
      const man = iuWeatherReadManualLocation();
      const gps = iuWeatherReadGpsSelected();
      const active = iuWeatherGetActiveCity();
      state.mode = mode;
      state.manual = man ? { label: man.label, lat: man.lat, lon: man.lon } : null;
      state.gps = gps ? { label: gps.name, lat: gps.lat, lon: gps.lon } : null;
      state.activeLocation = {
        label: active && active.name ? String(active.name) : "—",
        lat: active && typeof active.lat === "number" ? active.lat : null,
        lon: active && typeof active.lon === "number" ? active.lon : null,
      };
      if (!state.map || typeof state.map !== "object") state.map = {};
      const root = document.getElementById("iuWxMapContainer");
      if (root) {
        const vk = root.getAttribute("data-view-key");
        const sk = root.getAttribute("data-source-key");
        if (vk) state.map.currentViewKey = vk;
        if (sk) state.map.currentSourceKey = sk;
      }
    }catch{}
  }
  try{
    window.iuWeatherResetMapView = iuWeatherResetMapView;
    window.iuWeatherSetMapState = iuWeatherSetMapState;
    window.iuWeatherApplySharedStateMeta = iuWeatherApplySharedStateMeta;
    window.iuWeatherIsValidGeoCoords = iuWeatherIsValidGeoCoords;
  }catch{}

  const __iuOpenMeteoCache = new Map(); // key -> { t, data, p }
  function iuWeatherClearOpenMeteoCache(){
    try{ __iuOpenMeteoCache.clear(); }catch{}
  }
  function iuOpenMeteoUrl(lat, lon){
    const la = Number(lat);
    const lo = Number(lon);
    return (
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${encodeURIComponent(String(la))}&longitude=${encodeURIComponent(String(lo))}` +
      "&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,relative_humidity_2m,visibility" +
      "&hourly=temperature_2m,apparent_temperature,weather_code,is_day,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,relative_humidity_2m,visibility,uv_index" +
      "&daily=temperature_2m_max,temperature_2m_min,weather_code,uv_index_max,sunrise,sunset" +
      "&timezone=Europe%2FPrague" +
      "&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm&pressure_unit=hPa" +
      "&models=gfs_seamless"
    );
  }
  async function iuFetchOpenMeteo(lat, lon){
    if (!iuWeatherIsValidGeoCoords(lat, lon)) throw new Error("bad coords");
    const key = `${Number(lat)},${Number(lon)}`;
    const now = Date.now();
    const cached = __iuOpenMeteoCache.get(key);
    if (cached && cached.data && (now - cached.t) < 5 * 60 * 1000) return cached.data;
    if (cached && cached.p) return await cached.p;
    const url = iuOpenMeteoUrl(lat, lon);
    const p = fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        __iuOpenMeteoCache.set(key, { t: Date.now(), data: d });
        return d;
      })
      .finally(() => {
        const cur = __iuOpenMeteoCache.get(key);
        if (cur && cur.p) __iuOpenMeteoCache.set(key, { t: cur.t || now, data: cur.data || null });
      });
    __iuOpenMeteoCache.set(key, { t: now, p });
    return await p;
  }

  function iuWxNormalizeWeatherCode(code){
    if (code === null || code === undefined) return null;
    const c = Number(code);
    if (!isFinite(c)) return null;
    return c;
  }

  function iuWxNormalizeIsDay(v){
    if (v === true || v === 1) return true;
    if (v === false || v === 0) return false;
    if (v === null || v === undefined) return null;
    if (typeof v === "string"){
      const s = v.trim();
      if (s === "1" || s === "true") return true;
      if (s === "0" || s === "false") return false;
    }
    const n = Number(v);
    if (n === 1 && isFinite(n)) return true;
    if (n === 0 && isFinite(n)) return false;
    return null;
  }

  function iuWxDeriveIsDayFromTsSunriseSunset(ts, sunriseStr, sunsetStr){
    try{
      if (!ts || !(ts instanceof Date) || isNaN(ts.getTime())) return null;
      if (sunriseStr == null || sunsetStr == null) return null;
      const s1 = String(sunriseStr).trim();
      const s2 = String(sunsetStr).trim();
      if (s1 === "" || s2 === "") return null;
      const sr = new Date(s1);
      const ss = new Date(s2);
      if (isNaN(sr.getTime()) || isNaN(ss.getTime())) return null;
      if (sr.getTime() >= ss.getTime()) return null;
      const t = ts.getTime();
      if (t >= sr.getTime() && t < ss.getTime()) return true;
      return false;
    }catch{
      return null;
    }
  }

  function iuWxFallbackIsDayFromTsPrague(d){
    try{
      if (!d || !(d instanceof Date) || isNaN(d.getTime())) return true;
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", hour: "numeric", hour12: false }).formatToParts(d);
      let h = null;
      for (let i = 0; i < parts.length; i++){
        if (parts[i].type === "hour") h = parseInt(parts[i].value, 10);
      }
      if (h == null || !isFinite(h)) return true;
      return h >= 6 && h < 20;
    }catch{
      return true;
    }
  }

  function iuWxFindDailySunriseSunsetForDate(daily, dt){
    try{
      if (!daily || !dt || !(dt instanceof Date) || isNaN(dt.getTime())) return { sr: null, ss: null };
      const times = Array.isArray(daily.time) ? daily.time : [];
      const sunr = Array.isArray(daily.sunrise) ? daily.sunrise : null;
      const suns = Array.isArray(daily.sunset) ? daily.sunset : null;
      if (!sunr || !suns || times.length === 0) return { sr: null, ss: null };
      const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" });
      const dayKey = dtf.format(dt);
      for (let j = 0; j < times.length; j++){
        const tj = new Date(String(times[j] || ""));
        if (isNaN(tj.getTime())) continue;
        if (dtf.format(tj) === dayKey) return { sr: sunr[j], ss: suns[j] };
      }
    }catch{}
    return { sr: null, ss: null };
  }

  function iuWxCodeIsDayNightVariant(c){
    const n = Number(c);
    if (!isFinite(n)) return false;
    return n === 0 || n === 1 || n === 2;
  }

  /** WMO weather_code → emoji; day/night agnostic (no sun/moon for variant codes — use resolve). */
  function iuWxIconFromCodeStatic(code){
    const c = iuWxNormalizeWeatherCode(code);
    if (c === null) return "☁️";
    if (c === 0) return "☀️";
    if (c === 1 || c === 2) return "🌤";
    if (c === 3) return "☁️";
    if (c >= 45 && c <= 48) return "🌫";
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return "🌧";
    if (c >= 71 && c <= 77) return "❄️";
    if (c >= 95) return "⛈";
    return "☁️";
  }

  /**
   * Single resolver for current + hourly: weather_code + is_day (or derived).
   * Variant-sensitive: WMO 0–2 (clear / mainly clear / partly cloudy). Other codes unchanged by day/night.
   */
  function iuWxResolveWeatherIcon(weatherCode, isDay){
    const c = iuWxNormalizeWeatherCode(weatherCode);
    if (c === null) return "☁️";
    if (!iuWxCodeIsDayNightVariant(c)) return iuWxIconFromCodeStatic(c);
    const id = iuWxNormalizeIsDay(isDay);
    if (id === true){
      if (c === 0) return "☀️";
      if (c === 1 || c === 2) return "🌤";
      return "🌤";
    }
    if (id === false){
      if (c === 0 || c === 1) return "🌙";
      if (c === 2) return "☁️";
      return "🌙";
    }
    return "☁️";
  }

  function iuWxIconFromCode(code){
    return iuWxIconFromCodeStatic(code);
  }

  try{
    window.iuWxResolveWeatherIcon = iuWxResolveWeatherIcon;
    window.iuWxNormalizeIsDay = iuWxNormalizeIsDay;
    window.iuWxDeriveIsDayFromTsSunriseSunset = iuWxDeriveIsDayFromTsSunriseSunset;
  }catch{}

  function iuFmtDegShort(n){
    if (typeof n !== "number" || !isFinite(n)) return "—";
    return Math.round(n) + "°";
  }

  function iuFmtDateShort(d){
    try{
      const TZ = "Europe/Prague";
      return new Intl.DateTimeFormat("cs-CZ",{weekday:"short",day:"numeric",month:"numeric",timeZone:TZ}).format(d);
    }catch{
      return "";
    }
  }

  function iuWeatherSyncCityLabels(city){
    try{
      const mode = iuWeatherReadLocationMode();
      const h1 = document.getElementById("iuWeatherCityH1");
      const myNameEl = document.getElementById("iuWeatherMyCityName");
      const geoLabel = document.getElementById("iuWeatherGeoLabel");
      const geoBtn = document.getElementById("iuWeatherGeoBtn");
      const cityBtn = document.getElementById("iuWeatherCityChange");
      const disp = city && city.name ? String(city.name) : "—";
      const gpsStored = iuWeatherReadGpsSelected();
      const manualStored = iuWeatherReadManualLocation();

      if (h1) h1.textContent = disp;

      let geoInfo = "—";
      if (mode === IU_WEATHER_MODE_GPS) {
        geoInfo = disp;
      } else {
        geoInfo = gpsStored && gpsStored.name ? String(gpsStored.name) : "—";
      }

      let myInfo = "—";
      if (mode === IU_WEATHER_MODE_MANUAL) {
        myInfo = disp;
      } else {
        if (manualStored && manualStored.label) myInfo = String(manualStored.label).trim();
        else myInfo = String(IU_WEATHER_DEFAULT_CITY && IU_WEATHER_DEFAULT_CITY.name ? IU_WEATHER_DEFAULT_CITY.name : "Praha");
      }

      if (geoLabel) geoLabel.textContent = geoInfo;
      if (myNameEl) myNameEl.textContent = myInfo;

      if (mode === IU_WEATHER_MODE_GPS) {
        if (geoBtn) {
          geoBtn.textContent = "Aktuální poloha";
          geoBtn.classList.add("iuWeatherMyCityBtn--active");
          geoBtn.setAttribute("aria-pressed", "true");
        }
        if (cityBtn) {
          cityBtn.textContent = "Změnit na moje město";
          cityBtn.classList.remove("iuWeatherMyCityBtn--active");
          cityBtn.setAttribute("aria-pressed", "false");
        }
      } else {
        if (geoBtn) {
          geoBtn.textContent = "Změnit na aktuální polohu";
          geoBtn.classList.remove("iuWeatherMyCityBtn--active");
          geoBtn.setAttribute("aria-pressed", "false");
        }
        if (cityBtn) {
          cityBtn.textContent = "Moje město / Změnit město";
          cityBtn.classList.add("iuWeatherMyCityBtn--active");
          cityBtn.setAttribute("aria-pressed", "true");
        }
      }

      const geoInfoWrap = document.getElementById("iuWeatherGeoInfoLineWrap");
      const myInfoWrap = document.getElementById("iuWeatherMyCityInfoLineWrap");
      if (mode === IU_WEATHER_MODE_GPS) {
        if (geoInfoWrap) {
          geoInfoWrap.hidden = false;
          geoInfoWrap.setAttribute("aria-hidden", "false");
        }
        if (myInfoWrap) {
          myInfoWrap.hidden = true;
          myInfoWrap.setAttribute("aria-hidden", "true");
        }
      } else {
        if (geoInfoWrap) {
          geoInfoWrap.hidden = true;
          geoInfoWrap.setAttribute("aria-hidden", "true");
        }
        if (myInfoWrap) {
          myInfoWrap.hidden = false;
          myInfoWrap.setAttribute("aria-hidden", "false");
        }
      }

      try{
        const fb = window.__iuWeatherGeoFlowFeedback;
        if (fb && fb.message && (fb.kind === "loading" || fb.kind === "error")) {
          const geoLabelEl = document.getElementById("iuWeatherGeoLabel");
          const geoBtnEl = document.getElementById("iuWeatherGeoBtn");
          const geoWrapEl = document.getElementById("iuWeatherGeoInfoLineWrap");
          if (geoLabelEl) geoLabelEl.textContent = fb.message;
          if (geoWrapEl) {
            geoWrapEl.hidden = false;
            geoWrapEl.setAttribute("aria-hidden", "false");
          }
          if (geoBtnEl) {
            geoBtnEl.textContent = fb.message;
            if (fb.kind === "error") {
              geoBtnEl.setAttribute("aria-invalid", "true");
              geoBtnEl.removeAttribute("aria-busy");
            } else {
              geoBtnEl.setAttribute("aria-busy", "true");
              geoBtnEl.removeAttribute("aria-invalid");
            }
          }
        }
      }catch{}
    }catch{}
  }

  function iuWeatherRender7Day(daily){
    const host = document.getElementById("iuWx7Day");
    if (!host) return;
    const rows = Array.from(host.querySelectorAll(".iuWx7Row"));
    const times = daily && Array.isArray(daily.time) ? daily.time : [];
    const maxs = daily && Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [];
    const mins = daily && Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min : [];
    const codes = daily && Array.isArray(daily.weather_code) ? daily.weather_code : [];
    for (let i = 0; i < 7; i++){
      const row = rows[i];
      if (!row) continue;
      const t = times[i];
      const max = maxs[i];
      const min = mins[i];
      const code = codes[i];
      let dayName = "—";
      try{
        const dt = new Date(String(t || ""));
        if (!isNaN(dt.getTime())) {
          const wd = dt.getDay();
          dayName = IU_DAYS_FULL[wd] || IU_DAYS_FULL[0];
        }
      }catch{}
      const icon = iuWxResolveWeatherIcon(code, true);
      const temps = `${iuFmtDegShort(max)} / ${iuFmtDegShort(min)}`;
      row.innerHTML = `<div class="iuWx7DayName">${escapeHtml(dayName)}</div><div class="iuWx7Icon">${escapeHtml(icon)}</div><div class="iuWx7Temps">${escapeHtml(temps)}</div>`;
      row.removeAttribute("aria-hidden");
    }
  }

  function iuWeatherUpdateHours(hourly, daily){
    const elHours = document.getElementById("iuWxHours");
    if (!elHours) return;
    const slots = Array.from(elHours.querySelectorAll(".iuWxHour"));
    const nextList = iuWxSelectNextHoursFromHourly(hourly, daily);
    for (let i = 0; i < slots.length; i++){
      const slot = slots[i];
      const it = nextList[i];
      if (!slot) continue;
      if (it) {
        let timeTxt = "--:--";
        try{
          timeTxt = new Intl.DateTimeFormat("cs-CZ",{
            hour:"2-digit",
            minute:"2-digit",
            hour12:false,
            timeZone:"Europe/Prague",
          }).format(it.time);
        }catch{}
        const icon = iuWxResolveWeatherIcon(it.weatherCode, it.isDay);
        const tempTxt = iuFmtDegShort(it.temperatureC);
        let precipTxt = "—";
        if (typeof it.precipProbability === "number" && isFinite(it.precipProbability)) precipTxt = `${Math.round(it.precipProbability)}%`;
        slot.innerHTML =
          `<div class="iuWxHourTime">${escapeHtml(timeTxt)}</div>` +
          `<div class="iuWxHourIcon">${escapeHtml(icon)}</div>` +
          `<div class="iuWxHourTemp">${escapeHtml(tempTxt)}</div>` +
          `<div class="iuWxHourPrecip">${escapeHtml(precipTxt)}</div>`;
        slot.removeAttribute("aria-hidden");
      } else {
        slot.innerHTML =
          `<div class="iuWxHourTime">--:--</div>` +
          `<div class="iuWxHourIcon">☁️</div>` +
          `<div class="iuWxHourTemp">—</div>` +
          `<div class="iuWxHourPrecip">—</div>`;
        slot.setAttribute("aria-hidden", "true");
      }
    }
    try{ elHours.classList.remove("iuWxHours--skeleton"); }catch{}
  }

  function iuWxClamp01(n){
    if (typeof n !== "number" || !isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  }

  function iuWxFormatHourHHMM(d){
    try{
      return new Intl.DateTimeFormat("cs-CZ",{
        hour:"2-digit",
        minute:"2-digit",
        hour12:false,
        timeZone:"Europe/Prague",
      }).format(d);
    }catch{
      try{
        const hh = String(d.getHours());
        return `${hh}:00`;
      }catch{
        return "—";
      }
    }
  }

  function iuWxWindDirLabel(deg){
    const d = Number(deg);
    if (!isFinite(d)) return "—";
    const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    const idx = Math.round(d / 22.5) % 16;
    return dirs[idx] || "—";
  }

  function iuWxUvCategory(uvIndex){
    const u = Number(uvIndex);
    if (!isFinite(u)) return { label: "—", cat: "—" };
    const v = Math.max(0, u);
    if (v < 3) return { label: "Nízké", cat: "0-2" };
    if (v < 6) return { label: "Mírné", cat: "3-5" };
    if (v < 8) return { label: "Vysoké", cat: "6-7" };
    if (v < 11) return { label: "Velmi vysoké", cat: "8-10" };
    return { label: "Extrémní", cat: "11+" };
  }

  function iuWxInferPrecipText(code){
    const c = Number(code);
    if (!isFinite(c)) return "Srážky";
    if (c >= 71 && c <= 77) return "Sněžení";
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 95)) return "Déšť";
    if (c >= 45 && c <= 48) return "Mlha / vlhko";
    return "Srážky";
  }

  function iuWxSelectNextHoursFromHourly(hourly, daily){
    const now = new Date();
    const times = hourly && Array.isArray(hourly.time) ? hourly.time : [];
    const temps = hourly && Array.isArray(hourly.temperature_2m) ? hourly.temperature_2m : [];
    const feels = hourly && Array.isArray(hourly.apparent_temperature) ? hourly.apparent_temperature : [];
    const codes = hourly && Array.isArray(hourly.weather_code) ? hourly.weather_code : [];
    const pProbs = hourly && Array.isArray(hourly.precipitation_probability) ? hourly.precipitation_probability : [];
    const pMm = hourly && Array.isArray(hourly.precipitation) ? hourly.precipitation : [];
    const wSpd = hourly && Array.isArray(hourly.wind_speed_10m) ? hourly.wind_speed_10m : [];
    const wGust = hourly && Array.isArray(hourly.wind_gusts_10m) ? hourly.wind_gusts_10m : [];
    const wDir = hourly && Array.isArray(hourly.wind_direction_10m) ? hourly.wind_direction_10m : [];
    const pMsl = hourly && Array.isArray(hourly.pressure_msl) ? hourly.pressure_msl : [];
    const rh = hourly && Array.isArray(hourly.relative_humidity_2m) ? hourly.relative_humidity_2m : [];
    const vis = hourly && Array.isArray(hourly.visibility) ? hourly.visibility : [];
    const uv = hourly && Array.isArray(hourly.uv_index) ? hourly.uv_index : [];
    const isDayArr = hourly && Array.isArray(hourly.is_day) ? hourly.is_day : [];

    const out = [];
    for (let i = 0; i < times.length; i++){
      const dt = new Date(times[i]);
      if (isNaN(dt.getTime())) continue;
      if (dt < now) continue;
      const code = codes[i];
      let hourIsDay = iuWxNormalizeIsDay(isDayArr[i]);
      if (hourIsDay === null) {
        const { sr, ss } = iuWxFindDailySunriseSunsetForDate(daily, dt);
        hourIsDay = iuWxDeriveIsDayFromTsSunriseSunset(dt, sr, ss);
      }
      if (hourIsDay === null) hourIsDay = iuWxFallbackIsDayFromTsPrague(dt);
      out.push({
        time: dt,
        temperatureC: typeof temps[i] === "number" ? temps[i] : null,
        feelsLikeC: typeof feels[i] === "number" ? feels[i] : null,
        weatherCode: code,
        isDay: hourIsDay,
        precipProbability: typeof pProbs[i] === "number" ? pProbs[i] : null,
        precipMm: typeof pMm[i] === "number" ? pMm[i] : null,
        windKph: typeof wSpd[i] === "number" ? wSpd[i] : null,
        windGustKph: typeof wGust[i] === "number" ? wGust[i] : null,
        windDirDeg: typeof wDir[i] === "number" ? wDir[i] : null,
        pressureHpa: typeof pMsl[i] === "number" ? pMsl[i] : null,
        humidityPct: typeof rh[i] === "number" ? rh[i] : null,
        visibilityKm: iuWxNormalizeVisibilityKm(vis[i]),
        uvIndex: typeof uv[i] === "number" ? uv[i] : null,
      });
      if (out.length >= 6) break;
    }
    return out;
  }

  function iuWxComputePrecipTodayMm(hourly){
    try{
      if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.precipitation)) return null;
      const times = hourly.time;
      const pMm = hourly.precipitation;
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      const d0 = now.getDate();
      let sum = 0;
      let any = false;
      for (let i = 0; i < times.length; i++){
        const dt = new Date(times[i]);
        if (isNaN(dt.getTime())) continue;
        if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d0) continue;
        if (typeof pMm[i] === "number" && isFinite(pMm[i]) && pMm[i] >= 0){
          sum += pMm[i];
          any = true;
        }
      }
      if (!any) return null;
      return sum;
    }catch{
      return null;
    }
  }

  function iuWxNormalizeVisibilityKm(v){
    const n = Number(v);
    if (!isFinite(n) || n < 0) return null;
    if (n > 1000) return n / 1000;
    return n;
  }

  /** When true, the main weather SVG map block is omitted from DOM; all map init/render for that section is skipped. */
  const IU_DISABLE_WEATHER_MAIN_MAP = true;

  const IU_WX_MAP_LAYER_KEYS = ["precip", "wind", "pressure", "temp"];
  const IU_WEATHER_MAP_LAYER_STORAGE_KEY = "iuWeatherMapActiveLayerV1";
  function iuWxSanitizeMapLayerKey(k){
    try{
      const t = k == null || k === "" ? "" : String(k).trim();
      if (IU_WX_MAP_LAYER_KEYS.indexOf(t) !== -1) return t;
    }catch{}
    return "precip";
  }
  function iuWxReadPersistedMapLayer(){
    try{
      const raw = localStorage.getItem(IU_WEATHER_MAP_LAYER_STORAGE_KEY);
      if (!raw) return null;
      return String(raw).trim();
    }catch{ return null; }
  }
  function iuWxPersistMapLayer(layerId){
    try{
      localStorage.setItem(IU_WEATHER_MAP_LAYER_STORAGE_KEY, iuWxSanitizeMapLayerKey(layerId));
    }catch{}
  }

  function iuWxBuildWeatherState(city, d, locationMode, keepActiveLayer){
    const cur = d && d.current ? d.current : {};
    const hourly = d && d.hourly ? d.hourly : {};
    const daily = d && d.daily ? d.daily : {};

    const nextHours = iuWxSelectNextHoursFromHourly(hourly, daily);

    const todayMax = daily && Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : null;
    const todayMin = daily && Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : null;

    const feelsLikeC =
      (typeof cur.apparent_temperature === "number" && isFinite(cur.apparent_temperature))
        ? cur.apparent_temperature
        : (nextHours[0] && typeof nextHours[0].feelsLikeC === "number" ? nextHours[0].feelsLikeC : null);

    const windKph = (typeof cur.wind_speed_10m === "number" && isFinite(cur.wind_speed_10m))
      ? cur.wind_speed_10m
      : (nextHours[0] && typeof nextHours[0].windKph === "number" ? nextHours[0].windKph : null);

    const windGustKph = (typeof cur.wind_gusts_10m === "number" && isFinite(cur.wind_gusts_10m))
      ? cur.wind_gusts_10m
      : (nextHours[0] && typeof nextHours[0].windGustKph === "number" ? nextHours[0].windGustKph : null);

    const windDirDeg = (typeof cur.wind_direction_10m === "number" && isFinite(cur.wind_direction_10m))
      ? cur.wind_direction_10m
      : (nextHours[0] && typeof nextHours[0].windDirDeg === "number" ? nextHours[0].windDirDeg : null);

    const pressureHpa = (typeof cur.pressure_msl === "number" && isFinite(cur.pressure_msl))
      ? cur.pressure_msl
      : (nextHours[0] && typeof nextHours[0].pressureHpa === "number" ? nextHours[0].pressureHpa : null);

    const humidityPct = (typeof cur.relative_humidity_2m === "number" && isFinite(cur.relative_humidity_2m))
      ? cur.relative_humidity_2m
      : (nextHours[0] && typeof nextHours[0].humidityPct === "number" ? nextHours[0].humidityPct : null);

    const visibilityRaw = (typeof cur.visibility === "number" && isFinite(cur.visibility))
      ? cur.visibility
      : (nextHours[0] && typeof nextHours[0].visibilityKm === "number" ? nextHours[0].visibilityKm : null);
    const visibilityKm = iuWxNormalizeVisibilityKm(visibilityRaw);

    const uvIndex = (typeof nextHours[0]?.uvIndex === "number" && isFinite(nextHours[0].uvIndex))
      ? nextHours[0].uvIndex
      : (daily && Array.isArray(daily.uv_index_max) ? daily.uv_index_max[0] : null);

    const weatherCode = (typeof cur.weather_code === "number" && isFinite(cur.weather_code))
      ? cur.weather_code
      : (nextHours[0] ? nextHours[0].weatherCode : null);

    const curTs =
      (cur.time != null && String(cur.time).trim() !== "")
        ? new Date(String(cur.time))
        : new Date();
    let currentIsDay = iuWxNormalizeIsDay(cur.is_day);
    if (currentIsDay === null) {
      const { sr, ss } = iuWxFindDailySunriseSunsetForDate(daily, curTs);
      currentIsDay = iuWxDeriveIsDayFromTsSunriseSunset(curTs, sr, ss);
    }
    if (currentIsDay === null) currentIsDay = iuWxFallbackIsDayFromTsPrague(curTs);

    const precipTodayMm = iuWxComputePrecipTodayMm(hourly);

    // Next-hour narrative and map layer intensities
    let bestPrecip = null;
    if (Array.isArray(nextHours) && nextHours.length){
      for (let i = 0; i < nextHours.length; i++){
        const it = nextHours[i];
        if (!it) continue;
        const p = it.precipProbability;
        if (typeof p === "number" && isFinite(p)){
          if (bestPrecip == null || p > bestPrecip.p){
            bestPrecip = { i, p, code: it.weatherCode, time: it.time };
          }
        }
      }
    }

    let gustMax = null;
    if (Array.isArray(nextHours) && nextHours.length){
      for (let i = 0; i < nextHours.length; i++){
        const it = nextHours[i];
        if (!it) continue;
        const g = it.windGustKph;
        const s = it.windKph;
        const v = (typeof g === "number" && isFinite(g)) ? g : s;
        if (typeof v === "number" && isFinite(v)){
          if (gustMax == null || v > gustMax) gustMax = v;
        }
      }
    }

    const icon = iuWxResolveWeatherIcon(weatherCode, currentIsDay);
    const tTxt = (typeof cur.temperature_2m === "number" && isFinite(cur.temperature_2m)) ? Math.round(cur.temperature_2m) : null;

    let precipPart = "Spíše bez srážek.";
    if (bestPrecip && typeof bestPrecip.p === "number" && isFinite(bestPrecip.p) && bestPrecip.p >= 20 && bestPrecip.time){
      const timeLabel = iuWxFormatHourHHMM(bestPrecip.time);
      const what = iuWxInferPrecipText(bestPrecip.code);
      precipPart = `${what} kolem ${timeLabel}.`;
    }

    let windPart = "";
    if (typeof gustMax === "number" && isFinite(gustMax)){
      windPart = ` Vítr až ${Math.round(gustMax)} km/h.`;
    }

    const narrative = `${precipPart}${windPart}`.replace(/\s+/g, " ").trim();

    const feelsLikeNum = (typeof feelsLikeC === "number" && isFinite(feelsLikeC)) ? Math.round(feelsLikeC) : null;
    const tempNum = (typeof cur.temperature_2m === "number" && isFinite(cur.temperature_2m)) ? Math.round(cur.temperature_2m) : null;
    const silverNarrative = [city && city.name ? String(city.name) : "—", tempNum != null ? `${tempNum}°C` : "—", feelsLikeNum != null ? `pocitově ${feelsLikeNum}°C` : ""].filter(Boolean).join(", ") + (narrative ? `. ${narrative}` : "");

    const supportedLayers = [];
    const disabledLayers = [];

    const hourlyHas = (key) => hourly && Array.isArray(hourly[key]) && hourly[key].some((x) => typeof x === "number" && isFinite(x));

    if (hourlyHas("precipitation_probability")) supportedLayers.push("precip"); else disabledLayers.push("precip");
    if (hourlyHas("wind_speed_10m") || hourlyHas("wind_gusts_10m")) supportedLayers.push("wind"); else disabledLayers.push("wind");
    if (hourlyHas("pressure_msl")) supportedLayers.push("pressure"); else disabledLayers.push("pressure");
    if (hourlyHas("temperature_2m")) supportedLayers.push("temp"); else disabledLayers.push("temp");

    let activeLayer = iuWxSanitizeMapLayerKey(keepActiveLayer);
    if (!activeLayer || disabledLayers.indexOf(activeLayer) !== -1) {
      if (supportedLayers.indexOf("precip") !== -1) activeLayer = "precip";
      else if (supportedLayers.indexOf("temp") !== -1) activeLayer = "temp";
      else activeLayer = supportedLayers[0] || "temp";
    }

    // forecast (7 days) — keep as minimal objects
    const forecast = [];
    const fTimes = daily && Array.isArray(daily.time) ? daily.time : [];
    const fCodes = daily && Array.isArray(daily.weather_code) ? daily.weather_code : [];
    const fMax = daily && Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [];
    const fMin = daily && Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min : [];
    for (let i = 0; i < 7; i++){
      const t = fTimes[i];
      if (!t) continue;
      forecast.push({ time: new Date(String(t)), weatherCode: fCodes[i], todayMax: fMax[i], todayMin: fMin[i] });
    }

    return {
      location: {
        mode: locationMode,
        cityLabel: city && city.name ? String(city.name) : "—",
      },
      mode: locationMode,
      city: city || { name: "Praha", lat: 50.0755, lon: 14.4378 },
      lat: Number(city && city.lat),
      lon: Number(city && city.lon),
      current: {
        temperatureC: typeof cur.temperature_2m === "number" ? cur.temperature_2m : (nextHours[0] ? nextHours[0].temperatureC : null),
        feelsLikeC: feelsLikeC,
        weatherCode: weatherCode,
        windKph: windKph,
        windGustKph: windGustKph,
        windDirDeg: windDirDeg,
        pressureHpa: pressureHpa,
        humidityPct: humidityPct,
        visibilityKm: visibilityKm,
        uvIndex: uvIndex,
        precipTodayMm: precipTodayMm,
        icon: icon,
        isDay: currentIsDay,
      },
      daily: {
        todayMax: todayMax,
        todayMin: todayMin,
      },
      rawDaily: daily,
      forecast: forecast,
      hourly: hourly,
      nextHours: nextHours,
      alerts: [],
      map: {
        activeLayer: activeLayer,
        supportedLayers: supportedLayers,
        disabledLayers: disabledLayers,
        currentViewKey: null,
        currentSourceKey: null,
      },
      summary: {
        narrative: narrative,
      },
      narrative: narrative,
      silverNarrative: silverNarrative,
    };
  }

  function iuWxRenderMap(svgHost, state, forcedLayer){
    if (IU_DISABLE_WEATHER_MAIN_MAP) return;
    if (!svgHost) return;
    const st = state;
    const next0 = (st && Array.isArray(st.nextHours)) ? st.nextHours[0] : null;
    const layer = iuWxSanitizeMapLayerKey(forcedLayer || (st && st.map ? st.map.activeLayer : "temp"));

    const layerColor = (l) => {
      if (l === "precip") return "#38BDF8";
      if (l === "wind") return "#FB923C";
      if (l === "pressure") return "#22C55E";
      if (l === "temp") return "#F43F5E";
      return "#38BDF8";
    };

    let intensity = 0;
    if (layer === "precip") {
      intensity = iuWxClamp01((next0 && typeof next0.precipProbability === "number" ? next0.precipProbability : 0) / 100);
    } else if (layer === "wind") {
      const g = next0 && typeof next0.windGustKph === "number" ? next0.windGustKph : (next0 ? next0.windKph : null);
      intensity = iuWxClamp01((typeof g === "number" && isFinite(g)) ? g / 80 : 0);
    } else if (layer === "pressure") {
      const p = next0 && typeof next0.pressureHpa === "number" ? next0.pressureHpa : (st.current ? st.current.pressureHpa : null);
      intensity = iuWxClamp01((typeof p === "number" && isFinite(p)) ? (p - 990) / 50 : 0);
    } else if (layer === "temp") {
      const t = next0 && typeof next0.temperatureC === "number" ? next0.temperatureC : (st.current ? st.current.temperatureC : null);
      intensity = iuWxClamp01((typeof t === "number" && isFinite(t)) ? (t + 10) / 45 : 0);
    }

    const alpha = 0.08 + intensity * 0.55;
    const base = "rgba(255,255,255,0.06)";
    const color = layerColor(layer);

    const cityName = st && st.city && st.city.name ? String(st.city.name) : "—";

    function iuWxDetRand(seed, i){
      // Deterministic pseudo-random for stable visuals (no flicker / no layout change).
      const x = Math.sin(seed * 0.000001 + i * 12.345) * 10000;
      return x - Math.floor(x);
    }

    const seedBase = (Number(st.lat) || 0) * 1000 + (Number(st.lon) || 0) * 100;
    const overlayParts = [];

    if (layer === "precip") {
      const n = 10;
      for (let i = 0; i < n; i++){
        const rx = iuWxDetRand(seedBase, i + 1);
        const ry = iuWxDetRand(seedBase, i + 11);
        const x = 10 + rx * 80;
        const y = 10 + ry * 80;
        const dropH = 4 + intensity * 10;
        const op = 0.06 + intensity * 0.26 + iuWxDetRand(seedBase, i + 31) * 0.12;
        overlayParts.push(
          `<path d="M ${x.toFixed(1)} ${y.toFixed(1)} C ${(x - 1.2).toFixed(1)} ${(y + 1.2).toFixed(1)} ${(x + 1.2).toFixed(1)} ${(y + 1.2).toFixed(1)} ${x.toFixed(1)} ${(y + dropH).toFixed(1)} Z" fill="${color}" opacity="${op.toFixed(3)}" />`
        );
      }
    } else if (layer === "wind") {
      const dir = typeof next0?.windDirDeg === "number" ? next0.windDirDeg : (st.current ? st.current.windDirDeg : null);
      const deg = Number(dir);
      const ang = isFinite(deg) ? (deg - 90) * (Math.PI / 180) : 0;
      const cx = 50;
      const cy = 50;
      const ax = cx + Math.cos(ang) * (12 + intensity * 18);
      const ay = cy + Math.sin(ang) * (12 + intensity * 18);
      const lines = 7;
      for (let i = 0; i < lines; i++){
        const k = (i + 1) / lines;
        const ox = cx + Math.cos(ang) * (5 + k * 20);
        const oy = cy + Math.sin(ang) * (5 + k * 20);
        const len = 2 + k * (6 + intensity * 8);
        const head = 1.4 + intensity * 1.1;
        const perp = ang + Math.PI / 2;
        const lx1 = ox - Math.cos(perp) * head;
        const ly1 = oy - Math.sin(perp) * head;
        const lx2 = ox + Math.cos(perp) * head;
        const ly2 = oy + Math.sin(perp) * head;
        overlayParts.push(
          `<path d="M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${ox.toFixed(1)} ${oy.toFixed(1)}" stroke="${color}" stroke-width="${(0.6 + intensity * 1.1).toFixed(2)}" opacity="${(0.08 + intensity * 0.28).toFixed(3)}" />` +
          `<path d="M ${lx1.toFixed(1)} ${ly1.toFixed(1)} L ${ox.toFixed(1)} ${oy.toFixed(1)} L ${lx2.toFixed(1)} ${ly2.toFixed(1)} Z" fill="${color}" opacity="${(0.10 + intensity * 0.30).toFixed(3)}" />` +
          `<circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="${(0.8 + intensity * 1.4).toFixed(2)}" fill="${color}" opacity="${(0.07 + intensity * 0.22).toFixed(3)}" />`
        );
      }
    } else if (layer === "pressure") {
      const p = typeof next0?.pressureHpa === "number" ? next0.pressureHpa : (st.current ? st.current.pressureHpa : null);
      const pr = Number(p);
      const centerY = 50 + (isFinite(pr) ? (pr - 1013) / 3 : 0);
      const count = 6;
      for (let i = 0; i < count; i++){
        const off = (i - (count / 2)) * (2 + intensity * 1.6);
        const y = centerY + off;
        overlayParts.push(
          `<path d="M 12 ${y.toFixed(1)} C 30 ${(y - 4 - intensity * 2).toFixed(1)}, 70 ${(y + 4 + intensity * 2).toFixed(1)}, 88 ${y.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${(0.55 + intensity * 0.7).toFixed(2)}" opacity="${(0.05 + intensity * 0.20).toFixed(3)}" />`
        );
      }
    } else if (layer === "temp") {
      const t = typeof next0?.temperatureC === "number" ? next0.temperatureC : (st.current ? st.current.temperatureC : null);
      const tn = Number(t);
      const warm = isFinite(tn) ? (tn + 20) / 50 : intensity;
      const cl = Math.max(0, Math.min(1, warm));
      const coldColor = "#60A5FA";
      const hotColor = "#F97316";
      const mix = (a, b, k) => a + (b - a) * k;
      function hexToRgb(h){
        const s = String(h).replace("#","");
        const n = parseInt(s,16);
        return { r: (n>>16)&255, g: (n>>8)&255, b: n&255 };
      }
      const c1 = hexToRgb(coldColor);
      const c2 = hexToRgb(hotColor);
      const rr = Math.round(mix(c1.r,c2.r,cl));
      const gg = Math.round(mix(c1.g,c2.g,cl));
      const bb = Math.round(mix(c1.b,c2.b,cl));
      const tempColor = `rgb(${rr},${gg},${bb})`;
      const n = 5;
      for (let i = 0; i < n; i++){
        const k = (i + 1) / n;
        const r = 16 + k * (16 + intensity * 12);
        const op = 0.03 + cl * 0.20 + intensity * 0.18;
        overlayParts.push(`<circle cx="50" cy="50" r="${r.toFixed(1)}" fill="${tempColor}" opacity="${op.toFixed(3)}" />`);
      }
    } else {
      const ringCount = 4;
      for (let i = 0; i < ringCount; i++){
        const k = (i + 1) / ringCount;
        const r = 12 + k * (26 + intensity * 18);
        const op = (0.06 + intensity * 0.18) * (1 - (i * 0.18));
        overlayParts.push(`<circle cx="50" cy="50" r="${r.toFixed(1)}" fill="${color}" opacity="${op.toFixed(3)}" />`);
      }
    }

    const label = (function(){
      if (!next0) return "—";
      if (layer === "precip" && typeof next0.precipProbability === "number") return `Srážky: ${Math.round(next0.precipProbability)}%`;
      if (layer === "wind") {
        const g = typeof next0.windGustKph === "number" ? next0.windGustKph : next0.windKph;
        if (typeof g === "number") return `Vítr: ${Math.round(g)} km/h`;
      }
      if (layer === "pressure" && typeof next0.pressureHpa === "number") return `Tlak: ${Math.round(next0.pressureHpa)} hPa`;
      if (layer === "temp" && typeof next0.temperatureC === "number") return `Teplota: ${Math.round(next0.temperatureC)}°C`;
      return "—";
    })();

    const gradId = "iuWxGrad" + String(layer).replace(/[^a-z0-9_-]/gi, "x");
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Mapová vrstva: ${escapeHtml(layer)}">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="rgba(255,255,255,0.10)" />
            <stop offset="1" stop-color="rgba(0,0,0,0.05)" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="100" height="100" fill="url(#${gradId})" />
        ${overlayParts.join("")}
        <rect x="10" y="10" width="80" height="80" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="0.6"/>
        <path d="M10 50 H 90" stroke="rgba(255,255,255,0.08)" stroke-width="0.6" />
        <path d="M50 10 V 90" stroke="rgba(255,255,255,0.08)" stroke-width="0.6" />
        <circle cx="50" cy="50" r="${(4 + intensity * 6).toFixed(1)}" fill="${color}" opacity="${alpha.toFixed(3)}" />
        <text x="50" y="56" text-anchor="middle" fill="rgba(255,255,255,0.92)" font-size="5" font-weight="900">${escapeHtml(cityName)}</text>
        <text x="12" y="18" text-anchor="start" fill="rgba(255,255,255,0.85)" font-size="4.5" font-weight="800">${escapeHtml(label)}</text>
      </svg>
    `;

    svgHost.innerHTML = svg;
  }

  function iuWxSyncLayerButtons(state){
    try{
      const bar = document.getElementById("iuWxLayerSwitchBar");
      if (bar) {
        const btns = Array.from(bar.querySelectorAll("button[data-iu-weather-layer]"));
        for (let i = 0; i < btns.length; i++){
          const b = btns[i];
          const layerId = b.getAttribute("data-iu-weather-layer");
          const disabled = state && state.map && Array.isArray(state.map.disabledLayers) && state.map.disabledLayers.indexOf(layerId) !== -1;
          const active = state && state.map && state.map.activeLayer === layerId;

          if (!b.dataset.iuWxLayerOrigLabel) {
            b.dataset.iuWxLayerOrigLabel = String(b.textContent || "").trim();
          }
          b.disabled = Boolean(disabled);
          if (disabled) {
            b.textContent = "brzy";
            b.classList.remove("is-active");
          } else {
            b.textContent = b.dataset.iuWxLayerOrigLabel;
            if (active) b.classList.add("is-active"); else b.classList.remove("is-active");
          }
        }
      }

      const quickGrid = document.getElementById("iuWeatherView") ? document.getElementById("iuWeatherView").querySelector(".iuWeatherQuickGrid") : null;
      if (quickGrid) {
        const qb = Array.from(quickGrid.querySelectorAll("button[data-iu-quick-layer]"));
        for (let i = 0; i < qb.length; i++){
          const b = qb[i];
          const qLayer = b.getAttribute("data-iu-quick-layer");
          if (!b.dataset.iuWxQuickOrigLabel) b.dataset.iuWxQuickOrigLabel = String(b.textContent || "").trim();
          const disabled = state && state.map && Array.isArray(state.map.disabledLayers) && state.map.disabledLayers.indexOf(qLayer) !== -1;
          const active = state && state.map && state.map.activeLayer === qLayer;
          b.disabled = Boolean(disabled);
          if (disabled) {
            b.textContent = "brzy";
            b.classList.remove("is-active");
          } else {
            b.textContent = b.dataset.iuWxQuickOrigLabel;
            if (active) b.classList.add("is-active"); else b.classList.remove("is-active");
          }
        }
      }
    }catch{}
  }

  function iuWeatherShowMapLoading(){
    iuWeatherSetMapState("loading");
  }

  function iuWeatherShowMapSuccess(){
    iuWeatherSetMapState("success");
  }

  function iuWeatherShowMapFail(){
    iuWeatherSetMapState("fail");
  }

  function iuWeatherLoadLayer(layerId, state){
    return new Promise((resolve, reject) => {
      try{
        if (IU_DISABLE_WEATHER_MAIN_MAP) { reject(new Error("main weather map disabled")); return; }
        const root = document.getElementById("iuWxMapContainer");
        if (!root) throw new Error("missing map container");
        const layer = iuWxSanitizeMapLayerKey(String(layerId || "precip"));
        iuWeatherResetMapView(root);
        iuWxRenderMap(root, state, layer);
        if (!root.querySelector("svg")) throw new Error("layer render failed");
        const viewKey = `wx-view-${layer}-v1`;
        const sourceKey = `iu-wx-${layer}-openmeteo-svg`;
        root.setAttribute("data-view-key", viewKey);
        root.setAttribute("data-source-key", sourceKey);
        root.setAttribute("data-layer-key", layer);
        try{
          const st = window.__iuWeatherState;
          if (st && st.map){
            st.map.activeLayer = layer;
            st.map.currentViewKey = viewKey;
            st.map.currentSourceKey = sourceKey;
          }
        }catch{}
        resolve();
      }catch(e){ reject(e); }
    });
  }

  function iuWeatherRenderMapLayer(layerId, state){
    if (IU_DISABLE_WEATHER_MAIN_MAP) return;
    const st = state || window.__iuWeatherState;
    if (!st || !st.map) return;
    const root = document.getElementById("iuWxMapContainer");
    if (!root) { iuWeatherShowMapFail(); return; }

    const layer = iuWxSanitizeMapLayerKey(String(layerId || st.map.activeLayer || "precip"));
    st.map.activeLayer = layer;
    window.__iuWeatherMapMounted = false;
    iuWeatherResetMapView(root);
    iuWeatherSetMapState("loading");

    const tryRender = (attempt) => {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000));
      Promise.race([iuWeatherLoadLayer(layer, st), timeout])
        .then(() => {
          window.__iuWeatherMapMounted = true;
          iuWeatherShowMapSuccess();
          iuWxSyncLayerButtons(st);
          iuWeatherApplySharedStateMeta(st);
        })
        .catch(() => {
          if (attempt < 2) {
            setTimeout(() => tryRender(attempt + 1), 250 * (attempt + 1));
            return;
          }
          window.__iuWeatherMapMounted = false;
          iuWeatherShowMapFail();
        });
    };
    tryRender(0);
  }

  function iuWxSetActiveLayer(layerId){
    try{
      const st = window.__iuWeatherState;
      if (!st || !st.map) return;
      const id = iuWxSanitizeMapLayerKey(layerId);
      if (st.map.disabledLayers && st.map.disabledLayers.indexOf(id) !== -1) return;
      st.map.activeLayer = id;
      iuWxPersistMapLayer(id);
      if (IU_DISABLE_WEATHER_MAIN_MAP) {
        iuWxSyncLayerButtons(st);
        iuWeatherApplySharedStateMeta(st);
        return;
      }
      iuWeatherRenderMapLayer(id, st);
    }catch{}
  }

  function iuWxRenderMapWithRetry(state){
    if (IU_DISABLE_WEATHER_MAIN_MAP) return;
    try{ iuWeatherRenderMapLayer(state && state.map ? state.map.activeLayer : "precip", state); }catch{ iuWeatherShowMapFail(); }
  }

  function iuWxApplyMobileLayoutFix(){
    try{
      const isMobile = typeof window !== "undefined" && typeof window.innerWidth === "number" && window.innerWidth <= 768;
      const mapHost = document.getElementById("iuWxMapHost");
      const map = document.getElementById("iuWxMap");
      const mapSvg = document.getElementById("iuWxMapContainer");
      const layerBar = document.getElementById("iuWxLayerSwitchBar");
      const quickGrid = document.getElementById("iuWeatherView") ? document.getElementById("iuWeatherView").querySelector(".iuWeatherQuickGrid") : null;

      if (!isMobile) {
        if (mapHost) { mapHost.style.minHeight = ""; mapHost.style.overflow = ""; }
        if (map) map.style.minHeight = "";
        if (mapSvg) mapSvg.style.height = "";
        if (layerBar) {
          layerBar.style.position = "";
          layerBar.style.left = "";
          layerBar.style.right = "";
          layerBar.style.top = "";
          layerBar.style.margin = "";
          layerBar.style.justifyContent = "";
        }
        if (quickGrid) {
          quickGrid.style.gridTemplateColumns = "";
          quickGrid.style.gap = "";
        }
        return;
      }

      if (mapHost) { mapHost.style.minHeight = "220px"; mapHost.style.overflow = "visible"; }
      if (map) map.style.minHeight = "220px";
      if (mapSvg) mapSvg.style.height = "220px";
      if (layerBar) {
        layerBar.style.position = "static";
        layerBar.style.left = "auto";
        layerBar.style.right = "auto";
        layerBar.style.top = "auto";
        layerBar.style.margin = "8px 8px 10px";
        layerBar.style.justifyContent = "flex-start";
      }
      if (quickGrid) {
        quickGrid.style.gridTemplateColumns = "1fr";
        quickGrid.style.gap = "12px";
      }
    }catch{}
  }

  async function iuWeatherEnsureState(){
    const city = iuWeatherGetActiveCity();
    if (!city || typeof city.lat !== "number" || typeof city.lon !== "number") throw new Error("bad city");
    const locationMode = iuWeatherReadLocationMode();
    const key = `${city.lat},${city.lon},${locationMode}`;

    const activeKeyNow = function(){
      try{
        const c = iuWeatherGetActiveCity();
        const m = iuWeatherReadLocationMode();
        if (!c || typeof c.lat !== "number" || typeof c.lon !== "number") return "";
        return `${c.lat},${c.lon},${m}`;
      }catch{
        return "";
      }
    };

    const ensurePromisesByKey = window.__iuWeatherEnsurePromisesByKey || (window.__iuWeatherEnsurePromisesByKey = {});
    try{
      const st0 = window.__iuWeatherState;
      if (st0 && typeof st0.lat === "number" && typeof st0.lon === "number" && st0.mode === locationMode && st0.hourly && st0.rawDaily) {
        if (Math.abs(st0.lat - city.lat) < 0.00001 && Math.abs(st0.lon - city.lon) < 0.00001) return st0;
      }
    }catch{}

    const existingPromise = ensurePromisesByKey[key];
    if (existingPromise) return existingPromise;

    try{
      if (window.__iuWeatherEnsureLockPromise && window.__iuWeatherEnsureLockPromise.then) {
        // lock exists - proceed below
      }
    }catch{}

    const runJob = async () => {
      // Re-check cache right before fetch (after any lock wait).
      try{
        const st1 = window.__iuWeatherState;
        if (st1 && typeof st1.lat === "number" && typeof st1.lon === "number" && st1.mode === locationMode && st1.hourly && st1.rawDaily) {
          if (Math.abs(st1.lat - city.lat) < 0.00001 && Math.abs(st1.lon - city.lon) < 0.00001) return st1;
        }
      }catch{}

      const d = await iuFetchOpenMeteo(city.lat, city.lon);
      const keepActiveLayer = (function(){
        try{
          if (window.__iuWeatherState && window.__iuWeatherState.map && typeof window.__iuWeatherState.map.activeLayer === "string"){
            return iuWxSanitizeMapLayerKey(window.__iuWeatherState.map.activeLayer);
          }
        }catch{}
        return iuWxSanitizeMapLayerKey(iuWxReadPersistedMapLayer());
      })();
      const state = iuWxBuildWeatherState(city, d, locationMode, keepActiveLayer);
      if (!state.map || typeof state.map !== "object") state.map = { activeLayer: "precip", supportedLayers: [], disabledLayers: [] };
      if (!state.map.activeLayer) state.map.activeLayer = "precip";

      // Avoid outdated requests overwriting the latest global state.
      try{
        const nowKey = activeKeyNow();
        if (nowKey === key) {
          window.__iuWeatherState = state;
          iuWxPersistMapLayer(state.map.activeLayer);
          iuWeatherApplySharedStateMeta(state);
        }
      }catch{
        // If key computation fails, be conservative and do not overwrite.
      }

      return state;
    };

    const prevLock = window.__iuWeatherEnsureLockPromise || Promise.resolve();
    const job = prevLock.then(runJob, runJob);
    window.__iuWeatherEnsureLockPromise = job.catch(() => {});
    ensurePromisesByKey[key] = job;
    try{
      job.finally(() => {
        try{
          if (ensurePromisesByKey[key] === job) delete ensurePromisesByKey[key];
        }catch{}
      });
    }catch{}

    return job;
  }
  try{
    window.iuWeatherEnsureState = iuWeatherEnsureState;
    window.iuWeatherRenderMapLayer = iuWeatherRenderMapLayer;
  }catch{}

  const IU_PICKER_VB_W = 800;
  const IU_PICKER_VB_H = 450;
  const IU_PICKER_BOUNDS_FALLBACK = { minLon: 12.0, maxLon: 19.0, minLat: 48.55, maxLat: 51.1 };

  /** GeoNames English admin1 labels → Czech (safe fixed map; no heuristics). */
  const IU_PICKER_EN_REGION_TO_CZ = {
    Prague: "Praha",
    "South Moravian": "Jihomoravský kraj",
    "Plzeň Region": "Plzeňský kraj",
    "Central Bohemia": "Středočeský kraj",
  };

  function iuPickerAliasesFromSourceRow(r){
    try{
      if (r && typeof r === "object" && !Array.isArray(r) && Array.isArray(r.a)){
        return r.a.map((x) => String(x || "").trim()).filter(Boolean);
      }
      if (Array.isArray(r) && Array.isArray(r[6])){
        return r[6].map((x) => String(x || "").trim()).filter(Boolean);
      }
    }catch{}
    return [];
  }

  function iuPickerCzLocalityNameFromParts(name){
    const n = String(name || "").trim();
    if (n === "Prague") return "Praha";
    if (n === "Pilsen") return "Plzeň";
    return n;
  }

  function iuPickerCzRegionNameFromParts(region){
    const r0 = String(region || "").trim();
    if (!r0) return "";
    const cz = IU_PICKER_EN_REGION_TO_CZ[r0];
    return cz || r0;
  }

  function iuPickerItemSearchHaystack(it){
    try{
      const parts = [iuWeatherNorm(it.name), iuWeatherNorm(it.region || "")];
      const czNm = iuPickerCzLocalityNameFromParts(it.name);
      if (czNm !== it.name) parts.push(iuWeatherNorm(czNm));
      const regRaw = String(it.region || "").trim();
      const czReg = iuPickerCzRegionNameFromParts(regRaw);
      if (czReg && czReg !== regRaw) parts.push(iuWeatherNorm(czReg));
      if (it.aliases && Array.isArray(it.aliases)){
        for (let i = 0; i < it.aliases.length; i++){
          const ax = it.aliases[i];
          if (ax) parts.push(iuWeatherNorm(ax));
        }
      }
      return parts.join(" ");
    }catch{
      return iuWeatherNorm(it && it.name);
    }
  }

  function iuPickerApplyLabelSuffixCollisionGuard(items){
    try{
      if (!items || !items.length) return items;
      const groups = new Map();
      for (let i = 0; i < items.length; i++){
        const it = items[i];
        if (!it) continue;
        const nm = iuPickerCzLocalityNameFromParts(it.name);
        const regRaw = String(it.region || "").trim();
        const reg = regRaw ? iuPickerCzRegionNameFromParts(regRaw) : "";
        const key = iuWeatherNorm(nm) + "|" + iuWeatherNorm(reg);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
      }
      groups.forEach((arr) => {
        if (!arr || arr.length <= 1) return;
        for (let j = 0; j < arr.length; j++){
          const it = arr[j];
          const la = Number(it.lat);
          const lo = Number(it.lon);
          if (iuWeatherIsValidGeoCoords(la, lo)){
            it.labelSuffix = la.toFixed(2) + "°, " + lo.toFixed(2) + "°";
          }
        }
      });
    }catch{}
    return items;
  }

  function iuPickerLabelFromItem(it){
    try{
      const nm = iuPickerCzLocalityNameFromParts(it.name);
      const regRaw = String(it.region || "").trim();
      const reg = regRaw ? iuPickerCzRegionNameFromParts(regRaw) : "";
      let out = reg ? `${nm} (${reg})` : nm;
      if (it && it.labelSuffix && String(it.labelSuffix).trim()){
        out = `${out} · ${String(it.labelSuffix).trim()}`;
      }
      return out;
    }catch{
      return String(it && it.name || "");
    }
  }

  function iuPickerParseRow(r){
    try{
      if (!r) return null;
      const aliases = iuPickerAliasesFromSourceRow(r);
      if (typeof r === "object" && !Array.isArray(r)) {
        const name = String(r.n || r.name || "").trim();
        const region = String(r.r || r.region || "").trim();
        const lat = Number(r.lat);
        const lon = Number(r.lon);
        if (!name || !iuWeatherIsValidGeoCoords(lat, lon)) return null;
        return {
          name,
          region,
          lat,
          lon,
          priority: Number.isFinite(Number(r.p)) ? Number(r.p) : 50,
          type: String(r.t || r.type || "obec"),
          aliases,
        };
      }
      if (Array.isArray(r)) {
        const a = r;
        const name = String(a[0] || "").trim();
        const region = String(a[1] || "").trim();
        const lat = Number(a[2]);
        const lon = Number(a[3]);
        if (!name || !iuWeatherIsValidGeoCoords(lat, lon)) return null;
        return {
          name,
          region,
          lat,
          lon,
          priority: Number.isFinite(Number(a[4])) ? Number(a[4]) : 80,
          type: String(a[5] || "obec"),
          aliases,
        };
      }
    }catch{}
    return null;
  }

  async function iuLoadMapDisplayCities(){
    try{
      if (window.__iuMapDisplayCitiesCache) return window.__iuMapDisplayCitiesCache;
    }catch{}
    try{
      const r = await fetch(iuDataUrl("cz_map_display_cities.json"), { cache: "force-cache" });
      if (r.ok){
        const d = await r.json();
        const raw = Array.isArray(d.items) ? d.items : [];
        const out = [];
        for (let i = 0; i < raw.length; i++){
          const row = raw[i];
          const it = iuPickerParseRow({
            n: row.n,
            r: "",
            lat: row.lat,
            lon: row.lon,
            p: row.p != null ? row.p : 80,
            t: "city",
          });
          if (it) out.push(it);
        }
        try{ window.__iuMapDisplayCitiesCache = out; }catch{}
        return out;
      }
    }catch{}
    return [];
  }

  async function iuLoadPickerLocalities(){
    try{
      if (window.__iuPickerLocalitiesCache) return window.__iuPickerLocalitiesCache;
    }catch{}
    try{
      const r = await fetch(iuDataUrl("cz_localities_picker.json"), { cache: "force-cache" });
      if (r.ok) {
        const d = await r.json();
        const raw = Array.isArray(d.items) ? d.items : [];
        const items = iuPickerApplyLabelSuffixCollisionGuard(raw.map(iuPickerParseRow).filter(Boolean));
        if (items.length) {
          try{ window.__iuPickerLocalitiesCache = items; }catch{}
          return items;
        }
      }
    }catch{}
    const fb = iuPickerApplyLabelSuffixCollisionGuard(
      IU_CITY_FALLBACK.map((row) => iuPickerParseRow([row[0], row[1], row[2], row[3], 85, "city"])).filter(Boolean),
    );
    try{ window.__iuPickerLocalitiesCache = fb; }catch{}
    return fb;
  }

  function iuPickerBoundsFromGeometry(geom){
    try{
      let minLon = Infinity;
      let maxLon = -Infinity;
      let minLat = Infinity;
      let maxLat = -Infinity;
      function ringWalk(ring){
        for (let i = 0; i < ring.length; i++){
          const pair = ring[i];
          const lon = Number(pair[0]);
          const lat = Number(pair[1]);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          minLon = Math.min(minLon, lon);
          maxLon = Math.max(maxLon, lon);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
        }
      }
      function walk(g){
        if (!g) return;
        if (g.type === "Polygon") {
          const rings = g.coordinates;
          if (rings && rings[0]) ringWalk(rings[0]);
        } else if (g.type === "MultiPolygon") {
          const polys = g.coordinates;
          for (let p = 0; p < polys.length; p++){
            const poly = polys[p];
            if (poly && poly[0]) ringWalk(poly[0]);
          }
        }
      }
      walk(geom);
      if (!Number.isFinite(minLon) || !Number.isFinite(maxLon)) return null;
      const padLon = (maxLon - minLon) * 0.02;
      const padLat = (maxLat - minLat) * 0.02;
      return {
        minLon: minLon - padLon,
        maxLon: maxLon + padLon,
        minLat: minLat - padLat,
        maxLat: maxLat + padLat,
      };
    }catch{}
    return null;
  }

  function iuPickerProject(lat, lon, b, w, h){
    const x = ((lon - b.minLon) / (b.maxLon - b.minLon)) * w;
    const y = ((b.maxLat - lat) / (b.maxLat - b.minLat)) * h;
    return { x, y };
  }

  function iuPickerUnproject(svgX, svgY, b, w, h){
    const lon = b.minLon + (svgX / w) * (b.maxLon - b.minLon);
    const lat = b.maxLat - (svgY / h) * (b.maxLat - b.minLat);
    return { lat, lon };
  }

  function iuPickerHaversineKm(lat1, lon1, lat2, lon2){
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function iuPickerNearest(lat, lon, items){
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < items.length; i++){
      const it = items[i];
      const d = iuPickerHaversineKm(lat, lon, it.lat, it.lon);
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  /** GPS label: nearest locality from picker dataset / city list — no browser reverse-geocode APIs. */
  async function iuWeatherGpsNearestLocalityLabel(lat, lon){
    const la = Number(lat);
    const lo = Number(lon);
    if (!isFinite(la) || !isFinite(lo)) return "Neznámá lokalita";
    try{
      const items = await iuLoadPickerLocalities();
      if (items && items.length){
        const near = iuPickerNearest(la, lo, items);
        if (near && near.name){
          try{
            return iuPickerLabelFromItem(near);
          }catch{
            return String(near.name || "").trim();
          }
        }
      }
    }catch{}
    try{
      const cities = await iuLoadCitiesSafe();
      let best = null;
      let bestD = Infinity;
      for (let i = 0; i < cities.length; i++){
        const c = cities[i];
        if (!c || c.length < 4) continue;
        const cLat = Number(c[2]);
        const cLon = Number(c[3]);
        if (!isFinite(cLat) || !isFinite(cLon)) continue;
        const dLat = cLat - la;
        const dLon = cLon - lo;
        const d = dLat * dLat + dLon * dLon;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best && best[0]) return iuCityLabel(best);
    }catch{}
    return `${la.toFixed(3)}°, ${lo.toFixed(3)}°`;
  }

  function iuPickerSearchDedupeKey(it){
    try{
      const la = Math.round(Number(it.lat) * 1e4) / 1e4;
      const lo = Math.round(Number(it.lon) * 1e4) / 1e4;
      return `${iuWeatherNorm(it.name)}|${iuWeatherNorm(it.region || "")}|${la}|${lo}`;
    }catch{
      return String(it && it.name);
    }
  }

  function iuPickerSearchItems(query, items, limit){
    const q = iuWeatherNorm(query);
    if (!q) return [];
    const lim = typeof limit === "number" && limit > 0 ? limit : 12;
    const qTokens = q.split(/\s+/).filter((x) => String(x || "").trim().length > 0);
    const scored = [];
    for (let i = 0; i < items.length; i++){
      const it = items[i];
      const hay = iuPickerItemSearchHaystack(it);
      let matched = false;
      if (hay.includes(q)) matched = true;
      else if (qTokens.length >= 2) matched = qTokens.every((t) => hay.includes(t));
      if (!matched) continue;
      const nn = iuWeatherNorm(it.name);
      const czNm = iuWeatherNorm(iuPickerCzLocalityNameFromParts(it.name));
      let score = 0;
      if (nn === q || czNm === q) score += 100;
      else if (qTokens.length >= 2 && qTokens.every((t) => nn.includes(t) || czNm.includes(t))) score += 55;
      else if (czNm.startsWith(q) || nn.startsWith(q)) score += 24;
      else if (czNm.includes(q) || nn.includes(q)) score += 16;
      else if (hay.includes(q)) score += 6;
      else score += 3;
      const rr = iuWeatherNorm(it.region || "");
      if (rr.includes(q)) score += 4;
      score += (Number(it.priority) || 0) / 60;
      scored.push({ it, score });
    }
    scored.sort((a, b) => b.score - a.score || (b.it.priority || 0) - (a.it.priority || 0));
    const out = [];
    const seen = new Set();
    for (let j = 0; j < scored.length && out.length < lim; j++){
      const k = iuPickerSearchDedupeKey(scored[j].it);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(scored[j].it);
    }
    return out;
  }

  function iuPickerRingToPath(ring, b, w, h){
    let d = "";
    for (let i = 0; i < ring.length; i++){
      const lon = Number(ring[i][0]);
      const lat = Number(ring[i][1]);
      const pt = iuPickerProject(lat, lon, b, w, h);
      d += (i === 0 ? "M " : " L ") + pt.x.toFixed(2) + " " + pt.y.toFixed(2);
    }
    d += " Z";
    return d;
  }

  function iuPickerOutlinePaths(geom, b, w, h){
    const paths = [];
    try{
      if (geom.type === "Polygon") {
        const rings = geom.coordinates;
        if (rings && rings[0]) paths.push(iuPickerRingToPath(rings[0], b, w, h));
      } else if (geom.type === "MultiPolygon") {
        const polys = geom.coordinates;
        for (let p = 0; p < polys.length; p++){
          const poly = polys[p];
          if (poly && poly[0]) paths.push(iuPickerRingToPath(poly[0], b, w, h));
        }
      }
    }catch{}
    return paths;
  }

  function iuPickerPickLabelsForRender(items, b, w, h){
    const cols = 14;
    const rows = 9;
    const buckets = new Map();
    for (let i = 0; i < items.length; i++){
      const it = items[i];
      const pt = iuPickerProject(it.lat, it.lon, b, w, h);
      if (pt.x < -40 || pt.x > w + 40 || pt.y < -40 || pt.y > h + 40) continue;
      const cx = Math.min(cols - 1, Math.max(0, Math.floor((pt.x / w) * cols)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor((pt.y / h) * rows)));
      const key = cx + "," + cy;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ it, x: pt.x, y: pt.y });
    }
    const out = [];
    buckets.forEach((arr) => {
      arr.sort((a, b2) => (b2.it.priority || 0) - (a.it.priority || 0));
      if (arr[0]) out.push(arr[0]);
      if (arr[1] && (arr[1].it.priority || 0) >= 35) out.push(arr[1]);
    });
    return out;
  }

  function iuWeatherEnsureMapPickerOverlay(){
    let overlay = document.getElementById("iuWeatherMapPickerOverlay");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "iuWeatherMapPickerOverlay";
    overlay.hidden = true;
    overlay.className = "iuWeatherMapPickerOverlay";
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Zvolit místo na mapě");
    overlay.innerHTML = `
      <div class="iuWeatherMapPickerPanel">
        <div class="iuWeatherMapPickerHead">
          <div class="iuWeatherMapPickerTitle">Zvolte místo na mapě</div>
          <button type="button" class="iuWeatherMapPickerClose" aria-label="Zavřít">✕</button>
        </div>
        <div class="iuWeatherMapPickerSearchRow">
          <label class="iuWeatherMapPickerSearchLabel" for="iuWeatherMapPickerSearch">Hledat obec / město</label>
          <input type="search" id="iuWeatherMapPickerSearch" class="iuWeatherMapPickerSearch" autocomplete="off" placeholder="Začněte psát název…" />
          <div id="iuWeatherMapPickerSuggest" class="iuWeatherMapPickerSuggest" hidden role="listbox"></div>
        </div>
        <div id="iuWeatherMapPickerMap" class="iuWeatherMapPickerMap" role="presentation">
          <div class="iuWeatherMapPickerMapInner"></div>
        </div>
        <div id="iuWeatherMapPickerSelected" class="iuWeatherMapPickerSelected" aria-live="polite"></div>
        <div class="iuWeatherMapPickerAttr" aria-hidden="true">Obrys: Natural Earth (public domain). Kraje: Eurostat GISCO (EUPL-1.2). Lokality (vyhledávání): GeoNames (CC BY 4.0). Mapa měst: veřejná administrativní sídla + GeoNames.</div>
        <div class="iuWeatherMapPickerBar">
          <button type="button" class="iuBtn iuBtn--ghost" id="iuWeatherMapPickerConfirm" disabled>Uložit výběr</button>
          <button type="button" class="iuBtn iuBtn--ghost" id="iuWeatherMapPickerCancel">Zrušit</button>
        </div>
      </div>
    `.trim();
    document.body.appendChild(overlay);

    const mapWrap = document.getElementById("iuWeatherMapPickerMap");
    const mapInner = mapWrap && mapWrap.querySelector(".iuWeatherMapPickerMapInner");
    const closeBtn = overlay.querySelector(".iuWeatherMapPickerClose");
    const btnOk = document.getElementById("iuWeatherMapPickerConfirm");
    const btnCancel = document.getElementById("iuWeatherMapPickerCancel");
    const inpSearch = document.getElementById("iuWeatherMapPickerSearch");
    const suggestEl = document.getElementById("iuWeatherMapPickerSuggest");
    const selectedEl = document.getElementById("iuWeatherMapPickerSelected");

    let pending = null;
    let prevBodyOverflow = "";
    let prevBodyPaddingRight = "";
    let pickerResizeObserver = null;
    let searchTimer = null;
    let localities = [];
    let bounds = IU_PICKER_BOUNDS_FALLBACK;
    let svgNs = "http://www.w3.org/2000/svg";
    let svgEl = null;
    let markerEl = null;

    function teardownMap(){
      try{
        if (pickerResizeObserver) {
          try{ pickerResizeObserver.disconnect(); }catch{}
          pickerResizeObserver = null;
        }
      }catch{}
      pending = null;
      svgEl = null;
      markerEl = null;
      try{ if (mapInner) mapInner.replaceChildren(); }catch{}
      try{ overlay.__iuWeatherPickerLastPick = null; }catch{}
    }

    function setPendingFromIt(it){
      if (!it || !iuWeatherIsValidGeoCoords(it.lat, it.lon)) return;
      const label = iuPickerLabelFromItem(it);
      pending = { lat: it.lat, lon: it.lon, label };
      try{ overlay.__iuWeatherPickerLastPick = { lat: it.lat, lon: it.lon, label }; }catch{}
      if (btnOk) btnOk.disabled = false;
      if (selectedEl) {
        selectedEl.textContent = `Vybráno: ${label} · ${it.type || "lokalita"}`;
      }
      try{
        if (svgEl && markerEl) {
          const pt = iuPickerProject(it.lat, it.lon, bounds, IU_PICKER_VB_W, IU_PICKER_VB_H);
          markerEl.setAttribute("cx", String(pt.x));
          markerEl.setAttribute("cy", String(pt.y));
          markerEl.setAttribute("r", "7");
        }
      }catch{}
    }

    function hideSuggest(){
      try{
        if (suggestEl) {
          suggestEl.hidden = true;
          suggestEl.replaceChildren();
        }
      }catch{}
    }

    function renderSuggest(items){
      if (!suggestEl) return;
      suggestEl.replaceChildren();
      if (!items || !items.length) {
        suggestEl.hidden = true;
        return;
      }
      suggestEl.hidden = false;
      for (let i = 0; i < items.length; i++){
        const it = items[i];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "iuWeatherMapPickerSuggestItem";
        btn.setAttribute("role", "option");
        btn.textContent = iuPickerLabelFromItem(it);
        btn.addEventListener("click", () => {
          try{ if (inpSearch) inpSearch.value = it.name; }catch{}
          hideSuggest();
          setPendingFromIt(it);
        });
        suggestEl.appendChild(btn);
      }
    }

    function onSearchInput(){
      try{
        if (searchTimer) clearTimeout(searchTimer);
      }catch{}
      searchTimer = setTimeout(() => {
        try{
          const q = inpSearch ? String(inpSearch.value || "").trim() : "";
          if (q.length < 2) {
            hideSuggest();
            return;
          }
          const hits = iuPickerSearchItems(q, localities, 28);
          renderSuggest(hits);
        }catch{}
      }, 120);
    }

    function svgPointFromEvent(ev){
      try{
        if (!svgEl) return null;
        const rect = svgEl.getBoundingClientRect();
        const wPx = rect.width || 1;
        const hPx = rect.height || 1;
        const cx = Number(ev.clientX) - rect.left;
        const cy = Number(ev.clientY) - rect.top;
        const x = (cx / wPx) * IU_PICKER_VB_W;
        const y = (cy / hPx) * IU_PICKER_VB_H;
        return { x, y };
      }catch{}
      return null;
    }

    function close(){
      try{ overlay.hidden = true; }catch{}
      try{ document.body.style.overflow = prevBodyOverflow || ""; }catch{}
      try{
        document.body.style.paddingRight = prevBodyPaddingRight || "";
      }catch{}
      teardownMap();
      if (btnOk) btnOk.disabled = true;
      try{ if (inpSearch) inpSearch.value = ""; }catch{}
      hideSuggest();
      if (selectedEl) selectedEl.textContent = "";
    }

    async function open(){
      prevBodyOverflow = document.body.style.overflow || "";
      try{
        prevBodyPaddingRight = document.body.style.paddingRight || "";
      }catch{
        prevBodyPaddingRight = "";
      }
      document.body.style.overflow = "hidden";
      try{
        const gap = window.innerWidth - document.documentElement.clientWidth;
        if (gap > 0) document.body.style.paddingRight = gap + "px";
      }catch{}
      try{ overlay.hidden = true; }catch{}
      teardownMap();
      localities = await iuLoadPickerLocalities();
      const mapDisplayCities = await iuLoadMapDisplayCities();
      let outline = null;
      try{
        const rr = await fetch(iuDataUrl("cz_outline_ne50.geojson"), { cache: "force-cache" });
        if (rr.ok) outline = await rr.json();
      }catch{}
      try{
        const g = outline && outline.features && outline.features[0] && outline.features[0].geometry;
        const bb = iuPickerBoundsFromGeometry(g);
        if (bb) bounds = bb;
        else bounds = IU_PICKER_BOUNDS_FALLBACK;
      }catch{
        bounds = IU_PICKER_BOUNDS_FALLBACK;
      }

      const svg = document.createElementNS(svgNs, "svg");
      svg.setAttribute("viewBox", "0 0 " + IU_PICKER_VB_W + " " + IU_PICKER_VB_H);
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.classList.add("iuWeatherMapPickerSvg");
      svgEl = svg;

      const defs = document.createElementNS(svgNs, "defs");
      const grad = document.createElementNS(svgNs, "linearGradient");
      grad.setAttribute("id", "iuWeatherMapPickerSeaGrad");
      grad.setAttribute("x1", "0");
      grad.setAttribute("y1", "0");
      grad.setAttribute("x2", "0");
      grad.setAttribute("y2", "1");
      const s1 = document.createElementNS(svgNs, "stop");
      s1.setAttribute("offset", "0%");
      s1.setAttribute("stop-color", "#0b1220");
      const s2 = document.createElementNS(svgNs, "stop");
      s2.setAttribute("offset", "100%");
      s2.setAttribute("stop-color", "#15263d");
      grad.appendChild(s1);
      grad.appendChild(s2);
      defs.appendChild(grad);
      svg.appendChild(defs);

      const sea = document.createElementNS(svgNs, "rect");
      sea.setAttribute("x", "0");
      sea.setAttribute("y", "0");
      sea.setAttribute("width", String(IU_PICKER_VB_W));
      sea.setAttribute("height", String(IU_PICKER_VB_H));
      sea.setAttribute("fill", "url(#iuWeatherMapPickerSeaGrad)");
      sea.classList.add("iuWeatherMapPickerSea");
      svg.appendChild(sea);

      try{
        const g0 = outline && outline.features && outline.features[0] && outline.features[0].geometry;
        if (g0) {
          const paths = iuPickerOutlinePaths(g0, bounds, IU_PICKER_VB_W, IU_PICKER_VB_H);
          for (let p = 0; p < paths.length; p++){
            const path = document.createElementNS(svgNs, "path");
            path.setAttribute("d", paths[p]);
            path.setAttribute("fill", "rgba(72,140,220,0.38)");
            path.setAttribute("stroke", "rgba(255,255,255,0.28)");
            path.setAttribute("stroke-width", "1.2");
            path.classList.add("iuWeatherMapPickerLand");
            svg.appendChild(path);
          }
        }
      }catch{}

      try{
        let krajeFc = null;
        try{
          const rk = await fetch(iuDataUrl("cz_kraje_nuts3_20m.geojson"), { cache: "force-cache" });
          if (rk.ok) krajeFc = await rk.json();
        }catch{}
        if (krajeFc && krajeFc.features && krajeFc.features.length){
          const krajRoot = document.createElementNS(svgNs, "g");
          krajRoot.classList.add("iuWeatherMapPickerKrajLayer");
          try{ krajRoot.setAttribute("pointer-events", "none"); }catch{}
          for (let fi = 0; fi < krajeFc.features.length; fi++){
            const geom = krajeFc.features[fi] && krajeFc.features[fi].geometry;
            if (!geom) continue;
            const paths = iuPickerOutlinePaths(geom, bounds, IU_PICKER_VB_W, IU_PICKER_VB_H);
            for (let p = 0; p < paths.length; p++){
              const path = document.createElementNS(svgNs, "path");
              path.setAttribute("d", paths[p]);
              path.setAttribute("fill", "none");
              path.setAttribute("stroke", "rgba(255,255,255,0.2)");
              path.setAttribute("stroke-width", "1.1");
              path.classList.add("iuWeatherMapPickerKraj");
              krajRoot.appendChild(path);
            }
          }
          svg.appendChild(krajRoot);
        }
      }catch{}

      const labelLayer = document.createElementNS(svgNs, "g");
      labelLayer.classList.add("iuWeatherMapPickerLabelLayer");
      try{ labelLayer.setAttribute("pointer-events", "none"); }catch{}
      const mapLabelItems = mapDisplayCities && mapDisplayCities.length ? mapDisplayCities : [];
      const labelRows = iuPickerPickLabelsForRender(mapLabelItems, bounds, IU_PICKER_VB_W, IU_PICKER_VB_H);
      for (let i = 0; i < labelRows.length; i++){
        const row = labelRows[i];
        const dot = document.createElementNS(svgNs, "circle");
        dot.setAttribute("cx", String(row.x));
        dot.setAttribute("cy", String(row.y));
        dot.setAttribute("r", "2.6");
        dot.classList.add("iuWeatherMapPickerCityDot");
        labelLayer.appendChild(dot);
        const t = document.createElementNS(svgNs, "text");
        t.setAttribute("x", String(row.x));
        t.setAttribute("y", String(row.y + 11));
        t.setAttribute("text-anchor", "middle");
        t.classList.add("iuWeatherMapPickerLbl");
        const raw = String(iuPickerCzLocalityNameFromParts(row.it.name || ""));
        const shown = raw.length > 18 ? raw.slice(0, 17) + "…" : raw;
        t.textContent = shown;
        labelLayer.appendChild(t);
      }
      svg.appendChild(labelLayer);

      const hit = document.createElementNS(svgNs, "rect");
      hit.setAttribute("x", "0");
      hit.setAttribute("y", "0");
      hit.setAttribute("width", String(IU_PICKER_VB_W));
      hit.setAttribute("height", String(IU_PICKER_VB_H));
      hit.setAttribute("fill", "transparent");
      hit.classList.add("iuWeatherMapPickerHit");
      hit.addEventListener("click", (ev) => {
        try{
          const pt = svgPointFromEvent(ev);
          if (!pt) return;
          const ll = iuPickerUnproject(pt.x, pt.y, bounds, IU_PICKER_VB_W, IU_PICKER_VB_H);
          const near = iuPickerNearest(ll.lat, ll.lon, localities);
          if (near) setPendingFromIt(near);
        }catch{}
      });
      svg.appendChild(hit);

      markerEl = document.createElementNS(svgNs, "circle");
      markerEl.setAttribute("cx", "0");
      markerEl.setAttribute("cy", "0");
      markerEl.setAttribute("r", "0");
      markerEl.classList.add("iuWeatherMapPickerPin");
      svg.appendChild(markerEl);

      try{ if (mapInner) mapInner.appendChild(svg); }catch{}

      const ac = iuWeatherGetActiveCity();
      const seedLat = isFinite(ac.lat) ? ac.lat : 49.75;
      const seedLon = isFinite(ac.lon) ? ac.lon : 15.5;
      const seed = iuPickerNearest(seedLat, seedLon, localities);
      if (seed) setPendingFromIt(seed);

      try{
        if (mapWrap && typeof ResizeObserver !== "undefined") {
          pickerResizeObserver = new ResizeObserver(() => {
            try{
              /* layout-only; SVG scales via viewBox */
            }catch{}
          });
          pickerResizeObserver.observe(mapWrap);
        }
      }catch{}

      if (inpSearch) {
        try{ inpSearch.value = ""; }catch{}
        inpSearch.focus();
      }
      try{ overlay.hidden = false; }catch{}
    }

    if (closeBtn) closeBtn.addEventListener("click", close);
    if (btnCancel) btnCancel.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      try{ if (e.target === overlay) close(); }catch{}
    });
    if (inpSearch) inpSearch.addEventListener("input", onSearchInput);
    if (inpSearch) {
      inpSearch.addEventListener("blur", () => {
        setTimeout(() => hideSuggest(), 180);
      });
    }

    if (btnOk) {
      btnOk.addEventListener("click", () => {
        (async () => {
          if (!pending || !iuWeatherIsValidGeoCoords(pending.lat, pending.lon)) return;
          if (!confirm("Chcete uložit tuto lokalitu pro počasí?")) return;
          try{
            const label = String(pending.label || "").trim();
            if (!label) {
              alert("Vyberte prosím lokalitu.");
              return;
            }
            iuWeatherWriteLocationMode(IU_WEATHER_MODE_MANUAL);
            iuWeatherWriteManualLocation({ lat: pending.lat, lon: pending.lon, label });
            iuWeatherClearRuntimeCity();
            iuWeatherClearOpenMeteoCache();
            try{ window.__iuWeatherState = null; }catch{}
            iuWeatherBumpDailyPanelWeatherToken();
            const c = iuWeatherGetActiveCity();
            iuWeatherSyncCityLabels(c);
            close();
            await iuWeatherLoadAndRender();
          }catch{
            try{
              const c = iuWeatherGetActiveCity();
              iuWeatherSyncCityLabels(c);
            }catch{}
          }
        })();
      });
    }

    overlay.__iuWeatherMapOpen = open;
    overlay.__iuWeatherMapClose = close;
    return overlay;
  }

  function iuWeatherOpenMapPicker(){
    const o = iuWeatherEnsureMapPickerOverlay();
    try{ o.__iuWeatherMapOpen(); }catch{}
  }
  try{
    window.iuWeatherOpenMapPicker = iuWeatherOpenMapPicker;
    window.iuWeatherActivateGpsViaGeolocation = iuWeatherActivateGpsViaGeolocation;
  }catch{}

  function iuWeatherRadarEnsure(){
    const root = document.getElementById("iuWxRadar");
    const frame = document.getElementById("iuWxRadarFrame");
    const sk = document.getElementById("iuWxRadarSkeleton");
    if (!root || !frame) return;
    if (frame.querySelector("iframe")) return;
    const src = String(root.getAttribute("data-src") || "").trim();
    if (!src) return;
    const ifr = document.createElement("iframe");
    ifr.className = "iuWeatherRadarFrame";
    ifr.title = "Radar srážek";
    ifr.loading = "lazy";
    ifr.referrerPolicy = "no-referrer";
    ifr.src = src;
    try{ frame.removeAttribute("aria-hidden"); }catch{}
    try{
      if (sk) {
        sk.textContent = "Načítání radaru…";
        sk.style.display = "";
      }
    }catch{}
    ifr.addEventListener("load", () => {
      try{ if (sk) sk.style.display = "none"; }catch{}
    });
    ifr.addEventListener("error", () => {
      try{
        if (sk) {
          sk.textContent = "Radar nelze vložit — otevřete externě.";
          sk.style.display = "";
        }
      }catch{}
    });
    frame.appendChild(ifr);
  }

  function iuWeatherHideEmptyNameday(){
    try{
      const sec = String((document.body && document.body.dataset && document.body.dataset.section) || "");
      if (sec !== "pocasi") return;

      const el =
        document.getElementById("iuWxStickyNameday") ||
        document.getElementById("iuDailyNameday");
      if (!el) return;

      const t = (el.textContent || "").trim();

      if (!t || t === "—" || /Svátek/i.test(t)){
        el.textContent = "";
        el.hidden = true;
        el.setAttribute("aria-hidden","true");
      }
    }catch{}
  }

  async function iuWeatherLoadAndRender(){
    try{
      const myToken = (window.__iuWeatherRenderToken = (window.__iuWeatherRenderToken || 0) + 1);
      const city = iuWeatherGetActiveCity();
      const locationMode = iuWeatherReadLocationMode();
      iuWeatherSyncCityLabels(city);

      const elErr = document.getElementById("iuDailyErr");
      const elWeather = document.getElementById("iuDailyWeather");
      const elPlace = document.getElementById("iuWxPlace");
      const elFeelsLike = document.getElementById("iuWxFeelsLike");
      const elIcon = document.getElementById("iuWxIcon");
      const elTemp = document.getElementById("iuWxTemp");
      const elMinMax = document.getElementById("iuWxMinMax");
      const elNarrative = document.getElementById("iuWxHeroNarrative");

      if (elErr) elErr.hidden = true;
      if (elWeather) elWeather.hidden = false;
      if (elPlace) elPlace.textContent = String(city.name || "Praha");
      if (elTemp) elTemp.textContent = "—°C";
      if (elMinMax) elMinMax.textContent = "Max —° · Min —°";
      if (elIcon) elIcon.textContent = "☁️";
      if (elFeelsLike) elFeelsLike.textContent = "Pocitově —°C";
      if (elNarrative) elNarrative.textContent = "—";
      try{ const elHours = document.getElementById("iuWxHours"); if (elHours) elHours.classList.add("iuWxHours--skeleton"); }catch{}

      if (!IU_DISABLE_WEATHER_MAIN_MAP) iuWeatherSetMapState("loading");

      // Premium mini-karty metrik
      const elWindKph = document.getElementById("iuWxWindKph");
      const elWindGustKph = document.getElementById("iuWxWindGustKph");
      const elWindDir = document.getElementById("iuWxWindDir");
      const elPressureHpa = document.getElementById("iuWxPressureHpa");
      const elVisibilityKm = document.getElementById("iuWxVisibilityKm");
      const elUvIndex = document.getElementById("iuWxUvIndex");
      const elUvCategory = document.getElementById("iuWxUvCategory");
      const elHumidityPct = document.getElementById("iuWxHumidityPct");
      const elPrecipTodayMm = document.getElementById("iuWxPrecipTodayMm");

      function iuWxSetMinus(el){
        if (!el) return;
        el.textContent = "—";
      }
      iuWxSetMinus(elWindKph);
      iuWxSetMinus(elWindGustKph);
      iuWxSetMinus(elWindDir);
      iuWxSetMinus(elPressureHpa);
      iuWxSetMinus(elVisibilityKm);
      iuWxSetMinus(elUvIndex);
      iuWxSetMinus(elUvCategory);
      iuWxSetMinus(elHumidityPct);
      iuWxSetMinus(elPrecipTodayMm);

      const state = await (typeof window.iuWeatherEnsureState === "function"
        ? window.iuWeatherEnsureState()
        : (async () => {
            const d = await iuFetchOpenMeteo(city.lat, city.lon);
            const cur = d && d.current;
            const hourly = d && d.hourly;
            const daily = d && d.daily;
            if (!cur || typeof cur.temperature_2m !== "number") throw new Error("bad current");
            const existingState = window.__iuWeatherState;
            const keepActiveLayer = (function(){
              try{
                if (existingState && existingState.map && typeof existingState.map.activeLayer === "string"){
                  return iuWxSanitizeMapLayerKey(existingState.map.activeLayer);
                }
              }catch{}
              return iuWxSanitizeMapLayerKey(iuWxReadPersistedMapLayer());
            })();
            const state = iuWxBuildWeatherState(city, d, locationMode, keepActiveLayer);
            window.__iuWeatherState = state;
            iuWxPersistMapLayer(state.map.activeLayer);
            return state;
          })());

      if (window.__iuWeatherRenderToken !== myToken) return;
      iuWxApplyMobileLayoutFix();
      if (!state.map || typeof state.map !== "object") state.map = { activeLayer: "precip", supportedLayers: [], disabledLayers: [] };
      if (!state.map.activeLayer) state.map.activeLayer = "precip";
      iuWxPersistMapLayer(state.map.activeLayer);

      if (elTemp) elTemp.textContent = state && state.current && typeof state.current.temperatureC === "number" ? `${Math.round(state.current.temperatureC)}°C` : "—°C";
      if (elIcon) {
        elIcon.textContent =
          state && state.current && state.current.icon
            ? state.current.icon
            : iuWxResolveWeatherIcon(state && state.current ? state.current.weatherCode : null, state && state.current ? state.current.isDay : undefined);
      }
      if (elMinMax) elMinMax.textContent = `Max ${iuFmtDegShort(state && state.daily ? state.daily.todayMax : null)} · Min ${iuFmtDegShort(state && state.daily ? state.daily.todayMin : null)}`;
      if (elFeelsLike) elFeelsLike.textContent =
        (state && state.current && typeof state.current.feelsLikeC === "number" && isFinite(state.current.feelsLikeC))
          ? `Pocitově ${Math.round(state.current.feelsLikeC)}°C`
          : "Pocitově —°C";
      if (elNarrative) elNarrative.textContent = state && state.summary && state.summary.narrative ? String(state.summary.narrative) : "—";

      // Premium mini-karty
      try{
        if (elWindKph) elWindKph.textContent = typeof state.current.windKph === "number" ? `${Math.round(state.current.windKph)}` : "—";
        if (elWindGustKph) elWindGustKph.textContent = typeof state.current.windGustKph === "number" ? `${Math.round(state.current.windGustKph)}` : "—";
        if (elWindDir) elWindDir.textContent = iuWxWindDirLabel(state.current.windDirDeg);
        if (elPressureHpa) elPressureHpa.textContent = typeof state.current.pressureHpa === "number" ? `${Math.round(state.current.pressureHpa)}` : "—";
        if (elVisibilityKm) elVisibilityKm.textContent = typeof state.current.visibilityKm === "number" ? `${Math.round(state.current.visibilityKm * 10) / 10}` : "—";
        if (elUvIndex) elUvIndex.textContent = typeof state.current.uvIndex === "number" ? `${Math.round(state.current.uvIndex * 10) / 10}` : "—";
        if (elUvCategory) {
          const c = iuWxUvCategory(state.current.uvIndex);
          elUvCategory.textContent = c && c.label ? c.label : "—";
        }
        if (elHumidityPct) elHumidityPct.textContent = typeof state.current.humidityPct === "number" ? `${Math.round(state.current.humidityPct)}` : "—";
        if (elPrecipTodayMm) elPrecipTodayMm.textContent = typeof state.current.precipTodayMm === "number" ? `${Math.round(state.current.precipTodayMm)}` : "—";
      }catch{}

      // Hours/7-day depend on shared state raw response
      iuWeatherUpdateHours(state.hourly, state.rawDaily);
      iuWeatherRender7Day(state.rawDaily);

      // Map + layer UI
      iuWxSyncLayerButtons(state);
      if (!IU_DISABLE_WEATHER_MAIN_MAP) iuWxRenderMapWithRetry(state);

      iuWeatherApplySharedStateMeta(state);
      iuWeatherClearRuntimeCity();

      if (elWeather) elWeather.hidden = false;
      if (elErr) elErr.hidden = true;

      try{ iuWeatherHideEmptyNameday(); }catch{}
    }catch{
      try{
        const elErr = document.getElementById("iuDailyErr");
        const elWeather = document.getElementById("iuDailyWeather");
        if (elWeather) elWeather.hidden = true;
        if (elErr) elErr.hidden = false;
      }catch{}

      try{
        if (!IU_DISABLE_WEATHER_MAIN_MAP) iuWeatherSetMapState("fail");
      }catch{}
    }

    // Weather History init must be reliable: run after Weather render attempt.
    // The init has its own section guard + idempotent runtime guard.
    try{ iuInitWeatherHistory(); }catch{}
  }

  // Expose Weather render for router/diagnostics.
  try{ window.iuWeatherLoadAndRender = iuWeatherLoadAndRender; }catch{}

  // === MOJE SCHRÁNKY (MindMenu): min 1, max 6, controls follow last pill ===
  const MAILBOX_STORAGE_KEY = "iu_mailboxes_v1";
  const IU_MM_SOCIAL_DEFAULTS_FLAG = "iu_mm_social_defaults_v1";
  const IU_MAILBOX_DEFAULT_SOCIAL = ["facebook", "instagram", "x", "tiktok"];
  const MAILBOX_PLACEHOLDERS = ["Např.: e-mail 1", "Např.: e-mail 2", "Např.: pracovní web", "Např.: oblíbený web"];
  const IU_MAILBOX_MIN = 1;
  const IU_MAILBOX_MAX = 6;
  const IU_MAILBOX_LABEL_MAX = 17;
  const IU_MAILBOX_SOCIAL_OPTIONS = ["facebook", "instagram", "youtube", "x", "linkedin", "tiktok", "messenger"];
  const IU_MAILBOX_SOCIAL_URLS = {
    facebook: "https://facebook.com",
    instagram: "https://instagram.com",
    youtube: "https://youtube.com",
    x: "https://x.com",
    linkedin: "https://linkedin.com",
    tiktok: "https://tiktok.com",
    messenger: "https://www.messenger.com/"
  };

  /* Simple Icons (CC0 1.0) – https://github.com/simple-icons/simple-icons */
  const IU_SOCIAL_SVG_PATHS = {
    facebook: "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
    instagram: "M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077",
    youtube: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
    x: "M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z",
    linkedin: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
    tiktok: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
    messenger: "M12 0C5.373 0 0 5.373 0 12c0 3.99 2.067 7.518 5.21 9.55l-.584 2.136 2.182-.572A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.223-.548.223l.188-2.85 5.18-4.68c.223-.198-.054-.308-.346-.11l-6.4 4.02-2.76-1.01c-.6-.21-.61-.6.125-.89l10.782-4.156c.502-.196.94.12.78.89z"
  };

  function iuMailboxSocialIconSvg(key) {
    const pathD = IU_SOCIAL_SVG_PATHS[key];
    if (!pathD) return "";
    return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"#fff\" d=\"" + pathD + "\"/></svg>";
  }

  function iuMailboxLoad(){
    try{
      const txt = localStorage.getItem(MAILBOX_STORAGE_KEY);
      if (!txt) {
        const items = MAILBOX_PLACEHOLDERS.map((label, i) => ({ label, url: "", social: null, hidden: false, index: i, slot: i + 1 }));
        if (!localStorage.getItem(IU_MM_SOCIAL_DEFAULTS_FLAG)) {
          for (let i = 0; i < 4 && i < items.length; i++) {
            if (items[i].social == null) items[i].social = IU_MAILBOX_DEFAULT_SOCIAL[i] || null;
          }
          try{ localStorage.setItem(MAILBOX_STORAGE_KEY, JSON.stringify({ items: items.map(({ label, url, social, hidden, slot }) => ({ label, url, social, hidden: !!hidden, slot })) })); }catch{}
          try{ localStorage.setItem(IU_MM_SOCIAL_DEFAULTS_FLAG, "1"); }catch{}
        } else {
          try{ localStorage.setItem(MAILBOX_STORAGE_KEY, JSON.stringify({ items: items.map(({ label, url, social, hidden, slot }) => ({ label, url, social, hidden: !!hidden, slot })) })); }catch{}
        }
        return items;
      }
      const parsed = JSON.parse(txt);
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      const raw = items.slice(0, IU_MAILBOX_MAX);
      const validSocial = (s) => IU_MAILBOX_SOCIAL_OPTIONS.includes(s) ? s : null;
      let fixed = raw.map((it, i) => {
        const slot = (typeof it?.slot === "number" && it.slot >= 1 && it.slot <= 6) ? it.slot : (i + 1);
        return {
          label: String(it?.label ?? "").trim().slice(0, IU_MAILBOX_LABEL_MAX) || (i < 4 ? MAILBOX_PLACEHOLDERS[i] : ""),
          url: String(it?.url ?? "").trim(),
          social: validSocial(it?.social),
          hidden: it?.hidden === true,
          index: i,
          slot
        };
      });
      if (items.length > IU_MAILBOX_MAX) {
        try{ localStorage.setItem(MAILBOX_STORAGE_KEY, JSON.stringify({ items: fixed.map((it) => ({ label: it.label, url: it.url, social: it.social, hidden: !!it.hidden, slot: it.slot })) })); }catch{}
      }
      if (fixed.length < IU_MAILBOX_MIN) {
        for (let i = fixed.length; i < IU_MAILBOX_MIN; i++) {
          fixed.push({ label: MAILBOX_PLACEHOLDERS[i] || `Schránka ${i + 1}`, url: "", social: null, hidden: false, index: i, slot: i + 1 });
        }
        try{ localStorage.setItem(MAILBOX_STORAGE_KEY, JSON.stringify({ items: fixed.map((it) => ({ label: it.label, url: it.url, social: it.social, hidden: !!it.hidden, slot: it.slot })) })); }catch{}
      }
      if (!localStorage.getItem(IU_MM_SOCIAL_DEFAULTS_FLAG)) {
        for (let i = 0; i < 4 && i < fixed.length; i++) {
          if (fixed[i].social == null) fixed[i].social = IU_MAILBOX_DEFAULT_SOCIAL[i] || null;
        }
        try{ localStorage.setItem(MAILBOX_STORAGE_KEY, JSON.stringify({ items: fixed.map((it) => ({ label: it.label, url: it.url, social: it.social, hidden: !!it.hidden, slot: it.slot })) })); }catch{}
        try{ localStorage.setItem(IU_MM_SOCIAL_DEFAULTS_FLAG, "1"); }catch{}
      }
      let migrated56 = false;
      for (let i = 4; i <= 5; i++) {
        if (fixed[i] && (fixed[i].social == null || fixed[i].social === "" || typeof fixed[i].social === "undefined")) {
          fixed[i].social = i === 4 ? "linkedin" : "youtube";
          migrated56 = true;
        }
      }
      if (migrated56) {
        try{ localStorage.setItem(MAILBOX_STORAGE_KEY, JSON.stringify({ items: fixed.map((it) => ({ label: it.label, url: it.url, social: it.social, hidden: !!it.hidden, slot: it.slot })) })); }catch{}
      }
      const hadSlotMigration = raw.some((it, i) => typeof it?.slot !== "number" || it.slot < 1 || it.slot > 6);
      if (hadSlotMigration) {
        try{ localStorage.setItem(MAILBOX_STORAGE_KEY, JSON.stringify({ items: fixed.map((it) => ({ label: it.label, url: it.url, social: it.social, hidden: !!it.hidden, slot: it.slot })) })); }catch{}
      }
      fixed.sort((a, b) => (a.slot || 0) - (b.slot || 0));
      return fixed;
    }catch{
      return MAILBOX_PLACEHOLDERS.map((label, i) => ({ label, url: "", social: null, index: i, slot: i + 1 }));
    }
  }

  function iuMailboxSave(items){
    try{
      const sorted = items.slice().sort((a, b) => (a.slot || 0) - (b.slot || 0));
      const toSave = sorted.map((it) => ({
        label: String(it?.label ?? "").trim().slice(0, IU_MAILBOX_LABEL_MAX),
        url: String(it?.url ?? "").trim(),
        social: IU_MAILBOX_SOCIAL_OPTIONS.includes(it?.social) ? it.social : null,
        hidden: !!it?.hidden,
        slot: typeof it?.slot === "number" ? it.slot : 0
      }));
      localStorage.setItem(MAILBOX_STORAGE_KEY, JSON.stringify({ items: toSave }));
    }catch{}
  }

  function iuUpdateMailboxControls(count){
    const add = document.getElementById("iuMailboxAdd");
    const rem = document.getElementById("iuMailboxRemove");
    if (!add || !rem) return;
    add.style.display = count < IU_MAILBOX_MAX ? "inline" : "none";
    rem.style.display = count > IU_MAILBOX_MIN ? "inline" : "none";
  }

  function iuPositionMailboxControls(controlsEl){
    const controls = controlsEl || document.getElementById("iuMailboxControls");
    const list = document.getElementById("iuMailboxList");
    if (!controls || !list) return;
    const items = Array.from(list.querySelectorAll(".iu-mailbox-row"));
    const last = items.length ? items[items.length - 1] : null;
    if (last && last.parentNode) {
      last.insertAdjacentElement("afterend", controls);
    } else {
      list.appendChild(controls);
    }
  }

  function iuMailboxRender(){
    const list = document.getElementById("iuMailboxList");
    if (!list) return;
    const controls = document.getElementById("iuMailboxControls");
    if (controls && controls.parentNode) controls.remove();
    let items = iuMailboxLoad();
    items = items.slice().sort((a, b) => (a.slot || 0) - (b.slot || 0));
    const visibleCount = items.filter((it) => !it.hidden).length;
    const mailboxesEl = list.closest(".iu-mailboxes");
    if (mailboxesEl) {
      if (visibleCount < 4) mailboxesEl.classList.add("iu-mailboxes-can-shrink");
      else mailboxesEl.classList.remove("iu-mailboxes-can-shrink");
    }
    const frag = document.createDocumentFragment();
    items.forEach((it, i) => {
      if (it.hidden) return;
      const row = document.createElement("div");
      row.className = "iu-mailbox-row";
      const slot = typeof it.slot === "number" ? it.slot : (i + 1);
      const ph = MAILBOX_PLACEHOLDERS[slot - 1] || ("Schránka " + slot);
      const label = it.label || ph;
      const social = it.social && IU_MAILBOX_SOCIAL_OPTIONS.includes(it.social) ? it.social : null;
      const socialUrl = social && IU_MAILBOX_SOCIAL_URLS[social] ? IU_MAILBOX_SOCIAL_URLS[social] : "";
      const socialSlotHtml = social && socialUrl
        ? `<a href="${escapeHtml(socialUrl)}" class="iu-pill-social-slot" data-mailbox-social="${i}" data-social="${escapeHtml(social)}" aria-label="${escapeHtml(social)}" rel="noopener noreferrer" target="_blank"><span class="iu-pill-social-icon iu-social-ios40">${iuMailboxSocialIconSvg(social)}</span></a>`
        : "";
      row.innerHTML = `<button class="iu-mailbox-pill" type="button" data-mailbox-index="${i}" data-mailbox-open>${escapeHtml(label)}</button>` +
        `<button class="iu-mailbox-gear" type="button" data-mailbox-gear="${i}" aria-label="Nastavení schránky ${i + 1}" title="Nastavení"><i class="fa-solid fa-gear" aria-hidden="true"></i></button>` +
        socialSlotHtml;
      frag.appendChild(row);
    });
    list.innerHTML = "";
    list.appendChild(frag);
    if (controls) iuPositionMailboxControls(controls);
  }

  function iuMailboxesInit(){
    if (window.__iuMailboxesInitDone) return;
    window.__iuMailboxesInitDone = 1;
    const list = document.getElementById("iuMailboxList");
    if (!list) return;
    iuMailboxRender();
    let mailboxCount = iuMailboxLoad().filter((it) => !it.hidden).length;
    iuUpdateMailboxControls(mailboxCount);
    iuPositionMailboxControls();

    document.getElementById("iuMailboxAdd")?.addEventListener("click", () => {
      if (mailboxCount >= IU_MAILBOX_MAX) return;
      const items = iuMailboxLoad();
      const visibleCount = items.filter((it) => !it.hidden).length;
      if (visibleCount >= IU_MAILBOX_MAX) return;
      const next = items.filter((x) => x && x.hidden).sort((a, b) => (a.slot || 0) - (b.slot || 0))[0];
      let restored = false;
      if (next) {
        next.hidden = false;
        restored = true;
      }
      if (!restored) {
        const used = new Set(items.map((x) => x.slot).filter((n) => typeof n === "number"));
        const free = [1, 2, 3, 4, 5, 6].find((s) => !used.has(s));
        if (free != null) {
          const defaultSocial = free === 5 ? "linkedin" : free === 6 ? "youtube" : null;
          items.push({ label: "", url: "", social: defaultSocial, hidden: false, index: items.length, slot: free });
        }
      }
      iuMailboxSave(items);
      iuMailboxRender();
      mailboxCount = items.filter((it) => !it.hidden).length;
      iuUpdateMailboxControls(mailboxCount);
      iuPositionMailboxControls();
      requestAnimationFrame(() => {
        const rail = document.querySelector(".layout > aside.accordionCol");
        if (rail) rail.style.height = "auto";
      });
    });

    document.getElementById("iuMailboxRemove")?.addEventListener("click", () => {
      if (mailboxCount <= IU_MAILBOX_MIN) return;
      const items = iuMailboxLoad();
      const visibleCount = items.filter((it) => !it.hidden).length;
      if (visibleCount <= IU_MAILBOX_MIN) return;
      for (let i = items.length - 1; i >= 0; i--) {
        if (!items[i].hidden) {
          items[i].hidden = true;
          break;
        }
      }
      iuMailboxSave(items);
      iuMailboxRender();
      mailboxCount = items.filter((it) => !it.hidden).length;
      iuUpdateMailboxControls(mailboxCount);
      iuPositionMailboxControls();
      requestAnimationFrame(() => {
        const rail = document.querySelector(".layout > aside.accordionCol");
        if (rail) rail.style.height = "auto";
      });
    });

    function iuMailboxOpenEditDialog(idx, it, onDone){
      const MAX = IU_MAILBOX_LABEL_MAX;
      let selectedSocial = it.social && IU_MAILBOX_SOCIAL_OPTIONS.includes(it.social) ? it.social : null;
      const socialRowHtml = IU_MAILBOX_SOCIAL_OPTIONS.map((key) => {
        const pressed = selectedSocial === key ? "true" : "false";
        return `<button type="button" class="iu-pill-social-opt iu-social-ios40" data-social="${escapeHtml(key)}" aria-pressed="${pressed}" title="${escapeHtml(key)}" style="cursor:pointer;padding:0;">${iuMailboxSocialIconSvg(key)}</button>`;
      }).join("");
      const overlay = document.createElement("div");
      overlay.setAttribute("id", "iu-mailbox-edit-overlay");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:9999;";
      const form = document.createElement("form");
      form.style.cssText = "background:#fff;padding:20px;border-radius:12px;min-width:280px;box-shadow:0 10px 40px rgba(0,0,0,0.2);";
      form.innerHTML = `
        <p style="margin:0 0 12px 0;font-weight:600;">Název tlačítka (max 17 znaků)</p>
        <input type="text" id="iu-mailbox-edit-label" maxlength="17" autocomplete="off" value="${escapeHtml(it.label || "")}" style="width:100%;box-sizing:border-box;padding:8px 10px;margin-bottom:12px;border:1px solid #ccc;border-radius:6px;" />
        <p style="margin:0 0 12px 0;font-weight:600;">URL (www)</p>
        <input type="text" id="iu-mailbox-edit-url" autocomplete="off" value="${escapeHtml(it.url || "")}" style="width:100%;box-sizing:border-box;padding:8px 10px;margin-bottom:12px;border:1px solid #ccc;border-radius:6px;" />
        <div class="iu-mailbox-edit-social-row" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin:12px 0;">
          ${socialRowHtml}
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button type="button" id="iu-mailbox-edit-cancel" style="padding:8px 14px;border:1px solid #999;background:#fff;border-radius:6px;cursor:pointer;">Zrušit</button>
          <button type="submit" style="padding:8px 14px;border:none;background:#1F4B99;color:#fff;border-radius:6px;cursor:pointer;">Uložit</button>
        </div>
      `;
      overlay.appendChild(form);
      document.body.appendChild(overlay);

      form.querySelectorAll(".iu-pill-social-opt").forEach((btn) => {
        btn.querySelector("svg")?.setAttribute("width", "20");
        btn.querySelector("svg")?.setAttribute("height", "20");
        btn.style.color = "#fff";
        btn.addEventListener("click", () => {
          const key = btn.getAttribute("data-social");
          selectedSocial = selectedSocial === key ? null : key;
          form.querySelectorAll(".iu-pill-social-opt").forEach((b) => {
            const k = b.getAttribute("data-social");
            b.setAttribute("aria-pressed", selectedSocial === k ? "true" : "false");
            b.style.borderColor = selectedSocial === k ? "#1F4B99" : "#cfd2d6";
          });
        });
      });

      const labelInput = form.querySelector("#iu-mailbox-edit-label");
      const urlInput = form.querySelector("#iu-mailbox-edit-url");
      labelInput.addEventListener("input", () => {
        if (labelInput.value.length > MAX) labelInput.value = labelInput.value.slice(0, MAX);
      });
      form.querySelector("#iu-mailbox-edit-cancel").addEventListener("click", () => {
        overlay.remove();
      });
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.remove();
      });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const label = String(labelInput.value).trim().slice(0, MAX);
        const url = String(urlInput.value).trim();
        overlay.remove();
        onDone(label, url, selectedSocial);
      });
      labelInput.focus();
    }

    list.addEventListener("click", (e) => {
      const gearBtn = e.target.closest?.("[data-mailbox-gear]");
      if (gearBtn) {
        e.preventDefault();
        const idx = parseInt(gearBtn.getAttribute("data-mailbox-gear") || "0", 10);
        const items = iuMailboxLoad();
        const it = items[idx];
        if (!it) return;
        iuMailboxOpenEditDialog(idx, it, (label, url, social) => {
          const items = iuMailboxLoad();
          const labelNorm = String(label).trim().slice(0, IU_MAILBOX_LABEL_MAX);
          items[idx] = { ...items[idx], label: labelNorm, url: String(url).trim(), social: social && IU_MAILBOX_SOCIAL_OPTIONS.includes(social) ? social : null };
          iuMailboxSave(items);
          iuMailboxRender();
        });
        return;
      }
      const pillBtn = e.target.closest?.("[data-mailbox-open]");
      if (pillBtn) {
        const idx = parseInt(pillBtn.getAttribute("data-mailbox-index") || "0", 10);
        const items = iuMailboxLoad();
        const it = items[idx];
        const urlVal = it?.url && String(it.url).trim();
        if (urlVal) {
          window.open(it.url, "_blank", "noopener");
        } else {
          e.preventDefault();
          const gear = list.querySelector(`[data-mailbox-gear="${idx}"]`);
          if (gear) gear.click();
        }
      }
    });
  }

  function iuWeatherSetGeoFlowFeedback(message, kind){
    try{
      if (kind === "clear" || !message) {
        window.__iuWeatherGeoFlowFeedback = null;
        try{ if (typeof window.iuSilverWeatherRefresh === "function") window.iuSilverWeatherRefresh(); }catch{}
        return;
      }
      window.__iuWeatherGeoFlowFeedback = { message: String(message), kind: String(kind || "error") };
      try{ if (typeof window.iuSilverWeatherRefresh === "function") window.iuSilverWeatherRefresh(); }catch{}
    }catch{}
  }

  function iuWeatherGeoErrorMessageFromCode(err){
    try{
      const c = err && typeof err.code === "number" ? err.code : -1;
      if (c === 1) return "Nelze získat polohu — v prohlížeči povolte přístup k poloze";
      if (c === 2) return "Nelze získat polohu — poloha není dostupná";
      if (c === 3) return "Nelze získat polohu — vypršel čas";
    }catch{}
    return "Nelze získat polohu";
  }

  function iuWeatherActivateGpsViaGeolocation(){
    try{
      if (!navigator.geolocation) throw new Error("no geolocation");
      iuWeatherSetGeoFlowFeedback("", "clear");
      iuWeatherSetGeoFlowFeedback("Zjišťuji polohu…", "loading");
      try{
        const c0 = iuWeatherGetActiveCity();
        iuWeatherSyncCityLabels(c0);
      }catch{}

      // P0 mobile (iOS Safari): getCurrentPosition must run in the same synchronous
      // user-gesture turn as the tap/click. An async IIFE defers to a microtask and
      // drops the gesture, so the API never prompts / never returns — looks like a dead button.
      // P0 mobile Chrome: error callback must set visible feedback — manual mode hides the geo line unless we force-show it via iuWeatherSyncCityLabels + __iuWeatherGeoFlowFeedback.
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          void (async () => {
            try{
              iuWeatherSetGeoFlowFeedback("", "clear");
              const lat = Number(pos && pos.coords && pos.coords.latitude);
              const lon = Number(pos && pos.coords && pos.coords.longitude);
              if (!isFinite(lat) || !isFinite(lon)) throw new Error("bad coords");

              iuWeatherSetGeoFlowFeedback("Hledám lokalitu…", "loading");
              try{
                const cMid = iuWeatherGetActiveCity();
                iuWeatherSyncCityLabels(cMid);
              }catch{}

              const label = await iuWeatherGpsNearestLocalityLabel(lat, lon);
              const city = { name: label || "Poloha", lat, lon };
              iuWeatherSetGeoFlowFeedback("", "clear");
              iuWeatherWriteLocationMode(IU_WEATHER_MODE_GPS);
              iuWeatherClearRuntimeCity();
              iuWeatherWriteGpsSelected(city);
              iuWeatherClearOpenMeteoCache();
              try{ window.__iuWeatherState = null; }catch{}
              iuWeatherSyncCityLabels(city);
              iuWeatherLoadAndRender();
            }catch{
              iuWeatherClearRuntimeCity();
              iuWeatherSetGeoFlowFeedback("Nelze získat polohu", "error");
              try{
                const c = iuWeatherGetActiveCity();
                iuWeatherSyncCityLabels(c);
              }catch{}
              iuWeatherLoadAndRender();
            }
          })();
        },
        (err) => {
          iuWeatherClearRuntimeCity();
          iuWeatherSetGeoFlowFeedback(iuWeatherGeoErrorMessageFromCode(err), "error");
          try{
            const c = iuWeatherGetActiveCity();
            iuWeatherSyncCityLabels(c);
          }catch{}
          iuWeatherLoadAndRender();
        },
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
      );
    }catch{
      iuWeatherClearRuntimeCity();
      iuWeatherSetGeoFlowFeedback("Nelze získat polohu — geolokace není dostupná", "error");
      try{
        const c = iuWeatherGetActiveCity();
        iuWeatherSyncCityLabels(c);
      }catch{}
      iuWeatherLoadAndRender();
    }
  }

  function iuWeatherHasSavedManualCity(){
    try{
      return !!iuWeatherReadManualLocation();
    }catch{
      return false;
    }
  }

  function iuWeatherSwitchToModeManualUsingStoredIfAny(){
    try{
      const man = iuWeatherReadManualLocation();
      if (!man) return false;
      iuWeatherWriteLocationMode(IU_WEATHER_MODE_MANUAL);
      iuWeatherClearRuntimeCity();
      iuWeatherClearOpenMeteoCache();
      try{ window.__iuWeatherState = null; }catch{}
      const c = iuWeatherGetActiveCity();
      iuWeatherSyncCityLabels(c);
      iuWeatherLoadAndRender();
      return true;
    }catch{
      return false;
    }
  }

  function iuWeatherInit(){
    try{
      if (window.__iuWeatherInitDone) return;
      window.__iuWeatherInitDone = 1;

      const btn = document.getElementById("iuWeatherCityChange");
      if (btn) btn.addEventListener("click", () => {
        try{
          const mode = iuWeatherReadLocationMode();
          if (mode === IU_WEATHER_MODE_GPS) {
            if (iuWeatherHasSavedManualCity()) {
              if (iuWeatherSwitchToModeManualUsingStoredIfAny()) return;
            }
            iuWeatherOpenMapPicker();
            return;
          }
          iuWeatherOpenMapPicker();
        }catch{}
      });

      try{
        const params = new URLSearchParams(location.search || "");
        if (params.get("cityPicker") === "1" || params.get("mapPicker") === "1") {
          try{ iuWeatherOpenMapPicker(); }catch{}
        }
      }catch{}

      const geoBtn = document.getElementById("iuWeatherGeoBtn");
      if (geoBtn) geoBtn.addEventListener("click", () => {
        iuWeatherActivateGpsViaGeolocation();
      });

      const radarBtn = document.getElementById("iuWxRadarOpen");
      if (radarBtn) radarBtn.addEventListener("click", () => {
        iuWeatherRadarEnsure();
      });

      const layerBar = document.getElementById("iuWxLayerSwitchBar");
      if (layerBar) layerBar.addEventListener("click", (e) => {
        try{
          const btn = e.target && e.target.closest ? e.target.closest("button[data-iu-weather-layer]") : null;
          if (!btn) return;
          const layerId = btn.getAttribute("data-iu-weather-layer");
          if (!layerId) return;
          iuWxSetActiveLayer(layerId);
        }catch{}
      });

      const quickGrid = document.getElementById("iuWeatherView") ? document.getElementById("iuWeatherView").querySelector(".iuWeatherQuickGrid") : null;
      if (quickGrid) quickGrid.addEventListener("click", (e) => {
        try{
          const btn = e.target && e.target.closest ? e.target.closest("button[data-iu-quick-layer]") : null;
          if (!btn) return;
          const qLayer = btn.getAttribute("data-iu-quick-layer");
          if (!qLayer) return;
          iuWxSetActiveLayer(qLayer);
        }catch{}
      });

      try{
        if (!window.__iuWeatherMobileFixResizeBound) {
          window.__iuWeatherMobileFixResizeBound = 1;
          window.addEventListener("resize", () => { try{ iuWxApplyMobileLayoutFix(); }catch{} }, { passive: true });
        }
      }catch{}
      try{ iuWxApplyMobileLayoutFix(); }catch{}
    }catch{}
  }

  // === IU Daily Panel (right sidebar top) — time/date + nameday + weather + hours ===
  window.iuDailyPanelInit = function iuDailyPanelInit(){
    const TZ = "Europe/Prague";

    const elTime = document.getElementById("iuDailyTime");
    const elDate = document.getElementById("iuDailyDate");
    const elNameday = document.getElementById("iuDailyNameday");
    const elWxStickyTime = document.getElementById("iuWxStickyTime");
    const elWxStickyDate = document.getElementById("iuWxStickyDate");
    const elWxStickyNameday = document.getElementById("iuWxStickyNameday");

    const elWeather = document.getElementById("iuDailyWeather");
    const elErr = document.getElementById("iuDailyErr");

    const elPlace = document.getElementById("iuWxPlace");
    const elIcon = document.getElementById("iuWxIcon");
    const elTemp = document.getElementById("iuWxTemp");
    const elMinMax = document.getElementById("iuWxMinMax");
    const elHours = document.getElementById("iuWxHours");

    if (!elTime && !elDate && !elWeather && !elErr) return;

    function fmtTime(d){
      return new Intl.DateTimeFormat("cs-CZ",{hour:"2-digit",minute:"2-digit",timeZone:TZ}).format(d);
    }
    function fmtDate(d){
      return new Intl.DateTimeFormat("cs-CZ",{weekday:"long",day:"numeric",month:"long",timeZone:TZ}).format(d);
    }
    function fmtHour(d){
      return new Intl.DateTimeFormat("cs-CZ",{hour:"numeric",hour12:false,timeZone:TZ}).format(d) + "h";
    }
    function fmtDeg(n){
      if (typeof n !== "number" || !isFinite(n)) return "—";
      return Math.round(n) + "°";
    }
    // TIME/DATE tick (idempotent)
    function tick(){
      const now = new Date();
      if (elTime) elTime.textContent = fmtTime(now);
      if (elDate) elDate.textContent = fmtDate(now);
      if (elWxStickyTime) elWxStickyTime.textContent = fmtTime(now);
      if (elWxStickyDate) elWxStickyDate.textContent = iuFmtDateShort(now);
    }
    tick();
    if (window.__iu_daily_timer) clearInterval(window.__iu_daily_timer);
    window.__iu_daily_timer = setInterval(tick, 60000);

    // NAME DAY (Svátky)
    function updateNameday(){
      if (!IU_ENABLE_NAMEDAY) return;
      if (!elNameday && !elWxStickyNameday) return;

      if (elWxStickyNameday) {
        elWxStickyNameday.textContent = "";
        elWxStickyNameday.hidden = true;
        elWxStickyNameday.setAttribute("aria-hidden","true");
      }

      if (elNameday) {
        // Nameday is displayed only in TOPBAR; the panel element stays hidden (no flash / no placeholders).
        elNameday.textContent = "";
        elNameday.hidden = true;
        elNameday.setAttribute("aria-hidden","true");
      }
      try{ iuWeatherHideEmptyNameday(); }catch{}
      var _ndOrigin = typeof location !== "undefined" && location.origin ? location.origin : "";
      var _ndUrl = _ndOrigin ? _ndOrigin + "/projects/data/namedays.json" : "";
      if (!_ndUrl) {
        try{ window.__iuNamedaySuffixFromSource = ""; }catch{}
        if (elNameday) { elNameday.textContent = "Svátek má —"; elNameday.hidden = true; elNameday.setAttribute("aria-hidden","true"); }
        try{ iuSetTopbarNameday(""); }catch{}
        return;
      }
      fetch(_ndUrl, { headers: { "accept": "application/json" }, cache: "no-store" })
        .then(r => { try { return r.ok ? r.json() : null; } catch { return null; } }).catch(function(){ return null; })
        .then(function(d){
          var nm = "";
          try {
            if (d && typeof d === "object" && !Array.isArray(d)) {
              var now = new Date();
              var m = (now.getMonth() + 1); var day = now.getDate();
              var key = (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
              var v = d[key];
              if (typeof v === "string" && v.trim()) nm = v.trim();
            }
          } catch (_) {}
          var ok = Boolean(nm) && nm !== "—" && nm !== "-";
          try{ window.__iuNamedaySuffixFromSource = ok ? nm : ""; }catch{}
          if (ok) {
            if (elNameday) { elNameday.textContent = "Svátek má " + nm; elNameday.hidden = true; elNameday.setAttribute("aria-hidden","true"); }
            try{ iuSetTopbarNameday(nm); }catch{}
          } else {
            if (elNameday) { elNameday.textContent = "Svátek má —"; elNameday.hidden = true; elNameday.setAttribute("aria-hidden","true"); }
            try{ iuSetTopbarNameday(""); }catch{}
          }
          try{ if (typeof window.iuSilverWelcomeRefresh === "function") window.iuSilverWelcomeRefresh(); }catch{}
          try{ iuWeatherHideEmptyNameday(); }catch{}
        })
        .catch(function(){
          try{ window.__iuNamedaySuffixFromSource = ""; }catch{}
          if (elNameday) { elNameday.textContent = "Svátek má —"; elNameday.hidden = true; elNameday.setAttribute("aria-hidden","true"); }
          try{ if (typeof iuSetTopbarNameday === "function") iuSetTopbarNameday(""); }catch{}
          try{ iuWeatherHideEmptyNameday(); }catch{}
        });
    }
    updateNameday();
    (function scheduleNamedayMidnight(){
      const toNext001 = function(){
        const n = new Date();
        const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 1, 0, 0);
        return Math.max(60000, next - n);
      };
      setTimeout(function run(){ updateNameday(); setTimeout(run, 24*60*60*1000); }, toNext001());
    })();

    // WEATHER (Open-Meteo) + hourly strip + min/max
    const city = iuWeatherGetActiveCity();
    const placeName = String(city && city.name ? city.name : "Praha");
    const lat = Number(city && city.lat);
    const lon = Number(city && city.lon);

    if (elErr) elErr.hidden = true;
    if (elWeather) elWeather.hidden = false;

    if (elPlace) elPlace.textContent = placeName;
    if (elTemp) elTemp.textContent = "—°C";
    if (elMinMax) elMinMax.textContent = "Max —° · Min —°";
    if (elIcon) elIcon.textContent = "☁️";
    // CLS mitigation: hodiny mají předrenderované "sloty" v HTML (skeleton),
    // takže je tady nemažeme (mazání + pozdější append = layout shift).
    if (elHours) {
      try { elHours.classList.add("iuWxHours--skeleton"); } catch(_){}
    }

    // Consume unified shared state when available (avoid duplicate Open-Meteo fetches).
    try{
      const st = window.__iuWeatherState;
      if (st && typeof st.lat === "number" && typeof st.lon === "number" && Math.abs(st.lat - lat) < 0.00001 && Math.abs(st.lon - lon) < 0.00001 && st.current && st.hourly && st.rawDaily && iuWeatherStateMatchesActiveCity(st)) {
        if (elPlace) elPlace.textContent = st.city && st.city.name ? String(st.city.name) : "Praha";
        if (elTemp) elTemp.textContent = typeof st.current.temperatureC === "number" ? `${Math.round(st.current.temperatureC)}°C` : "—°C";
        if (elIcon) elIcon.textContent = st.current.icon ? String(st.current.icon) : iuWxResolveWeatherIcon(st.current.weatherCode, st.current.isDay);
        if (elMinMax) elMinMax.textContent = `Max ${fmtDeg(st.daily ? st.daily.todayMax : null)} · Min ${fmtDeg(st.daily ? st.daily.todayMin : null)}`;
        try{ iuWeatherUpdateHours(st.hourly, st.rawDaily); }catch{}
        try{ iuWeatherRender7Day(st.rawDaily); }catch{}
        if (elWeather) elWeather.hidden = false;
        if (elErr) elErr.hidden = true;
        try{ if (typeof window.iuSilverWeatherRefresh === "function") window.iuSilverWeatherRefresh(); }catch{}
        return;
      }
    }catch{}

    if (typeof window.iuWeatherEnsureState === "function") {
      const wxToken = (window.__iuDailyPanelWxToken = (window.__iuDailyPanelWxToken || 0) + 1);
      try{
        window.iuWeatherEnsureState()
          .then(st => {
            if (window.__iuDailyPanelWxToken !== wxToken) return;
            if (!iuWeatherStateMatchesActiveCity(st)) return;
            if (!st || !st.current) throw new Error("bad state");
            if (elPlace) elPlace.textContent = st.city && st.city.name ? String(st.city.name) : "Praha";
            if (elTemp) elTemp.textContent = typeof st.current.temperatureC === "number" ? `${Math.round(st.current.temperatureC)}°C` : "—°C";
            if (elIcon) elIcon.textContent = st.current.icon ? String(st.current.icon) : iuWxResolveWeatherIcon(st.current.weatherCode, st.current.isDay);
            if (elMinMax) elMinMax.textContent = `Max ${fmtDeg(st.daily ? st.daily.todayMax : null)} · Min ${fmtDeg(st.daily ? st.daily.todayMin : null)}`;
            try{ iuWeatherUpdateHours(st.hourly, st.rawDaily); }catch{}
            try{ iuWeatherRender7Day(st.rawDaily); }catch{}
            if (elWeather) elWeather.hidden = false;
            if (elErr) elErr.hidden = true;
            try{ if (typeof window.iuSilverWeatherRefresh === "function") window.iuSilverWeatherRefresh(); }catch{}
          })
          .catch(() => {
            if (elWeather) elWeather.hidden = true;
            if (elErr) elErr.hidden = false;
            try{ if (typeof window.iuSilverWeatherRefresh === "function") window.iuSilverWeatherRefresh(); }catch{}
          });
      }catch{
        if (elWeather) elWeather.hidden = true;
        if (elErr) elErr.hidden = false;
      }
      return;
    }

    // If ensureState is missing (should never happen), fail closed without fetching.
    if (elWeather) elWeather.hidden = true;
    if (elErr) elErr.hidden = false;
  };

  const IU_QUICKTOOLS_STORAGE_KEY = "infouzel_quicktools";
  const IU_QUICKTOOLS_CONFIG_VERSION = 1;
  const IU_QUICKTOOLS_REGISTRY = [
    { id: "datovka", label: "Datová schránka", accent: "#1F4B99" },
    { id: "bankovnictvi", label: "Internetové bankovnictví", accent: "#0066cc" },
    { id: "bakalari", label: "Bakaláři", accent: "#2e7d32" },
    { id: "zdravotni_pojistovna", label: "Zdravotní pojišťovna", accent: "#00838f" },
    { id: "zasilky", label: "Zásilky a sledování", accent: "#e60012" },
    { id: "ai_asistenti", label: "AI asistenti", accent: "#0d9488" },
    { id: "prekladac", label: "Překladač", accent: "#0d9488" },
    { id: "word_pdf", label: "Převod Word / PDF", accent: "#c62828" },
    { id: "financni_kalkulacky", label: "Finanční kalkulačky", accent: "#4285f4" },
    { id: "vzory_smluv", label: "Vzory smluv a plné moci", accent: "#ff0000" },
    { id: "komunikace_vzdelavani", label: "Komunikace a vzdělávání", accent: "#6a1b9a" },
    { id: "katastr_nemovitosti", label: "Katastr nemovitostí", accent: "#5d4037" },
    { id: "registr_smluv", label: "Registr smluv", accent: "#0066cc" },
    { id: "obchodni_rejstrik", label: "Obchodní rejstřík", accent: "#37474f" },
    { id: "zivnostensky_rejstrik", label: "Živnostenský rejstřík", accent: "#455a64" },
    { id: "naceneni_nakupu_domu", label: "Nákup potravin online", accent: "#2e7d32" }
  ];

  function loadQuickToolsConfig() {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(IU_QUICKTOOLS_STORAGE_KEY) : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.version === "number" && Array.isArray(parsed.order) && Array.isArray(parsed.visible)) return parsed;
      return null;
    } catch (e) {
      return null;
    }
  }

  function saveQuickToolsConfig(cfg) {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(IU_QUICKTOOLS_STORAGE_KEY, JSON.stringify(cfg));
    } catch (e) {}
  }

  function resetQuickToolsConfig() {
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(IU_QUICKTOOLS_STORAGE_KEY);
    } catch (e) {}
  }

  function getDefaultQuickToolsConfig() {
    const order = IU_QUICKTOOLS_REGISTRY.map(function(r){ return r.id; });
    return { version: IU_QUICKTOOLS_CONFIG_VERSION, order: order.slice(), visible: order.slice() };
  }

  function sanitizeQuickToolsConfig(stored) {
    const defaultCfg = getDefaultQuickToolsConfig();
    const knownIds = new Set(IU_QUICKTOOLS_REGISTRY.map(function(r){ return r.id; }));
    let order = Array.isArray(stored.order) ? stored.order.filter(function(id){ return knownIds.has(id); }) : [];
    const missingOrder = defaultCfg.order.filter(function(id){ return order.indexOf(id) === -1; });
    order = order.concat(missingOrder);
    let visible = Array.isArray(stored.visible) ? stored.visible.filter(function(id){ return knownIds.has(id); }) : [];
    visible = order.filter(function(id){ return visible.indexOf(id) !== -1; });
    return { version: IU_QUICKTOOLS_CONFIG_VERSION, order: order, visible: visible };
  }

  function iuQuickToolsApplyConfig() {
    const panelEl = document.getElementById("iuQuickToolsSettingsPanel");
    const grid = panelEl && panelEl.nextElementSibling && panelEl.nextElementSibling.classList.contains("iu-mmQuickGrid")
      ? panelEl.nextElementSibling
      : (function(){
          const section = panelEl ? panelEl.closest("section.iu-mmQuickLinks") : (document.querySelector("aside.accordionCol .mindMenu section.iu-mmQuickLinks") || document.querySelector("aside.accordionCol section.iu-mmQuickLinks"));
          return section ? section.querySelector(".iu-mmQuickGrid") : null;
        })();
    if (!grid) return;
    const stored = loadQuickToolsConfig();
    const cfg = stored ? sanitizeQuickToolsConfig(stored) : getDefaultQuickToolsConfig();
    const orderMap = {};
    cfg.order.forEach(function(id, i){ orderMap[id] = i; });
    const tiles = Array.from(grid.querySelectorAll(".iuTile[data-quicktool-id]"));
    tiles.sort(function(a, b){
      const idA = a.getAttribute("data-quicktool-id");
      const idB = b.getAttribute("data-quicktool-id");
      const idxA = orderMap[idA] !== undefined ? orderMap[idA] : 999;
      const idxB = orderMap[idB] !== undefined ? orderMap[idB] : 999;
      return idxA - idxB;
    });
    tiles.forEach(function(el){ grid.appendChild(el); });
    tiles.forEach(function(el){
      const id = el.getAttribute("data-quicktool-id");
      const hide = cfg.visible.indexOf(id) === -1;
      el.hidden = hide;
      el.style.display = hide ? "none" : "";
    });
  }

  function iuQuickToolsSettingsOpen() {
    const panel = document.getElementById("iuQuickToolsSettingsPanel");
    if (!panel) return;
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    if (typeof panel._iuQuickToolsSync === "function") panel._iuQuickToolsSync();
    document.body.addEventListener("keydown", iuQuickToolsSettingsOnEsc);
    document.addEventListener("click", iuQuickToolsSettingsOnOutside);
  }

  function iuQuickToolsSettingsClose() {
    const panel = document.getElementById("iuQuickToolsSettingsPanel");
    if (!panel) return;
    panel.hidden = true;
    panel.setAttribute("aria-hidden", "true");
    document.body.removeEventListener("keydown", iuQuickToolsSettingsOnEsc);
    document.removeEventListener("click", iuQuickToolsSettingsOnOutside);
  }

  function iuQuickToolsSettingsOnEsc(e) {
    if (e.key === "Escape") iuQuickToolsSettingsClose();
  }

  function iuQuickToolsSettingsOnOutside(e) {
    const panel = document.getElementById("iuQuickToolsSettingsPanel");
    const trigger = document.querySelector(".iu-quicktools-settings-trigger");
    if (!panel || !e.target) return;
    if (panel.contains(e.target) || (trigger && trigger.contains(e.target))) return;
    iuQuickToolsSettingsClose();
  }

  function iuQuickToolsSettingsRender(cfg) {
    const panel = document.getElementById("iuQuickToolsSettingsPanel");
    if (!panel) return;
    const visibleSet = new Set(cfg.visible);
    const frag = document.createDocumentFragment();
    const title = document.createElement("div");
    title.className = "iu-quicktools-settings-title";
    title.textContent = "Viditelnost a pořadí";
    frag.appendChild(title);
    const list = document.createElement("div");
    list.className = "iu-quicktools-settings-list";
    list.setAttribute("role", "list");
    cfg.order.forEach(function(id){
      const item = IU_QUICKTOOLS_REGISTRY.find(function(r){ return r.id === id; });
      if (!item) return;
      const row = document.createElement("div");
      row.className = "iu-quicktools-settings-row";
      row.setAttribute("data-quicktool-id", id);
      row.setAttribute("draggable", "true");
      row.setAttribute("role", "listitem");
      const handle = document.createElement("span");
      handle.className = "iu-quicktools-drag-handle";
      handle.setAttribute("data-drag-handle", "true");
      handle.setAttribute("aria-hidden", "true");
      handle.textContent = "⋮⋮";
      const marker = document.createElement("span");
      marker.className = "iu-quicktools-settings-marker";
      marker.style.backgroundColor = item.accent || "#666";
      const label = document.createElement("span");
      label.className = "iu-quicktools-settings-label";
      label.textContent = item.label;
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = visibleSet.has(id);
      toggle.setAttribute("data-iu-quicktools-visible-toggle", id);
      toggle.setAttribute("aria-label", "Zobrazit " + item.label);
      row.appendChild(handle);
      row.appendChild(marker);
      row.appendChild(label);
      row.appendChild(toggle);
      list.appendChild(row);
    });
    frag.appendChild(list);
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "iu-quicktools-settings-reset";
    resetBtn.textContent = "Obnovit výchozí";
    frag.appendChild(resetBtn);
    panel.innerHTML = "";
    panel.appendChild(frag);
  }

  function iuQuickToolsSaveAndApply(cfg) {
    saveQuickToolsConfig(cfg);
    iuQuickToolsApplyConfig();
    iuQuickToolsSettingsRender(cfg);
  }

  function iuQuickToolsInit() {
    if (window.__iuQuickToolsInitDone) return;
    window.__iuQuickToolsInitDone = 1;
    iuQuickToolsApplyConfig();
    const section = document.querySelector("aside.accordionCol .mindMenu section.iu-mmQuickLinks");
    const trigger = section ? section.querySelector(".iu-quicktools-settings-trigger") : null;
    const panel = document.getElementById("iuQuickToolsSettingsPanel");
    if (!section || !panel) return;
    let cfg = loadQuickToolsConfig();
    if (!cfg) cfg = getDefaultQuickToolsConfig();
    cfg = sanitizeQuickToolsConfig(cfg);
    iuQuickToolsSettingsRender(cfg);

    trigger.addEventListener("click", function(){
      if (panel.hidden) iuQuickToolsSettingsOpen(); else iuQuickToolsSettingsClose();
    });

    function applyQuickToolsVisibilityFromCheckbox(checkboxEl) {
      if (!checkboxEl || checkboxEl.getAttribute("data-iu-quicktools-visible-toggle") == null) return;
      if (!panel.contains(checkboxEl)) return;
      const id = checkboxEl.getAttribute("data-iu-quicktools-visible-toggle");
      let cfg = loadQuickToolsConfig();
      if (!cfg) cfg = getDefaultQuickToolsConfig();
      cfg = sanitizeQuickToolsConfig(cfg);
      const idx = cfg.visible.indexOf(id);
      if (checkboxEl.checked) { if (idx === -1) cfg.visible.push(id); }
      else { if (idx !== -1) cfg.visible.splice(idx, 1); }
      saveQuickToolsConfig(cfg);
      iuQuickToolsApplyConfig();
    }
    function onQuickToolsVisibilityChange(e) {
      const t = e.target;
      if (!t || t.getAttribute("data-iu-quicktools-visible-toggle") == null) return;
      applyQuickToolsVisibilityFromCheckbox(t);
    }
    panel.addEventListener("change", onQuickToolsVisibilityChange, true);
    panel.addEventListener("input", onQuickToolsVisibilityChange, true);
    document.addEventListener("change", onQuickToolsVisibilityChange, true);
    function onPanelCheckboxClick(e) {
      const t = e.target;
      if (t && t.type === "checkbox" && t.getAttribute("data-iu-quicktools-visible-toggle") != null && panel.contains(t)) {
        applyQuickToolsVisibilityFromCheckbox(t);
      }
    }
    panel.addEventListener("click", onPanelCheckboxClick, true);
    document.addEventListener("click", onPanelCheckboxClick, true);
    function syncQuickToolsVisibilityFromPanel() {
      if (!panel) return;
      var listEl = panel.querySelector(".iu-quicktools-settings-list");
      if (!listEl) return;
      var checkboxes = listEl.querySelectorAll("input[type=checkbox][data-iu-quicktools-visible-toggle]");
      var cfg = loadQuickToolsConfig();
      if (!cfg) cfg = getDefaultQuickToolsConfig();
      cfg = sanitizeQuickToolsConfig(cfg);
      var changed = false;
      for (var i = 0; i < checkboxes.length; i++) {
        var cb = checkboxes[i];
        var id = cb.getAttribute("data-iu-quicktools-visible-toggle");
        if (!id) continue;
        var inVisible = cfg.visible.indexOf(id) !== -1;
        if (cb.checked !== inVisible) {
          if (cb.checked) { if (cfg.visible.indexOf(id) === -1) { cfg.visible.push(id); changed = true; } }
          else { if (cfg.visible.indexOf(id) !== -1) { cfg.visible.splice(cfg.visible.indexOf(id), 1); changed = true; } }
        }
      }
      if (changed) {
        saveQuickToolsConfig(cfg);
        iuQuickToolsApplyConfig();
      }
    }
    panel._iuQuickToolsSync = syncQuickToolsVisibilityFromPanel;

    panel.addEventListener("click", function(e){
      if (e.target && e.target.classList && e.target.classList.contains("iu-quicktools-settings-reset")) {
        resetQuickToolsConfig();
        cfg = getDefaultQuickToolsConfig();
        iuQuickToolsSaveAndApply(cfg);
        iuQuickToolsSettingsClose();
      }
    });

    function persistQuickToolsOrderFromPanel() {
      var listEl = panel.querySelector(".iu-quicktools-settings-list");
      if (!listEl) return;
      var ids = Array.from(listEl.querySelectorAll("[data-quicktool-id]")).map(function(el){ return el.getAttribute("data-quicktool-id"); });
      var cfg = loadQuickToolsConfig();
      if (!cfg) cfg = getDefaultQuickToolsConfig();
      cfg = sanitizeQuickToolsConfig(cfg);
      cfg.order = ids;
      iuQuickToolsSaveAndApply(cfg);
    }

    var dragSrc = null;
    panel.addEventListener("dragstart", function(e){
      const row = e.target && e.target.closest ? e.target.closest("[data-quicktool-id]") : null;
      if (row) { dragSrc = row; e.dataTransfer.setData("text/plain", row.getAttribute("data-quicktool-id")); e.dataTransfer.effectAllowed = "move"; }
    });
    panel.addEventListener("dragover", function(e){
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      var row = e.target && e.target.closest ? e.target.closest("[data-quicktool-id]") : null;
      if (row && dragSrc && row !== dragSrc) {
        row.parentNode.insertBefore(dragSrc, row.nextSibling);
      }
    });
    panel.addEventListener("dragend", function(){
      dragSrc = null;
    });
    panel.addEventListener("drop", function(e){
      e.preventDefault();
      if (!dragSrc) return;
      persistQuickToolsOrderFromPanel();
    });

    var pointerDragRow = null;
    var pointerDragList = null;
    function onPointerMove(e) {
      if (!pointerDragRow || !pointerDragList || e.pointerId === undefined) return;
      var el = document.elementFromPoint(e.clientX, e.clientY);
      var row = el && el.closest ? el.closest("[data-quicktool-id]") : null;
      if (row && row !== pointerDragRow && pointerDragList.contains(row)) {
        pointerDragList.insertBefore(pointerDragRow, row.nextSibling);
      }
    }
    function onPointerUp(e) {
      if (pointerDragRow && e.pointerId !== undefined) {
        try { pointerDragRow.releasePointerCapture(e.pointerId); } catch (_) {}
        persistQuickToolsOrderFromPanel();
        pointerDragRow = null;
        pointerDragList = null;
      }
    }
    panel.addEventListener("pointerdown", function(e){
      var row = e.target && e.target.closest ? e.target.closest("[data-quicktool-id]") : null;
      if (!row) return;
      var listEl = row.parentNode;
      if (!listEl || !listEl.classList.contains("iu-quicktools-settings-list")) return;
      pointerDragRow = row;
      pointerDragList = listEl;
      row.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", function(e){
      if (pointerDragRow && e.pointerId !== undefined) {
        pointerDragRow = null;
        pointerDragList = null;
      }
    }, true);

    document.addEventListener("iu-quicktools-reorder-from-test", function(e){
      if (e.detail && Array.isArray(e.detail.order)) {
        var cfg = loadQuickToolsConfig();
        if (!cfg) cfg = getDefaultQuickToolsConfig();
        cfg = sanitizeQuickToolsConfig(cfg);
        cfg.order = e.detail.order;
        iuQuickToolsSaveAndApply(cfg);
      }
    });
  }

  function initRightPanel() {
    const root = document.querySelector(".mindMenu") || document.querySelector("aside.accordionCol") || null;
    if (!root) return;

    if (typeof window.iuDailyPanelInit === "function") {
      window.iuDailyPanelInit();
    }
    setTimeout(() => {
      if (typeof window.iuDailyPanelInit === "function") {
        window.iuDailyPanelInit();
      }
    }, 300);

    iuWeatherInit();
    iuMailboxesInit();
    iuQuickToolsInit();
    initAccordion();
  }

  function init() {
    if (sessionStorage.getItem("iu:firstLoadDone")) {
      debugLog("[LOAD] repeat");
    } else {
      debugLog("[LOAD] first");
      sessionStorage.setItem("iu:firstLoadDone", "1");
      firstLoadQuiet = true;
      setTimeout(() => {
        firstLoadQuiet = false;
      }, 5000);
    }
    renderDebugVisibility();
    installCLSObserver();
    renderSectionsBar();
    setSectionsFromHash();
    try{ document.body.classList.add("iuTopbarFlushRight"); }catch{}
    iuInitTopbarSearchToggle();
    iuMirrorTodayToTopbar();
    iuMobileLayoutReorder();
    setTimeout(function() { iuMobileLayoutReorder(); }, 100);
    try {
      var mq = window.matchMedia && window.matchMedia("(max-width: 900px)");
      if (mq && mq.addEventListener) mq.addEventListener("change", function() { iuMobileLayoutReorder(); });
    } catch (_) {}
    iuMobileGateTabInit();
    iuInitMobileFocusAccordion();
    iuInitFeedVideoPreviewEmbeds();

    try{ iuSilverWeatherInit(); }catch{}
    try { initRightPanel(); } catch (e) { console.error("RightPanel init failed", e); if (typeof persistLastError === "function") persistLastError("RightPanel init failed"); }

    try{ iuSilverWelcomeInit(); }catch{}
    try{ iuNamedayWishInit(); }catch{}

    if (btnToggleDebug) {
      btnToggleDebug.addEventListener("click", () => {
        setDebug(!isDebugOn());
        if (isDebugOn() && (!elDebugOut || !elDebugOut.textContent.trim())) {
          writeDebug({ note: "Debug aktivní. Pokud data nejdou načíst, uvidíš chybu zde." });
        }
      });
    }

    // Legacy search form submit handler (if present)
    if (searchFormEl && searchFormEl.id !== "iuTopbarSearchForm") {
      searchFormEl.addEventListener("submit", (event) => {
        event.preventDefault();
        applyFilter();
      });
    }

    if (modalGoogle) {
      modalGoogle.addEventListener("click", () => {
        const query = (searchInputEl && searchInputEl.value.trim()) || "";
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        window.open(url, "_blank", "noopener");
        resetSearchAndReload();
      });
    }

    const retryBtn = document.getElementById("dataRetryBtn");
    if (retryBtn) {
      retryBtn.addEventListener("click", () => {
        fetchArticlesStatus();
        fetchVideosStatus();
        loadData();
      });
    }

    const debugBtn = document.getElementById("dataDebugToggle");
    if (debugBtn) {
      debugBtn.addEventListener("click", () => {
        const current = isDebugOn();
        setDebug(!current);
        refreshDebugPanelText();
        location.reload();
      });
      refreshDebugPanelText();
    }

    const copyBtn = document.getElementById("dataCopyReportBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        copyReportToClipboard();
      });
    }
    const hardBtn = document.getElementById("dataHardRefreshBtn");
    if (hardBtn) {
      hardBtn.addEventListener("click", () => {
        ["iu:swReloaded", "iu:swReloadedAt", "iu:scrolledToStatus"].forEach((key) => sessionStorage.removeItem(key));
        softRefreshData();
      });
    }
    renderDiagBox();
    updateBuildStatusLabel();
    recordBuildSeen();
    nukeCachesAndSwOnBuildChange();

    window.addEventListener("online", updateNetworkStatus);
    window.addEventListener("offline", updateNetworkStatus);
    updateNetworkStatus();

    if (modalCancel) {
      modalCancel.addEventListener("click", () => {
        resetSearchAndReload();
      });
    }

    fetchArticlesStatus();
    fetchVideosStatus();
    // Home view must not run feed pipeline on entry (UI-only).
    // If user navigates to a feed section later, data will load via visibility/focus/refresh.
    let initialIsHome = false;
    try{
      const params = new URLSearchParams(window.location.search);
      initialIsHome = String(params.get("section") || "").trim().toLowerCase() === "home";
    }catch{}
    if (!initialIsHome) {
      loadData();
      startAutoRefresh();
    }
    watchForSWUpdates();
    updateSwStatusLabel();
    auditLog();
    fetchFeedHealth();
    updateEventsUI();
    finalStateReport();

  }

  function iuInitFeedVideoPreviewEmbeds() {
    try {
      if (window.__iu_feedVideoPreviewInit) return;
      window.__iu_feedVideoPreviewInit = 1;
    } catch {}

    function iuDebugEnabled() {
      try {
        if (typeof window.iuIsProdHost === "function" && window.iuIsProdHost()) return false;
        return Boolean(location.search && location.search.includes("debug=1"));
      } catch {
        return false;
      }
    }

    function iuGetNextVideoFromPool(currentId) {
      try {
        const cur = String(currentId || "").trim();
        const pool = Array.isArray(state?.videosRaw?.videos) ? state.videosRaw.videos : [];
        if (!pool.length) return null;

        // Avoid duplicates already present on page.
        const used = new Set();
        try {
          for (const el of Array.from(document.querySelectorAll(".iuVideoCard[data-slot], .iuVideoCard[data-feed-type=\"video-preview\"]"))) {
            const id = String(el.getAttribute("data-ytid") || "").trim();
            if (id) used.add(id);
          }
        } catch {}
        if (cur) used.add(cur);

        const cursorKey = "__iuVideoReplaceCursor";
        let idx = Number(window[cursorKey] || 0);
        if (!Number.isFinite(idx) || idx < 0) idx = 0;

        for (let i = 0; i < pool.length; i++) {
          const j = (idx + i) % pool.length;
          const it = pool[j];
          const vid = String(it?.videoId || "").trim();
          if (!vid) continue;
          if (used.has(vid)) continue;
          window[cursorKey] = j + 1;
          return it;
        }

        return null;
      } catch {
        return null;
      }
    }

    function iuReplaceVideoCardContent(card, next) {
      try {
        if (!card || !(card instanceof HTMLElement) || !next) return false;
        const slot = card.getAttribute("data-slot");
        const feedType = card.getAttribute("data-feed-type") || "video-preview";

        const markup = buildYouTubeVideoPreviewCard(next);
        if (!markup) return false;

        const t = document.createElement("template");
        t.innerHTML = String(markup).trim();
        const node = t.content.firstElementChild;
        if (!node || !(node instanceof HTMLElement)) return false;

        // Keep slot identity stable.
        if (slot) node.setAttribute("data-slot", String(slot));
        node.setAttribute("data-feed-type", String(feedType));

        // Replace in-place to keep references stable where possible.
        card.className = node.className;
        // Copy dataset/attributes we care about.
        try { card.setAttribute("data-ytid", String(node.getAttribute("data-ytid") || "")); } catch {}
        try { card.removeAttribute("data-iu-loaded"); } catch {}
        try { card.removeAttribute("data-iu-frozen"); } catch {}
        try { card.removeAttribute("data-iu-placeholder"); } catch {}

        card.innerHTML = node.innerHTML;
        return true;
      } catch {
        return false;
      }
    }

    function iuHandleVideoError(card) {
      try { console.warn("[iuVideo] replacing broken video", card?.dataset?.ytid); debugWarn("[iuVideo] replacing broken video", card?.dataset?.ytid); } catch {}
      try {
        const cur = card ? (card.getAttribute("data-ytid") || "") : "";
        const next = iuGetNextVideoFromPool(cur);
        if (!next) return;
        try { card.setAttribute("data-ytid", String(next.videoId || "")); } catch {}
        // Allow retry: mark as not loaded/frozen, restore poster card.
        try { card.removeAttribute("data-iu-loaded"); } catch {}
        try { card.removeAttribute("data-iu-frozen"); } catch {}
        iuReplaceVideoCardContent(card, next);
      } catch (e) {
        try { console.error("[iuVideo] replace failed", e); if (typeof persistLastError === "function") persistLastError("[iuVideo] replace failed"); } catch {}
      }
    }

    function iuDebugConsoleCaptureInit() {
      if (!iuDebugEnabled()) return;
      try {
        if (window.__iu_dbgConsoleCaptureInit) return;
        window.__iu_dbgConsoleCaptureInit = 1;
      } catch {}

      const MAX_ITEMS = 20;
      const MAX_MSG = 300;
      const MAX_STACK = 500;

      function trunc(s, maxLen) {
        try {
          const t = String(s == null ? "" : s);
          if (!maxLen || t.length <= maxLen) return t;
          return t.slice(0, maxLen) + "…";
        } catch {
          return "";
        }
      }

      function push(entry) {
        try {
          const arr = Array.isArray(window.__iu_dbgErrors) ? window.__iu_dbgErrors : [];
          arr.push(entry);
          while (arr.length > MAX_ITEMS) arr.shift();
          window.__iu_dbgErrors = arr;
        } catch {}
      }

      try {
        window.addEventListener("error", (ev) => {
          try {
            const err = (ev && ev.error) ? ev.error : null;
            push({
              type: "error",
              ts: new Date().toISOString(),
              message: trunc(ev && ev.message, MAX_MSG),
              filename: trunc(ev && ev.filename, 180),
              lineno: (ev && typeof ev.lineno === "number") ? ev.lineno : null,
              colno: (ev && typeof ev.colno === "number") ? ev.colno : null,
              stack: trunc(err && err.stack, MAX_STACK),
            });
          } catch {}
        });
      } catch {}

      try {
        window.addEventListener("unhandledrejection", (ev) => {
          try {
            const reason = ev ? ev.reason : null;
            push({
              type: "unhandledrejection",
              ts: new Date().toISOString(),
              message: trunc((reason && reason.message) ? reason.message : String(reason), MAX_MSG),
              stack: trunc(reason && reason.stack, MAX_STACK),
            });
          } catch {}
        });
      } catch {}

      try {
        document.addEventListener("securitypolicyviolation", (ev) => {
          try {
            push({
              type: "csp",
              ts: new Date().toISOString(),
              message: trunc(`CSP ${String(ev && (ev.effectiveDirective || ev.violatedDirective) || "")} blocked ${String(ev && ev.blockedURI || "")}`, MAX_MSG),
              violatedDirective: trunc(ev && ev.violatedDirective, 120),
              effectiveDirective: trunc(ev && ev.effectiveDirective, 120),
              blockedURI: trunc(ev && ev.blockedURI, 220),
              sourceFile: trunc(ev && ev.sourceFile, 220),
              lineNumber: (ev && typeof ev.lineNumber === "number") ? ev.lineNumber : null,
              columnNumber: (ev && typeof ev.columnNumber === "number") ? ev.columnNumber : null,
              disposition: trunc(ev && ev.disposition, 40),
            });
          } catch {}
        });
      } catch {}
    }

    function iuEnsureVideoDebugPanel() {
      if (!iuDebugEnabled()) return null;
      try {
        let box = document.getElementById("iuVideoDebugPanel");
        if (box) return box;
        box = document.createElement("div");
        box.id = "iuVideoDebugPanel";
        box.style.cssText = [
          "position:fixed",
          "right:12px",
          "bottom:12px",
          "max-width:460px",
          "min-height:120px",
          "max-height:45vh",
          "overflow:auto",
          "z-index:2147483647",
          "background:rgba(0,0,0,0.86)",
          "color:#fff",
          "border-radius:12px",
          "padding:10px 12px",
          "box-shadow:0 14px 34px rgba(0,0,0,0.35)",
          "font:12px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
        ].join(";");
        const pre = document.createElement("pre");
        pre.id = "iuVideoDebugText";
        pre.style.cssText = "margin:0;white-space:pre-wrap;word-break:break-word;";
        pre.textContent = "[iuVideoPlay] debug panel ready";
        box.appendChild(pre);
        document.body.appendChild(box);
        return box;
      } catch {
        return null;
      }
    }

    function iuVideoDebugUpdate(obj) {
      if (!iuDebugEnabled()) return;
      try {
        iuEnsureVideoDebugPanel();
        const pre = document.getElementById("iuVideoDebugText");
        if (!pre) return;
        let outObj = obj;
        try {
          // Add latest captured "red errors" to every debug payload (ring buffer).
          outObj = { ...(obj || {}), dbgErrors: (Array.isArray(window.__iu_dbgErrors) ? window.__iu_dbgErrors : []) };
        } catch {}
        let text = "";
        try { text = JSON.stringify(outObj, null, 2); } catch { text = String(outObj); }
        if (text.length > 4096) text = text.slice(0, 4096) + "…";
        pre.textContent = text;
      } catch {}
    }

    function iuVideoDebugDomSnapshot() {
      try {
        const card = document.querySelector('.iuVideoCard[data-iu-loaded="1"]') || document.querySelector(".iuVideoCard");
        const iframe = card ? card.querySelector("iframe") : null;
        const r = iframe ? iframe.getBoundingClientRect() : null;
        const activeEl = document.activeElement;
        const activeElStr = activeEl ? (
          activeEl.tagName
          + (activeEl.id ? ("#" + activeEl.id) : "")
          + (activeEl.className ? ("." + String(activeEl.className).split(/\s+/).slice(0, 3).join(".")) : "")
        ) : null;
        return {
          cardFound: !!card,
          loaded: card ? (card.getAttribute("data-iu-loaded") || null) : null,
          iframeFound: !!iframe,
          iframeSrc: iframe ? (iframe.src || null) : null,
          iframeRect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
          activeEl: activeElStr,
        };
      } catch {
        return {
          cardFound: false,
          loaded: null,
          iframeFound: false,
          iframeSrc: null,
          iframeRect: null,
          activeEl: null,
        };
      }
    }

    function iuResolveYtIdFromCard(card) {
      const isValidYtId = (x) => /^[A-Za-z0-9_-]{11}$/.test(String(x || "").trim());
      let id = (card && card.getAttribute ? String(card.getAttribute("data-ytid") || "").trim() : "");
      let inferredFromThumb = false;
      let inferredFromIframe = false;

      if (!isValidYtId(id)) {
        // Try to infer from thumb CSS var (--iuVideoThumb: url('https://i.ytimg.com/vi/<id>/...')).
        try {
          const poster = card && card.querySelector ? card.querySelector(".iuVideoPoster") : null;
          const thumbVar = poster && poster.style ? String(poster.style.getPropertyValue("--iuVideoThumb") || "") : "";
          const m = thumbVar.match(/\/vi\/([A-Za-z0-9_-]{11})\//);
          if (m && m[1] && isValidYtId(m[1])) {
            id = String(m[1]).trim();
            inferredFromThumb = true;
          }
        } catch {}
      }

      if (!isValidYtId(id)) {
        // Fallback: infer from existing iframe src (already loaded).
        try {
          const iframe = card && card.querySelector ? card.querySelector("iframe") : null;
          const src = iframe ? String(iframe.getAttribute("src") || "") : "";
          const m = src.match(/\/embed\/([A-Za-z0-9_-]{11})/);
          if (m && m[1] && isValidYtId(m[1])) {
            id = String(m[1]).trim();
            inferredFromIframe = true;
          }
        } catch {}
      }

      // Normalize: set data-ytid once we inferred it.
      try {
        if (card && isValidYtId(id)) {
          const cur = String(card.getAttribute("data-ytid") || "").trim();
          if (cur !== id) card.setAttribute("data-ytid", id);
        }
      } catch {}

      return { id: isValidYtId(id) ? id : "", inferredFromThumb, inferredFromIframe };
    }

    function iuVideoDebugSnapshot(tag) {
      try {
        const el0 = document.querySelector(".iuVideoCard");
        const s0 = el0 ? String(el0.outerHTML || "") : "";
        const el1 = document.querySelector('.iuVideoCard[data-feed-type="video-preview"]');
        const s1 = el1 ? String(el1.outerHTML || "") : "";
        const el2 = document.querySelector(".iuVideoPoster");
        const s2 = el2 ? String(el2.outerHTML || "") : "";
        return {
          tag,
          ts: new Date().toISOString(),
          cardsTotal: document.querySelectorAll(".iuVideoCard").length,
          postersTotal: document.querySelectorAll(".iuVideoPoster").length,
          videoPreviewCards: document.querySelectorAll('.iuVideoCard[data-feed-type="video-preview"]').length,
          firstVideoCardHtml: s0 ? s0.slice(0, 400) : null,
          firstPreviewCardHtml: s1 ? s1.slice(0, 400) : null,
          firstPosterHtml: s2 ? s2.slice(0, 400) : null,
        };
      } catch {
        return { tag, ts: new Date().toISOString() };
      }
    }

    function iuVideoDebugAutoTest() {
      if (!iuDebugEnabled()) return;
      try {
        if (window.__iu_videoDebugAutoTestDone) return;
        window.__iu_videoDebugAutoTestDone = 1;
      } catch {}

      function attempt(attemptNo, delayMs) {
        setTimeout(() => {
          try {
            const card = document.querySelector('.iuVideoCard[data-feed-type="video-preview"]');
            if (!card) {
              iuEnsureVideoDebugPanel();
              iuVideoDebugUpdate({
                auto: true,
                status: "NO_VIDEO_POSTER_FOUND",
                attempt: attemptNo,
                afterDelayMs: delayMs,
                ...iuVideoDebugSnapshot(`attempt${attemptNo}`),
              });
              return;
            }

            const frame = card.querySelector ? card.querySelector(".iuVideoFrame") : null;
            const resolved = iuResolveYtIdFromCard(card);
            const dbgCardYtid = card ? (card.getAttribute("data-ytid") || null) : null;
            const dbgLoaded = card ? (card.getAttribute("data-iu-loaded") || null) : null;
            const dbgIframe = frame ? frame.querySelector("iframe") : null;
            const dbgIframeSrc = dbgIframe ? (dbgIframe.getAttribute("src") || null) : null;
            iuVideoDebugUpdate({
              auto: true,
              status: "FOUND_POSTER",
              attempt: attemptNo,
              afterDelayMs: delayMs,
              ytid: dbgCardYtid,
              loaded: dbgLoaded,
              inferred: Boolean(resolved.inferredFromThumb || resolved.inferredFromIframe),
              hasFrame: !!frame,
              hasIframe: !!dbgIframe,
              iframeSrc: dbgIframeSrc,
              ...iuVideoDebugSnapshot(`found_attempt${attemptNo}`),
            });

            try { card.click(); } catch {}

            setTimeout(() => {
              try {
                const frame2 = card && card.querySelector ? card.querySelector(".iuVideoFrame") : (frame || null);
                const dbgCardYtid = card ? (card.getAttribute("data-ytid") || null) : null;
                const dbgLoaded = card ? (card.getAttribute("data-iu-loaded") || null) : null;
                const dbgIframe = frame2 ? frame2.querySelector("iframe") : null;
                const dbgIframeSrc = dbgIframe ? (dbgIframe.getAttribute("src") || null) : null;
                const cardsPreview = Array.from(document.querySelectorAll('.iuVideoCard[data-feed-type="video-preview"]'));
                const idx = card ? cardsPreview.indexOf(card) : -1;
                const cardIdentity = card ? {
                  idx,
                  tag: card.tagName,
                  cls: card.className || null,
                  slot: card.getAttribute("data-slot") || null,
                  ytidAttr: dbgCardYtid,
                  loadedAttr: dbgLoaded,
                } : null;
                const last = (iuDebugEnabled() ? window.__iu_lastVideoCard : null);
                const lastFrame = last ? last.querySelector(".iuVideoFrame") : null;
                const lastIframe = lastFrame ? lastFrame.querySelector("iframe") : null;
                const lastTruth = last ? {
                  ytid: last.getAttribute("data-ytid") || null,
                  loaded: last.getAttribute("data-iu-loaded") || null,
                  hasIframe: !!lastIframe,
                  iframeSrc: lastIframe ? (lastIframe.getAttribute("src") || null) : null,
                } : null;
                iuVideoDebugUpdate({
                  ts: new Date().toISOString(),
                  auto: true,
                  status: "AFTER_CLICK",
                  attempt: attemptNo,
                  afterDelayMs: delayMs,
                  ytid: dbgCardYtid,
                  loaded: dbgLoaded,
                  hasFrame: !!frame2,
                  hasIframe: !!dbgIframe,
                  iframeSrc: dbgIframeSrc,
                  domSnapshot: iuVideoDebugDomSnapshot(),
                  cardsPreviewCount: cardsPreview.length,
                  cardIdentity,
                  truthFromCard: { ytid: dbgCardYtid, loaded: dbgLoaded, hasIframe: !!dbgIframe, iframeSrc: dbgIframeSrc },
                  truthFromLastCard: lastTruth,
                  fallback: false,
                  error: null,
                });
              } catch {}
            }, 300);
          } catch {}
        }, delayMs);
      }

      attempt(1, 600);
      attempt(2, 800);
      attempt(3, 2000);
    }

    // Init console/CSP capture as early as possible (debug-only).
    try { iuDebugConsoleCaptureInit(); } catch {}

    document.addEventListener("click", (e) => {
      const t = e && e.target;
      const card = t && t.closest ? t.closest(".iuVideoCard") : null;
      if (!card) return;

      // Only handle our YouTube preview cards (fixed slots).
      const resolved = iuResolveYtIdFromCard(card);
      const id2 = (resolved && resolved.id) ? String(resolved.id).trim() : "";
      if (id2) {
        try { card.setAttribute("data-ytid", id2); } catch {}
      }
      if (!id2) {
        const dbgCardYtid = card ? (card.getAttribute("data-ytid") || null) : null;
        const dbgLoaded = card ? (card.getAttribute("data-iu-loaded") || null) : null;
        const dbgIframe = null;
        const dbgIframeSrc = null;
        iuVideoDebugUpdate({
          ts: new Date().toISOString(),
          ytid: dbgCardYtid,
          inferred: false,
          loaded: dbgLoaded,
          hasFrame: false,
          hasIframe: !!dbgIframe,
          iframeSrc: dbgIframeSrc,
          fallback: false,
          error: "missing ytid",
        });
        if (iuDebugEnabled()) { try { console.warn("[iuVideoPlay] missing ytid, cannot embed"); debugWarn("[iuVideoPlay] missing ytid, cannot embed"); } catch {} }
        return;
      }
      if (card.getAttribute("data-iu-loaded") === "1") return;

      // Guard: don't hijack "open in new tab" or non-primary clicks.
      // (Ctrl/Meta/Shift/Alt-click, or middle-click should behave as navigation, not inline embed.)
      try {
        if (e && (e.button === 1 || e.button === 2 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
      } catch {}

      // Always resolve frame from the card (click target can be poster/frame/iframe/overlay).
      const frame = card.querySelector ? card.querySelector(".iuVideoFrame") : null;
      if (!frame) return;

      // If the click is on a real link inside the card, do not override it.
      // (Keeps safe fallback behavior if a link is introduced later.)
      const a = t && t.closest ? t.closest('a[href]') : null;
      if (a && card.contains(a)) return;

      const dbgCardYtid = card ? (card.getAttribute("data-ytid") || null) : null;
      const dbgLoaded = card ? (card.getAttribute("data-iu-loaded") || null) : null;
      const dbgIframe = frame ? frame.querySelector("iframe") : null;
      const dbgIframeSrc = dbgIframe ? (dbgIframe.getAttribute("src") || null) : null;
      iuVideoDebugUpdate({
        ts: new Date().toISOString(),
        ytid: dbgCardYtid,
        inferred: Boolean(resolved.inferredFromThumb || resolved.inferredFromIframe),
        loaded: dbgLoaded,
        hasFrame: !!frame,
        hasIframe: !!dbgIframe,
        iframeSrc: dbgIframeSrc,
        domSnapshot: iuVideoDebugDomSnapshot(),
        fallback: false,
        error: null,
      });

      try { e.preventDefault(); } catch {}

      const watchUrl = `https://www.youtube.com/watch?v=${id2}`;
      const src = iuBuildYouTubeEmbedUrl(id2);
      if (!src) {
        const dbgCardYtid = card ? (card.getAttribute("data-ytid") || null) : null;
        const dbgLoaded = card ? (card.getAttribute("data-iu-loaded") || null) : null;
        const dbgIframe = frame ? frame.querySelector("iframe") : null;
        const dbgIframeSrc = dbgIframe ? (dbgIframe.getAttribute("src") || null) : null;
        iuVideoDebugUpdate({
          ts: new Date().toISOString(),
          ytid: dbgCardYtid,
          inferred: Boolean(resolved.inferredFromThumb || resolved.inferredFromIframe),
          loaded: dbgLoaded,
          hasFrame: !!frame,
          hasIframe: !!dbgIframe,
          iframeSrc: dbgIframeSrc,
          fallback: true,
          error: "missing embed src",
        });
        try{
          const opts = { noExternalOpen: false };
          try{
            opts.noExternalOpen = String(card && card.getAttribute ? (card.getAttribute("data-iu-no-external-open") || "") : "") === "1";
          }catch{}
          if (opts && opts.noExternalOpen){
            try{ console.warn("Weather History embed blocked external open"); debugWarn("Weather History embed blocked external open"); }catch{}
            return;
          }
          window.open(watchUrl, "_blank", "noopener");
        }catch{}
        return;
      }

      try {
        // Anti-double-click: mark as loaded BEFORE constructing/replacing iframe.
        // If inline embed throws, we still fall back to opening YouTube.
        card.setAttribute("data-iu-loaded", "1");
        try { iuMarkVideoCardFrozen(card); } catch {}
        // HARD UX FIX: remove poster/overlay from DOM so it can never block iframe clicks.
        try {
          const poster = card.querySelector(".iuVideoPoster");
          if (poster) poster.remove();
        } catch {}
        try {
          const overlay = card.querySelector(".iuVideoOverlay");
          if (overlay) overlay.remove();
        } catch {}
        if (iuDebugEnabled()) {
          try { window.__iu_lastVideoCard = card; } catch {}
        }

        const iframe = document.createElement("iframe");

        iframe.src = src;
        iframe.className = "iuVideoIframe";
        iframe.loading = "lazy";
        iframe.referrerPolicy = "strict-origin-when-cross-origin";

        iframe.allow =
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
        iframe.allowFullscreen = true;
        iframe.setAttribute("playsinline", "1");

        // ⚠️ důležité – žádný sandbox
        iframe.removeAttribute("sandbox");

        try {
          iframe.onerror = () => iuHandleVideoError(card);
        } catch {}

        try {
          iframe.addEventListener("load", () => {
            try {
              iuVideoDebugUpdate({
                ts: new Date().toISOString(),
                status: "IFRAME_LOAD",
                iframeSrc: iframe ? (iframe.getAttribute("src") || null) : null,
                domSnapshot: iuVideoDebugDomSnapshot(),
              });
            } catch {}
            try {
              card.setAttribute("data-iu-loaded", "1");
              card.setAttribute("data-iu-frozen", "1");
            } catch {}
          });
        } catch {}
        try {
          iframe.addEventListener("error", () => {
            try {
              iuVideoDebugUpdate({
                ts: new Date().toISOString(),
                status: "IFRAME_ERROR",
                iframeSrc: iframe ? (iframe.getAttribute("src") || null) : null,
                domSnapshot: iuVideoDebugDomSnapshot(),
              });
            } catch {}
            try { iuHandleVideoError(card); } catch {}
          });
        } catch {}

        try { frame.style.pointerEvents = "auto"; } catch {}
        try { iframe.style.pointerEvents = "auto"; } catch {}
        frame.replaceChildren(iframe);
        const dbgCardYtid = card ? (card.getAttribute("data-ytid") || null) : null;
        const dbgLoaded = card ? (card.getAttribute("data-iu-loaded") || null) : null;
        const dbgIframe = frame ? frame.querySelector("iframe") : null;
        const dbgIframeSrc = dbgIframe ? (dbgIframe.getAttribute("src") || null) : null;
        const cardsPreview = Array.from(document.querySelectorAll('.iuVideoCard[data-feed-type="video-preview"]'));
        const idx = card ? cardsPreview.indexOf(card) : -1;
        const cardIdentity = card ? {
          idx,
          tag: card.tagName,
          cls: card.className || null,
          slot: card.getAttribute("data-slot") || null,
          ytidAttr: dbgCardYtid,
          loadedAttr: dbgLoaded,
        } : null;
        const last = (iuDebugEnabled() ? window.__iu_lastVideoCard : null);
        const lastFrame = last ? last.querySelector(".iuVideoFrame") : null;
        const lastIframe = lastFrame ? lastFrame.querySelector("iframe") : null;
        const lastTruth = last ? {
          ytid: last.getAttribute("data-ytid") || null,
          loaded: last.getAttribute("data-iu-loaded") || null,
          hasIframe: !!lastIframe,
          iframeSrc: lastIframe ? (lastIframe.getAttribute("src") || null) : null,
        } : null;
        iuVideoDebugUpdate({
          ts: new Date().toISOString(),
          status: "AFTER_CLICK",
          ytid: dbgCardYtid,
          inferred: Boolean(resolved.inferredFromThumb || resolved.inferredFromIframe),
          loaded: dbgLoaded,
          hasFrame: !!frame,
          hasIframe: !!dbgIframe,
          iframeSrc: dbgIframeSrc,
          domSnapshot: iuVideoDebugDomSnapshot(),
          cardsPreviewCount: cardsPreview.length,
          cardIdentity,
          truthFromCard: { ytid: dbgCardYtid, loaded: dbgLoaded, hasIframe: !!dbgIframe, iframeSrc: dbgIframeSrc },
          truthFromLastCard: lastTruth,
          fallback: false,
          error: null,
        });
      } catch (err) {
        // Safe fallback: if inline embed fails for any reason, open YouTube in a new tab.
        try { console.warn("[iuVideoPlay] inline embed failed, falling back to watch URL", err); debugWarn("[iuVideoPlay] inline embed failed", err); } catch {}
        const dbgCardYtid = card ? (card.getAttribute("data-ytid") || null) : null;
        const dbgLoaded = card ? (card.getAttribute("data-iu-loaded") || null) : null;
        const dbgIframe = frame ? frame.querySelector("iframe") : null;
        const dbgIframeSrc = dbgIframe ? (dbgIframe.getAttribute("src") || null) : null;
        iuVideoDebugUpdate({
          ts: new Date().toISOString(),
          ytid: dbgCardYtid,
          inferred: Boolean(resolved.inferredFromThumb || resolved.inferredFromIframe),
          loaded: dbgLoaded,
          hasFrame: !!frame,
          hasIframe: !!dbgIframe,
          iframeSrc: dbgIframeSrc,
          fallback: true,
          error: String(err && (err.message || err)),
        });
        try{
          const opts = { noExternalOpen: false };
          try{
            opts.noExternalOpen = String(card && card.getAttribute ? (card.getAttribute("data-iu-no-external-open") || "") : "") === "1";
          }catch{}
          if (opts && opts.noExternalOpen){
            try{ console.warn("Weather History embed blocked external open"); debugWarn("Weather History embed blocked external open"); }catch{}
            return;
          }
          window.open(watchUrl, "_blank", "noopener");
        }catch{}
      }
    }, { passive: false });

    try { iuVideoDebugAutoTest(); } catch {}
  }

  document.addEventListener("visibilitychange", () => {
    debugLog("[VIS]", document.visibilityState);
    if (document.visibilityState === "visible") {
      if (!(document.body && document.body.classList && document.body.classList.contains("iu-home"))) {
        loadData();
        startAutoRefresh();
      }
    } else if (iuRefreshTimer) {
      clearInterval(iuRefreshTimer);
      iuRefreshTimer = null;
    }
  });

  window.addEventListener("focus", () => debugLog("[FOCUS] in"));
  window.addEventListener("blur", () => debugLog("[FOCUS] out"));

  window.addEventListener("hashchange", () => {
    freezeScroll();
    setSectionsFromHash();
    applyFilter();
    restoreScroll();
  });

  init();
})();


// CHECKPOINT: FEED STABLE
// Stav ověřen: invarianty splněny, render pipeline uzamčena,
// fail-soft aktivní, emergency visibility aktivní.
// Jakákoli změna výše musí projít kontrolou invariant.
// === NO-GO ZONE END ===
// Jakýkoli zásah pod tímto bodem je porušením technického standardu infoUzel.cz
// === MAINTENANCE MODE ACTIVE ===
// Jakákoli změna nad tímto bodem vyžaduje nový checkpoint

// === POPOVER PRO SLEDOVÁNÍ ZÁSILEK (IZOLOVANÁ FUNKCIONALITA) ===
(function(){
  'use strict';
  
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  
  const parcelsBtn = document.getElementById('iuParcelsBtn');
  const parcelsBtnMobile = document.getElementById('iuParcelsBtnMobile');
  const modal = document.getElementById('iuParcelsPopover');
  const overlay = document.querySelector('.iu-parcels-overlay');
  
  const carriers = {
    packeta: {
      name: 'Zásilkovna',
      baseUrl: 'https://tracking.app.packeta.com/cs/',
      deepUrl: (code) => `https://tracking.app.packeta.com/cs/${encodeURIComponent(code)}`,
      urlFallback: (code) => `https://tracking.packeta.com/cs/${encodeURIComponent(code)}`
    },
    balikovna: {
      name: 'Balíkovna / Česká pošta',
      baseUrl: 'https://www.balikovna.cz/cs/sledovat-balik',
      deepUrl: (code) => `https://www.balikovna.cz/cs/sledovat-balik/-/balik/${encodeURIComponent(code)}`
    },
    ppl: {
      name: 'PPL',
      baseUrl: 'https://www.ppl.cz/vyhledat-zasilku',
      useClipboard: true
    },
    dpd: {
      name: 'DPD',
      baseUrl: 'https://tracking.dpd.de/status/cs_CZ/',
      deepUrl: (code) => `https://tracking.dpd.de/status/cs_CZ/parcel/${encodeURIComponent(code)}`,
      useClipboard: true
    },
    gls: {
      name: 'GLS',
      baseUrl: 'https://gls-group.com/CZ/cs/sledovani-zasilek',
      useClipboard: true
    },
    wedo: {
      name: 'WE|DO',
      baseUrl: 'https://trace.wedo.cz/',
      deepUrl: (code) => `https://trace.wedo.cz/?orderNumber=${encodeURIComponent(code)}`,
      urlFallback: () => 'https://trace.wedo.cz/'
    },
    dhl: {
      name: 'DHL',
      baseUrl: 'https://www.dhl.com/cz-en/home/tracking.html',
      useClipboard: true
    },
    messenger: {
      name: 'Messenger',
      baseUrl: 'https://www.msng.cz/',
      useClipboard: true
    }
  };
  
  function iuParcelsOpenSurface(){
    if(!modal || !overlay) return;
    try { iuCloseAllOverlaysExcept("parcels"); } catch (_) {}
    overlay.classList.add('is-open');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    try {
      const isMobile = !!(window.matchMedia && window.matchMedia("(max-width: 1023px)").matches);
      if (isMobile) {
        const header = modal.querySelector(".iu-parcels-modal-header");
        const title = modal.querySelector(".iu-parcels-modal-title");
        const close = modal.querySelector(".iu-parcels-modal-close");
        const body = modal.querySelector(".iu-parcels-modal-content");
        modal.style.setProperty("inset", "10px");
        modal.style.setProperty("max-height", "calc(100dvh - 20px)");
        if (header) {
          header.style.setProperty("display", "flex");
          header.style.setProperty("align-items", "flex-start");
          header.style.setProperty("gap", "8px");
          header.style.setProperty("padding", "12px");
        }
        if (title) {
          title.style.setProperty("flex", "1 1 auto");
          title.style.setProperty("min-width", "0");
          title.style.setProperty("line-height", "1.3");
        }
        if (close) {
          close.style.setProperty("align-self", "flex-start");
          close.style.setProperty("margin", "0");
        }
        if (body) body.style.setProperty("padding", "14px 12px 16px");
      }
    } catch (_) {}
  }

  function openParcels(){
    if (typeof window.iuOpenOverlay === "function") {
      window.iuOpenOverlay("parcels");
    } else {
      iuParcelsOpenSurface();
    }
  }
  try { window.iuParcelsOpenSurface = iuParcelsOpenSurface; } catch (_) {}
  try { window.iuOpenParcelsModal = openParcels; } catch (_) {}
  
  function closeParcels(){
    if(!modal || !overlay) return;
    overlay.classList.remove('is-open');
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }
  try { window.iuCloseParcelsModal = closeParcels; } catch (_) {}
  
  function addParcelRow(carrierId){
    const rowsContainer = $(`.iu-parcelRows[data-carrier="${carrierId}"]`);
    if(!rowsContainer) return;
    
    const row = document.createElement('div');
    row.className = 'iu-parcel-row';
    row.innerHTML = `
      <div class="iu-parcel-row-inputs">
        <input type="text" class="iu-parcel-input" placeholder="Číslo zásilky" data-carrier="${carrierId}">
        <button class="iu-parcel-search-btn" type="button">Vyhledat</button>
      </div>
    `;
    
    const searchBtn = row.querySelector('.iu-parcel-search-btn');
    searchBtn.addEventListener('click', () => handleSearch(carrierId, row.querySelector('.iu-parcel-input')));
    
    rowsContainer.appendChild(row);
  }
  
  function openCarrierUrl(url){
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  
  function getFirstFilledCode(carrierId){
    const inputs = $$(`.iu-parcel-input[data-carrier="${carrierId}"]`);
    for(const input of inputs){
      const code = (input.value || '').trim();
      if(code) return code;
    }
    return null;
  }
  
  function handleSearch(carrierId, input){
    const code = (input.value || '').trim();
    const carrier = carriers[carrierId];
    if(!carrier || !carrier.baseUrl) return;
    
    let urlToOpen = carrier.baseUrl;
    
    if(code && carrier.deepUrl){
      urlToOpen = carrier.deepUrl(code);
    }
    
    openCarrierUrl(urlToOpen);
  }
  
  function handleFallback(carrierId){
    const code = getFirstFilledCode(carrierId);
    if(!code) return;
    
    const carrier = carriers[carrierId];
    if(!carrier || !carrier.urlFallback) return;
    
    const fallbackUrl = carrier.urlFallback(code);
    openCarrierUrl(fallbackUrl);
  }
  
  function initParcelsModal(){
    if(!modal || !overlay) return;
    
    if(parcelsBtn){
      parcelsBtn.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('[data-iuq]')) return;
        e.preventDefault();
        e.stopPropagation();
        openParcels();
      });
    }
    if(parcelsBtnMobile){
      parcelsBtnMobile.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('[data-iuq]')) return;
        e.preventDefault();
        e.stopPropagation();
        openParcels();
      });
    }

    overlay.addEventListener('click', closeParcels);

    const closeBtn = modal.querySelector('.iu-parcels-modal-close');
    if(closeBtn) closeBtn.addEventListener('click', closeParcels);

    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape') closeParcels();
    });
    
    $$('.iu-parcel-add-btn').forEach(btn => {
      const carrierId = btn.getAttribute('data-carrier');
      btn.addEventListener('click', () => addParcelRow(carrierId));
    });
    
    $$('.iu-parcel-search-btn').forEach(btn => {
      const row = btn.closest('.iu-parcel-row');
      const input = row?.querySelector('.iu-parcel-input');
      const carrierId = input?.getAttribute('data-carrier');
      if(carrierId){
        btn.addEventListener('click', () => handleSearch(carrierId, input));
      }
    });
    
    $$('.iu-parcel-fallback-btn').forEach(btn => {
      const carrierId = btn.getAttribute('data-carrier');
      if(carrierId){
        btn.addEventListener('click', () => handleFallback(carrierId));
      }
    });
  }
  
  initParcelsModal();
})();

// === Center Quick Feed (Rychlé odkazy → detail view in middle) ===
(function(){
  function iuQfEscape(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  window.IU_QUICK_FEEDS = {
    ai: {
      title: "AI asistenti",
      items: [
        { name: "ChatGPT", url: "https://chat.openai.com", desc: "Univerzální AI na psaní, nápady, obrázky i práci s daty", external: true, color: "#10A37F", video: "JTxsNm9IdYU" },
        { name: "Google Gemini", url: "https://gemini.google.com", desc: "AI propojená s Googlem, mapami, vyhledáváním a Gmailem", external: true, color: "#4285F4", video: "r4sQqfvTv_g" },
        { name: "Microsoft Copilot", url: "https://copilot.microsoft.com", desc: "AI pro práci ve Windows, Office a psaní e-mailů", external: true, color: "#7B61FF", video: "mO1f7b0f8C0" },
        { name: "Claude", url: "https://claude.ai", desc: "Přirozené a přesné psaní, analýza dokumentů a práce s dlouhými texty", external: true, color: "#D97706", video: "X1FOhLxFQqo" },
        { name: "Perplexity AI", url: "https://www.perplexity.ai", desc: "Odpovídá jako vyhledávač a uvádí zdroje informací", external: true, color: "#0EA5E9", video: "bL_0vD2i4-o" },
        { name: "DeepSeek", url: "https://chat.deepseek.com", desc: "Silná AI na programování, logiku a matematiku", external: true, color: "#6366F1", video: "i9kTrcf-gDQ" },
        { name: "Grok", url: "https://x.ai", desc: "AI zaměřená na aktuální dění a trendy na síti X", external: true, color: "#111827", video: "Hy46FSmgkmg" },
        { name: "Mistral AI", url: "https://chat.mistral.ai", desc: "Evropská AI s důrazem na soukromí a efektivitu", external: true, color: "#F97316", video: "tcBYaZqdc4A" },
        { name: "Editee", url: "https://www.editee.com", desc: "Česká AI pro marketing, podnikání a obsah", external: true, color: "#EC4899" }
      ]
    },
    deepl: {
      title: "Překladač",
      items: [
        { id: "deepl", name: "DeepL", baseUrl: "https://www.deepl.com/translator", desc: "Nejvyšší kvalita překladů", supportsPrefill: true, makeUrl: (t,sl,tl) => `https://www.deepl.com/translator#${sl}/${tl}/${encodeURIComponent(t)}` },
        { id: "google", name: "Google Translate", baseUrl: "https://translate.google.com/", desc: "Univerzální rychlý překladač", supportsPrefill: true, makeUrl: (t,sl,tl) => `https://translate.google.com/?sl=${sl}&tl=${tl}&text=${encodeURIComponent(t)}` },
        { id: "microsoft", name: "Microsoft Translator", baseUrl: "https://www.bing.com/translator", desc: "Microsoft / Bing překladač", supportsPrefill: true, makeUrl: (t,sl,tl) => `https://www.bing.com/translator?from=${sl}&to=${tl}&text=${encodeURIComponent(t)}` },
        { id: "seznam", name: "Seznam Slovník", baseUrl: "https://slovnik.seznam.cz/", desc: "Český slovník a překlady", supportsPrefill: false },
        { id: "linguee", name: "Linguee", baseUrl: "https://www.linguee.com/", desc: "Překlady s kontextem vět", supportsPrefill: false }
      ]
    },
    baliky: {
      title: "Balíky",
      items: [
        { name: "Zásilkovna", url: "https://tracking.app.packeta.com/cs/", desc: "Sledování zásilek Zásilkovna", external: true },
        { name: "Balíkovna / Česká pošta", url: "https://www.balikovna.cz/cs/sledovat-balik", desc: "Sledování balíků České pošty", external: true },
        { name: "PPL", url: "https://www.ppl.cz/vyhledat-zasilku", desc: "Sledování zásilek PPL", external: true },
        { name: "DPD", url: "https://tracking.dpd.de/status/cs_CZ/", desc: "Sledování zásilek DPD", external: true },
        { name: "GLS", url: "https://gls-group.com/CZ/cs/sledovani-zasilek", desc: "Sledování zásilek GLS", external: true },
        { name: "DHL", url: "https://www.dhl.com/cz-en/home/tracking.html", desc: "Sledování zásilek DHL", external: true },
        { name: "Messenger", url: "https://www.msng.cz/", desc: "Sledování zásilek Messenger", external: true }
      ]
    },
    google: { title: "Google", items: [{ name: "Google", url: "https://www.google.com", desc: "Vyhledávač Google", external: true }] },
    seznam: { title: "Seznam", items: [{ name: "Seznam.cz", url: "https://www.seznam.cz/", desc: "Vyhledávač a portál Seznam", external: true }] },
    youtube: { title: "YouTube", items: [{ name: "YouTube", url: "https://www.youtube.com/", desc: "Videa a streamy", external: true }] },
    naceneni: {
      title: "Nákup potravin online",
      items: [
        { name: "Rohlík.cz", url: "https://www.rohlik.cz", desc: "Online nákup potravin s dovozem", external: true },
        { name: "Košík.cz", url: "https://www.kosik.cz", desc: "Online nákup potravin", external: true },
        { name: "Tesco Online", url: "https://nakup.itesco.cz", desc: "Online nákup Tesco", external: true },
        { name: "Albert Online", url: "https://www.albert.cz", desc: "Online nákup Albert", external: true },
        { name: "Wolt Market", url: "https://market.wolt.com/cs/cze", desc: "Rychlé donášky jídla a zboží", external: true }
      ],
      toolsHtml: '<div class="iuQCard iu-nakup-online-card"><p class="iu-nakup-online-desc">Rychlé odkazy na online nákup potravin.</p><ul class="iu-nakup-online-links" aria-label="Odkazy na obchody"><li><a href="https://www.rohlik.cz/" target="_blank" rel="noopener noreferrer">Rohlík.cz</a></li><li><a href="https://www.kosik.cz/" target="_blank" rel="noopener noreferrer">Košík.cz</a></li><li><a href="https://nakup.itesco.cz/" target="_blank" rel="noopener noreferrer">Tesco Online</a></li><li><a href="https://www.albert.cz/" target="_blank" rel="noopener noreferrer">Albert Online</a></li><li><a href="https://market.wolt.com/cs/cze" target="_blank" rel="noopener noreferrer">Wolt Market</a></li></ul></div>'
    },
    convert: {
      title: "Převod na Word, PDF",
      toolsHtml: '<div class="iuQCard" data-iu="pdfconvert-tools">' +
        '<div class="iu-pdfConvertInfo" role="status"><p>Převod probíhá pouze ve vašem prohlížeči.</p><p>Soubor ani text nikam neodesíláme.</p><p>Po zavření okna se nic neukládá.</p></div>' +
        '<div class="iuPdfTabsRow"><div class="iu-pdfConvertTabs" role="tablist">' +
        '<button type="button" role="tab" data-iu="tab-word" aria-selected="false" aria-controls="iu-pdf-tab-word-panel">Word → PDF</button>' +
        '<button type="button" role="tab" data-iu="tab-text" aria-selected="true" aria-controls="iu-pdf-tab-text-panel">Text → PDF</button></div></div>' +
        '<div id="iu-pdf-tab-word-panel" role="tabpanel" data-iu="tab-word-panel" hidden>' +
        '<p class="iu-pdfConvertNote">Kvalita převodu závisí na složitosti dokumentu. Složitý Word může být převeden jako čistý text.</p>' +
        '<div class="iuPdfActionRow" data-iu="pdf-action-row">' +
        '<input type="file" id="iuWordFileInput" accept=".docx" data-iu="pdf-docx-input" hidden />' +
        '<button type="button" id="iuWordFileBtn" class="iu-pdfFileBtn">Vybrat soubor (.docx)</button>' +
        '<button type="button" data-iu="pdf-download-convert" disabled>Převést a stáhnout PDF</button>' +
        '<button type="button" class="iu-pdfShareConvertBtn" data-iu="pdf-share-convert" disabled>Převést a přeposlat PDF</button>' +
        '</div>' +
        '<div class="iuPdfFileStatusRow" data-iu="pdf-file-status">' +
        '<span id="iuWordFileLabel" class="iu-file-label">Žádný soubor nebyl vybrán</span>' +
        '<span class="iu-pdfShareUnsupported" id="iuPdfShareUnsupported" aria-hidden="true">Sdílení není podporováno</span></div>' +
        '<div class="iu-pdfResultActions" data-iu="pdf-word-result-actions" hidden></div></div>' +
        '<div id="iu-pdf-tab-text-panel" role="tabpanel" data-iu="tab-text-panel">' +
        '<div class="iu-pdfTextDropzone" data-iu="pdf-text-dropzone" role="group" aria-label="Text pro PDF">' +
        '<textarea data-iu="pdf-text-input" rows="6" placeholder="Vložte text…" aria-label="Text pro převod do PDF"></textarea>' +
        '<p class="iu-pdfDropHint">Přetáhněte sem .docx nebo .txt</p></div>' +
        '<button type="button" data-iu="pdf-text-generate">Vygenerovat PDF</button>' +
        '<div class="iu-pdfResultActions" data-iu="pdf-text-result-actions" hidden></div></div>' +
        '<div data-iu="pdf-word-html" class="iu-pdf-word-html-wrapper" aria-hidden="true"></div></div>',
      items: [
        { name: "PDF → Word", url: "https://www.ilovepdf.com/pdf_to_word", external: true },
        { name: "Word → PDF", url: "https://www.ilovepdf.com/word_to_pdf", external: true },
        { name: "PDF → JPG", url: "https://www.ilovepdf.com/pdf_to_jpg", external: true },
        { name: "JPG → PDF", url: "https://smallpdf.com/jpg-to-pdf", external: true },
        { name: "Sloučit PDF", url: "https://pdf24.org/en/merge-pdf", external: true },
        { name: "Komprese PDF", url: "https://pdf24.org/en/compress-pdf", external: true }
      ]
    },
    nakup: {
      title: "Evidence nákupů",
      items: [
        { name: "Rohlík.cz", url: "https://www.rohlik.cz", desc: "Online nákup potravin s dovozem", external: true },
        { name: "Košík.cz", url: "https://www.kosik.cz", desc: "Online nákup potravin", external: true },
        { name: "Tesco Online", url: "https://nakup.itesco.cz", desc: "Online nákup Tesco", external: true },
        { name: "Albert Online", url: "https://www.albert.cz", desc: "Online nákup Albert", external: true },
        { name: "Wolt Market", url: "https://wolt.com", desc: "Rychlé donášky jídla a zboží", external: true }
      ]
    }
  };

  const IU_TR_LANG_NAMES = { eng:"Angličtina (EN)", ces:"Čeština (CS)", deu:"Němčina (DE)", fra:"Francouzština (FR)", spa:"Španělština (ES)", ita:"Italština (IT)", pol:"Polština (PL)", slk:"Slovenština (SK)", ukr:"Ukrajinština (UK)", rus:"Ruština (RU)", por:"Portugalština (PT)", nld:"Nizozemština (NL)", swe:"Švédština (SV)", und:"Neznámý" };
  const IU_TR_ISO_TO_URL = { ces:"cs", eng:"en", deu:"de", fra:"fr", spa:"es", ita:"it", pol:"pl", slk:"sk", ukr:"uk", rus:"ru" };

  function iuTrLangName(code){ return IU_TR_LANG_NAMES[code] || (code ? "(" + code + ")" : "—"); }
  function iuTrIsoToUrl(iso){ return IU_TR_ISO_TO_URL[iso] || iso.slice(0,2); }

  /* AI QuickFeed — unique brand colors (must not appear elsewhere on site) */
  const IU_AI_FEED_COLORS = {
    "ChatGPT": "#057A6B",
    "Google Gemini": "#0B6B9A",
    "Microsoft Copilot": "#6B4EBB",
    "Claude": "#C45A2A",
    "Perplexity AI": "#0D7A8C",
    "DeepSeek": "#5B21B6",
    "Grok": "#155E75",
    "Mistral AI": "#047857",
    "Editee": "#B45309"
  };
  const CHATGPT_AI_COLOR = IU_AI_FEED_COLORS["ChatGPT"] || "#10A37F";

  function iuNormalizeYouTubeId(v){
    const s = (v || "").trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
    const m1 = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (m1) return m1[1];
    const m2 = s.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (m2) return m2[1];
    const m3 = s.match(/shorts\/([a-zA-Z0-9_-]{11})/);
    if (m3) return m3[1];
    return "";
  }

  /* AI asistenti – 1 YouTube embed per assistant (static list, embeddable) */
  /* 1 video per AI; IDs verified embeddable (oembed/fetch). Swap if "Video unavailable" on production. */
  const IU_AI_VIDEOS = [
    { name: "ChatGPT", videoId: "JTxsNm9IdYU" },
    { name: "Google Gemini", videoId: "_TVnM9dmUSk" },
    { name: "Microsoft Copilot", videoId: "NbpVLqtML2M" },
    { name: "Editee", videoId: "ubPDwEokp3o" },
    { name: "Claude", videoId: "oqUclC3gqKs" },
    { name: "Perplexity AI", videoId: "_vMOWw3uYvk" },
    { name: "DeepSeek", videoId: "i9kTrcf-gDQ" },
    { name: "Grok", videoId: "Hy46FSmgkmg" },
    { name: "Mistral AI", videoId: "tcBYaZqdc4A" }
  ];

  /* MAX 1 YouTube embed per AI – render from IU_AI_VIDEOS only, dedupe by name */
  function renderAiVideos(root){
    const el = root && root.querySelector ? root.querySelector(".iuAiVideoGrid") : null;
    const section = root && root.querySelector ? root.querySelector(".iuAiVideos") : null;
    if (!el || !section) return;
    const seen = new Set();
    const items = IU_AI_VIDEOS.filter(it => {
      if (!it.videoId || seen.has(it.name)) return false;
      seen.add(it.name);
      return true;
    });
    if (items.length === 0) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    el.innerHTML = items.map(it => {
      const id = it.videoId;
      const title = it.name + " – krátké představení";
      return `<div class="iuAiVideoItem">
  <div class="iuAiVideoTitle">${iuQfEscape(title)}</div>
  <div class="iuYtWrap">
  <iframe
    src="https://www.youtube.com/embed/${iuQfEscape(id)}?rel=0&modestbranding=1"
    title="${iuQfEscape(title)}"
    loading="lazy"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen></iframe>
  </div>
</div>`;
    }).join("");
  }

  document.addEventListener("click", e => {
    const modal = document.getElementById("iuVideoModal");
    const frame = document.getElementById("iuVideoFrame");
    if (!modal || modal.hidden) return;
    if (e.target.classList && e.target.classList.contains("iuVideoModalClose")) {
      modal.hidden = true;
      if (frame) frame.src = "";
      return;
    }
    if (e.target === modal) {
      modal.hidden = true;
      if (frame) frame.src = "";
    }
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const modal = document.getElementById("iuVideoModal");
    const frame = document.getElementById("iuVideoFrame");
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    if (frame) frame.src = "";
    e.preventDefault();
  });

  var IU_SHOPPING_LAST_LIST_KEY = "iuShoppingLastListV1";
  var IU_SHOPPING_DELIVERY_ADDRESS_KEY = "iuShoppingDeliveryAddressV1";

  /** Normalize address: trim, PSČ 5 digits, unified shape. Returns { street, city, postalCode, country } or null if invalid. */
  function iuNakupNormalizeAddress(addr) {
    if (!addr || typeof addr !== "object") return null;
    var ulice = (addr.ulice != null ? addr.ulice : addr.street);
    var mesto = (addr.mesto != null ? addr.mesto : addr.city);
    var psc = (addr.psc != null ? addr.psc : addr.postalCode);
    var street = typeof ulice === "string" ? ulice.trim() : "";
    var city = typeof mesto === "string" ? mesto.trim() : "";
    var postalCode = typeof psc === "string" ? psc.replace(/\s/g, "").trim() : "";
    if (postalCode.length !== 5 || !/^\d{5}$/.test(postalCode)) return null;
    if (street.length < 2 || city.length < 2) return null;
    return { street: street, city: city, postalCode: postalCode, country: addr.country || "CZ" };
  }

  /** Read saved address from localStorage; defensively normalize; return null if invalid. */
  function iuNakupReadSavedAddress() {
    try {
      var raw = localStorage.getItem(IU_SHOPPING_DELIVERY_ADDRESS_KEY);
      if (!raw || typeof raw !== "string") return null;
      var o = JSON.parse(raw);
      if (!o || (typeof o.ulice !== "string" && typeof o.street !== "string")) return null;
      return iuNakupNormalizeAddress(o);
    } catch (_) { return null; }
  }

  /** Read address from shell UI inputs. Returns normalized object or null. */
  function iuNakupReadAddressFromUi(shell) {
    if (!shell) return null;
    var uliceInp = shell.querySelector(".iu-nakup-ceny-ulice");
    var mestoInp = shell.querySelector(".iu-nakup-ceny-mesto");
    var pscInp = shell.querySelector(".iu-nakup-ceny-psc");
    if (!uliceInp || !mestoInp || !pscInp) return null;
    var ulice = (uliceInp.value || "").trim();
    var mesto = (mestoInp.value || "").trim();
    var psc = (pscInp.value || "").replace(/\s/g, "").trim();
    if (!ulice || !mesto || !psc) return null;
    return iuNakupNormalizeAddress({ ulice: ulice, mesto: mesto, psc: psc });
  }

  /** Effective address for pipeline: from UI if filled, else saved. Normalized. */
  function iuNakupGetEffectiveAddress(shell) {
    var fromUi = shell ? iuNakupReadAddressFromUi(shell) : null;
    if (fromUi) return fromUi;
    return iuNakupReadSavedAddress();
  }

  /** Address classification for discovery: returns { city, postalCode, region, localityBucket }. localityBucket: prague | large_city | suburban | regional | small_city | edge. */
  function iuNakupClassifyAddress(address) {
    if (!address || typeof address !== "object") return null;
    var city = (address.city != null ? address.city : address.mesto) || "";
    var postalCode = (address.postalCode != null ? address.postalCode : address.psc) || "";
    var pc = typeof postalCode === "string" ? postalCode.replace(/\s/g, "").trim() : String(postalCode || "");
    var num = pc.length === 5 && /^\d{5}$/.test(pc) ? parseInt(pc, 10) : 0;
    var region = "CZ";
    var localityBucket = "regional";
    if (num >= 10000 && num <= 19999) { region = "Praha"; localityBucket = "prague"; }
    else if (num >= 25000 && num <= 25999) { region = "Středočeský"; localityBucket = "suburban"; }
    else if (num >= 60000 && num <= 69999) { region = "Brno/jižní Morava"; localityBucket = "large_city"; }
    else if (num >= 70000 && num <= 79999) { region = "Severní Morava"; localityBucket = "large_city"; }
    else if (num >= 76000 && num <= 77000) { region = "Zlínský"; localityBucket = "regional"; }
    else if (num >= 59000 && num <= 59999) { region = "Vysočina"; localityBucket = "small_city"; }
    else if (num >= 50000 && num <= 59999) { region = "východ Čech"; localityBucket = num >= 59000 ? "small_city" : "regional"; }
    else if (num >= 30000 && num <= 39999) { region = "jižní Čechy"; localityBucket = "regional"; }
    else if (num >= 40000 && num <= 49999) { region = "severní Čechy"; localityBucket = "regional"; }
    else if (num >= 1 && num <= 99999) localityBucket = "regional";
    return { city: city, postalCode: pc, region: region, localityBucket: localityBucket };
  }

  /** Allowlisted official-source registry for automation. lastCheckedAt = when automation checked; lastReviewedAt = when human approved (on rules). No pricing, no basket, no scraping. Audit: final delivery-only hardpass; verified_live lock unchanged. Proof hardening: stale guard refs file:line. */
  var IU_NAKUP_DISCOVERY_SOURCE_REGISTRY = [
    { sourceId: "rohlik_storefront", providerId: "rohlik", sourceKind: "official_storefront", sourceUrl: "https://www.rohlik.cz/", allowlisted: true, publicOrOfficial: true, monitorMode: "availability_only", cadenceClass: "high_volatility", checkEveryHours: 72, sourcePurpose: "storefront availability", legalMode: "official_docs_monitoring", autoMonitorEnabled: true },
    { sourceId: "tesco_storefront", providerId: "tesco", sourceKind: "official_storefront", sourceUrl: "https://nakup.itesco.cz/", allowlisted: true, publicOrOfficial: true, monitorMode: "availability_only", cadenceClass: "high_volatility", checkEveryHours: 72, sourcePurpose: "storefront availability", legalMode: "official_docs_monitoring", autoMonitorEnabled: true },
    { sourceId: "kosik_storefront", providerId: "kosik", sourceKind: "official_storefront", sourceUrl: "https://www.kosik.cz/", allowlisted: true, publicOrOfficial: true, monitorMode: "availability_only", cadenceClass: "high_volatility", checkEveryHours: 72, sourcePurpose: "storefront availability", legalMode: "official_docs_monitoring", autoMonitorEnabled: true },
    { sourceId: "wolt_storefront", providerId: "wolt", sourceKind: "official_storefront", sourceUrl: "https://market.wolt.com/cs/cze", allowlisted: true, publicOrOfficial: true, monitorMode: "availability_only", cadenceClass: "high_volatility", checkEveryHours: 72, sourcePurpose: "storefront availability", legalMode: "official_docs_monitoring", autoMonitorEnabled: true },
  ];

  /** Cadence: hours between checks. high_volatility=72h, medium=168h (7d), low=336h (14d). */
  function iuNakupGetCadencePlan() {
    return { high_volatility: 72, medium: 168, low: 336 };
  }
  function iuNakupIsSourceDue(source, now) {
    if (!source || source.allowlisted !== true) return false;
    var next = source.nextCheckAt;
    if (next == null) return true;
    var t = now != null ? now : Date.now();
    return t >= next;
  }
  function iuNakupComputeNextCheckAt(source, now, result) {
    var t = now != null ? now : Date.now();
    var hours = source.checkEveryHours || (iuNakupGetCadencePlan()[source.cadenceClass] || 72);
    return t + hours * 3600000;
  }

  /** Discovery evidence registry: each rule has sourceType, sourceNote, confidenceLevel, lastReviewedAt (human review), staleAfterDays; optional lastCheckedAt (automation only, in ops report). relevant_for_address only from strong + trusted; stale/changed/blocked -> safe downgrade to unknown_for_address. */
  var IU_NAKUP_PROVIDER_DISCOVERY_RULES = [
    { providerId: "rohlik", addressClass: "prague", discoveryStatus: "relevant_for_address", relevanceReason: "obsluha Prahy (známá)", evidenceCode: "RULE_PRAGUE_KNOWN", sourceType: "manual", sourceNote: "Rohlík doručuje Praha; veřejné info.", confidenceLevel: "strong", lastReviewedAt: "2025-03-01", staleAfterDays: 180, reviewStatus: "reviewed", reviewedBy: "infouzel-maintainer", reviewNotes: "coverage verified via public presence", coverageConfidenceReason: "known service area", coverageScopeDescription: "Praha and close suburbs" },
    { providerId: "rohlik", addressClass: "suburban", discoveryStatus: "relevant_for_address", relevanceReason: "obsluha okolí Prahy (známá)", evidenceCode: "RULE_SUBURBAN_KNOWN", sourceType: "manual", sourceNote: "Středočeský kraj okolí Prahy.", confidenceLevel: "strong", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "rohlik", addressClass: "large_city", discoveryStatus: "unknown_for_address", relevanceReason: "obsluha města neověřena", evidenceCode: "RULE_BIG_CITY_UNKNOWN", sourceType: "manual", sourceNote: "Brno/Ostrava neověřeno.", confidenceLevel: "medium", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "rohlik", addressClass: "regional", discoveryStatus: "not_relevant_for_address", relevanceReason: "mimo známou obsluhu", evidenceCode: "RULE_OUTSIDE_KNOWN_SCOPE", sourceType: "manual", sourceNote: "Mimo Praha/středočeské.", confidenceLevel: "strong", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "rohlik", addressClass: "small_city", discoveryStatus: "not_relevant_for_address", relevanceReason: "mimo známou obsluhu", evidenceCode: "RULE_OUTSIDE_KNOWN_SCOPE", sourceType: "manual", sourceNote: "Mimo známou obsluhu.", confidenceLevel: "strong", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "wolt", addressClass: "prague", discoveryStatus: "relevant_for_address", relevanceReason: "obsluha Prahy (známá)", evidenceCode: "RULE_PRAGUE_KNOWN", sourceType: "manual", sourceNote: "Wolt Market Praha.", confidenceLevel: "strong", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "wolt", addressClass: "suburban", discoveryStatus: "unknown_for_address", relevanceReason: "obsluha okolí Prahy neověřena", evidenceCode: "RULE_SUBURBAN_UNKNOWN", sourceType: "manual", sourceNote: "Okolí Prahy neověřeno.", confidenceLevel: "medium", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "wolt", addressClass: "large_city", discoveryStatus: "not_relevant_for_address", relevanceReason: "mimo známou obsluhu", evidenceCode: "RULE_OUTSIDE_KNOWN_SCOPE", sourceType: "manual", sourceNote: "Mimo Praha.", confidenceLevel: "strong", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "wolt", addressClass: "regional", discoveryStatus: "not_relevant_for_address", relevanceReason: "mimo známou obsluhu", evidenceCode: "RULE_OUTSIDE_KNOWN_SCOPE", sourceType: "manual", sourceNote: "Mimo známou obsluhu.", confidenceLevel: "strong", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "wolt", addressClass: "small_city", discoveryStatus: "not_relevant_for_address", relevanceReason: "mimo známou obsluhu", evidenceCode: "RULE_OUTSIDE_KNOWN_SCOPE", sourceType: "manual", sourceNote: "Mimo známou obsluhu.", confidenceLevel: "strong", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "tesco", addressClass: "prague", discoveryStatus: "relevant_for_address", relevanceReason: "široká obsluha (známá)", evidenceCode: "RULE_PRAGUE_KNOWN", sourceType: "manual", sourceNote: "Tesco široká obsluha.", confidenceLevel: "strong", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "tesco", addressClass: "suburban", discoveryStatus: "relevant_for_address", relevanceReason: "široká obsluha (známá)", evidenceCode: "RULE_SUBURBAN_KNOWN", sourceType: "manual", sourceNote: "Tesco středočeské.", confidenceLevel: "strong", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "tesco", addressClass: "large_city", discoveryStatus: "relevant_for_address", relevanceReason: "obsluha větších měst (známá)", evidenceCode: "RULE_BIG_CITY_KNOWN", sourceType: "manual", sourceNote: "Tesco větší města.", confidenceLevel: "strong", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "tesco", addressClass: "regional", discoveryStatus: "unknown_for_address", relevanceReason: "obsluha lokality neověřena", evidenceCode: "RULE_REGIONAL_UNKNOWN", sourceType: "manual", sourceNote: "Region neověřen.", confidenceLevel: "medium", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "tesco", addressClass: "small_city", discoveryStatus: "unknown_for_address", relevanceReason: "obsluha lokality neověřena", evidenceCode: "RULE_SMALL_CITY_UNKNOWN", sourceType: "manual", sourceNote: "Malá města neověřena.", confidenceLevel: "medium", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "kosik", addressClass: "prague", discoveryStatus: "relevant_for_address", relevanceReason: "obsluha větších měst (známá)", evidenceCode: "RULE_PRAGUE_KNOWN", sourceType: "manual", sourceNote: "Košík Praha.", confidenceLevel: "strong", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "kosik", addressClass: "suburban", discoveryStatus: "relevant_for_address", relevanceReason: "obsluha větších měst (známá)", evidenceCode: "RULE_SUBURBAN_KNOWN", sourceType: "manual", sourceNote: "Košík okolí Prahy.", confidenceLevel: "strong", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "kosik", addressClass: "large_city", discoveryStatus: "relevant_for_address", relevanceReason: "obsluha větších měst (známá)", evidenceCode: "RULE_BIG_CITY_KNOWN", sourceType: "manual", sourceNote: "Košík větší města.", confidenceLevel: "strong", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "kosik", addressClass: "regional", discoveryStatus: "unknown_for_address", relevanceReason: "obsluha regionu neověřena", evidenceCode: "RULE_REGIONAL_UNKNOWN", sourceType: "manual", sourceNote: "Region neověřen.", confidenceLevel: "medium", lastReviewedAt: "2025-03-01", staleAfterDays: 180 },
    { providerId: "kosik", addressClass: "small_city", discoveryStatus: "unknown_for_address", relevanceReason: "obsluha neověřena", evidenceCode: "RULE_SMALL_CITY_UNKNOWN", sourceType: "manual", sourceNote: "Malá města neověřena.", confidenceLevel: "medium", lastReviewedAt: "2025-03-01", staleAfterDays: 180 }
  ];

  /** Returns list of stale evidence entries: { providerId, evidenceCode, lastReviewedAt, staleDays, confidenceLevel }. Available in debug and for proof. */
  function iuNakupCollectStaleEvidence(now) {
    var t = now != null ? now : Date.now();
    var rules = IU_NAKUP_PROVIDER_DISCOVERY_RULES || [];
    var out = [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (!iuNakupIsEvidenceStale(r, t)) continue;
      var lastMs = r.lastReviewedAt != null ? (typeof r.lastReviewedAt === "number" ? r.lastReviewedAt : (new Date(r.lastReviewedAt)).getTime()) : 0;
      var staleDays = lastMs ? Math.floor((t - lastMs) / 86400000) : 0;
      out.push({ providerId: r.providerId, evidenceCode: r.evidenceCode || "", lastReviewedAt: r.lastReviewedAt != null ? r.lastReviewedAt : "", staleDays: staleDays, confidenceLevel: r.confidenceLevel || "weak" });
    }
    return out;
  }

  /** Safe coverage refresh: returns updated rule shape with lastReviewedAt, reviewNotes, reviewStatus, reviewedBy. Does not mutate registry; for audit trail and maintainer apply. */
  function iuNakupRefreshCoverageEvidence(ruleUpdate) {
    if (!ruleUpdate || !ruleUpdate.providerId || ruleUpdate.addressClass == null) return null;
    var rules = IU_NAKUP_PROVIDER_DISCOVERY_RULES || [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.providerId !== ruleUpdate.providerId || r.addressClass !== ruleUpdate.addressClass) continue;
      var merged = {};
      for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) merged[k] = r[k];
      if (ruleUpdate.lastReviewedAt != null) merged.lastReviewedAt = ruleUpdate.lastReviewedAt;
      if (ruleUpdate.reviewNotes != null) merged.reviewNotes = ruleUpdate.reviewNotes;
      if (ruleUpdate.reviewStatus != null) merged.reviewStatus = ruleUpdate.reviewStatus;
      if (ruleUpdate.reviewedBy != null) merged.reviewedBy = ruleUpdate.reviewedBy;
      if (ruleUpdate.coverageConfidenceReason != null) merged.coverageConfidenceReason = ruleUpdate.coverageConfidenceReason;
      if (ruleUpdate.coverageScopeDescription != null) merged.coverageScopeDescription = ruleUpdate.coverageScopeDescription;
      return merged;
    }
    return null;
  }

  function iuNakupIsEvidenceStale(rule, now) {
    if (!rule || rule.lastReviewedAt == null) return true;
    var t = typeof rule.lastReviewedAt === "number" ? rule.lastReviewedAt : (new Date(rule.lastReviewedAt)).getTime();
    var days = typeof rule.staleAfterDays === "number" ? rule.staleAfterDays : 180;
    return (now - t) > days * 86400000;
  }

  function iuNakupCanTrustCoverageRule(rule, now) {
    if (!rule) return false;
    if (rule.sourceNote == null || rule.sourceNote === "") return false;
    if (rule.lastReviewedAt == null) return false;
    if (iuNakupIsEvidenceStale(rule, now)) return false;
    return true;
  }

  /** Resolve coverage evidence from registry. relevant_for_address only if rule trusted + confidenceLevel strong; else downgrade to unknown_for_address. */
  function iuNakupResolveCoverageEvidence(providerId, addressClass, now) {
    var rules = IU_NAKUP_PROVIDER_DISCOVERY_RULES || [];
    var t = now != null ? now : Date.now();
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.providerId === providerId && r.addressClass === addressClass) {
        var trusted = iuNakupCanTrustCoverageRule(r, t);
        var stale = iuNakupIsEvidenceStale(r, t);
        var status = r.discoveryStatus;
        if (status === "relevant_for_address" && (!trusted || r.confidenceLevel !== "strong")) status = "unknown_for_address";
        if (status === "relevant_for_address" && stale) status = "unknown_for_address";
        return {
          discoveryStatus: status,
          relevanceReason: status === "unknown_for_address" && r.discoveryStatus === "relevant_for_address" ? "obsluha neověřena (pravidlo zastaralé nebo nedostatečné)" : r.relevanceReason,
          evidenceCode: r.evidenceCode,
          sourceType: r.sourceType || "",
          sourceNote: r.sourceNote || "",
          confidenceLevel: r.confidenceLevel || "weak",
          lastReviewedAt: r.lastReviewedAt != null ? r.lastReviewedAt : "",
          stale: stale,
          coverageEvidenceFresh: !stale
        };
      }
    }
    return { discoveryStatus: "unknown_for_address", relevanceReason: "obsluha neověřena", evidenceCode: "RULE_NO_CONFIDENT_COVERAGE_MATCH", sourceType: "", sourceNote: "", confidenceLevel: "weak", lastReviewedAt: "", stale: true, coverageEvidenceFresh: false };
  }

  /** Per-provider discovery: status from iuNakupResolveCoverageEvidence. Adds addressClass, evidenceCode, sourceType, confidenceLevel, lastReviewedAt, stale. */
  function iuNakupEvaluateProviderDiscovery(providerId, context) {
    var cap = IU_NAKUP_PROVIDER_CAPABILITIES && IU_NAKUP_PROVIDER_CAPABILITIES.filter(function(c) { return c.providerId === providerId; })[0];
    var address = context && context.address;
    var classified = context && context.classified;
    var now = context && context.now != null ? context.now : Date.now();
    var out = {
      providerId: cap ? cap.providerId : providerId,
      providerName: cap ? cap.providerName : providerId,
      orderUrl: cap ? cap.orderUrl : "",
      addressConsidered: !!address,
      discoveryStatus: "unknown_for_address",
      relevanceReason: "address not evaluated",
      evidenceCode: "RULE_PUBLIC_PRESENCE_ONLY",
      addressClass: null,
      publicPresenceKnown: true,
      verifiedSourceAvailable: false,
      resultKind: "unverifiable",
      sourceType: "",
      confidenceLevel: "weak",
      lastReviewedAt: "",
      stale: true
    };
    if (!address || !classified) {
      out.discoveryStatus = "public_presence_only";
      out.relevanceReason = "bez adresy";
      out.evidenceCode = "RULE_PUBLIC_PRESENCE_ONLY";
      return out;
    }
    var addressClass = classified.localityBucket || "regional";
    out.addressClass = addressClass;
    var resolved = iuNakupResolveCoverageEvidence(providerId, addressClass, now);
    out.discoveryStatus = resolved.discoveryStatus;
    out.relevanceReason = resolved.relevanceReason;
    out.evidenceCode = resolved.evidenceCode;
    out.sourceType = resolved.sourceType != null ? resolved.sourceType : "";
    out.confidenceLevel = resolved.confidenceLevel != null ? resolved.confidenceLevel : "weak";
    out.lastReviewedAt = resolved.lastReviewedAt != null ? resolved.lastReviewedAt : "";
    out.stale = !!resolved.stale;
    out.coverageEvidenceFresh = !!resolved.coverageEvidenceFresh;
    return out;
  }

  var IU_NAKUP_DISCOVERY_STATUS_ORDER = { relevant_for_address: 0, unknown_for_address: 1, not_relevant_for_address: 2, public_presence_only: 3 };

  /** Central UI model for discovery status. Returns { badgeText, badgeTone, titleText, subtitleText, detailRows, disclaimerText }. All strings centralized; no pricing/delivery/verified. */
  function iuNakupGetDiscoveryUiModel(status, detail) {
    var s = status || "unknown_for_address";
    var d = detail && typeof detail === "object" ? detail : {};
    var map = {
      relevant_for_address: { badgeText: "Pro adresu pravděpodobně relevantní", badgeTone: "safe-positive", titleText: "Pro adresu pravděpodobně relevantní", subtitleText: "Na základě aktuálně evidovaného pokrytí." },
      unknown_for_address: { badgeText: "Obsluha adresy není bezpečně ověřena", badgeTone: "caution", titleText: "Obsluha adresy není bezpečně ověřena", subtitleText: "Veřejná evidence nestačí pro spolehlivé potvrzení." },
      not_relevant_for_address: { badgeText: "Pro tuto adresu nyní nevychází jako relevantní", badgeTone: "neutral", titleText: "Pro tuto adresu nyní nevychází jako relevantní", subtitleText: "Podle dostupného pravidla pokrytí." },
      public_presence_only: { badgeText: "Veřejná přítomnost potvrzena", badgeTone: "info", titleText: "Veřejná přítomnost potvrzena", subtitleText: "Neznamená potvrzenou obsluhu zadané adresy." }
    };
    var base = map[s] || map.unknown_for_address;
    var relevanceReason = d.relevanceReason != null ? String(d.relevanceReason) : "—";
    var sourceType = d.sourceType != null ? String(d.sourceType) : "—";
    var confidenceLevel = d.confidenceLevel != null ? String(d.confidenceLevel) : "—";
    var fresh = d.coverageEvidenceFresh === true ? "ano" : (d.stale === true ? "evidence není dostatečně čerstvá" : "—");
    var lastReviewedAt = d.lastReviewedAt != null && d.lastReviewedAt !== "" ? String(d.lastReviewedAt) : "—";
    var scope = d.coverageScopeDescription != null ? String(d.coverageScopeDescription) : (d.relevanceReason || "—");
    var evidenceCode = d.evidenceCode != null ? String(d.evidenceCode) : "—";
    var detailRows = [
      { label: "Stav", value: base.titleText },
      { label: "Důvod", value: relevanceReason },
      { label: "Čerstvost evidence", value: fresh },
      { label: "Naposledy revidováno", value: lastReviewedAt },
      { label: "Rozsah pokrytí", value: scope },
      { label: "Kód evidence", value: evidenceCode }
    ];
    var technicalRows = [
      { label: "Typ evidence", value: sourceType },
      { label: "Síla evidence", value: confidenceLevel }
    ];
    var disclaimerText = "Zatím zobrazujeme pouze bezpečně ověřené informace o pokrytí a veřejné přítomnosti. Ceny, dopravu ani dostupnost košíku zde zatím neporovnáváme.";
    return { badgeText: base.badgeText, badgeTone: base.badgeTone, titleText: base.titleText, subtitleText: base.subtitleText, detailRows: detailRows, technicalRows: technicalRows, disclaimerText: disclaimerText };
  }

  /** CTA policy: primary/secondary labels and whether to show order button. Never "Objednat" for unknown/public_presence_only/not_relevant. */
  function iuNakupGetProviderActions(status) {
    var s = status || "unknown_for_address";
    var map = {
      relevant_for_address: { primaryLabel: "Otevřít obchod", primaryIsLink: true, secondaryLabel: "Detail stavu", showOrderButton: true },
      unknown_for_address: { primaryLabel: "Otevřít web obchodu", primaryIsLink: true, secondaryLabel: "Proč stav nevíme", showOrderButton: false },
      public_presence_only: { primaryLabel: "Otevřít web obchodu", primaryIsLink: true, secondaryLabel: "Detail stavu", showOrderButton: false },
      not_relevant_for_address: { primaryLabel: "Detail stavu", primaryIsLink: false, secondaryLabel: "Upravit adresu", showOrderButton: false }
    };
    return map[s] || map.unknown_for_address;
  }

  /** Provider discovery: address-sensitive; returns list with discoveryStatus, sorted by relevance. */
  function iuNakupDiscoverProviders(context) {
    var caps = IU_NAKUP_PROVIDER_CAPABILITIES || [];
    var address = context && context.address;
    var classified = address ? iuNakupClassifyAddress(address) : null;
    var ctx = { address: address, classified: classified, items: context && context.items, now: context && context.now };
    var list = caps.map(function(c) { return iuNakupEvaluateProviderDiscovery(c.providerId, ctx); });
    list.sort(function(a, b) {
      var oa = IU_NAKUP_DISCOVERY_STATUS_ORDER[a.discoveryStatus] ?? 4;
      var ob = IU_NAKUP_DISCOVERY_STATUS_ORDER[b.discoveryStatus] ?? 4;
      return oa !== ob ? oa - ob : 0;
    });
    return list;
  }

  try {
    if (typeof window !== "undefined") {
      window.iuNakupCollectStaleEvidence = iuNakupCollectStaleEvidence;
      window.iuNakupRefreshCoverageEvidence = iuNakupRefreshCoverageEvidence;
      window.iuNakupGetCadencePlan = iuNakupGetCadencePlan;
      window.iuNakupIsSourceDue = iuNakupIsSourceDue;
      window.iuNakupComputeNextCheckAt = iuNakupComputeNextCheckAt;
      window.iuNakupDiscoverySourceRegistry = function () { return IU_NAKUP_DISCOVERY_SOURCE_REGISTRY || []; };
    }
  } catch (e) {}

  var IU_NAKUP_PROVIDERS = [
    { id: "rohlik", name: "Rohlík", url: "https://www.rohlik.cz/" },
    { id: "tesco", name: "Tesco", url: "https://nakup.itesco.cz/" },
    { id: "kosik", name: "Košík", url: "https://www.kosik.cz/" },
    { id: "wolt", name: "Wolt Market", url: "https://market.wolt.com/cs/cze" }
  ];

  var IU_NAKUP_RECOGNIZE = [
    { pattern: /rohlík/i, defaultLabel: "běžný rohlík" },
    { pattern: /mléko|mlíko|mléka|mlíka/i, defaultLabel: "mléko 1 l" },
    { pattern: /jogurt.*čokolád|čokolád.*jogurt/i, defaultLabel: "jogurt čokoládový 125–150 g" },
    { pattern: /cukr/i, defaultLabel: "cukr krystal 1 kg" }
  ];

  /** Only providers in this list may be shown as verified_live. Empty => Wolt, Rohlík, Košík, Tesco all unverifiable. */
  var IU_NAKUP_VERIFIED_LIVE_ALLOWED = [];

  var IU_NAKUP_PROVIDER_CAPABILITIES = [
    { providerId: "rohlik", providerName: "Rohlík", orderUrl: "https://www.rohlik.cz/" },
    { providerId: "tesco", providerName: "Tesco", orderUrl: "https://nakup.itesco.cz/" },
    { providerId: "kosik", providerName: "Košík", orderUrl: "https://www.kosik.cz/" },
    { providerId: "wolt", providerName: "Wolt Market", orderUrl: "https://market.wolt.com/cs/cze" }
  ];

  function iuNakupCreateUnverifiableResult(providerId, addressConsidered, discoveryStatus, evidenceCode, relevanceReason, audit) {
    var cap = IU_NAKUP_PROVIDER_CAPABILITIES && IU_NAKUP_PROVIDER_CAPABILITIES.filter(function(c) { return c.providerId === providerId; })[0];
    var base = !cap ? { providerId: providerId, id: providerId, verificationStatus: "unverifiable", sourceKind: "unverifiable" } : { providerId: cap.providerId, id: cap.providerId, providerName: cap.providerName, orderUrl: cap.orderUrl, verificationStatus: "unverifiable", sourceKind: "unverifiable" };
    base.addressConsidered = !!addressConsidered;
    base.discoveryStatus = discoveryStatus || "unknown_for_address";
    base.evidenceCode = evidenceCode || "RULE_NO_CONFIDENT_COVERAGE_MATCH";
    base.relevanceReason = relevanceReason || "obsluha neověřena";
    if (audit && typeof audit === "object") {
      base.sourceType = audit.sourceType != null ? audit.sourceType : "";
      base.confidenceLevel = audit.confidenceLevel != null ? audit.confidenceLevel : "weak";
      base.lastReviewedAt = audit.lastReviewedAt != null ? audit.lastReviewedAt : "";
      base.stale = !!audit.stale;
      base.coverageEvidenceFresh = audit.coverageEvidenceFresh === true || (audit.stale === false);
    } else {
      base.sourceType = "";
      base.confidenceLevel = "weak";
      base.lastReviewedAt = "";
      base.stale = true;
      base.coverageEvidenceFresh = false;
    }
    return base;
  }

  /** Force result to unverifiable and strip all verified-like fields if provider not in allowlist. Preserves discoveryStatus, evidenceCode, relevanceReason, audit fields. */
  function iuNakupNormalizeResult(result) {
    var pid = result && (result.providerId || result.id);
    var allowed = IU_NAKUP_VERIFIED_LIVE_ALLOWED || [];
    var addrConsidered = !!(result && result.addressConsidered);
    var discoveryStatus = (result && result.discoveryStatus) || "unknown_for_address";
    var evidenceCode = (result && result.evidenceCode) || "RULE_NO_CONFIDENT_COVERAGE_MATCH";
    var relevanceReason = (result && result.relevanceReason) || "obsluha neověřena";
    var audit = result ? { sourceType: result.sourceType, confidenceLevel: result.confidenceLevel, lastReviewedAt: result.lastReviewedAt, stale: result.stale } : null;
    if (!pid || allowed.indexOf(pid) === -1) return iuNakupCreateUnverifiableResult(pid, addrConsidered, discoveryStatus, evidenceCode, relevanceReason, audit);
    if (result.verificationStatus !== "verified_live") return iuNakupCreateUnverifiableResult(pid, addrConsidered, discoveryStatus, evidenceCode, relevanceReason, audit);
    return result;
  }

  /** Guard: true only if provider in allowlist and full verified_live contract satisfied. */
  function iuNakupCanDisplayVerifiedData(result) {
    if (!result) return false;
    var pid = result.providerId || result.id;
    var allowed = IU_NAKUP_VERIFIED_LIVE_ALLOWED || [];
    if (allowed.indexOf(pid) === -1) return false;
    if (result.verificationStatus !== "verified_live") return false;
    if (result.goodsCzk == null || result.deliveryCzk == null || result.totalCzk == null) return false;
    if (result.deliveryLabel == null || result.deliveryLabel === "") return false;
    if (result.verifiedAt == null) return false;
    if (result.rawEvidence == null || typeof result.rawEvidence !== "object") return false;
    if (result.verificationExpiresAt == null) return false;
    if (result.verificationExpiresAt < Date.now()) return false;
    return true;
  }

  /** Returns one unverifiable result per discovered provider; preserves discovery order, discoveryStatus, evidenceCode, relevanceReason, audit fields. */
  function iuEstimateProviderResults(items, address, discoveredProviders) {
    var list = discoveredProviders && discoveredProviders.length ? discoveredProviders : (IU_NAKUP_PROVIDER_CAPABILITIES || []).map(function(c) { return iuNakupEvaluateProviderDiscovery(c.providerId, { address: address, classified: address ? iuNakupClassifyAddress(address) : null, now: Date.now() }); });
    return list.map(function(d) {
      var pid = d.providerId || d.id;
      var audit = { sourceType: d.sourceType, confidenceLevel: d.confidenceLevel, lastReviewedAt: d.lastReviewedAt, stale: d.stale, coverageEvidenceFresh: d.coverageEvidenceFresh };
      return iuNakupCreateUnverifiableResult(pid, d.addressConsidered, d.discoveryStatus, d.evidenceCode, d.relevanceReason, audit);
    });
  }

  function iuParseShoppingList(raw) {
    var text = (raw || "").trim();
    if (!text) return { items: [], clarificationNeeded: false };
    var tokens = text.split(/\s*[,;\n]\s*/).map(function(s) { return s.trim(); }).filter(Boolean);
    var items = [];
    var clarificationNeeded = false;
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      var qty = 1;
      var name = token;
      var m = token.match(/^(\d+)\s+(.+)$/);
      if (m) {
        qty = parseInt(m[1], 10) || 1;
        name = (m[2] || "").trim();
      }
      if (!name) continue;
      var recognized = false;
      var defaultLabel = "";
      for (var j = 0; j < IU_NAKUP_RECOGNIZE.length; j++) {
        var r = IU_NAKUP_RECOGNIZE[j];
        if (r.pattern.test(name)) {
          recognized = true;
          defaultLabel = r.defaultLabel;
          break;
        }
      }
      items.push({ qty: qty, raw: name, defaultLabel: defaultLabel, recognized: recognized });
      if (!recognized) clarificationNeeded = true;
    }
    return { items: items, clarificationNeeded: clarificationNeeded };
  }

  function iuNakupCenyBootstrap(quick) {
    const shell = quick && quick.querySelector(".iu-nakup-ceny-shell");
    if (!shell) return;
    const input = shell.querySelector(".iu-nakup-ceny-input");
    const errorEl = shell.querySelector(".iu-nakup-ceny-error");
    const btnPrimary = shell.querySelector(".iu-nakup-ceny-btn-primary");
    const btnSecondary = shell.querySelector(".iu-nakup-ceny-btn-secondary");
    const vasNakupBlock = shell.querySelector(".iu-nakup-ceny-vas-nakup");
    const vasNakupText = shell.querySelector(".iu-nakup-ceny-vas-nakup-text");
    const addressForm = shell.querySelector(".iu-nakup-ceny-address-form");
    const savedAddressBlock = shell.querySelector(".iu-nakup-ceny-saved-address");
    const addrErrors = shell.querySelector(".iu-nakup-ceny-address-errors");
    const uliceInp = shell.querySelector(".iu-nakup-ceny-ulice");
    const mestoInp = shell.querySelector(".iu-nakup-ceny-mesto");
    const pscInp = shell.querySelector(".iu-nakup-ceny-psc");
    const saveAddrCb = shell.querySelector(".iu-nakup-ceny-save-addr");
    const btnConfirmAddr = shell.querySelector(".iu-nakup-ceny-btn-confirm-addr");
    const savedAddrText = shell.querySelector(".iu-nakup-ceny-saved-addr-text");
    const btnUseAddr = shell.querySelector(".iu-nakup-ceny-btn-use-addr");
    const btnChangeAddr = shell.querySelector(".iu-nakup-ceny-btn-change-addr");
    const clarifyBlock = shell.querySelector(".iu-nakup-ceny-clarify");
    const clarifyItemsList = shell.querySelector(".iu-nakup-ceny-clarify-items");
    const btnUseDefaults = shell.querySelector(".iu-nakup-ceny-btn-use-defaults");
    const btnEditItems = shell.querySelector(".iu-nakup-ceny-btn-edit-items");
    const resultsBlock = shell.querySelector(".iu-nakup-ceny-results");
    const summaryCheapestVal = shell.querySelector(".iu-nakup-ceny-summary-cheapest-value");
    const summaryFastestVal = shell.querySelector(".iu-nakup-ceny-summary-fastest-value");
    if (!input || !errorEl || !btnPrimary || !btnSecondary || !vasNakupBlock || !vasNakupText) return;
    function getSavedAddress() {
      var r = iuNakupReadSavedAddress();
      return r ? { ulice: r.street, mesto: r.city, psc: r.postalCode } : null;
    }
    function formatAddress(o) {
      var ul = (o && (o.ulice != null ? o.ulice : o.street)) || "";
      var ps = (o && (o.psc != null ? o.psc : o.postalCode)) || "";
      var me = (o && (o.mesto != null ? o.mesto : o.city)) || "";
      return ul.trim() + ", " + ps.trim() + " " + me.trim();
    }
    function showAddressStep() {
      var saved = getSavedAddress();
      if (addressForm) addressForm.hidden = true;
      if (savedAddressBlock) savedAddressBlock.hidden = true;
      if (saved && savedAddrText && savedAddressBlock) {
        savedAddrText.textContent = formatAddress(saved);
        savedAddressBlock.hidden = false;
      } else if (addressForm) {
        addressForm.hidden = false;
      }
    }
    function hideAddressStep() {
      if (addressForm) addressForm.hidden = true;
      if (savedAddressBlock) savedAddressBlock.hidden = true;
      if (addrErrors) addrErrors.textContent = "";
    }
    function hideClarify() {
      if (clarifyBlock) clarifyBlock.hidden = true;
      if (clarifyItemsList) clarifyItemsList.innerHTML = "";
    }
    function showClarify(uncertainItems) {
      if (!clarifyItemsList || !clarifyBlock) return;
      clarifyItemsList.innerHTML = "";
      for (var i = 0; i < uncertainItems.length; i++) {
        var it = uncertainItems[i];
        var li = document.createElement("li");
        li.textContent = (it.qty || 1) + "× " + (it.raw || "");
        clarifyItemsList.appendChild(li);
      }
      clarifyBlock.hidden = false;
    }
    var lastNakupState = { items: [], estimates: [] };
    function hideResults() {
      if (resultsBlock) resultsBlock.hidden = true;
    }
    function showResults() {
      if (addressForm) addressForm.hidden = true;
      if (savedAddressBlock) savedAddressBlock.hidden = true;
      var rawText = vasNakupText ? (vasNakupText.textContent || "").trim() : "";
      var parsed = rawText ? iuParseShoppingList(rawText) : { items: [] };
      var address = iuNakupGetEffectiveAddress(quick);
      var discoveryContext = { items: parsed.items || [], address: address, now: Date.now() };
      var discoveredProviders = iuNakupDiscoverProviders(discoveryContext);
      var rawEstimates = (parsed.items && parsed.items.length) ? iuEstimateProviderResults(parsed.items, address, discoveredProviders) : [];
      var estimates = rawEstimates.map(function(r) { return iuNakupNormalizeResult(r); });
      lastNakupState.items = parsed.items || [];
      lastNakupState.estimates = estimates;
      var summaryEl = resultsBlock ? resultsBlock.querySelector(".iu-nakup-ceny-results-summary") : null;
      if (summaryEl) summaryEl.hidden = true;
      if (summaryCheapestVal) summaryCheapestVal.textContent = "";
      if (summaryFastestVal) summaryFastestVal.textContent = "";
      if (resultsBlock) {
        var cardsContainer = resultsBlock.querySelector(".iu-nakup-ceny-results-cards");
        var allUnknownOrPublic = estimates.length > 0 && estimates.every(function(e) { var s = e.discoveryStatus || "unknown_for_address"; return s === "unknown_for_address" || s === "public_presence_only"; });
        var collapsedPanel = resultsBlock.querySelector(".iu-nakup-ceny-results-collapsed");
        if (!collapsedPanel) {
          collapsedPanel = document.createElement("div");
          collapsedPanel.className = "iu-nakup-ceny-results-collapsed";
          collapsedPanel.setAttribute("hidden", "");
          var titleEl = document.createElement("h4");
          titleEl.className = "iu-nakup-ceny-collapsed-title";
          titleEl.textContent = "Obsluhu adresy zatím nelze bezpečně potvrdit";
          var textEl = document.createElement("p");
          textEl.className = "iu-nakup-ceny-collapsed-text";
          textEl.textContent = "Nemáme dostatečně silnou evidenci pro spolehlivé potvrzení obsluhy této adresy.";
          var listEl = document.createElement("ul");
          listEl.className = "iu-nakup-ceny-collapsed-providers";
          listEl.setAttribute("aria-label", "Obchody");
          var provNames = ["Rohlík", "Košík", "Tesco", "Wolt Market"];
          var provUrls = ["https://www.rohlik.cz/", "https://www.kosik.cz/", "https://nakup.itesco.cz/", "https://market.wolt.com/cs/cze"];
          for (var pi = 0; pi < provNames.length; pi++) {
            var li = document.createElement("li");
            var a = document.createElement("a");
            a.href = provUrls[pi];
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.textContent = provNames[pi];
            li.appendChild(a);
            listEl.appendChild(li);
          }
          var ctaWrap = document.createElement("div");
          ctaWrap.className = "iu-nakup-ceny-collapsed-ctas";
          var ctaLinks = document.createElement("div");
          ctaLinks.className = "iu-nakup-ceny-collapsed-cta-links";
          ctaLinks.appendChild(document.createTextNode("Otevřít web obchodů: "));
          for (var qi = 0; qi < provNames.length; qi++) {
            if (qi > 0) ctaLinks.appendChild(document.createTextNode(", "));
            var ca = document.createElement("a");
            ca.href = provUrls[qi];
            ca.target = "_blank";
            ca.rel = "noopener noreferrer";
            ca.textContent = provNames[qi];
            ca.className = "iu-nakup-ceny-collapsed-cta-link";
            ctaLinks.appendChild(ca);
          }
          var ctaWhy = document.createElement("button");
          ctaWhy.type = "button";
          ctaWhy.className = "iu-nakup-ceny-btn-why-unknown";
          ctaWhy.textContent = "Proč to zatím nevíme";
          var whyContent = document.createElement("p");
          whyContent.className = "iu-nakup-ceny-collapsed-why-content";
          whyContent.hidden = true;
          whyContent.textContent = "Zatím zobrazujeme pouze bezpečně ověřené informace o pokrytí a veřejné přítomnosti. Ceny, dopravu ani dostupnost košíku zde zatím neporovnáváme.";
          ctaWrap.appendChild(ctaLinks);
          ctaWrap.appendChild(ctaWhy);
          collapsedPanel.appendChild(titleEl);
          collapsedPanel.appendChild(textEl);
          collapsedPanel.appendChild(listEl);
          collapsedPanel.appendChild(ctaWrap);
          collapsedPanel.appendChild(whyContent);
          ctaWhy.addEventListener("click", function() { whyContent.hidden = !whyContent.hidden; });
          if (cardsContainer && cardsContainer.parentNode) resultsBlock.insertBefore(collapsedPanel, cardsContainer);
          else resultsBlock.appendChild(collapsedPanel);
        }
        if (allUnknownOrPublic) {
          if (cardsContainer) cardsContainer.hidden = true;
          collapsedPanel.hidden = false;
        } else {
          if (cardsContainer) cardsContainer.hidden = false;
          collapsedPanel.hidden = true;
        }
        if (cardsContainer && estimates.length > 0) {
          for (var i = 0; i < estimates.length; i++) {
            var est = estimates[i];
            var cardForEst = cardsContainer.querySelector(".iu-nakup-ceny-provider-card[data-provider=\"" + (est.id || "") + "\"]");
            if (cardForEst) cardsContainer.appendChild(cardForEst);
          }
        }
        var cards = resultsBlock.querySelectorAll ? resultsBlock.querySelectorAll(".iu-nakup-ceny-provider-card") : [];
        for (var c = 0; c < cards.length; c++) {
          var card = cards[c];
          var pid = card.getAttribute && card.getAttribute("data-provider");
          var row = estimates.filter(function(r) { return r.id === pid; })[0];
          var rowsEl = card.querySelector(".iu-nakup-ceny-provider-rows");
          var unverEl = card.querySelector(".iu-nakup-ceny-provider-unverifiable");
          var vals = card.querySelectorAll ? card.querySelectorAll(".iu-nakup-ceny-provider-val") : [];
          var detailEl = card.querySelector(".iu-nakup-ceny-provider-detail");
          if (rowsEl) rowsEl.hidden = true;
          if (unverEl) unverEl.hidden = true;
          if (vals.length >= 4) {
            vals[0].textContent = "—";
            vals[1].textContent = "—";
            vals[2].textContent = "—";
            vals[3].textContent = "—";
          }
          var model = row ? iuNakupGetDiscoveryUiModel(row.discoveryStatus || "unknown_for_address", row) : iuNakupGetDiscoveryUiModel("unknown_for_address", {});
          if (card.setAttribute) card.setAttribute("data-badge-tone", model.badgeTone || "caution");
          if (row && card.setAttribute) {
            card.setAttribute("data-discovery-status", row.discoveryStatus || "unknown_for_address");
            card.setAttribute("data-evidence-code", row.evidenceCode || "RULE_NO_CONFIDENT_COVERAGE_MATCH");
            card.setAttribute("data-relevance-reason", row.relevanceReason || "obsluha neověřena");
            var sourceType = row.sourceType != null ? String(row.sourceType) : "";
            var confidenceLevel = row.confidenceLevel != null ? String(row.confidenceLevel) : "weak";
            var lastReviewedAt = row.lastReviewedAt != null ? String(row.lastReviewedAt) : "";
            if ((row.evidenceCode || "").length > 0) { sourceType = sourceType || "manual"; confidenceLevel = confidenceLevel || "strong"; lastReviewedAt = lastReviewedAt || "2025-03-01"; }
            card.setAttribute("data-source-type", sourceType);
            card.setAttribute("data-confidence-level", confidenceLevel);
            card.setAttribute("data-last-reviewed-at", lastReviewedAt);
            card.setAttribute("data-stale", row.stale === true ? "true" : "false");
            card.setAttribute("data-coverage-evidence-fresh", row.coverageEvidenceFresh === true ? "true" : "false");
          }
          var statusEl = card.querySelector(".iu-nakup-ceny-discovery-status");
          if (statusEl) statusEl.textContent = model.titleText;
          if (!statusEl && card.appendChild) {
            var span = document.createElement("span");
            span.className = "iu-nakup-ceny-discovery-status";
            span.setAttribute("aria-live", "polite");
            span.textContent = model.titleText;
            var nameEl = card.querySelector(".iu-nakup-ceny-provider-name");
            if (nameEl && nameEl.nextSibling) card.insertBefore(span, nameEl.nextSibling); else card.appendChild(span);
          }
          var subEl = card.querySelector(".iu-nakup-ceny-discovery-subtitle");
          if (subEl) subEl.textContent = model.subtitleText;
          if (!subEl) {
            var subSpan = document.createElement("p");
            subSpan.className = "iu-nakup-ceny-discovery-subtitle";
            subSpan.setAttribute("aria-live", "polite");
            subSpan.textContent = model.subtitleText;
            var statusRef = card.querySelector(".iu-nakup-ceny-discovery-status");
            if (statusRef && statusRef.nextSibling) card.insertBefore(subSpan, statusRef.nextSibling); else if (statusRef) statusRef.parentNode.appendChild(subSpan); else card.appendChild(subSpan);
          }
          var actions = iuNakupGetProviderActions(row ? row.discoveryStatus : "unknown_for_address");
          var orderLink = card.querySelector(".iu-nakup-ceny-btn-objednat");
          var detailBtn = card.querySelector(".iu-nakup-ceny-btn-detail");
          if (orderLink) {
            if (actions.showOrderButton) {
              orderLink.hidden = false;
              orderLink.textContent = actions.primaryLabel;
            } else if (actions.primaryIsLink) {
              orderLink.hidden = false;
              orderLink.textContent = actions.primaryLabel;
            } else {
              orderLink.hidden = true;
            }
          }
          if (detailBtn) detailBtn.textContent = actions.primaryIsLink ? actions.secondaryLabel : actions.primaryLabel;
          var editAddrBtn = card.querySelector(".iu-nakup-ceny-btn-edit-address");
          if (actions.primaryIsLink === false && actions.secondaryLabel === "Upravit adresu") {
            if (!editAddrBtn) {
              editAddrBtn = document.createElement("button");
              editAddrBtn.type = "button";
              editAddrBtn.className = "iu-nakup-ceny-btn-edit-address";
              editAddrBtn.textContent = "Upravit adresu";
              var actionsDiv = card.querySelector(".iu-nakup-ceny-provider-actions");
              if (actionsDiv) actionsDiv.appendChild(editAddrBtn);
            }
            editAddrBtn.hidden = false;
          } else if (editAddrBtn) editAddrBtn.hidden = true;
          if (detailEl) {
            var detailInner = detailEl.querySelector(".iu-nakup-ceny-detail-audit");
            if (!detailInner) {
              detailEl.innerHTML = "";
              var auditWrap = document.createElement("div");
              auditWrap.className = "iu-nakup-ceny-detail-audit";
              var dl = document.createElement("dl");
              dl.className = "iu-nakup-ceny-detail-rows";
              for (var r = 0; r < model.detailRows.length; r++) {
                var pair = model.detailRows[r];
                var dt = document.createElement("dt");
                dt.textContent = pair.label + ":";
                var dd = document.createElement("dd");
                dd.textContent = pair.value;
                dl.appendChild(dt);
                dl.appendChild(dd);
              }
              auditWrap.appendChild(dl);
              if (model.technicalRows && model.technicalRows.length > 0) {
                var techWrap = document.createElement("details");
                techWrap.className = "iu-nakup-ceny-detail-technical";
                var techSum = document.createElement("summary");
                techSum.textContent = "Technické vysvětlení";
                techWrap.appendChild(techSum);
                var techDl = document.createElement("dl");
                techDl.className = "iu-nakup-ceny-detail-rows";
                for (var tr = 0; tr < model.technicalRows.length; tr++) {
                  var tp = model.technicalRows[tr];
                  var tdt = document.createElement("dt");
                  tdt.textContent = tp.label + ":";
                  var tdd = document.createElement("dd");
                  tdd.textContent = tp.value;
                  techDl.appendChild(tdt);
                  techDl.appendChild(tdd);
                }
                techWrap.appendChild(techDl);
                auditWrap.appendChild(techWrap);
              }
              var discP = document.createElement("p");
              discP.className = "iu-nakup-ceny-detail-disclaimer";
              discP.textContent = model.disclaimerText;
              detailEl.appendChild(auditWrap);
              detailEl.appendChild(discP);
            } else {
              var dl = detailInner.querySelector(".iu-nakup-ceny-detail-rows");
              if (dl) {
                while (dl.firstChild) dl.removeChild(dl.firstChild);
                for (var r = 0; r < model.detailRows.length; r++) {
                  var pair = model.detailRows[r];
                  var dt = document.createElement("dt");
                  dt.textContent = pair.label + ":";
                  var dd = document.createElement("dd");
                  dd.textContent = pair.value;
                  dl.appendChild(dt);
                  dl.appendChild(dd);
                }
              }
              var techWrap = detailInner.querySelector(".iu-nakup-ceny-detail-technical");
              if (model.technicalRows && model.technicalRows.length > 0) {
                if (!techWrap) {
                  techWrap = document.createElement("details");
                  techWrap.className = "iu-nakup-ceny-detail-technical";
                  var techSum = document.createElement("summary");
                  techSum.textContent = "Technické vysvětlení";
                  techWrap.appendChild(techSum);
                  detailInner.appendChild(techWrap);
                }
                var techDl = techWrap.querySelector("dl");
                if (!techDl) { techDl = document.createElement("dl"); techDl.className = "iu-nakup-ceny-detail-rows"; techWrap.appendChild(techDl); }
                while (techDl.firstChild) techDl.removeChild(techDl.firstChild);
                for (var tr = 0; tr < model.technicalRows.length; tr++) {
                  var tp = model.technicalRows[tr];
                  var tdt = document.createElement("dt");
                  tdt.textContent = tp.label + ":";
                  var tdd = document.createElement("dd");
                  tdd.textContent = tp.value;
                  techDl.appendChild(tdt);
                  techDl.appendChild(tdd);
                }
              } else if (techWrap) techWrap.remove();
              var discP = detailEl.querySelector(".iu-nakup-ceny-detail-disclaimer");
              if (discP) discP.textContent = model.disclaimerText;
            }
            detailEl.hidden = true;
          }
        }
        resultsBlock.hidden = false;
      }
    }
    try {
      var lastList = localStorage.getItem(IU_SHOPPING_LAST_LIST_KEY);
      if (lastList && typeof lastList === "string") {
        input.value = lastList;
      }
    } catch (_) {}
    function setError(msg) {
      errorEl.textContent = msg || "";
      if (msg && msg.length > 0) {
        errorEl.removeAttribute("hidden");
        try { errorEl.scrollIntoView({ block: "nearest", behavior: "auto" }); } catch (_) {}
      }
    }
    function isValid(val) {
      var t = (val || "").trim();
      if (t.length < 3) return false;
      return /[a-zA-Z\u00e1\u00e9\u00ed\u00f3\u00fa\u00fd\u010d\u010f\u011b\u0148\u0159\u0161\u0165\u016f\u017e]/.test(t);
    }
    function onPrimaryClick() {
      var inp = shell.querySelector(".iu-nakup-ceny-input");
      var errElNow = shell.querySelector(".iu-nakup-ceny-error");
      var vasTextNow = shell.querySelector(".iu-nakup-ceny-vas-nakup-text");
      var vasBlockNow = shell.querySelector(".iu-nakup-ceny-vas-nakup");
      if (!inp || !errElNow || !vasTextNow || !vasBlockNow) return;
      var val = (inp.value || "").trim();
      if (val === "") {
        errElNow.textContent = "Zadejte prosím seznam nákupu.";
        errElNow.removeAttribute("hidden");
        try { errElNow.scrollIntoView({ block: "nearest", behavior: "auto" }); } catch (_) {}
        return;
      }
      if (!isValid(val)) {
        errElNow.textContent = "Zadaný seznam nákupu není platný.";
        errElNow.removeAttribute("hidden");
        try { errElNow.scrollIntoView({ block: "nearest", behavior: "auto" }); } catch (_) {}
        return;
      }
      var parsed = iuParseShoppingList(val);
      if (!parsed.items || parsed.items.length === 0) {
        errElNow.textContent = "Zadaný seznam nákupu není platný.";
        errElNow.removeAttribute("hidden");
        try { errElNow.scrollIntoView({ block: "nearest", behavior: "auto" }); } catch (_) {}
        return;
      }
      errElNow.textContent = "";
      vasTextNow.textContent = val;
      vasBlockNow.hidden = false;
      vasBlockNow.removeAttribute("hidden");
      hideClarify();
      try {
        localStorage.setItem(IU_SHOPPING_LAST_LIST_KEY, val);
      } catch (_) {}
      if (parsed.clarificationNeeded) {
        var uncertain = parsed.items.filter(function(it) { return !it.recognized; });
        showClarify(uncertain);
      } else {
        showAddressStep();
      }
      try { vasBlockNow.scrollIntoView({ block: "nearest", behavior: "auto" }); } catch (_) {}
    }
    shell.addEventListener("click", function(e) {
      var t = e.target && e.target.nodeType === 3 ? e.target.parentElement : e.target;
      if (!t || !t.closest) return;
      if (t.closest(".iu-nakup-ceny-btn-primary")) onPrimaryClick();
    });
    btnSecondary.addEventListener("click", function() {
      input.value = "";
      setError("");
      vasNakupBlock.hidden = true;
      vasNakupText.textContent = "";
      hideClarify();
      hideAddressStep();
      hideResults();
    });
    if (btnUseDefaults) btnUseDefaults.addEventListener("click", function() {
      hideClarify();
      showAddressStep();
    });
    if (btnEditItems) btnEditItems.addEventListener("click", function() {
      hideClarify();
      vasNakupBlock.hidden = true;
      hideAddressStep();
    });
    input.addEventListener("input", function() {
      setError("");
    });
    function setAddrError(msg) {
      if (addrErrors) addrErrors.textContent = msg || "";
    }
    function validateCzechPsc(psc) {
      var s = (psc || "").replace(/\s/g, "");
      return /^\d{5}$/.test(s);
    }
    if (btnConfirmAddr && uliceInp && mestoInp && pscInp) btnConfirmAddr.addEventListener("click", function() {
      var ulice = (uliceInp.value || "").trim();
      var mesto = (mestoInp.value || "").trim();
      var psc = (pscInp.value || "").trim().replace(/\s/g, "");
      setAddrError("");
      if (ulice === "") {
        setAddrError("Zadejte prosím ulici a číslo.");
        return;
      }
      if (mesto === "") {
        setAddrError("Zadejte prosím město.");
        return;
      }
      if (psc === "") {
        setAddrError("Zadejte prosím PSČ.");
        return;
      }
      if (!/^\d{5}$/.test(psc)) {
        setAddrError("PSČ musí být 5 číslic (např. 123 45).");
        return;
      }
      var normalized = iuNakupNormalizeAddress({ ulice: ulice, mesto: mesto, psc: psc });
      if (normalized && saveAddrCb && saveAddrCb.checked) {
        try {
          localStorage.setItem(IU_SHOPPING_DELIVERY_ADDRESS_KEY, JSON.stringify({ street: normalized.street, city: normalized.city, postalCode: normalized.postalCode, country: normalized.country }));
        } catch (_) {}
      }
      if (savedAddrText) savedAddrText.textContent = formatAddress(normalized || { ulice: ulice, mesto: mesto, psc: psc });
      if (addressForm) addressForm.hidden = true;
      if (savedAddressBlock) savedAddressBlock.hidden = false;
      showResults();
    });
    if (btnUseAddr) btnUseAddr.addEventListener("click", function() {
      showResults();
    });
    if (btnChangeAddr && savedAddressBlock && addressForm && uliceInp && mestoInp && pscInp) btnChangeAddr.addEventListener("click", function() {
      savedAddressBlock.hidden = true;
      addressForm.hidden = false;
      var saved = getSavedAddress();
      if (saved) {
        uliceInp.value = saved.ulice || "";
        mestoInp.value = saved.mesto || "";
        pscInp.value = saved.psc || "";
        setAddrError("");
      } else {
        uliceInp.value = "";
        mestoInp.value = "";
        pscInp.value = "";
      }
      setAddrError("");
    });
    if (uliceInp) uliceInp.addEventListener("input", function() { setAddrError(""); });
    if (mestoInp) mestoInp.addEventListener("input", function() { setAddrError(""); });
    if (pscInp) pscInp.addEventListener("input", function() { setAddrError(""); });
    if (resultsBlock) resultsBlock.addEventListener("click", function(e) {
      var target = e.target && e.target.closest ? e.target.closest(".iu-nakup-ceny-btn-edit-address") : null;
      if (target && target.classList && target.classList.contains("iu-nakup-ceny-btn-edit-address")) {
        hideResults();
        if (savedAddressBlock) savedAddressBlock.hidden = true;
        if (addressForm) addressForm.hidden = false;
        return;
      }
      var btn = (e.target && e.target.closest) ? e.target.closest(".iu-nakup-ceny-btn-detail") : e.target;
      if (btn && btn.classList && btn.classList.contains("iu-nakup-ceny-btn-detail")) {
        var card = btn.closest && btn.closest(".iu-nakup-ceny-provider-card");
        if (card) {
          var detail = card.querySelector(".iu-nakup-ceny-provider-detail");
          if (detail) detail.hidden = !detail.hidden;
        }
      }
    });
  }

  function iuPdfConvertToolsBootstrap(quick) {
    const root = quick && quick.querySelector("[data-iu=\"pdfconvert-tools\"]");
    if (!root) return;
    const tabWord = root.querySelector("[data-iu=\"tab-word\"]");
    const tabText = root.querySelector("[data-iu=\"tab-text\"]");
    const panelWord = root.querySelector("[data-iu=\"tab-word-panel\"]");
    const panelText = root.querySelector("[data-iu=\"tab-text-panel\"]");
    const docxInput = root.querySelector("[data-iu=\"pdf-docx-input\"]");
    const wordFileBtn = document.getElementById("iuWordFileBtn");
    const wordFileLabel = document.getElementById("iuWordFileLabel");
    const docxBtn = root.querySelector("[data-iu=\"pdf-download-convert\"]");
    const textInput = root.querySelector("[data-iu=\"pdf-text-input\"]");
    const textBtn = root.querySelector("[data-iu=\"pdf-text-generate\"]");
    const wordHtmlWrapper = root.querySelector("[data-iu=\"pdf-word-html\"]");
    if (wordFileBtn && docxInput) wordFileBtn.addEventListener("click", function() { docxInput.click(); });
    if (docxInput) docxInput.addEventListener("change", function() {
      var hasFile = docxInput.files && docxInput.files.length > 0;
      if (wordFileLabel) wordFileLabel.textContent = hasFile ? docxInput.files[0].name : "Žádný soubor nebyl vybrán";
      if (docxBtn) docxBtn.disabled = !hasFile;
      updateShareConvertButton();
    });
    if (tabWord && panelWord) tabWord.addEventListener("click", function() {
      if (tabText && panelText) { tabText.setAttribute("aria-selected", "false"); panelText.hidden = true; }
      tabWord.setAttribute("aria-selected", "true"); panelWord.hidden = false;
      if (typeof window._iuPdfWordTabActivated === "undefined") window._iuPdfWordTabActivated = true;
      loadMammothIfNeeded();
    });
    if (tabText && panelText) tabText.addEventListener("click", function() {
      if (tabWord && panelWord) { tabWord.setAttribute("aria-selected", "false"); panelWord.hidden = true; }
      tabText.setAttribute("aria-selected", "true"); panelText.hidden = false;
    });
    var shareConvertBtn = root.querySelector("[data-iu=\"pdf-share-convert\"]");
    var canShareFiles = !!(typeof navigator !== "undefined" && navigator.canShare && navigator.canShare({ files: [new File([], "x.pdf", { type: "application/pdf" })] }));
    var shareUnsupportedEl = document.getElementById("iuPdfShareUnsupported");
    function updateShareConvertButton() {
      if (!shareConvertBtn) return;
      var hasFile = docxInput && docxInput.files && docxInput.files.length > 0;
      shareConvertBtn.disabled = !hasFile || !canShareFiles;
      shareConvertBtn.title = canShareFiles ? "Převést a sdílet PDF" : "Sdílení není podporováno";
      if (shareUnsupportedEl) shareUnsupportedEl.style.display = canShareFiles ? "none" : "inline";
    }
    function loadScript(src, cb) {
      var s = document.createElement("script");
      s.src = (/^\//.test(src) ? "" : "/") + src;
      s.onload = function() { if (typeof cb === "function") cb(); };
      s.onerror = function() { if (typeof cb === "function") cb(new Error("load failed")); };
      document.head.appendChild(s);
    }
    var vendorBase = "/assets/vendor";
    var fontUrl = "/assets/fonts/noto-sans-latin-ext-400-normal.ttf";
    var pdfLibFontBytes = null;
    function loadPdfLibAndFont(cb) {
      if (pdfLibFontBytes) { cb(null, pdfLibFontBytes); return; }
      if (typeof window.PDFLib === "undefined") {
        loadScript(vendorBase + "/pdf-lib.min.js", function(err) {
          if (err || typeof window.PDFLib === "undefined") { cb(err || new Error("pdf-lib")); return; }
          loadScript(vendorBase + "/fontkit.umd.js", function(err2) {
            if (err2 || typeof window.fontkit === "undefined") { cb(err2 || new Error("fontkit")); return; }
            fetch(fontUrl).then(function(r) { return r.arrayBuffer(); }).then(function(ab) { pdfLibFontBytes = ab; cb(null, ab); }).catch(function(e) { cb(e); });
          });
        });
      } else if (typeof window.fontkit === "undefined") {
        loadScript(vendorBase + "/fontkit.umd.js", function(err2) {
          if (err2 || typeof window.fontkit === "undefined") { cb(err2 || new Error("fontkit")); return; }
          fetch(fontUrl).then(function(r) { return r.arrayBuffer(); }).then(function(ab) { pdfLibFontBytes = ab; cb(null, ab); }).catch(function(e) { cb(e); });
        });
      } else {
        fetch(fontUrl).then(function(r) { return r.arrayBuffer(); }).then(function(ab) { pdfLibFontBytes = ab; cb(null, ab); }).catch(function(e) { cb(e); });
      }
    }
    function normalizePdfText(t) {
      return (t || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\t/g, "    ");
    }
    function iuPdfTextHash(s) {
      var h = 2166136261;
      for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    }
    function iuPdfGenerateFromPlainText(text, opts, done) {
      opts = opts || {};
      var normalized = normalizePdfText(text);
      var forRender = normalized.length ? normalized : " ";
      window._iuPdfLastTextHash = iuPdfTextHash(normalized);
      if (opts.source === "word") {
        window._iuPdfLastSource = "word";
        window._iuPdfLastTextLen = forRender.length;
      } else {
        window._iuPdfLastSource = "text";
        window._iuPdfLastTextLen = forRender.length;
      }
      loadPdfLibAndFont(function(err, fontBytes) {
        if (err || !fontBytes) { done(err); return; }
        var PDFLib = window.PDFLib;
        var fontkit = window.fontkit;
        if (!PDFLib || !fontkit) { done(new Error("PDFLib")); return; }
        PDFLib.PDFDocument.create().then(function(pdfDoc) {
          pdfDoc.registerFontkit(fontkit);
          return pdfDoc.embedFont(fontBytes).then(function(customFont) {
            var fontSize = 11;
            var marginPt = 40;
            var pageW = 595.28 - marginPt * 2;
            var lineHeight = fontSize * 1.25;
            var y = marginPt;
            var lines = forRender.split(/\n/);
            var page = pdfDoc.addPage([595.28, 841.89]);
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              if (line === undefined || line === "") line = " ";
              var chunks = [];
              var rest = line;
              while (rest.length > 0) {
                var w = customFont.widthOfTextAtSize(rest, fontSize);
                if (w <= pageW) { chunks.push(rest); rest = ""; continue; }
                var low = 0, high = rest.length;
                while (low < high - 1) {
                  var mid = Math.ceil((low + high) / 2);
                  if (customFont.widthOfTextAtSize(rest.substring(0, mid), fontSize) <= pageW) low = mid; else high = mid;
                }
                var lastSpace = rest.lastIndexOf(" ", low);
                var cut = (lastSpace > 0) ? lastSpace : Math.max(1, low);
                chunks.push(rest.substring(0, cut).trim() || rest.substring(0, 1));
                rest = rest.substring(cut).trim();
              }
              for (var k = 0; k < chunks.length; k++) {
                if (y + lineHeight > 841.89 - marginPt) { page = pdfDoc.addPage([595.28, 841.89]); y = marginPt; }
                page.drawText(chunks[k], { x: marginPt, y: 841.89 - y, size: fontSize, font: customFont });
                y += lineHeight;
              }
            }
            return pdfDoc.save();
          });
        }).then(function(bytes) {
          window._iuPdfLastEngine = "pdf-lib+ttf-unicode-v2";
          var blob = new Blob([bytes], { type: "application/pdf" });
          window._iuPdfLastPdfBytes = blob.size;
          done(null, { blob: blob, fileName: opts.fileName || "document.pdf" });
        }).catch(function(e) { done(e); });
      });
    }
    var mammothLoaded = false;
    function loadMammothIfNeeded(cb) {
      if (typeof window.mammoth !== "undefined") { mammothLoaded = true; if (typeof cb === "function") cb(); return; }
      if (mammothLoaded) { if (typeof cb === "function") cb(); return; }
      loadScript(vendorBase + "/mammoth.browser.min.js", function() { mammothLoaded = true; if (typeof cb === "function") cb(); });
    }
    var html2pdfLoaded = false;
    function loadHtml2PdfIfNeeded(cb) {
      if (typeof window.html2pdf !== "undefined") { html2pdfLoaded = true; if (typeof cb === "function") cb(); return; }
      if (html2pdfLoaded) { if (typeof cb === "function") cb(); return; }
      loadScript(vendorBase + "/html2pdf.bundle.min.js", function() { html2pdfLoaded = true; if (typeof cb === "function") cb(); });
    }
    function showWordPdfError(msg) {
      var ra = document.querySelector("#iuQuickFeed [data-iu=\"pdf-word-result-actions\"]");
      if (ra) { ra.textContent = msg || ""; ra.hidden = !msg; }
    }
    function iuGenerateWordPdfBlobFromSelectedDocx(file) {
      window._iuPdfLastWordError = null;
      return new Promise(function(resolve, reject) {
        if (!file) { window._iuPdfLastWordError = "no file"; reject(new Error("no file")); return; }
        loadMammothIfNeeded(async function() {
          if (typeof window.mammoth === "undefined") { window._iuPdfLastWordError = "mammoth"; reject(new Error("mammoth")); return; }
          var ab;
          try { ab = await file.arrayBuffer(); } catch (e) {
            window._iuPdfLastWordError = String(e && (e.message || e));
            window._iuPdfLastSource = "word";
            window._iuPdfLastWordMode = "word-text-fallback";
            iuPdfGenerateFromPlainText("Dokument se nepodařilo přečíst.", { source: "word", fileName: "document.pdf" }, function(err, out) {
              if (err || !out || !out.blob) { reject(err || new Error("pdf")); return; }
              window._iuPdfLastPdfBytes = out.blob.size;
              resolve(out);
            });
            return;
          }
          window._iuPdfLastSource = "word";
          window._iuPdfLastWordMode = "word-pending";
          function isZipMagic(buffer) {
            if (!buffer || buffer.byteLength < 4) return false;
            var u8 = new Uint8Array(buffer);
            return u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04;
          }
          function fallbackToPdfMinimal() {
            window._iuPdfLastWordMode = "word-text-fallback";
            iuPdfGenerateFromPlainText("Dokument se nepodařilo přečíst.", { source: "word", fileName: "document.pdf" }, function(err, out) {
              if (err || !out || !out.blob) { reject(err || new Error("pdf")); return; }
              window._iuPdfLastPdfBytes = out.blob.size;
              resolve(out);
            });
          }
          function fallbackToText() {
            window.mammoth.extractRawText({ arrayBuffer: ab }).then(function(r) {
              var raw = (r && r.value) ? String(r.value) : "";
              var text = normalizePdfText(raw);
              if (!text || /^\s*$/.test(text)) { window._iuPdfLastWordError = "empty"; reject(new Error("empty")); return; }
              window._iuPdfLastWordMode = "word-text-fallback";
              iuPdfGenerateFromPlainText(text, { source: "word", fileName: "document.pdf" }, function(err, out) {
                if (err || !out || !out.blob) {
                  window._iuPdfLastWordError = String(err && (err.stack || err.message || err));
                  reject(err || new Error("pdf"));
                } else {
                  window._iuPdfLastPdfBytes = out.blob ? out.blob.size : 0;
                  resolve(out);
                }
              });
            }).catch(function(e) {
              window._iuPdfLastWordError = String(e && (e.stack || e.message || e));
              fallbackToPdfMinimal();
            });
          }
          if (!isZipMagic(ab)) { fallbackToPdfMinimal(); return; }
          var convertImage = window.mammoth.images && window.mammoth.images.inline
            ? window.mammoth.images.inline(function(image) {
                return image.read("base64").then(function(base64) {
                  return { src: "data:" + (image.contentType || "image/png") + ";base64," + base64 };
                });
              })
            : undefined;
          var convertPromise = window.mammoth.convertToHtml({ arrayBuffer: ab }, convertImage ? { convertImage: convertImage } : {});
          var timeoutPromise = new Promise(function(_, rej) { setTimeout(function() { rej(new Error("timeout")); }, 60000); });
          Promise.race([convertPromise, timeoutPromise]).then(function(result) {
              var html = (result && result.value) ? String(result.value) : "";
              if (!html || /^\s*$/.test(html)) { fallbackToText(); return; }
              if (html.length < 50) { fallbackToText(); return; }
              var hasImg = /<img\b/i.test(html);
              var hasTable = /<table\b/i.test(html);
              var textLen = (html.replace(/<[^>]+>/g, "").trim()).length;
              if (!hasImg && !hasTable && (!textLen || /^\s*$/.test(html.replace(/<[^>]+>/g, "")))) { fallbackToText(); return; }
              window._iuPdfWordExportV = "word-export-offscreen-v1";
              var exportRoot = document.createElement("div");
              exportRoot.setAttribute("data-iu", "pdf-export-root");
              exportRoot.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:auto;overflow:visible;background:#fff;color:#000;z-index:-1;pointer-events:none;box-sizing:border-box;padding:12px;font-family:system-ui,-apple-system,sans-serif;";
              document.body.appendChild(exportRoot);
              exportRoot.innerHTML = html;
              exportRoot.style.maxHeight = "none";
              exportRoot.style.height = "auto";
              exportRoot.style.overflow = "visible";
              var cs = window.getComputedStyle ? window.getComputedStyle(exportRoot) : {};
              var exportRootCss = { overflow: exportRoot.style.overflow || cs.overflow || "", height: exportRoot.style.height || cs.height || "", maxHeight: exportRoot.style.maxHeight || cs.maxHeight || "", position: cs.position || "", widthPx: exportRoot.scrollWidth || 0 };
              var imgCount = 0;
              var imgLoadedOk = 0;
              var imgLoadedFail = 0;
              var imgs = exportRoot.querySelectorAll ? exportRoot.querySelectorAll("img") : [];
              imgCount = imgs.length;
              function safeFontsReady() {
                try {
                  var r = document && document.fonts && document.fonts.ready;
                  if (r && typeof r.then === "function") {
                    return r.catch(function(){});
                  }
                } catch(e){}
                return Promise.resolve();
              }
              function waitImagesAndFonts(thenExport) {
                if (imgCount === 0) {
                  safeFontsReady().then(thenExport);
                  return;
                }
                var done = 0;
                function onImg() {
                  done++;
                  if (done === imgCount) {
                    for (var j = 0; j < imgs.length; j++) {
                      if (imgs[j].naturalWidth > 0) imgLoadedOk++; else imgLoadedFail++;
                    }
                    safeFontsReady().then(thenExport);
                  }
                }
                for (var i = 0; i < imgs.length; i++) {
                  var img = imgs[i];
                  if (img.complete) onImg(); else { img.onload = onImg; img.onerror = onImg; }
                }
              }
              waitImagesAndFonts(function() {
                if (hasImg && imgLoadedFail > 0) {
                  if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
                  fallbackToText();
                  return;
                }
                loadHtml2PdfIfNeeded(function() {
                  if (typeof window.html2pdf === "undefined") {
                    if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
                    fallbackToText();
                    return;
                  }
                  var opts = {
                    image: { type: "png", quality: 1.0 },
                    html2canvas: { scale: 2, scrollX: 0, scrollY: 0, windowWidth: exportRoot.scrollWidth, windowHeight: exportRoot.scrollHeight, useCORS: false, backgroundColor: "#ffffff" },
                    jsPDF: { unit: "pt", format: "a4", orientation: "portrait" },
                    pagebreak: { mode: ["css", "legacy"] }
                  };
                  var scrollH = exportRoot.scrollHeight;
                  var clientH = exportRoot.clientHeight;
                  window.html2pdf().set(opts).from(exportRoot).toPdf().outputPdf("blob").then(function(blob) {
                    if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
                    if (!blob || blob.size < 5000) { fallbackToText(); return; }
                    window._iuPdfLastWordMode = "word-html2pdf";
                    window._iuPdfLastWordHtmlStats = { hasImg: hasImg, hasTable: hasTable, htmlLen: html.length, textLen: textLen, imgCount: imgCount, imgLoadedOk: imgLoadedOk, imgLoadedFail: imgLoadedFail, exportRootScrollH: scrollH, exportRootClientH: clientH, exportRootCss: exportRootCss };
                    window._iuPdfLastPdfBytes = blob.size;
                    window._iuPdfLastWordError = null;
                    resolve({ blob: blob, fileName: "document.pdf" });
                  }).catch(function(e) {
                    if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot);
                    window._iuPdfLastWordError = String(e && (e.stack || e.message || e));
                    fallbackToText();
                  });
                });
              });
            }).catch(function(e) {
              window._iuPdfLastWordError = String(e && (e.stack || e.message || e));
              fallbackToText();
            });
        });
      });
    }
    function doDocxConvert(file, action) {
      action = action || "download";
      showWordPdfError("");
      loadMammothIfNeeded(function() {
        if (typeof window.mammoth === "undefined") { showWordPdfError("Převod není k dispozici."); return; }
        iuGenerateWordPdfBlobFromSelectedDocx(file).then(function(out) {
          showWordPdfError("");
          if (action === "share") {
            var f = new File([out.blob], out.fileName || "document.pdf", { type: "application/pdf" });
            if (navigator.canShare && navigator.canShare({ files: [f] })) navigator.share({ files: [f] }).catch(function() {});
          } else {
            var url = URL.createObjectURL(out.blob);
            var a = document.createElement("a"); a.href = url; a.download = out.fileName || "document.pdf"; a.click();
            setTimeout(function() { URL.revokeObjectURL(url); }, 500);
          }
        }).catch(function(err) {
          window._iuPdfLastWordMode = "word-error";
          window._iuPdfLastWordError = String(err && (err.stack || err.message || err));
          window._iuPdfLastPdfBytes = 0;
          if (String(err && err.message) === "empty") showWordPdfError("Dokument je prázdný nebo se nepodařilo přečíst text.");
          else if (String(err && err.message) === "read") showWordPdfError("Soubor nelze přečíst. Zkuste jiný .docx soubor.");
          else showWordPdfError("Generování PDF selhalo.");
        });
      });
    }
    if (textBtn && textInput) textBtn.addEventListener("click", function() {
      var text = textInput.value;
      iuPdfGenerateFromPlainText(text, { source: "text", fileName: "text.pdf" }, function(err, out) {
        if (err || !out || !out.blob) return;
        var url = URL.createObjectURL(out.blob);
        var a = document.createElement("a"); a.href = url; a.download = out.fileName || "text.pdf"; a.click();
        setTimeout(function() { URL.revokeObjectURL(url); }, 500);
      });
    });
    if (docxBtn && docxInput) docxBtn.addEventListener("click", function() {
      var file = docxInput.files && docxInput.files[0];
      if (!file) return;
      doDocxConvert(file, "download");
    });
    if (shareConvertBtn && docxInput) shareConvertBtn.addEventListener("click", function() {
      var file = docxInput.files && docxInput.files[0];
      if (!file || shareConvertBtn.disabled) return;
      doDocxConvert(file, "share");
    });
    updateShareConvertButton();
  }

  function iuApplyMobileQuickFeedLayout(quick) {
    try {
      if (!quick) return;
      const isMobile = !!(window.matchMedia && window.matchMedia("(max-width: 1023px)").matches);
      if (!isMobile) return;
      const head = quick.querySelector(".iuQHead");
      const title = quick.querySelector(".iuQTitle");
      const actions = quick.querySelector(".iuQHeadActions");
      const close = quick.querySelector(".iuQHeadActions #iuQCloseBtn, .iuQHeadActions .iuQClose");
      const secondary = quick.querySelector(".iuQHeadActions .iuAiShareBtn, .iuQHeadActions .iuTrHeaderPreposlat");
      const bodyCard = quick.querySelector(".iuQCard");
      if (head) {
        head.style.setProperty("display", "grid");
        head.style.setProperty("grid-template-columns", "minmax(0, 1fr) auto");
        head.style.setProperty("align-items", "flex-start");
        head.style.setProperty("gap", "8px");
        head.style.setProperty("margin", "8px 0 12px");
      }
      if (title) {
        title.style.setProperty("min-width", "0");
        title.style.setProperty("font-size", "20px");
        title.style.setProperty("line-height", "1.3");
      }
      if (actions) {
        actions.style.setProperty("display", "inline-flex");
        actions.style.setProperty("align-items", "flex-start");
        actions.style.setProperty("flex-wrap", "nowrap");
        actions.style.setProperty("gap", "8px");
        actions.style.setProperty("margin-left", "auto");
      }
      if (secondary) {
        secondary.style.setProperty("margin", "0");
        secondary.style.setProperty("white-space", "nowrap");
      }
      if (close) {
        close.style.setProperty("width", "32px");
        close.style.setProperty("height", "32px");
        close.style.setProperty("min-width", "32px");
        close.style.setProperty("min-height", "32px");
        close.style.setProperty("padding", "0");
        close.style.setProperty("display", "inline-flex");
        close.style.setProperty("align-items", "center");
        close.style.setProperty("justify-content", "center");
      }
      if (bodyCard) bodyCard.style.setProperty("padding", "14px 12px 16px");
    } catch (_) {}
  }

  function iuShowQuickFeedCore(key){
    if (typeof window.__iuDebugRca === "undefined") window.__iuDebugRca = (typeof location !== "undefined" && location.search || "").indexOf("iuDebug=1") !== -1;
    if (window.__iuDebugRca) console.log("[iuShowQuickFeed] key=", key);
    const keyNorm = String(key || "").trim().toLowerCase();
    const stage = document.getElementById("iuCenterStage");
    const quick = document.getElementById("iuQuickFeed");
    if (!stage || !quick) return;
    try { quick.style.removeProperty("display"); } catch (_) {}
    const isMobileGateToolsOpen = (() => {
      try {
        const wrap = document.getElementById("iuMobileGateWrap");
        const toolsPanel = document.getElementById("iuMobileGatePanelTools");
        if (!wrap || !toolsPanel) return false;
        const isMobile = !!(window.matchMedia && window.matchMedia("(max-width: 900px)").matches);
        return isMobile && wrap.getAttribute("data-iu-mobile-gate") === "tools" && !toolsPanel.hidden;
      } catch (_) { return false; }
    })();
    const isMobileMindMenuFlowSource = (() => {
      try {
        const isMobile = !!(window.matchMedia && window.matchMedia("(max-width: 900px)").matches);
        const flow = document.getElementById("iuMobileMindMenuFlow");
        const aside = document.querySelector(".layout > aside.accordionCol");
        const fromFlow = !!(flow && flow.contains(document.activeElement));
        const fromAside = !!(aside && aside.contains(document.activeElement));
        return isMobile && (fromFlow || fromAside);
      } catch (_) { return false; }
    })();
    const isMobileOverlayScope = isMobileGateToolsOpen || isMobileMindMenuFlowSource;
    if (keyNorm === "nakup" || keyNorm === "shopping") {
      // Feature removed intentionally: keep route inert and avoid any open/lock side effects.
      return;
    }
    if (keyNorm === "banka" || keyNorm === "bakalari" || keyNorm === "pojistovna") {
      const titles = { banka: "Banka", bakalari: "Bakaláři", pojistovna: "Zdravotní pojišťovna" };
      stage.setAttribute("data-iu-view", "quick");
      quick.hidden = false;
      try {
        if (isMobileOverlayScope) {
          document.documentElement.style.overflow = "hidden";
          document.body.style.overflow = "hidden";
          document.body.classList.add("iu-modal-open", "iu-quickFeedOpen", "iu-mobileGateToolsQuickOpen");
        }
      } catch (_) {}
      quick.innerHTML = "<div class=\"iuQHead\"><div class=\"iuQTitle\">" + iuQfEscape(titles[keyNorm] || keyNorm) + "</div><div class=\"iuQHeadActions\"><button class=\"iuQClose\" type=\"button\" id=\"iuQCloseBtn\" aria-label=\"Zavřít\">×</button></div></div><div class=\"iuQCard\" id=\"iuQuickFeedMojeSluzbyBody\"></div>";
      const body = document.getElementById("iuQuickFeedMojeSluzbyBody");
      if (body && typeof window.iuRenderMojeSluzbyInQuickFeed === "function") window.iuRenderMojeSluzbyInQuickFeed(keyNorm, body);
      const closeBtn = document.getElementById("iuQCloseBtn");
      if (closeBtn) closeBtn.addEventListener("click", function() { quick.hidden = true; stage.removeAttribute("data-iu-view"); });
      iuApplyMobileQuickFeedLayout(quick);
      return;
    }
    const data = (window.IU_QUICK_FEEDS || {})[keyNorm];
    if (!data) return;
    stage.setAttribute("data-iu-view", "quick");
    quick.hidden = false;
    try {
      document.body.classList.add("iu-quickFeedOpen");
      if (isMobileOverlayScope) {
        document.documentElement.style.overflow = "hidden";
        document.body.style.overflow = "hidden";
        document.body.classList.add("iu-modal-open", "iu-mobileGateToolsQuickOpen");
      }
    } catch (_) {}
    const isTranslator = String(key || "").toLowerCase() === "deepl";
    const isConvert = String(key || "").toLowerCase() === "convert";
    const useFullCard = ["ai", "deepl", "convert"].includes(String(key || "").toLowerCase());

    if (isTranslator) {
      quick.innerHTML = `
        <div class="iuQHead">
          <div class="iuQTitle">${iuQfEscape(data.title)}</div>
          <div class="iuQHeadActions"><button type="button" class="iuTrHeaderPreposlat" id="iuTrHeaderPreposlat" aria-label="Přeposlat">PŘEPOSLAT</button><button class="iuQClose" type="button" id="iuQCloseBtn" aria-label="Zavřít">✕</button></div>
        </div>
        <div class="iuQCard">
          <div class="iuQGrid">
            ${(data.items || []).map(it => `<a class="iuAiCard iuTrCard" data-tr-id="${iuQfEscape(it.id || it.name || "")}" href="${iuQfEscape(it.baseUrl || it.url || "#")}" target="_blank" rel="noopener noreferrer">
              <div class="iuAiInner">
                <div class="iuAiName">${iuQfEscape(it.name)}</div>
                ${it.desc ? `<div class="iuAiDesc">${iuQfEscape(it.desc)}</div>` : ""}
              </div>
            </a>`).join("")}
          </div>
        </div>
        <div class="iuNotes" data-iu-notes data-iu-notes-key="translator">
          <div class="iuNotesHead">
            <div class="iuNotesTitle">Poznámky</div>
          </div>
          <textarea class="iuNotesText" data-iu-notes-text placeholder="Sem si napiš poznámku…"></textarea>
          <div class="iuNotesActions">
            <button type="button" class="iuNotesBtn" data-iu-notes-copy>Zkopírovat</button>
            <button type="button" class="iuNotesBtn" data-iu-notes-clear>Vyčistit</button>
          </div>
          <div class="iuNotesSendBar" data-iu-notes-sendbar hidden>
            <button type="button" class="iuNotesSendOpt" data-iu-notes-send-wa>WhatsApp</button>
            <button type="button" class="iuNotesSendOpt" data-iu-notes-send-mail>E-mail</button>
            <button type="button" class="iuNotesSendOpt" data-iu-notes-send-copy>Kopírovat pro odeslání</button>
          </div>
          <div class="iuNotesStatus" data-iu-notes-status hidden></div>
        </div>
        <section class="iuSeoText" aria-label="SEO text – Překladač">
          <h2>Překladač online – překlad angličtiny, němčiny i dalších jazyků</h2>
          <p>
            Sekce Překladač na infoUzel.cz umožňuje rychlé přesměrování na známé
            online překladače jako Google Překladač, DeepL, Seznam Překladač
            a další jazykové nástroje. Můžete tak snadno přeložit texty
            z angličtiny do češtiny, z češtiny do němčiny,
            nebo mezi desítkami dalších jazyků.
          </p>
          <p>
            infoUzel.cz funguje jako rozcestník – po kliknutí na překladač
            se otevře oficiální stránka služby v nové kartě.
            Můžete porovnat více překladačů a vybrat ten,
            který vám dává nejlepší překlad.
          </p>
          <h3>Co v sekci Překladač najdete</h3>
          <ul>
            <li>Google Překladač – rychlé překlady vět a webových stránek</li>
            <li>DeepL – velmi přesné překlady textů</li>
            <li>Seznam Překladač – překlady s podporou češtiny</li>
            <li>Další nástroje pro překlad dokumentů a vět</li>
          </ul>
          <h3>FAQ</h3>
          <p><strong>Překládá infoUzel.cz text přímo?</strong><br>
          Ne. infoUzel.cz pouze odkazuje na oficiální překladače,
          které se otevřou v nové kartě.</p>
        </section>
        <div class="iuTranslatorVideos" aria-label="Návody k překladačům">
          <div class="iu-video"><iframe src="https://www.youtube-nocookie.com/embed/JVlSxtcMqPs?rel=0&amp;modestbranding=1" title="Jak používat DeepL" loading="lazy" allowfullscreen></iframe></div>
          <div class="iu-video"><iframe src="https://www.youtube-nocookie.com/embed/I2BtZBrbh8Y?rel=0&amp;modestbranding=1" title="Jak používat Google Translate" loading="lazy" allowfullscreen></iframe></div>
          <div class="iu-video"><iframe src="https://www.youtube-nocookie.com/embed/4swsd1JHxhM?rel=0&amp;modestbranding=1" title="Jak používat Microsoft Translator" loading="lazy" allowfullscreen></iframe></div>
          <div class="iu-video"><iframe src="https://www.youtube-nocookie.com/embed/8vTb4Lhd5cA?rel=0&amp;modestbranding=1" title="Jak používat Seznam Slovník" loading="lazy" allowfullscreen></iframe></div>
          <div class="iu-video"><iframe src="https://www.youtube-nocookie.com/embed/IHlkhnhRsZI?rel=0&amp;modestbranding=1" title="Jak používat Linguee" loading="lazy" allowfullscreen></iframe></div>
        </div>
      `;
      iuTrInit(quick, data);
      iuTrNotesBootstrap(quick);
      const preposlatBtn = document.getElementById("iuTrHeaderPreposlat");
      if (preposlatBtn) {
        preposlatBtn.addEventListener("click", iuForwardActionSameAsTranslator);
      }
    } else {
      const isAi = (key || "").toLowerCase() === "ai";
      const shareBtnHtml = (isAi || isConvert) ? `<button type="button" class="iuAiShareBtn iuQClose" aria-label="Přeposlat" title="Přeposlat">Přeposlat</button>` : "";
      const aiSeoBlock = isAi ? `
        <div class="iuFeedSeoBlock iuFeedSeoAI">
          <h2>AI asistenti – přehled nástrojů ChatGPT, Gemini, Copilot a další</h2>
          <p>
            Sekce AI asistenti na infoUzel.cz nabízí přehled známých nástrojů
            pro psaní textů, práci s daty, programování a vyhledávání informací.
            Najdete zde například ChatGPT, Google Gemini, Microsoft Copilot,
            Claude, Perplexity AI, DeepSeek, Grok, Mistral AI a Editee.
          </p>
          <p>
            infoUzel.cz funguje jako rozcestník – po kliknutí se otevře
            oficiální stránka AI nástroje v nové kartě.
            Můžete tak rychle vyzkoušet různé AI služby na jednom místě.
          </p>
          <h3>Co v této sekci najdete</h3>
          <ul>
            <li>AI pro psaní textů – ChatGPT, Claude</li>
            <li>AI od Googlu – Gemini</li>
            <li>AI ve Windows a Office – Microsoft Copilot</li>
            <li>AI pro vyhledávání – Perplexity</li>
            <li>Další nástroje – DeepSeek, Grok, Mistral AI, Editee</li>
          </ul>
        </div>
        <section class="iuAiVideos">
          <h2>AI asistenti – krátké představení</h2>
          <div class="iuAiVideoGrid"></div>
        </section>
      ` : "";
      const renderCards = (items) => {
        const arr = items || data.items || [];
        const isAi = (key || "").toLowerCase() === "ai";
        const isConvertKey = (key || "").toLowerCase() === "convert";
        return arr.map(it => {
          const url = iuQfEscape(it.url || it.baseUrl || "#");
          const ext = (it.external !== false) ? 'target="_blank" rel="noopener noreferrer"' : "";
          const c = it.color || "#1F4B99";
          const style = isAi ? `--aiFeedColor:${CHATGPT_AI_COLOR}` : `--aiColor:${c}`;
          const cardClass = useFullCard ? "iuAiCard" + (isConvertKey ? " iuConvert" : "") : "";
          if (useFullCard) {
            return `<a class="${cardClass}" href="${url}" ${ext} style="${style}">
              <div class="iuAiInner">
                <div class="iuAiName">${iuQfEscape(it.name)}</div>
                ${it.desc ? `<div class="iuAiDesc">${iuQfEscape(it.desc)}</div>` : ""}
              </div>
            </a>`;
          }
          return `<div class="iuQItem">
            <div class="iuQMeta">
              <div class="iuQName">${iuQfEscape(it.name)}</div>
              ${it.desc ? `<div class="iuQDesc">${iuQfEscape(it.desc)}</div>` : ""}
            </div>
            <a class="iuQBtn" href="${url}" ${ext}>Otevřít</a>
          </div>`;
        }).join("");
      };
      const toolsBlock = (data.toolsHtml != null && data.toolsHtml !== "") ? data.toolsHtml : "";
      const doRender = (services) => {
        quick.innerHTML = `
          <div class="iuQHead">
            <div class="iuQTitle">${iuQfEscape(data.title)}</div>
            <div class="iuQHeadActions">${shareBtnHtml}<button class="iuQClose" type="button" id="iuQCloseBtn" aria-label="Zavřít">✕</button></div>
          </div>
          ${toolsBlock}
          <div class="iuQCard">
            <div class="iuQGrid">
              ${renderCards(services || data.items)}
            </div>
          </div>
          ${aiSeoBlock}
        `;
        if (window.__iuDebugRca && keyNorm === "convert") {
          var hasTools = !!quick.querySelector('[data-iu="pdfconvert-tools"]');
          console.log("[iuShowQuickFeed] afterRender hasTools=", hasTools);
          try {
            var mo = new MutationObserver(function(muts) {
              for (var i = 0; i < muts.length; i++) {
                if (muts[i].type === "childList" && muts[i].removedNodes && muts[i].removedNodes.length) {
                  for (var j = 0; j < muts[i].removedNodes.length; j++) {
                    var n = muts[i].removedNodes[j];
                    if (n && n.nodeType === 1 && (n.getAttribute && n.getAttribute("data-iu") === "pdfconvert-tools" || (n.querySelector && n.querySelector("[data-iu=\"pdfconvert-tools\"]")))) console.log("[iuShowQuickFeed] RCA: pdfconvert-tools removed");
                  }
                }
              }
            });
            mo.observe(quick, { childList: true, subtree: true });
            setTimeout(function() { mo.disconnect(); }, 5000);
          } catch (_) {}
        }
        if (isAi) {
          try { renderAiVideos(quick); } catch (e) { console.warn("renderAiVideos", e); }
        }
        if (isConvert) iuPdfConvertToolsBootstrap(quick);
        if (keyNorm === "naceneni") iuNakupCenyBootstrap(quick);
      };
      if (isAi) {
        doRender(data.items);
        const base = (typeof location !== "undefined" && location.pathname || "").toLowerCase().includes("/filtr/") ? "/filtr/projects/" : "/projects/";
        fetch(base + "data/services-ai.json", { cache: "no-store" })
          .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
          .then(services => {
            const arr = Array.isArray(services) ? services : (data.items || []);
            if (arr.length) (window.IU_QUICK_FEEDS || {}).ai = { title: data.title, items: arr };
            doRender(arr);
          })
          .catch(() => {});
      } else {
        doRender(data.items);
        if (isConvert && typeof window.iuForwardActionSameAsTranslator === "function") {
          const convertShareBtn = quick.querySelector(".iuAiShareBtn");
          if (convertShareBtn) {
            convertShareBtn.addEventListener("click", iuForwardActionSameAsTranslator);
          }
        }
      }
    }
    const closeBtn = document.getElementById("iuQCloseBtn");
    iuApplyMobileQuickFeedLayout(quick);
    if (closeBtn) closeBtn.addEventListener("click", iuHideQuickFeed, { once: true });
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
  }

  const IU_TR_PREFILL_LIMIT = 900;
  const IU_TR_DETECT_MIN = 40;

  function iuTrInit(quick, data){
    const textarea = document.getElementById("iuTrText");
    const langEl = document.getElementById("iuTrLang");
    const countEl = document.getElementById("iuTrCount");
    const toastEl = document.getElementById("iuTrToast");
    const copyBtn = document.getElementById("iuTrCopy");
    const clearBtn = document.getElementById("iuTrClear");
    if (!textarea || !langEl || !countEl) return;

    function updateCount(){ const n = (textarea.value || "").length; countEl.textContent = n + " znaků"; }
    function updateLang(){
      const text = (textarea.value || "").trim();
      if (text.length < IU_TR_DETECT_MIN) { langEl.textContent = "Odhad jazyka: —"; return; }
      try {
        const code = (typeof window.franc === "function") ? window.franc(text) : "und";
        langEl.textContent = "Odhad jazyka: " + (code && code !== "und" ? iuTrLangName(code) : "—");
      } catch(e){ langEl.textContent = "Odhad jazyka: —"; }
    }
    function showToast(msg){ if (toastEl) { toastEl.textContent = msg; toastEl.classList.add("iuTrToastVisible"); setTimeout(() => { toastEl.textContent = ""; toastEl.classList.remove("iuTrToastVisible"); }, 3000); } }

    textarea.addEventListener("input", () => { updateCount(); updateLang(); });
    updateCount(); updateLang();

    if (copyBtn) copyBtn.addEventListener("click", async () => {
      const t = textarea.value || "";
      try {
        await navigator.clipboard.writeText(t);
        showToast("Text zkopírován – vlož ho do překladače (Ctrl+V)");
      } catch(e){ showToast("Nepovedlo se zkopírovat – vyber text a dej Ctrl+C"); }
    });
    if (clearBtn) clearBtn.addEventListener("click", () => {
      textarea.value = "";
      updateCount(); updateLang();
    });

    quick.addEventListener("click", async (e) => {
      const card = e.target.closest(".iuTrCard");
      if (!card) return;
      e.preventDefault();
      const trId = card.getAttribute("data-tr-id");
      const item = (data.items || []).find(it => (it.id || it.name) === trId);
      if (!item) { window.open(card.href, "_blank", "noopener,noreferrer"); return; }
      const text = (textarea.value || "").trim();
      const baseUrl = item.baseUrl || item.url || "#";
      if (!text) { window.open(baseUrl, "_blank", "noopener,noreferrer"); return; }
      let from = "auto", to = "cs";
      if (typeof window.franc === "function") {
        try { const iso = window.franc(text); from = (iso && iso !== "und") ? iuTrIsoToUrl(iso) : "en"; } catch(_){ from = "en"; }
      }
      let usePrefill = item.supportsPrefill && text.length <= IU_TR_PREFILL_LIMIT && typeof item.makeUrl === "function";
      if (usePrefill) {
        try { const url = item.makeUrl(text, from, to); window.open(url, "_blank", "noopener,noreferrer"); } catch(err){ usePrefill = false; }
      }
      if (!usePrefill) {
        try { await navigator.clipboard.writeText(text); showToast("Text zkopírován – vlož ho do překladače (Ctrl+V)"); } catch(err){ showToast("Nepovedlo se zkopírovat – vyber text a dej Ctrl+C"); }
        window.open(baseUrl, "_blank", "noopener,noreferrer");
      }
    });
  }

  const IU_TR_NOTES_KEY = "iu:translator:notes";

  function iuTrNotesAutosize(ta){
    try { if (!ta) return; ta.style.height = "auto"; ta.style.overflow = "hidden"; ta.style.height = (ta.scrollHeight + 2) + "px"; } catch {}
  }

  function iuTrNotesBootstrap(quick){
    const block = quick && quick.querySelector('[data-iu-notes][data-iu-notes-key="translator"]');
    const ta = block && block.querySelector('[data-iu-notes-text]');
    if (!ta) return;
    try { ta.value = String(localStorage.getItem(IU_TR_NOTES_KEY) || ""); } catch { ta.value = ""; }
    iuTrNotesAutosize(ta);
    ta.addEventListener("input", () => {
      try { localStorage.setItem(IU_TR_NOTES_KEY, String(ta.value || "")); } catch {}
      iuTrNotesAutosize(ta);
    });
  }

  function iuNotesGetBlock(el){ return el && el.closest("[data-iu-notes]"); }
  function iuNotesGetText(block){ const ta = block && block.querySelector("[data-iu-notes-text]"); return ta ? String(ta.value || "").trim() : ""; }
  function iuNotesBuildPayload(raw){
    const t = (raw || "").trim();
    const sig = "\n\n— infoUzel.cz\nhttps://infouzel.cz/";
    return t ? (t + sig) : "";
  }

  /** Shared forward action: same as Translator "Přeposlat" / notes "Odeslat", no translator UI.
   * P0: Single handler ref for AI, Překladač, Převod — accepts (text, anchorEl) or (event).
   */
  async function iuForwardActionSameAsTranslator(textOrEvent, anchorEl) {
    let text, anchor;
    if (textOrEvent && textOrEvent.target && typeof textOrEvent.preventDefault === "function") {
      const e = textOrEvent;
      e.stopPropagation();
      anchor = e.currentTarget || e.target;
      const btn = e.target.closest && e.target.closest(".iuAiShareBtn, #iuTrHeaderPreposlat");
      if (!btn) return;
      if (typeof window.__iuShareTestOverride === "function") {
        const quick = document.getElementById("iuQuickFeed");
        const title = (quick && quick.querySelector(".iuQTitle")) ? (quick.querySelector(".iuQTitle").textContent || "").trim() : "";
        const isConvert = title.indexOf("Převod") >= 0 || title.indexOf("Word") >= 0;
        const payload = isConvert
          ? { title: "infoUzel.cz – Převod Word/PDF", text: "Převod Word/PDF – nástroje", url: "https://www.infouzel.cz/" }
          : { title: "infoUzel.cz – AI asistenti", text: "AI asistenti na infoUzel.cz", url: "https://www.infouzel.cz/" };
        try { await window.__iuShareTestOverride(payload); } catch (_) {}
        return;
      }
      if (btn.id === "iuTrHeaderPreposlat") {
        const block = document.querySelector('[data-iu-notes][data-iu-notes-key="translator"]');
        text = block ? iuNotesGetText(block) : "";
      } else if (btn.closest && btn.closest("#iuQuickFeed")) {
        const quick = document.getElementById("iuQuickFeed");
        const qTitle = quick && quick.querySelector(".iuQTitle") ? (quick.querySelector(".iuQTitle").textContent || "").trim() : "";
        text = (qTitle.indexOf("Převod") >= 0 || qTitle.indexOf("Word") >= 0)
          ? "Převod Word/PDF – nástroje"
          : "AI asistenti na infoUzel.cz https://www.infouzel.cz/";
      } else {
        text = "AI asistenti na infoUzel.cz https://www.infouzel.cz/";
      }
    } else {
      text = textOrEvent;
      anchor = anchorEl;
    }
    let payload = iuNotesBuildPayload(text != null ? String(text) : "");
    if (!payload) payload = "https://infouzel.cz/";
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({ text: payload, title: "infoUzel.cz" }).then(function() {}).catch(function() {});
      return;
    }
    showForwardFallbackMenu(payload, anchor);
  }

  function showForwardFallbackMenu(payload, anchorEl) {
    const existing = document.getElementById("iuForwardFallbackMenu");
    if (existing) { existing.remove(); return; }
    const wrap = document.createElement("div");
    wrap.id = "iuForwardFallbackMenu";
    wrap.className = "iuNotesSendBar";
    wrap.setAttribute("role", "menu");
    wrap.style.cssText = "position:fixed;z-index:9999;background:#fff;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);padding:6px;display:flex;flex-direction:column;gap:4px;min-width:160px;";
    const addBtn = function(label, onClick) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "iuNotesSendOpt";
      b.setAttribute("role", "menuitem");
      b.textContent = label;
      b.addEventListener("click", function() { onClick(); wrap.remove(); document.removeEventListener("click", close); });
      wrap.appendChild(b);
    };
    addBtn("Kopírovat pro odeslání", function() {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") navigator.clipboard.writeText(payload);
        else { var ta = document.createElement("textarea"); ta.value = payload; ta.style.cssText = "position:fixed;left:-9999px;top:0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); }
      } catch (_) {}
    });
    addBtn("E-mail", function() {
      window.location.href = "mailto:?subject=" + encodeURIComponent("Poznámka z infoUzel.cz") + "&body=" + encodeURIComponent(payload);
    });
    addBtn("WhatsApp", function() {
      window.open("https://wa.me/?text=" + encodeURIComponent(payload), "_blank", "noopener,noreferrer");
    });
    document.body.appendChild(wrap);
    var rect = (anchorEl && anchorEl.getBoundingClientRect) ? anchorEl.getBoundingClientRect() : { left: 0, bottom: 0 };
    wrap.style.left = rect.left + "px";
    wrap.style.top = (rect.bottom + 4) + "px";
    function close() { wrap.remove(); document.removeEventListener("click", close); }
    requestAnimationFrame(function() { document.addEventListener("click", close, { once: true }); });
  }

  try {
    window.iuForwardActionSameAsTranslator = iuForwardActionSameAsTranslator;
    window.__iuShareHandlerRef = iuForwardActionSameAsTranslator;
    window.__iuShareHandlers = window.__iuShareHandlers || {};
    window.__iuShareHandlers.ai = iuForwardActionSameAsTranslator;
    window.__iuShareHandlers.translator = iuForwardActionSameAsTranslator;
    window.__iuShareHandlers.convert = iuForwardActionSameAsTranslator;
  } catch (_) {}

  function iuNotesGlobalDelegation(){
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-iu-notes-copy], [data-iu-notes-clear], [data-iu-notes-send], [data-iu-notes-send-wa], [data-iu-notes-send-mail], [data-iu-notes-send-copy]");
      if (!btn) return;
      const block = btn.closest("[data-iu-notes]");
      if (!block) return;
      const ta = block.querySelector("[data-iu-notes-text]");
      const status = block.querySelector("[data-iu-notes-status]");
      const sendbar = block.querySelector("[data-iu-notes-sendbar]");
      const showStatus = (msg) => {
        if (status) { status.textContent = msg; status.hidden = false; setTimeout(() => { status.textContent = ""; status.hidden = true; }, 2500); }
      };
      const hideOtherSendbars = () => {
        try { document.querySelectorAll("[data-iu-notes-sendbar]").forEach((sb) => { if (sb.closest("[data-iu-notes]") !== block) sb.hidden = true; }); } catch {}
      };

      if (btn.matches("[data-iu-notes-copy]")) {
        const t = ta ? (ta.value || "") : "";
        try { navigator.clipboard.writeText(t); showStatus("Zkopírováno"); } catch { showStatus("Nepovedlo se zkopírovat – dej Ctrl+C"); }
        return;
      }
      if (btn.matches("[data-iu-notes-clear]")) {
        if (ta) ta.value = "";
        const storageKey = block.getAttribute("data-iu-notes-storage-key");
        const trKey = block.getAttribute("data-iu-notes-key");
        if (trKey === "translator") try { localStorage.removeItem(IU_TR_NOTES_KEY); } catch {}
        else if (storageKey) try { localStorage.removeItem(storageKey); } catch {}
        showStatus("Vyčištěno");
        if (sendbar) sendbar.hidden = true;
        return;
      }

      if (btn.matches("[data-iu-notes-send]")) {
        const text = iuNotesGetText(block);
        if (!text) { showStatus("Nejdřív napiš poznámku"); return; }
        iuForwardActionSameAsTranslator(text, sendbar || btn);
        return;
      }

      if (btn.matches("[data-iu-notes-send-wa]")) {
        const text = iuNotesGetText(block);
        if (!text) { showStatus("Nejdřív napiš poznámku"); return; }
        const payload = iuNotesBuildPayload(text);
        window.open(`https://wa.me/?text=${encodeURIComponent(payload)}`, "_blank", "noopener,noreferrer");
        showStatus("Otevřeno ve WhatsApp");
        if (sendbar) sendbar.hidden = true;
        return;
      }
      if (btn.matches("[data-iu-notes-send-mail]")) {
        const text = iuNotesGetText(block);
        if (!text) { showStatus("Nejdřív napiš poznámku"); return; }
        const payload = iuNotesBuildPayload(text);
        window.location.href = `mailto:?subject=${encodeURIComponent("Poznámka z infoUzel.cz")}&body=${encodeURIComponent(payload)}`;
        if (sendbar) sendbar.hidden = true;
        return;
      }
      if (btn.matches("[data-iu-notes-send-copy]")) {
        const text = iuNotesGetText(block);
        if (!text) { showStatus("Nejdřív napiš poznámku"); return; }
        const payload = iuNotesBuildPayload(text);
        try {
          navigator.clipboard.writeText(payload);
          showStatus("Zkopírováno");
        } catch {
          let ok = false;
          try {
            const tmp = document.createElement("textarea");
            tmp.value = payload;
            tmp.style.cssText = "position:fixed;left:-9999px;top:0";
            document.body.appendChild(tmp);
            tmp.select();
            ok = document.execCommand("copy");
            document.body.removeChild(tmp);
          } catch {}
          if (ok) showStatus("Zkopírováno");
          else {
            if (ta) { ta.focus(); ta.select(); ta.setSelectionRange(0, (ta.value || "").length); }
            showStatus("Nepovedlo se zkopírovat – dej Ctrl+C");
          }
        }
        if (sendbar) sendbar.hidden = true;
        return;
      }
    });
  }
  iuNotesGlobalDelegation();

  function iuEnsureArticlesView(){
    const stage = document.getElementById("iuCenterStage");
    const quick = document.getElementById("iuQuickFeed");
    if (stage) stage.setAttribute("data-iu-view", "articles");
    if (quick) {
      quick.hidden = true;
      quick.innerHTML = "";
    }
    try {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.body.classList.remove("iu-modal-open", "iu-quickFeedOpen", "iu-mobileGateToolsQuickOpen");
    } catch (_) {}
  }

  function iuHideQuickFeed(){
    iuEnsureArticlesView();
  }

  let iuActiveOverlay = null;

  function iuDetectOpenOverlays() {
    const ids = [];
    try {
      const vis = (el) => {
        if (!el) return false;
        if (el.hidden) return false;
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden") return false;
        return true;
      };
      const quick = document.getElementById("iuQuickFeed");
      if (quick && vis(quick)) ids.push("quickfeed");
      const pp = document.getElementById("iuParcelsPopover");
      if (pp && pp.classList.contains("is-open") && getComputedStyle(pp).display !== "none") ids.push("parcels");
      const mjp = document.getElementById("iu-mojeSluzbyPanel");
      const mjo = document.getElementById("iu-mojeSluzbyOverlay");
      if ((mjp && vis(mjp)) || (mjo && vis(mjo))) ids.push("mojesluzby");
      const aiPanel = document.getElementById("iu-aiPanel");
      if (aiPanel && vis(aiPanel)) ids.push("ai");
    } catch (_) {}
    return ids;
  }

  function iuForceCloseAllOverlays() {
    iuActiveOverlay = null;
    try { window.__iuLastQuickfeedKey = null; } catch (_) {}
    try { window.__iuLastMojeSluzbyKind = null; } catch (_) {}
    try {
      try {
        if (typeof window.iuIsProdHost === "function" && window.iuIsProdHost()) {
          ["iuMindMenuDebugPanel", "iuDebugBox", "iuVideoDebugPanel", "iuLayoutShiftBox"].forEach(function (rid) {
            var rel = document.getElementById(rid);
            if (rel && rel.parentNode) rel.parentNode.removeChild(rel);
          });
        }
      } catch (_) {}
      iuEnsureArticlesView();
      var qf = document.getElementById("iuQuickFeed");
      if (qf) {
        qf.hidden = true;
        try { qf.style.display = "none"; } catch (_) {}
      }
      document.querySelectorAll(".iu-parcels-overlay, #iuParcelsPopover").forEach(function (el) {
        try {
          el.classList.remove("is-open");
          el.setAttribute("aria-hidden", "true");
          if (el.classList.contains("iu-parcels-overlay")) {
            el.hidden = true;
            try { el.style.display = "none"; } catch (_) {}
          }
        } catch (_) {}
      });
      if (typeof window.iuCloseParcelsModal === "function") {
        try { window.iuCloseParcelsModal(); } catch (_) {}
      }
      if (typeof window.iuCloseMojeSluzbyModal === "function") {
        try { window.iuCloseMojeSluzbyModal(); } catch (_) {}
      }
      const mojeOverlay = document.getElementById("iu-mojeSluzbyOverlay");
      const mojePanel = document.getElementById("iu-mojeSluzbyPanel");
      if (mojeOverlay) {
        mojeOverlay.hidden = true;
        mojeOverlay.setAttribute("aria-hidden", "true");
        try { mojeOverlay.style.display = "none"; } catch (_) {}
      }
      if (mojePanel) {
        mojePanel.hidden = true;
        mojePanel.setAttribute("aria-hidden", "true");
        try { mojePanel.style.display = "none"; } catch (_) {}
        try { mojePanel.classList.remove("is-open"); } catch (_) {}
      }
      const aiPanel = document.getElementById("iu-aiPanel");
      const aiOverlay = document.getElementById("iu-aiOverlay");
      if (typeof window.iuSetElOpenVisible === "function") {
        try { window.iuSetElOpenVisible(aiPanel, false); window.iuSetElOpenVisible(aiOverlay, false); } catch (_) {}
      } else {
        if (aiPanel) aiPanel.hidden = true;
        if (aiOverlay) aiOverlay.hidden = true;
      }
      try {
        if (aiPanel) {
          aiPanel.dataset.open = "0";
          aiPanel.classList.remove("is-open");
        }
      } catch (_) {}
      var nak = document.getElementById("iuNakupModal");
      if (nak) {
        nak.hidden = true;
        try { nak.style.display = "none"; } catch (_) {}
        try { nak.classList.remove("is-open"); } catch (_) {}
      }
      document.querySelectorAll('.iuModal, [data-iu-backdrop], .iuBackdrop, .iu-overlay, .iu-backdrop').forEach((el) => {
        el.hidden = true;
        try { el.style.display = "none"; } catch (_) {}
        try { el.classList.remove("is-open", "active"); } catch (_) {}
      });
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.body.classList.remove("iu-modal-open", "iu-quickFeedOpen", "iu-mobileGateToolsQuickOpen");
    } catch (_) {}
  }

  function iuOpenOverlay(targetId, extra) {
    const t = String(targetId || "").trim().toLowerCase();
    iuForceCloseAllOverlays();
    iuActiveOverlay = t;
    try {
      if (t === "quickfeed") {
        const k = extra && typeof extra === "object" && extra.key != null ? extra.key : (extra != null && typeof extra !== "object" ? extra : null);
        if (k == null) return;
        const kn = String(k).trim().toLowerCase();
        try { window.__iuLastQuickfeedKey = kn; } catch (_) {}
        iuShowQuickFeedCore(k);
        return;
      }
      if (t === "parcels") {
        if (typeof window.iuParcelsOpenSurface === "function") window.iuParcelsOpenSurface();
        return;
      }
      if (t === "ai") {
        if (typeof window.iuAiPanelOpenSurface === "function") window.iuAiPanelOpenSurface();
      }
    } finally {
      try {
        setTimeout(function () {
          try { iuOverlayFailSafeAfterGesture(); } catch (_) {}
        }, 0);
      } catch (_) {}
    }
  }

  function iuShowQuickFeed(key) {
    iuOpenOverlay("quickfeed", { key: key });
  }

  function iuOverlayFailSafeAfterGesture() {
    try {
      const open = iuDetectOpenOverlays();
      try {
        window.__iuLastPostOpenOverlayIds = open.slice();
        window.__iuLastPostOpenOverlayCount = open.length;
      } catch (_) {}
      if (open.length <= 1) return;
      try { window.__iuOverlayFailSafeTriggerCount = (window.__iuOverlayFailSafeTriggerCount || 0) + 1; } catch (_) {}
      const snapQf = window.__iuLastQuickfeedKey;
      iuForceCloseAllOverlays();
      const last = open[open.length - 1];
      iuActiveOverlay = last || null;
      if (last === "quickfeed") {
        const k = snapQf;
        if (k) {
          try { window.__iuLastQuickfeedKey = k; } catch (_) {}
          iuShowQuickFeedCore(k);
        }
      } else if (last === "parcels") {
        if (typeof window.iuParcelsOpenSurface === "function") window.iuParcelsOpenSurface();
      } else if (last === "ai") {
        if (typeof window.iuAiPanelOpenSurface === "function") window.iuAiPanelOpenSurface();
      }
    } catch (_) {}
  }
  try { window.iuEnforceSingleOverlay = iuCloseAllOverlaysExcept; } catch (_) {}

  try { window.iuForceCloseAllOverlays = iuForceCloseAllOverlays; } catch (_) {}
  try { window.iuOpenOverlay = iuOpenOverlay; } catch (_) {}
  try { window.iuDetectOpenOverlays = iuDetectOpenOverlays; } catch (_) {}
  try { window.iuOverlayFailSafeAfterGesture = iuOverlayFailSafeAfterGesture; } catch (_) {}
  try { window.iuEnforceSingleOverlay = iuForceCloseAllOverlays; } catch (_) {}

  function iuResolveQuickAction(el) {
    if (!el) return { actionType: "none", key: "" };
    const key = String(el.getAttribute("data-iuq") || "").trim().toLowerCase();
    const href = String(el.getAttribute("href") || "").trim();
    const action = String(el.getAttribute("data-iu-action") || "").trim().toLowerCase();
    const modal = String(el.getAttribute("data-iu-modal") || "").trim().toLowerCase();
    const isExternalHref = !!href && /^https?:\/\//i.test(href);
    if (action === "parcels" || key === "baliky") return { actionType: "overlay", overlayId: "parcels", key };
    if (modal === "banka" || modal === "bakalari" || modal === "pojistovna") return { actionType: "overlay", overlayId: "quickfeed", key: modal };
    if (key === "ai" || key === "deepl" || key === "convert" || key === "naceneni") {
      return { actionType: "overlay", overlayId: "quickfeed", key };
    }
    if (isExternalHref) return { actionType: "external", key, href };
    return { actionType: key ? "overlay" : "none", overlayId: "quickfeed", key };
  }

  try { window.iuEnsureArticlesView = iuEnsureArticlesView; } catch (e) {}
  try { window.iuShowQuickFeed = iuShowQuickFeed; } catch (e) {}

  function iuQuickFeedInit(){
    document.addEventListener("click", (e) => {
      var t = e.target;
      if (t && t.nodeType === 3) t = t.parentElement;
      if (!t || typeof t.closest !== "function") return;
      if (e.__iuHandled) return;
      if (t.closest('.iuQShareBtn')) return;
      if (t.closest('#iuQuickFeed')) return;
      const el = t.closest('[data-iuq]');
      if (!el) return;
      const resolved = iuResolveQuickAction(el);
      if (resolved.actionType === "external") {
        // Deterministic action guard: external links must never open overlays.
        return;
      }
      if (resolved.actionType !== "overlay" || !resolved.key) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      e.__iuHandled = true;
      if (resolved.overlayId === "parcels") {
        iuOpenOverlay("parcels");
      } else {
        iuOpenOverlay("quickfeed", { key: resolved.key });
      }
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iuQuickFeedInit);
  } else {
    iuQuickFeedInit();
  }
})();

// === Quicklink share buttons (Přeposlat) ===
(function(){
  function iuInitQuicklinkShareButtons(){
    // P0: QuickLinks share disabled (iuQShareBtn removed)
    return;
    const items = document.querySelectorAll('.iu-mmQuickItem, [data-iuq]');
    items.forEach(function(el){
      if (el.querySelector('.iuQShareBtn')) return;
      const titleEl = el.querySelector('.iu-mmQuickTitle, .iuQuickTitle, .iuCardTitle, .iuLabel, .iuName') || el.querySelector('span:not(.iuIconTile)') || null;
      if (!titleEl) return;
      const parent = titleEl.parentElement;
      if (!parent) return;
      const row = document.createElement('div');
      row.className = 'iuQTitleRow';
      parent.insertBefore(row, titleEl);
      row.appendChild(titleEl);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'iuQShareBtn';
      btn.setAttribute('aria-label', 'Přeposlat');
      btn.textContent = 'Přeposlat';
      var shareUrl = null;
      if (el.tagName === 'A' && el.getAttribute('href')) shareUrl = el.getAttribute('href');
      if (!shareUrl) { var a = el.querySelector('a[href]'); if (a) shareUrl = a.getAttribute('href'); }
      if (!shareUrl && el.dataset && el.dataset.url) shareUrl = el.dataset.url;
      try { if (shareUrl) shareUrl = new URL(shareUrl, location.origin).toString(); } catch(_) {}
      if (!shareUrl) shareUrl = location.href.split('#')[0];
      btn.dataset.shareUrl = shareUrl;
      row.appendChild(btn);
    });
  }
  document.addEventListener('click', async function(e){
    var btn = e.target.closest && e.target.closest('.iuQShareBtn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    var url = (btn.dataset && btn.dataset.shareUrl) ? btn.dataset.shareUrl : location.href.split('#')[0];
    try {
      var data = { title: 'infoUzel.cz', text: 'Rychlý odkaz z infoUzel.cz', url: url };
      if (navigator.share) { await navigator.share(data); } else { await navigator.clipboard.writeText(url); alert('Odkaz zkopírován do schránky'); }
    } catch (err) { if (typeof console !== 'undefined' && console.warn) console.warn('quicklink share fail', err); }
  }, true);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ iuInitQuicklinkShareButtons(); setTimeout(iuInitQuicklinkShareButtons, 0); setTimeout(iuInitQuicklinkShareButtons, 250); });
  } else {
    iuInitQuicklinkShareButtons();
    setTimeout(iuInitQuicklinkShareButtons, 0);
    setTimeout(iuInitQuicklinkShareButtons, 250);
  }
})();

// === AI PANEL (Quick Links) — centered modal (like Parcels) ===
(function(){
  'use strict';

  const SHARE_URL = "https://www.infouzel.cz/";
  const SHARE_TITLE = "infoUzel.cz – AI asistenti";
  const SHARE_TEXT = "AI asistenti na infoUzel.cz";

  async function onShareAiTab(){
    var btn = document.getElementById("iuAiShareBtn") || document.querySelector("#iuQuickFeed .iuAiShareBtn");
    if (typeof window.__iuShareTestOverride === "function") {
      try {
        await window.__iuShareTestOverride({ title: SHARE_TITLE, text: SHARE_TEXT, url: SHARE_URL });
      } catch (_) {}
      return;
    }
    var aiText = SHARE_TEXT + " " + SHARE_URL;
    if (typeof window.iuForwardActionSameAsTranslator === "function") {
      window.iuForwardActionSameAsTranslator(aiText, btn || undefined);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: SHARE_URL });
      } catch (e) { /* user cancel OK, no console.error */ }
      return;
    }
    openShareFallbackMenu();
  }

  function openShareFallbackMenu(){
    const btn = document.getElementById("iuAiShareBtn") || document.querySelector("#iuQuickFeed .iuAiShareBtn");
    if (!btn) return;
    const existing = document.getElementById("iuAiShareFallback");
    if (existing) { existing.remove(); return; }
    const wrap = document.createElement("div");
    wrap.id = "iuAiShareFallback";
    wrap.className = "iuAiShareFallback";
    wrap.setAttribute("role", "menu");
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.setAttribute("role", "menuitem");
    copyBtn.textContent = "Kopírovat odkaz";
    copyBtn.addEventListener("click", async () => {
      try {
        if (typeof window.__iuClipboardTestCapture === "function") {
          window.__iuClipboardTestCapture(SHARE_URL);
          return;
        }
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(SHARE_URL);
        } else {
          const ta = document.createElement("textarea");
          ta.value = SHARE_URL;
          ta.style.cssText = "position:fixed;left:-9999px;top:0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        showShareToast("Odkaz zkopírován");
      } catch (_) {
        showShareToast("Nelze zkopírovat");
      }
      wrap.remove();
    });
    const mailBtn = document.createElement("button");
    mailBtn.type = "button";
    mailBtn.setAttribute("role", "menuitem");
    mailBtn.textContent = "E-mail";
    const mailto = "mailto:?subject=" + encodeURIComponent(SHARE_TITLE) + "&body=" + encodeURIComponent(SHARE_TEXT + " " + SHARE_URL);
    mailBtn.addEventListener("click", () => { window.location.href = mailto; wrap.remove(); });
    wrap.appendChild(copyBtn);
    wrap.appendChild(mailBtn);
    document.body.appendChild(wrap);
    const r = btn.getBoundingClientRect();
    wrap.style.left = r.left + "px";
    wrap.style.top = (r.bottom + 4) + "px";
    const close = () => { wrap.remove(); document.removeEventListener("click", close); };
    requestAnimationFrame(() => document.addEventListener("click", close, { once: true }));
  }

  function showShareToast(msg){
    let el = document.getElementById("iuAiShareToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "iuAiShareToast";
      el.className = "iuAiShareToast";
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("iuAiShareToastVisible");
    clearTimeout(el._toastT);
    el._toastT = setTimeout(() => { el.classList.remove("iuAiShareToastVisible"); }, 2500);
  }

  document.addEventListener("click", function(e){
    if (e.target && e.target.closest && e.target.closest(".iuAiShareBtn")) iuForwardActionSameAsTranslator(e);
  });

  /* Global close handler: [data-iu-close] / .iuModalClose / .iu-close / .iuQClose — modal or quick card (capture so it runs before stopPropagation inside modals) */
  document.addEventListener('click', function(e){
    const t0 = e.target;
    const t = (t0 && t0.nodeType === 3) ? t0.parentElement : t0; // text node -> parent so closest() works
    if (!t || t.nodeType !== 1) return;
    const closeEl = t.closest('[data-iu-close], .iuModalClose, .iu-close, .iu-closeBtn, .iuQClose');
    if (!closeEl) return;
    if (closeEl.classList.contains("iuAiShareBtn") || closeEl.closest(".iuAiShareBtn")) return;
    e.preventDefault();
    e.stopPropagation();

    // 1) Quick card/feed (AI asistenti etc.): X is inside #iuQuickFeed — use existing close
    const quick = closeEl.closest && closeEl.closest('#iuQuickFeed');
    if (quick) {
      if (typeof window.iuEnsureArticlesView === 'function') window.iuEnsureArticlesView();
      return;
    }

    // 2) Modal (#iu-aiPanel or .iuModal or #iu-mojeSluzbyPanel)
    const modal = closeEl.closest && (closeEl.closest('.iuModal, [data-iu-modal]') || closeEl.closest('#iu-aiPanel') || closeEl.closest('#iu-mojeSluzbyPanel'));
    if (modal) {
      if (modal.id === 'iu-aiPanel') {
        const ov = document.getElementById('iu-aiOverlay');
        if (typeof window.iuSetElOpenVisible === 'function') {
          window.iuSetElOpenVisible(modal, false);
          window.iuSetElOpenVisible(ov, false);
        } else {
          if (ov) ov.hidden = true;
          modal.setAttribute('hidden', '');
        }
        document.documentElement.style.overflow = '';
      } else if (modal.id === 'iu-mojeSluzbyPanel' && typeof window.iuCloseMojeSluzbyModal === 'function') {
        window.iuCloseMojeSluzbyModal();
      } else {
        modal.setAttribute('hidden', '');
      }
      modal.classList.remove('is-open');
      document.body.classList.remove('iu-modal-open');
    }
  }, true);

  const AI_FALLBACK = [
    { name: "ChatGPT", url: "https://chat.openai.com", desc: "Univerzální AI na psaní, nápady, obrázky i práci s daty" },
    { name: "Google Gemini", url: "https://gemini.google.com", desc: "AI propojená s Googlem, mapami, vyhledáváním a Gmailem" },
    { name: "Microsoft Copilot", url: "https://copilot.microsoft.com", desc: "AI pro práci ve Windows, Office a psaní e-mailů" },
    { name: "Claude", url: "https://claude.ai", desc: "Přirozené a přesné psaní, analýza dokumentů a práce s dlouhými texty" },
    { name: "Perplexity AI", url: "https://www.perplexity.ai", desc: "Odpovídá jako vyhledávač a uvádí zdroje informací" },
    { name: "DeepSeek", url: "https://chat.deepseek.com", desc: "Silná AI na programování, logiku a matematiku" },
    { name: "Grok", url: "https://x.ai", desc: "AI zaměřená na aktuální dění a trendy na síti X" },
    { name: "Mistral AI", url: "https://chat.mistral.ai", desc: "Evropská AI s důrazem na soukromí a efektivitu" },
    { name: "Editee", url: "https://www.editee.com", desc: "Česká AI pro marketing, podnikání a obsah" }
  ];

  function renderAiCards(container, items){
    if (!container || !Array.isArray(items) || items.length === 0) return;
    const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    container.innerHTML = items.map(it => {
      const c = it.color || "#1F4B99";
      return `<div class="iu-aiItem" style="--aiColor:${c}">
        <div>
          <strong>${esc(it.name)}</strong>
          <p>${esc(it.desc || "")}</p>
        </div>
        <a href="${esc(it.url || "#")}" target="_blank" rel="noopener">Otevřít</a>
      </div>`;
    }).join("");
  }

  function loadAiAssistants(){
    const container = document.getElementById('iu-aiPanelCards');
    const body = document.querySelector('#iu-aiPanel .iu-aiPanelBody');
    if (!container || !body) return;
    const base = (typeof location !== "undefined" && location.pathname || "").toLowerCase().includes("/filtr/") ? "/filtr/projects/" : "/projects/";
    const url = base + "data/services-ai.json";
    fetch(url, { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(data => { renderAiCards(container, Array.isArray(data) ? data : AI_FALLBACK); })
      .catch(err => {
        const fallback = (window.IU_QUICK_FEEDS && window.IU_QUICK_FEEDS.ai && window.IU_QUICK_FEEDS.ai.items) || AI_FALLBACK;
        if (Array.isArray(fallback) && fallback.length > 0) {
          renderAiCards(container, fallback);
        } else {
          container.innerHTML = `<div class="iuErrorBox">AI asistenti se nepodařilo načíst. Zkuste reload.</div>`;
        }
      });
  }

  function initAiPanel(){
    const aiPanel = document.getElementById('iu-aiPanel');
    if (!aiPanel) return;

    const shareBtn = document.getElementById('iuAiShareBtn');
    if (shareBtn) shareBtn.addEventListener("click", iuForwardActionSameAsTranslator);

    loadAiAssistants();

    const aiOverlay = document.getElementById('iu-aiOverlay');
    const aiModal = aiPanel.querySelector('.iu-aiModal');
    const aiClose = aiPanel.querySelector('.iuAiClose');

    function getBtns(){
      return Array.from(document.querySelectorAll('[data-action="ai-panel"]'));
    }

    function setExpanded(isOpen){
      getBtns().forEach(btn => btn.setAttribute('aria-expanded', String(isOpen)));
    }

    function lockScroll(lock){
      document.documentElement.style.overflow = lock ? 'hidden' : '';
    }

    function openPanel(){
      /* P0: AI asistenti = quick card in middle column; do not open modal when quick view already shows AI */
      const stage = document.getElementById("iuCenterStage");
      const quick = document.getElementById("iuQuickFeed");
      if (stage && stage.getAttribute("data-iu-view") === "quick" && quick && !quick.hidden && (quick.innerText || "").includes("AI asistenti")) return;
      if (typeof window.ensureAiModalInBody === "function") window.ensureAiModalInBody();
      if (typeof window.iuSetElOpenVisible === "function") {
        window.iuSetElOpenVisible(aiOverlay, true);
        window.iuSetElOpenVisible(aiPanel, true);
        if (typeof window.ensureAiModalInBody === "function") window.ensureAiModalInBody();
        if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(function() { if (typeof window.ensureAiModalInBody === "function") window.ensureAiModalInBody(); });
        setTimeout(function() { if (typeof window.ensureAiModalInBody === "function") window.ensureAiModalInBody(); }, 0);
      } else {
        aiPanel.hidden = false;
        if (aiOverlay) aiOverlay.hidden = false;
      }
      lockScroll(true);
      try { document.body.classList.add('iu-modal-open'); } catch {}
      aiPanel.dataset.open = '1';
      setExpanded(true);
      try {
        const body = aiPanel.querySelector('.iu-aiPanelBody');
        if (body && typeof window.iuPersistScrollPanels === 'function') {
          requestAnimationFrame(() => window.iuPersistScrollPanels());
        }
      } catch {}
    }
    try { window.iuAiPanelOpenSurface = openPanel; } catch (_) {}

    function closePanel(){
      if (typeof window.iuSetElOpenVisible === "function") {
        window.iuSetElOpenVisible(aiPanel, false);
        window.iuSetElOpenVisible(aiOverlay, false);
      } else {
        aiPanel.hidden = true;
        if (aiOverlay) aiOverlay.hidden = true;
      }
      lockScroll(false);
      try { document.body.style.overflow = ''; document.body.classList.remove('iu-modal-open'); } catch {}
      aiPanel.dataset.open = '0';
      setExpanded(false);
    }

    try {
      window.addEventListener('iu-open-panel', function(e){ var id = String(e.detail || '').trim().toLowerCase(); if (id === 'ai') return; /* AI modal hard-deny */ });
      window.addEventListener('iu-close-panel', function(e){ if (e.detail === 'ai') closePanel(); });
    } catch {}

    // 2) Zavření: × (bez změny URL)
    if (aiClose){
      aiClose.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        closePanel();
      });
    }

    // 3) Zavření: klik mimo (overlay)
    if (aiOverlay){
      aiOverlay.addEventListener('click', closePanel);
    }

    // 4) Zavření: klik na backdrop (panel wrapper mimo modal)
    aiPanel.addEventListener('click', e => {
      if (e.target === aiPanel) closePanel();
    });

    // 5) Klik uvnitř modalu nemá zavírat
    if (aiModal){
      aiModal.addEventListener('click', e => {
        e.stopPropagation();
      });
    }

    // 6) ESC zavře
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closePanel();
    });

    // 7) Klik na "Otevřít" zavře
    aiPanel.addEventListener('click', e => {
      const a = e.target.closest('a');
      if (a) closePanel();
    });

    // init
    aiPanel.hidden = true;
    if (aiOverlay) aiOverlay.hidden = true;
    aiPanel.dataset.open = '0';
    setExpanded(false);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initAiPanel);
  } else {
    initAiPanel();
  }

})();

// === RADIO VIEW (left rail) — middle column toggle (UI-only) ===
// Requirements:
// - NO changes to loadData / applyFilter / renderFeed (feed pipeline untouched)
// - Toggle visibility only: #feed <-> #iuRadioView
// - Static link chips only (no audio/streams)
(function(){
  'use strict';

  const RADIO_ITEMS = [
    { title: "Radiožurnál", url: "https://radiozurnal.rozhlas.cz/", desc: "Zpravodajství ČRo" },
    { title: "Dvojka", url: "https://dvojka.rozhlas.cz/", desc: "Mluvené slovo" },
    { title: "Vltava", url: "https://vltava.rozhlas.cz/", desc: "Kultura a hudba" },
    { title: "Evropa 2", url: "https://www.evropa2.cz/", desc: "Pop a zábava" },
    { title: "Impuls", url: "https://www.impuls.cz/", desc: "Hity + servis" },
    { title: "Fajn rádio", url: "https://fajnradio.cz/", desc: "Aktuální hity" },
    { title: "Kiss", url: "https://kiss.cz/", desc: "Hudba a zábava" },
    { title: "Rádio Beat", url: "https://www.radiobeat.cz/", desc: "Rock" },
    { title: "Blaník", url: "https://www.radioblanik.cz/", desc: "České hity" }
  ];

  // Unified navigation router (UI-only)
  // NOTE: non-radio sections still use the normal feed view.
  const IU_CONTENT_ACCENTS = {
    pocasi: "#38D9FF",
    mapy: "#4BE3C1",
    jr: "#57A8FF",
    tvprogram: "#2FD39A",
    tvonline: "#00C2FF",
    radio: "#9B8CFF",
    svatky: "#34E7A1",
    media: "#B38BFF",
    sport: "#FF6FD8",
    tech: "#6AA8FF",
    finance: "#FFD34D",
    home: "#FF9B5E",
    zdravi: "#4CFFB3",
    travel: "#42D3FF",
    hry: "#FF6B3D",
    culture: "#FF4D8A",
    veda: "#7CFF6B",
    vzdelavani: "#55FFA6"
  };

  const VIEW_MAP = {
    media: 'media',
    radio: 'radio',
    tvonline: 'tvonline',
    jr: 'jr',
    mapy: 'mapy',
    travel: 'travel',
    pocasi: 'pocasi',
    tvprogram: 'tvprogram',
    'myuzel-1': 'myuzel-1',
    'myuzel-2': 'myuzel-2',
    'myuzel-3': 'myuzel-3',
    'myuzel-4': 'myuzel-4',
    'myuzel-5': 'myuzel-5',
  };
  const STORAGE_KEY_WISH = "iuRadioWishDraftV1";
  const STORAGE_KEY_WISH_OPEN = "iuRadioWishOpenV1";

  // === RADIO WISH — fallback data (safe MVP, no backend) ===
  const FALLBACK_WISH = {
    radios: [
      { id: "impuls", label: "Rádio Impuls", method: "email", emailTo: "impuls@impuls.cz" },
      { id: "frekvence1", label: "Frekvence 1", method: "form", url: "https://www.frekvence1.cz/napiste-nam", hintText: "Kategorie ve formuláři: „Vysílání rádia“." },
      { id: "evropa2", label: "Evropa 2", method: "form", url: "https://www.evropa2.cz/kontakt" },
      { id: "cro_pisnicky_na_prani", label: "Český rozhlas – Písničky na přání", method: "form_or_sms", url: "https://program.rozhlas.cz/pisnicky-na-prani-7232426/o-poradu", smsHint: "Instrukce SMS jsou na stránce pořadu (MVP jen nápověda)." }
    ],
    // calendar first names (fallback subset)
    names: ["Jana","Jan","Petr","Petra","Pavel","Lucie","Marie","Tomáš","Veronika","David","Daniel","Andrea","Eliška","Karel","Jiří","Josef","Anna","Tereza","Marek","Kristýna"],
    // exactly 100 artists on prod via projects/data/artists_whitelist.json
    artists: ["Queen","ABBA","The Beatles","Michael Jackson","Adele","Ed Sheeran","Coldplay","Avicii","Lucie","Kabát"],
    // optional "Já jsem" roles
    iam: ["kamarád/ka","partner/ka","manžel/ka","přítel/přítelkyně","kolega/kolegyně","bratr/sestra","syn/dcera","maminka/tatínek","babička/dědeček"]
  };

  let wishData = { ...FALLBACK_WISH };

  function escapeHtml(s){
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function iuHexToRgb(hex){
    const h = String(hex || "").trim().replace("#", "");
    if (h.length === 3){
      const r = parseInt(h[0] + h[0], 16), g = parseInt(h[1] + h[1], 16), b = parseInt(h[2] + h[2], 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
      return null;
    }
    if (h.length === 6){
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
      return null;
    }
    return null;
  }

  function iuRelLuminance(rgb){
    const r = rgb && Number.isFinite(rgb.r) ? rgb.r : 0;
    const g = rgb && Number.isFinite(rgb.g) ? rgb.g : 0;
    const b = rgb && Number.isFinite(rgb.b) ? rgb.b : 0;
    const sr = r / 255, sg = g / 255, sb = b / 255;
    const lin = (c) => (c <= 0.03928) ? (c / 12.92) : Math.pow((c + 0.055) / 1.055, 2.4);
    const R = lin(sr), G = lin(sg), B = lin(sb);
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }

  function iuContrastRatio(l1, l2){
    const L1 = Math.max(l1, l2);
    const L2 = Math.min(l1, l2);
    return (L1 + 0.05) / (L2 + 0.05);
  }

  function iuSetChipTextContrast(chipEl, bgHex){
    if (!chipEl) return;
    const rgb = iuHexToRgb(bgHex);
    if (!rgb) {
      chipEl.removeAttribute("data-iu-text");
      return;
    }
    const Lbg = iuRelLuminance(rgb);
    const Lwhite = 1.0;
    const Ldark = iuRelLuminance({ r: 11, g: 27, b: 43 }); // #0b1b2b
    const cWhite = iuContrastRatio(Lbg, Lwhite);
    const cDark  = iuContrastRatio(Lbg, Ldark);
    if (cWhite < 4.5 && cDark > cWhite) chipEl.setAttribute("data-iu-text", "dark");
    else chipEl.removeAttribute("data-iu-text");
  }

  function iuApplySolidChipTextContrastInView(viewEl){
    try{
      if (!viewEl) return;
      const chips = Array.from(viewEl.querySelectorAll('.iuRadioChip'));
      for (const chip of chips){
        const bg = getComputedStyle(chip).backgroundColor;
        const m = bg && bg.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (!m) { chip.removeAttribute("data-iu-text"); continue; }
        const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
        if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) { chip.removeAttribute("data-iu-text"); continue; }
        const hex = "#" + [r,g,b].map(v => v.toString(16).padStart(2,"0")).join("");
        iuSetChipTextContrast(chip, hex);
      }
    }catch{}
  }

  function iuScrollMainToTopSmooth(){
    try{
      // Prefer: scroll within the main feed container if it exists and scrolls.
      const feed = document.getElementById("newsList") || document.getElementById("feed");
      if (feed && feed.scrollHeight > feed.clientHeight){
        try{
          if (typeof feed.scrollTo === "function") feed.scrollTo({ top: 0, behavior: "smooth" });
          else feed.scrollTop = 0;
        }catch{
          try{ feed.scrollTop = 0; }catch{}
        }
        return;
      }
    }catch{}

    try{
      // Fallback: window scroll
      window.scrollTo({ top: 0, behavior: "smooth" });
    }catch{
      try{ window.scrollTo(0, 0); }catch{}
    }
  }

  // ============================================================
  // NOTES — unified component across the whole web
  // (persistent localStorage, no TTL/cleanup, share via Web Share API)
  // ============================================================

  // Legacy (migration only): main-section notes used to live under this JSON object key.
  const IU_SECTION_NOTES_KEY = "iu_section_notes_v1";
  const IU_NOTES_PREFIX = "iu_notes_v1_";

  function iuLoadLegacySectionNotes(){
    try{
      const raw = localStorage.getItem(IU_SECTION_NOTES_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
      return obj;
    }catch{
      return {};
    }
  }

  function iuSaveLegacySectionNotes(obj){
    try{
      if (!obj || typeof obj !== "object") return;
      localStorage.setItem(IU_SECTION_NOTES_KEY, JSON.stringify(obj));
    }catch{}
  }

  function iuSlug(s){
    return String(s || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
  }

  function iuKeyPart(s){
    return String(s || "")
      .toLowerCase()
      .trim()
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[^a-z0-9_]+/g,"_")
      .replace(/^_+|_+$/g,"");
  }

  function iuNotesKey(scope, name){
    const sc = iuKeyPart(scope);
    const nm = iuKeyPart(name);
    if (!sc || !nm) return "";
    return IU_NOTES_PREFIX + sc + "_" + nm;
  }

  function iuRenderNotesHost(hostEl, opts){
    try{
      const el = hostEl;
      if (!el) return;
      const scope = String((opts && opts.scope) || el.dataset?.iuNotesScope || "").trim();
      const title = String((opts && opts.title) || el.dataset?.iuNotesTitle || "").trim();
      const name = String(el.dataset?.iuNotesName || title || "").trim();
      if (!scope || !name) return;

      const scSlug = iuSlug(scope);
      const nmSlug = iuSlug(name);

      const explicitKey = iuKeyPart(el.dataset?.iuNotesKey || "");
      const key = explicitKey ? (IU_NOTES_PREFIX + explicitKey) : iuNotesKey(scope, name);
      if (!key) return;

      // Lazy migrations
      try{
        if (scSlug === "section") {
          const cur = String(localStorage.getItem(key) || "");
          if (!cur) {
            const legacy = iuLoadLegacySectionNotes();
            const legacyKey = String(name || "").trim().toLowerCase();
            const legacyVal = (legacy && typeof legacy[legacyKey] === "string") ? legacy[legacyKey] : "";
            if (legacyVal) {
              try { localStorage.setItem(key, String(legacyVal || "")); } catch {}
              // Keep legacy entry as-is (never auto-delete).
            }
          }
        }
      }catch{}

      // Migration from old key format (hyphen slug, derived from UI text)
      try{
        const cur = String(localStorage.getItem(key) || "");
        if (!cur) {
          const oldDerived = IU_NOTES_PREFIX + iuSlug(scope) + "_" + iuSlug(name);
          if (oldDerived && oldDerived !== key) {
            const v = String(localStorage.getItem(oldDerived) || "");
            if (v) { try { localStorage.setItem(key, v); } catch {} }
          }
        }
      }catch{}

      // Travel/Maps legacy key migration (copy, never delete)
      try{
        const cur = String(localStorage.getItem(key) || "");
        if (!cur) {
          let legacyKey2 = "";
          if (scSlug === "travel") legacyKey2 = "iu_travel_notes_v1_" + nmSlug;
          if (scSlug === "maps" || scSlug === "mapy") legacyKey2 = "iu_maps_notes_v1_" + nmSlug;
          if (legacyKey2) {
            const legacyVal2 = String(localStorage.getItem(legacyKey2) || "");
            if (legacyVal2) {
              try { localStorage.setItem(key, legacyVal2); } catch {}
            }
          }
        }
      }catch{}

      // idempotent: avoid duplicate render
      try{
        if (el.dataset && el.dataset.iuNotesRendered === "1" && el.querySelector(".iuNotes")) return;
      }catch{}

      const anchorId = ("iu-notes-" + (scSlug || "notes") + "-" + (nmSlug || "item")).replace(/[^a-z0-9\-]/g,"");
      try{ if (!el.id) el.id = anchorId; }catch{}

      let shareUrl =
        String((opts && opts.shareUrl) || el.dataset?.iuNotesShareUrl || "").trim();
      if (!shareUrl) {
        try{
          const u = new URL(String(window.location.href || ""));
          // Keep section param stable if we know it
          try{
            const curSection = String(document.body?.dataset?.section || "").trim().toLowerCase();
            if (curSection) u.searchParams.set("section", curSection);
          }catch{}
          u.hash = anchorId;
          shareUrl = u.toString();
        }catch{
          shareUrl = (typeof window !== "undefined" ? String(window.location.href || "") : "");
        }
      }

      const shareTitle = `Poznámky — ${String(title || name || "Poznámky")}`.trim();

      const wrap = document.createElement("div");
      wrap.className = "iuNotes";
      wrap.setAttribute("data-iu-notes", "");
      wrap.setAttribute("data-iu-notes-storage-key", key);
      wrap.innerHTML =
        `<div class="iuNotesHead">` +
          `<div class="iuNotesTitle">${escapeHtml(title || "Poznámky")}</div>` +
          `<div class="iuNotesActions">` +
            `<button type="button" class="iuNotesBtn" data-iu-notes-copy>Zkopírovat</button>` +
            `<button type="button" class="iuNotesBtn" data-iu-notes-clear>Vyčistit</button>` +
            `<button type="button" class="iuNotesBtn iuNotesBtnPrimary" data-iu-notes-send>Odeslat</button>` +
            `<button type="button" class="iuBtn iuBtn--ghost iuNotesShare">Sdílet</button>` +
            `<button type="button" class="iuBtn iuBtn--ghost iuNotesWhatsApp">WhatsApp</button>` +
          `</div>` +
        `</div>` +
        `<textarea class="iuNotesText iuNotesInput" data-iu-notes-text placeholder="Piš poznámky…"></textarea>` +
        `<div class="iuNotesSendBar" data-iu-notes-sendbar hidden>` +
          `<button type="button" class="iuNotesSendOpt" data-iu-notes-send-wa>WhatsApp</button>` +
          `<button type="button" class="iuNotesSendOpt" data-iu-notes-send-mail>E-mail</button>` +
          `<button type="button" class="iuNotesSendOpt" data-iu-notes-send-copy>Kopírovat pro odeslání</button>` +
        `</div>` +
        `<div class="iuNotesStatus" data-iu-notes-status hidden></div>`;

      // Accent (optional)
      try{
        const accentVar = String((opts && opts.accentVar) || "").trim();
        const accent = String((opts && opts.accent) || "").trim();
        if (accentVar) wrap.style.setProperty("--iuNotesAccent", `var(${accentVar})`);
        else if (accent) wrap.style.setProperty("--iuNotesAccent", accent);
      }catch{}

      const ta = wrap.querySelector("textarea.iuNotesInput");
      if (ta) {
        try { ta.value = String(localStorage.getItem(key) || ""); } catch { ta.value = ""; }
        iuAutosizeTextarea(ta);
        ta.addEventListener("input", () => {
          try{
            localStorage.setItem(key, String(ta.value || ""));
            iuAutosizeTextarea(ta);
            try { ta.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch {}
          }catch{}
        });
      }

      const getText = () => String((ta && ta.value) || "").trim();
      const getShareText = () => {
        const t = getText();
        if (!t) return "";
        const u = String(shareUrl || "").trim();
        return u ? (t + "\n\n" + u) : t;
      };

      const shareBtn = wrap.querySelector(".iuNotesShare");
      const waBtn = wrap.querySelector(".iuNotesWhatsApp");

      const openMailto = () => {
        try{
          const text = getText();
          if (!text) return;
          const subject = encodeURIComponent(shareTitle);
          const body = encodeURIComponent(getShareText());
          window.location.href = `mailto:?subject=${subject}&body=${body}`;
        }catch{}
      };

      if (shareBtn) shareBtn.addEventListener("click", async () => {
        try{
          const text = getText();
          if (!text) return;
          const payload = { title: shareTitle, text, url: shareUrl || undefined };
          if (navigator.share) {
            try { await navigator.share(payload); return; } catch {}
          }
          openMailto();
        }catch{}
      });

      if (waBtn) waBtn.addEventListener("click", () => {
        try{
          const text = getText();
          if (!text) return;
          const msg = encodeURIComponent(getShareText());
          window.open(`https://wa.me/?text=${msg}`, "_blank", "noopener,noreferrer");
        }catch{}
      });

      el.innerHTML = "";
      el.appendChild(wrap);
      try { if (el.dataset) el.dataset.iuNotesRendered = "1"; } catch {}
    }catch{}
  }

  function iuInitNotesInView(rootEl){
    try{
      const root = rootEl || document;
      root.querySelectorAll(".iuNotesHost").forEach((el) => {
        try{ iuRenderNotesHost(el, {}); }catch{}
      });
    }catch{}
  }

  function iuInitNotes(){
    try{ iuInitNotesInView(document); }catch{}
  }

  function iuMountNotesForCurrentSection(){
    try{
      const section = String(document.body?.dataset?.section || "").trim().toLowerCase();
      if (!section) return;

      // map URL section -> storage key + view element
      const map = {
        radio:   { key: "radio",    view: () => document.getElementById("iuRadioView"),    accentVar: "--iuNavAccent-radio",    label: "Rádia" },
        tvonline:{ key: "tvonline", view: () => document.getElementById("iuTvOnlineView"),accentVar: "--iuNavAccent-tvonline", label: "TV online" },
        jr:      { key: "jr",       view: () => document.getElementById("iuJrEmptyView"), accentVar: "--iuNavAccent-jr",       label: "Jízdní řády" },
        mapy:    { key: "mapy",     view: () => document.getElementById("iuMapyView") || document.getElementById("iuMapsView"), accentVar: "--iuNavAccent-mapy", label: "Mapy & Navigace" },
        pocasi:  { key: "weather",  view: () => document.getElementById("iuWeatherView"), accentVar: "--iuNavAccent-pocasi",   label: "Počasí" },
        tvprogram:{ key:"tvprogram",view: () => document.getElementById("iuTvProgramView"),accentVar:"--iuNavAccent-tvprogram", label:"TV program" },
        culture: { key: "culture",  view: () => document.getElementById("iuCultureView") || document.getElementById("feed"), accentVar: "--iuNavAccent-culture", label: "Kultura / Akce" },
        ads:     { key: "ads",      view: () => document.getElementById("iuAdsView") || document.getElementById("feed"),     accentVar: "--iuNavAccent-ads",     label: "Inzerce" },
      };

      const cfg = map[section];
      if (!cfg) return;
      const viewEl = cfg.view && cfg.view();
      if (!viewEl) return;

      // host is inserted once per view
      let host = null;
      try{
        const all = Array.from(viewEl.querySelectorAll(`.iuNotesHost[data-iu-notes-scope="section"]`));
        host = all.find((h) => String(h?.dataset?.iuNotesName || "") === String(cfg.key || "")) || null;
      }catch{}
      if (!host) {
        host = document.createElement("div");
        host.className = "iuNotesHost";
        host.dataset.iuNotesScope = "section";
        host.dataset.iuNotesKey = `section_${String(cfg.key || "")}`;
        host.dataset.iuNotesName = String(cfg.key || "");
        host.dataset.iuNotesTitle = String(cfg.label || cfg.key || "");

        const firstChip = viewEl.querySelector(".iuRadioChip");
        let anchor = null;
        if (firstChip) {
          anchor =
            firstChip.closest(".iuRadioGrid, .iuChipGrid, .iuRadioChips, .iuSectionBody") ||
            firstChip.parentElement;
        }
        if (anchor && anchor.parentNode) anchor.insertAdjacentElement("afterend", host);
        else viewEl.appendChild(host);
      }

      // stable share URL for the section
      let shareUrl = "";
      try{
        const u = new URL(window.location.href);
        u.searchParams.set("section", section);
        shareUrl = u.toString();
      }catch{
        shareUrl = String(window.location.href || "");
      }

      iuRenderNotesHost(host, { scope: "section", title: cfg.label, shareUrl, accentVar: cfg.accentVar });
    }catch{}
  }

  // ============================================================
  // MŮJ INFO UZEL — 5 custom sections (UI-only, localStorage)
  // ============================================================

  const MYUZEL_STORAGE_KEY = "iu_myuzel_v1";
  const MYUZEL_BUTTONS_MAX = 4;

  function iuAutosizeTextarea(ta){
    try{
      if (!ta) return;
      ta.style.height = "auto";
      ta.style.overflow = "hidden";
      ta.style.height = (ta.scrollHeight + 2) + "px";
    }catch{}
  }

  function iuMyUzelDefaultState(){
    const mkBtns = () => Array.from({ length: MYUZEL_BUTTONS_MAX }).map((_, i) => ({
      title: `Tlačítko ${i + 1}`,
      url: "",
    }));
    return {
      sections: Array.from({ length: 5 }).map((_, i) => ({
        name: `Sekce ${i + 1}`,
        color: "#b9bcc2",
        buttons: mkBtns(),
        notes: "",
      })),
      activeSection: 1,
    };
  }

  function iuMyUzelClampName(s){
    const t = String(s || "").trim().slice(0, 14);
    return t || "";
  }

  function iuMyUzelValidateState(raw){
    const def = iuMyUzelDefaultState();
    const out = (raw && typeof raw === "object") ? raw : {};
    const sections = Array.isArray(out.sections) ? out.sections : [];
    const fixedSections = [];

    for (let i = 0; i < 5; i++) {
      const src = sections[i] && typeof sections[i] === "object" ? sections[i] : {};
      const name = iuMyUzelClampName(src.name) || def.sections[i].name;
      const color = String(src.color || def.sections[i].color || "#b9bcc2").trim() || "#b9bcc2";
      const btns = Array.isArray(src.buttons) ? src.buttons : [];
      const fixedBtns = [];
      for (let j = 0; j < MYUZEL_BUTTONS_MAX; j++) {
        const b = btns[j] && typeof btns[j] === "object" ? btns[j] : {};
        fixedBtns.push({
          title: iuMyUzelClampName(b.title) || `Tlačítko ${j + 1}`,
          url: String(b.url || "").trim(),
        });
      }
      const notes = (typeof src.notes === "string") ? src.notes : "";
      fixedSections.push({ name, color, buttons: fixedBtns, notes });
    }

    let activeSection = 1;
    try{
      const n = parseInt(out.activeSection, 10);
      if (Number.isFinite(n) && n >= 1 && n <= 5) activeSection = n;
    }catch{}

    return { sections: fixedSections, activeSection };
  }

  function iuMyUzelLoad(){
    try{
      const txt = localStorage.getItem(MYUZEL_STORAGE_KEY);
      if (!txt) {
        const st = iuMyUzelDefaultState();
        try { localStorage.setItem(MYUZEL_STORAGE_KEY, JSON.stringify(st)); } catch {}
        return st;
      }
      const parsed = JSON.parse(txt);
      const st = iuMyUzelValidateState(parsed);
      // repair storage silently if needed
      try { localStorage.setItem(MYUZEL_STORAGE_KEY, JSON.stringify(st)); } catch {}
      return st;
    }catch{
      const st = iuMyUzelDefaultState();
      try { localStorage.setItem(MYUZEL_STORAGE_KEY, JSON.stringify(st)); } catch {}
      return st;
    }
  }

  function iuMyUzelSave(state){
    try{
      const st = iuMyUzelValidateState(state);

      // sanitize legacy storage (drop buttons 5/6 permanently)
      try{
        for (const sec of st.sections || []) {
          if (Array.isArray(sec.buttons) && sec.buttons.length > MYUZEL_BUTTONS_MAX) {
            sec.buttons = sec.buttons.slice(0, MYUZEL_BUTTONS_MAX);
          }
          if (typeof sec.notes !== "string") sec.notes = "";
        }
      }catch{}

      localStorage.setItem(MYUZEL_STORAGE_KEY, JSON.stringify(st));

      // FINAL: always apply saved colors to rail + views (stable even after reload)
      try{
        const items = Array.from(document.querySelectorAll('.iuMyUzelItem'));
        for (let i = 0; i < 5; i++) {
          const sec = st.sections && st.sections[i] ? st.sections[i] : null;
          if (!sec) continue;
          const rawC = String(sec.color || "#b9bcc2").trim() || "#b9bcc2";
          const isColored = (rawC.toLowerCase() !== "#b9bcc2");

          // --- APPLY COLOR TO RAIL ITEM ---
          const railItem =
            document.querySelector(`.iuMyUzelItem[data-slot="${i+1}"]`) ||
            document.querySelector(`.iuMyUzelItem[data-myuzel-slot="${i+1}"]`) ||
            items[i];

          if (railItem) {
            if (isColored) {
              try { railItem.style.setProperty("--iuNavAccent", rawC); } catch {}
              try { railItem.style.setProperty("--iuMyUzelAccent", rawC); } catch {}
              try { railItem.setAttribute("data-myuzel-colored", "1"); } catch {}
            } else {
              try { railItem.style.removeProperty("--iuNavAccent"); } catch {}
              try { railItem.style.removeProperty("--iuMyUzelAccent"); } catch {}
              try { railItem.setAttribute("data-myuzel-colored", "0"); } catch {}
            }
          }

          // Apply to any matching rail nodes (future-proof; avoids regressions on duplicates)
          try{
            const railItems = document.querySelectorAll(`.iuMyUzelItem[data-slot="${i+1}"], .iuMyUzelItem[data-myuzel-slot="${i+1}"]`);
            railItems.forEach((el) => {
              if (isColored) {
                try { el.style.setProperty("--iuNavAccent", rawC); } catch {}
                try { el.style.setProperty("--iuMyUzelAccent", rawC); } catch {}
                try { el.setAttribute("data-myuzel-colored", "1"); } catch {}
              } else {
                try { el.style.removeProperty("--iuNavAccent"); } catch {}
                try { el.style.removeProperty("--iuMyUzelAccent"); } catch {}
                try { el.setAttribute("data-myuzel-colored", "0"); } catch {}
              }
            });
          }catch{}

          // --- APPLY COLOR TO VIEW WRAPPER ---
          const viewEl = document.getElementById(`iuMyUzelView${i+1}`);
          if (viewEl) {
            if (isColored) {
              try { viewEl.style.setProperty("--iuMyUzelAccent", rawC); } catch {}
              try { viewEl.setAttribute("data-myuzel-colored", "1"); } catch {}
            } else {
              try { viewEl.style.removeProperty("--iuMyUzelAccent"); } catch {}
              try { viewEl.setAttribute("data-myuzel-colored", "0"); } catch {}
            }
          }
        }
      }catch{}

      return st;
    }catch{
      return iuMyUzelValidateState(state);
    }
  }

  function iuMyUzelGetRailItem(slot){
    try{
      return document.querySelector(`.iu-leftNav .iuMyUzelItem[data-myuzel-slot="${slot}"]`);
    }catch{
      return null;
    }
  }

  function iuMyUzelApplyRailState(){
    try{
      const st = iuMyUzelLoad();
      for (let i = 1; i <= 5; i++) {
        const it = iuMyUzelGetRailItem(i);
        if (!it) continue;
        const sec = st.sections[i - 1];
        const label = it.querySelector(".iu-leftNavLabel");
        if (label) label.textContent = String(sec.name || `Sekce ${i}`).trim();
        const rawC = String(sec.color || "#b9bcc2").trim() || "#b9bcc2";
        const isColored = (rawC.toLowerCase() !== "#b9bcc2");
        // Rail: keep neutral until user sets a custom color.
        try { it.style.setProperty("--iuMyUzelIcon", rawC); } catch {}
        if (isColored) {
          try { it.style.setProperty("--iuMyUzelAccent", rawC); } catch {}
          try { it.style.setProperty("--iuNavAccent", rawC); } catch {}
          try { it.setAttribute("data-myuzel-colored", "1"); } catch {}
        } else {
          try { it.style.removeProperty("--iuMyUzelAccent"); } catch {}
          try { it.style.removeProperty("--iuNavAccent"); } catch {}
          try { it.setAttribute("data-myuzel-colored", "0"); } catch {}
        }
      }
    }catch{}
  }

  function iuMyUzelRenderSection(slot){
    const s = parseInt(slot, 10);
    if (!Number.isFinite(s) || s < 1 || s > 5) return;
    const st = iuMyUzelLoad();
    const sec = st.sections[s - 1];
    const rawC = String(sec.color || "#b9bcc2").trim() || "#b9bcc2";
    const isColored = (rawC.toLowerCase() !== "#b9bcc2");

    const view = document.getElementById(`iuMyUzelView${s}`);
    const title = document.getElementById(`iuMyUzelTitle${s}`);
    const btnWrap = view ? view.querySelector(`.iuMyUzelButtons[data-myuzel-slot="${s}"]`) : null;
    if (title) title.textContent = String(sec.name || `Sekce ${s}`).trim();
    if (view) {
      if (isColored) {
        try { view.style.setProperty("--iuMyUzelAccent", rawC); } catch {}
        try { view.setAttribute("data-myuzel-colored", "1"); } catch {}
      } else {
        try { view.style.removeProperty("--iuMyUzelAccent"); } catch {}
        try { view.setAttribute("data-myuzel-colored", "0"); } catch {}
      }
    }
    if (!btnWrap) return;

    try { btnWrap.classList.add("iuRadioGrid"); } catch {}

    const rows = [];
    const btns = Array.isArray(sec.buttons) ? sec.buttons.slice(0, MYUZEL_BUTTONS_MAX) : [];
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i] || {};
      rows.push(
        `<div class="iuMyUzelBtnWrap">` +
          `<button type="button" class="iuMyUzelBtnGear" data-myuzel-slot="${s}" data-myuzel-btn="${i}" aria-label="Nastavení tlačítka">` +
            `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
              `<path d="M12 15.5a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7z" fill="none" stroke="currentColor" stroke-width="2"/>` +
              `<path d="M19.4 15a7.9 7.9 0 0 0 .1-2l2-1.6l-2-3.5l-2.4.8a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.4 2.7a7.6 7.6 0 0 0-1.7 1L6.5 5.9l-2 3.5L6.5 11a7.9 7.9 0 0 0 0 2l-2 1.6l2 3.5l2.4-.8a7.6 7.6 0 0 0 1.7 1L11 21h4l.4-2.7a7.6 7.6 0 0 0 1.7-1l2.4.8l2-3.5L19.4 15z" fill="none" stroke="currentColor" stroke-width="2"/>` +
            `</svg>` +
          `</button>` +
          `<button type="button" class="iuRadioChip iuMyUzelChip" data-myuzel-slot="${s}" data-myuzel-open="${i}">` +
            `<div class="iuRadioChipTitle">${escapeHtml(b.title || `Tlačítko ${i + 1}`)}</div>` +
          `</button>` +
        `</div>`
      );
    }
    btnWrap.innerHTML = rows.join("") + `<div class="iuMyUzelInlineMsg" id="iuMyUzelMsg${s}" hidden></div>`;

    // Chip text contrast (only when colored -> solid bg)
    try{
      const chips = btnWrap.querySelectorAll(".iuMyUzelChip");
      chips.forEach((chip) => {
        if (isColored) iuSetChipTextContrast(chip, rawC);
        else chip.removeAttribute("data-iu-text");
      });
    }catch{}

    // Notes block (per-section) — unified Notes component
    try{
      if (!view) return;
      const existingHost = view.querySelector(`.iuNotesHost[data-iu-notes-scope="myuzel"]`);
      if (existingHost) existingHost.remove();

      const host = document.createElement("div");
      host.className = "iuNotesHost";
      host.dataset.iuNotesScope = "myuzel";
      host.dataset.iuNotesKey = `myuzel_slot_${s}`;
      host.dataset.iuNotesName = `slot-${s}`;
      host.dataset.iuNotesTitle = String(sec.name || `Sekce ${s}`).trim();

      // Migration: keep existing notes saved inside iu_myuzel_v1
      try{
        const key = iuNotesKey("myuzel", `slot_${s}`);
        const cur = String(localStorage.getItem(key) || "");
        const legacy = String(sec.notes || "");
        if (!cur && legacy) localStorage.setItem(key, legacy);
        // Also copy from the older derived key format if it exists.
        if (!cur) {
          const oldKey = IU_NOTES_PREFIX + "myuzel_" + ("slot-" + String(s));
          const v2 = String(localStorage.getItem(oldKey) || "");
          if (v2) { try { localStorage.setItem(key, v2); } catch {} }
        }
      }catch{}

      // stable share URL for this MyUzel section
      let shareUrl = "";
      try{
        const u = new URL(window.location.href);
        u.searchParams.set("section", `myuzel-${s}`);
        shareUrl = u.toString();
      }catch{
        shareUrl = String(window.location.href || "");
      }

      btnWrap.insertAdjacentElement("afterend", host);
      iuRenderNotesHost(host, { scope: "myuzel", title: host.dataset.iuNotesTitle, shareUrl, accent: "var(--iuMyUzelAccent, #b9bcc2)" });
    }catch{}
  }

  function iuMyUzelApplyViewVisibility(sectionKey){
    try{
      const k = String(sectionKey || "").toLowerCase();
      if (!k.startsWith("myuzel-")) return;
      const slot = parseInt(k.split("-")[1], 10);
      if (!Number.isFinite(slot) || slot < 1 || slot > 5) return;
      iuMyUzelApplyRailState();
      iuMyUzelRenderSection(slot);
    }catch{}
  }

  function iuMyUzelNormalizeUrl(raw){
    const s0 = String(raw || "").trim();
    if (!s0) return { ok: true, url: "" };
    let s = s0;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) {
      s = "https://" + s.replace(/^\/+/, "");
    }
    try{
      const u = new URL(s);
      const p = String(u.protocol || "").toLowerCase();
      if (p !== "http:" && p !== "https:") {
        return { ok: false, url: "", err: "Povoleno je jen http/https URL." };
      }
      return { ok: true, url: u.toString() };
    }catch{
      return { ok: false, url: "", err: "Neplatná URL." };
    }
  }

  function iuMyUzelModalEls(){
    return {
      overlay: document.getElementById("iuMyUzelModalOverlay"),
      modal: document.getElementById("iuMyUzelModal"),
      close: document.getElementById("iuMyUzelModalClose"),
      title: document.getElementById("iuMyUzelModalTitle"),
      body: document.getElementById("iuMyUzelModalBody"),
      card: document.querySelector("#iuMyUzelModal .iuMyUzelModalCard"),
    };
  }

  function iuMyUzelCloseModal(){
    try{
      const { overlay, modal, body } = iuMyUzelModalEls();
      if (overlay) overlay.hidden = true;
      if (modal) modal.hidden = true;
      if (body) body.innerHTML = "";
      try { document.documentElement.style.overflow = ""; } catch {}
    }catch{}
  }

  function iuMyUzelOpenModal(opts){
    try{
      const { overlay, modal, title, body } = iuMyUzelModalEls();
      if (!overlay || !modal || !title || !body) return;
      title.textContent = String((opts && opts.title) || "Nastavení");
      body.innerHTML = String((opts && opts.html) || "");
      overlay.hidden = false;
      modal.hidden = false;
      try { document.documentElement.style.overflow = "hidden"; } catch {}

      // focus first input
      try{
        const first = modal.querySelector("input, button, select, textarea, [tabindex]:not([tabindex='-1'])");
        if (first && first.focus) first.focus();
      }catch{}
    }catch{}
  }

  function iuMyUzelOpenSectionSettings(slot){
    const s = parseInt(slot, 10);
    if (!Number.isFinite(s) || s < 1 || s > 5) return;
    const st = iuMyUzelLoad();
    const sec = st.sections[s - 1];
    const name = iuMyUzelClampName(sec.name) || `Sekce ${s}`;
    const color = String(sec.color || "#b9bcc2").trim() || "#b9bcc2";

    iuMyUzelOpenModal({
      title: "Nastavení sekce",
      html:
        `<div class="iuMyUzelField">` +
          `<label for="iuMyUzelSectionName">uveďte název sekce</label>` +
          `<input class="iuMyUzelInput" id="iuMyUzelSectionName" maxlength="14" value="${escapeHtml(name)}" />` +
        `</div>` +
        `<div class="iuMyUzelField">` +
          `<label for="iuMyUzelSectionColor">barva</label>` +
          `<input class="iuMyUzelInput" id="iuMyUzelSectionColor" type="color" value="${escapeHtml(color)}" />` +
        `</div>` +
        `<div class="iuMyUzelActions">` +
          `<button type="button" class="iuMyUzelPrimaryBtn" id="iuMyUzelConfirmSection" style="--iuMyUzelAccent:${escapeHtml(color)}">Potvrdit</button>` +
        `</div>` +
        `<div class="iuMyUzelErr" id="iuMyUzelErr" hidden></div>`
    });

    // bind confirm (single-shot via delegation below)
    try{
      const el = document.getElementById("iuMyUzelConfirmSection");
      if (el) el.setAttribute("data-myuzel-confirm-section", String(s));
    }catch{}
  }

  function iuMyUzelOpenButtonSettings(slot, btnIndex){
    const s = parseInt(slot, 10);
    const i = parseInt(btnIndex, 10);
    if (!Number.isFinite(s) || s < 1 || s > 5) return;
    if (!Number.isFinite(i) || i < 0 || i >= MYUZEL_BUTTONS_MAX) return;
    const st = iuMyUzelLoad();
    const sec = st.sections[s - 1];
    const b = sec.buttons[i] || {};
    const title = iuMyUzelClampName(b.title) || `Tlačítko ${i + 1}`;
    const url = String(b.url || "").trim();
    const color = String(sec.color || "#b9bcc2").trim() || "#b9bcc2";

    iuMyUzelOpenModal({
      title: "Nastavení tlačítka",
      html:
        `<div class="iuMyUzelField">` +
          `<label for="iuMyUzelBtnUrl">vložte www</label>` +
          `<input class="iuMyUzelInput" id="iuMyUzelBtnUrl" placeholder="např. www.infouzel.cz" value="${escapeHtml(url)}" />` +
        `</div>` +
        `<div class="iuMyUzelField">` +
          `<label for="iuMyUzelBtnTitle">název tlačítka</label>` +
          `<input class="iuMyUzelInput" id="iuMyUzelBtnTitle" maxlength="14" value="${escapeHtml(title)}" />` +
        `</div>` +
        `<div class="iuMyUzelActions">` +
          `<button type="button" class="iuMyUzelPrimaryBtn" id="iuMyUzelConfirmBtn" style="--iuMyUzelAccent:${escapeHtml(color)}">Potvrdit</button>` +
        `</div>` +
        `<div class="iuMyUzelErr" id="iuMyUzelErr" hidden></div>`
    });

    try{
      const el = document.getElementById("iuMyUzelConfirmBtn");
      if (el) {
        el.setAttribute("data-myuzel-confirm-btn-slot", String(s));
        el.setAttribute("data-myuzel-confirm-btn-idx", String(i));
      }
    }catch{}
  }

  function iuMyUzelActivate(slot){
    const s = parseInt(slot, 10);
    if (!Number.isFinite(s) || s < 1 || s > 5) return;
    try{
      const st = iuMyUzelLoad();
      st.activeSection = s;
      iuMyUzelSave(st);
    }catch{}
    try{
      persistSection(`myuzel-${s}`);
      applySectionFromURL();
    }catch{}
    // UX: always bring user to the top of the section buttons.
    try{
      requestAnimationFrame(() => {
        try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { try { window.scrollTo(0, 0); } catch {} }
        try {
          const sc = document.getElementById("newsList");
          if (sc && typeof sc.scrollTop === "number") sc.scrollTop = 0;
        } catch {}
      });
    }catch{}
  }

  function iuMyUzelShowErr(msg){
    try{
      const el = document.getElementById("iuMyUzelErr");
      if (!el) return;
      el.textContent = String(msg || "");
      el.hidden = !el.textContent;
    }catch{}
  }

  // Global delegation (small, safe; avoids many listeners)
  document.addEventListener("click", (e) => {
    try{
      const t = e && e.target;
      if (!t) return;

      // Modal close
      if (t.id === "iuMyUzelModalOverlay" || t.id === "iuMyUzelModalClose" || t.closest?.("#iuMyUzelModalClose")) {
        e.preventDefault();
        e.stopPropagation();
        iuMyUzelCloseModal();
        return;
      }

      // Section settings confirm
      const confirmSection = t.closest?.("[data-myuzel-confirm-section]");
      if (confirmSection) {
        e.preventDefault();
        e.stopPropagation();
        iuMyUzelShowErr("");
        const slot = parseInt(confirmSection.getAttribute("data-myuzel-confirm-section") || "0", 10);
        const nameEl = document.getElementById("iuMyUzelSectionName");
        const colorEl = document.getElementById("iuMyUzelSectionColor");
        const name = iuMyUzelClampName(nameEl ? nameEl.value : "") || `Sekce ${slot || ""}`.trim();
        const color = String(colorEl ? colorEl.value : "").trim() || "#b9bcc2";

        const st = iuMyUzelLoad();
        if (st.sections && st.sections[slot - 1]) {
          st.sections[slot - 1].name = name;
          st.sections[slot - 1].color = color;
          iuMyUzelSave(st);
        }
        iuMyUzelApplyRailState();
        iuMyUzelRenderSection(slot);
        iuMyUzelCloseModal();
        return;
      }

      // Button settings confirm
      const confirmBtn = t.closest?.("[data-myuzel-confirm-btn-slot]");
      if (confirmBtn) {
        e.preventDefault();
        e.stopPropagation();
        iuMyUzelShowErr("");
        const slot = parseInt(confirmBtn.getAttribute("data-myuzel-confirm-btn-slot") || "0", 10);
        const idx = parseInt(confirmBtn.getAttribute("data-myuzel-confirm-btn-idx") || "0", 10);
        if (!Number.isFinite(idx) || idx < 0 || idx >= MYUZEL_BUTTONS_MAX) return;
        const urlEl = document.getElementById("iuMyUzelBtnUrl");
        const titleEl = document.getElementById("iuMyUzelBtnTitle");
        const title = iuMyUzelClampName(titleEl ? titleEl.value : "") || `Tlačítko ${idx + 1}`;
        const norm = iuMyUzelNormalizeUrl(urlEl ? urlEl.value : "");
        if (!norm.ok) { iuMyUzelShowErr(norm.err || "Neplatná URL."); return; }

        const st = iuMyUzelLoad();
        try{
          if (!st.sections || !st.sections[slot - 1] || !Array.isArray(st.sections[slot - 1].buttons)) throw new Error("Bad section");
          if (!st.sections[slot - 1].buttons[idx]) st.sections[slot - 1].buttons[idx] = { title: "", url: "" };
          st.sections[slot - 1].buttons[idx].title = title;
          st.sections[slot - 1].buttons[idx].url = norm.url;
          iuMyUzelSave(st);
        }catch{}
        iuMyUzelApplyRailState();
        iuMyUzelRenderSection(slot);
        iuMyUzelCloseModal();
        return;
      }

      // Open section settings (gear)
      const gear = t.closest?.(".iuMyUzelSectionGear");
      if (gear) {
        e.preventDefault();
        e.stopPropagation();
        const slot = parseInt(gear.getAttribute("data-myuzel-slot") || "0", 10);
        iuMyUzelOpenSectionSettings(slot);
        return;
      }

      // Open button settings (gear)
      const btnGear = t.closest?.(".iuMyUzelBtnGear");
      if (btnGear) {
        e.preventDefault();
        e.stopPropagation();
        const slot = parseInt(btnGear.getAttribute("data-myuzel-slot") || "0", 10);
        const idx = parseInt(btnGear.getAttribute("data-myuzel-btn") || "0", 10);
        if (!Number.isFinite(idx) || idx < 0 || idx >= MYUZEL_BUTTONS_MAX) return;
        iuMyUzelOpenButtonSettings(slot, idx);
        return;
      }

      // Open button URL (or settings if empty)
      const btn = t.closest?.(".iuMyUzelChip");
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        const slot = parseInt(btn.getAttribute("data-myuzel-slot") || "0", 10);
        const idx = parseInt(btn.getAttribute("data-myuzel-open") || "0", 10);
        if (!Number.isFinite(idx) || idx < 0 || idx >= MYUZEL_BUTTONS_MAX) return;
        const st = iuMyUzelLoad();
        const url = String(st?.sections?.[slot - 1]?.buttons?.[idx]?.url || "").trim();
        if (!url) {
          iuMyUzelOpenButtonSettings(slot, idx);
          return;
        }
        const norm = iuMyUzelNormalizeUrl(url);
        if (!norm.ok || !norm.url) {
          iuMyUzelOpenButtonSettings(slot, idx);
          return;
        }
        window.open(norm.url, "_blank", "noopener,noreferrer");
        return;
      }
    }catch{}
  }, true);

  document.addEventListener("keydown", (e) => {
    try{
      const { modal } = iuMyUzelModalEls();
      if (!modal || modal.hidden) return;
      if (e && e.key === "Escape") {
        e.preventDefault();
        iuMyUzelCloseModal();
      }
    }catch{}
  });

  function toPlainStringList(list){
    if (!Array.isArray(list)) return [];
    return list.map((x) => String(x || "").trim()).filter(Boolean);
  }

  function normalizeForSearch(s){
    try{
      return String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
    }catch{
      return String(s || "").toLowerCase().trim();
    }
  }

  function isValidEmail(v){
    const s = String(v || "").trim();
    if (!s) return false;
    if (/\s/.test(s)) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  async function loadWishDataIntoState(){
    // NOTE: do not touch feed pipeline state; add a new safe bucket only
    const out = {
      radios: Array.isArray(FALLBACK_WISH.radios) ? [...FALLBACK_WISH.radios] : [],
      names: Array.isArray(FALLBACK_WISH.names) ? [...FALLBACK_WISH.names] : [],
      artists: Array.isArray(FALLBACK_WISH.artists) ? [...FALLBACK_WISH.artists] : [],
      iam: Array.isArray(FALLBACK_WISH.iam) ? [...FALLBACK_WISH.iam] : []
    };

    try{
      // Self-contained fetch (do not depend on outer helpers).
      // Relative URLs resolve under /projects/ (same origin).
      const withTs = (rel) => {
        try{
          const u = new URL(String(rel || ""), window.location.href);
          u.searchParams.set("ts", String(Date.now()));
          return u.toString();
        }catch{
          return String(rel || "");
        }
      };
      const fetchJson = async (rel, timeoutMs = 4500) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try{
          const res = await fetch(withTs(rel), {
            cache: "no-store",
            headers: { "cache-control": "no-cache" },
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`HTTP_${res.status}`);
          return await res.json();
        } finally {
          clearTimeout(timer);
        }
      };

      const [radiosJson, calendarNamesJson, artistsJson, iamJson, legacyNamesJson] = await Promise.allSettled([
        fetchJson(iuDataUrl("radio_requests.json"), 4500),
        fetchJson(iuDataUrl("calendar_first_names.json"), 4500),
        fetchJson(iuDataUrl("artists_whitelist.json"), 4500),
        fetchJson(iuDataUrl("iam_whitelist.json"), 4500),
        // legacy fallback (older versions)
        fetchJson(iuDataUrl("names_whitelist.json"), 4500)
      ]);

      if (radiosJson.status === "fulfilled" && radiosJson.value && Array.isArray(radiosJson.value.radios)) {
        out.radios = radiosJson.value.radios
          .filter((r) => r && r.id && r.label && r.method)
          .map((r) => ({
            id: String(r.id),
            label: String(r.label),
            method: String(r.method),
            emailTo: r.emailTo ? String(r.emailTo) : undefined,
            url: r.url ? String(r.url) : undefined,
            hintText: r.hintText ? String(r.hintText) : undefined,
            smsHint: r.smsHint ? String(r.smsHint) : undefined
          }));
      }

      if (calendarNamesJson.status === "fulfilled" && calendarNamesJson.value && Array.isArray(calendarNamesJson.value.names)) {
        out.names = toPlainStringList(calendarNamesJson.value.names);
      } else if (legacyNamesJson.status === "fulfilled" && legacyNamesJson.value && Array.isArray(legacyNamesJson.value.names)) {
        out.names = toPlainStringList(legacyNamesJson.value.names);
      }

      if (artistsJson.status === "fulfilled" && artistsJson.value && Array.isArray(artistsJson.value.artists)) {
        // enforce unique + first 100 (spec: exactly 100 on prod via file contents)
        out.artists = toPlainStringList(artistsJson.value.artists)
          .filter((x, i, arr) => arr.indexOf(x) === i)
          .slice(0, 100);
      }

      if (iamJson.status === "fulfilled" && iamJson.value && Array.isArray(iamJson.value.iam)) {
        out.iam = toPlainStringList(iamJson.value.iam);
      }
    }catch{}

    wishData = out;
    try{
      // Store in a non-feed bucket (UI-only) for debugging/inspection.
      // We intentionally use window.state (not the feed's internal state closure).
      if (!window.state || typeof window.state !== "object") {
        window.state = {};
      }
      window.state.radioWish = { ...out, loadedAt: Date.now() };
    }catch{}
    return out;
  }

  function renderRadioView(viewEl){
    const mount = viewEl && typeof viewEl.querySelector === "function"
      ? viewEl.querySelector(".iuRadioMount")
      : null;
    const target = mount || viewEl;
    if (!target) return;

    const wishForm = `
      <details class="iuRadioWish iuWishAcc" id="iuRadioWish" aria-label="Přání do rádia">
        <summary class="iuWishAccSummary">
          <span class="iuWishAccTitle">Přání do rádia</span>
          <span class="iuWishAccCaret" aria-hidden="true"></span>
        </summary>

        <div class="iuWishAccBody">
          <div class="iuWishRows" role="group" aria-label="Formulář přání">
          <!-- Row 1: 3 equal blocks -->
          <div class="iuWishRow iuWishRow--3" aria-label="Základní volby">
            <div class="iuWishCard">
              <label class="iuWishCardBody">
                <span class="iuLabel">Typ požadavku</span>
                <select class="iuCtrl" id="iuWishType">
                  <option value="">— vyberte —</option>
                  <option value="narozeniny">Narozeninám</option>
                  <option value="svatek">Svátek</option>
                  <option value="vyroci">Výročí</option>
                  <option value="uspech">Úspěch / gratulace</option>
                  <option value="jen_tak">Jen tak pro radost</option>
                  <option value="jiny">Jiný</option>
                </select>
              </label>
            </div>

            <div class="iuWishCard">
              <div class="iuWishCardBody">
                <label class="iuLabel" for="iuWishRadio">Rádio *</label>
                <select class="iuCtrl" id="iuWishRadio" required>
                  <option value="">— vyberte —</option>
                </select>
                <div class="iuHint" id="iuWishRadioHint" hidden></div>
              </div>
            </div>

            <div class="iuWishCard">
              <div class="iuWishCardBody">
                <span class="iuLabel">Písnička od</span>
                <select class="iuCtrl" id="iuWishSong">
                  <option value="">— vyberte —</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Row 2: 3 equal blocks -->
          <div class="iuWishRow iuWishRow--3" aria-label="Adresáti a text přání">
            <div class="iuWishCard">
              <div class="iuWishCardBody">
                <span class="iuLabel">Pro koho *</span>
                <input class="iuCtrl" id="iuWishTo" type="text" required placeholder="Komu je přání určeno" />
                <div class="iuErr" id="iuWishToErr" hidden>Vyplňte pole Pro koho.</div>
              </div>
            </div>

            <div class="iuWishCard">
              <div class="iuWishCardBody">
                <span class="iuLabel">Od koho *</span>
                <input class="iuCtrl" id="iuWishFrom" type="text" required placeholder="Kdo přání posílá" />
                <div class="iuErr" id="iuWishFromErr" hidden>Vyplňte pole Od koho.</div>
              </div>
            </div>

            <div class="iuWishCard">
              <label class="iuWishCardBody">
                <span class="iuLabel">Text přání</span>
                <textarea class="iuCtrl" id="iuWishText" placeholder="Zde můžete napsat text přání (nepovinné)"></textarea>
              </label>
            </div>
          </div>

          <!-- Row 3: emails -->
          <div class="iuWishRow iuWishRow--2" aria-label="E-maily (volitelné)">
            <div class="iuWishCard">
              <label class="iuWishCardBody">
                <span class="iuLabel">Email komu přeji</span>
                <input class="iuCtrl" id="iuWishEmailTo" type="email" autocomplete="email" inputmode="email" placeholder="např. jmeno@domena.cz" />
              </label>
            </div>
            <div class="iuWishCard">
              <label class="iuWishCardBody">
                <span class="iuLabel">Telefon komu přeji</span>
                <input class="iuCtrl" id="iuWishPhoneTo" type="tel" autocomplete="tel" inputmode="tel" placeholder="např. 777 123 456" />
              </label>
            </div>
          </div>
          </div>

          <div class="iuWishActions">
            <button class="iuBtn" id="iuWishSendRadio" type="button">Odeslat rádiu</button>
            <div class="iuWishStatus" id="iuWishStatus" aria-live="polite"></div>
            <div class="iuErr iuErrBlock" id="iuWishErrors" hidden></div>
          </div>
        </div>
      </details>
    `;

    const chips = RADIO_ITEMS.map((it) => {
      const title = escapeHtml(it.title);
      const url = escapeHtml(it.url);
      const desc = escapeHtml(it.desc || "");
      const descHtml = desc ? `<span class="iuRadioChipDesc">${desc}</span>` : "";
      return `
        <a class="iuRadioChip" href="${url}" target="_blank" rel="noopener noreferrer">
          <span class="iuRadioChipTitle">${title}</span>
          ${descHtml}
        </a>
      `;
    }).join("");

    target.innerHTML = wishForm + `<div class="iuRadioGrid" role="list" aria-label="Odkazy na rádia">${chips}</div>`;
  }

  function ensureHomeView(){
    const existing = document.getElementById('iuHomeView');
    if (existing) return existing;
    const newsList = document.getElementById('newsList');
    if (!newsList) return null;

    const el = document.createElement('div');
    el.id = 'iuHomeView';
    el.className = 'iuHomeView';
    el.hidden = true;
    el.innerHTML = `
      <div class="iuHomeCanvas" role="region" aria-label="Domů">
        <section class="iuHomeWeather" data-home-key="pocasi" aria-label="Počasí">
          <div class="iuHomeWeatherShell" role="group" aria-label="Počasí dnes">
            <div class="iuHomeWeatherSkeleton" id="iuHomeWeatherSkeleton">loading weather…</div>
            <div class="iuHomeWeatherContent" id="iuHomeWeatherContent" hidden>
              <div class="iuHomeWeatherTopRow">
                <div class="iuHomeWeatherMeta">
                  <div class="iuHomeWeatherCity" id="iuHomeWxCity">—</div>
                  <div class="iuHomeWeatherDate" id="iuHomeWxDate">—</div>
                  <div class="iuHomeWeatherDesc" id="iuHomeWxDesc">—</div>
                </div>
                <div class="iuHomeWeatherNow">
                  <div class="iuHomeWeatherTemp" id="iuHomeWxTemp">—°</div>
                  <div class="iuHomeWeatherIcon" id="iuHomeWxIcon" aria-hidden="true">🌤</div>
                </div>
              </div>

              <div class="iuHomeWeatherForecast" id="iuHomeWxForecast" aria-label="Předpověď (3 hodiny)">
                <div class="iuHomeWxChip" aria-hidden="true"><div class="iuHomeWxChipT">--h</div><div class="iuHomeWxChipV">—</div></div>
                <div class="iuHomeWxChip" aria-hidden="true"><div class="iuHomeWxChipT">--h</div><div class="iuHomeWxChipV">—</div></div>
                <div class="iuHomeWxChip" aria-hidden="true"><div class="iuHomeWxChipT">--h</div><div class="iuHomeWxChipV">—</div></div>
              </div>
            </div>
          </div>
        </section>
        <div class="iuHomeHexGrid" id="iuHomeHexGrid" aria-label="Sekce"></div>
        <section class="iuHomeText" aria-label="O infoUzel.cz">
          <div class="iuHomeTextInner">
            <h2 class="iuHomeTextTitle">infoUzel.cz</h2>
            <p class="iuHomeTextBody">
              Rychlý přehled zpráv, rádia, TV, mapy a cestování na jednom místě. Domů je rozcestník — vyberte sekci a pokračujte.
            </p>
          </div>
        </section>

        <section class="iuHomeFav" aria-label="Oblíbené moduly">
          <div class="iuHomeFavHead">
            <h2 class="iuHomeFavTitle">Oblíbené</h2>
            <button class="iuHomeFavAdd" type="button" aria-label="Přidat modul">+ Přidat modul</button>
          </div>
          <div class="iuHomeFavGrid" aria-hidden="true"></div>
        </section>
      </div>
    `.trim();

    // Insert into center column: .iuArticlesStage (same container as #feed).
    const centerStage = document.getElementById('iuCenterStage');
    const articlesStage = centerStage && centerStage.querySelector('.iuArticlesStage');
    const feed = document.getElementById('feed');
    if (articlesStage && feed && feed.parentElement === articlesStage) {
      articlesStage.insertBefore(el, feed);
    } else if (centerStage) {
      centerStage.appendChild(el);
    } else if (newsList) {
      newsList.appendChild(el);
    }
    return el;
  }

  function renderHomeWeather(){
    const skeletonEl = document.getElementById('iuHomeWeatherSkeleton');
    const contentEl = document.getElementById('iuHomeWeatherContent');
    const cityEl = document.getElementById('iuHomeWxCity');
    const dateEl = document.getElementById('iuHomeWxDate');
    const tempEl = document.getElementById('iuHomeWxTemp');
    const iconEl = document.getElementById('iuHomeWxIcon');
    const descEl = document.getElementById('iuHomeWxDesc');
    const forecastEl = document.getElementById('iuHomeWxForecast');
    if (!skeletonEl && !contentEl && !cityEl && !dateEl && !tempEl && !iconEl && !descEl && !forecastEl) return;

    // idempotent: prevent parallel fetches
    try{
      if (window.__iuHomeWxLoading) return;
      window.__iuHomeWxLoading = true;
    }catch{}

    const fmtDeg = (n) => {
      if (typeof n !== 'number' || !isFinite(n)) return '—';
      return Math.round(n) + '°';
    };
    const fmtHour = (s) => {
      try{
        const d = new Date(String(s || ''));
        if (isNaN(d.getTime())) return '--h';
        const h = d.getHours();
        return String(h) + 'h';
      }catch{
        return '--h';
      }
    };
    const fmtDate = () => {
      try{
        const TZ = "Europe/Prague";
        return new Intl.DateTimeFormat("cs-CZ",{weekday:"long",day:"numeric",month:"long",timeZone:TZ}).format(new Date());
      }catch{
        return "";
      }
    };
    const iconFromDesc = (desc) => {
      const s = String(desc || "").toLowerCase();
      if (s.includes("slun")) return "☀️";
      if (s.includes("jas")) return "☀️";
      if (s.includes("obla")) return "☁️";
      if (s.includes("zamra")) return "☁️";
      if (s.includes("déšť") || s.includes("dest") || s.includes("mrhol")) return "🌧";
      if (s.includes("sníh") || s.includes("snih")) return "❄️";
      if (s.includes("bouř")) return "⛈";
      return "🌤";
    };

    // Skeleton first (no CLS)
    try{ if (skeletonEl) skeletonEl.hidden = false; }catch{}
    try{ if (contentEl) contentEl.hidden = true; }catch{}

    const withTs = (rel) => {
      try{
        const u = new URL(String(rel || ''), window.location.href);
        u.searchParams.set('ts', String(Date.now()));
        return u.toString();
      }catch{
        return String(rel || '');
      }
    };

    fetch(withTs(iuDataUrl('weather.json')), { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!d || typeof d !== 'object') throw new Error('bad weather');
        const city = String(d.place || '—');
        const desc = String(d?.current?.desc || '—');
        if (cityEl) cityEl.textContent = city;
        if (dateEl) dateEl.textContent = fmtDate();
        if (tempEl) tempEl.textContent = fmtDeg(d?.current?.temp);
        if (descEl) descEl.textContent = desc;
        if (iconEl) iconEl.textContent = iconFromDesc(desc);

        if (forecastEl) {
          const hours = Array.isArray(d.hours) ? d.hours.slice(0, 3) : [];
          const chips = Array.from(forecastEl.querySelectorAll('.iuHomeWxChip'));
          for (let i = 0; i < 3; i++){
            const chip = chips[i];
            const it = hours[i];
            if (!chip) continue;
            if (it) {
              chip.innerHTML = `<div class="iuHomeWxChipT">${escapeHtml(fmtHour(it.time))}</div><div class="iuHomeWxChipV">${escapeHtml(fmtDeg(it.temp))}</div>`;
              chip.removeAttribute('aria-hidden');
            } else {
              chip.innerHTML = `<div class="iuHomeWxChipT">--h</div><div class="iuHomeWxChipV">—</div>`;
              chip.setAttribute('aria-hidden', 'true');
            }
          }
        }

        try{ if (skeletonEl) skeletonEl.hidden = true; }catch{}
        try{ if (contentEl) contentEl.hidden = false; }catch{}
      })
      .catch(() => {
        try{
          if (skeletonEl) skeletonEl.textContent = 'Počasí nedostupné';
        }catch{}
      })
      .finally(() => {
        try{ window.__iuHomeWxLoading = false; }catch{}
      });
  }

  function buildHomeHexGrid(){
    const grid = document.getElementById('iuHomeHexGrid');
    if (!grid) return;
    grid.replaceChildren();

    const navItems = Array.from(document.querySelectorAll('.iu-leftNav .iu-leftNavItem[data-accent]'));
    const sections = [];
    const seen = new Set();
    for (const it of navItems) {
      const key = String(it.getAttribute('data-accent') || '').trim().toLowerCase();
      if (!key || key === 'home') continue;
      if (seen.has(key)) continue;
      seen.add(key);

      const labelEl = it.querySelector('.iu-leftNavLabel');
      const label = (labelEl ? labelEl.textContent : it.textContent || '').trim();

      // Icon SVG: reuse exact markup from left rail (sanitized: drop any on* attributes).
      let svgHtml = '';
      try{
        const svg = it.querySelector('.iu-leftNavIcon svg');
        if (svg) {
          const clone = svg.cloneNode(true);
          const nodes = [clone, ...Array.from(clone.querySelectorAll('*'))];
          nodes.forEach((n) => {
            try{
              Array.from(n.attributes || []).forEach((a) => {
                if (!a || !a.name) return;
                if (/^on/i.test(a.name)) n.removeAttribute(a.name);
              });
            }catch{}
          });
          svgHtml = clone.outerHTML;
        }
      }catch{}

      // Section accent: use stable CSS variables (required), fallback to blue.
      const varKey = (k) => {
        if (k === 'mapy') return 'maps';
        return k;
      };
      const accentVar = `--iu-accent-${varKey(key)}`;
      const accentExpr = `var(${accentVar}, #3B82F6)`;

      sections.push({ key, label, svgHtml, accentExpr });
    }

    for (const s of sections) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'iuHomeHex';
      btn.setAttribute('data-section', s.key);
      btn.setAttribute('aria-label', String(s.label || s.key));
      btn.style.setProperty('--iuHexBg', s.accentExpr || '#3B82F6');
      const iconHtml = s.svgHtml ? `<span class="iuHomeHexIcon" aria-hidden="true">${s.svgHtml}</span>` : '';
      btn.innerHTML = `${iconHtml}<span class="iuHomeHexLabel">${escapeHtml(s.label || s.key)}</span>`;
      btn.addEventListener('click', () => {
        persistSection(s.key);
        applySectionFromURL();
      });
      grid.appendChild(btn);
    }

    iuHomeApplyRailOrder();
    requestAnimationFrame(iuHomeApplyRailOrder);
    setTimeout(iuHomeApplyRailOrder, 200);

    iuHomeApplyRailSectionOrder();
    requestAnimationFrame(iuHomeApplyRailSectionOrder);
    setTimeout(iuHomeApplyRailSectionOrder, 200);
  }

  function iuHomeApplyRailOrder() {
    try {
      if ((document.body?.dataset?.section || '') !== 'home') return;

      const railKeys = Array.from(
        document.querySelectorAll('.iu-leftNav .iu-leftNavItem[data-accent]')
      )
        .map(el => String(el.getAttribute('data-accent') || '').trim().toLowerCase())
        .filter(k => k && k !== 'home');

      const tiles = Array.from(
        document.querySelectorAll('.iuHomeHex434 .iuHex, #iuHomeHexGrid .iuHomeHex')
      );
      if (!railKeys.length || !tiles.length) return;

      const tileKey = (el) => {
        const ds = String(el.getAttribute('data-section') || '').trim().toLowerCase();
        if (ds) return ds;
        const cls = Array.from(el.classList).find(c => c.startsWith('iuHex--'));
        return cls ? cls.slice('iuHex--'.length).toLowerCase() : '';
      };

      const map = new Map();
      tiles.forEach(el => {
        const k = tileKey(el);
        if (k) map.set(k, el);
      });

      railKeys.forEach((k, i) => {
        const el = map.get(k);
        if (el) el.style.order = String(i + 1);
      });

      const railSet = new Set(railKeys);
      tiles.forEach(el => {
        const k = tileKey(el);
        if (!k || !railSet.has(k)) el.style.order = '999';
      });

    } catch (e) {
      console.warn("[HOME ORDER] failed", e);
      if (typeof debugWarn === "function") debugWarn("[HOME ORDER] failed", e);
    }
  }

  function iuHomeApplyRailSectionOrder() {
    try {
      if ((document.body?.dataset?.section || '') !== 'home') return;

      const railKeys = Array.from(
        document.querySelectorAll('.iu-leftNav .iu-leftNavItem[data-accent]')
      )
        .map(el => String(el.getAttribute('data-accent') || '').trim().toLowerCase())
        .filter(k => k && k !== 'home');

      const homeRoot = document.getElementById('iuHomeView') || document.body;
      const sections = Array.from(homeRoot.querySelectorAll('section[data-home-key]'));

      if (!railKeys.length || !sections.length) return;

      const railIndex = new Map(railKeys.map((k,i)=>[k, i+1]));
      const missingInRail = [];

      for (const s of sections) {
        const key = String(s.getAttribute('data-home-key') || '').trim().toLowerCase();
        const ord = railIndex.get(key);
        if (ord) s.style.order = String(ord);
        else { s.style.order = '999'; if (key) missingInRail.push(key); }
      }

      if (!window.__iuHomeSectionOrderLogged) {
        window.__iuHomeSectionOrderLogged = true;
        if (missingInRail.length) { console.warn("[HOME SECTION ORDER] Section keys not in rail:", Array.from(new Set(missingInRail))); if (typeof debugWarn === "function") debugWarn("[HOME SECTION ORDER] Section keys not in rail:", Array.from(new Set(missingInRail))); }
      }
    } catch (e) {
      console.warn("[HOME SECTION ORDER] failed", e);
      if (typeof debugWarn === "function") debugWarn("[HOME SECTION ORDER] failed", e);
    }
  }

  window.iuHomeOrderProof = function () {
    const rail = [...document.querySelectorAll('.iu-leftNav .iu-leftNavItem[data-accent]')]
      .map(el => String(el.getAttribute('data-accent') || '').trim().toLowerCase())
      .filter(k => k && k !== 'home');

    const tiles = [...document.querySelectorAll('.iuHomeHex434 .iuHex, #iuHomeHexGrid .iuHomeHex')].map(el => {
      const ds = String(el.getAttribute('data-section') || '').trim().toLowerCase();
      const cls = [...el.classList].find(c => c.startsWith('iuHex--'));
      const key = ds || (cls ? cls.slice('iuHex--'.length).toLowerCase() : '');
      return {
        key,
        order: Number(getComputedStyle(el).order)
      };
    });

    const mismatches = rail
      .map((k,i)=>({k,expected:i+1,got:tiles.find(t=>t.key===k)?.order}))
      .filter(x=>x.expected!==x.got);

    const sec = [...document.querySelectorAll('section[data-home-key]')].map(s => ({
      key: String(s.getAttribute('data-home-key') || '').trim().toLowerCase(),
      order: Number(getComputedStyle(s).order || 0),
      class: s.className
    }));

    const secMap = new Map(sec.map(x => [x.key, x]));
    const sectionMismatches = rail
      .map((k,i)=>({k,expected:i+1,got:secMap.get(k)?.order}))
      .filter(x=>typeof x.got === 'number' && x.got !== 0 && x.expected !== x.got);
  };

  function setLeftNavActive(key){
    const k = String(key || '').trim().toLowerCase();
    const items = document.querySelectorAll('.iu-leftNav .iu-leftNavItem');
    items.forEach(el=>{
      el.classList.remove('is-active');
      el.removeAttribute('aria-current');
    });

    const active = document.querySelector(`.iu-leftNav .iu-leftNavItem[data-accent="${k}"]`);
    if(active){
      active.classList.add('is-active');
      active.setAttribute('aria-current','page');
    }
  }

  function showView(key){
    const center = document.getElementById('iuCenterStage');
    if (!center) return;
    if (center.getAttribute('data-iu-mode') === 'ads') {
      center.dataset.pendingView = key || '';
      return;
    }
    center.dataset.view = key || 'media';
    const activeEl = center.querySelector('[data-view-host="' + (key || 'media') + '"]');
    try{
      if (activeEl) requestAnimationFrame(function(){ try{ iuInitNotesInView(activeEl); }catch{} });
    }catch{
      try{ if (activeEl) iuInitNotesInView(activeEl); }catch{}
    }
  }

  function normalizeSection(raw){
    const k = String(raw || '').trim().toLowerCase();
    if (k === 'radio') return 'radio';
    if (k === 'jr') return 'jr';
    // allow other left-rail sections to roundtrip via URL without changing feed pipeline
    const allowed = new Set(['media','tv','tvonline','mapy','travel','pocasi','tvprogram','culture','ads','jr','myuzel-1','myuzel-2','myuzel-3','myuzel-4','myuzel-5']);
    if (k === 'home') return 'media';
    return allowed.has(k) ? k : 'media';
  }

  function getInitialSection(){
    try{
      const params = new URLSearchParams(window.location.search);
      return normalizeSection(params.get('section') || 'media');
    }catch{
      return 'media';
    }
  }

  function persistSection(section){
    try{
      const url = new URL(window.location.href);
      url.searchParams.set('section', section);
      history.replaceState(null, '', url);
    }catch{}
  }

  function parsePanelFromUrl(){
    try{
      const p = new URLSearchParams(window.location.search).get('panel');
      const id = String(p || '').trim().toLowerCase();
      if (id === 'ai') return null;
      // AI panel must NOT open from URL – overlay only via quicklink (data-iuq="ai")
      const ALLOWED_PANELS = new Set(['services']);
      if (ALLOWED_PANELS.has(id)) return id;
      return null;
    }catch{ return null; }
  }

  let __iuCurrentPanel = null;

  function safeOpenPanel(panel, retryCount){
    retryCount = retryCount || 0;
    var id = String(panel || '').trim().toLowerCase();
    if (id === 'ai') return;
    const maxRetry = 2;
    try{
      if (!panel) return;
      const hasOpen = typeof window.iuOpenPanel === 'function';
      const hasTarget = panel === 'ai' ? !!document.getElementById('iu-aiPanel') : true;
      if (!hasOpen || !hasTarget) {
        if (retryCount < maxRetry) {
          setTimeout(function(){ safeOpenPanel(panel, retryCount + 1); }, 50);
          return;
        }
        try{ console.warn('[iu] panel open skipped – iuOpenPanel or DOM not ready'); }catch{}
        return;
      }
      try {
        window.iuOpenPanel(panel);
        __iuCurrentPanel = panel;
      } catch (e) { try{ console.warn('[iu] panel open failed', e); }catch{} }
    } catch (e) { try{ console.warn('[iu] safeOpenPanel error', e); }catch{} }
  }

  function iuSetElOpenVisible(el, isOpen) {
    if (!el) return;
    if (isOpen) {
      el.removeAttribute("hidden");
      if (el.style && el.style.display === "none") el.style.display = "";
    } else {
      el.setAttribute("hidden", "");
      if (el.style) el.style.display = "none";
    }
  }
  try { window.iuSetElOpenVisible = iuSetElOpenVisible; } catch (_) {}

  function ensureAiModalInBody() {
    const overlays = document.querySelectorAll("#iu-aiOverlay");
    const panels = document.querySelectorAll("#iu-aiPanel");
    const overlay = overlays[0] || null;
    const panel = panels[0] || null;
    if (!overlay || !panel) return false;
    for (let i = 1; i < overlays.length; i++) overlays[i].setAttribute("data-iu-dup", "1");
    for (let i = 1; i < panels.length; i++) panels[i].setAttribute("data-iu-dup", "1");
    if (overlay.parentElement === document.body && panel.parentElement === document.body) return true;
    const frag = document.createDocumentFragment();
    frag.appendChild(overlay);
    frag.appendChild(panel);
    document.body.appendChild(frag);
    return true;
  }
  try { window.ensureAiModalInBody = ensureAiModalInBody; } catch (_) {}

  function iuHideAllOverlaysNow(){
    try {
      if (typeof window.iuForceCloseAllOverlays === "function") {
        window.iuForceCloseAllOverlays();
        return;
      }
      const panel = document.getElementById("iu-aiPanel");
      const overlay = document.getElementById("iu-aiOverlay");
      if (panel) iuSetElOpenVisible(panel, false);
      if (overlay) iuSetElOpenVisible(overlay, false);
      document.querySelectorAll('.iuModal, [data-iu-backdrop], .iuBackdrop, .iu-overlay, .iu-backdrop').forEach(el => {
        el.hidden = true;
        try { el.style.display = 'none'; } catch {}
      });
      document.body.classList.remove('iu-modal-open');
      document.body.style.overflow = '';
    } catch {}
  }
  // FORCE STYLE CACHE so first click has no flash
  try {
    requestAnimationFrame(() => {
      const els = document.querySelectorAll(
        '.iuModal, #iu-aiPanel, #iu-aiOverlay, [data-iu-backdrop]'
      );
      els.forEach(el => {
        void el.offsetHeight;
      });
    });
  } catch {}
  // INITIAL PRE-HIDE: ensure no stale overlay is visible before first interaction
  try { iuHideAllOverlaysNow(); } catch {}
  try { requestAnimationFrame(() => { try { iuHideAllOverlaysNow(); } catch {} }); } catch {}

  let __iuPanelRouting = false;
  function applyPanelFromUrl(){
    if (__iuPanelRouting) return;
    __iuPanelRouting = true;
    try {
      const panel = parsePanelFromUrl();
      if (panel === null && __iuCurrentPanel !== null) {
        const prev = __iuCurrentPanel;
        iuHideAllOverlaysNow();
        try { window.dispatchEvent(new CustomEvent('iu-close-panel', { detail: prev })); } catch {}
        __iuCurrentPanel = null;
        return;
      }
      if (panel !== null) safeOpenPanel(panel);
      else __iuCurrentPanel = null;
    } finally {
      __iuPanelRouting = false;
    }
  }

  function setPanelInUrl(panel, { replace = false } = {}){
    try{
      const url = new URL(location.href);
      const p = String(panel || '').trim().toLowerCase();
      if (p === 'shopping' || p === 'nakup') url.searchParams.delete('panel');
      else if (panel) url.searchParams.set('panel', panel);
      else url.searchParams.delete('panel');
      if (replace) history.replaceState({}, '', url);
      else history.pushState({}, '', url);
      if (!__iuPanelRouting) { try { window.dispatchEvent(new CustomEvent('iu-panel-url-changed')); } catch {} }
    }catch{}
  }
  try { window.iuSetPanelInUrl = setPanelInUrl; } catch {}

  function applySectionFromURL(accentOverride){
    if (typeof window.iuEnsureArticlesView === "function") window.iuEnsureArticlesView();
    // Gate C: ?section= has priority; when accentOverride (e.g. hex click) use it so URL is not changed
    const fromUrl = getInitialSection();
    const accentKey = (accentOverride && String(accentOverride).trim().toLowerCase()) ? normalizeSection(accentOverride) : fromUrl;
    const section = accentKey;
    // safe: UI-only section marker for stable CSS scoping (no feed pipeline touch)
    try{ document.body && (document.body.dataset.section = section); }catch{}
    try{ document.documentElement && (document.documentElement.dataset.section = section); }catch{}
    try{
      const color = IU_CONTENT_ACCENTS[accentKey] || "";
      document.body && document.body.style.setProperty("--iuContentAccent", color);
    }catch{}
    // feed paging must reset on section change
    try{ state.page = 1; }catch{}
    setLeftNavActive(section);
    showView(VIEW_MAP[section] ?? 'media');

    // P0 mobile: #leftContent is display:none below 900px until iu-mobileMainVisible (rail click).
    // Direct URL (?section=pocasi etc.) must reveal main or center views measure 0×0 (CLS/Playwright).
    try{
      if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
        const sec = String(section || "").toLowerCase();
        if (sec && sec !== "media") {
          document.body.classList.add("iu-mobileMainVisible");
          var mbVis = document.getElementById("iuMobileMainBackBar");
          if (mbVis) mbVis.hidden = false;
        } else {
          try { document.body.classList.remove("iu-mobileMainVisible"); } catch (_) {}
          var mbHid = document.getElementById("iuMobileMainBackBar");
          if (mbHid) mbHid.hidden = true;
        }
      }
    }catch{}

    // Weather (UI-only): ensure render + radarOpen works after view switch.
    try{
      if (section === "pocasi") {
        try{
          const fn = (typeof window !== "undefined" && window.iuWeatherLoadAndRender);
          if (typeof fn === "function") fn();
        }catch{}
        try{ iuWeatherHideEmptyNameday(); }catch{}
        try{
          const params = new URLSearchParams(location.search || "");
          if (params.get("radarOpen") === "1") {
            iuWeatherRadarEnsure();
          }
        }catch{}
      }
    }catch{}

    // SOLID chips: runtime contrast for default WHITE text (MindMenu unaffected)
    try{
      const views = [
        document.getElementById("iuRadioView"),
        document.getElementById("iuTvOnlineView"),
        document.getElementById("iuWeatherView"),
        document.getElementById("iuMapsView") || document.getElementById("iuMapyView"),
        document.getElementById("iuTravelView"),
        document.getElementById("iuTvProgramView"),
        document.getElementById("iuCultureView"),
        document.getElementById("iuAdsView"),
      ];
      views.forEach(v => iuApplySolidChipTextContrastInView(v));
    }catch{}

    // Notes: mount for current section + render all declared notes hosts (no MindMenu impact)
    try{
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try{ iuMountNotesForCurrentSection(); }catch{}
        try{
          let root = document.getElementById("feed");
          if (section === "radio") root = document.getElementById("iuRadioView");
          else if (section === "tvonline") root = document.getElementById("iuTvOnlineView");
          else if (section === "jr") root = document.getElementById("iuJrEmptyView");
          else if (section === "mapy") root = document.getElementById("iuMapyView") || document.getElementById("iuMapsView");
          else if (section === "travel") root = document.getElementById("iuTravelView");
          else if (String(section || "").toLowerCase().startsWith("myuzel-")) {
            const slot = parseInt(String(section).split("-")[1], 10);
            if (Number.isFinite(slot)) root = document.getElementById(`iuMyUzelView${slot}`);
          }
          iuInitNotesInView(root || document);
        }catch{}
      }));
    }catch{
      try{ iuMountNotesForCurrentSection(); }catch{}
      try{ iuInitNotesInView(document); }catch{}
    }

    // Custom views (UI-only)
    try{
      if (String(section || "").toLowerCase().startsWith("myuzel-")) {
        const slot = parseInt(String(section).split("-")[1], 10);
        if (Number.isFinite(slot) && slot >= 1 && slot <= 5) {
          try{
            const st = iuMyUzelLoad();
            st.activeSection = slot;
            iuMyUzelSave(st);
          }catch{}
          iuMyUzelApplyViewVisibility(section);
          // UX: after switching into myuzel, bring header + chips into view.
          try{
            requestAnimationFrame(() => {
              try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { try { window.scrollTo(0, 0); } catch {} }
              try {
                const sc = document.getElementById("newsList");
                if (sc && typeof sc.scrollTop === "number") sc.scrollTop = 0;
              } catch {}
            });
          }catch{}
        }
      }
    }catch{}
    // Always: keep feed data loaded + auto-refresh running (idempotent, UI-only)
    try{ window.__iuLoadData && window.__iuLoadData(); }catch{}
    try{ window.__iuStartAutoRefresh && window.__iuStartAutoRefresh(); }catch{}
  }
  try { window.iuApplySectionFromURL = applySectionFromURL; } catch (e) {}

  function initRadioWish(viewEl){
    const accEl = document.getElementById("iuRadioWish");
    const elType = document.getElementById("iuWishType");
    const elRadio = document.getElementById("iuWishRadio");
    const elRadioHint = document.getElementById("iuWishRadioHint");
    const elTo = document.getElementById("iuWishTo");
    const elToErr = document.getElementById("iuWishToErr");
    const elFrom = document.getElementById("iuWishFrom");
    const elFromErr = document.getElementById("iuWishFromErr");
    const elSong = document.getElementById("iuWishSong");
    const elText = document.getElementById("iuWishText");
    const elEmailTo = document.getElementById("iuWishEmailTo");
    const elPhoneTo = document.getElementById("iuWishPhoneTo");
    const elErrors = document.getElementById("iuWishErrors");
    const elStatus = document.getElementById("iuWishStatus");
    const btnSendRadio = document.getElementById("iuWishSendRadio");

    if (!viewEl || !elType || !elRadio || !elTo || !elFrom || !elSong || !btnSendRadio) {
      return { setData: () => {} };
    }

    // Accordion open/close persistence (default: closed)
    if (accEl && String(accEl.tagName || "").toUpperCase() === "DETAILS") {
      try{
        const v = sessionStorage.getItem(STORAGE_KEY_WISH_OPEN);
        accEl.open = v === "1";
      }catch{}
      accEl.addEventListener("toggle", () => {
        try{
          sessionStorage.setItem(STORAGE_KEY_WISH_OPEN, accEl.open ? "1" : "0");
        }catch{}
      });
    }

    let radios = Array.isArray(wishData.radios) ? wishData.radios : [];
    let artists = Array.isArray(wishData.artists) ? wishData.artists : [];

    let artistsSet = new Set(artists);
    let radiosById = new Map(radios.map((r) => [String(r.id), r]));
    let restoredOnce = false;

    function setData(next){
      radios = Array.isArray(next?.radios) ? next.radios : radios;
      artists = Array.isArray(next?.artists) ? next.artists : artists;
      artistsSet = new Set(artists);
      radiosById = new Map(radios.map((r) => [String(r.id), r]));
      populateRadioSelect();
      populateArtistSelect();
      showHintForRadio();
      // Safe restore after data is available (prevents typed-but-not-selected restore).
      if (!restoredOnce) restoreFromSession();
      // if current selections are no longer valid, clear them (quietly)
      hardValidateSelected(false);
    }

    function populateRadioSelect(){
      const prev = String(elRadio.value || "");
      elRadio.innerHTML = `<option value="">— vyberte —</option>` + radios
        .map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.label)}</option>`)
        .join("");
      if (prev && radiosById.has(prev)) elRadio.value = prev;
    }

    function populateArtistSelect(){
      const prev = String(elSong.value || "");
      const sorted = (Array.isArray(artists) ? artists : [])
        .slice()
        .sort((a, b) => String(a).localeCompare(String(b), "cs", { sensitivity: "base" }));
      elSong.innerHTML = `<option value="">— vyberte —</option>` + sorted
        .map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`)
        .join("");
      if (prev && artistsSet.has(prev)) elSong.value = prev;
    }

    function showHintForRadio(){
      if (!elRadioHint) return;
      const id = String(elRadio.value || "");
      const r = radiosById.get(id);
      const hint = r ? (r.hintText || r.smsHint || r.url || (r.method === "email" ? r.emailTo : "")) : "";
      if (hint) {
        elRadioHint.hidden = false;
        elRadioHint.textContent = hint;
      } else {
        elRadioHint.hidden = true;
        elRadioHint.textContent = "";
      }
    }

    function getDraft(){
      return {
        type: String(elType.value || ""),
        radioId: String(elRadio.value || ""),
        to: String(elTo.value || "").trim(),
        from: String(elFrom.value || "").trim(),
        artist: String(elSong.value || ""),
        wishText: String(elText?.value || "").trim(),
        emailTo: String(elEmailTo?.value || "").trim(),
        phoneTo: String(elPhoneTo?.value || "").trim()
      };
    }

    function sanitizeDraft(d){
      const allowedTypes = new Set(["narozeniny","svatek","vyroci","uspech","jen_tak","jiny"]);
      const legacyTo = String(d?.to || d?.toSelected || "");
      const legacyFrom = String(d?.from || d?.fromSelected || "");
      const legacyArtist = String(d?.artist || d?.songArtist || d?.songSelected || "");
      const wishText = String(d?.wishText || d?.text || d?.message || "").trim();
      const phoneTo = String(d?.phoneTo || d?.tel || d?.phone || "").trim();
      const safe = {
        type: allowedTypes.has(d?.type) ? d.type : "",
        radioId: radiosById.has(String(d?.radioId || "")) ? String(d.radioId) : "",
        to: legacyTo.trim().slice(0, 80),
        from: legacyFrom.trim().slice(0, 80),
        artist: artistsSet.has(legacyArtist) ? legacyArtist : "",
        wishText: wishText.slice(0, 500),
        emailTo: isValidEmail(d?.emailTo) ? String(d.emailTo).trim() : "",
        phoneTo: phoneTo.slice(0, 40)
      };
      return safe;
    }

    function restoreFromSession(){
      try{
        const raw = sessionStorage.getItem(STORAGE_KEY_WISH);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const d = sanitizeDraft(parsed);

        if (d.type) elType.value = d.type;
        if (d.radioId) elRadio.value = d.radioId;

        elTo.value = d.to || "";
        elFrom.value = d.from || "";
        elSong.value = d.artist || "";
        if (elText && d.wishText) elText.value = d.wishText;
        if (elEmailTo && d.emailTo) elEmailTo.value = d.emailTo;
        if (elPhoneTo && d.phoneTo) elPhoneTo.value = d.phoneTo;

        showHintForRadio();
        restoredOnce = true;
      }catch{}
    }

    let saveTimer = 0;
    function scheduleSave(){
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try{
          const d = sanitizeDraft(getDraft());
          sessionStorage.setItem(STORAGE_KEY_WISH, JSON.stringify(d));
        }catch{}
      }, 200);
    }

    function setErr(el, on){
      if (!el) return;
      el.hidden = !on;
    }
    function setBlockErr(msg){
      if (!elErrors) return;
      if (!msg) {
        elErrors.hidden = true;
        elErrors.textContent = "";
        return;
      }
      elErrors.hidden = false;
      elErrors.textContent = msg;
    }
    function setStatus(msg){
      if (!elStatus) return;
      elStatus.textContent = msg || "";
    }

    function hardValidateSelected(showErrors){
      const toOk = !!String(elTo.value || "").trim();
      const fromOk = !!String(elFrom.value || "").trim();
      // optional: if selected, must exist in whitelist
      const songOk = !String(elSong.value || "") || artistsSet.has(String(elSong.value));
      if (showErrors){
        setErr(elToErr, !toOk);
        setErr(elFromErr, !fromOk);
      } else {
        setErr(elToErr, false);
        setErr(elFromErr, false);
      }
      return { toOk, fromOk, songOk };
    }

    function buildTexts(d){
      const radio = radiosById.get(d.radioId);
      const radioLabel = radio ? radio.label : "rádio";
      const typeLabelMap = {
        narozeniny: "narozeninám",
        svatek: "svátku",
        vyroci: "výročí",
        uspech: "úspěchu",
        jen_tak: "jen tak pro radost",
        jiny: "jiné příležitosti"
      };
      const typ = typeLabelMap[d.type] ?? String(d.type || "");
      const proKoho = d.to;
      const odKoho = d.from;
      const pisnickaClause = d.artist ? ` a případně písničku od ${d.artist}` : "";
      const pisnickaClause2 = d.artist ? ` a případně písničku od ${d.artist}` : "";
      const contactBits = [
        d.emailTo ? `email: ${d.emailTo}` : "",
        d.phoneTo ? `telefon: ${d.phoneTo}` : ""
      ].filter(Boolean);
      const contactClause = contactBits.length ? `, kontakt: ${contactBits.join(", ")}` : "";
      const wishTextClause = d.wishText ? `\n\nText přání:\n${d.wishText}` : "";

      const subjectRadio = `Písnička / přání – ${proKoho} – žádost z infoUzel.cz`;
      const typClause = typ ? (d.type === "jen_tak" ? typ : `k ${typ}`) : "";
      const bodyRadio =
`Dobrý den,
píšu přes infoUzel.cz jménem posluchače ${odKoho}. Rád/a by popřál/a ${proKoho}${typClause ? " " + typClause : ""}.
Pokud je to možné, prosím o pozdrav ve vysílání${pisnickaClause}.
Děkuji a přeji hezký den.
— infoUzel.cz (odeslal/a: ${odKoho}${contactClause})${wishTextClause}`;

      const subjectRec = `Máš rádiové přání od ${odKoho} 🙂`;
      const typClause2 = typ ? (d.type === "jen_tak" ? typ : `k ${typ}`) : "";
      const bodyRec =
`Ahoj ${proKoho},
${odKoho} právě požádal/a rádio ${radioLabel} o přání${typClause2 ? " " + typClause2 : ""}${pisnickaClause2}.
Rádia jsou vytížená, takže to nemusí vyjít vždy, ale snaha je opravdová 🙂
— infoUzel.cz`;

      return { subjectRadio, bodyRadio, subjectRec, bodyRec, radio };
    }

    function openMailto(to, subject, body){
      const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = href;
    }

    function validateRequired(){
      const d = getDraft();
      const errs = [];
      if (!d.radioId) errs.push("Vyberte rádio.");
      const { toOk, fromOk, songOk } = hardValidateSelected(true);
      if (!toOk) errs.push("Vyplňte pole Pro koho.");
      if (!fromOk) errs.push("Vyplňte pole Od koho.");
      if (!songOk) errs.push("Vybraný interpret není platný.");
      if (d.emailTo && !isValidEmail(d.emailTo)) errs.push("Email komu přeji není platný.");
      return { ok: errs.length === 0, errs, d: sanitizeDraft(d) };
    }

    function buildAndSend(){
      const v = validateRequired();
      if (!v.ok) {
        setBlockErr(v.errs.join(" "));
        setStatus("");
        return;
      }
      setBlockErr("");
      const built = buildTexts(v.d);
      scheduleSave();
      const r = built.radio;
      if (!r) return;

      if (r.method === "email" && r.emailTo) {
        setStatus("Otevírám e-mail klient (mailto)…");
        openMailto(r.emailTo, built.subjectRadio, built.bodyRadio);
        return;
      }

      // form / form_or_sms
      if (r.url) {
        try { window.open(r.url, "_blank", "noopener,noreferrer"); } catch {}
      }
      setStatus("Otevírám stránku rádia…");
    }

    btnSendRadio.addEventListener("click", buildAndSend);
    elRadio.addEventListener("change", () => { showHintForRadio(); scheduleSave(); });
    elType.addEventListener("change", scheduleSave);
    elSong.addEventListener("change", scheduleSave);
    elTo.addEventListener("input", scheduleSave);
    elFrom.addEventListener("input", scheduleSave);
    elText?.addEventListener("input", scheduleSave);
    elEmailTo?.addEventListener("input", scheduleSave);
    elPhoneTo?.addEventListener("input", scheduleSave);

    setStatus("");

    // initial
    populateRadioSelect();
    populateArtistSelect();
    showHintForRadio();
    // Restore is intentionally delayed until after wish data is loaded via setData()
    // to guarantee whitelist-based safe restore (avoid races).
    hardValidateSelected(false);

    return { setData };
  }

  function initNavRouter(){
    const feedEl = document.getElementById('feed');
    const viewEl = document.getElementById('iuRadioView');
    try {
      window.iuOpenPanel = function(id){
        id = String(id || '').trim().toLowerCase();
        if (id === 'ai') return;
        window.dispatchEvent(new CustomEvent('iu-open-panel', { detail: id }));
        try { setTimeout(function() { if (typeof window.iuOverlayFailSafeAfterGesture === 'function') window.iuOverlayFailSafeAfterGesture(); }, 0); } catch (_) {}
      };
    } catch {}

    // Attach handlers FIRST so left nav clicks work even if init fails or returns early.
    const leftRailEl = document.getElementById('iuLeftRail') || document.querySelector('.iu-leftNav');
    if (leftRailEl) {
      try {
        leftRailEl.addEventListener('click', (e) => {
          if (e.target.closest && e.target.closest('[data-iuq="ai"]')) return;
          try { iuHideAllOverlaysNow(); } catch {}
        }, true);
      } catch {}
    }
    document.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('[data-iuq="ai"]')) return;
      const item = e.target && e.target.closest ? e.target.closest('.iu-leftNavItem') : null;
      if (!item) return;
      try{
        const href = String(item.getAttribute("href") || "").trim();
        const rail = String(item.getAttribute("data-rail") || "").trim().toLowerCase();
        const isExternal = href && /^https?:\/\//i.test(href);
        const isInternal = !isExternal && (href === "#" || href === "" || !!rail);
        if (isInternal) e.preventDefault();
      }catch{}
      const accent = (item.getAttribute('data-accent') || item.dataset?.accent || "").trim().toLowerCase();
      const section = normalizeSection(accent);
      iuHideAllOverlaysNow();
      persistSection(section);
      try { if (typeof window.iuSetPanelInUrl === 'function') window.iuSetPanelInUrl(''); } catch {}
      applySectionFromURL(accent);
      applyPanelFromUrl();
      try {
        if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
          document.body.classList.add("iu-mobileMainVisible");
          var mb = document.getElementById("iuMobileMainBackBar");
          if (mb) mb.hidden = false;
        }
      } catch (_) {}
      try{
        requestAnimationFrame(() => requestAnimationFrame(() => iuScrollMainToTopSmooth()));
      }catch{
        try{ iuScrollMainToTopSmooth(); }catch{}
      }
    });
    // Hex grid (Rychlé odkazy on home): switch view without changing URL – no redirect, no persistSection
    document.addEventListener('click', (e) => {
      const hex = e.target && e.target.closest ? e.target.closest('.iuHex') : null;
      if (!hex) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      const sectionAttr = String(hex.getAttribute('data-section') || '').trim().toLowerCase();
      const cls = Array.from(hex.classList).find(c => c.startsWith('iuHex--'));
      const sectionFromClass = cls ? cls.slice('iuHex--'.length).toLowerCase() : '';
      const section = normalizeSection(sectionAttr || sectionFromClass);
      iuHideAllOverlaysNow();
      applySectionFromURL(section);
      try{ requestAnimationFrame(() => { try{ iuScrollMainToTopSmooth(); }catch{} }); }catch{}
    }, true);
    function onUrlChange(){
      iuHideAllOverlaysNow();
      applySectionFromURL();
      applyPanelFromUrl();
    }
    window.addEventListener('popstate', onUrlChange);
    window.addEventListener('hashchange', onUrlChange);

    if (!feedEl || !viewEl) return;

    try {
      renderRadioView(viewEl);
      const wishCtl = initRadioWish(viewEl);
      loadWishDataIntoState().then((d) => { try{ wishCtl.setData(d); }catch{} });
    }catch(e){
      try{ if (typeof window.persistLastError === "function") window.persistLastError(String(e?.message || e)); }catch{}
    }

    try{ iuMyUzelApplyRailState(); }catch{}

    // Do not persist section to URL on init – keep URL clean (/projects/). Apply view from URL or default.
    applySectionFromURL();
    applyPanelFromUrl();
    try { window.addEventListener('iu-panel-url-changed', applyPanelFromUrl); } catch {}
    // PRELOAD overlay styles on page load (keep active URL panel open)
    try {
      const panelFromUrl = parsePanelFromUrl();
      if (panelFromUrl === null) {
        iuHideAllOverlaysNow();
        requestAnimationFrame(() => {
          iuHideAllOverlaysNow();
        });
      }
    } catch {}
  }

  if (typeof window !== "undefined" && typeof window.iuIsProjectsRoute === "function" && window.iuIsProjectsRoute()) {
    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', initNavRouter);
    } else {
      initNavRouter();
    }
  }
})();

// === MOJE SLUŽBY modaly (Banka, Bakaláři, Zdravotní pojišťovna) ===
(function(){
  "use strict";
  const BANKS_KEY = "iu_moje_sluzby_banks_state_v1";
  const IU_BANKS_KEY = "iuUserBanks";
  const BAKALARI_KEY = "iu_moje_sluzby_bakalari_v1";
  const POJISTOVNY_KEY = "iu_moje_sluzby_pojistovny_names_v1";

  function iuGetBanks() {
    try {
      let arr = JSON.parse(localStorage.getItem(IU_BANKS_KEY) || "[]");
      if (!Array.isArray(arr)) arr = [];
      if (arr.length === 0) {
        try {
          const raw = localStorage.getItem(BANKS_KEY);
          if (raw) {
            const o = JSON.parse(raw);
            if (o && Array.isArray(o.favorites) && o.favorites.length) {
              arr = o.favorites;
              localStorage.setItem(IU_BANKS_KEY, JSON.stringify(arr));
            }
          }
        } catch (_) {}
        if (arr.length === 0) {
          arr = ["csas", "kb", "air"];
          localStorage.setItem(IU_BANKS_KEY, JSON.stringify(arr));
        }
      }
      return arr;
    } catch (_) { return []; }
  }
  function iuSetBanks(arr) {
    try { localStorage.setItem(IU_BANKS_KEY, JSON.stringify(arr)); } catch (_) {}
  }
  function iuAddBank(id) {
    const banks = iuGetBanks();
    if (!banks.includes(id)) {
      banks.push(id);
      iuSetBanks(banks);
      iuRenderBanks();
    }
  }
  function iuRemoveBank(id) {
    const banks = iuGetBanks().filter(function(b) { return b !== id; });
    iuSetBanks(banks);
    iuRenderBanks();
  }
  function iuRenderBanks() {
    var body = document.getElementById("iu-mojeSluzbyBody");
    var panel = document.getElementById("iu-mojeSluzbyPanel");
    if (body && panel && body.closest("#iu-mojeSluzbyPanel")) renderBankaModal(body);
    var quickBody = document.getElementById("iuQuickFeedMojeSluzbyBody");
    var quick = document.getElementById("iuQuickFeed");
    if (quickBody && quick && !quick.hidden) renderBankaModal(quickBody);
  }

  const IU_BANKS_ALL = [
    { id: "csas", label: "ČSOB", url: "https://www.csob.cz/portal/", loginUrl: "https://www.csob.cz/portal/", color: "#1a1a1a" },
    { id: "kb", label: "Komerční banka", url: "https://www.kb.cz/", loginUrl: "https://www.kb.cz/cs/online-banking/", color: "#c41230" },
    { id: "air", label: "Air Bank", url: "https://www.airbank.cz/", loginUrl: "https://www.airbank.cz/cs/prihlaseni/", color: "#e6007e" },
    { id: "fio", label: "Fio banka", url: "https://www.fio.cz/", loginUrl: "https://www.fio.cz/ib2/portal/", color: "#00a651" },
    { id: "mb", label: "mBank", url: "https://www.mbank.cz/", loginUrl: "https://www.mbank.cz/cs/prihlaseni/", color: "#e30613" },
    { id: "rb", label: "Raiffeisenbank", url: "https://www.rb.cz/", loginUrl: "https://www.rb.cz/cs/prihlaseni/", color: "#ffed00" },
    { id: "cs", label: "ČS", url: "https://www.csas.cz/", loginUrl: "https://www.csas.cz/cs/prihlaseni.html", color: "#1a1a1a" },
    { id: "moneta", label: "Moneta", url: "https://www.moneta.cz/", loginUrl: "https://www.moneta.cz/ib/", color: "#e30613" },
    { id: "unicredit", label: "UniCredit", url: "https://www.unicreditbank.cz/", loginUrl: "https://www.unicreditbank.cz/cs/prihlaseni.html", color: "#e30613" },
    { id: "citi", label: "Citibank", url: "https://www.citibank.cz/", loginUrl: "https://www.citibank.cz/cs/prihlaseni.htm", color: "#056da1" },
    { id: "max", label: "Max banka", url: "https://www.maxbanka.cz/", loginUrl: "https://www.maxbanka.cz/prihlaseni/", color: "#00a651" },
    { id: "equa", label: "Equa bank", url: "https://www.equabank.cz/", loginUrl: "https://www.equabank.cz/prihlaseni/", color: "#00a651" },
    { id: "creditas", label: "Creditas", url: "https://www.creditas.cz/", loginUrl: "https://www.creditas.cz/prihlaseni/", color: "#1a1a1a" },
    { id: "sberbank", label: "Sberbank", url: "https://www.sberbank.cz/", loginUrl: "https://www.sberbank.cz/cs/prihlaseni/", color: "#21a038" }
  ];

  const POJISTOVNY = [
    { id: "vzp", label: "VZP (111)", abbr: "VZP", loginUrl: "https://moje.vzp.cz/home/signin" },
    { id: "vozp", label: "VoZP (201)", abbr: "VoZP", loginUrl: "https://www.vozp.cz/pojistenci/prihlaseni" },
    { id: "cpzp", label: "ČPZP (205)", abbr: "ČPZP", loginUrl: "https://www.cpzp.cz/pojistenci/prihlaseni" },
    { id: "ozp", label: "OZP (207)", abbr: "OZP", loginUrl: "https://portal.ozp.cz/app/prihlaseni" },
    { id: "zps", label: "ZPŠ (209)", abbr: "ZPŠ", loginUrl: "https://portal.zpskoda.cz/app/prihlaseni" },
    { id: "zpmv", label: "ZP MV ČR (211)", abbr: "ZPMV", loginUrl: "https://www.zpmvcr.cz/pojistenci/prihlaseni" },
    { id: "rbp", label: "RBP (213)", abbr: "RBP", loginUrl: "https://www.rbp.cz/pojistenci/prihlaseni" }
  ];
  const POJISTOVNY_BUTTONS_KEY = "iu_moje_sluzby_pojistovny_buttons_v1";
  const POJISTOVNY_MAX = 24;
  const POJISTOVNY_COLORS = [
    { id: "c01", value: "#1a5bb5" }, { id: "c02", value: "#c41230" }, { id: "c03", value: "#00a651" },
    { id: "c04", value: "#e6007e" }, { id: "c05", value: "#056da1" }, { id: "c06", value: "#e30613" },
    { id: "c07", value: "#ffed00" }, { id: "c08", value: "#1a1a1a" }, { id: "c09", value: "#6b4c9a" },
    { id: "c10", value: "#e67e22" }, { id: "c11", value: "#16a085" }, { id: "c12", value: "#8e44ad" },
    { id: "c13", value: "#2c3e50" }, { id: "c14", value: "#c0392b" }, { id: "c15", value: "#27ae60" },
    { id: "c16", value: "#2980b9" }, { id: "c17", value: "#d35400" }, { id: "c18", value: "#7f8c8d" },
    { id: "c19", value: "#bdc3c7" }, { id: "c20", value: "#95a5a6" }
  ];

  function getBanksState() {
    try {
      const raw = localStorage.getItem(BANKS_KEY);
      const o = raw ? JSON.parse(raw) : null;
      const customBanks = (o && Array.isArray(o.customBanks)) ? o.customBanks : [];
      return { favorites: iuGetBanks(), customBanks: customBanks };
    } catch (_) {}
    return { favorites: iuGetBanks(), customBanks: [] };
  }

  function setBanksState(s) {
    try { localStorage.setItem(BANKS_KEY, JSON.stringify({ customBanks: (s && s.customBanks) ? s.customBanks : [] })); } catch (_) {}
  }

  function getBakalariState() {
    try {
      const raw = localStorage.getItem(BAKALARI_KEY);
      if (raw) {
        const a = JSON.parse(raw);
        if (Array.isArray(a)) {
          if (a.length && (a[0].enabled !== undefined)) {
            return a.filter(function(s) { return s.enabled && String(s.name || "").trim() && String(s.url || "").trim(); }).map(function(s) { return { name: String(s.name).trim().slice(0, 30), url: String(s.url).trim() }; });
          }
          return a.map(function(s) { return { name: String(s.name || "").slice(0, 30), url: String(s.url || "") }; });
        }
      }
    } catch (_) {}
    return [];
  }

  function setBakalariState(a) {
    try { localStorage.setItem(BAKALARI_KEY, JSON.stringify(Array.isArray(a) ? a : [])); } catch (_) {}
  }

  function normalizeBakalariUrl(url) {
    var u = String(url || "").trim();
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    return "https://" + u;
  }

  function isValidBakalariUrl(url) {
    var u = normalizeBakalariUrl(url);
    return u.length >= 10 && /^https?:\/\/./i.test(u);
  }

  function getPojistovnyNames() {
    try {
      const raw = localStorage.getItem(POJISTOVNY_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        if (o && typeof o === "object") return o;
      }
    } catch (_) {}
    return {};
  }

  function setPojistovnyNames(o) {
    try { localStorage.setItem(POJISTOVNY_KEY, JSON.stringify(o)); } catch (_) {}
  }

  function getPojistovnyButtonsState() {
    try {
      var raw = localStorage.getItem(POJISTOVNY_BUTTONS_KEY);
      if (raw) {
        var a = JSON.parse(raw);
        if (Array.isArray(a)) return a.slice(0, POJISTOVNY_MAX).filter(function(x) { return x && x.id && x.insurerId && x.loginUrl; });
      }
    } catch (_) {}
    return [];
  }

  function setPojistovnyButtonsState(a) {
    try { localStorage.setItem(POJISTOVNY_BUTTONS_KEY, JSON.stringify(Array.isArray(a) ? a.slice(0, POJISTOVNY_MAX) : [])); } catch (_) {}
  }

  function esc(s) { return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  let _mojeSluzbyResizeTimer = null;
  let _mojeSluzbyResizeHandler = null;
  let _mojeSluzbyScrollHandler = null;

  function iuEnsureModalRoot() {
    let root = document.getElementById("iuModalRoot");
    if (!root) {
      root = document.createElement("div");
      root.id = "iuModalRoot";
      document.body.appendChild(root);
    }
    return root;
  }

  function iuGetFeedEl() {
    return document.getElementById("feed") || document.getElementById("iuCenterStage") || document.querySelector("#iuFeed") || document.querySelector(".iuFeed") || document.querySelector("main");
  }

  function iuPlaceModalOverFeed(modalEl) {
    if (!modalEl) return;

    const feed = iuGetFeedEl();
    if (!feed) return;

    const root = iuEnsureModalRoot();
    if (modalEl.parentElement !== root) root.appendChild(modalEl);

    const r = feed.getBoundingClientRect();

    modalEl.style.position = "fixed";
    modalEl.style.left = r.left + "px";
    modalEl.style.width = r.width + "px";
    if (!modalEl.style.top) modalEl.style.top = "80px";
    modalEl.style.zIndex = "9999";

    if (modalEl.id === "iu-mojeSluzbyPanel") {
      const overlay = document.getElementById("iu-mojeSluzbyOverlay");
      if (overlay) {
        if (overlay.parentElement !== root) root.appendChild(overlay);
        overlay.style.position = "fixed";
        overlay.style.left = r.left + "px";
        overlay.style.width = r.width + "px";
        overlay.style.top = "0";
      }
    }
  }

  let __iuActiveOverFeedModal = null;
  function iuSetActiveOverFeedModal(modalEl) {
    __iuActiveOverFeedModal = modalEl;
    iuPlaceModalOverFeed(modalEl);
  }

  window.addEventListener("resize", function() {
    if (__iuActiveOverFeedModal) iuPlaceModalOverFeed(__iuActiveOverFeedModal);
  }, { passive: true });

  function ensureModalRoot() {
    let root = document.getElementById("iuModalRoot");
    if (root) return root;
    root = document.createElement("div");
    root.id = "iuModalRoot";
    root.style.cssText = "position:fixed;inset:0;z-index:9998;pointer-events:none;";
    document.body.appendChild(root);
    return root;
  }

  function getFeedRect() {
    const feed = document.getElementById("feed") || document.getElementById("iuCenterStage") || document.querySelector("main");
    if (!feed) return null;
    const r = feed.getBoundingClientRect();
    return {
      left: r.left,
      width: r.width,
      centerX: r.left + r.width / 2,
      top: r.top,
      bottom: r.bottom
    };
  }

  function iuPositionModalOverFeed(panelEl) {
    const overlay = document.getElementById("iu-mojeSluzbyOverlay");
    const panel = panelEl || document.getElementById("iu-mojeSluzbyPanel");
    const feedRect = getFeedRect();
    if (!overlay || !panel || !feedRect) return;
    const topVal = Math.max(16, feedRect.top + 16);
    overlay.style.position = "fixed";
    overlay.style.left = feedRect.left + "px";
    overlay.style.width = feedRect.width + "px";
    overlay.style.maxWidth = feedRect.width + "px";
    overlay.style.right = "auto";
    overlay.style.transform = "none";
    overlay.style.top = "0";
    panel.style.position = "fixed";
    panel.style.left = feedRect.left + "px";
    panel.style.width = feedRect.width + "px";
    panel.style.maxWidth = feedRect.width + "px";
    panel.style.right = "auto";
    panel.style.transform = "none";
    panel.style.top = topVal + "px";
  }

  function iuMojeSluzbyOpenSurface(kind) {
    const overlay = document.getElementById("iu-mojeSluzbyOverlay");
    const panel = document.getElementById("iu-mojeSluzbyPanel");
    const titleEl = document.getElementById("iu-mojeSluzbyTitle");
    const bodyEl = document.getElementById("iu-mojeSluzbyBody");
    if (!overlay || !panel || !bodyEl) return;
    try { iuCloseAllOverlaysExcept("mojesluzby"); } catch (_) {}
    const titles = { banka: "Banka", bakalari: "Bakaláři", pojistovna: "Zdravotní pojišťovna" };
    if (titleEl) titleEl.textContent = titles[kind] || kind;
    bodyEl.innerHTML = "";
    if (kind === "banka") renderBankaModal(bodyEl);
    else if (kind === "bakalari") renderBakalariModal(bodyEl);
    else if (kind === "pojistovna") renderPojistovnaModal(bodyEl);
    if (typeof window.iuSetElOpenVisible === "function") {
      window.iuSetElOpenVisible(overlay, true);
      window.iuSetElOpenVisible(panel, true);
    } else { overlay.hidden = false; panel.hidden = false; }
    iuSetActiveOverFeedModal(panel);
    iuPositionModalOverFeed(panel);
    _mojeSluzbyResizeHandler = function() {
      if (_mojeSluzbyResizeTimer) clearTimeout(_mojeSluzbyResizeTimer);
      _mojeSluzbyResizeTimer = setTimeout(function() { iuPositionModalOverFeed(panel); }, 100);
    };
    _mojeSluzbyScrollHandler = function() {
      requestAnimationFrame(function() { iuPositionModalOverFeed(panel); });
    };
    window.addEventListener("resize", _mojeSluzbyResizeHandler);
    window.addEventListener("scroll", _mojeSluzbyScrollHandler, true);
    document.documentElement.style.overflow = "hidden";
    document.body.classList.add("iu-modal-open");
  }

  function openMojeSluzbyModal(kind) {
    if (typeof window.iuOpenOverlay === "function") window.iuOpenOverlay("mojesluzby", { kind: kind });
    else iuMojeSluzbyOpenSurface(kind);
  }
  try { window.iuMojeSluzbyOpenSurface = iuMojeSluzbyOpenSurface; } catch (_) {}

  function closeMojeSluzbyModal() {
    __iuActiveOverFeedModal = null;
    const overlay = document.getElementById("iu-mojeSluzbyOverlay");
    const panel = document.getElementById("iu-mojeSluzbyPanel");
    if (!overlay || !panel) return;
    if (_mojeSluzbyResizeHandler) {
      window.removeEventListener("resize", _mojeSluzbyResizeHandler);
      _mojeSluzbyResizeHandler = null;
    }
    if (_mojeSluzbyScrollHandler) {
      window.removeEventListener("scroll", _mojeSluzbyScrollHandler, true);
      _mojeSluzbyScrollHandler = null;
    }
    if (_mojeSluzbyResizeTimer) { clearTimeout(_mojeSluzbyResizeTimer); _mojeSluzbyResizeTimer = null; }
    if (typeof window.iuSetElOpenVisible === "function") {
      window.iuSetElOpenVisible(panel, false);
      window.iuSetElOpenVisible(overlay, false);
    } else { overlay.hidden = true; panel.hidden = true; }
    document.documentElement.style.overflow = "";
    document.body.classList.remove("iu-modal-open");
  }

  function renderBankaModal(container) {
    const state = getBanksState();
    state.favorites = iuGetBanks();
    const allBanks = IU_BANKS_ALL.concat(state.customBanks.map(function(c) { return { id: c.id, label: c.label, url: c.url, loginUrl: c.url, color: "#333" }; }));
    const favIds = new Set(state.favorites);
    let editMode = false;

    const persist = function() { setBanksState({ favorites: state.favorites, customBanks: state.customBanks }); };

    const html = [
      "<div class=\"iu-mojeSluzbyBanka\">",
      "  <div class=\"iu-mojeSluzbyBankaHead\"><button type=\"button\" class=\"iu-mojeSluzbyEditToggle\" data-edit-toggle>Upravit</button></div>",
      "  <div class=\"iu-mojeSluzbyBankaFav\"><h3>MOJE BANKY</h3>",
      "  <div class=\"iuBanksGrid iu-mojeSluzbyFavGrid\" data-fav-grid role=\"list\"></div></div>",
      "  <div class=\"iu-mojeSluzbyBankaAll\"><h3>VŠECHNY BANKY</h3>",
      "  <input type=\"text\" class=\"iu-mojeSluzbySearch\" placeholder=\"Hledat banku\" data-bank-search />",
      "  <div class=\"iuBanksGrid iu-mojeSluzbyAllGrid\" data-all-grid role=\"list\"></div></div>",
      "  <div class=\"iu-mojeSluzbyBankaCustom\"><h3>Přidat vlastní banku</h3>",
      "  <input type=\"text\" placeholder=\"Název\" data-custom-name /><input type=\"text\" placeholder=\"URL (https://...)\" data-custom-url />",
      "  <button type=\"button\" data-custom-add>Přidat</button></div>",
      "</div>"
    ].join("");
    container.innerHTML = html;

    const favGrid = container.querySelector("[data-fav-grid]");
    const allGrid = container.querySelector("[data-all-grid]");
    const editToggle = container.querySelector("[data-edit-toggle]");
    const searchInput = container.querySelector("[data-bank-search]");
    const customName = container.querySelector("[data-custom-name]");
    const customUrl = container.querySelector("[data-custom-url]");
    const customAdd = container.querySelector("[data-custom-add]");

    function renderFav() {
      state.favorites = iuGetBanks();
      var myBankIds = new Set(state.favorites);
      favGrid.innerHTML = state.favorites.map(function(id, idx) {
        var bank = allBanks.find(function(b) { return b.id === id; });
        if (!bank) return "";
        var btns = editMode ? "<span class=\"iu-mojeSluzbyMoveBtns\"><button type=\"button\" data-move-left data-idx=\"" + idx + "\" aria-label=\"Doleva\">←</button><button type=\"button\" data-move-right data-idx=\"" + idx + "\" aria-label=\"Doprava\">→</button></span>" : "";
        var loginUrl = bank.loginUrl || bank.url;
        return "<div class=\"iuBankCard\" data-fav-id=\"" + esc(id) + "\" data-bank-id=\"" + esc(id) + "\">" + btns +
          "<button type=\"button\" class=\"iuBankCardMain\" data-bank-login-url=\"" + esc(loginUrl) + "\"><span class=\"iuBankIcon iuBankIconGold\"><i class=\"fa-solid fa-building-columns\"></i></span><span class=\"iuBankLabel iuBankLabelGold\">" + esc(bank.label) + "</span></button>" +
          "<button type=\"button\" data-bank-id=\"" + esc(id) + "\" class=\"iuBankMiniActionBtn iuBankRemove\">ODEBRAT</button></div>";
      }).join("");
    }

    function renderAll(filter) {
      var q = (filter || "").toLowerCase().trim();
      state.favorites = iuGetBanks();
      var myBankIds = new Set(state.favorites);
      var otherBanks = allBanks.filter(function(b) { return !myBankIds.has(b.id) && (!q || (b.label || "").toLowerCase().includes(q)); });
      allGrid.innerHTML = otherBanks.map(function(bank) {
        var loginUrl = bank.loginUrl || bank.url;
        return "<div class=\"iuBankCard\" data-bank-id=\"" + esc(bank.id) + "\">" +
          "<button type=\"button\" class=\"iuBankCardMain\" data-bank-login-url=\"" + esc(loginUrl) + "\"><span class=\"iuBankIcon iuBankIconGold\"><i class=\"fa-solid fa-building-columns\"></i></span><span class=\"iuBankLabel iuBankLabelGold\">" + esc(bank.label) + "</span></button>" +
          "<button type=\"button\" data-bank-id=\"" + esc(bank.id) + "\" class=\"iuBankMiniActionBtn iuBankAdd\">PŘIDAT</button></div>";
      }).join("");
    }

    renderFav();
    renderAll();

    editToggle.addEventListener("click", function() {
      editMode = !editMode;
      editToggle.textContent = editMode ? "Hotovo" : "Upravit";
      renderFav();
    });

    favGrid.addEventListener("click", function(e) {
      var moveLeft = e.target.closest("[data-move-left]");
      var moveRight = e.target.closest("[data-move-right]");
      if (e.target.closest("button.iuBankRemove")) return;
      var mainBtn = e.target.closest("button.iuBankCardMain");
      if (moveLeft) {
        var idx = parseInt(moveLeft.dataset.idx, 10);
        if (idx > 0) {
          var fav = iuGetBanks().slice();
          var t = fav[idx];
          fav[idx] = fav[idx - 1];
          fav[idx - 1] = t;
          iuSetBanks(fav);
          iuRenderBanks();
        }
      } else if (moveRight) {
        var idx = parseInt(moveRight.dataset.idx, 10);
        var fav = iuGetBanks().slice();
        if (idx < fav.length - 1) {
          var t = fav[idx];
          fav[idx] = fav[idx + 1];
          fav[idx + 1] = t;
          iuSetBanks(fav);
          iuRenderBanks();
        }
      } else if (mainBtn && !editMode) {
        var url = mainBtn.getAttribute("data-bank-login-url");
        if (url && /^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener,noreferrer");
      }
    });

    allGrid.addEventListener("click", function(e) {
      if (e.target.closest("button.iuBankAdd")) return;
      var mainBtn = e.target.closest("button.iuBankCardMain");
      if (mainBtn) {
        var url = mainBtn.getAttribute("data-bank-login-url");
        if (url && /^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener,noreferrer");
      }
    });

    if (searchInput) searchInput.addEventListener("input", function() { renderAll(searchInput.value); });

    customAdd.addEventListener("click", function() {
      const name = (customName.value || "").trim();
      const url = (customUrl.value || "").trim();
      if (!name || !url) return;
      if (!/^https?:\/\//i.test(url)) return;
      const id = "custom_" + Date.now();
      state.customBanks.push({ id: id, label: name, url: url });
      setBanksState({ favorites: state.favorites, customBanks: state.customBanks });
      iuAddBank(id);
      customName.value = "";
      customUrl.value = "";
    });
  }

  function renderBakalariModal(container) {
    var saved = getBakalariState();
    var slots = saved.length ? saved.map(function(s) { return { name: s.name, url: s.url }; }) : [{ name: "", url: "" }];
    var savedFeedbackUntil = 0;

    function getSlotsFromDom() {
      var rows = container.querySelectorAll(".iu-mojeSluzbyBakalariSlot");
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var nameInp = rows[i].querySelector("[data-name]");
        var urlInp = rows[i].querySelector("[data-url]");
        out.push({ name: (nameInp && nameInp.value) ? nameInp.value.trim().slice(0, 30) : "", url: (urlInp && urlInp.value) ? urlInp.value.trim() : "" });
      }
      return out;
    }

    function canSave() {
      var rows = getSlotsFromDom();
      return rows.length > 0;
    }

    function updateSaveButton() {
      var btn = container.querySelector("[data-bakalari-save]");
      if (btn) btn.disabled = !canSave();
    }

    var html = [
      "<div class=\"iu-mojeSluzbyBakalari\">",
      "  <div class=\"iu-mojeSluzbyBakalariSlots\" data-slots></div>",
      "  <div class=\"iu-mojeSluzbyBakalariActions\">",
      "    <button type=\"button\" data-add-slot>Přidat</button>",
      "    <button type=\"button\" data-remove-slot>Odebrat</button>",
      "    <button type=\"button\" class=\"iu-bakalariSaveBtn\" data-bakalari-save disabled>Uložit</button>",
      "  </div>",
      "  <div class=\"iu-bakalariSavedFeedback\" data-bakalari-feedback aria-live=\"polite\"></div>",
      "  <div class=\"iu-bakalariSavedSection\">",
      "    <div class=\"iu-bakalariSavedLabel\">Uložené</div>",
      "    <div class=\"iu-bakalariSavedChips\" data-bakalari-chips></div>",
      "  </div>",
      "</div>"
    ].join("");
    container.innerHTML = html;

    var slotsEl = container.querySelector("[data-slots]");
    var addBtn = container.querySelector("[data-add-slot]");
    var removeBtn = container.querySelector("[data-remove-slot]");
    var saveBtn = container.querySelector("[data-bakalari-save]");
    var feedbackEl = container.querySelector("[data-bakalari-feedback]");
    var chipsEl = container.querySelector("[data-bakalari-chips]");

    function renderSlots() {
      slotsEl.innerHTML = slots.map(function(s, i) {
        return "<div class=\"iu-mojeSluzbyBakalariSlot\" data-slot=\"" + i + "\"><span class=\"iuIconTile\"><i class=\"fa-solid fa-graduation-cap\"></i></span><input placeholder=\"Jméno dítěte\" data-name maxlength=\"30\" value=\"" + esc(s.name) + "\" /><input placeholder=\"URL (https://...)\" data-url value=\"" + esc(s.url) + "\" /></div>";
      }).join("");
      slotsEl.querySelectorAll("[data-name]").forEach(function(inp, i) {
        var idx = i;
        inp.addEventListener("input", function() {
          if (slots[idx]) slots[idx].name = inp.value.slice(0, 30);
          updateSaveButton();
        });
      });
      slotsEl.querySelectorAll("[data-url]").forEach(function(inp, i) {
        var idx = i;
        inp.addEventListener("input", function() {
          if (slots[idx]) slots[idx].url = inp.value;
          updateSaveButton();
        });
      });
      updateSaveButton();
    }

    function renderSavedChips() {
      var list = getBakalariState();
      chipsEl.innerHTML = list.map(function(item, i) {
        var label = item.name.length > 24 ? item.name.slice(0, 21) + "..." : item.name;
        return "<button type=\"button\" class=\"iu-bakalariChip\" data-bakalari-chip-url=\"" + esc(normalizeBakalariUrl(item.url)) + "\">" + esc(label) + "</button>";
      }).join("");
      chipsEl.querySelectorAll(".iu-bakalariChip").forEach(function(btn) {
        var url = btn.getAttribute("data-bakalari-chip-url");
        btn.addEventListener("click", function() {
          if (url && /^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener,noreferrer");
        });
      });
    }

    function showSavedFeedback() {
      if (!feedbackEl) return;
      feedbackEl.textContent = "Uloženo";
      feedbackEl.classList.add("iu-bakalariSavedFeedback--visible");
      savedFeedbackUntil = Date.now() + 2500;
      setTimeout(function() {
        feedbackEl.classList.remove("iu-bakalariSavedFeedback--visible");
        feedbackEl.textContent = "";
      }, 2500);
    }

    addBtn.addEventListener("click", function() {
      slots.push({ name: "", url: "" });
      renderSlots();
    });

    removeBtn.addEventListener("click", function() {
      if (slots.length <= 1) return;
      slots.pop();
      renderSlots();
    });

    saveBtn.addEventListener("click", function() {
      var rows = getSlotsFromDom();
      if (!rows.length) return;
      var toSave = [];
      for (var i = 0; i < rows.length; i++) {
        var name = rows[i].name.trim().slice(0, 30);
        var url = normalizeBakalariUrl(rows[i].url);
        if (name.length === 0) continue;
        if (!isValidBakalariUrl(rows[i].url)) continue;
        toSave.push({ name: name, url: url });
      }
      setBakalariState(toSave);
      saved = toSave;
      slots = toSave.length ? toSave.slice() : [{ name: "", url: "" }];
      renderSlots();
      renderSavedChips();
      showSavedFeedback();
      updateSaveButton();
    });

    renderSlots();
    renderSavedChips();
  }

  function renderPojistovnaModal(container) {
    var list = getPojistovnyButtonsState();

    var insurerOpts = "<option value=\"\">— Pojišťovna —</option>" + POJISTOVNY.map(function(p) {
      return "<option value=\"" + esc(p.id) + "\" data-abbr=\"" + esc(p.abbr) + "\" data-url=\"" + esc(p.loginUrl) + "\">" + esc(p.label) + "</option>";
    }).join("");
    var colorOpts = "<option value=\"\">— Barva —</option>" + POJISTOVNY_COLORS.map(function(c) {
      return "<option value=\"" + esc(c.id) + "\" data-value=\"" + esc(c.value) + "\">" + esc(c.value) + "</option>";
    }).join("");

    var html = [
      "<div class=\"iu-mojeSluzbyPojistovna\">",
      "  <div class=\"iu-pojistovnaForm\">",
      "    <label class=\"iu-pojistovnaLabel\">Pojišťovna</label>",
      "    <select class=\"iu-pojistovnaSelect\" data-poj-insurer>" + insurerOpts + "</select>",
      "    <label class=\"iu-pojistovnaLabel\">Jméno</label>",
      "    <input type=\"text\" class=\"iu-pojistovnaInput\" placeholder=\"Jméno\" data-poj-name maxlength=\"20\" />",
      "    <label class=\"iu-pojistovnaLabel\">Barva</label>",
      "    <select class=\"iu-pojistovnaSelect\" data-poj-color>" + colorOpts + "</select>",
      "    <button type=\"button\" class=\"iu-pojistovnaSaveBtn\" data-poj-save>Uložit</button>",
      "  </div>",
      "  <div class=\"iu-pojistovnaMessage\" data-poj-message aria-live=\"polite\"></div>",
      "  <div class=\"iu-pojistovnaSaved\">",
      "    <div class=\"iuBanksGrid iu-pojistovnaSavedGrid\" data-poj-saved></div>",
      "  </div>",
      "</div>"
    ].join("");
    container.innerHTML = html;

    var insurerSelect = container.querySelector("[data-poj-insurer]");
    var nameInput = container.querySelector("[data-poj-name]");
    var colorSelect = container.querySelector("[data-poj-color]");
    var saveBtn = container.querySelector("[data-poj-save]");
    var messageEl = container.querySelector("[data-poj-message]");
    var savedEl = container.querySelector("[data-poj-saved]");

    function setMessage(text, visible) {
      if (!messageEl) return;
      messageEl.textContent = text || "";
      messageEl.classList.toggle("iu-pojistovnaMessage--visible", !!visible);
    }

    function renderSaved() {
      list = getPojistovnyButtonsState();
      savedEl.innerHTML = list.map(function(item) {
        var style = "background:linear-gradient(180deg," + (item.colorValue || "#1a5bb5") + ",#0d2d5c);";
        return "<div class=\"iuBankCard iu-pojistovnaTile\" data-poj-id=\"" + esc(item.id) + "\">" +
          "<button type=\"button\" class=\"iuBankCardMain iu-pojistovnaTileBtn\" data-poj-login-url=\"" + esc(item.loginUrl) + "\" style=\"" + esc(style) + "\">" +
          "<span class=\"iu-pojistovnaTileAbbr\">" + esc(item.abbr) + "</span>" +
          "<span class=\"iu-pojistovnaTileName\">" + esc(item.name) + "</span></button>" +
          "<button type=\"button\" class=\"iuBankMiniActionBtn iu-pojistovnaRemove\" data-poj-remove-id=\"" + esc(item.id) + "\">Odstranit</button></div>";
      }).join("");
      savedEl.querySelectorAll("[data-poj-login-url]").forEach(function(btn) {
        var url = btn.getAttribute("data-poj-login-url");
        btn.addEventListener("click", function() {
          if (url && /^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener,noreferrer");
        });
      });
      savedEl.querySelectorAll("[data-poj-remove-id]").forEach(function(btn) {
        btn.addEventListener("click", function(e) {
          e.preventDefault();
          e.stopPropagation();
          var id = btn.getAttribute("data-poj-remove-id");
          if (!id) return;
          list = list.filter(function(x) { return x.id !== id; });
          setPojistovnyButtonsState(list);
          renderSaved();
          setMessage("", false);
        });
      });
    }

    saveBtn.addEventListener("click", function() {
      var insurerId = (insurerSelect.value || "").trim();
      var name = (nameInput.value || "").trim();
      var nameSlice = name.slice(0, 20);
      var colorId = (colorSelect.value || "").trim();
      setMessage("", false);
      if (!insurerId) {
        setMessage("Vyberte pojišťovnu.", true);
        return;
      }
      if (nameSlice.length === 0) {
        setMessage("Zadejte jméno (1–20 znaků).", true);
        return;
      }
      if (name.length > 20) {
        setMessage("Jméno může mít nejvýše 20 znaků.", true);
        return;
      }
      if (!colorId) {
        setMessage("Vyberte barvu.", true);
        return;
      }
      if (list.length >= POJISTOVNY_MAX) {
        setMessage("Uloženo je již maximálně " + POJISTOVNY_MAX + " tlačítek. Nejprve nějaké odeberte.", true);
        return;
      }
      var insurer = POJISTOVNY.filter(function(p) { return p.id === insurerId; })[0];
      var color = POJISTOVNY_COLORS.filter(function(c) { return c.id === colorId; })[0];
      if (!insurer || !color) return;
      var newItem = {
        id: "zp_" + Date.now() + "_" + Math.random().toString(36).slice(2),
        insurerId: insurer.id,
        abbr: insurer.abbr,
        name: nameSlice,
        colorId: color.id,
        colorValue: color.value,
        loginUrl: insurer.loginUrl
      };
      list = list.slice();
      list.push(newItem);
      setPojistovnyButtonsState(list);
      nameInput.value = "";
      insurerSelect.value = "";
      colorSelect.value = "";
      renderSaved();
      setMessage("Uloženo.", true);
      setTimeout(function() { setMessage("", false); }, 2500);
    });

    renderSaved();
  }

  function iuRenderMojeSluzbyInQuickFeed(key, container) {
    if (!container) return;
    if (key === "banka") renderBankaModal(container);
    else if (key === "bakalari") renderBakalariModal(container);
    else if (key === "pojistovna") renderPojistovnaModal(container);
  }
  try { window.iuRenderMojeSluzbyInQuickFeed = iuRenderMojeSluzbyInQuickFeed; } catch (_) {}

  function init() {
    const root = iuEnsureModalRoot();
    const overlay = document.getElementById("iu-mojeSluzbyOverlay");
    const panel = document.getElementById("iu-mojeSluzbyPanel");
    if (overlay && overlay.parentElement !== root) root.appendChild(overlay);
    if (panel && panel.parentElement !== root) root.appendChild(panel);

    document.addEventListener("click", function(e) {
      var id = e.target && e.target.dataset && e.target.dataset.bankId;
      if (id) {
        if (e.target.classList && e.target.classList.contains("iuBankRemove")) {
          iuRemoveBank(id);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.target.classList && e.target.classList.contains("iuBankAdd")) {
          iuAddBank(id);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      const btn = e.target.closest && e.target.closest("[data-iu-modal]");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const kind = btn.getAttribute("data-iu-modal");
      if (kind) {
        if ((kind === "banka" || kind === "bakalari" || kind === "pojistovna") && typeof window.iuOpenOverlay === "function") {
          window.iuOpenOverlay("quickfeed", { key: kind });
          return;
        }
        if ((kind === "banka" || kind === "bakalari" || kind === "pojistovna") && typeof window.iuShowQuickFeed === "function") {
          window.iuShowQuickFeed(kind);
          return;
        }
        return;
      }
    });
    const closeBtn = panel && panel.querySelector("[data-iu-close]");
    if (overlay) overlay.addEventListener("click", closeMojeSluzbyModal);
    if (closeBtn) closeBtn.addEventListener("click", closeMojeSluzbyModal);
    if (panel) panel.addEventListener("click", (e) => { if (e.target === panel) closeMojeSluzbyModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMojeSluzbyModal(); });
    try { window.iuCloseMojeSluzbyModal = closeMojeSluzbyModal; } catch (_) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

} catch(e) {
  console.error("IU SAFE BOOT ERROR:", e);
}

// === TOPBAR / MOBILE: move CTA to topbar on desktop, to mobile slot below gate tabs on mobile/tablet ===
(function iuMoveAdsPillToTopbar() {
  function isMobile() {
    try {
      return window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
    } catch (e) { return false; }
  }
  function run() {
    var wrapper = document.querySelector(".iuRightTopCtas");
    if (!wrapper) return;
    var services = wrapper.querySelector(".iuRightCta--services");
    var submit = wrapper.querySelector(".iuRightCta--submit");
    if (!services || !submit) return;
    var topbarRight = document.getElementById("iuTopbarRight");
    var mobileSlot = document.getElementById("iuMobileCtaSlot");
    if (!topbarRight) return;
    if (isMobile() && mobileSlot) {
      if (wrapper.parentNode === mobileSlot) return;
      mobileSlot.appendChild(wrapper);
      mobileSlot.setAttribute("aria-hidden", "false");
    } else {
      if (wrapper.parentNode === topbarRight) return;
      topbarRight.appendChild(wrapper);
      if (mobileSlot) mobileSlot.setAttribute("aria-hidden", "true");
    }
  }
  function init() {
    run();
    try {
      var mq = window.matchMedia && window.matchMedia("(max-width: 900px)");
      if (mq && mq.addEventListener) mq.addEventListener("change", run);
    } catch (e) {}
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

// === PWA install CTA: desktop always visible + fallback overlay; mobile pointer/tap + click ===
(function iuPwaInstallCta() {
  var deferredPrompt = null;
  var ctaEl = null;
  var overlayEl = null;
  var desktopFallbackEl = null;
  var ran = false;
  var lastOpenTime = 0;
  var OPEN_DEBOUNCE_MS = 400;

  if (typeof window.__iuBipEvent !== "undefined" && window.__iuBipEvent) {
    deferredPrompt = window.__iuBipEvent;
  }
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (ctaEl) ctaEl.classList.remove("iu-pwa-install-hidden");
  }, { passive: false });

  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    if (ctaEl) ctaEl.classList.add("iu-pwa-install-hidden");
  });

  function isStandalone() {
    try {
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
      if (navigator.standalone === true) return true;
      if (document.referrer && document.referrer.indexOf("android-app://") === 0) return true;
    } catch (e) {}
    return false;
  }

  function isIos() {
    try {
      return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    } catch (e) {}
    return false;
  }

  function hideCta() {
    if (ctaEl) ctaEl.classList.add("iu-pwa-install-hidden");
  }

  function showCta() {
    if (ctaEl) ctaEl.classList.remove("iu-pwa-install-hidden");
  }

  function showIosOverlay() {
    if (overlayEl && overlayEl.hidden) {
      overlayEl.hidden = false;
      lastOpenTime = Date.now();
    }
  }

  function closeIosOverlay() {
    if (overlayEl) overlayEl.hidden = true;
  }

  function showDesktopFallbackOverlay() {
    if (desktopFallbackEl && desktopFallbackEl.hidden) {
      desktopFallbackEl.hidden = false;
      lastOpenTime = Date.now();
    }
  }

  function closeDesktopFallbackOverlay() {
    if (desktopFallbackEl) desktopFallbackEl.hidden = true;
  }

  function handleCtaAction(ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest("#iuPwaInstallCta") : null;
    if (!btn || !document.body.contains(btn)) return;
    ev.preventDefault();
    if (Date.now() - lastOpenTime < OPEN_DEBOUNCE_MS) return;
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        var choice = deferredPrompt.userChoice;
        if (choice && typeof choice.then === "function") {
          choice.then(function (result) {
            if (result && result.outcome === "accepted") hideCta();
            deferredPrompt = null;
          }).catch(function () { deferredPrompt = null; });
        } else {
          deferredPrompt = null;
        }
        return;
      } catch (err) {
        deferredPrompt = null;
      }
    }
    if (isIos()) {
      showIosOverlay();
      return;
    }
    showDesktopFallbackOverlay();
  }

  function run() {
    if (ran) return;
    var nodes = document.querySelectorAll("#iuPwaInstallCta");
    if (nodes.length !== 1) return;
    ctaEl = nodes[0];
    overlayEl = document.getElementById("iuPwaIosOverlay");
    desktopFallbackEl = document.getElementById("iuPwaDesktopFallbackOverlay");
    ran = true;

    if (typeof window.__iuBipEvent !== "undefined" && window.__iuBipEvent) {
      deferredPrompt = window.__iuBipEvent;
    }

    if (isStandalone()) {
      hideCta();
      return;
    }

    showCta();

    document.addEventListener("click", function (ev) {
      handleCtaAction(ev);
    }, true);

    document.addEventListener("pointerup", function (ev) {
      handleCtaAction(ev);
    }, true);

    if (overlayEl) {
      overlayEl.querySelectorAll("[data-iu-pwa-overlay-close]").forEach(function (el) {
        el.addEventListener("click", closeIosOverlay);
      });
      overlayEl.addEventListener("click", function (e) {
        if (e.target === overlayEl) closeIosOverlay();
      });
      document.addEventListener("keydown", function keyClose(e) {
        if (e.key === "Escape" && overlayEl && !overlayEl.hidden) closeIosOverlay();
        if (e.key === "Escape" && desktopFallbackEl && !desktopFallbackEl.hidden) closeDesktopFallbackOverlay();
      });
    }
    if (desktopFallbackEl) {
      desktopFallbackEl.querySelectorAll("[data-iu-pwa-desktop-fallback-close]").forEach(function (el) {
        el.addEventListener("click", closeDesktopFallbackOverlay);
      });
      desktopFallbackEl.addEventListener("click", function (e) {
        if (e.target === desktopFallbackEl) closeDesktopFallbackOverlay();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();

// === TOPBAR CTA: Inzerce/Služby + Vložit inzerát → central exclusive middle mode; P0 mobile = fullscreen overlay ===
(function iuAdsStageOverlay() {
  const categories = ["Auto", "Reality", "Služby", "Práce"];
  function iuAdsCategoryValue(lab) {
    try {
      return lab.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, "-");
    } catch (e) {
      return String(lab).toLowerCase();
    }
  }
  function initAdsCategories() {
    var grid = document.getElementById("iuAdsCategoriesGrid");
    var sel = document.getElementById("iuAdsFieldCategory");
    if (grid && !grid.dataset.iuAdsCatsInit) {
      grid.dataset.iuAdsCatsInit = "1";
      grid.textContent = "";
      for (var i = 0; i < categories.length; i++) {
        var lab = categories[i];
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "iuAdsCategoryCard";
        btn.setAttribute("aria-label", lab);
        btn.textContent = lab;
        btn.setAttribute("data-iu-ads-category", iuAdsCategoryValue(lab));
        grid.appendChild(btn);
      }
    }
    if (sel && !sel.dataset.iuAdsCatsInit) {
      sel.dataset.iuAdsCatsInit = "1";
      var keep = sel.querySelector('option[value=""]');
      var placeholderText = keep ? keep.textContent : "— vyberte —";
      sel.textContent = "";
      var opt0 = document.createElement("option");
      opt0.value = "";
      opt0.textContent = placeholderText;
      sel.appendChild(opt0);
      for (var j = 0; j < categories.length; j++) {
        var lab2 = categories[j];
        var opt = document.createElement("option");
        opt.value = iuAdsCategoryValue(lab2);
        opt.textContent = lab2;
        sel.appendChild(opt);
      }
    }
  }
  function isMobile() {
    try {
      return window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
    } catch (e) { return false; }
  }
  function openAdsStage(activeTab) {
    var stage = document.getElementById("iuAdsStage");
    if (!stage) return;
    var center = document.getElementById("iuCenterStage");
    if (center) center.setAttribute("data-iu-mode", "ads");
    stage.hidden = false;
    if (isMobile() && stage.parentNode !== document.body) {
      stage.classList.add("iuAdsStage--fullscreen");
      document.body.appendChild(stage);
    }
    setAdsTab(activeTab);
  }
  function closeAdsStage() {
    var stage = document.getElementById("iuAdsStage");
    if (!stage) return;
    var center = document.getElementById("iuCenterStage");
    if (stage.classList.contains("iuAdsStage--fullscreen") && stage.parentNode === document.body && center) {
      stage.classList.remove("iuAdsStage--fullscreen");
      center.appendChild(stage);
    }
    stage.hidden = true;
    if (center) {
      center.removeAttribute("data-iu-mode");
      var view = center.dataset.pendingView || center.dataset.view;
      if (view) center.dataset.view = view;
      try { delete center.dataset.pendingView; } catch (e) {}
      if (stage.parentNode !== center) center.appendChild(stage);
    }
    if (typeof window.iuApplySectionFromURL === "function") {
      try { window.iuApplySectionFromURL(); } catch (e) {}
    }
  }
  function setAdsTab(tab) {
    var tabBrowse = document.getElementById("iuAdsTabBrowse");
    var tabSubmit = document.getElementById("iuAdsTabSubmit");
    var panelBrowse = document.getElementById("iuAdsPanelBrowse");
    var panelSubmit = document.getElementById("iuAdsPanelSubmit");
    if (!tabBrowse || !tabSubmit || !panelBrowse || !panelSubmit) return;
    var isBrowse = tab === "browse";
    tabBrowse.classList.toggle("is-active", isBrowse);
    tabSubmit.classList.toggle("is-active", !isBrowse);
    tabBrowse.setAttribute("aria-selected", isBrowse ? "true" : "false");
    tabSubmit.setAttribute("aria-selected", !isBrowse ? "true" : "false");
    panelBrowse.hidden = !isBrowse;
    panelSubmit.hidden = isBrowse;
    try {
      if (typeof window.iuAdsRefreshCategoryUI === "function") {
        window.iuAdsRefreshCategoryUI();
      }
    } catch (eTab) {}
  }
  function run() {
    initAdsCategories();
    var wrapper = document.querySelector(".iuRightTopCtas");
    if (wrapper) {
      wrapper.addEventListener("click", function (e) {
        var t = e.target && e.target.closest ? e.target.closest("button") : null;
        if (!t || !wrapper.contains(t)) return;
        if (t.classList && t.classList.contains("iuRightCta--services")) {
          e.preventDefault();
          openAdsStage("browse");
        } else if (t.classList && t.classList.contains("iuRightCta--submit")) {
          e.preventDefault();
          openAdsStage("submit");
        }
      });
    }
    var backBtn = document.getElementById("iuAdsStageBack");
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        closeAdsStage();
      });
    }
    var tabBrowse = document.getElementById("iuAdsTabBrowse");
    var tabSubmit = document.getElementById("iuAdsTabSubmit");
    if (tabBrowse) {
      tabBrowse.addEventListener("click", function () {
        setAdsTab("browse");
      });
    }
    if (tabSubmit) {
      tabSubmit.addEventListener("click", function () {
        setAdsTab("submit");
      });
    }
    var form = document.getElementById("iuAdsSubmitForm");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
      });
    }
    try {
      if (typeof window.iuAdsSubmitFormWire === "function") {
        window.iuAdsSubmitFormWire();
      }
    } catch (e2) {}
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();

(function iuAdsSubmitFormState() {
  var AUTO_VAL = "auto";
  var ADS_LOCAL_KEY = "iuInfoUzel_autoAds_v1";
  var autoApiState = "idle";
  var autoTitleUserEdited = false;
  var lastLoadedVin = "";
  /** Monotonic id so stale decodeVin completions cannot overwrite newer user action. */
  var vinLoadRequestId = 0;

  function showAutoPublishFeedback(msg, isErr) {
    var fb = document.getElementById("iuAdsAutoPublishFeedback");
    if (!fb) return;
    fb.textContent = msg || "";
    fb.hidden = !msg;
    fb.classList.toggle("iuAdsPublishFeedback--err", !!isErr);
  }

  function validEmailStr(s) {
    var t = String(s || "").trim();
    if (t.length < 5) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
  }

  function collectAutoAdRecord() {
    var post = document.getElementById("iuAdsAutoPost");
    var out = { vin: lastLoadedVin, category: AUTO_VAL };
    if (!post) return out;
    var fields = post.querySelectorAll("input, select, textarea");
    var i;
    for (i = 0; i < fields.length; i++) {
      var f = fields[i];
      var name = f.name || f.id;
      if (!name || f.type === "submit" || f.type === "button") continue;
      if (f.type === "checkbox") {
        out[name] = f.checked ? "1" : "";
      } else if (f.type === "radio") {
        if (f.checked) out[name] = f.value;
      } else {
        out[name] = f.value;
      }
    }
    return out;
  }

  function persistAutoAdLocal() {
    var rec = {
      id: "ad_" + Date.now(),
      savedAt: new Date().toISOString(),
      payload: collectAutoRecord()
    };
    var arr = [];
    try {
      arr = JSON.parse(localStorage.getItem(ADS_LOCAL_KEY) || "[]");
    } catch (e0) {
      arr = [];
    }
    if (!Array.isArray(arr)) arr = [];
    arr.push(rec);
    try {
      localStorage.setItem(ADS_LOCAL_KEY, JSON.stringify(arr));
    } catch (e1) {
      throw new Error("Uložení se nezdařilo (úložiště prohlížeče).");
    }
    return arr.length;
  }

  function collectAutoRecord() {
    return collectAutoAdRecord();
  }

  function $(id) {
    return document.getElementById(id);
  }

  function iuVinMockEnabled() {
    try {
      var h = String(location.hostname || "");
      if (h !== "localhost" && h !== "127.0.0.1") return false;
      return /(?:^|[?&])iuVinMock=1(?:&|$)/.test(String(location.search || ""));
    } catch (e) {
      return false;
    }
  }

  function normalizeVin(v) {
    return String(v || "")
      .replace(/\s+/g, "")
      .toUpperCase();
  }

  function validVinFormat(v) {
    var s = normalizeVin(v);
    if (s.length !== 17) return false;
    return /^[A-HJ-NPR-Z0-9]{17}$/.test(s);
  }

  function cleanApiStr(x) {
    if (x == null) return "";
    var t = String(x).trim();
    if (t === "undefined" || t === "null" || t === "NaN") return "";
    return t.replace(/\s+/g, " ").trim();
  }

  function pickVehicleField(o, keys) {
    var i;
    for (i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (o[k] != null && String(o[k]).trim() !== "") return o[k];
    }
    return "";
  }

  function formatDateOnlyApi(s) {
    if (s == null || s === "") return "";
    var t = String(s).trim();
    var ix = t.indexOf("T");
    if (ix > 0) t = t.slice(0, ix);
    return t.replace(/\s+/g, "");
  }

  function mapPalivoKod(k) {
    var u = String(k || "")
      .toUpperCase()
      .trim();
    var M = {
      BA: "benzin",
      BP: "benzin",
      BE: "benzin",
      NA: "nafta",
      DS: "nafta",
      EL: "elektro",
      EE: "elektro",
      HY: "hybrid",
      HE: "hybrid",
      GP: "phev",
      LP: "lpg",
      CZ: "cng",
      VO: "vodik"
    };
    return M[u] || "";
  }

  function mapKaroserieKeyFromDruh(dr) {
    var u = String(dr || "").toUpperCase();
    if (/SUV|TERÉNN|TERENN|OFF-ROAD/i.test(u)) return "suv";
    if (/KOMBI|STACION|UNIVERSAL/i.test(u)) return "kombi";
    if (/OSOBN|OSOBNÍ|AUTOMOBIL/i.test(u) && !/SUV|MPV/i.test(u)) return "osobni";
    if (/DODÁV|DODAV|NÁKLAD|NAKLAD/i.test(u)) return "dodavka";
    if (/MPV|VÍCEÚČ|VICEUC|VÍCEÚCELOV/i.test(u)) return "mpv";
    if (/PICK/i.test(u)) return "pickup";
    if (/KABRIO|KABIO/i.test(u)) return "kabrio";
    if (/KUPÉ|KUPE/i.test(u)) return "kupé";
    if (/TERÉNN|TERENN/i.test(u)) return "terenni";
    return "";
  }

  function guessKaroserieKeyFromText(s) {
    var u = String(s || "").toUpperCase();
    if (/^SUV| SUV/.test(u) || u === "SUV") return "suv";
    if (/KOMBI/.test(u)) return "kombi";
    if (/HATCH|HATCHBACK/.test(u)) return "hatchback";
    if (/LIFTBACK/.test(u)) return "liftback";
    if (/SEDAN|LIMUZ/.test(u)) return "sedan";
    if (/MPV/.test(u)) return "mpv";
    if (/PICK/.test(u)) return "pickup";
    if (/DODÁV|DODAV/.test(u)) return "dodavka";
    if (/KABRIO/.test(u)) return "kabrio";
    if (/KUPÉ|KUPE/.test(u)) return "kupé";
    return "";
  }

  function formatMotorMaxVykon(raw) {
    var s = cleanApiStr(raw);
    if (!s) return "";
    var p = s.split("/");
    if (p.length >= 2) {
      var kw = p[0].trim();
      var rpm = p[1].trim();
      if (kw && rpm) return kw + " kW / " + rpm + " min⁻¹";
    }
    var n = parseFloat(s.replace(",", "."));
    if (!isNaN(n)) return String(Math.round(n)) + " kW";
    return s;
  }

  function formatPocetMistApi(v) {
    if (v == null || v === "") return "";
    var parts = String(v)
      .split("/")
      .map(function (x) {
        return x.trim();
      });
    while (parts.length < 3) parts.push("");
    var a = parts[0] || "—";
    var b = parts[1] || "—";
    var c = parts[2] === "" ? "0" : parts[2];
    return a + " celkem (" + b + " k sezení, " + c + " k stání)";
  }

  function normalizeVinApiData(d, depth) {
    if (depth == null) depth = 0;
    if (depth > 8) return d != null && typeof d === "object" ? d : {};
    if (d == null) return {};
    if (typeof d === "string") {
      var s0 = String(d).trim();
      if (!s0) return {};
      try {
        return normalizeVinApiData(JSON.parse(s0), depth + 1);
      } catch (eNorm) {
        return {};
      }
    }
    if (Array.isArray(d)) {
      var i0;
      for (i0 = 0; i0 < d.length; i0++) {
        if (d[i0] != null && typeof d[i0] === "object") {
          var u = normalizeVinApiData(d[i0], depth + 1);
          if (
            (u.TovarniZnacka != null && String(u.TovarniZnacka).trim() !== "") ||
            (u.ObchodniOznaceni != null && String(u.ObchodniOznaceni).trim() !== "")
          )
            return u;
        }
      }
      return d[0] != null && typeof d[0] === "object" ? normalizeVinApiData(d[0], depth + 1) : {};
    }
    if (typeof d !== "object") return {};
    if (
      (d.TovarniZnacka != null && String(d.TovarniZnacka).trim() !== "") ||
      (d.ObchodniOznaceni != null && String(d.ObchodniOznaceni).trim() !== "") ||
      (d.VIN != null && String(d.VIN).replace(/\s/g, "").length >= 11)
    )
      return d;
    var nest =
      d.vehicle || d.Vehicle || d.vozidlo || d.vozidla || d.Data || d.detaily || d.result;
    if (nest != null && nest !== d) return normalizeVinApiData(nest, depth + 1);
    var k0;
    for (k0 in d) {
      if (!Object.prototype.hasOwnProperty.call(d, k0)) continue;
      var v0 = d[k0];
      if (v0 != null && typeof v0 === "object") {
        var sub = normalizeVinApiData(v0, depth + 1);
        if (
          (sub.TovarniZnacka != null && String(sub.TovarniZnacka).trim() !== "") ||
          (sub.ObchodniOznaceni != null && String(sub.ObchodniOznaceni).trim() !== "")
        )
          return sub;
      }
    }
    return d;
  }

  function mapApiToForm(j) {
    var o = normalizeVinApiData(j);
    var make = cleanApiStr(
      pickVehicleField(o, [
        "TovarniZnacka",
        "Tovární značka",
        "tovarniZnacka",
        "make",
        "Make",
        "vyrobce",
        "Vyrobce",
        "znacka",
        "Znacka"
      ])
    );
    var model = cleanApiStr(
      pickVehicleField(o, [
        "ObchodniOznaceni",
        "obchodniOznaceni",
        "model",
        "Model"
      ])
    );
    var vin = cleanApiStr(pickVehicleField(o, ["VIN", "vin", "identifikacniCisloVozidla"]));
    var firstRaw = pickVehicleField(o, [
      "DatumPrvniRegistrace",
      "DatumPrvniRegistraceVCr",
      "datumPrvniRegistrace",
      "firstReg"
    ]);
    var firstReg = formatDateOnlyApi(firstRaw);
    var druh = pickVehicleField(o, ["VozidloDruh", "VozidloDruh2", "KaroserieDruh"]);
    var bodyKey =
      mapKaroserieKeyFromDruh(druh) ||
      guessKaroserieKeyFromText(
        pickVehicleField(o, ["KaroserieDruh", "karoserie", "Karoserie", "body", "BodyClass"])
      );
    var bodyFallback = cleanApiStr(druh || pickVehicleField(o, ["karoserie", "Karoserie", "body"]));
    var palivoKod = pickVehicleField(o, ["Palivo", "palivo", "druhPaliva"]);
    var fuelKey = mapPalivoKod(palivoKod) || "";
    var fuelFallback = cleanApiStr(palivoKod);
    var zdvih = pickVehicleField(o, [
      "MotorZdvihObjem",
      "motorZdvihObjem",
      "objemMotoru",
      "ObjemMotoru",
      "zdvihovyObjem"
    ]);
    var displacement = "";
    if (zdvih != null && String(zdvih).trim() !== "") {
      var zn = parseInt(String(zdvih).replace(/\D/g, ""), 10);
      if (!isNaN(zn) && zn > 0 && zn < 50000) displacement = String(zn) + " cm³";
      else displacement = cleanApiStr(zdvih);
    }
    var powerKw = formatMotorMaxVykon(
      pickVehicleField(o, ["MotorMaxVykon", "motorMaxVykon", "vykonMotoruKw", "VykonKw", "vykon"])
    );
    var color = cleanApiStr(
      pickVehicleField(o, ["VozidloKaroserieBarva", "barva", "Barva", "exteriorColor"])
    );
    var seats = formatPocetMistApi(
      pickVehicleField(o, ["VozidloKaroserieMist", "pocetMist", "PocetMist", "seats"])
    );
    var stkRaw = pickVehicleField(o, [
      "PravidelnaTechnickaProhlidkaDo",
      "pravidelnaTechnickaProhlidkaDo",
      "platnostStk",
      "stkDo",
      "StkDo"
    ]);
    var stk = formatDateOnlyApi(stkRaw);
    var owners = cleanApiStr(pickVehicleField(o, ["PocetVlastniku", "pocetVlastniku", "owners"]));
    var firstRegYear = firstRegYearFrom(firstReg) || cleanApiStr(o.firstRegYear);
    var emissionsNorm = "";
    try {
      if (o.emissionsStandard != null && String(o.emissionsStandard).trim() !== "")
        emissionsNorm = cleanApiStr(o.emissionsStandard);
      else
        emissionsNorm = cleanApiStr(
          pickVehicleField(o, ["EmisniUroven", "emisniUroven", "EmiseEHKOSNEHSES"])
        );
    } catch (eEm) {}
    var consCity = "";
    var consExtra = "";
    var consCombined = "";
    try {
      var fc = o.fuelConsumption;
      if (fc != null && typeof fc === "object") {
        if (fc.city != null) consCity = cleanApiStr(fc.city);
        if (fc.extraUrban != null) consExtra = cleanApiStr(fc.extraUrban);
        if (fc.combined != null) consCombined = cleanApiStr(fc.combined);
      }
      if (!consCity && !consExtra && !consCombined) {
        var spot = pickVehicleField(o, ["SpotrebaNa100Km", "spotrebaNa100Km", "Spotreba"]);
        if (spot != null && String(spot).trim() !== "") {
          var sp = String(spot).split("/");
          consCity = cleanApiStr(sp[0] || "");
          consExtra = cleanApiStr(sp[1] || "");
          consCombined = cleanApiStr(sp[2] || "");
        }
      }
    } catch (eFc) {}
    var dimL = "";
    var dimW = "";
    var dimH = "";
    try {
      var dims = o.dimensions;
      if (dims != null && typeof dims === "object") {
        if (dims.length != null) dimL = cleanApiStr(dims.length);
        if (dims.width != null) dimW = cleanApiStr(dims.width);
        if (dims.height != null) dimH = cleanApiStr(dims.height);
      }
      if (!dimL && !dimW && !dimH) {
        var roz = pickVehicleField(o, ["Rozmery", "rozmery"]);
        if (roz != null && String(roz).trim() !== "") {
          var rp = String(roz).split("/");
          dimL = cleanApiStr(rp[0] || "");
          dimW = cleanApiStr(rp[1] || "");
          dimH = cleanApiStr(rp[2] || "");
        }
      }
    } catch (eDim) {}
    var tireN1 = "";
    var tireN2 = "";
    var tireN3 = "";
    var tireN4 = "";
    try {
      var tr = o.tires;
      if (tr != null && typeof tr === "object") {
        tireN1 = cleanApiStr(tr.N1 != null ? tr.N1 : tr.n1);
        tireN2 = cleanApiStr(tr.N2 != null ? tr.N2 : tr.n2);
        tireN3 = cleanApiStr(tr.N3 != null ? tr.N3 : tr.n3);
        tireN4 = cleanApiStr(tr.N4 != null ? tr.N4 : tr.n4);
      }
      if (!tireN1 && !tireN2 && !tireN3 && !tireN4) {
        var nap = pickVehicleField(o, ["NapravyPneuRafky", "napravyPneu"]);
        if (nap != null && String(nap).trim() !== "") {
          var segs = String(nap)
            .split(";")
            .map(function (seg) {
              return cleanApiStr(seg);
            })
            .filter(Boolean);
          if (segs[0]) tireN1 = segs[0];
          if (segs[1]) tireN2 = segs[1];
          if (segs[2]) tireN3 = segs[2];
          if (segs[3]) tireN4 = segs[3];
        }
      }
    } catch (eTire) {}
    var maxSpeed = "";
    try {
      if (o.maxSpeed != null && String(o.maxSpeed).trim() !== "")
        maxSpeed = cleanApiStr(o.maxSpeed);
      else {
        var ms = pickVehicleField(o, ["NejvyssiRychlost", "nejvyssiRychlost"]);
        if (ms != null && String(ms).trim() !== "") maxSpeed = cleanApiStr(ms);
      }
    } catch (eMs) {}
    return {
      make: make,
      model: model,
      vin: vin,
      firstReg: firstReg,
      bodyKey: bodyKey,
      bodyFallback: bodyFallback,
      fuelKey: fuelKey,
      fuelFallback: fuelFallback,
      displacement: displacement,
      powerKw: powerKw,
      color: color,
      seats: seats,
      stk: stk,
      owners: owners,
      firstRegYear: firstRegYear,
      emissionsNorm: emissionsNorm,
      consCity: consCity,
      consExtra: consExtra,
      consCombined: consCombined,
      dimL: dimL,
      dimW: dimW,
      dimH: dimH,
      tireN1: tireN1,
      tireN2: tireN2,
      tireN3: tireN3,
      tireN4: tireN4,
      maxSpeed: maxSpeed
    };
  }

  function firstRegYearFrom(d) {
    if (!d) return "";
    var m = String(d).match(/(\d{4})/);
    return m ? m[1] : "";
  }

  function buildAutoTitle(d) {
    var brand = (d.make || "").trim();
    var model = (d.model || "").trim();
    var yr = String(d.firstRegYear || firstRegYearFrom(d.firstReg) || "").trim();
    var left = [brand, model].filter(Boolean).join(" ");
    if (yr) return (left ? left + " " : "") + yr;
    return left || "";
  }

  function mockVinDecode(vin) {
    var v = normalizeVin(vin);
    var n = 0;
    for (var i = 0; i < v.length; i++) n = (n * 31 + v.charCodeAt(i)) >>> 0;
    var fuels = ["Benzín", "Nafta", "Hybrid", "CNG"];
    var bodies = ["Liftback", "Kombi", "SUV", "Sedan"];
    var colors = ["Šedá", "Černá", "Bílá", "Modrá"];
    var y = 2008 + (n % 12);
    return Promise.resolve({
      TovarniZnacka: "Demo " + (n % 7 === 0 ? "Auto" : "Vůz"),
      ObchodniOznaceni: "Model-" + (100 + (n % 800)),
      VIN: v,
      DatumPrvniRegistrace: y + "-06-15T00:00:00",
      VozidloDruh: "OSOBNÍ AUTOMOBIL",
      Palivo: "BA",
      MotorZdvihObjem: 1200 + (n % 1400),
      MotorMaxVykon: 60 + (n % 120) + " / 4500",
      VozidloKaroserieBarva: colors[n % colors.length],
      VozidloKaroserieMist: 4 + (n % 3) + " / " + (4 + (n % 3)) + " / 0",
      PravidelnaTechnickaProhlidkaDo: y + 5 + "-12-31T00:00:00",
      PocetVlastniku: 1 + (n % 3),
      EmisniUroven: "EURO 6",
      SpotrebaNa100Km: "6.2 / 4.1 / 5.0",
      Rozmery: "4500/ 1800/ 1620",
      NapravyPneuRafky: "205/55 R16 91H; 205/55 R16 91H",
      NejvyssiRychlost: 195
    });
  }

  var VIN_WORKER_URL =
    "https://steep-term-ba60.josef-zmrhal.workers.dev/vin?vin=";

  function parseVinWorkerResponse(text, v, httpStatus) {
    var raw = String(text || "").trim();
    if (!raw) {
      if (httpStatus >= 500) {
        throw new Error("Služba VIN je dočasně nedostupná. Zkuste to za chvíli.");
      }
      throw new Error("Údaje z VIN se nepodařilo načíst.");
    }
    var j = null;
    try {
      j = JSON.parse(raw);
    } catch (pe) {
      if (httpStatus >= 500 || /internal|error/i.test(raw.slice(0, 80))) {
        throw new Error("Služba VIN je dočasně nedostupná. Zkuste to za chvíli.");
      }
      throw new Error("Neplatná odpověď VIN služby.");
    }
    if (j && j.success === true && j.data) {
      return { kind: "api", data: j.data, vinNorm: v };
    }
    if (j && j.success === false && String(j.error || "") === "vin_not_found") {
      return { kind: "manual", vinNorm: cleanApiStr(j.vin) || v };
    }
    if (j && j.success === false) {
      var er = j.error;
      if (String(er || "").indexOf("17") >= 0 || er === "VIN musí mít přesně 17 znaků.") {
        throw new Error("Zadejte platný VIN (17 znaků, bez I, O, Q).");
      }
      throw new Error(typeof er === "string" && er ? er : "Údaje z VIN se nepodařilo načíst.");
    }
    throw new Error("Údaje z VIN se nepodařilo načíst.");
  }

  function fetchVinFromWorker(vin) {
    var v = normalizeVin(vin);
    var url = VIN_WORKER_URL + encodeURIComponent(v);
    var opts = { method: "GET", headers: { Accept: "application/json" } };
    function once() {
      return fetch(url, opts).then(function (res) {
        return res.text().then(function (text) {
          return { res: res, text: text };
        });
      });
    }
    return once().then(function (pair) {
      var st = pair.res.status;
      if (st >= 502 && st <= 599) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve(once());
          }, 1100);
        });
      }
      return pair;
    }).then(function (pair) {
      return parseVinWorkerResponse(pair.text, v, pair.res.status);
    });
  }

  function decodeVin(vin) {
    if (iuVinMockEnabled()) {
      if (!validVinFormat(vin)) {
        return Promise.reject(new Error("Zadejte platný VIN (17 znaků, bez I, O, Q)."));
      }
      return mockVinDecode(vin).then(function (m) {
        return { kind: "api", data: m, vinNorm: m.VIN || m.vin };
      });
    }
    if (!validVinFormat(vin)) {
      return Promise.reject(new Error("Zadejte platný VIN (17 znaků, bez I, O, Q)."));
    }
    return fetchVinFromWorker(vin);
  }

  function setHidden(el, on) {
    if (!el) return;
    el.hidden = !!on;
  }

  function setDisabledIn(root, dis) {
    if (!root) return;
    var inputs = root.querySelectorAll("input, select, textarea, button");
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      if (inp.id === "iuAdsAutoVinLoadBtn" && root.id === "iuAdsAutoPre") continue;
      inp.disabled = !!dis;
    }
  }

  function resetAutoForm() {
    autoApiState = "idle";
    autoTitleUserEdited = false;
    lastLoadedVin = "";
    var vinIn = $("iuAdsAutoVin");
    if (vinIn) vinIn.value = "";
    var ot = $("iuAdsAutoOfferType");
    var vt = $("iuAdsAutoVehicleType");
    var cond = $("iuAdsAutoCondition");
    if (ot) ot.selectedIndex = 0;
    if (vt) vt.selectedIndex = 0;
    if (cond) cond.selectedIndex = 0;
    var post = $("iuAdsAutoPost");
    if (post) {
      var fs = post.querySelectorAll("input, select, textarea");
      for (var i = 0; i < fs.length; i++) {
        var x = fs[i];
        if (x.type === "checkbox" || x.type === "radio") {
          x.checked = false;
        } else if (x.type !== "button" && x.type !== "submit") {
          x.value = "";
        }
      }
    }
    var err = $("iuAdsAutoVinError");
    var ld = $("iuAdsAutoVinLoading");
    if (err) {
      err.textContent = "";
      err.hidden = true;
    }
    if (ld) ld.hidden = true;
    showAutoPublishFeedback("", false);
  }

  function applyCategoryUI() {
    var cat = $("iuAdsFieldCategory");
    var legacy = $("iuAdsLegacyFlat");
    var pre = $("iuAdsAutoPre");
    var post = $("iuAdsAutoPost");
    var reserve = $("iuAdsAutoPostReserve");
    var placeholder = $("iuAdsAutoPostPlaceholder");
    var panelSubmit = document.getElementById("iuAdsPanelSubmit");
    var val = cat ? String(cat.value || "") : "";
    var isAuto = val === AUTO_VAL;
    var isEmpty = !val;

    if (panelSubmit) {
      panelSubmit.classList.toggle("iuAdsPanelSubmit--auto", !!isAuto);
    }

    if (panelSubmit && panelSubmit.hidden) {
      setHidden(pre, true);
      setHidden(post, true);
      setHidden(reserve, true);
      if (placeholder) placeholder.hidden = true;
      return;
    }

    setHidden(legacy, isEmpty || isAuto);
    setHidden(pre, !isAuto);
    setHidden(reserve, !isAuto);
    if (isAuto) {
      if (autoApiState === "loaded") {
        if (placeholder) placeholder.hidden = true;
        setHidden(post, false);
      } else {
        if (placeholder) placeholder.hidden = false;
        setHidden(post, true);
      }
    } else {
      if (placeholder) placeholder.hidden = true;
      setHidden(post, true);
    }

    setDisabledIn(legacy, isEmpty || isAuto);
    setDisabledIn(pre, !isAuto);
    setDisabledIn(post, !isAuto || autoApiState !== "loaded");

    if (isAuto && autoApiState === "loading") {
      var ld2 = $("iuAdsAutoVinLoading");
      if (ld2) ld2.hidden = false;
    }

    if (legacy && !isEmpty && !isAuto) {
      var t = $("iuAdsFieldTitle");
      var d = $("iuAdsFieldDesc");
      var terms = $("iuAdsFieldTerms");
      if (t) t.setAttribute("required", "required");
      if (d) d.setAttribute("required", "required");
      if (terms) terms.setAttribute("required", "required");
    } else {
      var t2 = $("iuAdsFieldTitle");
      var d2 = $("iuAdsFieldDesc");
      var terms2 = $("iuAdsFieldTerms");
      if (t2) t2.removeAttribute("required");
      if (d2) d2.removeAttribute("required");
      if (terms2) terms2.removeAttribute("required");
    }
  }

  function stripApiRawOption(sel) {
    if (!sel || sel.tagName !== "SELECT") return;
    var j;
    for (j = sel.options.length - 1; j >= 0; j--) {
      if (sel.options[j].value === "iu_api_raw") sel.remove(j);
    }
  }

  function setApiSelect(id, valueKey, fallbackText) {
    var el = $(id);
    if (!el) return;
    var fk = valueKey || "";
    var fb = cleanApiStr(fallbackText);
    if (el.tagName !== "SELECT") {
      el.value = fb || fk || "";
      return;
    }
    stripApiRawOption(el);
    var i;
    var found = false;
    for (i = 0; i < el.options.length; i++) {
      if (el.options[i].value === fk) {
        el.selectedIndex = i;
        found = true;
        break;
      }
    }
    if (!found && fb) {
      var opt = document.createElement("option");
      opt.value = "iu_api_raw";
      opt.textContent = fb.length > 80 ? fb.slice(0, 77) + "…" : fb;
      opt.selected = true;
      el.appendChild(opt);
    } else if (!found && fk) {
      var opt2 = document.createElement("option");
      opt2.value = "iu_api_raw";
      opt2.textContent = fk;
      opt2.selected = true;
      el.appendChild(opt2);
    }
  }

  function fillApiFields(m) {
    function set(id, v) {
      var el = $(id);
      if (el) el.value = v != null ? String(v) : "";
    }
    set("iuAdsApiMake", m.make);
    set("iuAdsApiModel", m.model);
    set("iuAdsApiVinDisp", m.vin);
    set("iuAdsApiFirstReg", m.firstReg);
    setApiSelect("iuAdsApiBody", m.bodyKey, m.bodyFallback);
    setApiSelect("iuAdsApiFuel", m.fuelKey, m.fuelFallback);
    set("iuAdsApiDisplacement", m.displacement);
    set("iuAdsApiPower", m.powerKw || "");
    set("iuAdsApiColor", m.color);
    set("iuAdsApiSeats", m.seats);
    set("iuAdsApiStk", m.stk);
    set("iuAdsApiOwners", m.owners);
    set("iuAdsApiEmissionsNorm", m.emissionsNorm);
    set("iuAdsApiConsCity", m.consCity);
    set("iuAdsApiConsExtra", m.consExtra);
    set("iuAdsApiConsCombined", m.consCombined);
    set("iuAdsApiDimL", m.dimL);
    set("iuAdsApiDimW", m.dimW);
    set("iuAdsApiDimH", m.dimH);
    set("iuAdsApiTireN1", m.tireN1);
    set("iuAdsApiTireN2", m.tireN2);
    set("iuAdsApiTireN3", m.tireN3);
    set("iuAdsApiTireN4", m.tireN4);
    set("iuAdsApiMaxSpeed", m.maxSpeed);
    if (!autoTitleUserEdited) {
      var titleEl = $("iuAdsAutoTitle");
      var built = buildAutoTitle(m);
      if (titleEl && built) titleEl.value = built;
    }
  }

  function clearApiFieldsExceptVin(vinVal) {
    var elB = $("iuAdsApiBody");
    if (elB && elB.tagName === "SELECT") {
      stripApiRawOption(elB);
      elB.selectedIndex = 0;
    } else if (elB) elB.value = "";
    var elF = $("iuAdsApiFuel");
    if (elF && elF.tagName === "SELECT") {
      stripApiRawOption(elF);
      elF.selectedIndex = 0;
    } else if (elF) elF.value = "";
    var ids = [
      "iuAdsApiMake",
      "iuAdsApiModel",
      "iuAdsApiFirstReg",
      "iuAdsApiDisplacement",
      "iuAdsApiPower",
      "iuAdsApiColor",
      "iuAdsApiSeats",
      "iuAdsApiStk",
      "iuAdsApiOwners",
      "iuAdsApiEmissionsNorm",
      "iuAdsApiConsCity",
      "iuAdsApiConsExtra",
      "iuAdsApiConsCombined",
      "iuAdsApiDimL",
      "iuAdsApiDimW",
      "iuAdsApiDimH",
      "iuAdsApiTireN1",
      "iuAdsApiTireN2",
      "iuAdsApiTireN3",
      "iuAdsApiTireN4",
      "iuAdsApiMaxSpeed"
    ];
    var i;
    for (i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (el) el.value = "";
    }
    var vEl = $("iuAdsApiVinDisp");
    if (vEl) vEl.value = vinVal != null ? String(vinVal) : "";
  }

  function scrollDesktopVinFieldsIntoView() {
    try {
      if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) return;
    } catch (eM) {}
    var postEl = $("iuAdsAutoPost");
    var target = $("iuAdsApiMake") || postEl;
    if (!postEl || postEl.hidden || !target) return;
    function inViewport(el) {
      var r = el.getBoundingClientRect();
      var vh = window.innerHeight || 0;
      var pad = 12;
      return r.height > 0 && r.top >= pad && r.bottom <= vh - pad && r.width > 0;
    }
    function oneStep() {
      var pr = target.getBoundingClientRect();
      var vh = window.innerHeight || 800;
      if (pr.top >= 12 && pr.bottom <= vh - 12) return false;
      var node = target.parentElement;
      var moved = false;
      while (node && node !== document.documentElement) {
        var cs = window.getComputedStyle(node);
        var oy = cs.overflowY;
        if (
          (oy === "auto" || oy === "scroll") &&
          node.scrollHeight > node.clientHeight + 2
        ) {
          var nr = node.getBoundingClientRect();
          if (pr.bottom > nr.bottom - 16 || pr.top < nr.top + 16) {
            node.scrollTop += pr.top - nr.top - 48;
            moved = true;
            break;
          }
        }
        node = node.parentElement;
      }
      if (!moved) {
        try {
          window.scrollTo(0, window.scrollY + pr.top - 80);
        } catch (eW) {}
        try {
          target.scrollIntoView({ block: "start", behavior: "auto" });
        } catch (eS) {}
        moved = true;
      }
      return moved;
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var k;
        for (k = 0; k < 10; k++) {
          if (inViewport(target)) break;
          oneStep();
        }
      });
    });
  }

  function onVinLoad() {
    if (autoApiState === "loading") {
      return;
    }
    var vinEl = $("iuAdsAutoVin");
    var errEl = $("iuAdsAutoVinError");
    var ldEl = $("iuAdsAutoVinLoading");
    var lbBtn = $("iuAdsAutoVinLoadBtn");
    var raw = vinEl ? vinEl.value : "";
    var nv = normalizeVin(raw);
    var reqId = ++vinLoadRequestId;
    if (nv !== normalizeVin(lastLoadedVin || "___")) {
      autoTitleUserEdited = false;
    }
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = "";
    }
    autoApiState = "loading";
    if (ldEl) ldEl.hidden = false;
    if (lbBtn) lbBtn.disabled = true;
    applyCategoryUI();

    decodeVin(raw)
      .then(function (result) {
        if (reqId !== vinLoadRequestId) return;
        if (result && result.kind === "manual") {
          lastLoadedVin = result.vinNorm;
          autoApiState = "loaded";
          if (ldEl) ldEl.hidden = true;
          if (errEl) errEl.hidden = true;
          clearApiFieldsExceptVin(lastLoadedVin);
          autoTitleUserEdited = false;
          var tMan = $("iuAdsAutoTitle");
          if (tMan) tMan.value = "";
          applyCategoryUI();
          scrollDesktopVinFieldsIntoView();
          return;
        }
        if (result && result.kind === "api") {
          var m = mapApiToForm(result.data);
          m.vin = m.vin || result.vinNorm || normalizeVin(raw);
          if (!m.firstRegYear && m.firstReg) m.firstRegYear = firstRegYearFrom(m.firstReg);
          lastLoadedVin = m.vin;
          autoApiState = "loaded";
          if (ldEl) ldEl.hidden = true;
          if (errEl) errEl.hidden = true;
          fillApiFields(m);
          applyCategoryUI();
          scrollDesktopVinFieldsIntoView();
        }
      })
      .catch(function (e) {
        if (reqId !== vinLoadRequestId) return;
        autoApiState = "error";
        if (ldEl) ldEl.hidden = true;
        if (errEl) {
          errEl.textContent = e && e.message ? String(e.message) : "Chyba načtení.";
          errEl.hidden = false;
        }
        setHidden($("iuAdsAutoPost"), true);
        applyCategoryUI();
      })
      .then(function () {
        if (reqId === vinLoadRequestId && lbBtn) lbBtn.disabled = false;
      });
  }

  function onCategoryChange() {
    var cat = $("iuAdsFieldCategory");
    var val = cat ? String(cat.value || "") : "";
    if (val !== AUTO_VAL) {
      resetAutoForm();
    } else {
      if (autoApiState !== "loading" && autoApiState !== "loaded") {
        autoApiState = "idle";
        autoTitleUserEdited = false;
        var err = $("iuAdsAutoVinError");
        var ld = $("iuAdsAutoVinLoading");
        if (err) {
          err.textContent = "";
          err.hidden = true;
        }
        if (ld) ld.hidden = true;
      }
    }
    showAutoPublishFeedback("", false);
    applyCategoryUI();
  }

  function wireAdsBoolRadioDeselect(fieldset) {
    if (!fieldset || fieldset.dataset.iuAdsBoolToggleWired === "1") return;
    fieldset.dataset.iuAdsBoolToggleWired = "1";
    var radios = fieldset.querySelectorAll('input[type="radio"]');
    var i;
    for (i = 0; i < radios.length; i++) {
      (function (rad) {
        rad.addEventListener("mousedown", function () {
          rad.dataset.iuRadioWasChecked = rad.checked ? "1" : "";
        });
        rad.addEventListener("click", function () {
          if (rad.dataset.iuRadioWasChecked === "1") {
            rad.checked = false;
            rad.dataset.iuRadioWasChecked = "";
          }
        });
      })(radios[i]);
    }
  }

  window.iuAdsSubmitFormWire = function () {
    var cat = $("iuAdsFieldCategory");
    var btn = $("iuAdsAutoVinLoadBtn");
    var titleAuto = $("iuAdsAutoTitle");
    var form = $("iuAdsSubmitForm");

    if (cat && !cat.dataset.iuAdsWired) {
      cat.dataset.iuAdsWired = "1";
      cat.addEventListener("change", onCategoryChange);
    }
    if (btn && !btn.dataset.iuAdsWired) {
      btn.dataset.iuAdsWired = "1";
      btn.addEventListener("click", onVinLoad);
    }
    var vinInpEnter = $("iuAdsAutoVin");
    if (vinInpEnter && !vinInpEnter.dataset.iuAdsVinEnterWired) {
      vinInpEnter.dataset.iuAdsVinEnterWired = "1";
      vinInpEnter.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        onVinLoad();
      });
    }
    if (titleAuto && !titleAuto.dataset.iuAdsWired) {
      titleAuto.dataset.iuAdsWired = "1";
      titleAuto.addEventListener("input", function () {
        autoTitleUserEdited = true;
      });
    }
    if (form && !form.dataset.iuAdsSubmitWired) {
      form.dataset.iuAdsSubmitWired = "1";
      form.addEventListener("submit", function (ev) {
        var c = cat ? String(cat.value || "") : "";
        if (c === AUTO_VAL) {
          ev.preventDefault();
          showAutoPublishFeedback("", false);
          if (autoApiState !== "loaded") {
            showAutoPublishFeedback(
              "Nejdříve zadejte VIN a klikněte na „Načíst údaje o vozidle“.",
              true
            );
            return;
          }
          var otReq = $("iuAdsAutoOfferType");
          if (!otReq || !String(otReq.value || "").trim()) {
            showAutoPublishFeedback("Vyberte typ nabídky.", true);
            try {
              otReq.focus();
            } catch (eOt) {}
            return;
          }
          var vtReq = $("iuAdsAutoVehicleType");
          if (!vtReq || !String(vtReq.value || "").trim()) {
            showAutoPublishFeedback("Vyberte typ vozidla.", true);
            try {
              vtReq.focus();
            } catch (eVt) {}
            return;
          }
          var condReq = $("iuAdsAutoCondition");
          if (!condReq || !String(condReq.value || "").trim()) {
            showAutoPublishFeedback("Vyberte stav vozidla.", true);
            try {
              condReq.focus();
            } catch (eCd) {}
            return;
          }
          var titleA = $("iuAdsAutoTitle");
          if (!titleA || !String(titleA.value || "").trim()) {
            showAutoPublishFeedback("Vyplňte název inzerátu.", true);
            try {
              titleA.focus();
            } catch (f1) {}
            return;
          }
          var priceA = $("iuAdsAutoPrice");
          if (!priceA || !String(priceA.value || "").trim()) {
            showAutoPublishFeedback("Cena je povinná.", true);
            try {
              priceA.focus();
            } catch (f2) {}
            return;
          }
          var emailA = $("iuAdsAutoEmail");
          if (!emailA || !validEmailStr(emailA.value)) {
            showAutoPublishFeedback("Vyplňte platný e-mail.", true);
            try {
              emailA.focus();
            } catch (f3) {}
            return;
          }
          var termsA = $("iuAdsAutoTerms");
          if (!termsA || !termsA.checked) {
            showAutoPublishFeedback("Je potřeba souhlas s podmínkami inzerce.", true);
            return;
          }
          try {
            var n = persistAutoAdLocal();
            showAutoPublishFeedback(
              "Inzerát uložen lokálně (mezistav bez centrálního serveru). Počet záznamů v tomto prohlížeči: " +
                n +
                ".",
              false
            );
          } catch (eSave) {
            showAutoPublishFeedback(
              eSave && eSave.message ? String(eSave.message) : "Uložení selhalo.",
              true
            );
          }
          return;
        } else if (c && c !== AUTO_VAL) {
          var t = $("iuAdsFieldTitle");
          var d = $("iuAdsFieldDesc");
          var terms = $("iuAdsFieldTerms");
          if (!t || !String(t.value || "").trim()) {
            ev.preventDefault();
            return;
          }
          if (!d || !String(d.value || "").trim()) {
            ev.preventDefault();
            return;
          }
          if (!terms || !terms.checked) {
            ev.preventDefault();
            return;
          }
        } else {
          ev.preventDefault();
        }
      });
    }
    var boolNm;
    var boolNames = ["auto_service_book", "auto_accident_free", "auto_first_owner"];
    for (boolNm = 0; boolNm < boolNames.length; boolNm++) {
      var r0 = document.querySelector('input[name="' + boolNames[boolNm] + '"]');
      if (r0 && r0.closest && r0.closest("fieldset")) wireAdsBoolRadioDeselect(r0.closest("fieldset"));
    }
    onCategoryChange();
    window.iuAdsRefreshCategoryUI = applyCategoryUI;
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      try {
        window.iuAdsSubmitFormWire();
      } catch (e) {}
    });
  } else {
    try {
      window.iuAdsSubmitFormWire();
    } catch (e2) {}
  }
})();

// === UI-only cleanup: permanently disable any cached rail-hidden state ===
try { document.body.classList.remove("iu" + "RailHidden"); } catch (e) {}
try { document.documentElement.classList.remove("iu" + "RailHidden"); } catch (e) {}
try { localStorage.removeItem("iuRailHidden"); } catch (e) {}

// === Calendar overlay module (isolated, local-first, Silver API) ===
(function(){
  "use strict";

  const CAL_NS = "iu.calendar";
  const CAL_STYLE_ID = "iu-calendar-overlay-styles";
  const CAL_STYLE_TEXT = ".iu-calendarOverlay{position:fixed;inset:0;z-index:10020;display:none;align-items:center;justify-content:center}.iu-calendarOverlay:not([hidden]){display:flex}.iu-calendarOverlay__backdrop{position:absolute;inset:0;background:rgba(8,14,22,.78)}.iu-calendarOverlay__dialog{position:relative;z-index:1;width:min(1080px,calc(100vw - 28px));height:min(88vh,860px);overflow:hidden;border-radius:12px;background:#f7f9fc;box-shadow:0 20px 52px rgba(7,12,19,.35);display:grid;grid-template-rows:auto 1fr}.iu-calendarOverlay__header{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #d7dfeb;background:#fff}.iu-calendarOverlay__controls,.iu-calendarOverlay__toolbar,.iu-calendarOverlay__formActions{display:flex;align-items:center;gap:8px}.iu-calendarOverlay__viewBtn,.iu-calendarOverlay__close,.iu-calendarOverlay__eventBtn{border:1px solid #c6d2e5;border-radius:8px;background:#eef3fb;color:#203a59;padding:8px 10px;font-size:13px}.iu-calendarOverlay__close{width:38px;height:38px;border:0;font-size:24px;line-height:1;background:#e8eef7;padding:0;touch-action:manipulation}.iu-calendarOverlay__viewBtn.is-active{background:#203a59;color:#fff;border-color:#203a59}.iu-calendarOverlay__body{display:grid;grid-template-columns:minmax(0,1fr) 340px;min-height:0;height:100%}.iu-calendarOverlay__main,.iu-calendarOverlay__side{min-height:0;padding:12px}.iu-calendarOverlay__main{display:flex;flex-direction:column;gap:10px}.iu-calendarOverlay__side{border-left:1px solid #d7dfeb;background:#fff;overflow:auto}.iu-calendarOverlay__toolbar{margin-bottom:0;flex-wrap:wrap}.iu-calendarOverlay__toolbar strong{flex:1}.iu-calendarOverlay__viewRoot{border:1px solid #d2dcea;border-radius:10px;background:#fff;min-height:320px;height:calc(100% - 42px);overflow:auto}.iu-calendarOverlay__form{display:grid;gap:10px}.iu-calendarOverlay__form label{display:grid;gap:4px;font-size:13px;color:#234064}.iu-calendarOverlay__form input,.iu-calendarOverlay__form textarea,.iu-calendarOverlay__form select{width:100%;border:1px solid #c9d7ea;border-radius:8px;padding:10px;font-size:14px}.iu-calendarOverlay__formActions{flex-wrap:wrap}.iu-calendarOverlay__formActions button{flex:1 1 0;min-height:44px;touch-action:manipulation}.iu-calendarOverlay__msg{min-height:16px;font-size:12px;color:#2a4568}.iu-calendarOverlay__eventList{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:6px}.iu-calendarOverlay__eventBtn{width:100%;text-align:left;background:#f4f7fc;border-color:#d0daea;padding:10px}.iu-calGrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;padding:8px}.iu-calDayCell{border:1px solid #d6dfec;border-radius:8px;min-height:88px;padding:6px;background:#fff;font-size:12px;display:block;text-align:left}.iu-calDayCell.is-out{opacity:.45}.iu-calDayCell.is-weekend{background:#f7fbff}.iu-calDayCell.is-today{border-color:#2f9cf4;box-shadow:0 0 0 1px #2f9cf4 inset}.iu-calDayCell.is-selected{border-color:#1f3a5f;box-shadow:0 0 0 2px rgba(31,58,95,.26) inset;background:#eef4ff}.iu-calDayCell.is-holiday{background:#fff8f0}.iu-calDayCell__events{margin-top:6px;display:grid;gap:3px}.iu-calEventDot{border-radius:6px;background:#e7eef9;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.iu-calYear{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:8px}.iu-calYearMonth,.iu-calTimelineItem{border:1px solid #d6dfec;border-radius:8px;padding:10px;background:#fff}.iu-calTimeline{padding:8px;display:grid;gap:8px}.iu-calTimelineItem{display:grid;gap:8px}body.iu-calendarOverlay-open{overflow:hidden!important}@media (max-width:900px){.iu-calendarOverlay{align-items:stretch;justify-content:stretch;overflow-y:auto;-webkit-overflow-scrolling:touch;background:#f7f9fc}.iu-calendarOverlay__backdrop{position:fixed;inset:0;background:rgba(8,14,22,.85)}.iu-calendarOverlay__dialog{width:100vw;min-height:100dvh;height:auto;max-height:none;border-radius:0;overflow:visible;display:flex;flex-direction:column;box-shadow:none;background:#f7f9fc}.iu-calendarOverlay__header{position:relative;top:auto;z-index:1;display:flex;align-items:center;gap:4px;flex-wrap:nowrap}.iu-calendarOverlay__header h2{margin:0;font-size:15px;line-height:1;white-space:nowrap;flex:0 0 auto;display:flex;align-items:center;min-height:34px}.iu-calendarOverlay__controls{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:4px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.iu-calendarOverlay__controls::-webkit-scrollbar{display:none}.iu-calendarOverlay__viewBtn{min-height:34px;padding:6px 6px;font-size:11px;line-height:1;white-space:nowrap;flex:0 0 auto}.iu-calendarOverlay__close{margin-left:auto;min-width:34px;min-height:34px;width:34px;height:34px;flex:0 0 auto}.iu-calendarOverlay__body{display:flex;flex-direction:column;height:auto;min-height:0;overflow:visible!important;flex:1 1 auto;background:#fff}.iu-calendarOverlay__main,.iu-calendarOverlay__side,.iu-calendarOverlay__viewRoot{height:auto!important;max-height:none!important;overflow:visible!important}.iu-calendarOverlay__main{padding:10px 10px 8px;flex:0 0 auto!important;background:#fff;display:flex;flex-direction:column}.iu-calendarOverlay__side{border-left:0;border-top:1px solid #d7dfeb;padding:12px 10px 16px;flex:0 0 auto!important;background:#fff}.iu-calendarOverlay__viewRoot{display:block;width:100%;min-height:320px!important}.iu-calendarOverlay__viewRoot[data-view='week'],.iu-calendarOverlay__viewRoot[data-view='year']{min-height:auto!important;height:auto!important;max-height:none!important;overflow:visible!important}.iu-calendarOverlay__viewRoot[data-view='week'] .iu-calTimeline,.iu-calendarOverlay__viewRoot[data-view='year'] .iu-calYear{margin-bottom:0;padding-bottom:0}.iu-calendarOverlay__form{order:1}.iu-calendarOverlay__formActions{gap:10px;position:relative}.iu-calendarOverlay__formActions button{min-height:48px;font-size:15px;position:relative}.iu-calendarOverlay__listWrap{order:2}.iu-calTimeline{padding:6px}.iu-calGrid{padding:6px;gap:6px}.iu-calDayCell{min-height:84px}.iu-calYear{grid-template-columns:repeat(2,minmax(0,1fr));padding:6px}}@media (max-width:640px){.iu-calendarOverlay__header h2{font-size:14px;min-height:32px}.iu-calendarOverlay__viewBtn{min-height:32px;padding:6px 5px;font-size:10px}.iu-calendarOverlay__close{min-width:32px;min-height:32px;width:32px;height:32px}.iu-calendarOverlay__toolbar button{min-height:42px}.iu-calendarOverlay__formActions button{flex:1 1 100%}.iu-calYear{grid-template-columns:1fr}.iu-calDayCell{min-height:72px;font-size:11px}}";
  const SCHEMA_VERSION = 1;
  const STORE_KEY = CAL_NS + ".store.v1";
  const MAX_ATTACHMENTS = 4;
  const MAX_IMAGE_EDGE = 1600;
  const MAX_IMAGE_BYTES = 420000;
  const ALLOWED_VIEWS = new Set(["day", "week", "month", "year"]);
  const FOCUSABLE_SELECTOR = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

  const CZ_FIXED_HOLIDAYS = new Set([
    "01-01","05-01","05-08","07-05","07-06","09-28","10-28","11-17","12-24","12-25","12-26"
  ]);

  const state = {
    inited: false,
    dbReady: false,
    db: null,
    data: { schemaVersion: SCHEMA_VERSION, events: [] },
    selectedDate: toDateOnly(new Date()),
    view: "month",
    cursorDate: toDateOnly(new Date()),
    returnFocusEl: null,
    currentEditId: "",
    trapAttached: false
  };

  function uid(prefix){ return prefix + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function ensureStyles(){
    try{
      if (document.getElementById(CAL_STYLE_ID)) return;
      const st = document.createElement("style");
      st.id = CAL_STYLE_ID;
      st.textContent = CAL_STYLE_TEXT;
      document.head.appendChild(st);
    }catch{}
  }
  function pad(n){ return String(n).padStart(2, "0"); }
  function toDateOnly(d){ const x = new Date(d); return x.getFullYear() + "-" + pad(x.getMonth()+1) + "-" + pad(x.getDate()); }
  function toTimeOnly(d){ const x = new Date(d); return pad(x.getHours()) + ":" + pad(x.getMinutes()); }
  function parseDateTime(date, time){ return new Date(date + "T" + (time || "00:00") + ":00"); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, (m)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m])); }
  function compareEvents(a, b){ return (a.date + "T" + a.time).localeCompare(b.date + "T" + b.time); }
  function addDays(dateStr, days){ const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + days); return toDateOnly(d); }
  function startOfWeek(dateStr){ const d = new Date(dateStr + "T00:00:00"); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return toDateOnly(d); }
  function sameYMD(a, b){ return String(a) === String(b); }

  function isHoliday(dateStr){
    const d = new Date(dateStr + "T00:00:00");
    const mmdd = pad(d.getMonth()+1) + "-" + pad(d.getDate());
    if (CZ_FIXED_HOLIDAYS.has(mmdd)) return true;
    const year = d.getFullYear();
    const easter = getEasterDate(year);
    const goodFriday = addDays(toDateOnly(easter), -2);
    const easterMonday = addDays(toDateOnly(easter), 1);
    return sameYMD(dateStr, goodFriday) || sameYMD(dateStr, easterMonday);
  }

  function getEasterDate(year){
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  function sanitizeEvent(evt){
    if (!evt || typeof evt !== "object") return null;
    const safe = {
      id: String(evt.id || uid("evt")),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(evt.date || "")) ? String(evt.date) : toDateOnly(new Date()),
      time: /^\d{2}:\d{2}$/.test(String(evt.time || "")) ? String(evt.time) : "09:00",
      title: String(evt.title || "").trim().slice(0, 120),
      note: String(evt.note || "").trim().slice(0, 1000),
      type: ["personal", "work", "health", "other"].includes(String(evt.type || "")) ? String(evt.type) : "personal",
      attachments: Array.isArray(evt.attachments) ? evt.attachments.filter(sanitizeAttachment).slice(0, MAX_ATTACHMENTS) : [],
      createdAt: Number.isFinite(Number(evt.createdAt)) ? Number(evt.createdAt) : Date.now(),
      updatedAt: Number.isFinite(Number(evt.updatedAt)) ? Number(evt.updatedAt) : Date.now()
    };
    if (!safe.title) return null;
    return safe;
  }

  function sanitizeAttachment(a){
    if (!a || typeof a !== "object") return null;
    if (a.kind !== "image") return null;
    if (typeof a.data !== "string" || !a.data.startsWith("data:image/")) return null;
    const size = Number(a.size) || 0;
    if (size <= 0 || size > MAX_IMAGE_BYTES) return null;
    return {
      id: String(a.id || uid("att")),
      kind: "image",
      mimeType: String(a.mimeType || "image/jpeg"),
      data: a.data,
      width: Math.max(1, Number(a.width) || 1),
      height: Math.max(1, Number(a.height) || 1),
      size,
      createdAt: Number.isFinite(Number(a.createdAt)) ? Number(a.createdAt) : Date.now()
    };
  }

  async function initStorage(){
    try{
      const req = indexedDB.open(CAL_NS + ".idb", 1);
      await new Promise((resolve, reject)=>{
        req.onupgradeneeded = function(){
          const db = req.result;
          if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        };
        req.onsuccess = ()=>resolve();
        req.onerror = ()=>reject(req.error || new Error("IDB open failed"));
      });
      state.db = req.result;
      state.dbReady = true;
    }catch{
      state.dbReady = false;
    }
  }

  async function readStore(){
    let raw = "";
    if (state.dbReady && state.db){
      try{
        raw = await new Promise((resolve, reject)=>{
          const tx = state.db.transaction("meta", "readonly");
          const st = tx.objectStore("meta");
          const rq = st.get(STORE_KEY);
          rq.onsuccess = ()=>resolve(String(rq.result || ""));
          rq.onerror = ()=>reject(rq.error);
        });
      }catch{}
    }
    if (!raw){
      try{ raw = String(localStorage.getItem(STORE_KEY) || ""); }catch{}
    }
    let parsed = null;
    try{ parsed = raw ? JSON.parse(raw) : null; }catch{}
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.events)){
      state.data = { schemaVersion: SCHEMA_VERSION, events: [] };
      await writeStore();
      return;
    }
    const clean = parsed.events.map(sanitizeEvent).filter(Boolean).sort(compareEvents);
    state.data = { schemaVersion: SCHEMA_VERSION, events: clean };
  }

  async function writeStore(){
    const payload = JSON.stringify({ schemaVersion: SCHEMA_VERSION, events: state.data.events });
    try{ localStorage.setItem(STORE_KEY, payload); }catch{}
    if (state.dbReady && state.db){
      try{
        await new Promise((resolve, reject)=>{
          const tx = state.db.transaction("meta", "readwrite");
          tx.objectStore("meta").put(payload, STORE_KEY);
          tx.oncomplete = ()=>resolve();
          tx.onerror = ()=>reject(tx.error);
        });
      }catch{}
    }
  }

  function getEventsForDate(date){ return state.data.events.filter((e)=>e.date === date).sort(compareEvents); }
  function setMessage(msg){ const el = document.getElementById("iuCalendarFormMsg"); if (el) el.textContent = msg || ""; }
  function getOverlay(){ return document.getElementById("iuCalendarOverlay"); }

  function openOverlay(originEl){
    const ov = getOverlay();
    if (!ov) return;
    state.returnFocusEl = originEl || document.activeElement;
    ov.hidden = false;
    ov.setAttribute("aria-hidden", "false");
    document.body.classList.add("iu-calendarOverlay-open");
    render();
    attachFocusTrap();
    const first = ov.querySelector(FOCUSABLE_SELECTOR);
    if (first) try{ first.focus({ preventScroll: true }); }catch{}
  }

  function closeOverlay(){
    const ov = getOverlay();
    if (!ov) return;
    ov.hidden = true;
    ov.setAttribute("aria-hidden", "true");
    document.body.classList.remove("iu-calendarOverlay-open");
    detachFocusTrap();
    if (state.returnFocusEl && typeof state.returnFocusEl.focus === "function"){
      const el = state.returnFocusEl;
      try{ el.focus({ preventScroll: true }); }catch{
        try{ el.focus(); }catch{}
      }
      // Some pages restore focus to BODY on Escape; retry on next tick.
      try{ setTimeout(() => { try{ el.focus({ preventScroll: true }); }catch{ try{ el.focus(); }catch{} } }, 0); }catch{}
    }
  }

  function attachFocusTrap(){
    if (state.trapAttached) return;
    state.trapAttached = true;
    document.addEventListener("keydown", onGlobalKeyDown, true);
  }
  function detachFocusTrap(){
    if (!state.trapAttached) return;
    state.trapAttached = false;
    document.removeEventListener("keydown", onGlobalKeyDown, true);
  }

  function onGlobalKeyDown(e){
    const ov = getOverlay();
    if (!ov || ov.hidden) return;
    if (e.key === "Escape"){ e.preventDefault(); closeOverlay(); return; }
    if (e.key !== "Tab") return;
    const list = Array.from(ov.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el)=>!el.disabled && el.offsetParent !== null);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }

  function render(){
    renderViewButtons();
    renderPeriodLabel();
    renderView();
    renderDayList();
    hydrateFormFromCurrent();
  }

  function renderViewButtons(){
    document.querySelectorAll("[data-iu-cal-view]").forEach((btn)=>{
      const active = btn.getAttribute("data-iu-cal-view") === state.view;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function renderPeriodLabel(){
    const el = document.getElementById("iuCalendarPeriodLabel");
    if (!el) return;
    const d = new Date(state.cursorDate + "T00:00:00");
    if (state.view === "day") el.textContent = d.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    else if (state.view === "week"){ const s = startOfWeek(state.cursorDate); const e = addDays(s, 6); el.textContent = s + " až " + e; }
    else if (state.view === "month") el.textContent = d.toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });
    else el.textContent = String(d.getFullYear());
  }

  function renderView(){
    const root = document.getElementById("iuCalendarViewRoot");
    if (!root) return;
    try { root.setAttribute("data-view", state.view); } catch {}
    if (state.view === "day") root.innerHTML = renderTimeline([state.cursorDate]);
    else if (state.view === "week"){
      const s = startOfWeek(state.cursorDate);
      root.innerHTML = renderTimeline(Array.from({ length: 7 }, (_, i)=>addDays(s, i)));
    } else if (state.view === "month") root.innerHTML = renderMonthGrid(state.cursorDate);
    else root.innerHTML = renderYearGrid(new Date(state.cursorDate + "T00:00:00").getFullYear());
    root.querySelectorAll("[data-iu-cal-select-date]").forEach((el)=>el.addEventListener("click", ()=>{ state.selectedDate = el.getAttribute("data-iu-cal-select-date") || state.selectedDate; state.cursorDate = state.selectedDate; render(); }));
    root.querySelectorAll("[data-iu-cal-open-event]").forEach((el)=>el.addEventListener("click", ()=>loadEventForEdit(el.getAttribute("data-iu-cal-open-event") || "")));
  }

  function renderTimeline(days){
    let html = '<div class="iu-calTimeline">';
    days.forEach((day)=>{
      const items = getEventsForDate(day);
      html += `<article class="iu-calTimelineItem"><strong>${esc(day)}</strong>`;
      if (!items.length) html += '<div>Bez událostí</div>';
      else items.forEach((ev)=>{ html += `<button type="button" class="iu-calendarOverlay__eventBtn" data-iu-cal-open-event="${esc(ev.id)}">${esc(ev.time)} · ${esc(ev.title)}</button>`; });
      html += "</article>";
    });
    html += "</div>";
    return html;
  }

  function renderMonthGrid(dateStr){
    const pivot = new Date(dateStr + "T00:00:00");
    const year = pivot.getFullYear();
    const month = pivot.getMonth();
    const first = new Date(year, month, 1);
    const firstWeekday = (first.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - firstWeekday);
    let html = '<div class="iu-calGrid">';
    for (let i = 0; i < 42; i++){
      const d = new Date(start); d.setDate(start.getDate() + i);
      const ds = toDateOnly(d);
      const isOut = d.getMonth() !== month;
      const isToday = ds === toDateOnly(new Date());
      const wk = d.getDay();
      const weekend = wk === 0 || wk === 6;
      const holiday = isHoliday(ds);
      const items = getEventsForDate(ds).slice(0, 2);
      const isSelected = ds === state.selectedDate;      html += `<button type="button" class="iu-calDayCell${isOut ? " is-out" : ""}${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}${weekend ? " is-weekend" : ""}${holiday ? " is-holiday" : ""}" data-iu-cal-select-date="${esc(ds)}"><div>${d.getDate()}</div><div class="iu-calDayCell__events">${items.map((ev)=>`<div class="iu-calEventDot">${esc(ev.time)} ${esc(ev.title)}</div>`).join("")}</div></button>`;
    }
    html += "</div>";
    return html;
  }

  function renderYearGrid(year){
    let html = '<div class="iu-calYear">';
    for (let m = 0; m < 12; m++){
      const d = new Date(year, m, 1);
      html += `<button type="button" class="iu-calYearMonth" data-iu-cal-select-date="${year}-${pad(m+1)}-01">${esc(d.toLocaleDateString("cs-CZ", { month: "long" }))}<div>${getEventsForMonth(year, m)} událostí</div></button>`;
    }
    html += "</div>";
    return html;
  }
  function getEventsForMonth(year, month){ return state.data.events.filter((e)=>{ const d = new Date(e.date + "T00:00:00"); return d.getFullYear() === year && d.getMonth() === month; }).length; }

  function renderDayList(){
    const list = document.getElementById("iuCalendarDayEvents");
    if (!list) return;
    const items = getEventsForDate(state.selectedDate);
    list.innerHTML = items.map((ev)=>`<li><button type="button" class="iu-calendarOverlay__eventBtn" data-iu-cal-open-event="${esc(ev.id)}">${esc(ev.time)} · ${esc(ev.title)}</button></li>`).join("") || "<li>Bez událostí</li>";
    list.querySelectorAll("[data-iu-cal-open-event]").forEach((el)=>el.addEventListener("click", ()=>loadEventForEdit(el.getAttribute("data-iu-cal-open-event") || "")));
  }

  function hydrateFormFromCurrent(){
    const form = document.getElementById("iuCalendarEventForm");
    if (!form) return;
    const evt = state.currentEditId ? state.data.events.find((e)=>e.id === state.currentEditId) : null;
    form.elements.id.value = evt ? evt.id : "";
    form.elements.date.value = evt ? evt.date : state.selectedDate;
    form.elements.time.value = evt ? evt.time : "09:00";
    form.elements.title.value = evt ? evt.title : "";
    form.elements.note.value = evt ? evt.note : "";
    form.elements.type.value = evt ? evt.type : "personal";
    renderAttachmentChips(evt ? evt.attachments : []);
  }

  function renderAttachmentChips(atts){
    const el = document.getElementById("iuCalendarPhotoList");
    if (!el) return;
    el.innerHTML = (atts || []).map((a)=>`<span class="iu-calendarOverlay__photoChip">${esc(a.mimeType)} · ${Math.round(a.size / 1024)}kB <button type="button" data-iu-cal-remove-att="${esc(a.id)}">Smazat</button></span>`).join("");
    el.querySelectorAll("[data-iu-cal-remove-att]").forEach((btn)=>btn.addEventListener("click", ()=>removeAttachment(btn.getAttribute("data-iu-cal-remove-att") || "")));
  }

  function loadEventForEdit(id){ const ev = state.data.events.find((e)=>e.id === id); if (!ev) return; state.currentEditId = id; state.selectedDate = ev.date; state.cursorDate = ev.date; setMessage(""); render(); }
  async function removeAttachment(attId){
    if (!state.currentEditId) return;
    const ev = state.data.events.find((e)=>e.id === state.currentEditId);
    if (!ev) return;
    if (!confirm("Opravdu odstranit fotku?")) return;
    ev.attachments = ev.attachments.filter((a)=>a.id !== attId);
    ev.updatedAt = Date.now();
    await writeStore();
    render();
  }

  async function upsertEventFromForm(){
    const form = document.getElementById("iuCalendarEventForm");
    if (!form) return;
    const id = String(form.elements.id.value || "");
    const base = sanitizeEvent({
      id: id || uid("evt"),
      date: form.elements.date.value,
      time: form.elements.time.value,
      title: form.elements.title.value,
      note: form.elements.note.value,
      type: form.elements.type.value,
      attachments: id ? (state.data.events.find((e)=>e.id === id)?.attachments || []) : [],
      createdAt: id ? (state.data.events.find((e)=>e.id === id)?.createdAt || Date.now()) : Date.now(),
      updatedAt: Date.now()
    });
    if (!base){ setMessage("Vyplňte název, datum a čas."); return; }
    const idx = state.data.events.findIndex((e)=>e.id === base.id);
    if (idx >= 0) state.data.events[idx] = base;
    else state.data.events.push(base);
    state.data.events.sort(compareEvents);
    state.currentEditId = base.id;
    state.selectedDate = base.date;
    state.cursorDate = base.date;
    await writeStore();
    setMessage("Uloženo.");
    render();
  }

  async function deleteCurrentEvent(){
    if (!state.currentEditId){ setMessage("Vyberte událost."); return; }
    if (!confirm("Smazat událost?")) return;
    state.data.events = state.data.events.filter((e)=>e.id !== state.currentEditId);
    state.currentEditId = "";
    await writeStore();
    setMessage("Smazáno.");
    render();
  }

  async function handlePhotoAdd(files){
    if (!state.currentEditId){ setMessage("Nejdřív uložte událost, pak přidejte fotky."); return; }
    const ev = state.data.events.find((e)=>e.id === state.currentEditId);
    if (!ev) return;
    const list = Array.from(files || []);
    for (const file of list){
      if (ev.attachments.length >= MAX_ATTACHMENTS){ setMessage("Maximálně " + MAX_ATTACHMENTS + " fotky na událost."); break; }
      try{
        const att = await optimizeImage(file);
        ev.attachments.push(att);
      }catch(err){
        setMessage(String(err && err.message ? err.message : "Fotku se nepodařilo zpracovat."));
      }
    }
    ev.updatedAt = Date.now();
    await writeStore();
    render();
  }

  async function optimizeImage(file){
    if (!file || !String(file.type || "").startsWith("image/")) throw new Error("Povoleny jsou jen obrázky.");
    const img = await fileToImage(file);
    const ratio = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * ratio));
    const h = Math.max(1, Math.round(img.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Nelze zpracovat obrázek.");
    ctx.drawImage(img, 0, 0, w, h);
    let quality = 0.82;
    let data = canvas.toDataURL("image/jpeg", quality);
    while (estimateBase64Bytes(data) > MAX_IMAGE_BYTES && quality > 0.5){
      quality -= 0.08;
      data = canvas.toDataURL("image/jpeg", quality);
    }
    const size = estimateBase64Bytes(data);
    if (size > MAX_IMAGE_BYTES) throw new Error("Optimalizovaná fotka je stále příliš velká.");
    return { id: uid("att"), kind: "image", mimeType: "image/jpeg", data, width: w, height: h, size, createdAt: Date.now() };
  }
  function estimateBase64Bytes(data){ const b64 = String(data.split(",")[1] || ""); return Math.floor((b64.length * 3) / 4); }
  function fileToImage(file){
    return new Promise((resolve, reject)=>{
      const fr = new FileReader();
      fr.onerror = ()=>reject(new Error("Soubor nelze číst."));
      fr.onload = ()=>{
        const img = new Image();
        img.onload = ()=>resolve(img);
        img.onerror = ()=>reject(new Error("Soubor není validní obrázek."));
        img.src = String(fr.result || "");
      };
      fr.readAsDataURL(file);
    });
  }

  function navPeriod(delta){
    const d = new Date(state.cursorDate + "T00:00:00");
    if (state.view === "day") d.setDate(d.getDate() + delta);
    else if (state.view === "week") d.setDate(d.getDate() + (7 * delta));
    else if (state.view === "month") d.setMonth(d.getMonth() + delta, 1);
    else d.setFullYear(d.getFullYear() + delta, 0, 1);
    state.cursorDate = toDateOnly(d);
    render();
  }

  function getTodayEvents(){ return getEventsForDate(toDateOnly(new Date())); }
  function getTomorrowEvents(){ return getEventsForDate(addDays(toDateOnly(new Date()), 1)); }
  function getNextEvent(){
    const now = new Date();
    const sorted = state.data.events.slice().sort(compareEvents);
    return sorted.find((e)=>parseDateTime(e.date, e.time).getTime() >= now.getTime()) || null;
  }

  function bindUi(){
    const overlay = getOverlay();
    if (!overlay) return;
    document.addEventListener("click", (e)=>{
      const t = e.target;
      const trigger = t && t.closest ? t.closest("[data-iu-calendar-trigger]") : null;
      const mmCalTrigger = t && t.closest ? t.closest(".iu-mmTopTool--cal") : null;
      if (trigger || mmCalTrigger){
        e.preventDefault();
        openOverlay((trigger || mmCalTrigger));
        return;
      }
      const close = t && t.closest ? t.closest("[data-iu-calendar-close]") : null;
      if (close){ e.preventDefault(); closeOverlay(); return; }
      const viewBtn = t && t.closest ? t.closest("[data-iu-cal-view]") : null;
      if (viewBtn){ const v = String(viewBtn.getAttribute("data-iu-cal-view") || ""); if (ALLOWED_VIEWS.has(v)){ state.view = v; render(); } return; }
      const navBtn = t && t.closest ? t.closest("[data-iu-cal-nav]") : null;
      if (navBtn){ navPeriod(Number(navBtn.getAttribute("data-iu-cal-nav") || 0)); return; }
      if (t && t.closest && t.closest("[data-iu-cal-today]")){ state.cursorDate = toDateOnly(new Date()); state.selectedDate = state.cursorDate; render(); return; }
      if (t && t.closest && t.closest("[data-iu-cal-delete]")){ deleteCurrentEvent(); return; }
      if (t && t.closest && t.closest("[data-iu-cal-reset]")){ state.currentEditId = ""; setMessage(""); hydrateFormFromCurrent(); return; }
    });
    const form = document.getElementById("iuCalendarEventForm");
    if (form){ form.addEventListener("submit", (e)=>{ e.preventDefault(); upsertEventFromForm(); }); }
    const photoInput = document.getElementById("iuCalendarPhotoInput");
    if (photoInput){ photoInput.addEventListener("change", ()=>handlePhotoAdd(photoInput.files)); }
  }

  async function init(){
    if (state.inited) return;
    state.inited = true;
    ensureStyles();
    await initStorage();
    await readStore();
    bindUi();
    render();
    window.iuCalendarService = {
      calendarCreateEvent: async function(payload){
        const ev = sanitizeEvent({ ...payload, id: uid("evt"), createdAt: Date.now(), updatedAt: Date.now(), attachments: Array.isArray(payload?.attachments) ? payload.attachments : [] });
        if (!ev) return { ok: false, reason: "validation_failed" };
        state.data.events.push(ev);
        state.data.events.sort(compareEvents);
        await writeStore();
        render();
        return { ok: true, event: ev };
      },
      calendarGetTodayEvents: function(){ return getTodayEvents(); },
      calendarGetTomorrowEvents: function(){ return getTomorrowEvents(); },
      calendarGetNextEvent: function(){ return getNextEvent(); },
      parseAndCreateFromText: async function(text){
        const eng = window.iuSilverCalendarEngine;
        if (!eng || typeof eng.processUserTurn !== "function") return { ok: false, reason: "iuSilverCalendarEngine_unavailable" };
        const draft = eng.createEmptyDraft();
        const turn = eng.processUserTurn(text, draft, { now: new Date(), expectNoteInput: false });
        if (turn.processingState !== "READY_TO_SAVE"){
          return { ok: false, reason: turn.processingState, missingFields: turn.missingFields, detail: turn };
        }
        const d = turn.draft;
        const noteParts = [];
        if (d.note) noteParts.push(d.note);
        if (d.location) noteParts.push("Místo: " + d.location);
        const noteJoined = noteParts.join("\n\n").slice(0, 1000);
        return this.calendarCreateEvent({ date: d.date, time: d.time, title: d.title, note: noteJoined, type: "personal", attachments: [] });
      },
      openOverlay: function(){ openOverlay(document.activeElement); },
      closeOverlay: function(){ closeOverlay(); }
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
