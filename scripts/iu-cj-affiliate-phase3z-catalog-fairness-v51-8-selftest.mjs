#!/usr/bin/env node
/**
 * V51.8 — catalog fairness + traversal classification selftest (offline).
 */
import {
  TRAVERSAL_STATUS,
  classifyPartnerTraversalStatus,
  selectPartnersForFairDiscovery,
  summarizeTraversalClassifications,
} from "./iu-cj-affiliate-phase3z-catalog-fairness-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const nonempty = classifyPartnerTraversalStatus({
  lastComplete: true,
  lastTotalCount: 1200,
  lastFetchedCount: 100,
});
assert(nonempty.status === TRAVERSAL_STATUS.COMPLETE_NONEMPTY, "nonempty complete");

const empty = classifyPartnerTraversalStatus({
  lastComplete: true,
  lastTotalCount: 0,
  lastFetchedCount: 0,
  lastError: null,
});
assert(empty.status === TRAVERSAL_STATUS.COMPLETE_VERIFIED_EMPTY, "verified empty");
assert(empty.verifiedEmpty === true, "verifiedEmpty flag");

const noFeed = classifyPartnerTraversalStatus(
  { lastComplete: true, lastTotalCount: 0, lastFetchedCount: 0 },
  { hasFeed: false, inventoryComplete: true, feedCount: 0 }
);
assert(noFeed.status === TRAVERSAL_STATUS.NO_FEED_AVAILABLE, "no feed");

const incomplete = classifyPartnerTraversalStatus({
  lastComplete: false,
  lastTotalCount: 50000,
  lastFetchedCount: 100,
  lastStoppedEarlyForBudget: false,
});
assert(incomplete.status === TRAVERSAL_STATUS.INCOMPLETE, "incomplete");

const stopped = classifyPartnerTraversalStatus({
  lastComplete: false,
  lastTotalCount: 50000,
  lastFetchedCount: 100,
  lastStoppedEarlyForBudget: true,
});
assert(stopped.status === TRAVERSAL_STATUS.STOPPED_EARLY, "stopped early");

const nowMs = Date.parse("2026-11-08T12:00:00.000Z");
const partners = [
  { advertiserId: "A", title: "done-empty" },
  { advertiserId: "B", title: "incomplete-old" },
  { advertiserId: "C", title: "incomplete-new" },
  { advertiserId: "D", title: "complete-nonempty" },
];
const cps = {
  A: { lastComplete: true, lastTotalCount: 0, lastFetchedCount: 0, lastRunAt: "2026-11-08T11:00:00.000Z" },
  B: {
    lastComplete: false,
    lastTotalCount: 90000,
    lastFetchedCount: 100,
    lastStoppedEarlyForBudget: true,
    lastRunAt: "2026-11-07T10:00:00.000Z",
    productsRemainingEstimate: 89900,
  },
  C: {
    lastComplete: false,
    lastTotalCount: 500,
    lastFetchedCount: 100,
    lastRunAt: "2026-11-08T11:30:00.000Z",
    productsRemainingEstimate: 400,
  },
  D: {
    lastComplete: true,
    lastTotalCount: 200,
    lastFetchedCount: 200,
    lastRunAt: "2026-11-08T11:00:00.000Z",
  },
};
const fair = selectPartnersForFairDiscovery(partners, cps, { nowMs, starvationHours: 12 });
assert(fair.selected[0].advertiserId === "B", "oldest incomplete first");
assert(fair.counts.starved >= 1, "starvation detected for B");
assert(fair.order[fair.order.length - 1].advertiserId === "A", "empty complete last");

const summary = summarizeTraversalClassifications(
  Object.entries(cps).map(([id, cp]) => ({
    advertiserId: id,
    ...classifyPartnerTraversalStatus(cp),
  }))
);
assert(summary.completeVerifiedEmpty === 1, "summary empty");
assert(summary.completeNonempty === 1, "summary nonempty");
assert(summary.stoppedEarly + summary.incomplete === 2, "summary open feeds");

console.log(
  JSON.stringify({
    IU_CJ_CATALOG_FAIRNESS_V51_8_SELFTEST: "PASS",
    statuses: {
      nonempty: nonempty.status,
      empty: empty.status,
      noFeed: noFeed.status,
      incomplete: incomplete.status,
      stopped: stopped.status,
    },
    fairHead: fair.order[0],
    summary,
  })
);
