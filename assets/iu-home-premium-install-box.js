/**
 * Homepage premium install box — opens Informační centrum › PWA (existing overlay).
 * Mobile/tablet only; no new overlay logic.
 */
(function iuHomePremiumInstallBox() {
  "use strict";

  function isStandalone() {
    try {
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
      if (navigator.standalone === true) return true;
    } catch (_) {}
    return false;
  }

  function isMobileTablet() {
    try {
      return window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
    } catch (_) {}
    return false;
  }

  function rectsOverlap(a, b) {
    if (!a || !b) return false;
    return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  }

  function overlayIsOpen(el) {
    if (!el) return false;
    if (el.hidden) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    return true;
  }

  function syncInstallBoxClearance(box) {
    if (!box || box.hidden) return;
    var suppress = false;
    var quick = document.querySelector("#iuSilverHeroPremium .iu-hero-quickActions");
    var heroInput = document.getElementById("iuSilverHomeInput");
    var boxRect = box.getBoundingClientRect();
    if (quick && rectsOverlap(boxRect, quick.getBoundingClientRect())) suppress = true;
    if (!suppress && heroInput && rectsOverlap(boxRect, heroInput.getBoundingClientRect())) {
      suppress = true;
    }
    if (
      overlayIsOpen(document.getElementById("iuCalendarOverlay")) ||
      overlayIsOpen(document.getElementById("iuTasksOverlay")) ||
      overlayIsOpen(document.getElementById("iuNotesOverlay")) ||
      overlayIsOpen(document.getElementById("iuTopbarInfoOverlay"))
    ) {
      suppress = true;
    }
    box.classList.toggle("iuHomePremiumInstallBox--clearance", suppress);
  }

  function bindInstallBoxClearance(box) {
    var tick = function () {
      syncInstallBoxClearance(box);
    };
    window.addEventListener("scroll", tick, { passive: true });
    window.addEventListener("resize", tick, { passive: true });
    window.addEventListener("orientationchange", tick, { passive: true });
    try {
      var mo = new MutationObserver(tick);
      [
        "iuCalendarOverlay",
        "iuTasksOverlay",
        "iuNotesOverlay",
        "iuTopbarInfoOverlay"
      ].forEach(function (id) {
        var node = document.getElementById(id);
        if (node) mo.observe(node, { attributes: true, attributeFilter: ["hidden", "aria-hidden", "class"] });
      });
    } catch (_) {}
    tick();
  }

  function openPwaSection() {
    var key = "pwa";
    var openFn = window.iuInfoCenterOpenSection;
    if (typeof openFn === "function") {
      openFn(key);
    }
    var trigger =
      document.getElementById("iuTopbarInfoBtn") ||
      document.getElementById("iuSilverWelcomeInfoBtn");
    var overlay = document.getElementById("iuTopbarInfoOverlay");
    if (!overlay && trigger) {
      try {
        trigger.click();
      } catch (_) {}
    } else if (overlay && overlay.hidden && trigger) {
      try {
        trigger.click();
      } catch (_) {}
    } else if (overlay && overlay.hidden) {
      try {
        overlay.hidden = false;
        overlay.removeAttribute("aria-hidden");
      } catch (_) {}
    }
    window.setTimeout(function () {
      if (typeof window.iuInfoCenterOpenSection === "function") {
        window.iuInfoCenterOpenSection(key);
      }
    }, 80);
  }

  function boot() {
    var box = document.getElementById("iuHomePremiumInstallBox");
    if (!box || box.getAttribute("data-iu-home-install-box-inited") === "1") return;
    box.setAttribute("data-iu-home-install-box-inited", "1");

    if (!isMobileTablet() || isStandalone()) {
      box.hidden = true;
      return;
    }

    bindInstallBoxClearance(box);

    box.addEventListener(
      "click",
      function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        try {
          e.stopPropagation();
        } catch (_) {}
        openPwaSection();
      },
      true
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
