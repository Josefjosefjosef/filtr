/** Offer identity v20 — same commercial action merges across differing validity claims. */
import { createHash } from "node:crypto";
import { normCoupon, normMarket, OFFER_NETWORK, OFFER_TYPE } from "./iu-cj-affiliate-phase2-central-offer-model-v19.mjs";

function stablePart(v) {
  if (v == null || v === "") return "-";
  return String(v).trim();
}

/** v19 identity (dates in key) — repro / legacy lookup only. */
export function computeOfferIdentityKeyV19(fields, sourceRecordId) {
  const network = stablePart(fields.network || OFFER_NETWORK.CJ);
  const cid = stablePart(fields.cjCid || fields.advertiserId);
  const market = normMarket(fields.market) || "-";
  const offerType = stablePart(fields.offerType || OFFER_TYPE.promotion);
  const coupon = normCoupon(fields.couponCode) || "-";
  const productId = stablePart(fields.productId);
  const variant = stablePart(fields.productVariant);
  const scope = stablePart(fields.assortmentScope || fields.brandRestrictions);
  const from = stablePart(fields.validFrom);
  const to = stablePart(fields.validTo);
  const parts = [network, cid, market, offerType, coupon, productId, variant, scope, from, to];
  const missingCore = cid === "-" && productId === "-";
  const ambiguous = missingCore || (coupon !== "-" && market === "-" && scope === "-");
  if (ambiguous) parts.push("src", stablePart(sourceRecordId));
  const raw = parts.join("|");
  const hash = createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 32);
  return { identityKey: `cor:v19:${hash}`, ambiguous, rawFingerprint: raw };
}

/**
 * v20 action identity — excludes validFrom/validTo so conflicting dates reconcile under one offer.
 * Optional campaignEpoch distinguishes intentional separate campaigns (same coupon, different period).
 */
export function computeOfferIdentityKey(fields, sourceRecordId, options = {}) {
  const network = stablePart(fields.network || OFFER_NETWORK.CJ);
  const cid = stablePart(fields.cjCid || fields.advertiserId);
  const market = normMarket(fields.market) || "-";
  const offerType = stablePart(fields.offerType || OFFER_TYPE.promotion);
  const coupon = normCoupon(fields.couponCode) || "-";
  const productId = stablePart(fields.productId);
  const variant = stablePart(fields.productVariant);
  const scope = stablePart(fields.assortmentScope || fields.brandRestrictions);
  const campaignEpoch = stablePart(fields.campaignEpoch || options.campaignEpoch);
  const parts = [network, cid, market, offerType, coupon, productId, variant, scope, campaignEpoch];
  const missingCore = cid === "-" && productId === "-";
  const ambiguous = missingCore || (coupon !== "-" && market === "-" && scope === "-");
  if (ambiguous) parts.push("src", stablePart(sourceRecordId));
  const raw = parts.join("|");
  const hash = createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 32);
  return { identityKey: `cor:v20:${hash}`, ambiguous, rawFingerprint: raw, version: 20 };
}

/** Deterministic offer id — safe under concurrent insert for same action identity. */
export function offerIdFromIdentityKey(identityKey) {
  return createHash("sha256").update("oid|" + identityKey, "utf8").digest("hex").slice(0, 24);
}

export function newOfferId(identityKey) {
  return offerIdFromIdentityKey(identityKey);
}
