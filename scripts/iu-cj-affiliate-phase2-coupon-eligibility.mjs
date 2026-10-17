#!/usr/bin/env node
/** Eligibility reclassification for coupon–product rows (no re-bind). */
import { parseCouponScope } from "./iu-cj-affiliate-phase2-coupon-scope.mjs";
import { parseAffiliateClickUrl } from "./iu-cj-affiliate-phase2-product-api.mjs";

export const IU_CJ_ELIGIBILITY_POLICY = {
  whenUncertainDoNotPublish: true,
  publishRequires: "eligible_at_coupon_and_product_level",
  blockedForPublicProductBlock: ["unknown", "ineligible"],
  rulesVersion: "iu-cj-affiliate-phase2-coupon-eligibility-v2_2",
};

/** Official CJ identifier meanings (not interchangeable). */
export const CJ_IDENTIFIER_GLOSSARY = {
  linkId:
    "Link Search link-id: tracking link in click URL (/click-{websitePid}-{linkId}); not product feed adId",
  adId:
    "Product Feed adId: feed identifier from shoppingProductFeeds / mutations (developers.cj.com/graphql/reference/Product Feed); shoppingProducts.adIds filters by feed adId, not coupon link-id",
  advertiserId: "CJ company id of advertiser (partnerIds in product GraphQL)",
  productId: "SKU/id in product feed row (shoppingProducts productIds / cjsku in click URL)",
  couponLinkId: "Link Search row for coupon creative; independent from product deep-link tracking link-id",
  adIdsNotCouponScope:
    "Documented: Restrict search results based on these adIds (product feed). No doc that adIds limits products eligible for a specific coupon code",
  programTermsApi:
    "https://docs.cj.com/docs/copy-of-program-terms-api.md — programs.api.cj.com GraphQL: commission rates, specialTerms body; not coupon creative text or image licenses",
};

/** Fixture-only attestation; must never be set from production batch samples. */
export const SYNTHETIC_FIXTURE_MARKER = "iu_synthetic_eligibility_fixture_only";

const GIFT_VOUCHER_RE = /poukaz|voucher|gift\s*card|dárkov|darkov/i;
const USED_OPEN_RE = /použit|rozbalen|refurb|bazar|second[\s-]?hand|open[\s-]?box/i;
const FULL_SORTIMENT_RE = /(?:na\s+v[sš]e|v[sš]echny\s+produkty|cel[ýy]\s+sortiment)/i;

export function extractLandingUrl(affiliateClickUrl) {
  if (!affiliateClickUrl) return null;
  try {
    const u = new URL(String(affiliateClickUrl));
    const inner = u.searchParams.get("url");
    if (!inner) return null;
    return new URL(inner);
  } catch {
    return null;
  }
}

export function inferProductMarket(product) {
  const landing = extractLandingUrl(product.affiliateClickUrl);
  const host = landing?.hostname?.toLowerCase() || "";
  const path = landing?.pathname?.toLowerCase() || "";
  const currency = String(product.currency || "").toUpperCase();

  if (host.endsWith(".cz") || path.includes("/cz/")) {
    return { market: "cz", source: "product_landing_host", host, currency };
  }
  if (host.endsWith(".sk") || path.includes("/sk/")) {
    return { market: "sk", source: "product_landing_host", host, currency };
  }
  if (host.endsWith(".ro")) return { market: "ro", source: "product_landing_host", host, currency };
  if (host.endsWith(".pl")) return { market: "pl", source: "product_landing_host", host, currency };
  if (host.includes("lelosi.ie")) return { market: "ie", source: "product_landing_host", host, currency };

  if (currency === "CZK") return { market: "cz", source: "product_currency_czk", host, currency };
  if (currency === "RON") return { market: "ro", source: "product_currency_ron", host, currency };
  if (currency === "EUR" && host.includes("tierraverde.sk")) return { market: "sk", source: "product_landing_host", host, currency };

  return { market: "unknown", source: "product_market_unverified", host, currency };
}

