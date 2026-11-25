#!/usr/bin/env node
/**
 * V51.8 — product inventory balance (pure aggregate, no IO).
 *
 * Builds mutually exclusive primaryState buckets from aggregate master-task
 * counters so catalog math is never double-counted.
 *
 * primaryState assignment priority (first match wins; lower ranks never re-count):
 *   1. published
 *   2. invalid
 *   3. technical_failure
 *   4. hold
 *   5. retry
 *   6. lkg
 *   7. blocked_growth_only
 *   8. eligible_new
 *   9. refreshed          (operational overlay; count kept informational / 0 exclusive)
 *  10. unavailable        (residual placeholder when explicitly supplied later)
 *  11. duplicate
 *  12. identity_collision
 *  13. unsuitable_cz_market
 *  14. missing_business_data
 *  15. ended_partnership
 *  16. external_cj_restriction
 *
 * CLI selftest: node scripts/iu-cj-affiliate-phase3z-product-inventory-balance-v51-8.mjs
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

export const PRODUCT_INVENTORY_BALANCE_SCHEMA =
  "iu-cj-affiliate-phase3z-product-inventory-balance-v51-8";

/** Master-task primaryState classes (aggregate inventory). */
export const PRIMARY_STATE = Object.freeze({
  PUBLISHED: "published",
  ELIGIBLE_NEW: "eligible_new",
  BLOCKED_GROWTH_ONLY: "blocked_growth_only",
  HOLD: "hold",
  LKG: "lkg",
  INVALID: "invalid",
  RETRY: "retry",
  TECHNICAL_FAILURE: "technical_failure",
  REFRESHED: "refreshed",
  UNAVAILABLE: "unavailable",
  DUPLICATE: "duplicate",
  IDENTITY_COLLISION: "identity_collision",
  UNSUITABLE_CZ_MARKET: "unsuitable_cz_market",
  MISSING_BUSINESS_DATA: "missing_business_data",
  ENDED_PARTNERSHIP: "ended_partnership",
  EXTERNAL_CJ_RESTRICTION: "external_cj_restriction",
});

/**
 * Exclusive assignment order — document + enforce.
 * Aggregate inputs are treated as already-classed exclusive counts; this order
 * is the contract for per-identity classifiers that feed this balancer.
 */
export const PRIMARY_STATE_PRIORITY = Object.freeze([
  PRIMARY_STATE.PUBLISHED,
  PRIMARY_STATE.INVALID,
  PRIMARY_STATE.TECHNICAL_FAILURE,
  PRIMARY_STATE.HOLD,
  PRIMARY_STATE.RETRY,
  PRIMARY_STATE.LKG,
  PRIMARY_STATE.BLOCKED_GROWTH_ONLY,
  PRIMARY_STATE.ELIGIBLE_NEW,
  PRIMARY_STATE.REFRESHED,
  PRIMARY_STATE.UNAVAILABLE,
  PRIMARY_STATE.DUPLICATE,
  PRIMARY_STATE.IDENTITY_COLLISION,
  PRIMARY_STATE.UNSUITABLE_CZ_MARKET,
  PRIMARY_STATE.MISSING_BUSINESS_DATA,
  PRIMARY_STATE.ENDED_PARTNERSHIP,
  PRIMARY_STATE.EXTERNAL_CJ_RESTRICTION,
]);

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v, fallback = false) {
  if (typeof v === "boolean") return v;
  if (v == null || v === "") return fallback;
  if (v === 1 || v === "1" || v === "true") return true;
  if (v === 0 || v === "0" || v === "false") return false;
  return fallback;
}

function group(primaryState, count, note) {
  return {
    primaryState,
    count: Math.max(0, Math.trunc(num(count, 0))),
    note: note || null,
  };
}

/**
 * Pure product inventory balance from aggregate counters.
 *
 * @param {object} input
 * @param {number} input.uniquePublished
 * @param {number} input.uniquePublicEligible
 * @param {number} input.deferredNew
 * @param {number} input.holdCount
 * @param {number} input.lkgCarried
 * @param {number} input.invalidData
 * @param {number} input.retryScheduled
 * @param {number} input.refreshed
 * @param {number} input.technicalFailure
 * @param {number} input.newCandidates
 * @param {number} input.growthRemaining
 * @param {boolean} input.uncappedMode
 */
