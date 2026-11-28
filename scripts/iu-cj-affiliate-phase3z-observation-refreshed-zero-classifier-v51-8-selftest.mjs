#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  classifyRefreshedZeroResidual,
  classifyRefreshPriority,
  planSourceCurrentPriorityRefresh,
  PRIORITY_TIER,
  recordResidualInObservationLedger,
  RESIDUAL_CLASS,
} from "./iu-cj-affiliate-phase3z-observation-refreshed-zero-classifier-v51-8.mjs";
import {
  emptyObservationLedger,
  evaluateObservationWindow,
} from "./iu-cj-affiliate-phase3z-48h-observation-ledger-v51-8.mjs";
import { ATTEMPT_STATUS } from "./iu-cj-affiliate-phase3z-lkg-missing-refresh-attempt-v51-8.mjs";

const mk = (byStatus, extra = {}) => ({
  targetCount: Object.values(byStatus).reduce((a, b) => a + b, 0),
  credentialsPresent: true,
  byStatus: { REFRESHED: 0, ...byStatus },
  ...extra,
});

// --- classifier ---
assert.equal(classifyRefreshedZeroResidual(null).residualClass, RESIDUAL_CLASS.LEDGER_MISSING);
assert.equal(classifyRefreshedZeroResidual(null).blocking, true);
assert.equal(
  classifyRefreshedZeroResidual(mk({ REFRESHED: 3, RETRY_SCHEDULED: 2 })).residualClass,
  RESIDUAL_CLASS.REFRESHED_POSITIVE,
);
assert.equal(
  classifyRefreshedZeroResidual({ targetCount: 0, credentialsPresent: true, byStatus: { REFRESHED: 0 } })
    .residualClass,
  RESIDUAL_CLASS.NO_TARGETS_CLEAN,
);
assert.equal(
  classifyRefreshedZeroResidual({
    targetCount: 0,
    credentialsPresent: true,
    byStatus: { REFRESHED: 0 },
    queueMerge: { deferredNotDue: 4 },
  }).residualClass,
  RESIDUAL_CLASS.NO_TARGETS_BACKOFF_DEFERRED,
);
assert.equal(
  classifyRefreshedZeroResidual(mk({ RETRY_SCHEDULED: 5 }, { credentialsPresent: false })).residualClass,
  RESIDUAL_CLASS.NO_CREDENTIALS_DRY,
);
assert.equal(
  classifyRefreshedZeroResidual(mk({ RETRY_SCHEDULED: 5 })).residualClass,
  RESIDUAL_CLASS.RETRY_PENDING,
);
assert.equal(
  classifyRefreshedZeroResidual(mk({ PRODUCT_NOT_FOUND: 2 })).residualClass,
  RESIDUAL_CLASS.PRODUCT_NOT_FOUND_RESIDUAL,
);
assert.equal(
  classifyRefreshedZeroResidual(mk({ SOURCE_UNAVAILABLE: 2 })).residualClass,
  RESIDUAL_CLASS.SOURCE_UNAVAILABLE_PARTNER,
);
assert.equal(
  classifyRefreshedZeroResidual(mk({ PARTNERSHIP_ENDED: 1 })).residualClass,
  RESIDUAL_CLASS.PARTNERSHIP_ENDED,
);
assert.equal(
  classifyRefreshedZeroResidual(mk({ INVALID_DATA: 1 })).residualClass,
  RESIDUAL_CLASS.INVALID_DATA_HOLD,
);
const tech = classifyRefreshedZeroResidual(mk({ TECHNICAL_FAILURE: 1, PRODUCT_NOT_FOUND: 3 }));
assert.equal(tech.residualClass, RESIDUAL_CLASS.TECHNICAL_FAILURE);
assert.equal(tech.blocking, true);
const mixed = classifyRefreshedZeroResidual(mk({ PRODUCT_NOT_FOUND: 3, RETRY_SCHEDULED: 1 }));
assert.equal(mixed.residualClass, RESIDUAL_CLASS.MIXED_NO_REFRESH);
assert.equal(mixed.dominantStatus, "PRODUCT_NOT_FOUND");
assert.equal(mixed.blocking, false);
assert.equal(mixed.growthArmed, false);
assert.ok(Object.values(ATTEMPT_STATUS).includes("REFRESHED"));

