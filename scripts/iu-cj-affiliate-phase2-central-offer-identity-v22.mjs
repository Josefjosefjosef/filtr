/** Campaign identity v22 — month bucket without splitting same-month starts. */
import { createHash } from "node:crypto";
import { normCoupon, normMarket, OFFER_NETWORK, OFFER_TYPE } from "./iu-cj-affiliate-phase2-central-offer-model-v19.mjs";

function stablePart(v) {
  if (v == null || v === "") return "-";
  return String(v).trim();
}

function explicitCampaign(fields) {
  return Boolean(fields.campaignId || fields.cjPromotionId || fields.promotionId || fields.externalCampaignId);
}

function monthBucket(validFrom) {
  const s = stablePart(validFrom);
  if (s === "-") return "-";
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${mo}`;
  }
  return "-";
}

/** v22: explicit campaign id, else calendar month of validFrom (not day). */
export function resolveCampaignEpoch(fields) {
  const explicit =
    fields.campaignId || fields.cjPromotionId || fields.promotionId || fields.externalCampaignId || null;
  if (explicit) return "cid:" + stablePart(explicit);
  const bucket = monthBucket(fields.validFrom);
  if (bucket !== "-") return "vm:" + bucket;
  return "-";
}

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
    identityKey: `cor:v22:${hash}`,
    ambiguous,
    campaignEpoch,
    rawFingerprint: raw,
    version: 22,
  };
}

export function offerIdFromIdentityKey(identityKey) {
  return createHash("sha256").update("oid|" + identityKey, "utf8").digest("hex").slice(0, 24);
}

export function newOfferId(identityKey) {
  return offerIdFromIdentityKey(identityKey);
}

export { computeOfferIdentityKeyV19 } from "./iu-cj-affiliate-phase2-central-offer-identity-v20.mjs";
export {
  resolveCampaignEpoch as resolveCampaignEpochV21,
  computeOfferIdentityKey as computeOfferIdentityKeyV21,
} from "./iu-cj-affiliate-phase2-central-offer-identity-v21.mjs";
