/** Canonical central offer model v19 — internal registry (not public publish record). */

export const OFFER_NETWORK = Object.freeze({ CJ: "CJ" });

export const OFFER_SOURCE = Object.freeze({
  API: "API",
  FEED: "FEED",
  EMAIL: "EMAIL",
});

export const OFFER_TYPE = Object.freeze({
  coupon: "coupon",
  auto_discount: "auto_discount",
  promotion: "promotion",
  product: "product",
});

export const CONFLICT_STATE = Object.freeze({
  none: "none",
  BLOCKED_CONFLICT: "BLOCKED_CONFLICT",
});

export const PUBLISHABILITY_STATE = Object.freeze({
  not_evaluated: "not_evaluated",
  blocked_conflict: "blocked_conflict",
  blocked_gate: "blocked_gate",
  blocked_missing_evidence: "blocked_missing_evidence",
  blocked_contract: "blocked_contract",
  staging_blocked: "staging_blocked",
});

export const REGISTRY_EVENT_KIND = Object.freeze({
  claim_committed: "claim_committed",
  invalid_source_record: "invalid_source_record",
  source_conflict: "source_conflict",
  unknown_advertiser: "unknown_advertiser",
  invalid_affiliate_link: "invalid_affiliate_link",
  missing_contract_permission: "missing_contract_permission",
  d1_write_failed: "d1_write_failed",
  batch_incomplete: "batch_incomplete",
});

/** @returns {import('./iu-cj-affiliate-phase2-central-offer-model-v19.mjs').CentralSourceClaimInput} */
export function emptyCanonicalFields() {
  return {
    network: OFFER_NETWORK.CJ,
    advertiserId: null,
    cjCid: null,
    market: null,
    offerType: null,
    couponCode: null,
    customerDiscountValue: null,
    customerDiscountUnit: null,
    currency: null,
    validFrom: null,
    validTo: null,
    observedAt: null,
    sourceUpdatedAt: null,
    productId: null,
    productVariant: null,
    brandRestrictions: null,
    assortmentScope: null,
    minOrderValue: null,
    exclusions: null,
    affiliateLink: null,
    affiliateLinkVerified: null,
    publisherCommissionValue: null,
    publisherCommissionUnit: null,
    contractPermissionState: null,
    marketingClaimText: null,
  };
}

/**
 * Normalized source claim before merge (never invent missing values).
 * @typedef {Object} CentralSourceClaimInput
 * @property {string} source API|FEED|EMAIL
 * @property {string} sourceRecordId idempotent key per source
 * @property {string} observedAt ISO
 * @property {string|null} sourceUpdatedAt ISO when known
 * @property {Object} fields partial canonical fields
 * @property {Object} evidence opaque evidence blob preserved verbatim
 * @property {Object} [meta] trust hints: terminationNotice, contractBlocker, untrustedSource
 */

export function validateSourceClaim(input) {
  if (!input || typeof input !== "object") return { ok: false, reason: "claim_invalid" };
  if (!OFFER_SOURCE[input.source]) return { ok: false, reason: "invalid_source" };
  if (!input.sourceRecordId || typeof input.sourceRecordId !== "string") return { ok: false, reason: "missing_source_record_id" };
  if (!input.observedAt) return { ok: false, reason: "missing_observed_at" };
  if (!input.evidence || typeof input.evidence !== "object") return { ok: false, reason: "missing_evidence" };
  const f = input.fields || {};
  if (f.publisherCommissionValue != null && f.customerDiscountValue == null && f.offerType === OFFER_TYPE.coupon) {
    /* commission-only row — ok */
  }
  if (f.customerDiscountUnit === "commission" || f.customerDiscountUnit === "commission_mislabeled") {
    return { ok: false, reason: "commission_labeled_as_customer_discount" };
  }
  return { ok: true };
}

export function normCoupon(code) {
  if (code == null || code === "") return null;
  return String(code).trim().toUpperCase();
}

export function normMarket(m) {
  if (m == null || m === "") return null;
  return String(m).trim().toUpperCase();
}