export function parseOfferMarketAndStore(offerText) {
  const t = String(offerText || "");
  const lower = t.toLowerCase();
  const out = { markets: [], stores: [], sources: [] };

  const siteM = lower.match(/na\s+v[sš]e\s+na\s+([a-z0-9-]+\.(?:sk|cz|ro|pl|ie))/i);
  if (siteM) {
    out.stores.push(siteM[1]);
    out.markets.push(siteM[1].split(".").pop());
    out.sources.push("creative_target_store_domain");
  }
  if (/\bro:\b/.test(lower) || /peste\s+\d+[\d\s.,]*\s*lei/i.test(lower)) {
    out.markets.push("ro");
    out.sources.push("creative_romania_lei_wording");
  }
  if (/autohotarek\.cz/i.test(t)) {
    out.stores.push("autohotarek.cz");
    out.markets.push("cz");
    out.sources.push("creative_named_cz_store");
  }
  if (/asko-nabytek\.cz/i.test(t)) {
    out.stores.push("asko-nabytek.cz");
    out.markets.push("cz");
    out.sources.push("creative_named_cz_store");
  }
  if (/\.sk\b/i.test(t) && !out.markets.includes("sk")) {
    out.markets.push("sk");
    out.sources.push("creative_sk_domain_mention");
  }
  if (/nab[íy]tek.*\.cz|z\s+[a-z0-9-]+\.cz|na\s+[a-z0-9-]+\.cz/i.test(lower)) {
    out.markets.push("cz");
    out.sources.push("creative_cz_store_wording");
  }
  if (out.markets.length === 0 && FULL_SORTIMENT_RE.test(lower)) {
    out.sources.push("creative_full_sortiment_no_explicit_market");
  }
  return out;
}

export function parseCartCondition(scope) {
  if (!scope?.cartMin) return null;
  return {
    type: "minimum_order_value",
    amount: scope.cartMin.amount,
    currency: scope.cartMin.currency,
    source: scope.source || "cj_link_search_description_adcontent",
    note: "cart_rule_display_separately; post_discount_price_not_computed",
  };
}

function missingFieldsForScope(scope, offerText) {
  const missing = [];
  const lower = String(offerText || "").toLowerCase();
  if (scope.scopeType === "full_sortiment_with_exclusions" || /neplat[ií]\s+na|krom[eě]/i.test(lower)) {
    missing.push("product_condition_used_open_box_or_excluded_category");
  }
  if (/nezlevněn|niesobj|promocj/i.test(lower)) missing.push("product_sale_or_promo_flag");
  if (scope.scopeType.includes("selected") || /vybran[ée]\s+modely/i.test(lower)) {
    missing.push("documented_model_list_or_structured_product_category");
  }
  missing.push("promotion_scope_applies_to_this_sku");
  return missing;
}

function isGiftVoucherProduct(product) {
  const name = String(product.name || "");
  const landing = extractLandingUrl(product.affiliateClickUrl);
  const path = landing?.pathname || "";
  return GIFT_VOUCHER_RE.test(name) || GIFT_VOUCHER_RE.test(path);
}

function productHitsDocumentedExclusion(product, scope) {
  const name = String(product.name || "").toLowerCase();
  const desc = String(product.description || "").toLowerCase();
  const blocks = (scope.exclusionSpans || []).join(" ").toLowerCase();
  if (!blocks) return null;
  if (/outlet|výprodej|gift card|bundle|surprise|poukaz|dárkov/i.test(blocks)) {
    if (/outlet|výprodej/i.test(blocks) && (name.includes("outlet") || name.includes("výprodej"))) {
      return { hit: true, term: "outlet_or_sale_category_in_name", source: "creative_exclusion_block" };
    }
    if (/gift card|poukaz|dárkov/i.test(blocks) && GIFT_VOUCHER_RE.test(name)) {
      return { hit: true, term: "gift_voucher_in_documented_exclusion", source: "creative_exclusion_block" };
    }
  }
  if (/použit|rozbalen/i.test(blocks) && (USED_OPEN_RE.test(name) || USED_OPEN_RE.test(desc))) {
    return { hit: true, term: "used_or_open_box_signal_in_product_text", source: "creative_exclusion_block" };
  }
  return { hit: false };
}

export function buildOfferEvidenceBundle(offerText, linkMeta = {}) {
  const t = String(offerText || "");
  const lower = t.toLowerCase();
  const stores = [];
  const sources = [];
  const markets = [];

  const creativeStore = t.match(/([a-z0-9-]+\.cz)/i);
  if (creativeStore) {
    stores.push(creativeStore[1].toLowerCase());
    markets.push("cz");
    sources.push("cj_link_search_description_adcontent");
  }
  if (linkMeta.destination) {
    try {
      const dh = new URL(String(linkMeta.destination)).hostname.toLowerCase();
      if (dh && !stores.includes(dh)) stores.push(dh);
      if (dh.endsWith(".cz")) {
        markets.push("cz");
        sources.push("cj_link_search_destination");
      }
    } catch {
      /* ignore */
    }
  }
  const fullSortiment = FULL_SORTIMENT_RE.test(lower);
  return {
    stores: [...new Set(stores)],
    markets: [...new Set(markets)],
    sources: [...new Set(sources)],
    fullSortiment,
    couponLinkId: linkMeta.linkId ? String(linkMeta.linkId) : null,
    couponCode: linkMeta.couponCode ? String(linkMeta.couponCode) : null,
    validity: {
      promotionStartDate: linkMeta.promotionStartDate || null,
      promotionEndDate: linkMeta.promotionEndDate || null,
    },
  };
}

