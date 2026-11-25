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
import { classifyScheduleSlots } from "./iu-cj-affiliate-phase3z-schedule-slot-watch-v42.mjs";
import {
  decideScheduleCatchup,
  CATCHUP_DISPATCH_MARKER,
} from "./iu-cj-affiliate-phase3z-schedule-catchup-v44.mjs";

export const AUTONOMOUS_RECOVERY_SCHEMA =
  "iu-cj-affiliate-phase3z-autonomous-recovery-scenarios-v51-8";

/** Classification of REFRESHED=0 outcomes (never auto-arms growth/email). */
export const REFRESHED_ZERO_CLASS = Object.freeze({
  EXTERNAL_RESIDUAL: "EXTERNAL_RESIDUAL",
  TRANSIENT_NOT_RESIDUAL: "TRANSIENT_NOT_RESIDUAL",
  NO_ATTEMPT: "NO_ATTEMPT",
  REFRESH_PROGRESS: "REFRESH_PROGRESS",
  UNKNOWN_FAIL_CLOSED: "UNKNOWN_FAIL_CLOSED",
});

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
  SCHEDULE_CATCHUP: "SCHEDULE_CATCHUP",
});

/** Every recovery decision must carry these safety flags as false. */
const NO_ARM = Object.freeze({
  autoArmGrowth: false,
  autoArmEmail: false,
  ownerGateBypass: false,
  rewriteSource: false,
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
    ...NO_ARM,
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

/**
 * Schedule slot miss → bounded workflow_dispatch catch-up (never a fake schedule event).
 * Delegates cadence rules to V42 slot classification + V44 catch-up policy.
 *
 * @param {object} input
 * @param {Array} [input.scheduleRuns] natural schedule runs (for slot classification)
 * @param {object} [input.slotReport] precomputed V42 report (overrides scheduleRuns)
 * @param {Array} [input.recentCatalogRuns]
 * @param {Date} [input.now]
 */
export function decideScheduleMissRecovery(input = {}) {
  const now = input.now instanceof Date ? input.now : new Date();
  const slotReport =
    input.slotReport || classifyScheduleSlots(input.scheduleRuns || [], now);
  const catchup = decideScheduleCatchup({
    slotReport,
    recentCatalogRuns: input.recentCatalogRuns || [],
    now,
  });
  return {
    schema: AUTONOMOUS_RECOVERY_SCHEMA,
    scenario: "SCHEDULE_MISS_CATCHUP",
    action: catchup.allow ? RECOVERY_ACTION.SCHEDULE_CATCHUP : RECOVERY_ACTION.CONTINUE,
    reason: catchup.reason,
    dispatchOnly: true,
    eventLabel: catchup.allow ? CATCHUP_DISPATCH_MARKER : null,
    missCount: Number(slotReport.counts?.miss || 0),
    catchup,
    secondary: catchup.allow ? [RECOVERY_ACTION.RECORD_INCIDENT] : [],
    ...NO_ARM,
    notes: ["Catch-up is workflow_dispatch only; same concurrency group; never counted as schedule."],
  };
}

/**
 * Promote must fail closed: anything other than explicit success on every
 * check blocks promotion and keeps LKG. Never bypasses owner gates.
 *
 * @param {object} input
 * @param {boolean} [input.promoteOk]
 * @param {boolean} [input.readbackOk]
 * @param {boolean} [input.gatesOk]
 * @param {number} [input.uniqueBefore]
 * @param {number} [input.uniqueAfter]
 * @param {boolean} [input.lkgPresent]
 */
export function decidePromoteRecovery(input = {}) {
  const lkg = bool(input.lkgPresent, false);
  const reasons = [];
  if (input.promoteOk !== true) reasons.push("PROMOTE_NOT_OK");
  if (input.readbackOk !== true) reasons.push("READBACK_NOT_OK");
  if (input.gatesOk !== true) reasons.push("GATES_NOT_OK");
  const before = Number(input.uniqueBefore);
  const after = Number(input.uniqueAfter);
  if (Number.isFinite(before) && Number.isFinite(after) && after < before) {
    reasons.push("UNIQUE_REGRESSION");
  }
  const allowPromote = reasons.length === 0;
  return {
    schema: AUTONOMOUS_RECOVERY_SCHEMA,
    scenario: "PROMOTE_FAIL_CLOSED",
    allowPromote,
    action: allowPromote
      ? RECOVERY_ACTION.CONTINUE
      : lkg
        ? RECOVERY_ACTION.KEEP_LKG
        : RECOVERY_ACTION.PAUSE_PUBLISH,
    secondary: allowPromote ? [] : [RECOVERY_ACTION.RECORD_INCIDENT],
    reason: allowPromote ? "PROMOTE_ALLOWED" : "PROMOTE_FAIL_CLOSED",
    failReasons: reasons,
    lkgPresent: lkg,
    ...NO_ARM,
    notes: ["Fail closed: missing/unknown promote evidence blocks promotion."],
  };
}

/**
 * Classify REFRESHED=0. A zero-refresh with real attempts and healthy API is an
 * EXTERNAL_RESIDUAL (CJ-side data), recorded as incident — NEVER auto-arms
 * growth/email and never rewrites source.
 *
 * @param {object} input
 * @param {number} [input.refreshed]
 * @param {number} [input.attempted]
 * @param {number} [input.apiErrorCount]
 * @param {boolean} [input.lkgPresent]
 */
export function classifyRefreshedZero(input = {}) {
  const refreshedRaw = input.refreshed;
  const refreshed = Number(refreshedRaw);
  const attempted = Math.max(0, Math.trunc(num(input.attempted, 0)));
  const apiErrors = Math.max(0, Math.trunc(num(input.apiErrorCount, 0)));
  const lkg = bool(input.lkgPresent, false);

  let classification;
  let action;
  let secondary = [];
  let reason;
  if (refreshedRaw == null || !Number.isFinite(refreshed) || refreshed < 0) {
    classification = REFRESHED_ZERO_CLASS.UNKNOWN_FAIL_CLOSED;
    action = RECOVERY_ACTION.RECORD_INCIDENT;
    reason = "REFRESHED_UNKNOWN";
  } else if (refreshed > 0) {
    classification = REFRESHED_ZERO_CLASS.REFRESH_PROGRESS;
    action = RECOVERY_ACTION.CONTINUE;
    reason = "REFRESHED_GT_0";
  } else if (attempted === 0) {
    classification = REFRESHED_ZERO_CLASS.NO_ATTEMPT;
    action = RECOVERY_ACTION.CONTINUE;
    reason = "NO_REFRESH_ATTEMPTED";
  } else if (apiErrors > 0) {
    classification = REFRESHED_ZERO_CLASS.TRANSIENT_NOT_RESIDUAL;
    action = RECOVERY_ACTION.RETRY_BACKOFF;
    reason = "API_ERRORS_DURING_REFRESH";
  } else {
    classification = REFRESHED_ZERO_CLASS.EXTERNAL_RESIDUAL;
    action = RECOVERY_ACTION.RECORD_INCIDENT;
    secondary = lkg ? [RECOVERY_ACTION.KEEP_LKG] : [];
    reason = "REFRESHED_0_WITH_ATTEMPTS_NO_API_ERRORS";
  }
  return {
    schema: AUTONOMOUS_RECOVERY_SCHEMA,
    scenario: "REFRESHED_ZERO_CLASSIFICATION",
    classification,
    externalResidual: classification === REFRESHED_ZERO_CLASS.EXTERNAL_RESIDUAL,
    action,
    secondary,
    reason,
    refreshed: Number.isFinite(refreshed) ? refreshed : null,
    attempted,
    apiErrorCount: apiErrors,
    lkgPresent: lkg,
    ...NO_ARM,
    notes: [
      "EXTERNAL_RESIDUAL is recorded only; it never arms growth or email.",
      "Re-attempt on next natural schedule slot.",
    ],
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

  check(
    "global_no_autoarm_growth_email",
    decisions.every((d) => d.autoArmGrowth === false && d.autoArmEmail === false),
    decisions.map((d) => [d.autoArmGrowth, d.autoArmEmail]),
  );

  // ---------- Scenario: schedule miss → bounded catch-up ----------
  const NOW = new Date("2026-11-25T10:00:00.000Z");
  const slotRun = (hour, dayOffset) => ({
    id: `r-${dayOffset}-${hour}`,
    created_at: new Date(Date.UTC(2026, 10, 25 + dayOffset, hour, 22, 0, 0)).toISOString(),
    conclusion: "success",
    head_sha: "a".repeat(40),
  });
  const fullRuns = [
    slotRun(0, 0), slotRun(3, 0), slotRun(6, 0), slotRun(9, 0),
    slotRun(12, -1), slotRun(15, -1), slotRun(18, -1), slotRun(21, -1),
  ];
  const missRuns = fullRuns.filter((r) => r.id !== "r-0-6");
  const scenarioDecisions = [];

  const noMiss = decideScheduleMissRecovery({ scheduleRuns: fullRuns, now: NOW });
  scenarioDecisions.push(noMiss);
  check(
    "sched_no_miss_no_catchup",
    noMiss.action === RECOVERY_ACTION.CONTINUE && noMiss.catchup.reason === "NO_SLOT_MISS",
    noMiss.catchup,
  );

  const miss = decideScheduleMissRecovery({ scheduleRuns: missRuns, now: NOW });
  scenarioDecisions.push(miss);
  check(
    "sched_miss_triggers_catchup",
    miss.action === RECOVERY_ACTION.SCHEDULE_CATCHUP &&
      miss.catchup.allow === true &&
      miss.missCount === 1 &&
      miss.catchup.missedSlots.some((s) => s.hour === 6),
    miss.catchup,
  );
  check(
    "sched_catchup_dispatch_only_not_schedule",
    miss.dispatchOnly === true && miss.eventLabel === CATCHUP_DISPATCH_MARKER,
    miss.eventLabel,
  );

  const missBusy = decideScheduleMissRecovery({
    scheduleRuns: missRuns,
    recentCatalogRuns: [{ event: "schedule", status: "queued", created_at: NOW.toISOString() }],
    now: NOW,
  });
  scenarioDecisions.push(missBusy);
  check(
    "sched_miss_blocked_when_schedule_pending",
    missBusy.action === RECOVERY_ACTION.CONTINUE &&
      missBusy.catchup.reason === "SCHEDULE_PENDING_OR_QUEUED",
    missBusy.catchup,
  );

  const missCooldown = decideScheduleMissRecovery({
    scheduleRuns: missRuns,
    recentCatalogRuns: [
      {
        event: "workflow_dispatch",
        status: "completed",
        catchup_dispatch: true,
        created_at: new Date(NOW.getTime() - 30 * 60000).toISOString(),
      },
    ],
    now: NOW,
  });
  scenarioDecisions.push(missCooldown);
  check(
    "sched_miss_cooldown_bounds_storm",
    missCooldown.action === RECOVERY_ACTION.CONTINUE &&
      missCooldown.catchup.reason === "CATCHUP_COOLDOWN",
    missCooldown.catchup,
  );

  // ---------- Scenario: promote fail-closed ----------
  const promoteOk = decidePromoteRecovery({
    promoteOk: true, readbackOk: true, gatesOk: true,
    uniqueBefore: 2600, uniqueAfter: 2624, lkgPresent: true,
  });
  const promoteFail = decidePromoteRecovery({
    promoteOk: false, readbackOk: true, gatesOk: true, lkgPresent: true,
  });
  const promoteReadback = decidePromoteRecovery({
    promoteOk: true, readbackOk: false, gatesOk: true, lkgPresent: true,
  });
  const promoteUnknown = decidePromoteRecovery({});
  const promoteRegress = decidePromoteRecovery({
    promoteOk: true, readbackOk: true, gatesOk: true,
    uniqueBefore: 2624, uniqueAfter: 2000, lkgPresent: false,
  });
  scenarioDecisions.push(promoteOk, promoteFail, promoteReadback, promoteUnknown, promoteRegress);
  check(
    "promote_all_green_allowed",
    promoteOk.allowPromote === true && promoteOk.action === RECOVERY_ACTION.CONTINUE,
    promoteOk,
  );
  check(
    "promote_fail_closed_keep_lkg",
    promoteFail.allowPromote === false &&
      promoteFail.action === RECOVERY_ACTION.KEEP_LKG &&
      promoteFail.failReasons.includes("PROMOTE_NOT_OK"),
    promoteFail,
  );
  check(
    "promote_readback_fail_closed",
    promoteReadback.allowPromote === false &&
      promoteReadback.failReasons.includes("READBACK_NOT_OK"),
    promoteReadback,
  );
  check(
    "promote_unknown_evidence_fail_closed",
    promoteUnknown.allowPromote === false &&
      promoteUnknown.action === RECOVERY_ACTION.PAUSE_PUBLISH &&
      promoteUnknown.failReasons.length === 3,
    promoteUnknown,
  );
  check(
    "promote_unique_regression_blocked",
    promoteRegress.allowPromote === false &&
      promoteRegress.failReasons.includes("UNIQUE_REGRESSION"),
    promoteRegress,
  );

  // ---------- Scenario: REFRESHED=0 external residual ----------
  const resExternal = classifyRefreshedZero({
    refreshed: 0, attempted: 4, apiErrorCount: 0, lkgPresent: true,
  });
  const resTransient = classifyRefreshedZero({
    refreshed: 0, attempted: 4, apiErrorCount: 2, lkgPresent: true,
  });
  const resNoAttempt = classifyRefreshedZero({ refreshed: 0, attempted: 0 });
  const resProgress = classifyRefreshedZero({ refreshed: 3, attempted: 4 });
  const resUnknown = classifyRefreshedZero({});
  scenarioDecisions.push(resExternal, resTransient, resNoAttempt, resProgress, resUnknown);
  check(
    "refreshed0_external_residual",
    resExternal.classification === REFRESHED_ZERO_CLASS.EXTERNAL_RESIDUAL &&
      resExternal.externalResidual === true &&
      resExternal.action === RECOVERY_ACTION.RECORD_INCIDENT &&
      resExternal.secondary.includes(RECOVERY_ACTION.KEEP_LKG),
    resExternal,
  );
  check(
    "refreshed0_external_residual_no_autoarm",
    resExternal.autoArmGrowth === false && resExternal.autoArmEmail === false,
    resExternal,
  );
  check(
    "refreshed0_api_errors_not_residual",
    resTransient.classification === REFRESHED_ZERO_CLASS.TRANSIENT_NOT_RESIDUAL &&
      resTransient.externalResidual === false &&
      resTransient.action === RECOVERY_ACTION.RETRY_BACKOFF,
    resTransient,
  );
  check(
    "refreshed0_no_attempt_not_residual",
    resNoAttempt.classification === REFRESHED_ZERO_CLASS.NO_ATTEMPT &&
      resNoAttempt.externalResidual === false,
    resNoAttempt,
  );
  check(
    "refreshed_gt0_progress",
    resProgress.classification === REFRESHED_ZERO_CLASS.REFRESH_PROGRESS &&
      resProgress.externalResidual === false,
    resProgress,
  );
  check(
    "refreshed_unknown_fail_closed",
    resUnknown.classification === REFRESHED_ZERO_CLASS.UNKNOWN_FAIL_CLOSED &&
      resUnknown.action === RECOVERY_ACTION.RECORD_INCIDENT,
    resUnknown,
  );

  // ---------- Global safety across ALL scenario decisions ----------
  const allScenario = [...decisions, ...scenarioDecisions];
  check(
    "scenarios_never_autoarm_growth_or_email",
    scenarioDecisions.every((d) => d.autoArmGrowth === false && d.autoArmEmail === false),
    scenarioDecisions.map((d) => [d.scenario, d.autoArmGrowth, d.autoArmEmail]),
  );
  check(
    "scenarios_no_forbidden_actions",
    allScenario.every(
      (d) =>
        !FORBIDDEN_ACTIONS.includes(d.action) &&
        !(d.secondary || []).some((a) => FORBIDDEN_ACTIONS.includes(a)) &&
        d.ownerGateBypass === false &&
        d.rewriteSource === false,
    ),
    allScenario.map((d) => d.action),
  );
  check(
    "scenario_actions_in_enum",
    scenarioDecisions.every((d) => allowed.has(d.action)),
    scenarioDecisions.map((d) => d.action),
  );

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