export function buildProductInventoryBalance({
  uniquePublished,
  uniquePublicEligible,
  deferredNew,
  holdCount,
  lkgCarried,
  invalidData,
  retryScheduled,
  refreshed,
  technicalFailure,
  newCandidates,
  growthRemaining,
  uncappedMode,
} = {}) {
  const published = Math.max(0, Math.trunc(num(uniquePublished, 0)));
  const publicEligible = Math.max(0, Math.trunc(num(uniquePublicEligible, published)));
  const deferred = Math.max(0, Math.trunc(num(deferredNew, 0)));
  const hold = Math.max(0, Math.trunc(num(holdCount, 0)));
  const lkg = Math.max(0, Math.trunc(num(lkgCarried, 0)));
  const invalid = Math.max(0, Math.trunc(num(invalidData, 0)));
  const retry = Math.max(0, Math.trunc(num(retryScheduled, 0)));
  const refreshedN = Math.max(0, Math.trunc(num(refreshed, 0)));
  const techFail = Math.max(0, Math.trunc(num(technicalFailure, 0)));
  const candidates = Math.max(0, Math.trunc(num(newCandidates, 0)));
  const growthLeft = Math.max(0, Math.trunc(num(growthRemaining, 0)));
  const uncapped = bool(uncappedMode, false);

  // eligible_new: fully eligible & not growth-blocked.
  // Prefer newCandidates − deferredNew; else residual publicEligible − published − deferred.
  let eligibleNew;
  if (candidates > 0 || deferred > 0) {
    eligibleNew = Math.max(0, candidates - deferred);
  } else {
    eligibleNew = Math.max(0, publicEligible - published - deferred);
  }

  // refreshed is cross-cutting (ops overlay). Exclusive primary count stays 0 so
  // it never double-counts identities already in published/hold/lkg/….
  const refreshedExclusive = 0;

  const groups = [
    group(
      PRIMARY_STATE.PUBLISHED,
      published,
      "Already in public catalog (uniquePublished).",
    ),
    group(
      PRIMARY_STATE.INVALID,
      invalid,
      "Invalid / corrupt product data — not publishable until repaired.",
    ),
    group(
      PRIMARY_STATE.TECHNICAL_FAILURE,
      techFail,
      "Technical failure blocking publication (fetch/parse/promote).",
    ),
    group(
      PRIMARY_STATE.HOLD,
      hold,
      "Publication hold (fail-closed / protective).",
    ),
    group(
      PRIMARY_STATE.RETRY,
      retry,
      "Retry scheduled — awaiting further verification.",
    ),
    group(
      PRIMARY_STATE.LKG,
      lkg,
      "LKG carried retain — exclusive of published when classifier uses priority.",
    ),
    group(
      PRIMARY_STATE.BLOCKED_GROWTH_ONLY,
      deferred,
      "Fully eligible but blocked exclusively by growth budget (deferredNew).",
    ),
    group(
      PRIMARY_STATE.ELIGIBLE_NEW,
      eligibleNew,
      "New & fully eligible within growth budget (not deferred).",
    ),
    group(
      PRIMARY_STATE.REFRESHED,
      refreshedExclusive,
      "Operational overlay only (refreshed=" +
        refreshedN +
        "); not an exclusive inventory primaryState — never double-counted.",
    ),
    // Master-task residual classes (aggregate placeholders; 0 unless wired later)
    group(PRIMARY_STATE.UNAVAILABLE, 0, "Unavailable products (placeholder)."),
    group(PRIMARY_STATE.DUPLICATE, 0, "Duplicate identities (placeholder)."),
    group(
      PRIMARY_STATE.IDENTITY_COLLISION,
      0,
      "Identity collision (placeholder).",
    ),
    group(
      PRIMARY_STATE.UNSUITABLE_CZ_MARKET,
      0,
      "Unsuitable for Czech market (placeholder).",
    ),
    group(
      PRIMARY_STATE.MISSING_BUSINESS_DATA,
      0,
      "Missing business fields (placeholder).",
    ),
    group(
      PRIMARY_STATE.ENDED_PARTNERSHIP,
      0,
      "Ended partnership (placeholder).",
    ),
    group(
      PRIMARY_STATE.EXTERNAL_CJ_RESTRICTION,
      0,
      "External CJ restriction (placeholder).",
    ),
  ];

  const exclusiveSum = groups.reduce((s, g) => s + g.count, 0);
  const publishedPlusDeferredApprox = published + deferred;

  const notes = [
    "primaryState priority (no double-count): " + PRIMARY_STATE_PRIORITY.join(" > "),
    "Aggregate inputs are treated as exclusive primary counts; per-identity classifiers MUST assign exactly one primaryState using PRIMARY_STATE_PRIORITY.",
    "refreshed is informational overlay (exclusive count forced to 0).",
    "publishedPlusDeferredApprox = uniquePublished + deferredNew (catalog scale approx, not a unique-identity proof).",
    "uniquePublicEligible=" +
      publicEligible +
      " is a denominator check, not a separate exclusive bucket.",
  ];

  if (publicEligible > 0 && publicEligible < published) {
    notes.push(
      "WARN: uniquePublicEligible < uniquePublished — denominator inconsistency.",
    );
  }

  const passSafe =
    uncapped === false &&
    Number.isFinite(growthLeft) &&
    growthLeft >= 0;

  return {
    schema: PRODUCT_INVENTORY_BALANCE_SCHEMA,
    primaryStatePriority: [...PRIMARY_STATE_PRIORITY],
    noDoubleCountContract:
      "Each product identity maps to exactly one primaryState via PRIMARY_STATE_PRIORITY; secondary flags allowed; never sum overlapping flags as unique products.",
    inputs: {
      uniquePublished: published,
      uniquePublicEligible: publicEligible,
      deferredNew: deferred,
      holdCount: hold,
      lkgCarried: lkg,
      invalidData: invalid,
      retryScheduled: retry,
      refreshed: refreshedN,
      technicalFailure: techFail,
      newCandidates: candidates,
      growthRemaining: growthLeft,
      uncappedMode: uncapped,
    },
    groups,
    countsByPrimaryState: Object.fromEntries(
      groups.map((g) => [g.primaryState, g.count]),
    ),
    exclusiveSum,
    mathBalance: {
      publishedPlusDeferredApprox,
      uniquePublicEligible: publicEligible,
      exclusiveSum,
      notes,
    },
    gates: {
      uncappedMode: uncapped,
      uncappedModeMustBeFalseForPassSafe: true,
      growthRemaining: growthLeft,
      PASS_SAFE: passSafe,
      passSafeReason: passSafe
        ? "uncappedMode===false and growthRemaining is a finite non-negative number"
        : uncapped
          ? "FAIL: uncappedMode===true — not PASS_SAFE"
          : "FAIL: growthRemaining invalid",
    },
  };
}

