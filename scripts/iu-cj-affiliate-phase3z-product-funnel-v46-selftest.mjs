#!/usr/bin/env node
import {
  PRODUCT_FUNNEL_SCHEMA,
  FUNNEL_EXCLUDE,
  buildProductFunnelDocument,
  computeHonestOffersStats,
} from "./iu-cj-affiliate-phase3z-product-funnel-v46.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const stats = computeHonestOffersStats([
  {
    sectionKey: "aff-a",
    coupons: [{ advertiserId: "1", publicationReady: true }],
    actions: [],
    products: [
      { advertiserId: "1", productId: "p1", publicationReady: true },
      { advertiserId: "2", productId: "p2", publicationReady: true },
    ],
  },
  {
    sectionKey: "aff-b",
    coupons: [],
    actions: [{ advertiserId: "3", publicationReady: true }],
    products: [{ advertiserId: "2", productId: "p3", publicationReady: true }],
  },
]);
assert(stats.sections === 2, "sections");
assert(stats.productAdvertisers === 2, "product advertisers");
assert(stats.partners === 3, "unique advertisers across coupons/actions/products");
assert(stats.partners !== stats.sections, "partners must not equal sections when they differ");

const funnel = buildProductFunnelDocument({
  inventoryPartners: [
    { advertiserId: "1", partnerName: "A", hasFeed: true, feedCount: 1, declaredProductCountSum: 10, inventoryStatus: "INVENTORIED_HAS_FEED" },
    { advertiserId: "2", partnerName: "B", hasFeed: true, feedCount: 1, declaredProductCountSum: 5, inventoryStatus: "INVENTORIED_HAS_FEED" },
    { advertiserId: "3", partnerName: "C", hasFeed: false, feedCount: 0, inventoryStatus: "INVENTORIED_NO_FEED" },
  ],
  checkpoints: {
    "1": { lastFetchedCount: 10, lastTotalCount: 10, lastComplete: true },
    "2": { lastFetchedCount: 0, lastTotalCount: 0, lastComplete: true },
  },
  publishedByAdvertiser: {
    "1": { occurrences: 3, unique: 3, sections: ["aff-a"] },
  },
  fetchMetaByAdvertiser: {
    "1": { fetched: 10, totalCount: 10, validated: 10, publishReady: 8, publishedSelected: 3 },
    "2": { fetched: 0, totalCount: 0, validated: 0, publishReady: 0, publishedSelected: 0 },
  },
  nowIso: "2026-11-05T15:00:00.000Z",
  runId: "test",
});
assert(funnel.schema === PRODUCT_FUNNEL_SCHEMA, "schema");
assert(funnel.counts.withFeed === 2, "with feed");
assert(funnel.counts.inPublicCatalog === 1, "in catalog");
assert(funnel.partners.find((p) => p.advertiserId === "2").excludeReason === FUNNEL_EXCLUDE.PRODUCT_API_EMPTY, "empty api");
assert(funnel.partners.find((p) => p.advertiserId === "3").excludeReason === FUNNEL_EXCLUDE.NO_FEED, "no feed");

console.log(
  JSON.stringify({
    IU_CJ_PRODUCT_FUNNEL_V46_SELFTEST: "PASS",
    stats: { partners: stats.partners, sections: stats.sections, productAdvertisers: stats.productAdvertisers },
    funnelCounts: funnel.counts,
  })
);
