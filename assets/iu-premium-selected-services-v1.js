/**
 * InfoUzel.cz — Premium selected-services (compact public display + sales panel).
 */
(function (global) {
  "use strict";

  var API = "https://ads.infouzel.cz/v1/public/premium/selected-services";
  var CSS_ID = "iu-premium-selected-v1-css";
  var CSS_HREF = "/assets/iu-premium-selected-services-v1.css?v=premium-selected-v1-20261005-p1-p8";
  var mountSeq = 0;
  var salesOpen = false;
  var lastCatalog = null;

  function ensureCss() {
    if (global.document.getElementById(CSS_ID)) return;
    var link = global.document.createElement("link");
    link.id = CSS_ID;
    link.rel = "stylesheet";
    link.href = CSS_HREF;
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

  function sortByPosition(list) {
    return list.slice().sort(function (a, b) {
      return (a.position || 0) - (b.position || 0);
    });
  }

  function ensureSalesLink() {
    var disclosure = global.document.getElementById("iuAffiliateDisclosure");
    if (!disclosure || disclosure.querySelector(".iuPremiumSalesLink")) return;
    disclosure.appendChild(global.document.createTextNode(" "));
    var btn = global.document.createElement("button");
    btn.type = "button";
    btn.className = "iuPremiumSalesLink";
    btn.id = "iuPremiumSalesToggle";
    btn.setAttribute("aria-expanded", salesOpen ? "true" : "false");
    btn.setAttribute("aria-controls", "iuPremiumSalesPanel");
    btn.textContent = "Chci zde mít vlastní tlačítko.";
    btn.addEventListener("click", toggleSalesPanel);
    disclosure.appendChild(btn);
  }

  function ensureSalesPanelHost(gridEl) {
    var panel = global.document.getElementById("iuPremiumSalesPanel");
    if (!panel) {
      panel = global.document.createElement("div");
      panel.id = "iuPremiumSalesPanel";
      panel.className = "iuPremiumSalesPanel";
      panel.hidden = true;
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-label", "Nabídka prémiových pozic");
      gridEl.parentNode.insertBefore(panel, gridEl);
    }
    return panel;
  }

  function renderSalesPanel(catalog) {
    var gridEl = global.document.getElementById("iuAffiliateGrid");
    if (!gridEl || !catalog || !catalog.slots) return;
    var panel = ensureSalesPanelHost(gridEl);
    var parts = [];
    parts.push('<div class="iuRadioGrid iuJRGrid iuPremiumGrid iuPremiumSalesGrid" role="list">');
    var slots = sortByPosition(catalog.slots);
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var posLabel = slot.position_label_cs || "P" + slot.position;
      if (slot.buyable) {
        parts.push(
          '<a class="iuPremiumSlot iuPremiumSlot--free iuPremiumSlot--sale" role="listitem" href="' +
            esc(slot.order_url || "#") +
            '" rel="noopener"><span class="iuPremiumSlotCta">P' +
            esc(String(slot.position)) +
            " — " +
            esc(posLabel) +
            '</span><span class="iuPremiumSlotSub">' +
            esc(slot.price_label_cs || "") +
            '</span><span class="iuPremiumSlotSub iuPremiumSlotBuy">Objednat</span></a>'
        );
      } else if (slot.sale_state === "live") {
        parts.push(
          '<div class="iuPremiumSlot iuPremiumSlot--held iuPremiumSlot--sale" role="listitem" aria-disabled="true"><span class="iuPremiumSlotCta">P' +
            esc(String(slot.position)) +
            " — obsazeno (aktivní reklama)</span></div>"
        );
      } else {
        parts.push(
          '<div class="iuPremiumSlot iuPremiumSlot--held iuPremiumSlot--sale" role="listitem" aria-disabled="true"><span class="iuPremiumSlotCta">P' +
            esc(String(slot.position)) +
            " — momentálně nedostupné</span></div>"
        );
      }
    }
    parts.push("</div>");
    parts.push('<p class="iuPremiumSalesHint">', esc(catalog.sales_panel_hint_cs || ""), "</p>");
    if (slots.length) {
      var hintPos = slots[0].position_explanation_cs;
      if (hintPos) parts.push('<p class="iuPremiumSalesHint muted">', esc(hintPos), "</p>");
    }
    panel.innerHTML = parts.join("");
    panel.hidden = !salesOpen;
    var toggle = global.document.getElementById("iuPremiumSalesToggle");
    if (toggle) toggle.setAttribute("aria-expanded", salesOpen ? "true" : "false");
  }

  function toggleSalesPanel() {
    salesOpen = !salesOpen;
    if (lastCatalog) renderSalesPanel(lastCatalog);
    else {
      var panel = global.document.getElementById("iuPremiumSalesPanel");
      if (panel) panel.hidden = !salesOpen;
    }
    var toggle = global.document.getElementById("iuPremiumSalesToggle");
    if (toggle) toggle.setAttribute("aria-expanded", salesOpen ? "true" : "false");
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

    ensureSalesLink();
    salesOpen = false;
    lastCatalog = null;

    var host = global.document.getElementById("iuPremiumSelectedGrid");
    if (!host) {
      host = global.document.createElement("div");
      host.id = "iuPremiumSelectedGrid";
      host.className = "iuRadioGrid iuJRGrid iuPremiumGrid";
      host.setAttribute("role", "list");
      host.setAttribute("aria-label", "Aktivní prémiové reklamy");
      gridEl.parentNode.insertBefore(host, gridEl);
    }
    while (host.firstChild) host.removeChild(host.firstChild);
    host.hidden = true;

    var panel = global.document.getElementById("iuPremiumSalesPanel");
    if (panel) {
      panel.hidden = true;
      panel.innerHTML = "";
    }

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
      lastCatalog = catalog;

      var activeList = render && render.active ? sortByPosition(render.active) : [];
      if (activeList.length) {
        host.hidden = false;
        for (var ai = 0; ai < activeList.length; ai++) {
          var node = buildSoldSlot(activeList[ai]);
          node.setAttribute("role", "listitem");
          host.appendChild(node);
        }
      } else {
        host.hidden = true;
      }

      renderSalesPanel(catalog);
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
      var restoreOrderReturnUi = function () {
        try {
          var scrollRaw = global.sessionStorage.getItem("iuPremiumOrderRestoreScroll");
          if (scrollRaw) {
            global.sessionStorage.removeItem("iuPremiumOrderRestoreScroll");
            var y = parseInt(scrollRaw, 10);
            if (!isNaN(y)) {
              global.requestAnimationFrame(function () {
                global.scrollTo(0, y);
              });
            }
          }
          var focusId = global.sessionStorage.getItem("iuPremiumOrderRestoreFocus");
          if (focusId) {
            global.sessionStorage.removeItem("iuPremiumOrderRestoreFocus");
            var el = global.document.getElementById(focusId);
            if (el && el.focus) el.focus({ preventScroll: true });
          }
        } catch (_) {}
      };
      var boot = function () {
        restoreOrderReturnUi();
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

  try {
    global.document.addEventListener(
      "click",
      function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var a = t.closest("a.iuPremiumSlot--sale[href*='premium/order']");
        if (!a) return;
        try {
          var focusId = "";
          var ae = global.document.activeElement;
          if (ae && ae.id) focusId = ae.id;
          global.sessionStorage.setItem(
            "iuPremiumOrderReturn",
            JSON.stringify({
              href: global.location.href,
              scrollY: global.scrollY,
              focusId: focusId || "iuPremiumSalesToggle",
            })
          );
        } catch (_) {}
      },
      true
    );
  } catch (_) {}

  global.iuPremiumSelectedMount = mountPremium;
})(
  typeof window !== "undefined" ? window : globalThis
);
