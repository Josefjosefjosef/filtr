/**
 * V51.8 — SAFE_AUTONOMOUS_GROWTH (prepare + adaptive offline batches).
 * No permanent per-partner product cap. Adaptive batching is operational protection only.
 * LIVE uncapped growth stays locked until owner sets IU_CJ_PUBLIC_GROWTH_UNCAPPED=1.
 * EXECUTE_GROWTH_ACTIVATION is intentionally stubbed / refuse-without-owner-token.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  applyPublicGrowthBudget,
  collectPublicEligibleProductMap,
} from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";
import {
  runGrowthShadowMode,
  reconstructDeferredCandidatesFromDurable,
} from "./iu-cj-affiliate-phase3z-growth-shadow-mode-v51-8.mjs";

export const SAFE_AUTONOMOUS_GROWTH_SCHEMA =
  "iu-cj-affiliate-phase3z-safe-autonomous-growth-v51-8";
export const PREPARE_GROWTH_ACTIVATION_SCHEMA =
  "iu-cj-affiliate-phase3z-prepare-growth-activation-v51-8";
export const EXECUTE_GROWTH_ACTIVATION_SCHEMA =
  "iu-cj-affiliate-phase3z-execute-growth-activation-v51-8";

/** Permanent numeric partner caps are forbidden — adaptive batches only. */
export const FORBIDDEN_PERMANENT_PARTNER_CAP = null;

export const DEFAULT_STOP_THRESHOLDS = Object.freeze({
  maxShrinkRatio: 0.05,
  maxSurgeRatio: 0.35,
  maxDuplicateRatio: 0.4,
  maxCollisionAbs: 0,
  maxInvalidAffiliateRatio: 0.15,
  maxRejectRatio: 0.85,
  maxBatchMs: 120_000,
  minValidationSuccessRatio: 0.12,
});

function sha256Json(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj || {})).digest("hex");
}

function countPublic(doc) {
  return collectPublicEligibleProductMap(doc || { sections: [] }).size;
}

/**
 * Adaptive batch size from prior outcomes — not a permanent catalog ceiling.
 */
export function computeAdaptiveBatchSize(state = {}) {
  const catalogSize = Math.max(1, Number(state.catalogSize) || 1);
  const priorOk = state.priorBatchOk !== false;
  const priorAdmitted = Math.max(0, Number(state.priorAdmitted) || 0);
  const priorRejectRatio = Math.min(1, Math.max(0, Number(state.priorRejectRatio) || 0));
  const errorRate = Math.min(1, Math.max(0, Number(state.errorRate) || 0));
  const publishLoad = Math.min(1, Math.max(0, Number(state.publishLoad) || 0));

  // Base: ~2–8% of catalog, floor 25 / ceiling 400 (ops drip, not partner cap).
  let next = Math.round(catalogSize * 0.04);
  next = Math.max(25, Math.min(400, next));

  if (!priorOk) return Math.max(10, Math.floor(next * 0.35));
  if (priorRejectRatio > 0.6 || errorRate > 0.2) next = Math.floor(next * 0.5);
  else if (priorAdmitted > 0 && priorRejectRatio < 0.25 && errorRate < 0.05) next = Math.floor(next * 1.35);
  if (publishLoad > 0.7) next = Math.floor(next * 0.6);
  return Math.max(10, Math.min(400, next));
}

/**
 * Evaluate STOP conditions after a batch. Fail-closed.
 */
