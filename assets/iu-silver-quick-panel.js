(function () {
  "use strict";

  var PREFIX_NOTES = "Do poznámek ";
  var open = false;

  function narrowMobileTablet() {
    try {
      return window.matchMedia("(max-width: 1024px)").matches;
    } catch (_) {
      return (window.innerWidth || 0) <= 1024;
    }
  }

  function bottomNavVisible() {
    try {
      return window.matchMedia("(max-width: 900px)").matches;
    } catch (_) {
      return (window.innerWidth || 0) <= 900;
    }
  }

  function onHomePage() {
    try {
      if (document.body.classList.contains("iu-mobileMainVisible")) return false;
      if (document.body.classList.contains("iu-mobileGateOverlayOpen")) return false;
      var stage = document.getElementById("iuCenterStage");
      if (stage && String(stage.getAttribute("data-iu-view") || "") === "quick") return false;
    } catch (_) {}
    return true;
  }

  function panelEl() {
    return document.getElementById("iuSilverQuickPanel");
  }

  function inputEl() {
    return document.getElementById("iuSilverQuickPanelInput");
  }

  function sendEl() {
    return document.getElementById("iuSilverQuickPanelSend");
  }

  function fieldShellEl() {
    var panel = panelEl();
    if (!panel) return null;
    return panel.querySelector(".iuSilverQuickPanel__fieldShell");
  }

  function composerEl() {
    var panel = panelEl();
    if (!panel) return null;
    return panel.querySelector(".iuSilverQuickPanel__composer");
  }

  function prefixEl() {
    return document.getElementById("iuSilverQuickPanelPrefix");
  }

  function silverNavBtn() {
    return document.querySelector('#iuMobileBottomNav [data-iu-bottom-nav="silver"]');
  }

  function setOpen(next) {
    open = !!next;
    var panel = panelEl();
    if (!panel) return;
    try {
      panel.hidden = !open;
      panel.setAttribute("aria-hidden", open ? "false" : "true");
      panel.classList.toggle("iuSilverQuickPanel--open", open);
    } catch (_) {}
    try {
      document.body.classList.toggle("iu-silverQuickPanelOpen", open);
    } catch (_) {}
    var btn = silverNavBtn();
    if (btn) {
      try {
        btn.classList.toggle("iu-mobileBottomNav__btn--silverActive", open);
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      } catch (_) {}
    }
  }

  function syncQuickPanelUxState() {
    var inp = inputEl();
    var shell = fieldShellEl();
    var composer = composerEl();
    var prefix = prefixEl();
    if (!inp || !shell) return;
    var empty = !String(inp.value || "").length;
    var focused = false;
    try {
      focused = document.activeElement === inp;
    } catch (_) {}
    var templateMode = empty && !focused;
    try {
      shell.classList.toggle("iuSilverQuickPanel__fieldShell--template", templateMode);
      shell.classList.toggle("iuSilverQuickPanel__fieldShell--compose", !templateMode);
    } catch (_) {}
    if (composer) {
      try {
        composer.classList.toggle("iuSilverQuickPanel__composer--templateMode", templateMode);
        composer.classList.toggle("iuSilverQuickPanel__composer--composeMode", !templateMode);
      } catch (_) {}
    }
    if (prefix) {
      try {
        prefix.hidden = !templateMode;
        prefix.setAttribute("aria-hidden", templateMode ? "false" : "true");
      } catch (_) {}
    }
  }

  function resetQuickPanelTemplateMode() {
    var inp = inputEl();
    if (inp) {
      try {
        inp.value = "";
      } catch (_) {}
      try {
        inp.blur();
      } catch (_) {}
    }
    syncQuickPanelUxState();
  }

  function insertNotesPrefix() {
    var inp = inputEl();
    if (!inp) return;
    try {
      inp.value = PREFIX_NOTES;
    } catch (_) {}
    syncQuickPanelUxState();
    focusInput();
  }

  function focusInput() {
    var inp = inputEl();
    if (!inp) return;
    window.requestAnimationFrame(function () {
      window.setTimeout(function () {
        try {
          inp.focus({ preventScroll: true });
        } catch (_) {
          try {
            inp.focus();
          } catch (_2) {}
        }
        try {
          var pos = String(inp.value || "").length;
          inp.setSelectionRange(pos, pos);
        } catch (_3) {}
        syncQuickPanelUxState();
      }, 40);
    });
  }

  function closePanel() {
    if (!open) return;
    resetQuickPanelTemplateMode();
    setOpen(false);
  }

  function openPanel() {
    if (!narrowMobileTablet() || !bottomNavVisible()) return;
    setOpen(true);
    resetQuickPanelTemplateMode();
  }

  function togglePanel() {
    if (open) closePanel();
    else openPanel();
  }

  function submitPanel() {
    var qIn = inputEl();
    var mainIn = document.getElementById("iuSilverHomeInput");
    if (!qIn || !mainIn) return;
    var text = String(qIn.value || "").trim();
    if (!text) return;
    try {
      mainIn.value = text;
    } catch (_) {}
    try {
      if (typeof window.__iuSilverSyncHomeUxEmptyState === "function") window.__iuSilverSyncHomeUxEmptyState();
    } catch (_) {}
    try {
      if (typeof window.__iuSilverSyncHomeMicSend === "function") window.__iuSilverSyncHomeMicSend();
    } catch (_) {}
    closePanel();
    try {
      if (typeof window.__iuSilverTriggerHomeSubmit === "function") window.__iuSilverTriggerHomeSubmit();
    } catch (_) {}
  }

  function bindPanel() {
    var panel = panelEl();
    var inp = inputEl();
    var send = sendEl();
    var prefix = prefixEl();
    if (!panel || !inp || !send) return;

    if (!send.__iuSilverQuickPanelBound) {
      send.__iuSilverQuickPanelBound = 1;
      send.addEventListener("click", function (e) {
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch (_) {}
        submitPanel();
      });
    }

    if (prefix && !prefix.__iuSilverQuickPanelBound) {
      prefix.__iuSilverQuickPanelBound = 1;
      prefix.addEventListener("click", function (e) {
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch (_) {}
        insertNotesPrefix();
      });
    }

    if (!inp.__iuSilverQuickPanelBound) {
      inp.__iuSilverQuickPanelBound = 1;
      inp.addEventListener("input", syncQuickPanelUxState);
      inp.addEventListener("focus", syncQuickPanelUxState);
      inp.addEventListener("blur", syncQuickPanelUxState);
      inp.addEventListener("keydown", function (e) {
        try {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submitPanel();
          }
        } catch (_) {}
      });
    }

    syncQuickPanelUxState();
  }

  function handleBottomNavSilver() {
    if (!narrowMobileTablet() || !bottomNavVisible()) return false;
    if (onHomePage()) return false;
    togglePanel();
    return true;
  }

  function init() {
    bindPanel();
    try {
      window.iuSilverQuickPanelHandleBottomNavSilver = handleBottomNavSilver;
      window.iuSilverQuickPanelClose = closePanel;
      window.iuSilverQuickPanelIsOpen = function () {
        return open;
      };
      window.__iuSilverSyncQuickPanelUxState = syncQuickPanelUxState;
    } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
