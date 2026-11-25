#!/usr/bin/env node
/**
 * V51.8 — hold-delta reconcile (pure, no IO).
 *
 * Compares prior vs current hold key sets + aggregate hold counts and emits
 * added/removed/unchanged counts, samples, and classification hints:
 *   FAIL_CLOSED_EXPANSION — hold set grew (protective / fail-closed widening)
 *   DATA_LOSS             — hold keys vanished without a matching refresh recovery signal
 *   EXTERNAL              — residual / mixed / outside-catalog movement
 *
 * CLI selftest: node scripts/iu-cj-affiliate-phase3z-hold-delta-reconcile-v51-8.mjs
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

export const HOLD_DELTA_RECONCILE_SCHEMA =
  "iu-cj-affiliate-phase3z-hold-delta-reconcile-v51-8";

export const HOLD_DELTA_CLASS = Object.freeze({
  FAIL_CLOSED_EXPANSION: "FAIL_CLOSED_EXPANSION",
  DATA_LOSS: "DATA_LOSS",
  EXTERNAL: "EXTERNAL",
});

const SAMPLE_LIMIT = 12;

/** Protective / fail-closed refreshResult tokens that justify hold expansion. */
const FAIL_CLOSED_REFRESH = new Set([
  "PUBLICATION_HOLD",
  "SOURCE_STALE",
  "NOT_YET_SEEN",
  "NOT_YET_SEEN_MAX_AGE",
  "GRADUAL_HOLD",
  "INCOMPLETE",
  "VALIDATION_INCOMPLETE",
  "ERROR",
  "NOT_ATTEMPTED",
  "NOT_IN_SCAN_WINDOW",
  "PROTECTIVE_HOLD",
  "FAIL_CLOSED",
]);

const RECOVERY_REFRESH = new Set([
  "SUCCESSFULLY_REFRESHED",
  "OK",
  "CURRENT",
]);

