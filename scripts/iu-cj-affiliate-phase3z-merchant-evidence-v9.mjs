/**
 * Phase 3Z V9 — merchant identity / destination classification / evidence overrides.
 * Unifies decision inputs for category + main-button destination.
 * Never fabricates website evidence; overrides require explicit documented rationale.
 */
export const DESTINATION_TYPE = Object.freeze({
  MERCHANT_HOMEPAGE: "MERCHANT_HOMEPAGE",
  RELEVANT_CATEGORY: "RELEVANT_CATEGORY",
  RELEVANT_SERVICE: "RELEVANT_SERVICE",
  RELEVANT_PRODUCT: "RELEVANT_PRODUCT",
  CAMPAIGN: "CAMPAIGN",
  COUPON: "COUPON",
  NEWSLETTER: "NEWSLETTER",
  LOGIN: "LOGIN",
  REGISTRATION: "REGISTRATION",
  CART: "CART",
  CHECKOUT: "CHECKOUT",
  AFFILIATE_SIGNUP: "AFFILIATE_SIGNUP",
  ERROR_PAGE: "ERROR_PAGE",
  UNRELATED_DESTINATION: "UNRELATED_DESTINATION",
  EXTERNAL_TRACKER: "EXTERNAL_TRACKER",
  UNKNOWN: "UNKNOWN",
});

/**
 * Curated merchant evidence for known misclassifications (independent of CJ tags).
 * Sources are public merchant positioning — used as high-confidence assortment prior.
 */
export const MERCHANT_EVIDENCE_OVERRIDES = Object.freeze({
  "4921612": {
    advertiserCid: "4921612",
    merchantIdentity: "TIPA.EU",
    officialDomains: ["tipa.eu", "www.tipa.eu"],
    merchantType: "SPECIALIST",
    primaryAssortment: { sectionId: "aff-elektro", group: "elektro" },
    secondaryAssortments: [{ sectionId: "aff-mobily", group: "mobily" }],
    significantAssortmentGroups: ["elektro", "mobily", "dilna"],
    forbiddenSections: ["aff-moda"],
    confidence: "high",
    rationale:
      "TIPA.EU is a CZ/EU electronics and photography-tech retailer; moda assignment from CJ apparel metadata is incorrect.",
    evidenceSources: ["official_domain:tipa.eu", "merchant_positioning:electronics_photography"],
  },
  "6464420": {
    advertiserCid: "6464420",
    merchantIdentity: "Allegro.cz",
    officialDomains: ["allegro.cz", "www.allegro.cz"],
    merchantType: "MARKETPLACE",
    primaryAssortment: null,
    secondaryAssortments: [],
    significantAssortmentGroups: ["marketplace", "universal"],
    forbiddenSections: [],
    preferCategoryReview: true,
    rejectSectionIds: ["aff-inzerce-bazary"],
    confidence: "high",
    rationale:
      "Allegro.cz is a general marketplace, not a classifieds/bazar. Without a dedicated marketplace tile, category stays PENDING_EVIDENCE rather than aff-inzerce-bazary.",
    evidenceSources: ["official_domain:allegro.cz", "merchant_type:marketplace"],
    preferHomepagePath: true,
  },
  "2624620": {
    advertiserCid: "2624620",
    merchantIdentity: "ABBYY",
    officialDomains: ["abbyy.com", "pdf.abbyy.com", "checkout.abbyy.com"],
    merchantType: "DIGITAL_SERVICE",
    primaryAssortment: { sectionId: "aff-software", group: "software" },
    confidence: "high",
    rejectDestinationTypes: ["CHECKOUT", "CART"],
    rationale: "Main button must not use checkout.abbyy.com order endpoints when a general product/home link exists.",
    evidenceSources: ["official_domain:abbyy.com"],
  },
  "4686326": {
    advertiserCid: "4686326",
    merchantIdentity: "Paragon Software Group",
    officialDomains: ["paragon-software.com", "shop.paragon-software.com"],
    merchantType: "DIGITAL_SERVICE",
    primaryAssortment: { sectionId: "aff-software", group: "software" },
    confidence: "high",
    rejectDestinationTypes: ["CHECKOUT", "CART"],
    rationale: "Query scope=checkout and cart= mark order funnel URLs unsuitable as main partner button.",
    evidenceSources: ["shop.paragon-software.com checkout query contract"],
  },
  "7947783": {
    advertiserCid: "7947783",
    merchantIdentity: "Cheapvuelos",
    officialDomains: ["cheapvuelos.com"],
    merchantType: "SERVICE_PROVIDER",
    primaryAssortment: { sectionId: "aff-letenky-letecka-doprava", group: "letenky" },
    confidence: "medium",
    rejectDestinationTypes: ["AFFILIATE_SIGNUP", "REGISTRATION"],
    rationale: "/cheapflights-affiliates/ is partner signup, not a customer flight booking landing.",
    evidenceSources: ["path:cheapflights-affiliates"],
  },
  "5193265": {
    advertiserCid: "5193265",
    merchantIdentity: "LAMAX / LAUBEN / TRUELIFE",
    officialDomains: ["lauben.com", "lamax-electronics.com", "truelife.eu"],
    brandDomains: ["lauben.com", "lamax-electronics.com", "truelife.eu"],
    merchantType: "MULTI_ASSORTMENT",
    primaryAssortment: { sectionId: "aff-elektro", group: "elektro" },
    secondaryAssortments: [{ sectionId: "aff-kuchyn", group: "kuchyn" }],
    significantAssortmentGroups: ["elektro", "kuchyn", "dum"],
    confidence: "medium",
    rationale: "Multi-brand consumer electronics / small appliances program; lauben.com/cs is acceptable brand home within program.",
    evidenceSources: ["brand_domains:lauben,lamax,truelife"],
  },
});

