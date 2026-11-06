#!/usr/bin/env node
import {
  classifyPartnerProgress,
  buildProductProgressLedger,
  buildFetchedPublishedFunnel,
  buildPriceAvailabilityHistory,
  collectChangeRowsFromOffersDoc,
  summarizeHonestContinuationCounts,
  PARTNER_PROGRESS_STATE,
} from "./iu-cj-affiliate-phase3z-product-progress-v48.mjs";
import { mergeRefreshedProductIntoCard } from "./iu-cj-affiliate-phase3z-offers-freshness-v32.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

// 1→1 / 0→0 must NOT be product progress
const noProg = classifyPartnerProgress(
  { resumeOffset: 1, lastFetchedCount: 0, lastTotalCount: 0, completePassCount: 5 },
  { resumeOffset: 1, lastFetchedCount: 0, lastTotalCount: 0, completePassCount: 6 },
  { hasFeed: true }
);
assert(noProg.state === PARTNER_PROGRESS_STATE.API_EMPTY, "empty api");
assert(noProg.productProgress === false, "empty not product progress");

const cursorOnly = classifyPartnerProgress(
  { resumeOffset: 101, lastFetchedCount: 0, lastTotalCount: 500, completePassCount: 0 },
  { resumeOffset: 201, lastFetchedCount: 0, lastTotalCount: 500, completePassCount: 0 },
  { hasFeed: true }
);
assert(cursorOnly.state === PARTNER_PROGRESS_STATE.CURSOR_ADVANCED, "cursor only");
assert(cursorOnly.productProgress === false, "cursor without rows not product progress");

const withRows = classifyPartnerProgress(
  { resumeOffset: 101, lastFetchedCount: 100, lastTotalCount: 500, completePassCount: 0 },
  { resumeOffset: 201, lastFetchedCount: 100, lastTotalCount: 500, completePassCount: 0 },
  { hasFeed: true }
);
assert(withRows.state === PARTNER_PROGRESS_STATE.PRODUCTS_FETCHED, "products fetched");
assert(withRows.productProgress === true, "product progress");

const refreshCycle = classifyPartnerProgress(
  { resumeOffset: 401, lastFetchedCount: 50, lastTotalCount: 420, completePassCount: 1 },
  { resumeOffset: 1, lastFetchedCount: 100, lastTotalCount: 420, completePassCount: 2 },
  { hasFeed: true }
);
assert(refreshCycle.state === PARTNER_PROGRESS_STATE.NEW_REFRESH_CYCLE_STARTED, "refresh cycle");

const ledger = buildProductProgressLedger({
  inventoryPartners: [
    { advertiserId: "1", hasFeed: true, partnerName: "A" },
    { advertiserId: "2", hasFeed: true, partnerName: "B" },
    { advertiserId: "3", hasFeed: false, partnerName: "C" },
  ],
  previousPartners: {
    "1": { resumeOffset: 1, lastFetchedCount: 0, lastTotalCount: 0, completePassCount: 1 },
    "2": { resumeOffset: 101, lastFetchedCount: 100, lastTotalCount: 500, completePassCount: 0 },
  },
  currentPartners: {
    "1": { resumeOffset: 1, lastFetchedCount: 0, lastTotalCount: 0, completePassCount: 2 },
    "2": { resumeOffset: 201, lastFetchedCount: 100, lastTotalCount: 500, completePassCount: 0 },
  },
});
assert(ledger.counts.withFeedTracked === 2, "only withFeed");
assert(ledger.counts.productProgress === 1, "one product progress");
assert(ledger.counts.apiEmpty === 1, "one api empty");
const honest = summarizeHonestContinuationCounts(ledger);
assert(honest.advancedProductProgress === 1, "honest advanced");
assert(honest.withFeedTracked === 2, "honest withFeed");

const funnel = buildFetchedPublishedFunnel({
  fetchedRows: 52225,
  uniqueInWindow: 18000,
  validated: 12000,
  ready: 8000,
  published: 3609,
  publishedUnique: 3250,
});
assert(funnel.snapshot.fetchedRows === 52225, "fetched");
assert(funnel.snapshot.publishedOccurrences === 3609, "published");
assert(funnel.stages[0].name === "API_FETCHED", "stage0");
assert(funnel.stages[1].name === "UNIQUE_IDENTITIES", "stage1");
assert(funnel.stages[1].accepted === 18000, "unique accepted");
assert(funnel.stages[1].rejected === 0 || funnel.stages[1].duplicates === 34225, "unique dups accounted");

const funnelUnknownUnique = buildFetchedPublishedFunnel({
  fetchedRows: 100,
  ready: 80,
  published: 10,
});
assert(funnelUnknownUnique.stages[1].accepted == null, "unique unknown accepted null");
assert(funnelUnknownUnique.stages[1].rejected == null, "unique unknown not rejected-all");
assert(funnelUnknownUnique.stages[1].unknown === 100, "unique unknown=input");

// Deterministic synthetic price change (selftest only — not production ledger)
const nowIso = "2026-11-05T20:00:00.000Z";
const merged = mergeRefreshedProductIntoCard(
  { advertiserId: "9", productId: "p1", currentPrice: 100, currency: "CZK", availability: "in stock" },
  { currentPrice: 90, currency: "CZK", availability: "in stock" },
  nowIso
);
assert(merged.priceChanged === true, "synth price changed");
assert(merged.card.previousPrice === 100, "previous price stored");
const doc = {
  sections: [{ products: [{ ...merged.card, advertiserId: "9", productId: "p1" }] }],
};
const collected = collectChangeRowsFromOffersDoc(doc, { nowIso, runId: "selftest", acceptAny: true });
assert(collected.priceChanges.length === 1, "collected price change");
assert(collected.priceChanges[0].changeClassification === "PRICE_CHANGED", "economic class");
const hist = buildPriceAvailabilityHistory({
  priceChanges: collected.priceChanges,
  formatOnlyChanges: [],
  availabilityChanges: [],
  nowIso,
  evidenceClass: "SELFTEST_SYNTHETIC",
});
assert(hist.counts.priceStatus === "OBSERVED", "observed in selftest");
const zero = buildPriceAvailabilityHistory({ priceChanges: [], availabilityChanges: [] });
assert(zero.counts.priceStatus === "ZERO_OBSERVED_CHANGES", "zero observed");

const fmtMerged = mergeRefreshedProductIntoCard(
  { advertiserId: "9", productId: "p2", currentPrice: "4490.00", currency: "CZK" },
  { currentPrice: 4490, currency: "CZK" },
  nowIso
);
assert(fmtMerged.priceChanged === false, "format merge not economic");
const fmtDoc = {
  sections: [{ products: [{ ...fmtMerged.card, advertiserId: "9", productId: "p2" }] }],
};
const fmtCollected = collectChangeRowsFromOffersDoc(fmtDoc, { nowIso, runId: "selftest", acceptAny: true });
assert(fmtCollected.priceChanges.length === 0, "format not in priceChanges");
assert((fmtCollected.formatOnlyChanges || []).length === 1, "format diagnostic row");

// Idempotent: same change twice should still be one logical event when deduped by caller
assert(collected.priceChanges[0].advertiserId === "9", "compound advertiser");
assert(collected.priceChanges[0].productId === "p1", "compound product");

console.log(
  JSON.stringify({
    IU_CJ_PRODUCT_PROGRESS_V48_SELFTEST: "PASS",
    honest,
    funnelRatio: funnel.snapshot.ratioPublishedToFetched,
    priceSelftest: hist.counts.priceStatus,
  })
);
