#!/usr/bin/env node
/** Eligibility reclassification for coupon–product rows (no re-bind). */
import { createHash } from "node:crypto";
import {
  assessProductDocumentedExclusions,
  parseCouponScope,
  productMatchesScope,
} from "./iu-cj-affiliate-phase2-coupon-scope.mjs";
import { parseAffiliateClickUrl } from "./iu-cj-affiliate-phase2-product-api.mjs";

function stableDigestSha256(input) {
  return createHash("sha256").update(String(input ?? ""), "utf8").digest("hex");
}

export const IU_CJ_ELIGIBILITY_POLICY = {
  whenUncertainDoNotPublish: true,
  publishRequires: "eligible_at_coupon_and_product_level",
  blockedForPublicProductBlock: ["unknown", "ineligible"],
  rulesVersion: "iu-cj-affiliate-phase2-coupon-eligibility-v2_8",
};

export const STORE_AUTHORITATIVE_EVIDENCE_MIN_CAPTURED_EPOCH_MS = Date.parse("2021-01-01T00:00:00.000Z");

/** Where a prepared whole-sortiment card may appear for infoUzel.cz visitors in CZ. */
export const COUPON_PUBLICATION_TRACK = Object.freeze({
  CZ_STOREFRONT: "cz_storefront_for_cz_visitors",
  FOREIGN_FOR_CZ: "foreign_storefront_for_cz_visitors",
  UNKNOWN_CANDIDATE: "unknown_candidate",
  NOT_FOR_CZ: "not_for_cz_visitors",
});

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
const FULL_SORTIMENT_RE =
  /(?:na\s+v[sš]e(?:\s+z\s+[a-z0-9.-]+)?|v[sš]echny\s+produkty|v[sš]etky\s+produkty|cel[ýy]\s+sortiment)/i;

export function normalizePromotionStoreHost(hostname) {
  return String(hostname || "")
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

/** Exact registrable host match; www-only normalization (no suffix-substring tricks). */
export function promotionStoreHostMatches(productHost, promotionStoreHost) {
  const p = normalizePromotionStoreHost(productHost);
  const s = normalizePromotionStoreHost(promotionStoreHost);
  if (!s) return true;
  if (!p) return false;
  return p === s;
}

export function promotionStoreEvidenceAligned(productHost, promotionStores = []) {
  if (!promotionStores.length) return true;
  return promotionStores.some((store) => promotionStoreHostMatches(productHost, store));
}

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
  if (/theraband/i.test(blocks) && /theraband/i.test(name + " " + desc)) {
    return { hit: true, term: "theraband_in_documented_exclusion", source: "creative_exclusion_block" };
  }
  const exDoc = assessProductDocumentedExclusions(product, scope);
  if (exDoc.status === "ineligible") {
    return { hit: true, term: exDoc.term || exDoc.reason, source: exDoc.source || "creative_exclusion_block" };
  }
  return { hit: false };
}

export function destinationPathMarketHint(destination) {
  try {
    const u = new URL(String(destination));
    const path = u.pathname.toLowerCase();
    if (/\/sk(\/|$)/.test(path)) return "sk";
    if (/\/cz(\/|$)/.test(path)) return "cz";
    return null;
  } catch {
    return null;
  }
}

/** Authoritative storefront market from destination host/path (not inferred from .cz TLD alone for /sk). */
export function destinationAuthoritativeMarket(destination) {
  const pathHint = destinationPathMarketHint(destination);
  if (pathHint === "sk") return "sk";
  if (pathHint === "cz") return "cz";
  try {
    const host = normalizePromotionStoreHost(new URL(String(destination)).hostname);
    if (host.endsWith(".sk")) return "sk";
    if (host.endsWith(".cz")) return "cz";
  } catch {
    /* ignore */
  }
  return null;
}

function registrableStoreKey(host) {
  const h = normalizePromotionStoreHost(host);
  const parts = h.split(".");
  if (parts.length >= 2) return parts.slice(-2).join(".");
  return h;
}

/** Stores named explicitly in creative „na vše z …“ (authoritative for store–destination coherence). */
export function creativeAuthoritativeStoreHosts(offerText) {
  const t = String(offerText || "");
  const stores = [];
  const vseZ = t.match(/na\s+v[sš]e\s+z\s+([a-z0-9-]+\.(?:cz|sk|ro|pl|ie|com))/i);
  if (vseZ) stores.push(normalizePromotionStoreHost(vseZ[1]));
  return [...new Set(stores)];
}

/**
 * One matching store signal must not override a contradictory authoritative pair (creative vs destination).
 */
export function assessOfferStoreDestinationCoherence(offerText, linkMeta = {}) {
  const creative = creativeAuthoritativeStoreHosts(offerText);
  if (!creative.length || !linkMeta.destination) {
    return { blocked: false, coherent: true, source: "not_applicable" };
  }
  let destHost = null;
  try {
    destHost = normalizePromotionStoreHost(new URL(String(linkMeta.destination)).hostname);
  } catch {
    return { blocked: false, coherent: true, source: "destination_unparseable" };
  }
  const destKey = registrableStoreKey(destHost);
  const creativeKeys = creative.map(registrableStoreKey);
  const matching = creativeKeys.filter((k) => k === destKey);
  const contradicting = creativeKeys.filter((k) => k !== destKey);
  if (contradicting.length > 0 && matching.length > 0) {
    return {
      blocked: true,
      coherent: false,
      reason: "creative_store_contradicts_destination_authoritative_pair",
      detail: contradicting.join(",") + "|dest:" + destKey,
      source: "creative_na_vse_z|cj_link_search_destination",
    };
  }
  if (creativeKeys.length > 0 && matching.length === 0) {
    return {
      blocked: true,
      coherent: false,
      reason: "destination_store_not_matching_creative_na_vse_z",
      detail: destKey + "|creative:" + creativeKeys.join(","),
      source: "creative_na_vse_z|cj_link_search_destination",
    };
  }
  return { blocked: false, coherent: true, source: "creative_and_destination_aligned" };
}

function scopeModelListSku(scope) {
  for (const e of scope?.evidence || []) {
    const s = String(e);
    if (s.startsWith("model_list:")) return s.slice("model_list:".length).trim();
  }
  return null;
}

