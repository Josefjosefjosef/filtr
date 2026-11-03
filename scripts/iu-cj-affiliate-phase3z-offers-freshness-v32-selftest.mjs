#!/usr/bin/env node
import {
  FRESHNESS_STATUS,
  applyFreshnessToOffersDocument,
  classifyProductFreshness,
  collectPublishedProductKeys,
  isOfferExpiredAt,
  mergeRefreshedProductIntoCard,
  FRESHNESS_POLICY_V32,
} from "./iu-cj-affiliate-phase3z-offers-freshness-v32.mjs";

const failures = [];
function expect(id, cond) {
  if (!cond) failures.push(id);
}

const now = Date.parse("2026-11-03T12:00:00Z");

expect("expired_coupon", isOfferExpiredAt({ validTo: "2026-11-01T00:00:00Z" }, now).expired === true);
expect("future_coupon", isOfferExpiredAt({ validTo: "2099-01-01T00:00:00Z" }, now).expired === false);

const fresh = classifyProductFreshness(
  { lastSuccessfulRefreshAt: "2026-11-03T11:00:00Z" },
  now
);
expect("fresh_status", fresh.freshnessStatus === FRESHNESS_STATUS.FRESH);

const stale = classifyProductFreshness(
  { lastSuccessfulRefreshAt: "2026-11-03T06:00:00Z" },
  now
);
expect("stale_status", stale.freshnessStatus === FRESHNESS_STATUS.STALE);

const hide = classifyProductFreshness(
  { lastSuccessfulRefreshAt: "2026-10-01T00:00:00Z" },
  now
);
expect("hide_stale", hide.freshnessStatus === FRESHNESS_STATUS.HIDDEN_STALE && hide.hidePublicPrice === true);

const doc = {
  sections: [
    {
      sectionKey: "aff-moda",
      coupons: [
        { offerId: "c1", validTo: "2020-01-01", publicationReady: true },
        { offerId: "c2", validTo: "2099-01-01", publicationReady: true },
      ],
      actions: [{ offerId: "a1", validTo: "2099-06-01", publicationReady: true }],
      products: [
        {
          advertiserId: "1",
          productId: "p1",
          currentPrice: 100,
          lastSuccessfulRefreshAt: "2026-10-01T00:00:00Z",
          publicationReady: true,
        },
        {
          advertiserId: "1",
          productId: "p2",
          currentPrice: 50,
          lastSuccessfulRefreshAt: "2026-11-03T11:30:00Z",
          publicationReady: true,
        },
      ],
    },
  ],
};
const applied = applyFreshnessToOffersDocument(doc, { nowMs: now });
expect("coupon_expired_hidden", applied.stats.couponsExpiredHidden === 1);
expect("coupon_kept", applied.doc.sections[0].coupons.length === 1);
expect("stale_product_hidden", applied.stats.productsPriceHidden === 1);
expect("fresh_product_kept", applied.doc.sections[0].products.length === 1);

const keys = collectPublishedProductKeys(doc);
expect("keys_two", keys.length === 2);

const merged = mergeRefreshedProductIntoCard(
  {
    productId: "p2",
    currentPrice: 50,
    sourceUpdatedAt: "2026-11-03T10:00:00Z",
    availability: "In Stock",
  },
  {
    currentPrice: 45,
    sourceUpdatedAt: "2026-11-03T11:00:00Z",
    availability: "In Stock",
  },
  "2026-11-03T12:00:00Z"
);
expect("price_changed", merged.priceChanged === true && merged.card.currentPrice === 45);

const keepNewer = mergeRefreshedProductIntoCard(
  { currentPrice: 50, sourceUpdatedAt: "2026-11-03T12:00:00Z" },
  { currentPrice: 40, sourceUpdatedAt: "2026-11-03T11:00:00Z" },
  "2026-11-03T12:05:00Z"
);
expect("reject_older_source", keepNewer.skipped === "older_source");

expect("policy_defined", FRESHNESS_POLICY_V32.productPriceAvailabilityMs > 0);

console.log(
  JSON.stringify({
    IU_CJ_OFFERS_FRESHNESS_V32_SELFTEST: failures.length === 0 ? "PASS" : "FAIL",
    failures,
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
