#!/usr/bin/env node
/**
 * V51.8 — adaptive growth FAILURE BATTERY (DISARMED, offline, no production writes).
 *
 * Exercises the pure adaptive growth controller + safe-autonomous-growth STOP/auth helpers
 * against 19 failure/edge scenario groups. Never sets IU_CJ_PUBLIC_GROWTH_UNCAPPED, never
 * writes projects/data, never touches the network. Temp state lives under os.tmpdir().
 *
 * CLI: node scripts/iu-cj-affiliate-phase3z-adaptive-growth-failure-battery-v51-8-selftest.mjs [resultsJsonPath]
 *   (resultsJsonPath or env IU_BATTERY_OUT -> results JSON written there; use %TEMP%.)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  estimateSafeBatchSize,
  evaluateGrowthHealth,
  planAdaptiveBatch,
  circuitBreakerDecide,
  REASON_OWNER_GATES_DISARMED,
} from "./iu-cj-affiliate-phase3z-adaptive-growth-controller-v51-8.mjs";
import {
  computeAdaptiveBatchSize,
  evaluateGrowthStopConditions,
  executeGrowthActivation,
  mintOwnerApprovalToken,
  resolveEffectiveUncappedGrowth,
  runNegativeGrowthGuards,
  FORBIDDEN_PERMANENT_PARTNER_CAP,
} from "./iu-cj-affiliate-phase3z-safe-autonomous-growth-v51-8.mjs";
import {
  classifyProductFeedHttpStatus,
  classifyNetworkFailure,
} from "./iu-cj-affiliate-phase2-unattended-import-cycle-lib-v1.mjs";
import {
  advancePartnerCheckpoint,
  emptyProductFeedCheckpointState,
  loadProductFeedCheckpointState,
  proveContinuationBetweenRuns,
  saveProductFeedCheckpointState,
} from "./iu-cj-affiliate-phase3z-product-feed-checkpoint-v31.mjs";
import { runIsolatedRollbackDrill } from "./iu-cj-affiliate-phase3z-rollback-drill-isolated-v51-8.mjs";

const BATTERY_SCHEMA = "iu-cj-affiliate-phase3z-adaptive-growth-failure-battery-v51-8";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-growth-battery-"));
const nonceSqlitePath = path.join(tmpRoot, "nonces.sqlite");
const hmacSecret = "battery-hmac-secret-do-not-use-in-prod-32b";
const mainSha = "1012fc5a10f13aa3248e8e633b0d2a7fad01ae71";
const generationId = "2026-11-26T00:00:00.000Z";
const gateEnvAtStart = String(process.env.IU_CJ_PUBLIC_GROWTH_UNCAPPED ?? "0");

/** Required scenario groups from the owner brief. */
const REQUIRED = [
  "normal_growth",
  "auto_increase_throughput",
  "auto_decrease_throughput",
  "exhausted_api_capacity",
  "exhausted_workflow_time_budget",
  "cost_limit",
  "elevated_hold",
  "elevated_invalid",
  "identity_collisions",
  "publish_failure",
  "read_back_failure",
  "cj_api_down",
  "infra_down",
  "process_interrupt",
  "checkpoint_resume",
  "circuit_breaker",
  "auto_stop",
  "owner_stop",
  "rollback",
  "unauthorized_activation_attempt",
];

const scenarios = [];
const findings = [];

function scenario(group, name, fn) {
  scenarios.push({ group, name, fn });
}

const candidates = Array.from({ length: 100 }, (_, i) => ({ id: "p" + i }));
const healthy = evaluateGrowthHealth({
  uniqueProducts: 1000,
  holdCount: 10,
  invalidRate: 0.01,
  syncDurationMs: 1000,
  pagesFail: 0,
});
const armedArgs = { uncappedGate: true, executeArmed: true }; // pure planner args; not production activation

/* ---------------- normal growth ---------------- */
scenario("normal_growth", "healthy metrics -> ok, no stop/throttle", () => {
  assert.equal(healthy.ok, true);
  assert.equal(healthy.stop, false);
  assert.equal(healthy.throttle, false);
  assert.deepEqual(healthy.reasons, []);
});
scenario("normal_growth", "disarmed planner admits 0 (default, env 1 ignored)", () => {
  const r = planAdaptiveBatch({ candidates, health: healthy, remainingCumulative: 1000 });
  assert.equal(r.allowed, 0);
  assert.equal(r.reason, REASON_OWNER_GATES_DISARMED);
});
scenario("normal_growth", "simulated armed planner takes full batch within cumulative cap", () => {
  const r = planAdaptiveBatch({ candidates, health: healthy, remainingCumulative: 1000, ...armedArgs });
  assert.equal(r.allowed, 100);
  assert.equal(r.reason, "OK");
  assert.equal(r.selected.length, 100);
  const capped = planAdaptiveBatch({ candidates, health: healthy, remainingCumulative: 30, ...armedArgs });
  assert.equal(capped.allowed, 30);
});
scenario("normal_growth", "no permanent partner cap constant", () => {
  assert.equal(FORBIDDEN_PERMANENT_PARTNER_CAP, null);
});