function scopeCategoryPhrase(scope) {
  for (const e of scope?.evidence || []) {
    const s = String(e);
    if (s.startsWith("creative_category_phrase:")) return s.slice("creative_category_phrase:".length).trim();
  }
  return null;
}

export function assessStorefrontIdentity(linkMeta = {}) {
  const pathHint = destinationPathMarketHint(linkMeta.destination);
  const destMarket = destinationAuthoritativeMarket(linkMeta.destination);
  let storeHost = null;
  try {
    storeHost = normalizePromotionStoreHost(new URL(String(linkMeta.destination)).hostname);
  } catch {
    /* ignore */
  }
  return {
    storefrontMarket: destMarket || "unknown",
    storeHost,
    destination: linkMeta.destination || null,
    destinationPathMarketHint: pathHint,
    source: "cj_link_search_destination",
  };
}

export function assessOfferPresentationVariant(linkMeta = {}, offerText = "") {
  const storefront = assessStorefrontIdentity(linkMeta);
  let variant = "foreign_or_mixed_storefront";
  if (storefront.storefrontMarket === "cz") variant = "czech_storefront_offer";
  else if (storefront.storefrontMarket === "sk") variant = "slovak_storefront_offer";
  const sameCodeDifferentStorefront =
    variant === "slovak_storefront_offer" && /AFFIL10/i.test(String(linkMeta.couponCode || ""));
  return {
    variant,
    mustNotPresentAsCzechStoreVariant: variant !== "czech_storefront_offer",
    separateFromSameCouponCodeCzechVariant: sameCodeDifferentStorefront,
    offerTextSample: String(offerText || linkMeta.description || "").slice(0, 120),
    source: "storefront_identity|coupon_link_id",
  };
}

export function assessCouponTargetingForCzVisitors(linkMeta = {}) {
  const tcRaw = String(linkMeta.targetedCountries || "").trim();
  const tc = tcRaw.toUpperCase();
  if (!tc) {
    return { ok: false, reason: "targeted_countries_missing", detail: null, source: "cj_link_search_targeted_countries" };
  }
  if (!tc.includes("CZ")) {
    return { ok: false, reason: "targeted_countries_exclude_cz", detail: tcRaw, source: "cj_link_search_targeted_countries" };
  }
  return { ok: true, reason: "targeted_countries_include_cz", detail: tcRaw, source: "cj_link_search_targeted_countries" };
}

const CZ_TEXT_NEG_DELIVERY = [
  /doručen[ií]?\s+do\s+(?:čr|česk[ée]? republiky|\bcz\b)[^.!\n]{0,40}(?:nen[ií]|nemožn|neplat|vyloučen|not\s+possible|not\s+available)/i,
  /doruč(ení|i)\s+do\s+(?:čr|česk)[^.!\n]{0,20}nen[ií]\s+možn/i,
  /nákup\s+s\s+doručením\s+do\s+čr\s+(není|neplatí|vyloučen)/i,
  /(?:nelze|nemožno|cannot)\s+(?:doručit|dodat|deliver|ship)[^.!\n]{0,40}(?:čr|česk|czech|\bcz\b)/i,
  /doručen[ií]?\s+pouze\s+na\s+slovensko/i,
  /doruč[^.!\n]{0,30}pouze[^.!\n]{0,25}slovensko/i,
];
const CZ_TEXT_NEG_COUPON_VALIDITY = [
  /kup[oó]n\s+neplat[ií]\s+v\s+(?:čr|česk|\bcz\b)/i,
  /k[oó]d\s+neplat[ií]\s+v\s+(?:čr|česk|\bcz\b)/i,
  /akc[eie]\s+neplat[ií]\s+v\s+(?:čr|česk|\bcz\b)/i,
  /(?:coupon|offer)\s+not\s+valid\s+in\s+czech/i,
  /plat[ií]\s+(?:pouze|jen|only)\s+(?:na\s+)?slovensko/i,
  /pouze\s+(?:pro\s+)?slovensko|only\s+slovakia|iba\s+(?:pre\s+)?slovensko/i,
];
const CZ_TEXT_POS_DELIVERY = [
  /doručen[ií]?\s+do\s+(?:čr|česk[ée]? republiky|\bcz\b)(?![^.!\n]{0,30}(?:nen[ií]|nemožn|neplat))/i,
  /doručen[ií]?\s+do\s+(?:čr|česk[ée]? republiky|\bcz\b)[^.!\n]{0,30}možn/i,
  /dodán[ií]?\s+do\s+(?:čr|česk)/i,
  /zasíl[aá]me?\s+do\s+(?:čr|česk)/i,
  /shipping\s+to\s+czech/i,
  /deliver(y)?\s+to\s+czech/i,
];
const CZ_TEXT_POS_SERVICE = [
  /dostupn[éeo]\s+v\s+(?:čr|cz)/i,
  /pro\s+zákazníky\s+v\s+(?:čr|cz)/i,
  /plat[ií]\s+v\s+(?:čr|cz)(?![^.!\n]{0,20}neplat)/i,
];

function firstMatchingPattern(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return { hit: true, match: m[0], pattern: re.source };
  }
  return { hit: false };
}

