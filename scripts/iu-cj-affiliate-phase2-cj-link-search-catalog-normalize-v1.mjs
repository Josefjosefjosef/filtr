/**
 * Offline CJ Link Search XML → internal catalog records + central-offer claims.
 * Never invents prices/codes; never sets publishable=true; no live HTTP.
 */
import {
  classifyCjResponse,
  parseLinkBlocks,
  parseLinkRecord,
  parseListMeta,
} from "./iu-cj-affiliate-phase1-lib.mjs";
import {
  assessOffer,
  classifyTimeWindow,
  hostFromUrl,
  normCode,
  offerKind,
  parseCjDate,
} from "./iu-cj-affiliate-phase2-lib.mjs";
import {
  OFFER_NETWORK,
  OFFER_SOURCE,
  OFFER_TYPE,
  PUBLISHABILITY_STATE,
  validateSourceClaim,
} from "./iu-cj-affiliate-phase2-central-offer-model-v19.mjs";
import {
  computeOfferIdentityKey,
  offerIdFromIdentityKey,
} from "./iu-cj-affiliate-phase2-central-offer-identity-v23.mjs";
import { isTrustedCjClickHost, parseAffiliateClickUrl } from "./iu-cj-affiliate-phase2-product-api.mjs";

export const CATALOG_RECORD_KIND = Object.freeze({
  coupon_with_code: "coupon_with_code",
  action_without_code: "action_without_code",
  product_offer: "product_offer",
  incomplete: "incomplete",
  invalid: "invalid",
});

export const VALIDATION_STATE = Object.freeze({
  valid: "valid",
  incomplete: "incomplete",
  invalid: "invalid",
  expired: "expired",
  http_error: "http_error",
  parse_error: "parse_error",
});

/** Approved partner hints only — unknown → manual_review. Never auto-publish. */
export const APPROVED_PARTNER_HINTS = Object.freeze([
  Object.freeze({
    advertiserId: "5124968",
    partnerSlug: "autohotarek",
    partnerName: "Autohotarek.cz",
    sectionKey: "aff-auto-moto",
  }),
]);

export function classifyLinkSearchHttpOutcome(httpStatus, networkError = false, timeout = false) {
  const status = Number(httpStatus || 0);
  if (timeout || status === 0 && networkError) {
    return { ok: false, reason: timeout ? "timeout" : "network_error", validationState: VALIDATION_STATE.http_error };
  }
  if (status === 401) return { ok: false, reason: "http_401", validationState: VALIDATION_STATE.http_error };
  if (status === 403) return { ok: false, reason: "http_403", validationState: VALIDATION_STATE.http_error };
  if (status === 429) return { ok: false, reason: "http_429", validationState: VALIDATION_STATE.http_error };
  if (status >= 500) return { ok: false, reason: "http_" + status, validationState: VALIDATION_STATE.http_error };
  if (status >= 400) return { ok: false, reason: "http_" + status, validationState: VALIDATION_STATE.http_error };
  if (status < 200 || status >= 300) {
    return { ok: false, reason: "http_" + status, validationState: VALIDATION_STATE.http_error };
  }
  return { ok: true, reason: "http_ok", validationState: VALIDATION_STATE.valid };
}

function emptyOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function mapOfferType(link, kind) {
  if (kind === "coupon_coded") return OFFER_TYPE.coupon;
  if (kind === "candidate_discount_no_code") return OFFER_TYPE.auto_discount;
  const pt = String(link.promotionType || "").toLowerCase();
  if (pt === "product" || String(link.linkType || "").toLowerCase() === "product link") {
    return OFFER_TYPE.product;
  }
  return OFFER_TYPE.promotion;
}

function classifyCatalogKind(link, assessment) {
  if (!link || typeof link !== "object") return CATALOG_RECORD_KIND.invalid;
  const linkId = emptyOrNull(link.linkId);
  const advertiserId = emptyOrNull(link.advertiserId);
  if (!linkId && !advertiserId) return CATALOG_RECORD_KIND.invalid;

  const code = normCode(link.couponCode);
  const pt = String(link.promotionType || "").toLowerCase();
  const lt = String(link.linkType || "").toLowerCase();

  if (code) return CATALOG_RECORD_KIND.coupon_with_code;
  if (assessment?.kind === "candidate_discount_no_code") return CATALOG_RECORD_KIND.action_without_code;
  if (pt === "sale/discount" || pt === "free shipping") return CATALOG_RECORD_KIND.action_without_code;
  if (pt === "product" || lt.includes("product")) return CATALOG_RECORD_KIND.product_offer;
  if (!linkId || !advertiserId) return CATALOG_RECORD_KIND.incomplete;
  return CATALOG_RECORD_KIND.incomplete;
}

