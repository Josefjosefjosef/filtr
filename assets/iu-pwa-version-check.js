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
  var SS_PENDING_RELOAD = "iu:pwa:ver:pending-reload";
  var SS_LAST_RELOAD_REASON = "iu:pwa:ver:last-reload-reason";
  var RELOAD_COOLDOWN_MS = 30000;
  var MAX_RELOAD_ATTEMPTS = 3;
  var checking = false;
  var pendingReloadTimer = null;

  function isProjectsRoute() {
    try {
      var p = String(location.pathname || "").replace(/\\/g, "/");
      if (p === "/" || p === "/index.html") return true;
      if (p === "/filtr/" || p === "/filtr" || p === "/filtr/index.html") return true;
      return p === "/projects/" || p === "/projects" || p.indexOf("/projects/") === 0 || p.indexOf("/filtr/projects") === 0;
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

  function externalReturnBlocksDeployReload() {
    try {
      var n = window.iuNetwork;
      if (n) {
        if (typeof n.isExternalReturnRestoreActive === "function" && n.isExternalReturnRestoreActive()) return true;
        if (typeof n.isExternalReturnHoldActive === "function" && n.isExternalReturnHoldActive()) return true;
        if (typeof n.isExternalReturnVersionDeferActive === "function" && n.isExternalReturnVersionDeferActive()) {
          return true;
        }
      }
    } catch (_) {}
    try {
      if (sessionStorage.getItem("iu_external_nav_armed") === "1") return true;
    } catch (_) {}
    try {
      var rawPost = localStorage.getItem("iuPwaExternalReturnPostSettleV1");
      if (rawPost) {
        var op = JSON.parse(rawPost);
        if (Number(op && op.until) > Date.now()) return true;
      }
    } catch (_) {}
    try {
      var rawMain = localStorage.getItem("iuPwaExternalReturnMainScrollPersistV1");
      if (rawMain) {
        var om = JSON.parse(rawMain);
        var tsM = Number(om && om.t);
        if (om && Number(om.y) > 0 && Number.isFinite(tsM) && Date.now() - tsM < 45000) return true;
      }
    } catch (_) {}
    try {
      var rawMenu = localStorage.getItem("iuPwaMenuNavReturnPersistV1");
      if (rawMenu) {
        var oMenu = JSON.parse(rawMenu);
        var tsN = Number(oMenu && oMenu.t);
        if (oMenu && oMenu.gate === "nav" && Number.isFinite(tsN) && Date.now() - tsN < 45000) return true;
      }
    } catch (_) {}
    return false;
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

  function noteReloadReason(reason, detail) {
    try {
      var payload = { reason: String(reason || ""), t: Date.now() };
      if (detail && typeof detail === "object") {
        if (detail.serverVer) payload.serverVer = detail.serverVer;
        if (detail.bootVer) payload.bootVer = detail.bootVer;
        if (detail.source) payload.source = detail.source;
      }
      sessionStorage.setItem(SS_LAST_RELOAD_REASON, JSON.stringify(payload));
    } catch (_) {}
    try {
      if (window.iuPwaReturnRecorder && typeof window.iuPwaReturnRecorder.ingestTrace === "function") {
        window.iuPwaReturnRecorder.ingestTrace("version_reload", detail || { reason: reason });
      }
    } catch (_) {}
  }

  function queuePendingReload(serverVer, bootVer, source) {
    try {
      sessionStorage.setItem(
        SS_PENDING_RELOAD,
        JSON.stringify({ serverVer: serverVer, bootVer: bootVer, source: source || "version_mismatch", t: Date.now() })
      );
    } catch (_) {}
    schedulePendingReloadRetry();
  }

  function schedulePendingReloadRetry() {
    if (pendingReloadTimer) return;
    pendingReloadTimer = setTimeout(function () {
      pendingReloadTimer = null;
      tryPendingReload();
    }, 800);
  }

  function tryPendingReload() {
    if (externalReturnBlocksDeployReload()) {
      schedulePendingReloadRetry();
      return;
    }
    var pending = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(SS_PENDING_RELOAD) || "null");
    } catch (_) {
      pending = null;
    }
    if (!pending || !pending.serverVer) return;
    var bootVer = getBootVersion();
    if (shouldSkipReload(pending.serverVer, bootVer)) {
      try {
        sessionStorage.removeItem(SS_PENDING_RELOAD);
      } catch (_) {}
      return;
    }
    try {
      sessionStorage.removeItem(SS_PENDING_RELOAD);
    } catch (_) {}
    markReloadFor(pending.serverVer);
    noteReloadReason(pending.source || "version_mismatch_deferred", {
      serverVer: pending.serverVer,
      bootVer: bootVer,
      source: "pending",
    });
    safeReload();
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
        if (externalReturnBlocksDeployReload()) {
          queuePendingReload(getBootVersion(), getBootVersion(), "sw_deploy_deferred");
          return;
        }
        try {
          if (sessionStorage.getItem(SS_SW_DEPLOY_RELOAD) === "1") return;
          sessionStorage.setItem(SS_SW_DEPLOY_RELOAD, "1");
        } catch (_) {}
        noteReloadReason("sw_deploy", { source: "IU_SW_DEPLOY_RELOAD" });
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
      if (shouldSkipReload(serverVer, bootVer)) {
        try {
          sessionStorage.removeItem(SS_PENDING_RELOAD);
        } catch (_) {}
        return;
      }
      if (externalReturnBlocksDeployReload()) {
        queuePendingReload(serverVer, bootVer, "version_mismatch");
        return;
      }
      try {
        if (sessionStorage.getItem(SS_SW_DEPLOY_RELOAD) === "1") return;
        sessionStorage.setItem(SS_SW_DEPLOY_RELOAD, "1");
      } catch (_) {}

      markReloadFor(serverVer);
      noteReloadReason("version_mismatch", { serverVer: serverVer, bootVer: bootVer, source: "checkVersion" });
      safeReload();
    } catch (_) {
      /* silent — stale shell is OK, reload loop is not */
    } finally {
      checking = false;
    }
  }

  function boot() {
    if (!isProjectsRoute()) return;
    if (window.__iuPwaInlineBoot) return;
    bindSwDeployReload();
    scheduleCheck();
    tryPendingReload();
    if (window.__iuPwaVersionEventsBound) return;
    window.__iuPwaVersionEventsBound = true;
    window.addEventListener("pageshow", function () {
      scheduleCheck();
      tryPendingReload();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        scheduleCheck();
        tryPendingReload();
        try {
          if (navigator.serviceWorker) {
            navigator.serviceWorker.getRegistration().then(function (reg) {
              if (reg) reg.update();
            });
          }
        } catch (_) {}
      }
    });
  }

  window.__iuPwaVersionCheck = boot;
  boot();
})();
