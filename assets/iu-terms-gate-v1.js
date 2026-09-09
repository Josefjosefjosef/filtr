/**
 * InfoUzel — TERMS/VOP clickwrap gate UI.
 * Priority over analytics consent sheet; does not alter analytics copy/logic/persistence.
 */
(function iuTermsGateV1() {
  "use strict";

  var FOCUSABLE =
    'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';
  var lastFocus = null;
  var bound = false;
  var icentrumHistoryPushed = false;
  var ignoreNextPopstate = false;

  function qs(id) {
    return document.getElementById(id);
  }

  function termsApi() {
    return window.iuTermsAcceptance || null;
  }

  function ensureCss() {
    try {
      if (typeof window.iuEnsureOverlayCss === "function") {
        window.iuEnsureOverlayCss("iu-terms-gate-v1.css");
      }
    } catch (_) {}
  }

  function setBodyLock(on) {
    try {
      document.documentElement.classList.toggle("iu-terms-gate-open", !!on);
      document.body.classList.toggle("iu-terms-gate-open", !!on);
    } catch (_) {}
  }

  function setIcentrumReadMode(on) {
    try {
      document.documentElement.classList.toggle("iu-terms-icentrum-read", !!on);
      document.body.classList.toggle("iu-terms-icentrum-read", !!on);
      window.__IU_TERMS_ICENTRUM_READ__ = !!on;
    } catch (_) {}
  }

  function setTermsInertForIcentrum(on) {
    var root = qs("iuTermsGate");
    if (!root) return;
    try {
      if (on) {
        root.setAttribute("aria-hidden", "true");
        if ("inert" in root) root.inert = true;
      } else {
        root.setAttribute("aria-hidden", "false");
        if ("inert" in root) root.inert = false;
      }
    } catch (_) {}
  }

  function resetScrollContainers() {
    var root = qs("iuTermsGate");
    if (!root) return;
    try {
      var scrolls = root.querySelectorAll(".iuTermsGate__scroll");
      for (var i = 0; i < scrolls.length; i++) {
        scrolls[i].scrollTop = 0;
      }
    } catch (_) {}
    var docMount = qs("iuTermsGateDocMount");
    if (docMount) {
      try {
        docMount.scrollTop = 0;
      } catch (_) {}
    }
  }

  function scheduleScrollReset() {
    resetScrollContainers();
    try {
      window.requestAnimationFrame(function () {
        resetScrollContainers();
        window.requestAnimationFrame(resetScrollContainers);
      });
    } catch (_) {
      try {
        window.setTimeout(resetScrollContainers, 0);
        window.setTimeout(resetScrollContainers, 50);
      } catch (_) {}
    }
  }

  function focusEl(el) {
    if (!el || typeof el.focus !== "function") return;
    try {
      el.focus({ preventScroll: true });
    } catch (_) {
      try {
        el.focus();
      } catch (_) {}
    }
  }

  function setAcceptEnabled(on) {
    var btn = qs("iuTermsAcceptBtn");
    if (!btn) return;
    btn.disabled = !on;
    try {
      btn.setAttribute("aria-disabled", on ? "false" : "true");
    } catch (_) {}
  }

  function syncCheckboxUi() {
    var cb = qs("iuTermsAcceptCheck");
    setAcceptEnabled(!!(cb && cb.checked));
  }

  function showPanel(mode) {
    var root = qs("iuTermsGate");
    var main = qs("iuTermsGateMain");
    var declined = qs("iuTermsGateDeclined");
    var doc = qs("iuTermsGateDoc");
    if (!root) return;
    root.hidden = false;
    try {
      root.setAttribute("aria-hidden", "false");
    } catch (_) {}
    setBodyLock(true);
    if (main) main.hidden = mode !== "main";
    if (declined) declined.hidden = mode !== "declined";
    if (doc) doc.hidden = mode !== "doc";
    scheduleScrollReset();
  }

  function hideGate() {
    var root = qs("iuTermsGate");
    if (!root) return;
    clearIcentrumReadSession(true);
    root.hidden = true;
    try {
      root.setAttribute("aria-hidden", "true");
    } catch (_) {}
    setBodyLock(false);
    if (lastFocus && typeof lastFocus.focus === "function") {
      try {
        lastFocus.focus({ preventScroll: true });
      } catch (_) {
        try {
          lastFocus.focus();
        } catch (_) {}
      }
    }
  }

  function mountLegalDoc() {
    var host = qs("iuTermsGateDocMount");
    if (!host) return;
    try {
      if (host.getAttribute("data-iu-mounted") === "1") return;
      var legal = window.iuGdprVopLegal;
      if (legal && typeof legal.mountInto === "function") {
        legal.mountInto(host);
        host.setAttribute("data-iu-mounted", "1");
      } else {
        host.innerHTML =
          '<p class="iuTermsGate__p">Dokument načtěte na <a class="iuTermsGate__link" href="/gdpr-a-vop/" target="_blank" rel="noopener noreferrer">/gdpr-a-vop/</a>.</p>';
      }
    } catch (_) {}
  }

  function openDocPanel() {
    mountLegalDoc();
    showPanel("doc");
    var back = qs("iuTermsDocBackBtn");
    focusEl(back);
  }

  function closeInfoOverlayQuiet() {
    var overlay = qs("iuTopbarInfoOverlay");
    if (!overlay || overlay.hidden) return;
    try {
      if (typeof window.iuInfoCenterClose === "function") {
        window.iuInfoCenterClose();
        return;
      }
    } catch (_) {}
    try {
      var closeBtn = document.getElementById("iuTopbarInfoOverlayClose");
      if (closeBtn) closeBtn.click();
    } catch (_) {}
  }

  function clearIcentrumReadSession(fromHideGate) {
    if (!window.__IU_TERMS_ICENTRUM_READ__ && !icentrumHistoryPushed) {
      setIcentrumReadMode(false);
      setTermsInertForIcentrum(false);
      return;
    }
    setIcentrumReadMode(false);
    setTermsInertForIcentrum(false);
    if (icentrumHistoryPushed) {
      icentrumHistoryPushed = false;
      if (!fromHideGate) {
        try {
          ignoreNextPopstate = true;
          history.replaceState(null, "", location.href);
        } catch (_) {}
      }
    }
  }

  function onIcentrumClosed() {
    if (!window.__IU_TERMS_ICENTRUM_READ__) return;
    clearIcentrumReadSession(false);
    var root = qs("iuTermsGate");
    if (!root || root.hidden) return;
    showPanel("main");
    syncCheckboxUi();
    scheduleScrollReset();
    focusEl(qs("iuTermsReadBtn") || qs("iuTermsAcceptCheck"));
  }

  function openIcentrumFromTerms() {
    setIcentrumReadMode(true);
    setTermsInertForIcentrum(true);
    try {
      if (!icentrumHistoryPushed) {
        history.pushState({ iuTermsIcentrum: 1 }, "", location.href);
        icentrumHistoryPushed = true;
      }
    } catch (_) {}
    try {
      if (typeof window.iuInfoCenterOpenSection === "function") {
        window.iuInfoCenterOpenSection("gdpr-vop");
        return;
      }
    } catch (_) {}
    // Fallback if iCentrum API is unavailable: keep previous inline doc panel.
    clearIcentrumReadSession(false);
    openDocPanel();
  }

  function trapFocus(e) {
    if (window.__IU_TERMS_ICENTRUM_READ__) return;
    var root = qs("iuTermsGate");
    if (!root || root.hidden || e.key !== "Tab") return;
    var panel = root.querySelector(".iuTermsGate__dialog:not([hidden])") || root;
    var nodes = Array.prototype.slice.call(panel.querySelectorAll(FOCUSABLE)).filter(function (el) {
      return !el.disabled && el.offsetParent !== null;
    });
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onAccept() {
    var cb = qs("iuTermsAcceptCheck");
    if (!cb || !cb.checked) return;
    var api = termsApi();
    if (!api) return;
    api.acceptCurrentVersion();
    hideGate();
    try {
      if (typeof window.iuConsentLayerShowIfNeeded === "function") {
        window.setTimeout(function () {
          window.iuConsentLayerShowIfNeeded();
        }, 0);
      }
    } catch (_) {}
  }

  function onDecline() {
    var api = termsApi();
    if (api) api.recordDecline();
    var cb = qs("iuTermsAcceptCheck");
    if (cb) {
      cb.checked = false;
      syncCheckboxUi();
    }
    showPanel("declined");
    focusEl(qs("iuTermsShowAgainBtn"));
  }

  function bindOnce() {
    if (bound) return;
    bound = true;
    var cb = qs("iuTermsAcceptCheck");
    var accept = qs("iuTermsAcceptBtn");
    var decline = qs("iuTermsDeclineBtn");
    var readBtn = qs("iuTermsReadBtn");
    var again = qs("iuTermsShowAgainBtn");
    var back = qs("iuTermsDocBackBtn");
    var openPublic = qs("iuTermsOpenPublicBtn");

    if (cb) {
      cb.checked = false;
      cb.addEventListener("change", syncCheckboxUi);
    }
    if (accept) {
      accept.addEventListener("click", function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        onAccept();
      });
    }
    if (decline) {
      decline.addEventListener("click", function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        onDecline();
      });
    }
    if (readBtn) {
      readBtn.addEventListener("click", function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        openIcentrumFromTerms();
      });
    }
    if (again) {
      again.addEventListener("click", function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        showPanel("main");
        syncCheckboxUi();
        scheduleScrollReset();
        focusEl(cb);
      });
    }
    if (back) {
      back.addEventListener("click", function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        showPanel("main");
        syncCheckboxUi();
        scheduleScrollReset();
      });
    }
    if (openPublic) {
      openPublic.addEventListener("click", function () {
        /* native link — keep checkbox state in main panel */
      });
    }
    document.addEventListener("keydown", trapFocus, true);
    window.addEventListener("popstate", function () {
      if (ignoreNextPopstate) {
        ignoreNextPopstate = false;
        return;
      }
      if (!window.__IU_TERMS_ICENTRUM_READ__) return;
      icentrumHistoryPushed = false;
      closeInfoOverlayQuiet();
    });
  }

  function openGate() {
    ensureCss();
    bindOnce();
    var cb = qs("iuTermsAcceptCheck");
    if (cb) cb.checked = false;
    syncCheckboxUi();
    try {
      lastFocus = document.activeElement;
    } catch (_) {
      lastFocus = null;
    }
    showPanel("main");
    scheduleScrollReset();
    focusEl(cb);
    scheduleScrollReset();
  }

  function boot() {
    var root = qs("iuTermsGate");
    if (!root) return;
    var api = termsApi();
    if (!api || typeof api.needsAcceptance !== "function") {
      hideGate();
      return;
    }
    if (!api.needsAcceptance()) {
      hideGate();
      return;
    }
    openGate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.iuTermsGate = {
    open: openGate,
    hide: hideGate,
    onIcentrumClosed: onIcentrumClosed,
    isIcentrumReadMode: function () {
      return !!window.__IU_TERMS_ICENTRUM_READ__;
    },
    needsAcceptance: function () {
      var api = termsApi();
      return !!(api && api.needsAcceptance && api.needsAcceptance());
    }
  };
})();
