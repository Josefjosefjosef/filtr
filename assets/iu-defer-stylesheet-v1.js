/**
 * CSP-safe replacement for inline link[onload] defer-to-screen promotion.
 * Wires print-media stylesheets (app.css + overlay CSS) to switch to media=all after load.
 */
(function iuDeferStylesheetV1() {
  "use strict";

  if (window.__iuDeferStylesheetV1) return;
  window.__iuDeferStylesheetV1 = 1;

  function promoteLink(link) {
    if (!link || link.dataset.iuDeferWired === "1") return;
    link.dataset.iuDeferWired = "1";

    function apply() {
      try {
        link.media = "all";
        link.dataset.iuDeferReady = "1";
      } catch (_) {}
    }

    link.addEventListener("load", apply, { once: true });
    try {
      if (link.sheet) apply();
    } catch (_) {}
  }

  function scan() {
    var nodes = document.querySelectorAll(
      'link[data-iu-defer-app-css="1"],link[data-iu-defer-overlay-css="1"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      var link = nodes[i];
      if (link.getAttribute("href") || link.href) promoteLink(link);
    }
  }

  window.iuWireDeferStylesheetLink = promoteLink;
  window.iuScanDeferStylesheetLinks = scan;

  scan();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan, { once: true });
  }
})();