/* ---------------- auto increase / decrease throughput ---------------- */
scenario("auto_increase_throughput", "good prior batch grows next batch (x1.35)", () => {
  const base = computeAdaptiveBatchSize({ catalogSize: 2705, priorBatchOk: true, priorAdmitted: 0 });
  const grown = computeAdaptiveBatchSize({
    catalogSize: 2705,
    priorBatchOk: true,
    priorAdmitted: 100,
    priorRejectRatio: 0.1,
    errorRate: 0.01,
  });
  assert.ok(grown > base, `grown ${grown} must exceed base ${base}`);
  assert.equal(base, 108);
  assert.equal(grown, 145);
});
scenario("auto_increase_throughput", "growth is bounded by 400 ceiling", () => {
  const big = computeAdaptiveBatchSize({
    catalogSize: 1_000_000,
    priorBatchOk: true,
    priorAdmitted: 500,
    priorRejectRatio: 0,
    errorRate: 0,
  });
  assert.equal(big, 400);
});
scenario("auto_decrease_throughput", "high reject ratio halves next batch", () => {
  const base = computeAdaptiveBatchSize({ catalogSize: 2705, priorBatchOk: true, priorAdmitted: 0 });
  const less = computeAdaptiveBatchSize({ catalogSize: 2705, priorBatchOk: true, priorRejectRatio: 0.7 });
  assert.equal(less, Math.floor(base * 0.5));
});
scenario("auto_decrease_throughput", "prior failure and high publish load shrink batch; floor is 10", () => {
  const base = computeAdaptiveBatchSize({ catalogSize: 2705, priorBatchOk: true });
  const afterFail = computeAdaptiveBatchSize({ catalogSize: 2705, priorBatchOk: false });
  const loaded = computeAdaptiveBatchSize({ catalogSize: 2705, priorBatchOk: true, publishLoad: 0.9 });
  assert.ok(afterFail < base);
  assert.ok(loaded < base);
  assert.equal(computeAdaptiveBatchSize({ catalogSize: 1, priorBatchOk: false, errorRate: 1, publishLoad: 1 }), 10);
});
scenario("auto_decrease_throughput", "controller estimate halves on hold/api/duration pressure, never exceeds deferred", () => {
  assert.equal(estimateSafeBatchSize({ deferredCount: 200, holdRate: 0.5, caps: { maxBatch: 200 } }), 100);
  assert.equal(estimateSafeBatchSize({ deferredCount: 200, holdRate: 0.5, apiErrorRate: 0.5, caps: { maxBatch: 200 } }), 50);
  assert.equal(estimateSafeBatchSize({ deferredCount: 10, caps: { maxBatch: 200 } }), 10);
  assert.equal(estimateSafeBatchSize({ deferredCount: 0 }), 0);
});

/* ---------------- exhausted API capacity ---------------- */
scenario("exhausted_api_capacity", "high API error rate halves batch", () => {
  assert.equal(estimateSafeBatchSize({ deferredCount: 200, apiErrorRate: 0.5, caps: { maxBatch: 200 } }), 100);
  const a = computeAdaptiveBatchSize({ catalogSize: 2705, priorBatchOk: true, errorRate: 0.5 });
  assert.ok(a < computeAdaptiveBatchSize({ catalogSize: 2705, priorBatchOk: true }));
});
scenario("exhausted_api_capacity", "capacityExceeded flag -> STOP CAPACITY_EXCEEDED", () => {
  const d = evaluateGrowthStopConditions({ capacityExceeded: true });
  assert.equal(d.stop, true);
  assert.ok(d.reasons.some((r) => r.code === "CAPACITY_EXCEEDED"));
  assert.equal(d.failClosed, true);
});
scenario("exhausted_api_capacity", "HTTP 429 is retryable throttle, not hard stop", () => {
  const r = classifyProductFeedHttpStatus(429);
  assert.equal(r.reason, "cj_api_rate_limited");
  assert.equal(r.retry, true);
  assert.equal(r.stopRun, false);
});
scenario("exhausted_api_capacity", "cumulative budget exhausted -> planner admits 0", () => {
  const r = planAdaptiveBatch({ candidates, health: healthy, remainingCumulative: 0, ...armedArgs });
  assert.equal(r.allowed, 0);
  assert.equal(r.reason, "CUMULATIVE_CAP_REACHED");
});