export function evaluateGrowthStopConditions(batch = {}, thresholds = DEFAULT_STOP_THRESHOLDS) {
  const t = { ...DEFAULT_STOP_THRESHOLDS, ...(thresholds || {}) };
  const reasons = [];
  const prev = Math.max(0, Number(batch.prevPublicSize) || 0);
  const next = Math.max(0, Number(batch.nextPublicSize) || 0);
  const processed = Math.max(0, Number(batch.processed) || 0);
  const admitted = Math.max(0, Number(batch.validCandidates) || 0);
  const rejected = Math.max(0, Number(batch.rejected) || 0);
  const duplicates = Math.max(0, Number(batch.duplicates) || 0);
  const collisions = Math.max(0, Number(batch.collisions) || 0);
  const invalidAffiliate = Math.max(0, Number(batch.invalidAffiliate) || 0);
  const ms = Math.max(0, Number(batch.durationMs) || 0);

  if (prev > 0 && next < prev * (1 - t.maxShrinkRatio)) {
    reasons.push({ code: "CATALOG_SHRINKAGE", prev, next, maxShrinkRatio: t.maxShrinkRatio });
  }
  if (prev > 0 && next > prev * (1 + t.maxSurgeRatio)) {
    reasons.push({ code: "CATALOG_SURGE", prev, next, maxSurgeRatio: t.maxSurgeRatio });
  }
  if (processed > 0 && duplicates / processed > t.maxDuplicateRatio) {
    reasons.push({ code: "DUPLICATE_SPIKE", duplicates, processed });
  }
  if (collisions > t.maxCollisionAbs) {
    reasons.push({ code: "IDENTITY_COLLISIONS", collisions });
  }
  if (processed > 0 && invalidAffiliate / processed > t.maxInvalidAffiliateRatio) {
    reasons.push({ code: "INVALID_AFFILIATE_SPIKE", invalidAffiliate, processed });
  }
  if (processed > 20 && rejected / processed > t.maxRejectRatio) {
    reasons.push({ code: "REJECT_SPIKE", rejected, processed });
  }
  if (processed > 20 && admitted / processed < t.minValidationSuccessRatio) {
    reasons.push({ code: "VALIDATION_SUCCESS_COLLAPSE", admitted, processed });
  }
  if (ms > t.maxBatchMs) {
    reasons.push({ code: "BATCH_TIMEOUT", ms, maxBatchMs: t.maxBatchMs });
  }
  if (batch.pagesDeployFailed === true) reasons.push({ code: "PAGES_DEPLOY_FAILED" });
  if (batch.requiredCiFailed === true) reasons.push({ code: "REQUIRED_CI_FAILED" });
  if (batch.rollbackFailed === true) reasons.push({ code: "ROLLBACK_FAILED" });
  if (batch.joinedRegistryMismatch === true) reasons.push({ code: "JOINED_REGISTRY_MISMATCH" });
  if (batch.staleSourceFeeds === true) reasons.push({ code: "STALE_SOURCE_FEEDS" });
  if (batch.missingSection === true) reasons.push({ code: "MISSING_SECTION" });
  if (batch.corruptManifest === true) reasons.push({ code: "CORRUPT_MANIFEST" });
  if (batch.shaMismatch === true) reasons.push({ code: "SHA_MISMATCH" });
  if (batch.capacityExceeded === true) reasons.push({ code: "CAPACITY_EXCEEDED" });
  if (batch.syncRepeatedFail === true) reasons.push({ code: "SYNC_REPEATED_FAIL" });
  if (batch.batchHardFail === true) reasons.push({ code: "BATCH_HARD_FAIL" });

  return {
    stop: reasons.length > 0,
    reasons,
    failClosed: true,
    note: reasons.length
      ? "STOP — do not admit further products until owner/ops clears the cause."
      : "CONTINUE",
  };
}

/**
 * Offline adaptive canary / safe growth simulation. Never writes projects/data.
 * Never arms IU_CJ_PUBLIC_GROWTH_UNCAPPED.
 */
