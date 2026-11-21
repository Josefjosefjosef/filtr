#!/usr/bin/env node
/**
 * Selftest: SAFE_AUTONOMOUS_GROWTH adaptive batches, STOP, prepare/execute auth,
 * growth gate resolution, dry-run first batch ≤25. Does NOT unlock production growth.
 * Does NOT write projects/data. Uses sqlite durable-semantics store (allowInsecureLocal).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  computeAdaptiveBatchSize,
  evaluateGrowthStopConditions,
  prepareGrowthActivation,
  executeGrowthActivation,
  runNegativeGrowthGuards,
  runSafeAutonomousGrowthCanary,
  mintOwnerApprovalToken,
  verifyOwnerActivationApproval,
  resolvePublicGrowthUncappedGate,
  resolveEffectiveUncappedGrowth,
  FORBIDDEN_PERMANENT_PARTNER_CAP,
  DEFAULT_FIRST_BATCH_MAX,
} from "./iu-cj-affiliate-phase3z-safe-autonomous-growth-v51-8.mjs";
import { computePublicGrowthBudget } from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";

assert.equal(FORBIDDEN_PERMANENT_PARTNER_CAP, null);
assert.equal(DEFAULT_FIRST_BATCH_MAX, 25);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-growth-exec-"));
const nonceSqlitePath = path.join(tmpRoot, "nonces.sqlite");
const hmacSecret = "selftest-hmac-secret-do-not-use-in-prod-32b";
const mainSha = "1012fc5a10f13aa3248e8e633b0d2a7fad01ae71";
const generationId = "2026-11-21T07:37:56.158Z";
const localStoreOpts = {
  allowInsecureLocal: true,
  nonceSqlitePath,
  env: { IU_CJ_GROWTH_NONCE_ALLOW_INSECURE_LOCAL: "1" },
};

/* ---- Growth gate ---- */
assert.equal(resolvePublicGrowthUncappedGate(undefined), false);
assert.equal(resolvePublicGrowthUncappedGate(""), false);
assert.equal(resolvePublicGrowthUncappedGate("0"), false);
assert.equal(resolvePublicGrowthUncappedGate("true"), false);
assert.equal(resolvePublicGrowthUncappedGate("yes"), false);
assert.equal(resolvePublicGrowthUncappedGate(" 1 "), true); // trim only; still exact "1"
assert.equal(resolvePublicGrowthUncappedGate("1"), true);

const gatedOnly = resolveEffectiveUncappedGrowth({
  env: { IU_CJ_PUBLIC_GROWTH_UNCAPPED: "1", IU_CJ_GROWTH_ACTIVATION_ARMED: "0" },
});
assert.equal(gatedOnly.effectiveUncapped, false, "gate 1 without arm must stay capped");
const armed = resolveEffectiveUncappedGrowth({
  env: {
    IU_CJ_PUBLIC_GROWTH_UNCAPPED: "1",
    IU_CJ_GROWTH_ACTIVATION_ARMED: "1",
    IU_CJ_GROWTH_FIRST_BATCH_MAX: "25",
  },
});
assert.equal(armed.effectiveUncapped, true);
assert.equal(armed.maxAllowedNew, 25);

const clampBudget = computePublicGrowthBudget(2975, {
  uncappedMode: true,
  maxGrowthRatio: 0.2,
  maxAllowedNew: 25,
  newCandidatesCount: 500,
});
assert.equal(clampBudget.allowedNew, 25);

/* ---- Adaptive + STOP ---- */
const aOk = computeAdaptiveBatchSize({
  catalogSize: 2705,
  priorBatchOk: true,
  priorAdmitted: 80,
  priorRejectRatio: 0.1,
});
const aFail = computeAdaptiveBatchSize({
  catalogSize: 2705,
  priorBatchOk: false,
  priorAdmitted: 0,
  priorRejectRatio: 0.95,
});
assert.ok(aOk >= 25 && aOk <= 400);
assert.ok(aFail < aOk);

const stopShrink = evaluateGrowthStopConditions({
  prevPublicSize: 2000,
  nextPublicSize: 1500,
  processed: 10,
  validCandidates: 0,
});
assert.equal(stopShrink.stop, true);

const neg = await runNegativeGrowthGuards({ nonceSqlitePath });
assert.equal(neg.ok, true, JSON.stringify(neg.cases.filter((c) => !c.pass)));

