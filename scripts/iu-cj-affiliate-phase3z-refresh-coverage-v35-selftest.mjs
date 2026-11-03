#!/usr/bin/env node
/**
 * V35 — refresh coverage + continueable window selftest (offline).
 */
import {
  REFRESH_COVERAGE_SCHEMA,
  REFRESH_RESULT,
  advanceRefreshPartnerCheckpoint,
  buildRefreshCoverageLedger,
  estimateFullCoverageHours,
  orderAdvertisersForRefresh,
  summarizeCoverageFromLedger,
} from "./iu-cj-affiliate-phase3z-refresh-coverage-v35.mjs";
import { CJ_CALL_MIN_INTERVAL_MS } from "./iu-cj-affiliate-phase1-lib.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const keys = [
  { advertiserId: "A", productId: "1", sectionKey: "s1" },
  { advertiserId: "A", productId: "2", sectionKey: "s1" },
  { advertiserId: "B", productId: "9", sectionKey: "s2" },
];
const prevByKey = new Map([
  ["A|1", { lastSuccessfulRefreshAt: "2026-11-01T00:00:00.000Z" }],
  ["A|2", { lastSuccessfulRefreshAt: "2026-11-03T00:00:00.000Z" }],
]);
const ordered = orderAdvertisersForRefresh(keys, prevByKey);
assert(ordered[0].advertiserId === "B", "never-refreshed advertiser first");
assert(ordered[1].advertiserId === "A", "older cohort second");

const matchedKeys = new Set(["A|1"]);
const scanned = new Set(["A"]);
const ledger = buildRefreshCoverageLedger({
  keys,
  matchedKeys,
  scannedAdvertisers: scanned,
  errorAdvertisers: new Set(),
  prevByKey,
  nowIso: "2026-11-04T00:00:00.000Z",
});
assert(ledger.schema === REFRESH_COVERAGE_SCHEMA, "schema");
assert(ledger.counts.successfullyRefreshed === 1, "one matched");
assert(ledger.counts.notInScanWindow === 1, "A|2 not in window");
assert(ledger.counts.notAttempted === 1, "B not attempted");
const rowA2 = ledger.rows.find((r) => r.sourceIdentity === "A|2");
assert(rowA2.refreshResult === REFRESH_RESULT.NOT_IN_SCAN_WINDOW, "window miss status");
assert(rowA2.refreshReason.includes("not_in_window"), "honest reason");
const sum = summarizeCoverageFromLedger(ledger);
assert(sum.matchRateOfPublished === 0.3333, "1/3 published matched");
assert(/not treated as deleted/i.test(sum.honestNote), "honest note");

const adv = advanceRefreshPartnerCheckpoint(null, {
  advertiserId: "A",
  startedOffset: 1,
  fetchedCount: 500,
  totalCount: 500,
  matched: 1,
  notInWindow: 1,
  pageSize: 100,
  maxPages: 5,
  at: "2026-11-04T00:00:00.000Z",
});
assert(adv.wrapped === true, "wrap when past totalCount");
assert(adv.resumeOffset === 1, "resume at first after wrap");

const deep = estimateFullCoverageHours({
  advertisers: 133,
  maxPartnerCatalogDepth: 5000,
  refreshPageSize: 100,
  refreshMaxPages: 5,
  callIntervalMs: CJ_CALL_MIN_INTERVAL_MS,
});
assert(deep.passesNeeded === 10, "5000/500 = 10 passes");
assert(deep.meetsAllProductsEvery3h === false, "cannot claim all products every 3h for deep catalogs");
assert(/scan-window based/i.test(deep.caveat), "caveat");

const shallow = estimateFullCoverageHours({
  advertisers: 28,
  maxPartnerCatalogDepth: 400,
  refreshPageSize: 100,
  refreshMaxPages: 5,
  callIntervalMs: CJ_CALL_MIN_INTERVAL_MS,
});
assert(shallow.meetsAllProductsEvery3h === true, "shallow catalogs can meet 3h");

console.log(
  JSON.stringify(
    {
      ok: true,
      schema: REFRESH_COVERAGE_SCHEMA,
      sampleCoverage: sum,
      deepCapacity: deep,
      shallowCapacity: shallow,
    },
    null,
    2
  )
);
