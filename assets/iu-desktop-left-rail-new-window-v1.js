/**
 * infoUzel.cz — PC (≥1025px): left-rail tools open in a new tab of the same
 * browser window with the full functional desktop top bar + section shell (?iu_window=tool).
 */
(function iuDesktopLeftRailNewWindowV1() {
  "use strict";

  if (window.__iuDesktopLeftRailNewWindowV1Init) return;
  window.__iuDesktopLeftRailNewWindowV1Init = true;

  var PC_MQ = "(min-width: 1025px)";
  var WINDOW_PARAM = "iu_window";
  var WINDOW_VALUE = "tool";

  function isPcWide() {
    try {
      return !!(window.matchMedia && window.matchMedia(PC_MQ).matches);
    } catch (_) {
      return false;
    }
  }

  function isToolWindowContext() {
    try {
      var p = new URLSearchParams(String(location.search || ""));
      return String(p.get(WINDOW_PARAM) || "").trim().toLowerCase() === WINDOW_VALUE;
    } catch (_) {
      return false;
    }
  }

  function normalizeAccent(raw) {
    var k = String(raw || "").trim().toLowerCase();
    if (k === "tv") return "tvonline";
    if (k.indexOf("aff-") === 0) return k;
    return k;
  }

  function isLeftRailToolItem(item) {
    if (!item || !item.classList || !item.classList.contains("iu-leftNavItem")) return false;
    if (!item.closest || !item.closest("#iuLeftRail")) return false;
    var mediaTopic = String(item.getAttribute("data-media-topic") || "").trim();
    if (mediaTopic) return false;
    var accent = String(item.getAttribute("data-accent") || "").trim().toLowerCase();
    if (!accent) return false;
    if (accent === "travel") return true;
    if (accent.indexOf("aff-") === 0) return true;
    var tools = {
      pocasi: 1,
      mapy: 1,
      jr: 1,
      tvprogram: 1,
      tvonline: 1,
      radio: 1,
    };
    return !!tools[accent];
  }

  function buildToolWindowUrl(accent) {
    var url = new URL("/projects/", location.origin);
    url.searchParams.set("section", normalizeAccent(accent));
    url.searchParams.set(WINDOW_PARAM, WINDOW_VALUE);
    return url.toString();
  }

  function getScrollY() {
    try {
      if (typeof window.iuGetMainScrollTop === "function") return window.iuGetMainScrollTop();
    } catch (_) {}
    try {
      return Math.max(
        0,
        window.scrollY || 0,
        (document.documentElement && document.documentElement.scrollTop) || 0,
        (document.body && document.body.scrollTop) || 0
      );
    } catch (_) {
      return 0;
    }
  }

  function restoreScrollY(y) {
    var target = Math.max(0, Number(y) || 0);
    try {
      window.scrollTo(0, target);
      if (document.documentElement) document.documentElement.scrollTop = target;
      if (document.body) document.body.scrollTop = target;
    } catch (_) {}
  }

  var parentScrollRestoreY = null;
  var parentScrollRestoreUntil = 0;

  function armParentScrollRestore(y) {
    parentScrollRestoreY = Math.max(0, Number(y) || 0);
    parentScrollRestoreUntil = Date.now() + 8000;
    restoreScrollY(parentScrollRestoreY);
    try {
      requestAnimationFrame(function () {
        restoreScrollY(parentScrollRestoreY);
      });
    } catch (_) {}
    try {
      window.setTimeout(function () {
        restoreScrollY(parentScrollRestoreY);
      }, 0);
    } catch (_) {}
  }

  function maybeRestoreParentScroll() {
    if (parentScrollRestoreY == null) return;
    if (Date.now() > parentScrollRestoreUntil) {
      parentScrollRestoreY = null;
      return;
    }
    if (isToolWindowContext()) return;
    restoreScrollY(parentScrollRestoreY);
  }

  try {
    document.addEventListener("visibilitychange", function () {
      try {
        if (!document.hidden) maybeRestoreParentScroll();
      } catch (_) {}
    });
  } catch (_) {}

  function showTabBlockedNotice() {
    var msg =
      "Prohlížeč zablokoval novou kartu. Povolte vyskakovací okna pro infoUzel.cz a zkuste to znovu.";
    try {
      if (typeof window.iuToast === "function") {
        window.iuToast(msg, { duration: 8000 });
        return;
      }
    } catch (_) {}
    var host = document.getElementById("iuDesktopLeftRailPopupBlocked");
    if (!host) {
      host = document.createElement("div");
      host.id = "iuDesktopLeftRailPopupBlocked";
      host.className = "iuDesktopLeftRailPopupBlocked";
      host.setAttribute("role", "alert");
      host.setAttribute("aria-live", "assertive");
      document.body.appendChild(host);
    }
    host.textContent = msg;
    host.hidden = false;
    try {
      window.setTimeout(function () {
        try {
          host.hidden = true;
        } catch (_) {}
      }, 9000);
    } catch (_) {}
  }

  function openToolTab(accent) {
    var key = normalizeAccent(accent);
    var targetUrl = buildToolWindowUrl(key);
    var tab = null;
    try {
      tab = window.open(targetUrl, "_blank", "noopener,noreferrer");
    } catch (_) {
      tab = null;
    }
    if (!tab) {
      showTabBlockedNotice();
      return true;
    }
    try {
      tab.opener = null;
    } catch (_) {}
    return true;
  }

  function markToolWindowShellEarly() {
    if (!isToolWindowContext()) return;
    try {
      document.documentElement.setAttribute("data-iu-tool-window", "1");
    } catch (_) {}
    try {
      if (document.body) document.body.setAttribute("data-iu-tool-window", "1");
    } catch (_) {}
  }

  window.iuDesktopLeftRailNewWindowIsToolWindow = isToolWindowContext;
  window.iuDesktopLeftRailNewWindowHandleClick = function (item, e) {
    if (!isPcWide()) return false;
    if (!isLeftRailToolItem(item)) return false;

    try {
      if (e && typeof e.preventDefault === "function") e.preventDefault();
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      if (e && typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    } catch (_) {}

    var accent = String(item.getAttribute("data-accent") || "").trim().toLowerCase();
    if (!isToolWindowContext()) {
      armParentScrollRestore(getScrollY());
    }
    return openToolTab(accent);
  };

  markToolWindowShellEarly();
  document.addEventListener("DOMContentLoaded", markToolWindowShellEarly);
})();
