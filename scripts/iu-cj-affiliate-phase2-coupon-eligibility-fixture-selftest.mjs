#!/usr/bin/env node
/**
 * Offline synthetic eligibility + publication validator (no TEMP data, no network).
 * Fixture data must never enter production offer pipelines.
 */
import { parseCouponScope } from "./iu-cj-affiliate-phase2-coupon-scope.mjs";
import {
  SYNTHETIC_FIXTURE_MARKER,
  assessProductAffiliateLink,
  evaluateCouponCzPublish,
  evaluateProductBinding,
  validatePublicationCard,
} from "./iu-cj-affiliate-phase2-coupon-eligibility.mjs";

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const FIXTURE_OFFER = "Sleva 10 % na vše z obchod-fixture.cz";
const COUPON_LINK_ID = "99900001";
const PRODUCT_TRACKING_LINK_ID = "88888888";
const FIXTURE_LINK = {
  linkId: COUPON_LINK_ID,
  destination: "https://www.obchod-fixture.cz/",
  couponCode: "FIX10",
  promotionStartDate: "2026-01-01 00:00:00.0",
  promotionEndDate: "2030-12-31 23:59:00.0",
  targetedCountries: "CZ",
  websitePid: "101883843",
};

const baseProduct = {
  productId: "SKU-FIX-1",
  name: "Fixture produkt A",
  price: "100.00",
  currency: "CZK",
  availability: "in stock",
  affiliateClickUrl:
    "https://www.kqzyfj.com/click-101883843-" +
    PRODUCT_TRACKING_LINK_ID +
    "?url=https%3A%2F%2Fwww.obchod-fixture.cz%2Fp%2Fsku-fix-1&cjsku=SKU-FIX-1",
  matchReason: "full_sortiment_scope",
  matchDetail: "sample_or_query_not_full_catalog_proof",
  bindingSource: "batch_sample_only",
};

const bindingRow = {
  linkId: FIXTURE_LINK.linkId,
  couponCode: FIXTURE_LINK.couponCode,
  offerText: FIXTURE_OFFER,
};

const scope = parseCouponScope({ description: FIXTURE_OFFER, adContent: "" });
const couponEval = evaluateCouponCzPublish({ bindingRow, scope, linkMeta: FIXTURE_LINK });
const refDate = new Date("2026-06-01T00:00:00Z");

expect("fixture_coupon_cz_eligible", couponEval.czCouponPublishEligibility === "eligible");

const linkA = assessProductAffiliateLink(baseProduct, FIXTURE_LINK.websitePid);
expect("fixture_affiliate_link_valid", linkA.affiliateLinkStatus === "valid_cj_click_format");
expect("fixture_tracking_aid_differs_from_coupon", linkA.trackingLinkIdInClickUrl === PRODUCT_TRACKING_LINK_ID);

const evilHost = assessProductAffiliateLink(
  { affiliateClickUrl: "https://evil.example.com/click-101883843-" + PRODUCT_TRACKING_LINK_ID },
  FIXTURE_LINK.websitePid
);
expect("untrusted_click_host_not_publication_valid", evilHost.affiliateLinkStatus === "untrusted_click_host");

const wrongPid = assessProductAffiliateLink(baseProduct, "99999999");
expect("pid_mismatch_not_publication_valid", wrongPid.affiliateLinkStatus === "pid_mismatch");

const couponNoDates = evaluateCouponCzPublish({
  bindingRow,
  scope,
  linkMeta: { ...FIXTURE_LINK, promotionStartDate: null, promotionEndDate: null },
});
expect(
  "coupon_missing_promotion_dates_not_eligible",
  couponNoDates.czCouponPublishEligibility !== "eligible" && couponNoDates.czAudiencePublishBlocked === true
);

const evDocumented = evaluateProductBinding({
  bindingRow,
  product: { ...baseProduct },
  scope,
  linkMeta: FIXTURE_LINK,
  couponEval,
  refDate,
});
expect("fixture_different_tracking_aid_still_eligible", evDocumented.eligibility === "eligible");
expect(
  "fixture_eligible_reason_documented_sortiment",
  evDocumented.eligibilityReason === "promotion_full_sortiment_same_cz_store_documented_in_link_search"
);
expect("fixture_different_aid_publishable", evDocumented.publicProductBlockPublishable === true);