function promotionDocumentsCzStoreAndScope(offerText, linkMeta = {}) {
  const bundle = buildOfferEvidenceBundle(offerText, linkMeta);
  const namedCzStore = bundle.stores.some((s) => s.endsWith(".cz"));
  if (namedCzStore && bundle.fullSortiment) {
    const via = bundle.sources.includes("cj_link_search_destination")
      ? "creative_plus_link_destination"
      : "creative_text";
    return {
      documented: true,
      reason: "full_sortiment_promotion_with_cz_store:" + via,
      source: bundle.sources.join("|") || "cj_link_search",
      evidenceBundle: bundle,
    };
  }
  return {
    documented: false,
    reason: "promotion_cz_store_or_action_scope_not_documented",
    source: "iu_eligibility_rules_v2_1",
    evidenceBundle: bundle,
  };
}

/** A: product affiliate link integrity (independent from coupon eligibility). */
export function assessProductAffiliateLink(product, expectedWebsitePid = null) {
  const click = parseAffiliateClickUrl(product.affiliateClickUrl, expectedWebsitePid);
  const landing = extractLandingUrl(product.affiliateClickUrl);
  const exp = String(expectedWebsitePid || "").trim();
  let affiliateLinkStatus = "invalid_or_unparseable";
  if (!click.present) {
    affiliateLinkStatus = "missing_click_url";
  } else if (!click.trustedClickHost) {
    affiliateLinkStatus = "untrusted_click_host";
  } else if (!click.documentedFormat) {
    affiliateLinkStatus = "invalid_or_unparseable";
  } else if (!exp) {
    affiliateLinkStatus = "unknown_expected_pid_not_provided";
  } else if (!click.matchesExpectedWebsitePid) {
    affiliateLinkStatus = "pid_mismatch";
  } else {
    affiliateLinkStatus = "valid_cj_click_format";
  }
  return {
    affiliateLinkStatus,
    trackingLinkIdInClickUrl: click.linkIdInUrl,
    publisherPidInClickUrl: click.websitePidInUrl,
    matchesExpectedWebsitePid: click.matchesExpectedWebsitePid,
    trustedClickHost: click.trustedClickHost,
    productLandingHost: landing?.hostname || null,
    note: "tracking_link_id_differs_from_coupon_link_id_is_normal_for_product_deep_links",
  };
}

export function assessPromotionTimeActive(linkMeta, refDate = new Date()) {
  const startRaw = linkMeta.promotionStartDate;
  const endRaw = linkMeta.promotionEndDate;
  const startMs = parsePromotionEndMs(startRaw);
  const endMs = parsePromotionEndMs(endRaw);
  const now = refDate.getTime();
  if (String(endRaw || "").trim() && endMs === null) {
    return { active: false, state: "invalid", reason: "promotion_end_date_unparseable" };
  }
  if (String(startRaw || "").trim() && startMs === null) {
    return { active: false, state: "invalid", reason: "promotion_start_date_unparseable" };
  }
  if (endMs !== null && now > endMs) {
    return { active: false, state: "inactive", reason: "coupon_promotion_end_date_passed" };
  }
  if (startMs !== null && now < startMs) {
    return { active: false, state: "inactive", reason: "coupon_promotion_not_yet_started" };
  }
  if (endMs === null && startMs === null) {
    return { active: null, state: "unknown", reason: "promotion_dates_missing" };
  }
  if (endMs === null || startMs === null) {
    return { active: null, state: "unknown", reason: "promotion_dates_incomplete" };
  }
  return { active: true, state: "active", reason: "cj_link_search_promotion_dates" };
}

function cjskuMatchesProductId(product) {
  const landing = extractLandingUrl(product.affiliateClickUrl);
  if (!landing) return null;
  try {
    const u = new URL(String(product.affiliateClickUrl));
    const inner = new URL(u.searchParams.get("url") || "");
    const cjsku = inner.searchParams.get("cjsku") || u.searchParams.get("cjsku");
    if (!cjsku) return null;
    return String(cjsku) === String(product.productId);
  } catch {
    return null;
  }
}

