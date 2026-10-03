/**
 * InfoUzel.cz — Premium selected-services slots (fail-soft, no ad tracking).
 */
(function (global) {
  "use strict";

  var API = "https://ads.infouzel.cz/v1/public/premium/selected-services";
  var CSS_ID = "iu-premium-selected-v1-css";
  var mountSeq = 0;

  function ensureCss() {
    if (global.document.getElementById(CSS_ID)) return;
    var link = global.document.createElement("link");
    link.id = CSS_ID;
    link.rel = "stylesheet";
    link.href = "/assets/iu-premium-selected-services-v1.css?v=premium-selected-v1-20261003";
    global.document.head.appendChild(link);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function fetchJson(url) {
    return fetch(url, { credentials: "omit", mode: "cors" })
      .then(function (r) {
        return r.json();
      })
      .catch(function () {
        return null;
      });
  }

  function buildFreeSlot(slot) {
    var a = global.document.createElement("a");
    a.className = "iuPremiumSlot iuPremiumSlot--free";
    a.href = slot.order_url || "#";
    a.setAttribute("rel", "noopener");
    a.innerHTML =
      '<span class="iuPremiumSlotCta">Vaše logo zde</span><span class="iuPremiumSlotSub">' +
      esc(slot.price_label_cs || "") +
      "</span>";
    return a;
  }

  function buildSoldSlot(item) {
    var a = global.document.createElement("a");
    a.className =
      "iuPremiumSlot iuPremiumSlot--sold iuPremiumSlot--" +
      (item.creative_format === "full_bleed_banner" ? "banner" : "logo");
    a.href = item.target_url;
    a.setAttribute("rel", "noopener sponsored");
    a.setAttribute("target", "_blank");
    a.setAttribute("aria-label", item.accessible_name || "Reklamní pozice");
    if (item.creative_cdn_url) {
      var img = global.document.createElement("img");
      img.className = "iuPremiumSlotImg";
      img.src = item.creative_cdn_url;
      img.alt = item.accessible_name || "";
      img.loading = "lazy";
      img.decoding = "async";
      a.appendChild(img);
    }
    return a;
  }

  function affiliateSelectedSectionVisible() {
    try {
      var secBody =
        global.document.body && global.document.body.dataset
          ? String(global.document.body.dataset.section || "")
          : "";
      var secHtml =
        global.document.documentElement && global.document.documentElement.dataset
          ? String(global.document.documentElement.dataset.section || "")
          : "";
      if (secBody.indexOf("aff-") === 0 || secHtml.indexOf("aff-") === 0) return true;
      var cs = global.document.getElementById("iuCenterStage");
      if (cs && cs.getAttribute("data-view") === "affiliate") return true;
    } catch (_) {}
    return false;
  }

  function mountPremium(category) {
    var gridEl = global.document.getElementById("iuAffiliateGrid");
    if (!gridEl || !category) return;

    var host = global.document.getElementById("iuPremiumSelectedGrid");
    if (!host) {
      host = global.document.createElement("div");
      host.id = "iuPremiumSelectedGrid";
      host.className = "iuRadioGrid iuJRGrid iuPremiumGrid";
      host.setAttribute("role", "list");
      host.setAttribute("aria-label", "Prémiové reklamní pozice");
      gridEl.parentNode.insertBefore(host, gridEl);
    }
    while (host.firstChild) host.removeChild(host.firstChild);

    var seq = ++mountSeq;
    Promise.all([
      fetchJson(API + "/catalog?category=" + encodeURIComponent(category)),
      fetchJson(API + "/render?category=" + encodeURIComponent(category)),
    ]).then(function (pair) {
      if (seq !== mountSeq) return;
      var catalog = pair[0];
      var render = pair[1];
      if (!catalog || !catalog.slots) return;
      ensureCss();
      var activeMap = {};
      if (render && render.active) {
        for (var i = 0; i < render.active.length; i++) activeMap[render.active[i].placement_id] = render.active[i];
      }
      for (var si = 0; si < catalog.slots.length; si++) {
        var slot = catalog.slots[si];
        if (!slot.publicly_listed) continue;
        var node = activeMap[slot.placement_id] ? buildSoldSlot(activeMap[slot.placement_id]) : buildFreeSlot(slot);
        node.setAttribute("role", "listitem");
        host.appendChild(node);
      }
    });
  }

  function syncPremiumFromAffiliateView() {
    try {
      var view = global.document.getElementById("iuAffiliateView");
      if (!view || !affiliateSelectedSectionVisible()) return;
      var cat = view.getAttribute("data-aff-category");
      if (!cat) return;
      mountPremium(cat);
    } catch (_) {}
  }

  function attachPremiumSectionListeners() {
    try {
      global.document.addEventListener("iu:section-view-mounted", function (ev) {
        if (ev && ev.detail && ev.detail.key === "affiliate") syncPremiumFromAffiliateView();
      });
    } catch (_) {}
    try {
      var body = global.document.body;
      if (body) {
        new global.MutationObserver(syncPremiumFromAffiliateView).observe(body, {
          attributes: true,
          attributeFilter: ["data-section"],
        });
      }
      var html = global.document.documentElement;
      if (html) {
        new global.MutationObserver(syncPremiumFromAffiliateView).observe(html, {
          attributes: true,
          attributeFilter: ["data-section"],
        });
      }
      var center = global.document.getElementById("iuCenterStage");
      if (center) {
        new global.MutationObserver(syncPremiumFromAffiliateView).observe(center, {
          attributes: true,
          attributeFilter: ["data-view"],
        });
      }
    } catch (_) {}
  }

  if (typeof global.MutationObserver === "function") {
    try {
      var affObs = null;
      var attachAffiliateObserver = function () {
        var view = global.document.getElementById("iuAffiliateView");
        if (!view || affObs) return;
        affObs = new global.MutationObserver(syncPremiumFromAffiliateView);
        affObs.observe(view, {
          attributes: true,
          attributeFilter: ["hidden", "data-aff-category"],
        });
        syncPremiumFromAffiliateView();
      };
      var boot = function () {
        attachPremiumSectionListeners();
        attachAffiliateObserver();
        if (!affObs && global.document.body) {
          var rootObs = new global.MutationObserver(function () {
            attachAffiliateObserver();
            if (affObs) rootObs.disconnect();
          });
          rootObs.observe(global.document.body, { childList: true, subtree: true });
        }
      };
      if (global.document.readyState === "loading") {
        global.document.addEventListener("DOMContentLoaded", boot, { once: true });
      } else {
        boot();
      }
    } catch (_) {}
  }

  global.iuPremiumSelectedMount = mountPremium;
})(
  typeof window !== "undefined" ? window : globalThis
);
