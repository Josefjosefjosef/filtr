#!/usr/bin/env node
import assert from "node:assert/strict";
import { reconcileEmptyFeedSnapshots } from "./iu-cj-affiliate-phase3z-empty-feed-reconcile-v51-8.mjs";

const doc = reconcileEmptyFeedSnapshots({
  continuation: {
    partners: [
      { advertiserId: "A", emptyApi: true, currentLoaded: 0, partnerName: "A" },
      { advertiserId: "B", emptyApi: true, currentLoaded: 0, partnerName: "B" },
      { advertiserId: "C", emptyApi: false, currentLoaded: 10 },
    ],
  },
  inventory: {
    partners: [
      { advertiserId: "A", hasFeed: true, declaredProductCountSum: 5, partnerName: "A" },
      { advertiserId: "B", hasFeed: true, declaredProductCountSum: 9, partnerName: "B" },
      { advertiserId: "D", hasFeed: true, declaredProductCountSum: 1, partnerName: "D" },
    ],
  },
  completeness: {
    partners: [
      { advertiserId: "A", gapReasons: ["CJ_FEED_API_EMPTY"], partnerName: "A" },
      { advertiserId: "B", gapReasons: ["CJ_FEED_API_EMPTY"], partnerName: "B" },
    ],
  },
  priorEmptyIds: ["A", "B", "D", "E"],
});
assert.equal(doc.counts.continuationEmpty, 2);
assert.equal(doc.counts.completenessEmpty, 2);
assert.equal(doc.counts.unifiedCurrentEmpty, 2);
assert.ok(doc.counts.priorNotCurrent >= 2);
assert.ok(doc.driftExplanation.length >= 1);
console.log(JSON.stringify({ ok: true, counts: doc.counts }));
