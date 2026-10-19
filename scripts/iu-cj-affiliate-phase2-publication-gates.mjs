#!/usr/bin/env node
/** Coupon-level vs product-level publication gates (card-level publicationReady). */
import {
  COUPON_PUBLICATION_CARD_TYPE,
  assessPromotionTimeActive,
  validatePublicationCard,
} from "./iu-cj-affiliate-phase2-coupon-eligibility.mjs";

function mergedValidity(ctx) {
  const linkMeta = ctx.linkMeta || {};
  const validity = ctx.validity || {};
  return {
    promotionStartDate: validity.promotionStartDate || linkMeta.promotionStartDate || null,
    promotionEndDate: validity.promotionEndDate || linkMeta.promotionEndDate || null,
  };
}

/**
 * Type A: whole-sortiment partner coupon card — no product previews, no landing on card.
 */
export function assessCouponOnlyPublicationGates(ctx) {
  const couponEval = ctx.couponEval || {};
  const refDate = ctx.refDate || new Date();
  const validity = mergedValidity(ctx);
  const publicationCardType =
    ctx.publicationCardType || COUPON_PUBLICATION_CARD_TYPE.WHOLE_SORTIMENT_PARTNER;
  const linkMeta = ctx.linkMeta || {};

  const blockers = [];
  if (couponEval.czCouponPublishEligibility !== "eligible") {
    blockers.push(
      "coupon_publish_assessment_missing_or_not_eligible:" + (couponEval.czCouponPublishEligibility || "missing")
    );
  }
  if (couponEval.czAudiencePublishBlocked) {
    blockers.push("coupon_cz_audience_blocked:" + (couponEval.publishBlockReason || "blocked"));
  }

  const time = assessPromotionTimeActive(
    {
      promotionStartDate: validity.promotionStartDate,
      promotionEndDate: validity.promotionEndDate,
    },
    refDate
  );
  if (time.state === "unknown") blockers.push("promotion_time_unknown:" + time.reason);
  if (time.active === false) blockers.push("promotion_time_inactive:" + time.reason);

  const cardForValidator = {
    publicationCardType,
    validity,
    linkMeta,
    couponCzPublish: couponEval,
    displayProducts: [],
    cardMetadata: ctx.cardMetadata || null,
  };
  const pubVal = validatePublicationCard(cardForValidator, refDate);
  if (!pubVal.ok) blockers.push(...pubVal.errors.map((e) => "validator:" + e));

  const publicationReady =
    couponEval.czCouponPublishEligibility === "eligible" &&
    !couponEval.czAudiencePublishBlocked &&
    time.active === true &&
    pubVal.ok;

  return {
    gateLayer: "coupon_only",
    publicationCardType,
    couponAssessmentExplicit: couponEval.czCouponPublishEligibility === "eligible",
    publicationReady,
    promotionTime: time,
    blockers: [...new Set(blockers)],
    cardMetadata: ctx.cardMetadata || null,
    note: "whole_sortiment_partner_card; historical_batch_samples_are_not_display_products",
  };
}

/**
 * Type B product row / limited card with concrete display products.
 */
