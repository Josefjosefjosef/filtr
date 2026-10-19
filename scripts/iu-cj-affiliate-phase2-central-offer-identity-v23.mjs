/** Campaign identity v23 — proven cid only; otherwise provenance-isolated offers (no vm:YYYY-MM). */
import { createHash } from "node:crypto";
import { normCoupon, normMarket, OFFER_NETWORK, OFFER_TYPE } from "./iu-cj-affiliate-phase2-central-offer-model-v19.mjs";

function stablePart(v) {
  if (v == null || v === "") return "-";
  return String(v).trim();
}

export function explicitCampaignId(fields) {
  return (
    fields.campaignId ||
    fields.cjPromotionId ||
    fields.promotionId ||
    fields.externalCampaignId ||
    null
  );
}

/** v23: only explicit campaign identifiers; never month bucket. */
export function resolveCampaignEpoch(fields) {
  const explicit = explicitCampaignId(fields);
  if (explicit) return "cid:" + stablePart(explicit);
  return "-";
}

export const IDENTITY_MODE = Object.freeze({
  proven_campaign: "proven_campaign",
  provenance_isolated: "provenance_isolated",
  ambiguous_blocked: "ambiguous_blocked",
});

/**
 * Deterministic offer identity (cor:v23).
 * Without proven campaign id, each source claim is isolated (prov:source:recordId) and ambiguous for publish.
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
  const source = stablePart(options.source || "");

  const hasProvenCampaign = campaignEpoch.startsWith("cid:");
  const parts = [network, cid, market, offerType, coupon, productId, variant, scope, campaignEpoch];

  const missingCore = cid === "-" && productId === "-";
  let identityMode = IDENTITY_MODE.proven_campaign;
  let ambiguous = false;

  if (!hasProvenCampaign) {
    identityMode = IDENTITY_MODE.provenance_isolated;
    ambiguous = true;
    parts.push("prov", stablePart(source), stablePart(sourceRecordId));
  }

  if (missingCore) {
    identityMode = IDENTITY_MODE.ambiguous_blocked;
    ambiguous = true;
    parts.push("src", stablePart(sourceRecordId));
  } else if (
    coupon !== "-" &&
    market === "-" &&
    scope === "-" &&
    !hasProvenCampaign
  ) {
    identityMode = IDENTITY_MODE.ambiguous_blocked;
    ambiguous = true;
  }

  const raw = parts.join("|");
  const hash = createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 32);
  return {
    identityKey: `cor:v23:${hash}`,
    ambiguous,
    campaignEpoch,
    identityMode,
    rawFingerprint: raw,
    version: 23,
  };
}

/** Soft link key for candidate grouping (never used as offer identity). */
export function computeCampaignCandidateKey(fields) {
  const network = stablePart(fields.network || OFFER_NETWORK.CJ);
  const cid = stablePart(fields.cjCid || fields.advertiserId);
  const market = normMarket(fields.market) || "-";
  const coupon = normCoupon(fields.couponCode) || "-";
  const productId = stablePart(fields.productId);
  const raw = [network, cid, market, coupon, productId].join("|");
  return createHash("sha256").update("cand|" + raw, "utf8").digest("hex").slice(0, 24);
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
export {
  resolveCampaignEpoch as resolveCampaignEpochV22,
  computeOfferIdentityKey as computeOfferIdentityKeyV22,
} from "./iu-cj-affiliate-phase2-central-offer-identity-v22.mjs";
