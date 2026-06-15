/**
 * infoUzel.cz — consent layer UI (Varianta A, no analytics load)
 */
(function iuConsentLayerModule() {
  "use strict";

  function qs(sel) {
    return document.querySelector(sel);
  }

  function hideLayer(bar) {
    if (bar) bar.hidden = true;
  }

  function openInfoCenter(sectionKey) {
    var key = sectionKey || "menu";
    var openFn = window.iuInfoCenterOpenSection;
    if (typeof openFn === "function") {
      openFn(key);
      return;
    }
    var trigger = document.getElementById("iuTopbarInfoBtn") || document.getElementById("iuSilverWelcomeInfoBtn");
    var overlay = document.getElementById("iuTopbarInfoOverlay");
    if (!overlay) return;
    if (overlay.hidden && trigger) {
      try {
        trigger.click();
      } catch (_) {}
    } else if (overlay.hidden) {
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

  function openPrivacySettings() {
    openInfoCenter("privacy-settings");
  }

  function applyChoice(bar, value, dismiss) {
    var consent = window.iuConsent;
    if (!consent) return;
    consent.setAnalyticsConsent(value);
    if (dismiss) {
      consent.dismissLayer();
      hideLayer(bar);
    }
  }

  function boot() {
    var bar = document.getElementById("iuConsentLayer");
    if (!bar) return;

    var consent = window.iuConsent;
    if (!consent || consent.isLayerDismissed()) {
      bar.hidden = true;
      return;
    }

    bar.hidden = false;

    var allowBtn = document.getElementById("iuConsentAllowStats");
    var essentialBtn = document.getElementById("iuConsentEssentialOnly");
    var settingsBtn = document.getElementById("iuConsentSettings");
    var infoBtn = document.getElementById("iuConsentInfoBtn");

    if (allowBtn) {
      allowBtn.addEventListener("click", function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        applyChoice(bar, "granted", true);
      });
    }

    if (essentialBtn) {
      essentialBtn.addEventListener("click", function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        applyChoice(bar, "denied", true);
      });
    }

    if (settingsBtn) {
      settingsBtn.addEventListener("click", function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        openPrivacySettings();
      });
    }

    if (infoBtn) {
      infoBtn.addEventListener("click", function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        openInfoCenter("menu");
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