const prep = prepareGrowthActivation({
  mainSha,
  requiredCiPass: true,
  pagesPass: true,
  growthLedger: { cumulativeAddedSinceBaseline: 500, maxCumulativeAbs: 500, allowedNew: 0 },
  envUncapped: "0",
});
assert.equal(prep.ready, true);

/* ---- Auth negative tests ---- */
const authCases = [];
async function expectDeny(label, opts, expectedReason) {
  const r = await verifyOwnerActivationApproval({
    hmacSecret,
    ...localStoreOpts,
    expectedGenerationId: generationId,
    expectedMainSha: mainSha,
    ...opts,
  });
  authCases.push({
    id: label,
    pass: r.ok === false && (!expectedReason || r.reason === expectedReason || r.reason.startsWith(expectedReason)),
    reason: r.reason,
  });
  assert.equal(r.ok, false, label + " should deny: " + r.reason);
}

await expectDeny("missing_token", { ownerApprovalToken: "" }, "OWNER_APPROVAL_REQUIRED");
await expectDeny("malformed", { ownerApprovalToken: "not-a-token" }, "OWNER_APPROVAL_MALFORMED");
await expectDeny(
  "invalid_sig",
  {
    ownerApprovalToken: mintOwnerApprovalToken({
      hmacSecret: "different-secret-also-long-enough!!",
      generationId,
      mainSha,
    }).token,
  },
  "OWNER_APPROVAL_INVALID_SIGNATURE",
);

const goodMint = mintOwnerApprovalToken({
  hmacSecret,
  generationId,
  mainSha,
  firstBatchMax: 25,
  actor: "owner-bot",
  ttlMs: 3_600_000,
});
await expectDeny(
  "expired",
  {
    ownerApprovalToken: mintOwnerApprovalToken({
      hmacSecret,
      generationId,
      mainSha,
      ttlMs: 1_000,
      nowIso: "2020-01-01T00:00:00.000Z",
    }).token,
    nowIso: "2026-11-21T08:00:00.000Z",
  },
  "OWNER_APPROVAL_EXPIRED",
);
await expectDeny(
  "wrong_generation",
  {
    ownerApprovalToken: mintOwnerApprovalToken({
      hmacSecret,
      generationId: "1999-01-01T00:00:00.000Z",
      mainSha,
    }).token,
  },
  "OWNER_APPROVAL_GENERATION_MISMATCH",
);
await expectDeny(
  "wrong_main_sha",
  {
    ownerApprovalToken: mintOwnerApprovalToken({
      hmacSecret,
      generationId,
      mainSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }).token,
  },
  "OWNER_APPROVAL_MAIN_SHA_MISMATCH",
);
await expectDeny(
  "unauthorized_actor",
  {
    ownerApprovalToken: goodMint.token,
    requiredActor: "allowed-owner",
    actor: "intruder",
  },
  "OWNER_APPROVAL_UNAUTHORIZED_ACTOR",
);

const okOnce = await verifyOwnerActivationApproval({
  hmacSecret,
  ownerApprovalToken: goodMint.token,
  expectedGenerationId: generationId,
  expectedMainSha: mainSha,
  ...localStoreOpts,
  consume: true,
});
assert.equal(okOnce.ok, true);
assert.equal(okOnce.nonceStoreKind, "sqlite");
assert.equal(okOnce.nonceStoreDurable, true);
authCases.push({ id: "valid_consume", pass: true, reason: "OK" });

const replay = await verifyOwnerActivationApproval({
  hmacSecret,
  ownerApprovalToken: goodMint.token,
  expectedGenerationId: generationId,
  expectedMainSha: mainSha,
  ...localStoreOpts,
  consume: true,
});
assert.equal(replay.ok, false);
assert.equal(replay.reason, "OWNER_APPROVAL_REPLAY");
authCases.push({ id: "replay", pass: replay.reason === "OWNER_APPROVAL_REPLAY", reason: replay.reason });

/* Fail-closed: GITHUB_ACTIONS without durable HTTP → NONCE_STORE_UNAVAILABLE on consume */
const failClosedMint = mintOwnerApprovalToken({
  hmacSecret,
  generationId,
  mainSha,
  nonce: "fail-closed-" + Date.now(),
});
const failClosed = await verifyOwnerActivationApproval({
  hmacSecret,
  ownerApprovalToken: failClosedMint.token,
  expectedGenerationId: generationId,
  expectedMainSha: mainSha,
  requireDurable: true,
  env: { GITHUB_ACTIONS: "true" },
  consume: true,
});
assert.equal(failClosed.ok, false);
assert.equal(failClosed.reason, "NONCE_STORE_UNAVAILABLE");
assert.equal(failClosed.noProductionWrite, true);
authCases.push({
  id: "actions_without_durable_fail_closed",
  pass: failClosed.reason === "NONCE_STORE_UNAVAILABLE",
  reason: failClosed.reason,
});

