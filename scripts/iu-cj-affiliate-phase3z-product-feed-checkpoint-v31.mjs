#!/usr/bin/env node
/**
 * V31 — durable per-advertiser product-feed checkpoints across sync runs.
 *
 * Proves continuation: next run resumes offset/page instead of replaying page 1 forever.
 * Presentation budget (publishPerPartner) rotates within/across windows; never a source wipe.
 */
import fs from "node:fs";
import path from "node:path";
import { CJ_PRODUCT_SEARCH_OFFSET_FIRST } from "./iu-cj-affiliate-phase2-product-api.mjs";

export const PRODUCT_FEED_CHECKPOINT_SCHEMA =
  "iu-cj-affiliate-phase3z-product-feed-checkpoint-v31";

export function emptyProductFeedCheckpointState(opts = {}) {
  return {
    schema: PRODUCT_FEED_CHECKPOINT_SCHEMA,
    version: 1,
    updatedAt: opts.updatedAt || new Date().toISOString(),
    websitePid: opts.websitePid || "101883843",
    partners: {},
    runs: [],
    note:
      "Per-advertiser resumeOffset/resumePage + presentationCursor. Presentation budget ≠ API source cap.",
  };
}

export function loadProductFeedCheckpointState(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return emptyProductFeedCheckpointState();
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object") return emptyProductFeedCheckpointState();
    if (!raw.partners || typeof raw.partners !== "object") raw.partners = {};
    if (!Array.isArray(raw.runs)) raw.runs = [];
    raw.schema = PRODUCT_FEED_CHECKPOINT_SCHEMA;
    return raw;
  } catch {
    return emptyProductFeedCheckpointState();
  }
}

