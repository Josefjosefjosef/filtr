#!/usr/bin/env node
/**
 * V51.8 — R2 / D1 / Workers readiness (pure recommendation, no migration activation).
 *
 * Compares Pages shards vs R2 managed-public vs hybrid for public catalog serving.
 * Never arms publish, never mutates infra, never activates migration.
 *
 * CLI selftest: node scripts/iu-cj-affiliate-phase3z-r2-d1-workers-readiness-v51-8.mjs
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

export const R2_D1_WORKERS_READINESS_SCHEMA =
  "iu-cj-affiliate-phase3z-r2-d1-workers-readiness-v51-8";

export const MIGRATION_STATUS = Object.freeze({
  DRAFT_ONLY: "DRAFT_ONLY",
  OWNER_APPROVED_NOT_ACTIVATED: "OWNER_APPROVED_NOT_ACTIVATED",
});

export const STRATEGY = Object.freeze({
  PAGES_SHARDS: "PAGES_SHARDS",
  R2_MANAGED_PUBLIC: "R2_MANAGED_PUBLIC",
  HYBRID: "HYBRID",
});

/** Soft Pages asset comfort ceiling before sharding pain rises (~20 MiB). */
const PAGES_COMFORT_BYTES = 20 * 1024 * 1024;
/** Hard-ish Pages practical limit for a single public JSON blob (~25 MiB). */
const PAGES_HARD_BYTES = 25 * 1024 * 1024;

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function isInfraPending(infraPending) {
  if (infraPending === true) return true;
  if (typeof infraPending === "string") {
    const s = infraPending.trim().toUpperCase();
    return s === "INFRA_PENDING" || s === "PENDING" || s === "TRUE" || s === "1";
  }
  return false;
}

function scoreStrategies(pagesPublicBytes, uniqueProducts) {
  const bytes = num(pagesPublicBytes);
  const products = Math.trunc(num(uniqueProducts));
  const pagesMiB = Math.round((bytes / 1048576) * 100) / 100;

  const pagesShards = {
    id: STRATEGY.PAGES_SHARDS,
    fit:
      bytes < PAGES_COMFORT_BYTES
        ? "GOOD"
        : bytes < PAGES_HARD_BYTES
          ? "MARGINAL"
          : "POOR",
    pros: [
      "Same-origin static serve on Pages",
      "No R2/D1 binding required",
      "Lowest operational surface",
    ],
    cons: [
      "Shard count grows with catalog size",
      "Deploy payload + build time scale with bytes",
      "Weak random-access / query story",
    ],
    estimatedShardHint:
      bytes <= 0
        ? 1
        : Math.max(1, Math.ceil(bytes / PAGES_COMFORT_BYTES)),
  };

  const r2Managed = {
    id: STRATEGY.R2_MANAGED_PUBLIC,
    fit: bytes >= PAGES_COMFORT_BYTES ? "GOOD" : "OPTIONAL",
    pros: [
      "Object storage scales past Pages asset limits",
      "Atomic LKG / staging object patterns",
      "Workers can gate LIVE_ENABLED without git merges",
    ],
    cons: [
      "Requires CJ_MANAGED_PUBLIC R2 binding + publish token",
      "INFRA_PENDING until bucket/secrets/deploy are owner-ready",
      "Extra publish path to keep disarmed by default",
    ],
  };

  const hybrid = {
    id: STRATEGY.HYBRID,
    fit:
      bytes >= PAGES_COMFORT_BYTES && products >= 10000
        ? "GOOD"
        : bytes >= PAGES_HARD_BYTES
          ? "RECOMMENDED"
          : "OPTIONAL",
    pros: [
      "Pages keeps slim index / partner shell",
      "R2 holds bulky managed-public product payloads",
      "D1 optional for advertiser/product lookup indexes via Workers",
    ],
    cons: [
      "Two serve paths to keep consistent",
      "Still blocked on R2/D1/Workers infra readiness",
      "Must not activate until ownerMigrateApproved",
    ],
  };

  let recommended = STRATEGY.PAGES_SHARDS;
  if (bytes >= PAGES_HARD_BYTES) recommended = STRATEGY.HYBRID;
  else if (bytes >= PAGES_COMFORT_BYTES) recommended = STRATEGY.R2_MANAGED_PUBLIC;

  return {
    pagesPublicBytes: bytes,
    pagesPublicMiB: pagesMiB,
    uniqueProducts: products,
    thresholds: {
      pagesComfortBytes: PAGES_COMFORT_BYTES,
      pagesHardBytes: PAGES_HARD_BYTES,
    },
    strategies: [pagesShards, r2Managed, hybrid],
    recommendedStrategy: recommended,
  };
}

/**
 * Draft-only readiness comparison. Never activates migration.
 *
 * @param {object} input
 * @param {number} [input.pagesPublicBytes]
 * @param {number} [input.uniqueProducts]
 * @param {boolean|string} [input.infraPending]
 * @param {boolean} [input.ownerMigrateApproved]
 */
