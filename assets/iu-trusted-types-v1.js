/**
 * Trusted Types — allowlist HTML sanitizer + sink patches.
 * Policies: iu-default (DOM allowlist), iu-escape (text only).
 *
 * XSS-TT-01: sanitizeHtml uses browser DOMParser + element/attribute allowlist
 * (deny-by-default). Must remain safe on Firefox where Trusted Types is absent.
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

  // Capture natives BEFORE sink patches — sanitizeHtml must not re-enter TT/patched setters.
  var nativeInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  var nativeSetAttribute = Element.prototype.setAttribute;
  var nativeRemoveAttribute = Element.prototype.removeAttribute;
  var nativeAppendChild = Node.prototype.appendChild;
  var nativeInsertBefore = Node.prototype.insertBefore;
  var nativeRemoveChild = Node.prototype.removeChild;

  /** Content + first-party UI templates that flow through patched innerHTML. */
  var ALLOWED_TAGS = {
    // structure / text
    DIV: 1,
    SPAN: 1,
    P: 1,
    BR: 1,
    HR: 1,
    SECTION: 1,
    ARTICLE: 1,
    HEADER: 1,
    FOOTER: 1,
    MAIN: 1,
    NAV: 1,
    ASIDE: 1,
    H1: 1,
    H2: 1,
    H3: 1,
    H4: 1,
    H5: 1,
    H6: 1,
    STRONG: 1,
    B: 1,
    EM: 1,
    I: 1,
    U: 1,
    S: 1,
    SMALL: 1,
    MARK: 1,
    SUB: 1,
    SUP: 1,
    ABBR: 1,
    CODE: 1,
    PRE: 1,
    BLOCKQUOTE: 1,
    Q: 1,
    CITE: 1,
    UL: 1,
    OL: 1,
    LI: 1,
    DL: 1,
    DT: 1,
    DD: 1,
    TABLE: 1,
    THEAD: 1,
    TBODY: 1,
    TFOOT: 1,
    TR: 1,
    TH: 1,
    TD: 1,
    CAPTION: 1,
    COLGROUP: 1,
    COL: 1,
    A: 1,
    IMG: 1,
    FIGURE: 1,
    FIGCAPTION: 1,
    TIME: 1,
    // first-party interactive UI (finance / legal / notes / filters)
    BUTTON: 1,
    LABEL: 1,
    INPUT: 1,
    TEXTAREA: 1,
    SELECT: 1,
    OPTION: 1,
    OPTGROUP: 1,
    FIELDSET: 1,
    LEGEND: 1,
    FORM: 1,
    PROGRESS: 1,
    METER: 1,
    OUTPUT: 1,
    DETAILS: 1,
    SUMMARY: 1,
    // YouTube embeds in first-party templates (src host allowlisted)
    IFRAME: 1,
    // first-party iconography (no foreignObject / animate / script)
    SVG: 1,
    PATH: 1,
    G: 1,
    CIRCLE: 1,
    RECT: 1,
    LINE: 1,
    POLYLINE: 1,
    POLYGON: 1,
    ELLIPSE: 1,
    USE: 1,
    DEFS: 1,
    SYMBOL: 1,
    TITLE: 1,
    DESC: 1,
  };

  var GLOBAL_ATTRS = {
    class: 1,
    id: 1,
    title: 1,
    lang: 1,
    dir: 1,
    hidden: 1,
    tabindex: 1,
    role: 1,
    // First-party UI templates set layout via inline style through patched innerHTML.
    // Values are filtered by sanitizeStyleValue (not raw passthrough).
    style: 1,
  };

  /**
   * Minimal CSS defense for first-party style attrs (not a full CSS sanitizer).
   * Reject known scriptable / binding vectors; allow ordinary layout declarations.
   */
  function sanitizeStyleValue(raw) {
    var s = String(raw == null ? "" : raw);
    if (!s) return "";
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s)) return null;
    if (/expression\s*\(|-moz-binding|@import|behavior\s*:|javascript\s*:|vbscript\s*:|mocha\s*:/i.test(s)) {
      return null;
    }
    if (/url\s*\(\s*['"]?\s*(?:javascript|vbscript|data)\s*:/i.test(s)) return null;
    return s;
  }

  var TAG_ATTRS = {
    A: { href: 1, target: 1, rel: 1, download: 1 },
    IMG: { src: 1, alt: 1, width: 1, height: 1, loading: 1, decoding: 1 },
    IFRAME: {
      src: 1,
      title: 1,
      width: 1,
      height: 1,
      loading: 1,
      allow: 1,
      allowfullscreen: 1,
      frameborder: 1,
      referrerpolicy: 1,
    },
    BUTTON: { type: 1, disabled: 1, name: 1, value: 1 },
    INPUT: {
      type: 1,
      name: 1,
      value: 1,
      placeholder: 1,
      disabled: 1,
      readonly: 1,
      checked: 1,
      required: 1,
      min: 1,
      max: 1,
      step: 1,
      minlength: 1,
      maxlength: 1,
      pattern: 1,
      autocomplete: 1,
      inputmode: 1,
    },
    TEXTAREA: {
      name: 1,
      rows: 1,
      cols: 1,
      placeholder: 1,
      disabled: 1,
      readonly: 1,
      required: 1,
      maxlength: 1,
      autocomplete: 1,
    },
    SELECT: { name: 1, disabled: 1, required: 1, multiple: 1 },
    OPTION: { value: 1, selected: 1, disabled: 1, label: 1 },
    OPTGROUP: { label: 1, disabled: 1 },
    LABEL: { for: 1 },
    FORM: { action: 1, method: 1, novalidate: 1, autocomplete: 1 },
    TH: { colspan: 1, rowspan: 1, scope: 1 },
    TD: { colspan: 1, rowspan: 1 },
    COL: { span: 1 },
    COLGROUP: { span: 1 },
    TIME: { datetime: 1 },
    PROGRESS: { value: 1, max: 1 },
    METER: { value: 1, min: 1, max: 1, low: 1, high: 1, optimum: 1 },
    DETAILS: { open: 1 },
    SVG: {
      viewBox: 1,
      width: 1,
      height: 1,
      fill: 1,
      stroke: 1,
      xmlns: 1,
      focusable: 1,
      "aria-hidden": 1,
    },
    PATH: {
      d: 1,
      fill: 1,
      stroke: 1,
      "stroke-width": 1,
      "stroke-linecap": 1,
      "stroke-linejoin": 1,
      "fill-rule": 1,
      transform: 1,
    },
    G: { fill: 1, stroke: 1, transform: 1, "stroke-width": 1 },
    CIRCLE: { cx: 1, cy: 1, r: 1, fill: 1, stroke: 1, "stroke-width": 1 },
    RECT: {
      x: 1,
      y: 1,
      width: 1,
      height: 1,
      rx: 1,
      ry: 1,
      fill: 1,
      stroke: 1,
      "stroke-width": 1,
    },
    LINE: { x1: 1, y1: 1, x2: 1, y2: 1, stroke: 1, "stroke-width": 1 },
    POLYLINE: { points: 1, fill: 1, stroke: 1, "stroke-width": 1 },
    POLYGON: { points: 1, fill: 1, stroke: 1, "stroke-width": 1 },
    ELLIPSE: { cx: 1, cy: 1, rx: 1, ry: 1, fill: 1, stroke: 1 },
    USE: { href: 1, "xlink:href": 1, width: 1, height: 1, x: 1, y: 1 },
    SYMBOL: { viewBox: 1, id: 1 },
  };

  var SAFE_INPUT_TYPES = {
    text: 1,
    search: 1,
    email: 1,
    tel: 1,
    url: 1,
    password: 1,
    number: 1,
    date: 1,
    datetime: 1,
    "datetime-local": 1,
    month: 1,
    week: 1,
    time: 1,
    checkbox: 1,
    radio: 1,
    range: 1,
    color: 1,
    file: 1,
    hidden: 1,
    submit: 1,
    reset: 1,
    button: 1,
  };

  var YT_HOSTS = {
    "www.youtube.com": 1,
    "youtube.com": 1,
    "www.youtube-nocookie.com": 1,
    "youtube-nocookie.com": 1,
  };

  function isAriaAttr(name) {
    return name.length > 5 && name.slice(0, 5) === "aria-";
  }

  function isDataAttr(name) {
    return name.length > 5 && name.slice(0, 5) === "data-";
  }

  function isEventAttr(name) {
    return name.length > 2 && name.slice(0, 2) === "on";
  }

  function parseUrlSafe(raw) {
    var s = String(raw || "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
    if (!s) return null;
    try {
      return new URL(s, location.href);
    } catch (_) {
      return null;
    }
  }

  function isSafeHttpUrl(raw) {
    var u = parseUrlSafe(raw);
    if (!u) return false;
    return u.protocol === "https:" || u.protocol === "http:";
  }

  function isSafeHref(raw) {
    var s = String(raw || "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
    if (!s) return false;
    if (s.charAt(0) === "#") return true;
    if (s.charAt(0) === "/" && s.charAt(1) !== "/") return true;
    if (s.indexOf("./") === 0 || s.indexOf("../") === 0) return true;
    var u = parseUrlSafe(s);
    if (!u) return false;
    if (u.protocol === "https:" || u.protocol === "http:") return true;
    if (u.protocol === "mailto:" || u.protocol === "tel:") return true;
    return false;
  }

  function isSafeImgSrc(raw) {
    var s = String(raw || "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
    if (!s) return false;
    if (s.charAt(0) === "/" && s.charAt(1) !== "/") return true;
    if (s.indexOf("./") === 0 || s.indexOf("../") === 0) return true;
    // No data:image/svg+xml — SVG-in-data can carry script/event payloads.
    if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(s)) return true;
    return isSafeHttpUrl(s);
  }

  function isSafeIframeSrc(raw) {
    var u = parseUrlSafe(raw);
    if (!u || u.protocol !== "https:") return false;
    var host = String(u.hostname || "").toLowerCase();
    return !!YT_HOSTS[host];
  }

  function isSafeSvgHref(raw) {
    var s = String(raw || "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
    // Same-document symbol references only (first-party icon sprites).
    return s.charAt(0) === "#" && s.length > 1 && s.indexOf(":") === -1;
  }

  function isSafeFormAction(raw) {
    var s = String(raw || "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
    if (!s || s === "#") return true;
    if (s.charAt(0) === "/" && s.charAt(1) !== "/") return true;
    return isSafeHttpUrl(s);
  }

  function attrAllowedForTag(tag, attr) {
    if (GLOBAL_ATTRS[attr]) return true;
    if (isAriaAttr(attr)) return true;
    if (isDataAttr(attr)) return true;
    // DOM clobbering: name on media/forms can overwrite document.* named properties.
    if (attr === "name" && tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA" && tag !== "BUTTON" && tag !== "OPTION" && tag !== "FIELDSET" && tag !== "OUTPUT") {
      return false;
    }
    var map = TAG_ATTRS[tag];
    return !!(map && map[attr]);
  }

  function sanitizeAttributeValue(tag, attr, value) {
    var v = String(value == null ? "" : value);
    if (attr === "href") {
      if (tag === "USE") return isSafeSvgHref(v) ? v : null;
      return isSafeHref(v) ? v : null;
    }
    if (attr === "xlink:href") {
      if (tag === "USE") return isSafeSvgHref(v) ? v : null;
      return null;
    }
    if (attr === "src") {
      if (tag === "IMG") return isSafeImgSrc(v) ? v : null;
      if (tag === "IFRAME") return isSafeIframeSrc(v) ? v : null;
      return null;
    }
    if (attr === "action" || attr === "formaction") {
      return isSafeFormAction(v) ? v : null;
    }
    if (attr === "type" && tag === "INPUT") {
      var t = v.toLowerCase();
      return SAFE_INPUT_TYPES[t] ? t : "text";
    }
    if (attr === "type" && tag === "BUTTON") {
      var bt = v.toLowerCase();
      return bt === "submit" || bt === "reset" || bt === "button" ? bt : "button";
    }
    if (attr === "target") {
      return v === "_blank" || v === "_self" ? v : null;
    }
    if (attr === "method") {
      var m = v.toLowerCase();
      return m === "get" || m === "post" ? m : "get";
    }
    if (attr === "style") return sanitizeStyleValue(v);
    // Never allow srcdoc / poster on HTML sinks
    if (attr === "srcdoc" || attr === "poster") return null;
    return v;
  }

  function sanitizeElement(el) {
    var tag = String(el.tagName || "").toUpperCase();
    if (!ALLOWED_TAGS[tag]) {
      var parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) nativeInsertBefore.call(parent, el.firstChild, el);
      nativeRemoveChild.call(parent, el);
      return;
    }

    var names = el.getAttributeNames ? el.getAttributeNames() : [];
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i];
      var lower = String(name).toLowerCase();
      if (isEventAttr(lower) || lower === "srcdoc" || lower === "poster") {
        nativeRemoveAttribute.call(el, name);
        continue;
      }
      if (!attrAllowedForTag(tag, lower)) {
        nativeRemoveAttribute.call(el, name);
        continue;
      }
      var cleaned = sanitizeAttributeValue(tag, lower, el.getAttribute(name));
      if (cleaned == null) nativeRemoveAttribute.call(el, name);
      else if (cleaned !== el.getAttribute(name)) nativeSetAttribute.call(el, name, cleaned);
    }

    ensureSafeRel(el);

    var kids = Array.prototype.slice.call(el.childNodes || []);
    for (var k = 0; k < kids.length; k += 1) {
      sanitizeNode(kids[k]);
    }
  }

  function sanitizeNode(node) {
    if (!node) return;
    var type = node.nodeType;
    if (type === 3 || type === 4) return;
    if (type === 8) {
      if (node.parentNode) nativeRemoveChild.call(node.parentNode, node);
      return;
    }
    if (type === 1) {
      sanitizeElement(node);
      return;
    }
    if (node.parentNode) nativeRemoveChild.call(node.parentNode, node);
  }

  function ensureSafeRel(el) {
    if (String(el.tagName || "").toUpperCase() !== "A") return;
    if (el.getAttribute("target") !== "_blank") return;
    var rel = String(el.getAttribute("rel") || "").toLowerCase();
    var parts = {};
    rel.split(/\s+/).forEach(function (p) {
      if (p) parts[p] = 1;
    });
    parts.noopener = 1;
    parts.noreferrer = 1;
    nativeSetAttribute.call(el, "rel", Object.keys(parts).join(" "));
  }

  var policies = {
    default: null,
    escape: null,
    parser: null,
  };

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

  /**
   * Allowlist sanitize via DOMParser.
   * Under TT, parseFromString(text/html) requires TrustedHTML — iu-tt-parser wraps
   * parser input only; returned markup is always allowlist-filtered.
   */
  function sanitizeHtml(html) {
    var raw = String(html == null ? "" : html);
    if (!raw) return "";
    if (typeof DOMParser !== "function") return escapeHtml(raw);
    if (!nativeInnerHTML || typeof nativeInnerHTML.get !== "function") return escapeHtml(raw);

    var wrapped = "<!DOCTYPE html><html><head></head><body>" + raw + "</body></html>";
    var parsed;
    try {
      var parserInput = policies.parser ? policies.parser.createHTML(wrapped) : wrapped;
      parsed = new DOMParser().parseFromString(parserInput, "text/html");
    } catch (_) {
      return escapeHtml(raw);
    }
    var body = parsed && parsed.body;
    if (!body) return "";

    var kids = Array.prototype.slice.call(body.childNodes || []);
    for (var i = 0; i < kids.length; i += 1) sanitizeNode(kids[i]);

    try {
      return nativeInnerHTML.get.call(body);
    } catch (_) {
      return "";
    }
  }

  if (window.trustedTypes && typeof window.trustedTypes.createPolicy === "function") {
    try {
      // Parser-input only. Never assign to DOM sinks.
      policies.parser = window.trustedTypes.createPolicy("iu-tt-parser", {
        createHTML: function (s) {
          return String(s == null ? "" : s);
        },
      });
    } catch (_) {}
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
    if (!isAllowedScriptUrl(url)) throw new TypeError("IU_TT_SCRIPT_URL_BLOCKED");
    return String(url || "");
  }

  function trustScriptElement(node) {
    if (!node) return;
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
      if (String(name).toLowerCase() === "src" && this.tagName === "SCRIPT" && typeof value === "string") {
        value = toTrustedScriptUrl(value);
      }
      return origSetAttr.call(this, name, value);
    };
  }

  function patchWorkerConstructor() {
    if (typeof Worker !== "function") return;
    var OrigWorker = Worker;
    window.Worker = function (url, options) {
      if (typeof url === "string") url = toTrustedScriptUrl(url);
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
        if (typeof value === "string") value = toTrustedScriptUrl(value);
        desc.set.call(this, value);
      },
    });
  }

  function patchServiceWorkerRegister() {
    if (!navigator.serviceWorker || typeof navigator.serviceWorker.register !== "function") return;
    var orig = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = function (url, options) {
      if (typeof url === "string") {
        url = policies.default ? policies.default.createScriptURL(url) : toTrustedScriptUrl(url);
      }
      return orig(url, options);
    };
  }

  function patchSharedWorkerConstructor() {
    if (typeof SharedWorker !== "function") return;
    var OrigSharedWorker = SharedWorker;
    window.SharedWorker = function (url, options) {
      if (typeof url === "string") url = toTrustedScriptUrl(url);
      return new OrigSharedWorker(url, options);
    };
    window.SharedWorker.prototype = OrigSharedWorker.prototype;
  }

  // Always patch sinks so Firefox (no TT) still gets allowlist sanitization.
  try {
    patchSetter(Element.prototype, "innerHTML");
    patchSetter(Element.prototype, "outerHTML");
    patchInsertAdjacentHTML();
    patchScriptSrc();
    patchDomInsertion();
    patchWorkerConstructor();
    patchSharedWorkerConstructor();
    patchServiceWorkerRegister();
  } catch (_) {}

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
    model: "dom-allowlist-v1",
  };

  window.__iuTrustedTypesReady = 1;
})();
