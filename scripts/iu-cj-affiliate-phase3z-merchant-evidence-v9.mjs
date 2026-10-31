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
    // Independent content (title/nav) + brand "ARGOS ELEKTRO" → aff-elektro.
    // Production historically listed Argos under aff-dum-zahrada; that is assortment-incorrect.
    // Prior robot override aff-dilna-naradi also mismatched weighted website evidence (elektro).
    primaryAssortment: { sectionId: "aff-elektro", group: "elektro" },
    secondaryAssortments: [{ sectionId: "aff-dilna-naradi", group: "dilna" }],
    significantAssortmentGroups: ["elektro", "dilna"],
    rejectSectionIds: ["aff-dum-zahrada"],
    confidence: "high",
    rationale:
      "ARGOS ELEKTRO sells electrical installation materials, lighting and PV — primary tile is aff-elektro (matches title/nav evidence). Not general dum-zahrada; dilna-naradi is secondary DIY adjacency only.",
    evidenceSources: [
      "official_domain:argos.cz",
      "merchant_positioning:elektroinstalace",
      "title:ARGOS ELEKTRO",
      "weighted_nav:elektro",
    ],
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
    // ABBYY-style ORDERSTYLE checkout hop: authorized CJ destination stays checkout.*,
    // but customer landing is DESTURL (pdf.abbyy.com / digital.abbyy.com). Classify DESTURL.
    // Never rewrite clickUrl / tracking — only destination-type evidence.
    const destUrlParam = u0.searchParams.get("DESTURL") || u0.searchParams.get("desturl") || "";
    if (
      destUrlParam &&
      (/checkout\./i.test(u0.hostname) || /order\/product/i.test(u0.pathname)) &&
      /ORDERSTYLE=/i.test(u0.search)
    ) {
      let inner = destUrlParam;
      try {
        inner = decodeURIComponent(destUrlParam);
      } catch {
        /* keep raw */
      }
      if (inner && /^https?:\/\//i.test(inner) && !/checkout\./i.test(inner)) {
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
    /\/(checkout|order\/product|payment|platba|objednavka)\b/i.test(path) ||
    (/checkout\./i.test(host) && !/ORDERSTYLE=/i.test(query))
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

/**
 * Strip page noise that causes false assortment hits (footers, cookies, ads, scripts).
 * Prefer title / h1 / nav / header / main for assortment decisions.
 */
export function extractWeightedAssortmentEvidence(
  html,
  { title = null, merchantIdentity = null, cjCategoryBlob = null } = {}
) {
  const raw = String(html || "");
  const scriptCount = (raw.match(/<script\b/gi) || []).length;
  let cleaned = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  // Drop low-trust regions entirely when tagged.
  cleaned = cleaned
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<(aside)[\s\S]*?<\/\1>/gi, " ")
    .replace(/id=["'][^"']*(cookie|consent|gdpr|banner|newsletter|promo-ad)[^"']*["'][\s\S]{0,4000}/gi, " ")
    .replace(/class=["'][^"']*(cookie|consent|gdpr|footer|advert|adsbygoogle|sidebar)[^"']*["'][\s\S]{0,4000}/gi, " ");

  const pick = (re) => {
    const m = cleaned.match(re);
    return m ? m[0] : "";
  };
  const titleText = String(title || (cleaned.match(/<title[^>]*>([^<]{0,200})<\/title>/i) || [])[1] || "").trim();
  const metaDesc = (
    (cleaned.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,400})["']/i) || [])[1] ||
    (cleaned.match(/<meta[^>]+content=["']([^"']{0,400})["'][^>]+name=["']description["']/i) || [])[1] ||
    (cleaned.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{0,400})["']/i) || [])[1] ||
    ""
  ).trim();
  const jsonLd = (cleaned.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]{0,20000}?)<\/script>/gi) || [])
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .slice(0, 12000);
  const h1 = (pick(/<h1\b[^>]*>[\s\S]{0,400}?<\/h1>/i) || "").replace(/<[^>]+>/g, " ");
  const nav = [
    pick(/<nav\b[^>]*>[\s\S]{0,12000}?<\/nav>/i),
    pick(/<header\b[^>]*>[\s\S]{0,16000}?<\/header>/i),
    pick(/role=["']navigation["'][\s\S]{0,12000}/i),
  ]
    .join(" ")
    .replace(/<[^>]+>/g, " ");
  const main = [
    pick(/<main\b[^>]*>[\s\S]{0,40000}?<\/main>/i),
    pick(/role=["']main["'][\s\S]{0,40000}/i),
  ]
    .join(" ")
    .replace(/<[^>]+>/g, " ");

  const HINTS = [
    { group: "software", re: /\b(software|antivirus|vpn|saas|pdf|ocr|finereader|abbyy|paragon|security\s*suite|game\s*booster)\b/i, sectionId: "aff-software" },
    { group: "elektro", re: /\b(elektro|electronics|notebook|laptop|fotografie|camera|svítid|svitid)\b/i, sectionId: "aff-elektro" },
    { group: "dilna", re: /\b(díln|dilna|nářad|naradi|stavebn|vrtač|bauhaus|hobby\s*market)\b/i, sectionId: "aff-dilna-naradi" },
    { group: "nabytek", re: /\b(nábytek|nabytek|furniture|židle|zidle|stůl|sofa)\b/i, sectionId: "aff-nabytek" },
    { group: "kuchyn", re: /\b(kuchyn|kitchen|cookware|gril)\b/i, sectionId: "aff-kuchyn" },
    { group: "dum", re: /\b(zahrad|garden|koupel|sanit|dům\s+a\s+zahrada)\b/i, sectionId: "aff-dum-zahrada" },
    { group: "moda", re: /\b(móda|moda|fashion|oblečen|oblecen|apparel|streetwear)\b/i, sectionId: "aff-moda" },
    { group: "boty", re: /\b(boty|obuv|footwear|barefoot)\b/i, sectionId: "aff-boty" },
    { group: "kosmetika", re: /\b(kosmetik|beauty|skincare|skin\s*care|make-?up)\b/i, sectionId: "aff-kosmetika" },
    { group: "drogerie", re: /\b(drogerie|drugstore)\b/i, sectionId: "aff-drogerie" },
    { group: "lekarny", re: /\b(lékárn|lekarn|pharmacy|pharma)\b/i, sectionId: "aff-lekarny" },
    { group: "zdravi", re: /\b(doplněk\s+stravy|supplement|vitamin|superfood)\b/i, sectionId: "aff-zdravi-doplnky" },
    { group: "jidlo", re: /\b(potravin|supermarket|grocery|jídlo|jidlo)\b/i, sectionId: "aff-jidlo" },
    { group: "zvirata", re: /\b(chovatel|zvířec|zvirec|pet\s*shop|superzoo|obojek)\b/i, sectionId: "aff-zvirata" },
    { group: "sport", re: /\b(sport|outdoor|fitness|turistik|crossbow)\b/i, sectionId: "aff-sport-outdoor" },
    { group: "deti", re: /\b(hračk|hrack|toys?|dětsk|detsk|kids)\b/i, sectionId: "aff-deti-hracky" },
    { group: "pojisteni", re: /\b(pojišt|pojist|insurance|assistance)\b/i, sectionId: "aff-pojisteni" },
    { group: "ubytovani", re: /\b(hotel|ubytov|spa\s*pobyt|accommodation)\b/i, sectionId: "aff-ubytovani-hotely" },
    { group: "cestovani", re: /\b(cestovn|dovolen|zájezd|zajezd|travel\s*agency)\b/i, sectionId: "aff-cestovni-kancelare" },
    { group: "letenky", re: /\b(letenk|flight|airline|letišt)\b/i, sectionId: "aff-letenky-letecka-doprava" },
    { group: "darky", re: /\b(zážitkov|zazitkov|dárkov|darkov|gift\s*experience)\b/i, sectionId: "aff-kvetiny-darky" },
    // Require clear marketplace brands — bare "marketplace" appears on SaaS/app stores and causes FPs.
    { group: "marketplace", re: /\b(allegro|amazon\.|ebay|heureka|bazos|aukro|mall\.cz)\b/i, sectionId: "aff-inzerce-bazary" },
    { group: "pneu", re: /\b(pneu|pneumatik|tyre|tire\s*service)\b/i, sectionId: "aff-pneu-pneuservis" },
    { group: "tv", re: /\b(streamování|streaming|iptv|satelit)\b/i, sectionId: "aff-tv-streamovani" },
  ];

  const scores = new Map();
  const add = (blob, weight, source) => {
    if (!blob || weight <= 0) return;
    for (const h of HINTS) {
      if (!h.re.test(blob)) continue;
      const cur = scores.get(h.group) || { group: h.group, sectionId: h.sectionId, weight: 0, sources: [] };
      cur.weight += weight;
      if (cur.sources.length < 8) cur.sources.push(source);
      scores.set(h.group, cur);
    }
  };

  add(titleText, 50, "title");
  add(String(merchantIdentity || ""), 40, "merchant_identity");
  add(h1, 35, "h1");
  add(nav, 30, "nav_or_header");
  add(metaDesc, 22, "meta_description");
  add(jsonLd, 18, "json_ld");
  add(main.slice(0, 20000), 12, "main");
  // CJ primary category may only corroborate an already-present high-trust hit — never invent alone.
  const cjBlob = String(cjCategoryBlob || "").trim();
  if (cjBlob) add(cjBlob, 8, "cj_primary_category_corroboration");
  // Remainder of cleaned page (already without footer/script) — very low weight, cannot alone create significant group.
  const rest = cleaned.replace(/<[^>]+>/g, " ").slice(0, 40000);
  add(rest, 2, "body_low_trust");

  const ranked = [...scores.values()].sort((a, b) => b.weight - a.weight || a.group.localeCompare(b.group));
  // Significant only if driven by high-trust sources — never body/CJ-alone.
  const HIGH = new Set(["title", "h1", "nav_or_header", "merchant_identity", "meta_description", "json_ld"]);
  let significant = ranked.filter((r) => {
    const high = (r.sources || []).some((s) => HIGH.has(s));
    const onlyCj =
      (r.sources || []).length > 0 &&
      (r.sources || []).every((s) => s === "cj_primary_category_corroboration" || s === "body_low_trust");
    return high && !onlyCj && r.weight >= 30;
  });
  // Identity conflict: software/digital specialists must not pick up marketplace/moda/etc. from a lone nav token.
  const idBlob = `${titleText} ${merchantIdentity || ""}`;
  const softwareIdentity = /\b(software|abbyy|paragon|vpn|saas|antivirus|finereader|ocr)\b/i.test(idBlob);
  if (softwareIdentity) {
    const suppress = new Set(["marketplace", "moda", "kuchyn", "pojisteni", "ubytovani", "zvirata", "pneu", "nabytek", "jidlo"]);
    significant = significant.filter((r) => !suppress.has(r.group) || r.weight >= 80);
  }
  const primary = significant[0] || null;
  const secondary = significant[1] || null;
  const contentVerified = Boolean(titleText) && significant.length > 0;
  const textLen = rest.replace(/\s+/g, " ").trim().length;
  const thinHtml = textLen < 400 && !h1.trim() && !nav.trim();
  const spaSuspected = scriptCount >= 8 && thinHtml;

  return {
    title: titleText || null,
    contentVerified,
    primaryAssortment: primary
      ? { sectionId: primary.sectionId, group: primary.group, weight: primary.weight, sources: primary.sources }
      : null,
    secondaryAssortments: secondary
      ? [{ sectionId: secondary.sectionId, group: secondary.group, weight: secondary.weight, sources: secondary.sources }]
      : [],
    significantGroups: significant.map((s) => ({
      sectionId: s.sectionId,
      group: s.group,
      weight: s.weight,
      sources: s.sources,
    })),
    allScored: ranked.slice(0, 10),
    regionsUsed: {
      title: Boolean(titleText),
      h1: Boolean(h1.trim()),
      nav: Boolean(nav.trim()),
      main: Boolean(main.trim()),
      meta: Boolean(metaDesc),
      jsonLd: Boolean(jsonLd.trim()),
    },
    diagnostics: {
      scriptCount,
      textLen,
      thinHtml,
      spaSuspected,
      cjCategoryCorroborationUsed: Boolean(cjBlob),
    },
    note: "Assortment from title/h1/nav/meta/json-ld with weights; footer/cookie/ads stripped. CJ category only corroborates. Body-only hits are not significant.",
  };
}

/** Lightweight merchant website probe (no affiliate click). */
export async function probeMerchantHomepage(
  url,
  { timeoutMs = 8000, merchantIdentity = null, cjCategoryBlob = null } = {}
) {
  const out = {
    url: String(url || ""),
    ok: false,
    httpStatus: null,
    title: null,
    navHints: [],
    assortmentEvidence: null,
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
    const evidence = extractWeightedAssortmentEvidence(text, {
      title: out.title,
      merchantIdentity,
      cjCategoryBlob,
    });
    out.assortmentEvidence = evidence;
    out.navHints = (evidence.significantGroups || []).slice(0, 8).map((g) => g.group);
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