/**
 * B: coupon eligibility for this SKU (independent from tracking link-id equality).
 */
export function assessCouponProductAssociation(product, bindingRow, linkMeta = {}, scope = null, refDate = new Date()) {
  const couponLinkId = String(linkMeta.linkId || bindingRow.linkId || "");
  const click = parseAffiliateClickUrl(product.affiliateClickUrl);
  const landing = extractLandingUrl(product.affiliateClickUrl);
  const productHost = landing?.hostname?.toLowerCase() || "";
  const offerText = bindingRow.offerText || "";
  const bundle = buildOfferEvidenceBundle(offerText, linkMeta);
  const promoDoc = promotionDocumentsCzStoreAndScope(offerText, linkMeta);
  const affiliateLink = assessProductAffiliateLink(product, linkMeta.websitePid);

  const availableEvidence = {
    couponLinkId,
    productTrackingLinkId: click.linkIdInUrl,
    trackingLinkIdDiffersFromCouponLink: Boolean(
      click.linkIdInUrl && couponLinkId && click.linkIdInUrl !== couponLinkId
    ),
    affiliateLinkStatus: affiliateLink.affiliateLinkStatus,
    productId: product.productId,
    cjskuMatchesProductId: cjskuMatchesProductId(product),
    productLandingHost: productHost,
    promotionStores: bundle.stores,
    promotionFullSortiment: bundle.fullSortiment,
    promotionDocumented: promoDoc.documented,
    targetedCountries: linkMeta.targetedCountries || null,
    couponCode: linkMeta.couponCode || bindingRow.couponCode,
    validity: bundle.validity,
    bindingSource: product.bindingSource || null,
  };

  if (product.promotionSkuAttestation?.[SYNTHETIC_FIXTURE_MARKER]) {
    return {
      status: "eligible",
      reason: "synthetic_fixture_full_attestation",
      source: SYNTHETIC_FIXTURE_MARKER,
      availableEvidence,
      affiliateLink,
      missingDecisiveFact: null,
      smallestVerificationStep: null,
    };
  }

  const time = assessPromotionTimeActive(linkMeta, refDate);
  if (time.active !== true) {
    return {
      status: "unknown",
      reason: time.reason,
      source: "cj_link_search_promotion_dates",
      availableEvidence,
      affiliateLink,
      missingDecisiveFact: time.state === "inactive" || time.state === "invalid" ? time.reason : "active_promotion_window",
      smallestVerificationStep: "Refresh link-search promotion dates or wait for active window",
    };
  }

  if (affiliateLink.affiliateLinkStatus !== "valid_cj_click_format") {
    return {
      status: "unknown",
      reason: "product_affiliate_click_url_not_valid_cj_format",
      source: "cj_click_url_parser",
      availableEvidence,
      affiliateLink,
      missingDecisiveFact: "valid_product_affiliate_click_url",
      smallestVerificationStep: "Use linkCode.clickUrl from shoppingProducts GraphQL",
    };
  }

  const normHost = (h) => String(h || "").toLowerCase().replace(/^www\./, "");
  const storeAligned =
    bundle.stores.length === 0 ||
    bundle.stores.some((s) => normHost(productHost) === normHost(s) || normHost(productHost).endsWith(normHost(s)));
  if (!storeAligned && bundle.stores.length > 0) {
    return {
      status: "ineligible",
      reason: "product_landing_host_not_aligned_with_promotion_store_evidence",
      source: "product_landing_host|offer_evidence_bundle",
      availableEvidence,
      affiliateLink,
      missingDecisiveFact: null,
      smallestVerificationStep: null,
    };
  }

  if (linkMeta.targetedCountries && !String(linkMeta.targetedCountries).toUpperCase().includes("CZ")) {
    return {
      status: "unknown",
      reason: "coupon_targeted_countries_exclude_cz",
      source: "cj_link_search_targeted_countries",
      availableEvidence,
      affiliateLink,
      missingDecisiveFact: "cz_in_targeted_countries",
      smallestVerificationStep: "Confirm link-search targetedCountries for CZ audience",
    };
  }

  if (!promoDoc.documented) {
    return {
      status: "unknown",
      reason: "promotion_cz_store_or_scope_not_documented_in_authoritative_offer_data",
      source: "iu_eligibility_rules_v2_2",
      availableEvidence,
      affiliateLink,
      missingDecisiveFact: "documented_full_sortiment_for_cz_store_in_offer_bundle",
      smallestVerificationStep: "Link-search description/destination naming CZ store and full sortiment",
    };
  }

  const scopeType = scope?.scopeType || "";
  if (
    scopeType.includes("category") ||
    scopeType.includes("subset") ||
    scopeType.includes("selected") ||
    /vybran[ée]\s+modely/i.test(offerText)
  ) {
    return {
      status: "unknown",
      reason: "subset_or_category_promotion_requires_model_list_or_structured_category",
      source: "creative_scope|product_feed",
      availableEvidence,
      affiliateLink,
      missingDecisiveFact: "documented_model_list_or_structured_product_category",
      smallestVerificationStep: "Item List API if program ties coupon to item list; else model URLs in creative",
    };
  }

  if (bundle.fullSortiment && promoDoc.documented && storeAligned) {
    return {
      status: "eligible",
      reason: "promotion_full_sortiment_same_cz_store_documented_in_link_search",
      source: promoDoc.source,
      availableEvidence,
      affiliateLink,
      missingDecisiveFact: null,
      smallestVerificationStep: null,
    };
  }

  return {
    status: "unknown",
    reason: "coupon_product_eligibility_not_documented_from_available_authoritative_fields",
    source: "iu_eligibility_rules_v2_2",
    availableEvidence,
    affiliateLink,
    missingDecisiveFact: "offer_scope_or_store_alignment",
    smallestVerificationStep: "Aggregate link-search creative, destination, targetedCountries, product landing",
  };
}

