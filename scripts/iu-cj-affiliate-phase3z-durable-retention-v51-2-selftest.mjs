#!/usr/bin/env node
/**
 * V51.2 offline selftest: format-only retention ledger + honest readProof split.
 */
import {
  appendDurablePriceHistory,
  assertDurableHistoryReadable,
  compareDurableKeySets,
  emptyDurablePriceHistory,
  RETENTION_POLICY_VERSION,
  DEFAULT_MAX_FORMAT_ONLY,
} from "./iu-cj-affiliate-phase3z-durable-price-history-v50.mjs";
import { PRICE_CHANGE_CLASS } from "./iu-cj-affiliate-phase3z-price-normalize-v49.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const t0 = "2026-11-07T10:00:00.000Z";

function fmtRow(i, runId, ts) {
  return {
    advertiserId: "ADV",
    productId: "F" + String(i),
    previousPrice: String(100 + i),
    newPrice: String(100 + i) + ".00",
    currency: "CZK",
    runId,
    changeTimestamp: ts,
  };
}

function econRow(i, runId, prev, next, ts) {
  return {
    advertiserId: "ADV",
    productId: "E" + String(i),
    previousPrice: String(prev),
    newPrice: String(next),
    currency: "CZK",
    runId,
    changeTimestamp: ts,
    publicationResult: "PUBLISHED",
  };
}

// Seed 5 format-only + 2 economic under maxFormatOnly=3
let doc = emptyDurablePriceHistory({ nowIso: t0, runId: "seed" });
doc = appendDurablePriceHistory(doc, {
  nowIso: t0,
  runId: "seed",
  sha: "sha-seed",
  maxFormatOnly: 3,
  maxAvailability: 3,
  priceChanges: [
    econRow(1, "seed", 10, 11, "2026-11-07T10:00:01.000Z"),
    econRow(2, "seed", 20, 21, "2026-11-07T10:00:02.000Z"),
  ],
  formatOnlyChanges: [
    fmtRow(1, "seed", "2026-11-07T10:00:01.000Z"),
    fmtRow(2, "seed", "2026-11-07T10:00:02.000Z"),
    fmtRow(3, "seed", "2026-11-07T10:00:03.000Z"),
    fmtRow(4, "seed", "2026-11-07T10:00:04.000Z"),
    fmtRow(5, "seed", "2026-11-07T10:00:05.000Z"),
  ],
  availabilityChanges: [],
});

assert(doc.counts.economicEvents === 2, "econ kept 2");
assert(doc.counts.formatOnlyEvents === 3, "fmt capped at 3");
assert(doc.retention.retiredFormatOnlyCount === 2, "2 fmt retired");
assert(doc.retention.policyVersion === RETENTION_POLICY_VERSION, "policy version");
assert(
  doc.retention.archiveStatus === "FORMAT_ONLY_ACTIVE_WINDOW_ONLY" ||
    doc.retention.archiveStatus === "NOT_ARCHIVED_ACTIVE_WINDOW_ONLY" ||
    doc.retention.archiveStatus === "NO_RETENTION_THIS_RUN",
  "format-only window not claimed as durable archive"
);
assert(doc.retention.formatOnlyRetentionLedger.count === 2, "ledger rows=2");
const retiredKeys = doc.retention.formatOnlyRetentionLedger.rows.map((r) => r.eventKey);
assert(retiredKeys.length === 2, "2 retired keys");
for (const row of doc.retention.formatOnlyRetentionLedger.rows) {
  assert(row.archivedStatus === "NOT_ARCHIVED", "row not archived");
  assert(row.archiveLocation === null, "no archive location");
  assert(row.retentionReason === "FORMAT_ONLY_ROLLING_WINDOW", "reason");
  assert(row.retentionPolicyVersion === RETENTION_POLICY_VERSION, "row policy");
  assert(row.advertiserId === "ADV", "adv");
  assert(row.productId, "productId");
  assert(row.previousTimestamp, "prev ts");
  assert(row.retentionTimestamp, "ret ts");
  assert(row.sourceRunId === "seed", "source run");
}