/** Closure synthetic fixture: 2624 published, 297325 deferred, 1014 hold. */
export function runProductInventoryBalanceSelftest() {
  const r = buildProductInventoryBalance({
    uniquePublished: 2624,
    uniquePublicEligible: 2624,
    deferredNew: 297325,
    holdCount: 1014,
    lkgCarried: 209,
    invalidData: 0,
    retryScheduled: 0,
    refreshed: 100,
    technicalFailure: 0,
    newCandidates: 297325,
    growthRemaining: 0,
    uncappedMode: false,
  });

  const checks = [];
  function check(name, ok, detail) {
    checks.push({ name, ok: ok === true, detail: detail ?? null });
  }

  check("published_2624", r.countsByPrimaryState.published === 2624, r.countsByPrimaryState.published);
  check(
    "blocked_growth_297325",
    r.countsByPrimaryState.blocked_growth_only === 297325,
    r.countsByPrimaryState.blocked_growth_only,
  );
  check("hold_1014", r.countsByPrimaryState.hold === 1014, r.countsByPrimaryState.hold);
  check("lkg_209", r.countsByPrimaryState.lkg === 209, r.countsByPrimaryState.lkg);
  check(
    "eligible_new_0_when_all_deferred",
    r.countsByPrimaryState.eligible_new === 0,
    r.countsByPrimaryState.eligible_new,
  );
  check(
    "refreshed_exclusive_0",
    r.countsByPrimaryState.refreshed === 0,
    r.countsByPrimaryState.refreshed,
  );
  check(
    "math_published_plus_deferred",
    r.mathBalance.publishedPlusDeferredApprox === 2624 + 297325,
    r.mathBalance.publishedPlusDeferredApprox,
  );
  check("pass_safe_true", r.gates.PASS_SAFE === true, r.gates);
  check("uncapped_false", r.gates.uncappedMode === false, r.gates.uncappedMode);
  check("growth_remaining_0", r.gates.growthRemaining === 0, r.gates.growthRemaining);
  check(
    "priority_starts_published",
    r.primaryStatePriority[0] === PRIMARY_STATE.PUBLISHED,
    r.primaryStatePriority[0],
  );
  check(
    "priority_includes_blocked_growth",
    r.primaryStatePriority.includes(PRIMARY_STATE.BLOCKED_GROWTH_ONLY),
    r.primaryStatePriority,
  );
  check(
    "groups_cover_master_classes",
    [
      "published",
      "eligible_new",
      "blocked_growth_only",
      "hold",
      "lkg",
      "invalid",
      "retry",
    ].every((k) => r.countsByPrimaryState[k] != null),
    Object.keys(r.countsByPrimaryState),
  );

  // Uncapped must fail PASS_SAFE
  const unsafe = buildProductInventoryBalance({
    uniquePublished: 10,
    uniquePublicEligible: 10,
    deferredNew: 5,
    holdCount: 0,
    lkgCarried: 0,
    invalidData: 0,
    retryScheduled: 0,
    refreshed: 0,
    technicalFailure: 0,
    newCandidates: 8,
    growthRemaining: 3,
    uncappedMode: true,
  });
  check("uncapped_fails_pass_safe", unsafe.gates.PASS_SAFE === false, unsafe.gates);
  check(
    "eligible_from_candidates",
    unsafe.countsByPrimaryState.eligible_new === 3,
    unsafe.countsByPrimaryState.eligible_new,
  );

  const failed = checks.filter((c) => !c.ok);
  return {
    schema: PRODUCT_INVENTORY_BALANCE_SCHEMA + "-selftest",
    ok: failed.length === 0,
    failed: failed.map((f) => f.name),
    checks,
    closure: {
      uniquePublished: 2624,
      deferredNew: 297325,
      holdCount: 1014,
      publishedPlusDeferredApprox: r.mathBalance.publishedPlusDeferredApprox,
      PASS_SAFE: r.gates.PASS_SAFE,
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
  const result = runProductInventoryBalanceSelftest();
  console.log(
    JSON.stringify(
      {
        IU_CJ_PRODUCT_INVENTORY_BALANCE_SELFTEST: result.ok ? "PASS" : "FAIL",
        ...result,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exit(1);
}
