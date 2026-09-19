/**
 * P0 pwa-title-no-dup-v1-20260918
 *
 * Windows Chromium/Edge installed PWA title bar composition:
 *   manifest.name + " – " + (application-title OR document.title)
 * If document.title already starts with manifest.name (exact case), engines skip prepending.
 *
 * Historical FAIL: title "InfoUzel.cz – …" + short_name "infoUzel.cz" (case mismatch)
 * → "infoUzel.cz – InfoUzel.cz – internet v internetu"
 *
 * Contract:
 *   - Browser tab: document.title = "infoUzel.cz – internet v internetu"
 *   - Standalone/PWA: document.title subtitle-only "internet v internetu"
 *     so chrome shows "infoUzel.cz – internet v internetu" even on older engines
 *     without application-title support.
 */
(function iuPwaWindowTitleV1() {
  "use strict";
  if (window.__iuPwaWindowTitleBooted) return;
  window.__iuPwaWindowTitleBooted = true;

  var APP_NAME = "infoUzel.cz";
  var TAGLINE = "internet v internetu";
  var BROWSER_TITLE = APP_NAME + " \u2013 " + TAGLINE;
  var PWA_SUBTITLE = TAGLINE;

  function isInstalledDisplay() {
    try {
      if (typeof window.matchMedia === "function") {
        if (window.matchMedia("(display-mode: standalone)").matches) return true;
        if (window.matchMedia("(display-mode: minimal-ui)").matches) return true;
        if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
        if (window.matchMedia("(display-mode: window-controls-overlay)").matches) return true;
      }
    } catch (_) {}
    try {
      if (window.navigator && window.navigator.standalone === true) return true;
    } catch (_) {}
    return false;
  }

  function isHomeBrandTitle(t) {
    var s = String(t || "").replace(/\s+/g, " ").trim();
    // Allow both en-dash and hyphen separators; tolerate legacy InfoUzel casing.
    return /^infoUzel\.cz\s*[–-]\s*internet v internetu$/i.test(s);
  }

  function apply() {
    try {
      if (isInstalledDisplay()) {
        if (isHomeBrandTitle(document.title) || !String(document.title || "").trim()) {
          document.title = PWA_SUBTITLE;
        } else if (new RegExp("^" + APP_NAME.replace(/\./g, "\\.") + "\\s*[–-]\\s*", "i").test(document.title)) {
          // Strip leading brand if a future section title still prefixes the app name.
          document.title = String(document.title)
            .replace(new RegExp("^" + APP_NAME.replace(/\./g, "\\.") + "\\s*[–-]\\s*", "i"), "")
            .trim();
        }
      } else if (isHomeBrandTitle(document.title) && document.title !== BROWSER_TITLE) {
        document.title = BROWSER_TITLE;
      }
    } catch (_) {}
  }

  apply();
  try {
    if (typeof window.matchMedia === "function") {
      var mq = window.matchMedia("(display-mode: standalone)");
      if (mq && typeof mq.addEventListener === "function") {
        mq.addEventListener("change", apply);
      } else if (mq && typeof mq.addListener === "function") {
        mq.addListener(apply);
      }
    }
  } catch (_) {}
})();
