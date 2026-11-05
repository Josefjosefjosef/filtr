#!/usr/bin/env node
import {
  FRESHNESS_STATUS,
  SOURCE_UPDATED_AT_STATUS,
  applyFreshnessToOffersDocument,
  classifyProductFreshness,
  collectPublishedProductKeys,
  isOfferExpiredAt,
  mergeRefreshedProductIntoCard,
  resolveSourceUpdatedAtProvenance,
  stampProductFetchClocks,
  FRESHNESS_POLICY_V32,
} from "./iu-cj-affiliate-phase3z-offers-freshness-v32.mjs";

const failures = [];
function expect(id, cond) {
  if (!cond) failures.push(id);
}

const now = Date.parse("2026-11-03T12:00:00Z");

expect("expired_coupon", isOfferExpiredAt({ validTo: "2026-11-01T00:00:00Z" }, now).expired === true);
expect("future_coupon", isOfferExpiredAt({ validTo: "2099-01-01T00:00:00Z" }, now).expired === false);
expect(
  "unknown_validity_not_unlimited",
  isOfferExpiredAt({ couponCode: "X" }, now).unknownValidity === true
);

const recent = classifyProductFreshness(
  { lastSuccessfulRefreshAt: "2026-11-03T11:00:00Z", sourceUpdatedAtStatus: "NOT_PROVIDED" },
  now
);
expect(
  "fetch_recent_unknown",
  recent.freshnessStatus === FRESHNESS_STATUS.FETCH_RECENT_SOURCE_AGE_UNKNOWN
);

const sourceFresh = classifyProductFreshness(
  {
    lastSuccessfulRefreshAt: "2026-11-03T11:00:00Z",
    sourceUpdatedAt: "2026-11-03T10:30:00Z",
    sourceUpdatedAtStatus: SOURCE_UPDATED_AT_STATUS.PROVIDED,
  },
  now
);
expect("source_fresh", sourceFresh.freshnessStatus === FRESHNESS_STATUS.SOURCE_FRESH);

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

const legacy = resolveSourceUpdatedAtProvenance({
  sourceUpdatedAt: "2026-11-03T11:00:00Z",
  lastCheckedAt: "2026-11-03T11:00:00Z",
});
expect(
  "legacy_fetch_as_source_cleared",
  legacy.sourceUpdatedAtStatus === SOURCE_UPDATED_AT_STATUS.LEGACY_FETCH_AS_SOURCE &&
    legacy.sourceUpdatedAt == null
);

const stamped = stampProductFetchClocks({ productId: "p1", currentPrice: 10 }, "2026-11-03T12:00:00Z");
expect(
  "stamp_no_invented_source",
  stamped.sourceUpdatedAt == null &&
    stamped.sourceUpdatedAtStatus === SOURCE_UPDATED_AT_STATUS.NOT_PROVIDED &&
    stamped.fetchedAt === "2026-11-03T12:00:00Z" &&
    stamped.freshnessStatus === FRESHNESS_STATUS.FETCH_RECENT_SOURCE_AGE_UNKNOWN
);

const doc = {
  sections: [
    {
      sectionKey: "aff-moda",
      coupons: [
        { offerId: "c1", validTo: "2020-01-01", publicationReady: true },
        { offerId: "c2", validTo: "2099-01-01", publicationReady: true },
        { offerId: "c3", publicationReady: true },
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
          sourceUpdatedAt: "2026-11-03T11:30:00Z",
          lastCheckedAt: "2026-11-03T11:30:00Z",
          publicationReady: true,
        },
      ],
    },
  ],
};
const applied = applyFreshnessToOffersDocument(doc, { nowMs: now });
expect("coupon_expired_hidden", applied.stats.couponsExpiredHidden === 1);
expect("coupon_unknown_hidden", applied.stats.couponsUnknownValidityHidden === 1);
expect("coupon_kept", applied.doc.sections[0].coupons.length === 1);
expect("stale_product_hidden", applied.stats.productsPriceHidden === 1);
expect("fresh_product_kept", applied.doc.sections[0].products.length === 1);
expect(
  "legacy_cleared_on_apply",
  applied.doc.sections[0].products[0].sourceUpdatedAt == null &&
    applied.doc.sections[0].products[0].freshnessStatus ===
      FRESHNESS_STATUS.FETCH_RECENT_SOURCE_AGE_UNKNOWN
);

const keys = collectPublishedProductKeys(doc);
expect("keys_two", keys.length === 2);

const merged = mergeRefreshedProductIntoCard(
  {
    productId: "p2",
    currentPrice: 50,
    sourceUpdatedAt: "2026-11-03T10:00:00Z",
    sourceUpdatedAtStatus: SOURCE_UPDATED_AT_STATUS.PROVIDED,
    availability: "In Stock",
  },
  {
    currentPrice: 45,
    sourceUpdatedAt: "2026-11-03T11:00:00Z",
    sourceUpdatedAtStatus: SOURCE_UPDATED_AT_STATUS.PROVIDED,
    availability: "In Stock",
  },
  "2026-11-03T12:00:00Z"
);
expect("price_changed", merged.priceChanged === true && merged.card.currentPrice === 45);
expect(
  "price_history_trail",
  merged.card.previousPrice === 50 &&
    merged.card.priceChangedAt === "2026-11-03T12:00:00Z" &&
    merged.card.verifiedAt === "2026-11-03T12:00:00Z"
);
expect(
  "merged_keeps_authoritative_source",
  merged.card.sourceUpdatedAtStatus === SOURCE_UPDATED_AT_STATUS.PROVIDED &&
    merged.card.sourceUpdatedAt === "2026-11-03T11:00:00.000Z"
);

const keepNewer = mergeRefreshedProductIntoCard(
  {
    currentPrice: 50,
    sourceUpdatedAt: "2026-11-03T12:00:00Z",
    sourceUpdatedAtStatus: SOURCE_UPDATED_AT_STATUS.PROVIDED,
  },
  {
    currentPrice: 40,
    sourceUpdatedAt: "2026-11-03T11:00:00Z",
    sourceUpdatedAtStatus: SOURCE_UPDATED_AT_STATUS.PROVIDED,
  },
  "2026-11-03T12:05:00Z"
);
expect("reject_older_source", keepNewer.skipped === "older_source");

const mergeNoSource = mergeRefreshedProductIntoCard(
  { currentPrice: 50, sourceUpdatedAtStatus: SOURCE_UPDATED_AT_STATUS.NOT_PROVIDED },
  { currentPrice: 48, sourceUpdatedAtStatus: SOURCE_UPDATED_AT_STATUS.NOT_PROVIDED },
  "2026-11-03T12:00:00Z"
);
expect(
  "merge_without_inventing_source",
  mergeNoSource.card.sourceUpdatedAt == null &&
    mergeNoSource.card.freshnessStatus === FRESHNESS_STATUS.FETCH_RECENT_SOURCE_AGE_UNKNOWN
);

expect("policy_defined", FRESHNESS_POLICY_V32.productPriceAvailabilityMs > 0);

console.log(
  JSON.stringify({
    IU_CJ_OFFERS_FRESHNESS_V32_SELFTEST: failures.length === 0 ? "PASS" : "FAIL",
    failures,
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