export function explainAutohotarekProductGap(product, bindingRow, linkMeta, scope = null, refDate = new Date()) {
  const assoc = assessCouponProductAssociation(product, bindingRow, linkMeta, scope, refDate);
  return {
    partner: "Autohotarek.cz",
    couponCode: bindingRow.couponCode,
    couponLinkId: linkMeta.linkId,
    offerSummary: bindingRow.offerText,
    description: linkMeta.description || null,
    targetedCountries: linkMeta.targetedCountries || null,
    destination: linkMeta.destination || null,
    affiliateLinkAssessment: assoc.affiliateLink,
    couponEligibilityAssessment: {
      status: assoc.status,
      reason: assoc.reason,
      source: assoc.source,
    },
    availableEvidence: assoc.availableEvidence,
    missingDecisiveFact: assoc.missingDecisiveFact,
    smallestVerificationStep: assoc.smallestVerificationStep,
    note: "Different product vs coupon tracking link-id is expected; not used as ineligibility",
  };
}

/**
 * Coupon-level gate for infoUzel.cz (CZ visitors). Program membership ≠ promotion scope.
 */
export function evaluateCouponCzPublish(ctx) {
  const bindingRow = ctx.bindingRow || {};
  const linkMeta = ctx.linkMeta || bindingRow.linkMeta || {};
  const scope = ctx.scope || parseCouponScope({ description: bindingRow.offerText, adContent: "" });
  const offerText = bindingRow.offerText || scope.offerTextStripped || "";
  const signals = parseOfferMarketAndStore(offerText);
  const cartCondition = parseCartCondition(scope);

  const base = {
    czCouponPublishEligibility: "unknown",
    czAudiencePublishBlocked: true,
    publishBlockReason: "",
    publishBlockSource: "",
    cartCondition,
    offerMarketSignals: signals,
    policy: IU_CJ_ELIGIBILITY_POLICY.whenUncertainDoNotPublish,
  };

  if (signals.markets.includes("ro") && !signals.markets.includes("cz")) {
    return {
      ...base,
      publishBlockReason: "romania_lei_coupon_not_for_cz_visitors_without_ro_checkout_proof",
      publishBlockSource: "creative_romania_lei_wording",
      czAudienceScopeNote: "do_not_present_as_general_cz_coupon",
    };
  }

  if (scope.targetStoreHost && !scope.targetStoreHost.endsWith(".cz")) {
    return {
      ...base,
      publishBlockReason: "promotion_targets_non_cz_store:" + scope.targetStoreHost,
      publishBlockSource: "creative_target_store_domain",
    };
  }

  const promoDoc = promotionDocumentsCzStoreAndScope(offerText, linkMeta);
  if (promoDoc.documented) {
    const time = assessPromotionTimeActive(linkMeta, ctx.refDate || new Date());
    if (time.active !== true) {
      return {
        ...base,
        publishBlockReason: time.reason,
        publishBlockSource: "cj_link_search_promotion_dates",
        promotionTimeState: time.state,
      };
    }
    return {
      ...base,
      czCouponPublishEligibility: "eligible",
      czAudiencePublishBlocked: false,
      publishBlockReason: "",
      publishBlockSource: "",
      couponPublishReason: promoDoc.reason,
      couponPublishSource: promoDoc.source,
      offerEvidenceBundle: promoDoc.evidenceBundle,
      note: "coupon_only_gate; product_rows_still_require_sku_association_proof",
    };
  }

  if (FULL_SORTIMENT_RE.test(offerText.toLowerCase())) {
    return {
      ...base,
      publishBlockReason: "promotion_full_sortiment_without_cz_store_in_creative_not_publishable",
      publishBlockSource: "iu_eligibility_rules_v2_program_not_substitute_for_promotion",
    };
  }

  return {
    ...base,
    publishBlockReason: "coupon_market_or_promotion_scope_undocumented_for_cz",
    publishBlockSource: "iu_eligibility_rules_v2",
  };
}