// --- priority planner ---
const NOW = Date.parse("2026-11-25T12:00:00.000Z");
const h = (n) => new Date(NOW - n * 3600000).toISOString();
const doc = {
  sections: [
    {
      products: [
        // CJ source ts present, stale (5h verify age) → restore
        { advertiserId: "1", productId: "A", lastVerifiedAt: h(5), sourceUpdatedAt: h(6), sourceUpdatedAtStatus: "PROVIDED" },
        // CJ source ts present, fresh → protect
        { advertiserId: "1", productId: "B", lastVerifiedAt: h(1), sourceUpdatedAt: h(2), sourceUpdatedAtStatus: "PROVIDED" },
        // No source ts, LKG carried → P3
        { advertiserId: "2", productId: "C", lastVerifiedAt: h(30), lkgCarried: true, sourceUpdatedAtStatus: "NOT_PROVIDED" },
        // No source ts, fetch recent → P4
        { advertiserId: "2", productId: "D", lastVerifiedAt: h(1), sourceUpdatedAtStatus: "NOT_PROVIDED" },
        // Never refreshed, no source ts → ceiling
        { advertiserId: "3", productId: "E", sourceUpdatedAtStatus: "NOT_PROVIDED" },
        // duplicate key ignored
        { advertiserId: "1", productId: "A", lastVerifiedAt: h(5), sourceUpdatedAt: h(6), sourceUpdatedAtStatus: "PROVIDED" },
      ],
    },
  ],
};
assert.equal(classifyRefreshPriority(doc.sections[0].products[0], NOW).tier, PRIORITY_TIER.P1_SOURCE_CURRENT_RESTORE);
assert.equal(classifyRefreshPriority(doc.sections[0].products[1], NOW).tier, PRIORITY_TIER.P2_SOURCE_CURRENT_PROTECT);
assert.equal(classifyRefreshPriority(doc.sections[0].products[2], NOW).tier, PRIORITY_TIER.P3_MISSING_REFRESH_CARRY);
assert.equal(classifyRefreshPriority(doc.sections[0].products[3], NOW).tier, PRIORITY_TIER.P4_VERIFIED_RECENT_UPKEEP);
assert.equal(classifyRefreshPriority(doc.sections[0].products[4], NOW).tier, PRIORITY_TIER.P9_SOURCE_CURRENT_CEILING);

const plan = planSourceCurrentPriorityRefresh(doc, { nowMs: NOW });
assert.equal(plan.totalProducts, 5);
assert.equal(plan.growthArmed, false);
assert.deepEqual(plan.selected.map((r) => r.productId), ["A", "B", "C", "D"]); // ceiling excluded
assert.equal(plan.sourceCurrentCapable, 2);
assert.equal(plan.sourceCurrentCeiling, 3);

const planCeil = planSourceCurrentPriorityRefresh(doc, { nowMs: NOW, includeCeiling: true });
assert.deepEqual(planCeil.selected.map((r) => r.productId), ["A", "B", "C", "D", "E"]);
assert.equal(planSourceCurrentPriorityRefresh(doc, { nowMs: NOW, budget: 1 }).selected.length, 1);

// Backoff: A not due → dropped from plan.
const queue = {
  items: {
    "1|A": {
      advertiserId: "1",
      productId: "A",
      status: "RETRY_SCHEDULED",
      closed: false,
      nextAttemptAt: new Date(NOW + 3600000).toISOString(),
    },
  },
};
const planBackoff = planSourceCurrentPriorityRefresh(doc, { nowMs: NOW, retryQueue: queue });
assert.equal(planBackoff.deferredByBackoff, 1);
assert.ok(!planBackoff.selected.some((r) => r.productId === "A"));
assert.equal(planBackoff.selected[0].productId, "B");

const variantPlan = planSourceCurrentPriorityRefresh(
  {
    sections: [
      {
        products: [
          { advertiserId: "1", productId: "SAME", productVariant: "v", lastVerifiedAt: h(5), sourceUpdatedAt: h(6), sourceUpdatedAtStatus: "PROVIDED" },
          { advertiserId: "1", productId: "SAME", productVariant: "w", lastVerifiedAt: h(5), sourceUpdatedAt: h(6), sourceUpdatedAtStatus: "PROVIDED" },
          { advertiserId: "1", productId: "SAME", productVariant: "v", lastVerifiedAt: h(5), sourceUpdatedAt: h(6), sourceUpdatedAtStatus: "PROVIDED" },
        ],
      },
    ],
  },
  { nowMs: NOW },
);
assert.equal(variantPlan.totalProducts, 2);
assert.equal(variantPlan.growthArmed, false);
assert.deepEqual(variantPlan.selected.map((row) => row.key), ["1|SAME|v", "1|SAME|w"]);

// --- ledger integration ---
let led = emptyObservationLedger({ startedAt: "2026-11-23T00:00:00.000Z" });
led = recordResidualInObservationLedger(led, classifyRefreshedZeroResidual(mk({ RETRY_SCHEDULED: 2 }), { runId: "r1" }), {
  at: "2026-11-24T00:00:00.000Z",
  runId: "r1",
});
led = recordResidualInObservationLedger(led, classifyRefreshedZeroResidual(mk({ PRODUCT_NOT_FOUND: 2 })), {
  at: "2026-11-24T06:00:00.000Z",
  runId: "r2",
});
const ev = evaluateObservationWindow(led, { nowIso: "2026-11-24T12:00:00.000Z" });
assert.equal(ev.refreshedZeroResidual.observations, 2);
assert.equal(ev.refreshedZeroResidual.consecutiveRefreshedZero, 2);
assert.equal(ev.refreshedZeroResidual.lastClass, RESIDUAL_CLASS.PRODUCT_NOT_FOUND_RESIDUAL);
assert.equal(ev.refreshedZeroResidual.informationalOnly, true);
assert.equal(ev.scheduleSuccessCount, 0); // residual events never count as schedule success
assert.equal(ev.complete, false);
// positive run resets consecutive streak
led = recordResidualInObservationLedger(led, classifyRefreshedZeroResidual(mk({ REFRESHED: 1 })), {
  at: "2026-11-24T09:00:00.000Z",
  runId: "r3",
});
assert.equal(
  evaluateObservationWindow(led, { nowIso: "2026-11-24T12:00:00.000Z" }).refreshedZeroResidual.consecutiveRefreshedZero,
  0,
);

console.log(JSON.stringify({ IU_CJ_REFRESHED_ZERO_CLASSIFIER_SELFTEST: "PASS" }));