/**
 * Classify destination URL purpose for main-button suitability.
 */
export function classifyDestinationType(destination, linkName = "", opts = {}) {
  const dest = String(destination || "");
  const name = String(linkName || "").toLowerCase();
  let path = "";
  let host = "";
  let query = "";
  try {
    const u = new URL(dest.startsWith("http") ? dest : "https://" + dest);
    path = (u.pathname || "/").toLowerCase();
    host = u.hostname.replace(/^www\./i, "").toLowerCase();
    query = (u.search || "").toLowerCase();
  } catch {
    path = dest.toLowerCase();
  }
  // Merchant affiliate hop with redirect_url → classify the customer landing, not the hop path.
  // Example: allegro.cz/affiliate?redirect_url=https%3A%2F%2Fallegro.cz%2F…
  try {
    const u0 = new URL(dest.startsWith("http") ? dest : "https://" + dest);
    const redir = u0.searchParams.get("redirect_url") || u0.searchParams.get("url") || "";
    if (
      redir &&
      /\/affiliate(\/|$)/i.test(u0.pathname) &&
      !/affiliates|partner.?signup|cheapflights-affiliates/i.test(u0.pathname + u0.search)
    ) {
      let inner = redir;
      try {
        inner = decodeURIComponent(redir);
      } catch {
        /* keep raw */
      }
      // Avoid infinite recursion on nested hops; classify inner destination once.
      if (inner && !/\/affiliate(\/|$)/i.test(inner)) {
        return classifyDestinationType(inner, linkName, opts);
      }
    }
  } catch {
    /* fall through */
  }

  const blob = [path, query, name, host].join(" ");

  if (/newsletter|subscribe|odber|odběr|mailing/i.test(blob)) return DESTINATION_TYPE.NEWSLETTER;
  if (
    /scope=checkout/i.test(query) ||
    /[?&]cart=/i.test(query) ||
    /checkout|order\/product|payment|platba|objednavka/i.test(blob) ||
    /checkout\./i.test(host)
  ) {
    return DESTINATION_TYPE.CHECKOUT;
  }
  if (/\/(cart|kosik|košík|bag)(\/|$)/i.test(path) || /[?&]cart=/i.test(query) || /\bcart\b/i.test(name)) {
    return DESTINATION_TYPE.CART;
  }
  // Partner signup pages (plural affiliates / explicit signup) — NOT merchant /affiliate?redirect_url hops.
  if (
    /affiliates(\/|$)/i.test(path) ||
    /partner(s)?-?(signup|program|registr)/i.test(blob) ||
    /\/(affil|partneri|partners)\b/i.test(path) ||
    (/\/affiliate(\/|$)/i.test(path) && !/[?&]redirect_url=/i.test(query))
  ) {
    return DESTINATION_TYPE.AFFILIATE_SIGNUP;
  }
  if (/\/(login|signin|prihlas)/i.test(path) || /\b(login|sign[\s-]?in)\b/i.test(name)) {
    return DESTINATION_TYPE.LOGIN;
  }
  if (/\/(register|registr|signup|sign-up)/i.test(path)) return DESTINATION_TYPE.REGISTRATION;
  if (/coupon|kup[oó]n|voucher|slevov/i.test(blob)) return DESTINATION_TYPE.COUPON;
  if (/\/(sale|promo|akce|deal|campaign|black-friday)/i.test(path) || /sale|promo|%\s*off|banner/i.test(name)) {
    return DESTINATION_TYPE.CAMPAIGN;
  }
  // Known external affiliate/tracking hops (not merchant origin).
  if (
    /g2afse\.com|go2cloud\.org|novakidtracking\.com|flip\.go2cloud/i.test(host) ||
    (opts.externalTrackerHosts || []).some((h) => host.endsWith(String(h).toLowerCase()))
  ) {
    return DESTINATION_TYPE.EXTERNAL_TRACKER;
  }
  if (/\/(p|product|produkt|item|sku)\b/i.test(path)) return DESTINATION_TYPE.RELEVANT_PRODUCT;
  const pathOnly = path.replace(/\/+$/, "") || "/";
  if (pathOnly === "/" || pathOnly.length <= 1) return DESTINATION_TYPE.MERCHANT_HOMEPAGE;
  if (/\/(cs|cz|sk|en)(\/|$)/i.test(pathOnly) && pathOnly.split("/").filter(Boolean).length <= 2) {
    return DESTINATION_TYPE.MERCHANT_HOMEPAGE;
  }
  if (/\/(category|kategorie|c\/|department)/i.test(path)) return DESTINATION_TYPE.RELEVANT_CATEGORY;
  if (/error|404|not[\s-]?found/i.test(blob)) return DESTINATION_TYPE.ERROR_PAGE;
  return DESTINATION_TYPE.UNKNOWN;
}

