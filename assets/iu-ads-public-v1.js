/**
 * InfoUzel public ads inject (v1).
 * Fail-soft: empty delivery / errors → zero DOM / no placeholders / no CLS reservation.
 * Allowlisted fields only from delivery response.
 */
(function (global) {
  "use strict";

  var DELIVERY_URL =
    "https://infouzel-ads.josef-zmrhal.workers.dev/v1/public/ads/delivery";
  var ROOT_ATTR = "data-iu-ads-root";
  var AD_CLASS = "iu-ad";

  function detectDevice() {
    try {
      var w = global.innerWidth || 1024;
      var ua = (global.navigator && global.navigator.userAgent) || "";
      var uaMobile = /Mobi|Android.*Mobile|iPhone|iPod/i.test(ua);
      var uaTablet = /iPad|Android(?!.*Mobile)|Tablet/i.test(ua);
      if (uaTablet || (w >= 768 && w <= 1024 && !uaMobile)) return "tablet";
      if (uaMobile || w < 768) return "mobile";
      return "pc";
    } catch (_) {
      return "pc";
    }
  }

  function detectSection() {
    try {
      var params = new URLSearchParams(global.location.search || "");
      var section = params.get("section");
      if (section && /^[a-z0-9_-]{1,64}$/i.test(section)) return section;
    } catch (_) {}
    return "";
  }

  function ensureStyle() {
    if (global.document.getElementById("iu-ads-public-v1-css")) return;
    var link = global.document.createElement("link");
    link.id = "iu-ads-public-v1-css";
    link.rel = "stylesheet";
    link.href = "/assets/iu-ads-public-v1.css?v=ads-public-inject-v1-20260724";
    global.document.head.appendChild(link);
  }

  function clearAds(root) {
    if (!root) return;
    while (root.firstChild) root.removeChild(root.firstChild);
    root.style.display = "none";
    root.setAttribute("aria-hidden", "true");
  }

  function pickRoot() {
    var existing = global.document.querySelector("[" + ROOT_ATTR + "]");
    if (existing) return existing;
    var host = global.document.createElement("div");
    host.setAttribute(ROOT_ATTR, "1");
    host.className = "iu-ads-root";
    host.style.display = "none";
    host.setAttribute("aria-hidden", "true");
    var anchor =
      global.document.getElementById("centerColumn") ||
      global.document.getElementById("main") ||
      global.document.body;
    if (!anchor) return null;
    if (anchor.firstChild) anchor.insertBefore(host, anchor.firstChild);
    else anchor.appendChild(host);
    return host;
  }

  function isHttpUrl(u) {
    return typeof u === "string" && /^https?:\/\//i.test(u);
  }

  function renderAds(root, ads) {
    clearAds(root);
    if (!ads || !ads.length) return;
    ensureStyle();
    root.style.display = "";
    root.removeAttribute("aria-hidden");
    for (var i = 0; i < ads.length; i++) {
      var ad = ads[i];
      if (!ad || typeof ad !== "object") continue;
      var label = typeof ad.label === "string" ? ad.label : "Reklama";
      var target = isHttpUrl(ad.target_url) ? ad.target_url : null;
      var creative = ad.creative && typeof ad.creative === "object" ? ad.creative : null;
      var cdn = creative && isHttpUrl(creative.cdn_url) ? creative.cdn_url : null;
      if (!target || !cdn) continue;

      var wrap = global.document.createElement("aside");
      wrap.className = AD_CLASS;
      wrap.setAttribute("data-iu-ad", "1");
      if (ad.placement_id) wrap.setAttribute("data-placement", String(ad.placement_id));

      var badge = global.document.createElement("span");
      badge.className = "iu-ad__label";
      badge.textContent = label;

      var link = global.document.createElement("a");
      link.className = "iu-ad__link";
      link.href = target;
      link.rel = "noopener noreferrer sponsored";
      link.target = "_blank";

      var img = global.document.createElement("img");
      img.className = "iu-ad__img";
      img.src = cdn;
      img.alt = label;
      img.loading = "lazy";
      img.decoding = "async";
      if (creative.width) img.width = Number(creative.width) || undefined;
      if (creative.height) img.height = Number(creative.height) || undefined;

      link.appendChild(img);
      wrap.appendChild(badge);
      wrap.appendChild(link);
      root.appendChild(wrap);
    }
    if (!root.firstChild) clearAds(root);
  }

  function run() {
    var root = pickRoot();
    if (!root) return;
    var device = detectDevice();
    var section = detectSection();
    var url =
      DELIVERY_URL +
      "?device=" +
      encodeURIComponent(device) +
      (section ? "&section=" + encodeURIComponent(section) : "");

    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer =
      ctrl &&
      global.setTimeout(function () {
        try {
          ctrl.abort();
        } catch (_) {}
      }, 6000);

    fetch(url, {
      method: "GET",
      credentials: "omit",
      mode: "cors",
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        if (!res.ok) throw new Error("delivery_http");
        return res.json();
      })
      .then(function (body) {
        if (!body || body.enabled === false || !Array.isArray(body.ads) || body.ads.length === 0) {
          clearAds(root);
          return;
        }
        renderAds(root, body.ads);
      })
      .catch(function () {
        clearAds(root);
      })
      .then(function () {
        if (timer) global.clearTimeout(timer);
      });
  }

  /** Test hooks — used by node/unit guards; no network. */
  global.IUAdsPublicV1 = {
    detectDevice: detectDevice,
    clearAds: clearAds,
    renderAds: renderAds,
    AD_CLASS: AD_CLASS,
  };

  if (global.document && global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})(typeof window !== "undefined" ? window : globalThis);