/* ---- EXECUTE: missing approval ---- */
const execNo = await executeGrowthActivation({
  generationId,
  mainSha,
  hmacSecret,
  ...localStoreOpts,
  dryRun: true,
});
assert.equal(execNo.executed, false);
assert.equal(execNo.refused, true);
assert.equal(execNo.reason, "OWNER_APPROVAL_REQUIRED");
assert.equal(execNo.productionWrite, "NO_PRODUCTION_WRITE");

/* ---- Fresh token for dry-run + live arm tests ---- */
const dryToken = mintOwnerApprovalToken({
  hmacSecret,
  generationId,
  mainSha,
  firstBatchMax: 25,
  nonce: "dry-run-nonce-" + Date.now(),
});

const baselineProducts = [];
for (let i = 0; i < 50; i++) {
  baselineProducts.push({
    advertiserId: "111",
    productId: "p" + i,
    title: "Baseline " + i,
    currentPrice: 10 + i,
    currency: "CZK",
    affiliateUrl: "https://www.kqzyfj.com/click-base-" + i,
    publicationReady: true,
    publicOffer: true,
    publicationEligibility: "PUBLICATION_ELIGIBLE",
  });
}
const offersDoc = {
  schema: "iu-affiliate-cj-offers-public-v1",
  liveEnabled: true,
  snapshotId: "selftest",
  sections: [
    {
      sectionKey: "aff-test",
      coupons: [{ id: "c1", code: "KEEP", affiliateUrl: "https://www.kqzyfj.com/c" }],
      actions: [],
      products: baselineProducts,
    },
  ],
  stats: { uniqueProducts: baselineProducts.length },
};
const durable = {};
for (let i = 1; i <= 80; i++) {
  const id = "n" + i;
  durable["222|" + id] = {
    advertiserId: "222",
    productId: id,
    partnerName: "PartnerX",
    sectionKey: "aff-test",
    title: "New " + id,
    currentPrice: 100 + i,
    currency: "CZK",
    affiliateUrl: "https://www.kqzyfj.com/click-" + id,
    availabilityClass: "IN_STOCK",
    publicationEligibility: "PUBLICATION_ELIGIBLE",
    publicationReady: true,
    publicOffer: true,
  };
}

const dryExec = await executeGrowthActivation({
  ownerApprovalToken: dryToken.token,
  hmacSecret,
  ...localStoreOpts,
  generationId,
  mainSha,
  dryRun: true,
  firstBatchMax: 25,
  offersDoc,
  durableProducts: durable,
  joinedPartners: [{ advertiserId: "222", name: "PartnerX", status: "JOINED" }],
  backupPlanReady: true,
  requiredCiPass: true,
  pagesPass: true,
  env: { IU_CJ_PUBLIC_GROWTH_UNCAPPED: "0", IU_CJ_GROWTH_NONCE_ALLOW_INSECURE_LOCAL: "1" },
});
assert.equal(dryExec.reason, "DRY_RUN_OK");
assert.equal(dryExec.executed, false);
assert.equal(dryExec.wroteProjectsData, false);
assert.equal(dryExec.productionWrite, "NO_PRODUCTION_WRITE");
assert.ok(dryExec.dryRunBatch);
assert.ok(dryExec.dryRunBatch.batchSize <= 25);
assert.equal(dryExec.pipelineArming, null);
assert.equal(dryExec.auth.consumed, false);

/* Live without gate → locked */
const liveNoGate = await executeGrowthActivation({
  ownerApprovalToken: dryToken.token,
  hmacSecret,
  ...localStoreOpts,
  generationId,
  mainSha,
  dryRun: false,
  offersDoc,
  durableProducts: durable,
  joinedPartners: [{ advertiserId: "222", name: "PartnerX", status: "JOINED" }],
  backupPlanReady: true,
  env: { IU_CJ_PUBLIC_GROWTH_UNCAPPED: "0", IU_CJ_GROWTH_NONCE_ALLOW_INSECURE_LOCAL: "1" },
});
assert.equal(liveNoGate.reason, "GROWTH_GATE_LOCKED");
assert.equal(liveNoGate.executed, false);