const evSameAidWrongStore = evaluateProductBinding({
  bindingRow,
  product: {
    ...baseProduct,
    affiliateClickUrl:
      "https://www.kqzyfj.com/click-101883843-" +
      COUPON_LINK_ID +
      "?url=https%3A%2F%2Fwww.jiny-obchod.cz%2Fp%2Fsku-fix-1&cjsku=SKU-FIX-1",
  },
  scope,
  linkMeta: FIXTURE_LINK,
  couponEval,
  refDate,
});
expect("fixture_same_aid_wrong_store_not_eligible", evSameAidWrongStore.eligibility === "ineligible");

const subsetOffer = "Sleva 10 % na vybrané modely fixture z obchod-fixture.cz";
const subsetScope = parseCouponScope({ description: subsetOffer, adContent: "" });
const evSubsetMissing = evaluateProductBinding({
  bindingRow: { ...bindingRow, offerText: subsetOffer },
  product: { ...baseProduct },
  scope: subsetScope,
  linkMeta: FIXTURE_LINK,
  couponEval: evaluateCouponCzPublish({ bindingRow: { offerText: subsetOffer }, scope: subsetScope, linkMeta: FIXTURE_LINK }),
  refDate,
});
expect("fixture_subset_missing_models_unknown", evSubsetMissing.eligibility === "unknown");

const evAidSwap = evaluateProductBinding({
  bindingRow,
  product: {
    ...baseProduct,
    affiliateClickUrl: baseProduct.affiliateClickUrl.replace(PRODUCT_TRACKING_LINK_ID, "77777777"),
  },
  scope,
  linkMeta: FIXTURE_LINK,
  couponEval,
  refDate,
});
expect("fixture_aid_swap_still_eligible", evAidSwap.eligibility === evDocumented.eligibility);

const attested = {
  ...baseProduct,
  promotionSkuAttestation: {
    [SYNTHETIC_FIXTURE_MARKER]: true,
    source: SYNTHETIC_FIXTURE_MARKER,
  },
  bindingSource: "synthetic_fixture",
};
const evSynthetic = evaluateProductBinding({
  bindingRow,
  product: attested,
  scope,
  linkMeta: FIXTURE_LINK,
  couponEval,
  refDate,
});
expect("fixture_synthetic_marker_eligible", evSynthetic.eligibility === "eligible");

const excludedOffer = FIXTURE_OFFER + " Neplatí pro poukazy.";
const excludedScope = parseCouponScope({ description: excludedOffer, adContent: "" });
const evExcluded = evaluateProductBinding({
  bindingRow: { ...bindingRow, offerText: excludedOffer },
  product: {
    ...baseProduct,
    name: "Dárkový poukaz 500 Kč",
    affiliateClickUrl:
      "https://www.kqzyfj.com/click-101883843-88888888?url=https%3A%2F%2Fwww.obchod-fixture.cz%2Fdarkovy-poukaz&cjsku=POUKAZ",
  },
  scope: excludedScope,
  linkMeta: FIXTURE_LINK,
  couponEval,
  refDate,
});
expect("fixture_voucher_excluded_ineligible", evExcluded.eligibility === "ineligible");

const expiredCard = {
  validity: { promotionEndDate: "2020-01-01 00:00:00.0" },
  couponCzPublish: couponEval,
  displayProducts: [evDocumented],
};
expect("fixture_expired_rejected", validatePublicationCard(expiredCard, refDate).ok === false);

const poisonCard = {
  validity: { promotionEndDate: FIXTURE_LINK.promotionEndDate },
  couponCzPublish: couponEval,
  displayProducts: [evSubsetMissing],
};
expect("fixture_unknown_in_display_rejected", validatePublicationCard(poisonCard, refDate).ok === false);

const goodCard = {
  validity: {
    promotionStartDate: FIXTURE_LINK.promotionStartDate,
    promotionEndDate: FIXTURE_LINK.promotionEndDate,
  },
  couponCzPublish: couponEval,
  displayProducts: [evDocumented],
};
expect("fixture_valid_card_passes", validatePublicationCard(goodCard, refDate).ok === true);

console.log(
  JSON.stringify({
    IU_CJ_COUPON_ELIGIBILITY_FIXTURE_SELFTEST: failures.length === 0 ? "OK" : "FAIL",
    failures,
    syntheticNeverInProduction: true,
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