/** Map DESTINATION_TYPE → legacy DESTINATION_ROLE string used by V7/V8 ranking. */
export function destinationTypeToLegacyRole(type) {
  switch (type) {
    case DESTINATION_TYPE.MERCHANT_HOMEPAGE:
      return "HOMEPAGE";
    case DESTINATION_TYPE.RELEVANT_CATEGORY:
    case DESTINATION_TYPE.RELEVANT_SERVICE:
      return "CATEGORY";
    case DESTINATION_TYPE.RELEVANT_PRODUCT:
      return "PRODUCT";
    case DESTINATION_TYPE.CAMPAIGN:
      return "PROMO";
    case DESTINATION_TYPE.COUPON:
      return "COUPON";
    case DESTINATION_TYPE.NEWSLETTER:
      return "NEWSLETTER";
    case DESTINATION_TYPE.LOGIN:
    case DESTINATION_TYPE.REGISTRATION:
      return "LOGIN";
    case DESTINATION_TYPE.CART:
      return "CART";
    case DESTINATION_TYPE.CHECKOUT:
      return "CHECKOUT";
    case DESTINATION_TYPE.AFFILIATE_SIGNUP:
    case DESTINATION_TYPE.UNRELATED_DESTINATION:
    case DESTINATION_TYPE.EXTERNAL_TRACKER:
    case DESTINATION_TYPE.ERROR_PAGE:
      return "OTHER";
    default:
      return "OTHER";
  }
}

export function getMerchantEvidenceOverride(advertiserId) {
  return MERCHANT_EVIDENCE_OVERRIDES[String(advertiserId)] || null;
}

/**
 * Apply curated evidence onto assortment + section decision.
 */
export function applyMerchantEvidenceOverride({ advertiserId, assortment, baseSectionId } = {}) {
  const ev = getMerchantEvidenceOverride(advertiserId);
  if (!ev) {
    return {
      applied: false,
      assortment,
      sectionId: baseSectionId || null,
      categoryReviewRequired: false,
      evidence: null,
    };
  }
  const nextAssortment = {
    ...(assortment || {}),
    merchantType: ev.merchantType || assortment?.merchantType,
    primaryAssortment: ev.primaryAssortment || assortment?.primaryAssortment,
    secondaryAssortment: (ev.secondaryAssortments || [])[0] || assortment?.secondaryAssortment,
    significantGroups: (ev.significantAssortmentGroups || []).map((g) => ({
      group: g,
      sectionId:
        ev.primaryAssortment?.group === g
          ? ev.primaryAssortment.sectionId
          : (ev.secondaryAssortments || []).find((s) => s.group === g)?.sectionId || null,
      weight: 80,
      sources: ev.evidenceSources || [],
    })),
    confidence: ev.confidence || assortment?.confidence || "medium",
    evidenceOverride: true,
    merchantIdentity: ev.merchantIdentity,
    officialDomains: ev.officialDomains || [],
    brandDomains: ev.brandDomains || [],
    rationale: ev.rationale,
    sources: [...new Set([...(assortment?.sources || []), ...(ev.evidenceSources || []), "merchant_evidence_v9"])],
    checkedAt: new Date().toISOString(),
  };

  let sectionId = ev.primaryAssortment?.sectionId || baseSectionId || null;
  let categoryReviewRequired = !!ev.preferCategoryReview;
  if (ev.rejectSectionIds?.includes(String(baseSectionId || ""))) {
    categoryReviewRequired = true;
    sectionId = ev.primaryAssortment?.sectionId || null;
  }
  if (ev.forbiddenSections?.includes(String(baseSectionId || ""))) {
    sectionId = ev.primaryAssortment?.sectionId || null;
  }
  if (ev.preferCategoryReview && !ev.primaryAssortment?.sectionId) {
    sectionId = null;
    categoryReviewRequired = true;
  }

  return {
    applied: true,
    assortment: nextAssortment,
    sectionId,
    categoryReviewRequired,
    evidence: ev,
  };
}

