/**
 * Phase 3Z V9 — merchant identity / destination classification / evidence overrides.
 * Unifies decision inputs for category + main-button destination.
 * Never fabricates website evidence; overrides require explicit documented rationale.
 */
import http from "node:http";
import https from "node:https";
import { URL as NodeURL } from "node:url";

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
    // No dedicated marketplace tile in the 36-section SoT. Closest honest fit among
    // existing tiles is universal home goods / living (still imperfect) — keep review
    // flag so READY requires explicit taxonomy GO; never map to aff-inzerce-bazary.
    primaryAssortment: null,
    secondaryAssortments: [],
    significantAssortmentGroups: ["marketplace", "universal"],
    forbiddenSections: ["aff-inzerce-bazary"],
    preferCategoryReview: true,
    rejectSectionIds: ["aff-inzerce-bazary"],
    taxonomyGap: "NO_MARKETPLACE_TILE_IN_36",
    confidence: "high",
    rationale:
      "Allegro.cz is a general marketplace, not classifieds/bazar. Authoritative taxonomy has no marketplace tile → CATEGORY_REVIEW_REQUIRED (external taxonomy gap).",
    evidenceSources: ["official_domain:allegro.cz", "merchant_type:marketplace", "taxonomy36_no_marketplace_tile"],
    preferHomepagePath: true,
  },
  "5096493": {
    advertiserCid: "5096493",
    merchantIdentity: "Booking.com",
    officialDomains: ["booking.com", "www.booking.com"],
    merchantType: "SERVICE_PROVIDER",
    primaryAssortment: { sectionId: "aff-ubytovani-hotely", group: "ubytovani" },
    confidence: "high",
    czAffinityOverride: true,
    rationale: "Booking.com CEE program; homepage is a legitimate CZ-visitor customer landing despite empty targetedCountries on some links.",
    evidenceSources: ["official_domain:booking.com", "program:CEE"],
  },
  "6282055": {
    advertiserCid: "6282055",
    merchantIdentity: "Surfshark",
    officialDomains: ["surfshark.com", "www.surfshark.com"],
    merchantType: "DIGITAL_SERVICE",
    primaryAssortment: { sectionId: "aff-software", group: "software" },
    confidence: "high",
    czAffinityOverride: true,
    rejectDestinationTypes: ["EXTERNAL_TRACKER"],
    preferHostnames: ["surfshark.com", "www.surfshark.com"],
    rationale: "Prefer surfshark.com customer homepage over get.surfshark.net tracker hops; VPN available to CZ visitors.",
    evidenceSources: ["official_domain:surfshark.com"],
  },
  "7133039": {
    advertiserCid: "7133039",
    merchantIdentity: "Byrokko World",
    officialDomains: ["byrokko.com", "www.byrokko.com"],
    merchantType: "SPECIALIST",
    primaryAssortment: { sectionId: "aff-kosmetika", group: "kosmetika" },
    confidence: "high",
    czAffinityOverride: true,
    rationale: "Byrokko sells beauty products to CZ/SK market from byrokko.com; empty CJ targetedCountries must not block CZ affinity.",
    evidenceSources: ["official_domain:byrokko.com", "merchant_positioning:beauty_cz_sk"],
  },
  "5755636": {
    advertiserCid: "5755636",
    merchantIdentity: "Foreo",
    officialDomains: ["foreo.com"],
    merchantType: "SPECIALIST",
    primaryAssortment: { sectionId: "aff-kosmetika", group: "kosmetika" },
    confidence: "medium",
    rejectDestinationTypes: ["EXTERNAL_TRACKER"],
    rationale: "Main button must not use flip.go2cloud.org tracker as customer destination when merchant origin is unavailable in inventory.",
    evidenceSources: ["external_tracker:go2cloud"],
  },
  "5578976": {
    advertiserCid: "5578976",
    merchantIdentity: "Novakid INT",
    officialDomains: ["novakidschool.com"],
    merchantType: "SERVICE_PROVIDER",
    primaryAssortment: { sectionId: "aff-deti-hracky", group: "deti" },
    confidence: "medium",
    rejectDestinationTypes: ["EXTERNAL_TRACKER"],
    rationale: "Novakidtracking.com is an external tracker hop — unsuitable as evidenced customer landing without resolved final merchant URL.",
    evidenceSources: ["external_tracker:novakidtracking"],
  },
  "7520433": {
    advertiserCid: "7520433",
    merchantIdentity: "Hero Wars",
    officialDomains: ["hero-wars.com"],
    merchantType: "DIGITAL_SERVICE",
    primaryAssortment: { sectionId: "aff-deti-hracky", group: "deti" },
    confidence: "medium",
    rejectDestinationTypes: ["EXTERNAL_TRACKER"],
    rationale: "g2afse.com click hop is external tracker — not a stable customer landing for main button.",
    evidenceSources: ["external_tracker:g2afse"],
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
  "5954793": {
    advertiserCid: "5954793",
    merchantIdentity: "lidl-shop.cz",
    officialDomains: ["lidl.cz", "www.lidl.cz"],
    merchantType: "MULTI_ASSORTMENT",
    primaryAssortment: { sectionId: "aff-jidlo", group: "jidlo" },
    secondaryAssortments: [
      { sectionId: "aff-dum-zahrada", group: "dum" },
      { sectionId: "aff-moda", group: "moda" },
    ],
    significantAssortmentGroups: ["jidlo", "dum", "moda", "elektro"],
    confidence: "high",
    czAffinityOverride: true,
    preferHomepagePath: true,
    rationale:
      "Lidl Czech retail + e-shop (lidl.cz). Bot probes without browser UA historically failed; customer homepage is live for CZ visitors.",
    evidenceSources: ["official_domain:lidl.cz", "cz_retail:lidl"],
  },
  "6857406": {
    advertiserCid: "6857406",
    merchantIdentity: "OBI CZ",
    officialDomains: ["obi.cz", "www.obi.cz"],
    merchantType: "SPECIALIST",
    // DIY warehouse — tools/construction is the primary customer intent on InfoUzel.
    primaryAssortment: { sectionId: "aff-dilna-naradi", group: "dilna" },
    secondaryAssortments: [{ sectionId: "aff-dum-zahrada", group: "dum" }],
    significantAssortmentGroups: ["dilna", "dum", "zahrada"],
    confidence: "high",
    czAffinityOverride: true,
    preferHomepagePath: true,
    rationale:
      "OBI Česká republika (obi.cz) DIY/bauhaus: dilna-naradi is the accurate primary tile; dum-zahrada is secondary.",
    evidenceSources: ["official_domain:obi.cz", "cz_retail:obi", "merchant_positioning:diy_bauhaus"],
  },
  "6358042": {
    advertiserCid: "6358042",
    merchantIdentity: "Sanitino Europe",
    officialDomains: ["sanitino.cz", "www.sanitino.cz"],
    merchantType: "SPECIALIST",
    primaryAssortment: { sectionId: "aff-dum-zahrada", group: "dum" },
    significantAssortmentGroups: ["dum", "koupelna"],
    confidence: "high",
    rejectSectionIds: ["aff-energie-uspor"],
    rationale:
      "Sanitino sells bathroom/sanitary fittings and home fixtures — not energy-saving utilities. CJ home_utilities map must not land on aff-energie-uspor.",
    evidenceSources: ["official_domain:sanitino.cz", "merchant_positioning:bathroom_sanitary"],
  },
  "4697950": {
    advertiserCid: "4697950",
    merchantIdentity: "AXA ASSISTANCE - CZ",
    officialDomains: ["axa-assistance.cz", "www.axa-assistance.cz"],
    merchantType: "SERVICE_PROVIDER",
    primaryAssortment: { sectionId: "aff-pojisteni", group: "pojisteni" },
    significantAssortmentGroups: ["pojisteni", "cestovni-pojisteni"],
    confidence: "high",
    rejectSectionIds: ["aff-cestovni-pojisteni"],
    rationale:
      "Selected customer landing is pojisteni-vozidla (vehicle assistance/insurance). General aff-pojisteni is correct; travel-insurance tile would mislabel the destination.",
    evidenceSources: ["official_domain:axa-assistance.cz", "destination_path:pojisteni-vozidla"],
  },
  "7804601": {
    advertiserCid: "7804601",
    merchantIdentity: "GearUP",
    officialDomains: ["gearupbooster.com", "www.gearupbooster.com"],
    merchantType: "DIGITAL_SERVICE",
    primaryAssortment: { sectionId: "aff-software", group: "software" },
    significantAssortmentGroups: ["software"],
    confidence: "high",
    czAffinityOverride: true,
    rejectSectionIds: ["aff-deti-hracky", "aff-knihy"],
    rationale:
      "GearUP is a PC/network game-booster software product available to CZ visitors online; not a children's toy catalog. Prefer aff-software.",
    evidenceSources: ["official_domain:gearupbooster.com", "merchant_positioning:game_booster_software", "digital_service_global_cz_ok"],
  },
  "5006846": {
    advertiserCid: "5006846",
    merchantIdentity: "Cestovná kancelária DAKA.sk",
    officialDomains: ["cestovnakancelariadaka.sk", "www.cestovnakancelariadaka.sk", "daka.sk"],
    merchantType: "SERVICE_PROVIDER",
    primaryAssortment: { sectionId: "aff-cestovni-kancelare", group: "cestovni" },
    confidence: "high",
    czAffinityOverride: true,
    preferHomepagePath: true,
    rationale:
      "DAKA (cestovnakancelariadaka.sk) is an SK travel agency serving CZ/SK visitors; SK homepage is CZ-affinity evidence when CJ click probes time out.",
    evidenceSources: ["official_domain:cestovnakancelariadaka.sk", "merchant_positioning:travel_agency_sk_cz"],
  },
  "7918457": {
    advertiserCid: "7918457",
    merchantIdentity: "Firmanazazitky.cz",
    officialDomains: ["firmanazazitky.cz", "www.firmanazazitky.cz"],
    merchantType: "SPECIALIST",
    primaryAssortment: { sectionId: "aff-kvetiny-darky", group: "darky" },
    confidence: "high",
    czAffinityOverride: true,
    preferHomepagePath: true,
    rationale:
      "Firmanazazitky.cz is a CZ experience-gift retailer; .cz homepage is CZ-affinity proof when intermittent probe failures occur.",
    evidenceSources: ["official_domain:firmanazazitky.cz", "merchant_positioning:experience_gifts_cz"],
  },
  "5603344": {
    advertiserCid: "5603344",
    merchantIdentity: "Hs-sport.cz",
    officialDomains: ["hs-sport.cz", "www.hs-sport.cz"],
    merchantType: "SPECIALIST",
    primaryAssortment: { sectionId: "aff-sport-outdoor", group: "sport" },
    secondaryAssortments: [{ sectionId: "aff-moda", group: "moda" }],
    significantAssortmentGroups: ["sport", "moda"],
    confidence: "high",
    rejectSectionIds: ["aff-moda"],
    rationale:
      "HS Sport is a sports equipment/apparel specialist — primary tile is sport-outdoor; moda alone understates assortment.",
    evidenceSources: ["official_domain:hs-sport.cz", "merchant_positioning:sports_specialist"],
  },
  "8010554": {
    advertiserCid: "8010554",
    merchantIdentity: "Argos.cz",
    officialDomains: ["argos.cz", "www.argos.cz"],
    merchantType: "SPECIALIST",
    primaryAssortment: { sectionId: "aff-dilna-naradi", group: "dilna" },
    significantAssortmentGroups: ["dilna", "elektro"],
    confidence: "high",
    rationale: "ARGOS ELEKTRO — electrical installation materials and lighting; dilna-naradi / elektro-trade, not general dum-zahrada.",
    evidenceSources: ["official_domain:argos.cz", "merchant_positioning:elektroinstalace"],
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
  // Homepage with coupon query is still a customer homepage (not a coupon listing page).
  const pathOnlyEarly = path.replace(/\/+$/, "") || "/";
  const isHomeish =
    pathOnlyEarly === "/" ||
    pathOnlyEarly.length <= 1 ||
    (/\/(cs|cz|sk|en)(\/|$)/i.test(pathOnlyEarly) &&
      pathOnlyEarly.split("/").filter(Boolean).length <= 2);
  if (/coupon|kup[oó]n|voucher|slevov/i.test(blob) && !isHomeish) return DESTINATION_TYPE.COUPON;
  // Known external affiliate/tracking hops (not merchant origin).
  // MUST run before CAMPAIGN — tracker paths often contain offer/promo tokens.
  if (
    /g2afse\.com|go2cloud\.org|novakidtracking\.com|flip\.go2cloud/i.test(host) ||
    (opts.externalTrackerHosts || []).some((h) => host.endsWith(String(h).toLowerCase()))
  ) {
    return DESTINATION_TYPE.EXTERNAL_TRACKER;
  }
  if (
    (/\/(sale|promo|akce|deal|campaign|black-friday)/i.test(path) ||
      /sale|promo|%\s*off|banner/i.test(name)) &&
    !isHomeish
  ) {
    return DESTINATION_TYPE.CAMPAIGN;
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
  // rejectSectionIds: remapa na primary, pokud existuje — quarantine jen při absenci náhrady.
  if (ev.rejectSectionIds?.includes(String(baseSectionId || ""))) {
    if (ev.primaryAssortment?.sectionId) {
      sectionId = ev.primaryAssortment.sectionId;
      categoryReviewRequired = !!ev.preferCategoryReview;
    } else {
      sectionId = null;
      categoryReviewRequired = true;
    }
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
    DESTINATION_TYPE.EXTERNAL_TRACKER,
  ]);
  if (bad.has(destinationType)) return { unsuitable: true, reason: "destination_type:" + destinationType };
  const ev = getMerchantEvidenceOverride(advertiserId);
  if (ev?.rejectDestinationTypes?.includes(destinationType)) {
    return { unsuitable: true, reason: "merchant_override_reject:" + destinationType };
  }
  return { unsuitable: false, reason: null };
}

const BROWSER_LIKE_HEADERS = Object.freeze({
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
});

/**
 * HTTP(S) GET with raised maxHeaderSize — Lidl and similar edges overflow Node's default undici limit.
 * Follows redirects up to maxRedirects. Does not click affiliate networks beyond the given URL.
 */
export function httpGetText(url, { timeoutMs = 8000, maxRedirects = 5, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };
    const run = (current, redirectsLeft) => {
      let parsed;
      try {
        parsed = new NodeURL(current);
      } catch (e) {
        finish(e);
        return;
      }
      const lib = parsed.protocol === "http:" ? http : https;
      const req = lib.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === "http:" ? 80 : 443),
          path: parsed.pathname + parsed.search,
          method: "GET",
          maxHeaderSize: 131072,
          headers: { ...BROWSER_LIKE_HEADERS, ...headers },
        },
        (res) => {
          const status = res.statusCode || 0;
          const loc = res.headers.location;
          if (status >= 300 && status < 400 && loc && redirectsLeft > 0) {
            res.resume();
            let next = loc;
            try {
              next = new NodeURL(loc, current).toString();
            } catch {
              /* keep raw */
            }
            run(next, redirectsLeft - 1);
            return;
          }
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            finish(null, {
              status,
              url: current,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        }
      );
      req.on("error", (e) => finish(e));
      req.setTimeout(timeoutMs, () => {
        req.destroy(Object.assign(new Error("timeout"), { name: "AbortError" }));
      });
      req.end();
    };
    run(String(url || ""), maxRedirects);
  });
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
  try {
    const res = await httpGetText(out.url, {
      timeoutMs,
      headers: {
        "X-InfoUzel-Audit": "merchant-evidence-only; no-affiliate-click; +https://infouzel.cz",
      },
    });
    out.httpStatus = res.status;
    out.url = res.url || out.url;
    const ct = String(res.headers["content-type"] || "");
    if (!ct.includes("text/html")) {
      out.error = "non_html";
      out.ok = res.status >= 200 && res.status < 400;
      return out;
    }
    const text = res.body || "";
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