/** Creative-only signals; negatives override positives in the same text. */
export function assessCreativeCzAccessSignals(offerText = "", linkMeta = {}) {
  const text = [offerText, linkMeta.description, linkMeta.adContent].filter(Boolean).join(" ");
  const negDelivery = firstMatchingPattern(text, CZ_TEXT_NEG_DELIVERY);
  const negCoupon = firstMatchingPattern(text, CZ_TEXT_NEG_COUPON_VALIDITY);
  const posDelivery = firstMatchingPattern(text, CZ_TEXT_POS_DELIVERY);
  const posService = firstMatchingPattern(text, CZ_TEXT_POS_SERVICE);
  if (negDelivery.hit || negCoupon.hit) {
    const contradictoryPositive =
      (negDelivery.hit && (posDelivery.hit || posService.hit)) ||
      (negCoupon.hit && (posDelivery.hit || posService.hit));
    return {
      state: "excluded",
      documented: true,
      blocked: true,
      reason: negCoupon.hit ? "explicit_coupon_not_valid_in_cz" : "explicit_cz_delivery_exclusion",
      contradictoryCreativeWording: contradictoryPositive,
      source: "cj_link_search_description_adcontent",
      matchedPhrase: (negCoupon.hit ? negCoupon.match : negDelivery.match) || null,
      dimension: negCoupon.hit ? "coupon_validity_in_cz" : "delivery_to_cz",
      note: contradictoryPositive ? "negative_cz_wording_overrides_positive_substring" : undefined,
    };
  }
  if (posDelivery.hit || posService.hit) {
    return {
      state: "creative_hint_only",
      documented: false,
      blocked: false,
      reason: "creative_cz_access_wording_not_authoritative_alone",
      source: "cj_link_search_description_adcontent",
      matchedPhrase: (posDelivery.hit ? posDelivery.match : posService.match) || null,
      dimension: posDelivery.hit ? "delivery_to_cz" : "service_in_cz",
    };
  }
  if (/doruč|dodán|deliver|shipping/i.test(text) && /(?:možn|available|unclear|nejas)/i.test(text)) {
    return {
      state: "unknown",
      documented: false,
      blocked: false,
      reason: "cz_delivery_wording_ambiguous",
      source: "cj_link_search_description_adcontent",
    };
  }
  return {
    state: "unknown",
    documented: false,
    blocked: false,
    reason: "cz_access_not_stated_in_creative",
    source: "cj_link_search_description_adcontent",
  };
}

function destinationStoreHostKey(linkMeta = {}) {
  if (!linkMeta.destination) return null;
  try {
    return registrableStoreKey(normalizePromotionStoreHost(new URL(String(linkMeta.destination)).hostname));
  } catch {
    return null;
  }
}

function domainMentionInSource(sourceText, hostKey) {
  const s = String(sourceText || "").toLowerCase();
  const m = s.match(/([a-z0-9-]+\.(?:cz|sk|ro|pl|ie|com|eu))/gi) || [];
  if (!m.length) return null;
  const keys = m.map((h) => registrableStoreKey(normalizePromotionStoreHost(h)));
  return keys;
}

/** Separate authoritative store substrate (not checkout); validated origin, storefront, content, time. */
export function assessStoreAuthoritativeCzCustomerAccess(linkMeta = {}, refDate = new Date()) {
  const ev = linkMeta.storeAuthoritativeEvidence || linkMeta.partnerStoreCzAccess || null;
  if (!ev || typeof ev !== "object") {
    return {
      state: "unknown",
      documented: false,
      blocked: false,
      reason: "store_authoritative_cz_access_missing",
      source: "stored_partner_store_evidence",
    };
  }
  if (ev.explicitCzExcluded === true) {
    return {
      state: "excluded",
      documented: true,
      blocked: true,
      reason: "store_authoritative_explicit_cz_exclusion",
      source: ev.source || "stored_partner_store_evidence",
      capturedAt: ev.capturedAt || null,
      scope: ev.scope || null,
    };
  }
  const destKey = destinationStoreHostKey(linkMeta);
  const unknownIncomplete = (reason, detail = null) => ({
    state: "unknown",
    documented: false,
    blocked: false,
    reason,
    source: "stored_partner_store_evidence",
    detail,
  });
  const source = String(ev.source || "").trim();
  if (source.length < 4) {
    return unknownIncomplete("store_authoritative_source_missing_or_too_short");
  }
  const capturedRaw = String(ev.capturedAt || "").trim();
  const capturedMs = Date.parse(capturedRaw);
  if (!capturedRaw || Number.isNaN(capturedMs)) {
    return unknownIncomplete("store_authoritative_captured_at_unparseable");
  }
  if (capturedMs < STORE_AUTHORITATIVE_EVIDENCE_MIN_CAPTURED_EPOCH_MS) {
    return unknownIncomplete("store_authoritative_captured_at_before_minimum_epoch");
  }
  if (capturedMs > refDate.getTime() + 60000) {
    return unknownIncomplete("store_authoritative_captured_at_in_future");
  }
  const contentSummary = String(ev.contentSummary || ev.summary || "").trim();
  if (contentSummary.length < 12) {
    return unknownIncomplete("store_authoritative_content_summary_missing");
  }
  const contentCreative = assessCreativeCzAccessSignals(contentSummary, {});
  if (contentCreative.blocked) {
    return {
      state: "excluded",
      documented: true,
      blocked: true,
      reason: "store_authoritative_content_explicit_cz_exclusion",
      source: "stored_partner_store_evidence",
      contentExclusion: {
        matchedPhrase: contentCreative.matchedPhrase,
        dimension: contentCreative.dimension,
        reason: contentCreative.reason,
      },
      capturedAt: capturedRaw || null,
      storefrontHost: ev.storefrontHost || ev.storeHost || null,
    };
  }
  const posDelivery = firstMatchingPattern(contentSummary, CZ_TEXT_POS_DELIVERY);
  const posService = firstMatchingPattern(contentSummary, CZ_TEXT_POS_SERVICE);
  const confirmsCz =
    posDelivery.hit ||
    posService.hit ||
    /doručen[ií]?\s+do\s+(?:čr|česk[ée]? republiky|\bcz\b)[^.!\n]{0,40}(?:je\s+)?možn/i.test(contentSummary) ||
    /(?:doruč|dodán)[^.!\n]{0,50}(?:česk[ée]? republiky|\bčr\b|\bcz\b)/i.test(contentSummary);
  if (!confirmsCz) {
    return unknownIncomplete("store_authoritative_content_missing_cz_delivery_confirmation");
  }
  if (ev.documentsCzDeliveryOrService !== true) {
    return unknownIncomplete("store_authoritative_flag_not_documented");
  }
  if (contentCreative.contradictoryCreativeWording) {
    return unknownIncomplete("store_authoritative_content_contradictory_cz_wording");
  }
  const evStoreHost = String(ev.storefrontHost || ev.storeHost || "").trim();
  if (!evStoreHost) {
    return unknownIncomplete("store_authoritative_storefront_host_missing");
  }
  const evStoreKey = registrableStoreKey(normalizePromotionStoreHost(evStoreHost));
  if (destKey && evStoreKey !== destKey) {
    return unknownIncomplete("store_authoritative_storefront_host_mismatch", destKey + "|ev:" + evStoreKey);
  }
  const sourceDomains = domainMentionInSource(source, destKey);
  if (sourceDomains && destKey) {
    const foreignOnly = sourceDomains.filter((k) => k !== destKey);
    if (foreignOnly.length > 0 && !sourceDomains.includes(destKey)) {
      return unknownIncomplete("store_authoritative_source_store_mismatch", foreignOnly.join(","));
    }
  }
  if (ev.scope && destKey && typeof ev.scope === "string") {
    const scopeLower = ev.scope.toLowerCase();
    if (/^[a-z0-9.-]+\.(cz|sk|ro|pl|ie|com)$/i.test(scopeLower)) {
      const scopeKey = registrableStoreKey(normalizePromotionStoreHost(scopeLower));
      if (scopeKey !== destKey) {
        return unknownIncomplete("store_authoritative_scope_store_mismatch");
      }
    }
  }
  return {
    state: "documented",
    documented: true,
    blocked: false,
    reason: "store_authoritative_cz_delivery_or_service",
    source,
    capturedAt: capturedRaw,
    scope: ev.scope || null,
    storefrontHost: evStoreHost,
    contentSummary: contentSummary.slice(0, 200),
  };
}

