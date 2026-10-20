/**
 * CJ Phase 2 — preview mount (localhost dev only). Production domains ignore preview flags.
 */
(function iuAffiliatePhase2Offers() {
  "use strict";
  if (window.__iuAffiliatePhase2OffersBooted) return;
  window.__iuAffiliatePhase2OffersBooted = true;

  var PREVIEW_JSON_LOCAL = "/assets/cj-phase2-preview-autohotarek.local-dev.json";
  var PREVIEW_JSON_STUB = "/assets/cj-phase2-preview-autohotarek.json";

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
    link.href = "/assets/iu-affiliate-phase2-offers-v1.css?v=cj-phase2-preview-v2";
    link.setAttribute("data-iu-aff-phase2-css", "1");
    document.head.appendChild(link);
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

  function renderCoupon(host, coupon) {
    if (!coupon || !coupon.couponCode) return;
    var parts = [
      '<div class="iuAffiliatePhase2Offers__coupon" role="region" aria-label="Slevový kupón (náhled)">',
      '<div class="iuAffiliatePhase2Offers__partner">',
      escapeHtml(coupon.partnerName || "Partner"),
      "</div>",
      '<div class="iuAffiliatePhase2Offers__codeRow">',
      "<strong>",
      escapeHtml(coupon.couponCode),
      "</strong>",
      '<button type="button" class="iuAffiliatePhase2Offers__copy iuRadioChip" data-iu-copy-code="1">Kopírovat kód</button>',
      "</div>",
    ];
    if (coupon.customerDiscount) {
      parts.push(
        '<div class="iuAffiliatePhase2Offers__meta">Ověřená sleva zákazníka: ' +
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
    if (coupon.affiliateUrl && coupon.publicationReady) {
      parts.push(
        '<a class="iuAffiliatePhase2Offers__meta" href="' +
          escapeHtml(coupon.affiliateUrl) +
          '" rel="sponsored noopener" target="_blank">Affiliate odkaz</a>"
      );
    } else if (coupon.affiliateUrl) {
      parts.push(
        '<div class="iuAffiliatePhase2Offers__meta">Affiliate odkaz zatím neověřen pro publikaci (náhled).</div>'
      );
    }
    if (!coupon.publicationReady && coupon.blockers && coupon.blockers.length) {
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

  function renderProducts(host, data) {
    var cards = data.productCards || [];
    if (!cards.length) return;
    var visible = data.display?.defaultVisibleProducts || 3;
    var grid = document.createElement("div");
    grid.className = "iuAffiliatePhase2Offers__grid";
    grid.setAttribute("role", "list");
    host.appendChild(grid);

    function paint(limit) {
      grid.innerHTML = "";
      for (var i = 0; i < Math.min(limit, cards.length); i++) {
        var c = cards[i];
        var el = document.createElement("article");
        el.className = "iuAffiliatePhase2Offers__card";
        el.setAttribute("role", "listitem");
        var img =
          c.imageUrl && c.publicationReady
            ? '<img class="iuAffiliatePhase2Offers__img" src="' +
              escapeHtml(c.imageUrl) +
              '" alt="" loading="lazy" decoding="async" />'
            : "";
        var price =
          c.currentPrice
            ? '<div class="iuAffiliatePhase2Offers__meta">Cena: ' + escapeHtml(c.currentPrice) + "</div>"
            : "";
        var orig =
          c.originalPrice
            ? '<div class="iuAffiliatePhase2Offers__meta iuAffiliatePhase2Offers__priceWas">Původně: ' +
              escapeHtml(c.originalPrice) +
              "</div>"
            : "";
        var disc = c.discountLabel
          ? '<div class="iuAffiliatePhase2Offers__meta">Sleva: ' + escapeHtml(c.discountLabel) + "</div>"
          : "";
        var partner = c.partnerName
          ? '<div class="iuAffiliatePhase2Offers__meta">' + escapeHtml(c.partnerName) + "</div>"
          : "";
        var link =
          c.affiliateUrl && c.publicationReady
            ? '<a class="iuAffiliatePhase2Offers__cardLink" href="' +
              escapeHtml(c.affiliateUrl) +
              '" rel="sponsored noopener" target="_blank">Detail produktu</a>"
            : "";
        el.innerHTML =
          img +
          "<h3 class=\"iuAffiliatePhase2Offers__cardTitle\">" +
          escapeHtml(c.title) +
          "</h3>" +
          partner +
          price +
          orig +
          disc +
          link;
        grid.appendChild(el);
      }
    }
    paint(visible);
    if (cards.length > visible) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "iuAffiliatePhase2Offers__more iuRadioChip";
      btn.textContent = data.display?.showMoreLabel || "Zobrazit další";
      var expanded = false;
      btn.addEventListener("click", function () {
        expanded = !expanded;
        paint(expanded ? cards.length : visible);
        btn.textContent = expanded ? "Skrýt další" : data.display?.showMoreLabel || "Zobrazit další";
      });
      host.appendChild(btn);
    }
  }

  function renderBlock(data, sectionKey) {
    if (!data || data.previewGate === "public_stub_no_staging_data") return;
    if (!data.ok || data.sectionKey !== sectionKey) return;
    var mount = document.getElementById("iuAffiliatePhase2Offers");
    if (!mount) return;
    loadCssOnce();
    mount.innerHTML =
      '<div class="iuAffiliatePhase2Offers__banner" role="status">NÁHLED CJ Phase 2 — neveřejná publikace (localhost). PRODUCTION_SIGNING_ENABLED=false.</div>';
    renderCoupon(mount, data.coupon);
    renderProducts(mount, data);
    if (!data.coupon && !(data.productCards || []).length) {
      mount.innerHTML +=
        '<div class="iuAffiliatePhase2Offers__meta">Žádné schválené kupóny ani produkty k zobrazení.</div>';
    }
    mount.hidden = false;
  }

  var cached = null;
  function fetchPreview() {
    if (cached) return Promise.resolve(cached);
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
        cached = j;
        return j;
      });
  }

  window.iuAffiliatePhase2OffersRender = function (sectionKey) {
    if (!previewEnabled()) return;
    fetchPreview()
      .then(function (data) {
        renderBlock(data, sectionKey);
      })
      .catch(function () {
        /* silent — preview optional */
      });
  };

  if (previewEnabled()) {
    try {
      var sec = new URLSearchParams(location.search).get("section") || "";
      if (sec) window.iuAffiliatePhase2OffersRender(sec);
    } catch (_) {}
  }
})();
