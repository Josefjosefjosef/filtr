/* iu-pwa-version-check.js
   PWA / home-screen safe deploy detection — fetch server version, reload once if newer.
   Does not touch user data (localStorage/IndexedDB app keys). Only uses iu:pwa:ver:* keys.
*/
(function () {
  "use strict";

  var VERSION_PATH = "/projects/version.json";
  var SS_RELOAD_FOR = "iu:pwa:ver:reloaded-for";
  var SS_RELOAD_TS = "iu:pwa:ver:reload-ts";
  var RELOAD_COOLDOWN_MS = 30000;
  var checking = false;

  function isProjectsRoute() {
    try {
      var p = String(location.pathname || "");
      return p === "/projects/" || p === "/projects" || p.indexOf("/projects/") === 0;
    } catch (_) {
      return false;
    }
  }

  if (!isProjectsRoute()) return;

  function getBootVersion() {
    try {
      var meta = document.querySelector('meta[name="iu-build"]');
      return meta ? String(meta.getAttribute("content") || "").trim() : "";
    } catch (_) {
      return "";
    }
  }

  function shouldSkipReload(serverVer) {
    try {
      var now = Date.now();
      var lastTs = parseInt(sessionStorage.getItem(SS_RELOAD_TS) || "0", 10);
      if (!isNaN(lastTs) && now - lastTs < RELOAD_COOLDOWN_MS) return true;
      var reloadedFor = sessionStorage.getItem(SS_RELOAD_FOR) || "";
      if (reloadedFor && reloadedFor === serverVer) return true;
    } catch (_) {}
    return false;
  }

  function markReloadFor(serverVer) {
    try {
      sessionStorage.setItem(SS_RELOAD_FOR, serverVer);
      sessionStorage.setItem(SS_RELOAD_TS, String(Date.now()));
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

  function scheduleCheck() {
    try {
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(function () {
          checkVersion();
        }, { timeout: 3000 });
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
      if (!serverVer || serverVer === bootVer) return;

      if (shouldSkipReload(serverVer)) return;
      markReloadFor(serverVer);
      safeReload();
    } catch (_) {
      /* silent — stale shell is OK, reload loop is not */
    } finally {
      checking = false;
    }
  }

  scheduleCheck();

  window.addEventListener("pageshow", function () {
    scheduleCheck();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") scheduleCheck();
  });
})();
