/**
 * CJ Phase 2C / 3B — coupon + offer + product cards.
 * Production render requires offers-public JSON with liveEnabled===true AND publicationReady items.
 * Localhost preview (?iuCjPreview=1) remains for fixtures only.
 */
(function iuAffiliatePhase2Offers() {
  "use strict";
  if (window.__iuAffiliatePhase2OffersBooted) return;
  window.__iuAffiliatePhase2OffersBooted = true;

  var PREVIEW_JSON_LOCAL = "/assets/cj-phase2-preview-autohotarek.local-dev.json";
  var PREVIEW_JSON_STUB = "/assets/cj-phase2-preview-autohotarek.json";
  var OFFERS_PUBLIC_PATH = "/projects/data/iu-affiliate-cj-offers-public-v1.json";
  var CSS_HREF = "/assets/iu-affiliate-phase2-offers-v1.css?v=cj-phase2c-offers-v3";

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isLocalDevHost() {
    try {
      var h = String(location.hostname || "").toLowerCase();
      if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return true;
      if (h.endsWith(".local")) return true;
      return false;
    } catch (_) {
      return false;
    }
  }

  function previewEnabled() {
    if (!isLocalDevHost()) return false;
    try {
      var p = new URLSearchParams(location.search || "");
      return p.get("iuCjPreview") === "1";
    } catch (_) {
      return false;
    }
  }

  function loadCssOnce() {
    if (document.querySelector('link[data-iu-aff-phase2-css="1"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CSS_HREF;
    link.setAttribute("data-iu-aff-phase2-css", "1");
    document.head.appendChild(link);
  }

  function ensureMount() {
    var mount = document.getElementById("iuAffiliatePhase2Offers");
    if (mount) return mount;
    var view = document.getElementById("iuAffiliateView");
    if (!view) return null;
    mount = document.createElement("div");
    mount.id = "iuAffiliatePhase2Offers";
    mount.className = "iuAffiliatePhase2Offers";
    mount.hidden = true;
    mount.setAttribute("data-iu-aff-phase2-mount", "1");
    var grid = document.getElementById("iuAffiliateGrid");
    if (grid && grid.parentNode === view) {
      if (grid.nextSibling) view.insertBefore(mount, grid.nextSibling);
      else view.appendChild(mount);
    } else {
      view.appendChild(mount);
    }
    return mount;
  }

  function clearMount(mount) {
    if (!mount) return;
    mount.innerHTML = "";
    mount.hidden = true;
  }

  function copyText(txt, btn) {
    if (!txt) return;
    var label = btn ? btn.textContent : "";
    function done() {
      if (!btn) return;
      btn.textContent = "Zkopírováno";
      setTimeout(function () {
        btn.textContent = label || "Kopírovat kód";
      }, 2000);
    }
    function fallback() {
      try {
        var ta = document.createElement("textarea");
        ta.value = txt;
        ta.setAttribute("readonly", "readonly");
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        done();
      } catch (_) {}
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done).catch(fallback);
      } else {
        fallback();
      }
    } catch (_) {
      fallback();
    }
  }

  function partnerHeaderHtml(name, logoUrl) {
    var parts = ['<div class="iuAffiliatePhase2Offers__partner">'];
    if (logoUrl && /^https:\/\//i.test(String(logoUrl))) {
      parts.push(
        '<img class="iuAffiliatePhase2Offers__logo" src="' +
          escapeHtml(logoUrl) +
          '" alt="" loading="lazy" decoding="async" />'
      );
    }
    parts.push(escapeHtml(name || "Partner"));
    parts.push("</div>");
    return parts.join("");
  }

  function renderCoupon(host, coupon, opts) {
    if (!coupon) return;
    var preview = opts && opts.preview;
    if (!preview && coupon.publicationReady !== true) return;
    if (!preview && !coupon.couponCode) return;
    if (preview && !coupon.couponCode) return;

    var parts = [
      '<div class="iuAffiliatePhase2Offers__coupon" role="region" aria-label="Slevový kupón">',
      partnerHeaderHtml(coupon.partnerName, coupon.partnerLogoUrl),
      '<div class="iuAffiliatePhase2Offers__codeRow">',
      "<strong>",
      escapeHtml(coupon.couponCode),
      "</strong>",
      '<button type="button" class="iuAffiliatePhase2Offers__copy iuRadioChip" data-iu-copy-code="1">Kopírovat kód</button>',
      "</div>",
    ];
    if (coupon.title) {
      parts.push(
        '<div class="iuAffiliatePhase2Offers__meta">' + escapeHtml(coupon.title) + "</div>"
      );
    }
    if (coupon.customerDiscount) {
      parts.push(
        '<div class="iuAffiliatePhase2Offers__discount">Ověřená sleva: ' +
          escapeHtml(coupon.customerDiscount) +
          "</div>"
      );
    }
    if (coupon.validFrom || coupon.validTo) {
      parts.push(
        '<div class="iuAffiliatePhase2Offers__meta">Platnost: ' +
          escapeHtml([coupon.validFrom, coupon.validTo].filter(Boolean).join(" – ")) +
          "</div>"
      );
    }
    if (coupon.conditionsSummary) {
      parts.push(
        '<div class="iuAffiliatePhase2Offers__meta iuAffiliatePhase2Offers__conditions">' +
          escapeHtml(coupon.conditionsSummary) +
          "</div>"
      );
    }
    if (coupon.affiliateUrl && (coupon.publicationReady || preview)) {
      if (coupon.publicationReady) {
        parts.push(
          '<a class="iuAffiliatePhase2Offers__cta" href="' +
            escapeHtml(coupon.affiliateUrl) +
            '" rel="sponsored noopener" target="_blank">Zobrazit nabídku</a>'
        );
      } else if (preview) {
        parts.push(
          '<div class="iuAffiliatePhase2Offers__meta">Affiliate odkaz zatím neověřen pro publikaci (náhled).</div>'
        );
      }
    }
    if (preview && !coupon.publicationReady && coupon.blockers && coupon.blockers.length) {
      parts.push(
        '<div class="iuAffiliatePhase2Offers__blockers" role="status">' +
          escapeHtml(coupon.blockers.slice(0, 3).join("; ")) +
          "</div>"
      );
    }
    parts.push("</div>");
    host.insertAdjacentHTML("beforeend", parts.join(""));
    var copyBtn = host.querySelector("[data-iu-copy-code=\"1\"]");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        copyText(coupon.couponCode, copyBtn);
      });
    }
  }

  function renderAction(host, action, opts) {
    if (!action) return;
    var preview = opts && opts.preview;
    if (!preview && action.publicationReady !== true) return;
    var parts = [
      '<div class="iuAffiliatePhase2Offers__action" role="region" aria-label="Nabídka bez kódu">',
      partnerHeaderHtml(action.partnerName, action.partnerLogoUrl),
    ];
    if (action.title) {
      parts.push(
        '<div class="iuAffiliatePhase2Offers__cardTitle">' + escapeHtml(action.title) + "</div>"
      );
    }
    if (action.validFrom || action.validTo) {
      parts.push(
        '<div class="iuAffiliatePhase2Offers__meta">Platnost: ' +
          escapeHtml([action.validFrom, action.validTo].filter(Boolean).join(" – ")) +
          "</div>"
      );
    }
    if (action.conditionsSummary) {
      parts.push(
        '<div class="iuAffiliatePhase2Offers__meta iuAffiliatePhase2Offers__conditions">' +
          escapeHtml(action.conditionsSummary) +
          "</div>"
      );
    }
    if (action.affiliateUrl && action.publicationReady) {
      parts.push(
        '<a class="iuAffiliatePhase2Offers__cta" href="' +
          escapeHtml(action.affiliateUrl) +
          '" rel="sponsored noopener" target="_blank">Zobrazit nabídku</a>'
      );
    } else if (preview) {
      parts.push(
        '<div class="iuAffiliatePhase2Offers__meta">Nabídka bez kódu — publikace zatím neověřena (náhled).</div>'
      );
    }
    parts.push("</div>");
    host.insertAdjacentHTML("beforeend", parts.join(""));
  }

  function renderProducts(host, cards, display, opts) {
    var preview = opts && opts.preview;
    var list = (cards || []).filter(function (c) {
      if (!c) return false;
      if (preview) return true;
      return c.publicationReady === true;
    });
    if (!list.length) return;
    var visible = (display && display.defaultVisibleProducts) || 3;
    var grid = document.createElement("div");
    grid.className = "iuAffiliatePhase2Offers__grid";
    grid.setAttribute("role", "list");
    host.appendChild(grid);

    function paint(limit) {
      grid.innerHTML = "";
      for (var i = 0; i < Math.min(limit, list.length); i++) {
        var c = list[i];
        var el = document.createElement("article");
        el.className = "iuAffiliatePhase2Offers__card";
        el.setAttribute("role", "listitem");
        var img =
          c.imageUrl && /^https:\/\//i.test(String(c.imageUrl)) && (c.publicationReady || preview)
            ? '<img class="iuAffiliatePhase2Offers__img" src="' +
              escapeHtml(c.imageUrl) +
              '" alt="" loading="lazy" decoding="async" />'
            : "";
        var brand = c.brand
          ? '<div class="iuAffiliatePhase2Offers__brand">' + escapeHtml(c.brand) + "</div>"
          : "";
        var price = c.currentPrice
          ? '<div class="iuAffiliatePhase2Offers__price">' + escapeHtml(String(c.currentPrice)) + "</div>"
          : "";
        var orig = c.originalPrice
          ? '<div class="iuAffiliatePhase2Offers__meta iuAffiliatePhase2Offers__priceWas">Původně: ' +
            escapeHtml(String(c.originalPrice)) +
            "</div>"
          : "";
        var disc = c.discountLabel || c.savingsLabel
          ? '<div class="iuAffiliatePhase2Offers__discount">' +
            escapeHtml(c.discountLabel || c.savingsLabel) +
            "</div>"
          : "";
        var desc = c.description
          ? '<div class="iuAffiliatePhase2Offers__meta">' + escapeHtml(c.description) + "</div>"
          : "";
        var valid = c.validTo || c.validityTo
          ? '<div class="iuAffiliatePhase2Offers__meta">Platnost do: ' +
            escapeHtml(c.validTo || c.validityTo) +
            "</div>"
          : "";
        var partner = c.partnerName
          ? '<div class="iuAffiliatePhase2Offers__meta">' + escapeHtml(c.partnerName) + "</div>"
          : "";
        var ctaLabel = c.ctaLabel || "Zobrazit nabídku";
        var link =
          c.affiliateUrl && c.publicationReady
            ? '<a class="iuAffiliatePhase2Offers__cardLink" href="' +
              escapeHtml(c.affiliateUrl) +
              '" rel="sponsored noopener" target="_blank">' +
              escapeHtml(ctaLabel) +
              "</a>"
            : "";
        el.innerHTML =
          img +
          brand +
          '<h3 class="iuAffiliatePhase2Offers__cardTitle">' +
          escapeHtml(c.title || "") +
          "</h3>" +
          partner +
          desc +
          price +
          orig +
          disc +
          valid +
          link;
        grid.appendChild(el);
      }
    }
    paint(visible);
    if (list.length > visible) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "iuAffiliatePhase2Offers__more iuRadioChip";
      btn.textContent = (display && display.showMoreLabel) || "Zobrazit další";
      var expanded = false;
      btn.addEventListener("click", function () {
        expanded = !expanded;
        paint(expanded ? list.length : visible);
        btn.textContent = expanded
          ? "Skrýt další"
          : (display && display.showMoreLabel) || "Zobrazit další";
      });
      host.appendChild(btn);
    }
  }

  function renderPreviewBlock(data, sectionKey) {
    if (!data || data.previewGate === "public_stub_no_staging_data") return;
    if (!data.ok || data.sectionKey !== sectionKey) return;
    var mount = ensureMount();
    if (!mount) return;
    loadCssOnce();
    mount.innerHTML =
      '<div class="iuAffiliatePhase2Offers__banner" role="status">NÁHLED CJ Phase 2 — neveřejná publikace (localhost). liveEnabled=false.</div>';
    renderCoupon(mount, data.coupon, { preview: true });
    if (data.actions && data.actions.length) {
      for (var ai = 0; ai < data.actions.length; ai++) {
        renderAction(mount, data.actions[ai], { preview: true });
      }
    }
    renderProducts(mount, data.productCards || data.products || [], data.display, { preview: true });
    if (!data.coupon && !(data.productCards || []).length && !(data.actions || []).length) {
      mount.innerHTML +=
        '<div class="iuAffiliatePhase2Offers__meta">Žádné schválené kupóny ani produkty k zobrazení.</div>';
    }
    mount.hidden = false;
  }

  function renderPublicSection(doc, sectionKey) {
    var mount = ensureMount();
    if (!mount) return;
    clearMount(mount);
    if (!doc || doc.liveEnabled !== true) {
      /* Feature flag off — never show unverified offers on production hosts. */
      return;
    }
    if (doc.ok === false) return;
    var sections = doc.sections || [];
    var sec = null;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i] && sections[i].sectionKey === sectionKey) {
        sec = sections[i];
        break;
      }
    }
    if (!sec) return;

    var coupons = (sec.coupons || []).filter(function (c) {
      return c && c.publicationReady === true && c.couponCode;
    });
    var actions = (sec.actions || []).filter(function (a) {
      return a && a.publicationReady === true;
    });
    var products = (sec.products || []).filter(function (p) {
      return p && p.publicationReady === true;
    });
    if (!coupons.length && !actions.length && !products.length) return;

    loadCssOnce();
    for (var ci = 0; ci < coupons.length; ci++) {
      renderCoupon(mount, coupons[ci], { preview: false });
    }
    for (var aj = 0; aj < actions.length; aj++) {
      renderAction(mount, actions[aj], { preview: false });
    }
    renderProducts(
      mount,
      products,
      { defaultVisibleProducts: 3, showMoreLabel: "Zobrazit další" },
      { preview: false }
    );
    mount.hidden = false;
  }

  var previewCached = null;
  function fetchPreview() {
    if (previewCached) return Promise.resolve(previewCached);
    return fetch(PREVIEW_JSON_LOCAL, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("local_dev_missing");
        return r.json();
      })
      .catch(function () {
        return fetch(PREVIEW_JSON_STUB, { cache: "no-store" }).then(function (r) {
          return r.json();
        });
      })
      .then(function (j) {
        previewCached = j;
        return j;
      });
  }

  var publicCached = null;
  var publicFailed = false;
  function fetchOffersPublic() {
    if (publicFailed) return Promise.resolve(null);
    if (publicCached) return Promise.resolve(publicCached);
    var src = OFFERS_PUBLIC_PATH + "?v=" + String(Date.now());
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var to = setTimeout(function () {
      try {
        if (ctrl) ctrl.abort();
      } catch (_) {}
    }, 2500);
    var opts = { credentials: "same-origin", cache: "no-store" };
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(src, opts)
      .then(function (r) {
        clearTimeout(to);
        if (!r.ok) throw new Error("offers_http_" + r.status);
        return r.json();
      })
      .then(function (j) {
        publicCached = j;
        return j;
      })
      .catch(function () {
        clearTimeout(to);
        publicFailed = true;
        return null;
      });
  }

  window.iuAffiliatePhase2OffersRender = function (sectionKey) {
    if (!sectionKey) return;
    if (previewEnabled()) {
      fetchPreview()
        .then(function (data) {
          renderPreviewBlock(data, sectionKey);
        })
        .catch(function () {});
      return;
    }
    fetchOffersPublic().then(function (doc) {
      renderPublicSection(doc, sectionKey);
    });
  };

  window.iuAffiliatePhase2OffersClear = function () {
    clearMount(document.getElementById("iuAffiliatePhase2Offers"));
  };

  if (previewEnabled()) {
    try {
      var sec = new URLSearchParams(location.search).get("section") || "";
      if (sec) window.iuAffiliatePhase2OffersRender(sec);
    } catch (_) {}
  }
})();