export function assessCzCustomerAvailability(offerText = "", linkMeta = {}, storefrontMarket = "unknown", refDate = new Date()) {
  const creative = assessCreativeCzAccessSignals(offerText, linkMeta);
  const store = assessStoreAuthoritativeCzCustomerAccess(linkMeta, refDate);
  if (creative.blocked) {
    return { ...creative, channel: "creative", creative, store };
  }
  if (store.blocked) {
    return { ...store, channel: "store_authoritative", creative, store };
  }
  if (storefrontMarket === "cz") {
    return {
      state: "same_storefront_market",
      documented: true,
      blocked: false,
      reason: "cz_storefront_default_for_cz_visitors",
      source: "cj_link_search_destination",
      channel: "storefront_identity",
      creative,
      store,
    };
  }
  if (store.state === "documented") {
    return { ...store, channel: "store_authoritative", creative, store };
  }
  if (creative.state === "unknown") {
    return {
      state: "unknown",
      documented: false,
      blocked: false,
      reason: "cz_customer_access_requires_store_authoritative_evidence",
      source: "stored_partner_store_evidence",
      channel: "missing_store_substrate",
      creative,
      store,
      missingDecisiveFact: "store_authoritative_cz_delivery_or_service",
    };
  }
  return {
    state: "unknown",
    documented: false,
    blocked: false,
    reason: "creative_hint_insufficient_without_store_authoritative_evidence",
    source: "iu_requires_authoritative_delivery_proof",
    channel: "creative_only_not_sufficient",
    creative,
    store,
    missingDecisiveFact: "store_authoritative_cz_delivery_or_service",
  };
}

export function composeCouponPublicationContext(offerText = "", linkMeta = {}, refDate = new Date()) {
  const storefront = assessStorefrontIdentity(linkMeta);
  const presentation = assessOfferPresentationVariant(linkMeta, offerText);
  const targeting = assessCouponTargetingForCzVisitors(linkMeta);
  const availability = assessCzCustomerAvailability(offerText, linkMeta, storefront.storefrontMarket, refDate);
  const explicitCouponOrDeliveryBlock = availability.blocked === true;
  return {
    storefront,
    presentation,
    targeting,
    availability,
    targetingNote: "targetedCountries_is_not_automatic_cz_delivery_ban",
    explicitExclusion: explicitCouponOrDeliveryBlock
      ? { blocked: true, reason: availability.reason, source: availability.source }
      : { blocked: false, reason: "" },
  };
}

/**
 * Audience for CZ-site publication: separates storefront identity from CZ delivery proof (foreign shops allowed).
 */
export function assessCouponCzAudienceDocumented(linkMeta = {}, offerText = "", refDate = new Date()) {
  const ctx = composeCouponPublicationContext(offerText, linkMeta, refDate);
  const { storefront, presentation, targeting, availability, territorial } = ctx;
  if (availability.blocked) {
    return {
      documented: false,
      blocked: true,
      reason: availability.reason,
      source: availability.source,
      ...ctx,
    };
  }
  if (storefront.storefrontMarket !== "cz") {
    if (availability.state === "unknown") {
      return {
        documented: false,
        blocked: false,
        reason: availability.reason,
        source: availability.source,
        publicationTrackHint: COUPON_PUBLICATION_TRACK.UNKNOWN_CANDIDATE,
        ...ctx,
      };
    }
    return {
      documented: true,
      blocked: false,
      reason: "foreign_storefront_with_documented_cz_customer_availability",
      source: availability.source,
      publicationTrackHint: COUPON_PUBLICATION_TRACK.FOREIGN_FOR_CZ,
      ...ctx,
    };
  }
  if (!targeting.ok) {
    return {
      documented: false,
      blocked: true,
      reason: targeting.reason,
      detail: targeting.detail,
      source: targeting.source,
      ...ctx,
    };
  }
  return {
    documented: true,
    blocked: false,
    reason: "czech_storefront_offer_for_cz_visitors",
    source: "cj_link_search_destination|targeted_countries",
    publicationTrackHint: COUPON_PUBLICATION_TRACK.CZ_STOREFRONT,
    presentation,
    storefront,
    targeting,
    availability: { state: "same_storefront_market", documented: true, blocked: false, reason: "cz_storefront_default" },
  };
}