export function saveProductFeedCheckpointState(filePath, state) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const next = {
    ...emptyProductFeedCheckpointState(),
    ...state,
    schema: PRODUCT_FEED_CHECKPOINT_SCHEMA,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

export function getPartnerCheckpoint(state, advertiserId) {
  const id = String(advertiserId || "").trim();
  if (!id) return null;
  const p = state?.partners?.[id];
  if (!p || typeof p !== "object") {
    return {
      advertiserId: id,
      resumeOffset: CJ_PRODUCT_SEARCH_OFFSET_FIRST,
      resumePage: null,
      mode: "offset",
      presentationCursor: 0,
      completePassCount: 0,
      lastCompletePassAt: null,
      lastFetchedCount: 0,
      lastTotalCount: null,
      lastError: null,
      lastRunAt: null,
      productsRemainingEstimate: null,
    };
  }
  return { ...p, advertiserId: id };
}

/**
 * Compute next resume after one fetch window.
 * When budget-stopped mid-catalog, advance past the consumed window (do NOT null nextOffset).
 * When complete, reset to first offset for incremental refresh and bump completePassCount.
 */
export function advancePartnerCheckpoint(prev, fetchResult = {}, opts = {}) {
  const pageSize = Math.max(1, Number(opts.pageSize) || 100);
  const publishPerPartner = Math.max(0, Number(opts.publishPerPartner) || 0);
  const base = getPartnerCheckpoint({ partners: { [String(prev?.advertiserId || "")]: prev } }, prev?.advertiserId);
  const totalCount =
    fetchResult.totalCount != null && Number.isFinite(Number(fetchResult.totalCount))
      ? Number(fetchResult.totalCount)
      : base.lastTotalCount;
  const fetchedCount = Number(fetchResult.fetchedCount) || 0;
  const startedAt =
    fetchResult.startedOffset != null && Number.isFinite(Number(fetchResult.startedOffset))
      ? Math.max(CJ_PRODUCT_SEARCH_OFFSET_FIRST, Math.floor(Number(fetchResult.startedOffset)))
      : base.resumeOffset || CJ_PRODUCT_SEARCH_OFFSET_FIRST;

  let resumeOffset = CJ_PRODUCT_SEARCH_OFFSET_FIRST;
  let resumePage = null;
  let mode = "offset";
  let completePassCount = base.completePassCount || 0;
  let lastCompletePassAt = base.lastCompletePassAt || null;

  const cp = fetchResult.checkpoint || {};
  let complete =
    fetchResult.complete === true || fetchResult.staleTailCompleted === true;
  const stoppedEarly = fetchResult.stoppedEarlyForBudget === true;

  if (!complete && cp.nextOffset != null && Number.isFinite(Number(cp.nextOffset))) {
    const nextOff = Math.max(CJ_PRODUCT_SEARCH_OFFSET_FIRST, Math.floor(Number(cp.nextOffset)));
    // V51.8: after stale-page skip past declared totalCount, seal the pass.
    if (totalCount != null && Number.isFinite(totalCount) && nextOff > totalCount) {
      complete = true;
    }
  }

  if (complete) {
    resumeOffset = CJ_PRODUCT_SEARCH_OFFSET_FIRST;
    resumePage = null;
    mode = "offset";
    completePassCount += 1;
    lastCompletePassAt = new Date().toISOString();
  } else if (cp.nextPage) {
    mode = "page";
    resumePage = cp.nextPage;
    resumeOffset = null;
  } else if (cp.nextOffset != null && Number.isFinite(Number(cp.nextOffset))) {
    mode = "offset";
    resumeOffset = Math.max(CJ_PRODUCT_SEARCH_OFFSET_FIRST, Math.floor(Number(cp.nextOffset)));
    resumePage = null;
  } else if (stoppedEarly || fetchedCount > 0) {
    // Fallback: advance by window size from start of this run.
    mode = "offset";
    resumeOffset = startedAt + Math.max(fetchedCount, pageSize);
    resumePage = null;
  } else {
    resumeOffset = startedAt;
    resumePage = base.resumePage || null;
    mode = resumePage ? "page" : "offset";
  }

  const presentationCursor =
    publishPerPartner > 0
      ? (Number(base.presentationCursor) || 0) + publishPerPartner
      : Number(base.presentationCursor) || 0;

  const remaining =
    totalCount != null && resumeOffset != null
      ? Math.max(0, totalCount - (resumeOffset - CJ_PRODUCT_SEARCH_OFFSET_FIRST))
      : null;

  return {
    advertiserId: base.advertiserId,
    resumeOffset: mode === "page" ? null : resumeOffset,
    resumePage,
    mode,
    presentationCursor,
    completePassCount,
    lastCompletePassAt,
    lastFetchedCount: fetchedCount,
    lastTotalCount: totalCount,
    lastError: fetchResult.error || null,
    lastRunAt: new Date().toISOString(),
    productsRemainingEstimate: remaining,
    lastStartedOffset: startedAt,
    lastStoppedEarlyForBudget: stoppedEarly,
    lastComplete: complete,
  };
}

/**
 * Rotate presentation selection inside a ready list (presentation-only).
 */
export function selectPresentationSlice(readyRows, publishPerPartner, presentationCursor) {
  const rows = Array.isArray(readyRows) ? readyRows.slice() : [];
  const budget =
    publishPerPartner > 0 && Number.isFinite(Number(publishPerPartner))
      ? Math.floor(Number(publishPerPartner))
      : rows.length;
  if (budget <= 0 || rows.length === 0) return { selected: [], deferred: rows.length, cursorUsed: 0 };
  const cursor = Math.max(0, Math.floor(Number(presentationCursor) || 0));
  const start = rows.length > 0 ? cursor % rows.length : 0;
  const rotated = rows.slice(start).concat(rows.slice(0, start));
  const selected = rotated.slice(0, Math.min(budget, rotated.length));
  return {
    selected,
    deferred: Math.max(0, rows.length - selected.length),
    cursorUsed: start,
    presentationBudget: budget,
  };
}

/**
 * Dual-run progress proof (offline-friendly).
 * Expects runA/runB: { advertiserId, startedOffset, nextOffset, productIds[] }
 */
export function proveContinuationBetweenRuns(runA, runB) {
  const aOff = Number(runA?.startedOffset);
  const bOff = Number(runB?.startedOffset);
  const aNext = Number(runA?.nextOffset);
  const idsA = new Set((runA?.productIds || []).map(String));
  const idsB = new Set((runB?.productIds || []).map(String));
  let overlap = 0;
  for (const id of idsB) if (idsA.has(id)) overlap += 1;
  const advanced =
    Number.isFinite(aNext) &&
    Number.isFinite(bOff) &&
    bOff === aNext &&
    Number.isFinite(aOff) &&
    bOff > aOff;
  const distinctWindow = idsA.size > 0 && idsB.size > 0 && overlap < Math.min(idsA.size, idsB.size);
  return {
    ok: advanced === true && distinctWindow === true,
    advanced,
    distinctWindow,
    runAStartedOffset: aOff,
    runANextOffset: aNext,
    runBStartedOffset: bOff,
    overlapProductIds: overlap,
    runACount: idsA.size,
    runBCount: idsB.size,
    proof: advanced && distinctWindow ? "CONTINUATION_PROVEN" : "CONTINUATION_NOT_PROVEN",
  };
}

export function recordCheckpointRun(state, summary) {
  const runs = Array.isArray(state.runs) ? state.runs.slice(-40) : [];
  runs.push({
    at: new Date().toISOString(),
    ...summary,
  });
  return { ...state, runs };
}
