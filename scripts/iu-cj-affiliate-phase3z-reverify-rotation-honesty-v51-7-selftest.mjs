#!/usr/bin/env node
/**
 * V51.7 — presentation rotation must not be reported as catalog NEW_PRODUCT,
 * and source-matched rows without prior window baseline count as successfullyReverified.
 */
import {
  REVERIFY_CLASS,
  buildProductReverifyLedger,
} from "./iu-cj-affiliate-phase3z-product-reverify-v50.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const doc = {
  sections: [
    {
      sectionKey: "aff-test",
      products: [
        {
          advertiserId: "A",
          productId: "rotating-1",
          currentPrice: 10,
          currency: "CZK",
          availability: "in stock",
          publicationReady: true,
        },
      ],
    },
  ],
};

const ledger = buildProductReverifyLedger({
  doc,
  previousByKey: new Map(), // empty prior published window
  previousReverifyByKey: new Map(),
  refreshedByKey: new Map([["A|rotating-1", { fetchedAt: "2026-11-08T06:00:00.000Z" }]]),
  coverageByKey: new Map(),
  runId: "t",
  nowIso: "2026-11-08T06:00:00.000Z",
});

const row = ledger.rows[0];
assert(row.reverifyClassification === REVERIFY_CLASS.SOURCE_VERIFIED_NO_PRIOR_BASELINE, "rotation class");
assert(row.successfullyReverified === true, "counts as verified");
assert(row.crossRunPriceComparable === false, "not cross-run comparable");
assert(ledger.counts.successfullyReverified === 1, "count");
assert(ledger.counts.windowFirstSourceVerify === 1, "window first");
assert(ledger.counts.coveragePctSuccessfullyReverified === 100, "coverage 100");

console.log(
  JSON.stringify({
    V51_7_REVERIFY_ROTATION_HONESTY_SELFTEST: "PASS",
    class: row.reverifyClassification,
    successfullyReverified: row.successfullyReverified,
  })
);