export function resolvePartnerMapping(advertiserId, advertiserName) {
  const id = emptyOrNull(advertiserId);
  const hit = APPROVED_PARTNER_HINTS.find((p) => p.advertiserId === id);
  if (hit) {
    return {
      status: "mapped",
      partnerSlug: hit.partnerSlug,
      sectionKey: hit.sectionKey,
      partnerName: hit.partnerName,
      manualReviewRequired: false,
    };
  }
  return {
    status: "manual_review",
    partnerSlug: null,
    sectionKey: null,
    partnerName: emptyOrNull(advertiserName),
    manualReviewRequired: true,
    reason: id ? "unknown_advertiser_id" : "missing_advertiser_id",
  };
}

/**
 * @param {object} link parseLinkRecord output
 * @param {{ observedAt?: string, websitePid?: string|null, refDate?: Date }} [opts]
 */
export function normalizeCjLinkToCatalogRecord(link, opts = {}) {
  const observedAt = opts.observedAt || new Date().toISOString();
  const ref = opts.refDate || new Date(observedAt);
  const websitePid = opts.websitePid || null;

  if (!link || typeof link !== "object") {
    return {
      ok: false,
      recordKind: CATALOG_RECORD_KIND.invalid,
      validationState: VALIDATION_STATE.invalid,
      publishable: false,
      publicationState: PUBLISHABILITY_STATE.blocked_missing_evidence,
      blockers: ["invalid_link_object"],
      record: null,
    };
  }

  const assessment = assessOffer(link, ref, { productLinkVerified: false });
  const recordKind = classifyCatalogKind(link, assessment);
  const timeWindow = classifyTimeWindow(link.promotionStartDate, link.promotionEndDate, ref);
  const clickMeta = parseAffiliateClickUrl(link.clickUrl, websitePid);
  const affiliateUrl = emptyOrNull(link.clickUrl);
  const destinationUrl = emptyOrNull(link.destination);
  const couponCode = emptyOrNull(normCode(link.couponCode));
  const partnerMap = resolvePartnerMapping(link.advertiserId, link.advertiserName);

  const blockers = [];
  if (recordKind === CATALOG_RECORD_KIND.invalid) blockers.push("invalid_record");
  if (!emptyOrNull(link.linkId)) blockers.push("missing_offer_id");
  if (!emptyOrNull(link.advertiserId)) blockers.push("missing_partner_id");
  if (!affiliateUrl && !destinationUrl) blockers.push("missing_affiliate_url");
  if (affiliateUrl && !isTrustedCjClickHost(affiliateUrl) && !clickMeta.documentedFormat) {
    blockers.push("untrusted_or_undocumented_affiliate_url");
  }
  if (timeWindow === "expired") blockers.push("expired");
  if (recordKind === CATALOG_RECORD_KIND.incomplete) blockers.push("incomplete_fields");
  if (partnerMap.manualReviewRequired) blockers.push("partner_manual_review");
  for (const b of assessment.publishBlockers || []) blockers.push(b);

  let validationState = VALIDATION_STATE.valid;
  if (recordKind === CATALOG_RECORD_KIND.invalid) validationState = VALIDATION_STATE.invalid;
  else if (timeWindow === "expired") validationState = VALIDATION_STATE.expired;
  else if (blockers.length) validationState = VALIDATION_STATE.incomplete;

  const offerType = mapOfferType(link, assessment.kind || offerKind(link));
  const identity = computeOfferIdentityKey(
    {
      network: OFFER_NETWORK.CJ,
      advertiserId: emptyOrNull(link.advertiserId),
      cjCid: emptyOrNull(link.advertiserId),
      market: emptyOrNull(link.targetedCountries),
      offerType,
      couponCode,
      productId: null,
      productVariant: null,
      assortmentScope: null,
      campaignId: emptyOrNull(link.linkId),
    },
    "cj_link_search:" + String(link.linkId || "missing"),
    { source: OFFER_SOURCE.API }
  );

  const record = {
    dataSource: OFFER_SOURCE.API,
    sourceSystem: "cj_link_search",
    partnerId: emptyOrNull(link.advertiserId),
    partnerName: emptyOrNull(link.advertiserName),
    offerId: emptyOrNull(link.linkId),
    offerTitle: emptyOrNull(link.linkName),
    description: emptyOrNull(link.description) || emptyOrNull(link.adContent),
    offerType,
    recordKind,
    couponCode,
    validFrom: emptyOrNull(link.promotionStartDate),
    validTo: emptyOrNull(link.promotionEndDate),
    conditions: emptyOrNull(link.description) || emptyOrNull(link.adContent),
    affiliateUrl,
    destinationUrl,
    currency: null,
    originalPrice: null,
    salePrice: null,
    discountPercent: null,
    discountFixed: null,
    observedAt,
    lastVerifiedAt: observedAt,
    validationState,
    publicationState: PUBLISHABILITY_STATE.staging_blocked,
    publishable: false,
    partnerMapping: partnerMap,
    identityKey: identity.identityKey,
    internalOfferId: offerIdFromIdentityKey(identity.identityKey),
    identityMode: identity.identityMode,
    identityAmbiguous: identity.ambiguous === true,
    timeWindow,
    clickMeta: {
      documentedFormat: clickMeta.documentedFormat,
      trustedClickHost: clickMeta.trustedClickHost,
      websitePidMatch: clickMeta.matchesExpectedWebsitePid,
    },
    destinationHost: hostFromUrl(destinationUrl || ""),
    rawLinkLastUpdated: emptyOrNull(link.lastUpdated),
    promotionType: emptyOrNull(link.promotionType),
    linkType: emptyOrNull(link.linkType),
    relationshipStatus: emptyOrNull(link.relationshipStatus),
    targetedCountries: emptyOrNull(link.targetedCountries),
    assessmentBlockers: assessment.publishBlockers || [],
    blockers: [...new Set(blockers)],
  };

  // Incomplete/invalid must never be publishable
  if (validationState !== VALIDATION_STATE.valid || record.blockers.length > 0) {
    record.publishable = false;
    record.publicationState = PUBLISHABILITY_STATE.blocked_gate;
  }

  return {
    ok: recordKind !== CATALOG_RECORD_KIND.invalid && validationState !== VALIDATION_STATE.invalid,
    recordKind,
    validationState,
    publishable: false,
    publicationState: record.publicationState,
    blockers: record.blockers,
    record,
  };
}

