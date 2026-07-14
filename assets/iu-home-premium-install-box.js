/**
 * Homepage premium install box — opens Informační centrum › PWA (existing overlay).
 * Mobile/tablet only; UX v2: trigger-based reveal, session dismiss, inline title row.
 */
(function iuHomePremiumInstallBox() {
  "use strict";

  var SESSION_DISMISS_KEY = "iu_home_install_box_dismiss_v1";
  var SCROLL_END_PX = 120;
  var ACTION_REVEAL_DELAY_MS = 350;

  var state = {
    revealed: false,
    scrollEndTriggered: false,
    pendingCardReturn: false
  };

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

  function isSessionDismissed() {
    try {
      return sessionStorage.getItem(SESSION_DISMISS_KEY) === "1";
    } catch (_) {}
    return false;
  }

  function dismissForSession(box) {
    try {
      sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
    } catch (_) {}
    hideBox(box);
  }

  function hideBox(box) {
    if (!box) return;
    state.revealed = false;
    box.hidden = true;
    box.removeAttribute("data-iu-home-install-box-visible");
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
    if (!box || box.hidden || !state.revealed) return;
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

  function isNearPageBottom() {
    var doc = document.documentElement;
    var body = document.body;
    var scrollTop = window.scrollY || doc.scrollTop || (body ? body.scrollTop : 0) || 0;
    var viewH = window.innerHeight || doc.clientHeight || 0;
    var fullH = Math.max(
      doc.scrollHeight || 0,
      body ? body.scrollHeight : 0,
      doc.offsetHeight || 0
    );
    return scrollTop + viewH >= fullH - SCROLL_END_PX;
  }

  function revealBox(box, _reason) {
    if (!box || state.revealed || isSessionDismissed()) return;
    if (!isMobileTablet() || isStandalone()) return;
    state.revealed = true;
    box.hidden = false;
    box.setAttribute("data-iu-home-install-box-visible", "1");
    syncInstallBoxClearance(box);
  }

  function scheduleReveal(box, _reason) {
    if (state.revealed || isSessionDismissed()) return;
    window.setTimeout(function () {
      revealBox(box, _reason);
    }, ACTION_REVEAL_DELAY_MS);
  }

  function onScroll(box) {
    if (!state.revealed && !isSessionDismissed() && !state.scrollEndTriggered && isNearPageBottom()) {
      state.scrollEndTriggered = true;
      revealBox(box, "scroll-end");
    }
    syncInstallBoxClearance(box);
  }

  function noteHasSavedContent() {
    var ov = document.getElementById("iuNotesOverlay");
    if (!ov || ov.hidden) return false;
    var ta = ov.querySelector("#iuNoteBody, .iu-notesOverlay__textarea");
    return !!(ta && String(ta.value || "").trim());
  }

  function upgradeInstallBoxDom(rawEl) {
    if (!rawEl) return null;
    if (rawEl.getAttribute("data-iu-home-install-box-dom-v2") === "1") return rawEl;
    if (rawEl.tagName !== "BUTTON") return rawEl;

    var parent = rawEl.parentNode;
    if (!parent) return rawEl;

    var shell = document.createElement("div");
    shell.id = rawEl.id || "iuHomePremiumInstallBox";
    shell.className = rawEl.className || "iuHomePremiumInstallBox";
    shell.setAttribute("data-iu-home-premium-install-box", "1");
    shell.setAttribute("data-iu-home-install-box-dom-v2", "1");
    shell.hidden = true;

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "iuHomePremiumInstallBox__close";
    closeBtn.setAttribute("data-iu-home-install-box-close", "1");
    closeBtn.setAttribute("aria-label", "Zavřít");
    closeBtn.textContent = "✕";

    var actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = "iuHomePremiumInstallBox__action";
    actionBtn.setAttribute("data-iu-home-install-box-action", "1");
    actionBtn.setAttribute(
      "aria-label",
      rawEl.getAttribute("aria-label") || "Přidejte si InfoUzel.cz na plochu"
    );

    var inner = rawEl.querySelector(".iuHomePremiumInstallBox__inner");
    if (inner) {
      var titleEl = inner.querySelector(".iuHomePremiumInstallBox__title");
      var subtitleEl = inner.querySelector(".iuHomePremiumInstallBox__subtitle");
      var iconsEl = inner.querySelector(".iuHomePremiumInstallBox__icons");
      var chevronEl = inner.querySelector(".iuHomePremiumInstallBox__chevron");

      var newInner = document.createElement("span");
      newInner.className = "iuHomePremiumInstallBox__inner";

      var head = document.createElement("span");
      head.className = "iuHomePremiumInstallBox__head";
      if (titleEl) head.appendChild(titleEl);

      var body = document.createElement("span");
      body.className = "iuHomePremiumInstallBox__body";
      if (iconsEl) body.appendChild(iconsEl);

      var textWrap = document.createElement("span");
      textWrap.className = "iuHomePremiumInstallBox__text";
      if (subtitleEl) textWrap.appendChild(subtitleEl);
      body.appendChild(textWrap);

      if (chevronEl) body.appendChild(chevronEl);

      newInner.appendChild(head);
      newInner.appendChild(body);
      actionBtn.appendChild(newInner);
    } else {
      actionBtn.appendChild(rawEl.cloneNode(true));
    }

    shell.appendChild(closeBtn);
    shell.appendChild(actionBtn);
    parent.replaceChild(shell, rawEl);
    return shell;
  }

  function bindMeaningfulActionTriggers(box) {
    document.addEventListener(
      "click",
      function (e) {
        if (isSessionDismissed() || state.revealed) return;
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest("[data-iu-home-install-box-close]")) return;

        if (t.closest("[data-iu-tasks-save='1'], [data-iu-cal-inline-save='1']")) {
          scheduleReveal(box, "tool-save");
          return;
        }

        if (t.closest("[data-iu-notes-close]") && noteHasSavedContent()) {
          scheduleReveal(box, "note-close");
          return;
        }

        if (
          t.closest(
            ".iuNewsPreviewCard, [data-iu-news-preview-card], .iuSilverTallScrollCard, [data-iuq], [data-iu-bottom-nav]"
          ) &&
          !t.closest("#iuHomePremiumInstallBox")
        ) {
          if (t.closest("[data-iu-bottom-nav='home']")) {
            if (state.pendingCardReturn) {
              state.pendingCardReturn = false;
              scheduleReveal(box, "card-return-home");
            }
            return;
          }
          if (!t.closest("[data-iu-bottom-nav]")) {
            state.pendingCardReturn = true;
          }
        }
      },
      true
    );
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
    var raw = document.getElementById("iuHomePremiumInstallBox");
    var box = upgradeInstallBoxDom(raw);
    if (!box || box.getAttribute("data-iu-home-install-box-inited") === "1") return;
    box.setAttribute("data-iu-home-install-box-inited", "1");

    hideBox(box);

    if (!isMobileTablet() || isStandalone() || isSessionDismissed()) {
      return;
    }

    bindInstallBoxClearance(box);
    bindMeaningfulActionTriggers(box);

    window.addEventListener(
      "scroll",
      function () {
        onScroll(box);
      },
      { passive: true }
    );

    var closeBtn = box.querySelector("[data-iu-home-install-box-close]");
    if (closeBtn) {
      closeBtn.addEventListener("click", function (e) {
        try {
          e.preventDefault();
        } catch (_) {}
        try {
          e.stopPropagation();
        } catch (_) {}
        dismissForSession(box);
      });
    }

    var actionBtn = box.querySelector("[data-iu-home-install-box-action]");
    var clickTarget = actionBtn || box;
    clickTarget.addEventListener(
      "click",
      function (e) {
        if (e.target && e.target.closest && e.target.closest("[data-iu-home-install-box-close]")) return;
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

    window.addEventListener("resize", function () {
      if (!isMobileTablet() || isStandalone()) {
        hideBox(box);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