export function computePublicProductPublishable(productEligibility, couponEval) {
  if (productEligibility !== "eligible") {
    return {
      publicProductBlockPublishable: false,
      publishBlockReason: "product_" + productEligibility,
    };
  }
  if (couponEval.czCouponPublishEligibility !== "eligible" || couponEval.czAudiencePublishBlocked) {
    return {
      publicProductBlockPublishable: false,
      publishBlockReason: "coupon_gate:" + (couponEval.publishBlockReason || couponEval.czCouponPublishEligibility),
    };
  }
  return { publicProductBlockPublishable: true, publishBlockReason: "" };
}

function assessScopeMatch(product, scope, historical) {
  const reason = historical.matchReason || "";
  const detail = historical.matchDetail || "";

  if (reason === "category_keyword_in_product_description_only" || historical.warning) {
    return {
      ok: false,
      status: "ineligible",
      reason: "keyword_in_description_only_not_structured_category_proof",
      source: "iu_eligibility_rules_v2",
    };
  }

  if (
    scope.scopeType === "category_or_subset_restricted" ||
    /vybran[ée]\s+modely/i.test(scope.offerTextStripped || "")
  ) {
    if (reason.includes("category_keyword") || reason === "category_keyword_in_product_text") {
      const name = String(product.name || "").toLowerCase();
      const kw = String(detail || "").toLowerCase();
      if (name.includes("odsavač") && /myčk|mikrovln|troub/i.test(kw)) {
        return {
          ok: false,
          status: "ineligible",
          reason: "product_category_mismatch_despite_keyword_noise",
          source: "iu_eligibility_rules_v2",
        };
      }
      if (kw && name.includes(kw)) {
        return {
          ok: false,
          status: "unknown",
          reason: "selected_models_require_model_list_name_keyword_insufficient",
          source: "iu_eligibility_rules_v2",
        };
      }
      return {
        ok: false,
        status: "unknown",
        reason: "selected_models_without_documented_model_list",
        source: "iu_eligibility_rules_v2",
      };
    }
  }

  if (reason.includes("category_keyword") && detail === "produkty") {
    return {
      ok: false,
      status: "ineligible",
      reason: "generic_keyword_produkty_not_category_proof",
      source: "iu_eligibility_rules_v2",
    };
  }

  if (reason.includes("category_keyword") && !product.googleProductCategory) {
    return {
      ok: false,
      status: "unknown",
      reason: "category_match_keyword_only_missing_structured_category",
      source: "iu_eligibility_rules_v2",
    };
  }

  if (reason === "full_sortiment_scope") {
    return { ok: true, source: "historical_bind_full_sortiment", detail };
  }

  return { ok: true, source: "historical_bind_match", detail: reason };
}

function assessMarketFit(offerSignals, productMarket, linkId) {
  const productM = productMarket.market;

  if (offerSignals.markets.includes("ro") && productM !== "ro" && productM !== "unknown") {
    return {
      status: "ineligible",
      reason: "offer_market_romania_product_landing_other_market",
      source: offerSignals.sources.join("|") || "creative_market_signal",
    };
  }

  if (offerSignals.stores.some((s) => s.includes("wrangler.sk"))) {
    if (productM === "cz") {
      return {
        status: "unknown",
        reason: "offer_targets_wrangler_sk_store_product_on_partner_cz_domain",
        source: "creative_target_store_domain",
      };
    }
  }

  if (productM === "sk" && !offerSignals.markets.includes("sk") && offerSignals.markets.includes("cz")) {
    return {
      status: "ineligible",
      reason: "product_landing_sk_offer_not_explicitly_sk_for_cz_audience",
      source: "product_landing_host",
    };
  }

  if (productM === "ie") {
    return {
      status: "ineligible",
      reason: "product_landing_ie_not_cz_shoppable_offer",
      source: "product_landing_host",
    };
  }

  if (productM === "cz" || productMarket.currency === "CZK") {
    return { status: "pass", reason: "cz_landing_or_czk_currency", source: productMarket.source };
  }

  if (productM === "unknown") {
    return { status: "unknown", reason: "product_market_unverified", source: "product_landing_host" };
  }

  return { status: "unknown", reason: "market_fit_not_documented", source: "iu_eligibility_rules_v2" };
}

