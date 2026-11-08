#!/usr/bin/env node
/**
 * V51.6: price classification truth — null baseline must not invent PRICE_CHANGED;
 * mismatch detection uses within-row prices; confirmed vs insufficient split.
 */
import {
  REVERIFY_CLASS,
  buildCrossRunIndividualLedger,
  buildProductReverifyLedger,
} from "./iu-cj-affiliate-phase3z-product-reverify-v50.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

// --- Cross-run ledger: confirmed vs insufficient ---
const prev = {
  runId: "prev",
  rows: [
    {
      compoundIdentity: "A|1",
      advertiserId: "A",
      productId: "1",
      runId: "prev",
      currentPrice: 10,
      currentAvailability: "in_stock",
      successfullyReverified: true,
    },
  ],
};
const next = {
  runId: "next",
  rows: [
    {
      compoundIdentity: "A|1",
      advertiserId: "A",
      productId: "1",
      runId: "next",
      previousPrice: 12,
      currentPrice: 10,
      currentAvailability: "in_stock",
      successfullyReverified: true,
      sourceMatchResult: "SOURCE_MATCHED",
      reverifyClassification: REVERIFY_CLASS.REVERIFIED_PRICE_CHANGED,
      economicChange: true,
    },
    {
      compoundIdentity: "B|2",
      advertiserId: "B",
      productId: "2",
      runId: "next",
      previousPrice: null,
      currentPrice: 5,
      successfullyReverified: true,
      sourceMatchResult: "SOURCE_MATCHED",
      reverifyClassification: REVERIFY_CLASS.REVERIFIED_PRICE_CHANGED,
      economicChange: true,
    },
    {
      compoundIdentity: "C|3",
      advertiserId: "C",
      productId: "3",
      runId: "next",
      previousPrice: 7,
      currentPrice: 7,
      successfullyReverified: true,
      sourceMatchResult: "SOURCE_MATCHED",
      reverifyClassification: REVERIFY_CLASS.REVERIFIED_PRICE_CHANGED,
      economicChange: true,
    },
  ],
};

const cross = buildCrossRunIndividualLedger(prev, next);
const a = cross.rows.find((r) => r.compoundIdentity === "A|1");
const b = cross.rows.find((r) => r.compoundIdentity === "B|2");
const c = cross.rows.find((r) => r.compoundIdentity === "C|3");
assert(a.resolvedPriceOutcome === "PRICE_CHANGED_CONFIRMED", "A confirmed");
assert(a.economicChange === true, "A economic");
assert(b.resolvedPriceOutcome === "INSUFFICIENT_COMPARISON_DATA", "B insufficient");
assert(b.economicChange === false, "B not economic");
assert(c.resolvedPriceOutcome === "CLASSIFICATION_MISMATCH", "C mismatch");
assert(c.economicChange === false, "C not economic");
assert(cross.counts.priceChangedConfirmed === 1, "confirmed count");
assert(cross.counts.insufficientComparisonData >= 1, "insufficient count");
assert(cross.counts.changed === 1, "changed aliases confirmed");

// --- Fresh ledger build: null baseline → NEW_PRODUCT / UNCHANGED, not PRICE_CHANGED ---
const offers = {
  sections: [
    {
      sectionKey: "aff-test",
      products: [
        {
          advertiserId: "X",
          productId: "1",
          currentPrice: 99,
          currency: "CZK",
          availability: "in stock",
          publicationReady: true,
        },
      ],
    },
  ],
};
const fresh = buildProductReverifyLedger({
  doc: offers,
  previousByKey: new Map(),
  previousReverifyByKey: new Map(),
  refreshedByKey: new Map([["X|1", { fetchedAt: "2026-11-08T01:00:00.000Z" }]]),
  coverageByKey: new Map(),
  runId: "t1",
  nowIso: "2026-11-08T01:00:00.000Z",
});
const row = fresh.rows.find((r) => r.compoundIdentity === "X|1");
assert(row, "row present");
assert(
  row.reverifyClassification === REVERIFY_CLASS.SOURCE_VERIFIED_NO_PRIOR_BASELINE ||
    row.reverifyClassification === REVERIFY_CLASS.REVERIFIED_UNCHANGED ||
    row.reverifyClassification === REVERIFY_CLASS.NEW_PRODUCT,
  "null baseline must not be PRICE_CHANGED, got " + row.reverifyClassification
);
assert(row.economicChange !== true, "no economic without baseline");
assert(row.successfullyReverified === true, "source-matched rotation entry counts as verified");

// Real price change
const offers2 = {
  sections: [
    {
      sectionKey: "aff-test",
      products: [
        {
          advertiserId: "Y",
          productId: "2",
          currentPrice: 80,
          currency: "CZK",
          availability: "in stock",
          publicationReady: true,
        },
      ],
    },
  ],
};
const changed = buildProductReverifyLedger({
  doc: offers2,
  previousByKey: new Map([
    ["Y|2", { currentPrice: 100, currency: "CZK", availability: "in stock" }],
  ]),
  previousReverifyByKey: new Map(),
  refreshedByKey: new Map([["Y|2", { fetchedAt: "2026-11-08T01:00:00.000Z" }]]),
  coverageByKey: new Map(),
  runId: "t2",
  nowIso: "2026-11-08T01:00:00.000Z",
});
const y = changed.rows.find((r) => r.compoundIdentity === "Y|2");
assert(y.reverifyClassification === REVERIFY_CLASS.REVERIFIED_PRICE_CHANGED, "real change class");
assert(y.economicChange === true, "real economic");
assert(Number(y.previousPrice) === 100 && Number(y.currentPrice) === 80, "prices stored");

console.log(
  JSON.stringify({
    V51_6_REVERIFY_CONSISTENCY_SELFTEST: "PASS",
    confirmed: cross.counts.priceChangedConfirmed,
    insufficient: cross.counts.insufficientComparisonData,
    mismatch: cross.counts.classificationPriceMismatchCount,
  })
);
