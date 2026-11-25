#!/usr/bin/env node
/**
 * V51.8 — autonomous recovery scenario planner (pure, DISARMED).
 *
 * Decides recovery actions for catalog/sync failures. NEVER rewrites source,
 * NEVER bypasses owner gates, NEVER suggests OWNER_GATE_BYPASS.
 *
 * CLI selftest: node scripts/iu-cj-affiliate-phase3z-autonomous-recovery-scenarios-v51-8.mjs
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

export const AUTONOMOUS_RECOVERY_SCHEMA =
  "iu-cj-affiliate-phase3z-autonomous-recovery-scenarios-v51-8";

export const ERROR_KIND = Object.freeze({
  CJ_API_DOWN: "CJ_API_DOWN",
  TIMEOUT: "TIMEOUT",
  RATE_LIMIT: "RATE_LIMIT",
  INCOMPLETE_RESPONSE: "INCOMPLETE_RESPONSE",
  INVALID_DATA: "INVALID_DATA",
  CHECKPOINT_CORRUPT: "CHECKPOINT_CORRUPT",
  PUBLISH_FAIL: "PUBLISH_FAIL",
  READBACK_MISMATCH: "READBACK_MISMATCH",
  SHARD_CORRUPT: "SHARD_CORRUPT",
});

export const RECOVERY_ACTION = Object.freeze({
  RETRY_BACKOFF: "RETRY_BACKOFF",
  KEEP_LKG: "KEEP_LKG",
  PAUSE_PUBLISH: "PAUSE_PUBLISH",
  ROLLBACK_IF_SUPPORTED: "ROLLBACK_IF_SUPPORTED",
  RECORD_INCIDENT: "RECORD_INCIDENT",
  CONTINUE: "CONTINUE",
});

/** Hard-banned outcomes — recovery must never emit these. */
export const FORBIDDEN_ACTIONS = Object.freeze([
  "OWNER_GATE_BYPASS",
  "REWRITE_SOURCE",
  "BYPASS_OWNER_GATE",
  "FORCE_UNCAPPED",
  "ARM_EMAIL_WITHOUT_OWNER",
]);

const TRANSIENT = new Set([
  ERROR_KIND.CJ_API_DOWN,
  ERROR_KIND.TIMEOUT,
  ERROR_KIND.RATE_LIMIT,
]);

const DATA_INTEGRITY = new Set([
  ERROR_KIND.INCOMPLETE_RESPONSE,
  ERROR_KIND.INVALID_DATA,
]);

const CORRUPTION = new Set([
  ERROR_KIND.CHECKPOINT_CORRUPT,
  ERROR_KIND.SHARD_CORRUPT,
]);

const PUBLISH_PATH = new Set([
  ERROR_KIND.PUBLISH_FAIL,
  ERROR_KIND.READBACK_MISMATCH,
]);

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v, fallback = false) {
  if (v === true || v === false) return v;
  return fallback;
}

/**
 * Decide recovery action for a catalog/sync error.
 * Never rewrites source; never bypasses owner gates.
 *
 * @param {object} input
 * @param {string} input.errorKind
 * @param {number} [input.consecutiveFailures]
 * @param {boolean} [input.lkgPresent]
 * @param {boolean} [input.publishInProgress]
 */
