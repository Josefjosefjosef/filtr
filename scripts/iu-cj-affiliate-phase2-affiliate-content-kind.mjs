/** Classify CJ rows into coupon | product | banner (offline, no network). */
import { classifyBannerRole } from "./iu-cj-affiliate-phase2-media-inventory-lib.mjs";
import { normCode } from "./iu-cj-affiliate-phase2-lib.mjs";

export const AFFILIATE_CONTENT_KIND = Object.freeze({
  coupon: "coupon",
  product: "product",
  banner: "banner",
  unknown: "unknown",
});

export function classifyCjAffiliateContentKind(input = {}) {
  if (input.contentKind && AFFILIATE_CONTENT_KIND[input.contentKind]) {
    return input.contentKind;
  }
  if (input.graphqlProduct === true || (input.productId && !input.linkId)) {
    return AFFILIATE_CONTENT_KIND.product;
  }
  const linkType = String(input.linkType || "").toLowerCase();
  const hasBannerDims = /\d{2,4}\s*[x×]\s*\d{2,4}/i.test(String(input.linkName || ""));
  if (normCode(input.couponCode) && !linkType.includes("banner") && !hasBannerDims) {
    return AFFILIATE_CONTENT_KIND.coupon;
  }
  if (linkType.includes("banner") || hasBannerDims) {
    return AFFILIATE_CONTENT_KIND.banner;
  }
  const role = classifyBannerRole(input);
  if (role && role !== "U_unknown_unclassified_banner") {
    return AFFILIATE_CONTENT_KIND.banner;
  }
  if (normCode(input.couponCode)) {
    return AFFILIATE_CONTENT_KIND.coupon;
  }
  if (linkType.includes("coupon") || linkType.includes("text link")) {
    if (input.adContent && /\d{2,4}\s*[x×]\s*\d{2,4}/i.test(String(input.linkName || ""))) {
      return AFFILIATE_CONTENT_KIND.banner;
    }
    return normCode(input.couponCode) ? AFFILIATE_CONTENT_KIND.coupon : AFFILIATE_CONTENT_KIND.unknown;
  }
  if (input.shoppingProductRow === true) {
    return AFFILIATE_CONTENT_KIND.product;
  }
  return AFFILIATE_CONTENT_KIND.unknown;
}

/** Product catalog image must not be treated as CJ display banner creative. */
export function detectProductImageMislabeledAsBanner(link = {}) {
  const name = String(link.linkName || "").toLowerCase();
  const hasSkuShape = /\bcjsku=|product|sku|item/i.test(name + String(link.description || ""));
  const hasBannerDims = /\d{2,4}\s*[x×]\s*\d{2,4}/i.test(String(link.linkName || ""));
  const linkType = String(link.linkType || "").toLowerCase();
  if (hasSkuShape && !hasBannerDims && !linkType.includes("banner")) {
    return { mislabeled: true, reason: "product_feed_image_not_banner_creative" };
  }
  const kind = classifyCjAffiliateContentKind(link);
  if (kind === AFFILIATE_CONTENT_KIND.banner && hasSkuShape && !hasBannerDims) {
    return { mislabeled: true, reason: "product_feed_image_not_banner_creative" };
  }
  return { mislabeled: false, reason: null };
}
