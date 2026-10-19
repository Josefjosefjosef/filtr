/** Field-level merge and conflict rules v19 — no global API>FEED>EMAIL. */
import {
  CONFLICT_STATE,
  OFFER_SOURCE,
  OFFER_TYPE,
  PUBLISHABILITY_STATE,
} from "./iu-cj-affiliate-phase2-central-offer-model-v19.mjs";
import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";

const SOURCE_TRUST = Object.freeze({
  [OFFER_SOURCE.FEED]: 3,
  [OFFER_SOURCE.API]: 2,
  [OFFER_SOURCE.EMAIL]: 1,
});

function parseIso(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pickField(field, claims, resolver) {
  return resolver(field, claims);
}

/** Merge claims into canonical view + conflict list. */
export function reconcileOfferClaims(claims, options = {}) {
  const ref =
    options.referenceTime != null && !Number.isNaN(new Date(options.referenceTime).getTime())
      ? new Date(options.referenceTime)
      : new Date();
  const conflicts = [];
  const canonical = {};
  const evidenceBySource = {};

  for (const c of claims) {
    evidenceBySource[c.source + ":" + c.sourceRecordId] = c.evidence;
  }

  const fieldsList = claims.map((c) => ({ ...c.fields, _source: c.source, _observedAt: c.observedAt, _sourceUpdatedAt: c.sourceUpdatedAt, _meta: c.meta || {} }));

  // Termination / promotion ban from any source blocks publish until cleared
  const termination = claims.find((c) => c.meta?.terminationNotice === true || c.meta?.promotionBan === true);
  if (termination) {
    conflicts.push({ type: "early_termination", sources: [termination.source], detail: "partner_termination_notice" });
  }

  // Customer discount — must agree across sources if present
  const discountClaims = fieldsList.filter((f) => f.customerDiscountValue != null && f.customerDiscountUnit !== "commission");
  if (discountClaims.length > 1) {
    const units = new Set(discountClaims.map((d) => `${d.customerDiscountUnit}:${d.customerDiscountValue}`));
    if (units.size > 1) {
      conflicts.push({ type: "discount_mismatch", values: [...units], sources: discountClaims.map((d) => d._source) });
    }
  }

  // Commission mislabeled as customer discount
  for (const f of fieldsList) {
    if (f.customerDiscountUnit === "commission" || f._meta?.commissionMislabeled) {
      conflicts.push({ type: "commission_as_discount", source: f._source });
    }
  }

  // Validity window
  const windows = fieldsList.filter((f) => f.validFrom || f.validTo);
  if (windows.length > 1) {
    const sigs = new Set(windows.map((w) => `${w.validFrom}|${w.validTo}`));
    if (sigs.size > 1) {
      conflicts.push({ type: "validity_mismatch", signatures: [...sigs], sources: windows.map((w) => w._source) });
    }
  }

  for (const f of fieldsList) {
    if (f.validFrom && parseIso(f.validFrom) == null) {
      conflicts.push({ type: "invalid_validity_date", field: "validFrom", source: f._source, value: f.validFrom });
    }
    if (f.validTo && parseIso(f.validTo) == null) {
      conflicts.push({ type: "invalid_validity_date", field: "validTo", source: f._source, value: f.validTo });
    }
  }

  // Min order mismatch
  const mins = fieldsList.filter((f) => f.minOrderValue != null);
  if (mins.length > 1) {
    const mset = new Set(mins.map((m) => String(m.minOrderValue)));
    if (mset.size > 1) conflicts.push({ type: "min_order_mismatch", values: [...mset] });
  }

  // Exclusions only in one source
  const withEx = fieldsList.filter((f) => f.exclusions);
  const withoutEx = fieldsList.filter((f) => !f.exclusions);
  if (withEx.length && withoutEx.length) {
    conflicts.push({ type: "exclusion_asymmetric", withEx: withEx.map((f) => f._source), without: withoutEx.map((f) => f._source) });
  }

  // CID/PID mismatch
  const cids = new Set(fieldsList.map((f) => f.cjCid || f.advertiserId).filter(Boolean));
  if (cids.size > 1) conflicts.push({ type: "cid_pid_mismatch", cids: [...cids] });

  // Affiliate link validity
  const links = fieldsList.filter((f) => f.affiliateLink != null);
  for (const f of links) {
    if (f.affiliateLinkVerified === false) {
      conflicts.push({ type: "invalid_affiliate_link", source: f._source });
    }
  }

  // Contract vs marketing
  const marketingText = fieldsList.find((f) => f.marketingClaimText)?.marketingClaimText;
  if (marketingText && fieldsList.some((f) => f._meta?.contractBlocker)) {
    conflicts.push({ type: "marketing_vs_contract", sources: fieldsList.map((f) => f._source) });
  }

  // Unknown validity dates when publish would need dates
  const needsDates = fieldsList.some((f) => f.offerType === OFFER_TYPE.coupon || f.couponCode);
  const anyDates = fieldsList.some((f) => f.validFrom || f.validTo);
  if (needsDates && !anyDates) {
    conflicts.push({ type: "unknown_validity_dates", sources: fieldsList.map((f) => f._source) });
  }

  // Expired vs active (deterministic when referenceTime passed)
  for (const f of fieldsList) {
    const end = parseIso(f.validTo);
    if (end && end < ref) canonical._expiredHint = true;
    const start = parseIso(f.validFrom);
    if (start && start > ref) canonical._futureHint = true;
  }

  // Untrusted source
  if (claims.some((c) => c.meta?.untrustedSource)) {
    conflicts.push({ type: "untrusted_source", sources: claims.filter((c) => c.meta?.untrustedSource).map((c) => c.source) });
  }

  // Pick canonical fields (field-specific authority)
  const assign = (field, fn) => {
    canonical[field] = fn(fieldsList);
  };

  assign("network", (fs) => fs.find((f) => f.network)?.network || null);
  assign("advertiserId", (fs) => {
    const api = fs.find((f) => f._source === OFFER_SOURCE.API && f.advertiserId);
    if (api) return api.advertiserId;
    return fs.find((f) => f.advertiserId)?.advertiserId || null;
  });
  assign("cjCid", (fs) => fs.find((f) => f.cjCid)?.cjCid || fs.find((f) => f.advertiserId)?.advertiserId || null);
  assign("market", (fs) => fs.find((f) => f.market)?.market || null);
  assign("offerType", (fs) => fs.find((f) => f.offerType)?.offerType || null);
  assign("couponCode", (fs) => fs.find((f) => f.couponCode)?.couponCode || null);

  assign("customerDiscountValue", (fs) => {
    if (conflicts.some((c) => c.type === "discount_mismatch")) return null;
    const feed = fs.find((f) => f._source === OFFER_SOURCE.FEED && f.customerDiscountValue != null);
    if (feed) return feed.customerDiscountValue;
    const api = fs.find((f) => f._source === OFFER_SOURCE.API && f.customerDiscountValue != null);
    if (api) return api.customerDiscountValue;
    return fs.find((f) => f.customerDiscountValue != null)?.customerDiscountValue ?? null;
  });
  assign("customerDiscountUnit", (fs) => {
    if (conflicts.some((c) => c.type === "discount_mismatch")) return null;
    const feed = fs.find((f) => f._source === OFFER_SOURCE.FEED && f.customerDiscountUnit);
    if (feed) return feed.customerDiscountUnit;
    const api = fs.find((f) => f._source === OFFER_SOURCE.API && f.customerDiscountUnit);
    if (api) return api.customerDiscountUnit;
    return fs.find((f) => f.customerDiscountUnit)?.customerDiscountUnit ?? null;
  });

  assign("currency", (fs) => fs.find((f) => f.currency)?.currency || null);
  assign("validFrom", (fs) => {
    if (conflicts.some((c) => c.type === "validity_mismatch")) return null;
    const ranked = [...fs].sort((a, b) => (parseIso(b._sourceUpdatedAt) || 0) - (parseIso(a._sourceUpdatedAt) || 0));
    return ranked.find((f) => f.validFrom)?.validFrom || null;
  });
  assign("validTo", (fs) => {
    if (conflicts.some((c) => c.type === "validity_mismatch")) return null;
    if (termination) return termination.fields?.validTo || fs.find((f) => f.validTo)?.validTo || null;
    const ranked = [...fs].sort((a, b) => (parseIso(b._sourceUpdatedAt) || 0) - (parseIso(a._sourceUpdatedAt) || 0));
    return ranked.find((f) => f.validTo)?.validTo || null;
  });
  assign("observedAt", (fs) => fs.map((f) => f._observedAt).sort().slice(-1)[0] || null);
  assign("sourceUpdatedAt", (fs) => {
    const ranked = [...fs].sort((a, b) => (parseIso(b._sourceUpdatedAt) || 0) - (parseIso(a._sourceUpdatedAt) || 0));
    return ranked.find((f) => f._sourceUpdatedAt)?._sourceUpdatedAt || null;
  });
  assign("productId", (fs) => fs.find((f) => f.productId)?.productId || null);
  assign("productVariant", (fs) => fs.find((f) => f.productVariant)?.productVariant || null);
  assign("brandRestrictions", (fs) => fs.find((f) => f.brandRestrictions)?.brandRestrictions || null);
  assign("assortmentScope", (fs) => fs.find((f) => f.assortmentScope)?.assortmentScope || null);
  assign("minOrderValue", (fs) => {
    if (conflicts.some((c) => c.type === "min_order_mismatch")) return null;
    return fs.find((f) => f.minOrderValue != null)?.minOrderValue ?? null;
  });
  assign("exclusions", (fs) => fs.find((f) => f.exclusions)?.exclusions || null);
  assign("affiliateLink", (fs) => fs.find((f) => f.affiliateLink && f.affiliateLinkVerified !== false)?.affiliateLink || null);
  assign("affiliateLinkVerified", (fs) => {
    const l = fs.find((f) => f.affiliateLink);
    if (!l) return null;
    return l.affiliateLinkVerified !== false;
  });
  assign("publisherCommissionValue", (fs) => fs.find((f) => f.publisherCommissionValue != null)?.publisherCommissionValue ?? null);
  assign("publisherCommissionUnit", (fs) => fs.find((f) => f.publisherCommissionUnit)?.publisherCommissionUnit || null);
  assign("contractPermissionState", (fs) => fs.find((f) => f.contractPermissionState)?.contractPermissionState || null);

  const conflictState = conflicts.length ? CONFLICT_STATE.BLOCKED_CONFLICT : CONFLICT_STATE.none;
  let publishability = PUBLISHABILITY_STATE.not_evaluated;
  let blockReason = null;

  if (conflictState === CONFLICT_STATE.BLOCKED_CONFLICT) {
    publishability = PUBLISHABILITY_STATE.blocked_conflict;
    blockReason = conflicts[0]?.type || "conflict";
  } else if (termination) {
    publishability = PUBLISHABILITY_STATE.blocked_contract;
    blockReason = "termination_notice";
  } else if (canonical._expiredHint) {
    publishability = PUBLISHABILITY_STATE.blocked_gate;
    blockReason = "expired";
  } else if (canonical._futureHint) {
    publishability = PUBLISHABILITY_STATE.blocked_gate;
    blockReason = "future_action";
  } else if (options.identityAmbiguous) {
    publishability = PUBLISHABILITY_STATE.blocked_missing_evidence;
    blockReason = "identity_ambiguous";
  } else if (conflicts.some((c) => c.type === "invalid_validity_date")) {
    publishability = PUBLISHABILITY_STATE.blocked_gate;
    blockReason = "invalid_validity_date";
  } else if (conflicts.some((c) => c.type === "unknown_validity_dates")) {
    publishability = PUBLISHABILITY_STATE.blocked_missing_evidence;
    blockReason = "unknown_validity";
  } else if (conflicts.some((c) => c.type === "invalid_affiliate_link")) {
    publishability = PUBLISHABILITY_STATE.blocked_missing_evidence;
    blockReason = "invalid_affiliate_link";
  } else {
    publishability = PUBLISHABILITY_STATE.staging_blocked;
    blockReason = "awaiting_v15_gate";
  }

  // v15 / signing — never publishable in v19
  const publishable = false;
  if (!PRODUCTION_SIGNING_ENABLED) {
    publishability = publishability === PUBLISHABILITY_STATE.not_evaluated ? PUBLISHABILITY_STATE.staging_blocked : publishability;
  }

  return {
    canonical,
    conflicts,
    conflictState,
    publishabilityState: publishability,
    blockReason,
    publishable,
    evidenceBySource,
    sourceTrustRank: SOURCE_TRUST,
  };
}
