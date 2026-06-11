/**
 * infoUzel.cz — Info Center LAZY MOUNT (P0 performance fix #1)
 *
 * The #iuTopbarInfoOverlay markup (~460 DOM elements) ships inside an inert
 * <template id="iuTopbarInfoOverlayTpl"> and is mounted into the document only
 * on first open. After mounting, behaviour is identical to the previous eager
 * render.
 *
 * Ownership notes:
 *  - app.js iuInitTopbarInfoOverlay() finds no overlay at boot and no-ops,
 *    so this module owns open/close (same logic, replicated 1:1).
 *  - iu-info-center.js re-runs its initNavigation() on the
 *    "iu:info-center-mounted" event (inner navigation, consent panel).
 *  - Trigger clicks are intercepted in capture phase with stopPropagation,
 *    which also guards against double-binding races.
 */
(function iuInfoCenterLazyMount() {
  "use strict";

  if (window.__iuInfoCenterLazyMount) return;
  window.__iuInfoCenterLazyMount = true;

  var TRIGGER_SELECTOR = "#iuTopbarInfoBtn, #iuSilverWelcomeInfoBtn";

  var bound = false;
  var isOpen = false;
  var lastFocus = null;
  var lastTrigger = null;

  function getOverlay() {
    return document.getElementById("iuTopbarInfoOverlay");
  }

  function mountOverlay() {
    var existing = getOverlay();
    if (existing) return existing;
    var tpl = document.getElementById("iuTopbarInfoOverlayTpl");
    if (!tpl || !tpl.content) return null;
    try {
      tpl.parentNode.insertBefore(tpl.content.cloneNode(true), tpl);
      tpl.parentNode.removeChild(tpl);
    } catch (_) {
      return null;
    }
    var overlay = getOverlay();
    if (overlay && !bound) bindOverlay(overlay);
    try {
      document.dispatchEvent(new CustomEvent("iu:info-center-mounted"));
    } catch (_) {}
    return overlay;
  }

  function getTriggers() {
    var list = [];
    var a = document.getElementById("iuTopbarInfoBtn");
    var b = document.getElementById("iuSilverWelcomeInfoBtn");
    if (a) list.push(a);
    if (b) list.push(b);
    return list;
  }

  function setTriggersExpanded(expanded) {
    var v = expanded ? "true" : "false";
    getTriggers().forEach(function (el) {
      try {
        el.setAttribute("aria-expanded", v);
      } catch (_) {}
    });
  }

  function setOpen(open) {
    var overlay = open ? mountOverlay() : getOverlay();
    if (!overlay) return;
    var closeBtn = document.getElementById("iuTopbarInfoOverlayClose");
    isOpen = !!open;
    if (isOpen) {
      try { overlay.hidden = false; } catch (_) {}
      try { overlay.removeAttribute("aria-hidden"); } catch (_) {}
      setTriggersExpanded(true);
      try { lastFocus = document.activeElement; } catch (_) {}
      try { if (closeBtn) closeBtn.focus({ preventScroll: true }); } catch (_) {}
    } else {
      try { overlay.hidden = true; } catch (_) {}
      try { overlay.setAttribute("aria-hidden", "true"); } catch (_) {}
      setTriggersExpanded(false);
      try {
        if (lastFocus && typeof lastFocus.focus === "function") {
          lastFocus.focus({ preventScroll: true });
        } else {
          var fb = lastTrigger || getTriggers()[0];
          if (fb && typeof fb.focus === "function") fb.focus({ preventScroll: true });
        }
      } catch (_) {}
    }
  }

  function bindOverlay(overlay) {
    bound = true;
    try {
      overlay.querySelectorAll("[data-iu-topbar-info-close]").forEach(function (el) {
        el.addEventListener("click", function () {
          setOpen(false);
        });
      });
    } catch (_) {}
    overlay.addEventListener("click", function (e) {
      try {
        if (e.target === overlay) setOpen(false);
      } catch (_) {}
    });
  }

  document.addEventListener(
    "click",
    function (e) {
      var btn = null;
      try {
        btn = e.target && e.target.closest ? e.target.closest(TRIGGER_SELECTOR) : null;
      } catch (_) {}
      if (!btn) return;
      try { e.preventDefault(); } catch (_) {}
      // Suppress any legacy direct-bound toggle handlers (double-toggle guard).
      try { e.stopPropagation(); } catch (_) {}
      lastTrigger = btn;
      setOpen(!isOpen);
    },
    true,
  );

  document.addEventListener("keydown", function (e) {
    try {
      if (!isOpen) return;
      if (!e || e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    } catch (_) {}
  });

  // Stub for early callers (consent layer "Nastavení soukromí" etc.).
  // iu-info-center.js replaces this with the real implementation right after
  // the mount event is dispatched (synchronously inside mountOverlay()).
  if (typeof window.iuInfoCenterOpenSection !== "function") {
    var stub = function (key) {
      mountOverlay();
      var real = window.iuInfoCenterOpenSection;
      if (typeof real === "function" && real !== stub) {
        real(key);
      } else {
        setOpen(true);
      }
    };
    window.iuInfoCenterOpenSection = stub;
  }
})();