export function assessPublicationGates(ctx) {
  const productEval = ctx.productEval || {};
  const couponEval = ctx.couponEval || {};
  const cardDisplayMode = ctx.cardDisplayMode || "text_only";
  const refDate = ctx.refDate || new Date();
  const validity = mergedValidity(ctx);
  const linkMeta = ctx.linkMeta || {};

  const couponAssessmentExplicit = couponEval.czCouponPublishEligibility === "eligible";
  const couponProductEligible = productEval.eligibility === "eligible";
  const affiliateLinkValid =
    productEval.affiliateLinkAssessment?.affiliateLinkStatus === "valid_cj_click_format" ||
    productEval.affiliateLink?.affiliateLinkStatus === "valid_cj_click_format";

  let imageUsageAllowed = "unknown";
  const img = ctx.programTermsImage || { state: "not_fetched" };
  if (cardDisplayMode === "text_only") {
    imageUsageAllowed = "not_required_text_only_card";
  } else if (img.state === "allowed") {
    imageUsageAllowed = "allowed";
  } else if (img.state === "denied") {
    imageUsageAllowed = "denied";
  } else {
    imageUsageAllowed = "unknown";
  }

  const blockers = [];
  if (!couponAssessmentExplicit) {
    blockers.push(
      "coupon_publish_assessment_missing_or_not_eligible:" + (couponEval.czCouponPublishEligibility || "missing")
    );
  }
  if (couponEval.czAudiencePublishBlocked) blockers.push("coupon_cz_audience_blocked");
  if (productEval.eligibility === "unknown") {
    blockers.push("coupon_product_eligibility_unknown:" + (productEval.eligibilityReason || "unknown"));
  }
  if (!couponProductEligible) {
    blockers.push("coupon_product_not_eligible:" + (productEval.eligibilityReason || productEval.eligibility));
  }
  if (!affiliateLinkValid) blockers.push("affiliate_link_invalid");
  if (cardDisplayMode === "with_product_image" && imageUsageAllowed !== "allowed") {
    blockers.push("image_usage_not_allowed:" + imageUsageAllowed);
  }
  const land = ctx.landingIdentity;
  if (!land || land.status !== "pass") {
    blockers.push("landing_identity:" + (land?.reason || "not_verified"));
  }

  const time = assessPromotionTimeActive(
    {
      promotionStartDate: validity.promotionStartDate,
      promotionEndDate: validity.promotionEndDate,
    },
    refDate
  );
  if (time.state === "unknown") blockers.push("promotion_time_unknown:" + time.reason);
  if (time.active === false) blockers.push("promotion_time_inactive:" + time.reason);

  const rowProductId =
    productEval.productId != null
      ? String(productEval.productId)
      : ctx.product?.productId != null
        ? String(ctx.product.productId)
        : land?.productId != null
          ? String(land.productId)
          : "unknown_product_id";
  const cardForValidator = {
    publicationCardType: COUPON_PUBLICATION_CARD_TYPE.LIMITED_SORTIMENT,
    validity,
    linkMeta,
    couponCzPublish: couponEval,
    landingIdentity: land,
    displayProducts: [
      {
        ...productEval,
        productId: rowProductId,
        eligibility: productEval.eligibility,
        publicProductBlockPublishable:
          couponProductEligible && land?.status === "pass" && couponAssessmentExplicit,
        landingIdentity: land,
      },
    ],
  };
  const pubVal = validatePublicationCard(cardForValidator, refDate);
  if (!pubVal.ok) blockers.push(...pubVal.errors.map((e) => "validator:" + e));

  const publicationReady =
    couponAssessmentExplicit &&
    couponProductEligible &&
    affiliateLinkValid &&
    !couponEval.czAudiencePublishBlocked &&
    (cardDisplayMode === "text_only" || imageUsageAllowed === "allowed") &&
    land?.status === "pass" &&
    time.active === true &&
    pubVal.ok;

  return {
    gateLayer: "product_row",
    publicationCardType: COUPON_PUBLICATION_CARD_TYPE.LIMITED_SORTIMENT,
    couponProductEligible,
    couponAssessmentExplicit,
    affiliateLinkValid,
    imageUsageAllowed,
    publicationReady,
    cardDisplayMode,
    promotionTime: time,
    blockers: [...new Set(blockers)],
    checkoutNote:
      "checkout_api_not_required_for_publication; untested_coupon_code_in_cart_is_not_automatic_block",
    importNotCheckoutTest: true,
  };
}

/** @deprecated use publicationReady count; kept for diff clarity */
export function legacyPublishableProductBlock(productEval, couponEval) {
  return (
    productEval.eligibility === "eligible" &&
    productEval.publicProductBlockPublishable === true &&
    couponEval.czCouponPublishEligibility === "eligible"
  );
}