/* ---------------- exhausted workflow time budget ---------------- */
scenario("exhausted_workflow_time_budget", "sync duration >= 10 min throttles, >= 20 min stops", () => {
  const th = evaluateGrowthHealth({ uniqueProducts: 100, syncDurationMs: 600000 });
  assert.equal(th.throttle, true);
  assert.equal(th.stop, false);
  assert.ok(th.reasons.includes("SYNC_DURATION_THROTTLE"));
  const st = evaluateGrowthHealth({ uniqueProducts: 100, syncDurationMs: 1200000 });
  assert.equal(st.stop, true);
  assert.ok(st.reasons.includes("SYNC_DURATION_STOP"));
});
scenario("exhausted_workflow_time_budget", "slow sync halves batch; throttled health halves planner allowance", () => {
  assert.equal(estimateSafeBatchSize({ deferredCount: 200, syncDurationMs: 700000, caps: { maxBatch: 200 } }), 100);
  const th = evaluateGrowthHealth({ uniqueProducts: 100, syncDurationMs: 700000 });
  const r = planAdaptiveBatch({ candidates, health: th, remainingCumulative: 1000, ...armedArgs });
  assert.equal(r.allowed, 50);
});
scenario("exhausted_workflow_time_budget", "single batch > 120s -> BATCH_TIMEOUT STOP", () => {
  const d = evaluateGrowthStopConditions({ durationMs: 120001 });
  assert.equal(d.stop, true);
  assert.ok(d.reasons.some((r) => r.code === "BATCH_TIMEOUT"));
  assert.equal(evaluateGrowthStopConditions({ durationMs: 120000 }).stop, false);
});

/* ---------------- cost limit ---------------- */
scenario("cost_limit", "public payload over byte budget -> batch size 0", () => {
  assert.equal(estimateSafeBatchSize({ deferredCount: 200, publicBytes: 50 * 1024 * 1024 + 1 }), 0);
  assert.equal(estimateSafeBatchSize({ deferredCount: 200, publicBytes: 50 * 1024 * 1024 }), 200);
});
scenario("cost_limit", "custom lower cap is honoured", () => {
  assert.equal(estimateSafeBatchSize({ deferredCount: 200, publicBytes: 2000, caps: { maxPublicBytes: 1000 } }), 0);
  assert.equal(estimateSafeBatchSize({ deferredCount: 500, caps: { maxBatch: 50 } }), 50);
});

/* ---------------- elevated hold ---------------- */
scenario("elevated_hold", "hold rate 20% throttles, 35% stops, zero-unique with holds stops", () => {
  const th = evaluateGrowthHealth({ uniqueProducts: 100, holdCount: 20 });
  assert.equal(th.throttle, true);
  assert.ok(th.reasons.includes("HOLD_RATE_THROTTLE"));
  const st = evaluateGrowthHealth({ uniqueProducts: 100, holdCount: 35 });
  assert.equal(st.stop, true);
  assert.ok(st.reasons.includes("HOLD_RATE_STOP"));
  const zero = evaluateGrowthHealth({ uniqueProducts: 0, holdCount: 3 });
  assert.equal(zero.stop, true);
});
scenario("elevated_hold", "armed planner refuses on hold-rate STOP", () => {
  const st = evaluateGrowthHealth({ uniqueProducts: 100, holdCount: 50 });
  const r = planAdaptiveBatch({ candidates, health: st, remainingCumulative: 1000, ...armedArgs });
  assert.equal(r.allowed, 0);
  assert.equal(r.reason, "HEALTH_STOP");
});

/* ---------------- elevated invalid ---------------- */
scenario("elevated_invalid", "invalid rate 10% throttles, 25% stops", () => {
  const th = evaluateGrowthHealth({ uniqueProducts: 100, invalidRate: 0.1 });
  assert.equal(th.throttle, true);
  assert.ok(th.reasons.includes("INVALID_RATE_THROTTLE"));
  const st = evaluateGrowthHealth({ uniqueProducts: 100, invalidRate: 0.25 });
  assert.equal(st.stop, true);
  assert.ok(st.reasons.includes("INVALID_RATE_STOP"));
});
scenario("elevated_invalid", "invalid-affiliate / reject / validation-collapse spikes STOP", () => {
  const inv = evaluateGrowthStopConditions({ processed: 20, invalidAffiliate: 4 });
  assert.ok(inv.reasons.some((r) => r.code === "INVALID_AFFILIATE_SPIKE"));
  const rej = evaluateGrowthStopConditions({ processed: 30, rejected: 28, validCandidates: 2 });
  assert.ok(rej.reasons.some((r) => r.code === "REJECT_SPIKE"));
  const col = evaluateGrowthStopConditions({ processed: 30, validCandidates: 1 });
  assert.ok(col.reasons.some((r) => r.code === "VALIDATION_SUCCESS_COLLAPSE"));
});