function assessBrandSiteRestriction(product, offerText, scope) {
  const lower = String(offerText || "").toLowerCase();
  const name = String(product.name || "").toLowerCase();
  if (/wrangler\.sk/i.test(lower)) {
    if (name.includes("gap ") || name.startsWith("gap ") || name.includes(" džíny pro ženy gap")) {
      return {
        status: "ineligible",
        reason: "product_brand_gap_outside_wrangler_sk_offer_scope",
        source: "creative_target_store_domain",
      };
    }
    if (name.includes("wrangler")) {
      return {
        status: "unknown",
        reason: "wrangler_product_on_cz_domain_offer_wrangler_sk_only",
        source: "creative_target_store_domain",
      };
    }
  }
  if (scope.brandKeyword) {
    const bk = scope.brandKeyword.toLowerCase();
    if (!name.includes(bk) && !String(product.description || "").toLowerCase().includes(bk)) {
      return {
        status: "ineligible",
        reason: "product_missing_documented_brand:" + scope.brandKeyword,
        source: "creative_brand_mention",
      };
    }
  }
  return { status: "pass" };
}

/**
 * @param {{ bindingRow: object, product: object, scope?: object, linkId?: string, couponEval?: object }} ctx
 */
export function evaluateProductBinding(ctx) {
  const bindingRow = ctx.bindingRow;
  const product = ctx.product;
  const scope = ctx.scope || parseCouponScope({ description: bindingRow.offerText, adContent: "" });
  const linkId = String(ctx.linkId || bindingRow.linkId || "");
  const offerText = bindingRow.offerText || scope.offerTextStripped || "";
  const offerSignals = parseOfferMarketAndStore(offerText);
  const productMarket = inferProductMarket(product);
  const cartCondition = parseCartCondition(scope);
  const missingData = missingFieldsForScope(scope, offerText);
  const couponEval = ctx.couponEval || evaluateCouponCzPublish({ bindingRow, scope, linkId });

  const base = {
    eligibility: "unknown",
    eligibilityReason: "",
    eligibilitySource: "",
    missingData: [...missingData],
    cartCondition,
    productMarket,
    offerMarketSignals: offerSignals,
    historicalMatchReason: product.matchReason,
    priorReportStatus: "confirmed",
    couponCzPublish: couponEval,
  };

  const finish = (eligibility, eligibilityReason, eligibilitySource, extra = {}) => {
    const pub = computePublicProductPublishable(eligibility, couponEval);
    return {
      ...base,
      ...extra,
      eligibility,
      eligibilityReason,
      eligibilitySource,
      ...pub,
    };
  };

  if (isGiftVoucherProduct(product)) {
    const exHit = productHitsDocumentedExclusion(product, scope);
    if (exHit?.hit) {
      return finish("ineligible", exHit.term, exHit.source);
    }
    return finish(
      "unknown",
      "gift_voucher_coupon_eligibility_not_documented_exclusion_not_proven",
      "product_name_or_landing_path"
    );
  }

  const exHit = productHitsDocumentedExclusion(product, scope);
  if (exHit?.hit) {
    return finish("ineligible", exHit.term, exHit.source);
  }

  const brand = assessBrandSiteRestriction(product, offerText, scope);
  if (brand.status === "ineligible") {
    return finish("ineligible", brand.reason, brand.source);
  }
  if (brand.status === "unknown") {
    return finish("unknown", brand.reason, brand.source);
  }

  const market = assessMarketFit(offerSignals, productMarket, linkId);
  if (market.status === "ineligible") {
    return finish("ineligible", market.reason, market.source);
  }

  const scopeMatch = assessScopeMatch(product, scope, product);
  if (!scopeMatch.ok) {
    return finish(scopeMatch.status || "ineligible", scopeMatch.reason, scopeMatch.source);
  }

  const exclusionBlocks = (scope.exclusionSpans || []).join(" ").toLowerCase();
  const needsUsedOpenVerification =
    /použit|rozbalen/i.test(exclusionBlocks) || (/použit|rozbalen/i.test(offerText) && scope.scopeType === "full_sortiment_with_exclusions");
  if (needsUsedOpenVerification) {
    return finish(
      "unknown",
      "full_sortiment_exclusion_used_open_box_not_verified_in_feed",
      "creative_exclusion_block",
      { missingData: [...new Set([...base.missingData, "product_condition_used_or_open_box"])] }
    );
  }

  if (/nezlevněn|niesobj/i.test(offerText)) {
    return finish(
      "unknown",
      "sale_or_promo_eligibility_not_in_product_feed",
      "creative_non_discounted_wording",
      { missingData: [...new Set([...base.missingData, "product_sale_or_promo_flag"])] }
    );
  }

  if (market.status === "unknown") {
    return finish("unknown", market.reason, market.source);
  }

  const linkMeta = ctx.linkMeta || bindingRow.linkMeta || {};
  const assoc = assessCouponProductAssociation(product, bindingRow, linkMeta, scope, ctx.refDate || new Date());
  const extraAssoc = {
    affiliateLinkAssessment: assoc.affiliateLink,
    availableEvidence: assoc.availableEvidence,
    missingDecisiveFact: assoc.missingDecisiveFact,
    smallestVerificationStep: assoc.smallestVerificationStep,
  };
  if (assoc.status === "eligible") {
    return finish("eligible", assoc.reason, assoc.source, {
      ...extraAssoc,
      missingDecisiveFact: null,
      smallestVerificationStep: null,
    });
  }
  if (assoc.status === "ineligible") {
    return finish("ineligible", assoc.reason, assoc.source, extraAssoc);
  }

  return finish("unknown", assoc.reason, assoc.source, {
    missingData: [...new Set([...base.missingData, assoc.missingDecisiveFact].filter(Boolean))],
    ...extraAssoc,
  });
}

