#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildFeedCompleteness,
  evaluateFeedCompletenessPass,
} from "./iu-cj-affiliate-phase3z-feed-completeness-v51-8.mjs";

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
  publicGrowthBudget: {
    cumulativeAddedSinceBaseline: 500,
    cumulativeRemaining: 0,
    allowedNew: 0,
    deferredNew: 9,
  },
  sections: [
    {
      sectionKey: "aff-elektro",
      products: [{ advertiserId: "1", productId: "p1", title: "x", lkgCarried: true }],
    },
  ],
};
const doc = buildFeedCompleteness({
  inventory,
  offers,
  durableEligibleByAdvertiser: { "1": 10 },
});
assert.equal(doc.partners.length, 2);
assert.equal(doc.partners.find((p) => p.advertiserId === "1").publishedProducts, 1);
assert.equal(doc.growthBudget.cumulativeRemaining, 0);
const a = doc.partners.find((p) => p.advertiserId === "1");
assert.ok(!(a.gapReasons || []).includes("FEED_DECLARED_BUT_NONE_PUBLISHED"));
const inv2 = {
  partners: [
    {
      advertiserId: "9",
      partnerName: "Blocked",
      joined: true,
      hasFeed: true,
      declaredProductCountSum: 100,
    },
  ],
};
const blocked = buildFeedCompleteness({
  inventory: inv2,
  offers: {
    publicGrowthBudget: { cumulativeRemaining: 0, allowedNew: 0 },
    sections: [],
  },
  durableEligibleByAdvertiser: { "9": 40 },
});
assert.deepEqual(blocked.partners[0].gapReasons, ["GROWTH_BUDGET_BLOCKED_ELIGIBLE"]);
assert.equal(blocked.partners[0].growthBudgetBlocked, 40);
const emptyApi = buildFeedCompleteness({
  inventory: {
    partners: [
      {
        advertiserId: "8",
        partnerName: "EmptyAPI",
        joined: true,
        hasFeed: true,
        declaredProductCountSum: 50,
      },
    ],
  },
  offers: { publicGrowthBudget: { cumulativeRemaining: 0 }, sections: [] },
  continuationByAdvertiser: { "8": { offset: 1, mode: "offset", emptyApi: true, currentLoaded: 0 } },
});
assert.deepEqual(emptyApi.partners[0].gapReasons, ["CJ_FEED_API_EMPTY"]);
emptyApi.totals = emptyApi.totals || {};
emptyApi.totals.unexplainedNonePublished = 0;
emptyApi.totals.partnersInInventory = 1;
const emptyEval = evaluateFeedCompletenessPass(emptyApi);
assert.equal(emptyEval.pass, true);
assert.equal(emptyEval.cjFeedApiEmptyPartners, 1);
assert.equal(emptyEval.externalLimitations.length, 1);

const unexplained = buildFeedCompleteness({
  inventory: {
    partners: [
      {
        advertiserId: "7",
        partnerName: "Silent",
        joined: true,
        hasFeed: true,
        declaredProductCountSum: 20,
      },
    ],
  },
  offers: { publicGrowthBudget: { cumulativeRemaining: 0 }, sections: [] },
});
unexplained.totals = unexplained.totals || {};
unexplained.totals.partnersInInventory = 1;
unexplained.totals.unexplainedNonePublished = 1;
const badEval = evaluateFeedCompletenessPass(unexplained);
assert.equal(badEval.pass, false);
assert.equal(badEval.unexplainedNonePublished, 1);

// Tierraverde-class: lastComplete=true + offset=1 must NOT be CONTINUATION_PENDING.
const tierra = buildFeedCompleteness({
  inventory: {
    partners: [
      {
        advertiserId: "7612998",
        partnerName: "Tierraverde",
        joined: true,
        hasFeed: true,
        declaredProductCountSum: 324,
      },
    ],
  },
  offers: { publicGrowthBudget: { cumulativeRemaining: 0 }, sections: [] },
  continuationByAdvertiser: {
    "7612998": {
      offset: 1,
      mode: "offset",
      emptyApi: false,
      currentLoaded: 367,
      completePassCount: 100,
      lastComplete: true,
      productsRemainingEstimate: 0,
    },
  },
});
assert.ok(
  !(tierra.partners[0].gapReasons || []).includes("INGESTION_CONTINUATION_PENDING"),
  "sealed complete pass is not CONTINUATION_PENDING",
);
assert.deepEqual(
  tierra.partners[0].gapReasons,
  ["INGESTION_COMPLETE_AWAITING_PUBLICATION"],
  "sealed complete + loaded + published=0 → awaiting publication",
);
assert.ok(
  !(tierra.partners[0].gapReasons || []).includes("FEED_DECLARED_BUT_NONE_PUBLISHED"),
  "not unexplained silent loss",
);

const variants = buildFeedCompleteness({
  inventory: {
    partners: [
      {
        advertiserId: "111",
        partnerName: "V",
        joined: true,
        hasFeed: true,
        declaredProductCountSum: 2,
      },
    ],
  },
  offers: {
    publicGrowthBudget: { cumulativeRemaining: 0, allowedNew: 0 },
    sections: [
      {
        sectionKey: "aff-test",
        products: [
          { advertiserId: "111", productId: "SAME", productVariant: "v" },
          { advertiserId: "111", productId: "SAME", productVariant: "w" },
          { advertiserId: "111", productId: "SAME", productVariant: "v" },
        ],
      },
    ],
  },
});
assert.equal(variants.partners[0].publishedProducts, 2);

console.log(
  JSON.stringify({
    IU_CJ_FEED_COMPLETENESS_V51_8_SELFTEST: "PASS",
    partners: doc.partners.length,
    emptyApiPass: emptyEval.pass,
    unexplainedFail: badEval.pass === false,
    tierraverdeSealed: true,
  }),
);
