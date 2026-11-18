#!/usr/bin/env node
/**
 * V51.8 — durable catalog R2 migration PLAN (no uncontrolled cutover).
 *
 * Problem: iu-affiliate-cj-durable-catalog-v51.json approaches GitHub 100MB blob limit.
 * Short-term: minify + progressive HOLD strip + soft 88e6 / hard 98e6 under workflow 99e6.
 * Long-term: store durable blob on Cloudflare R2; keep only a pointer + LKG hash in git.
 *
 * This module documents the contract and exports a dry-run validator. It does NOT migrate.
 */
export const DURABLE_R2_MIGRATION_PLAN = Object.freeze({
  schema: "iu-cj-affiliate-phase3z-durable-r2-migration-plan-v51.8",
  status: "PLAN_ONLY_NO_CUTOVER",
  keepActive: {
    gitTipCompact: true,
    softMaxBytes: 88_000_000,
    hardMaxBytes: 98_000_000,
    workflowGateBytes: 99_000_000,
    failClosedOnHard: true,
  },
  target: {
    stagingPrefix: "cj-durable/staging/",
    livePointerKey: "cj-durable/live/pointer.json",
    objectKeyPattern: "cj-durable/objects/{generation}/{contentHash}.json.gz",
    contentHash: "sha256",
    atomicPointer: true,
    generationMonotonic: true,
    refuseOverwriteNewerGeneration: true,
    lkgPointerKey: "cj-durable/live/lkg-pointer.json",
    checkpointRestoreFromPointer: true,
    rollback: "swap pointer to previous generation",
    fallback: "git tip compact remains until pointer readback proves 2 consecutive green restores",
  },
  cutoverGates: [
    "staging write + content-hash verify",
    "pointer atomic swap with generation check",
    "offers-live-sync restore from R2 equals git tip identities",
    "HOLD/LKG/DEFERRED_NEW metadata preserved",
    "rollback drill PASS",
    "no force-push / no growth uncapped",
  ],
});

export function validateDurableR2MigrationPlan(plan = DURABLE_R2_MIGRATION_PLAN) {
  const errors = [];
  if (plan.status !== "PLAN_ONLY_NO_CUTOVER") errors.push("status_must_remain_plan_only");
  if (!plan.target?.atomicPointer) errors.push("atomic_pointer_required");
  if (!plan.target?.refuseOverwriteNewerGeneration) errors.push("generation_guard_required");
  if (!plan.target?.lkgPointerKey) errors.push("lkg_pointer_required");
  if (!(plan.keepActive?.hardMaxBytes < plan.keepActive?.workflowGateBytes)) {
    errors.push("hard_must_be_below_workflow_gate");
  }
  return { ok: errors.length === 0, errors, plan };
}

const isMain = process.argv[1] && String(process.argv[1]).replace(/\\/g, "/").endsWith(
  "iu-cj-affiliate-phase3z-durable-r2-migration-plan-v51-8.mjs"
);
if (isMain) {
  const r = validateDurableR2MigrationPlan();
  if (!r.ok) {
    console.error(JSON.stringify({ IU_CJ_DURABLE_R2_MIGRATION_PLAN: "FAIL", ...r }));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ IU_CJ_DURABLE_R2_MIGRATION_PLAN: "PASS", status: r.plan.status }));
  }
}
