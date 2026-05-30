/* iu-pwa-version-check.js
   PWA / home-screen safe deploy detection — fetch server version, reload once if newer.
   Does not touch user data (localStorage/IndexedDB app keys). Only uses iu:pwa:ver:* keys.
   Exposed as window.__iuPwaVersionCheck for inline head bootstrap (PWA stale shell recovery).
*/
(function () {
  "use strict";

  var VERSION_PATH = "/projects/version.json";
  var SS_RELOAD_FOR = "iu:pwa:ver:reloaded-for";
  var SS_RELOAD_TS = "iu:pwa:ver:reload-ts";
  var SS_RELOAD_ATTEMPTS = "iu:pwa:ver:reload-attempts";
  var SS_SW_DEPLOY_RELOAD = "iu:pwa:sw-deploy-reload";
  var RELOAD_COOLDOWN_MS = 30000;
  var MAX_RELOAD_ATTEMPTS = 3;
  var checking = false;

  function isProjectsRoute() {
    try {
      var p = String(location.pathname || "");
      return p === "/projects/" || p === "/projects" || p.indexOf("/projects/") === 0;
    } catch (_) {
      return false;
    }
  }

  function getBootVersion() {
    try {
      var meta = document.querySelector('meta[name="iu-build"]');
      return meta ? String(meta.getAttribute("content") || "").trim() : "";
    } catch (_) {
      return "";
    }
  }

  function shouldSkipReload(serverVer, bootVer) {
    if (!serverVer || serverVer === bootVer) return true;
    try {
      var now = Date.now();
      var lastTs = parseInt(sessionStorage.getItem(SS_RELOAD_TS) || "0", 10);
      var reloadedFor = sessionStorage.getItem(SS_RELOAD_FOR) || "";
      var attempts = parseInt(sessionStorage.getItem(SS_RELOAD_ATTEMPTS) || "0", 10);
      if (reloadedFor === serverVer) {
        if (attempts >= MAX_RELOAD_ATTEMPTS) return true;
        if (!isNaN(lastTs) && now - lastTs < RELOAD_COOLDOWN_MS) return true;
      } else if (!isNaN(lastTs) && now - lastTs < 3000) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  function markReloadFor(serverVer) {
    try {
      var prev = sessionStorage.getItem(SS_RELOAD_FOR) || "";
      var attempts = parseInt(sessionStorage.getItem(SS_RELOAD_ATTEMPTS) || "0", 10);
      if (prev !== serverVer) attempts = 0;
      sessionStorage.setItem(SS_RELOAD_FOR, serverVer);
      sessionStorage.setItem(SS_RELOAD_TS, String(Date.now()));
      sessionStorage.setItem(SS_RELOAD_ATTEMPTS, String(attempts + 1));
    } catch (_) {}
  }

  function safeReload() {
    try {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(function () {
          location.reload();
        });
        return;
      }
    } catch (_) {}
    location.reload();
  }

  function bindSwDeployReload() {
    try {
      if (!navigator.serviceWorker || window.__iuPwaSwDeployBound) return;
      window.__iuPwaSwDeployBound = true;
      navigator.serviceWorker.addEventListener("message", function (ev) {
        if (!ev || !ev.data || ev.data.type !== "IU_SW_DEPLOY_RELOAD") return;
        try {
          if (sessionStorage.getItem(SS_SW_DEPLOY_RELOAD) === "1") return;
          sessionStorage.setItem(SS_SW_DEPLOY_RELOAD, "1");
        } catch (_) {}
        safeReload();
      });
    } catch (_) {}
  }

  function scheduleCheck() {
    try {
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(function () {
          checkVersion();
        }, { timeout: 2000 });
        return;
      }
    } catch (_) {}
    setTimeout(checkVersion, 0);
  }

  async function checkVersion() {
    if (checking) return;
    checking = true;
    try {
      var bootVer = getBootVersion();
      if (!bootVer) return;

      var url = VERSION_PATH + "?t=" + String(Date.now());
      var res = await fetch(url, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { "cache-control": "no-cache" },
      });
      if (!res.ok) return;

      var data = await res.json();
      var serverVer =
        data && typeof data.version === "string" ? data.version.trim() : "";
      if (shouldSkipReload(serverVer, bootVer)) return;

      markReloadFor(serverVer);
      safeReload();
    } catch (_) {
      /* silent — stale shell is OK, reload loop is not */
    } finally {
      checking = false;
    }
  }

  function boot() {
    if (!isProjectsRoute()) return;
    bindSwDeployReload();
    scheduleCheck();
    if (window.__iuPwaVersionEventsBound) return;
    window.__iuPwaVersionEventsBound = true;
    window.addEventListener("pageshow", function () {
      scheduleCheck();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") scheduleCheck();
    });
  }

  window.__iuPwaVersionCheck = boot;
  boot();
})();
