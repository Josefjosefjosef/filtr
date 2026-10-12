/**
 * PWA external-return recorder — local-only, metadata-only diagnostic log for iCentrum.
 * Does not trigger navigation, restore, or snapshot writes by itself.
 */
(function iuPwaReturnRecorderModule() {
  "use strict";

  var LOG_KEY = "iu:pwa-return-recorder-log:v1";
  var ACTIVE_KEY = "iu:pwa-return-recorder-active:v1";
  var PAGE_SID_KEY = "iu:pwa-return-recorder-page-sid:v1";
  var MAX_ENTRIES = 220;
  var MAX_JSON_CHARS = 480000;
  var pageSid = "";
  var hooksBound = false;
  var lastGate = "";
  var lastSection = "";
  var scrollLogTimer = null;

  function safeJsonParse(raw) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function readLogStore() {
    try {
      var raw = localStorage.getItem(LOG_KEY);
      if (!raw) {
        return { v: 1, seq: 0, entries: [], startedAt: null, stoppedAt: null };
      }
      var o = safeJsonParse(raw);
      if (!o || !Array.isArray(o.entries)) {
        return { v: 1, seq: 0, entries: [], startedAt: null, stoppedAt: null };
      }
      if (typeof o.seq !== "number") o.seq = o.entries.length;
      return o;
    } catch (_) {
      return { v: 1, seq: 0, entries: [], startedAt: null, stoppedAt: null };
    }
  }

  function writeLogStore(store) {
    try {
      while (store.entries.length > MAX_ENTRIES) store.entries.shift();
      var txt = JSON.stringify(store);
      while (txt.length > MAX_JSON_CHARS && store.entries.length > 1) {
        store.entries.shift();
        txt = JSON.stringify(store);
      }
      localStorage.setItem(LOG_KEY, txt);
    } catch (_) {}
  }

  function appVersionLabel() {
    try {
      var meta = document.querySelector('meta[name="iu-build"]');
      if (meta) return String(meta.getAttribute("content") || "").trim();
    } catch (_) {}
    try {
      if (window.iuNetwork && window.iuNetwork.pwaExternalReturnBuildId) {
        return String(window.iuNetwork.pwaExternalReturnBuildId);
      }
    } catch (_) {}
    return "unknown";
  }

  function sanitizeUrl(raw) {
    var u = String(raw || "").trim();
    if (!u) return "";
    try {
      if (/^mailto:/i.test(u) || /^tel:/i.test(u)) return u.split(":")[0] + ":[redacted]";
      var parsed = new URL(u, location.href);
      if (parsed.origin === location.origin) {
        var section = parsed.searchParams.get("section") || "";
        var topic = parsed.searchParams.get("topic") || "";
        return (
          parsed.origin +
          parsed.pathname +
          (section ? "?section=" + section : "") +
          (topic ? (section ? "&" : "?") + "topic=" + topic : "") +
          (parsed.hash || "")
        );
      }
      return parsed.origin + parsed.pathname;
    } catch (_) {
      return "[url]";
    }
  }

  function hubSectionFromUrl() {
    try {
      var u = new URL(location.href);
      return String(u.searchParams.get("section") || u.searchParams.get("panel") || "");
    } catch (_) {
      return "";
    }
  }

  function viewSnapshot() {
    var wrap = document.getElementById("iuMobileGateWrap");
    var gate = wrap ? String(wrap.getAttribute("data-iu-mobile-gate") || "") : "";
    var nav = document.getElementById("iuMobileGatePanelNav");
    var tools = document.getElementById("iuMobileGatePanelTools");
    var mainY = 0;
    try {
      if (typeof window.iuPwaGetMainScrollY === "function") mainY = window.iuPwaGetMainScrollY();
      else mainY = window.scrollY || 0;
    } catch (_) {}
    var pendingMeta = null;
    try {
      var pendingRaw = localStorage.getItem("iuMindMenuReturnPendingV1");
      if (pendingRaw) {
        var p = safeJsonParse(pendingRaw);
        if (p && typeof p === "object") {
          pendingMeta = {
            keys: Object.keys(p),
            gate: p.gate != null ? p.gate : null,
            scrollY: typeof p.scrollY === "number" ? p.scrollY : null,
            t: typeof p.t === "number" ? p.t : null,
          };
        } else {
          pendingMeta = { len: pendingRaw.length };
        }
      }
    } catch (_) {}
    return {
      pageSid: pageSid,
      href: sanitizeUrl(location.href),
      hash: String(location.hash || ""),
      hubSection: hubSectionFromUrl(),
      gate: gate,
      body: {
        mobileGateOpen: !!(document.body && document.body.classList.contains("iu-mobileGateOverlayOpen")),
        mindMenuOpen: !!(document.body && document.body.classList.contains("iu-myinfouzel-open")),
        mmReturnBoot: document.documentElement.classList.contains("iu-mm-return-boot"),
      },
      scroll: {
        mainY: Math.round(mainY),
        nav: nav ? nav.scrollTop : null,
        tools: tools ? tools.scrollTop : null,
      },
      session: {
        ext: sessionStorage.getItem("iu_external_nav_armed") || "",
        restoring: sessionStorage.getItem("iuPwaExternalReturnRestoringV1") || "",
        mainY: sessionStorage.getItem("iuPwaExternalReturnMainScrollY") || "",
        navArm: sessionStorage.getItem("iuMobileWebNavReturnArmed") || "",
        gateTab: sessionStorage.getItem("iuPwaExternalReturnGateTab") || "",
      },
      restoreActive: !!(window.iuNetwork && window.iuNetwork.isExternalReturnRestoreActive && window.iuNetwork.isExternalReturnRestoreActive()),
      pending: pendingMeta,
    };
  }

  function isRecording() {
    try {
      return localStorage.getItem(ACTIVE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function appendEntry(ev, detail, source) {
    if (!isRecording()) return;
    var store = readLogStore();
    store.seq = (store.seq || 0) + 1;
    var entry = {
      n: store.seq,
      t: Date.now(),
      ev: String(ev || ""),
      src: source || "recorder",
      detail: detail && typeof detail === "object" ? detail : {},
      view: viewSnapshot(),
    };
    store.entries.push(entry);
    writeLogStore(store);
  }

  function navigationEntryType() {
    try {
      var nav = performance.getEntriesByType("navigation");
      if (nav && nav[0] && nav[0].type) return String(nav[0].type);
    } catch (_) {}
    return "unknown";
  }

  function markPageSid() {
    try {
      pageSid = sessionStorage.getItem(PAGE_SID_KEY) || "";
      if (!pageSid) {
        pageSid = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        sessionStorage.setItem(PAGE_SID_KEY, pageSid);
      }
    } catch (_) {
      pageSid = "p-fallback";
    }
  }

  function onDocumentBoot() {
    markPageSid();
    if (!isRecording()) return;
    appendEntry(
      "document:boot",
      {
        navType: navigationEntryType(),
        sameTabSession: true,
        appVersion: appVersionLabel(),
      },
      "boot"
    );
  }

  function startRecording() {
    try {
      localStorage.setItem(ACTIVE_KEY, "1");
    } catch (_) {}
    var store = readLogStore();
    if (!store.startedAt) store.startedAt = Date.now();
    store.stoppedAt = null;
    store.appVersion = appVersionLabel();
    writeLogStore(store);
    appendEntry("recorder:start", { appVersion: appVersionLabel() }, "ui");
    bindHooks();
    scheduleScrollSample(true);
  }

  function stopRecording() {
    appendEntry("recorder:stop", {}, "ui");
    try {
      localStorage.setItem(ACTIVE_KEY, "0");
    } catch (_) {}
    var store = readLogStore();
    store.stoppedAt = Date.now();
    writeLogStore(store);
  }

  function clearLog() {
    var wasRecording = isRecording();
    try {
      localStorage.removeItem(LOG_KEY);
    } catch (_) {}
    if (wasRecording) {
      var store = {
        v: 1,
        seq: 0,
        entries: [],
        startedAt: Date.now(),
        stoppedAt: null,
        appVersion: appVersionLabel(),
      };
      writeLogStore(store);
      appendEntry("recorder:cleared", {}, "ui");
    }
  }

  function exportText() {
    var store = readLogStore();
    var payload = {
      exportedAt: Date.now(),
      recording: isRecording(),
      appVersion: appVersionLabel(),
      pwaReturnBuildId: window.iuNetwork && window.iuNetwork.pwaExternalReturnBuildId,
      pageSid: pageSid,
      log: store,
    };
    return JSON.stringify(payload, null, 2);
  }

  function copyLog() {
    var txt = exportText();
    return Promise.resolve()
      .then(function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(txt);
        }
        throw new Error("no_clipboard");
      })
      .catch(function () {
        var ta = document.createElement("textarea");
        ta.value = txt;
        ta.setAttribute("readonly", "readonly");
        ta.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
          document.execCommand("copy");
        } catch (_) {}
        ta.remove();
        return undefined;
      });
  }

  function ingestTrace(tag, detail) {
    if (!isRecording()) return;
    appendEntry("trace:" + String(tag || ""), detail || {}, "iuNetwork");
  }

  function wrapFn(fnName, evName) {
    try {
      var cur = window[fnName];
      if (typeof cur !== "function" || cur.__iuPwaRecWrap) return;
      window[fnName] = function () {
        var argsSummary = [];
        try {
          for (var i = 0; i < arguments.length && i < 3; i++) {
            if (typeof arguments[i] === "string") argsSummary.push(sanitizeUrl(arguments[i]).slice(0, 120));
            else if (arguments[i] && typeof arguments[i] === "object") argsSummary.push(Object.keys(arguments[i]).slice(0, 8));
            else argsSummary.push(String(arguments[i]).slice(0, 40));
          }
        } catch (_) {}
        appendEntry(evName || "fn:" + fnName, { args: argsSummary, fn: fnName }, "wrap");
        return cur.apply(this, arguments);
      };
      window[fnName].__iuPwaRecWrap = true;
    } catch (_) {}
  }

  function patchNetwork() {
    try {
      if (!window.iuNetwork || window.iuNetwork.__iuPwaRecPatched) return;
      var net = window.iuNetwork;
      ["openExternalSync", "openExternalUrl", "armExternalReturn", "restoreAppShellAfterReturn", "cancelExternalReturnRestore"].forEach(
        function (name) {
          if (typeof net[name] !== "function" || net[name].__iuPwaRecWrap) return;
          var orig = net[name];
          net[name] = function () {
            var arg0 = arguments[0];
            var detail = { fn: name };
            if (name === "openExternalSync" || name === "openExternalUrl") {
              detail.url = sanitizeUrl(arg0);
            }
            if (name === "cancelExternalReturnRestore") detail.reason = String(arg0 || "");
            appendEntry("net:" + name, detail, "iuNetwork");
            return orig.apply(this, arguments);
          };
          net[name].__iuPwaRecWrap = true;
        }
      );
      net.__iuPwaRecPatched = true;
    } catch (_) {}
  }

  function observeGate() {
    var wrap = document.getElementById("iuMobileGateWrap");
    if (!wrap || wrap.__iuPwaRecObs) return;
    wrap.__iuPwaRecObs = true;
    lastGate = String(wrap.getAttribute("data-iu-mobile-gate") || "");
    try {
      var mo = new MutationObserver(function () {
        var g = String(wrap.getAttribute("data-iu-mobile-gate") || "");
        if (g === lastGate) return;
        appendEntry(
          "view:gate",
          { from: lastGate, to: g, via: "mutation:data-iu-mobile-gate" },
          "observer"
        );
        lastGate = g;
      });
      mo.observe(wrap, { attributes: true, attributeFilter: ["data-iu-mobile-gate"] });
    } catch (_) {}
  }

  function scheduleScrollSample(force) {
    if (!isRecording()) return;
    if (scrollLogTimer) return;
    scrollLogTimer = setTimeout(function () {
      scrollLogTimer = null;
      var snap = viewSnapshot();
      appendEntry("scroll:sample", { scroll: snap.scroll, gate: snap.gate, hubSection: snap.hubSection }, "scroll");
      if (force) scheduleScrollSample(false);
    }, force ? 0 : 280);
  }

  function bindLifecycleEvents() {
    if (window.__iuPwaRecLifecycle) return;
    window.__iuPwaRecLifecycle = true;
    var lifecycleNames = ["visibilitychange", "pageshow", "pagehide", "focus", "blur", "popstate", "hashchange"];
    lifecycleNames.forEach(function (name) {
      var target = name === "visibilitychange" ? document : window;
      target.addEventListener(
        name,
        function (ev) {
          if (!isRecording()) return;
          var detail = {
            vis: document.visibilityState,
            persisted: !!(ev && ev.persisted),
            hash: String(location.hash || ""),
            href: sanitizeUrl(location.href),
          };
          appendEntry("life:" + name, detail, "life");
          if (name === "pageshow" && ev && ev.persisted) {
            appendEntry("document:bfcache_restore", { navType: "back_forward_cache" }, "life");
          }
        },
        true
      );
    });
    document.addEventListener(
      "click",
      function (e) {
        if (!isRecording()) return;
        var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
        if (!a) return;
        var href = String(a.getAttribute("href") || "").trim();
        if (!/^https?:\/\//i.test(href)) return;
        if (isSameOriginHttp(href)) return;
        appendEntry(
          "click:external_link",
          {
            url: sanitizeUrl(href),
            inMenu: !!(a.closest && a.closest("#iuMobileGatePanelNav")),
            inMindMenu: !!(a.closest && a.closest(".mindMenu")),
            handler: "capture:click",
          },
          "click"
        );
      },
      true
    );
  }

  function isSameOriginHttp(url) {
    try {
      return new URL(url, location.href).origin === location.origin;
    } catch (_) {
      return false;
    }
  }

  function bindHooks() {
    if (hooksBound) return;
    hooksBound = true;
    patchNetwork();
    observeGate();
    bindLifecycleEvents();
    [
      "iuMindMenuArmReturnState",
      "iuMindMenuRestoreIfArmed",
      "iuMenuNavCaptureScroll",
      "iuMobileWebNavArmForExternalFromMenu",
      "iuMobileWebNavSyncFromHistory",
      "iuMindMenuSyncGateFromHistory",
    ].forEach(function (name) {
      wrapFn(name, "fn:" + name);
    });
    var poll = 0;
    var pollId = setInterval(function () {
      poll += 1;
      patchNetwork();
      [
        "iuMindMenuArmReturnState",
        "iuMindMenuRestoreIfArmed",
        "iuMenuNavCaptureScroll",
        "iuMobileWebNavArmForExternalFromMenu",
        "iuMobileWebNavSyncFromHistory",
        "iuMindMenuSyncGateFromHistory",
      ].forEach(function (name) {
        wrapFn(name, "fn:" + name);
      });
      observeGate();
      if (poll >= 24) clearInterval(pollId);
    }, 400);
    lastSection = hubSectionFromUrl();
    window.addEventListener("popstate", function () {
      if (!isRecording()) return;
      var sec = hubSectionFromUrl();
      if (sec !== lastSection) {
        appendEntry("view:hub_section", { from: lastSection, to: sec, via: "popstate" }, "history");
        lastSection = sec;
      }
    });
    window.addEventListener(
      "scroll",
      function () {
        scheduleScrollSample(false);
      },
      { passive: true, capture: true }
    );
    ["iuMobileGatePanelNav", "iuMobileGatePanelTools"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(
        "scroll",
        function () {
          scheduleScrollSample(false);
        },
        { passive: true }
      );
    });
  }

  function refreshIcentrumPanel(root) {
    var panel = root || document.getElementById("iuInfoCenterDetailPwaDiag");
    if (!panel) return;
    var ver = panel.querySelector("[data-iu-pwa-diag-version]");
    var state = panel.querySelector("[data-iu-pwa-diag-state]");
    if (ver) ver.textContent = appVersionLabel();
    if (state) {
      state.textContent = isRecording() ? "Záznam probíhá" : "Záznam vypnutý";
      state.setAttribute("data-recording", isRecording() ? "1" : "0");
    }
  }

  function bindIcentrumPanel() {
    var panel = document.getElementById("iuInfoCenterDetailPwaDiag");
    if (!panel || panel.__iuPwaDiagBound) return;
    panel.__iuPwaDiagBound = true;
    var startBtn = document.getElementById("iuPwaDiagStartBtn");
    var stopBtn = document.getElementById("iuPwaDiagStopBtn");
    var copyBtn = document.getElementById("iuPwaDiagCopyBtn");
    var clearBtn = document.getElementById("iuPwaDiagClearBtn");
    var copyStatus = document.getElementById("iuPwaDiagCopyStatus");
    if (startBtn) {
      startBtn.addEventListener("click", function () {
        startRecording();
        refreshIcentrumPanel(panel);
      });
    }
    if (stopBtn) {
      stopBtn.addEventListener("click", function () {
        stopRecording();
        refreshIcentrumPanel(panel);
      });
    }
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        void copyLog().then(function () {
          if (copyStatus) {
            copyStatus.textContent = "Zkopírováno do schránky (nebo vyberte text v poli níže).";
            copyStatus.hidden = false;
          }
        });
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        try {
          localStorage.removeItem(LOG_KEY);
        } catch (_) {}
        if (copyStatus) copyStatus.hidden = true;
        refreshIcentrumPanel(panel);
      });
    }
    refreshIcentrumPanel(panel);
  }

  window.iuPwaReturnRecorder = {
    startRecording: startRecording,
    stopRecording: stopRecording,
    clearLog: clearLog,
    copyLog: copyLog,
    exportText: exportText,
    isRecording: isRecording,
    ingestTrace: ingestTrace,
    refreshIcentrumPanel: refreshIcentrumPanel,
    bindIcentrumPanel: bindIcentrumPanel,
    getViewSnapshot: viewSnapshot,
  };

  onDocumentBoot();
  if (isRecording()) bindHooks();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindIcentrumPanel, { once: true });
  } else {
    bindIcentrumPanel();
  }
})();
