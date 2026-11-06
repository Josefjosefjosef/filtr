#!/usr/bin/env node
/**
 * V50 offline selftest: durable price history idempotency + reverify ledger honesty.
 */
import {
  appendDurablePriceHistory,
  assertDurableHistoryReadable,
  emptyDurablePriceHistory,
  toDurablePriceEvent,
  makePriceEventKey,
} from "./iu-cj-affiliate-phase3z-durable-price-history-v50.mjs";
import {
  buildProductReverifyLedger,
  compareReverifyRuns,
  indexProductsByCompoundIdentity,
  REVERIFY_CLASS,
} from "./iu-cj-affiliate-phase3z-product-reverify-v50.mjs";
import { buildProductIdentityLedger } from "./iu-cj-affiliate-phase3z-product-identity-v50.mjs";
import { PRICE_CHANGE_CLASS } from "./iu-cj-affiliate-phase3z-price-normalize-v49.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const nowIso = "2026-11-06T08:00:00.000Z";

// --- durable price: economic vs format-only ---
const econRow = {
  advertiserId: "111",
  productId: "P1",
  previousPrice: "100.00",
  newPrice: "110.00",
  currency: "CZK",
  runId: "runA",
  publicationResult: "PUBLISHED",
};
const fmtRow = {
  advertiserId: "111",
  productId: "P2",
  previousPrice: "100",
  newPrice: "100.00",
  currency: "CZK",
  runId: "runA",
};

const empty = emptyDurablePriceHistory({ nowIso, runId: "runA" });
const d1 = appendDurablePriceHistory(empty, {
  nowIso,
  runId: "runA",
  priceChanges: [econRow],
  formatOnlyChanges: [fmtRow],
  availabilityChanges: [],
});
assert(d1.counts.economicEvents === 1, "econ=1");
assert(d1.counts.formatOnlyEvents === 1, "fmt=1");
assert(d1.events[0].changeClassification === PRICE_CHANGE_CLASS.PRICE_CHANGED, "class PRICE_CHANGED");
assert(d1.events[0].compoundIdentity === "111|P1", "compound");
assert(d1.events[0].eventKey === makePriceEventKey(d1.events[0]), "eventKey stable");
assert(d1.events[0].previousNormalizedPrice != null, "prev norm");
assert(d1.events[0].currentNormalizedPrice != null, "next norm");

// Idempotent re-append same run
const d2 = appendDurablePriceHistory(d1, {
  nowIso,
  runId: "runA",
  priceChanges: [econRow],
  formatOnlyChanges: [fmtRow],
});
assert(d2.counts.economicEvents === 1, "idempotent econ");
assert(d2.counts.skippedDuplicateKeys >= 2, "skipped dups");
const readable = assertDurableHistoryReadable(d1, d2);
assert(readable.readable === true, "prior keys readable");
assert(readable.missing === 0, "no missing keys");

// Next independent run appends new economic change
const econRow2 = { ...econRow, newPrice: "120.00", runId: "runB" };
const d3 = appendDurablePriceHistory(d2, {
  nowIso: "2026-11-06T09:00:00.000Z",
  runId: "runB",
  priceChanges: [econRow2],
});
assert(d3.counts.economicEvents === 2, "second run append");
assert(assertDurableHistoryReadable(d2, d3).readable === true, "cross-run readable");

const ev = toDurablePriceEvent(econRow, { nowIso, runId: "runA" });
assert(ev.storageKey === ev.eventKey, "storageKey=eventKey");

