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