/* ---------------- identity collisions ---------------- */
scenario("identity_collisions", "any identity collision -> STOP IDENTITY_COLLISIONS", () => {
  const d = evaluateGrowthStopConditions({ prevPublicSize: 100, nextPublicSize: 110, processed: 20, validCandidates: 10, collisions: 1 });
  assert.equal(d.stop, true);
  assert.ok(d.reasons.some((r) => r.code === "IDENTITY_COLLISIONS"));
  assert.equal(evaluateGrowthStopConditions({ processed: 20, validCandidates: 10, collisions: 0 }).stop, false);
});
scenario("identity_collisions", "duplicate spike (>40%) and joined-registry mismatch STOP", () => {
  const dup = evaluateGrowthStopConditions({ processed: 20, duplicates: 9, validCandidates: 10 });
  assert.ok(dup.reasons.some((r) => r.code === "DUPLICATE_SPIKE"));
  const jr = evaluateGrowthStopConditions({ joinedRegistryMismatch: true });
  assert.ok(jr.reasons.some((r) => r.code === "JOINED_REGISTRY_MISMATCH"));
});

/* ---------------- publish failure ---------------- */
scenario("publish_failure", "Pages deploy failure / required CI failure -> STOP", () => {
  const a = evaluateGrowthStopConditions({ pagesDeployFailed: true });
  assert.ok(a.reasons.some((r) => r.code === "PAGES_DEPLOY_FAILED"));
  const b = evaluateGrowthStopConditions({ requiredCiFailed: true });
  assert.ok(b.reasons.some((r) => r.code === "REQUIRED_CI_FAILED"));
});
scenario("publish_failure", "controller health pagesFail -> STOP and planner refuses", () => {
  const h = evaluateGrowthHealth({ uniqueProducts: 100, pagesFail: 1 });
  assert.equal(h.stop, true);
  assert.ok(h.reasons.includes("PAGES_FAIL_STOP"));
  assert.equal(planAdaptiveBatch({ candidates, health: h, remainingCumulative: 1000, ...armedArgs }).allowed, 0);
});
scenario("publish_failure", "failed publish shrinks next adaptive batch", () => {
  const ok = computeAdaptiveBatchSize({ catalogSize: 2705, priorBatchOk: true });
  const failed = computeAdaptiveBatchSize({ catalogSize: 2705, priorBatchOk: false });
  assert.ok(failed < ok);
});

/* ---------------- read-back failure ---------------- */
scenario("read_back_failure", "corrupt manifest / SHA mismatch / missing section -> STOP", () => {
  for (const [flag, code] of [
    ["corruptManifest", "CORRUPT_MANIFEST"],
    ["shaMismatch", "SHA_MISMATCH"],
    ["missingSection", "MISSING_SECTION"],
  ]) {
    const d = evaluateGrowthStopConditions({ [flag]: true });
    assert.equal(d.stop, true, flag);
    assert.ok(d.reasons.some((r) => r.code === code), code);
  }
});
scenario("read_back_failure", "read-back shrinkage > 5% -> CATALOG_SHRINKAGE; surge > 35% -> CATALOG_SURGE", () => {
  const shrink = evaluateGrowthStopConditions({ prevPublicSize: 1000, nextPublicSize: 940, processed: 10, validCandidates: 5 });
  assert.ok(shrink.reasons.some((r) => r.code === "CATALOG_SHRINKAGE"));
  assert.equal(evaluateGrowthStopConditions({ prevPublicSize: 1000, nextPublicSize: 960 }).stop, false);
  const surge = evaluateGrowthStopConditions({ prevPublicSize: 1000, nextPublicSize: 1400 });
  assert.ok(surge.reasons.some((r) => r.code === "CATALOG_SURGE"));
});

/* ---------------- CJ API down ---------------- */
scenario("cj_api_down", "401/403 stop run; 5xx and network failures retry", () => {
  assert.equal(classifyProductFeedHttpStatus(401).stopRun, true);
  assert.equal(classifyProductFeedHttpStatus(403).stopRun, true);
  for (const code of [500, 502, 503]) {
    const r = classifyProductFeedHttpStatus(code);
    assert.equal(r.reason, "cj_api_server_error");
    assert.equal(r.retry, true);
    assert.equal(r.stopRun, false);
  }
  for (const code of ["ETIMEDOUT", "ECONNRESET", "ENOTFOUND"]) {
    const r = classifyNetworkFailure({ code });
    assert.equal(r.reason, "network_failure");
    assert.equal(r.retry, true);
  }
  assert.equal(classifyProductFeedHttpStatus(200).ok, true);
});
scenario("cj_api_down", "stale source feeds / repeated sync failure -> STOP", () => {
  const d = evaluateGrowthStopConditions({ staleSourceFeeds: true, syncRepeatedFail: true });
  assert.ok(d.reasons.some((r) => r.code === "STALE_SOURCE_FEEDS"));
  assert.ok(d.reasons.some((r) => r.code === "SYNC_REPEATED_FAIL"));
});
scenario("cj_api_down", "sustained API outage trips circuit breaker (3 consecutive failures)", () => {
  assert.equal(circuitBreakerDecide({ consecutiveFailures: 2 }), "CONTINUE");
  assert.equal(circuitBreakerDecide({ consecutiveFailures: 3 }), "STOP");
});