export function parsePromotionEndMs(endStr) {
  if (!endStr) return null;
  const normalized = String(endStr).trim().replace(" ", "T").replace(/\.0+$/, "");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** Rejects unknown/ineligible in displayProducts and expired coupons. */
export function validatePublicationCard(card, refDate = new Date()) {
  const errors = [];
  const endRaw = card.validity?.promotionEndDate || card.promotionEndDate;
  const startRaw = card.validity?.promotionStartDate || card.promotionStartDate;
  const endMs = parsePromotionEndMs(endRaw);
  const startMs = parsePromotionEndMs(startRaw);
  const now = refDate.getTime();
  if (String(endRaw || "").trim() && endMs === null) {
    errors.push("promotion_end_date_unparseable");
  }
  if (String(startRaw || "").trim() && startMs === null) {
    errors.push("promotion_start_date_unparseable");
  }
  if (!String(endRaw || "").trim()) {
    errors.push("promotion_end_date_missing");
  }
  if (endMs !== null && endMs < now) {
    errors.push("coupon_expired_for_publication");
  }
  if (startMs !== null && startMs > now) {
    errors.push("coupon_not_yet_started_for_publication");
  }
  if (card.couponCzPublish?.czAudiencePublishBlocked) {
    errors.push("coupon_cz_audience_blocked:" + (card.couponCzPublish.publishBlockReason || "blocked"));
  }
  for (const p of card.displayProducts || []) {
    if (p.eligibility === "unknown" || p.eligibility === "ineligible") {
      errors.push("display_product_blocked_eligibility:" + p.productId + ":" + p.eligibility);
    }
    if (p.publicProductBlockPublishable !== true) {
      errors.push("display_product_not_publishable:" + p.productId);
    }
    const land = p.landingIdentity?.status || card.landingIdentity?.status;
    if (land && land !== "pass") {
      errors.push("display_product_landing_not_verified:" + p.productId + ":" + (p.landingIdentity?.reason || card.landingIdentity?.reason || land));
    }
  }
  return { ok: errors.length === 0, errors };
}

export const SHOWCASE_CASE_EXPECTATIONS = {
  "17230066": "unknown_exclusion",
  "17346748": "unknown_voucher",
  "17362632": "market_brand",
  "15443533": "ro_coupon_blocked",
  "15427427": "no_products_selected_models",
  "15427432": "gorenje_mycky",
  "17352117": "wrangler10_all_unknown",
};