/**
 * Build central-offer source claim from a normalized catalog record (API provenance).
 */
export function catalogRecordToSourceClaim(normalized, opts = {}) {
  const rec = normalized?.record;
  if (!rec) return { ok: false, reason: "missing_record" };
  const claim = {
    source: OFFER_SOURCE.API,
    sourceRecordId: "cj_link_search:" + String(rec.offerId || "missing"),
    observedAt: rec.observedAt,
    sourceUpdatedAt: rec.rawLinkLastUpdated
      ? parseCjDate(rec.rawLinkLastUpdated)?.toISOString() || null
      : null,
    fields: {
      network: OFFER_NETWORK.CJ,
      advertiserId: rec.partnerId,
      cjCid: rec.partnerId,
      market: rec.targetedCountries,
      offerType: rec.offerType,
      couponCode: rec.couponCode,
      customerDiscountValue: null,
      customerDiscountUnit: null,
      currency: rec.currency,
      validFrom: rec.validFrom,
      validTo: rec.validTo,
      observedAt: rec.observedAt,
      sourceUpdatedAt: null,
      productId: null,
      productVariant: null,
      brandRestrictions: null,
      assortmentScope: null,
      minOrderValue: null,
      exclusions: null,
      affiliateLink: rec.affiliateUrl || rec.destinationUrl,
      affiliateLinkVerified: rec.clickMeta?.documentedFormat === true,
      publisherCommissionValue: null,
      publisherCommissionUnit: null,
      contractPermissionState: "unknown",
      marketingClaimText: rec.offerTitle || rec.description,
      campaignId: rec.offerId,
    },
    evidence: {
      source: "cj_link_search_xml",
      linkId: rec.offerId,
      advertiserId: rec.partnerId,
      recordKind: rec.recordKind,
      validationState: rec.validationState,
      fixtureKind: opts.fixtureKind || "offline",
      neverInventedPrices: true,
    },
    meta: {
      publishable: false,
      catalogPublishable: false,
      partnerMapping: rec.partnerMapping,
      identityKey: rec.identityKey,
      goFlagsRequiredOff: true,
    },
  };
  const v = validateSourceClaim(claim);
  if (!v.ok) return { ok: false, reason: v.reason, claim: null };
  return { ok: true, claim };
}

/**
 * Parse + classify a full Link Search XML body without inventing success on HTTP errors.
 * @param {string} xml
 * @param {{ httpStatus?: number, networkError?: boolean, timeout?: boolean, observedAt?: string, websitePid?: string|null, refDate?: Date }} [opts]
 */
