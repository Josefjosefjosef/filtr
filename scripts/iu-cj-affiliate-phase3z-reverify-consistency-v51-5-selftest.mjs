#!/usr/bin/env node
import {
  REVERIFY_CLASS,
  buildCrossRunIndividualLedger,
  buildReverifyAgeBuckets,
  resolveReverifyTimestampProvenance,
} from "./iu-cj-affiliate-phase3z-product-reverify-v50.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

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
      currentVerificationTimestamp: "2026-11-07T12:00:00.000Z",
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
      currentPrice: 10,
      currentAvailability: "in_stock",
      successfullyReverified: true,
      sourceMatchResult: "SOURCE_MATCHED",
      reverifyClassification: REVERIFY_CLASS.REVERIFIED_PRICE_CHANGED,
      currentVerificationTimestamp: "2026-11-08T01:00:00.000Z",
      fetchedAt: "2026-11-08T00:50:00.000Z",
    },
    {
      compoundIdentity: "B|2",
      advertiserId: "B",
      productId: "2",
      runId: "next",
      currentPrice: 5,
      currentAvailability: "in_stock",
      successfullyReverified: true,
      sourceMatchResult: "SOURCE_MATCHED",
      reverifyClassification: REVERIFY_CLASS.REVERIFIED_UNCHANGED,
      currentVerificationTimestamp: "2026-11-08T01:00:00.000Z",
      currentFetchTimestamp: "2026-11-08T00:55:00.000Z",
    },
  ],
};

const cross = buildCrossRunIndividualLedger(prev, next);
assert(cross.counts.reverifyAttempted === 2, "attempted 2");
assert(cross.counts.withinRunChangedByClassification === 1, "within-run changed 1");
assert(cross.counts.crossRunObservedChanged === 0, "no cross-run numeric delta");
const mismatched = cross.rows.find((r) => r.compoundIdentity === "A|1");
assert(mismatched.classificationPriceMismatch, "mismatch flagged");
assert(mismatched.economicChange === false, "economicChange false when prices equal");
assert(mismatched.reverifyAttempted === true, "attempted derived");

const age = buildReverifyAgeBuckets(
  { ...next, rows: next.rows.map((r) => ({ ...r, currentFetchTimestamp: r.currentFetchTimestamp || r.fetchedAt })) },
  { nowIso: "2026-11-08T04:00:00.000Z" }
);
assert(age.provenanceCounts.FETCH_TIMESTAMP_VERIFIED === 2, "fetch provenance");
const prov = resolveReverifyTimestampProvenance({ currentVerificationTimestamp: "2026-11-08T01:00:00.000Z" });
assert(prov.provenance === "VERIFICATION_BATCH_OR_LOCAL_ONLY", "verification-only disclosed");

console.log(
  JSON.stringify({
    V51_5_REVERIFY_CONSISTENCY_SELFTEST: "PASS",
    withinRunChanged: cross.counts.withinRunChangedByClassification,
    crossObservedChanged: cross.counts.crossRunObservedChanged,
    attempted: cross.counts.reverifyAttempted,
  })
);
