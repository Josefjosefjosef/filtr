/**
 * InfoUzel — local TERMS/VOP acceptance preference (clickwrap).
 * Separate from analytics consent (`iu:consent:*`). Plain localStorage only (readable before vault unlock).
 * Version source of truth: window.iuGdprVopLegal.META (fallback constant kept in sync).
 */
(function iuTermsAcceptanceV1() {
  "use strict";

  /** Fallback when legal body not yet loaded — must match META.versionId. */
  var FALLBACK_VERSION_ID = "2026-09-08-v1";
  var FALLBACK_REQUIRES_REACCEPTANCE = true;

  var KEYS = {
    accepted: "iu:terms:accepted:v1",
    version: "iu:terms:accepted-version:v1",
    acceptedAt: "iu:terms:accepted-at:v1"
  };

  function readMeta() {
    try {
      var legal = window.iuGdprVopLegal;
      if (legal && legal.META && legal.META.versionId) {
        return {
          versionId: String(legal.META.versionId),
          requiresReacceptance:
            legal.META.requiresReacceptance === true ||
            legal.META.requiresReacceptance === false
              ? !!legal.META.requiresReacceptance
              : FALLBACK_REQUIRES_REACCEPTANCE,
          documentId: legal.META.documentId || "gdpr-vop-ads"
        };
      }
    } catch (_) {}
    return {
      versionId: FALLBACK_VERSION_ID,
      requiresReacceptance: FALLBACK_REQUIRES_REACCEPTANCE,
      documentId: "gdpr-vop-ads"
    };
  }

  function getCurrentVersion() {
    return readMeta().versionId;
  }

  function getRequiresReacceptance() {
    return !!readMeta().requiresReacceptance;
  }

  function getAcceptedVersion() {
    try {
      return localStorage.getItem(KEYS.version) || "";
    } catch (_) {
      return "";
    }
  }

  function getAcceptedAt() {
    try {
      return localStorage.getItem(KEYS.acceptedAt) || "";
    } catch (_) {
      return "";
    }
  }

  function isAcceptedFlag() {
    try {
      return localStorage.getItem(KEYS.accepted) === "1";
    } catch (_) {
      return false;
    }
  }

  /**
   * Local Playwright/CI only: skip gate on 127.0.0.1|localhost when navigator.webdriver
   * so existing guards are not blocked. Production hosts never bypass.
   * Terms clickwrap guard sets window.__IU_FORCE_TERMS_GATE__ = true to opt out.
   */
  function isCiLocalAutomationBypass() {
    try {
      if (window.__IU_FORCE_TERMS_GATE__ === true) return false;
      if (!navigator.webdriver) return false;
      var h = String((location && location.hostname) || "");
      return h === "127.0.0.1" || h === "localhost";
    } catch (_) {
      return false;
    }
  }

  /**
   * True when gate must show for interactive use.
   * Minor doc bumps: META.requiresReacceptance === false keeps prior acceptance.
   * Significant bumps: requiresReacceptance true + version mismatch → re-prompt.
   */
  function needsAcceptance() {
    if (isCiLocalAutomationBypass()) return false;
    var meta = readMeta();
    var stored = getAcceptedVersion();
    if (!stored || !isAcceptedFlag()) return true;
    if (stored === meta.versionId) return false;
    if (meta.requiresReacceptance) return true;
    return false;
  }

  function acceptCurrentVersion() {
    var meta = readMeta();
    var ts = new Date().toISOString();
    try {
      localStorage.setItem(KEYS.accepted, "1");
      localStorage.setItem(KEYS.version, meta.versionId);
      localStorage.setItem(KEYS.acceptedAt, ts);
    } catch (_) {}
    try {
      window.dispatchEvent(
        new CustomEvent("iu:terms-accepted", {
          detail: {
            versionId: meta.versionId,
            acceptedAt: ts,
            documentId: meta.documentId
          }
        })
      );
    } catch (_) {}
    return { versionId: meta.versionId, acceptedAt: ts };
  }

  /** Explicit non-accept — never writes acceptance keys. */
  function recordDecline() {
    try {
      window.dispatchEvent(new CustomEvent("iu:terms-declined", { detail: {} }));
    } catch (_) {}
  }

  window.iuTermsAcceptance = {
    KEYS: KEYS,
    FALLBACK_VERSION_ID: FALLBACK_VERSION_ID,
    getCurrentVersion: getCurrentVersion,
    getRequiresReacceptance: getRequiresReacceptance,
    getAcceptedVersion: getAcceptedVersion,
    getAcceptedAt: getAcceptedAt,
    isAcceptedFlag: isAcceptedFlag,
    needsAcceptance: needsAcceptance,
    acceptCurrentVersion: acceptCurrentVersion,
    recordDecline: recordDecline,
    readMeta: readMeta
  };
})();
