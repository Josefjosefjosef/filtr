#!/usr/bin/env node
import {
  selectContinuationSamples,
  buildFeedContinuationLedger,
  decomposeDeclaredProductCounts,
  buildMissingFeedPartnersAudit,
} from "./iu-cj-affiliate-phase3z-feed-continuation-v47.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

const samples = selectContinuationSamples(
  [
    { advertiserId: "1", startedOffset: 1, nextOffset: 1, fetched: 0, totalCount: 0, resumed: false },
    { advertiserId: "2", startedOffset: 101, nextOffset: 201, fetched: 100, totalCount: 320, resumed: true },
    { advertiserId: "3", startedOffset: 1, nextOffset: 101, fetched: 100, totalCount: 500, resumed: false },
  ],
  2
);
assert(samples[0].advertiserId === "2", "prefer resumed advance");
assert(samples[1].advertiserId === "3", "second advance");

const ledger = buildFeedContinuationLedger({
  previousPartners: {
    "2": { resumeOffset: 101, lastFetchedCount: 100, lastTotalCount: 320, completePassCount: 0 },
  },
  currentPartners: {
    "2": {
      resumeOffset: 201,
      lastFetchedCount: 100,
      lastTotalCount: 320,
      completePassCount: 0,
      lastComplete: false,
      productsRemainingEstimate: 120,
    },
    "9": { resumeOffset: 1, lastFetchedCount: 0, lastTotalCount: 0, completePassCount: 0 },
  },
  inventoryPartners: [
    { advertiserId: "2", hasFeed: true, feedCount: 1, partnerName: "Adv" },
    { advertiserId: "9", hasFeed: true, feedCount: 1, partnerName: "Empty" },
  ],
});
assert(ledger.counts.advanced >= 1, "advanced");
assert(ledger.partners.find((p) => p.advertiserId === "2").progressed === true, "partner 2 progressed");
assert(ledger.partners.find((p) => p.advertiserId === "2").proofLine.includes("101→201"), "proof line");

const decomp = decomposeDeclaredProductCounts([
  { advertiserId: "a", adId: "1", productCount: 100, currency: "CZK", language: "cs", advertiserCountry: "CZ" },
  { advertiserId: "a", adId: "1", productCount: 100, currency: "CZK", language: "cs", advertiserCountry: "CZ" },
  { advertiserId: "b", adId: "2", productCount: 50, currency: "EUR", language: "en", advertiserCountry: "DE" },
  { advertiserId: "c", adId: "3", productCount: 0 },
]);
assert(decomp.declaredProductCountSum === 250, "declared sum includes duplicate feed metadata");
assert(decomp.duplicateFeedKeys === 1, "duplicate feed key");
assert(decomp.byCurrency.CZK === 200, "czk");

const miss = buildMissingFeedPartnersAudit({
  funnelPartners: [
    {
      advertiserId: "9",
      stages: { FEED: true },
      inPublicCatalog: false,
      excludeReason: "PRODUCT_API_EMPTY_OR_NO_ACCESS",
      counts: { fetched: 0, totalCount: 0 },
    },
  ],
  inventoryByAdvertiser: {
    "9": { partnerName: "EmptyCo", joined: true, declaredProductCountSum: 10, feeds: [{ adId: "x" }] },
  },
  checkpoints: { "9": { lastFetchedCount: 0, lastTotalCount: 0, lastError: null } },
});
assert(miss.count === 1, "missing count");
assert(miss.partners[0].nextAction.includes("KEEP_MONITOR"), "next action");

console.log(JSON.stringify({ IU_CJ_FEED_CONTINUATION_V47_SELFTEST: "PASS", sampleIds: samples.map((s) => s.advertiserId), ledgerCounts: ledger.counts, decompSum: decomp.declaredProductCountSum }));
