/**
 * Combined home module: RYCHLÝ PŘEHLED ⇄ SLEDOVÁNÍ ZÁSILEK (mobile/tablet/PWA ≤1024).
 * Gesture scope: ONLY the blue header bar. Content keeps native horizontal/vertical scroll.
 * Both panels stay in DOM (hidden toggle) — no remount / no duplicate listeners.
 */
(function () {
  "use strict";

  var MODULE_ID = "iuHomeQuickParcelModule";
  var SWITCHER_ID = "iuHomeQuickParcelSwitcher";
  var PANEL_QUICK = "iuHomeQuickParcelPanelQuick";
  var PANEL_PARCEL = "iuHomeQuickParcelPanelParcel";
  var SWIPE_MIN_PX = 48;
  var AXIS_RATIO = 1.35;
  var MQ = "(max-width: 1024px)";

  function $(id) {
    return document.getElementById(id);
  }

  function isMobileTablet() {
    try {
      return !!(window.matchMedia && window.matchMedia(MQ).matches);
    } catch (_) {
      return window.innerWidth <= 1024;
    }
  }

  function reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (_) {
      return false;
    }
  }

  function parcelInModule(module) {
    var panel = $(PANEL_PARCEL);
    var parcel = $("iuSilverParcelWatch");
    return !!(panel && parcel && panel.contains(parcel));
  }

  function syncSwitcherAvailability(module, switcher) {
    if (!switcher) return;
    var ok = parcelInModule(module);
    switcher.disabled = !ok;
    switcher.setAttribute("aria-disabled", ok ? "false" : "true");
    var chevron = switcher.querySelector("[data-iu-switcher-chevron]");
    var dots = switcher.querySelector(".iuHomeQuickParcelModule__dots");
    if (chevron) chevron.hidden = !ok;
    if (dots) dots.hidden = !ok;
    if (!ok) {
      setMode(module, "quick", { force: true });
    }
  }

  function setMode(module, mode, opts) {
    opts = opts || {};
    if (!module) return;
    var next = mode === "parcel" ? "parcel" : "quick";
    if (next === "parcel" && !parcelInModule(module)) next = "quick";
    var prev = module.getAttribute("data-iu-mode") || "quick";
    if (prev === next && !opts.force) return;

    var quick = $(PANEL_QUICK);
    var parcelPanel = $(PANEL_PARCEL);
    var switcher = $(SWITCHER_ID);
    var label = switcher && switcher.querySelector("[data-iu-switcher-label]");
    var chevron = switcher && switcher.querySelector("[data-iu-switcher-chevron]");
    var dots = switcher && switcher.querySelectorAll("[data-iu-switcher-dot]");

    module.setAttribute("data-iu-mode", next);

    if (quick) {
      if (next === "quick") {
        quick.hidden = false;
        quick.classList.add("is-active");
      } else {
        quick.hidden = true;
        quick.classList.remove("is-active");
      }
    }
    if (parcelPanel) {
      if (next === "parcel") {
        parcelPanel.hidden = false;
        parcelPanel.classList.add("is-active");
      } else {
        parcelPanel.hidden = true;
        parcelPanel.classList.remove("is-active");
      }
    }

    if (label) {
      label.textContent = next === "parcel" ? "SLEDOVÁNÍ ZÁSILEK" : "RYCHLÝ PŘEHLED";
    }
    if (chevron) {
      chevron.textContent = next === "parcel" ? "‹" : "›";
    }
    if (dots && dots.length >= 2) {
      dots[0].classList.toggle("is-on", next === "quick");
      dots[1].classList.toggle("is-on", next === "parcel");
    }
    if (switcher) {
      switcher.setAttribute(
        "aria-label",
        next === "parcel"
          ? "Sledování zásilek. Přepnout na Rychlý přehled"
          : "Rychlý přehled. Přepnout na Sledování zásilek"
      );
      switcher.setAttribute("aria-pressed", next === "parcel" ? "true" : "false");
    }

    if (opts.animate && !reducedMotion()) {
      var enter = next === "parcel" ? parcelPanel : quick;
      if (enter) {
        module.style.setProperty("--iu-qp-enter-x", next === "parcel" ? "12px" : "-12px");
        module.classList.add("is-animating");
        enter.classList.add("is-enter");
        window.setTimeout(function () {
          try {
            enter.classList.remove("is-enter");
            module.classList.remove("is-animating");
          } catch (_) {}
        }, 200);
      }
    }

    try {
      module.dispatchEvent(
        new CustomEvent("iu-home-quick-parcel-mode", { bubbles: true, detail: { mode: next } })
      );
    } catch (_) {}
  }

  function toggle(module) {
    if (!parcelInModule(module)) return;
    var cur = module.getAttribute("data-iu-mode") || "quick";
    setMode(module, cur === "quick" ? "parcel" : "quick", { animate: true });
  }

  function bindSwitcher(module, switcher) {
    if (!switcher || switcher.getAttribute("data-iu-qp-bound") === "1") return;
    switcher.setAttribute("data-iu-qp-bound", "1");
    syncSwitcherAvailability(module, switcher);

    var startX = 0;
    var startY = 0;
    var tracking = false;
    var decided = false;
    var axis = null; // "h" | "v"
    var pointerId = null;
    var suppressClickUntil = 0;

    function reset() {
      tracking = false;
      decided = false;
      axis = null;
      pointerId = null;
    }

    switcher.addEventListener(
      "pointerdown",
      function (e) {
        if (!isMobileTablet()) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        startX = e.clientX;
        startY = e.clientY;
        tracking = true;
        decided = false;
        axis = null;
        pointerId = e.pointerId;
        try {
          switcher.setPointerCapture(e.pointerId);
        } catch (_) {}
      },
      { passive: true }
    );

    switcher.addEventListener(
      "pointermove",
      function (e) {
        if (!tracking || (pointerId != null && e.pointerId !== pointerId)) return;
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        var adx = Math.abs(dx);
        var ady = Math.abs(dy);
        if (!decided) {
          if (adx < 10 && ady < 10) return;
          decided = true;
          if (ady >= adx * AXIS_RATIO) {
            axis = "v";
            try {
              switcher.releasePointerCapture(e.pointerId);
            } catch (_) {}
            reset();
            return;
          }
          if (adx >= ady * AXIS_RATIO) {
            axis = "h";
          } else {
            axis = "v";
            try {
              switcher.releasePointerCapture(e.pointerId);
            } catch (_) {}
            reset();
            return;
          }
        }
      },
      { passive: true }
    );

    function endPointer(e) {
      if (!tracking || (pointerId != null && e.pointerId !== pointerId)) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      var adx = Math.abs(dx);
      var ady = Math.abs(dy);
      var wasH = axis === "h" || (!decided && adx >= SWIPE_MIN_PX && adx > ady * AXIS_RATIO);
      tracking = false;
      try {
        switcher.releasePointerCapture(e.pointerId);
      } catch (_) {}

      if (wasH && adx >= SWIPE_MIN_PX && adx > ady) {
        var cur = module.getAttribute("data-iu-mode") || "quick";
        if (dx < 0 && cur === "quick") setMode(module, "parcel", { animate: true });
        else if (dx > 0 && cur === "parcel") setMode(module, "quick", { animate: true });
        suppressClickUntil = Date.now() + 450;
        reset();
        return;
      }
      reset();
    }

    switcher.addEventListener("pointerup", endPointer, { passive: true });
    switcher.addEventListener("pointercancel", function () {
      reset();
    }, { passive: true });

    switcher.addEventListener("click", function (e) {
      if (!isMobileTablet()) return;
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      toggle(module);
    });

    switcher.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle(module);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setMode(module, "parcel", { animate: true });
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setMode(module, "quick", { animate: true });
      }
    });
  }

  function ensureParcelSlot() {
    var panel = $(PANEL_PARCEL);
    var parcel = $("iuSilverParcelWatch");
    if (!panel || !parcel) return;
    if (!panel.contains(parcel)) {
      // Only reclaim when not intentionally in desktop overlay mount.
      var mount = $("iuDesktopParcelWatchMount");
      if (mount && mount.contains(parcel)) return;
      panel.appendChild(parcel);
    }
  }

  function init() {
    var module = $(MODULE_ID);
    var switcher = $(SWITCHER_ID);
    if (!module || !switcher) return;
    ensureParcelSlot();
    bindSwitcher(module, switcher);
    syncSwitcherAvailability(module, switcher);
    setMode(module, "quick", { force: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  try {
    window.iuHomeQuickParcelSetMode = function (mode) {
      setMode($(MODULE_ID), mode, { animate: false, force: true });
    };
    window.iuHomeQuickParcelEnsure = init;
  } catch (_) {}
})();