// Next run: keep economic, add more format-only → further retention
const prior = doc;
const next = appendDurablePriceHistory(prior, {
  nowIso: "2026-11-07T11:00:00.000Z",
  runId: "run2",
  sha: "sha-run2",
  maxFormatOnly: 3,
  priceChanges: [econRow(3, "run2", 30, 31, "2026-11-07T11:00:01.000Z")],
  formatOnlyChanges: [
    fmtRow(6, "run2", "2026-11-07T11:00:02.000Z"),
    fmtRow(7, "run2", "2026-11-07T11:00:03.000Z"),
  ],
});
assert(next.counts.economicEvents === 3, "econ append 3");
assert(next.counts.formatOnlyEvents === 3, "fmt still 3");

const proof = assertDurableHistoryReadable(prior, next);
assert(proof.readable === true, "readable=economic intact");
assert(proof.economic.missing === 0, "econ missing 0");
assert(proof.economicHistoryComplete === true, "econ complete");
assert(proof.readbackReadable === true, "tech readback ok");
assert(proof.allHistoricalKeysPreserved === false, "not all keys (fmt retention)");
assert(proof.formatOnly.retainedOut >= 1, "fmt retainedOut >0");
assert(proof.formatOnly.unexpectedMissing === 0, "no unexpected fmt loss");
assert(proof.formatOnly.status === "FORMAT_ONLY_RETENTION_DOCUMENTED", "fmt status");
assert(proof.statuses.economicIntegrity === "PASS", "econ PASS");
assert(proof.statuses.formatOnlyRetentionIntegrity === "PASS", "fmt retention PASS");
assert(proof.statuses.overallDurableIntegrity === "DURABLE_ACCOUNTING_PASS", "accounting PASS");
assert(proof.durableAccountingPass === true, "durableAccountingPass");
assert(proof.classification === "ECONOMIC_AVAIL_INTACT_DIAGNOSTIC_RETENTION", "class");
// Aggregate missing may be >0 while readable stays true
assert(proof.missing === proof.formatOnly.retainedOut + proof.formatOnly.unexpectedMissing, "missing=fmt only");

const cmp = compareDurableKeySets(prior, next);
assert(cmp.economic.missingKeys.length === 0, "set econ missing 0");
assert(cmp.economic.preservedKeys.length === 2, "set econ preserved 2");
assert(cmp.formatOnly.unexpectedMissingKeys.length === 0, "set fmt unexpected 0");
assert(cmp.formatOnly.retainedOutKeys.length >= 1, "set fmt retained");
assert(cmp.duplicates.count === 0, "no dupes");

// Economic must NEVER be silently dropped by format-only cap
const bigFmt = appendDurablePriceHistory(emptyDurablePriceHistory({ nowIso: t0, runId: "e1" }), {
  nowIso: t0,
  runId: "e1",
  maxFormatOnly: 2,
  maxEconomic: 2000,
  priceChanges: [econRow(9, "e1", 1, 2, "2026-11-07T10:00:00.000Z")],
  formatOnlyChanges: Array.from({ length: 10 }, (_, i) =>
    fmtRow(100 + i, "e1", "2026-11-07T10:00:" + String(i).padStart(2, "0") + ".000Z")
  ),
});
assert(bigFmt.counts.economicEvents === 1, "econ survives fmt flood");
assert(bigFmt.counts.formatOnlyEvents === 2, "fmt capped");
assert(bigFmt.events[0].changeClassification === PRICE_CHANGE_CLASS.PRICE_CHANGED, "still PRICE_CHANGED");

// Deterministic tie-break: same timestamp → eventKey order
const tie = appendDurablePriceHistory(emptyDurablePriceHistory({ nowIso: t0, runId: "tie" }), {
  nowIso: t0,
  runId: "tie",
  maxFormatOnly: 1,
  formatOnlyChanges: [
    fmtRow(1, "tie", "2026-11-07T12:00:00.000Z"),
    fmtRow(2, "tie", "2026-11-07T12:00:00.000Z"),
  ],
});
assert(tie.counts.formatOnlyEvents === 1, "tie keep 1");
assert(tie.retention.formatOnlyRetentionLedger.count === 1, "tie retire 1");
assert(DEFAULT_MAX_FORMAT_ONLY === 1000, "default MAX_FMT");

console.log(
  JSON.stringify({
    V51_2_DURABLE_RETENTION_SELFTEST: "PASS",
    economicPreserved: proof.economic.preserved,
    formatOnlyRetainedOut: proof.formatOnly.retainedOut,
    durableAccountingPass: proof.durableAccountingPass,
    classification: proof.classification,
    maxFmt: DEFAULT_MAX_FORMAT_ONLY,
  })
);
