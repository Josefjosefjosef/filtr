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

if (new URLSearchParams(location.search || "").get("debug") === "1") {
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

  function iuBasePath() {
    const p = location.pathname.toLowerCase();
    if (p.includes("/filtr/")) return "/filtr/projects/";
    if (p.includes("/projects/")) return "/projects/";
    return "/projects/";
  }

  function iuDataUrl(file) {
    return iuBasePath() + "data/" + file;
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
  const isDebugLogging = location.search.includes("debug=1");

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
  const IU_ENABLE_NAMEDAY = false; // hard off: no request, no DOM update
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
    location.search.includes("debug=1") || localStorage.getItem("iu_debug") === "1";
  if (location.search.includes("debug=1")) {
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
          return node.id === "iuDebugBox" || node.id === "iuLayoutShiftBox";
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
                        lbl.indexOf("iuLayoutShiftBox") === -1
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
    if (Date.now() - t > maxAgeMs) throw new Error("STALE_FEED");
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
    const iuDebug = Boolean(location.search.includes("debug=1"));
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
    const iuDebug = Boolean(location.search.includes("debug=1"));
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

    const iuDebug = Boolean(location.search.includes("debug=1"));
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
      renderEmpty("Žádné články k zobrazení. Zkontroluj Stav dat.");
      return;
    }

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
      // keep diag count roughly aligned (best-effort)
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
      persistLastError("Invariant breach: state.cachedItems není pole");
      renderInlineError("Obsah dočasně nedostupný.");
      return;
    }
    for (const it of state.cachedItems) {
      if (!it || !it.contentType) {
        persistLastError("Invariant breach: položka bez contentType");
        renderInlineError("Obsah dočasně nedostupný.");
        break;
      }
    }
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
    const primaryPart = `<span class="iu-meta-src">Zdroj: <a class="iu-meta-link" href="${escapeHtml(primary.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(primary.name)}</a></span>`;

    const othersPart = others.length
      ? `<span class="iu-meta-others">Píší také: ${others.map(o =>
          `<a class="iu-meta-link iu-meta-link-secondary" href="${escapeHtml(o.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(o.name)}</a>`
        ).join(", ")}</span>`
      : "";

    const sep = datePart ? `<span class="iu-meta-sep"> | </span>` : "";
    const sep2 = othersPart ? `<span class="iu-meta-sep"> | </span>` : "";

    return `<div class="iu-meta-line">${datePart}${sep}${primaryPart}${sep2}${othersPart}</div>`;
  }

  function buildArticleHtml(it) {
    const title = safeText(it.title || it.name || "(bez názvu)");
    const linkUrl =
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
    
    const titleMarkup = linkUrl
      ? `<a class="news-titleLink iuCardTitle" href="${linkUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
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

      if (!btn || !overlay || !form || !input || !dayInfo) return;

      let isOpen = false;
      let scrollHidden = false;
      let scrollTimer = 0;

      function setDayHidden(hidden){
        try{ dayInfo.classList.toggle("iuTopbarDayInfo--hidden", !!hidden); }catch{}
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
          // v3: topbar today is a structured component; keep its children intact.
          if (dayInfo && dayInfo.id === "iuTopbarToday") return;
          const dateStr = fmtDateNow();
          const namedayStr = readNamedayFromUI();
          const full = namedayStr ? `${dateStr} · ${namedayStr}` : dateStr;
          dayInfo.textContent = full;
          // tooltip: always keep full text available even when CSS truncates
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

  function iuInitLeftEdgeOverlayToggle(){
    const overlay = document.getElementById("iuLeftEdgeOverlay");
    const rail = document.getElementById("iuLeftRail");
    const tip = document.getElementById("iuLeftEdgeTooltip");
    if(!overlay || !rail) return;

    function isCollapsed(){
      return document.body.classList.contains("iu-leftRail-collapsed");
    }
    function setTipText(){
      if(!tip) return;
      tip.textContent = isCollapsed() ? "Zobrazit navigaci" : "Skrýt navigaci";
      tip.setAttribute("aria-hidden", "false");
    }
    function showTip(){
      if(!tip) return;
      tip.classList.add("is-visible");
    }
    function hideTip(){
      if(!tip) return;
      tip.classList.remove("is-visible");
      tip.setAttribute("aria-hidden", "true");
    }
    function positionTip(clientX, clientY){
      if(!tip) return;
      const pad = 12;
      let x = clientX + pad;
      let y = clientY + pad;
      const w = tip.offsetWidth || 120;
      const h = tip.offsetHeight || 28;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if(x + w > vw) x = vw - w - 4;
      if(y + h > vh) y = vh - h - 4;
      if(x < 4) x = 4;
      if(y < 4) y = 4;
      tip.style.transform = "translate(" + x + "px, " + y + "px)";
    }

    function updateWidth(){
      const rect = rail.getBoundingClientRect();
      const gap = Math.max(0, Math.floor(rect.left));
      overlay.style.width = gap + "px";
    }

    window.addEventListener("resize", updateWidth);
    window.addEventListener("load", updateWidth);
    setTimeout(updateWidth, 500);

    overlay.addEventListener("mouseenter", (e) => {
      setTipText();
      positionTip(e.clientX, e.clientY);
      showTip();
    });
    overlay.addEventListener("mouseleave", hideTip);
    overlay.addEventListener("mousemove", (e) => {
      positionTip(e.clientX, e.clientY);
    });

    overlay.addEventListener("click", () => {
      document.body.classList.toggle("iu-leftRail-collapsed");
      overlay.setAttribute("aria-pressed", isCollapsed() ? "true" : "false");
      setTipText();
    });
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

      function fmtDateNow(){
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
        try{ elDate.textContent = fmtDateNow(); }catch{}
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
      el.textContent = `Poslední chyba: ${message}`;
    }
    const inline = document.getElementById("lastErrInline");
    if (inline) {
      inline.textContent = `Poslední chyba: ${message}`;
      inline.style.display = "block";
    }
    if (message) console.error("[ERR]", message);
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

  const IU_WEATHER_CITY_KEY = "iuWeatherCity"; // legacy JSON: { name, lat, lon }
  const IU_WEATHER_CITY_PIN_KEY = "iuWeatherCityPinned"; // "1" | "0"
  const IU_WEATHER_CITY_SELECTED_KEY = "iuWeatherCitySelectedV1"; // JSON: { name, lat, lon }

  const IU_WEATHER_DEFAULT_CITY = { name: "Praha", lat: 50.0755, lon: 14.4378 };

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

  function iuWeatherReadPinned(){
    try{
      const pinned = String(localStorage.getItem(IU_WEATHER_CITY_PIN_KEY) || "0");
      if (pinned !== "1") return null;
      // preferred: new selected key
      try{
        const rawNew = localStorage.getItem(IU_WEATHER_CITY_SELECTED_KEY);
        if (rawNew) {
          const o = JSON.parse(rawNew);
          const name = String(o && o.name || "").trim();
          const lat = Number(o && o.lat);
          const lon = Number(o && o.lon);
          if (name && isFinite(lat) && isFinite(lon)) return { name, lat, lon };
        }
      }catch{}

      // legacy: pinned payload in IU_WEATHER_CITY_KEY
      try{
        const raw = localStorage.getItem(IU_WEATHER_CITY_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        const name = String(obj && obj.name || "").trim();
        const lat = Number(obj && obj.lat);
        const lon = Number(obj && obj.lon);
        if (!name || !isFinite(lat) || !isFinite(lon)) return null;
        return { name, lat, lon };
      }catch{}

      return null;
    }catch{
      return null;
    }
  }

  function iuWeatherWritePinned(pinned){
    try{ localStorage.setItem(IU_WEATHER_CITY_PIN_KEY, pinned ? "1" : "0"); }catch{}
  }

  function iuWeatherReadSelected(){
    try{
      const raw = localStorage.getItem(IU_WEATHER_CITY_SELECTED_KEY);
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

  function iuWeatherWriteSelected(city){
    try{
      localStorage.setItem(IU_WEATHER_CITY_SELECTED_KEY, JSON.stringify({
        name: String(city && city.name || "").trim(),
        lat: Number(city && city.lat),
        lon: Number(city && city.lon),
      }));
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
    return iuWeatherGetRuntime() || iuWeatherReadPinned() || iuWeatherReadSelected() || IU_WEATHER_DEFAULT_CITY;
  }

  function iuWeatherSetRuntime(city){
    try{ window.__iuWeatherRuntimeCity = { name: city.name, lat: city.lat, lon: city.lon }; }catch{}
  }

  const __iuOpenMeteoCache = new Map(); // key -> { t, data, p }
  function iuOpenMeteoUrl(lat, lon){
    const la = Number(lat);
    const lo = Number(lon);
    return (
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${encodeURIComponent(String(la))}&longitude=${encodeURIComponent(String(lo))}` +
      "&current=temperature_2m,weather_code" +
      "&hourly=temperature_2m,weather_code" +
      "&daily=temperature_2m_max,temperature_2m_min,weather_code" +
      "&timezone=Europe%2FPrague"
    );
  }
  async function iuFetchOpenMeteo(lat, lon){
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

  function iuWxIconFromCode(code){
    const c = Number(code);
    if (c === 0) return "☀️";
    if (c === 1 || c === 2) return "🌤";
    if (c === 3) return "☁️";
    if (c >= 45 && c <= 48) return "🌫";
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return "🌧";
    if (c >= 71 && c <= 77) return "❄️";
    if (c >= 95) return "⛈";
    return "🌤";
  }

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
      const h1 = document.getElementById("iuWeatherCityH1");
      const my = document.getElementById("iuWeatherMyCityName");
      if (h1) h1.textContent = city && city.name ? String(city.name) : "Praha";
      if (my) my.textContent = city && city.name ? String(city.name) : "Praha";
    }catch{}
  }

  function iuWeatherSyncPinnedToggle(){
    try{
      const el = document.getElementById("iuWeatherCityPinned");
      if (!el) return;
      const pinned = String(localStorage.getItem(IU_WEATHER_CITY_PIN_KEY) || "0") === "1";
      el.checked = pinned;
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
      const icon = iuWxIconFromCode(code);
      const temps = `${iuFmtDegShort(max)} / ${iuFmtDegShort(min)}`;
      row.innerHTML = `<div class="iuWx7DayName">${escapeHtml(dayName)}</div><div class="iuWx7Icon">${escapeHtml(icon)}</div><div class="iuWx7Temps">${escapeHtml(temps)}</div>`;
      row.removeAttribute("aria-hidden");
    }
  }

  function iuWeatherUpdateHours(hourly){
    const elHours = document.getElementById("iuWxHours");
    if (!elHours) return;
    const slots = Array.from(elHours.querySelectorAll(".iuWxHour"));
    const now = new Date();
    const times = hourly && Array.isArray(hourly.time) ? hourly.time : [];
    const temps = hourly && Array.isArray(hourly.temperature_2m) ? hourly.temperature_2m : [];
    const codes = hourly && Array.isArray(hourly.weather_code) ? hourly.weather_code : [];
    const items = [];
    for (let i = 0; i < times.length; i++){
      const dt = new Date(times[i]);
      if (isNaN(dt.getTime())) continue;
      if (dt < now) continue;
      items.push({ d: dt, temp: temps[i], code: codes[i] });
      if (items.length >= 6) break;
    }
    for (let i = 0; i < slots.length; i++){
      const slot = slots[i];
      const it = items[i];
      if (!slot) continue;
      if (it) {
        let hh = "--h";
        try{ hh = new Intl.DateTimeFormat("cs-CZ",{hour:"numeric",hour12:false,timeZone:"Europe/Prague"}).format(it.d) + "h"; }catch{}
        slot.innerHTML = `<div>${escapeHtml(hh)}</div><div class="iuWxHourTemp">${escapeHtml(iuFmtDegShort(it.temp))}</div><div>${escapeHtml(iuWxIconFromCode(it.code))}</div>`;
        slot.removeAttribute("aria-hidden");
      } else {
        slot.innerHTML = `<div>--h</div><div class="iuWxHourTemp">—</div><div>🌤</div>`;
        slot.setAttribute("aria-hidden", "true");
      }
    }
    try{ elHours.classList.remove("iuWxHours--skeleton"); }catch{}
  }

  function iuWeatherEnsureCitySheet(){
    let overlay = document.getElementById("iuWeatherSheetOverlay");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "iuWeatherSheetOverlay";
    overlay.hidden = true;
    overlay.className = "iuWeatherSheetOverlay";
    overlay.innerHTML = `
      <div class="iuWeatherSheet" role="dialog" aria-modal="true" aria-label="Vybrat město">
        <div class="iuWeatherSheetHead">
          <div class="iuWeatherSheetTitle">Moje město</div>
          <button class="iuWeatherSheetClose" type="button" aria-label="Zavřít">✕</button>
        </div>
        <input class="iuWeatherSheetSearch" type="search" inputmode="search" autocomplete="off" placeholder="Hledat město…" />
        <div class="iuWeatherSheetList" role="list"></div>
      </div>
    `.trim();
    document.body.appendChild(overlay);

    const sheet = overlay.querySelector(".iuWeatherSheet");
    const closeBtn = overlay.querySelector(".iuWeatherSheetClose");
    const input = overlay.querySelector(".iuWeatherSheetSearch");
    const list = overlay.querySelector(".iuWeatherSheetList");

    function close(){
      try{ overlay.hidden = true; }catch{}
    }
    async function open(){
      try{ overlay.hidden = false; }catch{}
      try{ if (input) input.focus(); }catch{}
      try{
        if (!window.__iuWeatherCitiesData) {
          if (list) list.innerHTML = `<div class="iuWeatherSheetEmpty">Načítání měst…</div>`;
          window.__iuWeatherCitiesData = await iuLoadCitiesSafe();
        }
      }catch{
        window.__iuWeatherCitiesData = IU_CITY_FALLBACK;
      }
      renderList();
    }
    function renderList(){
      if (!list) return;
      const q = iuWeatherNorm(input && input.value);
      const data = Array.isArray(window.__iuWeatherCitiesData) && window.__iuWeatherCitiesData.length
        ? window.__iuWeatherCitiesData
        : IU_CITY_FALLBACK;

      const out = [];
      for (let i = 0; i < data.length; i++){
        const c = data[i];
        const nm = c && c[0] ? String(c[0]) : "";
        const okr = c && c[1] ? String(c[1]) : "";
        if (!nm) continue;
        if (q) {
          const hay = iuWeatherNorm(nm + " " + okr);
          if (!hay.includes(q)) continue;
        }
        out.push({ idx: i, label: iuCityLabel(c) });
        if (out.length >= 20) break;
      }

      list.innerHTML = out.length
        ? out.map((it) => {
          const label = escapeHtml(it.label || "");
          return `<button type="button" class="iuWeatherSheetItem" role="listitem" data-idx="${String(it.idx)}">${label}</button>`;
        }).join("")
        : `<div class="iuWeatherSheetEmpty">Nic nenalezeno</div>`;
    }

    overlay.addEventListener("click", (e) => {
      try{
        if (e && e.target === overlay) close();
      }catch{}
    });
    if (closeBtn) closeBtn.addEventListener("click", close);
    if (input) input.addEventListener("input", renderList);
    if (list) list.addEventListener("click", (e) => {
      try{
        const btn = e.target && e.target.closest ? e.target.closest(".iuWeatherSheetItem") : null;
        if (!btn) return;
        const idx = Number(btn.getAttribute("data-idx"));
        const data = Array.isArray(window.__iuWeatherCitiesData) && window.__iuWeatherCitiesData.length
          ? window.__iuWeatherCitiesData
          : IU_CITY_FALLBACK;
        const c = data[idx];
        if (!c) return;
        const name = String(c[0] || "").trim();
        const lat = Number(c[2]);
        const lon = Number(c[3]);
        if (!name || !isFinite(lat) || !isFinite(lon)) return;
        const city = { name, lat, lon };
        iuWeatherSetRuntime(city);
        iuWeatherWriteSelected(city);
        iuWeatherSyncCityLabels(city);
        try{ if (document.getElementById("iuWxPlace")) document.getElementById("iuWxPlace").textContent = String(city.name); }catch{}
        try{
          const pin = document.getElementById("iuWeatherCityPinned");
          if (pin && pin.checked) {
            iuWeatherWritePinned(true);
            iuWeatherSyncPinnedToggle();
          } else {
            iuWeatherWritePinned(false);
          }
        }catch{}
        iuWeatherLoadAndRender();
        close();
      }catch{}
    });

    overlay.__iuWeatherOpen = open;
    overlay.__iuWeatherClose = close;
    return overlay;
  }

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
      const city = iuWeatherGetActiveCity();
      iuWeatherSyncCityLabels(city);
      iuWeatherSyncPinnedToggle();

      const elErr = document.getElementById("iuDailyErr");
      const elWeather = document.getElementById("iuDailyWeather");
      const elPlace = document.getElementById("iuWxPlace");
      const elIcon = document.getElementById("iuWxIcon");
      const elTemp = document.getElementById("iuWxTemp");
      const elMinMax = document.getElementById("iuWxMinMax");

      if (elErr) elErr.hidden = true;
      if (elWeather) elWeather.hidden = false;
      if (elPlace) elPlace.textContent = String(city.name || "Praha");
      if (elTemp) elTemp.textContent = "—°C";
      if (elMinMax) elMinMax.textContent = "Max —° · Min —°";
      if (elIcon) elIcon.textContent = "🌤";
      try{ const elHours = document.getElementById("iuWxHours"); if (elHours) elHours.classList.add("iuWxHours--skeleton"); }catch{}

      const d = await iuFetchOpenMeteo(city.lat, city.lon);
      const cur = d && d.current;
      const hourly = d && d.hourly;
      const daily = d && d.daily;
      if (!cur || typeof cur.temperature_2m !== "number") throw new Error("bad current");

      if (elTemp) elTemp.textContent = `${Math.round(cur.temperature_2m)}°C`;
      if (elIcon) elIcon.textContent = iuWxIconFromCode(cur.weather_code);

      const max0 = daily && Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : null;
      const min0 = daily && Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : null;
      if (elMinMax) elMinMax.textContent = `Max ${iuFmtDegShort(max0)} · Min ${iuFmtDegShort(min0)}`;

      iuWeatherUpdateHours(hourly);
      iuWeatherRender7Day(daily);

      if (elWeather) elWeather.hidden = false;
      if (elErr) elErr.hidden = true;

      try{
        const params = new URLSearchParams(location.search || "");
        if (params.get("radarOpen") === "1") {
          iuWeatherRadarEnsure();
        }
      }catch{}
      try{ iuWeatherHideEmptyNameday(); }catch{}
    }catch{
      try{
        const elErr = document.getElementById("iuDailyErr");
        const elWeather = document.getElementById("iuDailyWeather");
        if (elWeather) elWeather.hidden = true;
        if (elErr) elErr.hidden = false;
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
  const MAILBOX_PLACEHOLDERS = ["Např.: e-mail 1", "Např.: e-mail 2", "Např.: pracovní web", "Např.: oblíbený web"];
  const IU_MAILBOX_MIN = 1;
  const IU_MAILBOX_MAX = 6;

  function iuMailboxLoad(){
    try{
      const txt = localStorage.getItem(MAILBOX_STORAGE_KEY);
      if (!txt) {
        const items = MAILBOX_PLACEHOLDERS.map((label, i) => ({ label, url: "", index: i }));
        try{ localStorage.setItem(MAILBOX_STORAGE_KEY, JSON.stringify({ items })); }catch{}
        return items;
      }
      const parsed = JSON.parse(txt);
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      const raw = items.slice(0, IU_MAILBOX_MAX);
      let fixed = raw.map((it, i) => ({
        label: String(it?.label ?? "").trim() || (i < 4 ? MAILBOX_PLACEHOLDERS[i] : ""),
        url: String(it?.url ?? "").trim(),
        index: i
      }));
      if (items.length > IU_MAILBOX_MAX) {
        try{ localStorage.setItem(MAILBOX_STORAGE_KEY, JSON.stringify({ items: fixed.map(({ label, url }) => ({ label, url })) })); }catch{}
      }
      if (fixed.length < IU_MAILBOX_MIN) {
        for (let i = fixed.length; i < IU_MAILBOX_MIN; i++) {
          fixed.push({ label: MAILBOX_PLACEHOLDERS[i] || `Schránka ${i + 1}`, url: "", index: i });
        }
        try{ localStorage.setItem(MAILBOX_STORAGE_KEY, JSON.stringify({ items: fixed })); }catch{}
      }
      return fixed;
    }catch{
      return MAILBOX_PLACEHOLDERS.map((label, i) => ({ label, url: "", index: i }));
    }
  }

  function iuMailboxSave(items){
    try{
      const toSave = items.map(({ label, url }) => ({ label, url }));
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
    const items = iuMailboxLoad();
    const frag = document.createDocumentFragment();
    items.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "iu-mailbox-row";
      const label = it.label || (i < 4 ? MAILBOX_PLACEHOLDERS[i] : `Schránka ${i + 1}`);
      row.innerHTML = `<button class="iu-mailbox-pill" type="button" data-mailbox-index="${i}" data-mailbox-open>${escapeHtml(label)}</button>` +
        `<button class="iu-mailbox-gear" type="button" data-mailbox-gear="${i}" aria-label="Nastavení schránky ${i + 1}" title="Nastavení"><i class="fa-solid fa-gear" aria-hidden="true"></i></button>`;
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
    let mailboxCount = iuMailboxLoad().length;
    iuUpdateMailboxControls(mailboxCount);
    iuPositionMailboxControls();

    document.getElementById("iuMailboxAdd")?.addEventListener("click", () => {
      if (mailboxCount >= IU_MAILBOX_MAX) return;
      const items = iuMailboxLoad();
      items.push({ label: "", url: "", index: items.length });
      iuMailboxSave(items);
      iuMailboxRender();
      mailboxCount = items.length;
      iuUpdateMailboxControls(mailboxCount);
      iuPositionMailboxControls();
    });

    document.getElementById("iuMailboxRemove")?.addEventListener("click", () => {
      if (mailboxCount <= IU_MAILBOX_MIN) return;
      const items = iuMailboxLoad();
      items.pop();
      iuMailboxSave(items);
      iuMailboxRender();
      mailboxCount = items.length;
      iuUpdateMailboxControls(mailboxCount);
      iuPositionMailboxControls();
    });

    list.addEventListener("click", (e) => {
      const gearBtn = e.target.closest?.("[data-mailbox-gear]");
      if (gearBtn) {
        e.preventDefault();
        const idx = parseInt(gearBtn.getAttribute("data-mailbox-gear") || "0", 10);
        const items = iuMailboxLoad();
        const it = items[idx];
        if (!it) return;
        const label = window.prompt("Název tlačítka:", it.label || "") || it.label || "";
        const url = window.prompt("URL (www):", it.url || "") || it.url || "";
        items[idx] = { ...it, label: String(label).trim(), url: String(url).trim() };
        iuMailboxSave(items);
        iuMailboxRender();
        return;
      }
      const pillBtn = e.target.closest?.("[data-mailbox-open]");
      if (pillBtn) {
        const idx = parseInt(pillBtn.getAttribute("data-mailbox-index") || "0", 10);
        const items = iuMailboxLoad();
        const it = items[idx];
        if (it?.url) window.open(it.url, "_blank", "noopener");
      }
    });
  }

  function iuWeatherInit(){
    try{
      if (window.__iuWeatherInitDone) return;
      window.__iuWeatherInitDone = 1;

      iuWeatherSyncPinnedToggle();

      const btn = document.getElementById("iuWeatherCityChange");
      if (btn) btn.addEventListener("click", () => {
        const overlay = iuWeatherEnsureCitySheet();
        try{ overlay.__iuWeatherOpen(); }catch{}
      });

      try{
        const params = new URLSearchParams(location.search || "");
        if (params.get("cityPicker") === "1") {
          const overlay = iuWeatherEnsureCitySheet();
          try{ overlay.__iuWeatherOpen(); }catch{}
        }
      }catch{}

      const pin = document.getElementById("iuWeatherCityPinned");
      if (pin) pin.addEventListener("change", () => {
        try{
          const city = iuWeatherGetActiveCity();
          const pinned = Boolean(pin.checked);
          iuWeatherWritePinned(pinned);
          if (pinned) iuWeatherWriteSelected(city);
          iuWeatherSyncPinnedToggle();
        }catch{}
      });

      const radarBtn = document.getElementById("iuWxRadarOpen");
      if (radarBtn) radarBtn.addEventListener("click", () => {
        iuWeatherRadarEnsure();
      });
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
    function iconFromCode(code){
      if (code === 0) return "☀️";
      if (code === 1 || code === 2) return "🌤";
      if (code === 3) return "☁️";
      if (code >= 45 && code <= 48) return "🌫";
      if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "🌧";
      if (code >= 71 && code <= 77) return "❄️";
      if (code >= 95) return "⛈";
      return "🌤";
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
      fetch("https://svatky.adresa.info/json", { cache: "no-store" })
        .then(r => r.json())
        .then(d => {
          const nm = d && d.name ? String(d.name).trim() : "";
          const ok = Boolean(nm) && nm !== "—" && nm !== "-";
          if (ok) {
            if (elNameday) {
              elNameday.textContent = "Svátek má " + nm;
              elNameday.hidden = true;
              elNameday.setAttribute("aria-hidden","true");
            }
            try{ iuSetTopbarNameday(nm); }catch{}
          } else {
            if (elNameday) {
              elNameday.textContent = "";
              elNameday.hidden = true;
              elNameday.setAttribute("aria-hidden","true");
            }
            try{ iuSetTopbarNameday(""); }catch{}
          }
          try{ iuWeatherHideEmptyNameday(); }catch{}
        })
        .catch(() => {
          if (elNameday) {
            elNameday.textContent = "";
            elNameday.hidden = true;
            elNameday.setAttribute("aria-hidden","true");
          }
          try{ if (typeof iuSetTopbarNameday === "function") iuSetTopbarNameday(""); }catch{}
          try{ iuWeatherHideEmptyNameday(); }catch{}
        });
    }
    updateNameday();

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
    if (elIcon) elIcon.textContent = "🌤";
    // CLS mitigation: hodiny mají předrenderované "sloty" v HTML (skeleton),
    // takže je tady nemažeme (mazání + pozdější append = layout shift).
    if (elHours) {
      try { elHours.classList.add("iuWxHours--skeleton"); } catch(_){}
    }

    iuFetchOpenMeteo(lat, lon)
      .then(d => {
        const cur = d && d.current;
        const hourly = d && d.hourly;
        const daily = d && d.daily;

        if (!cur || typeof cur.temperature_2m !== "number") throw new Error("bad current");

        const t = Math.round(cur.temperature_2m);
        const code = cur.weather_code;

        if (elTemp) elTemp.textContent = `${t}°C`;
        if (elIcon) elIcon.textContent = iconFromCode(code);

        // min/max
        const max0 = daily && Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : null;
        const min0 = daily && Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : null;
        if (elMinMax) {
          elMinMax.textContent = `Max ${fmtDeg(max0)} · Min ${fmtDeg(min0)}`;
        }

        // hourly strip: update stable slots (count depends on HTML; Weather view uses 6)
        try{ iuWeatherUpdateHours(hourly); }catch{}
        try{ iuWeatherRender7Day(daily); }catch{}

        if (elWeather) elWeather.hidden = false;
        if (elErr) elErr.hidden = true;
      })
      .catch(() => {
        if (elWeather) elWeather.hidden = true;
        if (elErr) elErr.hidden = false;
      });
  };

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
    initAccordion();
  }

  const IU_NAKUP_JSON_PATH = "/assets/data/services-shopping.json";

  function iuNakupEls(){
    return {
      modal: document.getElementById("iuNakupModal"),
      list: document.getElementById("iuNakupList"),
      openBtn: document.getElementById("iuOpenNakupDomu"),
      closeBtn: document.getElementById("iuNakupClose"),
    };
  }

  function iuNakupClose(){
    const { modal } = iuNakupEls();
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }

  try {
    window.addEventListener('iu-open-panel', function(e){ if (e.detail === 'shopping') iuOpenNakupDomu(); });
    window.addEventListener('iu-close-panel', function(e){ if (e.detail === 'shopping') iuNakupClose(); });
  } catch {}

  async function iuLoadNakupDomu(){
    const url = new URL(IU_NAKUP_JSON_PATH, window.location.origin).toString();
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`services-shopping.json HTTP ${res.status}`);
    const data = await res.json();
    const { list } = iuNakupEls();
    if (!list) return;
    if (!Array.isArray(data) || !data.length) {
      throw new Error("services-shopping.json invalid/empty");
    }
    list.innerHTML = data.map(s => `
      <a href="${escapeHtml(String(s?.url || ""))}" target="_blank" rel="noopener noreferrer">
        <i class="fa-solid ${escapeHtml(String(s?.icon || "fa-bag-shopping"))}"
           style="color:${escapeHtml(String(s?.accent || "#1F4B99"))}"></i>
        ${escapeHtml(String(s?.name || "Odkaz"))}
      </a>
    `).join("");
  }

  async function iuOpenNakupDomu(){
    const { modal, list } = iuNakupEls();
    if (!modal || !list) return;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    list.innerHTML = '<div class="iuModalMsg">Načítám…</div>';
    try {
      await iuLoadNakupDomu();
    } catch (err) {
      console.error("[iuNakupDomu] load failed", err);
      list.innerHTML = '<div class="iuModalMsg">Odkazy se nepodařilo načíst. Zkuste obnovit stránku.</div>';
    }
  }

  function iuNakupDomuInit(){
    const { modal, openBtn, closeBtn } = iuNakupEls();
    openBtn?.addEventListener("click", (e) => {
      e.preventDefault?.();
      try { if (typeof window.iuSetPanelInUrl === 'function') window.iuSetPanelInUrl('shopping'); } catch {}
    });
    closeBtn?.addEventListener("click", (e) => {
      e.preventDefault?.();
      try { if (typeof window.iuSetPanelInUrl === 'function') window.iuSetPanelInUrl(''); } catch {}
    });
    modal?.addEventListener("click", (e) => {
      if (e.target === modal) {
        try { if (typeof window.iuSetPanelInUrl === 'function') window.iuSetPanelInUrl(''); } catch {}
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const m = iuNakupEls().modal;
        if (m && !m.hidden) {
          try { if (typeof window.iuSetPanelInUrl === 'function') window.iuSetPanelInUrl(''); } catch {}
        }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iuNakupDomuInit);
  } else {
    iuNakupDomuInit();
  }

  async function iuDiagNakupDomuOnce(){
    try {
      const url = new URL(IU_NAKUP_JSON_PATH, window.location.origin).toString();
      const res = await fetch(url, { cache: "no-store" });
      console.info("[iuDiagNakupDomu] json", url, "status", res.status);
    } catch (err) {
      console.warn("[iuDiagNakupDomu] json fetch failed", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iuDiagNakupDomuOnce);
  } else {
    iuDiagNakupDomuOnce();
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
    iuInitLeftEdgeOverlayToggle();
    iuMirrorTodayToTopbar();
    iuInitMobileFocusAccordion();
    iuInitFeedVideoPreviewEmbeds();

    try { initRightPanel(); } catch (e) { console.error("RightPanel init failed", e); if (typeof persistLastError === "function") persistLastError("RightPanel init failed"); }

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
      try { return Boolean(location.search && location.search.includes("debug=1")); } catch { return false; }
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
  
  function openParcels(){
    if(!modal || !overlay) return;
    overlay.classList.add('is-open');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }
  
  function closeParcels(){
    if(!modal || !overlay) return;
    overlay.classList.remove('is-open');
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }
  
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
        { name: "Claude", url: "https://claude.ai", desc: "Velmi přirozená a čtivá čeština pro texty a myšlenky", external: true, color: "#D97706", video: "X1FOhLxFQqo" },
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
    sms: { title: "Poslat SMS zdarma", items: [{ name: "SMS zdarma", url: "https://www.smszdarma.cz", desc: "Posílání SMS zdarma", external: true }] },
    convert: { title: "Převod na Word, PDF", items: [{ name: "iLovePDF", url: "https://www.ilovepdf.com", desc: "Převod a úprava PDF, Word a dalších formátů", external: true }] },
    nakup: {
      title: "Nákup domů",
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

  function iuShowQuickFeed(key){
    const keyNorm = String(key || "").trim().toLowerCase();
    if (keyNorm === "ai") {
      try { window.dispatchEvent(new CustomEvent("iu-open-panel", { detail: "ai" })); } catch {}
      var p = document.getElementById("iu-aiPanel");
      var o = document.getElementById("iu-aiOverlay");
      if (p) {
        if (typeof window.ensureAiModalInBody === "function") window.ensureAiModalInBody();
        if (typeof window.iuSetElOpenVisible === "function") {
          window.iuSetElOpenVisible(o, true);
          window.iuSetElOpenVisible(p, true);
          if (typeof window.ensureAiModalInBody === "function") window.ensureAiModalInBody();
          if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(function() { if (typeof window.ensureAiModalInBody === "function") window.ensureAiModalInBody(); });
          setTimeout(function() { if (typeof window.ensureAiModalInBody === "function") window.ensureAiModalInBody(); }, 0);
        } else {
          p.hidden = false;
          if (o) o.hidden = false;
        }
        try { document.documentElement.style.overflow = "hidden"; } catch (_) {}
        try { document.body.classList.add("iu-modal-open"); } catch (_) {}
        try { if (p.dataset) p.dataset.open = "1"; } catch (_) {}
      }
      return;
    }
    const data = (window.IU_QUICK_FEEDS || {})[key];
    if (!data) return;
    const stage = document.getElementById("iuCenterStage");
    const quick = document.getElementById("iuQuickFeed");
    if (!stage || !quick) return;
    stage.setAttribute("data-iu-view", "quick");
    quick.hidden = false;
    const isTranslator = String(key || "").toLowerCase() === "deepl";
    const useFullCard = ["ai", "deepl"].includes(String(key || "").toLowerCase());

    if (isTranslator) {
      quick.innerHTML = `
        <div class="iuQHead">
          <div class="iuQTitle">${iuQfEscape(data.title)}</div>
          <button class="iuQClose" type="button" id="iuQCloseBtn" aria-label="Zavřít">✕</button>
        </div>
        <div class="iuTrArea">
          <h3 class="iuTrTitle">Vlož text</h3>
          <textarea id="iuTrText" class="iuTrText" placeholder="Sem vlož text k překladu… (Ctrl+V)" rows="3"></textarea>
          <div class="iuTrBar">
            <span id="iuTrLang" class="iuTrStatus">Odhad jazyka: —</span>
            <span class="iuTrHintMid">Klikni na překladač níže</span>
            <span id="iuTrCount" class="iuTrCount">0 znaků</span>
          </div>
          <div class="iuTrUtils">
            <button type="button" id="iuTrCopy" class="iuTrPill">Zkopírovat</button>
            <button type="button" id="iuTrClear" class="iuTrPill">Vyčistit</button>
          </div>
          <p id="iuTrToast" class="iuTrToast" aria-live="polite"></p>
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
            <button type="button" class="iuNotesBtn iuNotesBtnPrimary" data-iu-notes-send>Odeslat</button>
          </div>
          <div class="iuNotesSendBar" data-iu-notes-sendbar hidden>
            <button type="button" class="iuNotesSendOpt" data-iu-notes-send-wa>WhatsApp</button>
            <button type="button" class="iuNotesSendOpt" data-iu-notes-send-mail>E-mail</button>
            <button type="button" class="iuNotesSendOpt" data-iu-notes-send-copy>Kopírovat pro odeslání</button>
          </div>
          <div class="iuNotesStatus" data-iu-notes-status hidden></div>
        </div>
      `;
      iuTrInit(quick, data);
      iuTrNotesBootstrap(quick);
    } else {
      const isAi = (key || "").toLowerCase() === "ai";
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
        return arr.map(it => {
          const url = iuQfEscape(it.url || it.baseUrl || "#");
          const ext = (it.external !== false) ? 'target="_blank" rel="noopener noreferrer"' : "";
          const c = it.color || "#1F4B99";
          const style = isAi ? `--aiFeedColor:${CHATGPT_AI_COLOR}` : `--aiColor:${c}`;
          if (useFullCard) {
            return `<a class="iuAiCard" href="${url}" ${ext} style="${style}">
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
      const doRender = (services) => {
        quick.innerHTML = `
          <div class="iuQHead">
            <div class="iuQTitle">${iuQfEscape(data.title)}</div>
            <button class="iuQClose" type="button" id="iuQCloseBtn" aria-label="Zavřít">✕</button>
          </div>
          <div class="iuQCard">
            <div class="iuQGrid">
              ${renderCards(services || data.items)}
            </div>
          </div>
          ${aiSeoBlock}
        `;
        if (isAi) {
          try { renderAiVideos(quick); } catch (e) { console.warn("renderAiVideos", e); }
        }
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
      }
    }
    const closeBtn = document.getElementById("iuQCloseBtn");
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
        const payload = iuNotesBuildPayload(text);
        if (typeof navigator !== "undefined" && navigator.share) {
          navigator.share({ text: payload, title: "infoUzel.cz" }).then(() => {}).catch(() => {
            hideOtherSendbars();
            if (sendbar) sendbar.hidden = false;
          });
        } else {
          hideOtherSendbars();
          if (sendbar) sendbar.hidden = false;
        }
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
  }

  function iuHideQuickFeed(){
    iuEnsureArticlesView();
  }

  try { window.iuEnsureArticlesView = iuEnsureArticlesView; } catch (e) {}

  function iuQuickFeedInit(){
    document.addEventListener("click", (e) => {
      const el = e.target.closest && e.target.closest('[data-iuq]');
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      const key = el.getAttribute("data-iuq");
      if (key) iuShowQuickFeed(key);
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iuQuickFeedInit);
  } else {
    iuQuickFeedInit();
  }
})();

// === AI PANEL (Quick Links) — centered modal (like Parcels) ===
(function(){
  'use strict';

  /* Global close handler: [data-iu-close] / .iuModalClose / .iu-close closes modal (capture so it runs before stopPropagation inside modals) */
  document.addEventListener('click', function(e){
    const t = e.target;
    const targetEl = (t && t.nodeType === 1) ? t : (t && t.parentElement ? t.parentElement : null);
    if (!targetEl) return;
    const closeBtn = targetEl.closest('[data-iu-close], .iuModalClose, .iu-close');
    if (!closeBtn) return;
    const modal = closeBtn.closest && (closeBtn.closest('.iuModal, [data-iu-modal]') || closeBtn.closest('#iu-aiPanel'));
    if (!modal) return;
    e.preventDefault();
    e.stopPropagation();
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
    } else {
      modal.setAttribute('hidden', '');
    }
    modal.classList.remove('is-open');
    document.body.classList.remove('iu-modal-open');
  }, true);

  const AI_FALLBACK = [
    { name: "ChatGPT", url: "https://chat.openai.com", desc: "Univerzální AI na psaní, nápady, obrázky i práci s daty" },
    { name: "Google Gemini", url: "https://gemini.google.com", desc: "AI propojená s Googlem, mapami, vyhledáváním a Gmailem" },
    { name: "Microsoft Copilot", url: "https://copilot.microsoft.com", desc: "AI pro práci ve Windows, Office a psaní e-mailů" },
    { name: "Claude", url: "https://claude.ai", desc: "Velmi přirozená a čtivá čeština pro texty a myšlenky" },
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
      window.addEventListener('iu-open-panel', function(e){ if (e.detail === 'ai') openPanel(); });
      window.addEventListener('iu-close-panel', function(e){ if (e.detail === 'ai') closePanel(); });
    } catch {}

    // 1) Klik na tlačítko – bez změny URL (AI jen overlay)
    document.addEventListener('click', e => {
      if (e.target.closest && e.target.closest('[data-iuq]')) return;
      const btn = e.target.closest('[data-action="ai-panel"]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      openPanel();
    }, true);

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
    const feedEl = document.getElementById('feed');
    const viewEl = document.getElementById('iuRadioView');
    const tvonlineEl = document.getElementById('iuTvOnlineView');
    const jrEmptyEl = document.getElementById('iuJrEmptyView');
    const mapyEl = document.getElementById('iuMapyView');
    const travelEl = document.getElementById('iuTravelView');
    const my1 = document.getElementById('iuMyUzelView1');
    const my2 = document.getElementById('iuMyUzelView2');
    const my3 = document.getElementById('iuMyUzelView3');
    const my4 = document.getElementById('iuMyUzelView4');
    const my5 = document.getElementById('iuMyUzelView5');

    if (feedEl) feedEl.hidden = true;
    if (viewEl) viewEl.hidden = true;
    if (tvonlineEl) tvonlineEl.hidden = true;
    if (jrEmptyEl) jrEmptyEl.hidden = true;
    if (mapyEl) mapyEl.hidden = true;
    if (travelEl) travelEl.hidden = true;
    if (my1) my1.hidden = true;
    if (my2) my2.hidden = true;
    if (my3) my3.hidden = true;
    if (my4) my4.hidden = true;
    if (my5) my5.hidden = true;

    let activeEl = null;
    if (String(key || '').toLowerCase().startsWith('myuzel-')) {
      if (key === 'myuzel-1' && my1) my1.hidden = false;
      if (key === 'myuzel-2' && my2) my2.hidden = false;
      if (key === 'myuzel-3' && my3) my3.hidden = false;
      if (key === 'myuzel-4' && my4) my4.hidden = false;
      if (key === 'myuzel-5' && my5) my5.hidden = false;
      activeEl = my1 && key === 'myuzel-1' ? my1 :
                 my2 && key === 'myuzel-2' ? my2 :
                 my3 && key === 'myuzel-3' ? my3 :
                 my4 && key === 'myuzel-4' ? my4 :
                 my5 && key === 'myuzel-5' ? my5 : null;
    } else {
      if(key === 'radio' && viewEl) { viewEl.hidden = false; activeEl = viewEl; }
      if(key === 'tvonline' && tvonlineEl) { tvonlineEl.hidden = false; activeEl = tvonlineEl; }
      if(key === 'jr' && jrEmptyEl) { jrEmptyEl.hidden = false; activeEl = jrEmptyEl; }
      if(key === 'mapy' && mapyEl) { mapyEl.hidden = false; activeEl = mapyEl; }
      if(key === 'travel' && travelEl) { travelEl.hidden = false; activeEl = travelEl; }
      // default feed view for all other sections
      if(key !== 'radio' && key !== 'tvonline' && key !== 'jr' && key !== 'mapy' && key !== 'travel' && feedEl) { feedEl.hidden = false; activeEl = feedEl; }
    }

    // Notes: re-init within the active view on every switch (idempotent).
    try{
      if (activeEl) requestAnimationFrame(() => { try{ iuInitNotesInView(activeEl); }catch{} });
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
      // AI panel must NOT open from URL – overlay only via quicklink (data-iuq="ai")
      const ALLOWED_PANELS = new Set(['shopping', 'services']);
      if (ALLOWED_PANELS.has(id)) return id;
      return null;
    }catch{ return null; }
  }

  let __iuCurrentPanel = null;

  function safeOpenPanel(panel, retryCount){
    retryCount = retryCount || 0;
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
        iuHideAllOverlaysNow();
        const prev = __iuCurrentPanel;
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
      if (panel) url.searchParams.set('panel', panel);
      else url.searchParams.delete('panel');
      if (replace) history.replaceState({}, '', url);
      else history.pushState({}, '', url);
      if (!__iuPanelRouting) { try { window.dispatchEvent(new CustomEvent('iu-panel-url-changed')); } catch {} }
    }catch{}
  }
  try { window.iuSetPanelInUrl = setPanelInUrl; } catch {}

  function applySectionFromURL(accentOverride){
    if (typeof window.iuEnsureArticlesView === "function") window.iuEnsureArticlesView();
    // Gate C: ?section= has priority; hash ignored (getInitialSection reads search only)
    const section = getInitialSection(); // already normalized + fallback->media
    const accentKey = (accentOverride && String(accentOverride).trim().toLowerCase()) || section;
    // safe: UI-only section marker for stable CSS scoping (no feed pipeline touch)
    try{ document.body && (document.body.dataset.section = section); }catch{}
    try{
      const color = IU_CONTENT_ACCENTS[accentKey] || "";
      document.body && document.body.style.setProperty("--iuContentAccent", color);
    }catch{}
    // feed paging must reset on section change
    try{ state.page = 1; }catch{}
    setLeftNavActive(section);
    showView(VIEW_MAP[section] ?? 'media');

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
        window.dispatchEvent(new CustomEvent('iu-open-panel', { detail: id }));
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
      try{
        requestAnimationFrame(() => requestAnimationFrame(() => iuScrollMainToTopSmooth()));
      }catch{
        try{ iuScrollMainToTopSmooth(); }catch{}
      }
    });
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

    const explicit = (typeof window !== "undefined" && typeof window.iuHasExplicitNavInUrl === "function" && window.iuHasExplicitNavInUrl()) || false;
    if (!explicit) {
      persistSection(getInitialSection());
    }
    applySectionFromURL();
    applyPanelFromUrl();
    try { window.addEventListener('iu-panel-url-changed', applyPanelFromUrl); } catch {}
    // PRELOAD overlay styles on page load
    try {
      iuHideAllOverlaysNow();
      requestAnimationFrame(() => {
        iuHideAllOverlaysNow();
      });
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
} catch(e) {
  console.error("IU SAFE BOOT ERROR:", e);
}

// === UI-only cleanup: permanently disable any cached rail-hidden state ===
try { document.body.classList.remove("iu" + "RailHidden"); } catch (e) {}
try { document.documentElement.classList.remove("iu" + "RailHidden"); } catch (e) {}
try { localStorage.removeItem("iuRailHidden"); } catch (e) {}
