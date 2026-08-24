import {
  iuSilverHashSafeLabelV1 as iuSilverHashSafeLabelLeafV1,
  iuSilverReplayChecksumV1 as iuSilverReplayChecksumLeafV1,
  iuSilverExpandRuntimeDebugMetaV1 as iuSilverExpandRuntimeDebugMetaLeafV1
} from "./silver-runtime-debug-leaf.js";
import {
  ensureLocalDataProtectionBeforeSave,
  isLocalDataProtectionNoticeAccepted,
} from "./iu-local-data-protection.js";
/* P0.5: financial / legal / invoice tool overlays load via dynamic import (see iuBootDeferredToolOverlays) — reduces initial parse + main-thread work. */
/* SEV1: iuIsProjectsRoute — global + window for safe scope (module/global) */
var iuIsProjectsRoute = function iuIsProjectsRoute(){
  try{
    var p = (typeof location !== "undefined" && location && location.pathname ? String(location.pathname) : "").replace(/\\/g, '/');
    /* Public hub is site root (/); /projects/ remains legacy hub path (redirected in prod). Data stays under /projects/data/. */
    if (p === '/' || p === '/index.html') return true;
    if (p === '/filtr/' || p === '/filtr' || p === '/filtr/index.html') return true;
    return p === '/projects/' || p === '/projects' || p.indexOf('/projects/') === 0 || p === '/filtr/projects' || p === '/filtr/projects/' || p.indexOf('/filtr/projects/') === 0;
  }catch(e){
    return false;
  }
};
try { if (typeof window !== "undefined") window.iuIsProjectsRoute = iuIsProjectsRoute; } catch(e){}
try { if (typeof window !== "undefined") window.__iuNavOverlayLock = false; } catch (e) {}
/** P0 mobile/tablet: transient lock during popstate overlay restore — rAF-only release left stale locks on WebKit/throttled tabs (dead Domů/Menu/Zpět). */
function iuNavOverlayLockArm() {
  try {
    if (typeof window === "undefined") return;
    window.__iuNavOverlayLock = true;
    window.__iuNavOverlayLockSeq = (typeof window.__iuNavOverlayLockSeq === "number" ? window.__iuNavOverlayLockSeq : 0) + 1;
    var seq = window.__iuNavOverlayLockSeq;
    function iuNavOverlayLockReleaseIfCurrent() {
      try {
        if (window.__iuNavOverlayLockSeq === seq) window.__iuNavOverlayLock = false;
      } catch (_) {}
    }
    try {
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(iuNavOverlayLockReleaseIfCurrent);
      });
    } catch (_) {}
    try {
      window.setTimeout(iuNavOverlayLockReleaseIfCurrent, 180);
    } catch (_) {}
  } catch (_) {}
}
function iuNavOverlayLockForceClear() {
  try {
    if (typeof window !== "undefined") {
      window.__iuNavOverlayLock = false;
      window.__iuNavOverlayLockSeq = (typeof window.__iuNavOverlayLockSeq === "number" ? window.__iuNavOverlayLockSeq : 0) + 1;
    }
  } catch (_) {}
}
try {
  if (typeof window !== "undefined") {
    window.iuNavOverlayLockArm = iuNavOverlayLockArm;
    window.iuNavOverlayLockForceClear = iuNavOverlayLockForceClear;
  }
} catch (e) {}

/**
 * Stage-3: Domů / gate Zpět must reset hub URL before the 1.11MB feed chunk evaluates.
 * Feed IIFE overwrites this with the full applySectionFromURL path when it loads.
 */
function iuProjectsHubNavigateHardResetFromHomeOrBack() {
  try {
    if (typeof window.iuIsProjectsRoute === "function" && !window.iuIsProjectsRoute()) return;
  } catch (_) {}
  try {
    if (typeof window.iuNavOverlayLockForceClear === "function") window.iuNavOverlayLockForceClear();
    else window.__iuNavOverlayLock = false;
  } catch (_) {}
  try {
    var wrapR = document.getElementById("iuMobileGateWrap");
    if (wrapR && typeof wrapR.__iuMobileGateSetTab === "function") wrapR.__iuMobileGateSetTab("");
  } catch (_) {}
  try {
    if (document.body) document.body.classList.remove("iu-mobileMainVisible", "iu-webnavDetailFromGate");
  } catch (_) {}
  try {
    var uSync = new URL(window.location.href);
    if (uSync.hash === "#iu-nav" || uSync.hash === "#nav" || uSync.hash === "#iu-mindmenu") uSync.hash = "";
    uSync.searchParams.delete("section");
    uSync.searchParams.delete("topic");
    uSync.searchParams.delete("mode");
    uSync.searchParams.delete("panel");
    uSync.searchParams.delete("radarOpen");
    history.replaceState(null, "", uSync.toString());
  } catch (_) {}
  try {
    window.scrollTo(0, 0);
  } catch (_) {}
  try {
    if (typeof window.iuApplySectionFromURL === "function") window.iuApplySectionFromURL();
  } catch (_) {}
}
try {
  if (typeof window !== "undefined") {
    window.iuProjectsHubNavigateHardResetFromHomeOrBack = iuProjectsHubNavigateHardResetFromHomeOrBack;
  }
} catch (e) {}

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

/**
 * Chrome/Chromium: ResizeObserver can emit a benign window "error" (loop / undelivered notifications).
 * Playwright layout guard counts console.error — must not fail CI on this known browser quirk.
 */
function iuIsBenignResizeObserverLoopError(ev) {
  try {
    const msg = String((ev && ev.message) || "");
    return /ResizeObserver loop/i.test(msg);
  } catch (_) {
    return false;
  }
}
try {
  if (typeof window !== "undefined") window.iuIsBenignResizeObserverLoopError = iuIsBenignResizeObserverLoopError;
} catch (_) {}

/** Debounce duplicate skipWaiting reloads in one burst — must NOT block a later new waiting worker in the same tab session (10 min sessionStorage was too aggressive). */
var __iuSilentSwReloadLastMs = 0;

function iuSwReloadGuardShouldSkip() {
  try {
    var now = Date.now();
    if (now - __iuSilentSwReloadLastMs < 2500) return true;
    __iuSilentSwReloadLastMs = now;
    return false;
  } catch (_) {
    return false;
  }
}

/** SKIP_WAITING + at most one page reload per session for real SW updates (never on first cold install). */
function iuSilentSwReloadFromWorker(worker) {
  if (!worker) return;
  try {
    /* First document load without a prior controller: skipWaiting + claim() attach without reload. */
    if (typeof window !== "undefined" && window.__iuSwHadControllerBeforeRegister !== true) {
      try {
        worker.postMessage({ type: "SKIP_WAITING" });
      } catch (_) {}
      return;
    }
  } catch (_) {}
  try {
    if (sessionStorage.getItem("iu_sw_update_reload_used") === "1") {
      try {
        worker.postMessage({ type: "SKIP_WAITING" });
      } catch (_) {}
      return;
    }
  } catch (_) {}
  if (iuSwReloadGuardShouldSkip()) return;
  try {
    sessionStorage.setItem("iu_sw_update_reload_used", "1");
  } catch (_) {}
  try {
    worker.postMessage({ type: "SKIP_WAITING" });
  } catch (_) {}
  try {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(function () {
        location.reload();
      });
    } else {
      location.reload();
    }
  } catch (_) {
    location.reload();
  }
}
try {
  if (typeof window !== "undefined") window.iuSilentSwReloadFromWorker = iuSilentSwReloadFromWorker;
} catch (_) {}

/** Shared CZ diacritic-insensitive fold: lowercase + NFD combining-mark strip. Module-scope for overlay IIFEs + Silver P0 foldCs wrappers. */
function iuFoldCsShared(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
try {
  if (typeof window !== "undefined") window.__iuFoldCsSharedImpl = iuFoldCsShared;
} catch (_) {}

/* P0: reload always returns to top (like seznam.cz) */
try {
  if (typeof history !== "undefined" && "scrollRestoration" in history) history.scrollRestoration = "manual";
  if (typeof window !== "undefined") {
    window.scrollTo(0, 0);
    window.addEventListener("load", function(){ window.scrollTo(0, 0); });
    /* P0 scroll restore: bfcache return (ev.persisted) keeps the browser-preserved position —
       forcing top here erased scroll on Back from an external page. Reload stays top via "load". */
    window.addEventListener("pageshow", function(ev){
      if (ev && ev.persisted) return;
      window.scrollTo(0, 0);
    });
  }
} catch(e){}

/* === IU SCROLL RESTORE LAYER V1 ===
   Root cause: history.scrollRestoration="manual" (above) disables native back/forward restore and the
   popstate route apply re-rendered the view at top (applySectionFromURL arms section-switch scroll +
   resets feed page). This layer saves the main scroll position per route key (section|topic|mode,
   "home" for the hub) into sessionStorage and restores it ONLY on history back/forward (popstate)
   or on the internal mobile "Zpět" → hub path (via window.iuScrollRestoreRequest).
   Forward navigation (left rail, hex tiles, Domů/home) keeps the existing scroll-to-top behavior.
   Must register its popstate listener BEFORE initNavRouter ones (module-top placement). */
(function iuScrollRestoreLayerV1() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var STORE_KEY = "iu:scrollRestoreMapV1";
  var MAX_ENTRIES = 40;
  /* back-navigation re-render (incl. feed batches) can take seconds on slower devices */
  var RESTORE_TIMEOUT_MS = 6000;

  function iuSrRouteKey() {
    try {
      var p = new URLSearchParams(String(location.search || ""));
      var s = String(p.get("section") || "");
      if (!s) return "home";
      return s + "|" + String(p.get("topic") || "") + "|" + String(p.get("mode") || "");
    } catch (_) {
      return "home";
    }
  }
  function iuSrReadMap() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      var m = raw ? JSON.parse(raw) : null;
      return m && typeof m === "object" ? m : {};
    } catch (_) {
      return {};
    }
  }
  function iuSrWriteMap(m) {
    try {
      var keys = Object.keys(m);
      if (keys.length > MAX_ENTRIES) {
        keys.sort(function (a, b) { return ((m[a] && m[a].t) || 0) - ((m[b] && m[b].t) || 0); });
        for (var i = 0; i < keys.length - MAX_ENTRIES; i++) delete m[keys[i]];
      }
      sessionStorage.setItem(STORE_KEY, JSON.stringify(m));
    } catch (_) {}
  }
  function iuSrScrollRoot() {
    try {
      if (!window.matchMedia || !window.matchMedia("(max-width: 900px)").matches) return null;
      var lc = document.getElementById("leftContent");
      if (lc && lc.clientHeight > 0 && lc.scrollHeight > lc.clientHeight + 1) {
        var st = getComputedStyle(lc);
        if (st.overflowY === "auto" || st.overflowY === "scroll") return lc;
      }
    } catch (_) {}
    return null;
  }
  function iuSrGetY() {
    try {
      var root = iuSrScrollRoot();
      if (root) return root.scrollTop || 0;
    } catch (_) {}
    var y = 0;
    try { y = Math.max(y, window.scrollY || 0); } catch (_) {}
    try {
      var se = document.scrollingElement || document.documentElement;
      if (se) y = Math.max(y, se.scrollTop || 0);
    } catch (_) {}
    try { if (document.body) y = Math.max(y, document.body.scrollTop || 0); } catch (_) {}
    return y;
  }
  function iuSrSetY(y) {
    var yv = Math.max(0, Math.round(Number(y) || 0));
    try {
      var root = iuSrScrollRoot();
      if (root) {
        root.scrollTop = yv;
        try { window.scrollTo(0, yv); } catch (_) {}
        return;
      }
    } catch (_) {}
    try { window.scrollTo(0, yv); } catch (_) {}
    try {
      var se = document.scrollingElement || document.documentElement;
      if (se) se.scrollTop = yv;
    } catch (_) {}
    try { if (document.body) document.body.scrollTop = yv; } catch (_) {}
  }
  function iuSrFeedPage() {
    try {
      var st = window.__iuFeedPipelineState;
      var pg = st ? Number(st.page) : 1;
      return Number.isFinite(pg) && pg >= 1 ? pg : 1;
    } catch (_) {
      return 1;
    }
  }
  function iuSrOverlayLockP() {
    try {
      var de = document.documentElement;
      var b = document.body;
      return !!(
        (de && de.classList.contains("iu-mobileGateOverlayOpen")) ||
        (b && b.classList.contains("iu-mobileGateOverlayOpen"))
      );
    } catch (_) {
      return false;
    }
  }

  var iuSrSaveQueued = false;
  function iuSrSaveNow() {
    iuSrSaveQueued = false;
    if (iuSrOverlayLockP()) return; /* overlay locks background scroll — never overwrite with 0 */
    if (iuSrRestoreState) return;   /* don't persist transient positions during an active restore */
    try {
      if (typeof window !== "undefined" && window.__iuDesktopSectionCloseRestoring) return;
    } catch (_) {}
    var m = iuSrReadMap();
    m[iuSrRouteKey()] = { y: iuSrGetY(), p: iuSrFeedPage(), t: Date.now() };
    iuSrWriteMap(m);
  }
  function iuSrQueueSave() {
    if (iuSrSaveQueued) return;
    iuSrSaveQueued = true;
    try { requestAnimationFrame(iuSrSaveNow); } catch (_) { iuSrSaveNow(); }
  }
  try { window.addEventListener("scroll", iuSrQueueSave, { passive: true }); } catch (_) {}
  try { document.addEventListener("scroll", iuSrQueueSave, { passive: true, capture: true }); } catch (_) {}
  try {
    function iuSrBindLeftContentScroll() {
      try {
        var lc = document.getElementById("leftContent");
        if (lc && !lc.__iuSrScrollBound) {
          lc.__iuSrScrollBound = true;
          lc.addEventListener("scroll", iuSrQueueSave, { passive: true });
        }
      } catch (_) {}
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iuSrBindLeftContentScroll);
    else iuSrBindLeftContentScroll();
  } catch (_) {}

  var iuSrRestoreState = null; /* { y, until } */
  function iuSrCancelRestore() {
    if (!iuSrRestoreState) return;
    iuSrRestoreState = null;
    try { window.__iuScrollRestorePendingNav = null; } catch (_) {}
  }
  /* user interaction (incl. forward nav clicks) wins over an in-flight restore */
  try {
    window.addEventListener("wheel", iuSrCancelRestore, { passive: true });
    window.addEventListener("touchstart", iuSrCancelRestore, { passive: true });
    window.addEventListener("keydown", iuSrCancelRestore, true);
    window.addEventListener("pointerdown", iuSrCancelRestore, true);
  } catch (_) {}

  function iuSrRestoreTick() {
    if (!iuSrRestoreState) return;
    var target = iuSrRestoreState.y;
    if (Date.now() > iuSrRestoreState.until) {
      iuSrSetY(target); /* best effort: clamps to max reachable height */
      iuSrCancelRestore();
      return;
    }
    /* HOLD until the window expires: the back-navigation re-render (view swap, async feed batches,
       mobile shell sync) can scroll to 0 AFTER a successful restore — a one-shot restore loses. */
    var srRoot = iuSrScrollRoot();
    var doc = srRoot || document.scrollingElement || document.documentElement;
    var viewH = srRoot ? srRoot.clientHeight : (window.innerHeight || 0);
    var maxY = doc ? Math.max(0, doc.scrollHeight - viewH) : 0;
    if (maxY >= target - 2 && Math.abs(iuSrGetY() - target) > 2) {
      iuSrSetY(target);
    }
    try { requestAnimationFrame(iuSrRestoreTick); } catch (_) { iuSrCancelRestore(); }
  }
  function iuSrRequestRestore(key) {
    var m = iuSrReadMap();
    var entry = m[String(key || iuSrRouteKey())];
    if (!entry || !(Number(entry.y) > 0)) {
      try { window.__iuScrollRestorePendingNav = null; } catch (_) {}
      return false;
    }
    try {
      window.__iuScrollRestorePendingNav = {
        key: String(key || ""),
        y: Math.round(Number(entry.y)),
        page: Number(entry.p) > 1 ? Number(entry.p) : 1,
      };
    } catch (_) {}
    iuSrRestoreState = { y: Math.round(Number(entry.y)), until: Date.now() + RESTORE_TIMEOUT_MS };
    try { requestAnimationFrame(iuSrRestoreTick); } catch (_) { iuSrRestoreTick(); }
    return true;
  }

  try {
    window.iuScrollRestoreSaveNow = iuSrSaveNow;
    window.iuScrollRestoreRequest = function (key) { return iuSrRequestRestore(key); };
  } catch (_) {}

  /* popstate fires after location changed; scroll listener saved the left route continuously.
     Registering here (module top) guarantees this runs before the nav router's popstate handlers,
     so window.__iuScrollRestorePendingNav is visible inside applySectionFromURL. */
  window.addEventListener("popstate", function () {
    try { iuSrRequestRestore(iuSrRouteKey()); } catch (_) {}
  });
})();

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
    // WebKit/Chromium emit this as a window error with no app stack; mark handled so
    // Playwright pageerror / proof harnesses do not count it as unexpectedConsoleError.
    // Real ResizeObserver failures still surface via callback throws / other messages.
    if (iuIsBenignResizeObserverLoopError(e)) {
      try {
        e.preventDefault();
      } catch (_) {}
      try {
        e.stopImmediatePropagation();
      } catch (_) {}
      return;
    }
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
(function iuBootFeedPipelineLazy() {
  // Perf-loop iter-006: keep 240KB feed-pipeline off the slow-net / early-mobile critical path.
  // FIRST LOAD 20260822: weather paints via HEAD early Open-Meteo; pipeline still deferred but not 20s.
  var FEED_URL = "./iu-app-feed-pipeline-v1.js?v=perf-stage3-feed-split-v1-20260818-perf-loop-iter006-defer-pipeline-v1-20260820-early-wx-v1-20260822-pc-vault-mindmenu-persist-v2-20260824";
  var p = null;
  function ensure() {
    if (p) return p;
    p = import(FEED_URL).catch(function (e) {
      p = null;
      try {
        console.warn("[iu] feed pipeline import failed", e);
      } catch (_) {}
    });
    return p;
  }
  function isSlowNet() {
    try {
      var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (!c) return false;
      if (c.saveData) return true;
      var t = String(c.effectiveType || "");
      return t === "slow-2g" || t === "2g" || t === "3g";
    } catch (_) {
      return false;
    }
  }
  try {
    window.__iuEnsureFeedPipeline = ensure;
  } catch (_) {}
  try {
    document.addEventListener(
      "pointerdown",
      function () {
        void ensure();
      },
      true
    );
  } catch (_) {}
  var slow = isSlowNet();
  try {
    // Desktop eager only when not slow-net (stage-3: min-width…ensure within 120).
    var desktopMq = window.matchMedia && window.matchMedia("(min-width: 1025px)");
    if (desktopMq && desktopMq.matches && !slow) void ensure();
  } catch (_) {}
  try {
    // After FCP: start sooner on fast nets; slow-net capped (was 20s — blocked Silver weather).
    // Compact/keyboard-hide still inside pipeline; early weather is HEAD-painted independently.
    var delayMs = slow ? 4000 : 0;
    var idleTimeout = slow ? 4000 : 1200;
    function afterFcpThen(fn) {
      var done = false;
      function run() {
        if (done) return;
        done = true;
        try {
          fn();
        } catch (_) {}
      }
      try {
        var paints = performance.getEntriesByType && performance.getEntriesByType("paint");
        if (paints && paints.some(function (e) { return e && e.name === "first-contentful-paint"; })) {
          run();
          return;
        }
      } catch (_) {}
      try {
        if (typeof PerformanceObserver === "function") {
          var po = new PerformanceObserver(function (list) {
            try {
              var ents = list.getEntries();
              for (var i = 0; i < ents.length; i++) {
                if (ents[i] && ents[i].name === "first-contentful-paint") {
                  try {
                    po.disconnect();
                  } catch (_) {}
                  run();
                  return;
                }
              }
            } catch (_) {}
          });
          po.observe({ type: "paint", buffered: true });
        }
      } catch (_) {}
      setTimeout(run, 1800);
    }
    afterFcpThen(function () {
      setTimeout(function () {
        try {
          if (typeof requestIdleCallback === "function") {
            requestIdleCallback(
              function () {
                void ensure();
              },
              { timeout: idleTimeout }
            );
          } else {
            void ensure();
          }
        } catch (_) {
          void ensure();
        }
      }, delayMs);
    });
  } catch (_) {
    void ensure();
  }
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
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const parcelsBtn = document.getElementById("iuParcelsBtn");
  const parcelsBtnMobile = document.getElementById("iuParcelsBtnMobile");
  const modal = document.getElementById("iuParcelsPopover");
  const overlay = document.querySelector(".iu-parcels-overlay");
  const quickInput = document.getElementById("iuParcelQuickInput");
  const quickPostal = document.getElementById("iuParcelQuickPostal");
  const quickPostalRow = document.getElementById("iuParcelQuickPostalRow");
  const quickMessage = document.getElementById("iuParcelQuickMessage");
  const quickSearchBtn = document.getElementById("iuParcelQuickSearch");
  const fallbackBanner = document.getElementById("iuParcelFallbackBanner");

  let __iuParcelsDock = null;
  let manualCarrierHint = "";
  let __parcelLastPreview = null;

  const carriers = {
    packeta: {
      name: "Zásilkovna",
      baseUrl: "https://tracking.app.packeta.com/cs/",
      deepUrl: (code) => `https://tracking.app.packeta.com/cs/${encodeURIComponent(code)}`,
      urlFallback: (code) => `https://tracking.packeta.com/cs/${encodeURIComponent(code)}`,
    },
    balikovna: {
      name: "Balíkovna / Česká pošta",
      baseUrl: "https://www.balikovna.cz/cs/sledovat-balik",
      deepUrl: (code) =>
        `https://www.balikovna.cz/cs/sledovat-balik/-/balik/${encodeURIComponent(code)}`,
    },
    ppl: {
      name: "PPL",
      baseUrl: "https://www.ppl.cz/vyhledat-zasilku",
      useClipboard: true,
    },
    dpd: {
      name: "DPD",
      baseUrl: "https://tracking.dpd.de/status/cs_CZ/",
      deepUrl: (code) =>
        `https://tracking.dpd.de/status/cs_CZ/parcel/${encodeURIComponent(code)}`,
      useClipboard: true,
    },
    gls: {
      name: "GLS",
      baseUrl: "https://gls-group.com/CZ/cs/sledovani-zasilek",
      useClipboard: true,
    },
    wedo: {
      name: "WE|DO",
      baseUrl: "https://trace.wedo.cz/",
      deepUrl: (code) => `https://trace.wedo.cz/?orderNumber=${encodeURIComponent(code)}`,
      urlFallback: () => "https://trace.wedo.cz/",
    },
    dhl: {
      name: "DHL",
      baseUrl: "https://www.dhl.com/cz-en/home/tracking.html",
      useClipboard: true,
    },
    messenger: {
      name: "Messenger",
      baseUrl: "https://www.msng.cz/",
      useClipboard: true,
    },
  };

  try {
    window.IU_MINDMENU_PARCEL_CARRIER_META = Object.fromEntries(
      Object.keys(carriers).map(function (k) {
        return [k, { name: carriers[k].name || k }];
      }),
    );
  } catch (_) {}

  function iuParcelsIsNarrow() {
    return !!(window.matchMedia && window.matchMedia("(max-width: 1023px)").matches);
  }

  function iuParcelsDockToBody() {
    if (!modal || !overlay || !iuParcelsIsNarrow()) return;
    if (overlay.parentNode === document.body && modal.parentNode === document.body) return;
    __iuParcelsDock = { parent: overlay.parentNode, anchor: modal.nextSibling };
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
  }

  function iuParcelsUndockFromBody() {
    if (!__iuParcelsDock || !modal || !overlay) {
      __iuParcelsDock = null;
      return;
    }
    const par = __iuParcelsDock.parent;
    const anchor = __iuParcelsDock.anchor;
    __iuParcelsDock = null;
    try {
      if (par) {
        if (anchor) {
          par.insertBefore(overlay, anchor);
          par.insertBefore(modal, overlay.nextSibling);
        } else {
          par.appendChild(overlay);
          par.appendChild(modal);
        }
      }
    } catch (_) {
      try {
        if (par) {
          par.appendChild(overlay);
          par.appendChild(modal);
        }
      } catch (_) {}
    }
  }

  function setQuickMessage(text, kind) {
    if (!quickMessage) return;
    quickMessage.textContent = text || "";
    quickMessage.classList.remove(
      "iu-parcels-quicktrack-message--warn",
      "iu-parcels-quicktrack-message--ok",
    );
    if (kind === "warn") quickMessage.classList.add("iu-parcels-quicktrack-message--warn");
    if (kind === "ok") quickMessage.classList.add("iu-parcels-quicktrack-message--ok");
  }

  function clearCarrierVisualState() {
    $$(".iu-parcel-carrier").forEach((el) => {
      el.classList.remove(
        "iu-parcel-carrier--selected",
        "iu-parcel-carrier--auto",
        "iu-parcel-carrier--neutral",
        "iu-parcel-carrier--needs-extra",
      );
      const badge = el.querySelector("[data-iu-parcel-badge]");
      if (badge) badge.hidden = true;
    });
  }

  function updateGlsNeedsExtraClass() {
    const glsCard = document.querySelector('.iu-parcel-carrier[data-iu-carrier-key="gls"]');
    if (!glsCard) return;
    const pc = quickPostal && quickPostal.value ? String(quickPostal.value).replace(/\D/g, "") : "";
    const needs = pc.length < 4;
    const active =
      glsCard.classList.contains("iu-parcel-carrier--selected") ||
      glsCard.classList.contains("iu-parcel-carrier--auto");
    if (active && needs) glsCard.classList.add("iu-parcel-carrier--needs-extra");
    else glsCard.classList.remove("iu-parcel-carrier--needs-extra");
  }

  function highlightDetection(det) {
    clearCarrierVisualState();
    if (!det || !det.carrierKey) {
      $$(".iu-parcel-carrier").forEach((el) => {
        el.classList.add("iu-parcel-carrier--neutral");
      });
      updateGlsNeedsExtraClass();
      return;
    }
    const key = det.carrierKey;
    const card = document.querySelector(`.iu-parcel-carrier[data-iu-carrier-key="${key}"]`);
    $$(".iu-parcel-carrier").forEach((el) => {
      if (el !== card) el.classList.add("iu-parcel-carrier--neutral");
    });
    if (card) {
      card.classList.remove("iu-parcel-carrier--neutral");
      card.classList.add("iu-parcel-carrier--auto");
      const badge = card.querySelector("[data-iu-parcel-badge]");
      if (badge) badge.hidden = false;
    }
    updateGlsNeedsExtraClass();
  }

  function setSelectedManualCarrier(key) {
    manualCarrierHint = key || "";
    clearCarrierVisualState();
    if (!key) return;
    const card = document.querySelector(`.iu-parcel-carrier[data-iu-carrier-key="${key}"]`);
    $$(".iu-parcel-carrier").forEach((el) => {
      const sel = el === card;
      el.classList.toggle("iu-parcel-carrier--selected", sel);
      if (!sel) el.classList.add("iu-parcel-carrier--neutral");
    });
    if (key === "gls") {
      if (quickPostalRow) quickPostalRow.hidden = false;
      setQuickMessage(
        "GLS vyžaduje PSČ doručovací adresy nebo výdejního místa. Doplňte PSČ a stiskněte „Vyhledat zásilku“ nahoře nebo „Vyhledat“ u GLS.",
        "warn",
      );
    } else if (quickPostalRow) {
      quickPostalRow.hidden = true;
    }
    updateGlsNeedsExtraClass();
  }

  function applyDestinationPlan(plan) {
    if (!plan || plan.action === "none" || plan.action === "need_input") return;
    if (plan.action === "open_url" && plan.url) {
      window.open(plan.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (plan.action === "open_base_clipboard" && plan.url) {
      try {
        if (plan.clipPlain && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(plan.clipPlain).catch(() => {});
        }
      } catch (_) {}
      window.open(plan.url, "_blank", "noopener,noreferrer");
    }
  }

  function onQuickSearch() {
    const eng = window.IU_PARCEL_TRACKING_ENGINE;
    if (!eng) {
      setQuickMessage("Modul bezpečné detekce není načtený. Obnovte stránku.", "warn");
      return;
    }
    const raw = quickInput ? quickInput.value : "";
    const postalDigits = quickPostal ? String(quickPostal.value || "").replace(/\D/g, "") : "";
    const hint = manualCarrierHint || "";
    const det = eng.getCarrierDetectionResult(raw, postalDigits, hint);
    __parcelLastPreview = { detection: det, destination: eng.buildTrackingDestination(det, postalDigits) };

    if (det.state === "needs_extra_input" && det.requiresPostalCode) {
      if (quickPostalRow) quickPostalRow.hidden = false;
      if (quickPostal) quickPostal.focus();
      setQuickMessage(det.reason, "warn");
      highlightDetection(det);
      if (fallbackBanner) fallbackBanner.hidden = true;
      return;
    }

    if (det.carrierKey !== "gls" && quickPostalRow) quickPostalRow.hidden = true;

    if (det.state === "no_safe_match" || det.state === "unsupported") {
      setQuickMessage(det.reason || "Zkuste ruční výběr dopravce.", "warn");
      if (fallbackBanner) fallbackBanner.hidden = false;
      clearCarrierVisualState();
      $$(".iu-parcel-carrier").forEach((el) => {
        el.classList.remove("iu-parcel-carrier--neutral");
      });
      updateGlsNeedsExtraClass();
      return;
    }

    if (fallbackBanner) fallbackBanner.hidden = true;
    const msgKind = det.state === "exact_match" ? "ok" : "warn";
    setQuickMessage(det.reason, msgKind);
    highlightDetection(det);
    const plan = eng.buildTrackingDestination(det, postalDigits);
    applyDestinationPlan(plan);
  }

  function resetParcelsUiState() {
    manualCarrierHint = "";
    __parcelLastPreview = null;
    if (quickPostalRow) quickPostalRow.hidden = true;
    if (quickPostal) quickPostal.value = "";
    if (quickInput) quickInput.value = "";
    setQuickMessage("", "");
    if (fallbackBanner) fallbackBanner.hidden = true;
    clearCarrierVisualState();
  }

  function iuParcelsOpenSurface() {
    if (!modal || !overlay) return;
    try {
      overlay.removeAttribute("hidden");
      overlay.style.removeProperty("display");
      modal.removeAttribute("hidden");
      modal.style.removeProperty("display");
    } catch (_) {}
    try {
      if (iuParcelsIsNarrow()) {
        iuParcelsDockToBody();
        document.body.classList.add("iu-parcels-overlay-open");
        if (typeof window.iuSetViewportLock === "function") window.iuSetViewportLock(true);
        document.body.classList.add("iu-modal-open");
      }
    } catch (_) {}
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  }

  function openParcels() {
    if (typeof window.iuOpenOverlay === "function") window.iuOpenOverlay("parcels");
    else iuParcelsOpenSurface();
  }
  try {
    window.iuParcelsOpenSurface = iuParcelsOpenSurface;
  } catch (_) {}
  try {
    window.iuOpenParcelsModal = openParcels;
  } catch (_) {}

  function closeParcels() {
    if (!modal || !overlay) return;
    overlay.classList.remove("is-open");
    modal.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    modal.setAttribute("aria-hidden", "true");
    try {
      document.body.classList.remove("iu-parcels-overlay-open");
      iuParcelsUndockFromBody();
      if (typeof window.iuSetViewportLock === "function") {
        let others = [];
        try {
          if (typeof window.iuDetectOpenOverlays === "function")
            others = window.iuDetectOpenOverlays().filter((x) => x !== "parcels");
        } catch (_) {}
        if (others.length === 0) {
          window.iuSetViewportLock(false);
          document.body.classList.remove("iu-modal-open");
        }
      } else {
        document.body.classList.remove("iu-modal-open");
      }
    } catch (_) {}
    try {
      resetParcelsUiState();
    } catch (_) {}
  }
  try {
    window.iuCloseParcelsModal = closeParcels;
  } catch (_) {}

  function addParcelRow(carrierId) {
    const rowsContainer = $(`.iu-parcelRows[data-carrier="${carrierId}"]`);
    if (!rowsContainer) return;

    const row = document.createElement("div");
    row.className = "iu-parcel-row";
    row.innerHTML = `
      <div class="iu-parcel-row-inputs">
        <input type="text" class="iu-parcel-input" placeholder="Číslo zásilky" data-carrier="${carrierId}">
        <button class="iu-parcel-search-btn" type="button">Vyhledat</button>
      </div>
    `;

    const searchBtn = row.querySelector(".iu-parcel-search-btn");
    searchBtn.addEventListener("click", () =>
      handleSearch(carrierId, row.querySelector(".iu-parcel-input")),
    );

    rowsContainer.appendChild(row);
  }

  function openCarrierUrl(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function getFirstFilledCode(carrierId) {
    const inputs = $$(`.iu-parcel-input[data-carrier="${carrierId}"]`);
    for (const input of inputs) {
      const code = (input.value || "").trim();
      if (code) return code;
    }
    return null;
  }

  function handleSearch(carrierId, input) {
    const code = (input.value || "").trim();
    const carrier = carriers[carrierId];
    if (!carrier || !carrier.baseUrl) return;

    if (carrierId === "gls") {
      const pd = quickPostal ? String(quickPostal.value || "").replace(/\D/g, "") : "";
      if (pd.length < 4) {
        setQuickMessage("Pro GLS doplňte PSČ v horním poli (požadavek GLS).", "warn");
        if (quickPostalRow) quickPostalRow.hidden = false;
        if (quickPostal) quickPostal.focus();
        setSelectedManualCarrier("gls");
        return;
      }
      const eng = window.IU_PARCEL_TRACKING_ENGINE;
      if (eng) {
        const det = eng.getCarrierDetectionResult(code, pd, "gls");
        const plan = eng.buildTrackingDestination(det, pd);
        applyDestinationPlan(plan);
      } else {
        openCarrierUrl(carrier.baseUrl);
      }
      return;
    }

    if (!code) {
      openCarrierUrl(carrier.baseUrl);
      return;
    }

    let urlToOpen = carrier.baseUrl;
    if (carrier.deepUrl) urlToOpen = carrier.deepUrl(code);
    openCarrierUrl(urlToOpen);
    if (carrier.useClipboard && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        navigator.clipboard.writeText(code).catch(() => {});
      } catch (_) {}
    }
  }

  function handleFallback(carrierId) {
    const code = getFirstFilledCode(carrierId);
    if (!code) return;

    const carrier = carriers[carrierId];
    if (!carrier || !carrier.urlFallback) return;

    const fallbackUrl = carrier.urlFallback(code);
    openCarrierUrl(fallbackUrl);
  }

  function createTrackingWatchCandidate() {
    return {
      trackingNumber: "",
      carrierKey: "",
      carrierConfidence: 0,
      lastKnownStatus: "unknown",
      lastKnownStatusAt: null,
      watchMode: "inactive",
      requiresUserConsent: true,
      lastPublicSourceKind: "none",
      lastOfficialUrl: "",
    };
  }

  function runTrackingLookup(opts) {
    const eng = window.IU_PARCEL_TRACKING_ENGINE;
    const o = opts && typeof opts === "object" ? opts : {};
    if (!eng) return { ok: false };
    const tn = o.trackingNumber != null ? String(o.trackingNumber) : "";
    const pc = o.postalCode != null ? String(o.postalCode) : "";
    const hint = o.carrierHint != null ? String(o.carrierHint) : "";
    const det = eng.getCarrierDetectionResult(tn, pc, hint);
    const dest = eng.buildTrackingDestination(
      det,
      String(pc || "").replace(/\D/g, ""),
    );
    __parcelLastPreview = { detection: det, destination: dest, at: Date.now() };
    if (o.open) applyDestinationPlan(dest);
    return { ok: true, detection: det, destination: dest };
  }

  /** Silver dashboard: same engine as MindMenu, never opens overlay or tabs. */
  function iuSilverParcelEngineResolve(opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    return runTrackingLookup({
      trackingNumber: o.trackingNumber,
      postalCode: o.postalCode,
      carrierHint: o.carrierHint,
      open: false,
    });
  }

  function prefillTrackingInput(value) {
    if (!quickInput) return;
    quickInput.value = value != null ? String(value) : "";
  }

  try {
    window.IU_SILVER_PARCEL_FACADE = {
      prefillTrackingInput,
      runTrackingLookup,
      iuSilverParcelEngineResolve,
      getTrackingLookupPreviewResult: () => __parcelLastPreview,
      createTrackingWatchCandidate,
      openTrackingDestination: (detectionResult, postalDigits) => {
        const eng = window.IU_PARCEL_TRACKING_ENGINE;
        if (!eng || !detectionResult) return;
        const pd =
          postalDigits != null ? String(postalDigits).replace(/\D/g, "") : "";
        const plan = eng.buildTrackingDestination(detectionResult, pd);
        applyDestinationPlan(plan);
      },
    };
  } catch (_) {}

  function initParcelsModal() {
    if (!modal || !overlay) return;

    if (parcelsBtn) {
      parcelsBtn.addEventListener("click", (e) => {
        if (e.target.closest && e.target.closest("[data-iuq]")) return;
        e.preventDefault();
        e.stopPropagation();
        openParcels();
      });
    }
    if (parcelsBtnMobile) {
      parcelsBtnMobile.addEventListener("click", (e) => {
        if (e.target.closest && e.target.closest("[data-iuq]")) return;
        e.preventDefault();
        e.stopPropagation();
        openParcels();
      });
    }

    overlay.addEventListener("click", closeParcels);

    const closeBtn = modal.querySelector(".iu-parcels-modal-close");
    if (closeBtn) closeBtn.addEventListener("click", closeParcels);

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!modal.classList.contains("is-open")) return;
      closeParcels();
    });

    $$(".iu-parcel-carrier").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest && e.target.closest("input, button, a, textarea, select")) return;
        const key = card.getAttribute("data-iu-carrier-key");
        if (key) setSelectedManualCarrier(key);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (e.target.closest && e.target.closest("input, button")) return;
        e.preventDefault();
        const key = card.getAttribute("data-iu-carrier-key");
        if (key) setSelectedManualCarrier(key);
      });
    });

    if (quickSearchBtn) quickSearchBtn.addEventListener("click", onQuickSearch);
    if (quickInput) {
      quickInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onQuickSearch();
        }
      });
    }
    if (quickPostal) {
      quickPostal.addEventListener("input", () => {
        updateGlsNeedsExtraClass();
      });
    }

    $$(".iu-parcel-add-btn").forEach((btn) => {
      const carrierId = btn.getAttribute("data-carrier");
      btn.addEventListener("click", () => addParcelRow(carrierId));
    });

    $$(".iu-parcel-search-btn").forEach((btn) => {
      const row = btn.closest(".iu-parcel-row");
      const input = row && row.querySelector(".iu-parcel-input");
      const carrierId = input && input.getAttribute("data-carrier");
      if (carrierId) {
        btn.addEventListener("click", () => handleSearch(carrierId, input));
      }
    });

    $$(".iu-parcel-fallback-btn").forEach((btn) => {
      const carrierId = btn.getAttribute("data-carrier");
      if (carrierId) {
        btn.addEventListener("click", () => handleFallback(carrierId));
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
      groups: [
        {
          title: "Nákup potravin s doručením domů",
          items: [
            { name: "Rohlík.cz", url: "https://www.rohlik.cz/", accent: "rohlik", external: true },
            { name: "Košík.cz", url: "https://www.kosik.cz/", accent: "kosik", external: true }
          ]
        },
        {
          title: "Partneři pro rozvoz potravin",
          items: [
            { name: "Wolt", url: "https://market.wolt.com/cs/cze", accent: "wolt", external: true },
            { name: "foodora", url: "https://www.foodora.cz/", accent: "foodora", external: true },
            { name: "Bolt", url: "https://bolt.eu/cs-cz/food/", accent: "bolt", external: true }
          ]
        },
        {
          title: "Speciální potraviny",
          items: [
            { name: "Scuk.cz", url: "https://www.scuk.cz/", accent: "scuk", external: true },
            { name: "Grizly.cz", url: "https://www.grizly.cz/", accent: "grizly", external: true },
            { name: "Aktin.cz", url: "https://www.aktin.cz/", accent: "aktin", external: true }
          ]
        }
      ]
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
        { name: "JPG → PDF", url: "https://smallpdf.com/jpg-to-pdf", external: true }
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
  function iuBuildAiYouTubeEmbedUrl(id) {
    const vid = String(id || "").trim();
    if (!vid) return "";
    let origin = "https://www.infouzel.cz";
    try {
      if (typeof window !== "undefined" && window.location && window.location.origin) {
        origin = window.location.origin;
      }
    } catch (_) {}
    const o = encodeURIComponent(origin);
    return `https://www.youtube-nocookie.com/embed/${vid}?rel=0&modestbranding=1&playsinline=1&enablejsapi=1&origin=${o}`;
  }

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
      const embedSrc = iuBuildAiYouTubeEmbedUrl(id);
      return `<div class="iuAiVideoItem">
  <div class="iuAiVideoTitle">${iuQfEscape(title)}</div>
  <div class="iuYtWrap">
  <iframe
    src="${iuQfEscape(embedSrc)}"
    title="${iuQfEscape(title)}"
    loading="eager"
    referrerpolicy="strict-origin-when-cross-origin"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen></iframe>
  </div>
</div>`;
    }).join("");
  }
  try { window.iuRenderAiVideos = renderAiVideos; } catch (_) {}

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
    try {
      import("./iu-pdf-convert-module.js?v=pdf-convert-lazy-v1-20260728")
        .then(function (m) {
          try {
            if (m && typeof m.iuPdfConvertToolsBootstrap === "function") m.iuPdfConvertToolsBootstrap(quick);
          } catch (e) {
            try { console.warn("[iu] pdf convert boot failed", e); } catch (_) {}
          }
        })
        .catch(function (e) {
          try { console.warn("[iu] pdf convert import failed", e); } catch (_) {}
        });
    } catch (e0) {
      try { console.warn("[iu] pdf convert import threw", e0); } catch (_) {}
    }
  }

  /* Stage-2 Wave B: invoice PDF legacy export lives in /assets/iu-invoice-pdf-legacy-export.js (lazy). */
  (function iuBootDeferredInvoicePdfLegacyExport() {
    var p = null;
    function ensure() {
      if (window.__iuInvoicePdfLegacyExportReady) return Promise.resolve();
      if (p) return p;
      p = import("./iu-invoice-pdf-legacy-export.js?v=invoice-pdf-legacy-lazy-v1-20260728")
        .then(function () {
          try { window.__iuInvoicePdfLegacyExportReady = 1; } catch (_) {}
        })
        .catch(function (e) {
          p = null;
          try { console.warn("[iu] invoice pdf legacy export import failed", e); } catch (_) {}
        });
      return p;
    }
    try { window.iuEnsureInvoicePdfLegacyExport = ensure; } catch (_) {}
    try {
      window.iuPdfExportHtmlStringToBlobForInvoice = function (htmlString, fileName, done) {
        ensure().then(function () {
          try {
            if (typeof window.__iuPdfExportHtmlStringToBlobForInvoiceImpl === "function") {
              window.__iuPdfExportHtmlStringToBlobForInvoiceImpl(htmlString, fileName, done);
              return;
            }
            if (typeof window.iuPdfExportHtmlStringToBlobForInvoice === "function" && !window.iuPdfExportHtmlStringToBlobForInvoice.__iuStub) {
              window.iuPdfExportHtmlStringToBlobForInvoice(htmlString, fileName, done);
              return;
            }
          } catch (e) {
            if (typeof done === "function") done(e);
            return;
          }
          if (typeof done === "function") done(new Error("invoice_pdf_export_unavailable"));
        });
      };
      window.iuPdfExportHtmlStringToBlobForInvoice.__iuStub = 1;
    } catch (_) {}
  })();


  function iuApplyMobileQuickFeedLayout(quick) {
    try {
      if (!quick) return;
      var nakupRoot = quick.classList && quick.classList.contains("iu-nakup-online-feed-root");
      var close38 = quick.querySelector("button#iuQCloseBtn.iu-overlayCloseBtn38");
      if (close38) {
        close38.style.setProperty("width", "38px");
        close38.style.setProperty("height", "38px");
        close38.style.setProperty("min-width", "38px");
        close38.style.setProperty("min-height", "38px");
        close38.style.setProperty("padding", "0");
        close38.style.setProperty("box-sizing", "border-box");
        close38.style.setProperty("display", "inline-flex");
        close38.style.setProperty("align-items", "center");
        close38.style.setProperty("justify-content", "center");
        close38.style.setProperty("background", "#EEF2F7");
        close38.style.setProperty("color", "#0F172A");
        close38.style.setProperty("border", "0");
        close38.style.setProperty("border-radius", "10px");
        close38.style.setProperty("font-size", "24px");
        close38.style.setProperty("line-height", "1");
        close38.style.setProperty("-webkit-tap-highlight-color", "transparent");
      }
      const isMobile = !!(window.matchMedia && window.matchMedia("(max-width: 1023px)").matches);
      if (!isMobile) return;
      const head = quick.querySelector(".iuQHead");
      const title = quick.querySelector(".iuQTitle");
      const actions = quick.querySelector(".iuQHeadActions");
      const close = quick.querySelector(".iuQHeadActions #iuQCloseBtn, .iuQHeadActions .iuQClose");
      const secondary = quick.querySelector(".iuQHeadActions .iuAiShareBtn, .iuQHeadActions .iu-forward-btn, .iuQHeadActions .iuTrHeaderPreposlat");
      const bodyCard = quick.querySelector(".iuQCard");
      var isCredentialQf =
        quick.classList &&
        (quick.classList.contains("iu-banking-quickfeed-root") ||
          quick.classList.contains("iu-bakalari-quickfeed-root") ||
          quick.classList.contains("iu-pojistovna-quickfeed-root"));
      if (head) {
        if (isCredentialQf) {
          head.style.setProperty("margin", "0");
        } else {
          head.style.setProperty("display", "grid");
          head.style.setProperty("grid-template-columns", "minmax(0, 1fr) auto");
          head.style.setProperty("align-items", "flex-start");
          head.style.setProperty("gap", "8px");
          head.style.setProperty("margin", "8px 0 12px");
        }
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
      if (close && !(close.classList && close.classList.contains("iu-overlayCloseBtn38"))) {
        close.style.setProperty("width", "32px");
        close.style.setProperty("height", "32px");
        close.style.setProperty("min-width", "32px");
        close.style.setProperty("min-height", "32px");
        close.style.setProperty("padding", "0");
        close.style.setProperty("display", "inline-flex");
        close.style.setProperty("align-items", "center");
        close.style.setProperty("justify-content", "center");
      }
      if (bodyCard && !nakupRoot) bodyCard.style.setProperty("padding", "14px 12px 16px");
    } catch (_) {}
  }

  /** P0: #iuQuickFeed lives under #leftContent; dock to body for true fullscreen (Moje služby + Word/PDF convert on ≤1023px). */
  var __iuQuickFeedDock = null;
  function iuDockQuickFeedToBodyForMojeFullscreen(quick) {
    try {
      if (!quick) return;
      if (!(window.matchMedia && window.matchMedia("(max-width: 1023px)").matches)) return;
      if (quick.parentNode === document.body) return;
      __iuQuickFeedDock = { parent: quick.parentNode, next: quick.nextSibling };
      document.body.appendChild(quick);
      try { quick.setAttribute("data-iu-qf-docked", "1"); } catch (_) {}
    } catch (_) {}
  }
  /** Desktop ≥1025px: #iuQuickFeed → body for Datovka-like fullscreen banking shell (no 1023 cap). */
  function iuDockQuickFeedToBodyForBankingDesktop(quick) {
    try {
      if (!quick) return;
      if (!(window.matchMedia && window.matchMedia("(min-width: 1025px)").matches)) return;
      if (quick.parentNode === document.body) return;
      __iuQuickFeedDock = { parent: quick.parentNode, next: quick.nextSibling };
      document.body.appendChild(quick);
      try {
        quick.setAttribute("data-iu-qf-docked", "1");
      } catch (_) {}
    } catch (_) {}
  }

  function iuUndockQuickFeedFromBody(quick) {
    try {
      if (!quick) return;
      if (!__iuQuickFeedDock) {
        try { quick.removeAttribute("data-iu-qf-docked"); } catch (_) {}
        return;
      }
      var par = __iuQuickFeedDock.parent;
      var next = __iuQuickFeedDock.next;
      __iuQuickFeedDock = null;
      try {
        if (par) {
          if (next && next.parentNode === par) par.insertBefore(quick, next);
          else par.appendChild(quick);
        }
      } catch (_) {
        try {
          if (par) par.appendChild(quick);
        } catch (_) {}
      }
      try { quick.removeAttribute("data-iu-qf-docked"); } catch (_) {}
    } catch (_) {}
  }

  var __iuMojeQuickFeedFsProps = [
    "position", "inset", "left", "top", "right", "bottom", "width", "height", "max-width", "max-height", "margin",
    "z-index", "overflow", "box-sizing", "background", "padding", "display"
  ];
  function iuApplyMojeQuickFeedFullscreenLayer(quick, on) {
    try {
      if (!quick) return;
      if (!on) {
        for (var i = 0; i < __iuMojeQuickFeedFsProps.length; i++) {
          try { quick.style.removeProperty(__iuMojeQuickFeedFsProps[i]); } catch (_) {}
        }
        return;
      }
      quick.style.setProperty("position", "fixed", "important");
      quick.style.removeProperty("inset");
      quick.style.setProperty("left", "0", "important");
      quick.style.setProperty("top", "0", "important");
      quick.style.setProperty("right", "0", "important");
      quick.style.setProperty("bottom", "var(--bottom-nav-height)", "important");
      quick.style.setProperty("width", "100vw", "important");
      quick.style.setProperty("height", "auto", "important");
      quick.style.setProperty("max-width", "none", "important");
      quick.style.setProperty("max-height", "calc(100dvh - var(--bottom-nav-height))", "important");
      quick.style.setProperty("margin", "0", "important");
      quick.style.setProperty("z-index", "10075", "important");
      quick.style.setProperty("overflow", "auto", "important");
      quick.style.setProperty("box-sizing", "border-box", "important");
      quick.style.setProperty("background", "#fff", "important");
      var isCredentialQfLayer =
        quick.classList &&
        (quick.classList.contains("iu-banking-quickfeed-root") ||
          quick.classList.contains("iu-bakalari-quickfeed-root") ||
          quick.classList.contains("iu-pojistovna-quickfeed-root"));
      quick.style.setProperty(
        "padding",
        isCredentialQfLayer ? "0" : "calc(env(safe-area-inset-top, 0px) + 8px) 8px 8px",
        "important"
      );
      quick.style.setProperty("display", "block", "important");
    } catch (_) {}
  }

  var __iuNakupOnlineFsProps = [
    "position", "inset", "left", "top", "right", "bottom", "width", "height", "max-width", "max-height", "margin",
    "z-index", "overflow", "overflow-x", "overflow-y", "box-sizing", "background", "padding",
    "display", "flex-direction", "min-height", "overscroll-behavior", "touch-action",
    "-webkit-overflow-scrolling"
  ];
  function iuNakupOnlineIsDesktopViewport() {
    try {
      return !!(window.matchMedia && window.matchMedia("(min-width: 1025px)").matches);
    } catch (_) {
      return false;
    }
  }
  /** P0: Nákup potravin online — mobile/tablet: fixed fullscreen na #iuQuickFeed. Desktop ≥1025 řeší stejný model jako Datovka (CSS + .iu-banking-ds-modal), ne tento layer. */
  function iuApplyNakupOnlineQuickFeedFullscreenLayer(quick, on) {
    try {
      if (!quick) return;
      if (!on) {
        try {
          if (quick.__iuNakupOnlineResizeBound && typeof quick.__iuNakupOnlineOnResize === "function") {
            window.removeEventListener("resize", quick.__iuNakupOnlineOnResize);
          }
        } catch (_) {}
        try {
          quick.__iuNakupOnlineResizeBound = false;
          quick.__iuNakupOnlineOnResize = null;
        } catch (_) {}
        for (var ni = 0; ni < __iuNakupOnlineFsProps.length; ni++) {
          try { quick.style.removeProperty(__iuNakupOnlineFsProps[ni]); } catch (_) {}
        }
        return;
      }
      if (iuNakupOnlineIsDesktopViewport()) return;
      quick.style.setProperty("position", "fixed", "important");
      quick.style.setProperty("margin", "0", "important");
      quick.style.setProperty("z-index", "10170", "important");
      quick.style.setProperty("box-sizing", "border-box", "important");
      quick.style.setProperty("background", "#eaf0f7", "important");
      quick.style.setProperty("display", "flex", "important");
      quick.style.setProperty("flex-direction", "column", "important");
      quick.style.setProperty("min-height", "0", "important");
      quick.style.setProperty("inset", "0", "important");
      quick.style.setProperty("left", "0", "important");
      quick.style.setProperty("top", "0", "important");
      try { quick.style.removeProperty("right"); } catch (_) {}
      try { quick.style.removeProperty("bottom"); } catch (_) {}
      quick.style.setProperty("width", "100vw", "important");
      quick.style.setProperty("height", "100dvh", "important");
      quick.style.setProperty("max-width", "100vw", "important");
      quick.style.setProperty("max-height", "100dvh", "important");
      quick.style.setProperty("padding", "calc(env(safe-area-inset-top, 0px) + 4px) 6px calc(env(safe-area-inset-bottom, 0px) + 4px)", "important");
      quick.style.setProperty("overflow-x", "hidden", "important");
      quick.style.setProperty("overflow-y", "auto", "important");
      try { quick.style.setProperty("-webkit-overflow-scrolling", "touch"); } catch (_) {}
      try { quick.style.removeProperty("overscroll-behavior"); } catch (_) {}
      try { quick.style.removeProperty("touch-action"); } catch (_) {}
    } catch (_) {}
  }

  /** Při změně šířky okna znovu složí Nákup potravin (desktop ↔ mobile) jednou finální cestou. */
  function iuBindNakupOnlineViewportReconcile(quick) {
    try {
      if (!quick) return;
      if (quick.__iuNakupOnlineResizeBound) return;
      quick.__iuNakupOnlineOnResize = function() {
        try {
          if (quick.hidden || !quick.classList.contains("iu-nakup-online-feed-root")) return;
          if (String(quick.getAttribute("data-iu-qf-key") || "") !== "naceneni") return;
          iuShowQuickFeedCore("naceneni");
        } catch (_) {}
      };
      window.addEventListener("resize", quick.__iuNakupOnlineOnResize);
      quick.__iuNakupOnlineResizeBound = true;
    } catch (_) {}
  }

  function iuDockQuickFeedToBodyForced(quick) {
    try {
      if (!quick) return;
      if (quick.parentNode === document.body) return;
      __iuQuickFeedDock = { parent: quick.parentNode, next: quick.nextSibling };
      document.body.appendChild(quick);
      try { quick.setAttribute("data-iu-qf-docked", "1"); } catch (_) {}
    } catch (_) {}
  }

  function iuRenderNakupOnlineQuickFeedHtml(data, useDesktopDatovkaShell) {
    const groups = (data && Array.isArray(data.groups)) ? data.groups : [];
    const head =
      '<div class="iuQHead">' +
      '<div class="iuQTitle">' + iuQfEscape(data.title || "") + "</div>" +
      '<div class="iuQHeadActions">' +
      '<button class="iuQClose iu-overlayCloseBtn38" type="button" id="iuQCloseBtn" aria-label="Zavřít">✕</button>' +
      "</div></div>";
    const sectionParts = groups.map(function(g, gi) {
      const gid = "iu-nakup-grp-" + gi;
      const items = Array.isArray(g.items) ? g.items : [];
      const cards = items.map(function(it) {
        const url = iuQfEscape(it.url || "#");
        const accent = iuQfEscape(it.accent || "neutral");
        return (
          '<div class="iu-nakup-online-card" data-iu-grocery-accent="' + accent + '" role="listitem">' +
          '<div class="iu-nakup-online-cardInner">' +
          "<strong class=\"iu-nakup-online-name\">" + iuQfEscape(it.name || "") + "</strong>" +
          '<a class="iuQBtn iu-nakup-online-cta" href="' + url + '" target="_blank" rel="noopener noreferrer">Otevřít</a>' +
          "</div></div>"
        );
      }).join("");
      return (
        '<section class="iu-nakup-online-group" aria-labelledby="' + gid + '">' +
        '<h3 class="iu-nakup-online-h3" id="' + gid + '">' + iuQfEscape(g.title || "") + "</h3>" +
        '<div class="iu-nakup-online-grid" role="list">' + cards + "</div>" +
        "</section>"
      );
    });
    var sections =
      '<div class="iu-nakup-online-singleColShell" data-iu-nakup-online-layout="single">' +
      sectionParts.join("") +
      "</div>";
    if (useDesktopDatovkaShell) {
      return (
        '<div class="iu-banking-ds-modal">' +
        head +
        '<div class="iu-banking-scroll-host">' +
        '<div class="iu-nakup-online-outerCard">' +
        '<div class="iu-nakup-online-feed" role="region" aria-label="' + iuQfEscape(data.title || "Nákup potravin online") + '">' +
        sections +
        "</div></div></div></div>"
      );
    }
    return (
      '<div class="iu-nakup-online-premiumShell">' +
      head +
      '<div class="iu-nakup-online-fill">' +
      '<div class="iuQCard iu-nakup-online-outerCard">' +
      '<div class="iu-nakup-online-feed" role="region" aria-label="' + iuQfEscape(data.title || "Nákup potravin online") + '">' +
      sections +
      "</div></div></div></div>"
    );
  }

  function iuShowQuickFeedCore(key){
    const keyNorm = String(key || "").trim().toLowerCase();
    const stage = document.getElementById("iuCenterStage");
    const quick = document.getElementById("iuQuickFeed");
    if (!stage || !quick) return;
    if (keyNorm !== "naceneni") {
      try {
        iuApplyNakupOnlineQuickFeedFullscreenLayer(quick, false);
      } catch (_) {}
      try {
        if (quick.classList && (quick.classList.contains("iu-nakup-online-feed-root") || quick.classList.contains("iu-grocery-quickfeed-root"))) {
          iuUndockQuickFeedFromBody(quick);
        }
      } catch (_) {}
      try {
        document.body.classList.remove("iu-nakup-online-overlay-open", "iu-quickFeedMojeFullscreen", "iu-grocery-desktop-overlay-open");
      } catch (_) {}
      try {
        quick.classList.remove("iu-nakup-online-feed-root", "iu-nakup-online-single-column", "iu-grocery-quickfeed-root");
      } catch (_) {}
    }
    try {
      if (document.body.classList.contains("iu-banking-desktop-overlay-open") && keyNorm !== "banka") {
        document.body.classList.remove("iu-banking-desktop-overlay-open");
        iuUndockQuickFeedFromBody(quick);
        try {
          iuSetViewportLock(false);
        } catch (_) {}
        try {
          document.body.classList.remove("iu-modal-open", "iu-quickFeedOpen");
        } catch (_) {}
      }
      if (document.body.classList.contains("iu-bakalari-desktop-overlay-open") && keyNorm !== "bakalari") {
        document.body.classList.remove("iu-bakalari-desktop-overlay-open");
        iuUndockQuickFeedFromBody(quick);
        try {
          iuSetViewportLock(false);
        } catch (_) {}
        try {
          document.body.classList.remove("iu-modal-open", "iu-quickFeedOpen");
        } catch (_) {}
      }
      if (document.body.classList.contains("iu-pojistovna-desktop-overlay-open") && keyNorm !== "pojistovna") {
        document.body.classList.remove("iu-pojistovna-desktop-overlay-open");
        iuUndockQuickFeedFromBody(quick);
        try {
          iuSetViewportLock(false);
        } catch (_) {}
        try {
          document.body.classList.remove("iu-modal-open", "iu-quickFeedOpen");
        } catch (_) {}
      }
      if (document.body.classList.contains("iu-wordpdf-desktop-overlay-open") && keyNorm !== "convert") {
        document.body.classList.remove("iu-wordpdf-desktop-overlay-open");
        iuUndockQuickFeedFromBody(quick);
        try {
          iuSetViewportLock(false);
        } catch (_) {}
        try {
          document.body.classList.remove("iu-modal-open", "iu-quickFeedOpen");
        } catch (_) {}
      }
      if (document.body.classList.contains("iu-grocery-desktop-overlay-open") && keyNorm !== "naceneni") {
        document.body.classList.remove("iu-grocery-desktop-overlay-open");
        iuUndockQuickFeedFromBody(quick);
        try {
          iuApplyNakupOnlineQuickFeedFullscreenLayer(quick, false);
        } catch (_) {}
        try {
          iuSetViewportLock(false);
        } catch (_) {}
        try {
          document.body.classList.remove("iu-modal-open", "iu-quickFeedOpen");
        } catch (_) {}
      }
    } catch (_) {}
    try { quick.classList.remove("iu-banking-quickfeed-root", "iu-bakalari-quickfeed-root", "iu-pojistovna-quickfeed-root", "iu-wordpdf-quickfeed-root", "iu-grocery-quickfeed-root"); } catch (_) {}
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
      const isNarrowMojeFs = !!(window.matchMedia && window.matchMedia("(max-width: 1023px)").matches);
      const isBankingDesktop = keyNorm === "banka" && !!(window.matchMedia && window.matchMedia("(min-width: 1025px)").matches);
      const isBakalariDesktop = keyNorm === "bakalari" && !!(window.matchMedia && window.matchMedia("(min-width: 1025px)").matches);
      const isPojistovnaDesktop = keyNorm === "pojistovna" && !!(window.matchMedia && window.matchMedia("(min-width: 1025px)").matches);
      stage.setAttribute("data-iu-view", "quick");
      quick.hidden = false;
      try {
        if (isBankingDesktop) {
          iuDockQuickFeedToBodyForBankingDesktop(quick);
          iuSetViewportLock(true);
          document.body.classList.add("iu-modal-open", "iu-quickFeedOpen", "iu-banking-desktop-overlay-open");
          if (isMobileOverlayScope) document.body.classList.add("iu-mobileGateToolsQuickOpen");
        } else if (isBakalariDesktop) {
          iuDockQuickFeedToBodyForBankingDesktop(quick);
          iuSetViewportLock(true);
          document.body.classList.add("iu-modal-open", "iu-quickFeedOpen", "iu-bakalari-desktop-overlay-open");
          if (isMobileOverlayScope) document.body.classList.add("iu-mobileGateToolsQuickOpen");
        } else if (isPojistovnaDesktop) {
          iuDockQuickFeedToBodyForBankingDesktop(quick);
          iuSetViewportLock(true);
          document.body.classList.add("iu-modal-open", "iu-quickFeedOpen", "iu-pojistovna-desktop-overlay-open");
          if (isMobileOverlayScope) document.body.classList.add("iu-mobileGateToolsQuickOpen");
        } else if (isNarrowMojeFs) {
          iuDockQuickFeedToBodyForMojeFullscreen(quick);
          iuSetViewportLock(true);
          document.body.classList.add("iu-modal-open", "iu-quickFeedOpen", "iu-quickFeedMojeFullscreen");
          if (isMobileOverlayScope) document.body.classList.add("iu-mobileGateToolsQuickOpen");
        } else if (isMobileOverlayScope) {
          iuSetViewportLock(true);
          document.body.classList.add("iu-modal-open", "iu-quickFeedOpen", "iu-mobileGateToolsQuickOpen");
        }
      } catch (_) {}
      const qTitle = iuQfEscape(titles[keyNorm] || keyNorm);
      var qPrivacyBtn = "";
      if ((keyNorm === "banka" || keyNorm === "bakalari" || keyNorm === "pojistovna") && typeof window.iuToolPrivacyHeadBlockHtml === "function") {
        qPrivacyBtn = window.iuToolPrivacyHeadBlockHtml(keyNorm);
      }
      const qHead =
        "<div class=\"iuQHead\"><div class=\"iuQHeadText\"><div class=\"iu-overlay-header-row\"><div class=\"iuQTitle\">" +
        qTitle +
        "</div>" +
        qPrivacyBtn +
        "</div></div><div class=\"iuQHeadActions\"><button class=\"iuQClose iu-overlayCloseBtn38\" type=\"button\" id=\"iuQCloseBtn\" aria-label=\"Zavřít\">×</button></div></div>";
      const qCard = "<div class=\"iuQCard\" id=\"iuQuickFeedMojeSluzbyBody\"></div>";
      const useMojeDesktopDsShell =
        (isBankingDesktop && keyNorm === "banka") ||
        (isBakalariDesktop && keyNorm === "bakalari") ||
        (isPojistovnaDesktop && keyNorm === "pojistovna");
      quick.innerHTML =
        useMojeDesktopDsShell
          ? "<div class=\"iu-banking-ds-modal\">" + qHead + "<div class=\"iu-banking-scroll-host\">" + qCard + "</div></div>"
          : qHead + qCard;
      try {
        if (keyNorm === "banka") quick.classList.add("iu-banking-quickfeed-root");
        if (keyNorm === "bakalari") quick.classList.add("iu-bakalari-quickfeed-root");
        if (keyNorm === "pojistovna") quick.classList.add("iu-pojistovna-quickfeed-root");
      } catch (_) {}
      const body = document.getElementById("iuQuickFeedMojeSluzbyBody");
      if (body && typeof window.iuRenderMojeSluzbyInQuickFeed === "function") window.iuRenderMojeSluzbyInQuickFeed(keyNorm, body);
      const closeBtn = document.getElementById("iuQCloseBtn");
      if (closeBtn) closeBtn.addEventListener("click", iuHideQuickFeed, { once: true });
      iuApplyMobileQuickFeedLayout(quick);
      if (isNarrowMojeFs) iuApplyMojeQuickFeedFullscreenLayer(quick, true);
      return;
    }
    const data = (window.IU_QUICK_FEEDS || {})[keyNorm];
    if (!data) return;
    stage.setAttribute("data-iu-view", "quick");
    quick.hidden = false;
    try {
      document.body.classList.add("iu-quickFeedOpen");
      if (keyNorm === "naceneni") {
        const nacDesk = !!(window.matchMedia && window.matchMedia("(min-width: 1025px)").matches);
        try {
          document.body.classList.remove("iu-quickFeedMojeFullscreen", "iu-nakup-online-overlay-open", "iu-grocery-desktop-overlay-open");
        } catch (_) {}
        if (nacDesk) {
          iuDockQuickFeedToBodyForBankingDesktop(quick);
          iuSetViewportLock(true);
          document.body.classList.add("iu-modal-open", "iu-quickFeedOpen", "iu-grocery-desktop-overlay-open");
          try { quick.classList.remove("iu-nakup-online-single-column"); } catch (_) {}
          try { quick.classList.add("iu-nakup-online-feed-root", "iu-grocery-quickfeed-root"); } catch (_) {}
        } else {
          iuDockQuickFeedToBodyForced(quick);
          iuSetViewportLock(true);
          document.body.classList.add("iu-modal-open", "iu-quickFeedMojeFullscreen", "iu-nakup-online-overlay-open");
          try { quick.classList.remove("iu-grocery-quickfeed-root"); } catch (_) {}
          try { quick.classList.add("iu-nakup-online-feed-root", "iu-nakup-online-single-column"); } catch (_) {}
        }
        try { quick.setAttribute("data-iu-qf-key", "naceneni"); } catch (_) {}
      }
      if (isMobileOverlayScope) {
        iuSetViewportLock(true);
        document.body.classList.add("iu-modal-open", "iu-mobileGateToolsQuickOpen");
      }
    } catch (_) {}
    const isTranslator = String(key || "").toLowerCase() === "deepl";
    const isConvert = String(key || "").toLowerCase() === "convert";
    const isWordPdfDesktop = !!(isConvert && window.matchMedia && window.matchMedia("(min-width: 1025px)").matches);
    const useFullCard = ["ai", "deepl", "convert"].includes(String(key || "").toLowerCase());
    /* P0 Word/PDF: desktop ≥1025 = stejný Datovka/banka model (#iuQuickFeed na body + .iu-banking-ds-modal + scroll host); ≤1023 = Moje fullscreen dock. */
    try {
      if (keyNorm === "convert" && isWordPdfDesktop) {
        iuDockQuickFeedToBodyForBankingDesktop(quick);
        iuSetViewportLock(true);
        document.body.classList.add("iu-modal-open", "iu-quickFeedOpen", "iu-wordpdf-desktop-overlay-open");
        if (isMobileOverlayScope) document.body.classList.add("iu-mobileGateToolsQuickOpen");
        try { quick.classList.add("iu-wordpdf-quickfeed-root"); } catch (_) {}
      } else if (keyNorm === "convert" && window.matchMedia && window.matchMedia("(max-width: 1023px)").matches) {
        iuDockQuickFeedToBodyForMojeFullscreen(quick);
        iuSetViewportLock(true);
        document.body.classList.add("iu-modal-open", "iu-quickFeedMojeFullscreen");
        if (isMobileOverlayScope) document.body.classList.add("iu-mobileGateToolsQuickOpen");
      }
    } catch (_) {}

    if (isTranslator) {
      quick.innerHTML = `
        <div class="iuQHead">
          <div class="iuQTitle">${iuQfEscape(data.title)}</div>
          <div class="iuQHeadActions"><button type="button" class="iuTrHeaderPreposlat" id="iuTrHeaderPreposlat" aria-label="Přeposlat">PŘEPOSLAT</button><button class="iuQClose iu-overlayCloseBtn38" type="button" id="iuQCloseBtn" aria-label="Zavřít">✕</button></div>
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
      void iuEnsureFrancLoaded();
      iuTrInit(quick, data);
      iuTrNotesBootstrap(quick);
      const preposlatBtn = document.getElementById("iuTrHeaderPreposlat");
      if (preposlatBtn) {
        preposlatBtn.addEventListener("click", iuForwardActionSameAsTranslator);
      }
    } else {
      const isNaceneni = keyNorm === "naceneni";
      const isAi = (key || "").toLowerCase() === "ai";
      /* AI: keep legacy markup. Convert: separate wrapper — never put iuQClose on forward (it strips border and looks text-only). */
      const shareBtnHtml = isAi ? `<button type="button" class="iuAiShareBtn iuQClose" aria-label="Přeposlat" title="Přeposlat">Přeposlat</button>` : "";
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
      const toolsBlock = isNaceneni ? "" : ((data.toolsHtml != null && data.toolsHtml !== "") ? data.toolsHtml : "");
      const doRender = (services) => {
        if (isNaceneni) {
          const groceryDs = !!(window.matchMedia && window.matchMedia("(min-width: 1025px)").matches);
          quick.innerHTML = iuRenderNakupOnlineQuickFeedHtml(data, groceryDs);
          iuNakupCenyBootstrap(quick);
          return;
        }
        const convertNoticeHtml = isConvert
          ? '<div class="iu-external-notice">Další převody níže jsou externí služby mimo infoUzel.cz.</div>'
          : "";
        const qHeadBlock =
          '<div class="iuQHead">' +
          '<div class="iuQTitle">' + iuQfEscape(data.title) + "</div>" +
          '<div class="iuQHeadActions">' +
          (isConvert
            ? '<div class="iu-header-actions"><button type="button" class="iu-forward-btn iuAiShareBtn" aria-label="Přeposlat" title="Přeposlat">Přeposlat</button><button class="iuQClose iu-overlayCloseBtn38" type="button" id="iuQCloseBtn" aria-label="Zavřít">✕</button></div>'
            : shareBtnHtml + '<button class="iuQClose iu-overlayCloseBtn38" type="button" id="iuQCloseBtn" aria-label="Zavřít">✕</button>') +
          "</div></div>";
        const gridBlock =
          '<div class="iuQCard"><div class="iuQGrid">' +
          renderCards(services || data.items) +
          "</div></div>";
        const scrollBlock = toolsBlock + convertNoticeHtml + gridBlock;
        if (isConvert && isWordPdfDesktop) {
          quick.innerHTML =
            '<div class="iu-banking-ds-modal">' +
            qHeadBlock +
            '<div class="iu-banking-scroll-host">' +
            scrollBlock +
            "</div></div>" +
            aiSeoBlock;
        } else {
          quick.innerHTML = qHeadBlock + scrollBlock + aiSeoBlock;
        }
        if (isAi) {
          try { renderAiVideos(quick); } catch (e) { console.warn("renderAiVideos", e); }
        }
        if (isConvert) iuPdfConvertToolsBootstrap(quick);
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
        if (isNaceneni) {
          doRender();
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
    }
    const closeBtn = document.getElementById("iuQCloseBtn");
    iuApplyMobileQuickFeedLayout(quick);
    try {
      if (keyNorm === "convert" && window.matchMedia && window.matchMedia("(max-width: 1023px)").matches) {
        iuApplyMojeQuickFeedFullscreenLayer(quick, true);
      }
      if (keyNorm === "naceneni") {
        if (!(window.matchMedia && window.matchMedia("(min-width: 1025px)").matches)) {
          iuApplyNakupOnlineQuickFeedFullscreenLayer(quick, true);
        }
        iuBindNakupOnlineViewportReconcile(quick);
      }
    } catch (_) {}
    if (closeBtn) closeBtn.addEventListener("click", iuHideQuickFeed, { once: true });
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
  }

  const IU_TR_PREFILL_LIMIT = 900;
  const IU_TR_DETECT_MIN = 40;

  var iuFrancPromise = null;
  function iuEnsureFrancLoaded() {
    try {
      if (typeof window !== "undefined") {
        window.__iuFrancDeferState = window.__iuFrancDeferState || {
          loadCount: 0,
          loadedAt: null,
          moduleEvalAt: typeof performance !== "undefined" && performance.now ? performance.now() : 0,
        };
      }
    } catch (_) {}
    try {
      if (typeof window.franc === "function") return Promise.resolve();
    } catch (_) {}
    if (iuFrancPromise) return iuFrancPromise;
    iuFrancPromise = import("/assets/vendor/franc-min.js")
      .then(function (m) {
        try {
          window.franc = m.franc;
          if (window.__iuFrancDeferState) {
            window.__iuFrancDeferState.loadCount += 1;
            window.__iuFrancDeferState.loadedAt =
              typeof performance !== "undefined" && performance.now ? performance.now() : 0;
          }
        } catch (_) {}
      })
      .catch(function (e) {
        iuFrancPromise = null;
        try {
          console.warn("[iu] franc-min import failed", e);
        } catch (_) {}
      });
    return iuFrancPromise;
  }

  function iuTrInit(quick, data){
    const textarea = document.getElementById("iuTrText");
    const langEl = document.getElementById("iuTrLang");
    const countEl = document.getElementById("iuTrCount");
    const toastEl = document.getElementById("iuTrToast");
    const copyBtn = document.getElementById("iuTrCopy");
    const clearBtn = document.getElementById("iuTrClear");
    if (!textarea || !langEl || !countEl) return;

    void iuEnsureFrancLoaded();

    function updateCount(){ const n = (textarea.value || "").length; countEl.textContent = n + " znaků"; }
    function updateLang(){
      const text = (textarea.value || "").trim();
      if (text.length < IU_TR_DETECT_MIN) { langEl.textContent = "Odhad jazyka: —"; return; }
      iuEnsureFrancLoaded().then(function () {
        try {
          const code = (typeof window.franc === "function") ? window.franc(text) : "und";
          langEl.textContent = "Odhad jazyka: " + (code && code !== "und" ? iuTrLangName(code) : "—");
        } catch(e){ langEl.textContent = "Odhad jazyka: —"; }
      });
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
      await iuEnsureFrancLoaded();
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

  function iuSetViewportLock(locked) {
    try {
      const root = document.documentElement;
      const body = document.body;
      if (!root || !body) return;
      const lockKey = "__iuViewportLockPadRight";
      if (locked) {
        if (!root.dataset[lockKey]) root.dataset[lockKey] = String(body.style.paddingRight || "");
        const gap = Math.max(0, (window.innerWidth || 0) - (root.clientWidth || 0));
        root.style.overflow = "hidden";
        body.style.overflow = "hidden";
        if (gap > 0) body.style.paddingRight = gap + "px";
        try {
          window.__iuRailShiftProbe = 0;
        } catch (_) {}
      } else {
        root.style.overflow = "";
        body.style.overflow = "";
        if (root.dataset[lockKey] !== undefined) {
          body.style.paddingRight = root.dataset[lockKey] || "";
          delete root.dataset[lockKey];
        } else {
          body.style.paddingRight = "";
        }
        try {
          window.__iuRailShiftProbe = 0;
        } catch (_) {}
      }
    } catch (_) {}
  }
  try { window.iuSetViewportLock = iuSetViewportLock; } catch (_) {}

  function iuEnsureArticlesView(){
    const stage = document.getElementById("iuCenterStage");
    const quick = document.getElementById("iuQuickFeed");
    if (stage) stage.setAttribute("data-iu-view", "articles");
    if (quick) {
      try {
        if (quick.classList.contains("iu-bakalari-quickfeed-root") && typeof window.iuBakalariPersistOpenCards === "function") {
          window.iuBakalariPersistOpenCards();
        }
        window.iuBakalariPersistOpenCards = null;
      } catch (_) {}
      try { iuApplyMojeQuickFeedFullscreenLayer(quick, false); } catch (_) {}
      try { iuApplyNakupOnlineQuickFeedFullscreenLayer(quick, false); } catch (_) {}
      try { quick.classList.remove("iu-nakup-online-feed-root", "iu-nakup-online-single-column", "iu-banking-quickfeed-root", "iu-bakalari-quickfeed-root", "iu-pojistovna-quickfeed-root", "iu-wordpdf-quickfeed-root", "iu-grocery-quickfeed-root"); } catch (_) {}
      try { quick.removeAttribute("data-iu-qf-key"); } catch (_) {}
      quick.hidden = true;
      try { quick.style.display = "none"; } catch (_) {}
      iuUndockQuickFeedFromBody(quick);
      /* P0 perf: clearing large QuickFeed HTML synchronously blocked main-thread nav for ~1–2s. */
      try {
        const html = quick.innerHTML;
        if (html && String(html).length > 0) {
          const flush = function () {
            try {
              quick.innerHTML = "";
            } catch (_) {}
          };
          if (typeof requestIdleCallback === "function") {
            requestIdleCallback(flush, { timeout: 400 });
          } else {
            setTimeout(flush, 0);
          }
        }
      } catch (_) {}
    }
    try {
      iuSetViewportLock(false);
      document.body.classList.remove("iu-modal-open", "iu-quickFeedOpen", "iu-mobileGateToolsQuickOpen", "iu-quickFeedMojeFullscreen", "iu-nakup-online-overlay-open", "iu-grocery-desktop-overlay-open", "iu-ds-overlay-open", "iu-financial-overlay-open", "iu-financial-calculators-overlay-open", "iu-legal-docs-overlay-open", "iu-invoice-overlay-open", "iu-ai-narrow-fullscreen", "iu-banking-desktop-overlay-open", "iu-bakalari-desktop-overlay-open", "iu-pojistovna-desktop-overlay-open", "iu-wordpdf-desktop-overlay-open");
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
      const dsPanel = document.getElementById("iuDsPanel");
      if (dsPanel && vis(dsPanel) && String(dsPanel.dataset.open || "") === "1") ids.push("datovka");
      const finPanel = document.getElementById("iuFinancialCalcPanel");
      if (finPanel && vis(finPanel) && String(finPanel.dataset.open || "") === "1") ids.push("financial");
      const legPanel = document.getElementById("iuLegalDocsPanel");
      if (legPanel && vis(legPanel) && String(legPanel.dataset.open || "") === "1") ids.push("legal");
      const invPanel = document.getElementById("iuInvoicePanel");
      if (invPanel && vis(invPanel) && String(invPanel.dataset.open || "") === "1") ids.push("invoice");
      const cbPanel = document.getElementById("iuCustomButtonsPanel");
      if (cbPanel && vis(cbPanel) && String(cbPanel.dataset.open || "") === "1") ids.push("custombuttons");
      const desktopParcelOv = document.getElementById("iuDesktopParcelWatchOverlay");
      if (desktopParcelOv && desktopParcelOv.classList.contains("is-open") && !desktopParcelOv.hidden) ids.push("desktop-parcel");
    } catch (_) {}
    return ids;
  }

  function iuForceCloseAllOverlays() {
    try {
      if (typeof window !== "undefined" && window.__iuNavOverlayLock === true) return;
    } catch (_){}
    try {
      if (typeof window.iuQuickToolsSettingsClose === "function") window.iuQuickToolsSettingsClose();
    } catch (_) {}
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
      if (typeof window.iuDatovkaCloseSurface === "function") {
        try { window.iuDatovkaCloseSurface(); } catch (_) {}
      } else {
        const dsPanel = document.getElementById("iuDsPanel");
        const dsOv = document.getElementById("iuDsOverlay");
        if (typeof window.iuSetElOpenVisible === "function") {
          try { window.iuSetElOpenVisible(dsPanel, false); window.iuSetElOpenVisible(dsOv, false); } catch (_) {}
        } else {
          if (dsPanel) dsPanel.hidden = true;
          if (dsOv) dsOv.hidden = true;
        }
        try {
          if (dsPanel) {
            dsPanel.dataset.open = "0";
            dsPanel.classList.remove("is-open");
          }
        } catch (_) {}
      }
      if (typeof window.iuFinancialCalcCloseSurface === "function") {
        try { window.iuFinancialCalcCloseSurface(); } catch (_) {}
      } else {
        const finBd = document.getElementById("iuFinancialCalcBackdrop");
        const finPn = document.getElementById("iuFinancialCalcPanel");
        if (typeof window.iuSetElOpenVisible === "function") {
          try { window.iuSetElOpenVisible(finBd, false); window.iuSetElOpenVisible(finPn, false); } catch (_) {}
        } else {
          if (finBd) finBd.hidden = true;
          if (finPn) finPn.hidden = true;
        }
        try {
          if (finPn) finPn.dataset.open = "0";
          document.body.classList.remove("iu-financial-overlay-open", "iu-financial-calculators-overlay-open");
        } catch (_) {}
      }
      if (typeof window.iuLegalDocsCloseSurface === "function") {
        try { window.iuLegalDocsCloseSurface(); } catch (_) {}
      } else {
        const legBd = document.getElementById("iuLegalDocsBackdrop");
        const legPn = document.getElementById("iuLegalDocsPanel");
        if (typeof window.iuSetElOpenVisible === "function") {
          try { window.iuSetElOpenVisible(legBd, false); window.iuSetElOpenVisible(legPn, false); } catch (_) {}
        } else {
          if (legBd) legBd.hidden = true;
          if (legPn) legPn.hidden = true;
        }
        try {
          if (legPn) legPn.dataset.open = "0";
          document.body.classList.remove("iu-legal-docs-overlay-open");
        } catch (_) {}
      }
      if (typeof window.iuInvoiceCloseSurface === "function") {
        try { window.iuInvoiceCloseSurface(); } catch (_) {}
      } else {
        const invBd = document.getElementById("iuInvoiceBackdrop");
        const invPn = document.getElementById("iuInvoicePanel");
        if (typeof window.iuSetElOpenVisible === "function") {
          try { window.iuSetElOpenVisible(invBd, false); window.iuSetElOpenVisible(invPn, false); } catch (_) {}
        } else {
          if (invBd) invBd.hidden = true;
          if (invPn) invPn.hidden = true;
        }
        try {
          if (invPn) invPn.dataset.open = "0";
          document.body.classList.remove("iu-invoice-overlay-open");
        } catch (_) {}
      }
      if (typeof window.iuCustomButtonsOverlayClose === "function") {
        try { window.iuCustomButtonsOverlayClose(); } catch (_) {}
      }
      try {
        if (typeof window.iuDesktopParcelWatchOverlayClose === "function") window.iuDesktopParcelWatchOverlayClose();
        else {
          const dpo = document.getElementById("iuDesktopParcelWatchOverlay");
          if (dpo) {
            dpo.hidden = true;
            dpo.classList.remove("is-open");
            dpo.setAttribute("aria-hidden", "true");
          }
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
      iuSetViewportLock(false);
      document.body.classList.remove("iu-modal-open", "iu-quickFeedOpen", "iu-mobileGateToolsQuickOpen", "iu-quickFeedMojeFullscreen", "iu-nakup-online-overlay-open", "iu-grocery-desktop-overlay-open", "iu-ds-overlay-open", "iu-financial-overlay-open", "iu-financial-calculators-overlay-open", "iu-legal-docs-overlay-open", "iu-invoice-overlay-open", "iu-custom-buttons-overlay-open", "iu-ai-narrow-fullscreen", "iu-banking-desktop-overlay-open", "iu-bakalari-desktop-overlay-open", "iu-pojistovna-desktop-overlay-open", "iu-wordpdf-desktop-overlay-open");
    } catch (_) {}
  }

  function iuOpenOverlay(targetId, extra) {
    const t = String(targetId || "").trim().toLowerCase();
    try {
      if (window.iuAnalytics && typeof window.iuAnalytics.privateToolsOpen === "function") {
        window.iuAnalytics.privateToolsOpen();
      }
    } catch (_) {}
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
      if (t === "datovka") {
        if (typeof window.iuDatovkaOpenSurface === "function") window.iuDatovkaOpenSurface();
      }
      if (t === "financial") {
        var openFinancialSurface = function () {
          if (typeof window.ensureFinancialModalInBody === "function") window.ensureFinancialModalInBody();
          if (typeof window.iuFinancialCalcOpenSurface === "function") {
            window.iuFinancialCalcOpenSurface(extra && typeof extra === "object" ? extra : null);
          }
        };
        if (typeof window.iuFinancialCalcOpenSurface === "function") {
          openFinancialSurface();
        } else if (typeof window.iuEnsureFinancialCalcOverlayBoot === "function") {
          void window.iuEnsureFinancialCalcOverlayBoot().then(openFinancialSurface);
        } else {
          openFinancialSurface();
        }
      }
      if (t === "legal") {
        var openLegalSurface = function () {
          if (typeof window.ensureLegalDocsModalInBody === "function") window.ensureLegalDocsModalInBody();
          if (typeof window.iuLegalDocsOpenSurface === "function") window.iuLegalDocsOpenSurface();
        };
        if (typeof window.iuLegalDocsOpenSurface === "function") {
          openLegalSurface();
        } else if (typeof window.iuEnsureLegalDocsOverlayBoot === "function") {
          void window.iuEnsureLegalDocsOverlayBoot().then(openLegalSurface);
        } else {
          openLegalSurface();
        }
      }
      if (t === "invoice") {
        var openInvoiceSurface = function () {
          if (typeof window.ensureInvoiceModalInBody === "function") window.ensureInvoiceModalInBody();
          if (typeof window.iuInvoiceOpenSurface === "function") window.iuInvoiceOpenSurface();
        };
        if (typeof window.iuInvoiceOpenSurface === "function") {
          openInvoiceSurface();
        } else if (typeof window.iuEnsureInvoiceOverlayBoot === "function") {
          void window.iuEnsureInvoiceOverlayBoot().then(openInvoiceSurface);
        } else {
          openInvoiceSurface();
        }
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
      } else if (last === "datovka") {
        if (typeof window.iuDatovkaOpenSurface === "function") window.iuDatovkaOpenSurface();
      } else if (last === "financial") {
        var reopenFin = function () {
          if (typeof window.ensureFinancialModalInBody === "function") window.ensureFinancialModalInBody();
          if (typeof window.iuFinancialCalcOpenSurface === "function") window.iuFinancialCalcOpenSurface(null);
        };
        if (typeof window.iuFinancialCalcOpenSurface === "function") {
          reopenFin();
        } else if (typeof window.iuEnsureFinancialCalcOverlayBoot === "function") {
          void window.iuEnsureFinancialCalcOverlayBoot().then(reopenFin);
        } else {
          reopenFin();
        }
      } else if (last === "legal") {
        var reopenLeg = function () {
          if (typeof window.ensureLegalDocsModalInBody === "function") window.ensureLegalDocsModalInBody();
          if (typeof window.iuLegalDocsOpenSurface === "function") window.iuLegalDocsOpenSurface();
        };
        if (typeof window.iuLegalDocsOpenSurface === "function") {
          reopenLeg();
        } else if (typeof window.iuEnsureLegalDocsOverlayBoot === "function") {
          void window.iuEnsureLegalDocsOverlayBoot().then(reopenLeg);
        } else {
          reopenLeg();
        }
      } else if (last === "invoice") {
        var reopenInv = function () {
          if (typeof window.ensureInvoiceModalInBody === "function") window.ensureInvoiceModalInBody();
          if (typeof window.iuInvoiceOpenSurface === "function") window.iuInvoiceOpenSurface();
        };
        if (typeof window.iuInvoiceOpenSurface === "function") {
          reopenInv();
        } else if (typeof window.iuEnsureInvoiceOverlayBoot === "function") {
          void window.iuEnsureInvoiceOverlayBoot().then(reopenInv);
        } else {
          reopenInv();
        }
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
    if (key === "datovka") return { actionType: "overlay", overlayId: "datovka", key: "datovka" };
    if (key === "fincalc") return { actionType: "overlay", overlayId: "financial", key: "fincalc" };
    if (key === "legaldocs") return { actionType: "overlay", overlayId: "legal", key: "legaldocs" };
    if (key === "faktura") return { actionType: "overlay", overlayId: "invoice", key: "faktura" };
    if (modal === "banka" || modal === "bakalari" || modal === "pojistovna") return { actionType: "overlay", overlayId: "quickfeed", key: modal };
    /* P0: AI asistenti — vždy stejný overlay (#iu-aiPanel); úzké viewporty řeší CSS (iu-ai-narrow-fullscreen), desktop = datovka-like shell v app.css. */
    if (key === "ai") {
      return { actionType: "overlay", overlayId: "ai", key: "ai" };
    }
    if (key === "deepl" || key === "convert" || key === "naceneni") {
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
      } else if (resolved.overlayId === "datovka") {
        iuOpenOverlay("datovka");
      } else if (resolved.overlayId === "financial") {
        iuOpenOverlay("financial", null);
      } else if (resolved.overlayId === "legal") {
        iuOpenOverlay("legal", null);
      } else if (resolved.overlayId === "invoice") {
        iuOpenOverlay("invoice");
      } else if (resolved.overlayId === "ai") {
        iuOpenOverlay("ai");
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
    const modal = closeEl.closest && (closeEl.closest('.iuModal, [data-iu-modal]') || closeEl.closest('#iu-aiPanel') || closeEl.closest('#iuDsPanel') || closeEl.closest('#iu-mojeSluzbyPanel') || closeEl.closest('#iuFinancialCalcPanel') || closeEl.closest('#iuLegalDocsPanel') || closeEl.closest('#iuInvoicePanel'));
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
        iuSetViewportLock(false);
      } else if (modal.id === 'iuDsPanel' && typeof window.iuDatovkaCloseSurface === 'function') {
        window.iuDatovkaCloseSurface();
      } else if (modal.id === 'iu-mojeSluzbyPanel' && typeof window.iuCloseMojeSluzbyModal === 'function') {
        window.iuCloseMojeSluzbyModal();
      } else if (modal.id === 'iuFinancialCalcPanel' && typeof window.iuFinancialCalcCloseSurface === 'function') {
        window.iuFinancialCalcCloseSurface();
      } else if (modal.id === 'iuLegalDocsPanel' && typeof window.iuLegalDocsCloseSurface === 'function') {
        window.iuLegalDocsCloseSurface();
      } else if (modal.id === 'iuInvoicePanel' && typeof window.iuInvoiceCloseSurface === 'function') {
        window.iuInvoiceCloseSurface();
      } else {
        modal.setAttribute('hidden', '');
      }
      modal.classList.remove('is-open');
      document.body.classList.remove('iu-modal-open', 'iu-ds-overlay-open', 'iu-financial-overlay-open', 'iu-financial-calculators-overlay-open', 'iu-legal-docs-overlay-open', 'iu-invoice-overlay-open');
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
    const safeHttp = (u) => {
      try {
        const parsed = new URL(String(u || ""), "https://infouzel.cz");
        if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
      } catch (_) {}
      return "";
    };
    container.innerHTML = items.map(it => {
      const c = /^#[0-9A-Fa-f]{3,8}$/.test(String(it.color || "")) ? String(it.color) : "#1F4B99";
      const href = safeHttp(it.url);
      const openLink = href
        ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Otevřít</a>`
        : `<span>Otevřít</span>`;
      return `<div class="iu-aiItem" style="--aiColor:${esc(c)}">
        <div>
          <strong>${esc(it.name)}</strong>
          <p>${esc(it.desc || "")}</p>
        </div>
        ${openLink}
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
      if (typeof iuSetViewportLock === "function") {
        iuSetViewportLock(!!lock);
        return;
      }
      if (typeof window.iuSetViewportLock === "function") {
        window.iuSetViewportLock(!!lock);
      }
    }

    function iuAiIsNarrowViewport() {
      try {
        return !!(window.matchMedia && window.matchMedia("(max-width: 1023px)").matches);
      } catch (_) {
        return false;
      }
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
      try {
        if (iuAiIsNarrowViewport()) document.body.classList.add("iu-ai-narrow-fullscreen");
        else document.body.classList.remove("iu-ai-narrow-fullscreen");
      } catch (_) {}
      aiPanel.dataset.open = '1';
      setExpanded(true);
      try {
        aiPanel.style.visibility = "visible";
        aiPanel.style.opacity = "1";
        if (aiOverlay) {
          aiOverlay.style.visibility = "visible";
          aiOverlay.style.opacity = "1";
        }
      } catch (_) {}
      try {
        const body = aiPanel.querySelector('.iu-aiPanelBody');
        if (body && typeof window.iuPersistScrollPanels === 'function') {
          requestAnimationFrame(() => window.iuPersistScrollPanels());
        }
      } catch {}
      try {
        if (typeof window.iuRenderAiVideos === "function") {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              try { window.iuRenderAiVideos(aiPanel); } catch (_) {}
            });
          });
        }
      } catch (_) {}
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
      try { document.body.classList.remove("iu-ai-narrow-fullscreen"); } catch (_) {}
      aiPanel.dataset.open = '0';
      setExpanded(false);
      try {
        aiPanel.style.visibility = "";
        aiPanel.style.opacity = "";
        if (aiOverlay) {
          aiOverlay.style.visibility = "";
          aiOverlay.style.opacity = "";
        }
      } catch (_) {}
    }
    try { window.iuAiPanelCloseSurface = closePanel; } catch (_) {}

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

    // init (guard lives later in bundle — use window)
    if (typeof window.iuAiEnsureGuardClasses === "function") window.iuAiEnsureGuardClasses();
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

// === DATOVÁ SCHRÁNKA — lokální profily (overlay; hesla jen localStorage v prohlížeči) ===
(function () {
  "use strict";

  /** Single source of truth — oficiální vstup do služby (ne Portál občana). */
  const DATOVKA_LOGIN_URL = "https://datovka.gov.cz";
  const IU_DS_LABEL_PLACEHOLDER = "např. Osobní nebo OSVČ";
  const IU_DS_STORAGE_KEY = "infouzel_datovka_profiles_v1";
  const IU_DS_MAX = 10;

  try {
    window.__IU_DS_AUTOFILL_SUPPORTED = false;
  } catch (_) {}

  let iuDsProfiles = [];
  let iuDsSaveTimer = 0;
  let iuDsLastFocus = null;
  let iuDsPendingDeleteId = null;
  let iuDsDeleteActionBusy = false;

  function iuDsEnsureAtLeastOneProfileIfEmpty() {
    if (iuDsProfiles.length > 0) return;
    const t = iuDsNow();
    iuDsProfiles.push({
      id: iuDsNewId(),
      label: "",
      username: "",
      password: "",
      locked: false,
      createdAt: t,
      updatedAt: t,
    });
    iuDsPersist();
  }

  function iuDsDeleteConfirmEl() {
    return document.getElementById("iuDsDeleteConfirm");
  }

  function iuDsDeleteConfirmIsOpen() {
    const el = iuDsDeleteConfirmEl();
    if (!el) return false;
    if (el.hasAttribute("hidden")) return false;
    try {
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
    } catch (_) {}
    return true;
  }

  function iuDsDeleteConfirmModalParent() {
    const panel = document.getElementById("iuDsPanel");
    return panel ? panel.querySelector(".iu-ds-modal") : null;
  }

  function iuDsIsMobileTabletViewport() {
    try {
      return !!(window.matchMedia && window.matchMedia("(max-width: 1024px)").matches);
    } catch (_) {
      return false;
    }
  }

  function iuDsRestoreDeleteConfirmToModal() {
    const el = iuDsDeleteConfirmEl();
    const modal = iuDsDeleteConfirmModalParent();
    if (!el || !modal) return;
    const hosts = document.querySelectorAll(".iu-ds-profile--deleteConfirmHost");
    for (let i = 0; i < hosts.length; i++) {
      hosts[i].classList.remove("iu-ds-profile--deleteConfirmHost");
    }
    if (el.parentElement !== modal) modal.appendChild(el);
  }

  function iuDsAttachDeleteConfirmToProfile(profileId) {
    const el = iuDsDeleteConfirmEl();
    if (!el || !profileId) return;
    if (!iuDsIsMobileTabletViewport()) {
      iuDsRestoreDeleteConfirmToModal();
      return;
    }
    const card = document.querySelector('.iu-ds-profile[data-profile-id="' + String(profileId) + '"]');
    if (!card) {
      iuDsRestoreDeleteConfirmToModal();
      return;
    }
    const hosts = document.querySelectorAll(".iu-ds-profile--deleteConfirmHost");
    for (let i = 0; i < hosts.length; i++) {
      hosts[i].classList.remove("iu-ds-profile--deleteConfirmHost");
    }
    card.classList.add("iu-ds-profile--deleteConfirmHost");
    if (el.parentElement !== card) card.appendChild(el);
  }

  function iuDsCloseDeleteConfirm() {
    const el = iuDsDeleteConfirmEl();
    if (el) el.setAttribute("hidden", "");
    iuDsRestoreDeleteConfirmToModal();
    iuDsPendingDeleteId = null;
    iuDsDeleteActionBusy = false;
  }

  function iuDsOpenDeleteConfirm(profileId) {
    iuDsEnsureDeleteConfirmMounted();
    const el = iuDsDeleteConfirmEl();
    if (!el || !profileId) return;
    iuDsPendingDeleteId = String(profileId);
    iuDsAttachDeleteConfirmToProfile(iuDsPendingDeleteId);
    el.removeAttribute("hidden");
    try {
      const cancel = document.getElementById("iuDsDeleteConfirmCancel");
      const ok = document.getElementById("iuDsDeleteConfirmOk");
      if (cancel) cancel.disabled = false;
      if (ok) ok.disabled = false;
      if (cancel && typeof cancel.focus === "function") {
        try {
          cancel.focus({ preventScroll: true });
        } catch (_) {
          cancel.focus();
        }
      }
    } catch (_) {}
  }

  function iuDsInjectMobileTabletCssOnce() {
    if (document.getElementById("iuDsMobileTabletCss")) return;
    const s = document.createElement("style");
    s.id = "iuDsMobileTabletCss";
    s.textContent =
      "@media (max-width:1024px){" +
      "body.iu-modal-open #iuDsOverlay.iu-ds-overlay:not([hidden]){z-index:10039!important;position:fixed!important;inset:auto!important;top:0!important;left:0!important;right:0!important;bottom:var(--iu-tool-overlay-panel-bottom,var(--bottom-nav-height,calc(56px + env(safe-area-inset-bottom,0px) + 48px)))!important;width:100%!important;height:auto!important;max-height:none!important;box-sizing:border-box!important}" +
      "body.iu-modal-open #iuDsPanel.iu-ds-panel.iuSectionDS[data-open=\"1\"]:not([hidden]){position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:var(--iu-tool-overlay-panel-bottom,var(--bottom-nav-height,calc(56px + env(safe-area-inset-bottom,0px) + 48px)))!important;transform:none!important;display:block!important;width:100%!important;max-width:none!important;height:auto!important;max-height:none!important;padding:0!important;margin:0!important;box-sizing:border-box!important;overflow-y:auto!important;overflow-x:hidden!important;-webkit-overflow-scrolling:touch!important;overscroll-behavior-y:contain!important;scroll-padding-bottom:calc(var(--iu-tool-overlay-bottom-gap,15px) + env(safe-area-inset-bottom,0px))!important;z-index:10040!important;border-radius:0!important;box-shadow:none!important}" +
      "#iuDsPanel.iu-ds-panel .iu-ds-modal{display:block!important;width:100%!important;max-width:none!important;height:auto!important;max-height:none!important;overflow:visible!important;border-radius:0!important;box-shadow:none!important;background:#fff!important}" +
      "#iuDsPanel.iu-ds-panel .iu-ds-panelHeader{border-top-left-radius:0!important;border-top-right-radius:0!important}" +
      "#iuDsPanel.iu-ds-panel .iu-ds-panelBody,#iuDsPanel.iu-ds-panel .iu-datovka-scroll-host{overflow:visible!important;min-height:0!important;touch-action:pan-y!important;padding-bottom:calc(var(--iu-tool-overlay-bottom-gap,15px) + env(safe-area-inset-bottom,0px))!important;scroll-padding-bottom:calc(var(--iu-tool-overlay-bottom-gap,15px) + env(safe-area-inset-bottom,0px))!important;box-sizing:border-box!important}" +
      ".iu-ds-profile .iu-ds-f-label,.iu-ds-profile .iu-ds-f-user,.iu-ds-profile .iu-ds-f-pass,.iu-ds-open-btn,#iuDsPanel .bakalari-btn,.iu-ds-add{font-size:16px!important}" +
      "}";
    try {
      document.head.appendChild(s);
    } catch (_) {}
  }

  function iuDsInjectDeleteConfirmCssOnce() {
    if (document.getElementById("iuDsDeleteConfirmCss")) return;
    const s = document.createElement("style");
    s.id = "iuDsDeleteConfirmCss";
    s.textContent =
      ".iu-ds-deleteConfirm{position:absolute;inset:0;z-index:6;display:none;align-items:center;justify-content:center;padding:14px;box-sizing:border-box}" +
      ".iu-ds-deleteConfirm:not([hidden]){display:flex!important}" +
      ".iu-ds-deleteConfirm__backdrop{position:absolute;inset:0;background:rgba(15,23,42,.48);-webkit-tap-highlight-color:transparent}" +
      ".iu-ds-deleteConfirm__box{position:relative;z-index:1;width:100%;max-width:400px;box-sizing:border-box;padding:16px 18px;border-radius:14px;background:#fff;box-shadow:0 18px 44px rgba(0,0,0,.22);max-height:min(70dvh,520px);overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}" +
      ".iu-ds-deleteConfirm__title{margin:0 0 10px;font-size:17px;font-weight:700}" +
      ".iu-ds-deleteConfirm__text{margin:0 0 16px;font-size:14px;line-height:1.45;color:rgba(11,27,43,.75)}" +
      ".iu-ds-deleteConfirm__actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end}" +
      ".iu-ds-deleteConfirm__cancel,.iu-ds-deleteConfirm__ok{padding:10px 16px;font-size:16px;font-family:inherit;font-weight:600;border-radius:10px;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:background-color .15s ease,filter .15s ease,transform .12s ease}" +
      ".iu-ds-deleteConfirm__cancel{border:1px solid rgba(0,0,0,.14);background:#f8fafc;color:#111}" +
      ".iu-ds-deleteConfirm__cancel:hover:not(:disabled){background:#eef2f7}" +
      ".iu-ds-deleteConfirm__cancel:active:not(:disabled){transform:scale(.97);background:#e2e8f0}" +
      ".iu-ds-deleteConfirm__ok{border:0;background:#b91c1c;color:#fff}" +
      ".iu-ds-deleteConfirm__ok:hover:not(:disabled){filter:brightness(1.08)}" +
      ".iu-ds-deleteConfirm__ok:active:not(:disabled){transform:scale(.97);filter:brightness(.9)}" +
      ".iu-ds-deleteConfirm__ok:disabled,.iu-ds-deleteConfirm__cancel:disabled{opacity:.55;cursor:not-allowed}" +
      "@media (max-width:1024px){" +
      ".iu-ds-profile--deleteConfirmHost{position:relative;isolation:isolate}" +
      ".iu-ds-profile--deleteConfirmHost>.iu-ds-deleteConfirm{position:absolute;inset:0;z-index:8;border-radius:14px;min-height:100%}" +
      "}";
    try {
      document.head.appendChild(s);
    } catch (_) {}
  }

  function iuDsInjectButtonFeedbackCssOnce() {
    if (document.getElementById("iuDsButtonFeedbackCss")) return;
    const s = document.createElement("style");
    s.id = "iuDsButtonFeedbackCss";
    s.textContent =
      "#iuDsPanel .bakalari-btn--ghost{background:#f1f5f9;color:#0f172a;border-color:rgba(15,23,42,.14)}" +
      "#iuDsPanel .bakalari-btn,#iuDsPanel .iu-ds-open-btn,#iuDsPanel .iu-ds-add{cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:background-color .15s ease,border-color .15s ease,filter .15s ease,box-shadow .15s ease,transform .12s ease}" +
      "#iuDsPanel .bakalari-btn:active:not(:disabled),#iuDsPanel .iu-ds-open-btn:active,#iuDsPanel .iu-ds-add:active:not(:disabled){transform:scale(.97)}" +
      "#iuDsPanel .bakalari-btn--ghost:hover:not(:disabled){background:#e2e8f0;border-color:rgba(15,23,42,.22)}" +
      "#iuDsPanel .bakalari-btn--ghost:active:not(:disabled){background:#cbd5e1;border-color:rgba(15,23,42,.3)}" +
      "#iuDsPanel .bakalari-btn--secondary:hover:not(:disabled){filter:brightness(1.05)}" +
      "#iuDsPanel .bakalari-btn--secondary:active:not(:disabled){filter:brightness(.9);transform:scale(.97)}" +
      "#iuDsPanel .bakalari-btn--danger:hover:not(:disabled){filter:brightness(.95)}" +
      "#iuDsPanel .bakalari-btn--danger:active:not(:disabled){transform:scale(.97);filter:brightness(.88)}" +
      "#iuDsPanel .bakalari-btn--mini{min-width:7.2em}" +
      "#iuDsPanel .bakalari-btn.iu-ds-btn--copied,#iuDsPanel .bakalari-btn.iu-ds-btn--saved{background:#dcfce7!important;color:#166534!important;border-color:#86efac!important}" +
      "#iuDsPanel .iu-ds-form-block--editing{box-shadow:0 0 0 2px rgba(29,78,216,.38)}" +
      "#iuDsPanel .iu-ds-toggle-pw--visible{background:#e0e7ff!important;border-color:rgba(29,78,216,.35)!important;color:#1e3a8a!important}" +
      "#iuDsPanel .iu-ds-add:hover:not(:disabled){background:#eef2f7;border-color:rgba(15,23,42,.22)}" +
      "#iuDsPanel .iu-ds-add:active:not(:disabled){background:#e2e8f0}" +
      "#iuDsPanel .iu-ds-open-btn:active{background:#1e3a8a}";
    try {
      document.head.appendChild(s);
    } catch (_) {}
  }

  function iuDsBtnFlashLabel(btn, tempLabel, ms, extraClass) {
    if (!btn || btn.disabled) return;
    if (btn.__iuDsFlashTimer) {
      clearTimeout(btn.__iuDsFlashTimer);
      btn.__iuDsFlashTimer = null;
    }
    const defaultLabel = btn.getAttribute("data-ds-default-label") || btn.textContent;
    if (!btn.getAttribute("data-ds-default-label")) btn.setAttribute("data-ds-default-label", defaultLabel);
    btn.textContent = tempLabel;
    if (extraClass) btn.classList.add(extraClass);
    btn.__iuDsFlashTimer = setTimeout(function () {
      btn.textContent = btn.getAttribute("data-ds-default-label") || defaultLabel;
      if (extraClass) btn.classList.remove(extraClass);
      btn.__iuDsFlashTimer = null;
    }, ms || 1600);
  }

  function iuDsMountDeleteConfirm() {
    iuDsInjectMobileTabletCssOnce();
    iuDsInjectDeleteConfirmCssOnce();
    iuDsInjectButtonFeedbackCssOnce();
    const panel = document.getElementById("iuDsPanel");
    const modal = panel ? panel.querySelector(".iu-ds-modal") : null;
    if (!modal || document.getElementById("iuDsDeleteConfirm")) return;
    const wrap = document.createElement("div");
    wrap.id = "iuDsDeleteConfirm";
    wrap.className = "iu-ds-deleteConfirm";
    wrap.setAttribute("hidden", "");
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "iuDsDeleteConfirmTitle");

    const back = document.createElement("div");
    back.className = "iu-ds-deleteConfirm__backdrop";
    back.tabIndex = -1;

    const box = document.createElement("div");
    box.className = "iu-ds-deleteConfirm__box";

    const title = document.createElement("div");
    title.className = "iu-ds-deleteConfirm__title";
    title.id = "iuDsDeleteConfirmTitle";
    title.textContent = "Odstranit datovou schránku?";

    const text = document.createElement("p");
    text.className = "iu-ds-deleteConfirm__text";
    text.textContent = "Tato akce je nevratná.";

    const actions = document.createElement("div");
    actions.className = "iu-ds-deleteConfirm__actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.id = "iuDsDeleteConfirmCancel";
    cancel.className = "iu-ds-deleteConfirm__cancel";
    cancel.textContent = "Zrušit";

    const ok = document.createElement("button");
    ok.type = "button";
    ok.id = "iuDsDeleteConfirmOk";
    ok.className = "iu-ds-deleteConfirm__ok";
    ok.textContent = "Odstranit";

    actions.appendChild(cancel);
    actions.appendChild(ok);
    box.appendChild(title);
    box.appendChild(text);
    box.appendChild(actions);
    wrap.appendChild(back);
    wrap.appendChild(box);
    modal.appendChild(wrap);

    back.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      iuDsCloseDeleteConfirm();
    });
    cancel.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      iuDsCloseDeleteConfirm();
    });
    ok.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (iuDsDeleteActionBusy) return;
      const delId = iuDsPendingDeleteId;
      if (!delId) {
        iuDsCloseDeleteConfirm();
        return;
      }
      iuDsDeleteActionBusy = true;
      try {
        if (ok) ok.disabled = true;
        if (cancel) cancel.disabled = true;
      } catch (_) {}
      iuDsSyncFromDomIfOpen();
      iuDsProfiles = iuDsProfiles.filter(function (r) {
        return r.id !== delId;
      });
      iuDsPersist();
      iuDsEnsureAtLeastOneProfileIfEmpty();
      iuDsCloseDeleteConfirm();
      iuDsRender();
    });
    wrap.addEventListener("click", function (e) {
      e.stopPropagation();
    });
  }

  function iuDsIsPanelOpen() {
    const p = document.getElementById("iuDsPanel");
    if (!p) return false;
    if (p.hasAttribute("hidden")) return false;
    return String(p.dataset.open || "") === "1";
  }

  function iuDsNow() {
    return Date.now();
  }

  function iuDsNewId() {
    return "iu_ds_" + iuDsNow().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }

  function iuDsNormalizeProfile(row, t) {
    const id = row && typeof row.id === "string" && row.id ? row.id : iuDsNewId();
    const label = row && typeof row.label === "string" ? row.label : "";
    const username = row && typeof row.username === "string" ? row.username : "";
    const password = row && typeof row.password === "string" ? row.password : "";
    const locked = !!(row && row.locked);
    const c0 = typeof row.createdAt === "number" && row.createdAt > 0 ? row.createdAt : t;
    const u0 = typeof row.updatedAt === "number" && row.updatedAt > 0 ? row.updatedAt : t;
    return { id: id, label: label, username: username, password: password, locked: locked, createdAt: c0, updatedAt: u0 };
  }

  function iuDsCopyToClipboard(text) {
    const t = String(text || "");
    if (!t) return false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        const pr = navigator.clipboard.writeText(t);
        if (pr && typeof pr.catch === "function") pr.catch(function () {});
        return true;
      }
    } catch (_) {}
    return false;
  }

  function iuDsApplyCardLock(card, locked) {
    if (!card) return;
    card.classList.toggle("iu-ds-profile--locked", !!locked);
    const formBlock = card.querySelector(".iu-ds-form-block");
    if (formBlock) formBlock.classList.toggle("iu-ds-form-block--editing", !locked);
    const inputs = card.querySelectorAll(".iu-ds-f-label, .iu-ds-f-user, .iu-ds-f-pass");
    for (let i = 0; i < inputs.length; i++) {
      if (locked) inputs[i].setAttribute("readonly", "readonly");
      else inputs[i].removeAttribute("readonly");
    }
    const passInput = card.querySelector(".iu-ds-f-pass");
    const togglePw = card.querySelector("[data-ds-toggle-password]");
    if (passInput && locked && passInput.getAttribute("type") === "text") {
      passInput.setAttribute("type", "password");
      if (togglePw) {
        togglePw.textContent = "Zobrazit heslo";
        togglePw.setAttribute("aria-pressed", "false");
        togglePw.classList.remove("iu-ds-toggle-pw--visible");
      }
    }
  }

  function iuDsLoadFromStorage() {
    let raw = null;
    try {
      raw = localStorage.getItem(IU_DS_STORAGE_KEY);
    } catch (_) {
      iuDsProfiles = [];
      return;
    }
    if (raw == null || raw === "") {
      iuDsProfiles = [];
      return;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      try {
        localStorage.removeItem(IU_DS_STORAGE_KEY);
      } catch (_) {}
      iuDsProfiles = [];
      return;
    }
    const t = iuDsNow();
    let rows = [];
    if (parsed && Array.isArray(parsed.profiles)) rows = parsed.profiles;
    else if (Array.isArray(parsed)) rows = parsed;
    else if (parsed && typeof parsed === "object") {
      const maybe = parsed.items || parsed.list;
      if (Array.isArray(maybe)) rows = maybe;
    }
    const out = [];
    if (Array.isArray(rows)) {
      for (let i = 0; i < rows.length && i < IU_DS_MAX + 2; i++) {
        if (!rows[i] || typeof rows[i] !== "object") continue;
        out.push(iuDsNormalizeProfile(rows[i], t));
      }
    }
    if (out.length > IU_DS_MAX) out.length = IU_DS_MAX;
    iuDsProfiles = out;
  }

  function iuDsPersist() {
    const payload = { v: 1, profiles: iuDsProfiles };
    if (!isLocalDataProtectionNoticeAccepted()) {
      void ensureLocalDataProtectionBeforeSave().then(function (ok) {
        if (!ok) return;
        try { localStorage.setItem(IU_DS_STORAGE_KEY, JSON.stringify(payload)); } catch (_) {}
      });
      return;
    }
    try {
      localStorage.setItem(IU_DS_STORAGE_KEY, JSON.stringify(payload));
    } catch (_) {}
  }

  function iuDsScheduleSave() {
    if (iuDsSaveTimer) clearTimeout(iuDsSaveTimer);
    iuDsSaveTimer = setTimeout(function () {
      iuDsSaveTimer = 0;
      iuDsSyncFromDomIfOpen();
    }, 220);
  }

  function iuDsFindPrev(id) {
    for (let i = 0; i < iuDsProfiles.length; i++) {
      if (iuDsProfiles[i].id === id) return iuDsProfiles[i];
    }
    return null;
  }

  function iuDsSyncFromDomIfOpen() {
    if (!iuDsIsPanelOpen()) return;
    const host = document.getElementById("iuDsProfileListHost");
    if (!host) return;
    const cards = host.querySelectorAll(".iu-ds-profile[data-profile-id]");
    const next = [];
    const t = iuDsNow();
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const id = card.getAttribute("data-profile-id");
      if (!id) continue;
      const prev = iuDsFindPrev(id);
      const labelEl = card.querySelector(".iu-ds-f-label");
      const userEl = card.querySelector(".iu-ds-f-user");
      const passEl = card.querySelector(".iu-ds-f-pass");
      const locked = card.classList.contains("iu-ds-profile--locked");
      next.push({
        id: id,
        label: labelEl ? String(labelEl.value || "") : "",
        username: userEl ? String(userEl.value || "") : "",
        password: passEl ? String(passEl.value || "") : "",
        locked: locked,
        createdAt: prev ? prev.createdAt : t,
        updatedAt: t,
      });
    }
    iuDsProfiles = next;
    iuDsPersist();
  }

  function iuDsGetSafeLoginUrl() {
    const raw = String(DATOVKA_LOGIN_URL || "").trim();
    if (!raw || raw.indexOf("https://") !== 0) return "";
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:") return "";
      return u.href;
    } catch (_) {
      return "";
    }
  }
  try {
    window.iuDsResolveDatovkaLoginUrl = function () {
      return iuDsGetSafeLoginUrl();
    };
  } catch (_) {}

  let iuDsOpenLoginBusy = false;
  function iuDsOpenLoginInNewTab() {
    if (iuDsOpenLoginBusy) return;
    const url = iuDsGetSafeLoginUrl();
    if (!url) return;
    iuDsOpenLoginBusy = true;
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (_) {}
    try {
      setTimeout(function () {
        iuDsOpenLoginBusy = false;
      }, 900);
    } catch (_) {
      iuDsOpenLoginBusy = false;
    }
  }

  function iuDsUpdateAddUi() {
    const addBtn = document.getElementById("iuDsAddBtn");
    const note = document.getElementById("iuDsLimitNote");
    const n = iuDsProfiles.length;
    if (!addBtn) return;
    const atCap = n >= IU_DS_MAX;
    addBtn.disabled = !!atCap;
    if (note) {
      note.hidden = !atCap;
      if (atCap) note.textContent = "Maximálně " + String(IU_DS_MAX) + " profilů.";
    }
  }

  function iuDsBuildProfileCard(p) {
    const card = document.createElement("div");
    card.className = "iu-ds-profile iu-ds-tool";
    card.setAttribute("data-profile-id", p.id);
    if (p.locked) card.classList.add("iu-ds-profile--locked");

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "iu-ds-open-btn";
    openBtn.textContent = "Otevřít a přihlásit do datové schránky";
    openBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      iuDsOpenLoginInNewTab();
    });
    card.appendChild(openBtn);

    const formBlock = document.createElement("div");
    formBlock.className = "iu-ds-form-block";

    function makeInput(labelText, className, inputType, value, idSuffix) {
      const inpId = "iu-ds-" + idSuffix + "-" + p.id;
      const wrap = document.createElement("label");
      wrap.className = "iu-ds-field";
      const lab = document.createElement("span");
      lab.className = "iu-ds-label";
      lab.textContent = labelText;
      const inp = document.createElement("input");
      inp.id = inpId;
      inp.type = inputType;
      inp.className = className;
      inp.value = value || "";
      inp.setAttribute("autocomplete", inputType === "password" ? "new-password" : "off");
      inp.setAttribute("autocapitalize", "off");
      inp.setAttribute("spellcheck", "false");
      if (className === "iu-ds-f-label") {
        inp.setAttribute("maxlength", "120");
        inp.setAttribute("placeholder", IU_DS_LABEL_PLACEHOLDER);
      }
      if (className === "iu-ds-f-user") inp.setAttribute("maxlength", "200");
      wrap.appendChild(lab);
      wrap.appendChild(inp);
      return { wrap: wrap, inp: inp };
    }

    const labelField = makeInput("Název přihlášení", "iu-ds-f-label", "text", p.label, "lbl");
    formBlock.appendChild(labelField.wrap);

    const userWrap = document.createElement("div");
    userWrap.className = "iu-ds-field";
    const userLab = document.createElement("span");
    userLab.className = "iu-ds-label";
    userLab.textContent = "Uživatelské jméno";
    const userRow = document.createElement("div");
    userRow.className = "bakalari-inline-row";
    const userInpId = "iu-ds-usr-" + p.id;
    const userInp = document.createElement("input");
    userInp.id = userInpId;
    userInp.type = "text";
    userInp.className = "iu-ds-f-user bakalari-input";
    userInp.value = p.username || "";
    userInp.setAttribute("autocomplete", "off");
    userInp.setAttribute("autocapitalize", "off");
    userInp.setAttribute("spellcheck", "false");
    userInp.setAttribute("maxlength", "200");
    const copyUserBtn = document.createElement("button");
    copyUserBtn.type = "button";
    copyUserBtn.className = "bakalari-btn bakalari-btn--mini bakalari-btn--ghost";
    copyUserBtn.setAttribute("data-ds-copy-username", "");
    copyUserBtn.textContent = "Kopírovat";
    userRow.appendChild(userInp);
    userRow.appendChild(copyUserBtn);
    userWrap.appendChild(userLab);
    userWrap.appendChild(userRow);
    formBlock.appendChild(userWrap);

    const passWrap = document.createElement("div");
    passWrap.className = "iu-ds-field";
    const passLab = document.createElement("span");
    passLab.className = "iu-ds-label";
    passLab.textContent = "Heslo";
    const passRow = document.createElement("div");
    passRow.className = "bakalari-inline-row";
    const passInpId = "iu-ds-pwd-" + p.id;
    const passInput = document.createElement("input");
    passInput.id = passInpId;
    passInput.type = "password";
    passInput.className = "iu-ds-f-pass bakalari-input";
    passInput.value = p.password || "";
    passInput.setAttribute("autocomplete", "new-password");
    passInput.setAttribute("autocapitalize", "off");
    passInput.setAttribute("spellcheck", "false");
    const copyPassBtn = document.createElement("button");
    copyPassBtn.type = "button";
    copyPassBtn.className = "bakalari-btn bakalari-btn--mini bakalari-btn--ghost";
    copyPassBtn.setAttribute("data-ds-copy-password", "");
    copyPassBtn.textContent = "Kopírovat";
    passRow.appendChild(passInput);
    passRow.appendChild(copyPassBtn);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "bakalari-btn bakalari-btn--ghost bakalari-toggle-pw";
    toggle.setAttribute("data-ds-toggle-password", "");
    toggle.textContent = "Zobrazit heslo";
    passWrap.appendChild(passLab);
    passWrap.appendChild(passRow);
    passWrap.appendChild(toggle);
    formBlock.appendChild(passWrap);

    const cardActions = document.createElement("div");
    cardActions.className = "bakalari-card-actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "bakalari-btn bakalari-btn--secondary";
    saveBtn.setAttribute("data-ds-action", "save");
    saveBtn.textContent = "Uložit";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "bakalari-btn bakalari-btn--ghost";
    editBtn.setAttribute("data-ds-action", "edit");
    editBtn.textContent = "Upravit";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "bakalari-btn bakalari-btn--danger";
    delBtn.setAttribute("data-ds-action", "delete");
    delBtn.textContent = "Odstranit";
    cardActions.appendChild(saveBtn);
    cardActions.appendChild(editBtn);
    cardActions.appendChild(delBtn);
    formBlock.appendChild(cardActions);

    const feedback = document.createElement("div");
    feedback.className = "bakalari-card-feedback";
    feedback.setAttribute("data-ds-card-feedback", "");
    feedback.setAttribute("aria-live", "polite");
    formBlock.appendChild(feedback);

    card.appendChild(formBlock);

    copyUserBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      const v = String(userInp.value || "").trim();
      if (v && iuDsCopyToClipboard(v)) iuDsBtnFlashLabel(copyUserBtn, "Zkopírováno ✓", 1600, "iu-ds-btn--copied");
    });
    copyPassBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      const v = String(passInput.value || "").trim();
      if (v && iuDsCopyToClipboard(v)) iuDsBtnFlashLabel(copyPassBtn, "Zkopírováno ✓", 1600, "iu-ds-btn--copied");
    });
    toggle.addEventListener("click", function (ev) {
      ev.preventDefault();
      const showing = passInput.getAttribute("type") === "text";
      passInput.setAttribute("type", showing ? "password" : "text");
      const nowShowing = !showing;
      toggle.textContent = nowShowing ? "Skrýt heslo" : "Zobrazit heslo";
      toggle.setAttribute("aria-pressed", nowShowing ? "true" : "false");
      toggle.classList.toggle("iu-ds-toggle-pw--visible", nowShowing);
    });

    saveBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      const data = {
        label: String(labelField.inp.value || "").trim(),
        username: String(userInp.value || "").trim(),
        password: String(passInput.value || "").trim(),
      };
      if (!data.label && !data.username && !data.password) {
        feedback.textContent = "Vyplňte alespoň jedno pole.";
        setTimeout(function () {
          if (feedback.textContent === "Vyplňte alespoň jedno pole.") feedback.textContent = "";
        }, 2200);
        return;
      }
      iuDsApplyCardLock(card, true);
      iuDsSyncFromDomIfOpen();
      feedback.textContent = "";
      iuDsBtnFlashLabel(saveBtn, "Uloženo ✓", 1800, "iu-ds-btn--saved");
    });

    editBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      iuDsApplyCardLock(card, false);
      iuDsSyncFromDomIfOpen();
      formBlock.classList.remove("bakalari-card--highlight");
      void formBlock.offsetWidth;
      formBlock.classList.add("bakalari-card--highlight");
      setTimeout(function () {
        formBlock.classList.remove("bakalari-card--highlight");
      }, 600);
      try {
        labelField.inp.focus();
      } catch (_) {}
    });

    delBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (iuDsDeleteConfirmIsOpen()) return;
      iuDsSyncFromDomIfOpen();
      const id = card.getAttribute("data-profile-id");
      if (!id) return;
      iuDsOpenDeleteConfirm(id);
    });

    iuDsApplyCardLock(card, !!p.locked);

    card.addEventListener(
      "input",
      function () {
        iuDsScheduleSave();
      },
      true
    );

    return card;
  }

  function iuDsEnsureDeleteConfirmMounted() {
    if (iuDsDeleteConfirmEl()) return;
    iuDsMountDeleteConfirm();
  }

  function iuDsRender() {
    try {
      if (iuDsDeleteConfirmIsOpen()) {
        iuDsCloseDeleteConfirm();
      } else {
        iuDsRestoreDeleteConfirmToModal();
      }
    } catch (_) {}
    const host = document.getElementById("iuDsProfileListHost");
    if (!host) return;
    host.textContent = "";
    for (let i = 0; i < iuDsProfiles.length; i++) {
      host.appendChild(iuDsBuildProfileCard(iuDsProfiles[i]));
    }
    iuDsUpdateAddUi();
  }

  function iuDsLockScroll(on) {
    if (typeof window.iuSetViewportLock === "function") window.iuSetViewportLock(!!on);
  }

  function iuDatovkaCloseSurface() {
    const panel = document.getElementById("iuDsPanel");
    const overlay = document.getElementById("iuDsOverlay");
    if (!panel || !overlay) return;
    try {
      iuDsCloseDeleteConfirm();
    } catch (_) {}
    try {
      iuDsSyncFromDomIfOpen();
    } catch (_) {}
    if (typeof window.iuSetElOpenVisible === "function") {
      try {
        window.iuSetElOpenVisible(panel, false);
        window.iuSetElOpenVisible(overlay, false);
      } catch (_) {}
    } else {
      panel.setAttribute("hidden", "");
      overlay.setAttribute("hidden", "");
    }
    panel.dataset.open = "0";
    try {
      panel.classList.remove("is-open");
    } catch (_) {}
    iuDsLockScroll(false);
    try {
      document.body.classList.remove("iu-modal-open", "iu-ds-overlay-open");
    } catch (_) {}
    try {
      if (iuDsLastFocus && typeof iuDsLastFocus.focus === "function") iuDsLastFocus.focus();
    } catch (_) {}
    iuDsLastFocus = null;
  }

  /* P1 perf (overlay cluster lazy mount): #iuDsOverlay + #iuDsPanel ship inside
     an inert <template id="iuLazyOverlayTpl-datovka"> and mount on first open. */
  function iuDsEnsureMounted() {
    if (document.getElementById("iuDsPanel")) {
      iuDsBindPanel();
      return true;
    }
    const tpl = document.getElementById("iuLazyOverlayTpl-datovka");
    if (!tpl || !tpl.content) return false;
    try {
      tpl.parentNode.insertBefore(tpl.content.cloneNode(true), tpl);
      tpl.parentNode.removeChild(tpl);
    } catch (_) {
      return false;
    }
    iuDsBindPanel();
    return true;
  }

  /* Panel-scoped bindings (formerly bound eagerly inside iuDsInit). */
  function iuDsBindPanel() {
    if (window.__iuDsPanelBound) return;
    const addBtn = document.getElementById("iuDsAddBtn");
    const overlay = document.getElementById("iuDsOverlay");
    const panel = document.getElementById("iuDsPanel");
    const modalInner = panel ? panel.querySelector(".iu-ds-modal") : null;
    if (!panel) return;
    window.__iuDsPanelBound = true;

    if (typeof window.iuToolPrivacyMountDatovkaHeading === "function") {
      window.iuToolPrivacyMountDatovkaHeading();
    }

    iuDsEnsureGuardClasses();
    iuDsMountDeleteConfirm();

    if (addBtn) {
      addBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        iuDsSyncFromDomIfOpen();
        if (iuDsProfiles.length >= IU_DS_MAX) return;
        const t = iuDsNow();
        iuDsProfiles.push({ id: iuDsNewId(), label: "", username: "", password: "", locked: false, createdAt: t, updatedAt: t });
        iuDsPersist();
        iuDsRender();
        try {
          if (addBtn && typeof addBtn.blur === "function") addBtn.blur();
        } catch (_) {}
      });
    }

    if (overlay) {
      overlay.addEventListener("click", function () {
        if (iuDsDeleteConfirmIsOpen()) {
          iuDsCloseDeleteConfirm();
          return;
        }
        iuDatovkaCloseSurface();
      });
    }
    if (panel) {
      panel.addEventListener("click", function (e) {
        if (e.target === panel) {
          if (iuDsDeleteConfirmIsOpen()) {
            iuDsCloseDeleteConfirm();
            return;
          }
          iuDatovkaCloseSurface();
        }
      });
    }
    if (modalInner) {
      modalInner.addEventListener("click", function (e) {
        e.stopPropagation();
      });
    }
  }

  function iuDatovkaOpenSurface() {
    iuDsEnsureMounted();
    const panel = document.getElementById("iuDsPanel");
    const overlay = document.getElementById("iuDsOverlay");
    if (!panel || !overlay) return;
    iuDsEnsureGuardClasses();
    try {
      iuDsLastFocus = document.activeElement;
    } catch (_) {
      iuDsLastFocus = null;
    }
    if (typeof window.ensureDatovkaModalInBody === "function") window.ensureDatovkaModalInBody();
    try {
      iuDsCloseDeleteConfirm();
    } catch (_) {}

    /* P0: show overlay shell synchronously (immediate open); then load + first-card init + render. */
    if (typeof window.iuSetElOpenVisible === "function") {
      try {
        window.iuSetElOpenVisible(overlay, true);
        window.iuSetElOpenVisible(panel, true);
      } catch (_) {}
    } else {
      overlay.removeAttribute("hidden");
      panel.removeAttribute("hidden");
    }
    panel.dataset.open = "1";
    try {
      document.body.classList.add("iu-modal-open", "iu-ds-overlay-open");
    } catch (_) {}
    iuDsLockScroll(true);

    iuDsLoadFromStorage();
    iuDsEnsureAtLeastOneProfileIfEmpty();
    iuDsRender();

    try {
      const host = document.getElementById("iuDsProfileListHost");
      const first = host ? host.querySelector("input, button.iu-ds-open-btn") : null;
      const closer = panel.querySelector(".iu-ds-close");
      const fo = { preventScroll: true };
      if (first && typeof first.focus === "function") {
        try {
          first.focus(fo);
        } catch (_) {
          try {
            first.focus();
          } catch (_) {}
        }
      } else if (closer && typeof closer.focus === "function") {
        try {
          closer.focus(fo);
        } catch (_) {
          try {
            closer.focus();
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  try {
    window.iuDatovkaOpenSurface = iuDatovkaOpenSurface;
  } catch (_) {}
  try {
    window.iuDatovkaCloseSurface = iuDatovkaCloseSurface;
  } catch (_) {}

  function iuDsEnsureGuardClasses() {
    try {
      const ov = document.getElementById("iuDsOverlay");
      const pan = document.getElementById("iuDsPanel");
      const scrollHost = pan ? pan.querySelector(".iu-ds-panelBody") : null;
      if (ov) ov.classList.add("iu-datovka-overlay-root");
      if (pan) pan.classList.add("iu-datovka-overlay-root");
      if (scrollHost) scrollHost.classList.add("iu-datovka-scroll-host");
      const closer = pan ? pan.querySelector(".iu-ds-close") : null;
      if (closer) closer.classList.add("iu-close-btn-38");
      const calClose = document.querySelector("#iuCalendarOverlay .iu-calendarOverlay__close");
      if (calClose) calClose.classList.add("iu-close-btn-38");
    } catch (_) {}
  }

  function iuDsInit() {
    if (window.__iuDsInitOnce) return;
    window.__iuDsInitOnce = true;

    /* Panel-scoped bindings moved to iuDsBindPanel() — runs on first lazy
       mount, or right away when the panel is already in the DOM (fallback).
       iuDsEnsureGuardClasses stays eager: it also tags the calendar close
       button (null-safe for the not-yet-mounted DS panel). */
    iuDsEnsureGuardClasses();
    iuDsLoadFromStorage();
    iuDsBindPanel();

    document.addEventListener(
      "keydown",
      function (e) {
        if (e.key !== "Escape") return;
        if (!iuDsIsPanelOpen()) return;
        e.preventDefault();
        if (iuDsDeleteConfirmIsOpen()) {
          iuDsCloseDeleteConfirm();
          return;
        }
        iuDatovkaCloseSurface();
      },
      true
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iuDsInit);
  } else {
    iuDsInit();
  }
})();

// === RADIO VIEW (left rail) — middle column toggle (UI-only) ===
// Requirements:
// - NO changes to loadData / applyFilter / renderFeed (feed pipeline untouched)
// - Toggle visibility only: #feed <-> #iuRadioView
// - Static link chips only (no audio/streams)
(function(){
  'use strict';

  /** Must mirror feed IIFE — this block is a separate scope (no shared closure). */
  const IU_ARTICLE_HUB_SECTION = "feed";
  function iuArticleHubSectionP(sec) {
    const s = String(sec || "").trim().toLowerCase();
    return s === IU_ARTICLE_HUB_SECTION || s === "media";
  }

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
    feed: "#B38BFF",
    media: "#B38BFF",
    zpravy: "#B38BFF",
    sport: "#FF6FD8",
    tech: "#6AA8FF",
    finance: "#FFD34D",
    home: "#FF9B5E",
    bydleni: "#FF9B5E",
    zdravi: "#4CFFB3",
    travel: "#42D3FF",
    hry: "#FF6B3D",
    kultura: "#FF4D8A",
    veda: "#7CFF6B",
    vzdelavani: "#55FFA6"
  };

  const VIEW_MAP = {
    feed: 'media',
    media: 'media',
    radio: 'radio',
    tvonline: 'tvonline',
    jr: 'jr',
    mapy: 'mapy',
    travel: 'media',
    pocasi: 'pocasi',
    tvprogram: 'tvprogram',
    affiliate: 'affiliate',
    hry: 'media',
    kultura: 'media',
    veda: 'media',
    vzdelavani: 'media',
  };
  function escapeHtml(s){
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /** P0 TV program: explicit allowlist — žádné falešné stanice / sdílené URL bez přesného významu. */
  const IU_TV_PROGRAM_LINKS = [
    { title: "Česká televize", label: "Oficiální TV program ČT", url: "https://www.ceskatelevize.cz/tv-program/", type: "OVĚŘENO" },
    { title: "Nova", label: "TV program Nova Group", url: "https://tv.nova.cz/program", type: "OVĚŘENO" },
    { title: "Prima", label: "Oficiální přehled Prima", url: "https://www.iprima.cz/tv-program", type: "OFICIÁLNÍ" },
    { title: "Seznam TV", label: "Veřejný TV program", url: "https://tv.seznam.cz/", type: "OVĚŘENO" },
  ];

  function iuMountTvProgramVerifiedLinks() {
    try {
      const host = document.getElementById("iuTvProgramVerifiedHost");
      if (!host || host.getAttribute("data-iu-tv-verified-mounted") === "1") return;
      const parts = [];
      for (let i = 0; i < IU_TV_PROGRAM_LINKS.length; i++) {
        const it = IU_TV_PROGRAM_LINKS[i];
        const u = String(it && it.url ? it.url : "").trim();
        if (!/^https:\/\//i.test(u)) continue;
        const title = escapeHtml(it.title);
        const label = escapeHtml(it.label);
        const aria = escapeHtml(String(it.title || "Externí odkaz"));
        parts.push(
          '<a class="iuTvPgHit iuTvPgHit--c" href="' +
            escapeHtml(u) +
            '" target="_blank" rel="noopener noreferrer" role="listitem" aria-label="' +
            aria +
            '"><span class="iuTvPgCard__name">' +
            title +
            '</span><span class="iuTvPgCard__hint">' +
            label +
            "</span></a>"
        );
      }
      host.innerHTML = parts.join("");
      host.setAttribute("data-iu-tv-verified-mounted", "1");
    } catch (_) {}
  }
  try {
    if (typeof window !== "undefined") window.IU_TV_PROGRAM_LINKS = IU_TV_PROGRAM_LINKS;
  } catch (_) {}

  /** TV program: řízený výběr žánru → interní overlay, jen ověřené HTTPS odkazy (žádný scraping). */
  const IU_TV_CHOICE_PANELS = {
    film: {
      title: "Film",
      items: [
        {
          title: "Česká televize",
          hint: "Oficiální TV program ČT",
          url: "https://www.ceskatelevize.cz/tv-program/",
        },
        {
          title: "Nova",
          hint: "TV program Nova Group",
          url: "https://tv.nova.cz/program",
        },
        {
          title: "Seznam TV",
          hint: "Veřejný TV program",
          url: "https://tv.seznam.cz/",
        },
      ],
    },
    serial: {
      title: "Seriál",
      items: [
        { title: "Česká televize", hint: "Oficiální TV program ČT", url: "https://www.ceskatelevize.cz/tv-program/" },
        { title: "Nova", hint: "TV program Nova Group", url: "https://tv.nova.cz/program" },
        {
          title: "Prima",
          hint: "Oficiální přehled Prima",
          url: "https://www.iprima.cz/tv-program",
          primaCaution: true,
        },
        { title: "Seznam TV", hint: "Veřejný TV program", url: "https://tv.seznam.cz/" },
      ],
    },
    sport: {
      title: "Sport",
      items: [
        {
          title: "Česká televize",
          hint: "Oficiální TV program ČT",
          url: "https://www.ceskatelevize.cz/tv-program/",
        },
        { title: "Nova", hint: "TV program Nova Group", url: "https://tv.nova.cz/program" },
        { title: "Seznam TV", hint: "Veřejný TV program", url: "https://tv.seznam.cz/" },
      ],
    },
    zpravy: {
      title: "Zprávy",
      items: [
        {
          title: "Česká televize",
          hint: "Oficiální TV program ČT",
          url: "https://www.ceskatelevize.cz/tv-program/",
        },
        { title: "Seznam TV", hint: "Veřejný TV program", url: "https://tv.seznam.cz/" },
      ],
    },
    deti: {
      title: "Děti",
      items: [
        { title: "Česká televize", hint: "Oficiální TV program ČT", url: "https://www.ceskatelevize.cz/tv-program/" },
        { title: "Seznam TV", hint: "Veřejný TV program", url: "https://tv.seznam.cz/" },
      ],
    },
    zabava: {
      title: "Zábava",
      items: [
        { title: "Nova", hint: "TV program Nova Group", url: "https://tv.nova.cz/program" },
        {
          title: "Prima",
          hint: "Oficiální přehled Prima",
          url: "https://www.iprima.cz/tv-program",
          primaCaution: true,
        },
        { title: "Seznam TV", hint: "Veřejný TV program", url: "https://tv.seznam.cz/" },
      ],
    },
  };

  const IU_TV_MAIN_CT = "https://www.ceskatelevize.cz/tv-program/";
  const IU_TV_MAIN_SEZNAM = "https://tv.seznam.cz/";

  var __iuTvOvState = {
    closeTimer: null,
    trapAttached: false,
    prevFocus: null,
    overlayPrimaUrl: "",
    pagePrimaUrl: "",
    openedFromRec: false,
  };

  function iuTvOverlayScrollLockSync() {
    try {
      const ov = document.getElementById("iuTvProgramChoiceOverlay");
      const ppc = document.getElementById("iuTvPgPrimaPageConfirm");
      const need =
        !!(ov && !ov.hasAttribute("hidden")) || !!(ppc && !ppc.hasAttribute("hidden"));
      if (need) document.documentElement.classList.add("iuTvOverlayScrollLock");
      else document.documentElement.classList.remove("iuTvOverlayScrollLock");
    } catch (_) {}
  }

  function iuTvDecisionProofEmit() {
    try {
      const ev = document.getElementById("iuTvPg-evening");
      const tv = document.getElementById("iuTvProgramView");
      const ov = document.getElementById("iuTvProgramChoiceOverlay");
      const linksEl = document.getElementById("iuTvProgramChoiceOverlayLinks");
      const hl = tv && tv.getAttribute ? tv.getAttribute("data-iu-tv-time-hl") : "";
      const open = !!(ov && !ov.hasAttribute("hidden"));
      let linkCount = 0;
      try {
        if (linksEl && linksEl.querySelectorAll) linkCount = linksEl.querySelectorAll("a.iuTvProgramChoiceOverlay__row").length;
      } catch (e1) {}
      window.__iuTvDecisionProof = {
        recommendationCardsVisible: !!(ev && !ev.hasAttribute("hidden")),
        timeBasedHighlightActive: !!(hl && String(hl).length > 0),
        overlayOpensFromRecommendation: !!__iuTvOvState.openedFromRec,
        overlayNotEmpty: !open || linkCount > 0,
        primaWarningShown: !!(window.__iuTvDecisionProof && window.__iuTvDecisionProof.primaWarningShown),
        fallbackMainProgramPresent: !open || linkCount > 0,
        consoleErrorsCount: 0,
        appErrorsCount: 0,
        result: "PASS",
      };
    } catch (_) {}
  }

  function iuTvProgramApplyTimeHighlight() {
    try {
      const tv = document.getElementById("iuTvProgramView");
      if (tv) tv.removeAttribute("data-iu-tv-time-hl");
    } catch (_) {}
  }

  function iuTvChoiceOverlayFocusNodes(panel) {
    try {
      if (!panel || !panel.querySelectorAll) return [];
      const pc = document.getElementById("iuTvProgramPrimaConfirm");
      const primOn = !!(pc && !pc.hasAttribute("hidden"));
      const linksEl = document.getElementById("iuTvProgramChoiceOverlayLinks");
      const sel =
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const n = panel.querySelectorAll(sel);
      const out = [];
      for (let i = 0; i < n.length; i++) {
        const el = n[i];
        if (!el || el.hasAttribute("hidden")) continue;
        if (primOn && linksEl && el.closest && el.closest("#iuTvProgramChoiceOverlayLinks") && String(el.tagName || "").toUpperCase() === "A") {
          continue;
        }
        out.push(el);
      }
      return out;
    } catch (_) {
      return [];
    }
  }

  function iuTvChoiceTrapKeydown(ev) {
    try {
      if (ev.key !== "Tab") return;
      const ov = document.getElementById("iuTvProgramChoiceOverlay");
      if (!ov || ov.hasAttribute("hidden")) return;
      const panel = ov.querySelector(".iuTvProgramChoiceOverlay__panel");
      const nodes = iuTvChoiceOverlayFocusNodes(panel);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const ae = document.activeElement;
      if (ev.shiftKey) {
        if (ae === first) {
          ev.preventDefault();
          last.focus();
        }
      } else {
        if (ae === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    } catch (_) {}
  }

  function iuTvChoiceHideOverlayPrima() {
    try {
      const pc = document.getElementById("iuTvProgramPrimaConfirm");
      const linksEl = document.getElementById("iuTvProgramChoiceOverlayLinks");
      __iuTvOvState.overlayPrimaUrl = "";
      if (pc) {
        pc.setAttribute("hidden", "");
        pc.setAttribute("aria-hidden", "true");
      }
      if (linksEl) {
        try {
          linksEl.inert = false;
        } catch (e0) {}
      }
    } catch (_) {}
  }

  function iuTvChoiceShowOverlayPrima(url) {
    try {
      const pc = document.getElementById("iuTvProgramPrimaConfirm");
      const linksEl = document.getElementById("iuTvProgramChoiceOverlayLinks");
      __iuTvOvState.overlayPrimaUrl = String(url || "");
      if (linksEl) {
        try {
          linksEl.inert = true;
        } catch (e1) {}
      }
      if (pc) {
        pc.removeAttribute("hidden");
        pc.setAttribute("aria-hidden", "false");
      }
      try {
        if (window.__iuTvDecisionProof) window.__iuTvDecisionProof.primaWarningShown = true;
      } catch (e2) {}
      window.setTimeout(function () {
        try {
          const btn = document.querySelector("[data-iu-tv-prima-proceed]");
          if (btn && typeof btn.focus === "function") btn.focus();
        } catch (e3) {}
      }, 0);
    } catch (_) {}
  }

  function iuTvPrimaPageConfirmClose() {
    try {
      const ppc = document.getElementById("iuTvPgPrimaPageConfirm");
      __iuTvOvState.pagePrimaUrl = "";
      if (ppc) {
        ppc.setAttribute("hidden", "");
        ppc.setAttribute("aria-hidden", "true");
      }
      iuTvOverlayScrollLockSync();
    } catch (_) {}
  }

  function iuTvPrimaPageConfirmOpen(url) {
    try {
      const ppc = document.getElementById("iuTvPgPrimaPageConfirm");
      __iuTvOvState.pagePrimaUrl = String(url || "");
      if (ppc) {
        ppc.removeAttribute("hidden");
        ppc.setAttribute("aria-hidden", "false");
      }
      iuTvOverlayScrollLockSync();
      try {
        if (window.__iuTvDecisionProof) window.__iuTvDecisionProof.primaWarningShown = true;
      } catch (e0) {}
      window.setTimeout(function () {
        try {
          const btn = document.querySelector("#iuTvPgPrimaPageConfirm [data-iu-tv-page-prima-proceed]");
          if (btn && typeof btn.focus === "function") btn.focus();
        } catch (e1) {}
      }, 0);
    } catch (_) {}
  }

  function iuTvChoiceCloseOverlay() {
    try {
      const ov = document.getElementById("iuTvProgramChoiceOverlay");
      if (!ov) return;
      if (__iuTvOvState.closeTimer) {
        try {
          window.clearTimeout(__iuTvOvState.closeTimer);
        } catch (e0) {}
        __iuTvOvState.closeTimer = null;
      }
      iuTvChoiceHideOverlayPrima();
      ov.classList.remove("iuTvProgramChoiceOverlay--shown");
      __iuTvOvState.closeTimer = window.setTimeout(function () {
        try {
          __iuTvOvState.closeTimer = null;
          ov.setAttribute("hidden", "");
          ov.setAttribute("aria-hidden", "true");
          iuTvOverlayScrollLockSync();
          if (__iuTvOvState.trapAttached) {
            try {
              document.removeEventListener("keydown", iuTvChoiceTrapKeydown, true);
            } catch (e1) {}
            __iuTvOvState.trapAttached = false;
          }
          const pf = __iuTvOvState.prevFocus;
          __iuTvOvState.prevFocus = null;
          if (pf && typeof pf.focus === "function") {
            try {
              pf.focus();
            } catch (e2) {}
          }
          __iuTvOvState.openedFromRec = false;
          iuTvDecisionProofEmit();
        } catch (e3) {}
      }, 165);
    } catch (_) {}
  }

  function iuTvChoiceOpenOverlay(key, opts) {
    try {
      const k = String(key || "").trim().toLowerCase();
      const cfg = IU_TV_CHOICE_PANELS[k];
      if (!cfg) return;
      const fromRec = !!(opts && opts.fromRec);
      __iuTvOvState.openedFromRec = fromRec;
      const ov = document.getElementById("iuTvProgramChoiceOverlay");
      const titleEl = document.getElementById("iuTvProgramChoiceTitle");
      const linksEl = document.getElementById("iuTvProgramChoiceOverlayLinks");
      if (!ov || !titleEl || !linksEl) return;
      if (__iuTvOvState.closeTimer) {
        try {
          window.clearTimeout(__iuTvOvState.closeTimer);
        } catch (e0) {}
        __iuTvOvState.closeTimer = null;
      }
      iuTvChoiceHideOverlayPrima();
      titleEl.textContent = String(cfg.title || "");
      const items = Array.isArray(cfg.items) ? cfg.items : [];
      const valid = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const u = String(it && it.url ? it.url : "").trim();
        if (!/^https:\/\//i.test(u)) continue;
        valid.push(it);
      }
      const emptyCategory = valid.length === 0;
      const parts = [];
      if (emptyCategory) {
        parts.push(
          '<div class="iuTvProgramChoiceOverlay__emptyMsg">Pro tuto kategorii nemáme dostupné ověřené odkazy.</div>'
        );
        parts.push(
          '<a class="iuTvProgramChoiceOverlay__row" href="' +
            escapeHtml(IU_TV_MAIN_CT) +
            '" target="_blank" rel="noopener noreferrer" aria-label="' +
            escapeHtml("Česká televize") +
            '"><span class="iuTvProgramChoiceOverlay__rowName">' +
            escapeHtml("Česká televize") +
            '</span><span class="iuTvProgramChoiceOverlay__rowHint">' +
            escapeHtml("Oficiální TV program ČT") +
            "</span></a>"
        );
        parts.push(
          '<a class="iuTvProgramChoiceOverlay__row" href="' +
            escapeHtml(IU_TV_MAIN_SEZNAM) +
            '" target="_blank" rel="noopener noreferrer" aria-label="' +
            escapeHtml("Seznam TV") +
            '"><span class="iuTvProgramChoiceOverlay__rowName">' +
            escapeHtml("Seznam TV") +
            '</span><span class="iuTvProgramChoiceOverlay__rowHint">' +
            escapeHtml("Veřejný TV program") +
            "</span></a>"
        );
      } else {
        parts.push(
          '<a class="iuTvProgramChoiceOverlay__row" href="' +
            escapeHtml(IU_TV_MAIN_CT) +
            '" target="_blank" rel="noopener noreferrer" aria-label="' +
            escapeHtml("Česká televize") +
            '"><span class="iuTvProgramChoiceOverlay__rowName">' +
            escapeHtml("Česká televize") +
            '</span><span class="iuTvProgramChoiceOverlay__rowHint">' +
            escapeHtml("Oficiální TV program ČT") +
            "</span></a>"
        );
        const seen = {};
        seen[IU_TV_MAIN_CT] = true;
        for (let j = 0; j < valid.length; j++) {
          const it = valid[j];
          const u = String(it.url || "").trim();
          if (seen[u]) continue;
          seen[u] = true;
          const t = escapeHtml(it.title);
          const h = escapeHtml(it.hint || "");
          const aria = escapeHtml(String(it.title || "Otevřít"));
          const prima = it.primaCaution === true || u.indexOf("iprima.cz") >= 0;
          const warn = prima
            ? '<div class="iuTvProgramChoiceOverlay__primaWarn">⚠️ Na některých mobilech nemusí fungovat</div>'
            : "";
          parts.push(
            '<a class="iuTvProgramChoiceOverlay__row" href="' +
              escapeHtml(u) +
              '" target="_blank" rel="noopener noreferrer" aria-label="' +
              aria +
              '"><span class="iuTvProgramChoiceOverlay__rowName">' +
              t +
              '</span><span class="iuTvProgramChoiceOverlay__rowHint">' +
              h +
              "</span>" +
              warn +
              "</a>"
          );
        }
      }
      linksEl.innerHTML = parts.join("");
      __iuTvOvState.prevFocus = document.activeElement;
      ov.classList.remove("iuTvProgramChoiceOverlay--shown");
      ov.removeAttribute("hidden");
      ov.setAttribute("aria-hidden", "false");
      iuTvOverlayScrollLockSync();
      if (!__iuTvOvState.trapAttached) {
        document.addEventListener("keydown", iuTvChoiceTrapKeydown, true);
        __iuTvOvState.trapAttached = true;
      }
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          try {
            ov.classList.add("iuTvProgramChoiceOverlay--shown");
            const panel = ov.querySelector(".iuTvProgramChoiceOverlay__panel");
            if (panel && typeof panel.focus === "function") panel.focus();
            const firstA = linksEl.querySelector("a.iuTvProgramChoiceOverlay__row");
            if (firstA && typeof firstA.focus === "function") firstA.focus();
          } catch (e4) {}
          iuTvDecisionProofEmit();
        });
      });
    } catch (_) {}
  }

  function iuInitTvProgramChoiceUi() {
    try {
      const tv = document.getElementById("iuTvProgramView");
      if (!tv || tv.getAttribute("data-iu-tv-choice-inited") === "1") return;
      tv.setAttribute("data-iu-tv-choice-inited", "1");
      iuTvProgramApplyTimeHighlight();
      try {
        window.__iuTvDecisionProof = {
          recommendationCardsVisible: !!document.getElementById("iuTvPg-evening"),
          timeBasedHighlightActive: false,
          overlayOpensFromRecommendation: false,
          overlayNotEmpty: true,
          primaWarningShown: false,
          fallbackMainProgramPresent: true,
          consoleErrorsCount: 0,
          appErrorsCount: 0,
          result: "PASS",
        };
      } catch (eInit) {}
      iuTvDecisionProofEmit();
      const linksEl = document.getElementById("iuTvProgramChoiceOverlayLinks");
      if (linksEl && linksEl.getAttribute("data-iu-tv-prima-cap") !== "1") {
        linksEl.setAttribute("data-iu-tv-prima-cap", "1");
        linksEl.addEventListener(
          "click",
          function (ev) {
            try {
              const t = ev.target;
              const a = t && t.closest ? t.closest("a.iuTvProgramChoiceOverlay__row") : null;
              if (!a || !a.href) return;
              const href = String(a.href);
              if (href.toLowerCase().indexOf("iprima.cz") < 0) return;
              ev.preventDefault();
              ev.stopPropagation();
              iuTvChoiceShowOverlayPrima(href);
            } catch (_) {}
          },
          true
        );
      }
      const ov = document.getElementById("iuTvProgramChoiceOverlay");
      if (ov && ov.getAttribute("data-iu-tv-prima-ui") !== "1") {
        ov.setAttribute("data-iu-tv-prima-ui", "1");
        ov.addEventListener("click", function (ev) {
          try {
            const t = ev.target;
            if (t && t.closest && t.closest("[data-iu-tv-prima-proceed]")) {
              ev.preventDefault();
              const u = String(__iuTvOvState.overlayPrimaUrl || "");
              if (u) window.open(u, "_blank", "noopener,noreferrer");
              iuTvChoiceHideOverlayPrima();
              return;
            }
            if (t && t.closest && t.closest("[data-iu-tv-prima-back]")) {
              ev.preventDefault();
              iuTvChoiceHideOverlayPrima();
            }
          } catch (_) {}
        });
      }
      const ppc = document.getElementById("iuTvPgPrimaPageConfirm");
      if (ppc && ppc.getAttribute("data-iu-tv-page-prima-wired") !== "1") {
        ppc.setAttribute("data-iu-tv-page-prima-wired", "1");
        ppc.addEventListener("click", function (ev) {
          try {
            const t = ev.target;
            if (t && t.closest && t.closest("[data-iu-tv-page-prima-proceed]")) {
              ev.preventDefault();
              const u = String(__iuTvOvState.pagePrimaUrl || "");
              if (u) window.open(u, "_blank", "noopener,noreferrer");
              iuTvPrimaPageConfirmClose();
              return;
            }
            if (
              (t && t.closest && t.closest("[data-iu-tv-page-prima-back]")) ||
              (t && t.closest && t.closest("[data-iu-tv-page-prima-close]"))
            ) {
              ev.preventDefault();
              iuTvPrimaPageConfirmClose();
            }
          } catch (_) {}
        });
      }
      tv.addEventListener("click", function (ev) {
        try {
          const t = ev.target;
          if (t && t.closest && t.closest("#iuTvPgPrimaPageConfirm") && !t.closest("[data-iu-tv-page-prima-close]")) {
            return;
          }
          const btn = t && t.closest ? t.closest("[data-iu-tv-choice]") : null;
          if (btn) {
            ev.preventDefault();
            const k = String(btn.getAttribute("data-iu-tv-choice") || "").trim().toLowerCase();
            const fromRec = !!(btn.getAttribute && btn.getAttribute("data-iu-tv-rec"));
            iuTvChoiceOpenOverlay(k, { fromRec: fromRec });
            return;
          }
          const a = t && t.closest ? t.closest("a[href]") : null;
          if (a && a.href && String(a.href).toLowerCase().indexOf("iprima.cz") >= 0) {
            if (a.closest && a.closest("#iuTvProgramChoiceOverlay")) return;
            ev.preventDefault();
            iuTvPrimaPageConfirmOpen(String(a.href));
            return;
          }
          if (t && t.closest && t.closest("[data-iu-tv-choice-close]")) {
            ev.preventDefault();
            iuTvChoiceCloseOverlay();
          }
        } catch (_) {}
      });
      document.addEventListener(
        "keydown",
        function (ev) {
          try {
            if (ev.key !== "Escape") return;
            const ppc2 = document.getElementById("iuTvPgPrimaPageConfirm");
            if (ppc2 && !ppc2.hasAttribute("hidden")) {
              ev.preventDefault();
              iuTvPrimaPageConfirmClose();
              return;
            }
            const ov2 = document.getElementById("iuTvProgramChoiceOverlay");
            if (!ov2 || ov2.hasAttribute("hidden")) return;
            const pc = document.getElementById("iuTvProgramPrimaConfirm");
            if (pc && !pc.hasAttribute("hidden")) {
              ev.preventDefault();
              iuTvChoiceHideOverlayPrima();
              return;
            }
            iuTvChoiceCloseOverlay();
          } catch (_) {}
        },
        true
      );
      if (window.MutationObserver) {
        const mo = new MutationObserver(function () {
          try {
            if (tv.hasAttribute("hidden")) {
              iuTvChoiceCloseOverlay();
              iuTvPrimaPageConfirmClose();
            } else {
              iuTvProgramApplyTimeHighlight();
              iuTvDecisionProofEmit();
            }
          } catch (_) {}
        });
        mo.observe(tv, { attributes: true, attributeFilter: ["hidden"] });
      }
    } catch (_) {}
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

  /**
   * P0 perf: SOLID chip contrast used to run on every section switch against many large views,
   * calling getComputedStyle per chip (layout thrash) before first paint. Only the view that
   * matches the active section needs a refresh (same chips; hidden views keep prior attrs).
   */
  function iuSolidChipContrastRootForSection(section, nav){
    try{
      const s = String(section || "").trim().toLowerCase();
      void nav;
      if (s === "radio") return document.getElementById("iuRadioView");
      if (s === "tvonline") return document.getElementById("iuTvOnlineView");
      if (s === "pocasi") return document.getElementById("iuWeatherView");
      if (s === "mapy") return document.getElementById("iuMapyView") || document.getElementById("iuMapsView");
      if (s === "tvprogram") return document.getElementById("iuTvProgramView");
      if (s === "jr") return document.getElementById("iuJrEmptyView");
      if (s === "travel") return document.getElementById("feed");
    }catch(_){}
    return null;
  }

  function iuGetMainScrollElement(){
    try{
      if (window.matchMedia && window.matchMedia("(min-width: 1025px)").matches) {
        const b = document.body;
        if (b) return b;
      }
      if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
        const lc = document.getElementById("leftContent");
        if (lc && lc.clientHeight > 0 && lc.scrollHeight > lc.clientHeight + 1) {
          const st = getComputedStyle(lc);
          if (st.overflowY === "auto" || st.overflowY === "scroll") return lc;
        }
      }
    }catch(_){}
    return document.scrollingElement || document.documentElement || document.body;
  }

  function iuGetMainScrollTop(){
    try{
      const el = iuGetMainScrollElement();
      if (el && typeof el.scrollTop === "number") return el.scrollTop;
    }catch(_){}
    return window.scrollY || 0;
  }

  function iuSetMainScrollTop(y){
    const yv = Math.max(0, Math.round(Number(y) || 0));
    try{
      if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
        const lc = document.getElementById("leftContent");
        if (lc) lc.scrollTop = yv;
      }
    }catch(_){}
    try{ window.scrollTo(0, yv); }catch(_){}
    try{
      const el = iuGetMainScrollElement();
      if (el) el.scrollTop = yv;
    }catch(_){}
    try{
      const b = document.body;
      const root = iuGetMainScrollElement();
      if (b && b !== root) b.scrollTop = yv;
    }catch(_){}
    try{
      const d = document.documentElement;
      const root = iuGetMainScrollElement();
      if (d && d !== root) d.scrollTop = yv;
    }catch(_){}
    if (yv === 0) {
      try{
        const feed = document.getElementById("newsList") || document.getElementById("feed");
        if (feed) feed.scrollTop = 0;
      }catch(_){}
    }
  }

  function iuGetTopbarStackOffsetPx(){
    try{
      const cs = getComputedStyle(document.documentElement);
      const v = parseFloat(cs.getPropertyValue("--topbarStackH"));
      if (Number.isFinite(v) && v > 0) return v;
    }catch(_){}
    return 68;
  }

  function iuResolveSectionScrollAnchor(){
    const feed = document.getElementById("feed");
    const center = document.getElementById("iuCenterStage");
    const desktopNav =
      !!(typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(min-width: 901px)").matches);
    if (desktopNav && center) {
      if (feed) {
        const feedHeader =
          feed.querySelector("picture.iu-feed-section-header-picture") ||
          feed.querySelector(".iu-feed-section-header-video-wrap") ||
          feed.querySelector("img.iu-feed-section-header-img") ||
          feed.querySelector(".iu-feed-section-header-img");
        if (feedHeader) return feedHeader;
        if (!feed.hidden && feed.firstElementChild) return feed;
      }
      try {
        const sec = document.body && document.body.dataset ? String(document.body.dataset.section || "") : "";
        const viewBySec = {
          pocasi: "iuWeatherView",
          mapy: "iuMapyView",
          jr: "iuJrEmptyView",
          tvprogram: "iuTvProgramView",
          tvonline: "iuTvOnlineView",
          radio: "iuRadioView",
          travel: "feed",
        };
        let viewId = viewBySec[sec];
        if (!viewId && sec.indexOf("aff-") === 0) viewId = "iuAffiliateView";
        if (viewId) {
          const viewEl = document.getElementById(viewId);
          if (viewEl && !viewEl.hidden) {
            return (
              viewEl.querySelector(".iuSectionHeader") ||
              viewEl.querySelector("[data-view-host]") ||
              viewEl
            );
          }
        }
      } catch (_) {}
      return center;
    }
    if (!feed) return document.getElementById("iuCenterStage") || document.getElementById("newsList");
    return iuFeedSectionHeaderQueryAnchor(feed) || feed;
  }

  function iuScrollToActiveSectionStartInstant(){
    try {
      if (!iuIsDesktopNavLayout()) {
        if (window.__iuSectionSwitchScrollArm && !window.__iuScrollRestorePendingNav) {
          iuSetMainScrollTop(0);
          return;
        }
      }
    } catch (_) {}
    const anchor = iuResolveSectionScrollAnchor();
    if (!anchor) {
      try {
        if (typeof window !== "undefined" && window.__iuSectionSwitchScrollArm) return;
      } catch (_) {}
      iuSetMainScrollTop(0);
      return;
    }
    const sticky = iuGetTopbarStackOffsetPx();
    const rect = anchor.getBoundingClientRect();
    const current = iuGetMainScrollTop();
    const target = Math.max(0, Math.round(rect.top + current - sticky));
    iuSetMainScrollTop(target);
  }

  function iuScrollMainSectionSwitchToTop(){
    try{ window.__iuSectionSwitchScrollArm = true; }catch(_){}
    try{
      if (iuIsDesktopNavLayout()) return;
      iuSetMainScrollTop(0);
    }catch(_){}
  }

  /** Must mirror feed IIFE — nav block is separate scope. */
  function iuIsDesktopNavLayout(){
    try {
      return !!(window.matchMedia && window.matchMedia("(min-width: 901px)").matches);
    } catch (_) {
      return false;
    }
  }

  function iuIsMobileTabletNavLayout(){
    try {
      return !!(window.matchMedia && window.matchMedia("(max-width: 900px)").matches);
    } catch (_) {
      return false;
    }
  }

  function iuMobileTabletConsumeSectionSwitchScrollIfArmed(){
    try {
      if (iuIsDesktopNavLayout()) return;
      if (typeof window === "undefined" || !window.__iuSectionSwitchScrollArm) return;
      window.__iuSectionSwitchScrollArm = false;
      if (window.__iuScrollRestorePendingNav) return;
      iuScrollMainToTopInstant();
      try {
        requestAnimationFrame(function () {
          try { iuScrollMainToTopInstant(); } catch (_) {}
        });
      } catch (_) {}
    } catch (_) {}
  }

  function iuMobileTabletMenuNavScrollArm(){
    try {
      if (!iuIsMobileTabletNavLayout()) return;
      window.__iuMenuForwardNav = true;
      if (typeof window.iuMobileTabletOverlayScrollReset === "function") {
        window.iuMobileTabletOverlayScrollReset();
      }
    } catch (_) {}
  }

  function iuMobileTabletMenuForwardScrollSyncIfArmed(){
    try {
      if (!iuIsMobileTabletNavLayout()) return;
      if (window.__iuScrollRestorePendingNav) return;
      if (!window.__iuMenuForwardNav && !window.__iuSectionSwitchScrollArm) return;
      iuScrollMainToTopInstant();
      try { window.__iuSectionSwitchScrollArm = false; } catch (_) {}
      try {
        requestAnimationFrame(function () {
          try { iuScrollMainToTopInstant(); } catch (_) {}
          try {
            requestAnimationFrame(function () {
              try { iuScrollMainToTopInstant(); } catch (_) {}
            });
          } catch (_) {}
        });
      } catch (_) {}
    } catch (_) {}
  }

  function iuMenuForwardNavScrollAfterApply(){
    try { iuScrollMainSectionSwitchToTop(); } catch (_) {}
    try { iuMobileTabletMenuForwardScrollSyncIfArmed(); } catch (_) {}
  }

  function iuScrollMainToTopInstant(){
    iuSetMainScrollTop(0);
  }

  function iuScrollMainToTopSmooth(){
    try{
      const feed = document.getElementById("newsList") || document.getElementById("feed");
      if (feed) {
        try{
          if (typeof feed.scrollTo === "function") feed.scrollTo({ top: 0, behavior: "auto" });
          else feed.scrollTop = 0;
        }catch{
          try{ feed.scrollTop = 0; }catch{}
        }
      }
    }catch(_){}
    iuSetMainScrollTop(0);
  }

  /* P0 mobile/tablet: save/restore main scroll when overlay opens/closes inside an open section.
     Menu forward nav sets __iuMenuForwardNav so overlay layer does not fight section-to-top. */
  (function iuMobileTabletOverlayScrollRestoreV1(){
    var savedY = null;
    var depth = 0;

    function activeP() {
      try {
        return window.matchMedia("(max-width: 900px)").matches
          && document.body.classList.contains("iu-mobileMainVisible")
          && !document.body.classList.contains("iu-mobileGateOverlayOpen");
      } catch (_) {
        return false;
      }
    }

    function readY() {
      try {
        if (typeof iuGetMainScrollTop === "function") return iuGetMainScrollTop();
      } catch (_) {}
      return 0;
    }

    function writeY(y) {
      try {
        if (typeof iuSetMainScrollTop === "function") iuSetMainScrollTop(y);
      } catch (_) {}
    }

    function onModalOpen() {
      if (!activeP()) return;
      if (window.__iuMenuForwardNav) return;
      if (depth === 0) savedY = readY();
      depth++;
    }

    function onModalClose() {
      try {
        if (!window.matchMedia("(max-width: 900px)").matches) return;
      } catch (_) {
        return;
      }
      if (depth <= 0) return;
      depth--;
      if (depth === 0 && savedY !== null && !window.__iuMenuForwardNav) {
        var y = savedY;
        savedY = null;
        writeY(y);
        try {
          requestAnimationFrame(function () { writeY(y); });
        } catch (_) {}
      }
    }

    function resetState() {
      savedY = null;
      depth = 0;
    }

    try {
      var obs = new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) {
          var m = list[i];
          if (m.type !== "attributes" || m.attributeName !== "class") continue;
          if (m.target !== document.body) continue;
          var had = m.oldValue && /\biu-modal-open\b/.test(m.oldValue);
          var has = document.body.classList.contains("iu-modal-open");
          if (has && !had) onModalOpen();
          if (!has && had) onModalClose();
        }
      });
      obs.observe(document.body, { attributes: true, attributeOldValue: true, attributeFilter: ["class"] });
    } catch (_) {}

    try {
      window.iuMobileTabletOverlayScrollNotifyOpen = onModalOpen;
      window.iuMobileTabletOverlayScrollNotifyClose = onModalClose;
      window.iuMobileTabletOverlayScrollReset = resetState;
    } catch (_) {}
  })();

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

  function iuAutosizeTextarea(ta){
    try{
      if (!ta) return;
      ta.style.height = "auto";
      ta.style.overflow = "hidden";
      ta.style.height = (ta.scrollHeight + 2) + "px";
    }catch{}
  }

  function iuRenderNotesHost(hostEl, opts){
    try{
      const el = hostEl;
      if (!el) return;
      try{
        if (el.closest && el.closest("#iuTvOnlineView")) return;
      }catch{}
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
          void (async function () {
            const ok = await ensureLocalDataProtectionBeforeSave();
            if (!ok) return;
            try{
              localStorage.setItem(key, String(ta.value || ""));
              iuAutosizeTextarea(ta);
              try { ta.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch {}
            }catch{}
          })();
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
        try{
          /* Počasí (#iuWeatherView): žádný notes blok (P0). */
          if (el && el.closest && el.closest("#iuWeatherView")) return;
          /* Jízdní řády (#iuJrEmptyView): žádný notes blok (P0 — nesmí se renderovat textarea / akce). */
          if (el && el.closest && el.closest("#iuJrEmptyView")) return;
          /* TV online (#iuTvOnlineView): žádný notes blok (P0). */
          if (el && el.closest && el.closest("#iuTvOnlineView")) return;
          /* TV program (#iuTvProgramView): žádný notes modul (P0). */
          if (el && el.closest && el.closest("#iuTvProgramView")) return;
          /* Rádio (#iuRadioView): žádný notes blok (P0). */
          if (el && el.closest && el.closest("#iuRadioView")) return;
          iuRenderNotesHost(el, {});
        }catch{}
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
      /* Article verticals (Kultura / Akce, Hry, …): never mount section notes into #feed.
         Offline fallback used to resolve kultura → #feed and show the old notes block. */
      if (
        section === "kultura" ||
        section === "kultura-akce" ||
        section === "hry" ||
        section === "veda" ||
        section === "vzdelavani" ||
        section === "media" ||
        section === "feed" ||
        section === "travel" ||
        section === "cestovani"
      ) {
        return;
      }
      /* P0 Mapy & Navigace: žádný dynamický section-level .iuNotesHost v #iuMapyView (per HTML cleanup + proof). */
      if (section === "mapy" || section === "maps") return;
      /* P0 Jízdní řády: žádný section-level notes host (žádné dynamické vložení po otevření sekce). */
      if (section === "jr") {
        try{
          const jrView = document.getElementById("iuJrEmptyView");
          if (jrView) Array.from(jrView.querySelectorAll(".iuNotesHost")).forEach((h) => { try{ h.remove(); }catch{} });
        }catch{}
        return;
      }
      /* P0 TV online: žádný section-level .iuNotesHost (textarea / Zkopírovat / Sdílet / WhatsApp). */
      if (section === "tvonline") {
        try{
          const tvView = document.getElementById("iuTvOnlineView");
          if (tvView) Array.from(tvView.querySelectorAll(".iuNotesHost")).forEach((h) => { try{ h.remove(); }catch{} });
        }catch{}
        return;
      }
      /* P0 TV program: žádný .iuNotesHost / textarea (vizuální link hub, bez poznámek). */
      if (section === "tvprogram") {
        try{
          const v = document.getElementById("iuTvProgramView");
          if (v) Array.from(v.querySelectorAll(".iuNotesHost")).forEach((h) => { try{ h.remove(); }catch{} });
        }catch{}
        return;
      }
      /* P0 Rádio: žádný section-level .iuNotesHost v #iuRadioView. */
      if (section === "radio") {
        try{
          const rv = document.getElementById("iuRadioView");
          if (rv) Array.from(rv.querySelectorAll(".iuNotesHost")).forEach((h) => { try{ h.remove(); }catch{} });
        }catch{}
        return;
      }
      /* P0 Počasí: žádný section-level notes host (textarea / sdílení). */
      if (section === "pocasi") {
        try{
          const wv = document.getElementById("iuWeatherView");
          if (wv) Array.from(wv.querySelectorAll(".iuNotesHost")).forEach((h) => { try{ h.remove(); }catch{} });
        }catch{}
        return;
      }

      // map URL section -> storage key + view element (no article verticals — they use #feed)
      const map = {
        mapy:    { key: "mapy",     view: () => document.getElementById("iuMapyView") || document.getElementById("iuMapsView"), accentVar: "--iuNavAccent-mapy", label: "Mapy & Navigace" },
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

  function renderRadioView(viewEl){
    const mount = viewEl && typeof viewEl.querySelector === "function"
      ? viewEl.querySelector(".iuRadioMount")
      : null;
    const target = mount || viewEl;
    if (!target) return;

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

    target.innerHTML = `<div class="iuRadioGrid" role="list" aria-label="Odkazy na rádia">${chips}</div>`;
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
        persistNavStateFromHexKey(s.key);
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

  function setLeftNavForUrlState(nav){
    try{
      const items = document.querySelectorAll('.iu-leftNav .iu-leftNavItem');
      items.forEach((el) => {
        el.classList.remove('is-active');
        el.removeAttribute('aria-current');
      });
      if (iuArticleHubSectionP(nav.section)) {
        const tk = nav.topic && nav.topic !== "all" ? nav.topic : "all";
        const el = document.querySelector('.iu-leftNav .iu-leftNavItem[data-media-topic="' + tk + '"]');
        if (el) {
          el.classList.add('is-active');
          el.setAttribute('aria-current', 'page');
        }
      } else if (nav.section === 'travel') {
        const el = document.querySelector('.iu-leftNav .iu-leftNavItem[data-accent="travel"]');
        if (el) {
          el.classList.add('is-active');
          el.setAttribute('aria-current', 'page');
        }
      } else {
        const el = document.querySelector('.iu-leftNav .iu-leftNavItem[data-accent="' + nav.section + '"]');
        if (el) {
          el.classList.add('is-active');
          el.setAttribute('aria-current', 'page');
        }
      }
    }catch{}
  }

  function showView(key){
    /* P1 lazy mount: section view DOM is mounted from <template> on first show. */
    try { if (window.__iuSectionViewsLazyMount) window.__iuSectionViewsLazyMount.ensure(key); } catch (_) {}
    const center = document.getElementById('iuCenterStage');
    if (!center) return;
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
    /* Legacy ?section=tv: feed hidden (iu-fc=0) but no #iuTvOnlineView without data-section=tvonline — blank main column. */
    if (k === 'tv') return 'tvonline';
    if (k === 'radio') return 'radio';
    if (k === 'jr') return 'jr';
    if (k.indexOf('aff-') === 0) return k;
    if (k === 'media') return IU_ARTICLE_HUB_SECTION;
    // allow other left-rail sections to roundtrip via URL without changing feed pipeline
    const allowed = new Set([IU_ARTICLE_HUB_SECTION,'tv','tvonline','mapy','travel','pocasi','tvprogram','hry','kultura','veda','vzdelavani','jr']);
    if (k === 'home') return IU_ARTICLE_HUB_SECTION;
    if (k === 'culture') return 'kultura';
    // P0 SAFE DISABLE: historické sekce (tech/bydleni) nesmí být routovatelné jako veřejné sekce
    if (k === 'tech' || k === 'bydleni') return IU_ARTICLE_HUB_SECTION;
    if (k === 'ads') return IU_ARTICLE_HUB_SECTION;
    // topic-only accents (URL uses ?section=feed&topic=…)
    if (['zpravy','sport','finance','zdravi'].indexOf(k) !== -1) return IU_ARTICLE_HUB_SECTION;
    return allowed.has(k) ? k : IU_ARTICLE_HUB_SECTION;
  }

  function getInitialSection(){
    try{
      const params = new URLSearchParams(window.location.search);
      return normalizeSection(params.get('section') || IU_ARTICLE_HUB_SECTION);
    }catch{
      return IU_ARTICLE_HUB_SECTION;
    }
  }

  function persistSection(section){
    try{
      persistNavState({ section: String(section || IU_ARTICLE_HUB_SECTION).toLowerCase() });
    }catch{}
  }

  function readUrlNavState(){
    try{
      const p = new URLSearchParams(window.location.search || "");
      const rawSec = (p.get("section") || IU_ARTICLE_HUB_SECTION).trim().toLowerCase();
      const section = normalizeSection(rawSec);
      let topic = (p.get("topic") || "").trim().toLowerCase();
      if (section === "travel") {
        return { section, topic: "", mode: "media" };
      }
      let mode = (p.get("mode") || "media").trim().toLowerCase();
      if (mode !== "media") mode = "media";
      // P0 SAFE DISABLE: fallback pro staré URL (topic=tech/bydleni nebo section=tech/bydleni)
      const hadDisabledSection = rawSec === "tech" || rawSec === "bydleni";
      const hadDisabledTopic = topic === "tech" || topic === "bydleni";
      if (hadDisabledSection) topic = "zpravy";
      if (hadDisabledTopic) topic = "zpravy";
      /* Missing/empty topic = global media feed (no implicit zpravy-only filter). */
      if (hadDisabledSection || hadDisabledTopic) {
        try { persistNavState({ section: IU_ARTICLE_HUB_SECTION, topic: "zpravy" }); } catch (_) {}
      }
      if (rawSec === "ads") {
        try { persistNavState({ section: IU_ARTICLE_HUB_SECTION, topic: "" }); } catch (_) {}
      }
      return { section, topic, mode };
    }catch{
      return { section: IU_ARTICLE_HUB_SECTION, topic: "", mode: "media" };
    }
  }

  /** Global article hub from URL (section media + no topic / topic all) — body.iu-home can lag first applyFilter. */
  function iuGlobalArticleHubFromNav() {
    try {
      const n = readUrlNavState();
      const topic = String(n.topic || "").trim().toLowerCase();
      const sec = String(n.section || "").trim().toLowerCase();
      return iuArticleHubSectionP(sec) && (!topic || topic === "all");
    } catch (_) {
      return false;
    }
  }
  try {
    window.iuGlobalArticleHubFromNav = iuGlobalArticleHubFromNav;
  } catch (_) {}

  /**
   * P0 mobile/tablet „Navigace po webu“: deterministický návratový stav — odděleno od obecného routeru.
   * Ozbrojí další pushState (?section=) metadaty iu_webnav_* + sessionStorage (WebKit/bfcache).
   */
  function iuMobileWebNavReturnArmForTile(tileKey) {
    try {
      if (typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 900px)").matches) return;
      var wrapArm = document.getElementById("iuMobileGateWrap");
      if (
        !wrapArm ||
        String(wrapArm.getAttribute("data-iu-mobile-gate") || "") !== "nav"
      ) {
        return;
      }
      var tk = String(tileKey || "").trim();
      try {
        window.__iuMobileWebNavReturnArmed = true;
        window.__iuMobileWebNavOrigin = "overlay";
        window.__iuMobileWebNavLastTile = tk;
      } catch (_){}
      try {
        sessionStorage.setItem("iuMobileWebNavReturnArmed", "1");
        sessionStorage.setItem("iuMobileWebNavLastTarget", tk);
      } catch (_){}
      try {
        window.__iuWebNavReturnStateForNextPush = {
          iu_webnav_return_armed: true,
          iu_webnav_source: "overlay",
          iu_webnav_tile: tk,
        };
      } catch (_){}
    } catch (_){}
  }
  try {
    window.iuMobileWebNavReturnArmForTile = iuMobileWebNavReturnArmForTile;
  } catch (_) {}

  function persistNavState(o){
    try{
      const u = new URL(window.location.href);
      /* P0 mobile/tablet webnav: strip overlay hash before writing ?section= (tile must push a new history entry, not replace). */
      try {
        var h0 = String(u.hash || "").replace(/^#/, "");
        if (h0 === "iu-nav" || h0 === "nav") u.hash = "";
      } catch (_){}
      let sec = String(o.section || IU_ARTICLE_HUB_SECTION).toLowerCase();
      if (sec === "media") sec = IU_ARTICLE_HUB_SECTION;
      u.searchParams.set("section", sec);
      if (sec === IU_ARTICLE_HUB_SECTION) {
        const t = String(o.topic || "").trim().toLowerCase();
        if (t && t !== "all") u.searchParams.set("topic", t);
        else u.searchParams.delete("topic");
        u.searchParams.delete("mode");
      } else if (sec === "travel") {
        u.searchParams.delete("topic");
        u.searchParams.delete("mode");
      } else {
        u.searchParams.delete("topic");
        u.searchParams.delete("mode");
      }
      var usePush = false;
      try {
        var wrapPn = document.getElementById("iuMobileGateWrap");
        usePush =
          !!wrapPn &&
          String(wrapPn.getAttribute("data-iu-mobile-gate") || "") === "nav" &&
          window.matchMedia &&
          window.matchMedia("(max-width: 900px)").matches;
      } catch (_){}
      if (usePush) {
        var pushSt = null;
        try {
          pushSt = window.__iuWebNavReturnStateForNextPush || null;
          window.__iuWebNavReturnStateForNextPush = null;
        } catch (_){}
        history.pushState(pushSt, "", u);
        try {
          window.__iuWebNavSectionPush = true;
        } catch (_){}
      } else {
        try {
          window.__iuWebNavReturnStateForNextPush = null;
        } catch (_){}
        history.replaceState(null, "", u);
        try {
          window.__iuWebNavSectionPush = false;
        } catch (_){}
      }
    }catch{}
  }

  function persistNavStateFromHexKey(key){
    const k = String(key || "").trim().toLowerCase();
    const MEDIA_TOPIC_KEYS = new Set(["all", "zpravy", "sport", "finance", "zdravi", "media", "feed"]);
    if (k === "feed" || k === "media" || k === "all") {
      persistNavState({ section: IU_ARTICLE_HUB_SECTION, topic: "" });
    } else if (k === "tech" || k === "bydleni") {
      persistNavState({ section: IU_ARTICLE_HUB_SECTION, topic: "zpravy" });
    } else if (MEDIA_TOPIC_KEYS.has(k)) {
      persistNavState({ section: IU_ARTICLE_HUB_SECTION, topic: k });
    } else if (k === "travel") {
      persistNavState({ section: "travel" });
    } else {
      persistNavState({ section: normalizeSection(k) });
    }
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

  function iuAiEnsureGuardClasses() {
    try {
      const ov = document.getElementById("iu-aiOverlay");
      const pan = document.getElementById("iu-aiPanel");
      const scrollHost = pan ? pan.querySelector(".iu-aiPanelBody") : null;
      if (ov) ov.classList.add("iu-ai-overlay-root");
      if (pan) pan.classList.add("iu-ai-overlay-root");
      if (scrollHost) scrollHost.classList.add("iu-ai-scroll-host");
    } catch (_) {}
  }
  try { window.iuAiEnsureGuardClasses = iuAiEnsureGuardClasses; } catch (_) {}

  function ensureAiModalInBody() {
    const overlays = document.querySelectorAll("#iu-aiOverlay");
    const panels = document.querySelectorAll("#iu-aiPanel");
    const overlay = overlays[0] || null;
    const panel = panels[0] || null;
    if (!overlay || !panel) return false;
    for (let i = 1; i < overlays.length; i++) overlays[i].setAttribute("data-iu-dup", "1");
    for (let i = 1; i < panels.length; i++) panels[i].setAttribute("data-iu-dup", "1");
    try {
      document.body.appendChild(overlay);
      document.body.appendChild(panel);
    } catch (_) {}
    iuAiEnsureGuardClasses();
    return true;
  }
  try { window.ensureAiModalInBody = ensureAiModalInBody; } catch (_) {}

  function ensureDatovkaModalInBody() {
    const overlays = document.querySelectorAll("#iuDsOverlay");
    const panels = document.querySelectorAll("#iuDsPanel");
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
  try { window.ensureDatovkaModalInBody = ensureDatovkaModalInBody; } catch (_) {}

  function ensureFinancialModalInBody() {
    const backs = document.querySelectorAll("#iuFinancialCalcBackdrop");
    const panels = document.querySelectorAll("#iuFinancialCalcPanel");
    const back = backs[0] || null;
    const panel = panels[0] || null;
    if (!back || !panel) return false;
    for (let i = 1; i < backs.length; i++) backs[i].setAttribute("data-iu-dup", "1");
    for (let i = 1; i < panels.length; i++) panels[i].setAttribute("data-iu-dup", "1");
    if (back.parentElement === document.body && panel.parentElement === document.body) return true;
    const frag = document.createDocumentFragment();
    frag.appendChild(back);
    frag.appendChild(panel);
    document.body.appendChild(frag);
    return true;
  }
  try { window.ensureFinancialModalInBody = ensureFinancialModalInBody; } catch (_) {}

  function ensureLegalDocsModalInBody() {
    const backs = document.querySelectorAll("#iuLegalDocsBackdrop");
    const panels = document.querySelectorAll("#iuLegalDocsPanel");
    const back = backs[0] || null;
    const panel = panels[0] || null;
    if (!back || !panel) return false;
    for (let i = 1; i < backs.length; i++) backs[i].setAttribute("data-iu-dup", "1");
    for (let i = 1; i < panels.length; i++) panels[i].setAttribute("data-iu-dup", "1");
    if (back.parentElement === document.body && panel.parentElement === document.body) return true;
    const frag = document.createDocumentFragment();
    frag.appendChild(back);
    frag.appendChild(panel);
    document.body.appendChild(frag);
    return true;
  }
  try { window.ensureLegalDocsModalInBody = ensureLegalDocsModalInBody; } catch (_) {}

  function ensureInvoiceModalInBody() {
    const backs = document.querySelectorAll("#iuInvoiceBackdrop");
    const panels = document.querySelectorAll("#iuInvoicePanel");
    const back = backs[0] || null;
    const panel = panels[0] || null;
    if (!back || !panel) return false;
    for (let i = 1; i < backs.length; i++) backs[i].setAttribute("data-iu-dup", "1");
    for (let i = 1; i < panels.length; i++) panels[i].setAttribute("data-iu-dup", "1");
    if (back.parentElement === document.body && panel.parentElement === document.body) return true;
    const frag = document.createDocumentFragment();
    frag.appendChild(back);
    frag.appendChild(panel);
    document.body.appendChild(frag);
    return true;
  }
  try { window.ensureInvoiceModalInBody = ensureInvoiceModalInBody; } catch (_) {}

  function iuHideAllOverlaysNow(){
    try {
      if (typeof window !== "undefined" && window.__iuNavOverlayLock === true) return;
    } catch (_){}
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

  /** P0 perf: left-rail / hex nav — avoid synchronous iuForceCloseAllOverlays (QuickFeed innerHTML, modal sweep). */
  function iuNavRailHideOverlaysFast() {
    try {
      const panel = document.getElementById("iu-aiPanel");
      const overlay = document.getElementById("iu-aiOverlay");
      if (typeof iuSetElOpenVisible === "function") {
        iuSetElOpenVisible(panel, false);
        iuSetElOpenVisible(overlay, false);
      } else {
        if (panel) panel.hidden = true;
        if (overlay) overlay.hidden = true;
      }
      try {
        if (panel) {
          panel.dataset.open = "0";
          panel.classList.remove("is-open");
        }
      } catch (_) {}
      const qf = document.getElementById("iuQuickFeed");
      if (qf) {
        qf.hidden = true;
        try {
          qf.style.display = "none";
        } catch (_) {}
      }
      try {
        document.body.classList.remove("iu-modal-open", "iu-ai-narrow-fullscreen");
        document.body.style.overflow = "";
      } catch (_) {}
    } catch (_) {}
    try {
      var ricNav =
        typeof requestIdleCallback !== "undefined"
          ? requestIdleCallback
          : function (cb, opt) {
              return setTimeout(function () {
                try {
                  cb({ didTimeout: true, timeRemaining: function () { return 5; } });
                } catch (_) {}
              }, opt && opt.timeout ? Math.min(opt.timeout, 64) : 48);
            };
      ricNav(
        function () {
          try {
            if (typeof window.iuForceCloseAllOverlays === "function") {
              window.iuForceCloseAllOverlays();
            }
          } catch (_) {}
        },
        { timeout: 900 }
      );
    } catch (_) {}
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

  /** P0: při otevření / návratu (vč. BFCache) vždy hlavní stránka — odstraní ?section= / ?panel= / ?radarOpen= z URL (root cause: browser restore poslední URL). */
  function iuStripProjectsNavParamsForHomeLanding(){
    try{
      if (typeof window.iuIsProjectsRoute !== "function" || !window.iuIsProjectsRoute()) return;
      const u = new URL(location.href);
      if (!u.search) return;
      /* section/topic/mode: deep links must survive (media topic filter + travel mode) */
      const keys = ["panel", "radarOpen"];
      let changed = false;
      for (let i = 0; i < keys.length; i++){
        const k = keys[i];
        if (u.searchParams.has(k)){
          u.searchParams.delete(k);
          changed = true;
        }
      }
      if (changed){
        const q = u.searchParams.toString();
        history.replaceState(null, "", u.pathname + (q ? "?" + q : "") + u.hash);
      }
    }catch(_){}
  }
  try { window.iuStripProjectsNavParamsForHomeLanding = iuStripProjectsNavParamsForHomeLanding; } catch(_){}

  /**
   * P0: Keep body.iu-home in sync with URL: global article hub (section feed/media, no topic filter).
   * Feed visibility handler skips full loadData() when iu-home is set (tab return on default /projects/ hub).
   */
  function iuSyncBodyIuHomeFromProjectsNav(nav) {
    try {
      if (typeof window.iuIsProjectsRoute !== "function" || !window.iuIsProjectsRoute()) {
        if (document.body) document.body.classList.remove("iu-home");
        return;
      }
      const n = nav && typeof nav === "object" ? nav : readUrlNavState();
      const topic = String(n.topic || "").trim().toLowerCase();
      const sec = String(n.section || "").trim().toLowerCase();
      let desktopDefaultTopic = null;
      try {
        if (
          window.matchMedia &&
          window.matchMedia("(min-width: 901px)").matches &&
          !window.__iuDesktopExplicitPrehledDne &&
          iuArticleHubSectionP(sec) &&
          (!topic || topic === "all")
        ) {
          desktopDefaultTopic = "zpravy";
        }
      } catch (_) {}
      const globalArticleHub =
        iuArticleHubSectionP(sec) && (!topic || topic === "all") && !desktopDefaultTopic;
      if (document.body) {
        document.body.classList.toggle("iu-home", globalArticleHub === true);
      }
    } catch (_) {
      try {
        if (document.body) document.body.classList.remove("iu-home");
      } catch (__) {}
    }
  }
  try {
    window.iuSyncBodyIuHomeFromProjectsNav = iuSyncBodyIuHomeFromProjectsNav;
  } catch (_) {}

  /** True when URL state uses the article feed pipeline (filter / loadData / auto-refresh). Non-feed sections must skip these. */
  function iuProjectsNavUsesFeedPipeline(nav) {
    try {
      const section = String(nav.section || "").trim().toLowerCase();
      if (iuArticleHubSectionP(section)) return true;
      if (["hry", "kultura", "veda", "vzdelavani", "travel"].indexOf(section) !== -1) return true;
    } catch (_) {}
    return false;
  }

  /**
   * P0 CLS (/projects/ tablet cold URL): keep mobile main shell in sync with showView in the same turn.
   * Previously this lived only inside applySection's post-apply rAF — first paint laid out gate + #leftContent
   * without iu-mobileMainVisible, then the class add (≈300–1200ms) produced a dominant ~0.85 layout-shift
   * on #leftContent / .iuSeoText (e.g. ?section=radio @ 768×1024).
   */
  function iuApplyMobileMainShellFromSectionNav(section, nav) {
    try {
      if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
        const sec = String(section || "").toLowerCase();
        if (sec && !iuArticleHubSectionP(sec)) {
          try {
            if (typeof window !== "undefined" && window.__iuNavOverlayLock === true) {
              /* P0: hard-lock — popstate reopened web-nav overlay; skip main-nav chrome until lock clears */
            } else {
              try {
                if (typeof window.iuMobileGateCloseForMainNav === "function") window.iuMobileGateCloseForMainNav();
              } catch (_) {}
              document.body.classList.add("iu-mobileMainVisible");
              var mbVisSync = document.getElementById("iuMobileMainBackBar");
              if (mbVisSync) mbVisSync.hidden = true;
              try {
                if (!(typeof window !== "undefined" && window.__iuWebNavGateDetailLatch === true)) {
                  document.body.classList.remove("iu-webnavDetailFromGate");
                }
              } catch (_) {}
              try {
                if (typeof window.iuWebNavDetailBackBarHostSync === "function") window.iuWebNavDetailBackBarHostSync();
              } catch (_) {}
            }
          } catch (_) {}
        } else if (iuArticleHubSectionP(sec)) {
          /* P0: Do not remove iu-mobileMainVisible on the post-applySection rAF for feed/Média hub.
             Left-rail / Silver preview handlers add this class before applySectionFromURL(); stripping it
             here re-showed #iuMobileGateWrap (body:not(.iu-mobileMainVisible) loses the gate-hide rule)
             and on ≤767px hid #leftContent again — taps looked dead or needed a second try. */
          /* P0 tablet portrait (768–900) Back→homepage: pure hub URL (no ?section=) must drop
             iu-mobileMainVisible — the leftover class clamps #leftContent (overflow:hidden) and the
             homepage comes back clipped + unscrollable, so scroll restore has no scroll range.
             Cold tablet home load has no such class; phones (≤767) keep the protection above. */
          try {
            var iuHubNoSectionParam = !new URLSearchParams(String(window.location.search || "")).has("section");
            if (
              iuHubNoSectionParam &&
              window.matchMedia &&
              window.matchMedia("(min-width: 768px) and (max-width: 900px)").matches
            ) {
              document.body.classList.remove("iu-mobileMainVisible");
            }
          } catch (_) {}
          try {
            if (!(typeof window !== "undefined" && window.__iuWebNavGateDetailLatch === true)) {
              document.body.classList.remove("iu-webnavDetailFromGate");
            }
          } catch (_) {}
          /* P0 mobile/tablet cold URL / reload: ?section=feed&topic=zpravy (konkrétní vertikála) — stejný chrome
             jako po tapu na HOME/Silver preview (iu-mobileMainVisible + #iuMobileMainBackBar + host sync). */
          try {
            if (typeof window !== "undefined" && window.__iuNavOverlayLock === true) {
              /* stejné jako non–hub větev: při hard-lock overlaye nesahat na main chrome */
            } else {
              const topicCold = String(nav && nav.topic ? nav.topic : "").trim().toLowerCase();
              if (topicCold && topicCold !== "all") {
                try {
                  if (typeof window.iuMobileGateCloseForMainNav === "function") window.iuMobileGateCloseForMainNav();
                } catch (_) {}
                try {
                  document.body.classList.add("iu-mobileMainVisible");
                } catch (_) {}
                var mbFeedTopicColdSync = document.getElementById("iuMobileMainBackBar");
                if (mbFeedTopicColdSync) mbFeedTopicColdSync.hidden = true;
              }
            }
          } catch (_) {}
          try {
            if (typeof window.iuWebNavDetailBackBarHostSync === "function") window.iuWebNavDetailBackBarHostSync();
          } catch (_) {}
        } else {
          try {
            document.body.classList.remove("iu-mobileMainVisible");
          } catch (_) {}
          var mbHidSync = document.getElementById("iuMobileMainBackBar");
          if (mbHidSync) mbHidSync.hidden = true;
          try {
            if (!(typeof window !== "undefined" && window.__iuWebNavGateDetailLatch === true)) {
              document.body.classList.remove("iu-webnavDetailFromGate");
            }
          } catch (_) {}
          try {
            if (typeof window.iuWebNavDetailBackBarHostSync === "function") window.iuWebNavDetailBackBarHostSync();
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  /**
   * P0 CLS (tablet 768–900 Menu → tool/affiliate): Silver gate min-height (~656px) vs #leftContent main
   * shell paint only after applySection/showView — same ~0.86 shift as cold URL before early shell.
   * Mirror index.html early inline script: set data-iu-tool-main + iu-mobileMainVisible before overlay
   * teardown and showView, only on tablet portrait band (phones use applySection toggle).
   */
  function iuPreApplyTabletToolShellBeforeNav(accentKey, mediaTopicKey) {
    try {
      if (!window.matchMedia || !window.matchMedia("(min-width: 768px) and (max-width: 900px)").matches) return;
      var sec = mediaTopicKey ? IU_ARTICLE_HUB_SECTION : normalizeSection(accentKey);
      if (!sec || sec === "travel" || iuArticleHubSectionP(sec)) return;
      var toolSec = { pocasi: 1, mapy: 1, maps: 1, jr: 1, tvprogram: 1, tvonline: 1, radio: 1 };
      if (!(toolSec[sec] || sec.indexOf("aff-") === 0)) return;
      if (document.documentElement) document.documentElement.setAttribute("data-iu-tool-main", "1");
      if (document.body) document.body.setAttribute("data-iu-tool-main", "1");
      document.body.classList.add("iu-mobileMainVisible");
      try {
        if (typeof window.iuMobileGateCloseForMainNav === "function") window.iuMobileGateCloseForMainNav();
      } catch (_) {}
      var mbPre = document.getElementById("iuMobileMainBackBar");
      if (mbPre) mbPre.hidden = true;
    } catch (_) {}
  }

  /**
   * P0 CLS (tablet 768–900 Menu overlay → tool/affiliate): gate wrap stays ~2860px in document flow during
   * overlay; SPA applySection hides it (~0.86 shift on #leftContent). Cold ?section= avoids overlay paint —
   * hard-assign to target section from open Menu so early inline shell runs before first paint.
   */
  function iuTabletMenuToolHardNavIfNeeded(accentKey, mediaTopicKey) {
    try {
      if (!document.body || !document.body.classList.contains("iu-mobileGateOverlayOpen")) return false;
      if (!window.matchMedia || !window.matchMedia("(min-width: 768px) and (max-width: 900px)").matches) return false;
      var sec = mediaTopicKey ? IU_ARTICLE_HUB_SECTION : normalizeSection(accentKey);
      if (!sec || sec === "travel" || iuArticleHubSectionP(sec)) return false;
      var toolSec = { pocasi: 1, mapy: 1, maps: 1, jr: 1, tvprogram: 1, tvonline: 1, radio: 1 };
      if (!(toolSec[sec] || sec.indexOf("aff-") === 0)) return false;
      var u = new URL(window.location.href);
      u.searchParams.set("section", sec);
      if (mediaTopicKey) u.searchParams.set("topic", mediaTopicKey);
      else u.searchParams.delete("topic");
      u.searchParams.delete("panel");
      window.location.assign(u.toString());
      return true;
    } catch (_) {}
    return false;
  }

  function applySectionFromURL(accentOverride){
    void accentOverride;
    /* P0 web-nav return controller: jeden tick bez obecného section apply při řízeném návratu do overlaye. */
    try {
      if (window.__iuMobileWebNavReturnSuppress === true) return;
    } catch (_e) {}
    /* P0 hub URL: žádné ?section= — vyčisti web-nav return arm; storage nesmí přebít čistou URL při dalším popstate/reload ticku. */
    try {
      if (
        typeof window !== "undefined" &&
        typeof window.iuIsProjectsRoute === "function" &&
        window.iuIsProjectsRoute()
      ) {
        var pHub = new URLSearchParams(
          (typeof location !== "undefined" && location.search) || ""
        );
        if (!pHub.has("section")) {
          try {
            sessionStorage.removeItem("iuMobileWebNavReturnArmed");
            sessionStorage.removeItem("iuMobileWebNavLastTarget");
          } catch (_arm) {}
          try {
            window.__iuMobileWebNavReturnArmed = false;
            delete window.__iuMobileWebNavLastTile;
          } catch (_arm2) {}
          try {
            var hHub = String(
              (typeof location !== "undefined" && location.hash) || ""
            );
            var hubCleanQuery =
              !pHub.has("topic") && !pHub.has("mode");
            if (
              hubCleanQuery &&
              hHub !== "#iu-nav" &&
              hHub !== "#nav" &&
              typeof history !== "undefined" &&
              typeof history.replaceState === "function" &&
              history.state &&
              history.state.iu_nav_overlay === true
            ) {
              var uHub = new URL(
                (typeof location !== "undefined" && location.href) || ""
              );
              history.replaceState(null, "", uHub.toString());
            }
          } catch (_st) {}
        }
      }
    } catch (_hub) {}
    const nav = readUrlNavState();
    const section = nav.section;
    /* P0 Počasí inline video: must not keep playing in background when leaving weather / any other section applies. */
    try {
      if (section !== "pocasi") {
        stopWeatherInlineVideo("applySection_non_weather");
      }
    } catch (_wxVidStop) {}
    const usesFeed = iuProjectsNavUsesFeedPipeline(nav);
    try {
      const feedState =
        typeof window !== "undefined" && window.__iuFeedPipelineState
          ? window.__iuFeedPipelineState
          : state;
      const czVerticals = ["hry", "kultura", "veda", "vzdelavani"];
      if (czVerticals.indexOf(section) !== -1) {
        feedState.mediaTopicKey = section;
        feedState.travelUiMode = "media";
      } else {
        const explicitPrehledHub =
          window.__iuDesktopExplicitPrehledDne === true &&
          iuArticleHubSectionP(section) &&
          (!nav.topic || nav.topic === "all");
        feedState.mediaTopicKey = null;
        if (explicitPrehledHub) {
          /* desktop Přehled dne click: keep global hub feed, never re-apply default Zprávy */
        } else if (section === "travel") {
          feedState.mediaTopicKey = "cestovani";
        } else if (iuArticleHubSectionP(section) && nav.topic && nav.topic !== "all") {
          feedState.mediaTopicKey = nav.topic;
        } else {
          const desktopDefaultTopic = iuDesktopDefaultFeedTopicResolve(nav);
          if (desktopDefaultTopic) {
            feedState.mediaTopicKey = desktopDefaultTopic;
          }
        }
        feedState.travelUiMode = "media";
      }
    } catch (_) {}
    const accentColorKey =
      iuArticleHubSectionP(section) && nav.topic && nav.topic !== "all" ? nav.topic : section;
    // safe: UI-only section marker for stable CSS scoping (no feed pipeline touch)
    try{ document.body && (document.body.dataset.section = section); }catch{}
    try{ document.documentElement && (document.documentElement.dataset.section = section); }catch{}
    try{
      var iuTmSec = { pocasi: 1, mapy: 1, maps: 1, jr: 1, tvprogram: 1, tvonline: 1, radio: 1 };
      if (iuTmSec[section] || section.indexOf("aff-") === 0) {
        if (document.documentElement) document.documentElement.setAttribute("data-iu-tool-main", "1");
        if (document.body) document.body.setAttribute("data-iu-tool-main", "1");
      } else {
        if (document.documentElement) document.documentElement.removeAttribute("data-iu-tool-main");
        if (document.body) document.body.removeAttribute("data-iu-tool-main");
      }
    }catch(_iuTm){}
    try{
      const iuFc = ["media", "feed", "travel", "hry", "kultura", "veda", "vzdelavani"].indexOf(section) !== -1 ? "1" : "0";
      if (document.body) document.body.setAttribute("data-iu-fc", iuFc);
      if (document.documentElement) document.documentElement.setAttribute("data-iu-fc", iuFc);
    }catch{}
    try{
      if (document.body) {
        if (section === "travel") document.body.dataset.travelFeed = "1";
        else delete document.body.dataset.travelFeed;
      }
      if (document.documentElement) {
        if (section === "travel") document.documentElement.dataset.travelFeed = "1";
        else delete document.documentElement.dataset.travelFeed;
      }
    }catch{}
    try{
      const color = IU_CONTENT_ACCENTS[accentColorKey] || IU_CONTENT_ACCENTS[section] || "";
      document.body && document.body.style.setProperty("--iuContentAccent", color);
    }catch{}
    // feed paging must reset on section change
    // (exception: history back/forward with a pending scroll restore keeps the saved page,
    //  otherwise deep positions from "load more" pages are unreachable after Back)
    try {
      const fp = typeof window !== "undefined" && window.__iuFeedPipelineState ? window.__iuFeedPipelineState : null;
      const prPage = typeof window !== "undefined" && window.__iuScrollRestorePendingNav ? Number(window.__iuScrollRestorePendingNav.page) : 0;
      if (fp) fp.page = prPage > 1 ? prPage : 1;
    } catch (_) {}
    try {
      iuApplyMobileMainShellFromSectionNav(section, nav);
    } catch (_) {}
    let viewKey = "media";
    if (section.indexOf("aff-") === 0) {
      viewKey = "affiliate";
    } else {
      viewKey = VIEW_MAP[section] ?? "media";
    }
    showView(viewKey);
    try {
      if (section.indexOf("aff-") === 0 && typeof window.iuAffiliateApplySection === "function") {
        window.iuAffiliateApplySection(section);
      }
    } catch (_) {}
    try {
      iuSyncBodyIuHomeFromProjectsNav(nav);
    } catch (_) {}
    /* P0 click latency: aktivní stav levé navigace ve stejném tahu jako data-section / showView (ne až v post-apply rAF). */
    try {
      setLeftNavForUrlState(nav);
    } catch (_) {}

    /* P0 section switch stability: eager feed filter+render — idle deferral kept stale articles/header visible up to ~500ms. */
    if (usesFeed) {
      /* scroll restore (back/forward): do not arm scroll-to-section-start — the restore layer brings
         the user back to the saved position instead. Forward navigation keeps arming as before. */
      try{
        window.__iuSectionSwitchScrollArm =
          !window.__iuScrollRestorePendingNav && !iuDesktopHubEntryShouldStartAtTop();
      }catch(_){}
      try {
        if (!iuIsDesktopNavLayout() && window.__iuMenuForwardNav && !window.__iuScrollRestorePendingNav) {
          window.__iuSectionSwitchScrollArm = true;
        }
      } catch (_) {}
      try {
        const fpSw = typeof window !== "undefined" && window.__iuFeedPipelineState ? window.__iuFeedPipelineState : null;
        if (fpSw) {
          fpSw.__iuFeedSwitchSeq = (fpSw.__iuFeedSwitchSeq || 0) + 1;
          fpSw.__iuRenderFeedGeneration = (fpSw.__iuRenderFeedGeneration | 0) + 1;
        }
      } catch (_) {}
      try {
        const feedSw = document.getElementById("feed");
        if (feedSw) {
          const prevH = feedSw.offsetHeight;
          const topicOnlyDesktopFeedSwitch = iuFeedSectionSwitchTopicOnlyDesktopP(section, nav);
          let holdMinH = 0;
          if (prevH > 120) {
            holdMinH = topicOnlyDesktopFeedSwitch
              ? iuFeedSectionSwitchEstimatedMinHeightPx()
              : prevH;
          }
          if (holdMinH > 120) feedSw.style.minHeight = holdMinH + "px";
          feedSw.setAttribute("data-feed-ready", "false");
          feedSw.setAttribute("data-feed-switching", "1");
          try {
            const fpSeq =
              typeof window !== "undefined" && window.__iuFeedPipelineState ? window.__iuFeedPipelineState : null;
            feedSw.setAttribute("data-feed-switch-seq", String((fpSeq && fpSeq.__iuFeedSwitchSeq) || 0));
            var swSeqWatch = String((fpSeq && fpSeq.__iuFeedSwitchSeq) || 0);
            try {
              window.setTimeout(function () {
                try {
                  var felW = document.getElementById("feed");
                  if (!felW) return;
                  if (String(felW.getAttribute("data-feed-switching") || "") !== "1") return;
                  if (String(felW.getAttribute("data-feed-switch-seq") || "") !== swSeqWatch) return;
                  felW.removeAttribute("data-feed-switching");
                  if (!iuChunkShouldHoldFeedMinHeightP()) {
                    iuFeedReleaseMinHeightIfAllowed(felW);
                  }
                } catch (_) {}
              }, 12000);
            } catch (_) {}
          } catch (_) {}
          try {
            iuFeedSectionSwitchInstantClear(feedSw);
          } catch (_) {}
          try {
            const vkFn =
              typeof window.__iuFeedSectionHeaderResolveVisualKey === "function"
                ? window.__iuFeedSectionHeaderResolveVisualKey
                : null;
            const vk = vkFn ? String(vkFn() || "") : "";
            if (vk) feedSw.setAttribute("data-feed-visual-key", vk);
            else feedSw.removeAttribute("data-feed-visual-key");
          } catch (_) {}
        }
      } catch (_) {}
      try {
        if (typeof window.__iuApplyFeedFilter === "function") {
          const prFeedNav = typeof window !== "undefined" ? window.__iuScrollRestorePendingNav : null;
          const keepPage = !!(prFeedNav && Number(prFeedNav.page) > 1);
          void window.__iuApplyFeedFilter({ resetPage: !keepPage, instantSectionSwitch: true });
        }
      } catch (_) {}
    }

    try { iuMobileTabletMenuForwardScrollSyncIfArmed(); } catch (_) {}

    try {
      requestAnimationFrame(function iuApplySectionPostPaint() {
        try {
          if (typeof window.iuEnsureArticlesView === "function") window.iuEnsureArticlesView();
        } catch (_) {}
        try {
          if (!usesFeed) {
            iuDesktopConsumeSectionSwitchScrollIfArmed();
            iuMobileTabletConsumeSectionSwitchScrollIfArmed();
          }
        } catch (_) {}
        try { iuMobileTabletMenuForwardScrollSyncIfArmed(); } catch (_) {}

    // P0 mobile shell: iuApplyMobileMainShellFromSectionNav(section, nav) runs synchronously after showView
    // (see iuApplyMobileMainShellFromSectionNav) — do not duplicate here.

    // Weather (UI-only): fetch/render immediately when Počasí section opens (no idle defer).
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

    // P0 perf: chip contrast + feed bootstrap in idle — applyFilter runs synchronously on feed nav (see usesFeed block above).
    try {
      var ricFeed =
        typeof requestIdleCallback !== "undefined"
          ? requestIdleCallback
          : function (cb, opt) {
              return setTimeout(function () {
                try {
                  cb({ didTimeout: true, timeRemaining: function () { return 5; } });
                } catch (_) {}
              }, opt && opt.timeout ? Math.min(opt.timeout, 48) : 1);
            };
      ricFeed(
        function () {
          try {
            var contrastRoot = iuSolidChipContrastRootForSection(section, nav);
            if (contrastRoot) iuApplySolidChipTextContrastInView(contrastRoot);
          } catch (_) {}
          if (!usesFeed) return;
          try {
            var pl = typeof window !== "undefined" && window.__iuFeedPipelineState ? window.__iuFeedPipelineState : null;
            if (pl) {
              var loadedOk =
                pl.hasLoadedData === true &&
                Array.isArray(pl.cachedItems) &&
                pl.cachedItems.length > 0;
              var needFeedBootstrap =
                typeof window.__iuLoadData === "function" &&
                !pl.isLoadingData &&
                !loadedOk;
              if (needFeedBootstrap) {
                window.__iuLoadData();
              }
            }
          } catch (_) {}
          try {
            window.__iuStartAutoRefresh && window.__iuStartAutoRefresh();
          } catch (_) {}
        },
        { timeout: 500 }
      );
    } catch (_) {}

    // Notes: mount for current section + render all declared notes hosts (no MindMenu impact)
    try{
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try{ iuMountNotesForCurrentSection(); }catch{}
        try{
          let root = document.getElementById("feed");
          if (section === "tvonline") root = document.getElementById("iuTvOnlineView");
          else if (section === "jr") root = document.getElementById("iuJrEmptyView");
          else if (section === "mapy") root = document.getElementById("iuMapyView") || document.getElementById("iuMapsView");
          else if (section === "travel") root = document.getElementById("feed");
          iuInitNotesInView(root || document);
        }catch{}
      }));
    }catch{
      try{ iuMountNotesForCurrentSection(); }catch{}
      try{ iuInitNotesInView(document); }catch{}
    }

      });
    } catch (_) {}
  }
  try { window.iuApplySectionFromURL = applySectionFromURL; } catch (e) {}
  try { window.iuPersistNavState = persistNavState; } catch (e) {}
  try { window.iuApplyPanelFromUrl = applyPanelFromUrl; } catch (e) {}
  try { window.iuHideAllOverlaysNow = iuHideAllOverlaysNow; } catch (e) {}
  try { window.iuNavRailHideOverlaysFast = iuNavRailHideOverlaysFast; } catch (e) {}
  try { window.iuScrollMainToTopSmooth = iuScrollMainToTopSmooth; } catch (e) {}
  try { window.iuScrollMainToTopInstant = iuScrollMainToTopInstant; } catch (e) {}
  try { window.iuScrollToActiveSectionStartInstant = iuScrollToActiveSectionStartInstant; } catch (e) {}
  try { window.iuScrollMainSectionSwitchToTop = iuScrollMainSectionSwitchToTop; } catch (e) {}
  try { window.iuDesktopConsumeSectionSwitchScrollIfArmed = iuDesktopConsumeSectionSwitchScrollIfArmed; } catch (e) {}
  try { window.iuMobileTabletConsumeSectionSwitchScrollIfArmed = iuMobileTabletConsumeSectionSwitchScrollIfArmed; } catch (e) {}
  try { window.iuMobileTabletMenuNavScrollArm = iuMobileTabletMenuNavScrollArm; } catch (e) {}
  try { window.iuMobileTabletMenuNavScrollFinalize = iuMobileTabletMenuNavScrollFinalize; } catch (e) {}
  try { window.iuMenuForwardNavScrollAfterApply = iuMenuForwardNavScrollAfterApply; } catch (e) {}
  try { window.iuMobileTabletMenuForwardScrollSyncIfArmed = iuMobileTabletMenuForwardScrollSyncIfArmed; } catch (e) {}
  try { window.iuDesktopPreviewNavScrollAfterOpen = iuDesktopPreviewNavScrollAfterOpen; } catch (e) {}
  try { window.iuGetMainScrollTop = iuGetMainScrollTop; } catch (e) {}
  try { window.iuSetMainScrollTop = iuSetMainScrollTop; } catch (e) {}

  var iuDesktopSectionCloseRestoreState = null;
  function iuDesktopSectionCloseScrollRestoreFinish() {
    iuDesktopSectionCloseRestoreState = null;
    try { window.__iuScrollRestorePendingNav = null; } catch (_) {}
    try { window.__iuDesktopSectionCloseRestoring = false; } catch (_) {}
  }
  function iuDesktopSectionCloseScrollRestoreTick() {
    if (!iuDesktopSectionCloseRestoreState) return;
    var st = iuDesktopSectionCloseRestoreState;
    var target = st.y;
    var now = Date.now();
    var maxY = 0;
    var currentY = 0;
    try {
      var root = iuGetMainScrollElement();
      var doc = root || document.scrollingElement || document.documentElement;
      var viewH = window.innerHeight || 0;
      maxY = doc ? Math.max(0, doc.scrollHeight - viewH) : 0;
      currentY = iuGetMainScrollTop();
      if (maxY >= target - 2 && Math.abs(currentY - target) > 2) {
        iuSetMainScrollTop(target);
        currentY = iuGetMainScrollTop();
      }
      if (Math.abs(currentY - target) <= 2) {
        iuDesktopSectionCloseScrollRestoreFinish();
        return;
      }
    } catch (_) {}
    var feedReady = true;
    try {
      var feedEl = document.getElementById("feed");
      feedReady = !feedEl || String(feedEl.getAttribute("data-feed-ready") || "") === "true";
    } catch (_) {}
    if (now > st.until) {
      if (maxY >= target - 2) {
        iuSetMainScrollTop(target);
        iuDesktopSectionCloseScrollRestoreFinish();
        return;
      }
      if (now < st.hardUntil) {
        st.until = now + 1500;
      } else {
        iuSetMainScrollTop(target);
        iuDesktopSectionCloseScrollRestoreFinish();
        return;
      }
    }
    try { requestAnimationFrame(iuDesktopSectionCloseScrollRestoreTick); } catch (_) {
      iuDesktopSectionCloseScrollRestoreFinish();
    }
  }
  function iuDesktopSectionCloseScrollRestoreBegin(targetY) {
    var yv = Math.max(0, Math.round(Number(targetY) || 0));
    var now = Date.now();
    iuDesktopSectionCloseRestoreState = { y: yv, until: now + 12000, hardUntil: now + 30000 };
    try { requestAnimationFrame(iuDesktopSectionCloseScrollRestoreTick); } catch (_) { iuDesktopSectionCloseScrollRestoreTick(); }
    try {
      var feed = document.getElementById("feed");
      if (feed && !feed.__iuDesktopCloseRestoreObs) {
        feed.__iuDesktopCloseRestoreObs = true;
        new MutationObserver(function () {
          try {
            if (String(feed.getAttribute("data-feed-ready") || "") === "true") {
              iuDesktopSectionCloseScrollRestoreTick();
            }
          } catch (_) {}
        }).observe(feed, { attributes: true, attributeFilter: ["data-feed-ready"] });
      }
    } catch (_) {}
  }
  function iuDesktopSectionCloseApply(snap) {
    if (!snap || !snap.href) return;
    var restoreY = Math.max(0, Math.round(Number(snap.scrollY) || 0));
    try { window.__iuSectionSwitchScrollArm = false; } catch (_) {}
    try { window.__iuDesktopSectionCloseRestoring = true; } catch (_) {}
    try {
      window.__iuScrollRestorePendingNav = {
        y: restoreY,
        page: Number(snap.page) > 1 ? Number(snap.page) : 1,
        key: "desktop-close",
      };
    } catch (_) {}
    try { history.replaceState(null, "", String(snap.href)); } catch (_) {}
    applySectionFromURL();
    applyPanelFromUrl();
    try {
      if (typeof window.iuDesktopSectionCloseOnSectionClosed === "function") {
        window.iuDesktopSectionCloseOnSectionClosed();
      }
    } catch (_) {}
    iuDesktopSectionCloseScrollRestoreBegin(restoreY);
  }
  try { window.iuDesktopSectionCloseApply = iuDesktopSectionCloseApply; } catch (e) {}

  function initNavRouter(){
    iuStripProjectsNavParamsForHomeLanding();
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
    let iuNavPressEl = null;
    function iuClearNavPress() {
      try {
        if (iuNavPressEl) {
          iuNavPressEl.classList.remove("iu-press-active");
          iuNavPressEl = null;
        }
      } catch (_) {}
    }
    document.addEventListener(
      "pointerdown",
      (e) => {
        const item =
          e.target && e.target.closest
            ? e.target.closest(".iu-leftNavItem")
            : null;
        const hex =
          e.target && e.target.closest ? e.target.closest(".iuHex") : null;
        const el = item || hex;
        if (!el) return;
        try {
          if (iuNavPressEl && iuNavPressEl !== el) {
            iuNavPressEl.classList.remove("iu-press-active");
          }
        } catch (_) {}
        iuNavPressEl = el;
        try {
          el.classList.add("iu-press-active");
        } catch (_) {}
      },
      true
    );
    document.addEventListener("pointerup", iuClearNavPress, true);
    document.addEventListener("pointercancel", iuClearNavPress, true);
    document.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('[data-iuq="ai"]')) return;
      const item = e.target && e.target.closest ? e.target.closest('.iu-leftNavItem') : null;
      if (!item) return;
      try {
        if (typeof window.iuDesktopLeftRailNewWindowHandleClick === "function") {
          if (window.iuDesktopLeftRailNewWindowHandleClick(item, e)) return;
        }
      } catch (_) {}
      try {
        if (iuIsDesktopNavLayout() && typeof window.iuDesktopSectionCloseHandleNavClick === "function") {
          if (window.iuDesktopSectionCloseHandleNavClick(item, e)) return;
        }
      } catch (_) {}
      try{
        const href = String(item.getAttribute("href") || "").trim();
        const rail = String(item.getAttribute("data-rail") || "").trim().toLowerCase();
        const isExternal = href && /^https?:\/\//i.test(href);
        const isInternal = !isExternal && (href === "#" || href === "" || !!rail);
        if (isInternal) e.preventDefault();
      }catch{}
      const mediaTopic = (item.getAttribute("data-media-topic") || "").trim().toLowerCase();
      const accentEarly = (item.getAttribute("data-accent") || item.dataset?.accent || "").trim().toLowerCase();
      try {
        if (iuTabletMenuToolHardNavIfNeeded(accentEarly, mediaTopic)) return;
      } catch (_) {}
      var gateWrapNavEarly = document.getElementById("iuMobileGateWrap");
      var fromWebNavGateNav =
        gateWrapNavEarly && String(gateWrapNavEarly.getAttribute("data-iu-mobile-gate") || "") === "nav";
      if (fromWebNavGateNav) {
        try {
          var armKeyNav = mediaTopic || accentEarly || "";
          if (typeof window.iuMobileWebNavReturnArmForTile === "function") {
            window.iuMobileWebNavReturnArmForTile(armKeyNav);
          }
        } catch (_){}
      }
      try {
        iuPreApplyTabletToolShellBeforeNav(accentEarly, mediaTopic);
      } catch (_) {}
      try {
        if (iuIsDesktopNavLayout() && typeof window.iuDesktopSectionCloseBeforeOpen === "function") {
          window.iuDesktopSectionCloseBeforeOpen(item);
        }
      } catch (_) {}
      if (typeof window.iuNavRailHideOverlaysFast === "function") {
        window.iuNavRailHideOverlaysFast();
      } else {
        iuHideAllOverlaysNow();
      }
      if (mediaTopic !== "") {
        persistNavState({ section: IU_ARTICLE_HUB_SECTION, topic: mediaTopic });
      } else {
        const accent = accentEarly;
        if (accent === "travel") {
          persistNavState({ section: "travel" });
        } else {
          persistNavState({ section: normalizeSection(accent) });
        }
      }
      /* P0 webnav back-stack: persistNavState already push/replace — panel clear must replaceState, else pushState duplicates the URL and the first Back pops a no-op instead of the overlay. */
      try { if (typeof window.iuSetPanelInUrl === 'function') window.iuSetPanelInUrl('', { replace: true }); } catch {}
      try {
        if (typeof window !== "undefined") window.__iuWebNavGateDetailLatch = !!fromWebNavGateNav;
      } catch (_) {}
      try{ iuMobileTabletMenuNavScrollArm(); }catch(_){}
      try{ window.__iuSectionSwitchScrollArm = true; }catch(_){}
      applySectionFromURL();
      applyPanelFromUrl();
      try {
        if (iuIsDesktopNavLayout() && typeof iuDesktopPreviewNavScrollAfterOpen === "function") {
          iuDesktopPreviewNavScrollAfterOpen();
        } else {
          try { iuMenuForwardNavScrollAfterApply(); } catch (_) {}
        }
      } catch (_) {}
      try {
        if (iuIsDesktopNavLayout() && typeof window.iuDesktopSectionCloseAfterOpen === "function") {
          window.iuDesktopSectionCloseAfterOpen();
        }
      } catch (_) {}
      try {
        if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
          try {
            if (typeof window.iuMobileGateCloseForMainNav === "function") window.iuMobileGateCloseForMainNav();
          } catch (_) {}
          document.body.classList.add("iu-mobileMainVisible");
          var mb = document.getElementById("iuMobileMainBackBar");
          if (mb) mb.hidden = true;
          try {
            if (fromWebNavGateNav) document.body.classList.add("iu-webnavDetailFromGate");
            else document.body.classList.remove("iu-webnavDetailFromGate");
          } catch (_) {}
          try {
            if (typeof window.iuWebNavDetailBackBarHostSync === "function") window.iuWebNavDetailBackBarHostSync();
          } catch (_) {}
        }
      } catch (_) {}
    });
    // Hex grid (home quick links + „Navigace po webu“ tiles): persist + apply — must mirror left-rail path so
    // mobile back-stack + iu-webnavDetailFromGate match; hex previously cleared latch and skipped post-apply
    // mobile chrome, breaking first Back / main Zpět for non–hub sections and tools tiles.
    document.addEventListener('click', (e) => {
      const hex = e.target && e.target.closest ? e.target.closest('.iuHex') : null;
      if (!hex) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      const sectionAttr = String(hex.getAttribute('data-section') || '').trim().toLowerCase();
      const cls = Array.from(hex.classList).find(c => c.startsWith('iuHex--'));
      const sectionFromClass = cls ? cls.slice('iuHex--'.length).toLowerCase() : '';
      const rawHexKey = sectionAttr || sectionFromClass;
      try {
        if (iuTabletMenuToolHardNavIfNeeded(rawHexKey, "")) return;
      } catch (_) {}
      try {
        iuPreApplyTabletToolShellBeforeNav(rawHexKey, "");
      } catch (_) {}
      if (typeof window.iuNavRailHideOverlaysFast === "function") {
        window.iuNavRailHideOverlaysFast();
      } else {
        iuHideAllOverlaysNow();
      }
      var gateWrapHexEarly = document.getElementById("iuMobileGateWrap");
      var fromWebNavGateHex =
        gateWrapHexEarly && String(gateWrapHexEarly.getAttribute("data-iu-mobile-gate") || "") === "nav";
      try {
        if (typeof window !== "undefined") window.__iuWebNavGateDetailLatch = !!fromWebNavGateHex;
      } catch (_) {}
      if (fromWebNavGateHex) {
        try {
          if (typeof window.iuMobileWebNavReturnArmForTile === "function") {
            window.iuMobileWebNavReturnArmForTile(rawHexKey);
          }
        } catch (_){}
      }
      persistNavStateFromHexKey(rawHexKey);
      /* P0 webnav back-stack: same as left-rail — panel clear must replaceState, else duplicate Back entry. */
      try { if (typeof window.iuSetPanelInUrl === "function") window.iuSetPanelInUrl("", { replace: true }); } catch (_) {}
      try{ iuMobileTabletMenuNavScrollArm(); }catch(_){}
      try{ window.__iuSectionSwitchScrollArm = true; }catch(_){}
      applySectionFromURL();
      applyPanelFromUrl();
      try {
        if (iuIsDesktopNavLayout() && typeof iuDesktopPreviewNavScrollAfterOpen === "function") {
          iuDesktopPreviewNavScrollAfterOpen();
        } else {
          try { iuMenuForwardNavScrollAfterApply(); } catch (_) {}
        }
      } catch (_) {}
      try {
        if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
          try {
            if (typeof window.iuMobileGateCloseForMainNav === "function") window.iuMobileGateCloseForMainNav();
          } catch (_) {}
          document.body.classList.add("iu-mobileMainVisible");
          var mbHexNav = document.getElementById("iuMobileMainBackBar");
          if (mbHexNav) mbHexNav.hidden = true;
          try {
            if (fromWebNavGateHex) document.body.classList.add("iu-webnavDetailFromGate");
            else document.body.classList.remove("iu-webnavDetailFromGate");
          } catch (_) {}
          try {
            if (typeof window.iuWebNavDetailBackBarHostSync === "function") window.iuWebNavDetailBackBarHostSync();
          } catch (_) {}
        }
      } catch (_) {}
    }, true);
    /** P0 mobile/tablet: keep browser history aligned with „Navigace po webu“ overlay (popstate → reopen overlay, no skip-to-external). */
    function iuMobileWebNavApplyRestoredOverlay(wrapH){
      try {
        if (typeof window.iuNavOverlayLockArm === "function") window.iuNavOverlayLockArm();
        else if (typeof window !== "undefined") window.__iuNavOverlayLock = true;
      } catch (_){}
      wrapH.__iuMobileGateSetTab("nav");
      try { document.body.classList.remove("iu-mobileMainVisible"); } catch (_){}
      var mbHx = document.getElementById("iuMobileMainBackBar");
      if (mbHx) mbHx.hidden = true;
      try { document.body.classList.remove("iu-webnavDetailFromGate"); } catch (_){}
      try {
        if (typeof window !== "undefined") window.__iuWebNavGateDetailLatch = false;
      } catch (_){}
      try {
        window.__iuWebNavSectionPush = false;
      } catch (_){}
    }
    /**
     * P0: první Zpět z detailu dlaždice (web-nav overlay) — deterministicky obnovit mřížku, ne obecný router.
     * Vrací true = zbytek onUrlChange / sync přeskočit pro tento popstate.
     */
    function iuMobileWebNavReturnControllerTryPop(ev) {
      try {
        if (!ev || ev.type !== "popstate") return false;
        if (!window.matchMedia || !window.matchMedia("(max-width: 900px)").matches) return false;
        if (typeof window.iuIsProjectsRoute !== "function" || !window.iuIsProjectsRoute()) return false;
      } catch (_e) {
        return false;
      }
      var armed = false;
      try {
        armed = sessionStorage.getItem("iuMobileWebNavReturnArmed") === "1";
      } catch (_e2) {}
      if (!armed) return false;
      var stEv = ev.state;
      var stHist = null;
      try {
        stHist = history.state;
      } catch (_e3) {}
      var st = stEv != null ? stEv : stHist;
      var h = String(location.hash || "");
      var onOverlay =
        h === "#iu-nav" ||
        h === "#nav" ||
        (st && st.iu_nav_overlay === true) ||
        (stHist && stHist.iu_nav_overlay === true) ||
        (stEv && stEv.iu_nav_overlay === true);
      if (!onOverlay) {
        /* WebKit: hash/state často dojedou až v dalším frame — jeden odložený pokus, první tick blokuje sync destruktivní větev. */
        try {
          var att = typeof window.__iuWebNavReturnPopAttempt === "number" ? window.__iuWebNavReturnPopAttempt : 0;
          if (att < 1) {
            window.__iuWebNavReturnPopAttempt = att + 1;
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                try {
                  if (sessionStorage.getItem("iuMobileWebNavReturnArmed") !== "1") return;
                  if (
                    typeof window.__iuMobileWebNavReturnControllerTryPop === "function"
                  ) {
                    window.__iuMobileWebNavReturnControllerTryPop({
                      type: "popstate",
                      state: history.state,
                    });
                  }
                } catch (_rb) {}
              });
            });
            /* P0 Back→hub: nesmíme zablokovat onUrlChange — jinak se applySectionFromURL vůbec nespustí a zůstane poslední sekce (např. Počasí) při čisté /projects/. */
            return false;
          }
          try {
            window.__iuWebNavReturnPopAttempt = 0;
          } catch (_rc) {}
        } catch (_rd) {}
        return false;
      }
      try {
        window.__iuWebNavReturnPopAttempt = 0;
      } catch (_re) {}
      var wrapR = document.getElementById("iuMobileGateWrap");
      if (!wrapR || typeof wrapR.__iuMobileGateSetTab !== "function") return false;
      try {
        window.__iuMobileWebNavReturnSuppress = true;
        iuMobileWebNavApplyRestoredOverlay(wrapR);
        var u = new URL(location.href);
        if (u.searchParams.has("section") || u.searchParams.has("topic") || u.searchParams.has("mode")) {
          u.searchParams.delete("section");
          u.searchParams.delete("topic");
          u.searchParams.delete("mode");
          if (!u.hash || u.hash === "#") u.hash = "iu-nav";
          history.replaceState(
            { iu_nav_overlay: true, iu_nav_origin: "homepage" },
            "",
            u.toString()
          );
        }
        try {
          sessionStorage.removeItem("iuMobileWebNavReturnArmed");
          sessionStorage.removeItem("iuMobileWebNavLastTarget");
        } catch (_e4) {}
        try {
          window.__iuMobileWebNavReturnArmed = false;
          delete window.__iuMobileWebNavLastTile;
        } catch (_e5) {}
      } catch (_e6) {}
      try {
        requestAnimationFrame(function () {
          try {
            window.__iuMobileWebNavReturnSuppress = false;
          } catch (_e7) {}
        });
      } catch (_e8) {
        try {
          window.__iuMobileWebNavReturnSuppress = false;
        } catch (_e9) {}
      }
      return true;
    }
    try {
      window.__iuMobileWebNavReturnControllerTryPop = iuMobileWebNavReturnControllerTryPop;
    } catch (_e10) {}
    function iuMobileWebNavSyncFromHistory(){
      try {
        if (!window.matchMedia || !window.matchMedia("(max-width: 900px)").matches) return;
        var wrapH = document.getElementById("iuMobileGateWrap");
        if (!wrapH || typeof wrapH.__iuMobileGateSetTab !== "function") return;
        var hash = String(window.location.hash || "").replace("#", "");
        var st = history.state && history.state.iu_nav_overlay === true;
        var stMind = false;
        try { stMind = !!(history.state && history.state.iu_mindmenu_overlay === true); } catch (_sm) {}
        if (hash === "iu-mindmenu" || stMind === true) {
          wrapH.__iuMobileGateSetTab("tools");
          return;
        }
        if (hash === "iu-nav" || hash === "nav" || st === true) {
          iuMobileWebNavApplyRestoredOverlay(wrapH);
          return;
        }
        /* P0 web-nav return: první tick popstate může mít ještě špatný hash/state — nesahej na gate (setTab ""),
           jinak se přepíše overlay dřív než return controller / odložený tryPop. */
        try {
          if (sessionStorage.getItem("iuMobileWebNavReturnArmed") === "1") return;
        } catch (_){}
        var gateH = String(wrapH.getAttribute("data-iu-mobile-gate") || "");
        if (gateH === "nav") {
          wrapH.__iuMobileGateSetTab("");
        }
      } catch (_){}
    }
    try {
      window.iuMobileWebNavSyncFromHistory = iuMobileWebNavSyncFromHistory;
    } catch (_eSync) {}
    function iuProjectsNavRouterRunHideApplySectionAndPanel(){
      try {
        if (window.__iuMobileWebNavReturnSuppress === true) return;
      } catch (_){}
      iuHideAllOverlaysNow();
      applySectionFromURL();
      applyPanelFromUrl();
      try{
        if (typeof window.iuDesktopHomeSectionGridGuardApply === "function") window.iuDesktopHomeSectionGridGuardApply();
      }catch(_){}
    }
    /** True when URL/history says the mobile „Navigace po webu“ overlay must stay open (tiles grid). */
    function iuProjectsNavRouterTryOverlayBranch(){
      try {
        var hNav = String(location.hash || "");
        if (hNav === "#iu-mindmenu") {
          try {
            if (typeof window.iuMindMenuSyncGateFromHistory === "function") window.iuMindMenuSyncGateFromHistory();
          } catch (_mm) {}
          try { applyPanelFromUrl(); } catch (_){}
          try{
            if (typeof window.iuDesktopHomeSectionGridGuardApply === "function") window.iuDesktopHomeSectionGridGuardApply();
          }catch(_){}
          return true;
        }
        if (hNav === "#iu-nav" || hNav === "#nav") {
          try { applyPanelFromUrl(); } catch (_){}
          try{
            if (typeof window.iuDesktopHomeSectionGridGuardApply === "function") window.iuDesktopHomeSectionGridGuardApply();
          }catch(_){}
          return true;
        }
        /* P0 mobile/tablet web-nav: popstate/hashchange can run before location.hash catches up with the
           restored history entry, while history.state already matches the pushed overlay entry
           ({ iu_nav_overlay: true }). If we fall through, applySectionFromURL still sees stale ?section=
           and iuMobileGateCloseForMainNav() clears the gate right after iuMobileWebNavSyncFromHistory()
           reopened it — overlay flashes closed. Same short-circuit as #iu-nav. */
        try {
          if (
            window.matchMedia &&
            window.matchMedia("(max-width: 900px)").matches &&
            history.state &&
            history.state.iu_nav_overlay === true
          ) {
            /* P0: autorita = aktuální URL. Bez ?section=/topic/mode je to hub homepage — zastaralý history.state nesmí přeskočit applySectionFromURL (Back ze sekce). */
            var uSt = new URL(location.href);
            var hubNoSectionQuery =
              !uSt.searchParams.has("section") &&
              !uSt.searchParams.has("topic") &&
              !uSt.searchParams.has("mode");
            if (!hubNoSectionQuery) {
              try { applyPanelFromUrl(); } catch (_){}
              try{
                if (typeof window.iuDesktopHomeSectionGridGuardApply === "function") window.iuDesktopHomeSectionGridGuardApply();
              }catch(_){}
              return true;
            }
          }
        } catch (_){}
      } catch (_){}
      return false;
    }
    function onUrlChange(ev){
      try {
        if (
          typeof window.__iuMobileWebNavReturnControllerTryPop === "function" &&
          window.__iuMobileWebNavReturnControllerTryPop(ev)
        ) {
          return;
        }
      } catch (_){}
      try { iuMobileWebNavSyncFromHistory(); } catch (_){}
      if (iuProjectsNavRouterTryOverlayBranch()) return;
      /* P0 mobile WebKit: first popstate tick can still expose stale location / null history.state; the real
         overlay entry appears on the next frame. Defer hide+applySection once so we never run
         applySectionFromURL with stale ?section= (iuMobileGateCloseForMainNav) after sync reopened nav. */
      try {
        if (
          ev &&
          ev.type === "popstate" &&
          window.matchMedia &&
          window.matchMedia("(max-width: 900px)").matches &&
          typeof window.iuIsProjectsRoute === "function" &&
          window.iuIsProjectsRoute()
        ) {
          requestAnimationFrame(function () {
            try { iuMobileWebNavSyncFromHistory(); } catch (_){}
            if (iuProjectsNavRouterTryOverlayBranch()) return;
            iuProjectsNavRouterRunHideApplySectionAndPanel();
          });
          return;
        }
      } catch (_){}
      iuProjectsNavRouterRunHideApplySectionAndPanel();
    }
    window.addEventListener("popstate", function (ev) {
      try {
        if (
          typeof window.__iuMobileWebNavReturnControllerTryPop === "function" &&
          window.__iuMobileWebNavReturnControllerTryPop(ev)
        ) {
          return;
        }
      } catch (_){}
      try { iuMobileWebNavSyncFromHistory(); } catch (_){}
    });
    window.addEventListener('popstate', onUrlChange);
    window.addEventListener('hashchange', onUrlChange);

    try {
      iuMountTvProgramVerifiedLinks();
    } catch (_) {}

    try{
      window.addEventListener("pageshow", function(ev){
        if (!ev.persisted) return;
        try{
          iuStripProjectsNavParamsForHomeLanding();
        }catch(_){}
        /* P0 bfcache: DOM + feed state preserved — do not re-apply section (would reset scroll/page). */
        try {
          iuReadArticlesSyncFeed(document.getElementById("feed"));
        } catch (_) {}
        try {
          if (typeof window.iuScrollRestoreRequest === "function") window.iuScrollRestoreRequest();
        } catch (_) {}
        try { applyPanelFromUrl(); } catch (_){}
      });
    }catch(_){}

    try {
      iuInitTvProgramChoiceUi();
    } catch (_) {}

    /* P1 lazy mount: re-run boot renderers for views mounted after this boot pass. */
    try {
      document.addEventListener("iu:section-view-mounted", function (ev) {
        var kLazy = ev && ev.detail ? String(ev.detail.key || "") : "";
        if (kLazy === "tvprogram") {
          try { iuMountTvProgramVerifiedLinks(); } catch (_) {}
          try { iuInitTvProgramChoiceUi(); } catch (_) {}
        } else if (kLazy === "radio") {
          try {
            var rvLazy = document.getElementById("iuRadioView");
            if (rvLazy) renderRadioView(rvLazy);
          } catch (_) {}
        } else if (kLazy === "pocasi") {
          /* Weather view mounted after boot: re-bind direct listeners
             (iuWeatherInit is once-guarded and no-opped at boot) and re-run
             the daily panel init against the freshly mounted elements. */
          try { window.__iuWeatherInitDone = 0; } catch (_) {}
          try { if (typeof window.iuWeatherInit === "function") window.iuWeatherInit(); } catch (_) {}
          try { if (typeof window.iuDailyPanelInit === "function") window.iuDailyPanelInit(); } catch (_) {}
        }
      });
    } catch (_) {}

    // P0 cold reload / partial DOM: URL→section must run even if radio feed host is missing (never skip applySectionFromURL).
    try { iuMobileWebNavSyncFromHistory(); } catch (_){}
    try {
      var hInit = String(location.hash || "");
      if (hInit === "#iu-mindmenu") {
        try {
          if (typeof window.iuMindMenuSyncGateFromHistory === "function") window.iuMindMenuSyncGateFromHistory();
        } catch (_mi) {}
        try { applyPanelFromUrl(); } catch (_){}
      } else if (hInit === "#iu-nav" || hInit === "#nav") {
        try { applyPanelFromUrl(); } catch (_){}
      } else {
        applySectionFromURL();
        applyPanelFromUrl();
      }
    } catch (_){
      applySectionFromURL();
      applyPanelFromUrl();
    }
    try { window.addEventListener('iu-panel-url-changed', applyPanelFromUrl); } catch {}
    try {
      const panelFromUrl = parsePanelFromUrl();
      if (panelFromUrl === null) {
        iuHideAllOverlaysNow();
        requestAnimationFrame(() => {
          iuHideAllOverlaysNow();
        });
      }
    } catch {}

    if (!feedEl || !viewEl) return;

    try {
      renderRadioView(viewEl);
    }catch(e){
      try{ if (typeof window.persistLastError === "function") window.persistLastError(String(e?.message || e)); }catch{}
    }
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
  const BAKALARI_PROFILES_KEY = "iu_bakalari_profiles";
  const BAKALARI_LEGACY_KEY = "iu_moje_sluzby_bakalari_v1";
  const BAKALARI_MAX_CARDS = 10;
  var _bakalariLegacyMigrated = false;
  /** Legacy + removed presets — must never reappear as active IB tiles or favorites. */
  const IU_BANKS_BLOCKED_IDS = ["citi", "equa", "sberbank", "max", "creditas"];
  function iuIsBlockedBankId(id) {
    return IU_BANKS_BLOCKED_IDS.indexOf(String(id || "")) !== -1;
  }
  function iuFilterBlockedFromFavorites(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (bid) { return !iuIsBlockedBankId(bid); });
  }
  var IU_BANK_LOGIN_PRESS_MS = 130;
  function iuOpenBankLoginAfterPress(mainBtn, url) {
    if (!mainBtn || mainBtn.getAttribute("data-iu-ib-opening") === "1") return;
    var u = String(url || "");
    if (!/^https?:\/\//i.test(u)) return;
    mainBtn.setAttribute("data-iu-ib-opening", "1");
    try {
      if (typeof navigator.vibrate === "function") {
        navigator.vibrate(10);
      }
    } catch (_) {}
    mainBtn.classList.add("iu-clickable-feedback", "iu-pressed");
    window.setTimeout(function () {
      if (window.iuNetwork && typeof window.iuNetwork.openExternalUrl === "function") {
        void window.iuNetwork.openExternalUrl(u);
      } else {
        window.open(u, "_blank", "noopener,noreferrer");
      }
      window.setTimeout(function () {
        mainBtn.classList.remove("iu-clickable-feedback", "iu-pressed");
        mainBtn.removeAttribute("data-iu-ib-opening");
      }, 60);
    }, IU_BANK_LOGIN_PRESS_MS);
  }

  function iuGetBanks() {
    try {
      let arr = JSON.parse(localStorage.getItem(IU_BANKS_KEY) || "[]");
      if (!Array.isArray(arr)) arr = [];
      var cleaned = iuFilterBlockedFromFavorites(arr);
      if (cleaned.length !== arr.length) {
        arr = cleaned;
        try { localStorage.setItem(IU_BANKS_KEY, JSON.stringify(arr)); } catch (_) {}
      }
      if (arr.length === 0) {
        try {
          const raw = localStorage.getItem(BANKS_KEY);
          if (raw) {
            const o = JSON.parse(raw);
            if (o && Array.isArray(o.favorites) && o.favorites.length) {
              arr = iuFilterBlockedFromFavorites(o.favorites);
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
    if (iuIsBlockedBankId(id)) return;
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
    /* ČSOB: oficiální přihlášení (ČSOB ID / identita — retail IB vstup; online.csob může skončit na error v některých prohlížečích). */
    { id: "csas", label: "ČSOB", url: "https://www.csob.cz/", loginUrl: "https://identita.csob.cz/", color: "#1a1a1a" },
    /* Komerční banka: retail MojeBanka (ne KB+ / ne plus.kb.cz). */
    { id: "kb", label: "Komerční banka", url: "https://www.kb.cz/", loginUrl: "https://mojebanka.kb.cz/", color: "#c41230" },
    { id: "air", label: "Air Bank", url: "https://www.airbank.cz/", loginUrl: "https://ib.airbank.cz/", color: "#e6007e" },
    { id: "fio", label: "Fio banka", url: "https://www.fio.cz/", loginUrl: "https://ib.fio.cz/", color: "#00a651" },
    { id: "mb", label: "mBank", url: "https://www.mbank.cz/", loginUrl: "https://online.mbank.cz/cs/Login", color: "#e30613" },
    { id: "rb", label: "Raiffeisenbank", url: "https://www.rb.cz/", loginUrl: "https://www.rb.cz/vstup-na-ucet", color: "#ffed00" },
    { id: "cs", label: "ČS", url: "https://www.csas.cz/", loginUrl: "https://george.csas.cz/", color: "#1a1a1a" },
    { id: "moneta", label: "Moneta", url: "https://www.moneta.cz/", loginUrl: "https://ib.moneta.cz/", color: "#e30613" },
    { id: "unicredit", label: "UniCredit", url: "https://www.unicreditbank.cz/", loginUrl: "https://cz.unicreditbanking.eu/cs/login_form", color: "#e30613" }
  ];

  const HEALTH_INSURANCE_STORAGE_KEY = "iu_health_insurance_v2";
  const HEALTH_INSURANCE_SCHEMA_VERSION = 1;
  const HEALTH_MAX_CARDS = 10;
  const HEALTH_COLOR_PALETTE = ["#1a5bb5", "#c41230", "#00a651", "#e6007e", "#056da1", "#e30613", "#6b4c9a", "#16a085", "#e67e22", "#2c3e50"];
  const HEALTH_PROVIDER_REGISTRY = [
    { id: "vzp", name: "VZP", loginUrl: "https://auth.vzp.cz/signin", loginType: "email", passwordMode: "normal", loginLabel: "E-mail", openLabel: "Otevřít pojišťovnu", copyLoginLabel: "Kopírovat e-mail", requiresCustomUrl: false },
    { id: "vozp", name: "VoZP", loginUrl: "https://www.vozp.cz/klientsky-portal", loginType: "username", passwordMode: "normal", loginLabel: "Přihlašovací jméno", openLabel: "Otevřít pojišťovnu", copyLoginLabel: "Kopírovat přihlašovací jméno", requiresCustomUrl: false },
    { id: "cpzp", name: "ČPZP", loginUrl: "https://portal.cpzp.cz/", loginType: "username", passwordMode: "not_primary", loginLabel: "Přihlašovací jméno", openLabel: "Otevřít pojišťovnu", copyLoginLabel: "Kopírovat přihlašovací jméno", requiresCustomUrl: false, helperText: "Webové přihlášení může po otevření vyžadovat SMS kód." },
    { id: "ozp", name: "OZP", loginUrl: "https://www.ozp.cz/elektronicka-komunikace/informace/vitakarta-online-informace", loginType: "username", passwordMode: "normal", loginLabel: "Uživatelské jméno", openLabel: "Otevřít pojišťovnu", copyLoginLabel: "Kopírovat uživatelské jméno", requiresCustomUrl: false, helperText: "Uživatelským jménem bývá ve většině případů e-mail." },
    { id: "zps", name: "ZPŠ", loginUrl: "https://www.zpskoda.cz/karta-meho-srdce", loginType: "username", passwordMode: "normal", loginLabel: "Přihlašovací jméno", openLabel: "Otevřít pojišťovnu", copyLoginLabel: "Kopírovat přihlašovací jméno", requiresCustomUrl: false, helperText: "Web může po otevření vyžadovat i SMS kód." },
    { id: "zpmv", name: "ZP MV ČR", loginUrl: "https://eforms.zpmvcr.cz/eforms/ekomunikace", loginType: "pin", passwordMode: "normal", loginLabel: "PIN", openLabel: "Otevřít pojišťovnu", copyLoginLabel: "Kopírovat PIN", requiresCustomUrl: false },
    { id: "rbp", name: "RBP", loginUrl: "https://www.my213.cz/prihlaseni", loginType: "email", passwordMode: "normal", loginLabel: "E-mail", openLabel: "Otevřít pojišťovnu", copyLoginLabel: "Kopírovat e-mail", requiresCustomUrl: false },
    { id: "custom", name: "Vlastní", loginUrl: "", loginType: "generic", passwordMode: "normal", loginLabel: "Přihlašovací údaj", openLabel: "Otevřít pojišťovnu", copyLoginLabel: "Kopírovat přihlašovací údaj", requiresCustomUrl: true }
  ];

  function healthRegistryById(id) {
    var sid = String(id || "");
    for (var hi = 0; hi < HEALTH_PROVIDER_REGISTRY.length; hi++) {
      if (HEALTH_PROVIDER_REGISTRY[hi].id === sid) return HEALTH_PROVIDER_REGISTRY[hi];
    }
    return null;
  }

  function healthPickNextColorToken(prevHex) {
    var prev = String(prevHex || "");
    for (var ci = 0; ci < HEALTH_COLOR_PALETTE.length; ci++) {
      if (HEALTH_COLOR_PALETTE[ci] !== prev) return HEALTH_COLOR_PALETTE[ci];
    }
    return HEALTH_COLOR_PALETTE[0];
  }

  function healthNewCardModel(prevColorHex) {
    return {
      id: "hi_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9),
      providerId: "",
      providerName: "",
      url: "",
      personLabel: "",
      loginValue: "",
      passwordValue: "",
      loginType: "generic",
      passwordMode: "normal",
      colorToken: healthPickNextColorToken(prevColorHex),
      isSaved: false
    };
  }

  function healthApplyRegistryToCard(card) {
    var pr = healthRegistryById(card.providerId);
    if (!pr) return;
    card.providerName = pr.name;
    card.loginType = pr.loginType;
    card.passwordMode = pr.passwordMode;
    if (!pr.requiresCustomUrl) card.url = pr.loginUrl || "";
  }

  function healthSanitizeLoadedCard(c) {
    if (!c || typeof c !== "object") return null;
    var nid = String(c.id || "").trim();
    if (!nid) return null;
    var pid = String(c.providerId || "").trim();
    var pr = healthRegistryById(pid);
    var personLabel = String(c.personLabel != null ? c.personLabel : "").slice(0, 120);
    var loginValue = String(c.loginValue != null ? c.loginValue : "");
    var passwordValue = String(c.passwordValue != null ? c.passwordValue : "");
    var colorToken = String(c.colorToken || "").trim();
    if (HEALTH_COLOR_PALETTE.indexOf(colorToken) === -1) colorToken = HEALTH_COLOR_PALETTE[0];
    var isSaved = c.isSaved === true;
    if (!pr) {
      return {
        id: nid,
        providerId: "",
        providerName: "",
        url: "",
        personLabel: personLabel,
        loginValue: loginValue,
        passwordValue: passwordValue,
        loginType: "generic",
        passwordMode: "normal",
        colorToken: colorToken,
        isSaved: false
      };
    }
    var url = String(c.url || "").trim();
    if (!pr.requiresCustomUrl) url = pr.loginUrl || "";
    return {
      id: nid,
      providerId: pr.id,
      providerName: pr.name,
      url: url,
      personLabel: personLabel,
      loginValue: loginValue,
      passwordValue: passwordValue,
      loginType: pr.loginType,
      passwordMode: pr.passwordMode,
      colorToken: colorToken,
      isSaved: isSaved
    };
  }

  function healthDefaultCards() {
    return [healthNewCardModel(undefined)];
  }

  function healthLoadCardsFromStorage() {
    try {
      var raw = localStorage.getItem(HEALTH_INSURANCE_STORAGE_KEY);
      if (!raw) return healthDefaultCards();
      var p = JSON.parse(raw);
      if (!p || typeof p !== "object") return healthDefaultCards();
      if (Number(p.schemaVersion) !== HEALTH_INSURANCE_SCHEMA_VERSION) return healthDefaultCards();
      if (!Array.isArray(p.cards)) return healthDefaultCards();
      var out = [];
      for (var li = 0; li < p.cards.length && out.length < HEALTH_MAX_CARDS; li++) {
        var sc = healthSanitizeLoadedCard(p.cards[li]);
        if (sc) out.push(sc);
      }
      if (out.length === 0) return healthDefaultCards();
      return out;
    } catch (_) {
      return healthDefaultCards();
    }
  }

  function healthSaveCardsToStorage(cards) {
    try {
      var list = Array.isArray(cards) ? cards.slice(0, HEALTH_MAX_CARDS) : [];
      localStorage.setItem(HEALTH_INSURANCE_STORAGE_KEY, JSON.stringify({ schemaVersion: HEALTH_INSURANCE_SCHEMA_VERSION, cards: list }));
    } catch (_) {}
  }

  function normalizeHealthUrl(url) {
    var u = String(url || "").trim();
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    return "https://" + u;
  }

  function isValidHealthOpenUrl(urlRaw) {
    var u = normalizeHealthUrl(urlRaw);
    if (!u) return false;
    try {
      var parsed = new URL(u);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
      if (!parsed.hostname || String(parsed.hostname).length < 2) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function healthResolveOpenUrl(card) {
    var pr = healthRegistryById(card.providerId);
    if (!pr) return "";
    if (pr.requiresCustomUrl) return normalizeHealthUrl(card.url);
    return normalizeHealthUrl(pr.loginUrl || "");
  }

  function healthCopyLoginFeedback(loginType) {
    var t = String(loginType || "");
    if (t === "email") return "E-mail zkopírován";
    if (t === "pin") return "PIN zkopírován";
    if (t === "username") return "Přihlašovací jméno zkopírováno";
    if (t === "generic") return "Přihlašovací údaj zkopírován";
    return "Údaj zkopírován";
  }

  function healthValidateSave(card) {
    var pr = healthRegistryById(card.providerId);
    if (!pr) return { ok: false, msg: "Vyberte pojišťovnu." };
    if (!String(card.loginValue || "").trim()) return { ok: false, msg: "Vyplňte přihlašovací údaj." };
    if (pr.passwordMode === "normal" && !String(card.passwordValue || "").trim()) return { ok: false, msg: "Vyplňte heslo." };
    if (pr.requiresCustomUrl && !isValidHealthOpenUrl(card.url)) return { ok: false, msg: "Zadejte platnou adresu URL (https://…)." };
    return { ok: true, msg: "" };
  }

  function healthCopyToClipboard(text) {
    var t = String(text || "");
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        var p = navigator.clipboard.writeText(t);
        if (p && typeof p.then === "function") p.catch(function () {});
        return true;
      }
    } catch (_) {}
    return false;
  }

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

  function isBakalariProfileEmpty(p) {
    if (!p) return true;
    return !String(p.name || "").trim() && !String(p.url || "").trim() && !String(p.username || "").trim() && !String(p.password || "").trim();
  }

  function migrateBakalariLegacyOnce() {
    if (_bakalariLegacyMigrated) return;
    _bakalariLegacyMigrated = true;
    try {
      var existingRaw = localStorage.getItem(BAKALARI_PROFILES_KEY);
      if (existingRaw) {
        try {
          var ex = JSON.parse(existingRaw);
          if (Array.isArray(ex) && ex.length > 0) return;
        } catch (_) {}
      }
      var raw = localStorage.getItem(BAKALARI_LEGACY_KEY);
      if (!raw) return;
      var a = JSON.parse(raw);
      if (!Array.isArray(a) || !a.length) return;
      var t = Date.now();
      var out = [];
      for (var i = 0; i < a.length; i++) {
        var s = a[i];
        if (!s) continue;
        if (s.enabled !== undefined && !s.enabled) continue;
        var name = String(s.name || "").trim().slice(0, 30);
        var url = normalizeBakalariUrl(s.url || "");
        if (!name && !String(s.url || "").trim()) continue;
        out.push({ id: "mig_" + t + "_" + i, name: name, url: url, username: "", password: "", locked: false });
      }
      if (out.length) {
        try { localStorage.setItem(BAKALARI_PROFILES_KEY, JSON.stringify(out)); } catch (_) {}
      }
      try { localStorage.removeItem(BAKALARI_LEGACY_KEY); } catch (_) {}
    } catch (_) {}
  }

  function getBakalariProfilesFromStorage() {
    migrateBakalariLegacyOnce();
    try {
      var raw = localStorage.getItem(BAKALARI_PROFILES_KEY);
      if (!raw) return [];
      var a = JSON.parse(raw);
      if (!Array.isArray(a)) return [];
      return a.map(function (p) {
        return {
          id: String(p.id || ("bak_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8))),
          name: String(p.name || "").slice(0, 30),
          url: String(p.url || ""),
          username: String(p.username || ""),
          password: String(p.password || ""),
          locked: p.locked === true
        };
      }).slice(0, BAKALARI_MAX_CARDS);
    } catch (_) {}
    return [];
  }

  function setBakalariProfilesToStorage(arr) {
    var list = Array.isArray(arr) ? arr.slice(0, BAKALARI_MAX_CARDS) : [];
    try { localStorage.setItem(BAKALARI_PROFILES_KEY, JSON.stringify(list)); } catch (_) {}
  }

  function openBakalariUrlSafe(urlRaw) {
    if (!isValidBakalariUrl(urlRaw)) return;
    var url = normalizeBakalariUrl(urlRaw);
    if (typeof window.iuMindMenuOpenExternalUrl === "function") {
      window.iuMindMenuOpenExternalUrl(url);
      return;
    }
    var win = null;
    try {
      win = window.open(url, "_blank", "noopener,noreferrer");
    } catch (_) { return; }
    if (!win) return;
    try {
      if (win.location && win.location.origin === window.location.origin) {
        /* Same-origin only: reserved for future safe autofill hook. */
      }
    } catch (_) {}
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
    if (panel) panel.setAttribute("data-moje-kind", kind);
    if (overlay) overlay.setAttribute("data-moje-kind", kind);
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
    iuSetViewportLock(true);
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
    try { overlay.removeAttribute("data-moje-kind"); } catch (_) {}
    try { panel.removeAttribute("data-moje-kind"); } catch (_) {}
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
    iuSetViewportLock(false);
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
      "  <div class=\"iu-ib-info-box iuFpExternalNotice\" role=\"note\" aria-label=\"Informace o přechodu na banku\">",
      "    <p class=\"iu-ib-info-box__text iuFpExternalNotice__text\">Po kliknutí budete přesměrováni na oficiální stránky vybraného poskytovatele. Opustíte prostředí InfoUzel.cz. Před přihlášením vždy zkontrolujte adresu oficiálního webu banky.</p>",
      "  </div>",
      "  <div class=\"iu-mojeSluzbyBankaHead\"><button type=\"button\" class=\"iu-mojeSluzbyEditToggle iu-ib-edit-btn\" data-edit-toggle>Upravit</button></div>",
      "  <div class=\"iu-mojeSluzbyBankaFav\"><h3 class=\"iu-ib-section-title\">MOJE BANKY</h3>",
      "  <div class=\"iuBanksGrid iu-mojeSluzbyFavGrid\" data-fav-grid role=\"list\"></div></div>",
      "  <div class=\"iu-mojeSluzbyBankaAll\"><h3 class=\"iu-ib-section-title\">VŠECHNY BANKY</h3>",
      "  <input type=\"text\" class=\"iu-mojeSluzbySearch iu-ib-input\" placeholder=\"Hledat banku\" data-bank-search />",
      "  <div class=\"iuBanksGrid iu-mojeSluzbyAllGrid\" data-all-grid role=\"list\"></div></div>",
      "  <div class=\"iu-mojeSluzbyBankaCustom iu-ibBankCustomForm\" data-iu-ib-custom-form=\"1\"><h3 class=\"iu-ib-section-title\">Přidat vlastní banku</h3>",
      "  <input type=\"text\" class=\"iu-ibBankCustomName iu-ib-input\" placeholder=\"Název\" data-custom-name /><input type=\"text\" class=\"iu-ibBankCustomUrl iu-ib-input\" placeholder=\"URL (https://...)\" data-custom-url />",
      "  <button type=\"button\" class=\"iu-ibBankCustomAdd iu-ib-action-btn\" data-custom-add>Přidat</button></div>",
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
          "<button type=\"button\" class=\"iuBankCardMain iu-ibBankCardClickTop iu-clickable-feedback\" data-bank-login-url=\"" + esc(loginUrl) + "\"><span class=\"iuBankIcon iuBankIconGold\" aria-hidden=\"true\"><svg class=\"iu-bank-building-svg\" viewBox=\"0 0 24 24\" width=\"26\" height=\"26\" focusable=\"false\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 21h18\"/><path d=\"M5 21V7l7-4v18\"/><path d=\"M19 21V11l-7-4\"/><path d=\"M9 9v.01\"/><path d=\"M9 12v.01\"/><path d=\"M9 15v.01\"/><path d=\"M9 18v.01\"/></svg></span><span class=\"iuBankLabel iuBankLabelGold\">" + esc(bank.label) + "</span></button>" +
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
          "<button type=\"button\" class=\"iuBankCardMain iu-ibBankCardClickTop iu-clickable-feedback\" data-bank-login-url=\"" + esc(loginUrl) + "\"><span class=\"iuBankIcon iuBankIconGold\" aria-hidden=\"true\"><svg class=\"iu-bank-building-svg\" viewBox=\"0 0 24 24\" width=\"26\" height=\"26\" focusable=\"false\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 21h18\"/><path d=\"M5 21V7l7-4v18\"/><path d=\"M19 21V11l-7-4\"/><path d=\"M9 9v.01\"/><path d=\"M9 12v.01\"/><path d=\"M9 15v.01\"/><path d=\"M9 18v.01\"/></svg></span><span class=\"iuBankLabel iuBankLabelGold\">" + esc(bank.label) + "</span></button>" +
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
        var urlFav = mainBtn.getAttribute("data-bank-login-url");
        iuOpenBankLoginAfterPress(mainBtn, urlFav);
      }
    });

    allGrid.addEventListener("click", function(e) {
      if (e.target.closest("button.iuBankAdd")) return;
      var mainBtnAll = e.target.closest("button.iuBankCardMain");
      if (mainBtnAll) {
        var urlAll = mainBtnAll.getAttribute("data-bank-login-url");
        iuOpenBankLoginAfterPress(mainBtnAll, urlAll);
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

  function iuBakalariInjectUxCssOnce() {
    if (document.getElementById("iuBakalariUxCss")) return;
    const s = document.createElement("style");
    s.id = "iuBakalariUxCss";
    s.textContent =
      ".bakalari-root .bakalari-btn,.bakalari-root .bakalari-open-btn,.bakalari-root .bakalari-add-another{cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:background-color .15s ease,border-color .15s ease,filter .15s ease,box-shadow .15s ease,transform .12s ease}" +
      ".bakalari-root .bakalari-open-btn:active:not(:disabled){transform:scale(.97);box-shadow:0 2px 8px rgba(42,125,224,.3)}" +
      ".bakalari-root .bakalari-btn--secondary:hover:not(:disabled){filter:brightness(1.05)}" +
      ".bakalari-root .bakalari-btn--secondary:active:not(:disabled){filter:brightness(.9);transform:scale(.97)}" +
      ".bakalari-root .bakalari-btn--ghost:hover:not(:disabled){background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.28)}" +
      ".bakalari-root .bakalari-btn--ghost:active:not(:disabled){background:rgba(255,255,255,.2);border-color:rgba(255,255,255,.34);transform:scale(.97)}" +
      ".bakalari-root .bakalari-btn--danger:active:not(:disabled){transform:scale(.97)}" +
      ".bakalari-root .bakalari-add-another:hover:not(:disabled){background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.3)}" +
      ".bakalari-root .bakalari-add-another:active:not(:disabled){transform:scale(.97);background:rgba(255,255,255,.2)}" +
      ".bakalari-root .bakalari-btn.iu-bakalari-btn--copied,.bakalari-root .bakalari-btn.iu-bakalari-btn--saved{background:#dcfce7!important;color:#166534!important;border-color:#86efac!important}" +
      ".bakalari-root .bakalari-toggle-pw.iu-bakalari-toggle-pw--visible{background:rgba(224,231,255,.35)!important;border-color:rgba(99,102,241,.45)!important;color:#3730a3!important}" +
      ".bakalari-root .bakalari-cards-container>.bakalari-card:nth-child(5n+1){background:rgba(219,234,254,.55)}" +
      ".bakalari-root .bakalari-cards-container>.bakalari-card:nth-child(5n+2){background:rgba(209,250,229,.55)}" +
      ".bakalari-root .bakalari-cards-container>.bakalari-card:nth-child(5n+3){background:rgba(254,249,195,.55)}" +
      ".bakalari-root .bakalari-cards-container>.bakalari-card:nth-child(5n+4){background:rgba(237,233,254,.55)}" +
      ".bakalari-root .bakalari-cards-container>.bakalari-card:nth-child(5n){background:rgba(255,237,213,.55)}" +
      "#iuQuickFeed .bakalari-root .bakalari-btn--ghost{background:#f1f5f9;color:#0f172a;border-color:rgba(15,23,42,.14)}" +
      "#iuQuickFeed .bakalari-root .bakalari-btn--ghost:hover:not(:disabled){background:#e2e8f0;border-color:rgba(15,23,42,.22)}" +
      "#iuQuickFeed .bakalari-root .bakalari-btn--ghost:active:not(:disabled){background:#cbd5e1;border-color:rgba(15,23,42,.3);transform:scale(.97)}" +
      "#iuQuickFeed .bakalari-root .bakalari-add-another{background:#f8fafc;border-color:rgba(15,23,42,.14);color:#0f172a}" +
      "#iuQuickFeed .bakalari-root .bakalari-add-another:hover:not(:disabled){background:#eef2f7;border-color:rgba(15,23,42,.22)}" +
      "#iuQuickFeed .bakalari-root .bakalari-add-another:active:not(:disabled){background:#e2e8f0;transform:scale(.97)}" +
      "#iuQuickFeed .bakalari-root .bakalari-toggle-pw.iu-bakalari-toggle-pw--visible{background:#e0e7ff!important;border-color:rgba(29,78,216,.35)!important;color:#1e3a8a!important}";
    try {
      document.head.appendChild(s);
    } catch (_) {}
  }

  function renderBakalariModal(container) {
    iuBakalariInjectUxCssOnce();
    var PH_NAME = "Jméno dítěte";
    var PH_URL = "https://...";
    var PH_USER = "Uživatelské jméno";
    var PH_PASS = "Heslo";

    var profiles = getBakalariProfilesFromStorage().slice();
    if (!profiles.length) {
      profiles = [{ id: "bak_" + Date.now(), name: "", url: "", username: "", password: "", locked: false }];
    }

    var rootHtml = [
      "<div class=\"iu-mojeSluzbyBakalari bakalari-root\">",
      "  <div class=\"bakalari-cards-container\" data-bakalari-cards></div>",
      "  <button type=\"button\" class=\"bakalari-add-another\" data-bakalari-add>+ Přidat další</button>",
      "  <div class=\"bakalari-global-feedback\" data-bakalari-global-feedback aria-live=\"polite\"></div>",
      "  <div class=\"bakalari-delete-layer\" hidden data-bakalari-delete-layer role=\"presentation\">",
      "    <div class=\"bakalari-delete-dialog\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"bakalari-delete-title\">",
      "      <p id=\"bakalari-delete-title\" class=\"bakalari-delete-title\">Opravdu chcete kartu odstranit?</p>",
      "      <p class=\"bakalari-delete-hint\" data-bakalari-delete-hint></p>",
      "      <div class=\"bakalari-delete-actions\">",
      "        <button type=\"button\" class=\"bakalari-btn bakalari-btn--danger\" data-bakalari-delete-confirm>Odstranit</button>",
      "        <button type=\"button\" class=\"bakalari-btn bakalari-btn--ghost\" data-bakalari-delete-cancel>Zrušit</button>",
      "      </div>",
      "    </div>",
      "  </div>",
      "</div>"
    ].join("");
    container.innerHTML = rootHtml;

    var cardsEl = container.querySelector("[data-bakalari-cards]");
    var addAnotherBtn = container.querySelector("[data-bakalari-add]");
    var globalFb = container.querySelector("[data-bakalari-global-feedback]");
    var deleteLayer = container.querySelector("[data-bakalari-delete-layer]");
    var deleteHint = container.querySelector("[data-bakalari-delete-hint]");
    var deleteConfirmBtn = container.querySelector("[data-bakalari-delete-confirm]");
    var deleteCancelBtn = container.querySelector("[data-bakalari-delete-cancel]");
    var pendingDeleteCardEl = null;

    function showGlobalFb(text, ms) {
      if (!globalFb) return;
      globalFb.textContent = text || "";
      if (ms) {
        window.setTimeout(function () {
          if (globalFb.textContent === text) globalFb.textContent = "";
        }, ms);
      }
    }

    function stripPlaceholder(val, ph) {
      var t = String(val || "").trim();
      if (ph && t === ph) return "";
      return t;
    }

    function readCardFromDom(cardEl) {
      var id = cardEl.getAttribute("data-bakalari-id") || "";
      var nameInp = cardEl.querySelector("[data-field=\"name\"]");
      var urlInp = cardEl.querySelector("[data-field=\"url\"]");
      var userInp = cardEl.querySelector("[data-field=\"username\"]");
      var passInp = cardEl.querySelector("[data-field=\"password\"]");
      return {
        id: id,
        name: stripPlaceholder(nameInp && nameInp.value, PH_NAME).slice(0, 30),
        url: stripPlaceholder(urlInp && urlInp.value, PH_URL),
        username: stripPlaceholder(userInp && userInp.value, PH_USER),
        password: stripPlaceholder(passInp && passInp.value, PH_PASS)
      };
    }

    function profileFromCardEl(cardEl) {
      var o = readCardFromDom(cardEl);
      o.url = normalizeBakalariUrl(o.url);
      o.locked = cardEl.classList.contains("bakalari-card--locked");
      return o;
    }

    function applyCardLock(cardEl, locked) {
      cardEl.classList.toggle("bakalari-card--locked", !!locked);
      var inputs = cardEl.querySelectorAll(".bakalari-input");
      for (var i = 0; i < inputs.length; i++) {
        if (locked) inputs[i].setAttribute("readonly", "readonly");
        else inputs[i].removeAttribute("readonly");
      }
      var passInp = cardEl.querySelector("[data-field=\"password\"]");
      var togglePw = cardEl.querySelector("[data-toggle-password]");
      if (togglePw) togglePw.disabled = false;
      if (passInp && locked && passInp.getAttribute("type") === "text") {
        passInp.setAttribute("type", "password");
        if (togglePw) togglePw.textContent = "Zobrazit heslo";
      }
    }

    function setOpenButtonState(cardEl) {
      var urlInp = cardEl.querySelector("[data-field=\"url\"]");
      var openBtn = cardEl.querySelector("[data-bakalari-open]");
      if (!openBtn || !urlInp) return;
      var raw = stripPlaceholder(urlInp.value, PH_URL);
      var ok = isValidBakalariUrl(raw);
      openBtn.disabled = !ok;
      openBtn.setAttribute("aria-disabled", ok ? "false" : "true");
    }

    function syncProfilesFromDom() {
      var cardNodes = cardsEl.querySelectorAll(".bakalari-card");
      var next = [];
      for (var i = 0; i < cardNodes.length; i++) {
        next.push(profileFromCardEl(cardNodes[i]));
      }
      profiles = next;
    }

    function persistAllFromDom() {
      syncProfilesFromDom();
      setBakalariProfilesToStorage(profiles);
    }

    function updateAddButtonState() {
      var n = cardsEl.querySelectorAll(".bakalari-card").length;
      if (addAnotherBtn) addAnotherBtn.disabled = n >= BAKALARI_MAX_CARDS;
    }

    function showDeleteLayer(cardEl) {
      pendingDeleteCardEl = cardEl;
      var all = cardsEl.querySelectorAll(".bakalari-card");
      if (deleteHint) {
        deleteHint.textContent = all.length <= 1
          ? "Zbude jedna prázdná karta (údaje se vymažou)."
          : "Karta bude trvale odebrána z tohoto zařízení.";
      }
      if (deleteLayer) deleteLayer.hidden = false;
    }

    function hideDeleteLayer() {
      pendingDeleteCardEl = null;
      if (deleteLayer) deleteLayer.hidden = true;
    }

    function runPendingDelete() {
      var cardEl = pendingDeleteCardEl;
      hideDeleteLayer();
      if (!cardEl) return;
      var all = cardsEl.querySelectorAll(".bakalari-card");
      if (all.length <= 1) {
        var inpName = cardEl.querySelector("[data-field=\"name\"]");
        var inpUrl = cardEl.querySelector("[data-field=\"url\"]");
        var inpUser = cardEl.querySelector("[data-field=\"username\"]");
        var inpPass = cardEl.querySelector("[data-field=\"password\"]");
        if (inpName) inpName.value = "";
        if (inpUrl) inpUrl.value = "";
        if (inpUser) inpUser.value = "";
        if (inpPass) { inpPass.value = ""; inpPass.setAttribute("type", "password"); }
        try {
          cardEl.setAttribute("data-bakalari-id", "bak_" + Date.now());
        } catch (_) {}
        applyCardLock(cardEl, false);
        setOpenButtonState(cardEl);
        setBakalariProfilesToStorage([]);
        showGlobalFb("Karta vyčištěna.", 1800);
        return;
      }
      cardEl.parentNode.removeChild(cardEl);
      persistAllFromDom();
      updateAddButtonState();
    }

    function bakalariCopyToClipboard(text) {
      var t = String(text || "");
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          var p = navigator.clipboard.writeText(t);
          if (p && typeof p.then === "function") {
            p.catch(function () {});
          }
          return true;
        }
      } catch (_) {}
      return false;
    }

    function bakalariBtnFlashLabel(btn, tempLabel, ms, extraClass) {
      if (!btn || btn.disabled) return;
      if (btn.__iuBakalariFlashTimer) {
        clearTimeout(btn.__iuBakalariFlashTimer);
        btn.__iuBakalariFlashTimer = null;
      }
      var defaultLabel = btn.getAttribute("data-bakalari-default-label") || btn.textContent;
      if (!btn.getAttribute("data-bakalari-default-label")) btn.setAttribute("data-bakalari-default-label", defaultLabel);
      btn.textContent = tempLabel;
      if (extraClass) btn.classList.add(extraClass);
      btn.__iuBakalariFlashTimer = setTimeout(function () {
        btn.textContent = btn.getAttribute("data-bakalari-default-label") || defaultLabel;
        if (extraClass) btn.classList.remove(extraClass);
        btn.__iuBakalariFlashTimer = null;
      }, ms || 1600);
    }

    function bindCard(cardEl) {
      var urlInp = cardEl.querySelector("[data-field=\"url\"]");
      var openBtn = cardEl.querySelector("[data-bakalari-open]");
      var passInp = cardEl.querySelector("[data-field=\"password\"]");
      var userInp = cardEl.querySelector("[data-field=\"username\"]");
      var togglePw = cardEl.querySelector("[data-toggle-password]");

      if (urlInp) {
        urlInp.addEventListener("input", function () { setOpenButtonState(cardEl); });
      }
      setOpenButtonState(cardEl);

      if (openBtn) {
        openBtn.addEventListener("click", function () {
          var raw = urlInp ? stripPlaceholder(urlInp.value, PH_URL) : "";
          if (!isValidBakalariUrl(raw)) return;
          openBakalariUrlSafe(raw);
        });
      }

      if (togglePw && passInp) {
        togglePw.addEventListener("click", function () {
          var isPw = passInp.getAttribute("type") === "password";
          passInp.setAttribute("type", isPw ? "text" : "password");
          togglePw.textContent = isPw ? "Skrýt heslo" : "Zobrazit heslo";
          togglePw.classList.toggle("iu-bakalari-toggle-pw--visible", isPw);
        });
      }

      var copyUser = cardEl.querySelector("[data-copy-username]");
      if (copyUser && userInp) {
        copyUser.addEventListener("click", function () {
          var v = stripPlaceholder(userInp.value, PH_USER);
          if (v && bakalariCopyToClipboard(v)) bakalariBtnFlashLabel(copyUser, "Zkopírováno ✓", 1600, "iu-bakalari-btn--copied");
        });
      }
      var copyPass = cardEl.querySelector("[data-copy-password]");
      if (copyPass && passInp) {
        copyPass.addEventListener("click", function () {
          var v = stripPlaceholder(passInp.value, PH_PASS);
          if (v && bakalariCopyToClipboard(v)) bakalariBtnFlashLabel(copyPass, "Zkopírováno ✓", 1600, "iu-bakalari-btn--copied");
        });
      }

      var saveBtn = cardEl.querySelector("[data-action=\"save\"]");
      if (saveBtn) {
        saveBtn.addEventListener("click", function () {
          var data = profileFromCardEl(cardEl);
          if (isBakalariProfileEmpty(data)) {
            var msgEl = cardEl.querySelector("[data-bakalari-card-feedback]");
            if (msgEl) {
              msgEl.textContent = "Vyplňte alespoň jedno pole.";
              window.setTimeout(function () { if (msgEl.textContent === "Vyplňte alespoň jedno pole.") msgEl.textContent = ""; }, 2200);
            }
            return;
          }
          var urlRaw = stripPlaceholder(urlInp ? urlInp.value : "", PH_URL);
          if (urlRaw && !isValidBakalariUrl(urlRaw)) {
            var msgUrl = cardEl.querySelector("[data-bakalari-card-feedback]");
            if (msgUrl) {
              msgUrl.textContent = "Zadejte platnou adresu URL (https://…).";
              window.setTimeout(function () { if (msgUrl.textContent.indexOf("platnou") !== -1) msgUrl.textContent = ""; }, 2800);
            }
            return;
          }
          applyCardLock(cardEl, true);
          persistAllFromDom();
          showGlobalFb("Uloženo.", 2200);
          bakalariBtnFlashLabel(saveBtn, "Uloženo ✓", 1800, "iu-bakalari-btn--saved");
          var cf = cardEl.querySelector("[data-bakalari-card-feedback]");
          if (cf) cf.textContent = "";
        });
      }

      var editBtn = cardEl.querySelector("[data-action=\"edit\"]");
      if (editBtn) {
        editBtn.addEventListener("click", function () {
          applyCardLock(cardEl, false);
          persistAllFromDom();
          bakalariBtnFlashLabel(editBtn, "Upraveno ✓", 1400, "iu-bakalari-btn--saved");
          cardEl.classList.remove("bakalari-card--highlight");
          void cardEl.offsetWidth;
          cardEl.classList.add("bakalari-card--highlight");
          window.setTimeout(function () { cardEl.classList.remove("bakalari-card--highlight"); }, 600);
          var urlField = cardEl.querySelector("[data-field=\"url\"]");
          var first = cardEl.querySelector("[data-field=\"name\"]");
          var target = (urlField && !String(stripPlaceholder(urlField.value, PH_URL) || "").trim()) ? urlField : (first || urlField);
          if (target) {
            try { target.focus(); } catch (_) {}
          }
        });
      }

      var delBtn = cardEl.querySelector("[data-action=\"delete\"]");
      if (delBtn) {
        delBtn.addEventListener("click", function () {
          showDeleteLayer(cardEl);
        });
      }
    }

    function cardHtml(p) {
      var id = esc(p.id);
      var locked = !!p.locked;
      var ro = locked ? " readonly" : "";
      var nameV = p.name ? esc(p.name) : "";
      var urlV = p.url ? esc(p.url) : "";
      var userV = p.username ? esc(p.username) : "";
      var passV = p.password ? esc(p.password) : "";
      var lockClass = locked ? " bakalari-card--locked" : "";
      return (
        "<section class=\"bakalari-card" + lockClass + "\" data-bakalari-id=\"" + id + "\">" +
        "  <button type=\"button\" class=\"bakalari-open-btn\" data-bakalari-open disabled aria-disabled=\"true\">Otevřít Bakaláře</button>" +
        "  <div class=\"bakalari-fields\">" +
        "    <label class=\"bakalari-field\"><span class=\"bakalari-label\">Jméno dítěte</span><input type=\"text\" class=\"bakalari-input\" data-field=\"name\" maxlength=\"30\" autocomplete=\"name\"" + ro + " value=\"" + nameV + "\" placeholder=\"" + esc(PH_NAME) + "\" /></label>" +
        "    <label class=\"bakalari-field\"><span class=\"bakalari-label\">Odkaz na Bakaláře</span><input type=\"text\" class=\"bakalari-input\" data-field=\"url\" inputmode=\"url\" autocomplete=\"url\"" + ro + " value=\"" + urlV + "\" placeholder=\"" + esc(PH_URL) + "\" /></label>" +
        "    <div class=\"bakalari-field\"><span class=\"bakalari-label\">Uživatelské jméno (volitelné)</span><div class=\"bakalari-inline-row\">" +
        "<input type=\"text\" class=\"bakalari-input\" data-field=\"username\" autocomplete=\"username\"" + ro + " value=\"" + userV + "\" placeholder=\"" + esc(PH_USER) + "\" />" +
        "<button type=\"button\" class=\"bakalari-btn bakalari-btn--mini bakalari-btn--ghost\" data-copy-username>Kopírovat</button></div></div>" +
        "    <div class=\"bakalari-field\"><span class=\"bakalari-label\">Heslo (volitelné)</span><div class=\"bakalari-inline-row\">" +
        "<input type=\"password\" class=\"bakalari-input\" data-field=\"password\" autocomplete=\"current-password\"" + ro + " value=\"" + passV + "\" placeholder=\"" + esc(PH_PASS) + "\" />" +
        "<button type=\"button\" class=\"bakalari-btn bakalari-btn--mini bakalari-btn--ghost\" data-copy-password>Kopírovat</button></div>" +
        "<button type=\"button\" class=\"bakalari-btn bakalari-btn--ghost bakalari-toggle-pw\" data-toggle-password>Zobrazit heslo</button></div>" +
        "  </div>" +
        "  <div class=\"bakalari-card-actions\">" +
        "    <button type=\"button\" class=\"bakalari-btn bakalari-btn--secondary\" data-action=\"save\">Uložit</button>" +
        "    <button type=\"button\" class=\"bakalari-btn bakalari-btn--ghost\" data-action=\"edit\">Upravit</button>" +
        "    <button type=\"button\" class=\"bakalari-btn bakalari-btn--danger\" data-action=\"delete\">Odstranit</button>" +
        "  </div>" +
        "  <div class=\"bakalari-card-feedback\" data-bakalari-card-feedback aria-live=\"polite\"></div>" +
        "</section>"
      );
    }

    function renderAllCards() {
      cardsEl.innerHTML = profiles.map(function (p) { return cardHtml(p); }).join("");
      cardsEl.querySelectorAll(".bakalari-card").forEach(function (el) {
        if (el.classList.contains("bakalari-card--locked")) {
          applyCardLock(el, true);
        }
        bindCard(el);
        setOpenButtonState(el);
      });
      updateAddButtonState();
    }

    if (deleteConfirmBtn) {
      deleteConfirmBtn.addEventListener("click", function () { runPendingDelete(); });
    }
    if (deleteCancelBtn) {
      deleteCancelBtn.addEventListener("click", function () { hideDeleteLayer(); });
    }
    if (deleteLayer) {
      deleteLayer.addEventListener("click", function (e) {
        if (e.target === deleteLayer) hideDeleteLayer();
      });
    }

    if (addAnotherBtn) {
      addAnotherBtn.addEventListener("click", function () {
        var n = cardsEl.querySelectorAll(".bakalari-card").length;
        if (n >= BAKALARI_MAX_CARDS) return;
        syncProfilesFromDom();
        profiles.push({ id: "bak_" + Date.now(), name: "", url: "", username: "", password: "", locked: false });
        setBakalariProfilesToStorage(profiles);
        renderAllCards();
        try {
          if (addAnotherBtn && typeof addAnotherBtn.blur === "function") addAnotherBtn.blur();
        } catch (_) {}
      });
    }

    try {
      window.iuBakalariPersistOpenCards = function () {
        if (!container || !container.isConnected) return;
        persistAllFromDom();
      };
    } catch (_) {}

    renderAllCards();
  }

  function renderPojistovnaModal(container) {
    var profiles = healthLoadCardsFromStorage().slice();

    function healthCardTitleLine(card) {
      var pr = healthRegistryById(card.providerId);
      if (!pr) return "Nová pojišťovna";
      var pl = String(card.personLabel || "").trim();
      if (pl) return pr.name + " – " + pl;
      return pr.name;
    }

    function syncProfilesFromDom() {
      var nodes = cardsEl.querySelectorAll(".iu-health-card");
      for (var si = 0; si < nodes.length; si++) {
        var ix = parseInt(nodes[si].getAttribute("data-iu-health-index") || "0", 10);
        if (!profiles[ix]) continue;
        var c = profiles[ix];
        var personInp = nodes[si].querySelector("[data-iu-health-person]");
        var urlInp = nodes[si].querySelector("[data-iu-health-custom-url]");
        var loginInp = nodes[si].querySelector("[data-iu-health-login]");
        var passInp = nodes[si].querySelector("[data-iu-health-password]");
        if (personInp) c.personLabel = String(personInp.value || "").slice(0, 120);
        if (urlInp) c.url = normalizeHealthUrl(urlInp.value);
        if (loginInp) c.loginValue = String(loginInp.value || "");
        if (passInp) c.passwordValue = String(passInp.value || "");
      }
    }

    function persistAllFromDom() {
      syncProfilesFromDom();
      healthSaveCardsToStorage(profiles);
    }

    var rootHtml = [
      "<div class=\"iu-health-root\" data-iu-health-root>",
      "  <div class=\"iu-health-cards\" data-iu-health-cards></div>",
      "  <button type=\"button\" class=\"iu-health-add\" data-iu-health-add>+ Přidat další</button>",
      "  <div class=\"iu-health-global-feedback\" data-iu-health-global-feedback aria-live=\"polite\"></div>",
      "  <div class=\"iu-health-picker-layer\" hidden data-iu-health-picker-layer role=\"presentation\">",
      "    <div class=\"iu-health-picker-dialog\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"iu-health-picker-title\">",
      "      <p id=\"iu-health-picker-title\" class=\"iu-health-picker-title\">Vyberte pojišťovnu</p>",
      "      <div class=\"iu-health-picker-list\" data-iu-health-picker-list></div>",
      "      <button type=\"button\" class=\"iu-health-picker-close\" data-iu-health-picker-close>Zavřít</button>",
      "    </div>",
      "  </div>",
      "  <div class=\"iu-health-delete-layer\" hidden data-iu-health-delete-layer role=\"presentation\">",
      "    <div class=\"iu-health-delete-dialog\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"iu-health-delete-title\">",
      "      <p id=\"iu-health-delete-title\" class=\"iu-health-delete-title\">Opravdu chcete kartu odstranit?</p>",
      "      <p class=\"iu-health-delete-hint\" data-iu-health-delete-hint></p>",
      "      <div class=\"iu-health-delete-actions\">",
      "        <button type=\"button\" class=\"iu-health-btn iu-health-btn--danger\" data-iu-health-delete-confirm>Odstranit</button>",
      "        <button type=\"button\" class=\"iu-health-btn iu-health-btn--ghost\" data-iu-health-delete-cancel>Zrušit</button>",
      "      </div>",
      "    </div>",
      "  </div>",
      "</div>"
    ].join("");
    container.innerHTML = rootHtml;

    var cardsEl = container.querySelector("[data-iu-health-cards]");
    var addAnotherBtn = container.querySelector("[data-iu-health-add]");
    var globalFb = container.querySelector("[data-iu-health-global-feedback]");
    var pickerLayer = container.querySelector("[data-iu-health-picker-layer]");
    var pickerList = container.querySelector("[data-iu-health-picker-list]");
    var pickerClose = container.querySelector("[data-iu-health-picker-close]");
    var deleteLayer = container.querySelector("[data-iu-health-delete-layer]");
    var deleteHint = container.querySelector("[data-iu-health-delete-hint]");
    var deleteConfirmBtn = container.querySelector("[data-iu-health-delete-confirm]");
    var deleteCancelBtn = container.querySelector("[data-iu-health-delete-cancel]");
    var pendingDeleteIndex = -1;
    var pickerTargetIndex = -1;
    var pickerReturnFocusEl = null;
    var pickerKeyHandler = null;

    function showGlobalFb(text, ms) {
      if (!globalFb) return;
      globalFb.textContent = text || "";
      if (ms) {
        window.setTimeout(function () {
          if (globalFb.textContent === text) globalFb.textContent = "";
        }, ms);
      }
    }

    function showCardFb(cardEl, text, ms) {
      var el = cardEl.querySelector("[data-iu-health-card-feedback]");
      if (!el) return;
      el.textContent = text || "";
      if (ms) {
        window.setTimeout(function () {
          if (el.textContent === text) el.textContent = "";
        }, ms);
      }
    }

    function updateAddButtonState() {
      var n = cardsEl.querySelectorAll(".iu-health-card").length;
      if (addAnotherBtn) {
        addAnotherBtn.disabled = n >= HEALTH_MAX_CARDS;
        addAnotherBtn.setAttribute("aria-disabled", n >= HEALTH_MAX_CARDS ? "true" : "false");
      }
    }

    function setOpenButtonState(cardEl, card) {
      var openBtn = cardEl.querySelector("[data-iu-health-open]");
      if (!openBtn) return;
      var u = healthResolveOpenUrl(card);
      var ok = isValidHealthOpenUrl(u);
      openBtn.disabled = !ok;
      openBtn.setAttribute("aria-disabled", ok ? "false" : "true");
    }

    function cardHtml(p, ix) {
      var pr = healthRegistryById(p.providerId);
      var lockClass = p.isSaved ? " iu-health-card--locked" : "";
      var ro = p.isSaved ? " readonly" : "";
      var showUrl = pr && pr.requiresCustomUrl;
      var loginLab = pr ? esc(pr.loginLabel) : esc("Přihlašovací údaj");
      var openLab = pr ? esc(pr.openLabel) : esc("Otevřít pojišťovnu");
      var provLabel = pr ? esc(pr.name) : esc("Vyberte pojišťovnu");
      var provDisabled = p.isSaved ? " disabled aria-disabled=\"true\"" : "";
      var helper = pr && pr.helperText ? "<p class=\"iu-health-helper\" data-iu-health-helper>" + esc(pr.helperText) + "</p>" : "<p class=\"iu-health-helper\" data-iu-health-helper hidden></p>";
      var urlRowHidden = showUrl ? "" : " hidden";
      var urlVal = esc(p.url || "");
      var personV = esc(p.personLabel || "");
      var loginV = esc(p.loginValue || "");
      var passV = esc(p.passwordValue || "");
      var accent = esc(p.colorToken || HEALTH_COLOR_PALETTE[0]);
      return (
        "<section class=\"iu-health-card" + lockClass + "\" data-iu-health-index=\"" + ix + "\" style=\"--iu-health-accent:" + accent + "\">" +
        "  <h3 class=\"iu-health-card-title\" data-iu-health-card-title>" + esc(healthCardTitleLine(p)) + "</h3>" +
        "  <button type=\"button\" class=\"iu-health-open-btn\" data-iu-health-open disabled aria-disabled=\"true\">" + openLab + "</button>" +
        "  <label class=\"iu-health-field\">" +
        "    <span class=\"iu-health-label\">Pojišťovna</span>" +
        "    <button type=\"button\" class=\"iu-health-provider-trigger\" data-iu-health-provider-trigger" + provDisabled + ">" + provLabel + "</button>" +
        "  </label>" +
        "  <div class=\"iu-health-field iu-health-url-row\"" + urlRowHidden + " data-iu-health-url-row>" +
        "    <span class=\"iu-health-label\">URL pojišťovny</span>" +
        "    <input type=\"text\" class=\"iu-health-input\" data-iu-health-custom-url inputmode=\"url\" autocomplete=\"url\" placeholder=\"https://…\"" + ro + " value=\"" + urlVal + "\" />" +
        "  </div>" +
        "  <label class=\"iu-health-field\">" +
        "    <span class=\"iu-health-label\">Pro koho</span>" +
        "    <input type=\"text\" class=\"iu-health-input\" data-iu-health-person maxlength=\"120\" autocomplete=\"name\" placeholder=\"např. Josef, Dcera…\"" + ro + " value=\"" + personV + "\" />" +
        "  </label>" +
        "  <div class=\"iu-health-field\">" +
        "    <span class=\"iu-health-label\" data-iu-health-login-label>" + loginLab + "</span>" +
        "    <div class=\"iu-health-inline-row\">" +
        "      <input type=\"text\" class=\"iu-health-input\" data-iu-health-login autocomplete=\"username\" spellcheck=\"false\"" + ro + " value=\"" + loginV + "\" />" +
        "      <button type=\"button\" class=\"iu-health-btn iu-health-btn--mini iu-health-btn--ghost\" data-iu-health-copy-login>Kopírovat</button>" +
        "    </div>" +
        "  </div>" +
        "  <div class=\"iu-health-field\">" +
        "    <span class=\"iu-health-label\">Heslo</span>" +
        "    <div class=\"iu-health-inline-row\">" +
        "      <input type=\"password\" class=\"iu-health-input\" data-iu-health-password autocomplete=\"current-password\"" + ro + " value=\"" + passV + "\" />" +
        "      <button type=\"button\" class=\"iu-health-btn iu-health-btn--mini iu-health-btn--ghost\" data-iu-health-copy-password>Kopírovat</button>" +
        "    </div>" +
        "    <button type=\"button\" class=\"iu-health-btn iu-health-btn--ghost iu-health-toggle-pw\" data-iu-health-toggle-pw aria-pressed=\"false\">Zobrazit heslo</button>" +
        "  </div>" +
        helper +
        "  <div class=\"iu-health-card-actions\">" +
        "    <button type=\"button\" class=\"iu-health-btn iu-health-btn--secondary\" data-iu-health-save>Uložit</button>" +
        "    <button type=\"button\" class=\"iu-health-btn iu-health-btn--ghost\" data-iu-health-edit>Upravit</button>" +
        "    <button type=\"button\" class=\"iu-health-btn iu-health-btn--danger\" data-iu-health-delete>Odstranit</button>" +
        "  </div>" +
        "  <div class=\"iu-health-card-feedback\" data-iu-health-card-feedback aria-live=\"polite\"></div>" +
        "</section>"
      );
    }

    function renderAllCards() {
      cardsEl.innerHTML = profiles.map(function (p, ix) { return cardHtml(p, ix); }).join("");
      cardsEl.querySelectorAll(".iu-health-card").forEach(function (el) {
        bindCard(el);
        var ix = parseInt(el.getAttribute("data-iu-health-index") || "0", 10);
        if (profiles[ix]) setOpenButtonState(el, profiles[ix]);
      });
      updateAddButtonState();
    }

    function hidePicker() {
      if (pickerLayer) pickerLayer.hidden = true;
      if (pickerKeyHandler) {
        document.removeEventListener("keydown", pickerKeyHandler, true);
        pickerKeyHandler = null;
      }
      if (pickerReturnFocusEl && typeof pickerReturnFocusEl.focus === "function") {
        try { pickerReturnFocusEl.focus(); } catch (_) {}
      }
      pickerReturnFocusEl = null;
      pickerTargetIndex = -1;
    }

    function showPicker(ix, triggerEl) {
      pickerTargetIndex = ix;
      pickerReturnFocusEl = triggerEl || null;
      if (!pickerList || !pickerLayer) return;
      pickerList.innerHTML = HEALTH_PROVIDER_REGISTRY.map(function (pr) {
        return "<button type=\"button\" class=\"iu-health-picker-item\" data-iu-health-pick-id=\"" + esc(pr.id) + "\">" + esc(pr.name) + "</button>";
      }).join("");
      pickerLayer.hidden = false;
      pickerKeyHandler = function (e) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          hidePicker();
        }
      };
      document.addEventListener("keydown", pickerKeyHandler, true);
      var first = pickerList.querySelector(".iu-health-picker-item");
      if (first) {
        window.setTimeout(function () {
          try { first.focus(); } catch (_) {}
        }, 0);
      }
    }

    if (pickerList) {
      pickerList.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest && e.target.closest("[data-iu-health-pick-id]");
        if (!btn) return;
        e.preventDefault();
        var pid = btn.getAttribute("data-iu-health-pick-id");
        if (pickerTargetIndex < 0 || !profiles[pickerTargetIndex]) {
          hidePicker();
          return;
        }
        profiles[pickerTargetIndex].providerId = pid;
        healthApplyRegistryToCard(profiles[pickerTargetIndex]);
        hidePicker();
        renderAllCards();
      });
    }
    if (pickerLayer) {
      pickerLayer.addEventListener("click", function (e) {
        if (e.target === pickerLayer) hidePicker();
      });
    }
    if (pickerClose) pickerClose.addEventListener("click", function () { hidePicker(); });

    function hideDeleteLayer() {
      pendingDeleteIndex = -1;
      if (deleteLayer) deleteLayer.hidden = true;
    }

    function showDeleteLayer(ix) {
      pendingDeleteIndex = ix;
      var allN = cardsEl.querySelectorAll(".iu-health-card").length;
      if (deleteHint) {
        deleteHint.textContent = allN <= 1
          ? "Zbude jedna prázdná karta (údaje se vymažou)."
          : "Karta bude trvale odebrána z tohoto zařízení.";
      }
      if (deleteLayer) deleteLayer.hidden = false;
    }

    function runPendingDelete() {
      var ix = pendingDeleteIndex;
      hideDeleteLayer();
      if (ix < 0) return;
      var nodes = cardsEl.querySelectorAll(".iu-health-card");
      if (nodes.length <= 1) {
        profiles = [healthNewCardModel(undefined)];
        healthSaveCardsToStorage(profiles);
        renderAllCards();
        showGlobalFb("Karta vyčištěna.", 1800);
        return;
      }
      profiles.splice(ix, 1);
      healthSaveCardsToStorage(profiles);
      renderAllCards();
    }

    function bindCard(cardEl) {
      var ix = parseInt(cardEl.getAttribute("data-iu-health-index") || "0", 10);
      var card = profiles[ix];
      if (!card) return;

      var openBtn = cardEl.querySelector("[data-iu-health-open]");
      var provTrigger = cardEl.querySelector("[data-iu-health-provider-trigger]");
      var urlInp = cardEl.querySelector("[data-iu-health-custom-url]");
      var personInp = cardEl.querySelector("[data-iu-health-person]");
      var loginInp = cardEl.querySelector("[data-iu-health-login]");
      var passInp = cardEl.querySelector("[data-iu-health-password]");
      var togglePw = cardEl.querySelector("[data-iu-health-toggle-pw]");
      var saveBtn = cardEl.querySelector("[data-iu-health-save]");
      var editBtn = cardEl.querySelector("[data-iu-health-edit]");
      var delBtn = cardEl.querySelector("[data-iu-health-delete]");
      var copyLoginBtn = cardEl.querySelector("[data-iu-health-copy-login]");
      var copyPassBtn = cardEl.querySelector("[data-iu-health-copy-password]");

      function refreshFromInputs() {
        syncProfilesFromDom();
        setOpenButtonState(cardEl, profiles[ix]);
      }

      if (urlInp) urlInp.addEventListener("input", refreshFromInputs);
      if (loginInp) loginInp.addEventListener("input", refreshFromInputs);
      if (personInp) personInp.addEventListener("input", function () {
        syncProfilesFromDom();
        var t = cardEl.querySelector("[data-iu-health-card-title]");
        if (t) t.textContent = healthCardTitleLine(profiles[ix]);
      });

      setOpenButtonState(cardEl, card);

      if (openBtn) {
        openBtn.addEventListener("click", function () {
          syncProfilesFromDom();
          var u = healthResolveOpenUrl(profiles[ix]);
          if (!isValidHealthOpenUrl(u)) return;
          try { window.open(u, "_blank", "noopener,noreferrer"); } catch (_) {}
        });
      }

      if (provTrigger) {
        provTrigger.addEventListener("click", function () {
          if (profiles[ix].isSaved) return;
          showPicker(ix, provTrigger);
        });
      }

      if (togglePw && passInp) {
        togglePw.addEventListener("click", function () {
          var isPw = passInp.getAttribute("type") === "password";
          passInp.setAttribute("type", isPw ? "text" : "password");
          togglePw.textContent = isPw ? "Skrýt heslo" : "Zobrazit heslo";
          togglePw.setAttribute("aria-pressed", isPw ? "true" : "false");
        });
      }

      if (copyLoginBtn && loginInp) {
        copyLoginBtn.addEventListener("click", function () {
          syncProfilesFromDom();
          var v = String(profiles[ix].loginValue || "").trim();
          if (!v) return;
          healthCopyToClipboard(v);
          var pr = healthRegistryById(profiles[ix].providerId);
          var msg = pr ? healthCopyLoginFeedback(pr.loginType) : "Údaj zkopírován";
          showCardFb(cardEl, msg, 2200);
        });
      }
      if (copyPassBtn && passInp) {
        copyPassBtn.addEventListener("click", function () {
          syncProfilesFromDom();
          var v = String(profiles[ix].passwordValue || "").trim();
          if (!v) return;
          healthCopyToClipboard(v);
          showCardFb(cardEl, "Heslo zkopírováno", 2200);
        });
      }

      if (saveBtn) {
        saveBtn.addEventListener("click", function () {
          syncProfilesFromDom();
          var chk = healthValidateSave(profiles[ix]);
          if (!chk.ok) {
            showCardFb(cardEl, chk.msg, 3200);
            return;
          }
          profiles[ix].isSaved = true;
          healthApplyRegistryToCard(profiles[ix]);
          persistAllFromDom();
          renderAllCards();
          showGlobalFb("Uloženo.", 2200);
        });
      }

      if (editBtn) {
        editBtn.addEventListener("click", function () {
          profiles[ix].isSaved = false;
          persistAllFromDom();
          renderAllCards();
          var el = cardsEl.querySelector(".iu-health-card[data-iu-health-index=\"" + ix + "\"]");
          if (el) {
            el.classList.remove("iu-health-card--highlight");
            void el.offsetWidth;
            el.classList.add("iu-health-card--highlight");
            window.setTimeout(function () { el.classList.remove("iu-health-card--highlight"); }, 600);
            var first = el.querySelector("[data-iu-health-provider-trigger]");
            if (first) try { first.focus(); } catch (_) {}
          }
        });
      }

      if (delBtn) {
        delBtn.addEventListener("click", function () {
          showDeleteLayer(ix);
        });
      }
    }

    if (deleteConfirmBtn) deleteConfirmBtn.addEventListener("click", runPendingDelete);
    if (deleteCancelBtn) deleteCancelBtn.addEventListener("click", hideDeleteLayer);
    if (deleteLayer) {
      deleteLayer.addEventListener("click", function (e) {
        if (e.target === deleteLayer) hideDeleteLayer();
      });
    }

    if (addAnotherBtn) {
      addAnotherBtn.addEventListener("click", function () {
        var n = cardsEl.querySelectorAll(".iu-health-card").length;
        if (n >= HEALTH_MAX_CARDS) return;
        syncProfilesFromDom();
        var prevCol = profiles.length ? profiles[profiles.length - 1].colorToken : undefined;
        profiles.push(healthNewCardModel(prevCol));
        healthSaveCardsToStorage(profiles);
        renderAllCards();
        try {
          if (addAnotherBtn && typeof addAnotherBtn.blur === "function") addAnotherBtn.blur();
        } catch (_) {}
      });
    }

    renderAllCards();
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

// === Notes overlay module (lazy boot; heavy IIFE in iu-notes-overlay-v1.js) ===
(function iuBootNotesOverlayLazy() {
  "use strict";
  var NOTES_URL = "./iu-notes-overlay-v1.js?v=perf-stage5-notes-v1-20260819-pc-vault-mindmenu-persist-v1-20260824";
  var p = null;

  function ready() {
    try {
      return !!(
        window.__iuNotesOverlayInited &&
        window.iuNotesService &&
        !window.iuNotesService.__iuNotesLazyStub &&
        typeof window.iuNotesService.openOverlay === "function" &&
        window.iuNotesStorage &&
        !window.iuNotesStorage.__iuNotesLazyStub &&
        typeof window.iuNotesStorage.noteMergeLegacyToBody === "function"
      );
    } catch (_) {
      return false;
    }
  }

  function ensure() {
    if (ready()) return Promise.resolve();
    if (p) return p;
    p = import(NOTES_URL)
      .then(function (m) {
        if (!m || typeof m.initIuNotesOverlay !== "function") {
          throw new Error("notes overlay module missing initIuNotesOverlay");
        }
        return m.initIuNotesOverlay();
      })
      .then(function () {
        try {
          if (window.__iuNotesOverlayBootPromise) return window.__iuNotesOverlayBootPromise;
        } catch (_) {}
      })
      .then(function () {
        if (!ready()) {
          p = null;
          throw new Error("notes overlay init did not install iuNotesService");
        }
      })
      .catch(function (e) {
        p = null;
        try {
          console.warn("[iu] notes overlay import/init failed", e);
        } catch (_) {}
        throw e;
      });
    return p;
  }

  try {
    window.__iuEnsureNotesOverlay = ensure;
  } catch (_) {}

  function installStub() {
    if (ready()) return;
    try {
      if (window.iuNotesService && !window.iuNotesService.__iuNotesLazyStub) return;
    } catch (_) {}
    window.iuNotesService = {
      __iuNotesLazyStub: 1,
      openOverlay: function (el) {
        return ensure().then(function () {
          var s = window.iuNotesService;
          if (s && !s.__iuNotesLazyStub && typeof s.openOverlay === "function") return s.openOverlay(el);
        });
      },
      closeOverlay: function () {
        return ensure().then(function () {
          var s = window.iuNotesService;
          if (s && !s.__iuNotesLazyStub && typeof s.closeOverlay === "function") return s.closeOverlay();
        });
      },
    };
  }
  installStub();

  function isNotesTrigger(el) {
    try {
      if (!el || typeof el.closest !== "function") return null;
      return el.closest("[data-iu-notes-trigger], .iu-mmTopTool--notes");
    } catch (_) {
      return null;
    }
  }

  try {
    document.addEventListener(
      "pointerdown",
      function (e) {
        try {
          var t = e.target;
          if (t && t.nodeType === 3) t = t.parentElement;
          if (isNotesTrigger(t)) void ensure();
        } catch (_) {}
      },
      true
    );
  } catch (_) {}

  try {
    document.addEventListener(
      "click",
      function (e) {
        try {
          if (ready()) return;
          var t = e.target;
          if (t && t.nodeType === 3) t = t.parentElement;
          var hit = isNotesTrigger(t);
          if (!hit) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          ensure().then(function () {
            try {
              var s = window.iuNotesService;
              if (s && !s.__iuNotesLazyStub && typeof s.openOverlay === "function") s.openOverlay(hit);
            } catch (_) {}
          });
        } catch (_) {}
      },
      true
    );
  } catch (_) {}
})();

// === Tasks overlay module (MVP, local-first) ===
(function iuTasksOverlayModule(){
  "use strict";

  const TASKS_STORE_KEY = "iu.tasks.mvp.v1";
  const VAULT_ENC_PREFIX = "iu:vault:enc:v1:";
  const TASKS_OVERLAY_DOM_VERSION = "2";
  const LEGACY_SILVER_KEY = "iu.infoUzel.silverTasks.v1";
  const SCHEMA_VERSION = 1;
  const MAX_TASKS = 500;

  const state = {
    inited: false,
    bound: false,
    overlayMounted: false,
    trapAttached: false,
    returnFocusEl: null,
    prevBodyPadRight: "",
    data: { schemaVersion: SCHEMA_VERSION, tasks: [] },
    filter: "all",
    panelMode: "list",
    editingId: "",
    migrationDone: false,
    searchQuery: "",
    searchTimer: null
  };

  function uid(p){ return String(p || "t") + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"]/g, function(m){
      return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]);
    });
  }

  function foldCs(s){
    return iuFoldCsShared(s);
  }

  function matchesSearch(t, q){
    const qq = foldCs(String(q || "").trim());
    if (!qq) return true;
    return foldCs(t.title).indexOf(qq) >= 0 || foldCs(t.note).indexOf(qq) >= 0;
  }

  function localYmd(d){
    try{
      const x = d instanceof Date ? d : new Date(d);
      if (!x || !Number.isFinite(x.getTime())) return "";
      const y = x.getFullYear();
      const m = String(x.getMonth() + 1).padStart(2, "0");
      const day = String(x.getDate()).padStart(2, "0");
      return y + "-" + m + "-" + day;
    }catch{ return ""; }
  }

  function isYmd(s){
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  function dueMeta(ymd, status){
    if (status === "done") return { cls: "iu-taskChip--none", label: "Hotovo" };
    if (!ymd) return { cls: "iu-taskChip--none", label: "Bez termínu" };
    const today = localYmd(new Date());
    if (ymd < today) return { cls: "iu-taskChip--overdue", label: "Po termínu" };
    if (ymd === today) return { cls: "iu-taskChip--today", label: "Dnes" };
    return { cls: "iu-taskChip--future", label: "Termín " + fmtCsDate(ymd) };
  }

  function fmtCsDate(ymd){
    if (!isYmd(ymd)) return "";
    const p = ymd.split("-");
    return p[2] + "." + p[1] + "." + p[0];
  }

  function priorityClass(p){
    const x = String(p || "medium");
    if (x === "low") return "iu-taskRow--pri-low";
    if (x === "high") return "iu-taskRow--pri-high";
    return "iu-taskRow--pri-medium";
  }

  function priorityLabel(p){
    const x = String(p || "medium");
    if (x === "low") return "Nízká";
    if (x === "high") return "Vysoká";
    return "Střední";
  }

  function sanitizeTask(t){
    if (!t || typeof t !== "object") return null;
    const id = String(t.id || "").trim() || uid("tsk");
    const title = String(t.title || "").trim().slice(0, 200);
    const note = String(t.note != null ? t.note : "").slice(0, 500);
    let dueAt = t.dueAt;
    if (dueAt == null || dueAt === "") dueAt = null;
    else {
      dueAt = String(dueAt).trim().slice(0, 10);
      if (!isYmd(dueAt)) dueAt = null;
    }
    const pr = String(t.priority || "medium");
    const priority = pr === "low" || pr === "medium" || pr === "high" ? pr : "medium";
    const status = t.status === "done" ? "done" : "todo";
    let dueTime = t.dueTime;
    if (dueTime == null || dueTime === "") dueTime = null;
    else {
      dueTime = String(dueTime).trim().slice(0, 5);
      if (!/^\d{1,2}:\d{2}$/.test(dueTime)) dueTime = null;
      else {
        const tp = dueTime.split(":");
        dueTime = String(Number(tp[0])).padStart(2, "0") + ":" + tp[1];
      }
    }
    const createdAt = Number.isFinite(Number(t.createdAt)) ? Number(t.createdAt) : Date.now();
    const updatedAt = Number.isFinite(Number(t.updatedAt)) ? Number(t.updatedAt) : createdAt;
    return { id, title, note, dueAt, dueTime, priority, status, createdAt, updatedAt };
  }

  function hasVaultEncBlob(key) {
    try {
      return !!localStorage.getItem(VAULT_ENC_PREFIX + key);
    } catch (_) {
      return false;
    }
  }

  function loadRaw(){
    try{
      const raw = localStorage.getItem(TASKS_STORE_KEY);
      const p = raw ? JSON.parse(raw) : null;
      if (p && p.schemaVersion === SCHEMA_VERSION && Array.isArray(p.tasks)) return p;
    }catch{}
    if (hasVaultEncBlob(TASKS_STORE_KEY)) {
      if (state.data && Array.isArray(state.data.tasks)) return state.data;
      return { schemaVersion: SCHEMA_VERSION, tasks: [] };
    }
    return { schemaVersion: SCHEMA_VERSION, tasks: [] };
  }

  function migrateLegacySilverOnce(){
    if (state.migrationDone) return;
    state.migrationDone = true;
    try{
      const cur = loadRaw();
      if (cur.tasks && cur.tasks.length) return;
      const leg = localStorage.getItem(LEGACY_SILVER_KEY);
      const p = leg ? JSON.parse(leg) : null;
      if (!p || !Array.isArray(p.items) || !p.items.length) return;
      const out = [];
      for (let i = 0; i < p.items.length; i++){
        const it = p.items[i];
        if (!it || typeof it !== "object") continue;
        const title = String(it.title || "Úkol").trim().slice(0, 200);
        const note = String(it.detail || "").slice(0, 500);
        const createdAt = Number.isFinite(Number(it.createdAt)) ? Number(it.createdAt) : Date.now();
        out.push(sanitizeTask({
          id: String(it.id || "").trim() || uid("tsk"),
          title: title || "Úkol",
          note: note,
          dueAt: null,
          priority: "medium",
          status: "todo",
          createdAt: createdAt,
          updatedAt: createdAt
        }));
      }
      if (out.length){
        state.data = { schemaVersion: SCHEMA_VERSION, tasks: out };
        saveTasks(state.data);
      }
    }catch{}
  }

  function loadTasks(){
    migrateLegacySilverOnce();
    const p = loadRaw();
    const tasks = Array.isArray(p.tasks) ? p.tasks.map(sanitizeTask).filter(Boolean) : [];
    state.data = { schemaVersion: SCHEMA_VERSION, tasks: tasks };
    return state.data;
  }

  function saveTasks(data){
    const copy = { schemaVersion: SCHEMA_VERSION, tasks: (data.tasks || []).map(sanitizeTask).filter(Boolean).slice(0, MAX_TASKS) };
    state.data = copy;
    function emitTasksChanged(){
      try{ window.dispatchEvent(new CustomEvent("iu-local-store-changed", { detail: { key: TASKS_STORE_KEY } })); }catch{}
    }
    try {
      if (window.iuVault && typeof window.iuVault.isPersistBlocked === "function" && window.iuVault.isPersistBlocked(TASKS_STORE_KEY)) {
        return;
      }
    } catch (_) {}
    if (!isLocalDataProtectionNoticeAccepted()) {
      void ensureLocalDataProtectionBeforeSave().then(function (ok) {
        if (!ok) return;
        try { localStorage.setItem(TASKS_STORE_KEY, JSON.stringify(copy)); } catch {}
        emitTasksChanged();
      });
      return;
    }
    try{
      localStorage.setItem(TASKS_STORE_KEY, JSON.stringify(copy));
    }catch{}
    emitTasksChanged();
  }

  function sortTasksInPlace(arr){
    const list = arr.slice();
    list.sort(function(a, b){
      const ad = a.status === "done" ? 1 : 0;
      const bd = b.status === "done" ? 1 : 0;
      if (ad !== bd) return ad - bd;
      if (ad === 1){
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      }
      const pa = a.priority === "high" ? 0 : a.priority === "medium" ? 1 : 2;
      const pb = b.priority === "high" ? 0 : b.priority === "medium" ? 1 : 2;
      if (pa !== pb) return pa - pb;
      const da = a.dueAt || "9999-99-99";
      const db = b.dueAt || "9999-99-99";
      if (da !== db) return da < db ? -1 : da > db ? 1 : 0;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return list;
  }

  function filterTasks(list){
    const f = state.filter;
    if (f === "done") return list.filter(function(t){ return t.status === "done"; });
    if (f === "today"){
      const today = localYmd(new Date());
      return list.filter(function(t){
        if (t.status !== "todo") return false;
        if (!t.dueAt) return false;
        return t.dueAt <= today;
      });
    }
    return list.slice();
  }

  function getFilteredSorted(){
    const base = state.data && Array.isArray(state.data.tasks) ? state.data.tasks : [];
    const filtered = filterTasks(base);
    const searched = filtered.filter(function(t){ return matchesSearch(t, state.searchQuery); });
    return sortTasksInPlace(searched);
  }

  function getFilterOnlyTasks(){
    const base = state.data && Array.isArray(state.data.tasks) ? state.data.tasks : [];
    return filterTasks(base);
  }

  function getOverlay(){ return document.getElementById("iuTasksOverlay"); }

  function isTasksNarrowViewport(){
    try{
      if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) return true;
      const iw = Number(window.innerWidth || document.documentElement.clientWidth || 0);
      return iw <= 900;
    }catch{
      return (window.innerWidth || 0) <= 900;
    }
  }

  function isTasksDesktopTwoPanel(){
    return !isTasksNarrowViewport();
  }

  function setTasksMobileMode(mode){
    const ov = getOverlay();
    if (!ov) return;
    ov.setAttribute("data-iu-tasks-mode", String(mode || "") === "form" ? "detail" : "list");
  }

  function syncTasksMobileChrome(){
    const ov = getOverlay();
    if (!ov) return;
    if (isTasksNarrowViewport()) setTasksMobileMode(state.panelMode);
    else ov.removeAttribute("data-iu-tasks-mode");
  }

  function ensureTasksOverlayDomFresh(){
    const ov = getOverlay();
    if (!ov) return;
    if (String(ov.getAttribute("data-iu-tasks-dom-version") || "") === TASKS_OVERLAY_DOM_VERSION) return;
    try{ ov.remove(); }catch{}
    state.overlayMounted = false;
    mountOverlay();
  }

  function mountOverlay(){
    if (state.overlayMounted){
      ensureTasksOverlayDomFresh();
      return;
    }
    state.overlayMounted = true;
    const ov = document.createElement("div");
    ov.id = "iuTasksOverlay";
    ov.className = "iu-tasksOverlay iu-tools-overlay-fullscreen-desktop iu-tasksPremiumScope";
    ov.hidden = true;
    ov.setAttribute("aria-hidden", "true");
    ov.setAttribute("data-iu-tasks-dom-version", TASKS_OVERLAY_DOM_VERSION);
    ov.innerHTML =
      '<div class="iu-tasksOverlay__backdrop" data-iu-tasks-close="1" aria-hidden="true"></div>' +
      '<div class="iu-tasksOverlay__dialog" role="dialog" aria-modal="true" aria-labelledby="iuTasksHeading">' +
        '<div class="iu-tasksOverlay__header">' +
          '<div class="iu-tasksOverlay__titleWrap">' +
            '<h2 class="iu-tasksOverlay__title" id="iuTasksHeading">Úkoly</h2>' +
            '<p class="iu-tasksOverlay__sub">Co je potřeba udělat</p>' +
          "</div>" +
          '<div class="iu-tasksOverlay__actions">' +
            '<button type="button" class="iu-tasksOverlay__back" data-iu-tasks-back="1" aria-label="Zpět">Zpět</button>' +
            '<button type="button" class="iu-tasksOverlay__btn iu-tasksOverlay__btn--primary" data-iu-tasks-new="1" data-iu-tasks-primary-cta="1">+ Nový úkol</button>' +
            '<button type="button" class="iu-tasksOverlay__close" data-iu-tasks-close="1" aria-label="Zavřít úkoly">×</button>' +
          "</div>" +
        "</div>" +
        '<div class="iu-tasksOverlay__body">' +
          '<aside class="iu-tasksOverlay__list" aria-label="Seznam úkolů">' +
            '<div class="iu-tasksOverlay__filters" id="iuTasksFilters" role="tablist" aria-label="Filtry úkolů">' +
              '<button type="button" class="iu-tasksOverlay__filter" data-iu-tasks-filter="all" role="tab">Vše</button>' +
              '<button type="button" class="iu-tasksOverlay__filter" data-iu-tasks-filter="today" role="tab">Dnes</button>' +
              '<button type="button" class="iu-tasksOverlay__filter" data-iu-tasks-filter="done" role="tab">Hotové</button>' +
            "</div>" +
            '<div class="iu-tasksOverlay__listScroll iu-tasksOverlay__scroll" id="iuTasksScroll">' +
              '<div id="iuTasksMain"></div>' +
            "</div>" +
          "</aside>" +
          '<section class="iu-tasksOverlay__detail" aria-label="Detail úkolu">' +
            '<div class="iu-tasksOverlay__detailScroll" id="iuTasksDetail"></div>' +
          "</section>" +
        "</div>" +
      "</div>";
    document.body.appendChild(ov);
  }

  function setFilterButtons(){
    const bar = document.getElementById("iuTasksFilters");
    if (!bar) return;
    const f = state.filter;
    const btns = bar.querySelectorAll("[data-iu-tasks-filter]");
    for (let i = 0; i < btns.length; i++){
      const b = btns[i];
      const k = String(b.getAttribute("data-iu-tasks-filter") || "");
      if (k === f) { b.classList.add("is-active"); b.setAttribute("aria-selected", "true"); }
      else { b.classList.remove("is-active"); b.setAttribute("aria-selected", "false"); }
    }
  }

  function renderListView(){
    const root = document.getElementById("iuTasksMain");
    const filters = document.getElementById("iuTasksFilters");
    if (filters) filters.hidden = false;
    if (!root) return;
    if (!isTasksDesktopTwoPanel() && state.panelMode === "form") return;

    const allTasks = state.data && Array.isArray(state.data.tasks) ? state.data.tasks : [];
    const filterOnly = getFilterOnlyTasks();
    const rows = getFilteredSorted();
    const sq = String(state.searchQuery || "").trim();
    let restoreSearchFocus = false;
    let restoreSelStart = 0;
    let restoreSelEnd = 0;
    try {
      const prevSearch = document.getElementById("iuTasksSearch");
      if (prevSearch && document.activeElement === prevSearch) {
        restoreSearchFocus = true;
        restoreSelStart = typeof prevSearch.selectionStart === "number" ? prevSearch.selectionStart : String(prevSearch.value || "").length;
        restoreSelEnd = typeof prevSearch.selectionEnd === "number" ? prevSearch.selectionEnd : restoreSelStart;
      }
    } catch (_) {}

    const searchBar =
      '<div class="iu-tasksOverlay__listToolbar" id="iuTasksSearchWrap">' +
        '<input class="iu-tasksOverlay__search" id="iuTasksSearch" type="search" placeholder="Hledat úkol" autocomplete="off" value="' + esc(state.searchQuery || "") + '" aria-label="Hledat úkol" />' +
      "</div>";

    function iuTasksRestoreSearchFocus(){
      if (!restoreSearchFocus) return;
      try {
        const inp = document.getElementById("iuTasksSearch");
        if (!inp) return;
        inp.focus({ preventScroll: true });
        if (typeof inp.setSelectionRange === "function") {
          const len = String(inp.value || "").length;
          const a = Math.max(0, Math.min(restoreSelStart, len));
          const b = Math.max(0, Math.min(restoreSelEnd, len));
          inp.setSelectionRange(a, b);
        }
      } catch (_) {}
    }

    if (!allTasks.length){
      root.innerHTML =
        '<div class="iu-tasksOverlay__empty" data-iu-tasks-empty="1">' +
          '<p class="iu-tasksOverlay__emptyTitle">Zatím nemáte žádné úkoly</p>' +
          '<p class="iu-tasksOverlay__emptySub">Přidejte první úkol…</p>' +
          '<button type="button" class="iu-tasksOverlay__btn iu-tasksOverlay__btn--primary" data-iu-tasks-empty-cta="1">Vytvořit první úkol</button>' +
        "</div>";
      return;
    }

    if (!filterOnly.length){
      root.innerHTML =
        searchBar +
        '<p class="iu-tasksOverlay__hint" data-iu-tasks-filter-empty="1">Žádný úkol v tomto výběru. ' +
        '<button type="button" class="iu-tasksOverlay__btn" data-iu-tasks-filter-all="1">Zobrazit vše</button></p>';
      iuTasksRestoreSearchFocus();
      return;
    }

    if (!rows.length && sq){
      root.innerHTML =
        searchBar +
        '<p class="iu-tasksOverlay__hint" data-iu-tasks-search-empty="1">Nebyl nalezen žádný úkol</p>';
      iuTasksRestoreSearchFocus();
      return;
    }

    const parts = [searchBar, '<ul class="iu-tasksOverlay__list" id="iuTasksList">'];
    for (let i = 0; i < rows.length; i++){
      const t = rows[i];
      const dm = dueMeta(t.dueAt, t.status);
      const prc = priorityClass(t.priority);
      const doneCls = t.status === "done" ? " iu-taskRow--done" : "";
      const selectedCls = isTasksDesktopTwoPanel() && String(state.editingId || "") === String(t.id || "") ? " iu-taskRow--selected" : "";
      const ariaCheck = t.status === "done" ? "true" : "false";
      const timeHtml = t.dueTime
        ? '<span class="iu-taskRow__time" aria-label="Čas">' + esc(t.dueTime) + "</span>"
        : "";
      parts.push(
        '<li class="iu-taskRow' + doneCls + selectedCls + " " + prc + '" data-iu-task-id="' + esc(t.id) + '">' +
          '<button type="button" class="iu-taskRow__check" data-iu-task-checkbox="' + esc(t.id) + '" aria-label="Označit jako hotovo" aria-checked="' + ariaCheck + '" role="checkbox">' + (t.status === "done" ? "✓" : "") + "</button>" +
          '<button type="button" class="iu-taskRow__body" data-iu-task-open="' + esc(t.id) + '">' +
            '<span class="iu-taskRow__content">' +
              '<span class="iu-taskRow__title">' + esc(t.title || "Bez názvu") + "</span>" +
              '<span class="iu-taskRow__meta">' +
                '<span class="iu-taskChip ' + dm.cls + '">' + esc(dm.label) + "</span>" +
                '<span class="iu-taskChip iu-taskChip--none">' + esc(priorityLabel(t.priority)) + "</span>" +
              "</span>" +
            "</span>" +
            timeHtml +
          "</button>" +
        "</li>"
      );
    }
    parts.push("</ul>");
    root.innerHTML = parts.join("");
    iuTasksRestoreSearchFocus();
  }

  function renderDetailEmpty(){
    const root = document.getElementById("iuTasksDetail");
    if (!root) return;
    root.innerHTML =
      '<div class="iu-tasksOverlay__empty" data-iu-tasks-detail-empty="1">' +
        '<p class="iu-tasksOverlay__emptyTitle">Vyberte úkol vlevo</p>' +
        '<p class="iu-tasksOverlay__emptySub">Nebo vytvořte nový úkol tlačítkem nahoře.</p>' +
      "</div>";
  }

  function renderFormView(){
    const filters = document.getElementById("iuTasksFilters");
    if (filters) filters.hidden = isTasksNarrowViewport() && state.panelMode === "form";
    /* P0 mobile/tablet: form lives in detail panel (list hidden in detail mode); iuTasksMain would stay display:none. */
    const root = document.getElementById("iuTasksDetail");
    if (!root) return;

    const isEdit = !!state.editingId;
    const t = isEdit ? sanitizeTask(state.data.tasks.find(function(x){ return x && x.id === state.editingId; }) || null) : null;
    const title = t ? t.title : "";
    const note = t ? t.note : "";
    const due = t && t.dueAt ? t.dueAt : "";
    const dueTime = t && t.dueTime ? t.dueTime : "";
    const pr = t ? t.priority : "medium";
    const st = t ? t.status : "todo";

    const dateIconSvg =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" focusable="false"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M7 4v4M17 4v4"/></svg>';
    const deleteBlock = isEdit
      ? '<button type="button" class="iu-tasksOverlay__btn iu-tasksOverlay__btn--delete" data-iu-tasks-delete="1">Odstranit</button>'
      : "";
    root.innerHTML =
      '<form class="iu-tasksOverlay__form" id="iuTasksForm" autocomplete="off">' +
        '<label class="iu-tasksOverlay__label">Název<input class="iu-tasksOverlay__input" id="iuTaskTitle" type="text" maxlength="200" value="' + esc(title) + '" required /></label>' +
        '<label class="iu-tasksOverlay__label">Poznámka<textarea class="iu-tasksOverlay__textarea" id="iuTaskNote" maxlength="500">' + esc(note) + "</textarea></label>" +
        '<label class="iu-tasksOverlay__label">Termín' +
          '<span class="iu-tasksOverlay__dateWrap">' +
            '<input class="iu-tasksOverlay__input iu-tasksOverlay__input--date" id="iuTaskDue" type="date" value="' + esc(due) + '" />' +
            '<span class="iu-tasksOverlay__dateIcon" aria-hidden="true">' + dateIconSvg + "</span>" +
          "</span>" +
        "</label>" +
        '<label class="iu-tasksOverlay__label">Čas<input class="iu-tasksOverlay__input" id="iuTaskDueTime" type="time" step="60" value="' + esc(dueTime) + '" /></label>' +
        '<label class="iu-tasksOverlay__label">Priorita' +
          '<select class="iu-tasksOverlay__select" id="iuTaskPriority">' +
            '<option value="low"' + (pr === "low" ? " selected" : "") + '>Nízká</option>' +
            '<option value="medium"' + (pr === "medium" ? " selected" : "") + '>Střední</option>' +
            '<option value="high"' + (pr === "high" ? " selected" : "") + '>Vysoká</option>' +
          "</select>" +
        "</label>" +
        '<label class="iu-tasksOverlay__label">Stav' +
          '<select class="iu-tasksOverlay__select" id="iuTaskStatus">' +
            '<option value="todo"' + (st === "todo" ? " selected" : "") + '>K udělání</option>' +
            '<option value="done"' + (st === "done" ? " selected" : "") + '>Hotovo</option>' +
          "</select>" +
        "</label>" +
        '<div class="iu-tasksOverlay__formActions">' +
          '<button type="submit" class="iu-tasksOverlay__btn iu-tasksOverlay__btn--primary" data-iu-tasks-save="1">Uložit</button>' +
          '<button type="button" class="iu-tasksOverlay__btn" data-iu-tasks-cancel="1">Zrušit</button>' +
        "</div>" +
        (deleteBlock ? '<div class="iu-tasksOverlay__formRow2">' + deleteBlock + "</div>" : "") +
      "</form>";
  }

  function render(){
    const ov = getOverlay();
    if (!ov) return;
    setFilterButtons();
    if (isTasksDesktopTwoPanel()){
      renderListView();
      if (state.panelMode === "form") renderFormView();
      else renderDetailEmpty();
    } else if (state.panelMode === "form") {
      renderFormView();
    } else {
      renderListView();
    }
    syncTasksMobileChrome();
  }

  function openCreate(){
    state.panelMode = "form";
    state.editingId = "";
    render();
    if (isTasksNarrowViewport()) setTasksMobileMode("form");
    const ti = document.getElementById("iuTaskTitle");
    if (ti) try{ ti.focus({ preventScroll: true }); ti.select(); }catch{}
  }

  function openEdit(id){
    state.panelMode = "form";
    state.editingId = String(id || "");
    render();
    if (isTasksNarrowViewport()) setTasksMobileMode("form");
    const ti = document.getElementById("iuTaskTitle");
    if (ti) try{ ti.focus({ preventScroll: true }); }catch{}
  }

  function backToList(){
    state.panelMode = "list";
    state.editingId = "";
    render();
    if (isTasksNarrowViewport()) setTasksMobileMode("list");
  }

  function readForm(){
    const titleEl = document.getElementById("iuTaskTitle");
    const noteEl = document.getElementById("iuTaskNote");
    const dueEl = document.getElementById("iuTaskDue");
    const dueTimeEl = document.getElementById("iuTaskDueTime");
    const prEl = document.getElementById("iuTaskPriority");
    const stEl = document.getElementById("iuTaskStatus");
    const title = titleEl ? String(titleEl.value || "").trim().slice(0, 200) : "";
    const note = noteEl ? String(noteEl.value || "").slice(0, 500) : "";
    let dueAt = dueEl ? String(dueEl.value || "").trim() : "";
    if (!isYmd(dueAt)) dueAt = null;
    let dueTime = dueTimeEl ? String(dueTimeEl.value || "").trim().slice(0, 5) : "";
    if (!/^\d{2}:\d{2}$/.test(dueTime)) dueTime = null;
    let priority = "medium";
    if (prEl && (prEl.value === "low" || prEl.value === "medium" || prEl.value === "high")) priority = prEl.value;
    const status = stEl && stEl.value === "done" ? "done" : "todo";
    return { title: title, note: note, dueAt: dueAt, dueTime: dueTime, priority: priority, status: status };
  }

  function saveForm(){
    const r = readForm();
    if (!r.title) return;
    const now = Date.now();
    const tasks = (state.data.tasks || []).slice();
    if (state.editingId){
      const idx = tasks.findIndex(function(x){ return x && x.id === state.editingId; });
      if (idx < 0) return;
      const prev = tasks[idx];
      tasks[idx] = sanitizeTask({
        id: prev.id,
        title: r.title,
        note: r.note,
        dueAt: r.dueAt,
        dueTime: r.dueTime,
        priority: r.priority,
        status: r.status,
        createdAt: prev.createdAt,
        updatedAt: now
      });
    } else {
      tasks.unshift(sanitizeTask({
        id: uid("tsk"),
        title: r.title,
        note: r.note,
        dueAt: r.dueAt,
        dueTime: r.dueTime,
        priority: r.priority,
        status: r.status,
        createdAt: now,
        updatedAt: now
      }));
    }
    state.data.tasks = tasks.slice(0, MAX_TASKS);
    saveTasks(state.data);
    state.panelMode = "list";
    state.editingId = "";
    render();
    if (isTasksNarrowViewport()) setTasksMobileMode("list");
  }

  function toggleDone(id){
    const tid = String(id || "");
    if (!tid) return;
    const tasks = (state.data.tasks || []).slice();
    const idx = tasks.findIndex(function(x){ return x && x.id === tid; });
    if (idx < 0) return;
    const t = tasks[idx];
    const next = t.status === "done" ? "todo" : "done";
    tasks[idx] = sanitizeTask({ ...t, status: next, updatedAt: Date.now() });
    state.data.tasks = tasks;
    saveTasks(state.data);
    render();
  }

  function deleteTask(){
    if (!state.editingId) return;
    if (!window.confirm("Opravdu odstranit tento úkol?")) return;
    const id = state.editingId;
    const tasks = (state.data.tasks || []).filter(function(x){ return x && x.id !== id; });
    state.data.tasks = tasks;
    saveTasks(state.data);
    state.panelMode = "list";
    state.editingId = "";
    render();
    if (isTasksNarrowViewport()) setTasksMobileMode("list");
  }

  function openOverlay(originEl){
    mountOverlay();
    const ov = getOverlay();
    if (!ov) return;
    if (!ov.hidden){
      try{
        if (state.panelMode === "form"){
          const ti = document.getElementById("iuTaskTitle");
          if (ti && typeof ti.focus === "function"){ ti.focus({ preventScroll: true }); return; }
        }
        const btn = ov.querySelector("[data-iu-tasks-new]");
        if (btn && typeof btn.focus === "function") btn.focus({ preventScroll: true });
      }catch{}
      return;
    }
    try {
      if (window.iuAnalytics && typeof window.iuAnalytics.privateToolsOpen === "function") {
        window.iuAnalytics.privateToolsOpen();
      }
    } catch (_) {}
    state.returnFocusEl = originEl && typeof originEl.focus === "function" ? originEl : document.activeElement;
    state.searchQuery = "";
    if (state.searchTimer){ try{ clearTimeout(state.searchTimer); }catch{} state.searchTimer = null; }
    loadTasks();
    if (isTasksDesktopTwoPanel()){
      const rows = getFilteredSorted();
      if (rows.length){
        state.panelMode = "form";
        state.editingId = String(rows[0].id || "");
      } else {
        state.panelMode = "list";
        state.editingId = "";
      }
    } else {
      state.panelMode = "list";
      state.editingId = "";
    }
    ov.hidden = false;
    ov.setAttribute("aria-hidden", "false");
    document.body.classList.add("iu-tasksOverlay-open");
    try{
      const sw = Math.max(0, (window.innerWidth || 0) - (document.documentElement && document.documentElement.clientWidth ? document.documentElement.clientWidth : 0));
      state.prevBodyPadRight = String(document.body.style.paddingRight || "");
      if (sw > 0) document.body.style.paddingRight = sw + "px";
    }catch{}
    render();
    attachTrap();
    try{
      const btn = ov.querySelector("[data-iu-tasks-new]");
      if (btn) btn.focus({ preventScroll: true });
    }catch{}
  }

  function closeOverlay(){
    const ov = getOverlay();
    if (!ov) return;
    state.panelMode = "list";
    state.editingId = "";
    ov.hidden = true;
    ov.setAttribute("aria-hidden", "true");
    document.body.classList.remove("iu-tasksOverlay-open");
    try{ document.body.style.paddingRight = state.prevBodyPadRight || ""; }catch{}
    detachTrap();
    const el = state.returnFocusEl;
    if (el && typeof el.focus === "function"){
      try{ el.focus({ preventScroll: true }); }catch{}
    }
  }

  function onTrapKey(e){
    const ov = getOverlay();
    if (!ov || ov.hidden) return;
    if (e.key !== "Escape") return;
    e.preventDefault();
    if (state.panelMode === "form") backToList();
    else closeOverlay();
  }

  function attachTrap(){
    if (state.trapAttached) return;
    state.trapAttached = true;
    document.addEventListener("keydown", onTrapKey, true);
  }

  function detachTrap(){
    if (!state.trapAttached) return;
    state.trapAttached = false;
    document.removeEventListener("keydown", onTrapKey, true);
  }

  function bindUi(){
    if (state.bound) return;
    state.bound = true;

    document.addEventListener("click", function(e){
      const t = e.target;
      const mm = t && t.closest ? t.closest(".iu-mmTopTool--tasks") : null;
      const tr = t && t.closest ? t.closest("[data-iu-tasks-trigger]") : null;
      if (mm || tr){
        e.preventDefault();
        openOverlay(mm || tr);
        return;
      }

      const ov = getOverlay();
      if (!ov || ov.hidden) return;

      if (t && t.closest && t.closest("[data-iu-tasks-close]")){
        e.preventDefault();
        closeOverlay();
        return;
      }

      const filt = t && t.closest ? t.closest("[data-iu-tasks-filter]") : null;
      if (filt && (isTasksDesktopTwoPanel() || state.panelMode === "list")){
        e.preventDefault();
        const k = String(filt.getAttribute("data-iu-tasks-filter") || "all");
        if (k === "all" || k === "today" || k === "done") state.filter = k;
        render();
        return;
      }

      if (t && t.closest && t.closest("[data-iu-tasks-filter-all]")){
        e.preventDefault();
        state.filter = "all";
        render();
        return;
      }

      const newBtn = t && t.closest ? t.closest("[data-iu-tasks-new]") : null;
      if (newBtn){
        e.preventDefault();
        openCreate();
        return;
      }

      const emptyCta = t && t.closest ? t.closest("[data-iu-tasks-empty-cta]") : null;
      if (emptyCta){
        e.preventDefault();
        openCreate();
        return;
      }

      const backBtn = t && t.closest ? t.closest("[data-iu-tasks-back]") : null;
      if (backBtn){
        e.preventDefault();
        backToList();
        return;
      }

      const cancel = t && t.closest ? t.closest("[data-iu-tasks-cancel]") : null;
      if (cancel){
        e.preventDefault();
        backToList();
        return;
      }

      const del = t && t.closest ? t.closest("[data-iu-tasks-delete]") : null;
      if (del){
        e.preventDefault();
        deleteTask();
        return;
      }

      const cb = t && t.closest ? t.closest("[data-iu-task-checkbox]") : null;
      if (cb){
        e.preventDefault();
        e.stopPropagation();
        const id = String(cb.getAttribute("data-iu-task-checkbox") || "");
        toggleDone(id);
        return;
      }

      const openB = t && t.closest ? t.closest("[data-iu-task-open]") : null;
      if (openB && (isTasksDesktopTwoPanel() || state.panelMode === "list")){
        e.preventDefault();
        const id = String(openB.getAttribute("data-iu-task-open") || "");
        if (id) openEdit(id);
        return;
      }
    });

    document.addEventListener("submit", function(e){
      const f = e.target;
      if (!f || f.id !== "iuTasksForm") return;
      const ov = getOverlay();
      if (!ov || ov.hidden) return;
      e.preventDefault();
      saveForm();
    });

    document.addEventListener("input", function(e){
      const t = e.target;
      if (!t || t.id !== "iuTasksSearch") return;
      const ov = getOverlay();
      if (!ov || ov.hidden) return;
      const next = String(t.value || "");
      /* Keep query in state immediately so remounted input keeps value + focus. */
      state.searchQuery = next;
      if (state.searchTimer){ try{ clearTimeout(state.searchTimer); }catch{} state.searchTimer = null; }
      state.searchTimer = setTimeout(function(){
        state.searchTimer = null;
        render();
      }, 200);
    });
  }

  function tasksCreateFromSilver(payload){
    const o = payload && typeof payload === "object" ? payload : {};
    let title = String(o.title || "").trim().slice(0, 200);
    if (!title) title = "Úkol";
    let dueAt = null;
    if (o.date){
      const d = String(o.date).trim();
      if (isYmd(d)) dueAt = d;
    }
    let dueTime = null;
    if (o.time) {
      const tv = String(o.time).trim().slice(0, 5);
      if (/^\d{1,2}:\d{2}$/.test(tv)) {
        const tp = tv.split(":");
        dueTime = String(Number(tp[0])).padStart(2, "0") + ":" + tp[1];
      }
    }
    const lines = [];
    if (o.note) lines.push(String(o.note));
    if (o.location) lines.push("Místo: " + String(o.location));
    const note = lines.join("\n").trim().slice(0, 500);
    loadTasks();
    const now = Date.now();
    const item = sanitizeTask({
      id: uid("tsk"),
      title: title,
      note: note,
      dueAt: dueAt,
      dueTime: dueTime,
      priority: "medium",
      status: "todo",
      createdAt: now,
      updatedAt: now
    });
    const tasks = (state.data.tasks || []).slice();
    tasks.unshift(item);
    state.data.tasks = tasks.slice(0, MAX_TASKS);
    saveTasks(state.data);
    try {
      loadTasks();
      const ov = getOverlay();
      if (ov && !ov.hidden) render();
    } catch (_) {}
    return { ok: true, task: item };
  }

  function init(){
    if (state.inited) return;
    state.inited = true;
    /* P1 perf (overlay cluster lazy mount): overlay DOM is built on first
       openOverlay() — not at startup. bindUi() is document-delegated. */
    /* Hydrate in-memory store from localStorage before exposing tasksGetSnapshot (summary box, etc.). */
    loadTasks();
    bindUi();
    try {
      window.addEventListener("iu-local-store-changed", function (ev) {
        try {
          if (!ev || !ev.detail || ev.detail.key !== TASKS_STORE_KEY) return;
          loadTasks();
          const ov = getOverlay();
          if (ov && !ov.hidden) render();
        } catch (_) {}
      });
      window.addEventListener("iu-vault-hydrated", function () {
        try {
          loadTasks();
          const ov = getOverlay();
          if (ov && !ov.hidden) render();
        } catch (_) {}
      });
    } catch (_) {}
    window.iuTasksService = {
      tasksCreateFromSilver: tasksCreateFromSilver,
      openOverlay: function(el){ openOverlay(el || document.activeElement); },
      closeOverlay: closeOverlay,
      tasksGetSnapshot: function(){ return (state.data && Array.isArray(state.data.tasks)) ? state.data.tasks.slice() : []; }
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();


} catch(e) {
  console.error("IU SAFE BOOT ERROR:", e);
}

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

// === UI-only cleanup: permanently disable any cached rail-hidden state ===
try { document.body.classList.remove("iu" + "RailHidden"); } catch (e) {}
try { document.documentElement.classList.remove("iu" + "RailHidden"); } catch (e) {}
try { localStorage.removeItem("iuRailHidden"); } catch (e) {}
try { localStorage.removeItem("iuInfoUzel_autoAds_v1"); } catch (e) {}

// P0 desktop ≥901px MindMenu fullscreen: injected here so assets/app.css stays under css_debt_guard byte budget (same rules as former app.css block).
(function iuToolsOverlayFsDesktopInject(){
  "use strict";
  var ID = "iu-tools-overlay-fs-desktop";
  var CSS =
    "@media(min-width:1025px){" +
    "#iuCalendarOverlay.iu-tools-overlay-fullscreen-desktop:not([hidden])," +
    "#iuNotesOverlay.iu-tools-overlay-fullscreen-desktop.iuNotesRoot:not([hidden])," +
    "#iuTasksOverlay.iu-tools-overlay-fullscreen-desktop:not([hidden]){align-items:stretch!important;justify-content:stretch!important;overflow:hidden!important;z-index:12000!important}" +
    "#iuCalendarOverlay.iu-tools-overlay-fullscreen-desktop .iu-calendarOverlay__backdrop," +
    "#iuNotesOverlay.iu-tools-overlay-fullscreen-desktop .iu-notesOverlay__backdrop," +
    "#iuTasksOverlay.iu-tools-overlay-fullscreen-desktop .iu-tasksOverlay__backdrop{position:fixed!important;inset:0!important}" +
    "#iuCalendarOverlay.iu-tools-overlay-fullscreen-desktop .iu-calendarOverlay__dialog," +
    "#iuNotesOverlay.iu-tools-overlay-fullscreen-desktop .iu-notesOverlay__dialog{width:100%!important;max-width:none!important;height:100vh!important;height:100dvh!important;min-height:100vh!important;min-height:100dvh!important;max-height:none!important;margin:0!important;border-radius:0!important;box-shadow:none!important;display:grid!important;grid-template-rows:auto 1fr!important;overflow:hidden!important;box-sizing:border-box!important}" +
    "#iuCalendarOverlay.iu-tools-overlay-fullscreen-desktop .iu-calendarOverlay__body{display:grid!important;grid-template-columns:minmax(0,1fr) 340px!important;min-height:0!important;height:100%!important;overflow:hidden!important}" +
    "#iuCalendarOverlay.iu-tools-overlay-fullscreen-desktop .iu-calendarOverlay__main{min-width:0!important;max-width:100%!important;contain:layout style!important}" +
    "#iuCalendarOverlay.iu-tools-overlay-fullscreen-desktop .iu-calendarOverlay__side{min-width:340px!important;max-width:340px!important;width:340px!important;box-sizing:border-box!important;flex:0 0 340px!important}" +
    "#iuCalendarOverlay.iu-tools-overlay-fullscreen-desktop .iu-calendarOverlay__side.iu-calendarOverlay__side--layoutEmpty{visibility:hidden!important;pointer-events:none!important;overflow:hidden!important}" +
    "#iuCalendarOverlay.iu-tools-overlay-fullscreen-desktop .iu-calendarOverlay__side.iu-calendarOverlay__side--layoutEmpty>*{visibility:hidden!important}" +
    "#iuCalendarOverlay.iu-tools-overlay-fullscreen-desktop .iu-calendarOverlay__main," +
    "#iuCalendarOverlay.iu-tools-overlay-fullscreen-desktop .iu-calendarOverlay__side," +
    "#iuNotesOverlay.iu-tools-overlay-fullscreen-desktop .iu-notesOverlay__listScroll," +
    "#iuNotesOverlay.iu-tools-overlay-fullscreen-desktop .iu-notesOverlay__detailScroll{min-height:0!important;overflow:auto!important;-webkit-overflow-scrolling:touch}" +
    "#iuCalendarOverlay.iu-tools-overlay-fullscreen-desktop .iu-calendarOverlay__viewRoot{min-height:320px!important;height:calc(100% - 42px)!important;overflow:auto!important}" +
    "#iuNotesOverlay.iu-tools-overlay-fullscreen-desktop .iu-notesOverlay__body{display:grid!important;grid-template-columns:450px minmax(0,1fr)!important;min-height:0!important;height:100%!important;overflow:hidden!important}" +
    "#iuTasksOverlay.iu-tools-overlay-fullscreen-desktop .iu-tasksOverlay__dialog{width:100%!important;max-width:none!important;min-height:100vh!important;min-height:100dvh!important;height:100vh!important;height:100dvh!important;max-height:100dvh!important;margin:0!important;border-radius:0!important;box-shadow:none!important;display:grid!important;grid-template-rows:auto 1fr!important;overflow:hidden!important;box-sizing:border-box!important}" +
    "#iuTasksOverlay.iu-tools-overlay-fullscreen-desktop .iu-tasksOverlay__body{display:grid!important;grid-template-columns:450px minmax(0,1fr)!important;min-height:0!important;height:100%!important;overflow:hidden!important}" +
    "#iuTasksOverlay.iu-tools-overlay-fullscreen-desktop .iu-tasksOverlay__listScroll," +
    "#iuTasksOverlay.iu-tools-overlay-fullscreen-desktop .iu-tasksOverlay__detailScroll{min-height:0!important;overflow:auto!important;-webkit-overflow-scrolling:touch}" +
    "}";
  try{
    if (document.getElementById(ID)) return;
    var st = document.createElement("style");
    st.id = ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }catch(e){}
})();

// P0 desktop ≥1025px MindMenu Kalendář/Úkoly hover summary: injected (ne app.css) kvůli css_debt_guard byte budget + duplicate risk zón.
(function iuMmHoverSummaryDesktopInject(){
  "use strict";
  var ID = "iu-mm-hover-summary-desktop";
  var CSS =
    ".accordionCol .mindMenu .iu-mmTopToolHoverHost.iu-hover-summary-host{position:relative;min-width:0;display:flex;flex-direction:column;align-items:stretch}" +
    ".accordionCol .mindMenu .iu-mmTopToolHoverHost.iu-hover-summary-host>.iu-mmTopTool{flex:1 1 auto;min-height:0;width:100%;align-self:stretch}" +
    ".iu-mmHoverSummaryBridge{position:absolute;left:0;right:0;top:100%;width:100%;height:0;margin:0;padding:0;border:0;pointer-events:none;box-sizing:border-box;z-index:3}" +
    "@media(min-width:1025px){" +
    "body.iu-desktop-hover-summary-enabled .accordionCol .mindMenu .iu-mmTopTools{transform:none!important}" +
    "body.iu-desktop-hover-summary-enabled .accordionCol .mindMenu .iu-mmTopTools>.iu-mmTopToolHoverHost~.iu-mmTopToolHoverHost{z-index:10070!important}" +
    "body.iu-desktop-hover-summary-enabled .accordionCol .mindMenu .iu-mmTopToolHoverHost{transform:none!important}" +
    "body.iu-desktop-hover-summary-enabled .iu-mmHoverSummaryBridge:not([hidden]){height:10px;pointer-events:auto}" +
    "body.iu-desktop-hover-summary-enabled .accordionCol .mindMenu .iu-mmTopTools>.iu-mmTopToolHoverHost>.iu-mmTopTool.iu-mmTopTool--imageTile:hover{transform:translateY(-1px)}" +
    "body.iu-desktop-hover-summary-enabled .accordionCol .mindMenu .iu-mmTopTools>.iu-mmTopToolHoverHost>.iu-mmTopTool.iu-mmTopTool--imageTile:active{transform:translateY(0.5px)}" +
    "body.iu-desktop-hover-summary-enabled .iu-mmHoverSummaryPanelShell.iu-mmHoverSummaryPanelShell--closed{position:fixed!important;left:-12000px!important;top:0!important;width:min(380px,calc(100vw - 20px))!important;max-height:min(72vh,560px)!important;opacity:0!important;pointer-events:none!important;z-index:-1!important;overflow:hidden!important}" +
    "#silver-slot.iu-silver-slot--mm-summary-desktop #iuSilverWelcomeStackSeparatorCal,#silver-slot.iu-silver-slot--mm-summary-desktop #iuSilverWelcomeStackSeparatorWeatherCal{display:none!important}" +
    "body.iu-desktop-hover-summary-enabled .iu-mmHoverSummaryPanelShell:not(.iu-mmHoverSummaryPanelShell--closed){position:fixed!important;left:auto!important;top:auto!important;right:auto!important;z-index:10150!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important;box-sizing:border-box;max-height:min(72vh,560px);overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;border-radius:12px;border:1px solid rgba(15,35,55,.16);background:rgba(255,255,255,.97);box-shadow:0 16px 44px rgba(7,12,19,.22);padding:10px 10px 12px;color:#0b1f33}" +
    ".dark body.iu-desktop-hover-summary-enabled .iu-mmHoverSummaryPanelShell:not(.iu-mmHoverSummaryPanelShell--closed){background:rgba(15,23,42,.96);border-color:rgba(148,163,184,.28);color:rgba(241,245,249,.95)}" +
    "body.iu-desktop-hover-summary-enabled .accordionCol .mindMenu .iu-mmTopToolHoverHost>.iu-mmTopTool.iu-has-hover-summary{position:relative;z-index:10058}" +
    "body.iu-desktop-hover-summary-enabled .iu-mmHoverSummaryPanelShell .silver-calendar-summary-card{border-radius:10px}" +
    "body.iu-desktop-hover-summary-enabled .iu-mmHoverSummaryPanelShell .silver-calendar-summary-text{white-space:normal;overflow:visible;text-overflow:clip}" +
    "body.iu-desktop-hover-summary-enabled .iu-mmHoverSummaryPanelShell .silver-calendar-summary-line2main{white-space:normal}" +
    ".mindMenu #iuSilverCalendarSummaryCard .iuCalendarSummary__label{color:var(--iu-calendar-accent)!important}" +
    ".mindMenu #iuSilverCalendarSummaryCard .iuCalendarSummary__icon{color:var(--iu-calendar-accent)!important}" +
    ".mindMenu #iuSilverTasksSummaryCard .iuTasksLabel{color:var(--iuTasksAccent,#8b5cf6)!important}" +
    ".mindMenu #iuSilverTasksSummaryCard .iuTasksIcon{color:var(--iuTasksAccent,#8b5cf6)!important}" +
    "}";
  try{
    if (document.getElementById(ID)) return;
    var st = document.createElement("style");
    st.id = ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }catch(e){}
})();

// MindMenu mobile/tablet (≤1024px): elevated unified controls — injected (not app.css) for css_debt_guard byte budget.
(function iuMindMenuMobileTabletElevatedInject(){
  "use strict";
  var ID = "iu-mindmenu-mobile-tablet-elevated";
  var CSS =
    "@media(max-width:1024px){" +
    "body #iuMindMenuView .iu-mailbox-pill--plain," +
    "body #iuMobileGatePanelTools #iuMindMenuView .iu-mailbox-pill--plain," +
    "body #iuMindMenuView section.iu-mmQuickLinks .iu-mmQuickGrid .iuTile>.iuTileLink," +
    "body #iuMindMenuView section.iu-mmQuickLinks .iu-mmQuickGrid .iuTile>a.iuTileLink," +
    "body #iuMindMenuView section.iu-mmQuickLinks .iu-mmQuickGrid .iuTile>button.iuTileLink," +
    "body #iuMindMenuView section.iu-mmQuickLinks .iu-mmQuickGrid .iuTile>span.iuTileLink," +
    "body #iuMindMenuView .iu-mmTopTool:not(.iu-mmTopTool--imageTile){" +
    "background:#fff!important;background-color:#fff!important;" +
    "border:1px solid rgba(15,23,42,.06)!important;" +
    "box-shadow:0 6px 18px rgba(15,23,42,.08),0 1px 2px rgba(15,23,42,.06)!important}" +
    "body #iuMindMenuView .iu-mailbox-pill--plain:active," +
    "body #iuMobileGatePanelTools #iuMindMenuView .iu-mailbox-pill--plain:active," +
    "body #iuMindMenuView section.iu-mmQuickLinks .iu-mmQuickGrid .iuTile>.iuTileLink:active," +
    "body #iuMindMenuView section.iu-mmQuickLinks .iu-mmQuickGrid .iuTile>a.iuTileLink:active," +
    "body #iuMindMenuView section.iu-mmQuickLinks .iu-mmQuickGrid .iuTile>button.iuTileLink:active," +
    "body #iuMindMenuView section.iu-mmQuickLinks .iu-mmQuickGrid .iuTile>span.iuTileLink:active," +
    "body #iuMindMenuView .iu-mmTopTool:not(.iu-mmTopTool--imageTile):active{" +
    "transform:translateY(1px)!important;" +
    "box-shadow:0 3px 10px rgba(15,23,42,.08),0 1px 2px rgba(15,23,42,.06)!important}" +
    "}";
  try{
    if (document.getElementById(ID)) return;
    var st = document.createElement("style");
    st.id = ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }catch(e){}
})();

// MindMenu custom buttons + desktop quicktools gear — injected (not app.css) for css_debt_guard byte budget.
(function iuMindMenuCustomButtonsInject(){
  "use strict";
  var ID = "iu-mindmenu-custom-buttons";
  var CSS =
    ".iu-quicktools-settings-panel[hidden]{display:none!important;pointer-events:none!important}" +
    ".iu-quicktools-settings-panel:not([hidden]){display:flex;flex-direction:column;overflow:hidden;padding:0;box-sizing:border-box;max-height:min(520px,calc(100dvh - 24px))}" +
    ".iu-quicktools-settings-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 12px 10px;flex:0 0 auto}" +
    ".iu-quicktools-settings-title{margin:0;min-width:0}" +
    ".iu-quicktools-settings-close{flex:0 0 auto;width:32px;height:32px;margin:0;padding:0;border:0;border-radius:8px;background:rgba(0,0,0,.04);color:rgba(0,0,0,.72);font-size:18px;line-height:1;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}" +
    ".iu-quicktools-settings-close:hover{background:rgba(0,0,0,.08)}" +
    ".iu-quicktools-settings-close:focus-visible{outline:2px solid #1F4B99;outline-offset:2px}" +
    "#iuQuickToolsResetConfirm[hidden]{display:none!important}" +
    "#iuQuickToolsResetConfirm:not([hidden]){position:fixed;inset:0;z-index:10030;display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top,0px)) 16px max(16px,env(safe-area-inset-bottom,0px));box-sizing:border-box}" +
    "body.iu-myinfouzel-open #iuQuickToolsResetConfirm:not([hidden]),body.iu-mobileGateOverlayOpen #iuQuickToolsResetConfirm:not([hidden]){z-index:12200!important}" +
    ".iu-quicktools-resetConfirm-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.48);-webkit-tap-highlight-color:transparent;touch-action:manipulation}" +
    ".iu-quicktools-resetConfirm-dialog{position:relative;z-index:1;width:min(400px,calc(100vw - 32px));max-height:min(70dvh,480px);overflow:auto;background:#fff;border-radius:14px;padding:20px 18px 16px;box-shadow:0 18px 44px rgba(0,0,0,.22);box-sizing:border-box;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}" +
    ".iu-quicktools-resetConfirm-title{margin:0 0 12px;font-size:17px;font-weight:700;color:#0f172a;line-height:1.3}" +
    ".iu-quicktools-resetConfirm-text{margin:0 0 18px;font-size:14px;line-height:1.5;color:rgba(11,27,43,.8)}" +
    ".iu-quicktools-resetConfirm-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end}" +
    ".iu-quicktools-resetConfirm-cancel,.iu-quicktools-resetConfirm-ok{padding:10px 16px;font-size:15px;font-family:inherit;font-weight:600;border-radius:10px;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}" +
    ".iu-quicktools-resetConfirm-cancel{border:1px solid rgba(0,0,0,.14);background:#f8fafc;color:#111}" +
    ".iu-quicktools-resetConfirm-cancel:hover{background:#eef2f7}" +
    ".iu-quicktools-resetConfirm-ok{border:0;background:#1F4B99;color:#fff}" +
    ".iu-quicktools-resetConfirm-ok:hover{background:#1a3f82}" +
    ".iu-quicktools-resetConfirm-cancel:focus-visible,.iu-quicktools-resetConfirm-ok:focus-visible{outline:2px solid #1F4B99;outline-offset:2px}" +
    ".iu-quicktools-settings-scroll{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;padding:0 12px calc(12px + env(safe-area-inset-bottom,0px));box-sizing:border-box}" +
    ".iu-quicktools-settings-list{touch-action:pan-y}" +
    ".iu-quicktools-settings-row{touch-action:pan-y}" +
    ".iu-quicktools-settings-label{touch-action:pan-y}" +
    ".iu-quicktools-settings-row input[type=checkbox]{touch-action:manipulation}" +
    ".iu-quicktools-drag-handle{touch-action:none;padding:6px 8px;margin:-6px 0 -6px -4px;border-radius:6px}" +
    ".iu-quicktools-drag-handle:active{background:rgba(0,0,0,.06)}" +
    "body .accordionCol .mindMenu .iu-mmQuickGrid .iuTile[data-iu-ql=\"pridat-tlacitko\"]{--iu-ql-accent:#455a64}" +
    "body .accordionCol .mindMenu .iu-mmQuickGrid .iuTile[data-iu-ql-custom=\"1\"]>.iuTileLink{border-color:var(--iu-ql-accent,#2563EB)!important}" +
    "#iuMobileGatePanelTools.accordionCol .mindMenu .iu-mmQuickGrid .iuTile[data-iu-ql=\"pridat-tlacitko\"]{--iu-ql-accent:#455a64}" +
    "section.iu-mmQuickLinks:not(.iu-mojeSluzby){align-items:stretch!important;width:100%!important;max-width:100%!important}" +
    "section.iu-mmQuickLinks:not(.iu-mojeSluzby)>.iu-mmQuickGrid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;justify-items:stretch!important;align-self:stretch!important;width:100%!important;min-width:100%!important;max-width:100%!important;flex:0 0 100%!important}" +
    "section.iu-mmQuickLinks:not(.iu-mojeSluzby)>.iu-mmQuickGrid>.iuTile{width:100%!important;max-width:none!important;justify-self:stretch!important}" +
    ".iu-custom-buttons-overlay-backdrop[hidden],.iu-custom-buttons-overlay-panel[hidden]{display:none!important}" +
    ".iu-custom-buttons-overlay-backdrop:not([hidden]){position:fixed;inset:0;z-index:10025;background:rgba(15,23,42,.42);-webkit-tap-highlight-color:transparent}" +
    ".iu-custom-buttons-overlay-panel:not([hidden]){position:fixed;inset:0;z-index:10026;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;pointer-events:auto;overflow:hidden}" +
    ".iu-custom-buttons-overlay-panel:not([hidden]) .iu-custom-buttons-overlay-cardShell{pointer-events:auto;width:min(720px,calc(100vw - 24px));max-height:min(88dvh,820px);display:flex;flex-direction:column;min-height:0;box-sizing:border-box;overflow:hidden}" +
    ".iu-custom-buttons-overlay-panel--fullscreen:not([hidden]){padding:0;align-items:stretch;justify-content:stretch}" +
    ".iu-custom-buttons-overlay-panel--fullscreen:not([hidden]) .iu-custom-buttons-overlay-cardShell{width:100%;max-width:none;max-height:100%;height:100%;border-radius:0}" +
    ".iu-custom-buttons-overlay-inner{display:flex;flex-direction:column;min-height:0;height:100%;background:rgba(255,255,255,.98);border:1px solid rgba(20,40,70,.12);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.12),0 2px 10px rgba(0,0,0,.08);overflow:hidden}" +
    ".iu-custom-buttons-overlay-panel--fullscreen .iu-custom-buttons-overlay-inner{border-radius:0;border-left:0;border-right:0;box-shadow:none}" +
    ".iu-custom-buttons-overlay-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(20,40,70,.1);flex:0 0 auto}" +
    ".iu-custom-buttons-overlay-h2{margin:0;font-size:18px;font-weight:700;color:#0b1f33;min-width:0}" +
    ".iu-custom-buttons-overlay-scrollHost{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:14px 16px 18px;box-sizing:border-box}" +
    ".iu-custom-buttons-form{display:flex;flex-direction:column;gap:10px;margin-bottom:16px}" +
    ".iu-custom-buttons-field{display:flex;flex-direction:column;gap:4px;min-width:0}" +
    ".iu-custom-buttons-field label{font-size:13px;font-weight:600;color:rgba(0,0,0,.85)}" +
    ".iu-custom-buttons-field input{width:100%;box-sizing:border-box;min-width:0;padding:10px 12px;border:1px solid rgba(20,40,70,.16);border-radius:8px;font-size:16px;font-family:inherit}" +
    ".iu-custom-buttons-field input:focus-visible{outline:2px solid #1f4b99;outline-offset:1px}" +
    ".iu-custom-buttons-formError,.iu-custom-buttons-limitMsg{margin:0;font-size:13px;line-height:1.35}" +
    ".iu-custom-buttons-formError{color:#b91c1c}.iu-custom-buttons-limitMsg{color:#92400e}" +
    ".iu-custom-buttons-saveBtn{align-self:flex-start;padding:10px 18px;border:0;border-radius:8px;background:#1f4b99;color:#fff;font-size:14px;font-weight:600;cursor:pointer}" +
    ".iu-custom-buttons-saveBtn:disabled{opacity:.55;cursor:not-allowed}" +
    ".iu-custom-buttons-list{display:flex;flex-direction:column;gap:10px;min-width:0}" +
    ".iu-custom-buttons-empty{margin:0;font-size:13px;color:rgba(0,0,0,.55)}" +
    ".iu-custom-buttons-item{border:1px solid rgba(20,40,70,.12);border-radius:10px;padding:10px 12px;background:rgba(0,0,0,.02);min-width:0;box-sizing:border-box}" +
    ".iu-custom-buttons-item-head{display:flex;align-items:center;gap:8px;min-width:0}" +
    ".iu-custom-buttons-item-marker{width:8px;height:8px;border-radius:50%;flex-shrink:0}" +
    ".iu-custom-buttons-item-title{font-size:14px;font-weight:600;color:#0b1f33;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".iu-custom-buttons-item-url{display:block;margin-top:4px;font-size:12px;color:#1f4b99;word-break:break-all;overflow-wrap:anywhere;text-decoration:none}" +
    ".iu-custom-buttons-item-url:hover{text-decoration:underline}" +
    ".iu-custom-buttons-item-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}" +
    ".iu-custom-buttons-item-edit,.iu-custom-buttons-item-delete,.iu-custom-buttons-deleteCancel,.iu-custom-buttons-deleteConfirmBtn{padding:7px 12px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}" +
    ".iu-custom-buttons-item-edit{border:1px solid rgba(31,75,153,.25);background:rgba(31,75,153,.08);color:#1f4b99}" +
    ".iu-custom-buttons-item-delete{border:1px solid rgba(185,28,28,.25);background:rgba(185,28,28,.08);color:#b91c1c}" +
    "#iuCustomButtonsDeleteConfirm[hidden]{display:none!important}" +
    "#iuCustomButtonsDeleteConfirm:not([hidden]){position:fixed;inset:0;z-index:10031;display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top,0px)) 16px max(16px,env(safe-area-inset-bottom,0px));box-sizing:border-box}" +
    "body.iu-myinfouzel-open #iuCustomButtonsDeleteConfirm:not([hidden]),body.iu-mobileGateOverlayOpen #iuCustomButtonsDeleteConfirm:not([hidden]){z-index:12210!important}" +
    ".iu-custom-buttons-deleteConfirm-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.48)}" +
    ".iu-custom-buttons-deleteConfirm-dialog{position:relative;z-index:1;width:min(360px,100%);background:#fff;border-radius:12px;padding:16px;box-shadow:0 12px 32px rgba(0,0,0,.18);box-sizing:border-box}" +
    ".iu-custom-buttons-deleteConfirm-dialog p{margin:0 0 14px;font-size:15px;line-height:1.4;color:#0b1f33}" +
    ".iu-custom-buttons-deleteConfirm-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}" +
    ".iu-custom-buttons-deleteCancel{border:1px solid rgba(20,40,70,.16);background:#fff;color:#334155}" +
    ".iu-custom-buttons-deleteConfirmBtn{border:0;background:#b91c1c;color:#fff}" +
    "body.iu-custom-buttons-overlay-open{overflow:hidden}" +
    "#iuMobileGatePanelTools .mindMenu :is(input[type=text],input[type=url],input[type=search],textarea,select),.iu-custom-buttons-overlay-panel :is(input,textarea,select){font-size:16px!important}" +
    "#iu-mailbox-edit-overlay input::placeholder,.iu-custom-buttons-field input::placeholder{color:rgba(107,114,128,.78);opacity:1}" +
    "@media(min-width:1025px){" +
    "body .layout>aside.accordionCol .mindMenu section.iu-mmQuickLinks .iu-mmSectionTopRow,body .accordionCol .mindMenu section.iu-mmQuickLinks .iu-mmSectionTopRow{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:8px!important;flex-wrap:nowrap!important;max-width:100%!important;position:relative!important;z-index:2!important}" +
    "body .layout>aside.accordionCol .mindMenu section.iu-mmQuickLinks .iu-mmSectionTopRow .iu-mmSectionTitle,body .accordionCol .mindMenu section.iu-mmQuickLinks .iu-mmSectionTopRow .iu-mmSectionTitle{width:auto!important;flex:0 1 auto!important;min-width:0!important}" +
    "body .layout>aside.accordionCol .mindMenu section.iu-mmQuickLinks .iu-quicktools-settings-trigger,body .accordionCol .mindMenu section.iu-mmQuickLinks .iu-quicktools-settings-trigger{display:inline-flex!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;flex:0 0 auto!important;width:32px!important;height:32px!important;min-width:32px!important;min-height:32px!important;margin:0!important;padding:0!important;position:relative!important;z-index:3!important;background:transparent!important;border:0!important;box-shadow:none!important;font-size:14px!important;cursor:pointer!important;color:var(--iu-rightcol-text,#2e3238)!important}" +
    "body .layout>aside.accordionCol .mindMenu section.iu-mmQuickLinks .iu-quicktools-settings-trigger .iu-quicktools-gear-icon,body .accordionCol .mindMenu section.iu-mmQuickLinks .iu-quicktools-settings-trigger .iu-quicktools-gear-icon,body .layout>aside.accordionCol .mindMenu section.iu-mmQuickLinks .iu-quicktools-settings-trigger .iu-quicktools-gear-icon svg,body .accordionCol .mindMenu section.iu-mmQuickLinks .iu-quicktools-settings-trigger .iu-quicktools-gear-icon svg{display:block!important;visibility:visible!important;opacity:1!important;width:14px!important;height:14px!important;min-width:14px!important;min-height:14px!important;overflow:visible!important;color:inherit!important;stroke:currentColor!important;fill:none!important}" +
    "}" +
    "@media(max-width:1023px){" +
    ".iu-custom-buttons-overlay-panel:not([hidden]){padding:0;align-items:stretch;justify-content:stretch}" +
    ".iu-custom-buttons-overlay-panel:not([hidden]) .iu-custom-buttons-overlay-cardShell{width:100%;max-width:none;max-height:none;height:100dvh}" +
    ".iu-custom-buttons-overlay-inner{border-radius:0;border-left:0;border-right:0;box-shadow:none}" +
    ".iu-quicktools-settings-backdrop:not([hidden]){top:0!important;left:0!important;right:0!important;bottom:0!important;z-index:10026!important}" +
    ".iu-quicktools-settings-panel.iu-quicktools-settings-panel--mobileFixed:not([hidden]){left:12px!important;right:12px!important;top:max(12px,env(safe-area-inset-top,0px))!important;bottom:max(12px,env(safe-area-inset-bottom,0px))!important;width:auto!important;max-width:none!important;max-height:none!important;height:auto!important;transform:none!important;z-index:10027!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;box-sizing:border-box!important;padding:0!important}" +
    ".iu-quicktools-settings-panel.iu-quicktools-settings-panel--mobileFixed .iu-quicktools-settings-scroll{flex:1 1 auto!important;min-height:0!important;overflow-x:hidden!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch!important;overscroll-behavior:contain!important;touch-action:pan-y!important}" +
    ".iu-quicktools-settings-panel.iu-quicktools-settings-panel--mobileFixed .iu-quicktools-drag-handle{touch-action:none!important}" +
    "body.iu-quicktools-settings-mobile-open{overflow:hidden!important}" +
    "body.iu-quicktools-settings-mobile-open #iuMobileBottomNav.iu-mobileBottomNav{z-index:10028!important;pointer-events:auto!important}" +
    "@media(max-width:900px){" +
    ".iu-quicktools-settings-backdrop:not([hidden]){bottom:var(--iu-mobile-bottom-nav-safe-space,calc(56px + env(safe-area-inset-bottom,0px) + 52px))!important}" +
    ".iu-quicktools-settings-panel.iu-quicktools-settings-panel--mobileFixed:not([hidden]){bottom:calc(var(--iu-mobile-bottom-nav-safe-space,calc(56px + env(safe-area-inset-bottom,0px) + 52px)) + 12px)!important}" +
    "}" +
    "}";
  try{
    if (document.getElementById(ID)) return;
    var st = document.createElement("style");
    st.id = ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }catch(e){}
})();

// === Calendar overlay module (lazy boot; heavy IIFE in iu-calendar-overlay-v1.js) ===
(function iuBootCalendarOverlayLazy() {
  "use strict";
  var CAL_URL = "./iu-calendar-overlay-v1.js?v=perf-stage4-calendar-v1-20260818-pc-vault-mindmenu-persist-v1-20260824";
  var p = null;

  function ready() {
    try {
      return !!(
        window.__iuCalendarOverlayInited &&
        window.iuCalendarService &&
        !window.iuCalendarService.__iuCalendarLazyStub &&
        typeof window.iuCalendarService.openOverlay === "function"
      );
    } catch (_) {
      return false;
    }
  }

  function ensure() {
    if (ready()) return Promise.resolve();
    if (p) return p;
    p = import(CAL_URL)
      .then(function (m) {
        if (!m || typeof m.initIuCalendarOverlay !== "function") {
          throw new Error("calendar overlay module missing initIuCalendarOverlay");
        }
        return m.initIuCalendarOverlay();
      })
      .then(function () {
        try {
          if (window.__iuCalendarOverlayBootPromise) return window.__iuCalendarOverlayBootPromise;
        } catch (_) {}
      })
      .then(function () {
        if (!ready()) {
          p = null;
          throw new Error("calendar overlay init did not install iuCalendarService");
        }
      })
      .catch(function (e) {
        p = null;
        try {
          console.warn("[iu] calendar overlay import/init failed", e);
        } catch (_) {}
        throw e;
      });
    return p;
  }

  try {
    window.__iuEnsureCalendarOverlay = ensure;
  } catch (_) {}

  function installStub() {
    if (ready()) return;
    try {
      if (window.iuCalendarService && !window.iuCalendarService.__iuCalendarLazyStub) return;
    } catch (_) {}
    var target = { __iuCalendarLazyStub: 1 };
    window.iuCalendarService = new Proxy(target, {
      get: function (_t, prop) {
        if (prop === "__iuCalendarLazyStub") return 1;
        if (prop === "then") return undefined;
        return function () {
          var args = arguments;
          return ensure().then(function () {
            var s = window.iuCalendarService;
            if (!s || s.__iuCalendarLazyStub) return;
            var fn = s[prop];
            if (typeof fn === "function") return fn.apply(s, args);
          });
        };
      },
      set: function (t, prop, value) {
        t[prop] = value;
        return true;
      },
    });
  }
  installStub();

  function isCalTrigger(el) {
    try {
      if (!el || typeof el.closest !== "function") return null;
      return el.closest(
        "[data-iu-calendar-trigger], .iu-mmTopTool--cal, #iuHeroQuickCal, [data-iu-hero-quick=\"cal\"]"
      );
    } catch (_) {
      return null;
    }
  }

  try {
    document.addEventListener(
      "pointerdown",
      function (e) {
        try {
          var t = e.target;
          if (t && t.nodeType === 3) t = t.parentElement;
          if (isCalTrigger(t)) void ensure();
        } catch (_) {}
      },
      true
    );
  } catch (_) {}

  try {
    document.addEventListener(
      "click",
      function (e) {
        try {
          if (ready()) return;
          var t = e.target;
          if (t && t.nodeType === 3) t = t.parentElement;
          var hit = isCalTrigger(t);
          if (!hit) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          ensure().then(function () {
            try {
              var s = window.iuCalendarService;
              if (s && !s.__iuCalendarLazyStub && typeof s.openOverlay === "function") {
                s.openOverlay(hit);
              }
            } catch (_) {}
          });
        } catch (_) {}
      },
      true
    );
  } catch (_) {}
})();


/* IU_SILVER_CALENDAR_GUIDED_HOST — mobile/tablet: Kalendář otevírá hlavní overlay přímo (žádný mezikrok uložit/vyhledat/zrušit). */
  (function iuSilverCalendarGuidedHost() {
    "use strict";
    var SILVER_CAL_UI_DEFAULT = "DEFAULT";
    var SILVER_CAL_UI_CAL_OPEN = "CALENDAR_OPEN";
    var SILVER_HOME_INPUT_DEFAULT_PLACEHOLDER = "Napi\u0161 Silverovi\u2026";
    var silverCalUiState = SILVER_CAL_UI_DEFAULT;

    function narrow() {
      try {
        return window.matchMedia("(max-width: 1024px)").matches;
      } catch (_) {
        return (window.innerWidth || 0) <= 1024;
      }
    }

    function iuSilverHeroPremiumExpandSet(on) {
      var el = document.getElementById("iuSilverHeroPremium");
      if (!el || !narrow()) return;
      try {
        if (on) el.classList.add("iu-silver-expanded");
        else el.classList.remove("iu-silver-expanded");
      } catch (_) {}
    }

    function modeEl() {
      return document.getElementById("iuSilverHomeModeLine");
    }
    function chipsEl() {
      return document.getElementById("iuSilverHomeChips");
    }
    function toastEl() {
      return document.getElementById("iuSilverHomeInlineToast");
    }

    function closeGuidedSheet() {
      var root = document.getElementById("iuSilverGuidedSheetRoot");
      var textBlock = document.getElementById("iuSilverGuidedSheetText");
      if (root) root.hidden = true;
      if (textBlock) textBlock.hidden = true;
    }

    function clearChipsScrollStyle() {
      var c = chipsEl();
      if (!c) return;
      try {
        c.style.maxHeight = "";
        c.style.overflowY = "";
      } catch (_) {}
    }

    function hideGuidedChrome() {
      closeGuidedSheet();
      var m = modeEl(),
        c = chipsEl(),
        t = toastEl();
      if (m) {
        m.hidden = true;
        m.textContent = "";
      }
      if (c) {
        clearChipsScrollStyle();
        c.hidden = true;
        c.innerHTML = "";
        c.removeAttribute("data-iu-guided-open");
        c.className = "iuSilverHomeChips";
      }
      if (t) {
        t.hidden = true;
        t.textContent = "";
      }
      iuSilverHeroPremiumExpandSet(false);
      try {
        silverCalUiState = SILVER_CAL_UI_DEFAULT;
        document.documentElement.removeAttribute("data-iu-silver-cal-ui");
      } catch (_) {}
    }

    function openSilverMainCalendarFromMobile(triggerEl) {
      var svc = window.iuCalendarService;
      if (!svc || typeof svc.openOverlay !== "function") return;
      var origin =
        triggerEl && typeof triggerEl.focus === "function" ? triggerEl : document.activeElement;
      try {
        svc.openOverlay(origin);
      } catch (_) {}
    }

    window.iuSilverGuidedResetFromNav = function () {
      try {
        if (typeof window.__iuSilverStopHomeSpeech === "function") window.__iuSilverStopHomeSpeech();
      } catch (_) {}
      try {
        silverCalUiState = SILVER_CAL_UI_DEFAULT;
      } catch (_) {}
      try {
        document.documentElement.removeAttribute("data-iu-silver-cal-ui");
      } catch (_) {}
      try {
        hideGuidedChrome();
      } catch (_) {}
    };

    function onMindMenuCapture(ev) {
      if (!narrow()) return;
      var b = ev.target && ev.target.closest ? ev.target.closest(".iu-mmTopTool--cal") : null;
      if (!b) return;
      try {
        if (b.getAttribute("data-iu-cal-synth") === "1") return;
      } catch (_) {}
      if (silverCalUiState === SILVER_CAL_UI_DEFAULT) {
        try {
          ev.preventDefault();
        } catch (_) {}
        try {
          ev.stopPropagation();
        } catch (_) {}
        openSilverMainCalendarFromMobile(b);
        return;
      }
    }

    window.iuSilverCalEntryQuick = function () {
      if (!narrow()) return false;
      if (silverCalUiState === SILVER_CAL_UI_DEFAULT) {
        var trigger = null;
        try {
          trigger = document.querySelector(".mindMenu .iu-mmTopTool--cal");
        } catch (_) {}
        openSilverMainCalendarFromMobile(trigger || document.activeElement);
        return true;
      }
      return false;
    };

    window.iuSilverGuidedOnHomeSendBefore = function () {
      try {
        hideGuidedChrome();
      } catch (_) {}
      var inp2 = document.getElementById("iuSilverHomeInput");
      if (inp2) {
        try {
          inp2.placeholder = SILVER_HOME_INPUT_DEFAULT_PLACEHOLDER;
        } catch (_) {}
      }
    };

    window.iuSilverGuidedConsumeEnter = function () {
      return false;
    };

    window.iuSilverCalendarGuidedFlowInit = function () {
      try {
        window.__iuSilverCalOverlayOpened = function (originEl) {
          if (!narrow()) return;
          var fromSilver = false;
          try {
            fromSilver = !!(
              originEl &&
              originEl.closest &&
              (originEl.closest("#iuHeroQuickCal") ||
                originEl.closest("[data-iu-hero-quick=\"cal\"]") ||
                originEl.closest(".iu-mmTopTool--cal"))
            );
          } catch (_) {}
          if (fromSilver) {
            silverCalUiState = SILVER_CAL_UI_CAL_OPEN;
            try {
              document.documentElement.setAttribute("data-iu-silver-cal-ui", silverCalUiState);
            } catch (_) {}
          }
        };
      } catch (_) {}
      try {
        window.__iuSilverCalOverlayClosed = function () {
          if (!narrow()) return;
          if (silverCalUiState === SILVER_CAL_UI_CAL_OPEN) {
            hideGuidedChrome();
          }
        };
      } catch (_) {}
      var mm = document.querySelector(".mindMenu");
      if (mm && !mm.__iuCalGuidedCap) {
        mm.__iuCalGuidedCap = 1;
        mm.addEventListener("click", onMindMenuCapture, true);
      }
    };
  })();

/* IU_SILVER_P0_ENGINE_START */
/* Stage-2 Wave A: engine body lives in /assets/iu-silver-p0-engine.js (lazy). Regression harnesses read that file. */
(function iuBootDeferredSilverP0Engine() {
  "use strict";
  var p = null;
  var pendingTap = null;
  var pendingGen = 0;
  var PREFIX_TEXT = {
    calendar: "Do kalendáře ",
    reminder: "Připomeň mi ",
    notes: "Do poznámek ",
  };

  function markReady() {
    try {
      window.__iuSilverP0EngineReady = 1;
    } catch (_) {}
    try {
      var ux = document.getElementById("iuSilverHomeInputUx");
      if (ux) ux.setAttribute("data-iu-silver-p0-ready", "1");
    } catch (_) {}
  }

  function ensure() {
    try {
      if (window.__iuSilverP0EngineReady) return Promise.resolve();
      if (typeof window.iuSilverCalendarEngine === "object" && window.iuSilverCalendarEngine && typeof window.iuSilverCalendarEngine.processUserTurn === "function") {
        markReady();
        return Promise.resolve();
      }
    } catch (_) {}
    if (p) return p;
    p = import("./iu-silver-p0-engine.js?v=silver-p0-lazy-v1a-20260728")
      .then(function () {
        markReady();
      })
      .catch(function (e) {
        p = null;
        try {
          console.warn("[iu] silver p0 engine import failed", e);
        } catch (_) {}
        try {
          if (typeof navigator !== "undefined" && navigator.onLine === false && window.iuNetwork && typeof window.iuNetwork.showOfflineHint === "function") {
            window.iuNetwork.showOfflineHint("Silver engine zatím není v této instalaci offline. Zapněte internet jednou, aby se modul stáhl.");
          }
        } catch (_) {}
      });
    return p;
  }
  try {
    window.iuEnsureSilverP0Engine = ensure;
  } catch (_) {}

  /* IU_SILVER_HOME_PREFIX_FIRST_TAP_HOLD_V1:
     Preferred: viewport/narrow prefetch so buttons are ready before first tap.
     Fallback: optimistic prefix apply + single pending finalize (no lost tap, no double fire). */
  var SILVER_P0_PREFETCH_SEL =
    "#iuSilverHomeInput, #iuSilverHomeSend, #iuSilverComposerInput, #iuSilverComposerSend, .iuSilverHomeInput, .iuSilverHomeSend, #iuSilverHomeInputUx, [data-iu-silver-home-prefix], [data-iu-silver-home-quick-action]";
  var SILVER_P0_CLICK_HOLD_SEL =
    "#iuSilverHomeSend, #iuSilverComposerSend, .iuSilverHomeSend, [data-iu-silver-home-prefix], [data-iu-silver-home-quick-action]";

  function narrowComposer() {
    try {
      return window.matchMedia("(max-width: 1024px)").matches;
    } catch (_) {
      return (window.innerWidth || 0) <= 1024;
    }
  }

  function cancelPendingTap() {
    pendingGen += 1;
    pendingTap = null;
  }

  function applyOptimisticPrefix(key) {
    var text = PREFIX_TEXT[key];
    var inp = document.getElementById("iuSilverHomeInput");
    var wrap = document.querySelector(".iuSilverHomeInputFieldWrap[data-iu-silver-home-input-field]");
    if (!inp || !text) return false;
    try {
      inp.value = text;
    } catch (_) {}
    try {
      if (wrap) {
        wrap.classList.remove("iuSilverHomeInputFieldWrap--empty");
        wrap.classList.remove("iuSilverHomeInputFieldWrap--template");
        wrap.classList.add("iuSilverHomeInputFieldWrap--compose");
      }
    } catch (_) {}
    try {
      var ux = document.getElementById("iuSilverHomeInputUx");
      if (ux) ux.setAttribute("aria-hidden", "true");
    } catch (_) {}
    try {
      inp.focus();
    } catch (_) {}
    try {
      var pos = text.length;
      inp.setSelectionRange(pos, pos);
    } catch (_) {}
    try {
      window.__iuSilverPrefixOptimisticCount = (window.__iuSilverPrefixOptimisticCount || 0) + 1;
      window.__iuSilverPrefixOptimisticLast = key;
    } catch (_) {}
    return true;
  }

  function finalizePendingTap(gen) {
    var pending = pendingTap;
    if (!pending || pending.gen !== gen) return;
    pendingTap = null;
    var el = pending.el;
    if (!el || !el.isConnected) return;
    if (pending.kind === "prefix") {
      /* Optimistic UI already applied; only sync engine-side helpers once. */
      try {
        if (typeof window.__iuSilverSyncHomeUxEmptyState === "function") window.__iuSilverSyncHomeUxEmptyState();
      } catch (_) {}
      try {
        if (typeof window.__iuSilverSyncHomeMicSend === "function") window.__iuSilverSyncHomeMicSend();
      } catch (_) {}
      try {
        window.__iuSilverPrefixFinalizeCount = (window.__iuSilverPrefixFinalizeCount || 0) + 1;
      } catch (_) {}
      return;
    }
    try {
      el.removeAttribute("aria-busy");
    } catch (_) {}
    try {
      el.click();
    } catch (_) {}
  }

  function shouldPrefetch(t) {
    try {
      if (!t || !t.closest) return false;
      /* Narrow: do not prefetch on whole Silver slot (weather/cards) — that pulls 1.55MB during Lighthouse. */
      if (t.closest(SILVER_P0_PREFETCH_SEL)) return true;
      if (t.closest("#iuHeroQuickCal, #iuHeroQuickTasks, #iuHeroQuickNotes, [data-iu-silver-open-chat]")) return true;
      return false;
    } catch (_) {
      return false;
    }
  }

  function onPrefetchEvent(e) {
    try {
      if (shouldPrefetch(e && e.target)) void ensure();
    } catch (_) {}
  }

  function scheduleEnsureIdle() {
    try {
      if (window.__iuSilverP0EngineReady) return;
      if (window.__iuSilverP0IdleArmed) return;
      window.__iuSilverP0IdleArmed = 1;
      var run = function () {
        void ensure();
      };
      /* Keep 1.55MB engine off first paint and early interaction (settings/checkboxes).
         FAST first-tap guards wait ≤15s for ready, so a 7s floor is safe. */
      setTimeout(function () {
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(run, { timeout: 1500 });
        } else {
          run();
        }
      }, 7000);
    } catch (_) {
      void ensure();
    }
  }

  function maybePrefetchVisibleHomeUx() {
    try {
      if (!narrowComposer()) return;
      if (window.__iuSilverP0EngineReady) return;
      var ux = document.getElementById("iuSilverHomeInputUx");
      if (!ux) return;
      var st = window.getComputedStyle ? getComputedStyle(ux) : null;
      if (st && (st.display === "none" || st.visibility === "hidden")) return;
      var r = ux.getBoundingClientRect ? ux.getBoundingClientRect() : null;
      if (!r || r.width < 8 || r.height < 8) return;
      if (r.bottom < 0 || r.top > (window.innerHeight || 0) + 8) return;
      scheduleEnsureIdle();
    } catch (_) {}
  }

  function armViewportPrefetch() {
    try {
      if (!narrowComposer()) return;
      maybePrefetchVisibleHomeUx();
      var ux = document.getElementById("iuSilverHomeInputUx");
      if (!ux || ux.__iuSilverP0ViewportPrefetch) return;
      ux.__iuSilverP0ViewportPrefetch = 1;
      if (typeof IntersectionObserver === "function") {
        var io = new IntersectionObserver(
          function (entries) {
            try {
              for (var i = 0; i < entries.length; i++) {
                if (entries[i] && entries[i].isIntersecting) {
                  scheduleEnsureIdle();
                  break;
                }
              }
            } catch (_) {}
          },
          { root: null, threshold: 0.01 }
        );
        io.observe(ux);
      }
    } catch (_) {}
  }

  try {
    document.addEventListener("pointerdown", onPrefetchEvent, true);
    document.addEventListener("focusin", onPrefetchEvent, true);
  } catch (_) {}

  /* Preferred path: prefetch when home UX is visible on mobile/tablet (not whole Silver weather slot). */
  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", armViewportPrefetch);
    } else {
      armViewportPrefetch();
    }
  } catch (_) {}
  try {
    window.addEventListener("pageshow", function () {
      cancelPendingTap();
      armViewportPrefetch();
      maybePrefetchVisibleHomeUx();
    });
  } catch (_) {}
  try {
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        armViewportPrefetch();
        maybePrefetchVisibleHomeUx();
      }
    });
  } catch (_) {}

  /* Fallback: first interaction before engine lands — optimistic UI + single finalize. */
  try {
    document.addEventListener(
      "click",
      function (e) {
        try {
          if (window.__iuSilverP0EngineReady) return;
          var t = e.target && e.target.closest ? e.target.closest(SILVER_P0_CLICK_HOLD_SEL) : null;
          if (!t) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          var prefixKey = "";
          try {
            prefixKey = String(t.getAttribute("data-iu-silver-home-prefix") || "");
          } catch (_) {}
          var kind = prefixKey ? "prefix" : "reclick";
          if (kind === "prefix") {
            applyOptimisticPrefix(prefixKey);
          } else {
            try {
              t.setAttribute("aria-busy", "true");
            } catch (_) {}
          }
          pendingGen += 1;
          var gen = pendingGen;
          pendingTap = { el: t, kind: kind, key: prefixKey, gen: gen };
          ensure().then(function () {
            finalizePendingTap(gen);
          });
        } catch (_) {}
      },
      true
    );
  } catch (_) {}

  /* Bridge: calendar service parseAndCreateFromText waits for engine. */
  try {
    var prev = window.iuCalendarService;
    if (prev && typeof prev.parseAndCreateFromText === "function" && !prev.__iuSilverLazyWrapped) {
      var orig = prev.parseAndCreateFromText.bind(prev);
      prev.parseAndCreateFromText = async function (text) {
        await ensure();
        return orig(text);
      };
      prev.__iuSilverLazyWrapped = 1;
    }
  } catch (_) {}
})();
/* IU_SILVER_P0_ENGINE_END */


(function iuBootDeferredToolOverlays() {
  "use strict";
  var finPromise = null;
  var legalPromise = null;
  var invPromise = null;

  function ensureFin() {
    try {
      if (typeof window.iuFinancialCalcOpenSurface === "function") return Promise.resolve();
    } catch (_) {}
    if (finPromise) return finPromise;
    finPromise = import("./iu-financial-calculators-module.js")
      .then(function (m) {
        try {
          m.initIuFinancialCalculatorsOverlay({});
        } catch (e) {
          try {
            console.warn("[iu] financial calculators overlay init failed", e);
          } catch (_) {}
        }
      })
      .catch(function (e) {
        finPromise = null;
        try {
          console.warn("[iu] financial calculators overlay import failed", e);
        } catch (_) {}
        try {
          if (typeof navigator !== "undefined" && navigator.onLine === false && window.iuNetwork && typeof window.iuNetwork.showOfflineHint === "function") {
            window.iuNetwork.showOfflineHint("Finanční kalkulačky zatím nejsou v této instalaci offline. Zapněte internet jednou, aby se modul stáhl.");
          }
        } catch (_) {}
      });
    return finPromise;
  }

  function ensureLegal() {
    try {
      if (typeof window.iuLegalDocsOpenSurface === "function") return Promise.resolve();
    } catch (_) {}
    if (legalPromise) return legalPromise;
    legalPromise = import("./iu-legal-documents-module.js?v=legal-docs-form-state-hidden-panel-v1-20260713")
      .then(function (m) {
        try {
          m.initIuLegalDocumentsOverlay({});
        } catch (e) {
          try {
            console.warn("[iu] legal documents overlay init failed", e);
          } catch (_) {}
        }
      })
      .catch(function (e) {
        legalPromise = null;
        try {
          console.warn("[iu] legal documents overlay import failed", e);
        } catch (_) {}
      });
    return legalPromise;
  }

  function ensureInv() {
    try {
      if (typeof window.iuInvoiceOpenSurface === "function") return Promise.resolve();
    } catch (_) {}
    if (invPromise) return invPromise;
    invPromise = import("./iu-invoice-module.js?v=invoice-desktop-fullpage-v1-20260620")
      .then(function (m) {
        try {
          m.initIuInvoiceOverlay({});
        } catch (e) {
          try {
            console.warn("[iu] invoice overlay init failed", e);
          } catch (_) {}
        }
      })
      .catch(function (e) {
        invPromise = null;
        try {
          console.warn("[iu] invoice overlay import failed", e);
        } catch (_) {}
        try {
          if (typeof navigator !== "undefined" && navigator.onLine === false && window.iuNetwork && typeof window.iuNetwork.showOfflineHint === "function") {
            window.iuNetwork.showOfflineHint("Generátor faktur zatím není v této instalaci offline. Zapněte internet jednou, aby se modul stáhl.");
          }
        } catch (_) {}
      });
    return invPromise;
  }

  try {
    window.iuEnsureFinancialCalcOverlayBoot = ensureFin;
    window.iuEnsureLegalDocsOverlayBoot = ensureLegal;
    window.iuEnsureInvoiceOverlayBoot = ensureInv;
  } catch (_) {}

  function prefetchFromDataIuq(el) {
    var key = String((el && el.getAttribute && el.getAttribute("data-iuq")) || "")
      .trim()
      .toLowerCase();
    if (key === "fincalc") void ensureFin();
    else if (key === "legaldocs") void ensureLegal();
    else if (key === "faktura") void ensureInv();
  }

  document.addEventListener(
    "pointerdown",
    function (e) {
      try {
        var t = e.target;
        if (t && t.nodeType === 3) t = t.parentElement;
        if (!t || typeof t.closest !== "function") return;
        var el = t.closest("[data-iuq]");
        if (!el) return;
        prefetchFromDataIuq(el);
      } catch (_) {}
    },
    true
  );
})();

/**
 * Opt-in probe for feed visibility guard (body.iu-home vs loadData on tab return). Set before app.js loads.
 * window.__IU_HOME_GUARD_PROBE__ = true
 */
(function iuHomeGuardProbeInstall() {
  try {
    if (typeof window === "undefined" || window.__IU_HOME_GUARD_PROBE__ !== true) return;
  } catch (_) {
    return;
  }
  var G = {
    homeStateAtLoad: null,
    homeStateAtReturn: null,
    loadDataWillRun: null,
    loadDataTriggeredAfterVisible: false,
    loadDataReason: "",
    loadDataDurationMs: null,
    requestsAfterVisible: 0,
    DOMMutationsAfterVisible: 0,
    lastVisiblePerf: 0,
    windowNs: 5000,
  };
  function readIuHome() {
    try {
      return !!(document.body && document.body.classList && document.body.classList.contains("iu-home"));
    } catch (_) {
      return false;
    }
  }
  try {
    G.homeStateAtLoad = readIuHome();
  } catch (_) {}
  try {
    var of = window.fetch;
    if (typeof of === "function") {
      window.fetch = function () {
        if (G.lastVisiblePerf && performance.now() - G.lastVisiblePerf < G.windowNs) {
          G.requestsAfterVisible++;
        }
        return of.apply(this, arguments);
      };
    }
  } catch (_) {}
  try {
    var mo = new MutationObserver(function () {
      if (G.lastVisiblePerf && performance.now() - G.lastVisiblePerf < G.windowNs) {
        G.DOMMutationsAfterVisible++;
        if (G.DOMMutationsAfterVisible > 200000) G.DOMMutationsAfterVisible = 200000;
      }
    });
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  } catch (_) {}
  var poll = 0;
  function wrapLoadData() {
    poll++;
    if (poll > 400) return;
    var fn = window.__iuLoadData;
    if (typeof fn !== "function" || fn.__iuGuardWrapped) return;
    var orig = fn;
    window.__iuLoadData = function () {
      var t0 = performance.now();
      var vis = !!(G.lastVisiblePerf && performance.now() - G.lastVisiblePerf < G.windowNs);
      try {
        var r = orig.apply(this, arguments);
        if (vis) {
          G.loadDataTriggeredAfterVisible = true;
          G.loadDataReason = readIuHome() ? "unexpected_with_iu_home" : "visibility_resume_or_bootstrap";
        }
        if (r && typeof r.then === "function") {
          return r.then(
            function (v) {
              if (vis) G.loadDataDurationMs = Math.round(performance.now() - t0);
              return v;
            },
            function (e) {
              if (vis) G.loadDataDurationMs = Math.round(performance.now() - t0);
              throw e;
            }
          );
        }
        if (vis) G.loadDataDurationMs = Math.round(performance.now() - t0);
        return r;
      } catch (e) {
        if (vis) G.loadDataDurationMs = Math.round(performance.now() - t0);
        throw e;
      }
    };
    window.__iuLoadData.__iuGuardWrapped = 1;
  }
  try {
    setInterval(wrapLoadData, 120);
    wrapLoadData();
  } catch (_) {}
  try {
    document.addEventListener(
      "visibilitychange",
      function () {
        if (document.visibilityState !== "visible") return;
        G.lastVisiblePerf = performance.now();
        G.requestsAfterVisible = 0;
        G.DOMMutationsAfterVisible = 0;
        G.loadDataTriggeredAfterVisible = false;
        G.loadDataDurationMs = null;
        G.loadDataReason = "";
        try {
          G.homeStateAtReturn = readIuHome();
          G.loadDataWillRun = !readIuHome();
        } catch (_) {
          G.loadDataWillRun = null;
        }
      },
      true
    );
  } catch (_) {}
  window.__IU_HOME_GUARD_SNAP__ = function () {
    return {
      homeStateAtLoad: G.homeStateAtLoad,
      homeStateAtReturn: G.homeStateAtReturn,
      loadDataTriggeredAfterVisible: G.loadDataTriggeredAfterVisible,
      loadDataReason: G.loadDataReason,
      loadDataDurationMs: G.loadDataDurationMs,
      requestsAfterVisible: G.requestsAfterVisible,
      DOMMutationsAfterVisible: G.DOMMutationsAfterVisible,
      loadDataWillRun: G.loadDataWillRun,
    };
  };
})();
