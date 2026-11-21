#!/usr/bin/env node
/**
 * Selftest: SAFE_AUTONOMOUS_GROWTH adaptive batches, STOP, prepare/execute disarm.
 * Does not unlock growth gate. Does not write projects/data.
 */
import assert from "node:assert/strict";
import {
  computeAdaptiveBatchSize,
  evaluateGrowthStopConditions,
  prepareGrowthActivation,
  executeGrowthActivation,
  runNegativeGrowthGuards,
  runSafeAutonomousGrowthCanary,
  FORBIDDEN_PERMANENT_PARTNER_CAP,
} from "./iu-cj-affiliate-phase3z-safe-autonomous-growth-v51-8.mjs";

assert.equal(FORBIDDEN_PERMANENT_PARTNER_CAP, null);

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

const neg = runNegativeGrowthGuards();
assert.equal(neg.ok, true, JSON.stringify(neg.cases.filter((c) => !c.pass)));

const prep = prepareGrowthActivation({
  mainSha: "10b5c382b97ca9319e7b93bb377541d8bad7c789",
  requiredCiPass: true,
  pagesPass: true,
  growthLedger: { cumulativeAddedSinceBaseline: 500, maxCumulativeAbs: 500, allowedNew: 0 },
  envUncapped: "0",
});
assert.equal(prep.ready, true);
assert.ok(prep.checks.some((c) => c.id === "execute_disarmed" && c.pass));

const exec = executeGrowthActivation({});
assert.equal(exec.executed, false);
assert.equal(exec.refused, true);
assert.equal(exec.reason, "OWNER_APPROVAL_REQUIRED");

/* Offline canary — baseline must be large enough for uncapped ratio drip (floor(n*0.2)). */
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

const canary = runSafeAutonomousGrowthCanary({
  offersDoc,
  durableProducts: durable,
  maxBatches: 3,
  joinedPartners: [{ advertiserId: "222", name: "PartnerX", status: "JOINED" }],
});
assert.equal(canary.wroteProjectsData, false);
assert.equal(canary.growthGateStillLocked, true);
assert.equal(canary.envIU_CJ_PUBLIC_GROWTH_UNCAPPED, "0");
assert.ok(canary.batches.length >= 1);
assert.equal(canary.ok, true, JSON.stringify(canary.halt || canary.batches));

/* Inject STOP mid-canary */
const halted = runSafeAutonomousGrowthCanary({
  offersDoc,
  durableProducts: durable,
  maxBatches: 3,
  injectStopFlags: { shaMismatch: true },
});
assert.equal(halted.halted, true);
assert.ok(halted.batches.length === 1);

console.log(
  JSON.stringify({
    IU_CJ_SAFE_AUTONOMOUS_GROWTH_SELFTEST: "OK",
    adaptiveOk: aOk,
    adaptiveFail: aFail,
    prepReady: prep.ready,
    executeRefused: exec.refused,
    canaryBatches: canary.batches.length,
    canaryAdmitted: canary.batches.reduce((s, b) => s + b.validCandidates, 0),
    haltOnInject: halted.halted,
    growthGateStillLocked: true,
  }),
);
