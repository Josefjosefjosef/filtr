/**
 * infoUzel.cz — consent storage + analytics guard (PR-1: no analytics script)
 */
(function iuConsentModule() {
  "use strict";

  var KEYS = {
    layerDismissed: "iu:consent:layer:dismissed:v1",
    analytics: "iu:consent:analytics:v1",
    version: "iu:consent:analytics:version:v1",
    ts: "iu:consent:analytics:ts:v1",
    legacyDismiss: "iu:storage-notice:dismissed:v1"
  };

  var POLICY_VERSION = "1";

  function migrateLegacyDismiss() {
    try {
      if (localStorage.getItem(KEYS.layerDismissed) === "1") return;
      if (localStorage.getItem(KEYS.legacyDismiss) === "1") {
        localStorage.setItem(KEYS.layerDismissed, "1");
        if (!localStorage.getItem(KEYS.analytics)) {
          localStorage.setItem(KEYS.analytics, "denied");
        }
      }
    } catch (_) {}
  }

  function getAnalyticsConsent() {
    migrateLegacyDismiss();
    try {
      var v = localStorage.getItem(KEYS.analytics);
      if (v === "granted" || v === "denied") return v;
    } catch (_) {}
    return null;
  }

  function isAnalyticsGranted() {
    return getAnalyticsConsent() === "granted";
  }

  function setAnalyticsConsent(value) {
    if (value !== "granted" && value !== "denied") return;
    try {
      localStorage.setItem(KEYS.analytics, value);
      localStorage.setItem(KEYS.version, String(POLICY_VERSION));
      localStorage.setItem(KEYS.ts, new Date().toISOString());
    } catch (_) {}
    if (value === "granted") {
      iuAnalyticsInit();
    } else {
      iuAnalyticsTeardown();
    }
    try {
      window.dispatchEvent(
        new CustomEvent("iu:consent-change", { detail: { analytics: value } })
      );
    } catch (_) {}
  }

  function dismissLayer() {
    try {
      localStorage.setItem(KEYS.layerDismissed, "1");
    } catch (_) {}
  }

  function isLayerDismissed() {
    migrateLegacyDismiss();
    try {
      return localStorage.getItem(KEYS.layerDismissed) === "1";
    } catch (_) {
      return false;
    }
  }

  function getConsentTimestamp() {
    try {
      return localStorage.getItem(KEYS.ts) || "";
    } catch (_) {
      return "";
    }
  }

  function formatConsentTimestamp(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleString("cs-CZ", {
        day: "numeric",
        month: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (_) {
      return "—";
    }
  }

  /** PR-1 stub — loads nothing; future Umami gated here */
  function iuAnalyticsInit() {
    if (!isAnalyticsGranted()) {
      try {
        window.__IU_ANALYTICS_ACTIVE__ = false;
      } catch (_) {}
      return;
    }
    try {
      window.__IU_ANALYTICS_ACTIVE__ = false;
    } catch (_) {}
  }

  function iuAnalyticsTeardown() {
    try {
      window.__IU_ANALYTICS_ACTIVE__ = false;
    } catch (_) {}
  }

  window.iuConsent = {
    getAnalyticsConsent: getAnalyticsConsent,
    isAnalyticsGranted: isAnalyticsGranted,
    setAnalyticsConsent: setAnalyticsConsent,
    dismissLayer: dismissLayer,
    isLayerDismissed: isLayerDismissed,
    getConsentTimestamp: getConsentTimestamp,
    formatConsentTimestamp: formatConsentTimestamp,
    POLICY_VERSION: POLICY_VERSION
  };
  window.iuAnalyticsInit = iuAnalyticsInit;
  window.iuAnalyticsTeardown = iuAnalyticsTeardown;

  if (isAnalyticsGranted()) {
    iuAnalyticsInit();
  }
})();