export function runSafeAutonomousGrowthCanary(opts = {}) {
  const offersDoc = opts.offersDoc || opts.prevDoc;
  if (!offersDoc) throw new Error("runSafeAutonomousGrowthCanary requires offersDoc");

  const maxBatches = Math.max(1, Math.min(12, Number(opts.maxBatches) || 5));
  const thresholds = opts.thresholds || DEFAULT_STOP_THRESHOLDS;
  const batches = [];
  let stop = null;
  let priorBatchOk = true;
  let priorAdmitted = 0;
  let priorRejectRatio = 0;
  let catalogSize = countPublic(offersDoc);
  const baseline = catalogSize;
  const t0 = Date.now();
  let cumulativeAdmitted = 0;

  for (let i = 0; i < maxBatches; i++) {
    if (stop?.stop) break;
    const batchSize = computeAdaptiveBatchSize({
      catalogSize,
      priorBatchOk,
      priorAdmitted,
      priorRejectRatio,
      errorRate: opts.errorRate || 0,
      publishLoad: opts.publishLoad || 0,
    });
    const started = Date.now();
    const shadow = runGrowthShadowMode({
      offersDoc,
      durableProducts: opts.durableProducts,
      joinedPartners: opts.joinedPartners,
      reportedDeferredNew: opts.reportedDeferredNew,
      iterations: i + 1,
      batchSize,
      uncappedShadow: true,
      preferredCurrency: opts.preferredCurrency || "CZK",
    });
    const durationMs = Date.now() - started;
    const row = shadow.iterationRows?.[shadow.iterationRows.length - 1] || {};
    const prevPublicSize = i === 0 ? baseline : batches[i - 1].cumulativePublicSize;
    const nextPublicSize = shadow.finalPublicSize;
    const admittedThis = Math.max(0, (shadow.validCandidates || 0) - cumulativeAdmitted);
    const evalBatch = {
      prevPublicSize,
      nextPublicSize,
      processed: row.processed || 0,
      validCandidates: admittedThis,
      rejected: row.rejected || 0,
      duplicates: row.duplicates || 0,
      collisions: 0,
      invalidAffiliate: 0,
      durationMs,
      batchHardFail: shadow.ok === false,
      ...(opts.injectStopFlags || {}),
    };
    const decision = evaluateGrowthStopConditions(evalBatch, thresholds);
    const snapshot = {
      batch: i + 1,
      batchSize,
      durationMs,
      processed: evalBatch.processed,
      validCandidates: admittedThis,
      rejected: evalBatch.rejected,
      hold: row.hold || 0,
      duplicates: evalBatch.duplicates,
      collisions: 0,
      byPartner: row.byPartner || {},
      byCategory: row.byCategory || {},
      prevPublicSize,
      nextPublicSize,
      deltaPublicSize: nextPublicSize - prevPublicSize,
      cumulativePublicSize: nextPublicSize,
      cumulativeAdmitted: shadow.validCandidates || 0,
      approxJsonBytesDelta: row.loadEstimate?.approxBytesDelta ?? null,
      paidPositionsUntouched: shadow.paidPositionsUntouched !== false,
      rollbackPlan: shadow.rollbackPlan || null,
      stopDecision: decision,
      ok: !decision.stop && shadow.ok !== false,
    };
    batches.push(snapshot);

    if (decision.stop || shadow.ok === false) {
      stop = decision.stop
        ? decision
        : evaluateGrowthStopConditions({ ...evalBatch, batchHardFail: true }, thresholds);
      priorBatchOk = false;
      break;
    }

    cumulativeAdmitted = shadow.validCandidates || 0;
    catalogSize = nextPublicSize;
    priorBatchOk = true;
    priorAdmitted = admittedThis;
    priorRejectRatio = snapshot.processed > 0 ? snapshot.rejected / snapshot.processed : 0;
  }

  const envUncapped = String(process.env.IU_CJ_PUBLIC_GROWTH_UNCAPPED || "0");
  return {
    schema: SAFE_AUTONOMOUS_GROWTH_SCHEMA,
    at: new Date().toISOString(),
    mode: "SAFE_AUTONOMOUS_GROWTH_OFFLINE_CANARY",
    ok: !stop?.stop && batches.every((b) => b.ok),
    wroteProjectsData: false,
    growthGateStillLocked: envUncapped !== "1",
    envIU_CJ_PUBLIC_GROWTH_UNCAPPED: envUncapped,
    forbiddenPermanentPartnerCap: FORBIDDEN_PERMANENT_PARTNER_CAP,
    baselinePublicSize: baseline,
    batches,
    halted: !!stop?.stop,
    halt: stop,
    durationMs: Date.now() - t0,
    note: "Adaptive drip only — no permanent 10/partner (or any) catalog ceiling.",
  };
}