function toKeySet(keys) {
  const out = new Set();
  if (keys == null) return out;
  const list = Array.isArray(keys)
    ? keys
    : keys instanceof Set
      ? [...keys]
      : typeof keys === "object"
        ? Object.keys(keys)
        : [];
  for (const k of list) {
    const s = String(k ?? "").trim();
    if (s) out.add(s);
  }
  return out;
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sumMap(m) {
  if (!m || typeof m !== "object") return 0;
  let s = 0;
  for (const v of Object.values(m)) s += num(v);
  return s;
}

function countMatching(map, allow) {
  if (!map || typeof map !== "object") return 0;
  let s = 0;
  for (const [k, v] of Object.entries(map)) {
    if (allow.has(String(k))) s += num(v);
  }
  return s;
}

function sampleFrom(iterable, limit = SAMPLE_LIMIT) {
  const out = [];
  for (const item of iterable) {
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Pure hold-delta reconcile.
 *
 * @param {object} input
 * @param {number} input.priorHold
 * @param {number} input.currentHold
 * @param {Iterable|string[]|Set|object} input.priorKeys
 * @param {Iterable|string[]|Set|object} input.currentKeys
 * @param {Record<string,number>} [input.byRefreshResultPrior]
 * @param {Record<string,number>} [input.byRefreshResultCurrent]
 */
export function reconcileHoldDelta({
  priorHold,
  currentHold,
  priorKeys,
  currentKeys,
  byRefreshResultPrior = {},
  byRefreshResultCurrent = {},
} = {}) {
  const prior = toKeySet(priorKeys);
  const current = toKeySet(currentKeys);
  const priorHoldN = num(priorHold, prior.size);
  const currentHoldN = num(currentHold, current.size);

  const added = [];
  const removed = [];
  const unchanged = [];

  for (const k of current) {
    if (prior.has(k)) unchanged.push(k);
    else added.push(k);
  }
  for (const k of prior) {
    if (!current.has(k)) removed.push(k);
  }

  const holdDelta = currentHoldN - priorHoldN;
  const keyDelta = current.size - prior.size;
  const priorFc = countMatching(byRefreshResultPrior, FAIL_CLOSED_REFRESH);
  const currentFc = countMatching(byRefreshResultCurrent, FAIL_CLOSED_REFRESH);
  const priorRec = countMatching(byRefreshResultPrior, RECOVERY_REFRESH);
  const currentRec = countMatching(byRefreshResultCurrent, RECOVERY_REFRESH);
  const fcDelta = currentFc - priorFc;
  const recoveryDelta = currentRec - priorRec;

  /** Primary classification hint (ordered). */
  let classification = HOLD_DELTA_CLASS.EXTERNAL;
  const hints = [];

  const expansion =
    holdDelta > 0 &&
    added.length > 0 &&
    (added.length >= removed.length || holdDelta >= Math.max(1, Math.floor(priorHoldN * 0.05)));

  const protectiveSignal = fcDelta > 0 || currentFc > 0 || added.length > removed.length * 2;

  if (expansion && protectiveSignal) {
    classification = HOLD_DELTA_CLASS.FAIL_CLOSED_EXPANSION;
    hints.push({
      code: HOLD_DELTA_CLASS.FAIL_CLOSED_EXPANSION,
      reason:
        "Hold count/key set grew with protective refreshResult pressure — treat as fail-closed widening, not restore target.",
      holdDelta,
      added: added.length,
      failClosedRefreshDelta: fcDelta,
    });
  }

  const unexplainedRemoval =
    removed.length > 0 &&
    recoveryDelta <= 0 &&
    (holdDelta < 0 || removed.length > added.length);

  if (unexplainedRemoval) {
    hints.push({
      code: HOLD_DELTA_CLASS.DATA_LOSS,
      reason:
        "Hold keys removed without a matching SUCCESSFULLY_REFRESHED recovery lift — possible identity/data loss.",
      removed: removed.length,
      recoveryDelta,
      holdDelta,
    });
    if (classification === HOLD_DELTA_CLASS.EXTERNAL || holdDelta < 0) {
      classification = HOLD_DELTA_CLASS.DATA_LOSS;
    }
  }

  if (hints.length === 0) {
    classification = HOLD_DELTA_CLASS.EXTERNAL;
    hints.push({
      code: HOLD_DELTA_CLASS.EXTERNAL,
      reason:
        "Hold movement not explained as fail-closed expansion or unexplained key loss — classify as external/catalog churn.",
      holdDelta,
      keyDelta,
    });
  } else if (
    classification !== HOLD_DELTA_CLASS.FAIL_CLOSED_EXPANSION &&
    classification !== HOLD_DELTA_CLASS.DATA_LOSS
  ) {
    classification = HOLD_DELTA_CLASS.EXTERNAL;
  }

  return {
    schema: HOLD_DELTA_RECONCILE_SCHEMA,
    priorHold: priorHoldN,
    currentHold: currentHoldN,
    holdDelta,
    keyCounts: {
      prior: prior.size,
      current: current.size,
      keyDelta,
    },
    counts: {
      added: added.length,
      removed: removed.length,
      unchanged: unchanged.length,
    },
    samples: {
      added: sampleFrom(added),
      removed: sampleFrom(removed),
      unchanged: sampleFrom(unchanged),
    },
    byRefreshResult: {
      prior: { ...(byRefreshResultPrior || {}) },
      current: { ...(byRefreshResultCurrent || {}) },
      priorSum: sumMap(byRefreshResultPrior),
      currentSum: sumMap(byRefreshResultCurrent),
      failClosedDelta: fcDelta,
      recoveryDelta,
    },
    classification,
    classificationHints: hints,
    note:
      "FAIL_CLOSED_EXPANSION must not be cosmetically restored. DATA_LOSS needs identity+cause evidence. EXTERNAL is residual churn.",
  };
}

/** Synthetic 529 → 1014 fail-closed expansion fixture + assertions. */
export function runHoldDeltaReconcileSelftest() {
  const priorHold = 529;
  const currentHold = 1014;
  const priorKeys = [];
  for (let i = 0; i < priorHold; i++) priorKeys.push("adv|p" + i);
  const currentKeys = [...priorKeys];
  for (let i = priorHold; i < currentHold; i++) currentKeys.push("adv|p" + i);

  const byRefreshResultPrior = {
    SUCCESSFULLY_REFRESHED: 400,
    NOT_IN_SCAN_WINDOW: 80,
    PUBLICATION_HOLD: 49,
  };
  const byRefreshResultCurrent = {
    SUCCESSFULLY_REFRESHED: 380,
    NOT_IN_SCAN_WINDOW: 120,
    PUBLICATION_HOLD: 414,
    SOURCE_STALE: 100,
  };

  const r = reconcileHoldDelta({
    priorHold,
    currentHold,
    priorKeys,
    currentKeys,
    byRefreshResultPrior,
    byRefreshResultCurrent,
  });

  const checks = [];
  function check(name, ok, detail) {
    checks.push({ name, ok: ok === true, detail: detail ?? null });
  }

  check("hold_counts", r.priorHold === 529 && r.currentHold === 1014, {
    priorHold: r.priorHold,
    currentHold: r.currentHold,
  });
  check("hold_delta", r.holdDelta === 485, r.holdDelta);
  check("added_count", r.counts.added === 485, r.counts.added);
  check("removed_count", r.counts.removed === 0, r.counts.removed);
  check("unchanged_count", r.counts.unchanged === 529, r.counts.unchanged);
  check(
    "classification_fail_closed_expansion",
    r.classification === HOLD_DELTA_CLASS.FAIL_CLOSED_EXPANSION,
    r.classification,
  );
  check(
    "hint_includes_fail_closed",
    r.classificationHints.some((h) => h.code === HOLD_DELTA_CLASS.FAIL_CLOSED_EXPANSION),
    r.classificationHints.map((h) => h.code),
  );
  check("sample_added_nonempty", r.samples.added.length > 0, r.samples.added.length);
  check("sample_capped", r.samples.added.length <= SAMPLE_LIMIT, r.samples.added.length);

  // Secondary: DATA_LOSS path
  const loss = reconcileHoldDelta({
    priorHold: 100,
    currentHold: 40,
    priorKeys: Array.from({ length: 100 }, (_, i) => "x|" + i),
    currentKeys: Array.from({ length: 40 }, (_, i) => "x|" + i),
    byRefreshResultPrior: { PUBLICATION_HOLD: 100 },
    byRefreshResultCurrent: { PUBLICATION_HOLD: 40, SUCCESSFULLY_REFRESHED: 0 },
  });
  check("data_loss_class", loss.classification === HOLD_DELTA_CLASS.DATA_LOSS, loss.classification);
  check("data_loss_removed", loss.counts.removed === 60, loss.counts.removed);

  // Tertiary: EXTERNAL churn (balanced add/remove, no protective expansion)
  const ext = reconcileHoldDelta({
    priorHold: 50,
    currentHold: 50,
    priorKeys: Array.from({ length: 50 }, (_, i) => "a|" + i),
    currentKeys: Array.from({ length: 50 }, (_, i) => "a|" + (i + 10)),
    byRefreshResultPrior: { SUCCESSFULLY_REFRESHED: 50 },
    byRefreshResultCurrent: { SUCCESSFULLY_REFRESHED: 50 },
  });
  check(
    "external_or_loss_when_balanced_churn",
    ext.classification === HOLD_DELTA_CLASS.EXTERNAL ||
      ext.classification === HOLD_DELTA_CLASS.DATA_LOSS,
    ext.classification,
  );

  const failed = checks.filter((c) => !c.ok);
  return {
    schema: HOLD_DELTA_RECONCILE_SCHEMA + "-selftest",
    ok: failed.length === 0,
    failed: failed.map((f) => f.name),
    checks,
    expansion: {
      priorHold,
      currentHold,
      holdDelta: r.holdDelta,
      classification: r.classification,
      counts: r.counts,
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
  const result = runHoldDeltaReconcileSelftest();
  console.log(
    JSON.stringify(
      {
        IU_CJ_HOLD_DELTA_RECONCILE_SELFTEST: result.ok ? "PASS" : "FAIL",
        ...result,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exit(1);
}
