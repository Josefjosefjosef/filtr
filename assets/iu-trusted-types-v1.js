/**
 * Trusted Types default policy — register before app scripts when supported.
 * CSP enforcement (require-trusted-types-for) is added only after sink migration.
 */
(function iuTrustedTypesBootstrap() {
  "use strict";
  if (typeof window === "undefined") return;
  if (!window.trustedTypes || typeof window.trustedTypes.createPolicy !== "function") return;
  if (window.__iuTrustedTypesPolicyReady) return;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isAllowedScriptUrl(url) {
    const u = String(url || "");
    if (!u) return false;
    if (u.startsWith("/assets/")) return true;
    if (u === "/sw.js" || u.startsWith("/sw.js?")) return true;
    if (u.startsWith("./") || u.startsWith("../")) return true;
    return false;
  }

  try {
    window.trustedTypes.createPolicy("iu-default", {
      createHTML: escapeHtml,
      createScriptURL: function (url) {
        if (!isAllowedScriptUrl(url)) throw new TypeError("IU_TT_SCRIPT_URL_BLOCKED");
        return url;
      },
    });
    window.__iuTrustedTypesPolicyReady = 1;
  } catch (_) {}
})();