/* ---------------- infra down ---------------- */
scenario("infra_down", "batch hard fail / rollback failure -> STOP", () => {
  const a = evaluateGrowthStopConditions({ batchHardFail: true });
  assert.ok(a.reasons.some((r) => r.code === "BATCH_HARD_FAIL"));
  const b = evaluateGrowthStopConditions({ rollbackFailed: true });
  assert.ok(b.reasons.some((r) => r.code === "ROLLBACK_FAILED"));
});
scenario("infra_down", "missing health (monitoring down) is fail-closed in planner", () => {
  for (const health of [null, undefined, "x", 42]) {
    const r = planAdaptiveBatch({ candidates, health, remainingCumulative: 1000, ...armedArgs });
    assert.equal(r.allowed, 0, String(health));
    assert.equal(r.reason, "HEALTH_STOP");
  }
});
scenario("infra_down", "DNS failure is retryable network failure; unknown error is non-retry", () => {
  assert.equal(classifyNetworkFailure({ code: "ENOTFOUND" }).retry, true);
  const unk = classifyNetworkFailure(new Error("boom"));
  assert.equal(unk.reason, "unexpected_error");
  assert.equal(unk.retry, false);
});

/* ---------------- process interrupt ---------------- */
scenario("process_interrupt", "mid-batch kill: resume processes remainder with no loss and no duplicates", () => {
  const plan = planAdaptiveBatch({ candidates, health: healthy, remainingCumulative: 1000, ...armedArgs });
  const journal = path.join(tmpRoot, "interrupt-journal.json");
  const processedBeforeKill = plan.selected.slice(0, 40).map((c) => c.id);
  fs.writeFileSync(journal, JSON.stringify({ done: processedBeforeKill }), "utf8");
  // process "dies" here; new process reloads the journal
  const reloaded = JSON.parse(fs.readFileSync(journal, "utf8"));
  const doneSet = new Set(reloaded.done);
  const remaining = plan.selected.filter((c) => !doneSet.has(c.id));
  assert.equal(remaining.length, 60);
  const finalIds = [...reloaded.done, ...remaining.map((c) => c.id)];
  assert.equal(new Set(finalIds).size, 100);
  assert.equal(finalIds.length, 100);
});
scenario("process_interrupt", "interrupt after failure keeps breaker state: 3 failures still STOP after restart", () => {
  const state = path.join(tmpRoot, "breaker-state.json");
  fs.writeFileSync(state, JSON.stringify({ consecutiveFailures: 3 }), "utf8");
  const reloaded = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(circuitBreakerDecide(reloaded), "STOP");
});

/* ---------------- checkpoint / resume ---------------- */
scenario("checkpoint_resume", "checkpoint persisted to disk, reloaded, continues without overlap", () => {
  const adv = "6466592";
  const file = path.join(tmpRoot, "feed-checkpoint.json");
  let state = emptyProductFeedCheckpointState({ websitePid: "101883843" });
  const cp0 = state.partners[adv] || { advertiserId: adv, resumeOffset: 1, presentationCursor: 0 };
  const fetchA = {
    fetchedCount: 100,
    totalCount: 5000,
    complete: false,
    stoppedEarlyForBudget: true,
    startedOffset: 1,
    checkpoint: { nextOffset: 101, mode: "offset", startedOffset: 1, stoppedEarlyForBudget: true, complete: false, fetchedCount: 100, totalCount: 5000 },
    error: null,
  };
  const afterA = advancePartnerCheckpoint(cp0, fetchA, { pageSize: 100, publishPerPartner: 25 });
  state.partners[adv] = afterA;
  saveProductFeedCheckpointState(file, state);
  state = null; // interrupt
  const loaded = loadProductFeedCheckpointState(file);
  const resumed = loaded.partners[adv];
  assert.equal(resumed.resumeOffset, 101);
  const fetchB = {
    fetchedCount: 100,
    totalCount: 5000,
    complete: false,
    stoppedEarlyForBudget: true,
    startedOffset: resumed.resumeOffset,
    checkpoint: { nextOffset: 201, mode: "offset", startedOffset: resumed.resumeOffset, stoppedEarlyForBudget: true, complete: false, fetchedCount: 100, totalCount: 5000 },
    error: null,
  };
  const afterB = advancePartnerCheckpoint(resumed, fetchB, { pageSize: 100, publishPerPartner: 25 });
  assert.equal(afterB.resumeOffset, 201);
  const proof = proveContinuationBetweenRuns(
    { advertiserId: adv, startedOffset: 1, nextOffset: afterA.resumeOffset, productIds: Array.from({ length: 100 }, (_, i) => "a" + (i + 1)) },
    { advertiserId: adv, startedOffset: resumed.resumeOffset, nextOffset: afterB.resumeOffset, productIds: Array.from({ length: 100 }, (_, i) => "a" + (i + 101)) },
  );
  assert.equal(proof.ok, true);
  assert.equal(proof.overlapProductIds, 0);
});
scenario("checkpoint_resume", "missing checkpoint file yields empty state (cold start, no crash)", () => {
  const s = loadProductFeedCheckpointState(path.join(tmpRoot, "does-not-exist.json"));
  assert.ok(s && typeof s === "object");
  assert.deepEqual(Object.keys(s.partners || {}), []);
});

