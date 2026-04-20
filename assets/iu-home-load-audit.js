/**
 * Opt-in homepage startup audit for /projects/ hub (section=media default).
 * Enable: window.__IU_HOME_LOAD_AUDIT__ === true before this script runs (see projects/index.html ?iuHomeAudit=1).
 * Zero effect when flag is not true.
 */
(function () {
  "use strict";
  try {
    if (typeof window === "undefined" || window.__IU_HOME_LOAD_AUDIT__ !== true) return;

    var repEarly = {
      enabled: true,
      auditNote: "init",
      href: String(typeof location !== "undefined" ? location.href || "" : ""),
    };
    try {
      window.__IU_HOME_LOAD_AUDIT_REPORT__ = repEarly;
    } catch (eRep) {}

    function pathnameOk() {
      try {
        var p = String(location.pathname || "").replace(/\\/g, "/");
        return (
          p === "/projects/" ||
          p === "/projects" ||
          p === "/projects/index.html"
        );
      } catch (e) {
        return false;
      }
    }

    function isHubHome() {
      try {
        if (!pathnameOk()) return false;
        var sec = String(new URLSearchParams(location.search || "").get("section") || "media")
          .trim()
          .toLowerCase();
        if (sec === "home") sec = "media";
        return sec === "media";
      } catch (e2) {
        return false;
      }
    }

    if (!isHubHome()) {
      try {
        repEarly.auditNote = "skipped_non_hub_home";
        repEarly.pathname = String(typeof location !== "undefined" ? location.pathname || "" : "");
      } catch (eSkip) {}
      return;
    }

    var t0 = typeof performance !== "undefined" && performance.timeOrigin ? performance.timeOrigin : Date.now();
    var perf0 = typeof performance !== "undefined" && performance.now ? performance.now.bind(performance) : function () { return Date.now() - t0; };

    var rep = {
      enabled: true,
      href: String(location.href || ""),
      navigationType: "",
      viewport: { w: typeof window.innerWidth === "number" ? window.innerWidth : 0, h: typeof window.innerHeight === "number" ? window.innerHeight : 0 },
      t0Ms: t0,
      navigationStartMs: 0,
      timeToFirstRenderMs: null,
      timeToFirstCardVisibleMs: null,
      timeToPreviewTitlesReadyMs: null,
      timeToWeatherReadyMs: null,
      timeToHomepageSettledMs: null,
      firstShellVisibleMs: null,
      firstUsableMs: null,
      firstRightRailVisibleMs: null,
      firstViewportStableMs: null,
      firstClickableTimeMs: null,
      firstSuccessfulClickHandledMs: null,
      clickHandledDelayMs: null,
      requestsDuringLoad: null,
      responseBytesTotal: null,
      domNodeCount: null,
      domMutationsFirst10s: 0,
      longTaskCount: 0,
      maxLongTaskMs: 0,
      totalBlockedMsDuringLoad: 0,
      consoleErrorsCount: 0,
      appErrorsCount: 0,
      cls: 0,
      overflowX: null,
      railShift: 0,
      hookTimestamps: {},
      phases: [],
    };

    window.__IU_HOME_LOAD_AUDIT_REPORT__ = rep;

    function relMs() {
      return perf0();
    }

    function mark(name) {
      try {
        rep.hookTimestamps[name] = relMs();
        rep.phases.push({ name: String(name), t: relMs() });
      } catch (e3) {}
    }

    window.__iuHomeLoadAuditHook = function (phase) {
      try {
        mark(String(phase || ""));
        if (phase === "loadData:complete") {
          scheduleSettled();
        }
      } catch (e4) {}
    };

    try {
      var nav = performance.getEntriesByType("navigation")[0];
      if (nav && typeof nav.startTime === "number") rep.navigationStartMs = nav.startTime;
    } catch (e5) {}

    var mutCutoff = relMs() + 10000;
    try {
      if (typeof MutationObserver !== "undefined") {
        var mo = new MutationObserver(function () {
          try {
            if (relMs() <= mutCutoff) rep.domMutationsFirst10s += 1;
          } catch (e6) {}
        });
        mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      }
    } catch (e7) {}

    try {
      if (typeof PerformanceObserver !== "undefined") {
        var poLt = new PerformanceObserver(function (list) {
          try {
            var entries = list.getEntries();
            for (var i = 0; i < entries.length; i++) {
              var e = entries[i];
              var d = typeof e.duration === "number" ? e.duration : 0;
              rep.longTaskCount += 1;
              if (d > rep.maxLongTaskMs) rep.maxLongTaskMs = d;
              rep.totalBlockedMsDuringLoad += d;
            }
          } catch (e8) {}
        });
        try {
          poLt.observe({ type: "longtask", buffered: true });
        } catch (e9) {}
      }
    } catch (e10) {}

    try {
      if (typeof PerformanceObserver !== "undefined") {
        var clsTotal = 0;
        var poCls = new PerformanceObserver(function (list) {
          try {
            var entries = list.getEntries();
            for (var j = 0; j < entries.length; j++) {
              var ls = entries[j];
              if (ls && !ls.hadRecentInput && typeof ls.value === "number") clsTotal += ls.value;
            }
            rep.cls = clsTotal;
          } catch (e11) {}
        });
        try {
          poCls.observe({ type: "layout-shift", buffered: true });
        } catch (e12) {}
      }
    } catch (e13) {}

    var errCons = 0;
    try {
      var prevErr = console.error;
      console.error = function () {
        errCons += 1;
        rep.consoleErrorsCount = errCons;
        try {
          return prevErr.apply(console, arguments);
        } catch (e14) {}
      };
    } catch (e15) {}

    try {
      window.addEventListener(
        "error",
        function () {
          rep.appErrorsCount += 1;
        },
        true
      );
    } catch (e16) {}

    function countDomNodes() {
      try {
        return document.getElementsByTagName("*").length;
      } catch (e17) {
        return null;
      }
    }

    function checkOverflowX() {
      try {
        var w = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        return w > 2;
      } catch (e18) {
        return null;
      }
    }

    var placeholders = [
      "Zprávy se načítají",
      "Sport se načítá",
      "Finance se načítají",
      "Zdraví se načítá",
      "Cestování se načítá",
      "Hry se načítají",
      "Kultura se načítá",
      "Věda se načítá",
      "Vzdělávání se načítá",
    ];

    function titleStillPlaceholder(t) {
      var s = String(t || "").trim();
      for (var p = 0; p < placeholders.length; p++) {
        if (s.indexOf(placeholders[p]) !== -1) return true;
      }
      return false;
    }

    function previewTitlesLookReady() {
      try {
        var sel =
          "[data-iu-news-preview-title-1],[data-iu-sport-preview-title-1],[data-iu-finance-preview-title-1],[data-iu-health-preview-title-1],[data-iu-travel-preview-title-1],[data-iu-games-preview-title-1],[data-iu-culture-preview-title-1],[data-iu-science-history-preview-title-1],[data-iu-education-preview-title-1]";
        var nodes = document.querySelectorAll(sel);
        if (!nodes || nodes.length < 3) return false;
        var ok = 0;
        for (var i = 0; i < nodes.length; i++) {
          var txt = nodes[i].textContent || "";
          if (!titleStillPlaceholder(txt) && String(txt).trim().length > 6) ok += 1;
        }
        return ok >= 3;
      } catch (e19) {
        return false;
      }
    }

    var settledTimer = null;
    function scheduleSettled() {
      try {
        if (settledTimer) clearTimeout(settledTimer);
        settledTimer = setTimeout(function () {
          try {
            rep.timeToHomepageSettledMs = relMs();
            rep.domNodeCount = countDomNodes();
            rep.requestsDuringLoad = performance.getEntriesByType("resource").length;
            var bytes = 0;
            var res = performance.getEntriesByType("resource");
            for (var r = 0; r < res.length; r++) {
              var t = res[r];
              if (typeof t.transferSize === "number" && t.transferSize > 0) bytes += t.transferSize;
              else if (typeof t.decodedBodySize === "number") bytes += t.decodedBodySize;
            }
            rep.responseBytesTotal = bytes;
            rep.overflowX = checkOverflowX();
            try {
              if (typeof window.__iuRailShiftProbe === "number") {
                rep.railShift = window.__iuRailShiftProbe;
              } else {
                rep.railShift = 0;
              }
            } catch (e20) {}
            if (typeof window.__iuHomeLoadAuditFinalize === "function") window.__iuHomeLoadAuditFinalize(rep);
          } catch (e21) {}
        }, 600);
      } catch (e22) {}
    }

    var rafI = 0;
    var rafMax = 9000;
    var stableSigPrev = null;
    var stableSameCount = 0;

    function viewportLayoutSignature() {
      try {
        var parts = [];
        var ids = ["topbarWrap", "iuSilverWelcomeCard", "iuSilverTallScrollSection"];
        for (var si = 0; si < ids.length; si++) {
          var el = document.getElementById(ids[si]);
          if (!el) return null;
          var r = el.getBoundingClientRect();
          parts.push(Math.round(r.top) + ":" + Math.round(r.height) + ":" + Math.round(r.width));
        }
        var rail = document.querySelector(".layout > aside.accordionCol");
        if (rail) {
          var rR = rail.getBoundingClientRect();
          parts.push(Math.round(rR.top) + ":" + Math.round(rR.height) + ":" + Math.round(rR.width));
        }
        return parts.join("|");
      } catch (eSig) {
        return null;
      }
    }

    function rafLoop() {
      rafI += 1;
      try {
        if (!rep.navigationType) {
          var navE = performance.getEntriesByType("navigation")[0];
          rep.navigationType = navE && navE.type ? String(navE.type) : "";
        }
      } catch (eNavLate) {}

      try {
        if (rep.timeToFirstRenderMs == null) {
          var fcp = performance.getEntriesByName("first-contentful-paint")[0];
          if (fcp && typeof fcp.startTime === "number") rep.timeToFirstRenderMs = fcp.startTime;
        }
      } catch (e23) {}

      try {
        if (rep.timeToFirstCardVisibleMs == null) {
          var card = document.getElementById("iuSilverWelcomeCard");
          if (card) {
            var br = card.getBoundingClientRect();
            if (br.width > 40 && br.height > 24) rep.timeToFirstCardVisibleMs = relMs();
          }
        }
      } catch (e24) {}

      try {
        if (rep.timeToPreviewTitlesReadyMs == null && previewTitlesLookReady()) {
          rep.timeToPreviewTitlesReadyMs = relMs();
        }
      } catch (e25) {}

      try {
        if (rep.timeToWeatherReadyMs == null) {
          var wx = document.getElementById("iuSilverWeatherCard");
          if (wx) {
            var ph = wx.getAttribute("data-iu-silver-wx-phase") || "";
            if (ph && ph !== "loading") rep.timeToWeatherReadyMs = relMs();
          }
        }
      } catch (e26) {}

      try {
        if (rep.firstClickableTimeMs == null) {
          var hamb = document.querySelector(".iuHamburger");
          var brand = document.querySelector(".iuBrand");
          if (hamb && brand) {
            rep.firstClickableTimeMs = relMs();
          }
        }
      } catch (e27) {}

      try {
        if (rep.firstShellVisibleMs == null) {
          var tb = document.getElementById("topbarWrap");
          var ap = document.getElementById("app");
          if (tb && ap) {
            var rt = tb.getBoundingClientRect();
            var ra = ap.getBoundingClientRect();
            if (rt.height >= 32 && ra.width > 200) rep.firstShellVisibleMs = relMs();
          }
        }
      } catch (eShell) {}

      try {
        if (rep.firstUsableMs == null) {
          var inp = document.getElementById("iuSilverHomeInput");
          if (inp && !inp.disabled) {
            var ri = inp.getBoundingClientRect();
            if (ri.width >= 80 && ri.height >= 20) rep.firstUsableMs = relMs();
          }
        }
      } catch (eUsa) {}

      try {
        if (rep.firstRightRailVisibleMs == null) {
          var ac = document.querySelector(".layout > aside.accordionCol");
          if (ac) {
            var rac = ac.getBoundingClientRect();
            var vh = typeof window.innerHeight === "number" ? window.innerHeight : 0;
            if (rac.height >= 48 && rac.top < vh && rac.width >= 40) {
              rep.firstRightRailVisibleMs = relMs();
            }
          }
        }
      } catch (eRail) {}

      try {
        if (rep.firstViewportStableMs == null) {
          var sig = viewportLayoutSignature();
          if (sig) {
            if (sig === stableSigPrev) {
              stableSameCount += 1;
            } else {
              stableSigPrev = sig;
              stableSameCount = 1;
            }
            if (stableSameCount >= 3) rep.firstViewportStableMs = relMs();
          }
        }
      } catch (eStab) {}

      if (
        rep.timeToFirstCardVisibleMs != null &&
        rep.timeToPreviewTitlesReadyMs != null &&
        rep.timeToWeatherReadyMs != null &&
        rep.timeToHomepageSettledMs != null &&
        rep.firstViewportStableMs != null
      ) {
        return;
      }
      if (rafI >= rafMax) return;
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(rafLoop);
      else setTimeout(rafLoop, 32);
    }

    if (typeof requestAnimationFrame === "function") requestAnimationFrame(rafLoop);
    else setTimeout(rafLoop, 0);

    var clickStart = null;
    try {
      document.addEventListener(
        "pointerdown",
        function () {
          if (clickStart == null) clickStart = relMs();
        },
        true
      );
      document.addEventListener(
        "click",
        function (ev) {
          try {
            if (rep.firstSuccessfulClickHandledMs != null) return;
            var t = ev.target;
            if (!t || !t.closest) return;
            var inApp = t.closest("#app");
            if (!inApp) return;
            rep.firstSuccessfulClickHandledMs = relMs();
            if (clickStart != null) rep.clickHandledDelayMs = rep.firstSuccessfulClickHandledMs - clickStart;
          } catch (e28) {}
        },
        true
      );
    } catch (e29) {}

    try {
      window.addEventListener("load", function () {
        try {
          if (rep.timeToFirstRenderMs == null) {
            var paint = performance.getEntriesByType("paint");
            for (var k = 0; k < paint.length; k++) {
              if (paint[k].name === "first-contentful-paint") rep.timeToFirstRenderMs = paint[k].startTime;
            }
          }
        } catch (e30) {}
        scheduleSettled();
      });
    } catch (e31) {}
  } catch (eOuter) {}
})();
