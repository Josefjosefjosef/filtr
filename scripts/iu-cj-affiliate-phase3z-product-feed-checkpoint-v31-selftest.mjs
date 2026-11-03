#!/usr/bin/env node
/**
 * V31 — prove product-feed continuation between two sync-like runs (offline).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  advancePartnerCheckpoint,
  emptyProductFeedCheckpointState,
  loadProductFeedCheckpointState,
  proveContinuationBetweenRuns,
  saveProductFeedCheckpointState,
  selectPresentationSlice,
} from "./iu-cj-affiliate-phase3z-product-feed-checkpoint-v31.mjs";
import { CJ_PRODUCT_SEARCH_OFFSET_FIRST } from "./iu-cj-affiliate-phase2-product-api.mjs";

const failures = [];
function expect(id, cond) {
  if (!cond) failures.push(id);
}

const adv = "6466592";
let state = emptyProductFeedCheckpointState({ websitePid: "101883843" });
const cp0 = state.partners[adv] || {
  advertiserId: adv,
  resumeOffset: CJ_PRODUCT_SEARCH_OFFSET_FIRST,
  presentationCursor: 0,
};

// Simulate run A: start at 1, fetch 100, stop for presentation budget, nextOffset=101
const fetchA = {
  fetchedCount: 100,
  totalCount: 5000,
  complete: false,
  stoppedEarlyForBudget: true,
  startedOffset: 1,
  checkpoint: {
    nextOffset: 101,
    nextPage: null,
    mode: "offset",
    startedOffset: 1,
    stoppedEarlyForBudget: true,
    complete: false,
    fetchedCount: 100,
    totalCount: 5000,
  },
  error: null,
};
const afterA = advancePartnerCheckpoint(cp0, fetchA, { pageSize: 100, publishPerPartner: 25 });
state.partners[adv] = afterA;
expect("runA_next_offset_101", afterA.resumeOffset === 101);
expect("runA_not_complete", afterA.lastComplete !== true);
expect("runA_cursor_25", afterA.presentationCursor === 25);

const idsA = Array.from({ length: 100 }, (_, i) => "pA-" + (i + 1));
const sliceA = selectPresentationSlice(
  idsA.map((id) => ({ productId: id, publicationReady: true })),
  25,
  0
);
expect("sliceA_25", sliceA.selected.length === 25);
expect("sliceA_first", sliceA.selected[0].productId === "pA-1");

// Simulate run B: resume at 101
const fetchB = {
  fetchedCount: 100,
  totalCount: 5000,
  complete: false,
  stoppedEarlyForBudget: true,
  startedOffset: afterA.resumeOffset,
  checkpoint: {
    nextOffset: 201,
    nextPage: null,
    mode: "offset",
    startedOffset: afterA.resumeOffset,
    stoppedEarlyForBudget: true,
    complete: false,
    fetchedCount: 100,
    totalCount: 5000,
  },
  error: null,
};
const afterB = advancePartnerCheckpoint(afterA, fetchB, { pageSize: 100, publishPerPartner: 25 });
expect("runB_started_from_A_next", fetchB.startedOffset === 101);
expect("runB_next_201", afterB.resumeOffset === 201);
expect("runB_cursor_50", afterB.presentationCursor === 50);

const idsB = Array.from({ length: 100 }, (_, i) => "pB-" + (i + 101));
const proof = proveContinuationBetweenRuns(
  {
    advertiserId: adv,
    startedOffset: 1,
    nextOffset: afterA.resumeOffset,
    productIds: idsA,
  },
  {
    advertiserId: adv,
    startedOffset: afterA.resumeOffset,
    nextOffset: afterB.resumeOffset,
    productIds: idsB,
  }
);
expect("continuation_proven", proof.ok === true && proof.proof === "CONTINUATION_PROVEN");
expect("no_overlap", proof.overlapProductIds === 0);

// Presentation rotation across same window
const sliceB = selectPresentationSlice(
  idsA.map((id) => ({ productId: id, publicationReady: true })),
  25,
  25
);
expect("sliceB_rotated", sliceB.selected[0].productId === "pA-26");
expect("slice_disjoint", sliceA.selected[0].productId !== sliceB.selected[0].productId);

// Complete pass resets
const fetchDone = {
  fetchedCount: 50,
  totalCount: 50,
  complete: true,
  stoppedEarlyForBudget: false,
  startedOffset: 1,
  checkpoint: {
    nextOffset: CJ_PRODUCT_SEARCH_OFFSET_FIRST,
    nextPage: null,
    mode: "offset",
    complete: true,
  },
};
const afterDone = advancePartnerCheckpoint(afterB, fetchDone, { pageSize: 100, publishPerPartner: 25 });
expect("complete_resets_offset", afterDone.resumeOffset === CJ_PRODUCT_SEARCH_OFFSET_FIRST);
expect("complete_pass_count", afterDone.completePassCount === 1);

// Persist round-trip
const tmp = path.join(os.tmpdir(), "iu-v31-product-feed-cp-" + Date.now() + ".json");
state.partners[adv] = afterB;
saveProductFeedCheckpointState(tmp, state);
const loaded = loadProductFeedCheckpointState(tmp);
expect("persist_offset", loaded.partners[adv]?.resumeOffset === 201);
try {
  fs.unlinkSync(tmp);
} catch {
  /* ignore */
}

console.log(
  JSON.stringify({
    IU_CJ_PRODUCT_FEED_CHECKPOINT_V31_SELFTEST: failures.length === 0 ? "PASS" : "FAIL",
    failures,
    proof,
    afterA: { resumeOffset: afterA.resumeOffset, presentationCursor: afterA.presentationCursor },
    afterB: { resumeOffset: afterB.resumeOffset, presentationCursor: afterB.presentationCursor },
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
