/**
 * PWA external-return recorder — local-only, metadata-only diagnostic log for iCentrum.
 * Does not trigger navigation, restore, or snapshot writes by itself.
 */
(function iuPwaReturnRecorderModule() {
  "use strict";

  var RECORDER_BUILD_ID = "pwa-return-recorder-v9-20261015-export114-115-fixes";
  var LAST_SETTLE_KEY = "iu:pwa:return-recorder:last-settle:v1";
  var LAST_HANDOFF_KEY = "iu:pwa:return-recorder:last-handoff:v1";
  var CRITICAL_WINDOW_ANCHOR_KEY = "iu:pwa:return-recorder:critical-window-anchor:v1";
  var returnMilestoneCleanups = [];
  var lastSettleAtMs = 0;
  var lastHandoffAtMs = 0;
  var attemptStartedAtMs = 0;
  var sectionApplyOpSeq = 0;
  var ATTEMPT_KEY = "iu:pwa:return-recorder-attempt:v1";
  var CORRELATION_KEY = "iu:pwa:return-recorder-correlation:v1";
  var navActionSeq = 0;
  var LOG_KEY = "iu:pwa-return-recorder-log:v1";
  var ACTIVE_KEY = "iu:pwa-return-recorder-active:v1";
  var TAB_SESSION_KEY = "iu:pwa-return-recorder-tab-sid:v1";
  var DOCUMENT_SID_KEY = "iu:pwa-return-recorder-document-sid:v1";
  var DOC_BOOT_SEQ_KEY = "iu:pwa-return-recorder-doc-boot-seq:v1";
  var MAX_ENTRIES = 420;
  var MAX_JSON_CHARS = 640000;
  var netFetchAggWindowMs = 900;
  var lastNetFetchAgg = null;
  var origWindowFetch = null;
  var SCROLL_LOG_MIN_INTERVAL_MS = 900;
  var tabSessionSid = "";
  var documentSid = "";
  var documentBootSeq = 0;
  var pageSid = "";
  var hooksBound = false;
  var lastGate = "";
  var lastSection = "";
  var scrollLogTimer = null;
  var lastScrollLogAt = 0;
  var paintBurstLock = false;
  var returnOpSeq = 0;
  var sectionOpenSeq = 0;
  var externalHandoffSeq = 0;
  var activeReturnOpId = "";
  var activeSectionOpenId = "";
  var diagCleanups = [];
  var diagPerfObservers = [];
  var diagPointerSession = null;
  var diagResourceCounts = { observers: 0, listeners: 0, intervals: 0, fetchWrap: 0 };
  var STORAGE_WATCH = {
    session: [
      "iu_external_nav_armed",
      "iuPwaExternalReturnRestoringV1",
      "iuPwaExternalReturnMainScrollY",
      "iuPwaExternalReturnMainScrollPersistV1",
      "iuMobileWebNavReturnArmed",
      "iuPwaExternalReturnGateTab",
      "iuMindMenuReturnArmed",
      "iuMindMenuReturnLatchTs",
      "iuPwaExternalReturnHubSectionAtArm",
      "iuPwaExternalReturnHoldUntil",
      "iuPwaExternalReturnVersionDeferUntil",
      "iu:pwa:ver:pending-reload",
      "iu:pwa:ver:last-reload-reason",
    ],
    local: ["iuMindMenuReturnPendingV1", "iuPwaExternalReturnMainScrollPersistV1"],
  };

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

  function activeAttemptId() {
    try {
      return sessionStorage.getItem(ATTEMPT_KEY) || "";
    } catch (_) {
      return "";
    }
  }

  function entryEvictTier(ev) {
    var e = String(ev || "");
    if (/^recorder:(start|stop)/.test(e)) return -1;
    if (/^document:boot/.test(e)) return -1;
    if (/^trace:(external_handoff|restore_start|settle_done)/.test(e)) return -1;
    if (/^(nav:(intent|reload|replace|history_go)|back:click|gate:setTab)/.test(e)) return -1;
    if (/^section:(open_start|apply_start|content_ready|content_timeout|content_cancelled)/.test(e)) return -1;
    if (/^attempt:milestone/.test(e)) return -1;
    if (/^layout:geometry/.test(e)) return 4;
    if (/^view:frame/.test(e)) return 3;
    if (/^net:fetch_done/.test(e)) return 3;
    if (/^scroll:sample/.test(e)) return 2;
    if (/^life:/.test(e)) return 2;
    return 1;
  }

  var criticalWindowAnchorAtMs = 0;

  function getCriticalWindowAnchorMs() {
    if (criticalWindowAnchorAtMs > 0) return criticalWindowAnchorAtMs;
    try {
      var raw = sessionStorage.getItem(CRITICAL_WINDOW_ANCHOR_KEY);
      var n = parseInt(raw || "0", 10);
      if (n > 0) criticalWindowAnchorAtMs = n;
    } catch (_) {}
    return criticalWindowAnchorAtMs || lastSettleAtMs || 0;
  }

  function inReturnCriticalWindow() {
    var anchor = getCriticalWindowAnchorMs();
    if (!anchor) return false;
    return Date.now() - anchor < 120000;
  }

  function touchCriticalWindowAnchor() {
    var now = Date.now();
    var prev = getCriticalWindowAnchorMs();
    if (!prev || now - prev >= 120000) {
      criticalWindowAnchorAtMs = now;
      try {
        sessionStorage.setItem(CRITICAL_WINDOW_ANCHOR_KEY, String(now));
      } catch (_) {}
    }
  }

  function findEvictIndex(entries, cur) {
    if (!entries || !entries.length) return -1;
    for (var i = 0; i < entries.length; i++) {
      var ea = entries[i].attemptId || "";
      if (ea && cur && ea !== cur) return i;
    }
    var bestIdx = -1;
    var bestTier = -1;
    for (var j = 0; j < entries.length; j++) {
      var tier = entryEvictTier(entries[j].ev);
      if (tier < 0) continue;
      if (inReturnCriticalWindow() && tier >= 3 && (entries[j].attemptId || "") === cur) continue;
      if (tier > bestTier) {
        bestTier = tier;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0) return bestIdx;
    for (var k = 0; k < entries.length; k++) {
      if (entryEvictTier(entries[k].ev) >= 0) return k;
    }
    return 0;
  }

  function evictOneLogEntry(store) {
    var cur = activeAttemptId() || store.recordingAttemptId || "";
    var idx = findEvictIndex(store.entries, cur);
    if (idx < 0) return;
    var removed = store.entries.splice(idx, 1)[0];
    store.droppedEntries = (store.droppedEntries || 0) + 1;
    if (!store.droppedByEv) store.droppedByEv = {};
    var evKey = removed && removed.ev ? String(removed.ev) : "unknown";
    store.droppedByEv[evKey] = (store.droppedByEv[evKey] || 0) + 1;
    var ea = removed && removed.attemptId ? removed.attemptId : "";
    if (ea && cur && ea !== cur) {
      store.droppedOtherAttempts = (store.droppedOtherAttempts || 0) + 1;
    } else {
      store.droppedCurrentAttempt = (store.droppedCurrentAttempt || 0) + 1;
      if (removed && removed.detail && removed.detail.aggregatedFrom) {
        store.droppedAggregatedUnits = (store.droppedAggregatedUnits || 0) + (removed.detail.aggregatedFrom - 1);
      }
    }
  }

  function persistCorrelationState() {
    try {
      var attemptId = activeAttemptId();
      if (!attemptId) return;
      sessionStorage.setItem(
        CORRELATION_KEY,
        JSON.stringify({
          attemptId: attemptId,
          returnOpSeq: returnOpSeq,
          externalHandoffSeq: externalHandoffSeq,
          activeReturnOpId: activeReturnOpId,
          activeSectionOpenId: activeSectionOpenId,
          sectionOpenSeq: sectionOpenSeq,
          tabSessionSid: tabSessionSid,
        })
      );
    } catch (_) {}
  }

  function restoreCorrelationState() {
    try {
      var attemptId = activeAttemptId();
      if (!attemptId) return null;
      var raw = sessionStorage.getItem(CORRELATION_KEY);
      if (!raw) return null;
      var o = safeJsonParse(raw);
      if (!o || o.attemptId !== attemptId) return null;
      returnOpSeq = typeof o.returnOpSeq === "number" ? o.returnOpSeq : returnOpSeq;
      externalHandoffSeq = typeof o.externalHandoffSeq === "number" ? o.externalHandoffSeq : externalHandoffSeq;
      activeReturnOpId = o.activeReturnOpId || activeReturnOpId;
      activeSectionOpenId = o.activeSectionOpenId || activeSectionOpenId;
      sectionOpenSeq = typeof o.sectionOpenSeq === "number" ? o.sectionOpenSeq : sectionOpenSeq;
      return o;
    } catch (_) {
      return null;
    }
  }

  function composeReturnOpId() {
    var attemptId = activeAttemptId() || "attempt";
    var shortA = attemptId.length > 10 ? attemptId.slice(-10) : attemptId;
    return shortA + ":ret" + returnOpSeq;
  }

  function composeHandoffId() {
    var attemptId = activeAttemptId() || "attempt";
    var shortA = attemptId.length > 10 ? attemptId.slice(-10) : attemptId;
    return shortA + ":ext" + externalHandoffSeq;
  }

  function composeSectionOpenId() {
    return (documentSid || "doc") + ":secopen" + sectionOpenSeq;
  }

  function writeLogStore(store) {
    try {
      if (typeof store.droppedEntries !== "number") store.droppedEntries = 0;
      while (store.entries.length > MAX_ENTRIES) {
        evictOneLogEntry(store);
      }
      var txt = JSON.stringify(store);
      while (txt.length > MAX_JSON_CHARS && store.entries.length > 1) {
        evictOneLogEntry(store);
        txt = JSON.stringify(store);
      }
      if (txt.length >= MAX_JSON_CHARS) store.truncatedExportLikely = true;
      localStorage.setItem(LOG_KEY, txt);
    } catch (_) {}
  }

  function monoNow() {
    try {
      return Math.round(performance.now() * 1000) / 1000;
    } catch (_) {
      return 0;
    }
  }

  function buildMetricCapabilities() {
    var out = {
      quality: "measured",
      performanceObserver: typeof PerformanceObserver !== "undefined",
      supportedEntryTypes: [],
      unsupportedEntryTypes: [],
      memoryApi: typeof performance !== "undefined" && !!performance.memory,
      eventTiming: "unavailable",
      longAnimationFrames: "unavailable",
      resourceTiming: typeof performance !== "undefined" && typeof performance.getEntriesByType === "function",
      visualViewport: typeof window.visualViewport !== "undefined",
      serviceWorker: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    };
    var types = ["layout-shift", "largest-contentful-paint", "longtask", "event", "navigation", "long-animation-frame"];
    for (var i = 0; i < types.length; i++) {
      var ty = types[i];
      try {
        if (out.performanceObserver && PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.indexOf(ty) >= 0) {
          out.supportedEntryTypes.push(ty);
        } else {
          out.unsupportedEntryTypes.push(ty);
        }
      } catch (_) {
        out.unsupportedEntryTypes.push(ty);
      }
    }
    if (out.supportedEntryTypes.indexOf("event") >= 0) out.eventTiming = "supported";
    if (out.supportedEntryTypes.indexOf("long-animation-frame") >= 0) out.longAnimationFrames = "supported";
    return out;
  }

  function scrollContainerMetrics() {
    var root = document.getElementById("leftContent");
    var useRoot = false;
    try {
      if (root && root.clientHeight > 0 && root.scrollHeight > root.clientHeight + 1) {
        var st = getComputedStyle(root);
        if (st.overflowY === "auto" || st.overflowY === "scroll") useRoot = true;
      }
    } catch (_) {}
    var doc = useRoot ? root : document.scrollingElement || document.documentElement;
    var viewH = useRoot ? root.clientHeight : window.innerHeight || 0;
    try {
      var vv = window.visualViewport;
      if (!useRoot && vv && vv.height) viewH = Math.max(viewH, Math.round(vv.height));
    } catch (_) {}
    var scrollY = 0;
    try {
      scrollY = typeof window.iuPwaGetMainScrollY === "function" ? window.iuPwaGetMainScrollY() : window.scrollY || 0;
    } catch (_) {}
    var maxY = 0;
    try {
      maxY = typeof window.iuPwaMainScrollMaxY === "function" ? window.iuPwaMainScrollMaxY() : 0;
    } catch (_) {
      if (doc) maxY = Math.max(0, doc.scrollHeight - viewH);
    }
    var vvSnap = null;
    try {
      var vv2 = window.visualViewport;
      if (vv2) {
        vvSnap = {
          pageTop: Math.round(vv2.pageTop || 0),
          offsetTop: Math.round(vv2.offsetTop || 0),
          offsetLeft: Math.round(vv2.offsetLeft || 0),
          h: Math.round(vv2.height || 0),
          w: Math.round(vv2.width || 0),
          scale: vv2.scale,
        };
      }
    } catch (_) {}
    var scrollRestoration = "unavailable";
    try {
      scrollRestoration = history.scrollRestoration || "unknown";
    } catch (_) {}
    return {
      container: useRoot ? "leftContent" : "document",
      scrollY: Math.round(scrollY),
      scrollTop: doc ? Math.round(doc.scrollTop || 0) : 0,
      scrollHeight: doc ? doc.scrollHeight : 0,
      clientHeight: doc ? doc.clientHeight : 0,
      maxY: Math.round(maxY),
      vv: vvSnap,
      scrollRestoration: scrollRestoration,
      activeElement: document.activeElement && document.activeElement.id ? document.activeElement.id : "",
    };
  }

  function correlationPayload(extra) {
    var now = Date.now();
    var o = {
      recordingAttemptId: activeAttemptId(),
      documentSid: documentSid,
      documentBootSeq: documentBootSeq,
      returnOpId: activeReturnOpId || "",
      sectionOpenId: activeSectionOpenId || "",
      handoffId: externalHandoffSeq ? composeHandoffId() : "",
      monoMs: monoNow(),
      attemptElapsedMs: attemptStartedAtMs ? now - attemptStartedAtMs : null,
      msSinceLastSettle: lastSettleAtMs ? now - lastSettleAtMs : null,
      msSinceLastHandoff: lastHandoffAtMs ? now - lastHandoffAtMs : null,
    };
    if (extra && typeof extra === "object") {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k];
      }
    }
    return o;
  }

  function registerDiagCleanup(fn) {
    if (typeof fn === "function") diagCleanups.push(fn);
  }

  function teardownDiagSession() {
    var before = {
      observers: diagResourceCounts.observers,
      listeners: diagResourceCounts.listeners,
      intervals: diagResourceCounts.intervals,
      fetchWrap: diagResourceCounts.fetchWrap,
    };
    while (diagCleanups.length) {
      try {
        var fn = diagCleanups.pop();
        fn();
      } catch (_) {}
    }
    diagPerfObservers = [];
    diagPointerSession = null;
    lastNetFetchAgg = null;
    var after = {
      observers: diagResourceCounts.observers,
      listeners: diagResourceCounts.listeners,
      intervals: diagResourceCounts.intervals,
      fetchWrap: diagResourceCounts.fetchWrap,
    };
    if (isRecording()) {
      appendEntry(
        "recorder:teardown",
        {
          resourceCountsBefore: before,
          resourceCountsAfter: after,
          idleHooksRemain: after.listeners,
          idleHookKinds: [
            "pointerdown_move_up_wheel_key (user input, removed on teardown)",
            "serviceWorker controllerchange (passive, cleanup noop)",
          ],
          quality: "measured",
        },
        "diag"
      );
    }
  }

  function bindScrollApplyWrap() {
    try {
      var cur = window.iuPwaApplyMainScrollY;
      if (typeof cur !== "function" || cur.__iuPwaRecScrollApply) return;
      window.iuPwaApplyMainScrollY = function (y) {
        var before = scrollContainerMetrics();
        var rv = cur.apply(this, arguments);
        var after = scrollContainerMetrics();
        if (isRecording()) {
          appendEntry(
            "scroll:apply",
            {
              quality: "measured",
              origin: "iuPwaApplyMainScrollY",
              requestedY: Math.round(Number(y) || 0),
              beforeY: before.scrollY,
              afterY: after.scrollY,
              maxY: after.maxY,
              container: after.container,
              vv: after.vv,
              correlation: correlationPayload(),
            },
            "scroll"
          );
        }
        return rv;
      };
      window.iuPwaApplyMainScrollY.__iuPwaRecScrollApply = true;
    } catch (_) {}
  }

  function bindUserInputSignals() {
    var down = false;
    var startX = 0;
    var startY = 0;
    var moved = false;
    function onPointerDown(e) {
      if (!isRecording()) return;
      down = true;
      moved = false;
      startX = e.clientX || 0;
      startY = e.clientY || 0;
      diagPointerSession = { t: Date.now(), type: e.pointerType || "unknown" };
    }
    function onPointerMove(e) {
      if (!down || !isRecording()) return;
      var dx = (e.clientX || 0) - startX;
      var dy = (e.clientY || 0) - startY;
      if (dx * dx + dy * dy > 64) moved = true;
    }
    function onPointerUp() {
      if (!isRecording() || !down) return;
      down = false;
      if (moved) {
        appendEntry(
          "input:user_scroll_intent",
          { quality: "estimated", via: "pointer_move", correlation: correlationPayload() },
          "input"
        );
      }
      diagPointerSession = null;
    }
    function onWheel() {
      if (!isRecording()) return;
      appendEntry("input:user_scroll_intent", { quality: "measured", via: "wheel", correlation: correlationPayload() }, "input");
    }
    function onKey(e) {
      if (!isRecording()) return;
      var k = e.key || "";
      if (k === "ArrowUp" || k === "ArrowDown" || k === "PageUp" || k === "PageDown" || k === "Home" || k === "End" || k === " ") {
        appendEntry("input:user_scroll_intent", { quality: "measured", via: "key", key: k, correlation: correlationPayload() }, "input");
      }
    }
    window.addEventListener("pointerdown", onPointerDown, { passive: true, capture: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true, capture: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true, capture: true });
    window.addEventListener("wheel", onWheel, { passive: true, capture: true });
    window.addEventListener("keydown", onKey, true);
    diagResourceCounts.listeners += 5;
    registerDiagCleanup(function () {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("keydown", onKey, true);
      diagResourceCounts.listeners = Math.max(0, diagResourceCounts.listeners - 5);
    });
  }

  function bindPerfObservers() {
    if (typeof PerformanceObserver === "undefined") return;
    var caps = buildMetricCapabilities();
    function observeType(type, evName, mapFn) {
      if (caps.supportedEntryTypes.indexOf(type) < 0) return;
      try {
        var po = new PerformanceObserver(function (list) {
          if (!isRecording()) return;
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            var mapped = mapFn(entries[i]);
            if (mapped) appendEntry(evName, mapped, "perf");
          }
        });
        po.observe({ type: type, buffered: true });
        diagPerfObservers.push(po);
        diagResourceCounts.observers += 1;
        registerDiagCleanup(function () {
          try {
            po.disconnect();
          } catch (_) {}
        });
      } catch (_) {}
    }
    observeType("largest-contentful-paint", "perf:lcp", function (e) {
      return {
        quality: "measured",
        size: e.size,
        startTime: Math.round(e.startTime),
        renderTime: Math.round(e.renderTime || 0),
        id: e.id || "",
        url: e.url ? sanitizeUrl(e.url) : "",
        visibility: document.visibilityState || "unknown",
        correlation: correlationPayload(),
      };
    });
    observeType("longtask", "perf:longtask", function (e) {
      if (e.duration < 50) return null;
      return {
        quality: "measured",
        duration: Math.round(e.duration),
        startTime: Math.round(e.startTime),
        name: e.name || "",
        correlation: correlationPayload(),
      };
    });
    observeType("event", "perf:event_timing", function (e) {
      if (e.name !== "click" && e.name !== "keydown" && e.name !== "pointerdown") return null;
      return {
        quality: "measured",
        name: e.name,
        duration: Math.round(e.duration || 0),
        startTime: Math.round(e.startTime),
        processingStart: Math.round(e.processingStart || 0),
        processingEnd: Math.round(e.processingEnd || 0),
        note: "not_inp_label",
        correlation: correlationPayload(),
      };
    });
  }

  function bindServiceWorkerDiag() {
    try {
      if (!navigator.serviceWorker) return;
      function logSw(state) {
        if (!isRecording()) return;
        appendEntry(
          "sw:state",
          {
            quality: "measured",
            controller: !!(navigator.serviceWorker.controller),
            state: state || "",
            correlation: correlationPayload(),
          },
          "sw"
        );
      }
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        logSw("controllerchange");
      });
      diagResourceCounts.listeners += 1;
      registerDiagCleanup(function () {});
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (!reg || !isRecording()) return;
        appendEntry(
          "sw:registration",
          {
            quality: "measured",
            scope: reg.scope ? sanitizeUrl(reg.scope) : "",
            active: !!(reg.active && reg.active.state),
            waiting: !!(reg.waiting && reg.waiting.state),
            installing: !!(reg.installing && reg.installing.state),
            correlation: correlationPayload(),
          },
          "sw"
        );
      });
    } catch (_) {}
  }

  function bindFetchTiming() {
    try {
      var cur = window.fetch;
      if (typeof cur !== "function" || cur.__iuPwaRecFetch) return;
      if (!origWindowFetch) origWindowFetch = cur;
      var netReqSeq = 0;
      window.fetch = function (input, init) {
        var url = typeof input === "string" ? input : input && input.url ? input.url : "";
        var same = false;
        try {
          same = new URL(url, location.href).origin === location.origin;
        } catch (_) {}
        var t0 = monoNow();
        netReqSeq += 1;
        var reqId = "fetch" + netReqSeq;
        var p = cur.apply(this, arguments);
        if (!isRecording() || !same) return p;
        return p.then(
          function (res) {
            var rt = null;
            try {
              rt = resourceTimingBrief(typeof url === "string" ? url : String(url));
            } catch (_) {}
            appendEntry(
              "net:fetch_done",
              {
                quality: "measured",
                url: sanitizeUrl(url),
                status: res.status,
                ms: Math.round((monoNow() - t0) * 1000) / 1000,
                cache: rt && rt.transferSize === 0 && rt.decodedBodySize === 0 ? "unknown" : "network_or_cache_api",
                reqId: reqId,
                opId: activeReturnOpId || "",
                cancelled: false,
                resourceTiming: rt,
                correlation: correlationPayload({ reqId: reqId }),
              },
              "net"
            );
            return res;
          },
          function (err) {
            appendEntry(
              "net:fetch_error",
              {
                quality: "measured",
                url: sanitizeUrl(url),
                ms: Math.round((monoNow() - t0) * 1000) / 1000,
                reqId: reqId,
                opId: activeReturnOpId || "",
                errType: err && err.name ? String(err.name) : "Error",
                err: String(err && err.message ? err.message : err).slice(0, 80),
                docHidden: document.visibilityState === "hidden",
                externalArmed: (function () {
                  try {
                    return sessionStorage.getItem("iu_external_nav_armed") === "1";
                  } catch (_) {
                    return false;
                  }
                })(),
                duringPageHide: document.visibilityState !== "visible",
                correlation: correlationPayload({ reqId: reqId }),
              },
              "net"
            );
            throw err;
          }
        );
      };
      window.fetch.__iuPwaRecFetch = true;
      diagResourceCounts.fetchWrap = 1;
      registerDiagCleanup(function () {
        try {
          if (origWindowFetch && window.fetch && window.fetch.__iuPwaRecFetch) {
            window.fetch = origWindowFetch;
            diagResourceCounts.fetchWrap = 0;
          }
        } catch (_) {}
      });
    } catch (_) {}
  }

  function bindExtendedDiagHooks() {
    bindScrollApplyWrap();
    bindUserInputSignals();
    bindPerfObservers();
    bindServiceWorkerDiag();
    bindFetchTiming();
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

  function captureStack(maxLines) {
    try {
      var err = new Error("iu-pwa-rec-stack");
      if (!err.stack) return "";
      return String(err.stack)
        .split("\n")
        .slice(1, maxLines || 6)
        .join("\n");
    } catch (_) {
      return "";
    }
  }

  function isElementVisuallyPresent(el) {
    if (!el) return false;
    try {
      var node = el;
      while (node && node.nodeType === 1) {
        if (node.hidden) return false;
        var pst = getComputedStyle(node);
        if (pst.display === "none" || pst.visibility === "hidden" || Number(pst.opacity) === 0) return false;
        node = node.parentElement;
      }
      var st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
      var r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      return r.bottom > 0 && r.right > 0 && r.top < (window.innerHeight || 0) && r.left < (window.innerWidth || 0);
    } catch (_) {
      return false;
    }
  }

  function isElementLayoutMounted(el) {
    if (!el || el.hidden) return false;
    try {
      var node = el;
      while (node && node.nodeType === 1) {
        if (node.hidden) return false;
        var pst = getComputedStyle(node);
        if (pst.display === "none" || pst.visibility === "hidden" || Number(pst.opacity) === 0) return false;
        node = node.parentElement;
      }
      var st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
      var r = el.getBoundingClientRect();
      return r.width >= 8 && r.height >= 8;
    } catch (_) {
      return false;
    }
  }

  function sectionAppliedHubFromDom() {
    try {
      var fromBody = document.body && document.body.getAttribute("data-section");
      if (fromBody) return String(fromBody).trim().toLowerCase();
      var center = document.getElementById("iuCenterStage");
      if (center && center.dataset && center.dataset.view) return String(center.dataset.view).trim().toLowerCase();
    } catch (_) {}
    return "";
  }

  function elementDomProbe(el) {
    if (!el) {
      return { present: false, connected: false };
    }
    var connected = false;
    try {
      connected = !!el.isConnected;
    } catch (_) {
      connected = !!document.getElementById(el.id);
    }
    var layoutMounted = isElementLayoutMounted(el);
    var visible = isElementVisuallyPresent(el);
    var r = null;
    try {
      r = el.getBoundingClientRect();
    } catch (_) {}
    var layoutBox = !!(r && r.width >= 8 && r.height >= 8);
    var inViewport = false;
    if (layoutBox && r) {
      inViewport = r.bottom > 0 && r.right > 0 && r.top < (window.innerHeight || 0) && r.left < (window.innerWidth || 0);
    }
    return {
      present: true,
      connected: connected,
      id: el.id || "",
      htmlHidden: !!el.hidden,
      layoutMounted: layoutMounted,
      visible: visible,
      layoutBox: layoutBox,
      inViewport: inViewport,
      rect: rectBrief(el),
      mountBlockers: layoutMountBlockers(el),
      probeNote: "layoutMounted!=visible; layoutBox may be true under visibility:hidden ancestors",
    };
  }

  function layoutMountBlockers(el) {
    var reasons = [];
    if (!el) {
      reasons.push("missing_element");
      return reasons;
    }
    try {
      if (el.hidden) reasons.push("html_hidden");
      var node = el;
      while (node && node.nodeType === 1) {
        if (node.id) reasons.push("ancestor:" + node.id);
        if (node.hidden) reasons.push("ancestor_hidden:" + (node.id || node.tagName));
        var pst = getComputedStyle(node);
        if (pst.display === "none") {
          reasons.push("ancestor_display_none:" + (node.id || node.tagName));
          break;
        }
        if (pst.visibility === "hidden") reasons.push("ancestor_visibility_hidden:" + (node.id || node.tagName));
        if (Number(pst.opacity) === 0) reasons.push("ancestor_opacity_zero:" + (node.id || node.tagName));
        node = node.parentElement;
      }
      var st = getComputedStyle(el);
      if (st.display === "none") reasons.push("display_none");
      if (st.visibility === "hidden") reasons.push("visibility_hidden");
      if (Number(st.opacity) === 0) reasons.push("opacity_zero");
      var r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) reasons.push("rect_too_small");
    } catch (_) {
      reasons.push("probe_error");
    }
    return reasons;
  }

  function rectBrief(el) {
    if (!el) return null;
    try {
      var r = el.getBoundingClientRect();
      return {
        t: Math.round(r.top),
        l: Math.round(r.left),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    } catch (_) {
      return null;
    }
  }

  function affiliateSectionProbeState(hub) {
    var h = hub || hubSectionFromUrl();
    var aff = document.getElementById("iuAffiliateView");
    var grid = document.getElementById("iuAffiliateGrid");
    var prem = document.getElementById("iuPremiumSelectedGrid");
    var sales = document.getElementById("iuPremiumSalesToggle");
    var body = document.body;
    var mobileMain = !!(body && body.classList.contains("iu-mobileMainVisible"));
    var toolMain = !!(body && body.getAttribute("data-iu-tool-main") === "1");
    var hubAff = /^aff-/.test(h);
    var sectionExpectedAffiliate = hubAff;
    var applied = sectionAppliedHubFromDom();
    var shellMounted = hubAff && isElementLayoutMounted(aff);
    var shellVisible = hubAff && isElementVisuallyPresent(aff);
    /* mobileMain/toolMain = route chrome only; must not imply #iuAffiliateView is mounted (export 114/115). */
    var routeChromeActive = hubAff && (mobileMain || toolMain);
    var sectionActive = hubAff && (shellMounted || shellVisible);
    var mountBlockers = hubAff && aff ? layoutMountBlockers(aff) : [];
    var affDom = hubAff ? elementDomProbe(aff) : null;
    return {
      hubSection: h,
      sectionExpectedHub: h,
      sectionAppliedHub: applied,
      hubAffiliate: hubAff,
      sectionExpectedAffiliate: sectionExpectedAffiliate,
      sectionActive: sectionActive,
      routeChromeActive: routeChromeActive,
      affShellMounted: shellMounted,
      affShellVisible: shellVisible,
      affDomProbe: affDom,
      affMountBlockers: mountBlockers,
      mobileMain: mobileMain,
      toolMain: toolMain,
      ids: {
        affView: aff ? aff.id : "",
        affGrid: grid ? grid.id : "",
        premiumGrid: prem ? prem.id : "",
        salesLink: sales ? sales.id : "",
      },
      globalRectNote: hubAff && !sectionActive ? "global_dom_rect_may_exist_while_section_inactive" : "",
    };
  }

  function layoutGeometrySnapshot() {
    var vv = window.visualViewport;
    var scrollHost = document.getElementById("content") || document.documentElement;
    var scrollHostY = 0;
    try {
      scrollHostY = scrollHost && scrollHost.scrollTop ? scrollHost.scrollTop : window.scrollY || 0;
    } catch (_) {}
    var hub = hubSectionFromUrl();
    var probe = affiliateSectionProbeState(hub);
    var aff = document.getElementById("iuAffiliateView");
    var grid = document.getElementById("iuAffiliateGrid");
    var prem = document.getElementById("iuPremiumSelectedGrid");
    var sales = document.getElementById("iuPremiumSalesToggle");
    var scopedAff = probe.sectionActive ? aff : null;
    var scopedGrid = probe.sectionActive ? grid : null;
    var scopedPrem = probe.sectionActive ? prem : null;
    var scopedSales = probe.sectionActive ? sales : null;
    return {
      scrollY: Math.round(window.scrollY || 0),
      scrollHostY: Math.round(scrollHostY),
      innerH: Math.round(window.innerHeight || 0),
      hubSection: hub,
      affiliateProbe: probe,
      vv: vv
        ? {
            h: Math.round(vv.height),
            offsetTop: Math.round(vv.offsetTop || 0),
            scale: vv.scale,
          }
        : null,
      center: rectBrief(document.getElementById("iuCenterStage")),
      affView: rectBrief(scopedAff),
      affGrid: rectBrief(scopedGrid),
      premiumGrid: rectBrief(scopedPrem),
      salesLink: rectBrief(scopedSales),
      globalAffView: probe.hubAffiliate && !probe.sectionActive ? rectBrief(aff) : null,
      topbar: rectBrief(document.getElementById("iuTopbar") || document.querySelector(".iuTopbar")),
    };
  }

  function sectionProbeMode(hub) {
    var h = hub || hubSectionFromUrl();
    if (/^aff-/.test(h)) return "affiliate";
    if (/^(pocasi|chmi)/.test(h)) return "chmi_feed";
    if (/^(mapy|maps|jr|tvprogram|tvonline|radio)/.test(h)) return "hub_lane";
    return "none";
  }

  function chmiFeedContentMetrics() {
    var feed = document.getElementById("feed");
    var cards = 0;
    var activeCards = 0;
    try {
      if (feed) {
        cards = feed.querySelectorAll("[data-iu-chmi-cap], .iuInfoEventCard, .iuChmiCapCard").length;
        activeCards = feed.querySelectorAll('[data-iu-chmi-lifecycle="ACTIVE"], [data-chmi-lifecycle="ACTIVE"]').length;
      }
    } catch (_) {}
    return {
      probeMode: "chmi_feed",
      feedMounted: isElementLayoutMounted(feed),
      feedVisible: isElementVisuallyPresent(feed),
      chmiCardCount: cards,
      chmiActiveCardCount: activeCards,
      feedRect: rectBrief(feed),
    };
  }

  function resourceTimingBrief(url) {
    try {
      if (!performance || typeof performance.getEntriesByName !== "function") return null;
      var list = performance.getEntriesByName(url);
      if (!list || !list.length) return null;
      var e = list[list.length - 1];
      return {
        quality: "measured",
        initiatorType: e.initiatorType || "",
        transferSize: e.transferSize,
        encodedBodySize: e.encodedBodySize,
        decodedBodySize: e.decodedBodySize,
        dns: Math.round((e.domainLookupEnd - e.domainLookupStart) * 1000) / 1000,
        connect: Math.round((e.connectEnd - e.connectStart) * 1000) / 1000,
        tls: Math.round((e.secureConnectionStart > 0 ? e.connectEnd - e.secureConnectionStart : 0) * 1000) / 1000,
        ttfb: Math.round((e.responseStart - e.requestStart) * 1000) / 1000,
        total: Math.round((e.responseEnd - e.startTime) * 1000) / 1000,
        timingAllowOrigin: e.transferSize > 0 || e.decodedBodySize > 0 ? "likely_allowed" : "restricted_or_opaque",
      };
    } catch (_) {
      return null;
    }
  }

  function affiliateContentMetrics(hub) {
    var mode = sectionProbeMode(hub);
    var probeState = affiliateSectionProbeState(hub);
    var grid = document.getElementById("iuAffiliateGrid");
    var partnerReady = 0;
    var chipTotal = 0;
    var partnerHrefSlots = 0;
    var partnerEmptySlots = 0;
    var salesButtons = 0;
    try {
      if (grid && mode === "affiliate") {
        chipTotal = grid.querySelectorAll(".iuAffiliateChip").length;
        partnerReady = grid.querySelectorAll('.iuAffiliateChip[data-aff-ready="1"]').length;
        partnerHrefSlots = grid.querySelectorAll('.iuAffiliateChip[href^="https"]').length;
        partnerEmptySlots = grid.querySelectorAll('.iuAffiliateChip[href="#"]').length;
        salesButtons = grid.querySelectorAll('.iuAffiliateChip[data-aff-ready="0"]').length;
      }
    } catch (_) {}
    var prem = document.getElementById("iuPremiumSelectedGrid");
    var sales = document.getElementById("iuPremiumSalesToggle");
    var affEl = document.getElementById("iuAffiliateView");
    var contentReadinessScope = mode === "affiliate";
    var affInScope = contentReadinessScope && probeState.sectionActive;
    var affLayoutMounted = contentReadinessScope && isElementLayoutMounted(affEl);
    var affVisible = contentReadinessScope && isElementVisuallyPresent(affEl);
    var metricsScope = contentReadinessScope;
    var premMounted = metricsScope && !!(prem && !prem.hidden && isElementLayoutMounted(prem));
    var partnerCatalogExpected = 0;
    try {
      if (grid && contentReadinessScope) {
        partnerCatalogExpected = grid.querySelectorAll('.iuAffiliateChip[data-aff-ready="1"], .iuAffiliateChip[href^="https"]').length;
      }
    } catch (_) {}
    var unmetReasons = [];
    if (contentReadinessScope && !probeState.sectionActive) {
      if (probeState.routeChromeActive) unmetReasons.push("aff_route_chrome_without_shell");
      else unmetReasons.push("aff_section_inactive");
      unmetReasons.push("aff_shell");
      if (probeState.affMountBlockers && probeState.affMountBlockers.length) {
        for (var bi = 0; bi < probeState.affMountBlockers.length && bi < 6; bi++) {
          unmetReasons.push("aff_mount:" + probeState.affMountBlockers[bi]);
        }
      }
      if (probeState.affShellMounted && !probeState.affShellVisible) unmetReasons.push("aff_mounted_not_visible");
    } else if (contentReadinessScope && !affLayoutMounted) {
      unmetReasons.push("aff_shell");
      var blockers = layoutMountBlockers(affEl);
      for (var bj = 0; bj < blockers.length && bj < 6; bj++) unmetReasons.push("aff_mount:" + blockers[bj]);
    }
    var out = {
      probeMode: mode,
      probeSchemaNote:
        "affInScope=scoped_active_shell; contentReadinessScope=expected_hub_affiliate; affLayoutMounted/affVisible always when expected",
      contentReadinessScope: contentReadinessScope,
      sectionExpectedHub: probeState.sectionExpectedHub || hub,
      sectionAppliedHub: probeState.sectionAppliedHub || "",
      affInScope: affInScope,
      affiliateProbe: probeState,
      affDomProbe: probeState.affDomProbe || elementDomProbe(affEl),
      probeUnmetReasons: unmetReasons,
      partnerHrefSlots: partnerHrefSlots,
      partnerEmptySlots: partnerEmptySlots,
      partnerCatalogExpected: partnerCatalogExpected,
      salesOrPlaceholderChips: salesButtons,
      affVis: affVisible,
      affVisible: affVisible,
      affShell: affLayoutMounted,
      affLayoutMounted: affLayoutMounted,
      partnerReadyCount: partnerReady,
      chipTotal: chipTotal,
      premiumGridVis: metricsScope && !!(prem && !prem.hidden && isElementVisuallyPresent(prem)),
      premiumGridMounted: premMounted,
      salesLinkVis: metricsScope && isElementVisuallyPresent(sales),
      salesLinkMounted: metricsScope && isElementLayoutMounted(sales),
      premiumLoading: metricsScope && !!(prem && prem.classList && prem.classList.contains("iuPremiumGrid--loading")),
      staleDomNote: contentReadinessScope && !affInScope ? "expected_affiliate_section_metrics_while_shell_inactive" : "",
      export114ParadoxNote:
        contentReadinessScope && probeState.routeChromeActive && !affLayoutMounted
          ? "pre_fix_had_affInScope_true_via_mobileMain_in_sectionActive"
          : "",
    };
    if (mode === "chmi_feed") {
      var chmi = chmiFeedContentMetrics();
      for (var k in chmi) {
        if (Object.prototype.hasOwnProperty.call(chmi, k)) out[k] = chmi[k];
      }
    }
    return out;
  }

  function visualLayerSnapshot() {
    var feed = document.getElementById("feed");
    var aff = document.getElementById("iuAffiliateView");
    var gateWrap = document.getElementById("iuMobileGateWrap");
    var navPanel = document.getElementById("iuMobileGatePanelNav");
    var grid = document.getElementById("iuAffiliateGrid");
    var hubSec = hubSectionFromUrl();
    var gate = gateWrap ? String(gateWrap.getAttribute("data-iu-mobile-gate") || "") : "";
    var body = document.body;
    var mobileMain = !!(body && body.classList.contains("iu-mobileMainVisible"));
    var toolMain = !!(body && body.getAttribute("data-iu-tool-main") === "1");
    var btnCount = 0;
    try {
      if (grid) btnCount = grid.querySelectorAll('a[href], button[type="button"]').length;
    } catch (_) {}
    return {
      proof: "dom_geometry_heuristic_not_framebuffer",
      intended: {
        hubSection: hubSec,
        gate: gate,
        hash: String(location.hash || ""),
      },
      iuHomeClass: !!(body && body.classList.contains("iu-home")),
      coldSectionAttr: !!(body && body.getAttribute("data-iu-cold-section") === "1"),
      hubResumePending: !!(document.documentElement && document.documentElement.classList.contains("iu-hub-section-resume-pending")),
      homeFeedVisible: isElementVisuallyPresent(feed) && !mobileMain && !toolMain,
      feedBlockVisible: isElementVisuallyPresent(feed),
      homeHubSilverVisible: isElementVisuallyPresent(
        document.getElementById("silver-slot") || document.querySelector("#iuMobileSilverSlot .silver-slot")
      ),
      silverSlotVisible: isElementVisuallyPresent(document.getElementById("silver-slot")),
      hubMainColumnVisible: mobileMain || toolMain,
      menuOverlayVisible: !!(body && body.classList.contains("iu-mobileGateOverlayOpen") && gate === "nav"),
      toolsGateVisible: gate === "tools" && !!(body && body.classList.contains("iu-mobileGateOverlayOpen")),
      mindMenuVisible:
        !!(body && body.classList.contains("iu-myinfouzel-open")) ||
        String(location.hash || "").replace("#", "") === "iu-mindmenu",
      sectionShellVisible: isElementVisuallyPresent(aff) || isElementVisuallyPresent(document.getElementById("iuCenterStage")),
      sectionButtonsVisible: btnCount > 0,
      sectionButtonCount: btnCount,
      navPanelVisible: isElementVisuallyPresent(navPanel),
    };
  }

  function collectDeliveryProof() {
    var out = {
      metaIuBuild: "",
      scriptTokens: {},
      pwaReturnBuildIdRuntime: "",
      recorderBuildId: RECORDER_BUILD_ID,
      proofNote: "script_tokens_from_dom_src_query_not_sw_cache_body",
    };
    try {
      var meta = document.querySelector('meta[name="iu-build"]');
      if (meta) out.metaIuBuild = String(meta.getAttribute("content") || "").trim();
    } catch (_) {}
    try {
      if (window.iuNetwork && window.iuNetwork.pwaExternalReturnBuildId) {
        out.pwaReturnBuildIdRuntime = String(window.iuNetwork.pwaExternalReturnBuildId);
      }
    } catch (_) {}
    try {
      var list = document.querySelectorAll("script[src]");
      for (var i = 0; i < list.length; i++) {
        var src = String(list[i].getAttribute("src") || "");
        if (src.indexOf("iu-network-connectivity") >= 0) out.scriptTokens.network = src.split("?v=")[1] || src;
        if (src.indexOf("iu-pwa-return-recorder") >= 0) out.scriptTokens.recorder = src.split("?v=")[1] || src;
        if (src.indexOf("iu-pwa-version-check") >= 0) out.scriptTokens.versionCheck = src.split("?v=")[1] || src;
      }
    } catch (_) {}
    return out;
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
      tabSessionSid: tabSessionSid,
      documentSid: documentSid,
      documentBootSeq: documentBootSeq,
      pageSid: documentSid || pageSid,
      href: sanitizeUrl(location.href),
      hash: String(location.hash || ""),
      hubSection: hubSectionFromUrl(),
      gate: gate,
      display: visualLayerSnapshot(),
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
        mmArmed: sessionStorage.getItem("iuMindMenuReturnArmed") || "",
        mmLatch: sessionStorage.getItem("iuMindMenuReturnLatchTs") || "",
        hubArm: sessionStorage.getItem("iuPwaExternalReturnHubSectionAtArm") || "",
        mmHist:
          !!(history.state && history.state.iu_mindmenu_overlay === true) ||
          String(location.hash || "").replace("#", "") === "iu-mindmenu",
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

  function tryAggregateNetFetch(store, ev, detail) {
    if (ev !== "net:fetch_done" || !detail || !detail.url) return false;
    var now = Date.now();
    if (
      lastNetFetchAgg &&
      lastNetFetchAgg.url === detail.url &&
      now - lastNetFetchAgg.t <= netFetchAggWindowMs &&
      store.entries.length
    ) {
      var last = store.entries[store.entries.length - 1];
      if (last && last.ev === "net:fetch_done" && last.detail && last.detail.url === detail.url) {
        last.detail.aggregatedFrom = (last.detail.aggregatedFrom || 1) + 1;
        last.detail.lastStatus = detail.status;
        last.detail.lastMs = detail.ms;
        last.t = now;
        last.monoMs = monoNow();
        store.aggregatedNetFetchUnits = (store.aggregatedNetFetchUnits || 0) + 1;
        lastNetFetchAgg.t = now;
        writeLogStore(store);
        return true;
      }
    }
    lastNetFetchAgg = { url: detail.url, t: now };
    return false;
  }

  function appendEntry(ev, detail, source) {
    if (!isRecording()) return;
    var store = readLogStore();
    if (tryAggregateNetFetch(store, String(ev || ""), detail)) return;
    store.seq = (store.seq || 0) + 1;
    var entry = {
      n: store.seq,
      t: Date.now(),
      monoMs: monoNow(),
      ev: String(ev || ""),
      src: source || "recorder",
      attemptId: activeAttemptId() || store.recordingAttemptId || "",
      detail: detail && typeof detail === "object" ? detail : {},
      view: viewSnapshot(),
    };
    try {
      entry.detail.correlation = entry.detail.correlation || correlationPayload();
    } catch (_) {}
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

  function markDocumentIdentity() {
    try {
      tabSessionSid = sessionStorage.getItem(TAB_SESSION_KEY) || "";
      if (!tabSessionSid) {
        tabSessionSid = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        sessionStorage.setItem(TAB_SESSION_KEY, tabSessionSid);
      }
      documentSid = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem(DOCUMENT_SID_KEY, documentSid);
      documentBootSeq = parseInt(sessionStorage.getItem(DOC_BOOT_SEQ_KEY) || "0", 10);
      if (!Number.isFinite(documentBootSeq)) documentBootSeq = 0;
      documentBootSeq += 1;
      sessionStorage.setItem(DOC_BOOT_SEQ_KEY, String(documentBootSeq));
      pageSid = documentSid;
    } catch (_) {
      documentSid = "d-fallback";
      pageSid = documentSid;
    }
  }

  function readLastReloadReason() {
    try {
      var raw = sessionStorage.getItem("iu:pwa:ver:last-reload-reason") || "";
      if (!raw) return null;
      var o = safeJsonParse(raw);
      return o && typeof o === "object" ? o : { reason: raw };
    } catch (_) {
      return null;
    }
  }

  function schedulePaintBurst(reason) {
    if (!isRecording() || paintBurstLock) return;
    paintBurstLock = true;
    var frame = 0;
    var maxFrames = 5;
    function tick() {
      frame += 1;
      appendEntry(
        "view:frame",
        { phase: String(reason || ""), frame: frame, display: visualLayerSnapshot() },
        "paint"
      );
      if (frame < maxFrames) requestAnimationFrame(tick);
      else paintBurstLock = false;
    }
    requestAnimationFrame(tick);
  }

  function onDocumentBoot() {
    markDocumentIdentity();
    if (isRecording()) {
      bindHooks();
      schedulePaintBurst("document_boot");
    }
    if (!isRecording()) return;
    var restoredCorr = restoreCorrelationState();
    try {
      lastSettleAtMs = parseInt(sessionStorage.getItem(LAST_SETTLE_KEY) || "0", 10) || 0;
      lastHandoffAtMs = parseInt(sessionStorage.getItem(LAST_HANDOFF_KEY) || "0", 10) || 0;
      criticalWindowAnchorAtMs = parseInt(sessionStorage.getItem(CRITICAL_WINDOW_ANCHOR_KEY) || "0", 10) || 0;
    } catch (_) {}
    var reloadMeta = readLastReloadReason();
    var msSinceSettleAtBoot = lastSettleAtMs ? Date.now() - lastSettleAtMs : null;
    var navEnt =
      typeof performance !== "undefined" && performance.getEntriesByType
        ? performance.getEntriesByType("navigation")[0]
        : null;
    appendEntry(
      "document:boot",
      {
        navType: navigationEntryType(),
        tabSessionSid: tabSessionSid,
        documentSid: documentSid,
        documentBootSeq: documentBootSeq,
        recordingAttemptId: sessionStorage.getItem(ATTEMPT_KEY) || "",
        returnOpId: activeReturnOpId || "",
        correlationRestored: !!restoredCorr,
        correlationSnapshot: restoredCorr,
        appVersion: appVersionLabel(),
        recorderBuildId: RECORDER_BUILD_ID,
        delivery: collectDeliveryProof(),
        reloadReason: reloadMeta,
        msSinceLastSettle: msSinceSettleAtBoot,
        msSinceLastHandoff: lastHandoffAtMs ? Date.now() - lastHandoffAtMs : null,
        navigationOrigin: reloadMeta ? "app_version_reload" : "unknown",
        geom: layoutGeometrySnapshot(),
        navEntry: navEnt
          ? {
              type: navEnt.type,
              redirectCount: navEnt.redirectCount,
              transferSize: navEnt.transferSize,
            }
          : null,
      },
      "boot"
    );
    scheduleSectionLayoutWatch(Date.now(), "document_boot");
    try {
      sessionStorage.removeItem("iu:pwa:ver:last-reload-reason");
    } catch (_) {}
  }

  function startRecording() {
    try {
      localStorage.setItem(ACTIVE_KEY, "1");
    } catch (_) {}
    var attemptId = "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try {
      sessionStorage.setItem(ATTEMPT_KEY, attemptId);
    } catch (_) {}
    var store = readLogStore();
    if (!store.startedAt) store.startedAt = Date.now();
    store.stoppedAt = null;
    store.appVersion = appVersionLabel();
    store.recordingAttemptId = attemptId;
    store.metricCapabilities = buildMetricCapabilities();
    store.attemptStartedMonoMs = monoNow();
    attemptStartedAtMs = Date.now();
    lastSettleAtMs = 0;
    lastHandoffAtMs = 0;
    criticalWindowAnchorAtMs = 0;
    try {
      sessionStorage.removeItem(CRITICAL_WINDOW_ANCHOR_KEY);
    } catch (_) {}
    clearReturnRelativeMilestones();
    writeLogStore(store);
    returnOpSeq = 0;
    sectionOpenSeq = 0;
    externalHandoffSeq = 0;
    activeReturnOpId = "";
    activeSectionOpenId = "";
    try {
      sessionStorage.removeItem(CORRELATION_KEY);
    } catch (_) {}
    appendEntry(
      "recorder:start",
      {
        appVersion: appVersionLabel(),
        recordingAttemptId: attemptId,
        recorderBuildId: RECORDER_BUILD_ID,
        metricCapabilities: store.metricCapabilities,
        quality: "measured",
      },
      "ui"
    );
    bindHooks();
    bindExtendedDiagHooks();
    scheduleScrollSample(true);
    scheduleAttemptMilestones();
  }

  function scheduleAttemptMilestones() {
    [15000, 45000, 50000].forEach(function (ms) {
      var t = setTimeout(function () {
        if (!isRecording()) return;
        appendEntry(
          "attempt:milestone",
          {
            ms: ms,
            label: ms / 1000 + "s",
            anchor: "attempt_start",
            scroll: scrollContainerMetrics(),
            returnOpId: activeReturnOpId || "",
            quality: "measured",
          },
          "attempt"
        );
      }, ms);
      registerDiagCleanup(function () {
        clearTimeout(t);
      });
    });
  }

  function clearReturnRelativeMilestones() {
    while (returnMilestoneCleanups.length) {
      try {
        var fn = returnMilestoneCleanups.pop();
        fn();
      } catch (_) {}
    }
  }

  function scheduleReturnRelativeMilestones() {
    clearReturnRelativeMilestones();
    if (!lastSettleAtMs) return;
    [15000, 50000].forEach(function (ms) {
      var t = setTimeout(function () {
        if (!isRecording()) return;
        appendEntry(
          "attempt:milestone",
          {
            ms: ms,
            label: "return+" + ms / 1000 + "s",
            anchor: "last_settle_done",
            msSinceSettle: Date.now() - lastSettleAtMs,
            scroll: scrollContainerMetrics(),
            returnOpId: activeReturnOpId || "",
            quality: "measured",
          },
          "attempt"
        );
      }, ms);
      returnMilestoneCleanups.push(function () {
        clearTimeout(t);
      });
    });
  }

  function stopRecording() {
    var countsBefore = {
      observers: diagResourceCounts.observers,
      listeners: diagResourceCounts.listeners,
      intervals: diagResourceCounts.intervals,
      fetchWrap: diagResourceCounts.fetchWrap,
    };
    appendEntry("recorder:stop", { resourceCountsBefore: countsBefore, quality: "measured" }, "ui");
    teardownDiagSession();
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

  function buildExportPayload(attemptOnly) {
    var store = readLogStore();
    var cur = store.recordingAttemptId || sessionStorage.getItem(ATTEMPT_KEY) || "";
    var entries = store.entries || [];
    if (attemptOnly && cur) {
      entries = entries.filter(function (e) {
        return (e.attemptId || "") === cur;
      });
    }
    var attemptCount = entries.length;
    var payload = {
      exportedAt: Date.now(),
      recording: isRecording(),
      appVersion: appVersionLabel(),
      pwaReturnBuildId: window.iuNetwork && window.iuNetwork.pwaExternalReturnBuildId,
      recorderBuildId: RECORDER_BUILD_ID,
      tabSessionSid: tabSessionSid || sessionStorage.getItem(TAB_SESSION_KEY) || "",
      documentSid: documentSid || sessionStorage.getItem(DOCUMENT_SID_KEY) || "",
      documentBootSeq: documentBootSeq || parseInt(sessionStorage.getItem(DOC_BOOT_SEQ_KEY) || "0", 10) || 0,
      pageSid: documentSid || pageSid,
      delivery: collectDeliveryProof(),
      recordingAttemptId: cur,
      metricCapabilities: store.metricCapabilities || buildMetricCapabilities(),
      exportScope: attemptOnly ? "current_attempt_only" : "full_archive",
      logMeta: {
        droppedEntries: store.droppedEntries || 0,
        droppedCurrentAttempt: store.droppedCurrentAttempt || 0,
        droppedOtherAttempts: store.droppedOtherAttempts || 0,
        droppedAggregatedUnits: store.droppedAggregatedUnits || 0,
        aggregatedNetFetchUnits: store.aggregatedNetFetchUnits || 0,
        droppedByEv: store.droppedByEv || {},
        truncatedExportLikely: !!store.truncatedExportLikely,
        entryCount: store.entries ? store.entries.length : 0,
        exportedEntryCount: attemptCount,
        currentAttemptEntryCount: attemptCount,
        maxEntries: MAX_ENTRIES,
        maxJsonChars: MAX_JSON_CHARS,
        evictPolicy: "tiered_priority_v9",
      },
      correlationExport: {
        attemptId: cur,
        returnOpId: activeReturnOpId || "",
        sectionOpenId: activeSectionOpenId || "",
        handoffId: externalHandoffSeq ? composeHandoffId() : "",
        documentSid: documentSid,
        documentBootSeq: documentBootSeq,
        idScheme: "attemptScoped:retN|extN|doc:secopenN",
      },
      log: {
        v: store.v,
        seq: store.seq,
        startedAt: store.startedAt,
        stoppedAt: store.stoppedAt,
        appVersion: store.appVersion,
        recordingAttemptId: store.recordingAttemptId,
        metricCapabilities: store.metricCapabilities,
        entries: entries,
        droppedEntries: store.droppedEntries,
        droppedCurrentAttempt: store.droppedCurrentAttempt,
        droppedOtherAttempts: store.droppedOtherAttempts,
        truncatedExportLikely: store.truncatedExportLikely,
      },
    };
    return payload;
  }

  function exportText() {
    return JSON.stringify(buildExportPayload(false), null, 2);
  }

  function exportAttemptText() {
    return JSON.stringify(buildExportPayload(true), null, 2);
  }

  function copyLog() {
    var txt = exportAttemptText();
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
    var t = String(tag || "");
    var d = detail && typeof detail === "object" ? detail : {};
    if (t === "external_handoff") {
      externalHandoffSeq += 1;
      returnOpSeq += 1;
      activeReturnOpId = composeReturnOpId();
      d.handoffId = composeHandoffId();
      d.returnOpId = activeReturnOpId;
      d.newDocumentExpected = true;
      lastHandoffAtMs = Date.now();
      try {
        sessionStorage.setItem(LAST_HANDOFF_KEY, String(lastHandoffAtMs));
      } catch (_) {}
      persistCorrelationState();
    }
    if (t === "restore_start") {
      if (!activeReturnOpId) {
        returnOpSeq += 1;
        activeReturnOpId = composeReturnOpId();
        persistCorrelationState();
      }
      d.returnOpId = activeReturnOpId;
      d.continuation = !d.newDocumentExpected;
    }
    if (t === "main_scroll_restore_done" || t === "main_scroll_restore_cancel" || t === "main_scroll_restore_trace") {
      d.returnOpId = activeReturnOpId;
      d.scroll = scrollContainerMetrics();
      d.quality = "measured";
    }
    if (t === "settle_done") {
      d.returnOpId = activeReturnOpId;
      lastSettleAtMs = Date.now();
      try {
        sessionStorage.setItem(LAST_SETTLE_KEY, String(lastSettleAtMs));
      } catch (_) {}
      touchCriticalWindowAnchor();
      scheduleReturnRelativeMilestones();
    }
    appendEntry("trace:" + t, d, "iuNetwork");
    if (
      t === "restore_start" ||
      t === "settle_done" ||
      t === "version_reload" ||
      t === "external_handoff"
    ) {
      schedulePaintBurst(t);
    }
    if (t === "settle_done" || t === "restore_start") scheduleSectionLayoutWatch(Date.now(), "external_" + t);
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
        appendEntry(
          evName || "fn:" + fnName,
          { args: argsSummary, fn: fnName, stack: captureStack(5) },
          "wrap"
        );
        return cur.apply(this, arguments);
      };
      window[fnName].__iuPwaRecWrap = true;
    } catch (_) {}
  }

  function scheduleSectionLayoutWatch(t0, reason) {
    var lastSig = "";
    var samples = 0;
    var maxMs = 4500;
    function tick() {
      if (!isRecording()) return;
      samples += 1;
      var geom = layoutGeometrySnapshot();
      var sig = JSON.stringify(geom);
      if (sig !== lastSig) {
        lastSig = sig;
        appendEntry(
          "layout:geometry",
          { ms: Date.now() - t0, reason: reason || "section", sample: samples, geom: geom },
          "layout"
        );
      }
      if (Date.now() - t0 < maxMs && samples < 72) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function sectionContentUnmet(m) {
    var u = [];
    var mode = m.probeMode || sectionProbeMode();
    if (Array.isArray(m.probeUnmetReasons) && m.probeUnmetReasons.length) {
      for (var ri = 0; ri < m.probeUnmetReasons.length; ri++) u.push(m.probeUnmetReasons[ri]);
    }
    if (mode === "chmi_feed") {
      if (!m.feedMounted) u.push("chmi_feed_mount");
      return u;
    }
    if (mode !== "affiliate") return u;
    if (!m.contentReadinessScope) return u;
    if (!m.affLayoutMounted && !m.affShell) {
      if (u.indexOf("aff_shell") < 0) u.push("aff_shell");
      return u;
    }
    var partnerExpected = m.partnerCatalogExpected > 0 ? m.partnerCatalogExpected : m.partnerHrefSlots;
    if (partnerExpected > 0 && !(m.partnerReadyCount > 0)) u.push("partners_ready");
    else if (m.chipTotal === 0 && partnerExpected === 0 && !m.salesLinkMounted && !m.premiumGridMounted) {
      u.push("sales_or_premium_shell");
    } else if (m.chipTotal === 0 && partnerExpected > 0) u.push("partners_catalog_not_rendered");
    if (m.premiumLoading && !m.premiumGridMounted) u.push("premium_loading");
    return u;
  }

  function scheduleSectionContentReady(t0) {
    var attempts = 0;
    var maxAttempts = 120;
    var startHub = hubSectionFromUrl();
    var openId = activeSectionOpenId;
    var milestones = { partners: false, sales: false, premium: false };
    function poll() {
      if (!isRecording()) return;
      if (hubSectionFromUrl() !== startHub) {
        appendEntry(
          "section:content_cancelled",
          {
            outcome: "cancelled",
            reason: "hub_changed",
            ms: Date.now() - t0,
            attempts: attempts,
            fromHub: startHub,
            toHub: hubSectionFromUrl(),
            sectionOpenId: openId,
          },
          "section"
        );
        return;
      }
      attempts += 1;
      var m = affiliateContentMetrics();
      if (!milestones.partners && m.partnerReadyCount > 0) {
        milestones.partners = true;
        appendEntry(
          "section:milestone",
          { kind: "partners_ready", ms: Date.now() - t0, attempts: attempts, metrics: m },
          "section"
        );
      }
      if (!milestones.sales && m.salesLinkMounted) {
        milestones.sales = true;
        appendEntry(
          "section:milestone",
          { kind: "sales_cta_mounted", ms: Date.now() - t0, attempts: attempts, metrics: m },
          "section"
        );
      }
      if (!milestones.premium && m.premiumGridMounted && !m.premiumLoading) {
        milestones.premium = true;
        appendEntry(
          "section:milestone",
          { kind: "premium_grid_mounted", ms: Date.now() - t0, attempts: attempts, metrics: m },
          "section"
        );
      }
      var unmet = sectionContentUnmet(m);
      if (unmet.length === 0) {
        appendEntry(
          "section:content_ready",
          {
            outcome: "ready",
            ms: Date.now() - t0,
            attempts: attempts,
            metrics: m,
            geom: layoutGeometrySnapshot(),
          },
          "section"
        );
        return;
      }
      if (attempts >= maxAttempts) {
        m.probeUnmetReasons = unmet.slice();
        appendEntry(
          "section:content_timeout",
          {
            outcome: "timeout",
            ms: Date.now() - t0,
            attempts: attempts,
            unmet: unmet,
            metrics: m,
            geom: layoutGeometrySnapshot(),
          },
          "section"
        );
        return;
      }
      requestAnimationFrame(poll);
    }
    requestAnimationFrame(poll);
  }

  function scheduleSectionReadyPoll(t0) {
    var hub = hubSectionFromUrl();
    var mode = sectionProbeMode(hub);
    if (mode === "none") return;
    var attempts = 0;
    function poll() {
      if (!isRecording()) return;
      attempts += 1;
      var m = affiliateContentMetrics(hub);
      var btnCount = m.chipTotal;
      var chmiReady = mode === "chmi_feed" && (m.feedMounted || m.chmiCardCount > 0);
      var probe = m.affiliateProbe || affiliateSectionProbeState(hub);
      var affShellLane = mode === "affiliate" && probe.sectionActive;
      var affRouteLane = mode === "affiliate" && probe.routeChromeActive && !probe.sectionActive;
      var affReady = affShellLane && (m.affVisible || m.affVis);
      var laneReady = mode === "hub_lane" && attempts >= 8;
      if (affReady || chmiReady || laneReady || (affRouteLane && attempts >= 12) || attempts >= 48) {
        appendEntry(
          "section:ready",
          {
            readyPhase: affShellLane ? "shell_or_lane" : affRouteLane ? "route_chrome_only" : "shell_or_lane",
            ms: Date.now() - t0,
            btnCount: btnCount,
            affVis: m.affVis,
            affShell: m.affShell,
            affLayoutMounted: m.affLayoutMounted,
            contentReadinessScope: m.contentReadinessScope,
            partnerReadyCount: m.partnerReadyCount,
            salesLinkVis: m.salesLinkVis,
            premiumGridVis: m.premiumGridVis,
            attempts: attempts,
            note: affShellLane ? "shell_ready_not_full_content" : "route_chrome_not_shell",
          },
          "section"
        );
        scheduleSectionContentReady(t0);
        scheduleSectionLayoutWatch(t0, "section_apply");
        return;
      }
      requestAnimationFrame(poll);
    }
    requestAnimationFrame(poll);
  }

  function wrapSectionApply() {
    try {
      var cur = window.iuApplySectionFromURL;
      if (typeof cur !== "function" || cur.__iuPwaRecSection) return;
      window.iuApplySectionFromURL = function () {
        var op = window.__iuPwaRecSectionApplyOp;
        var t0 = op && op.t0 ? op.t0 : Date.now();
        if (!op || !op.logged) {
          sectionApplyOpSeq += 1;
          var opId = op && op.id ? op.id : "sec" + sectionApplyOpSeq;
          appendEntry(
            "section:apply_start",
            { t0: t0, opId: opId, hubSection: hubSectionFromUrl(), stack: captureStack(5), via: "wrap" },
            "section"
          );
          if (op) op.logged = true;
        }
        var rv = cur.apply(this, arguments);
        if (!op) scheduleSectionReadyPoll(t0);
        schedulePaintBurst("section_apply");
        try {
          window.__iuPwaRecSectionApplyOp = null;
        } catch (_) {}
        return rv;
      };
      window.iuApplySectionFromURL.__iuPwaRecSection = true;
    } catch (_) {}
  }

  function shouldWatchStorageKey(area, key) {
    var list = area === "session" ? STORAGE_WATCH.session : STORAGE_WATCH.local;
    for (var i = 0; i < list.length; i++) {
      if (list[i] === key) return true;
    }
    return false;
  }

  function patchStorageWrites() {
    if (window.__iuPwaRecStoragePatch) return;
    window.__iuPwaRecStoragePatch = true;
    try {
      var proto = Storage.prototype;
      var origSet = proto.setItem;
      var origRemove = proto.removeItem;
      proto.setItem = function (key, value) {
        if (isRecording()) {
          var area = "local";
          try {
            if (this === sessionStorage) area = "session";
          } catch (_) {}
          if (shouldWatchStorageKey(area, String(key))) {
            appendEntry(
              "storage:set",
              {
                area: area,
                key: String(key),
                len: String(value).length,
                origin: "unknown",
                stack: captureStack(4),
              },
              "storage"
            );
          }
        }
        return origSet.apply(this, arguments);
      };
      proto.removeItem = function (key) {
        if (isRecording()) {
          var area = "local";
          try {
            if (this === sessionStorage) area = "session";
          } catch (_) {}
          if (shouldWatchStorageKey(area, String(key))) {
            appendEntry(
              "storage:remove",
              { area: area, key: String(key), origin: "unknown", stack: captureStack(4) },
              "storage"
            );
          }
        }
        return origRemove.apply(this, arguments);
      };
    } catch (_) {}
  }

  function patchHistoryApi() {
    if (window.__iuPwaRecHistoryPatch) return;
    window.__iuPwaRecHistoryPatch = true;
    try {
      var goOrig = history.go;
      if (typeof goOrig === "function" && !history.__iuPwaRecGoWrap) {
        history.__iuPwaRecGoWrap = true;
        history.go = function (delta) {
          if (isRecording()) {
            navActionSeq += 1;
            appendEntry(
              "nav:history_go",
              {
                actionId: "nav" + navActionSeq,
                delta: delta,
                hrefBefore: sanitizeUrl(location.href),
                stack: captureStack(6),
              },
              "nav"
            );
          }
          return goOrig.apply(history, arguments);
        };
      }
    } catch (_) {}
    ["pushState", "replaceState"].forEach(function (method) {
      try {
        var orig = history[method];
        if (typeof orig !== "function") return;
        history[method] = function (state, title, url) {
          if (isRecording()) {
            appendEntry(
              "history:" + method,
              {
                url: url ? sanitizeUrl(String(url)) : "",
                hrefBefore: sanitizeUrl(location.href),
                stack: captureStack(5),
              },
              "history"
            );
          }
          return orig.apply(history, arguments);
        };
      } catch (_) {}
    });
  }

  function patchNavigationApi() {
    if (window.__iuPwaRecNavPatch) return;
    window.__iuPwaRecNavPatch = true;
    try {
      var proto = window.Location && window.Location.prototype;
      if (!proto) return;
      var origReload = proto.reload;
      var origReplace = proto.replace;
      var origAssign = proto.assign;
      if (typeof origReload === "function") {
        proto.reload = function () {
          if (isRecording()) {
            navActionSeq += 1;
            appendEntry(
              "nav:reload",
              { actionId: "nav" + navActionSeq, stack: captureStack(8), origin: "location.reload" },
              "nav"
            );
          }
          return origReload.apply(this, arguments);
        };
      }
      if (typeof origReplace === "function") {
        proto.replace = function (url) {
          if (isRecording()) {
            navActionSeq += 1;
            appendEntry(
              "nav:replace",
              { actionId: "nav" + navActionSeq, url: sanitizeUrl(String(url || "")), stack: captureStack(8) },
              "nav"
            );
          }
          return origReplace.apply(this, arguments);
        };
      }
      if (typeof origAssign === "function") {
        proto.assign = function (url) {
          if (isRecording()) {
            navActionSeq += 1;
            appendEntry(
              "nav:assign",
              { actionId: "nav" + navActionSeq, url: sanitizeUrl(String(url || "")), stack: captureStack(8) },
              "nav"
            );
          }
          return origAssign.apply(this, arguments);
        };
      }
    } catch (_) {}
    try {
      if (navigator.serviceWorker && !window.__iuPwaRecSwMsg) {
        window.__iuPwaRecSwMsg = true;
        navigator.serviceWorker.addEventListener("message", function (ev) {
          if (!isRecording() || !ev || !ev.data) return;
          if (ev.data.type === "IU_SW_DEPLOY_RELOAD") {
            appendEntry("sw:deploy_reload", { type: ev.data.type }, "sw");
          }
        });
      }
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
            var detail = { fn: name, stack: captureStack(5) };
            if (name === "openExternalSync" || name === "openExternalUrl") {
              detail.url = sanitizeUrl(arg0);
            }
            if (name === "cancelExternalReturnRestore") detail.reason = String(arg0 || "");
            try {
              if (typeof net.getExternalReturnDiagSnapshot === "function") {
                var diag = net.getExternalReturnDiagSnapshot();
                if (diag && typeof diag.gen === "number") detail.gen = diag.gen;
              }
            } catch (_) {}
            appendEntry("net:" + name, detail, "iuNetwork");
            if (name === "restoreAppShellAfterReturn") schedulePaintBurst("restore_start");
            return orig.apply(this, arguments);
          };
          net[name].__iuPwaRecWrap = true;
        }
      );
      net.__iuPwaRecPatched = true;
    } catch (_) {}
  }

  function wrapGateSetTab(wrap) {
    if (!wrap || !isRecording()) return;
    try {
      var cur = wrap.__iuMobileGateSetTab;
      if (typeof cur !== "function" || cur.__iuPwaRecGateWrap) return;
      wrap.__iuMobileGateSetTab = function (value) {
        var stack = "";
        try {
          var err = new Error("gate-setTab");
          if (err.stack) stack = String(err.stack).split("\n").slice(1, 6).join("\n");
        } catch (_) {}
        navActionSeq += 1;
        appendEntry(
          "gate:setTab",
          {
            actionId: "nav" + navActionSeq,
            to: String(value || ""),
            hubSection: hubSectionFromUrl(),
            stack: stack,
          },
          "gate"
        );
        return cur.apply(this, arguments);
      };
      wrap.__iuMobileGateSetTab.__iuPwaRecGateWrap = true;
    } catch (_) {}
  }

  function observeGate() {
    var wrap = document.getElementById("iuMobileGateWrap");
    if (!wrap || wrap.__iuPwaRecObs) return;
    wrap.__iuPwaRecObs = true;
    wrapGateSetTab(wrap);
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
    var delay = force ? 0 : SCROLL_LOG_MIN_INTERVAL_MS;
    scrollLogTimer = setTimeout(function () {
      scrollLogTimer = null;
      var now = Date.now();
      if (!force && now - lastScrollLogAt < SCROLL_LOG_MIN_INTERVAL_MS) return;
      lastScrollLogAt = now;
      var snap = viewSnapshot();
      appendEntry("scroll:sample", { scroll: snap.scroll, gate: snap.gate, hubSection: snap.hubSection }, "scroll");
    }, delay);
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
          if (name === "visibilitychange" && document.visibilityState === "visible") {
            schedulePaintBurst("visibility_visible");
          }
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
        if (!href) return;
        if (/^https?:\/\//i.test(href) && !isSameOriginHttp(href)) {
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
          return;
        }
        if (href.indexOf("section=") >= 0 || href.indexOf("#iu-") === 0 || href.indexOf("/?") === 0) {
          appendEntry(
            "click:internal_link",
            { url: sanitizeUrl(href), handler: "capture:click" },
            "click"
          );
        }
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

  function bindLayoutShiftObserver() {
    if (window.__iuPwaRecClsObs || !window.PerformanceObserver) return;
    try {
      window.__iuPwaRecClsObs = true;
      var po = new PerformanceObserver(function (list) {
        if (!isRecording()) return;
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          if (e.hadRecentInput) continue;
          appendEntry(
            "layout:shift",
            { value: e.value, hadRecentInput: !!e.hadRecentInput, sourceCount: (e.sources || []).length },
            "layout"
          );
        }
      });
      po.observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  }

  function bindHooks() {
    if (hooksBound) return;
    hooksBound = true;
    bindLayoutShiftObserver();
    patchNetwork();
    observeGate();
    bindLifecycleEvents();
    patchStorageWrites();
    patchHistoryApi();
    patchNavigationApi();
    wrapSectionApply();
    [
      "iuMindMenuArmReturnState",
      "iuMindMenuRestoreIfArmed",
      "iuMenuNavCaptureScroll",
      "iuMobileWebNavArmForExternalFromMenu",
      "iuMobileWebNavSyncFromHistory",
      "iuMindMenuSyncGateFromHistory",
      "iuPwaCoordinatedMainScrollRestore",
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
        "iuPwaCoordinatedMainScrollRestore",
      ].forEach(function (name) {
        wrapFn(name, "fn:" + name);
      });
      wrapSectionApply();
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
    function bindBackButtons() {
      if (window.__iuPwaRecBackBtns) return;
      window.__iuPwaRecBackBtns = true;
      ["iuMobileMainBackBar", "iuMobileGateBack"].forEach(function (id) {
        var btn = document.getElementById(id);
        if (!btn || btn.__iuPwaRecBack) return;
        btn.__iuPwaRecBack = true;
        btn.addEventListener(
          "click",
          function () {
            if (!isRecording()) return;
            navActionSeq += 1;
            appendEntry(
              "back:click",
              {
                actionId: "nav" + navActionSeq,
                targetId: id,
                href: sanitizeUrl(location.href),
                hash: String(location.hash || ""),
                hubSection: hubSectionFromUrl(),
                handler: "ui:click",
              },
              "back"
            );
          },
          true
        );
      });
    }
    bindBackButtons();
    if (isRecording()) bindExtendedDiagHooks();
    var backPoll = 0;
    var backPollId = setInterval(function () {
      bindBackButtons();
      backPoll += 1;
      if (backPoll >= 20) clearInterval(backPollId);
    }, 500);
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
    if (ver) {
      var bid = "";
      try {
        bid = window.iuNetwork && window.iuNetwork.pwaExternalReturnBuildId ? String(window.iuNetwork.pwaExternalReturnBuildId) : "";
      } catch (_) {}
      ver.textContent = (bid ? bid + " · " : "") + RECORDER_BUILD_ID;
    }
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

  function ingestNavIntent(reason, detail) {
    if (!isRecording()) return;
    navActionSeq += 1;
    var payload = detail && typeof detail === "object" ? detail : {};
    payload.actionId = payload.actionId || "nav" + navActionSeq;
    payload.reason = String(reason || "");
    payload.documentSid = documentSid;
    payload.href = sanitizeUrl(location.href);
    appendEntry("nav:intent", payload, "nav");
  }

  function ingestSectionApplyStart(t0) {
    if (!isRecording()) return;
    sectionApplyOpSeq += 1;
    sectionOpenSeq += 1;
    activeSectionOpenId = composeSectionOpenId();
    persistCorrelationState();
    var opId = (documentSid || "doc") + ":sec" + sectionApplyOpSeq;
    var t = t0 || Date.now();
    window.__iuPwaRecSectionApplyOp = { id: opId, t0: t, logged: false, sectionOpenId: activeSectionOpenId };
    appendEntry(
      "section:open_start",
      { sectionOpenId: activeSectionOpenId, opId: opId, hubSection: hubSectionFromUrl(), t0: t, quality: "measured" },
      "section"
    );
    scheduleSectionReadyPoll(t);
    schedulePaintBurst("section_apply");
  }

  function ingestSectionApplyScheduledReady(t0) {
    if (!isRecording()) return;
    appendEntry(
      "section:apply_scheduled",
      { ms: Date.now() - (t0 || Date.now()), hubSection: hubSectionFromUrl() },
      "section"
    );
  }

  window.iuPwaReturnRecorder = {
    startRecording: startRecording,
    stopRecording: stopRecording,
    clearLog: clearLog,
    copyLog: copyLog,
    exportText: exportText,
    exportAttemptText: exportAttemptText,
    buildMetricCapabilities: buildMetricCapabilities,
    isRecording: isRecording,
    ingestTrace: ingestTrace,
    ingestNavIntent: ingestNavIntent,
    ingestSectionApplyStart: ingestSectionApplyStart,
    ingestSectionApplyScheduledReady: ingestSectionApplyScheduledReady,
    refreshIcentrumPanel: refreshIcentrumPanel,
    bindIcentrumPanel: bindIcentrumPanel,
    getViewSnapshot: viewSnapshot,
    getAffiliateSectionProbeState: function () {
      return affiliateSectionProbeState(hubSectionFromUrl());
    },
    getAffiliateContentMetrics: function (hub) {
      return affiliateContentMetrics(hub);
    },
    getLayoutGeometrySnapshot: function () {
      return layoutGeometrySnapshot();
    },
    recorderBuildId: RECORDER_BUILD_ID,
  };

  onDocumentBoot();
  if (isRecording()) bindHooks();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindIcentrumPanel, { once: true });
  } else {
    bindIcentrumPanel();
  }
})();
