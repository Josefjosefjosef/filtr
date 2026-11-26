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
  /* Pages scale: prefer per-section shard (then lean pages) over full audit JSON (~28MB). */
  var OFFERS_PAGES_LEAN_PATH = "/projects/data/iu-affiliate-cj-offers-pages-v1.json";
  var OFFERS_SECTION_BASE = "/projects/data/iu-affiliate-cj-offers-sections-v1/";
  var CSS_HREF = "/assets/iu-affiliate-phase2-offers-v1.css?v=cj-phase3z-offers-v33";

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** CJ-style datetimes → UTC ms; invalid → NaN. */
  function parseOfferInstantMs(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return NaN;
    var normalized = s.replace(/\.0$/, "").replace(" ", "T");
    if (!/Z$/i.test(normalized) && !/[+-]\d{2}:?\d{2}$/.test(normalized)) normalized += "Z";
    return Date.parse(normalized);
  }

  /**
   * Defense-in-depth: hide expired / not-yet-started offers even if JSON is stale.
   * opts.requireEndDate: coupons/actions must have validTo — unknown validity ≠ unlimited.
   */
  function offerInPublicTimeWindow(item, nowMs, opts) {
    if (!item) return false;
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    var requireEnd = opts && opts.requireEndDate === true;
    var from = parseOfferInstantMs(item.validFrom);
    var to = parseOfferInstantMs(item.validTo || item.validUntil || item.endDate || item.expiresAt);
    if (requireEnd && !Number.isFinite(to)) return false;
    if (Number.isFinite(from) && from > now) return false;
    if (Number.isFinite(to) && to < now) return false;
    return true;
  }

  function productPubliclyShowable(item, preview) {
    if (!item) return false;
    if (preview) return true;
    if (item.publicationReady !== true) return false;
    // V51.8-c4: LKG catalog retention must not show unverified/stale offers as current.
    if (item.publicOffer === false || item.lkgPublicHold === true || item.hideAsCurrent === true) {
      return false;
    }
    if (
      item.publicationEligibility === "PUBLICATION_HOLD" ||
      item.publicationEligibility === "PUBLICATION_BLOCKED"
    ) {
      return false;
    }
    if (item.freshnessStatus === "HIDDEN_STALE" || item.freshnessStatus === "SOURCE_UNAVAILABLE") {
      return false;
    }
    if (item.priceHiddenReason) return false;
    if (!isPositiveSalePrice(item.currentPrice)) return false;
    // Defense-in-depth: never paint confirmed out-of-stock / empty availability as buyable.
    var availClass = classifyAvailability(item.availability);
    if (availClass === "OUT_OF_STOCK" || availClass === "UNKNOWN_EMPTY" || availClass === "UNKNOWN_UNRECOGNIZED") {
      return false;
    }
    return offerInPublicTimeWindow(item);
  }

  function classifyAvailability(raw) {
    if (raw == null) return "UNKNOWN_NULL";
    var s = String(raw).trim();
    if (!s) return "UNKNOWN_EMPTY";
    var n = s.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    if (/(^|\b)(out of stock|outofstock|sold out|nedostupn)/.test(n)) return "OUT_OF_STOCK";
    if (/(^|\b)(preorder|pre order|p[rř]edobjedn)/.test(n)) return "PREORDER";
    if (/(^|\b)(backorder|back order)\b/.test(n)) return "BACKORDER";
    if (/(^|\b)(in stock|instock|available|skladem)\b/.test(n)) return "IN_STOCK";
    return "UNKNOWN_UNRECOGNIZED";
  }

  function availabilityLabel(raw) {
    var c = classifyAvailability(raw);
    if (c === "PREORDER") return "Předobjednávka";
    if (c === "BACKORDER") return "Na objednávku / backorder";
    if (c === "OUT_OF_STOCK") return "Momentálně nedostupné";
    // Never imply Skladem when source did not provide availability.
    if (c === "UNKNOWN_NULL" || c === "UNKNOWN_EMPTY" || c === "UNKNOWN_UNRECOGNIZED") {
      return "Dostupnost neověřena";
    }
    return "";
  }

  function isPositiveSalePrice(raw) {
    if (raw == null || raw === "") return false;
    var n = typeof raw === "number" ? raw : Number(String(raw).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0;
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

  function ensureAffiliateCategoryOrder() {
    var view = document.getElementById("iuAffiliateView");
    if (!view) return null;
    var intro = document.getElementById("iuAffiliateIntro");
    var grid = document.getElementById("iuAffiliateGrid");
    var mount = document.getElementById("iuAffiliatePhase2Offers");
    if (!mount) {
      mount = document.createElement("div");
      mount.id = "iuAffiliatePhase2Offers";
      mount.className = "iuAffiliatePhase2Offers";
      mount.hidden = true;
      mount.setAttribute("data-iu-aff-phase2-mount", "1");
    }
    var note =
      view.querySelector && typeof view.querySelector === "function"
        ? view.querySelector(".iuAffiliatePlaceholderNote")
        : null;
    var disclosure = document.getElementById("iuAffiliateDisclosure");
    var seo = document.getElementById("iuAffiliateSeo");
    /* Contract: intro → partner buttons → offers → note → legal/disclosure → SEO (always last). */
    if (intro) view.appendChild(intro);
    if (grid) view.appendChild(grid);
    view.appendChild(mount);
    if (note) view.appendChild(note);
    if (disclosure) view.appendChild(disclosure);
    if (seo) view.appendChild(seo);
    return mount;
  }

  function ensureMount() {
    return ensureAffiliateCategoryOrder();
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
    if (!preview && !offerInPublicTimeWindow(coupon, Date.now(), { requireEndDate: true })) return;
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
    if (!preview && !offerInPublicTimeWindow(action, Date.now(), { requireEndDate: true })) return;
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

  /* After the initial 3 cards, append in batches so large catalogs never mount all DOM at once. */
  var PRODUCT_RENDER_BATCH = 24;

  function buildProductCard(c, preview) {
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
    var pendingReverify =
      c.freshnessStatus === "LAST_KNOWN_PENDING_REVERIFY" ||
      c.sourceFreshLabelForbidden === true;
    if (pendingReverify) {
      el.setAttribute("data-iu-freshness", "LAST_KNOWN_PENDING_REVERIFY");
    } else if (c.freshnessStatus) {
      el.setAttribute("data-iu-freshness", String(c.freshnessStatus));
    }
    var price = isPositiveSalePrice(c.currentPrice)
      ? '<div class="iuAffiliatePhase2Offers__price"' +
        (pendingReverify ? ' data-iu-price-claim="LAST_KNOWN"' : ' data-iu-price-claim="SOURCE_VERIFIED"') +
        ">" +
        escapeHtml(String(c.currentPrice)) +
        (c.currency ? " " + escapeHtml(String(c.currency)) : "") +
        "</div>"
      : "";
    var freshnessMeta = pendingReverify
      ? '<div class="iuAffiliatePhase2Offers__meta" data-iu-freshness-label="1">Poslední známá cena — čeká ověření (není aktuální zdroj).</div>'
      : "";
    var orig = isPositiveSalePrice(c.originalPrice)
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
    var availText = availabilityLabel(c.availability);
    var availMeta = availText
      ? '<div class="iuAffiliatePhase2Offers__meta" data-iu-availability="' +
        escapeHtml(classifyAvailability(c.availability)) +
        '">' +
        escapeHtml(availText) +
        "</div>"
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
      availMeta +
      freshnessMeta +
      orig +
      disc +
      valid +
      link;
    var imgEl = el.querySelector ? el.querySelector("img.iuAffiliatePhase2Offers__img") : null;
    if (imgEl) {
      imgEl.addEventListener("error", function (ev) {
        var t = ev && ev.target;
        if (t && t.classList) t.classList.add("iuAffiliatePhase2Offers__img--failed");
      });
    }
    return el;
  }

  function renderProducts(host, cards, display, opts) {
    var preview = opts && opts.preview;
    var list = (cards || []).filter(function (c) {
      return productPubliclyShowable(c, preview);
    });
    if (!list.length) return;
    var visible = (display && display.defaultVisibleProducts) || 3;
    var batchSize = PRODUCT_RENDER_BATCH;
    var grid = document.createElement("div");
    grid.className = "iuAffiliatePhase2Offers__grid";
    grid.setAttribute("role", "list");
    host.appendChild(grid);

    var shown = 0;
    var sentinel = null;
    var io = null;

    function appendRange(from, to) {
      var end = Math.min(to, list.length);
      if (from >= end) return 0;
      var frag = document.createDocumentFragment();
      for (var i = from; i < end; i++) {
        frag.appendChild(buildProductCard(list[i], preview));
      }
      grid.appendChild(frag);
      return end - from;
    }

    function paintInitial() {
      stopSentinel();
      grid.innerHTML = "";
      shown = appendRange(0, visible);
    }

    function revealNextBatch() {
      if (shown >= list.length) return 0;
      var added = appendRange(shown, shown + batchSize);
      shown += added;
      return added;
    }

    function stopSentinel() {
      if (io) {
        try {
          io.disconnect();
        } catch (_) {}
        io = null;
      }
      if (sentinel && sentinel.parentNode) {
        sentinel.parentNode.removeChild(sentinel);
      }
      sentinel = null;
    }

    function ensureSentinel() {
      /* Sentinel only after the user expands past the intro 3 — never auto-bypass first click. */
      if (shown <= visible || shown >= list.length || truncated) {
        stopSentinel();
        return;
      }
      if (!sentinel) {
        sentinel = document.createElement("div");
        sentinel.className = "iuAffiliatePhase2Offers__sentinel";
        sentinel.setAttribute("data-iu-aff-batch-sentinel", "1");
        sentinel.setAttribute("aria-hidden", "true");
        sentinel.style.cssText = "height:1px;width:100%;pointer-events:none;";
        host.appendChild(sentinel);
      } else if (sentinel.parentNode !== host) {
        host.appendChild(sentinel);
      }
      /* Keep sentinel after the more-button when both exist. */
      if (btn && btn.parentNode === host) {
        host.appendChild(btn);
        host.appendChild(sentinel);
      }
      if (!io && typeof IntersectionObserver === "function") {
        io = new IntersectionObserver(
          function (entries) {
            var hit = false;
            for (var ei = 0; ei < entries.length; ei++) {
              if (entries[ei] && entries[ei].isIntersecting) {
                hit = true;
                break;
              }
            }
            if (!hit || loading || truncated || shown >= list.length) return;
            revealNextBatch();
            syncMoreButton();
            if (shown >= list.length) stopSentinel();
          },
          { root: null, rootMargin: "400px 0px", threshold: 0 }
        );
        io.observe(sentinel);
      }
    }

    var moreLabel = (display && display.showMoreLabel) || "Zobrazit další";
    var loadMore = opts && typeof opts.loadMore === "function" ? opts.loadMore : null;
    /* Lean-pages fallback ships only intro cards (productsTruncated) — more exist in the full shard. */
    var truncated = !!(opts && opts.truncated && loadMore);
    var btn = null;
    var loading = false;

    function syncMoreButton() {
      if (!btn) return;
      if (loading) return;
      if (truncated || shown < list.length) {
        btn.hidden = false;
        btn.disabled = false;
        btn.textContent = moreLabel;
        btn.setAttribute("data-iu-aff-more-mode", truncated ? "load" : "batch");
        ensureSentinel();
      } else if (list.length > visible) {
        stopSentinel();
        btn.hidden = false;
        btn.disabled = false;
        btn.textContent = "Skrýt další";
        btn.setAttribute("data-iu-aff-more-mode", "collapse");
      } else {
        stopSentinel();
        btn.hidden = true;
      }
    }

    paintInitial();

    if (list.length > visible || truncated) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "iuAffiliatePhase2Offers__more iuRadioChip";
      btn.textContent = moreLabel;
      btn.setAttribute("data-iu-aff-more-mode", truncated ? "load" : "batch");
      btn.addEventListener("click", function () {
        if (loading) return;
        if (!truncated && shown >= list.length && list.length > visible) {
          paintInitial();
          syncMoreButton();
          try {
            grid.scrollIntoView({ block: "nearest", behavior: "smooth" });
          } catch (_) {}
          return;
        }
        if (!truncated) {
          /* One batch per click — never mounts the full catalog in a single turn. */
          revealNextBatch();
          syncMoreButton();
          return;
        }
        loading = true;
        btn.disabled = true;
        btn.textContent = "Načítám…";
        loadMore()
          .then(function (full) {
            var more = (full || []).filter(function (c) {
              return productPubliclyShowable(c, preview);
            });
            if (more.length > list.length) list = more;
            truncated = false;
            loading = false;
            btn.disabled = false;
            if (list.length <= visible) {
              stopSentinel();
              if (btn.parentNode) btn.parentNode.removeChild(btn);
              btn = null;
              return;
            }
            revealNextBatch();
            syncMoreButton();
          })
          .catch(function () {
            loading = false;
            btn.disabled = false;
            btn.textContent = moreLabel;
          });
      });
      host.appendChild(btn);
      syncMoreButton();
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
      return c && c.publicationReady === true && c.couponCode && offerInPublicTimeWindow(c);
    });
    var actions = (sec.actions || []).filter(function (a) {
      return a && a.publicationReady === true && offerInPublicTimeWindow(a);
    });
    var products = (sec.products || []).filter(function (p) {
      return productPubliclyShowable(p, false);
    });
    if (!coupons.length && !actions.length && !products.length) return;

    loadCssOnce();
    for (var ci = 0; ci < coupons.length; ci++) {
      renderCoupon(mount, coupons[ci], { preview: false });
    }
    for (var aj = 0; aj < actions.length; aj++) {
      renderAction(mount, actions[aj], { preview: false });
    }
    var secTotal = Number(sec.productCountTotal) || 0;
    var secTruncated =
      sec.productsTruncated === true || (secTotal > 0 && secTotal > (sec.products || []).length);
    renderProducts(
      mount,
      products,
      { defaultVisibleProducts: 3, showMoreLabel: "Zobrazit další" },
      {
        preview: false,
        truncated: secTruncated && isSafeSectionKey(sectionKey),
        loadMore: function () {
          return fetchOffersSectionShard(sectionKey, { force: true, timeoutMs: 20000 }).then(
            function (full) {
              var s = full && full.sections && full.sections[0];
              return (s && s.products) || [];
            }
          );
        },
      }
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
  var sectionCached = Object.create(null);
  var sectionFailed = Object.create(null);
  /* P0 dedupe: in-flight promises (shard + lean/full fallback) so concurrent callers share ONE network fetch. */
  var sectionInflight = Object.create(null);
  var fallbackInflight = null;
  /* Bumped on every invalidation; responses that started under an older epoch are never cached. */
  var cacheEpoch = 0;
  var knownGenerationId = "";
  /* Latest-render-wins: older async render passes must not repaint after a newer one started. */
  var renderSeq = 0;

  /** Drop cached/in-flight/failed state (all sections, or one). In-flight stale responses are not cached. */
  function invalidateOffersCache(sectionKey) {
    cacheEpoch++;
    if (sectionKey && isSafeSectionKey(sectionKey)) {
      delete sectionCached[sectionKey];
      delete sectionFailed[sectionKey];
      delete sectionInflight[sectionKey];
    } else {
      sectionCached = Object.create(null);
      sectionFailed = Object.create(null);
      sectionInflight = Object.create(null);
      knownGenerationId = "";
    }
    publicCached = null;
    publicFailed = false;
    fallbackInflight = null;
  }

  /** ISO-ish generation ids (updatedAt/snapshotId) sort chronologically; opaque ids → not comparable. */
  function generationIsOlder(gen, known) {
    var a = Date.parse(gen);
    var b = Date.parse(known);
    return Number.isFinite(a) && Number.isFinite(b) && a < b;
  }

  function fetchJsonWithTimeout(url, timeoutMs) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var to = setTimeout(function () {
      try {
        if (ctrl) ctrl.abort();
      } catch (_) {}
    }, timeoutMs);
    var opts = { credentials: "same-origin", cache: "no-store" };
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts)
      .then(function (r) {
        clearTimeout(to);
        if (!r.ok) throw new Error("offers_http_" + r.status);
        return r.json();
      })
      .catch(function (err) {
        clearTimeout(to);
        throw err;
      });
  }

  function isSafeSectionKey(sectionKey) {
    return typeof sectionKey === "string" && /^[a-z0-9][a-z0-9._-]{0,80}$/i.test(sectionKey);
  }

  /** Legacy monolith — last resort (audit payload may include refreshCoverage ≈12MB+). */
  function fetchOffersPublicFull() {
    if (publicFailed) return Promise.resolve(null);
    if (publicCached) return Promise.resolve(publicCached);
    var src = OFFERS_PUBLIC_PATH + "?v=" + String(Date.now());
    var epoch = cacheEpoch;
    /* Last-resort monolith (~4MB gzip / ~28MB raw) — short abort permanently failed mobile. */
    return fetchJsonWithTimeout(src, 20000)
      .then(function (j) {
        if (epoch === cacheEpoch) publicCached = j;
        return j;
      })
      .catch(function () {
        if (epoch === cacheEpoch) publicFailed = true;
        return null;
      });
  }

  function fetchOffersPagesLean() {
    var src = OFFERS_PAGES_LEAN_PATH + "?v=" + String(Date.now());
    return fetchJsonWithTimeout(src, 3500);
  }

  function catalogGenerationId(doc) {
    if (!doc || typeof doc !== "object") return "";
    var g = doc.generationId || doc.snapshotId || doc.updatedAt || "";
    return String(g || "").trim();
  }

  /** Fail-closed: never merge pages from mixed catalog generations. */
  function assertSameCatalogGeneration(pages) {
    if (!pages || !pages.length) return true;
    var expect = catalogGenerationId(pages[0]);
    if (!expect) return true; // legacy lean/sections without generationId — allow
    for (var i = 1; i < pages.length; i++) {
      var got = catalogGenerationId(pages[i]);
      if (got && got !== expect) return false;
    }
    return true;
  }

  function mergeSectionPageDocs(pages) {
    if (!pages || !pages.length) return null;
    if (!assertSameCatalogGeneration(pages)) {
      throw new Error("offers_generation_mismatch");
    }
    var base = pages[0];
    var sec0 = base && base.sections && base.sections[0] ? base.sections[0] : null;
    if (!sec0) return base;
    var products = [];
    for (var i = 0; i < pages.length; i++) {
      var sec = pages[i] && pages[i].sections && pages[i].sections[0];
      var list = sec && sec.products ? sec.products : [];
      for (var j = 0; j < list.length; j++) products.push(list[j]);
    }
    var out = {};
    for (var k in base) {
      if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    }
    var mergedSec = {};
    for (var sk in sec0) {
      if (Object.prototype.hasOwnProperty.call(sec0, sk)) mergedSec[sk] = sec0[sk];
    }
    mergedSec.products = products;
    out.sections = [mergedSec];
    return out;
  }

  /**
   * Decide whether a freshly fetched section doc may enter the cache.
   * - Started under an older epoch (invalidated mid-flight) → never cache.
   * - Older catalog generation than the one already seen → never cache (stale snapshot).
   * - Newer generation than known → whole cache is stale: invalidate everything, then cache this doc.
   */
  function settleSectionDoc(doc, epoch) {
    if (epoch !== cacheEpoch) return false;
    var gen = catalogGenerationId(doc);
    if (!gen) return true;
    if (knownGenerationId && gen !== knownGenerationId) {
      if (generationIsOlder(gen, knownGenerationId)) return false;
      invalidateOffersCache();
    }
    knownGenerationId = gen;
    return true;
  }

  /** opts.force: ignore the failed flag (user-initiated Zobrazit dalsi retry); opts.timeoutMs: per-request abort. */
  function fetchOffersSectionShard(sectionKey, opts) {
    if (!isSafeSectionKey(sectionKey)) return Promise.reject(new Error("bad_section_key"));
    var force = !!(opts && opts.force);
    var timeoutMs = (opts && opts.timeoutMs) || 2500;
    if (force) {
      delete sectionFailed[sectionKey];
      delete sectionInflight[sectionKey];
    }
    if (!force && sectionFailed[sectionKey]) return Promise.reject(new Error("section_failed"));
    if (sectionCached[sectionKey]) return Promise.resolve(sectionCached[sectionKey]);
    /* Dedupe: concurrent callers share the in-flight promise (shard + __pN pages fetched once). */
    if (!force && sectionInflight[sectionKey]) return sectionInflight[sectionKey];
    var epoch = cacheEpoch;
    var bust = String(Date.now());
    var src = OFFERS_SECTION_BASE + encodeURIComponent(sectionKey) + ".json?v=" + bust;
    var p = fetchJsonWithTimeout(src, timeoutMs)
      .then(function (first) {
        var pageCount = first && first.pageCount ? Number(first.pageCount) : 1;
        if (!(pageCount > 1)) return first;
        var jobs = [];
        for (var pg = 2; pg <= pageCount; pg++) {
          var pageUrl =
            OFFERS_SECTION_BASE +
            encodeURIComponent(sectionKey) +
            "__p" +
            String(pg) +
            ".json?v=" +
            bust;
          jobs.push(fetchJsonWithTimeout(pageUrl, timeoutMs));
        }
        return Promise.all(jobs).then(function (rest) {
          return mergeSectionPageDocs([first].concat(rest));
        });
      })
      .then(
        function (doc) {
          if (settleSectionDoc(doc, epoch)) sectionCached[sectionKey] = doc;
          if (sectionInflight[sectionKey] === p) delete sectionInflight[sectionKey];
          return doc;
        },
        function (err) {
          if (sectionInflight[sectionKey] === p) delete sectionInflight[sectionKey];
          /* Failure is sticky (no retry storm) only if no invalidation happened mid-flight. */
          if (epoch === cacheEpoch) sectionFailed[sectionKey] = true;
          throw err;
        }
      );
    sectionInflight[sectionKey] = p;
    return p;
  }

  /** Lean pages → full public fallback; one shared in-flight promise for all concurrent callers. */
  function fetchOffersFallback() {
    if (publicCached) return Promise.resolve(publicCached);
    if (fallbackInflight) return fallbackInflight;
    var epoch = cacheEpoch;
    var p = fetchOffersPagesLean()
      .then(function (j) {
        if (epoch === cacheEpoch) publicCached = j;
        return j;
      })
      .catch(function () {
        return fetchOffersPublicFull();
      })
      .then(
        function (j) {
          if (fallbackInflight === p) fallbackInflight = null;
          return j;
        },
        function (err) {
          if (fallbackInflight === p) fallbackInflight = null;
          throw err;
        }
      );
    fallbackInflight = p;
    return p;
  }

  /**
   * Scale path: section shard → lean pages → full public.
   * Paid partner buttons stay in catalog JS/managed JSON (untouched here).
   */
  function fetchOffersPublic(sectionKey) {
    if (sectionKey && isSafeSectionKey(sectionKey)) {
      return fetchOffersSectionShard(sectionKey).catch(function () {
        if (publicCached) return publicCached;
        return fetchOffersFallback();
      });
    }
    return fetchOffersFallback();
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
    var seq = ++renderSeq;
    fetchOffersPublic(sectionKey).then(function (doc) {
      /* Stale-response guard: a newer Render()/Clear() superseded this pass. */
      if (seq !== renderSeq) return;
      renderPublicSection(doc, sectionKey);
    });
  };

  /** Drop cached offers (all, or one section) — e.g. after a catalog generation bump. */
  window.iuAffiliatePhase2OffersInvalidate = function (sectionKey) {
    invalidateOffersCache(sectionKey);
  };

  window.iuAffiliatePhase2OffersClear = function () {
    renderSeq++;
    clearMount(document.getElementById("iuAffiliatePhase2Offers"));
  };

  window.iuAffiliatePhase2OffersEnsureOrder = function () {
    return ensureAffiliateCategoryOrder();
  };

  if (previewEnabled()) {
    try {
      var sec = new URLSearchParams(location.search).get("section") || "";
      if (sec) window.iuAffiliatePhase2OffersRender(sec);
    } catch (_) {}
  }
})();
