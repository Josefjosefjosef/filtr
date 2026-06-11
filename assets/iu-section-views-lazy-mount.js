/**
 * infoUzel.cz — Section views LAZY MOUNT (P1 performance fix #2)
 *
 * The non-feed section views (jr, tvprogram, travel, mapy, radio, tvonline)
 * ship inside inert <template id="iuLazyViewTpl-KEY"> elements and are mounted
 * into #iuCenterStage only when their section is first opened.
 *
 * SEO: each view's SEO block stays OUTSIDE the template in a hidden stub
 * (<div data-iu-seo-stub="KEY" hidden>), so it remains part of the initially
 * rendered DOM exactly like before (hidden at start). On mount the stub
 * content is moved back to its original position inside the view
 * (marker: <div data-iu-seo-slot="KEY">).
 *
 * Integration points (app.js): showView() calls ensure(key) before flipping
 * data-view; mobile focus uses hasTarget()/ensureTarget(); radio/tvprogram
 * boot renderers re-run on the "iu:section-view-mounted" event.
 */
(function iuSectionViewsLazyMount() {
  "use strict";

  if (window.__iuSectionViewsLazyMount) return;

  var KEYS = ["jr", "tvprogram", "travel", "mapy", "radio", "tvonline", "pocasi"];
  var SELECTOR_TO_KEY = {
    "#iuJrEmptyView": "jr",
    "#iuTvProgramView": "tvprogram",
    "#iuTravelView": "travel",
    "#iuMapyView": "mapy",
    "#iuRadioView": "radio",
    "#iuTvOnlineView": "tvonline",
    "#iuWeatherView": "pocasi",
  };

  function getTpl(key) {
    return document.getElementById("iuLazyViewTpl-" + key);
  }

  function ensure(key) {
    var k = String(key || "").trim().toLowerCase();
    if (KEYS.indexOf(k) === -1) return false;
    var tpl = getTpl(k);
    if (!tpl || !tpl.content) return false;
    try {
      tpl.parentNode.insertBefore(tpl.content.cloneNode(true), tpl);
      tpl.parentNode.removeChild(tpl);
    } catch (_) {
      return false;
    }
    try {
      /* A view may have several SEO stubs: exact key or "key:suffix" pairs. */
      document.querySelectorAll("[data-iu-seo-slot]").forEach(function (slot) {
        var sk = String(slot.getAttribute("data-iu-seo-slot") || "");
        if (sk !== k && sk.indexOf(k + ":") !== 0) return;
        var stub = document.querySelector('[data-iu-seo-stub="' + sk + '"]');
        if (stub) {
          while (stub.firstChild) slot.parentNode.insertBefore(stub.firstChild, slot);
          stub.parentNode.removeChild(stub);
        }
        slot.parentNode.removeChild(slot);
      });
    } catch (_) {}
    try {
      document.dispatchEvent(new CustomEvent("iu:section-view-mounted", { detail: { key: k } }));
    } catch (_) {}
    return true;
  }

  function ensureTarget(sel) {
    var k = SELECTOR_TO_KEY[String(sel || "").trim()];
    if (k) ensure(k);
  }

  function hasTarget(sel) {
    var clean = String(sel || "").trim();
    var k = SELECTOR_TO_KEY[clean];
    if (!k) return false;
    try {
      return !!(document.querySelector(clean) || getTpl(k));
    } catch (_) {
      return false;
    }
  }

  window.__iuSectionViewsLazyMount = {
    ensure: ensure,
    ensureTarget: ensureTarget,
    hasTarget: hasTarget,
    keys: KEYS.slice(),
  };

  // Deep links (?section=...) — pre-mount before app.js boots so the initial
  // section apply, boot renderers and search engine rendering see the full view.
  try {
    var p = new URLSearchParams(window.location.search || "");
    var sec = String(p.get("section") || "").trim().toLowerCase();
    if (sec === "tv") sec = "tvonline";
    if (sec === "maps") sec = "mapy";
    if (sec === "travel") {
      var mode = String(p.get("mode") || "guide").trim().toLowerCase();
      if (mode !== "media") ensure("travel");
    } else if (KEYS.indexOf(sec) !== -1) {
      ensure(sec);
    }
  } catch (_) {}
})();
