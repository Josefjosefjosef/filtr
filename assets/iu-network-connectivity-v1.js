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
  var EXTERNAL_MAIN_SCROLL_KEY = "iuPwaExternalReturnMainScrollY";
  /** Survives document teardown (iOS PWA return from external browser) — TTL-bound, local-only. */
  var EXTERNAL_MAIN_SCROLL_PERSIST_LS = "iuPwaExternalReturnMainScrollPersistV1";
  var EXTERNAL_MENU_RETURN_PERSIST_LS = "iuPwaMenuNavReturnPersistV1";
  var EXTERNAL_POST_SETTLE_LS = "iuPwaExternalReturnPostSettleV1";
  var EXTERNAL_MAIN_SCROLL_PERSIST_TTL_MS = 45000;
  var EXTERNAL_MENU_RETURN_PERSIST_TTL_MS = 45000;
  var EXTERNAL_POST_SETTLE_TTL_MS = 12000;
  var EXTERNAL_RETURN_GATE_KEY = "iuPwaExternalReturnGateTab";
  var EXTERNAL_RESTORE_ACTIVE_KEY = "iuPwaExternalReturnRestoringV1";
  var EXTERNAL_RETURN_HOLD_UNTIL_KEY = "iuPwaExternalReturnHoldUntil";
  var EXTERNAL_RETURN_VERSION_DEFER_UNTIL_KEY = "iuPwaExternalReturnVersionDeferUntil";
  var EXTERNAL_RETURN_SETTLE_MS = 1600;
  /** After settle, keep hold so PWA version-check does not full-reload mid external-return paint. */
  var EXTERNAL_RETURN_POST_HOLD_MS = 6500;
  var HUB_SECTION_RETURN_LS = "iuPwaHubSectionReturnV1";
  var HUB_SECTION_ARM_SESSION_KEY = "iuPwaExternalReturnHubSectionAtArm";
  var HUB_SECTION_RETURN_TTL_MS = 30 * 60 * 1000;
  var PWA_EXTERNAL_RETURN_BUILD_ID =
    "pwa-external-return-unified-v16-20261016-export119-hub-boot-clear";
  var externalMainScrollRestoreState = null;
  var externalReturnDeferredSnapshotPending = false;
  var PWA_RETURN_DIAG_LS = "iu:pwa-external-return-diag:v1";
  var PWA_RETURN_TRACE_LS = "iu:pwa-external-return-trace:v1";
  var lastProbe = { ok: null, ts: 0 };
  var externalRestoreInFlight = false;
  var externalReturnGeneration = 0;
  var externalReturnSettleTimer = null;
  var externalReturnSettleRaf = 0;
  var externalReturnTraceRing = [];
  var externalReturnDiagEl = null;
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
    "iu-calendarOverlay-open",
  ];

  function isAiAssistantsOverlayOpen() {
    try {
      var pan = document.getElementById("iu-aiPanel");
      if (!pan) return false;
      if (pan.hasAttribute("hidden")) return false;
      if (String(pan.dataset.open || "") === "1") return true;
      return false;
    } catch (_) {
      return false;
    }
  }

  function hasIntentionalToolOverlayOpen() {
    try {
      var b = document.body;
      if (!b || !b.classList) return false;
      for (var i = 0; i < INTENTIONAL_TOOL_OVERLAY_BODY_CLASSES.length; i++) {
        if (b.classList.contains(INTENTIONAL_TOOL_OVERLAY_BODY_CLASSES[i])) return true;
      }
      /* Desktop AI asistenti use iu-modal-open without iu-ai-narrow-fullscreen.
         Missing this check made restoreAppShellAfterReturn strip iu-modal-open and
         collapse #iu-aiPanel from inset:0/100dvh back to top:84px/max-height clip. */
      if (isAiAssistantsOverlayOpen()) return true;
      var ds = document.getElementById("iuDsPanel");
      if (ds && String(ds.dataset.open || "") === "1" && !ds.hasAttribute("hidden")) return true;
      var fin = document.getElementById("iuFinancialCalcPanel");
      if (fin && String(fin.dataset.open || "") === "1" && !fin.hasAttribute("hidden")) return true;
      var leg = document.getElementById("iuLegalDocsPanel");
      if (leg && String(leg.dataset.open || "") === "1" && !leg.hasAttribute("hidden")) return true;
      var inv = document.getElementById("iuInvoicePanel");
      if (inv && String(inv.dataset.open || "") === "1" && !inv.hasAttribute("hidden")) return true;
      var cal = document.getElementById("iuCalendarOverlay");
      if (cal && !cal.hidden && !cal.hasAttribute("hidden")) return true;
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
      var aiScrollY = 0;
      try {
        if (isAiAssistantsOverlayOpen()) {
          var aiBody0 = document.querySelector("#iu-aiPanel .iu-aiPanelBody, #iu-aiPanel .iu-ai-scroll-host");
          if (aiBody0) aiScrollY = aiBody0.scrollTop || 0;
        }
      } catch (_sy) {}
      document.body.classList.add("iu-modal-open");
      if (isAiAssistantsOverlayOpen()) {
        try {
          if (typeof window.ensureAiModalInBody === "function") window.ensureAiModalInBody();
          if (typeof window.iuAiEnsureGuardClasses === "function") window.iuAiEnsureGuardClasses();
        } catch (_ai) {}
        try {
          var aiPan = document.getElementById("iu-aiPanel");
          var aiOv = document.getElementById("iu-aiOverlay");
          if (aiPan) {
            aiPan.dataset.open = "1";
            if (typeof window.iuSetElOpenVisible === "function") window.iuSetElOpenVisible(aiPan, true);
            else {
              aiPan.hidden = false;
              aiPan.removeAttribute("hidden");
            }
          }
          if (aiOv) {
            if (typeof window.iuSetElOpenVisible === "function") window.iuSetElOpenVisible(aiOv, true);
            else {
              aiOv.hidden = false;
              aiOv.removeAttribute("hidden");
            }
          }
          /* Force a layout pass against current viewport — no timeout reopen. */
          if (aiPan) void aiPan.offsetHeight;
          try {
            var aiBody1 = document.querySelector("#iu-aiPanel .iu-aiPanelBody, #iu-aiPanel .iu-ai-scroll-host");
            if (aiBody1 && aiScrollY > 0) aiBody1.scrollTop = aiScrollY;
          } catch (_sy2) {}
        } catch (_ai2) {}
      }
      if (document.body.classList.contains("iu-ds-overlay-open") ||
          (function () {
            var ds = document.getElementById("iuDsPanel");
            return !!(ds && String(ds.dataset.open || "") === "1" && !ds.hasAttribute("hidden"));
          })()) {
        document.body.classList.add("iu-ds-overlay-open", "iu-modal-open");
        if (typeof window.ensureDatovkaModalInBody === "function") window.ensureDatovkaModalInBody();
        try {
          var dsPan = document.getElementById("iuDsPanel");
          if (dsPan && String(dsPan.dataset.open || "") !== "1") {
            if (typeof window.iuOpenOverlay === "function") window.iuOpenOverlay("datovka");
          }
        } catch (_dsRe) {}
      } else {
        try {
          if (typeof window.iuMindMenuReadReturnPending === "function") {
            var pendDs = window.iuMindMenuReadReturnPending();
            if (pendDs && pendDs.tool === "datovka" && typeof window.iuOpenOverlay === "function") {
              window.iuOpenOverlay("datovka");
              document.body.classList.add("iu-modal-open", "iu-ds-overlay-open");
              if (typeof window.ensureDatovkaModalInBody === "function") window.ensureDatovkaModalInBody();
            }
          }
        } catch (_pendDs) {}
      }
    } catch (_) {}
  }

  function traceExternalReturn(tag, detail) {
    try {
      var entry = {
        t: Date.now(),
        tag: String(tag || ""),
        detail: detail && typeof detail === "object" ? detail : {},
      };
      externalReturnTraceRing.push(entry);
      if (externalReturnTraceRing.length > 48) externalReturnTraceRing.shift();
      try {
        if (localStorage.getItem(PWA_RETURN_TRACE_LS) === "1") {
          refreshExternalReturnDiagPanel();
        }
      } catch (_) {}
      try {
        if (window.iuPwaReturnRecorder && typeof window.iuPwaReturnRecorder.ingestTrace === "function") {
          window.iuPwaReturnRecorder.ingestTrace(String(tag || ""), entry.detail);
        }
      } catch (_) {}
    } catch (_) {}
  }

  function isExternalReturnDiagEnabled() {
    try {
      if (localStorage.getItem(PWA_RETURN_DIAG_LS) === "1") return true;
      if (localStorage.getItem(PWA_RETURN_TRACE_LS) === "1") return true;
      var q = new URLSearchParams(location.search || "");
      if (q.get("iuPwaReturnDiag") === "1") return true;
    } catch (_) {}
    return false;
  }

  function externalReturnDiagSnapshot() {
    var wrap = document.getElementById("iuMobileGateWrap");
    var gate = wrap ? String(wrap.getAttribute("data-iu-mobile-gate") || "") : "";
    var holdUntil = 0;
    try {
      holdUntil = parseInt(sessionStorage.getItem(EXTERNAL_RETURN_HOLD_UNTIL_KEY) || "0", 10);
    } catch (_) {}
    return {
      buildId: PWA_EXTERNAL_RETURN_BUILD_ID,
      href: location.pathname + location.search + location.hash,
      gate: gate,
      gen: externalReturnGeneration,
      inFlight: externalRestoreInFlight,
      holdUntil: holdUntil,
      holdActive: isExternalReturnHoldActive(),
      restoreActive: isExternalReturnRestoreActive(),
      session: {
        ext: sessionStorage.getItem(EXTERNAL_ARMED_KEY) || "",
        restoring: sessionStorage.getItem(EXTERNAL_RESTORE_ACTIVE_KEY) || "",
        mainY: sessionStorage.getItem(EXTERNAL_MAIN_SCROLL_KEY) || "",
        navArm: sessionStorage.getItem("iuMobileWebNavReturnArmed") || "",
      },
      trace: externalReturnTraceRing.slice(-24),
    };
  }

  function refreshExternalReturnDiagPanel() {
    if (!externalReturnDiagEl) return;
    try {
      externalReturnDiagEl.textContent = JSON.stringify(externalReturnDiagSnapshot(), null, 2);
    } catch (_) {}
  }

  function enableExternalReturnDiagPanel() {
    try {
      localStorage.setItem(PWA_RETURN_DIAG_LS, "1");
      localStorage.setItem(PWA_RETURN_TRACE_LS, "1");
    } catch (_) {}
    traceExternalReturn("diag_enable", { via: "api" });
    ensureExternalReturnDiagPanel();
  }

  function ensureExternalReturnDiagPanel() {
    if (!isExternalReturnDiagEnabled()) return;
    if (externalReturnDiagEl) {
      refreshExternalReturnDiagPanel();
      return;
    }
    if (!document.body) return;
    var panel = document.createElement("div");
    panel.id = "iuPwaExternalReturnDiag";
    panel.setAttribute("role", "complementary");
    panel.style.cssText =
      "position:fixed;left:8px;right:8px;bottom:calc(var(--iu-mobile-bottom-nav-safe-space,72px) + 8px);z-index:10040;max-height:42vh;overflow:auto;padding:8px 10px;border-radius:10px;background:rgba(12,16,24,.94);color:#e8eef8;font:11px/1.35 ui-monospace,Consolas,monospace;box-shadow:0 6px 24px rgba(0,0,0,.35);";
    var title = document.createElement("div");
    title.textContent = "PWA return diag · " + PWA_EXTERNAL_RETURN_BUILD_ID;
    title.style.cssText = "font-weight:600;margin-bottom:6px;font-family:system-ui,sans-serif;font-size:12px;";
    panel.appendChild(title);
    var pre = document.createElement("pre");
    pre.style.cssText = "margin:0;white-space:pre-wrap;word-break:break-word;";
    panel.appendChild(pre);
    externalReturnDiagEl = pre;
    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;";
    function mkBtn(label, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText =
        "padding:6px 10px;border-radius:8px;border:0;background:#3b82f6;color:#fff;font:12px system-ui,sans-serif;";
      b.addEventListener("click", fn);
      return b;
    }
    row.appendChild(
      mkBtn("Kopírovat", function () {
        try {
          var txt = externalReturnDiagEl.textContent || "";
          if (navigator.clipboard && navigator.clipboard.writeText) {
            void navigator.clipboard.writeText(txt);
          } else {
            var ta = document.createElement("textarea");
            ta.value = txt;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
          }
        } catch (_) {}
      })
    );
    row.appendChild(
      mkBtn(localStorage.getItem(PWA_RETURN_TRACE_LS) === "1" ? "Trace ON" : "Trace OFF", function () {
        try {
          var on = localStorage.getItem(PWA_RETURN_TRACE_LS) === "1";
          localStorage.setItem(PWA_RETURN_TRACE_LS, on ? "0" : "1");
          localStorage.setItem(PWA_RETURN_DIAG_LS, "1");
          traceExternalReturn("trace_toggle", { on: !on });
          ensureExternalReturnDiagPanel();
        } catch (_) {}
      })
    );
    row.appendChild(
      mkBtn("Skrýt", function () {
        try {
          localStorage.setItem(PWA_RETURN_DIAG_LS, "0");
        } catch (_) {}
        try {
          panel.remove();
        } catch (_) {}
        externalReturnDiagEl = null;
      })
    );
    panel.appendChild(row);
    document.body.appendChild(panel);
    try {
      localStorage.setItem(PWA_RETURN_DIAG_LS, "1");
    } catch (_) {}
    refreshExternalReturnDiagPanel();
  }

  function clearStaleMindMenuPendingForHubNav(reason) {
    if (String(reason || "") !== "section_apply") return;
    try {
      if (typeof window.iuMindMenuClearReturnPending === "function") {
        window.iuMindMenuClearReturnPending();
      } else {
        localStorage.removeItem("iuMindMenuReturnPendingV1");
      }
    } catch (_) {}
    try {
      sessionStorage.removeItem("iuMindMenuReturnArmed");
      sessionStorage.removeItem("iuMindMenuReturnScrollY");
      sessionStorage.removeItem("iuMindMenuReturnLatchTs");
    } catch (_) {}
    try {
      if (
        typeof window.__iuMmReturnBootRelease === "function" &&
        document.documentElement.classList.contains("iu-mm-return-boot")
      ) {
        window.__iuMmReturnBootRelease("clear-markers");
      }
    } catch (_) {}
    try {
      if (String(reason || "") === "section_apply") {
        sessionStorage.removeItem("iuMindMenuReturnLatchTs");
      }
    } catch (_) {}
    try {
      var qs = new URLSearchParams(String(location.search || ""));
      if (!qs.has("section")) {
        localStorage.removeItem(HUB_SECTION_RETURN_LS);
      }
    } catch (_) {}
  }

  function readHubSectionReturnResume() {
    try {
      var raw = localStorage.getItem(HUB_SECTION_RETURN_LS);
      if (!raw) return "";
      var obj = JSON.parse(raw);
      var sec = String(obj && obj.section ? obj.section : "").trim();
      var ts = Number(obj && obj.t);
      if (!sec || !Number.isFinite(ts) || ts <= 0) return "";
      if (Date.now() - ts > HUB_SECTION_RETURN_TTL_MS) {
        localStorage.removeItem(HUB_SECTION_RETURN_LS);
        return "";
      }
      return sec;
    } catch (_) {
      return "";
    }
  }

  function writeHubSectionReturnResume() {
    try {
      if (!window.matchMedia || !window.matchMedia("(max-width: 900px)").matches) {
        sessionStorage.removeItem(HUB_SECTION_ARM_SESSION_KEY);
        return;
      }
      var wrap = document.getElementById("iuMobileGateWrap");
      var gate = wrap ? String(wrap.getAttribute("data-iu-mobile-gate") || "") : "";
      if (gate === "tools") {
        sessionStorage.removeItem(HUB_SECTION_ARM_SESSION_KEY);
        return;
      }
      var sec = new URL(location.href).searchParams.get("section");
      sec = String(sec || "").trim();
      if (!sec) {
        sessionStorage.removeItem(HUB_SECTION_ARM_SESSION_KEY);
        return;
      }
      sessionStorage.setItem(HUB_SECTION_ARM_SESSION_KEY, sec);
      localStorage.setItem(HUB_SECTION_RETURN_LS, JSON.stringify({ section: sec, t: Date.now() }));
    } catch (_) {}
  }

  function shouldSkipMindMenuRestoreOnExternalReturn() {
    try {
      var armed = sessionStorage.getItem(HUB_SECTION_ARM_SESSION_KEY);
      return !!(armed && String(armed).trim());
    } catch (_) {}
    return false;
  }

  function writeExternalMainScrollPersist(y) {
    try {
      if (!Number.isFinite(y) || y <= 0) return;
      localStorage.setItem(
        EXTERNAL_MAIN_SCROLL_PERSIST_LS,
        JSON.stringify({ y: Math.round(y), t: Date.now(), gen: externalReturnGeneration, route: "home" })
      );
    } catch (_) {}
  }

  function readExternalMainScrollPersist() {
    try {
      var raw = localStorage.getItem(EXTERNAL_MAIN_SCROLL_PERSIST_LS);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !Number.isFinite(o.y) || o.y <= 0) return null;
      var ts = Number(o.t);
      if (!Number.isFinite(ts) || Date.now() - ts > EXTERNAL_MAIN_SCROLL_PERSIST_TTL_MS) {
        localStorage.removeItem(EXTERNAL_MAIN_SCROLL_PERSIST_LS);
        return null;
      }
      return o;
    } catch (_) {
      return null;
    }
  }

  function clearExternalMainScrollPersist() {
    try {
      localStorage.removeItem(EXTERNAL_MAIN_SCROLL_PERSIST_LS);
    } catch (_) {}
  }

  function writeMenuNavReturnPersist(y, gateTab) {
    try {
      if (gateTab !== "nav") return;
      if (!Number.isFinite(y) || y < 0) y = 0;
      localStorage.setItem(
        EXTERNAL_MENU_RETURN_PERSIST_LS,
        JSON.stringify({ y: Math.round(y), t: Date.now(), gate: "nav" })
      );
    } catch (_) {}
  }

  function readMenuNavReturnPersist() {
    try {
      var raw = localStorage.getItem(EXTERNAL_MENU_RETURN_PERSIST_LS);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || o.gate !== "nav") return null;
      var ts = Number(o.t);
      if (!Number.isFinite(ts) || Date.now() - ts > EXTERNAL_MENU_RETURN_PERSIST_TTL_MS) {
        localStorage.removeItem(EXTERNAL_MENU_RETURN_PERSIST_LS);
        return null;
      }
      return o;
    } catch (_) {
      return null;
    }
  }

  function clearMenuNavReturnPersist() {
    try {
      localStorage.removeItem(EXTERNAL_MENU_RETURN_PERSIST_LS);
    } catch (_) {}
  }

  function touchExternalReturnPostSettlePersist() {
    try {
      localStorage.setItem(
        EXTERNAL_POST_SETTLE_LS,
        JSON.stringify({ until: Date.now() + EXTERNAL_RETURN_POST_HOLD_MS, t: Date.now() })
      );
    } catch (_) {}
  }

  function isExternalReturnPostSettlePersistActive() {
    try {
      var raw = localStorage.getItem(EXTERNAL_POST_SETTLE_LS);
      if (!raw) return false;
      var o = JSON.parse(raw);
      var until = Number(o && o.until);
      if (!Number.isFinite(until) || until <= Date.now()) {
        localStorage.removeItem(EXTERNAL_POST_SETTLE_LS);
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function clearExternalReturnPostSettlePersist() {
    try {
      localStorage.removeItem(EXTERNAL_POST_SETTLE_LS);
    } catch (_) {}
  }

  function clearExternalMainScrollKeys() {
    try {
      sessionStorage.removeItem(EXTERNAL_MAIN_SCROLL_KEY);
    } catch (_) {}
    clearExternalMainScrollPersist();
    externalMainScrollRestoreState = null;
  }

  function externalMainScrollTargetY() {
    try {
      var raw = sessionStorage.getItem(EXTERNAL_MAIN_SCROLL_KEY);
      var y = parseInt(raw || "0", 10);
      if (Number.isFinite(y) && y > 0) return y;
    } catch (_) {}
    var p = readExternalMainScrollPersist();
    return p && Number.isFinite(p.y) ? p.y : 0;
  }

  function cancelExternalMainScrollRestoreTick() {
    externalMainScrollRestoreState = null;
  }

  function startExternalMainScrollRestoreCoordinated(gen) {
    var target = externalMainScrollTargetY();
    if (!(target > 0)) return;
    cancelExternalMainScrollRestoreTick();
    externalMainScrollRestoreState = { y: target, gen: gen };
    if (typeof window.iuPwaCoordinatedMainScrollRestore !== "function") {
      try {
        if (typeof window.iuPwaApplyMainScrollY === "function") window.iuPwaApplyMainScrollY(target);
      } catch (_) {}
      cancelExternalMainScrollRestoreTick();
      return;
    }
    window.iuPwaCoordinatedMainScrollRestore({
      targetY: target,
      shouldContinue: function () {
        return !!(externalMainScrollRestoreState && externalMainScrollRestoreState.gen === gen);
      },
      onTrace: function (detail) {
        traceExternalReturn("main_scroll_restore_trace", detail || {});
      },
      onComplete: function (detail) {
        if (!externalMainScrollRestoreState || externalMainScrollRestoreState.gen !== gen) return;
        cancelExternalMainScrollRestoreTick();
        clearExternalMainScrollPersist();
        clearExternalReturnPostSettlePersist();
        traceExternalReturn("main_scroll_restore_done", detail || {});
      },
      onCancel: function (detail) {
        if (!externalMainScrollRestoreState || externalMainScrollRestoreState.gen !== gen) return;
        cancelExternalMainScrollRestoreTick();
        traceExternalReturn("main_scroll_restore_cancel", detail || {});
      },
    });
  }

  function bootRestoreExternalMainScrollAfterDocumentLoad() {
    var p = readExternalMainScrollPersist();
    if (!p) return;
    try {
      if (new URL(location.href).searchParams.has("section")) return;
    } catch (_) {}
    try {
      sessionStorage.setItem(EXTERNAL_MAIN_SCROLL_KEY, String(Math.round(p.y)));
    } catch (_) {}
    startExternalMainScrollRestoreCoordinated(externalReturnGeneration);
    traceExternalReturn("boot_main_scroll_restore", { y: p.y });
  }

  function shouldPreserveExternalMainScrollOnHubSectionApply() {
    try {
      if (new URL(location.href).searchParams.has("section")) return false;
    } catch (_) {
      return false;
    }
    if (readExternalMainScrollPersist()) return true;
    try {
      if (sessionStorage.getItem(EXTERNAL_MAIN_SCROLL_KEY)) return true;
    } catch (_) {}
    if (isExternalReturnVersionDeferActive()) return true;
    if (isExternalReturnHoldActive()) return true;
    return false;
  }

  function cancelExternalReturnRestoreForSectionApply() {
    if (!shouldPreserveExternalMainScrollOnHubSectionApply()) {
      cancelExternalReturnRestore("section_apply");
      return;
    }
    externalReturnGeneration += 1;
    traceExternalReturn("cancel", { reason: "section_apply_preserve_main" });
    clearStaleMindMenuPendingForHubNav("section_apply");
    try {
      if (externalReturnSettleTimer) clearTimeout(externalReturnSettleTimer);
      externalReturnSettleTimer = null;
      if (externalReturnSettleRaf) cancelAnimationFrame(externalReturnSettleRaf);
      externalReturnSettleRaf = 0;
    } catch (_) {}
    try {
      sessionStorage.removeItem(EXTERNAL_ARMED_KEY);
      sessionStorage.removeItem(EXTERNAL_RESTORE_ACTIVE_KEY);
      sessionStorage.removeItem(EXTERNAL_RETURN_GATE_KEY);
      sessionStorage.removeItem(HUB_SECTION_ARM_SESSION_KEY);
      sessionStorage.removeItem("iuMobileWebNavReturnArmed");
    } catch (_) {}
    externalRestoreInFlight = false;
    refreshExternalReturnDiagPanel();
    bootRestoreExternalMainScrollAfterDocumentLoad();
  }

  /** User navigation / new view — drop stale return arms so delayed restore cannot overwrite. */
  function cancelExternalReturnRestore(reason) {
    externalReturnGeneration += 1;
    traceExternalReturn("cancel", { reason: String(reason || "") });
    clearStaleMindMenuPendingForHubNav(reason);
    try {
      if (externalReturnSettleTimer) clearTimeout(externalReturnSettleTimer);
      externalReturnSettleTimer = null;
      if (externalReturnSettleRaf) cancelAnimationFrame(externalReturnSettleRaf);
      externalReturnSettleRaf = 0;
    } catch (_) {}
    try {
      sessionStorage.removeItem(EXTERNAL_ARMED_KEY);
      sessionStorage.removeItem(EXTERNAL_RESTORE_ACTIVE_KEY);
      sessionStorage.removeItem(EXTERNAL_RETURN_HOLD_UNTIL_KEY);
      sessionStorage.removeItem(EXTERNAL_RETURN_VERSION_DEFER_UNTIL_KEY);
      clearExternalReturnPostSettlePersist();
      clearExternalMainScrollKeys();
      sessionStorage.removeItem(EXTERNAL_RETURN_GATE_KEY);
      sessionStorage.removeItem(HUB_SECTION_ARM_SESSION_KEY);
      sessionStorage.removeItem("iuMobileWebNavReturnArmed");
    } catch (_) {}
    externalRestoreInFlight = false;
    refreshExternalReturnDiagPanel();
  }

  function externalReturnSettleReady() {
    try {
      var pending = null;
      try {
        pending = localStorage.getItem("iuMindMenuReturnPendingV1");
      } catch (_) {}
      var wrap = document.getElementById("iuMobileGateWrap");
      var gate = wrap ? String(wrap.getAttribute("data-iu-mobile-gate") || "") : "";
      if (pending) {
        return gate === "tools" || gate === "nav";
      }
      if (
        typeof window.iuMindMenuReturnBootHidesHome === "function" &&
        window.iuMindMenuReturnBootHidesHome()
      ) {
        return false;
      }
      try {
        if (sessionStorage.getItem("iuMobileWebNavReturnArmed") === "1") {
          return gate === "nav";
        }
      } catch (_) {}
      return true;
    } catch (_) {
      return true;
    }
  }

  /** Drop return arms when external open never left the app (popup blocked, aborted gesture). */
  function abortExternalReturnArmsAfterFailedOpen() {
    try {
      sessionStorage.removeItem(EXTERNAL_ARMED_KEY);
      sessionStorage.removeItem(EXTERNAL_RESTORE_ACTIVE_KEY);
      sessionStorage.removeItem(EXTERNAL_RETURN_HOLD_UNTIL_KEY);
      sessionStorage.removeItem(EXTERNAL_MAIN_SCROLL_KEY);
      sessionStorage.removeItem(EXTERNAL_RETURN_GATE_KEY);
      sessionStorage.removeItem("iuMobileWebNavReturnArmed");
    } catch (_) {}
    try {
      if (externalReturnSettleTimer) clearTimeout(externalReturnSettleTimer);
    } catch (_) {}
    finishExternalReturnRestore();
  }

  function touchExternalReturnHoldUntil() {
    try {
      sessionStorage.setItem(EXTERNAL_RETURN_HOLD_UNTIL_KEY, String(Date.now() + EXTERNAL_RETURN_SETTLE_MS));
    } catch (_) {}
  }

  function isExternalReturnHoldActive() {
    try {
      var until = parseInt(sessionStorage.getItem(EXTERNAL_RETURN_HOLD_UNTIL_KEY) || "0", 10);
      if (Number.isFinite(until) && until > Date.now()) return true;
    } catch (_) {}
    if (isExternalReturnPostSettlePersistActive()) return true;
    return false;
  }

  function isExternalReturnVersionDeferActive() {
    try {
      var until = parseInt(sessionStorage.getItem(EXTERNAL_RETURN_VERSION_DEFER_UNTIL_KEY) || "0", 10);
      if (Number.isFinite(until) && until > Date.now()) return true;
    } catch (_) {}
    return false;
  }

  function finishExternalReturnRestore() {
    try {
      sessionStorage.removeItem(EXTERNAL_ARMED_KEY);
      sessionStorage.removeItem(EXTERNAL_RESTORE_ACTIVE_KEY);
      sessionStorage.removeItem(EXTERNAL_RETURN_HOLD_UNTIL_KEY);
      sessionStorage.setItem(EXTERNAL_RETURN_VERSION_DEFER_UNTIL_KEY, String(Date.now() + EXTERNAL_RETURN_POST_HOLD_MS));
      touchExternalReturnPostSettlePersist();
      sessionStorage.removeItem(HUB_SECTION_ARM_SESSION_KEY);
    } catch (_) {}
    externalRestoreInFlight = false;
    externalReturnSettleTimer = null;
    try {
      if (externalReturnSettleRaf) cancelAnimationFrame(externalReturnSettleRaf);
    } catch (_) {}
    externalReturnSettleRaf = 0;
  }

  function scheduleExternalReturnSettle() {
    touchExternalReturnHoldUntil();
    traceExternalReturn("settle_schedule", {});
    if (externalReturnSettleTimer) {
      try {
        clearTimeout(externalReturnSettleTimer);
      } catch (_) {}
      externalReturnSettleTimer = null;
    }
    if (externalReturnSettleRaf) {
      try {
        cancelAnimationFrame(externalReturnSettleRaf);
      } catch (_) {}
      externalReturnSettleRaf = 0;
    }
    var gen = externalReturnGeneration;
    var started = Date.now();
    function finishIfCurrent() {
      if (gen !== externalReturnGeneration) return;
      finishExternalReturnRestore();
      traceExternalReturn("settle_done", { ms: Date.now() - started });
      refreshExternalReturnDiagPanel();
    }
    function poll() {
      if (gen !== externalReturnGeneration) return;
      if (Date.now() - started >= EXTERNAL_RETURN_SETTLE_MS) {
        finishIfCurrent();
        return;
      }
      if (externalReturnSettleReady()) {
        finishIfCurrent();
        return;
      }
      externalReturnSettleRaf = requestAnimationFrame(poll);
    }
    externalReturnSettleRaf = requestAnimationFrame(poll);
    externalReturnSettleTimer = setTimeout(finishIfCurrent, EXTERNAL_RETURN_SETTLE_MS + 48);
  }

  function syncExternalReturnArmBeforeHandoff() {
    try {
      var y = 0;
      if (typeof window.iuPwaGetMainScrollY === "function") y = window.iuPwaGetMainScrollY();
      else y = window.scrollY || 0;
      if (Number.isFinite(y) && y > 0) {
        sessionStorage.setItem(EXTERNAL_MAIN_SCROLL_KEY, String(Math.round(y)));
        writeExternalMainScrollPersist(y);
      }
    } catch (_) {}
    try {
      var wrap = document.getElementById("iuMobileGateWrap");
      var gateTab = wrap ? String(wrap.getAttribute("data-iu-mobile-gate") || "") : "";
      if (gateTab) sessionStorage.setItem(EXTERNAL_RETURN_GATE_KEY, gateTab);
      if (gateTab === "nav") {
        var menuY = 0;
        try {
          if (typeof window.iuMenuNavCaptureScroll === "function") window.iuMenuNavCaptureScroll();
        } catch (_) {}
        try {
          if (typeof window.iuMenuNavReadScroll === "function") menuY = window.iuMenuNavReadScroll() || 0;
        } catch (_) {}
        if (!(menuY > 0)) {
          try {
            menuY = parseInt(sessionStorage.getItem("iuMenuNavPanelScrollY") || "0", 10) || 0;
          } catch (_) {}
        }
        writeMenuNavReturnPersist(menuY, "nav");
      }
    } catch (_) {}
    try {
      if (typeof window.iuMobileWebNavArmForExternalFromMenu === "function") {
        window.iuMobileWebNavArmForExternalFromMenu();
      }
    } catch (_) {}
    try {
      if (typeof window.iuMindMenuArmReturnState === "function") {
        var wrapArm = document.getElementById("iuMobileGateWrap");
        var gateArm = wrapArm ? String(wrapArm.getAttribute("data-iu-mobile-gate") || "") : "";
        if (gateArm === "tools" || hasIntentionalToolOverlayOpen()) window.iuMindMenuArmReturnState();
      }
    } catch (_) {}
    writeHubSectionReturnResume();
    try {
      if (typeof window.iuScrollRestoreSaveNow === "function") window.iuScrollRestoreSaveNow();
    } catch (_) {}
  }

  function runDeferredExternalReturnSnapshotWork() {
    externalReturnDeferredSnapshotPending = false;
    touchExternalReturnHoldUntil();
    try {
      if (typeof window.iuMenuNavCaptureScroll === "function") window.iuMenuNavCaptureScroll();
    } catch (_) {}
  }

  function deferExternalReturnSnapshotAfterHandoff() {
    externalReturnDeferredSnapshotPending = true;
    var flushed = false;
    function flushOnce() {
      if (flushed) return;
      flushed = true;
      runDeferredExternalReturnSnapshotWork();
    }
    setTimeout(flushOnce, 0);
    try {
      window.addEventListener("pagehide", flushOnce, { once: true, capture: true });
    } catch (_) {}
  }

  function capturePwaExternalReturnSnapshot() {
    touchExternalReturnHoldUntil();
    try {
      if (typeof window.iuScrollRestoreSaveNow === "function") window.iuScrollRestoreSaveNow();
    } catch (_) {}
    syncExternalReturnArmBeforeHandoff();
    try {
      if (typeof window.iuMenuNavCaptureScroll === "function") window.iuMenuNavCaptureScroll();
    } catch (_) {}
    writeHubSectionReturnResume();
  }

  function restorePwaExternalMainScrollIfNeeded() {
    var scrollGen = externalReturnGeneration;
    try {
      var y = externalMainScrollTargetY();
      if (!Number.isFinite(y) || y <= 0) return;
      var wrap = document.getElementById("iuMobileGateWrap");
      var gateOpen = wrap && String(wrap.getAttribute("data-iu-mobile-gate") || "") !== "";
      if (gateOpen || document.body.classList.contains("iu-mobileGateOverlayOpen")) return;
      try {
        sessionStorage.setItem(EXTERNAL_MAIN_SCROLL_KEY, String(Math.round(y)));
      } catch (_) {}
      startExternalMainScrollRestoreCoordinated(scrollGen);
    } catch (_) {}
  }

  function ensureWebNavHistoryForExternalReturn() {
    try {
      var armed = false;
      try {
        armed = sessionStorage.getItem("iuMobileWebNavReturnArmed") === "1";
      } catch (_) {}
      var gateHint = "";
      try {
        gateHint = sessionStorage.getItem(EXTERNAL_RETURN_GATE_KEY) || "";
      } catch (_) {}
      if (!armed && gateHint !== "nav") return;
      var u = new URL(location.href);
      /* P0: never graft #iu-nav onto ?section= — corrupts URL, duplicates history, can trigger iOS PWA reload. */
      if (u.searchParams.has("section")) return;
      var h = String(location.hash || "");
      if (h === "#iu-nav" || h === "#nav") return;
      u.hash = "iu-nav";
      history.replaceState({ iu_nav_overlay: true, iu_nav_origin: "homepage" }, "", u.toString());
    } catch (_) {}
  }

  function invokeReturnNavigationRestore() {
    var restoreGen = externalReturnGeneration;
    /* P0: while a fullscreen tool overlay is open, do not remount MindMenu tools chrome
       (would surface MindMenu/iCentrum header around Datové schránky after external return). */
    if (hasIntentionalToolOverlayOpen()) {
      reassertIntentionalOverlayShell();
      return;
    }
    ensureWebNavHistoryForExternalReturn();
    try {
      if (!shouldSkipMindMenuRestoreOnExternalReturn() && typeof window.iuMindMenuRestoreIfArmed === "function") {
        window.iuMindMenuRestoreIfArmed();
      }
    } catch (_) {}
    /* Do not call iuMindMenuSyncGateFromHistory here — restoreIfArmed + EnsureHistoryEntry
       already re-open tools; SyncGate on the same tick closed tools → Home (visible flicker). */
    try {
      if (typeof window.iuMobileWebNavSyncFromHistory === "function") window.iuMobileWebNavSyncFromHistory();
    } catch (_) {}
    restorePwaExternalMainScrollIfNeeded();
    try {
      var wrapNav = document.getElementById("iuMobileGateWrap");
      var gateNav = wrapNav ? String(wrapNav.getAttribute("data-iu-mobile-gate") || "") : "";
      if (gateNav === "nav" && typeof window.iuMenuNavApplyScroll === "function" && typeof window.iuMenuNavReadScroll === "function") {
        var menuY = window.iuMenuNavReadScroll();
        if (menuY > 0) window.iuMenuNavApplyScroll(menuY);
      }
    } catch (_) {}
    /* MindMenu latch belongs only on tools restore — not hub-section external (recorder 20261013). */
    try {
      if (
        !shouldSkipMindMenuRestoreOnExternalReturn() &&
        typeof window.iuMindMenuTouchReturnLatch === "function"
      ) {
        var gateBeforeLatch = "";
        try {
          var wLatch = document.getElementById("iuMobileGateWrap");
          gateBeforeLatch = wLatch ? String(wLatch.getAttribute("data-iu-mobile-gate") || "") : "";
        } catch (_) {}
        var gateHintLatch = "";
        try {
          gateHintLatch = sessionStorage.getItem(EXTERNAL_RETURN_GATE_KEY) || "";
        } catch (_) {}
        if (gateBeforeLatch === "tools" || gateHintLatch === "tools") {
          window.iuMindMenuTouchReturnLatch();
        }
      }
    } catch (_) {}
    try {
      sessionStorage.removeItem(EXTERNAL_RETURN_GATE_KEY);
      sessionStorage.removeItem("iuMobileWebNavReturnArmed");
    } catch (_) {}
    if (restoreGen !== externalReturnGeneration) return;
    touchExternalReturnHoldUntil();
    try {
      var gateDone = "";
      try {
        var wDone = document.getElementById("iuMobileGateWrap");
        gateDone = wDone ? String(wDone.getAttribute("data-iu-mobile-gate") || "") : "";
      } catch (_) {}
      if (gateDone === "nav") clearMenuNavReturnPersist();
    } catch (_) {}
  }

  function restoreAppShellAfterReturn() {
    if (externalRestoreInFlight) {
      if (shouldRestoreShell()) clearShellErrorUiOnly();
      reassertIntentionalOverlayShell();
      return;
    }
    if (!shouldRestoreShell()) {
      reassertIntentionalOverlayShell();
      return;
    }
    traceExternalReturn("restore_start", {});
    externalRestoreInFlight = true;
    try {
      sessionStorage.setItem(EXTERNAL_RESTORE_ACTIVE_KEY, "1");
    } catch (_) {}
    clearShellErrorUiOnly();
    reassertIntentionalOverlayShell();
    try {
      invokeReturnNavigationRestore();
    } finally {
      try {
        sessionStorage.setItem(EXTERNAL_RESTORE_ACTIVE_KEY, "1");
      } catch (_) {}
      scheduleExternalReturnSettle();
    }
  }

  function isExternalReturnRestoreActive() {
    try {
      if (externalRestoreInFlight) return true;
      if (sessionStorage.getItem(EXTERNAL_RESTORE_ACTIVE_KEY) === "1") return true;
      if (sessionStorage.getItem(EXTERNAL_ARMED_KEY) === "1") return true;
      var until = parseInt(sessionStorage.getItem(EXTERNAL_RETURN_HOLD_UNTIL_KEY) || "0", 10);
      if (Number.isFinite(until) && until > Date.now()) return true;
    } catch (_) {}
    return false;
  }

  function armExternalReturn() {
    externalReturnGeneration += 1;
    traceExternalReturn("arm", { gen: externalReturnGeneration });
    capturePwaExternalReturnSnapshot();
    try {
      sessionStorage.setItem(EXTERNAL_ARMED_KEY, "1");
    } catch (_) {}
    /* PWA MindMenu: network-boundary arm so process-death pending survives even if
       a caller skipped iuMindMenuOpenExternalUrl. */
    try {
      if (typeof window.iuMindMenuArmReturnState === "function") {
        var wrapArm = document.getElementById("iuMobileGateWrap");
        var gateArm = wrapArm ? String(wrapArm.getAttribute("data-iu-mobile-gate") || "") : "";
        if (gateArm === "tools" || hasIntentionalToolOverlayOpen()) window.iuMindMenuArmReturnState();
      }
    } catch (_) {}
  }

  function openExternalViaAnchor(url) {
    var a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    /* Must skip bindGlobalExternalCapture: otherwise the synthetic .click() is
       preventDefault'd in the same capture phase, then 600ms dedupe returns
       without opening → dead external buttons (post-#10239 mobile/PWA path). */
    a.setAttribute("data-iu-skip-external-guard", "1");
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  }

  /**
   * Mobile / tablet / iOS PWA / standalone: prefer a single <a target=_blank> open.
   * Avoids window.open(..., "noopener") which always returns null (HTML) and historically
   * triggered a second openExternalViaAnchor → duplicate tab / about:blank (+ PWA "Hotovo").
   * HTTPS targets still get OS Universal/App Link handoff when an app is installed.
   */
  function preferSingleAnchorExternalOpen() {
    try {
      if (typeof navigator !== "undefined" && navigator.standalone === true) return true;
    } catch (_) {}
    try {
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    } catch (_) {}
    try {
      if (window.matchMedia && window.matchMedia("(display-mode: fullscreen)").matches) return true;
    } catch (_) {}
    try {
      var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
      var narrow = window.matchMedia && window.matchMedia("(max-width: 1024px)").matches;
      if (coarse || narrow) return true;
    } catch (_) {}
    try {
      var ua = String((navigator && navigator.userAgent) || "");
      if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
    } catch (_) {}
    return false;
  }

  function openExternalSync(url, isMailTel) {
    externalReturnGeneration += 1;
    traceExternalReturn("arm", { gen: externalReturnGeneration, phase: "pre_handoff" });
    try {
      sessionStorage.setItem(EXTERNAL_ARMED_KEY, "1");
    } catch (_) {}
    syncExternalReturnArmBeforeHandoff();
    /* Do not clear shell/modal locks on depart — menu/MindMenu overlay must stay armed until return settle. */
    try {
      var now = Date.now();
      var last = window.__iuMindMenuLastExternalOpen || null;
      if (last && last.url === url && now - last.ts < 600) return { ok: true, reason: "deduped" };
      window.__iuMindMenuLastExternalOpen = { url: url, ts: now };
    } catch (_) {}
    var handoffT0 = Date.now();
    var opened = false;
    var reason = "blocked";
    try {
      if (isMailTel) {
        opened = openExternalViaAnchor(url);
        reason = opened ? "anchor_mail_tel" : "blocked";
      } else if (preferSingleAnchorExternalOpen()) {
        // One user gesture → one browsing/app target (maps UL + web fallback stay intact).
        opened = openExternalViaAnchor(url);
        reason = opened ? "anchor_mobile_pwa" : "blocked";
      } else {
        // Desktop: window.open with noopener. Spec: return value is null when noopener is set,
        // so NEVER treat null as "popup blocked" or a second open will create about:blank.
        var openThrew = false;
        try {
          window.open(url, "_blank", "noopener,noreferrer");
        } catch (_) {
          openThrew = true;
        }
        if (!openThrew) {
          opened = true;
          reason = "window_open";
        } else {
          opened = openExternalViaAnchor(url);
          reason = opened ? "anchor_after_throw" : "blocked";
        }
      }
    } catch (_) {
      try {
        opened = openExternalViaAnchor(url);
        reason = opened ? "anchor_catch" : "blocked";
      } catch (_a) {
        opened = false;
        reason = "blocked";
      }
    }
    if (!opened && reason !== "deduped") {
      abortExternalReturnArmsAfterFailedOpen();
    } else if (opened) {
      deferExternalReturnSnapshotAfterHandoff();
    }
    traceExternalReturn("external_handoff", {
      ms: Date.now() - handoffT0,
      ok: !!opened,
      reason: reason,
      gen: externalReturnGeneration,
    });
    return { ok: !!opened, reason: reason };
  }

  function openExternalUrl(rawUrl, opts) {
    var url = normalizeExternalUrl(rawUrl);
    if (!url) return Promise.resolve({ ok: false, reason: "empty" });
    var isMailTel = /^mailto:/i.test(url) || /^tel:/i.test(url);
    if (!isMailTel && isLikelyOfflineSignal()) {
      showOfflineHint("Tuto stránku nelze bez připojení k internetu otevřít.");
      abortExternalReturnArmsAfterFailedOpen();
      clearShellErrorUiOnly();
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
        try {
          if (a.closest && a.closest("#iuMobileGatePanelNav")) {
            if (typeof window.iuMenuNavCaptureScroll === "function") window.iuMenuNavCaptureScroll();
            if (typeof window.iuMobileWebNavArmForExternalFromMenu === "function") {
              window.iuMobileWebNavArmForExternalFromMenu();
            }
          }
        } catch (_) {}
        e.preventDefault();
        e.stopPropagation();
        void openExternalUrl(href);
      },
      true
    );
  }

  function bindPwaReturnDiagHashRoute() {
    function tryHash() {
      try {
        var h = String(location.hash || "").replace("#", "").toLowerCase();
        if (h === "iu-pwa-return-diag-enable") {
          enableExternalReturnDiagPanel();
          var u = new URL(location.href);
          u.hash = "";
          history.replaceState(history.state, "", u.toString());
        }
      } catch (_) {}
    }
    window.addEventListener("hashchange", tryHash);
    tryHash();
  }

  function bindPwaReturnDiagBrandGesture() {
    if (window.__iuPwaReturnDiagGesture) return;
    window.__iuPwaReturnDiagGesture = true;
    var taps = [];
    document.addEventListener(
      "click",
      function (e) {
        try {
          var brand = e.target && e.target.closest ? e.target.closest("a.iuBrand") : null;
          if (!brand) return;
          var now = Date.now();
          taps = taps.filter(function (t) {
            return now - t < 4000;
          });
          taps.push(now);
          if (taps.length >= 7) {
            taps = [];
            enableExternalReturnDiagPanel();
          }
        } catch (_) {}
      },
      true
    );
  }

  function bindUserNavigationCancel() {
    if (window.__iuExternalReturnUserNavCancel) return;
    window.__iuExternalReturnUserNavCancel = true;
    document.addEventListener(
      "click",
      function (e) {
        try {
          if (!isExternalReturnRestoreActive() && !isExternalReturnHoldActive()) return;
          var t = e.target && e.target.closest ? e.target.closest("[data-iu-bottom-nav], #iuLeftRail a, .iu-leftNavItem") : null;
          if (!t) return;
          cancelExternalReturnRestore("user_nav_click");
        } catch (_) {}
      },
      true
    );
    window.addEventListener("hashchange", function () {
      try {
        if (!isExternalReturnRestoreActive() && !isExternalReturnHoldActive()) return;
        var h = String(location.hash || "").toLowerCase();
        if (h === "#iu-mindmenu" || h === "#iu-nav" || h === "#nav") return;
        cancelExternalReturnRestore("hashchange");
      } catch (_) {}
    });
  }

  function bindLifecycle() {
    window.addEventListener("pagehide", function () {
      try {
        if (externalReturnDeferredSnapshotPending) runDeferredExternalReturnSnapshotWork();
      } catch (_) {}
      try {
        var yHide = externalMainScrollTargetY();
        if (!(yHide > 0)) {
          if (typeof window.iuPwaGetMainScrollY === "function") yHide = window.iuPwaGetMainScrollY();
        }
        if (Number.isFinite(yHide) && yHide > 0) writeExternalMainScrollPersist(yHide);
      } catch (_) {}
      try {
        var u = new URL(location.href);
        if (u.searchParams.has("section")) {
          sessionStorage.setItem("iuPwaPagehideSectionCanonV1", u.pathname + u.search);
        }
      } catch (_) {}
    });
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
    bindPwaReturnDiagHashRoute();
    bindPwaReturnDiagBrandGesture();
    bindUserNavigationCancel();
    bindLifecycle();
    try {
      bootRestoreExternalMainScrollAfterDocumentLoad();
    } catch (_) {}
    try {
      if (document.readyState === "complete") ensureExternalReturnDiagPanel();
      else window.addEventListener("load", ensureExternalReturnDiagPanel, { once: true });
    } catch (_) {}
    try {
      window.addEventListener("load", function () {
        try {
          bootRestoreExternalMainScrollAfterDocumentLoad();
        } catch (_) {}
      });
    } catch (_) {}
  }

  window.iuNetwork = {
    probeReachability: probeReachability,
    openExternalUrl: openExternalUrl,
    openExternalSync: openExternalSync,
    armExternalReturn: armExternalReturn,
    restoreAppShellAfterReturn: restoreAppShellAfterReturn,
    isExternalReturnRestoreActive: isExternalReturnRestoreActive,
    isExternalReturnHoldActive: isExternalReturnHoldActive,
    isExternalReturnVersionDeferActive: isExternalReturnVersionDeferActive,
    cancelExternalReturnRestore: cancelExternalReturnRestore,
    cancelExternalReturnRestoreForSectionApply: cancelExternalReturnRestoreForSectionApply,
    enableExternalReturnDiagPanel: enableExternalReturnDiagPanel,
    getExternalReturnDiagSnapshot: externalReturnDiagSnapshot,
    pwaExternalReturnBuildId: PWA_EXTERNAL_RETURN_BUILD_ID,
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