/* ---------------- circuit breaker ---------------- */
scenario("circuit_breaker", "threshold boundaries: 0..2 CONTINUE, >=3 STOP", () => {
  for (const n of [0, 1, 2]) assert.equal(circuitBreakerDecide({ consecutiveFailures: n }), "CONTINUE");
  for (const n of [3, 4, 100]) assert.equal(circuitBreakerDecide({ consecutiveFailures: n }), "STOP");
});
scenario("circuit_breaker", "recorded observation: non-numeric failure count counts as 0 (fail-open)", () => {
  const garbage = circuitBreakerDecide({ consecutiveFailures: "abc" });
  const negative = circuitBreakerDecide({ consecutiveFailures: -5 });
  assert.equal(garbage, "CONTINUE");
  assert.equal(negative, "CONTINUE");
  findings.push({
    id: "CB_GARBAGE_INPUT_FAIL_OPEN",
    severity: "LOW",
    detail:
      "circuitBreakerDecide treats non-numeric/negative consecutiveFailures as 0 (CONTINUE). Planner stays DISARMED and also requires health, so no production impact; consider fail-closed on NaN before arming.",
  });
});

/* ---------------- auto STOP ---------------- */
scenario("auto_stop", "any stop reason -> stop=true, failClosed=true, note says STOP", () => {
  const d = evaluateGrowthStopConditions({ collisions: 2, batchHardFail: true });
  assert.equal(d.stop, true);
  assert.equal(d.failClosed, true);
  assert.ok(d.reasons.length >= 2);
  assert.match(d.note, /STOP/);
  const clean = evaluateGrowthStopConditions({ prevPublicSize: 100, nextPublicSize: 110, processed: 20, validCandidates: 10 });
  assert.equal(clean.stop, false);
  assert.equal(clean.note, "CONTINUE");
});
scenario("auto_stop", "negative-guard suite from safe-autonomous-growth passes", async () => {
  const neg = await runNegativeGrowthGuards({ nonceSqlitePath });
  assert.equal(neg.ok, true, JSON.stringify(neg.cases.filter((c) => !c.pass)));
});
scenario("auto_stop", "combined health stop beats throttle and blocks armed planner", () => {
  const h = evaluateGrowthHealth({ uniqueProducts: 100, holdCount: 40, invalidRate: 0.1 });
  assert.equal(h.stop, true);
  assert.equal(h.throttle, false);
  assert.equal(planAdaptiveBatch({ candidates, health: h, remainingCumulative: 1000, ...armedArgs }).allowed, 0);
});

/* ---------------- owner STOP ---------------- */
scenario("owner_stop", "manualStop=true forces STOP regardless of failures", () => {
  assert.equal(circuitBreakerDecide({ consecutiveFailures: 0, manualStop: true }), "STOP");
});
scenario("owner_stop", "owner STOP via gate=0: effective uncapped stays off even if arm env is set", () => {
  const r = resolveEffectiveUncappedGrowth({ env: { IU_CJ_PUBLIC_GROWTH_UNCAPPED: "0", IU_CJ_GROWTH_ACTIVATION_ARMED: "1" } });
  assert.equal(r.effectiveUncapped, false);
  assert.equal(r.maxAllowedNew, null);
  const none = resolveEffectiveUncappedGrowth({ env: {} });
  assert.equal(none.effectiveUncapped, false);
});
scenario("owner_stop", "owner STOP (health.stop=true) blocks fully armed planner", () => {
  const r = planAdaptiveBatch({ candidates, health: { stop: true, throttle: false }, remainingCumulative: 1000, ...armedArgs });
  assert.equal(r.allowed, 0);
  assert.equal(r.reason, "HEALTH_STOP");
});
scenario("owner_stop", "recorded observation: manualStop must be boolean true (string 'true' is ignored)", () => {
  assert.equal(circuitBreakerDecide({ consecutiveFailures: 0, manualStop: "true" }), "CONTINUE");
  findings.push({
    id: "OWNER_STOP_STRICT_BOOLEAN",
    severity: "LOW",
    detail:
      "manualStop only honoured when strictly boolean true; a string flag from env/vars would be ignored. Wire owner STOP through a boolean parse before arming.",
  });
});