export function buildR2D1WorkersReadiness({
  pagesPublicBytes = 0,
  uniqueProducts = 0,
  infraPending = false,
  ownerMigrateApproved = false,
} = {}) {
  const pending = isInfraPending(infraPending);
  const approved = ownerMigrateApproved === true;
  const comparison = scoreStrategies(pagesPublicBytes, uniqueProducts);

  const migrationStatus = approved
    ? MIGRATION_STATUS.OWNER_APPROVED_NOT_ACTIVATED
    : MIGRATION_STATUS.DRAFT_ONLY;

  const blockers = [];
  if (pending) blockers.push("INFRA_PENDING");
  if (!approved) blockers.push("OWNER_MIGRATE_NOT_APPROVED");

  return {
    schema: R2_D1_WORKERS_READINESS_SCHEMA,
    at: new Date().toISOString(),
    migrationStatus,
    migrationActivated: false,
    infraPending: pending,
    ownerMigrateApproved: approved,
    comparison: {
      pagesShards: comparison.strategies.find((s) => s.id === STRATEGY.PAGES_SHARDS),
      r2ManagedPublic: comparison.strategies.find(
        (s) => s.id === STRATEGY.R2_MANAGED_PUBLIC,
      ),
      hybrid: comparison.strategies.find((s) => s.id === STRATEGY.HYBRID),
      pagesPublicBytes: comparison.pagesPublicBytes,
      pagesPublicMiB: comparison.pagesPublicMiB,
      uniqueProducts: comparison.uniqueProducts,
      thresholds: comparison.thresholds,
    },
    recommendedStrategy: comparison.recommendedStrategy,
    recommendationNote:
      "Draft recommendation only — do NOT activate R2/D1/Workers migration from this module.",
    blockers,
    nextOwnerSteps: [
      pending
        ? "Resolve INFRA_PENDING (R2 bucket binding, publish URL/token, worker deploy disarmed)"
        : "Confirm R2/D1/Workers bindings remain disarmed in wrangler",
      approved
        ? "Owner approved — still require separate explicit migrate arm (not this script)"
        : "Keep migrationStatus=DRAFT_ONLY until ownerMigrateApproved===true",
      "Re-run readiness after measured pagesPublicBytes / uniqueProducts update",
    ],
  };
}

/** Fixture selftest: INFRA_PENDING + ownerMigrateApproved false → DRAFT_ONLY. */
export function runR2D1WorkersReadinessSelftest() {
  const checks = [];
  function check(name, cond, detail) {
    checks.push({ name, ok: cond === true, detail: detail ?? null });
  }

  const r = buildR2D1WorkersReadiness({
    pagesPublicBytes: 28 * 1024 * 1024,
    uniqueProducts: 50000,
    infraPending: "INFRA_PENDING",
    ownerMigrateApproved: false,
  });

  check("migrationStatus_DRAFT_ONLY", r.migrationStatus === MIGRATION_STATUS.DRAFT_ONLY, r.migrationStatus);
  check("migrationActivated_false", r.migrationActivated === false, r.migrationActivated);
  check("infraPending_true", r.infraPending === true, r.infraPending);
  check("owner_not_approved", r.ownerMigrateApproved === false, r.ownerMigrateApproved);
  check(
    "blocker_INFRA_PENDING",
    r.blockers.includes("INFRA_PENDING"),
    r.blockers,
  );
  check(
    "blocker_OWNER_MIGRATE_NOT_APPROVED",
    r.blockers.includes("OWNER_MIGRATE_NOT_APPROVED"),
    r.blockers,
  );
  check(
    "has_pages_vs_r2_vs_hybrid",
    Boolean(r.comparison?.pagesShards && r.comparison?.r2ManagedPublic && r.comparison?.hybrid),
    Object.keys(r.comparison || {}),
  );
  check(
    "recommended_hybrid_or_r2_for_large",
    r.recommendedStrategy === STRATEGY.HYBRID ||
      r.recommendedStrategy === STRATEGY.R2_MANAGED_PUBLIC,
    r.recommendedStrategy,
  );

  const approved = buildR2D1WorkersReadiness({
    pagesPublicBytes: 1024,
    uniqueProducts: 10,
    infraPending: false,
    ownerMigrateApproved: true,
  });
  check(
    "approved_not_draft",
    approved.migrationStatus === MIGRATION_STATUS.OWNER_APPROVED_NOT_ACTIVATED,
    approved.migrationStatus,
  );
  check(
    "approved_still_not_activated",
    approved.migrationActivated === false,
    approved.migrationActivated,
  );

  const failed = checks.filter((c) => !c.ok);
  return {
    schema: R2_D1_WORKERS_READINESS_SCHEMA + "-selftest",
    ok: failed.length === 0,
    failed: failed.map((f) => f.name),
    checks,
    sample: {
      migrationStatus: r.migrationStatus,
      infraPending: r.infraPending,
      recommendedStrategy: r.recommendedStrategy,
      blockers: r.blockers,
    },
  };
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  const self = fileURLToPath(import.meta.url);
  return path.resolve(arg) === path.resolve(self);
}

if (isDirectRun()) {
  const result = runR2D1WorkersReadinessSelftest();
  console.log(
    JSON.stringify(
      {
        IU_CJ_R2_D1_WORKERS_READINESS_SELFTEST: result.ok ? "PASS" : "FAIL",
        ...result,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exit(1);
}
