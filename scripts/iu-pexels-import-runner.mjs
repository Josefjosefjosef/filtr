#!/usr/bin/env node
/**
 * Pexels import runner — skeleton only (V1 preparation).
 * Loads queue + state, computes batches, enforces rate/legal guards.
 * Does NOT call Pexels API, does NOT download photos, does NOT require API key.
 * Run: npm run pexels-import-runner
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUEUE_PATH = path.join(REPO, "docs", "pexels-initial-import-queue.json");
const STATE_PATH = path.join(REPO, "projects", "data", "image_gallery", "import_state.json");

const FORBIDDEN_RUNTIME = [
  /fetch\s*\(\s*[`'"]https:\/\/api\.pexels\.com/i,
  /axios\s*\([^)]*api\.pexels\.com/i,
  /\.download\s*\(/i,
  /writeFileSync\s*\([^)]*\.(jpg|jpeg|png|webp)/i,
];

export function loadQueue() {
  return JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
}

export function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error("import_state.json not found at " + STATE_PATH);
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

export function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function getPendingItems(queue, state) {
  const completedIds = new Set();
  for (const batch of state.completedBatches || []) {
    for (const id of batch.itemIds || []) completedIds.add(id);
  }
  return (queue.items || []).filter(
    (item) => item.status === "planned" && !completedIds.has(item.id)
  );
}

export function computeBatches(pendingItems, maxRequestsPerBatch) {
  const batches = [];
  let current = { batchIndex: batches.length, itemIds: [], estimatedRequests: 0 };
  for (const item of pendingItems) {
    const req = item.estimatedRequests || 0;
    if (current.estimatedRequests > 0 && current.estimatedRequests + req > maxRequestsPerBatch) {
      batches.push(current);
      current = { batchIndex: batches.length, itemIds: [], estimatedRequests: 0 };
    }
    current.itemIds.push(item.id);
    current.estimatedRequests += req;
  }
  if (current.itemIds.length) batches.push(current);
  return batches;
}

export function checkRateLimitGuards(state, queue) {
  const gov = state.governance || {};
  const rl = queue.rateLimit || {};
  const errors = [];

  if (gov.stopOnRateLimitReached !== true) {
    errors.push("STOP_ON_RATE_LIMIT_REACHED must be YES");
  }
  if (gov.stopOnMonthlyBudgetReached !== true) {
    errors.push("STOP_ON_MONTHLY_BUDGET_REACHED must be YES");
  }
  if (gov.rateLimitBypassAllowed !== false) {
    errors.push("RATE_LIMIT_BYPASS_ALLOWED must be NO");
  }
  if (rl.rateLimitBypassAllowed !== false) {
    errors.push("queue rateLimitBypassAllowed must be false");
  }

  const maxBatch = gov.maxRequestsPerBatch || rl.maxRequestsPerBatch || 200;
  if (state.rateLimitRemaining != null && state.rateLimitRemaining <= 0 && gov.stopOnRateLimitReached) {
    errors.push("rate limit reached — stop before next batch");
  }
  if (state.completedRequests >= (rl.pexelsDefaultMonthlyLimit || 20000) && gov.stopOnMonthlyBudgetReached) {
    errors.push("monthly budget reached — stop import");
  }

  return { ok: errors.length === 0, errors, maxRequestsPerBatch: maxBatch };
}

export function checkLegalGuards(item, state) {
  const gov = state.governance || {};
  const errors = [];
  const warnings = [];

  if (gov.autoPersonMatchingAllowed !== false) {
    errors.push("AUTO_PERSON_MATCHING_ALLOWED must be NO");
  }
  if (gov.autoPlaceMatchingAllowed !== false) {
    errors.push("AUTO_PLACE_MATCHING_ALLOWED must be NO");
  }

  if (item.galleryId === "verified_persons") {
    if (gov.verifiedPersonsRequireManualReview !== true) {
      errors.push("VERIFIED_PERSONS_REQUIRE_MANUAL_REVIEW must be YES");
    }
    if (item.query === "__ENTITY_QUERY_PENDING__") {
      warnings.push(`item ${item.id}: verified person query pending manual review`);
    }
  }

  if (item.galleryId === "verified_places_objects") {
    if (gov.verifiedPlacesRequireManualReview !== true) {
      errors.push("VERIFIED_PLACES_REQUIRE_MANUAL_REVIEW must be YES");
    }
    if (item.query === "__ENTITY_QUERY_PENDING__") {
      warnings.push(`item ${item.id}: verified place query pending manual review`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function assertNoApiCallsInSource() {
  const self = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  for (const pat of FORBIDDEN_RUNTIME) {
    if (pat.test(self)) {
      throw new Error("runner skeleton must not contain API/download patterns: " + pat);
    }
  }
}

export function isApiKeyRequiredNow(state) {
  return state.governance?.apiKeyRequiredNow === true;
}

export function planDryRun(queue, state) {
  assertNoApiCallsInSource();

  const rateCheck = checkRateLimitGuards(state, queue);
  if (!rateCheck.ok) {
    return { ok: false, phase: "rate_limit", errors: rateCheck.errors };
  }

  const pending = getPendingItems(queue, state);
  const batches = computeBatches(pending, rateCheck.maxRequestsPerBatch);
  const legalErrors = [];
  const legalWarnings = [];

  for (const item of pending) {
    const legal = checkLegalGuards(item, state);
    if (!legal.ok) legalErrors.push(...legal.errors);
    if (legal.warnings?.length) legalWarnings.push(...legal.warnings);
  }

  const currentBatchIndex = state.currentBatch || 0;
  const nextBatch = batches[currentBatchIndex] || null;

  return {
    ok: legalErrors.length === 0,
    phase: "dry_run_plan",
    pendingItems: pending.length,
    totalBatches: batches.length,
    currentBatch: currentBatchIndex,
    nextBatch,
    remainingRequests: state.remainingRequests,
    legalErrors,
    legalWarnings,
    manualReviewPendingCount: legalWarnings.length,
    apiKeyRequiredNow: isApiKeyRequiredNow(state),
  };
}

function main() {
  const queue = loadQueue();
  const state = loadState();
  const result = planDryRun(queue, state);

  console.log("PEXELS_IMPORT_RUNNER_SKELETON");
  console.log("DRY_RUN_ONLY=YES");
  console.log("PEXELS_API_CALLED=NO");
  console.log("PHOTOS_DOWNLOADED=NO");
  console.log("API_KEY_REQUIRED_NOW=" + (result.apiKeyRequiredNow ? "YES" : "NO"));
  console.log("PENDING_ITEMS=" + result.pendingItems);
  console.log("TOTAL_BATCHES=" + result.totalBatches);
  console.log("CURRENT_BATCH=" + result.currentBatch);
  console.log("REMAINING_REQUESTS=" + result.remainingRequests);

  if (result.nextBatch) {
    console.log("NEXT_BATCH_ITEMS=" + result.nextBatch.itemIds.length);
    console.log("NEXT_BATCH_REQUESTS=" + result.nextBatch.estimatedRequests);
  }

  if (!result.ok) {
    for (const e of result.legalErrors || result.errors || []) {
      console.log("GUARD_ERROR:" + e);
    }
    console.log("FINAL_VERDICT=FAIL");
    process.exit(1);
  }

  if (result.manualReviewPendingCount) {
    console.log("MANUAL_REVIEW_PENDING_COUNT=" + result.manualReviewPendingCount);
  }

  console.log("FINAL_VERDICT=PASS");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
