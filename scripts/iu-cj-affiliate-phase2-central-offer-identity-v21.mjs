/** Campaign-aware offer identity v21 — cor:v21 prefix. */
import { createHash } from "node:crypto";
import { normCoupon, normMarket, OFFER_NETWORK, OFFER_TYPE } from "./iu-cj-affiliate-phase2-central-offer-model-v19.mjs";

function stablePart(v) {
  if (v == null || v === "") return "-";
  return String(v).trim();
}

/** Documented campaign epoch for identity (not validTo — same start + different end → one campaign). */
export function resolveCampaignEpoch(fields) {
  const explicit =
    fields.campaignId ||
    fields.cjPromotionId ||
    fields.promotionId ||
    fields.externalCampaignId ||
    null;
  if (explicit) return "cid:" + stablePart(explicit);
  const vf = stablePart(fields.validFrom);
  if (vf !== "-") return "vf:" + vf;
  return "-";
}

/**
 * v21 identity — separates non-overlapping coupon campaigns by validFrom / explicit campaign id.
 * Coupon match alone is insufficient when campaign epoch is unknown.
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
  const campaignEpoch = stablePart(options.campaignEpoch || resolveCampaignEpoch(fields));

  const parts = [network, cid, market, offerType, coupon, productId, variant, scope, campaignEpoch];
  const missingCore = cid === "-" && productId === "-";
  const ambiguous =
    missingCore ||
    (coupon !== "-" && market === "-" && scope === "-") ||
    (coupon !== "-" && campaignEpoch === "-" && !explicitCampaign(fields));

  if (ambiguous) parts.push("src", stablePart(sourceRecordId));
  const raw = parts.join("|");
  const hash = createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 32);
  return {
    identityKey: `cor:v21:${hash}`,
    ambiguous,
    campaignEpoch,
    rawFingerprint: raw,
    version: 21,
  };
}

function explicitCampaign(fields) {
  return Boolean(fields.campaignId || fields.cjPromotionId || fields.promotionId || fields.externalCampaignId);
}

export function offerIdFromIdentityKey(identityKey) {
  return createHash("sha256").update("oid|" + identityKey, "utf8").digest("hex").slice(0, 24);
}

export function newOfferId(identityKey) {
  return offerIdFromIdentityKey(identityKey);
}

export { computeOfferIdentityKeyV19 } from "./iu-cj-affiliate-phase2-central-offer-identity-v20.mjs";
