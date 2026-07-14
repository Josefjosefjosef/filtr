/**
 * PC tool tabs (?iu_window=tool): MindMenu entry in left rail + right reserve column.
 */
(function iuDesktopToolWindowLeftRailV1() {
  "use strict";

  if (window.__iuDesktopToolWindowLeftRailV1Init) return;
  window.__iuDesktopToolWindowLeftRailV1Init = true;

  var PC_MQ = "(min-width: 901px)";
  var MIND_BTN_ID = "iuToolWindowMindMenuBtn";
  var RESERVE_ID = "iuToolWindowRightReserve";

  function isPcLayout() {
    try {
      return !!(window.matchMedia && window.matchMedia(PC_MQ).matches);
    } catch (_) {
      return false;
    }
  }

  function isToolWindowContext() {
    try {
      if (typeof window.iuDesktopLeftRailNewWindowIsToolWindow === "function") {
        return !!window.iuDesktopLeftRailNewWindowIsToolWindow();
      }
      return document.documentElement.getAttribute("data-iu-tool-window") === "1";
    } catch (_) {
      return false;
    }
  }

  function openMindMenuOverlay() {
    try {
      if (typeof window.iuArticleActionsOpenOverlay === "function") {
        window.iuArticleActionsOpenOverlay();
        return;
      }
    } catch (_) {}
    try {
      var mainBtn = document.getElementById("iuMyInfoUzelOpenBtn");
      if (mainBtn) {
        mainBtn.click();
        return;
      }
    } catch (_) {}
  }

  function ensureMindMenuButton() {
    if (!isToolWindowContext() || !isPcLayout()) return;
    var nav = document.querySelector("#iuLeftRail .iu-leftNav");
    if (!nav) return;
    if (document.getElementById(MIND_BTN_ID)) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = MIND_BTN_ID;
    btn.className = "iuToolWindowMindMenuBtn";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-controls", "iuMyInfoUzelOverlay");
    btn.setAttribute("aria-label", "Můj infoUzel.cz / MindMenu");
    btn.innerHTML =
      '<span class="iuToolWindowMindMenuBtn__icons" aria-hidden="true"><span>📧</span><span>📅</span><span>✅</span><span>📝</span></span>' +
      '<span class="iuToolWindowMindMenuBtn__label">Můj infoUzel.cz / MindMenu</span>';
    btn.addEventListener("click", function (e) {
      try {
        if (e && typeof e.preventDefault === "function") e.preventDefault();
        if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      } catch (_) {}
      openMindMenuOverlay();
    });

    nav.insertBefore(btn, nav.firstChild);
  }

  function ensureRightReserve() {
    if (!isToolWindowContext() || !isPcLayout()) return;
    var layout = document.querySelector(".layout");
    if (!layout || document.getElementById(RESERVE_ID)) return;
    var reserve = document.createElement("div");
    reserve.id = RESERVE_ID;
    reserve.className = "iuToolWindowRightReserve";
    reserve.setAttribute("aria-hidden", "true");
    layout.appendChild(reserve);
  }

  function applyToolWindowShellEnhancements() {
    if (!isToolWindowContext()) return;
    ensureMindMenuButton();
    ensureRightReserve();
  }

  applyToolWindowShellEnhancements();
  document.addEventListener("DOMContentLoaded", applyToolWindowShellEnhancements);
  try {
    window.addEventListener("load", applyToolWindowShellEnhancements);
  } catch (_) {}
})();
