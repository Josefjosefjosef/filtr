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
        "position:fixed;left:50%;bottom:calc(76px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:10030;max-width:min(92vw,420px);padding:10px 14px;border-radius:12px;background:rgba(20,24,32,.92);color:#fff;font:14px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.25);pointer-events:none;opacity:0;transition:opacity .2s ease;text-align:center";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      try {
        el.style.opacity = "0";
      } catch (_) {}
    }, 3200);
  }

  function shouldRestoreShell() {
    try {
      if (sessionStorage.getItem(EXTERNAL_ARMED_KEY) === "1") return true;
    } catch (_) {}
    try {
      if (document.body.classList.contains("iu-modal-open")) return true;
    } catch (_) {}
    return false;
  }

  function restoreAppShellAfterReturn() {
    if (!shouldRestoreShell()) return;
    try {
      if (typeof window.iuForceCloseAllOverlays === "function") window.iuForceCloseAllOverlays();
    } catch (_) {}
    try {
      if (typeof window.iuSetViewportLock === "function") window.iuSetViewportLock(false);
    } catch (_) {}
    try {
      document.documentElement.classList.remove("iu-modal-open");
      document.body.classList.remove(
        "iu-modal-open",
        "iu-custom-buttons-overlay-open",
        "iu-mindmenu-open"
      );
      document.documentElement.style.overflow = "";
      document.documentElement.style.pointerEvents = "";
      document.body.style.overflow = "";
      document.body.style.pointerEvents = "";
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
    try {
      sessionStorage.removeItem(EXTERNAL_ARMED_KEY);
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

  async function openExternalUrl(rawUrl, opts) {
    var url = normalizeExternalUrl(rawUrl);
    if (!url) return { ok: false, reason: "empty" };
    var skipProbe = !!(opts && opts.skipProbe);
    var isMailTel = /^mailto:/i.test(url) || /^tel:/i.test(url);
    if (!skipProbe && !isMailTel) {
      var reachable = await probeReachability();
      if (!reachable) {
        showOfflineHint("Tuto stránku bez internetu nelze otevřít.");
        try {
          sessionStorage.setItem(EXTERNAL_ARMED_KEY, "1");
        } catch (_) {}
        restoreAppShellAfterReturn();
        return { ok: false, reason: "offline" };
      }
    }
    restoreAppShellAfterReturn();
    try {
      sessionStorage.setItem(EXTERNAL_ARMED_KEY, "1");
    } catch (_) {}
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
        var ok = await probeReachability();
        if (!ok) return;
        showOfflineHint("Připojení bylo obnoveno.");
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
    restoreAppShellAfterReturn: restoreAppShellAfterReturn,
    showOfflineHint: showOfflineHint,
    fetchJson: fetchJson,
    onReconnect: onReconnect,
    invalidateProbe: invalidateProbe,
    normalizeExternalUrl: normalizeExternalUrl,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
