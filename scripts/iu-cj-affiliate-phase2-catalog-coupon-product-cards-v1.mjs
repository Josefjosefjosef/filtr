/**
 * Internal coupon + product card models from catalog records (offline prep only).
 * Never invents prices, photos, or discounts; publishable always false here.
 */

/**
 * @param {object} catalogRecord from normalizeCjLinkToCatalogRecord().record
 */
export function buildInternalCouponCard(catalogRecord) {
  const r = catalogRecord || {};
  return {
    partner: r.partnerName || r.partnerMapping?.partnerName || null,
    partnerSlug: r.partnerMapping?.partnerSlug || null,
    sectionKey: r.partnerMapping?.sectionKey || null,
    actionTitle: r.offerTitle || null,
    couponCode: r.couponCode || null,
    discountLabel: null,
    conditions: r.conditions || r.description || null,
    validFrom: r.validFrom || null,
    validTo: r.validTo || null,
    affiliateUrl: r.affiliateUrl || null,
    verificationState: r.validationState || "incomplete",
    copyCodeEnabled: Boolean(r.couponCode),
    showProductEnabled: Boolean(r.affiliateUrl || r.destinationUrl),
    publicationReady: false,
    publishable: false,
    blockers: [...(r.blockers || [])],
    sourceSystem: r.sourceSystem || "cj_link_search",
    offerId: r.offerId || null,
    updatedAt: r.lastVerifiedAt || r.observedAt || null,
  };
}

/**
 * Product card from feed/product evidence only — never invent photo/price from coupon XML.
 * @param {object|null} productEvidence
 * @param {object} catalogRecord
 */
export function buildInternalProductCard(productEvidence, catalogRecord) {
  const p = productEvidence || {};
  const r = catalogRecord || {};
  const imageUrl = typeof p.imageUrl === "string" && /^https?:\/\//i.test(p.imageUrl) ? p.imageUrl : null;
  const originalPrice = p.originalPrice ?? p.retailPrice ?? null;
  const currentPrice = p.salePrice ?? p.price ?? null;
  const currency = p.currency || null;
  let priceAfterCoupon = null;
  // Only compute when both coupon % and price are evidenced — never invent % from creative alone here.
  if (
    currentPrice != null &&
    Number.isFinite(Number(currentPrice)) &&
    p.couponPercentVerified === true &&
    Number.isFinite(Number(p.couponPercent))
  ) {
    priceAfterCoupon = Number(currentPrice) * (1 - Number(p.couponPercent) / 100);
  }
  const blockers = [];
  if (!imageUrl) blockers.push("missing_or_invalid_photo");
  if (currentPrice == null) blockers.push("missing_price");
  if (currency == null) blockers.push("missing_currency");
  return {
    product: p.title || p.name || null,
    productId: p.productId || p.id || null,
    productVariant: p.productVariant || p.variant || null,
    imageUrl,
    originalPrice,
    currentPrice,
    applicableCouponCode: r.couponCode || null,
    priceAfterCoupon,
    conditions: r.conditions || null,
    affiliateUrl: p.affiliateUrl || r.affiliateUrl || null,
    sourceSystem: p.sourceSystem || "product_feed",
    updatedAt: p.updatedAt || r.lastVerifiedAt || null,
    publicationReady: false,
    publishable: false,
    blockers,
  };
}

/**
 * Partner UX prep: 1 coupon + up to 3 product cards + "show more" flag. Internal only.
 */
export function buildPartnerOfferBundle(catalogRecord, productEvidenceList = [], opts = {}) {
  const maxCards = opts.maxVisibleCards ?? 3;
  const products = (productEvidenceList || []).map((p) => buildInternalProductCard(p, catalogRecord));
  const withPhoto = products.filter((c) => c.imageUrl);
  const visible = withPhoto.slice(0, maxCards);
  return {
    coupon: buildInternalCouponCard(catalogRecord),
    productCards: visible,
    showMoreAvailable: withPhoto.length > maxCards,
    totalValidProductCards: withPhoto.length,
    publicationReady: false,
    publishable: false,
  };
}
