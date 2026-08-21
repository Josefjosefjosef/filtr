/**
 * P0 perf stage-3: thin bottom-nav + mobile-gate shell.
 * First tap (Domů / Menu / Mindmenu / Silver / Zpět) must not wait for the 1.1MB feed IIFE.
 * Full gate (reorder, quick-tools, overlay close) upgrades when feed pipeline loads.
 */
(function iuMobileBottomNavShellV1() {
  "use strict";
  var FEED_MOD = "./iu-app-feed-pipeline-v1.js?v=perf-stage3-feed-split-v1-20260818-perf-loop-iter006-defer-pipeline-v1-20260820-early-wx-v1-20260822";

  function prefetchFeed() {
    try {
      if (typeof window.__iuEnsureFeedPipeline === "function") {
        void window.__iuEnsureFeedPipeline();
        return;
      }
    } catch (_) {}
    try {
      void import(FEED_MOD);
    } catch (_) {}
  }

  function dismissLdp() {
    try {
      var active = document.querySelector('.iu-ldp-backdrop[data-iu-ldp-active="1"]');
      if (!active) return false;
      var cancel = active.querySelector(".iu-ldp-btn--ghost") || active.querySelector(".iu-ldp-btn--secondary");
      if (cancel && typeof cancel.click === "function") {
        cancel.click();
        return true;
      }
    } catch (_) {}
    return false;
  }

  function closeToolOverlaysIfPossible() {
    try {
      if (typeof window.iuMindMenuCloseToolOverlaysIfOpen === "function") {
        return !!window.iuMindMenuCloseToolOverlaysIfOpen();
      }
    } catch (_) {}
    return false;
  }

  function installGateSetTab() {
    var wrap = document.getElementById("iuMobileGateWrap");
    var tabNav = document.getElementById("iuMobileGateTabNav");
    var tabTools = document.getElementById("iuMobileGateTabTools");
    var panelNav = document.getElementById("iuMobileGatePanelNav");
    var panelTools = document.getElementById("iuMobileGatePanelTools");
    var content = document.getElementById("iuMobileGateContent");
    if (!wrap || !tabNav || !tabTools || !panelNav || !panelTools || !content) return null;

    function setTab(value) {
      var gateVal = value || "";
      if (!gateVal) {
        try {
          if (window.__iuNavOverlayLock === true) return;
        } catch (_) {}
      }
      wrap.setAttribute("data-iu-mobile-gate", gateVal);
      if (!gateVal) {
        try {
          if (window.__iuWebNavGateDetailLatch !== true) {
            document.body.classList.remove("iu-webnavDetailFromGate");
          }
        } catch (_) {}
      }
      var bar = document.getElementById("iuMobileGateBackBar");
      if (bar) {
        try {
          if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) bar.hidden = true;
          else bar.hidden = !gateVal;
        } catch (_) {
          bar.hidden = !gateVal;
        }
      }
      if (panelTools && panelTools.classList) {
        if (gateVal === "tools") panelTools.classList.add("accordionCol");
        else panelTools.classList.remove("accordionCol");
      }
      if (gateVal === "nav") {
        tabNav.setAttribute("aria-selected", "true");
        tabTools.setAttribute("aria-selected", "false");
        content.setAttribute("aria-hidden", "false");
        panelNav.hidden = false;
        panelTools.hidden = true;
      } else if (gateVal === "tools") {
        tabNav.setAttribute("aria-selected", "false");
        tabTools.setAttribute("aria-selected", "true");
        content.setAttribute("aria-hidden", "false");
        panelNav.hidden = true;
        panelTools.hidden = false;
        ensureMindMenuInGate();
        try {
          if (typeof window.iuMobileGateReorder === "function") {
            window.requestAnimationFrame(function () {
              try {
                window.iuMobileGateReorder();
              } catch (_) {}
            });
          }
        } catch (_) {}
      } else {
        tabNav.setAttribute("aria-selected", "false");
        tabTools.setAttribute("aria-selected", "false");
        content.setAttribute("aria-hidden", "true");
        panelNav.hidden = true;
        panelTools.hidden = true;
        try {
          var keep = false;
          if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
            var u = new URL(window.location.href);
            if (u.searchParams.has("section")) keep = true;
          }
          if (!keep) document.body.classList.remove("iu-mobileMainVisible");
        } catch (_) {}
        var mb = document.getElementById("iuMobileMainBackBar");
        if (mb) mb.hidden = true;
      }
      try {
        if (gateVal === "nav" || gateVal === "tools") {
          document.documentElement.classList.add("iu-mobileGateOverlayOpen");
          document.body.classList.add("iu-mobileGateOverlayOpen");
        } else {
          document.documentElement.classList.remove("iu-mobileGateOverlayOpen");
          document.body.classList.remove("iu-mobileGateOverlayOpen");
        }
      } catch (_) {}
    }

    function toggleNav() {
      try {
        if (typeof window.iuNavOverlayLockForceClear === "function") window.iuNavOverlayLockForceClear();
      } catch (_) {}
      var cur = wrap.getAttribute("data-iu-mobile-gate");
      var next = cur === "nav" ? "" : "nav";
      var needHistBack = false;
      var schedulePush = false;
      if (!next) {
        try {
          window.__iuWebNavGateDetailLatch = false;
        } catch (_) {}
        try {
          if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
            if (history.state && history.state.iu_nav_overlay === true) needHistBack = true;
          }
        } catch (_) {}
      } else {
        try {
          schedulePush = !!(window.matchMedia && window.matchMedia("(max-width: 900px)").matches);
        } catch (_) {}
      }
      setTab(next);
      if (schedulePush) {
        try {
          queueMicrotask(function () {
            try {
              if (String(wrap.getAttribute("data-iu-mobile-gate") || "") !== "nav") return;
              var uNav = new URL(window.location.href);
              uNav.hash = "iu-nav";
              history.pushState({ iu_nav_overlay: true, iu_nav_origin: "homepage" }, "", uNav.toString());
            } catch (_) {}
          });
        } catch (_) {}
      }
      if (!next && needHistBack) {
        try {
          history.back();
        } catch (_) {}
      }
    }

    function toggleTools() {
      try {
        if (typeof window.iuNavOverlayLockForceClear === "function") window.iuNavOverlayLockForceClear();
      } catch (_) {}
      var cur = wrap.getAttribute("data-iu-mobile-gate");
      if (cur === "tools") {
        setTab("");
        try {
          var st = history.state && history.state.iu_mindmenu_overlay === true;
          var h = String(location.hash || "").replace("#", "");
          if (st || h === "iu-mindmenu") history.back();
        } catch (_) {}
      } else {
        setTab("tools");
        ensureMindMenuInGate();
        try {
          if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
            queueMicrotask(function () {
              try {
                if (String(wrap.getAttribute("data-iu-mobile-gate") || "") !== "tools") return;
                var u = new URL(window.location.href);
                if (String(u.hash || "").replace("#", "") === "iu-mindmenu") return;
                u.hash = "iu-mindmenu";
                history.pushState({ iu_mindmenu_overlay: true, iu_mindmenu_origin: "homepage" }, "", u.toString());
              } catch (_) {}
            });
          }
        } catch (_) {}
      }
    }

    try {
      wrap.__iuMobileGateSetTab = setTab;
      wrap.__iuMobileGateNavTabToggleFromUserAction = toggleNav;
    } catch (_) {}
    try {
      if (!wrap.__iuMobileGateTabClicksBound) {
        wrap.__iuMobileGateTabClicksBound = 1;
        tabNav.addEventListener("click", function () {
          prefetchFeed();
          toggleNav();
        });
        tabTools.addEventListener("click", function () {
          prefetchFeed();
          toggleTools();
        });
      }
    } catch (_) {}
    try {
      window.iuMobileGateCloseForMainNav = function () {
        try {
          if (window.__iuNavOverlayLock === true) return;
        } catch (_) {}
        setTab("");
      };
    } catch (_) {}
    return { wrap: wrap, setTab: setTab, toggleNav: toggleNav, toggleTools: toggleTools, tabNav: tabNav, tabTools: tabTools };
  }

  function ensureMindMenuInGate() {
    try {
      var mq = window.matchMedia && window.matchMedia("(max-width: 1023px)");
      var mobileMind = mq ? mq.matches : window.innerWidth < 1024;
      if (!mobileMind) return;
    } catch (_) {}
    var panelTools = document.getElementById("iuMobileGatePanelTools");
    var mindMenuFlow = document.getElementById("iuMobileMindMenuFlow");
    var mindMenu = document.getElementById("iuMindMenuView") || document.querySelector(".mindMenu");
    if (!panelTools || !mindMenuFlow || !mindMenu) return;
    try {
      if (!panelTools.contains(mindMenuFlow)) panelTools.appendChild(mindMenuFlow);
      if (mindMenu.parentElement !== mindMenuFlow) {
        mindMenuFlow.insertBefore(mindMenu, mindMenuFlow.firstChild || null);
      }
      mindMenuFlow.style.setProperty("display", "block", "important");
    } catch (_) {}
  }

  function installBottomNav(gate) {
    try {
      if (window.__iuMobileBottomNavInit) return;
      window.__iuMobileBottomNavInit = 1;
    } catch (_) {}
    var root = document.getElementById("iuMobileBottomNav");
    if (!root) return;
    try {
      root.addEventListener(
        "pointerdown",
        function () {
          prefetchFeed();
        },
        true
      );
    } catch (_) {}
    root.addEventListener(
      "click",
      function (ev) {
        try {
          if (typeof window.iuNavOverlayLockForceClear === "function") window.iuNavOverlayLockForceClear();
        } catch (_) {}
        prefetchFeed();
        try {
          var t = ev.target;
          var btn = t && t.closest ? t.closest("[data-iu-bottom-nav]") : null;
          if (!btn) return;
          var k = String(btn.getAttribute("data-iu-bottom-nav") || "");
          if (k !== "silver") {
            try {
              if (typeof window.iuSilverQuickPanelIsOpen === "function" && window.iuSilverQuickPanelIsOpen()) {
                if (typeof window.iuSilverQuickPanelClose === "function") window.iuSilverQuickPanelClose();
              }
            } catch (_) {}
          }
          if (k === "home") {
            dismissLdp();
            closeToolOverlaysIfPossible();
            try {
              if (typeof window.iuMobileGateCloseForMainNav === "function") window.iuMobileGateCloseForMainNav();
            } catch (_) {}
            try {
              if (typeof window.iuProjectsHubNavigateHardResetFromHomeOrBack === "function") {
                window.iuProjectsHubNavigateHardResetFromHomeOrBack();
              }
            } catch (_) {}
            try {
              window.scrollTo(0, 0);
            } catch (_) {}
            return;
          }
          if (k === "menu") {
            closeToolOverlaysIfPossible();
            if (gate && typeof gate.toggleNav === "function") {
              gate.toggleNav();
              return;
            }
            var wMenu = document.getElementById("iuMobileGateWrap");
            if (wMenu && typeof wMenu.__iuMobileGateNavTabToggleFromUserAction === "function") {
              wMenu.__iuMobileGateNavTabToggleFromUserAction();
            }
            return;
          }
          if (k === "mindmenu") {
            if (closeToolOverlaysIfPossible()) {
              if (gate && typeof gate.setTab === "function") gate.setTab("tools");
              return;
            }
            if (gate && typeof gate.toggleTools === "function") {
              gate.toggleTools();
              return;
            }
            return;
          }
          if (k === "silver") {
            try {
              if (typeof window.iuSilverQuickPanelHandleBottomNavSilver === "function") {
                if (window.iuSilverQuickPanelHandleBottomNavSilver()) return;
              }
            } catch (_) {}
            try {
              var hero = document.getElementById("iuSilverHeroPremium");
              if (hero && typeof hero.scrollIntoView === "function") {
                hero.scrollIntoView({ block: "center", behavior: "auto" });
              }
            } catch (_) {}
            try {
              var inp = document.getElementById("iuSilverHomeInput");
              if (inp && typeof inp.focus === "function") inp.focus({ preventScroll: true });
            } catch (_) {}
            return;
          }
          if (k === "back") {
            try {
              if (typeof window.closeTopMostOpenOverlayForBottomBack === "function" && window.closeTopMostOpenOverlayForBottomBack()) {
                return;
              }
            } catch (_) {}
            var wrap = document.getElementById("iuMobileGateWrap");
            var gateVal = wrap ? String(wrap.getAttribute("data-iu-mobile-gate") || "").trim() : "";
            var gateBack = document.getElementById("iuMobileGateBack");
            if (gateVal && gateBack && typeof gateBack.click === "function") {
              gateBack.click();
              return;
            }
            try {
              if (window.history && window.history.length > 1) window.history.back();
              else if (typeof window.iuProjectsHubNavigateHardResetFromHomeOrBack === "function") {
                window.iuProjectsHubNavigateHardResetFromHomeOrBack();
              }
            } catch (_) {}
          }
        } catch (_) {}
      },
      true
    );
  }

  function installMeasure() {
    try {
      if (window.__iuMobileBottomNavMeasureInit) return;
      window.__iuMobileBottomNavMeasureInit = 1;
    } catch (_) {}
    var mq = null;
    try {
      mq = window.matchMedia && window.matchMedia("(max-width: 1024px)");
    } catch (_) {}
    var scheduled = 0;
    function clearMeasuredVars() {
      try {
        var root = document.documentElement;
        if (!root || !root.style) return;
        root.style.removeProperty("--iu-mobile-bottom-nav-measured-h");
        root.style.removeProperty("--iu-mobile-bottom-nav-total-h");
        root.style.removeProperty("--bottom-nav-height");
        root.style.removeProperty("--iu-mobile-bottom-nav-safe-space");
        root.style.removeProperty("--iu-tool-overlay-panel-bottom");
      } catch (_) {}
    }
    function applyMeasure() {
      try {
        var root = document.documentElement;
        if (!root) return;
        if (mq && !mq.matches) {
          clearMeasuredVars();
          return;
        }
        if (root.classList.contains("iu-keyboard-open")) {
          clearMeasuredVars();
          return;
        }
        var nav = document.getElementById("iuMobileBottomNav");
        if (!nav) return;
        var cs = getComputedStyle(nav);
        if (cs.display === "none" || cs.visibility === "hidden") return;
        var r = nav.getBoundingClientRect();
        var h = Math.round(r.height || 0);
        if (!(h > 24)) return;
        var safe = h + 40;
        root.style.setProperty("--iu-mobile-bottom-nav-measured-h", h + "px");
        root.style.setProperty("--iu-mobile-bottom-nav-total-h", h + "px");
        root.style.setProperty("--bottom-nav-height", h + "px");
        root.style.setProperty("--iu-tool-overlay-panel-bottom", h + "px");
        root.style.setProperty("--iu-mobile-bottom-nav-safe-space", safe + "px");
      } catch (_) {}
    }
    function scheduleMeasure() {
      if (scheduled) return;
      scheduled = 1;
      try {
        window.requestAnimationFrame(function () {
          scheduled = 0;
          applyMeasure();
        });
      } catch (_) {
        scheduled = 0;
        applyMeasure();
      }
    }
    try {
      var navEl = document.getElementById("iuMobileBottomNav");
      if (navEl && typeof ResizeObserver !== "undefined") {
        var ro = new ResizeObserver(function () {
          scheduleMeasure();
        });
        ro.observe(navEl);
      }
    } catch (_) {}
    try {
      if (mq && mq.addEventListener) mq.addEventListener("change", scheduleMeasure);
      else if (mq && mq.addListener) mq.addListener(scheduleMeasure);
    } catch (_) {}
    try {
      window.addEventListener("orientationchange", scheduleMeasure, { passive: true });
      window.addEventListener("resize", scheduleMeasure, { passive: true });
    } catch (_) {}
    scheduleMeasure();
  }

  function boot() {
    var gate = installGateSetTab();
    ensureMindMenuInGate();
    installBottomNav(gate);
    installMeasure();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