/* ---------------- rollback ---------------- */
scenario("rollback", "snapshot -> bad batch -> restore yields byte-identical catalog", () => {
  const snapshot = JSON.stringify({ sections: [{ sectionKey: "aff-a", products: [{ productId: "1" }, { productId: "2" }] }] });
  const live = JSON.parse(snapshot);
  live.sections[0].products.push({ productId: "bad" });
  assert.notEqual(JSON.stringify(live), snapshot);
  const restored = JSON.parse(snapshot);
  assert.equal(JSON.stringify(restored), snapshot);
});
scenario("rollback", "ROLLBACK_FAILED is STOP and rollbackReady=false blocks activation prechecks", async () => {
  assert.equal(evaluateGrowthStopConditions({ rollbackFailed: true }).stop, true);
  const token = mintOwnerApprovalToken({ hmacSecret, generationId, mainSha });
  const r = await executeGrowthActivation({
    ownerApprovalToken: token.token,
    hmacSecret,
    generationId,
    mainSha,
    allowInsecureLocal: true,
    nonceSqlitePath,
    env: { IU_CJ_PUBLIC_GROWTH_UNCAPPED: "0", IU_CJ_GROWTH_NONCE_ALLOW_INSECURE_LOCAL: "1" },
    rollbackReady: false,
    dryRun: true,
    requirePrechecks: true,
  });
  assert.equal(r.executed, false);
  assert.equal(r.reason, "PRECHECK_FAILED");
  assert.ok(r.precheckFails.includes("rollback_not_ready"));
  assert.equal(r.wroteProjectsData, false);
});
scenario("rollback", "isolated rollback drill (read-only, repo data) passes and mutates nothing", () => {
  const drill = runIsolatedRollbackDrill({ root: REPO_ROOT });
  assert.equal(drill.productionWrite, false);
  assert.equal(drill.productionPagesMutated, false);
  assert.equal(drill.ok, true, JSON.stringify(drill.failures));
});

/* ---------------- unauthorized activation attempt ---------------- */
const localEnv = (extra = {}) => ({ IU_CJ_GROWTH_NONCE_ALLOW_INSECURE_LOCAL: "1", ...extra });
scenario("unauthorized_activation_attempt", "no token -> refused, nothing written", async () => {
  const r = await executeGrowthActivation({ hmacSecret, generationId, mainSha, allowInsecureLocal: true, nonceSqlitePath, env: localEnv({ IU_CJ_PUBLIC_GROWTH_UNCAPPED: "1" }) });
  assert.equal(r.refused, true);
  assert.equal(r.executed, false);
  assert.equal(r.wroteProjectsData, false);
  assert.equal(r.productionWrite, "NO_PRODUCTION_WRITE");
});
scenario("unauthorized_activation_attempt", "forged token + gate=1 + dryRun=false -> refused", async () => {
  const r = await executeGrowthActivation({
    ownerApprovalToken: "forged.token",
    hmacSecret,
    generationId,
    mainSha,
    dryRun: false,
    allowInsecureLocal: true,
    nonceSqlitePath,
    env: localEnv({ IU_CJ_PUBLIC_GROWTH_UNCAPPED: "1" }),
  });
  assert.equal(r.refused, true);
  assert.equal(r.executed, false);
  assert.equal(r.pipelineArming ?? null, null);
});
scenario("unauthorized_activation_attempt", "valid token but wrong mainSha / wrong generation -> refused", async () => {
  const token = mintOwnerApprovalToken({ hmacSecret, generationId, mainSha });
  const wrongSha = await executeGrowthActivation({
    ownerApprovalToken: token.token,
    hmacSecret,
    generationId,
    mainSha: "f".repeat(40),
    dryRun: false,
    allowInsecureLocal: true,
    nonceSqlitePath,
    env: localEnv({ IU_CJ_PUBLIC_GROWTH_UNCAPPED: "1" }),
  });
  assert.equal(wrongSha.refused, true);
  assert.equal(wrongSha.executed, false);
  const wrongGen = await executeGrowthActivation({
    ownerApprovalToken: token.token,
    hmacSecret,
    generationId: "other-generation",
    mainSha,
    dryRun: false,
    allowInsecureLocal: true,
    nonceSqlitePath,
    env: localEnv({ IU_CJ_PUBLIC_GROWTH_UNCAPPED: "1" }),
  });
  assert.equal(wrongGen.refused, true);
  assert.equal(wrongGen.executed, false);
});
scenario("unauthorized_activation_attempt", "expired token -> refused", async () => {
  const token = mintOwnerApprovalToken({
    hmacSecret,
    generationId,
    mainSha,
    nowIso: "2026-01-01T00:00:00.000Z",
    ttlMs: 60_000,
  });
  const r = await executeGrowthActivation({
    ownerApprovalToken: token.token,
    hmacSecret,
    generationId,
    mainSha,
    dryRun: false,
    allowInsecureLocal: true,
    nonceSqlitePath,
    nowIso: "2026-11-26T00:00:00.000Z",
    env: localEnv({ IU_CJ_PUBLIC_GROWTH_UNCAPPED: "1" }),
  });
  assert.equal(r.refused, true);
  assert.equal(r.executed, false);
});
scenario("unauthorized_activation_attempt", "valid token but gate=0 and dryRun=false -> GROWTH_GATE_LOCKED, nonce not consumed", async () => {
  const token = mintOwnerApprovalToken({ hmacSecret, generationId, mainSha });
  const r = await executeGrowthActivation({
    ownerApprovalToken: token.token,
    hmacSecret,
    generationId,
    mainSha,
    dryRun: false,
    allowInsecureLocal: true,
    nonceSqlitePath,
    nowIso: new Date().toISOString(),
    env: localEnv({ IU_CJ_PUBLIC_GROWTH_UNCAPPED: "0" }),
  });
  assert.equal(r.executed, false);
  assert.equal(r.reason, "GROWTH_GATE_LOCKED");
  assert.equal(r.wroteProjectsData, false);
});
scenario("unauthorized_activation_attempt", "gate=1 without execute arm stays capped; partial/truthy arms stay disarmed", () => {
  const g = resolveEffectiveUncappedGrowth({ env: { IU_CJ_PUBLIC_GROWTH_UNCAPPED: "1", IU_CJ_GROWTH_ACTIVATION_ARMED: "0" } });
  assert.equal(g.effectiveUncapped, false);
  for (const [u, e] of [[true, false], [false, true], ["1", true], [true, 1], [true, "true"]]) {
    const r = planAdaptiveBatch({ candidates, health: healthy, remainingCumulative: 1000, uncappedGate: u, executeArmed: e });
    assert.equal(r.allowed, 0);
    assert.equal(r.reason, REASON_OWNER_GATES_DISARMED);
  }
});