/* Gate 1 without auth still refuse */
const gateNoAuth = await executeGrowthActivation({
  dryRun: false,
  generationId,
  mainSha,
  hmacSecret,
  ...localStoreOpts,
  env: { IU_CJ_PUBLIC_GROWTH_UNCAPPED: "1", IU_CJ_GROWTH_NONCE_ALLOW_INSECURE_LOCAL: "1" },
});
assert.equal(gateNoAuth.reason, "OWNER_APPROVAL_REQUIRED");

/* Live arm with gate+token (still no projects/data write) */
const liveToken = mintOwnerApprovalToken({
  hmacSecret,
  generationId,
  mainSha,
  firstBatchMax: 25,
  nonce: "live-arm-nonce-" + Date.now(),
});
const armPath = path.join(tmpRoot, "arm.json");
const liveArm = await executeGrowthActivation({
  ownerApprovalToken: liveToken.token,
  hmacSecret,
  ...localStoreOpts,
  generationId,
  mainSha,
  dryRun: false,
  firstBatchMax: 25,
  offersDoc,
  durableProducts: durable,
  joinedPartners: [{ advertiserId: "222", name: "PartnerX", status: "JOINED" }],
  backupPlanReady: true,
  requiredCiPass: true,
  pagesPass: true,
  env: { IU_CJ_PUBLIC_GROWTH_UNCAPPED: "1", IU_CJ_GROWTH_NONCE_ALLOW_INSECURE_LOCAL: "1" },
  armReceiptPath: armPath,
});
assert.equal(liveArm.reason, "ARMED_FOR_CATALOG_SYNC");
assert.equal(liveArm.executed, true);
assert.equal(liveArm.wroteProjectsData, false);
assert.equal(liveArm.productionWrite, "NO_DIRECT_PROJECTS_DATA_WRITE");
assert.equal(liveArm.pipelineArming.envOverlay.IU_CJ_GROWTH_ACTIVATION_ARMED, "1");
assert.equal(liveArm.pipelineArming.envOverlay.IU_CJ_GROWTH_FIRST_BATCH_MAX, "25");
assert.equal(liveArm.auth.nonceStoreDurable, true);
assert.ok(fs.existsSync(armPath));

/* Replay of live token denied */
const liveReplay = await executeGrowthActivation({
  ownerApprovalToken: liveToken.token,
  hmacSecret,
  ...localStoreOpts,
  generationId,
  mainSha,
  dryRun: false,
  env: { IU_CJ_PUBLIC_GROWTH_UNCAPPED: "1", IU_CJ_GROWTH_NONCE_ALLOW_INSECURE_LOCAL: "1" },
  backupPlanReady: true,
});
assert.equal(liveReplay.reason, "OWNER_APPROVAL_REPLAY");

/* Offline canary */
const canary = runSafeAutonomousGrowthCanary({
  offersDoc,
  durableProducts: durable,
  maxBatches: 3,
  joinedPartners: [{ advertiserId: "222", name: "PartnerX", status: "JOINED" }],
});
assert.equal(canary.wroteProjectsData, false);
assert.equal(canary.growthGateStillLocked, true);
assert.ok(canary.batches.length >= 1);

const halted = runSafeAutonomousGrowthCanary({
  offersDoc,
  durableProducts: durable,
  maxBatches: 3,
  injectStopFlags: { shaMismatch: true },
});
assert.equal(halted.halted, true);

console.log(
  JSON.stringify({
    IU_CJ_SAFE_AUTONOMOUS_GROWTH_SELFTEST: "OK",
    EXECUTE_IMPLEMENTATION: "LIVE_PIPELINE_ARM_V1",
    NONCE_STORE: "sqlite_atomic_local",
    adaptiveOk: aOk,
    adaptiveFail: aFail,
    prepReady: prep.ready,
    authCasesPass: authCases.every((c) => c.pass),
    authCases,
    dryRunReason: dryExec.reason,
    dryRunBatchSize: dryExec.dryRunBatch?.batchSize,
    liveArmReason: liveArm.reason,
    gateAloneBlocks: gatedOnly.effectiveUncapped === false,
    growthGateStillLockedDefault: true,
    wroteProjectsData: false,
  }),
);