/**
 * Hard reject destination for main button based on type + merchant rules.
 */
export function isUnsuitableMainDestination(destinationType, advertiserId) {
  const bad = new Set([
    DESTINATION_TYPE.CHECKOUT,
    DESTINATION_TYPE.CART,
    DESTINATION_TYPE.NEWSLETTER,
    DESTINATION_TYPE.LOGIN,
    DESTINATION_TYPE.REGISTRATION,
    DESTINATION_TYPE.AFFILIATE_SIGNUP,
    DESTINATION_TYPE.ERROR_PAGE,
    DESTINATION_TYPE.UNRELATED_DESTINATION,
  ]);
  if (bad.has(destinationType)) return { unsuitable: true, reason: "destination_type:" + destinationType };
  const ev = getMerchantEvidenceOverride(advertiserId);
  if (ev?.rejectDestinationTypes?.includes(destinationType)) {
    return { unsuitable: true, reason: "merchant_override_reject:" + destinationType };
  }
  return { unsuitable: false, reason: null };
}

/** Lightweight merchant website probe (no affiliate click). */
export async function probeMerchantHomepage(url, { timeoutMs = 8000 } = {}) {
  const out = {
    url: String(url || ""),
    ok: false,
    httpStatus: null,
    title: null,
    navHints: [],
    error: null,
    fetchedAt: new Date().toISOString(),
  };
  if (!out.url) {
    out.error = "missing_url";
    return out;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(out.url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "InfoUzelMerchantEvidenceBot/1.0 (+https://infouzel.cz; audit-only; no affiliate click)" },
    });
    out.httpStatus = res.status;
    const ct = String(res.headers.get("content-type") || "");
    if (!ct.includes("text/html")) {
      out.error = "non_html";
      out.ok = res.status >= 200 && res.status < 400;
      return out;
    }
    const text = await res.text();
    const titleM = text.match(/<title[^>]*>([^<]{0,200})<\/title>/i);
    out.title = titleM ? titleM[1].trim() : null;
    const navSlice = text.slice(0, 120000);
    const hintRes = [
      [/elektro|electronics|foto|camera|notebook/i, "elektro"],
      [/móda|moda|fashion|oblečen/i, "moda"],
      [/marketplace|allegro/i, "marketplace"],
      [/pojišt|insurance/i, "pojisteni"],
      [/software|vpn|pdf/i, "software"],
      [/letenk|flight|airline/i, "letenky"],
    ];
    for (const [re, label] of hintRes) {
      if (re.test(navSlice) && out.navHints.length < 8) out.navHints.push(label);
    }
    out.ok = res.status >= 200 && res.status < 400;
    if (res.status === 202) {
      out.ok = false;
      out.error = "http_202_not_confirmed_customer_page";
    }
  } catch (e) {
    out.error = String(e && e.name === "AbortError" ? "timeout" : e?.message || e);
  } finally {
    clearTimeout(t);
  }
  return out;
}

export const GOLDEN_DATASET_V9 = Object.freeze(
  Object.values(MERCHANT_EVIDENCE_OVERRIDES).map((e) => ({
    advertiserCid: e.advertiserCid,
    merchantIdentity: e.merchantIdentity,
    expectedMerchantType: e.merchantType,
    expectedPrimarySectionId: e.primaryAssortment?.sectionId || null,
    forbiddenSections: e.forbiddenSections || [],
    rejectSectionIds: e.rejectSectionIds || [],
    rejectDestinationTypes: e.rejectDestinationTypes || [],
    preferCategoryReview: !!e.preferCategoryReview,
    rationale: e.rationale,
  }))
);