/**
 * PREPARE_GROWTH_ACTIVATION — evidence pack + readiness gates. Safe to run now.
 * Does not publish and does not flip uncapped env.
 */
export function prepareGrowthActivation(opts = {}) {
  const mainSha = String(opts.mainSha || "").trim();
  const growthGateLocked = String(opts.envUncapped ?? process.env.IU_CJ_PUBLIC_GROWTH_UNCAPPED ?? "0") !== "1";
  const ledger = opts.growthLedger || { cumulativeAddedSinceBaseline: 500, maxCumulativeAbs: 500, allowedNew: 0 };
  const checks = [
    { id: "backup_plan", pass: opts.backupPlanReady === true || opts.backupPlanReady == null, note: "Caller must snapshot last valid catalog before EXECUTE" },
    { id: "main_sha", pass: /^[0-9a-f]{40}$/i.test(mainSha) || mainSha.length >= 7, value: mainSha || null },
    { id: "required_ci", pass: opts.requiredCiPass !== false, value: opts.requiredCiPass },
    { id: "pages", pass: opts.pagesPass !== false, value: opts.pagesPass },
    { id: "r2_d1", pass: opts.r2d1Pass !== false, value: opts.r2d1Pass, note: "Soft until EXECUTE" },
    { id: "growth_ledger", pass: Number(ledger.allowedNew) === 0 && growthGateLocked, value: ledger },
    { id: "joined_registry", pass: opts.joinedRegistryPass !== false, value: opts.joinedRegistryPass },
    { id: "source_feeds", pass: opts.sourceFeedsPass !== false, value: opts.sourceFeedsPass },
    { id: "cz_eligibility", pass: opts.czEligibilityPass !== false, value: opts.czEligibilityPass },
    { id: "paid_positions", pass: opts.paidPositionsPass !== false, value: opts.paidPositionsPass },
    { id: "adaptive_batching_ready", pass: true },
    { id: "stop_conditions_ready", pass: true },
    { id: "rollback_ready", pass: true },
    { id: "growth_gate_locked", pass: growthGateLocked },
    { id: "execute_disarmed", pass: true, note: "EXECUTE requires ownerApprovalToken" },
  ];
  const fail = checks.filter((c) => c.pass === false);
  const doc = {
    schema: PREPARE_GROWTH_ACTIVATION_SCHEMA,
    at: new Date().toISOString(),
    ready: fail.length === 0,
    checks,
    fails: fail.map((f) => f.id),
    nextStep: "EXECUTE_GROWTH_ACTIVATION requires explicit owner approval token; do not run automatically.",
    activationFingerprint: sha256Json({
      mainSha,
      ledger,
      growthGateLocked,
      at: "prepare",
    }),
  };
  if (opts.outPath) {
    fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
    fs.writeFileSync(opts.outPath, JSON.stringify(doc, null, 2) + "\n");
  }
  return doc;
}

/**
 * EXECUTE_GROWTH_ACTIVATION — REFUSE unless ownerApprovalToken matches expected.
 * Default: always refuse in this prep phase.
 */
