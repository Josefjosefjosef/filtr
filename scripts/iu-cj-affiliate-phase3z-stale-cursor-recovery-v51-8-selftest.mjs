#!/usr/bin/env node
/**
 * V51.8 — repeated_or_stale_cursor: advance past stale page + feed-scoped recovery.
 */
import assert from "node:assert/strict";
import {
  CJ_PRODUCT_SEARCH_OFFSET_FIRST,
  fetchAllShoppingProductsForPartner,
} from "./iu-cj-affiliate-phase2-product-api.mjs";
import {
  advancePartnerCheckpoint,
} from "./iu-cj-affiliate-phase3z-product-feed-checkpoint-v31.mjs";
import {
  buildPartnerFetchErrorAudit,
  classifyPartnerFetchError,
  isPartnerStaleCursorStuck,
  listInventoryAdIdsForPartner,
} from "./iu-cj-affiliate-offers-live-sync-v1.mjs";

assert.equal(classifyPartnerFetchError("repeated_or_stale_cursor"), "PAGINATION_FAILURE");
const audit = buildPartnerFetchErrorAudit("repeated_or_stale_cursor", { resumeOffset: 2401 });
assert.equal(audit.errorClass, "PAGINATION_FAILURE");
assert.equal(audit.robotContinuationRequired, true);

assert.equal(
  isPartnerStaleCursorStuck({
    lastError: "repeated_or_stale_cursor",
    lastComplete: false,
    resumeOffset: 2401,
  }),
  true
);
assert.equal(
  isPartnerStaleCursorStuck({ lastError: null, lastComplete: false, resumeOffset: 1 }),
  false
);
assert.equal(
  isPartnerStaleCursorStuck({
    lastError: "repeated_or_stale_cursor",
    lastComplete: true,
    resumeOffset: 1,
  }),
  false
);

const ads = listInventoryAdIdsForPartner(
  {
    feeds: [
      { advertiserId: "7133039", adId: "15877502" },
      { advertiserId: "7133039", adId: "15877539" },
    ],
  },
  "7133039"
);
assert.deepEqual(ads, ["15877502", "15877539"]);

// Mock env: inject fetch via monkey-patch of global fetch is heavy; unit-test
// checkpoint advance semantics with synthetic fetchResult instead.
const staleMid = {
  fetchedCount: 200,
  totalCount: 20589,
  complete: false,
  error: "repeated_or_stale_cursor",
  stalePageSkipped: true,
  staleTailCompleted: false,
  stoppedEarlyForBudget: false,
  checkpoint: {
    nextOffset: 2701,
    nextPage: null,
    mode: "offset",
    startedOffset: 2401,
    stalePageSkipped: true,
    complete: false,
    fetchedCount: 200,
    totalCount: 20589,
  },
  startedOffset: 2401,
};
const midAdv = advancePartnerCheckpoint(
  {
    advertiserId: "5842597",
    resumeOffset: 2401,
    lastError: "repeated_or_stale_cursor",
    lastComplete: false,
  },
  staleMid,
  { pageSize: 100, publishPerPartner: 25 }
);
assert.equal(midAdv.resumeOffset, 2701, "must advance past stale page");
assert.equal(midAdv.lastComplete, false);
assert.equal(midAdv.lastError, "repeated_or_stale_cursor");

const staleTail = {
  fetchedCount: 15,
  totalCount: 6015,
  complete: true,
  error: null,
  stalePageSkipped: true,
  staleTailCompleted: true,
  stoppedEarlyForBudget: false,
  checkpoint: {
    nextOffset: CJ_PRODUCT_SEARCH_OFFSET_FIRST,
    nextPage: null,
    mode: "offset",
    startedOffset: 6001,
    stalePageSkipped: true,
    staleTailCompleted: true,
    complete: true,
    fetchedCount: 15,
    totalCount: 6015,
  },
  startedOffset: 6001,
};
const tailAdv = advancePartnerCheckpoint(
  {
    advertiserId: "6215286",
    resumeOffset: 6001,
    completePassCount: 5,
    lastComplete: false,
    lastError: "repeated_or_stale_cursor",
  },
  staleTail,
  { pageSize: 100, publishPerPartner: 25 }
);
assert.equal(tailAdv.resumeOffset, CJ_PRODUCT_SEARCH_OFFSET_FIRST);
assert.equal(tailAdv.lastComplete, true);
assert.equal(tailAdv.completePassCount, 6);
assert.equal(tailAdv.lastError, null);

// Past-total via nextOffset alone (checkpoint helper seals pass).
const pastTotal = advancePartnerCheckpoint(
  { advertiserId: "6976980", resumeOffset: 2201, completePassCount: 14 },
  {
    fetchedCount: 0,
    totalCount: 2208,
    complete: false,
    error: "repeated_or_stale_cursor",
    stalePageSkipped: true,
    checkpoint: { nextOffset: 2301, mode: "offset" },
    startedOffset: 2201,
  },
  { pageSize: 100 }
);
assert.equal(pastTotal.lastComplete, true);
assert.equal(pastTotal.resumeOffset, CJ_PRODUCT_SEARCH_OFFSET_FIRST);
assert.equal(pastTotal.completePassCount, 15);

// Offline ceiling path still works (no network).
const early = await fetchAllShoppingProductsForPartner(
  { pat: "x", publisherCid: "1", websitePid: "1" },
  "999",
  { resumeOffset: 9901, pageSize: 100, maxPages: 1 }
);
assert.equal(early.offsetCeiling, true);

console.log(
  JSON.stringify({
    IU_CJ_STALE_CURSOR_RECOVERY_V51_8_SELFTEST: "PASS",
    midResume: midAdv.resumeOffset,
    tailCompletePassCount: tailAdv.completePassCount,
    pastTotalComplete: pastTotal.lastComplete,
  })
);
