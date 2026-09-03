/**
 * Central network / connectivity layer for INFOUZEL.CZ PWA.
 * External opens, offline probes, UI shell restore after return, fetch timeouts.
 */
(function iuNetworkConnectivityModule() {
  "use strict";

  var PROBE_URL = "/projects/version.json";
  var PROBE_TIMEOUT_MS = 3500;
  var DEFAULT_FETCH_TIMEOUT_MS = 9000;
  var EXTERNAL_ARMED_KEY = "iu_external_nav_armed";
  var lastProbe = { ok: null, ts: 0 };
  var reconnectTimer = null;
  var reconnectCallbacks = [];
  var hintTimer = null;

  function isLikelyOfflineSignal() {
    try {
      return navigator.onLine === false;
    } catch (_) {
      return false;
    }
  }

  function normalizeExternalUrl(raw) {
    var u = String(raw || "").trim();
    if (!u) return "";
    if (/^mailto:/i.test(u) || /^tel:/i.test(u)) return u;
    if (/^https?:\/\//i.test(u)) return u;
    if (/^\/\//.test(u)) return "https:" + u;
    return "https://" + u;
  }

  function isSameOriginHttp(url) {
    try {
      var u = new URL(url, location.href);
      return u.origin === location.origin;
    } catch (_) {
      return false;
    }
  }

  function invalidateProbe() {
    lastProbe.ts = 0;
    lastProbe.ok = null;
  }

  async function probeReachability(opts) {
    var timeoutMs = (opts && opts.timeoutMs) || PROBE_TIMEOUT_MS;
    var now = Date.now();
    if (now - lastProbe.ts < 1800 && lastProbe.ok !== null) return lastProbe.ok;
    if (isLikelyOfflineSignal()) {
      lastProbe = { ok: false, ts: now };
      return false;
    }
    var ctrl = new AbortController();
    var t = setTimeout(function () {
      try {
        ctrl.abort();
      } catch (_) {}
    }, timeoutMs);
    try {
      var res = await fetch(PROBE_URL + "?iu_net_probe=" + now, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        signal: ctrl.signal,
      });
      var ok = !!(res && res.ok);
      lastProbe = { ok: ok, ts: now };
      return ok;
    } catch (_) {
      lastProbe = { ok: false, ts: now };
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  function hideOfflineHint() {
    var el = document.getElementById("iuNetworkOfflineHint");
    if (!el) return;
    try {
      el.style.opacity = "0";
    } catch (_) {}
  }

  function showOfflineHint(message) {
    var msg = String(message || "Tuto stránku bez internetu nelze otevřít.");
    if (!document.body) return;
    var el = document.getElementById("iuNetworkOfflineHint");
    if (!el) {
      el = document.createElement("div");
      el.id = "iuNetworkOfflineHint";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.style.cssText =
        "position:fixed;left:50%;bottom:calc(var(--iu-mobile-bottom-nav-safe-space, var(--bottom-nav-height, calc(var(--iu-mobile-bottom-nav-h, 56px) + env(safe-area-inset-bottom, 0px) + 40px))) + 12px);transform:translateX(-50%);z-index:10030;max-width:min(92vw, 420px);padding:10px 14px;border-radius:12px;background:rgba(20,24,32,.92);color:#fff;font:14px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.25);pointer-events:none;opacity:0;transition:opacity .2s ease;text-align:center";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      hideOfflineHint();
    }, 3200);
  }

  /* Body classes for intentional fullscreen / tool overlays. Stripping iu-modal-open
     while any of these are set collapses mobile layout (e.g. Datové schránky after
     return from external login tab → nested MindMenu chrome). */
  var INTENTIONAL_TOOL_OVERLAY_BODY_CLASSES = [
    "iu-ds-overlay-open",
    "iu-financial-overlay-open",
    "iu-financial-calculators-overlay-open",
    "iu-legal-docs-overlay-open",
    "iu-invoice-overlay-open",
    "iu-custom-buttons-overlay-open",
    "iu-quickFeedOpen",
    "iu-nakup-online-overlay-open",
    "iu-grocery-desktop-overlay-open",
    "iu-banking-desktop-overlay-open",
    "iu-bakalari-desktop-overlay-open",
    "iu-pojistovna-desktop-overlay-open",
    "iu-wordpdf-desktop-overlay-open",
    "iu-ai-narrow-fullscreen",
  ];

  function hasIntentionalToolOverlayOpen() {
    try {
      var b = document.body;
      if (!b || !b.classList) return false;
      for (var i = 0; i < INTENTIONAL_TOOL_OVERLAY_BODY_CLASSES.length; i++) {
        if (b.classList.contains(INTENTIONAL_TOOL_OVERLAY_BODY_CLASSES[i])) return true;
      }
      var ds = document.getElementById("iuDsPanel");
      if (ds && String(ds.dataset.open || "") === "1" && !ds.hasAttribute("hidden")) return true;
      var fin = document.getElementById("iuFinancialCalcPanel");
      if (fin && String(fin.dataset.open || "") === "1" && !fin.hasAttribute("hidden")) return true;
      var leg = document.getElementById("iuLegalDocsPanel");
      if (leg && String(leg.dataset.open || "") === "1" && !leg.hasAttribute("hidden")) return true;
      var inv = document.getElementById("iuInvoicePanel");
      if (inv && String(inv.dataset.open || "") === "1" && !inv.hasAttribute("hidden")) return true;
    } catch (_) {}
    return false;
  }

  function shouldRestoreShell() {
    try {
      if (sessionStorage.getItem(EXTERNAL_ARMED_KEY) === "1") return true;
    } catch (_) {}
    try {
      /* Stuck modal lock without an intentional tool overlay (error/loading leftover).
         Do NOT treat intentional overlays (Datovka / invoice / …) as restore triggers —
         that path used to strip iu-modal-open on every pageshow/visibility resume. */
      if (document.body.classList.contains("iu-modal-open") && !hasIntentionalToolOverlayOpen()) return true;
    } catch (_) {}
    return false;
  }

  function clearShellErrorUiOnly() {
    var preserveModal = hasIntentionalToolOverlayOpen();
    try {
      if (!preserveModal) {
        document.documentElement.classList.remove("iu-modal-open");
        document.body.classList.remove("iu-modal-open", "iu-custom-buttons-overlay-open");
        document.documentElement.style.overflow = "";
        document.documentElement.style.pointerEvents = "";
        document.body.style.overflow = "";
        document.body.style.pointerEvents = "";
      } else {
        /* Keep overflow lock for open tool overlays; only drop pointer-events traps. */
        document.documentElement.style.pointerEvents = "";
        document.body.style.pointerEvents = "";
      }
    } catch (_) {}
    try {
      document.querySelectorAll("[data-iu-loading-overlay='1'], .iu-loading-overlay").forEach(function (node) {
        try {
          node.hidden = true;
          node.style.display = "none";
          node.style.pointerEvents = "none";
        } catch (_) {}
      });
    } catch (_) {}
  }

  function reassertIntentionalOverlayShell() {
    try {
      if (!hasIntentionalToolOverlayOpen()) return;
      document.body.classList.add("iu-modal-open");
      if (document.body.classList.contains("iu-ds-overlay-open") ||
          (function () {
            var ds = document.getElementById("iuDsPanel");
            return !!(ds && String(ds.dataset.open || "") === "1" && !ds.hasAttribute("hidden"));
          })()) {
        document.body.classList.add("iu-ds-overlay-open");
        if (typeof window.ensureDatovkaModalInBody === "function") window.ensureDatovkaModalInBody();
      }
    } catch (_) {}
  }

  function invokeReturnNavigationRestore() {
    /* P0: while a fullscreen tool overlay is open, do not remount MindMenu tools chrome
       (would surface MindMenu/iCentrum header around Datové schránky after external return). */
    if (hasIntentionalToolOverlayOpen()) {
      reassertIntentionalOverlayShell();
      return;
    }
    try {
      if (typeof window.iuMindMenuRestoreIfArmed === "function") window.iuMindMenuRestoreIfArmed();
    } catch (_) {}
    try {
      if (typeof window.iuMindMenuSyncGateFromHistory === "function") window.iuMindMenuSyncGateFromHistory();
    } catch (_) {}
    try {
      if (typeof window.iuMobileWebNavSyncFromHistory === "function") window.iuMobileWebNavSyncFromHistory();
    } catch (_) {}
  }

  function restoreAppShellAfterReturn() {
    if (!shouldRestoreShell()) {
      reassertIntentionalOverlayShell();
      return;
    }
    clearShellErrorUiOnly();
    try {
      sessionStorage.removeItem(EXTERNAL_ARMED_KEY);
    } catch (_) {}
    reassertIntentionalOverlayShell();
    invokeReturnNavigationRestore();
  }

  function armExternalReturn() {
    try {
      sessionStorage.setItem(EXTERNAL_ARMED_KEY, "1");
    } catch (_) {}
  }

  function openExternalViaAnchor(url) {
    var a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  }

  function openExternalSync(url, isMailTel) {
    armExternalReturn();
    clearShellErrorUiOnly();
    try {
      var now = Date.now();
      var last = window.__iuMindMenuLastExternalOpen || null;
      if (last && last.url === url && now - last.ts < 600) return { ok: true, reason: "deduped" };
      window.__iuMindMenuLastExternalOpen = { url: url, ts: now };
    } catch (_) {}
    var opened = false;
    try {
      if (isMailTel) {
        opened = openExternalViaAnchor(url);
      } else {
        var w = window.open(url, "_blank", "noopener,noreferrer");
        opened = !!(w && !w.closed);
        if (!opened) opened = openExternalViaAnchor(url);
      }
    } catch (_) {
      try {
        opened = openExternalViaAnchor(url);
      } catch (_a) {}
    }
    return { ok: !!opened, reason: opened ? "opened" : "blocked" };
  }

  function openExternalUrl(rawUrl, opts) {
    var url = normalizeExternalUrl(rawUrl);
    if (!url) return Promise.resolve({ ok: false, reason: "empty" });
    var isMailTel = /^mailto:/i.test(url) || /^tel:/i.test(url);
    if (!isMailTel && isLikelyOfflineSignal()) {
      showOfflineHint("Tuto stránku nelze bez připojení k internetu otevřít.");
      armExternalReturn();
      clearShellErrorUiOnly();
      invokeReturnNavigationRestore();
      return Promise.resolve({ ok: false, reason: "offline" });
    }
    return Promise.resolve(openExternalSync(url, isMailTel));
  }

  async function fetchJson(url, opts) {
    var timeoutMs = (opts && opts.timeoutMs) || DEFAULT_FETCH_TIMEOUT_MS;
    var ctrl = new AbortController();
    var t = setTimeout(function () {
      try {
        ctrl.abort();
      } catch (_) {}
    }, timeoutMs);
    try {
      var fetchOpts = {
        signal: ctrl.signal,
        credentials: "same-origin",
      };
      if (opts && opts.cache) fetchOpts.cache = opts.cache;
      if (opts && opts.headers) fetchOpts.headers = opts.headers;
      var res = await fetch(url, fetchOpts);
      if (!res.ok) throw new Error("HTTP_" + res.status);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  function onReconnect(fn) {
    if (typeof fn === "function") reconnectCallbacks.push(fn);
  }

  function shouldSkipExternalAnchor(a) {
    if (!a) return true;
    if (a.hasAttribute("data-iu-skip-external-guard")) return true;
    if (a.closest(".mindMenu")) return true;
    if (a.closest("[data-quicktool-custom='1']")) return true;
    if (a.closest("#iuLeftRail")) return false;
    return false;
  }

  function bindGlobalExternalCapture() {
    if (window.__iuNetworkExternalCapture) return;
    window.__iuNetworkExternalCapture = true;
    document.addEventListener(
      "click",
      function (e) {
        var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
        if (!a || shouldSkipExternalAnchor(a)) return;
        var href = String(a.getAttribute("href") || "").trim();
        if (!/^https?:\/\//i.test(href)) return;
        if (isSameOriginHttp(href)) return;
        if (a.target !== "_blank" && !a.hasAttribute("data-iu-external-link")) return;
        e.preventDefault();
        e.stopPropagation();
        void openExternalUrl(href);
      },
      true
    );
  }

  function bindLifecycle() {
    window.addEventListener("pageshow", function () {
      restoreAppShellAfterReturn();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") restoreAppShellAfterReturn();
    });
    window.addEventListener("offline", function () {
      invalidateProbe();
    });
    window.addEventListener("online", function () {
      invalidateProbe();
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(async function () {
        var ok = false;
        for (var attempt = 0; attempt < 3; attempt++) {
          ok = await probeReachability({ timeoutMs: 2800 });
          if (ok) break;
          await new Promise(function (resolve) {
            setTimeout(resolve, 350 * (attempt + 1));
          });
        }
        /* Soft restore: if browser reports online but probe is flaky, still refresh UI. */
        if (!ok) {
          try {
            if (navigator.onLine === true) ok = true;
          } catch (_) {}
        }
        if (!ok) return;
        hideOfflineHint();
        reconnectCallbacks.forEach(function (fn) {
          try {
            fn();
          } catch (_) {}
        });
      }, 500);
    });
  }

  function init() {
    bindGlobalExternalCapture();
    bindLifecycle();
  }

  window.iuNetwork = {
    probeReachability: probeReachability,
    openExternalUrl: openExternalUrl,
    openExternalSync: openExternalSync,
    restoreAppShellAfterReturn: restoreAppShellAfterReturn,
    hasIntentionalToolOverlayOpen: hasIntentionalToolOverlayOpen,
    showOfflineHint: showOfflineHint,
    hideOfflineHint: hideOfflineHint,
    fetchJson: fetchJson,
    onReconnect: onReconnect,
    invalidateProbe: invalidateProbe,
    normalizeExternalUrl: normalizeExternalUrl,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
