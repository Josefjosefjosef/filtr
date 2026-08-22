/**
 * Trusted Types — sanitize HTML sinks + optional DOM patch for enforcement.
 * Policies: iu-default (sanitize), iu-escape (text only).
 */
(function iuTrustedTypesBootstrap() {
  "use strict";
  if (typeof window === "undefined") return;
  if (window.__iuTrustedTypesReady) return;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var BLOCKED_HTML_RE = [
    /<\s*script\b/i,
    /<\s*\/\s*script/i,
    /javascript\s*:/i,
    /vbscript\s*:/i,
    /data\s*:\s*text\/html/i,
    /<\s*iframe\b/i,
    /<\s*object\b/i,
    /<\s*embed\b/i,
    /<\s*base\b/i,
    /<\s*meta\b[^>]*http-equiv/i,
    /\bon\w+\s*=/i,
    /expression\s*\(/i,
    /url\s*\(\s*["']?\s*javascript/i,
  ];

  function sanitizeHtml(html) {
    var s = String(html || "");
    for (var i = 0; i < BLOCKED_HTML_RE.length; i += 1) {
      if (BLOCKED_HTML_RE[i].test(s)) throw new TypeError("IU_TT_HTML_BLOCKED");
    }
    return s;
  }

  function isAllowedScriptUrl(url) {
    var u = String(url || "");
    if (!u) return false;
    if (u.startsWith("blob:")) return true;
    if (u.startsWith("/")) return true;
    if (u.startsWith("./") || u.startsWith("../")) return true;
    if (u === "/sw.js" || u.startsWith("/sw.js?")) return true;
    try {
      var parsed = new URL(u, location.origin);
      if (parsed.origin === location.origin) return true;
    } catch (_) {}
    return false;
  }

  var policies = {
    default: null,
    escape: null,
  };

  if (window.trustedTypes && typeof window.trustedTypes.createPolicy === "function") {
    try {
      policies.default = window.trustedTypes.createPolicy("iu-default", {
        createHTML: sanitizeHtml,
        createScriptURL: function (url) {
          if (!isAllowedScriptUrl(url)) throw new TypeError("IU_TT_SCRIPT_URL_BLOCKED");
          return url;
        },
      });
    } catch (_) {}
    try {
      policies.escape = window.trustedTypes.createPolicy("iu-escape", {
        createHTML: escapeHtml,
      });
    } catch (_) {}
  }

  function toTrustedHtml(html) {
    if (policies.default) return policies.default.createHTML(String(html || ""));
    return sanitizeHtml(html);
  }

  function toEscapedHtml(text) {
    if (policies.escape) return policies.escape.createHTML(String(text || ""));
    return escapeHtml(text);
  }

  function patchSetter(proto, prop) {
    var desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || typeof desc.set !== "function") return;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (value) {
        if (typeof value === "string") value = toTrustedHtml(value);
        desc.set.call(this, value);
      },
    });
  }

  function patchInsertAdjacentHTML() {
    var orig = Element.prototype.insertAdjacentHTML;
    if (typeof orig !== "function") return;
    Element.prototype.insertAdjacentHTML = function (position, html) {
      return orig.call(this, position, toTrustedHtml(html));
    };
  }

  function toTrustedScriptUrl(url) {
    if (policies.default) return policies.default.createScriptURL(String(url || ""));
    return String(url || "");
  }

  function trustScriptElement(node) {
    if (!node || !policies.default) return;
    if (node.tagName !== "SCRIPT") return;
    var src = node.getAttribute("src");
    if (src) node.setAttribute("src", toTrustedScriptUrl(src));
  }

  function patchDomInsertion() {
    var origAppend = Node.prototype.appendChild;
    Node.prototype.appendChild = function (child) {
      trustScriptElement(child);
      return origAppend.call(this, child);
    };
    var origInsert = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (child, ref) {
      trustScriptElement(child);
      return origInsert.call(this, child, ref);
    };
    var origSetAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (String(name).toLowerCase() === "src" && this.tagName === "SCRIPT" && typeof value === "string" && policies.default) {
        value = toTrustedScriptUrl(value);
      }
      return origSetAttr.call(this, name, value);
    };
  }

  function patchWorkerConstructor() {
    if (typeof Worker !== "function") return;
    var OrigWorker = Worker;
    window.Worker = function (url, options) {
      if (typeof url === "string" && policies.default) url = toTrustedScriptUrl(url);
      return new OrigWorker(url, options);
    };
    window.Worker.prototype = OrigWorker.prototype;
  }

  function patchScriptSrc() {
    var desc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src");
    if (!desc || typeof desc.set !== "function") return;
    Object.defineProperty(HTMLScriptElement.prototype, "src", {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (value) {
        if (typeof value === "string" && policies.default) {
          value = toTrustedScriptUrl(value);
        }
        desc.set.call(this, value);
      },
    });
  }

  function patchServiceWorkerRegister() {
    if (!navigator.serviceWorker || typeof navigator.serviceWorker.register !== "function") return;
    var orig = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = function (url, options) {
      if (typeof url === "string" && policies.default) {
        url = policies.default.createScriptURL(url);
      }
      return orig(url, options);
    };
  }

  if (policies.default) {
    try {
      patchSetter(Element.prototype, "innerHTML");
      patchSetter(Element.prototype, "outerHTML");
      patchInsertAdjacentHTML();
      patchScriptSrc();
      patchDomInsertion();
      patchWorkerConstructor();
      patchServiceWorkerRegister();
    } catch (_) {}
  }

  window.iuTrustedHtml = {
    escape: escapeHtml,
    sanitize: sanitizeHtml,
    toHtml: toTrustedHtml,
    toEscaped: toEscapedHtml,
    setInnerHtml: function (el, html) {
      if (!el) return;
      el.innerHTML = toTrustedHtml(html);
    },
    setText: function (el, text) {
      if (!el) return;
      el.textContent = String(text || "");
    },
    policies: policies,
  };

  window.__iuTrustedTypesReady = 1;
})();