export function decideRecoveryAction({
  errorKind,
  consecutiveFailures,
  lkgPresent,
  publishInProgress,
} = {}) {
  const kind = String(errorKind || "").trim().toUpperCase();
  const failures = Math.max(0, Math.trunc(num(consecutiveFailures, 0)));
  const lkg = bool(lkgPresent, false);
  const publishing = bool(publishInProgress, false);

  const base = {
    schema: AUTONOMOUS_RECOVERY_SCHEMA,
    errorKind: kind,
    consecutiveFailures: failures,
    lkgPresent: lkg,
    publishInProgress: publishing,
    ownerGateBypass: false,
    rewriteSource: false,
    forbidden: [...FORBIDDEN_ACTIONS],
    notes: [],
  };

  const known = Object.values(ERROR_KIND).includes(kind);
  if (!known) {
    return {
      ...base,
      action: RECOVERY_ACTION.RECORD_INCIDENT,
      secondary: [],
      reason: "UNKNOWN_ERROR_KIND",
      notes: ["Unknown errorKind — record incident; do not mutate publish path."],
    };
  }

  // Publish-path failures: pause first; keep LKG; never force-forward.
  if (PUBLISH_PATH.has(kind)) {
    const secondary = [RECOVERY_ACTION.RECORD_INCIDENT];
    if (lkg) secondary.push(RECOVERY_ACTION.KEEP_LKG);
    if (kind === ERROR_KIND.READBACK_MISMATCH && lkg) {
      secondary.push(RECOVERY_ACTION.ROLLBACK_IF_SUPPORTED);
    }
    return {
      ...base,
      action: publishing
        ? RECOVERY_ACTION.PAUSE_PUBLISH
        : lkg
          ? RECOVERY_ACTION.KEEP_LKG
          : RECOVERY_ACTION.RECORD_INCIDENT,
      secondary,
      reason: publishing ? "PUBLISH_IN_PROGRESS_PAUSE" : "PUBLISH_PATH_SAFE",
      notes: [
        "Never rewrite source on publish failure.",
        "Never bypass owner gates to force publish.",
      ],
    };
  }

  // Corruption: incident + LKG / optional rollback; never continue publish.
  if (CORRUPTION.has(kind)) {
    const action = lkg
      ? RECOVERY_ACTION.KEEP_LKG
      : RECOVERY_ACTION.RECORD_INCIDENT;
    const secondary = [];
    if (publishing) secondary.push(RECOVERY_ACTION.PAUSE_PUBLISH);
    if (action !== RECOVERY_ACTION.RECORD_INCIDENT) {
      secondary.push(RECOVERY_ACTION.RECORD_INCIDENT);
    }
    if (lkg) secondary.push(RECOVERY_ACTION.ROLLBACK_IF_SUPPORTED);
    return {
      ...base,
      action,
      secondary,
      reason: "CORRUPTION_FAIL_CLOSED",
      notes: [
        "Checkpoint/shard corrupt — fail closed.",
        "No source rewrite; no owner-gate bypass.",
      ],
    };
  }

  // Bad/incomplete data: keep LKG, do not publish incomplete sets.
  if (DATA_INTEGRITY.has(kind)) {
    const secondary = [RECOVERY_ACTION.RECORD_INCIDENT];
    if (publishing) secondary.unshift(RECOVERY_ACTION.PAUSE_PUBLISH);
    return {
      ...base,
      action: lkg ? RECOVERY_ACTION.KEEP_LKG : RECOVERY_ACTION.PAUSE_PUBLISH,
      secondary,
      reason: "DATA_INTEGRITY_KEEP_LKG",
      notes: ["Incomplete/invalid data must not replace LKG."],
    };
  }

  // Transient API issues: backoff, then keep LKG after repeated failures.
  if (TRANSIENT.has(kind)) {
    if (failures >= 3) {
      const secondary = [RECOVERY_ACTION.RECORD_INCIDENT, RECOVERY_ACTION.RETRY_BACKOFF];
      if (publishing) secondary.unshift(RECOVERY_ACTION.PAUSE_PUBLISH);
      return {
        ...base,
        action: lkg ? RECOVERY_ACTION.KEEP_LKG : RECOVERY_ACTION.PAUSE_PUBLISH,
        secondary,
        reason: "TRANSIENT_EXHAUSTED_KEEP_LKG",
        notes: ["Consecutive transient failures ≥3 — keep LKG / pause."],
      };
    }
    return {
      ...base,
      action: RECOVERY_ACTION.RETRY_BACKOFF,
      secondary: publishing ? [RECOVERY_ACTION.PAUSE_PUBLISH] : [],
      reason: "TRANSIENT_RETRY",
      notes: ["Transient CJ/API issue — exponential backoff retry only."],
    };
  }

  // Fallback (should be unreachable for known kinds)
  return {
    ...base,
    action: RECOVERY_ACTION.RECORD_INCIDENT,
    secondary: [],
    reason: "FALLBACK_INCIDENT",
    notes: ["Fallback — record only."],
  };
}

