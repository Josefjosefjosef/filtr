#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildFeedCompleteness } from "./iu-cj-affiliate-phase3z-feed-completeness-v51-8.mjs";

const inventory = {
  counts: { partnersListed: 2, partnersWithFeed: 1, declaredProductCountSum: 10 },
  partners: [
    {
      advertiserId: "1",
      partnerName: "A",
      joined: true,
      hasFeed: true,
      feedCount: 1,
      declaredProductCountSum: 10,
      inventoriedAt: "2026-11-23T00:00:00Z",
    },
    {
      advertiserId: "2",
      partnerName: "B",
      joined: true,
      hasFeed: false,
      feedCount: 0,
      declaredProductCountSum: 0,
    },
  ],
};
const offers = {
  stats: { uniqueProducts: 1 },
  publicGrowthBudget: { cumulativeAddedSinceBaseline: 500, cumulativeRemaining: 0, deferredNew: 9 },
  sections: [
    {
      sectionKey: "aff-elektro",
      products: [{ advertiserId: "1", productId: "p1", title: "x", lkgCarried: true }],
    },
  ],
};
const doc = buildFeedCompleteness({ inventory, offers });
assert.equal(doc.partners.length, 2);
assert.equal(doc.partners.find((p) => p.advertiserId === "1").publishedProducts, 1);
assert.equal(doc.growthBudget.cumulativeRemaining, 0);
console.log(JSON.stringify({ IU_CJ_FEED_COMPLETENESS_V51_8_SELFTEST: "PASS", partners: doc.partners.length }));