// --- reverify: only source-matched counts ---
const doc = {
  sections: [
    {
      sectionKey: "s1",
      products: [
        {
          advertiserId: "111",
          productId: "P1",
          currentPrice: "110.00",
          previousPrice: "100.00",
          currency: "CZK",
          availability: "in stock",
          verifiedAt: nowIso,
          lastSuccessfulRefreshAt: nowIso,
          feedId: "F1",
        },
        {
          advertiserId: "111",
          productId: "P3",
          currentPrice: "50.00",
          currency: "CZK",
          availability: "in stock",
          verifiedAt: "2026-11-05T00:00:00.000Z",
        },
      ],
    },
  ],
};
const previousByKey = indexProductsByCompoundIdentity({
  sections: [
    {
      products: [
        {
          advertiserId: "111",
          productId: "P1",
          currentPrice: "100.00",
          currency: "CZK",
          availability: "in stock",
          verifiedAt: "2026-11-05T00:00:00.000Z",
        },
      ],
    },
  ],
});
const refreshedByKey = new Map([
  [
    "111|P1",
    { currentPrice: "110.00", availability: "in stock", gone: false },
  ],
]);
const coverageByKey = new Map([
  ["111|P1", { refreshResult: "SUCCESSFULLY_REFRESHED", startedOffset: 1 }],
  ["111|P3", { refreshResult: "NOT_IN_SCAN_WINDOW", startedOffset: 1 }],
]);

const rev = buildProductReverifyLedger({
  doc,
  previousByKey,
  refreshedByKey,
  coverageByKey,
  nowIso,
  runId: "runA",
});
assert(rev.counts.successfullyReverified === 1, "one true reverify");
assert(rev.counts.attemptedReverify === 2, "attempted=coverage+refresh");
const p1 = rev.rows.find((r) => r.compoundIdentity === "111|P1");
assert(p1.reverifyClassification === REVERIFY_CLASS.REVERIFIED_PRICE_CHANGED, "price changed");
assert(p1.successfullyReverified === true, "success flag");
const p3 = rev.rows.find((r) => r.compoundIdentity === "111|P3");
assert(p3.reverifyClassification === REVERIFY_CLASS.SOURCE_NOT_FOUND, "miss");
assert(p3.successfullyReverified === false, "miss not success");

const revB = buildProductReverifyLedger({
  doc,
  previousByKey,
  refreshedByKey,
  coverageByKey,
  nowIso: "2026-11-06T10:00:00.000Z",
  runId: "runB",
});
const cross = compareReverifyRuns(rev, revB);
assert(cross.intersectionSuccessfullyReverified === 1, "cross-run intersection");

// Timestamp-only churn must NOT invent reverify without refreshedByKey
const revNoSource = buildProductReverifyLedger({
  doc,
  previousByKey,
  refreshedByKey: new Map(),
  coverageByKey: new Map(),
  nowIso,
  runId: "runC",
});
assert(revNoSource.counts.successfullyReverified === 0, "no source = zero reverify");

// --- identity UNIQUE ≠ fetched when duplicates ---
const idLedger = buildProductIdentityLedger({
  fetchedRows: [
    { advertiserId: "111", productId: "P1", feedId: "F1" },
    { advertiserId: "111", productId: "P1", feedId: "F1" },
    { advertiserId: "111", productId: "P2", feedId: "F2" },
    { advertiserId: "222", productId: "P1", feedId: "F3" },
  ],
  publishedDoc: doc,
  nowIso,
  runId: "runA",
});
assert(idLedger.accounting.fetchedRowsWithIdentity === 4, "fetched 4");
assert(idLedger.accounting.uniqueIdentitiesInRun === 3, "unique 3");
assert(idLedger.accounting.uniqueEqualsFetchedRows === false, "not equal");
assert(idLedger.accounting.crossPartnerSameProductIdCount === 1, "cross partner P1");
assert(idLedger.accounting.publishedUnique === 2, "published unique");

console.log(
  JSON.stringify({
    V50_DURABLE_REVERIFY_SELFTEST: "PASS",
    durableEconomic: d3.counts.economicEvents,
    durableFormatOnly: d3.counts.formatOnlyEvents,
    reverifyOk: rev.counts.successfullyReverified,
    identityUnique: idLedger.accounting.uniqueIdentitiesInRun,
  })
);