export function normalizeCjLinkSearchXmlToCatalog(xml, opts = {}) {
  const httpStatus = opts.httpStatus != null ? Number(opts.httpStatus) : 200;
  const http = classifyLinkSearchHttpOutcome(httpStatus, opts.networkError === true, opts.timeout === true);
  if (!http.ok) {
    return {
      ok: false,
      reason: http.reason,
      validationState: http.validationState,
      publishable: false,
      emptySuccess: false,
      meta: null,
      records: [],
      claims: [],
      httpStatus,
      auth: { authenticated: false, reason: http.reason, httpStatus },
      CJ_LIVE_HTTP_CALLS: 0,
    };
  }

  const body = String(xml || "");
  if (!body.trim()) {
    return {
      ok: false,
      reason: "empty_body",
      validationState: VALIDATION_STATE.parse_error,
      publishable: false,
      emptySuccess: false,
      meta: null,
      records: [],
      claims: [],
      httpStatus,
      auth: { authenticated: false, reason: "empty_body", httpStatus },
      CJ_LIVE_HTTP_CALLS: 0,
    };
  }

  const auth = classifyCjResponse(body, httpStatus);
  if (!auth.authenticated) {
    return {
      ok: false,
      reason: auth.reason || "auth_failed",
      validationState: VALIDATION_STATE.http_error,
      publishable: false,
      emptySuccess: false,
      meta: null,
      records: [],
      claims: [],
      httpStatus,
      auth,
      CJ_LIVE_HTTP_CALLS: 0,
    };
  }

  let meta = null;
  try {
    meta = parseListMeta(body);
  } catch {
    meta = null;
  }

  let blocks;
  try {
    blocks = parseLinkBlocks(body);
  } catch (e) {
    return {
      ok: false,
      reason: "xml_parse_error",
      validationState: VALIDATION_STATE.parse_error,
      publishable: false,
      emptySuccess: false,
      meta,
      records: [],
      claims: [],
      httpStatus,
      auth,
      CJ_LIVE_HTTP_CALLS: 0,
      detail: String(e?.message || e).slice(0, 80),
    };
  }

  // Valid empty response (authenticated XML, zero links) vs error zero
  if (blocks.length === 0) {
    const totalMatched = meta?.totalMatched != null ? Number(meta.totalMatched) : null;
    const emptyOk = totalMatched === 0 || /<links[\s>][^>]*>\s*<\/links>/i.test(body) || /total-matched=["']0["']/i.test(body);
    return {
      ok: emptyOk,
      reason: emptyOk ? "empty_result_verified" : "zero_links_unverified_shape",
      validationState: emptyOk ? VALIDATION_STATE.valid : VALIDATION_STATE.parse_error,
      publishable: false,
      emptySuccess: emptyOk === true,
      meta,
      records: [],
      claims: [],
      httpStatus,
      auth,
      CJ_LIVE_HTTP_CALLS: 0,
    };
  }

  const records = [];
  const claims = [];
  const seenIdentity = new Map();
  for (const block of blocks) {
    const link = parseLinkRecord(block);
    const norm = normalizeCjLinkToCatalogRecord(link, opts);
    if (norm.record) {
      const key = norm.record.identityKey;
      if (seenIdentity.has(key)) {
        norm.record.blockers = [...new Set([...(norm.record.blockers || []), "duplicate_identity_in_batch"])];
        norm.record.publishable = false;
        norm.record.validationState = VALIDATION_STATE.incomplete;
        seenIdentity.get(key).push(norm.record.offerId);
      } else {
        seenIdentity.set(key, [norm.record.offerId]);
      }
      records.push(norm.record);
      const claimWrap = catalogRecordToSourceClaim(norm, opts);
      if (claimWrap.ok) claims.push(claimWrap.claim);
    }
  }

  return {
    ok: true,
    reason: "normalized",
    validationState: VALIDATION_STATE.valid,
    publishable: false,
    emptySuccess: false,
    meta,
    records,
    claims,
    httpStatus,
    auth,
    duplicateIdentityKeys: [...seenIdentity.entries()].filter(([, ids]) => ids.length > 1).map(([k]) => k),
    CJ_LIVE_HTTP_CALLS: 0,
  };
}

/** Stable dedupe key across sources — never merge on title alone. */
export function catalogDedupeKey(record) {
  return [
    String(record?.dataSource || ""),
    String(record?.partnerId || ""),
    String(record?.offerId || ""),
    String(record?.offerType || ""),
    String(record?.productVariant || "-"),
  ].join("|");
}
