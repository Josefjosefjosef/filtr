/**
 * infoUzel.cz — technická informační lišta (localStorage dismiss flag only)
 */
(function iuStorageNoticeModule() {
  "use strict";

  var DISMISS_KEY = "iu:storage-notice:dismissed:v1";

  function qs(sel) {
    return document.querySelector(sel);
  }

  function isDismissed() {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function dismissNotice(bar) {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch (_) {}
    if (bar) bar.hidden = true;
  }

  function openCookiesSection() {
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
      var tile = qs('.iuInfoCenter__tile[data-iu-info-section="cookies"]');
      if (tile) {
        try {
          tile.click();
        } catch (_) {}
      }
    }, 60);
  }

  function boot() {
    var bar = document.getElementById("iuStorageNotice");
    if (!bar || isDismissed()) {
      if (bar) bar.hidden = true;
      return;
    }
    bar.hidden = false;
    var okBtn = document.getElementById("iuStorageNoticeOk");
    var moreBtn = document.getElementById("iuStorageNoticeMore");
    if (okBtn) {
      okBtn.addEventListener("click", function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        dismissNotice(bar);
      });
    }
    if (moreBtn) {
      moreBtn.addEventListener("click", function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        dismissNotice(bar);
        openCookiesSection();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