export function buildOfferEvidenceBundle(offerText, linkMeta = {}) {
  const t = String(offerText || "");
  const lower = t.toLowerCase();
  const stores = [];
  const sources = [];
  const markets = [];
  const pathHint = destinationPathMarketHint(linkMeta.destination);

  const vseZ = t.match(/na\s+v[sš]e\s+z\s+([a-z0-9-]+\.(?:cz|sk|ro|pl|ie|com))/i);
  if (vseZ) {
    stores.push(vseZ[1].toLowerCase());
    sources.push("cj_link_search_description_adcontent_na_vse_z");
  } else {
    const creativeStore = t.match(/(?:^|[\s(])([a-z0-9-]+\.cz)(?:[\s),]|$)/i);
    if (creativeStore) {
      stores.push(creativeStore[1].toLowerCase());
      sources.push("cj_link_search_description_adcontent");
    }
  }
  if (linkMeta.destination) {
    try {
      const u = new URL(String(linkMeta.destination));
      const dh = u.hostname.toLowerCase();
      if (dh && !stores.includes(dh)) stores.push(dh);
      sources.push("cj_link_search_destination");
    } catch {
      /* ignore */
    }
  }
  const tc = String(linkMeta.targetedCountries || "").toUpperCase();
  const destMarket = destinationAuthoritativeMarket(linkMeta.destination);
  if (tc.includes("SK")) markets.push("sk");
  if (destMarket === "sk") {
    if (!markets.includes("sk")) markets.push("sk");
  } else if (tc.includes("CZ")) {
    markets.push("cz");
  }
  if (pathHint === "cz" && !markets.includes("cz") && destMarket !== "sk") markets.push("cz");

  const fullSortiment = FULL_SORTIMENT_RE.test(lower);
  return {
    stores: [...new Set(stores)],
    markets: [...new Set(markets)],
    sources: [...new Set(sources)],
    fullSortiment,
    destinationPathMarketHint: pathHint,
    targetedCountries: linkMeta.targetedCountries || null,
    couponLinkId: linkMeta.linkId ? String(linkMeta.linkId) : null,
    couponCode: linkMeta.couponCode ? String(linkMeta.couponCode) : null,
    validity: {
      promotionStartDate: linkMeta.promotionStartDate || null,
      promotionEndDate: linkMeta.promotionEndDate || null,
    },
  };
}

