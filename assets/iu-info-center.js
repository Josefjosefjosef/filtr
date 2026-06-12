/**
 * infoUzel.cz — Informační centrum V2.5 (consent / Nastavení soukromí)
 * Scope: pouze overlay #iuTopbarInfoOverlay; open/close zůstává v app.js.
 */
(function iuInfoCenterV2Module() {
  "use strict";

  var SECTION_TITLES = {
    menu: "Informační centrum",
    pwa: "Vytvořit ikonu na plochu",
    about: "O InfoUzel.cz",
    silver: "O Silverovi",
    cookies: "Cookies a technické ukládání",
    "privacy-settings": "Nastavení soukromí",
    privacy: "Ochrana soukromí a data",
    "data-storage": "Jak funguje ukládání dat",
    contact: "Provozovatel a kontakt"
  };

  var DOC_VERSION = "1.2";

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function qsa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function formatCsDate(d) {
    try {
      return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
    } catch (_) {
      return "";
    }
  }

  function stampVersionDates() {
    var today = formatCsDate(new Date());
    qsa("[data-iu-info-version-date]").forEach(function (el) {
      el.textContent = today;
    });
    qsa("[data-iu-info-doc-version]").forEach(function (el) {
      el.textContent = DOC_VERSION;
    });
  }

  function initPrivacySettings() {
    var panel = document.getElementById("iuInfoCenterDetailPrivacySettings");
    if (!panel) return;

    var offRadio = document.getElementById("iuPrivacyStatsOff");
    var onRadio = document.getElementById("iuPrivacyStatsOn");
    var saveBtn = document.getElementById("iuPrivacySettingsSave");
    var lastChangeEl = document.getElementById("iuPrivacySettingsLastChange");
    var statusLive = document.getElementById("iuPrivacySettingsStatus");

    function syncRadiosFromStorage() {
      var consent = window.iuConsent;
      if (!consent) return;
      var granted = consent.getAnalyticsConsent() === "granted";
      if (onRadio) onRadio.checked = granted;
      if (offRadio) offRadio.checked = !granted;
      if (lastChangeEl && consent.formatConsentTimestamp) {
        lastChangeEl.textContent = consent.formatConsentTimestamp(consent.getConsentTimestamp());
      }
    }

    function announce(msg) {
      if (statusLive) statusLive.textContent = msg;
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        var consent = window.iuConsent;
        if (!consent) return;
        var val = onRadio && onRadio.checked ? "granted" : "denied";
        consent.setAnalyticsConsent(val);
        consent.dismissLayer();
        var bar = document.getElementById("iuConsentLayer");
        if (bar) bar.hidden = true;
        syncRadiosFromStorage();
        announce("Nastavení soukromí uloženo.");
      });
    }

    try {
      var mo = new MutationObserver(function () {
        if (!panel.hidden) syncRadiosFromStorage();
      });
      mo.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
    } catch (_) {}

    window.addEventListener("iu:consent-change", syncRadiosFromStorage);
    syncRadiosFromStorage();
  }

  function initNavigation() {
    var overlay = document.getElementById("iuTopbarInfoOverlay");
    if (!overlay || overlay.getAttribute("data-iu-info-center-v2") !== "1") return;
    if (overlay.getAttribute("data-iu-info-center-v2-inited") === "1") return;
    overlay.setAttribute("data-iu-info-center-v2-inited", "1");

    var menu = document.getElementById("iuInfoCenterMenu");
    var titleEl = document.getElementById("iuTopbarInfoOverlayTitle");
    var backBtn = document.getElementById("iuInfoCenterBack");
    var details = qsa(".iuInfoCenter__detail", overlay);
    var tiles = menu ? qsa(".iuInfoCenter__tile[data-iu-info-section]", menu) : [];
    var currentSection = "menu";

    function setViewMode(key) {
      overlay.setAttribute("data-iu-info-view", key === "menu" ? "menu" : "detail");
    }

    function setTitle(key) {
      if (!titleEl) return;
      titleEl.textContent = SECTION_TITLES[key] || SECTION_TITLES.menu;
    }

    function scrollPanelToTop(panel) {
      if (!panel) return;
      try {
        panel.scrollTop = 0;
      } catch (_) {}
    }

    function showSection(key) {
      currentSection = key || "menu";
      setViewMode(currentSection);
      if (menu) menu.hidden = currentSection !== "menu";
      details.forEach(function (panel) {
        var id = panel.getAttribute("data-iu-info-section");
        var active = id === currentSection;
        panel.hidden = !active;
        if (active) scrollPanelToTop(panel);
      });
      if (backBtn) backBtn.hidden = currentSection === "menu";
      setTitle(currentSection);
      if (currentSection === "menu") scrollPanelToTop(menu);
    }

    function resetToMenu() {
      showSection("menu");
      var ios = document.getElementById("iuInfoCenterPwaIos");
      var and = document.getElementById("iuInfoCenterPwaAndroid");
      var btnIos = qs('[data-iu-info-pwa-platform="ios"]', overlay);
      var btnAnd = qs('[data-iu-info-pwa-platform="android"]', overlay);
      if (ios) ios.hidden = false;
      if (and) and.hidden = true;
      if (btnIos) {
        btnIos.classList.add("is-active");
        btnIos.setAttribute("aria-selected", "true");
      }
      if (btnAnd) {
        btnAnd.classList.remove("is-active");
        btnAnd.setAttribute("aria-selected", "false");
      }
    }

    window.iuInfoCenterOpenSection = function (key) {
      if (overlay.hidden) {
        var trigger =
          document.getElementById("iuTopbarInfoBtn") ||
          document.getElementById("iuSilverWelcomeInfoBtn");
        if (trigger) {
          try {
            trigger.click();
          } catch (_) {}
        } else {
          try {
            overlay.hidden = false;
            overlay.removeAttribute("aria-hidden");
          } catch (_) {}
        }
      }
      showSection(key || "menu");
    };

    tiles.forEach(function (tile) {
      tile.addEventListener("click", function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        var sec = tile.getAttribute("data-iu-info-section");
        if (sec) showSection(sec);
      });
    });

    qsa("[data-iu-info-goto]", overlay).forEach(function (link) {
      link.addEventListener("click", function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        var dest = link.getAttribute("data-iu-info-goto");
        if (dest) showSection(dest);
      });
    });

    if (backBtn) {
      backBtn.addEventListener("click", function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        showSection("menu");
      });
    }

    qsa("[data-iu-info-pwa-platform]", overlay).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var plat = btn.getAttribute("data-iu-info-pwa-platform");
        var ios = document.getElementById("iuInfoCenterPwaIos");
        var and = document.getElementById("iuInfoCenterPwaAndroid");
        qsa("[data-iu-info-pwa-platform]", overlay).forEach(function (b) {
          var active = b === btn;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-selected", active ? "true" : "false");
        });
        if (plat === "ios") {
          if (ios) ios.hidden = false;
          if (and) and.hidden = true;
        } else {
          if (ios) ios.hidden = true;
          if (and) and.hidden = false;
        }
      });
    });

    try {
      var mo = new MutationObserver(function () {
        if (overlay.hidden) resetToMenu();
      });
      mo.observe(overlay, { attributes: true, attributeFilter: ["hidden"] });
    } catch (_) {}

    var closeBtn = document.getElementById("iuTopbarInfoOverlayClose");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        resetToMenu();
      });
    }
    qsa("[data-iu-topbar-info-close]", overlay).forEach(function (el) {
      el.addEventListener("click", function () {
        resetToMenu();
      });
    });

    stampVersionDates();
    resetToMenu();
    initPrivacySettings();
  }

  function boot() {
    initNavigation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Lazy mount (P0 perf fix): overlay is mounted from <template> on first
  // open; re-run inner navigation init at that moment.
  document.addEventListener("iu:info-center-mounted", boot);
})();