/** Selftest: several error kinds + assert never OWNER_GATE_BYPASS. */
export function runAutonomousRecoverySelftest() {
  const checks = [];
  function check(name, ok, detail) {
    checks.push({ name, ok: ok === true, detail: detail ?? null });
  }

  const cases = [
    {
      name: "rate_limit_retry",
      input: {
        errorKind: ERROR_KIND.RATE_LIMIT,
        consecutiveFailures: 1,
        lkgPresent: true,
        publishInProgress: false,
      },
      expectAction: RECOVERY_ACTION.RETRY_BACKOFF,
    },
    {
      name: "timeout_retry",
      input: {
        errorKind: ERROR_KIND.TIMEOUT,
        consecutiveFailures: 0,
        lkgPresent: true,
        publishInProgress: false,
      },
      expectAction: RECOVERY_ACTION.RETRY_BACKOFF,
    },
    {
      name: "cj_api_down_exhausted_keep_lkg",
      input: {
        errorKind: ERROR_KIND.CJ_API_DOWN,
        consecutiveFailures: 3,
        lkgPresent: true,
        publishInProgress: false,
      },
      expectAction: RECOVERY_ACTION.KEEP_LKG,
    },
    {
      name: "incomplete_keep_lkg",
      input: {
        errorKind: ERROR_KIND.INCOMPLETE_RESPONSE,
        consecutiveFailures: 1,
        lkgPresent: true,
        publishInProgress: false,
      },
      expectAction: RECOVERY_ACTION.KEEP_LKG,
    },
    {
      name: "invalid_data_keep_lkg",
      input: {
        errorKind: ERROR_KIND.INVALID_DATA,
        consecutiveFailures: 0,
        lkgPresent: true,
        publishInProgress: true,
      },
      expectAction: RECOVERY_ACTION.KEEP_LKG,
    },
    {
      name: "checkpoint_corrupt_keep_lkg",
      input: {
        errorKind: ERROR_KIND.CHECKPOINT_CORRUPT,
        consecutiveFailures: 1,
        lkgPresent: true,
        publishInProgress: false,
      },
      expectAction: RECOVERY_ACTION.KEEP_LKG,
    },
    {
      name: "shard_corrupt_incident_no_lkg",
      input: {
        errorKind: ERROR_KIND.SHARD_CORRUPT,
        consecutiveFailures: 1,
        lkgPresent: false,
        publishInProgress: false,
      },
      expectAction: RECOVERY_ACTION.RECORD_INCIDENT,
    },
    {
      name: "publish_fail_pause",
      input: {
        errorKind: ERROR_KIND.PUBLISH_FAIL,
        consecutiveFailures: 1,
        lkgPresent: true,
        publishInProgress: true,
      },
      expectAction: RECOVERY_ACTION.PAUSE_PUBLISH,
    },
    {
      name: "readback_mismatch_pause",
      input: {
        errorKind: ERROR_KIND.READBACK_MISMATCH,
        consecutiveFailures: 2,
        lkgPresent: true,
        publishInProgress: true,
      },
      expectAction: RECOVERY_ACTION.PAUSE_PUBLISH,
    },
  ];

  const decisions = [];
  for (const c of cases) {
    const d = decideRecoveryAction(c.input);
    decisions.push(d);
    check(c.name + "_action", d.action === c.expectAction, {
      got: d.action,
      expect: c.expectAction,
    });
    check(c.name + "_no_owner_bypass_flag", d.ownerGateBypass === false, d);
    check(c.name + "_no_rewrite_source", d.rewriteSource === false, d);
    check(
      c.name + "_action_not_forbidden",
      !FORBIDDEN_ACTIONS.includes(d.action) && d.action !== "OWNER_GATE_BYPASS",
      d.action,
    );
    // Forbidden list may *mention* OWNER_GATE_BYPASS; action/secondary must never equal it.
    const secondary = Array.isArray(d.secondary) ? d.secondary : [];
    check(
      c.name + "_secondary_no_bypass",
      !secondary.includes("OWNER_GATE_BYPASS"),
      secondary,
    );
  }

  // Explicit global assert across all decisions
  const anyBypassAction = decisions.some(
    (d) =>
      d.action === "OWNER_GATE_BYPASS" ||
      (Array.isArray(d.secondary) && d.secondary.includes("OWNER_GATE_BYPASS")),
  );
  check("global_no_OWNER_GATE_BYPASS", anyBypassAction === false, anyBypassAction);

  const anyRewrite = decisions.some((d) => d.rewriteSource === true);
  check("global_no_rewrite_source", anyRewrite === false, anyRewrite);

  const allowed = new Set(Object.values(RECOVERY_ACTION));
  const allActionsKnown = decisions.every((d) => allowed.has(d.action));
  check("all_actions_in_enum", allActionsKnown === true, decisions.map((d) => d.action));

  const failed = checks.filter((c) => !c.ok);
  return {
    schema: AUTONOMOUS_RECOVERY_SCHEMA + "-selftest",
    ok: failed.length === 0,
    failed: failed.map((f) => f.name),
    checks,
    decisions: decisions.map((d) => ({
      errorKind: d.errorKind,
      action: d.action,
      reason: d.reason,
    })),
  };
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  const self = fileURLToPath(import.meta.url);
  return path.resolve(arg) === path.resolve(self);
}

if (isDirectRun()) {
  const result = runAutonomousRecoverySelftest();
  console.log(
    JSON.stringify(
      {
        IU_CJ_AUTONOMOUS_RECOVERY_SELFTEST: result.ok ? "PASS" : "FAIL",
        ...result,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exit(1);
}