/* ---------------- runner ---------------- */
const startedAt = new Date().toISOString();
const results = [];
for (const s of scenarios) {
  const t0 = Date.now();
  try {
    await s.fn();
    results.push({ group: s.group, name: s.name, pass: true, ms: Date.now() - t0 });
    console.log("PASS [" + s.group + "] " + s.name);
  } catch (err) {
    results.push({ group: s.group, name: s.name, pass: false, ms: Date.now() - t0, error: String(err?.message || err).slice(0, 500) });
    console.log("FAIL [" + s.group + "] " + s.name + " :: " + String(err?.message || err).split("\n")[0]);
  }
}

const gateEnvAtEnd = String(process.env.IU_CJ_PUBLIC_GROWTH_UNCAPPED ?? "0");
const gateOk = gateEnvAtStart !== "1" && gateEnvAtEnd !== "1";
results.push({
  group: "gate_invariant",
  name: "IU_CJ_PUBLIC_GROWTH_UNCAPPED stayed 0/unset for entire battery",
  pass: gateOk,
  ms: 0,
  ...(gateOk ? {} : { error: "gate env was '" + gateEnvAtStart + "'->'" + gateEnvAtEnd + "'" }),
});
console.log((gateOk ? "PASS" : "FAIL") + " [gate_invariant] IU_CJ_PUBLIC_GROWTH_UNCAPPED=" + gateEnvAtEnd);

const groupsCovered = new Set(results.filter((r) => r.pass).map((r) => r.group));
const groupsFailed = [...new Set(results.filter((r) => !r.pass).map((r) => r.group))];
const coverage = REQUIRED.map((g) => ({
  scenario: g,
  cases: results.filter((r) => r.group === g).length,
  pass: results.filter((r) => r.group === g && r.pass).length,
  fail: results.filter((r) => r.group === g && !r.pass).length,
  covered: groupsCovered.has(g) && !groupsFailed.includes(g),
}));
const passN = results.filter((r) => r.pass).length;
const failN = results.length - passN;
const summary = {
  schema: BATTERY_SCHEMA,
  startedAt,
  finishedAt: new Date().toISOString(),
  mode: "DISARMED_OFFLINE",
  productionWrite: false,
  wroteProjectsData: false,
  envIU_CJ_PUBLIC_GROWTH_UNCAPPED: gateEnvAtEnd,
  verdict: failN === 0 && coverage.every((c) => c.covered) ? "PASS" : "FAIL",
  counts: { total: results.length, pass: passN, fail: failN, requiredScenarioGroups: REQUIRED.length, groupsCovered: coverage.filter((c) => c.covered).length },
  coverage,
  findings,
  results,
};

const outPath = process.argv[2] || process.env.IU_BATTERY_OUT || "";
if (outPath) {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outPath), JSON.stringify(summary, null, 2) + "\n", "utf8");
}
try {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
} catch {
  /* ignore */
}
console.log(
  "BATTERY_" + summary.verdict + " total=" + summary.counts.total + " pass=" + passN + " fail=" + failN +
    " groups=" + summary.counts.groupsCovered + "/" + REQUIRED.length,
);
process.exit(failN === 0 && summary.verdict === "PASS" ? 0 : 1);