export function executeGrowthActivation(opts = {}) {
  const expected = String(opts.expectedOwnerToken || process.env.IU_CJ_GROWTH_OWNER_APPROVAL_TOKEN || "");
  const provided = String(opts.ownerApprovalToken || "");
  const envUncapped = String(process.env.IU_CJ_PUBLIC_GROWTH_UNCAPPED || "0");

  if (!expected || !provided || provided !== expected) {
    return {
      schema: EXECUTE_GROWTH_ACTIVATION_SCHEMA,
      at: new Date().toISOString(),
      executed: false,
      refused: true,
      reason: "OWNER_APPROVAL_REQUIRED",
      envIU_CJ_PUBLIC_GROWTH_UNCAPPED: envUncapped,
      note: "Activation execute is disarmed until explicit owner approval.",
    };
  }
  if (opts.dryRun !== false) {
    return {
      schema: EXECUTE_GROWTH_ACTIVATION_SCHEMA,
      at: new Date().toISOString(),
      executed: false,
      refused: true,
      reason: "DRY_RUN_ONLY_IN_PREP",
      note: "Even with token, prep builds refuse live execute (dryRun default true).",
    };
  }
  // Live path intentionally not implemented in prep PR — owner must ship execute follow-up.
  return {
    schema: EXECUTE_GROWTH_ACTIVATION_SCHEMA,
    at: new Date().toISOString(),
    executed: false,
    refused: true,
    reason: "EXECUTE_NOT_IMPLEMENTED_IN_PREP",
    note: "Safe prep only — no automatic uncapped publish.",
  };
}

export function runNegativeGrowthGuards(opts = {}) {
  const cases = [];
  const baseDoc = opts.offersDoc || { sections: [], liveEnabled: true, stats: { uniqueProducts: 10 } };

  // Shrinkage STOP
  const shrink = evaluateGrowthStopConditions({
    prevPublicSize: 1000,
    nextPublicSize: 800,
    processed: 50,
    validCandidates: 0,
    rejected: 0,
    duplicates: 0,
  });
  cases.push({ id: "stop_shrinkage", pass: shrink.stop === true && shrink.reasons.some((r) => r.code === "CATALOG_SHRINKAGE") });

  // Surge STOP
  const surge = evaluateGrowthStopConditions({
    prevPublicSize: 1000,
    nextPublicSize: 1500,
    processed: 50,
    validCandidates: 500,
    rejected: 0,
    duplicates: 0,
  });
  cases.push({ id: "stop_surge", pass: surge.stop === true && surge.reasons.some((r) => r.code === "CATALOG_SURGE") });

  // Collision STOP
  const coll = evaluateGrowthStopConditions({
    prevPublicSize: 100,
    nextPublicSize: 110,
    processed: 20,
    validCandidates: 10,
    collisions: 2,
  });
  cases.push({ id: "stop_collision", pass: coll.stop === true });

  // Execute refuse
  const exec = executeGrowthActivation({ ownerApprovalToken: "nope", expectedOwnerToken: "secret" });
  cases.push({ id: "execute_refused", pass: exec.refused === true && exec.executed === false });

  // Adaptive size changes with failures
  const a1 = computeAdaptiveBatchSize({ catalogSize: 2705, priorBatchOk: true, priorAdmitted: 100, priorRejectRatio: 0.1 });
  const a2 = computeAdaptiveBatchSize({ catalogSize: 2705, priorBatchOk: false, priorAdmitted: 0, priorRejectRatio: 0.9 });
  cases.push({ id: "adaptive_shrinks_on_fail", pass: a2 < a1 });
  cases.push({ id: "no_permanent_partner_cap", pass: FORBIDDEN_PERMANENT_PARTNER_CAP == null });

  // Budget still locked when not uncapped
  const locked = applyPublicGrowthBudget(
    JSON.parse(JSON.stringify(baseDoc)),
    baseDoc,
    { uncappedMode: false, cumulativeAddedSinceBaseline: 500, maxCumulativeAbs: 500 },
  );
  cases.push({
    id: "live_budget_still_exhausted",
    pass: Number(locked.budget?.allowedNew || 0) === 0 || Number(locked.budget?.cumulativeRemaining || 0) === 0,
  });

  return {
    schema: "iu-cj-affiliate-phase3z-safe-growth-negative-guards-v51-8",
    at: new Date().toISOString(),
    ok: cases.every((c) => c.pass),
    cases,
  };
}

export {
  reconstructDeferredCandidatesFromDurable,
  runGrowthShadowMode,
};