function promotionDocumentsPartnerStoreAndScope(offerText, linkMeta = {}) {
  const bundle = buildOfferEvidenceBundle(offerText, linkMeta);
  const audience = assessCouponCzAudienceDocumented(linkMeta, offerText);
  const storefront = audience.storefront || assessStorefrontIdentity(linkMeta);
  if (audience.blocked) {
    return {
      documented: false,
      reason: audience.reason,
      source: audience.source,
      evidenceBundle: bundle,
      czAudience: audience,
    };
  }
  if (storefront.storefrontMarket !== "cz" && audience.availability?.state !== "documented" && audience.availability?.state !== "same_storefront_market") {
    return {
      documented: false,
      reason: audience.availability?.reason || "cz_customer_delivery_or_service_not_documented",
      source: audience.availability?.source || "iu_requires_authoritative_delivery_proof",
      evidenceBundle: bundle,
      czAudience: audience,
      missingDecisiveFact: audience.availability?.missingDecisiveFact || "store_authoritative_cz_delivery_or_service",
    };
  }
  const namedStore = bundle.stores.length > 0;
  if (namedStore && bundle.fullSortiment) {
    const via = bundle.sources.includes("cj_link_search_destination")
      ? "creative_plus_link_destination"
      : "creative_text";
    const storeKind = storefront.storefrontMarket === "cz" ? "cz_store" : "partner_store";
    return {
      documented: true,
      reason: "full_sortiment_promotion_with_" + storeKind + ":" + via,
      source: bundle.sources.join("|") || "cj_link_search",
      evidenceBundle: bundle,
      czAudience: audience,
    };
  }
  const scopePeek = parseCouponScope({
    description: offerText,
    adContent: linkMeta.adContent,
    destination: linkMeta.destination,
  });
  const modelEvidence = (scopePeek.evidence || []).filter((e) => e.startsWith("model_list:"));
  if (
    namedStore &&
    modelEvidence.length > 0 &&
    (scopePeek.scopeType === "selected_models" || scopePeek.scopeType === "category_or_subset_restricted")
  ) {
    return {
      documented: true,
      reason: "limited_model_promotion_with_partner_store:" + modelEvidence[0],
      source: (bundle.sources.join("|") || "cj_link_search") + "|" + scopePeek.source,
      evidenceBundle: bundle,
      czAudience: audience,
      documentedScope: scopePeek,
    };
  }
  return {
    documented: false,
    reason: "promotion_partner_store_or_action_scope_not_documented",
    source: "iu_eligibility_rules_v2_1",
    evidenceBundle: bundle,
    czAudience: audience,
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
  const promoDoc = promotionDocumentsPartnerStoreAndScope(offerText, linkMeta);
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

  const storeAligned = promotionStoreEvidenceAligned(productHost, bundle.stores);
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

  const audience = assessCouponCzAudienceDocumented(linkMeta, offerText);
  if (audience.blocked && audience.targeting?.reason === "targeted_countries_exclude_cz") {
    return {
      status: "unknown",
      reason: audience.reason,
      source: audience.source,
      availableEvidence,
      affiliateLink,
      missingDecisiveFact: audience.reason,
      smallestVerificationStep: "Confirm coupon targeting for CZ visitors",
    };
  }
  if (audience.blocked && audience.availability?.blocked) {
    return {
      status: "unknown",
      reason: audience.reason,
      source: audience.source,
      availableEvidence,
      affiliateLink,
      missingDecisiveFact: audience.reason,
      smallestVerificationStep: "Confirm coupon territorial conditions in authoritative creative",
    };
  }

  const storeCoherence = assessOfferStoreDestinationCoherence(offerText, linkMeta);
  if (storeCoherence.blocked) {
    return {
      status: "unknown",
      reason: storeCoherence.reason,
      source: storeCoherence.source,
      availableEvidence,
      affiliateLink,
      missingDecisiveFact: storeCoherence.detail || storeCoherence.reason,
      smallestVerificationStep: "Align link-search destination with creative store naming",
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
  const listedSku = scopeModelListSku(scope);
  if (listedSku) {
    if (String(product.productId) !== String(listedSku)) {
      return {
        status: "ineligible",
        reason: "product_id_not_in_documented_model_list",
        source: "creative_model_list",
        availableEvidence,
        affiliateLink,
        missingDecisiveFact: null,
        smallestVerificationStep: null,
      };
    }
    return {
      status: "eligible",
      reason: "documented_authoritative_sku_in_offer_model_list",
      source: "creative_model_list|product_feed",
      availableEvidence,
      affiliateLink,
      missingDecisiveFact: null,
      smallestVerificationStep: null,
    };
  }

  const catPhrase = scopeCategoryPhrase(scope);
  if (catPhrase && (scopeType.includes("category") || scopeType.includes("subset"))) {
    const gpc = String(product.googleProductCategory || "").toLowerCase();
    const kw = catPhrase.toLowerCase();
    if (gpc && gpc.includes(kw)) {
      return {
        status: "eligible",
        reason: "documented_category_matches_product_google_category",
        source: "creative_category_phrase|product_feed",
        availableEvidence,
        affiliateLink,
        missingDecisiveFact: null,
        smallestVerificationStep: null,
      };
    }
    return {
      status: "unknown",
      reason: "documented_category_not_proven_on_product_attributes",
      source: "creative_category_phrase|product_feed",
      availableEvidence,
      affiliateLink,
      missingDecisiveFact: "structured_product_category",
      smallestVerificationStep: "Match feed googleProductCategory to documented category phrase",
    };
  }

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
    const exDoc = assessProductDocumentedExclusions(product, scope || parseCouponScope({ description: offerText }));
    if (exDoc.status === "ineligible") {
      return {
        status: "ineligible",
        reason: exDoc.reason,
        source: exDoc.source,
        availableEvidence,
        affiliateLink,
        missingDecisiveFact: null,
        smallestVerificationStep: null,
      };
    }
    if (exDoc.status === "unknown") {
      return {
        status: "unknown",
        reason: exDoc.reason,
        source: exDoc.source,
        availableEvidence,
        affiliateLink,
        missingDecisiveFact: exDoc.reason,
        smallestVerificationStep: "Verify product attributes against documented exclusion categories",
      };
    }
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

  const refDate = ctx.refDate || new Date();
  const pubCtx = composeCouponPublicationContext(offerText, linkMeta, refDate);
  const audience = assessCouponCzAudienceDocumented(linkMeta, offerText, refDate);

  if (!pubCtx.targeting.ok && pubCtx.targeting.reason === "targeted_countries_exclude_cz") {
    return {
      ...base,
      czCouponPublishEligibility: "unknown",
      czAudiencePublishBlocked: false,
      publicationTrack: COUPON_PUBLICATION_TRACK.UNKNOWN_CANDIDATE,
      publishBlockReason: "targeting_sk_only_not_explicit_cz_coupon_or_delivery_proof:" + (pubCtx.targeting.detail || ""),
      publishBlockSource: pubCtx.targeting.source,
      czAudienceAssessment: audience,
      publicationContext: pubCtx,
      missingDecisiveFact: "explicit_coupon_territorial_condition_or_cz_targeting",
      note: "targeting_countries_not_automatic_cz_delivery_ban",
    };
  }

  if (audience.blocked && pubCtx.explicitExclusion?.blocked) {
    return {
      ...base,
      czCouponPublishEligibility: "unknown",
      publicationTrack: COUPON_PUBLICATION_TRACK.NOT_FOR_CZ,
      czAudiencePublishBlocked: true,
      publishBlockReason: audience.reason,
      publishBlockSource: audience.source,
      czAudienceAssessment: audience,
      publicationContext: pubCtx,
      missingDecisiveFact: audience.reason,
    };
  }

  const storeCoherence = assessOfferStoreDestinationCoherence(offerText, linkMeta);
  if (storeCoherence.blocked) {
    return {
      ...base,
      publishBlockReason: storeCoherence.reason + (storeCoherence.detail ? ":" + storeCoherence.detail : ""),
      publishBlockSource: storeCoherence.source,
      czAudienceAssessment: audience,
      storeDestinationCoherence: storeCoherence,
      publicationContext: pubCtx,
    };
  }

  const promoDoc = promotionDocumentsPartnerStoreAndScope(offerText, linkMeta);
  if (promoDoc.documented) {
    const time = assessPromotionTimeActive(linkMeta, ctx.refDate || new Date());
    if (time.active !== true) {
      return {
        ...base,
        publishBlockReason: time.reason,
        publishBlockSource: "cj_link_search_promotion_dates",
        promotionTimeState: time.state,
        publicationContext: pubCtx,
      };
    }
    const track =
      pubCtx.storefront.storefrontMarket === "cz"
        ? COUPON_PUBLICATION_TRACK.CZ_STOREFRONT
        : COUPON_PUBLICATION_TRACK.FOREIGN_FOR_CZ;
    return {
      ...base,
      czCouponPublishEligibility: "eligible",
      czAudiencePublishBlocked: false,
      publishBlockReason: "",
      publishBlockSource: "",
      couponPublishReason: promoDoc.reason,
      couponPublishSource: promoDoc.source,
      offerEvidenceBundle: promoDoc.evidenceBundle,
      czAudienceAssessment: audience,
      publicationTrack: track,
      presentationVariant: pubCtx.presentation.variant,
      presentAsCzechStoreVariant: pubCtx.presentation.variant === "czech_storefront_offer",
      storefrontIdentity: pubCtx.storefront,
      czCustomerAvailability: pubCtx.availability,
      note: "coupon_only_gate; product_rows_still_require_sku_association_proof",
    };
  }

  if (
    pubCtx.storefront.storefrontMarket !== "cz" &&
    pubCtx.availability.state === "unknown" &&
    promoDoc.missingDecisiveFact
  ) {
    return {
      ...base,
      czCouponPublishEligibility: "unknown",
      czAudiencePublishBlocked: false,
      publicationTrack: COUPON_PUBLICATION_TRACK.UNKNOWN_CANDIDATE,
      publishBlockReason: promoDoc.reason,
      publishBlockSource: promoDoc.source,
      czAudienceAssessment: audience,
      publicationContext: pubCtx,
      presentationVariant: pubCtx.presentation.variant,
      presentAsCzechStoreVariant: false,
      storefrontIdentity: pubCtx.storefront,
      czCustomerAvailability: pubCtx.availability,
      missingDecisiveFact: promoDoc.missingDecisiveFact,
      smallestVerificationStep: "Document CZ delivery/service in link-search creative or partner terms",
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

  if (reason === "full_sortiment_scope" || reason.includes("full_sortiment")) {
    const pm = productMatchesScope(product, scope, scope.offerTextRaw || scope.offerTextStripped || "");
    if (pm.scopeStatus === "unknown") {
      return {
        ok: false,
        status: "unknown",
        reason: pm.reason || "exclusion_not_verified",
        source: "creative_exclusion_block",
      };
    }
    if (pm.match === false) {
      return {
        ok: false,
        status: "ineligible",
        reason: pm.reason || "product_in_documented_exclusion_zone",
        source: "creative_exclusion_block",
      };
    }
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
    productId: product.productId != null ? String(product.productId) : null,
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

  const exDoc = assessProductDocumentedExclusions(product, scope);
  if (exDoc.status === "ineligible") {
    return finish("ineligible", exDoc.reason, exDoc.source, { exclusionTerm: exDoc.term });
  }
  if (exDoc.status === "unknown") {
    return finish("unknown", exDoc.reason, exDoc.source, {
      missingData: [...new Set([...base.missingData, "product_exclusion_category_proof"])],
    });
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

/** Fingerprint of coupon offer action fields (not product identity). */
export function computeOfferActionLinkageFingerprint(linkMeta = {}, bindingRow = {}, scope = null) {
  let sc = scope || bindingRow.scope || null;
  if (!sc && bindingRow.offerText) {
    sc = parseCouponScope({
      description: bindingRow.offerText,
      adContent: bindingRow.adContent || "",
      destination: linkMeta.destination,
    });
  }
  const scopeType = sc?.scopeType || "";
  const exclusions = [...(sc?.exclusionSpans || [])].map((s) => String(s).trim()).sort();
  const cart = parseCartCondition(sc);
  const cartKey = cart ? [cart.type, cart.amount, cart.currency].join(":") : "";
  const scopeEvidence = [...(sc?.evidence || [])].slice().sort();
  const fullOfferSubstrate = String(
    sc?.offerTextRaw || sc?.offerTextStripped || bindingRow.offerText || linkMeta.description || ""
  );
  const offerSubstrateDigest = stableDigestSha256(fullOfferSubstrate);
  const structuredConditions = {
    scopeType,
    cartKey,
    exclusions,
    scopeEvidence,
    categoryKeywords: [...(sc?.categoryKeywords || [])].map(String).sort(),
    brandKeyword: sc?.brandKeyword ? String(sc.brandKeyword) : "",
    targetStoreHost: sc?.targetStoreHost ? String(sc.targetStoreHost) : "",
  };
  const structuredConditionsDigest = stableDigestSha256(JSON.stringify(structuredConditions));
  return [
    String(linkMeta.linkId || bindingRow.linkId || ""),
    String(linkMeta.destination || ""),
    String(linkMeta.couponCode || bindingRow.couponCode || ""),
    String(linkMeta.promotionStartDate || bindingRow.validity?.promotionStartDate || ""),
    String(linkMeta.promotionEndDate || bindingRow.validity?.promotionEndDate || ""),
    String(linkMeta.websitePid || ""),
    offerSubstrateDigest,
    structuredConditionsDigest,
  ].join("|");
}

export function parsePromotionEndMs(endStr) {
  if (!endStr) return null;
  const normalized = String(endStr).trim().replace(" ", "T").replace(/\.0+$/, "");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export const COUPON_PUBLICATION_CARD_TYPE = {
  WHOLE_SORTIMENT_PARTNER: "whole_sortiment_partner_coupon",
  LIMITED_SORTIMENT: "limited_sortiment_coupon",
};

/** Separates product-exclusion scope, minimum-order rules, and store/market targeting for card copy. */
export function buildCouponCardPresentation(scope, couponEval = {}, linkMeta = {}) {
  const cart = parseCartCondition(scope);
  const exclusions = scope?.exclusionSpans || [];
  const hasProductExclusions = exclusions.length > 0;
  const sortimentScopeKind = hasProductExclusions
    ? "whole_sortiment_with_product_exclusions"
    : "whole_sortiment_without_product_exclusions";
  const minimumOrderLine = cart
    ? "Minimální objednávka: " + cart.amount + " " + cart.currency + " (podmínka košíku, ne výjimka sortimentu)"
    : null;
  const exclusionLine = hasProductExclusions ? "Výjimky z produktového sortimentu: " + exclusions.join(" · ") : null;
  const offerText = scope?.offerTextStripped || linkMeta.description || "";
  const audience = couponEval.czAudienceAssessment || assessCouponCzAudienceDocumented(linkMeta, offerText);
  const presentation =
    couponEval.presentationVariant ||
    audience.presentation?.variant ||
    assessOfferPresentationVariant(linkMeta, offerText).variant;
  const isForeign = presentation !== "czech_storefront_offer";
  const sortimentLabel = isForeign ? "Celý sortiment partnerského obchodu (zahraniční storefront)" : "Celý sortiment obchodu";
  const proposedCardScopeLabel = hasProductExclusions
    ? sortimentLabel + " · " + (exclusionLine || "")
    : sortimentLabel + (minimumOrderLine ? " · " + minimumOrderLine : "");
  return {
    sortimentScopeKind,
    minimumOrderCondition: cart,
    minimumOrderLine,
    productExclusionLines: exclusions,
    exclusionLine,
    presentationVariant: presentation,
    presentAsCzechStoreVariant: !isForeign,
    priceDisplayNote: "Cena, sleva a minimální objednávka v původní měně kupónu",
    storeAndMarket: {
      storeHosts: couponEval.offerEvidenceBundle?.stores || [],
      targetedCountries: linkMeta.targetedCountries || couponEval.offerEvidenceBundle?.targetedCountries || null,
      destination: linkMeta.destination || null,
      storefrontIdentity: couponEval.storefrontIdentity || audience.storefront || assessStorefrontIdentity(linkMeta),
      czCustomerAvailability: couponEval.czCustomerAvailability || audience.availability || null,
      destinationPathMarketHint:
        destinationPathMarketHint(linkMeta.destination) ||
        couponEval.offerEvidenceBundle?.destinationPathMarketHint ||
        null,
      czAudience: audience,
    },
    proposedCardScopeLabel,
    noteWholeSortimentNotNoMinimumOrder:
      "Celý sortiment neznamená bez minimální objednávky; košík a produktové výjimky jsou oddělené dimenze.",
  };
}

/**
 * Type A = documented whole sortiment for a named partner store (not from „na vše“ alone).
 * Type B = subset/category/brand/models or missing partner whole-sortiment proof.
 */
export function classifyCouponPublicationCardType(scope, couponEval, offerText = "", linkMeta = {}) {
  const st = scope?.scopeType || "unknown";
  const text = String(offerText || scope?.offerTextStripped || "");
  const stores = couponEval?.offerEvidenceBundle?.stores || [];
  const hasNamedStore =
    Boolean(scope?.targetStoreHost) || stores.some((s) => /\.(cz|sk|com|eu)$/i.test(String(s)));

  if (couponEval?.czCouponPublishEligibility !== "eligible") {
    return {
      type: COUPON_PUBLICATION_CARD_TYPE.LIMITED_SORTIMENT,
      reason: "coupon_assessment_not_explicitly_eligible",
    };
  }
  if (
    /vybran[ée]\s+modely/i.test(text) ||
    st.includes("subset") ||
    st.includes("category_or") ||
    st === "brand_restricted" ||
    st === "category_restricted" ||
    st === "cart_rule_second_item" ||
    (st === "site_restricted" && !st.includes("full"))
  ) {
    return {
      type: COUPON_PUBLICATION_CARD_TYPE.LIMITED_SORTIMENT,
      reason: "documented_limited_scope_requires_eligible_product_row",
    };
  }
  const wholePartnerScope =
    st === "full_sortiment_site_restricted" ||
    st === "full_sortiment_with_exclusions" ||
    st === "full_sortiment_with_selected_models_note";
  if (wholePartnerScope && hasNamedStore) {
    return {
      type: COUPON_PUBLICATION_CARD_TYPE.WHOLE_SORTIMENT_PARTNER,
      reason: "documented_partner_whole_sortiment_offer",
      cardMetadata: {
        futureHighlightEligible: true,
        documentedExclusionCount: (scope?.exclusionSpans || []).length,
        targetStoreHost: scope?.targetStoreHost || stores[0] || null,
        minimumOrderCondition: parseCartCondition(scope),
        cardPresentation: buildCouponCardPresentation(scope, couponEval, linkMeta),
      },
    };
  }
  if (st === "full_sortiment" && hasNamedStore) {
    return {
      type: COUPON_PUBLICATION_CARD_TYPE.WHOLE_SORTIMENT_PARTNER,
      reason: "full_sortiment_with_named_store_evidence",
      cardMetadata: {
        futureHighlightEligible: true,
        targetStoreHost: scope?.targetStoreHost || stores[0] || null,
        minimumOrderCondition: parseCartCondition(scope),
        cardPresentation: buildCouponCardPresentation(scope, couponEval, linkMeta),
      },
    };
  }
  if (/na\s+v[sš]e/i.test(text) && !hasNamedStore) {
    return {
      type: COUPON_PUBLICATION_CARD_TYPE.LIMITED_SORTIMENT,
      reason: "na_vse_wording_without_partner_store_proof",
    };
  }
  return {
    type: COUPON_PUBLICATION_CARD_TYPE.LIMITED_SORTIMENT,
    reason: "scope_requires_concrete_eligible_display_item",
  };
}

function promotionValidityFromCard(card) {
  return {
    promotionStartDate:
      card.validity?.promotionStartDate ||
      card.promotionStartDate ||
      card.linkMeta?.promotionStartDate ||
      null,
    promotionEndDate:
      card.validity?.promotionEndDate ||
      card.promotionEndDate ||
      card.linkMeta?.promotionEndDate ||
      null,
  };
}

/** Rejects unknown/ineligible in displayProducts and expired coupons. */
export function validatePublicationCard(card, refDate = new Date()) {
  const errors = [];
  const validityMerged = promotionValidityFromCard(card);
  const endRaw = validityMerged.promotionEndDate;
  const startRaw = validityMerged.promotionStartDate;
  const cardType =
    card.publicationCardType ||
    (card.couponCardMode === "whole_sortiment_partner"
      ? COUPON_PUBLICATION_CARD_TYPE.WHOLE_SORTIMENT_PARTNER
      : null);
  const isWholeSortimentPartnerCard =
    cardType === COUPON_PUBLICATION_CARD_TYPE.WHOLE_SORTIMENT_PARTNER;
  if (!String(endRaw || "").trim()) {
    errors.push("promotion_end_date_missing");
  }
  if (!String(startRaw || "").trim()) {
    errors.push("promotion_start_date_missing");
  }
  const time = assessPromotionTimeActive(validityMerged, refDate);
  if (time.state === "unknown") {
    errors.push("promotion_time_unknown:" + time.reason);
  }
  if (time.active === false) {
    errors.push("promotion_time_inactive:" + time.reason);
  }
  if (String(endRaw || "").trim() && parsePromotionEndMs(endRaw) === null) {
    errors.push("promotion_end_date_unparseable");
  }
  if (String(startRaw || "").trim() && parsePromotionEndMs(startRaw) === null) {
    errors.push("promotion_start_date_unparseable");
  }
  if (card.couponCzPublish?.czAudiencePublishBlocked) {
    errors.push("coupon_cz_audience_blocked:" + (card.couponCzPublish.publishBlockReason || "blocked"));
  }
  if (card.couponCzPublish?.czCouponPublishEligibility !== "eligible") {
    errors.push("coupon_publish_assessment_not_explicitly_eligible");
  }
  if (isWholeSortimentPartnerCard) {
    if ((card.displayProducts || []).length > 0) {
      errors.push("whole_sortiment_card_must_not_include_display_products");
    }
    return { ok: errors.length === 0, errors, publicationCardType: cardType };
  }
  if (!Array.isArray(card.displayProducts) || card.displayProducts.length === 0) {
    errors.push("display_products_missing_concrete_eligible_item");
  }
  let explicitEligibleCount = 0;
  for (const p of card.displayProducts || []) {
    if (p.eligibility === "unknown" || p.eligibility === "ineligible") {
      errors.push("display_product_blocked_eligibility:" + p.productId + ":" + p.eligibility);
    }
    if (p.eligibility !== "eligible") {
      errors.push("display_product_eligibility_not_explicit:" + p.productId + ":" + (p.eligibility || "missing"));
    } else {
      explicitEligibleCount += 1;
    }
    if (p.publicProductBlockPublishable !== true) {
      errors.push("display_product_not_publishable:" + p.productId);
    }
    const land = p.landingIdentity?.status || card.landingIdentity?.status;
    if (land && land !== "pass") {
      errors.push("display_product_landing_not_verified:" + p.productId + ":" + (p.landingIdentity?.reason || card.landingIdentity?.reason || land));
    }
  }
  if (explicitEligibleCount === 0 && (card.displayProducts || []).length > 0) {
    errors.push("no_explicit_eligible_display_product");
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
