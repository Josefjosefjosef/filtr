#!/usr/bin/env node
/**
 * V51.8 — REFRESHED=0 residual classifier + SOURCE_CURRENT priority refresh planner.
 * Offline / pure. Feeds the 48h observation ledger (event.residual). NEVER arms growth.
 *
 * - classifyRefreshedZeroResidual(attemptLedger): why did a MISSING_REFRESH pass refresh nothing?
 * - planSourceCurrentPriorityRefresh(offersDoc): order refresh targets so SOURCE_CURRENT
 *   (authoritative CJ sourceUpdatedAt) is protected/restored first; rows without a CJ source
 *   timestamp are a hard ceiling (refresh cannot make them SOURCE_CURRENT).
 * - recordResidualInObservationLedger(): append classification as observation event.
 */
import fs from "node:fs";
import path from "node:path";
import {
  appendObservationEvent,
  emptyObservationLedger,
  evaluateObservationWindow,
  loadObservationLedger,
  writeObservationLedger,
} from "./iu-cj-affiliate-phase3z-48h-observation-ledger-v51-8.mjs";
import {
  ATTEMPT_STATUS,
  mergeTargetsWithRetryQueue,
  selectMissingRefreshTargets,
} from "./iu-cj-affiliate-phase3z-lkg-missing-refresh-attempt-v51-8.mjs";
import {
  classifyProductFreshness,
  FRESHNESS_POLICY_V32,
  FRESHNESS_STATUS,
  productCurrencyClocks,
} from "./iu-cj-affiliate-phase3z-offers-freshness-v32.mjs";

export const RESIDUAL_SCHEMA = "iu-cj-affiliate-phase3z-refreshed-zero-residual-v51-8";

export const RESIDUAL_CLASS = Object.freeze({
  REFRESHED_POSITIVE: "REFRESHED_POSITIVE",
  NO_TARGETS_CLEAN: "NO_TARGETS_CLEAN",
  NO_TARGETS_BACKOFF_DEFERRED: "NO_TARGETS_BACKOFF_DEFERRED",
  NO_CREDENTIALS_DRY: "NO_CREDENTIALS_DRY",
  RETRY_PENDING: "RETRY_PENDING",
  PRODUCT_NOT_FOUND_RESIDUAL: "PRODUCT_NOT_FOUND_RESIDUAL",
  SOURCE_UNAVAILABLE_PARTNER: "SOURCE_UNAVAILABLE_PARTNER",
  PARTNERSHIP_ENDED: "PARTNERSHIP_ENDED",
  INVALID_DATA_HOLD: "INVALID_DATA_HOLD",
  TECHNICAL_FAILURE: "TECHNICAL_FAILURE",
  MIXED_NO_REFRESH: "MIXED_NO_REFRESH",
  LEDGER_MISSING: "LEDGER_MISSING",
});

/** Classes that need operator/engineering attention (not just waiting). */
const BLOCKING_CLASSES = new Set([
  RESIDUAL_CLASS.TECHNICAL_FAILURE,
  RESIDUAL_CLASS.LEDGER_MISSING,
]);

const STATUS_TO_CLASS = Object.freeze({
  [ATTEMPT_STATUS.RETRY_SCHEDULED]: RESIDUAL_CLASS.RETRY_PENDING,
  [ATTEMPT_STATUS.PRODUCT_NOT_FOUND]: RESIDUAL_CLASS.PRODUCT_NOT_FOUND_RESIDUAL,
  [ATTEMPT_STATUS.SOURCE_UNAVAILABLE]: RESIDUAL_CLASS.SOURCE_UNAVAILABLE_PARTNER,
  [ATTEMPT_STATUS.PARTNERSHIP_ENDED]: RESIDUAL_CLASS.PARTNERSHIP_ENDED,
  [ATTEMPT_STATUS.INVALID_DATA]: RESIDUAL_CLASS.INVALID_DATA_HOLD,
  [ATTEMPT_STATUS.TECHNICAL_FAILURE]: RESIDUAL_CLASS.TECHNICAL_FAILURE,
});

/**
 * Classify a REFRESHED=0 (or positive) attempt ledger honestly. Does not rename failures to PASS.
 * @param {object|null} ledger output of attemptMissingRefreshBatch().ledger
 */
export function classifyRefreshedZeroResidual(ledger, opts = {}) {
  const base = {
    schema: RESIDUAL_SCHEMA,
    growthArmed: false,
    informationalOnly: true,
  };
  if (!ledger || typeof ledger !== "object" || !ledger.byStatus) {
    return {
      ...base,
      residualClass: RESIDUAL_CLASS.LEDGER_MISSING,
      blocking: true,
      refreshed: null,
      targetCount: null,
      byStatus: null,
      reason: "attempt_ledger_missing_or_malformed",
    };
  }
  const byStatus = { ...ledger.byStatus };
  const refreshed = Number(byStatus[ATTEMPT_STATUS.REFRESHED] || 0);
  const targetCount = Number(
    ledger.targetCount != null ? ledger.targetCount : (ledger.attempts || []).length,
  );
  const common = {
    ...base,
    refreshed,
    targetCount,
    byStatus,
    credentialsPresent: ledger.credentialsPresent === true,
    deferredNotDue: Number(ledger.queueMerge?.deferredNotDue || 0),
    runId: ledger.runId || opts.runId || null,
    at: ledger.at || opts.nowIso || null,
  };
  if (refreshed > 0) {
    return {
      ...common,
      residualClass: RESIDUAL_CLASS.REFRESHED_POSITIVE,
      blocking: false,
      residualCount: Math.max(0, targetCount - refreshed),
      reason: "refreshed_positive",
    };
  }
  if (targetCount === 0) {
    const deferred = common.deferredNotDue;
    return {
      ...common,
      residualClass:
        deferred > 0
          ? RESIDUAL_CLASS.NO_TARGETS_BACKOFF_DEFERRED
          : RESIDUAL_CLASS.NO_TARGETS_CLEAN,
      blocking: false,
      residualCount: 0,
      reason: deferred > 0 ? "all_open_items_in_backoff_window" : "no_missing_refresh_targets",
    };
  }
  if (ledger.credentialsPresent !== true) {
    return {
      ...common,
      residualClass: RESIDUAL_CLASS.NO_CREDENTIALS_DRY,
      blocking: false,
      residualCount: targetCount,
      reason: "dry_run_or_credentials_absent_attempts_not_authoritative",
    };
  }
  const counts = Object.entries(byStatus)
    .filter(([s, n]) => s !== ATTEMPT_STATUS.REFRESHED && Number(n) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  let residualClass = RESIDUAL_CLASS.MIXED_NO_REFRESH;
  let reason = "mixed_statuses_no_refresh";
  if (counts.length === 1) {
    residualClass = STATUS_TO_CLASS[counts[0][0]] || RESIDUAL_CLASS.MIXED_NO_REFRESH;
    reason = `all_attempts_${counts[0][0].toLowerCase()}`;
  } else if (Number(byStatus[ATTEMPT_STATUS.TECHNICAL_FAILURE] || 0) > 0) {
    // Any technical failure in a mixed zero-refresh pass must stay visible.
    residualClass = RESIDUAL_CLASS.TECHNICAL_FAILURE;
    reason = "technical_failure_present_in_mixed_zero_refresh";
  }
  return {
    ...common,
    residualClass,
    blocking: BLOCKING_CLASSES.has(residualClass),
    residualCount: targetCount,
    dominantStatus: counts.length ? counts[0][0] : null,
    reason,
  };
}

/**
 * Priority tiers: lower number = refresh sooner.
 * P1 SOURCE_CURRENT restore  (authoritative CJ ts, but beyond target)
 * P2 SOURCE_CURRENT protect  (authoritative CJ ts, fresh, aging toward target)
 * P3 MISSING_REFRESH carry   (LKG without CJ ts; refresh clears hold, cannot reach SOURCE_CURRENT)
 * P4 VERIFIED_RECENT upkeep  (no CJ ts; fetch recent)
 * P9 CEILING                 (no authoritative CJ ts — SOURCE_CURRENT impossible, lowest priority)
 */
export const PRIORITY_TIER = Object.freeze({
  P1_SOURCE_CURRENT_RESTORE: 1,
  P2_SOURCE_CURRENT_PROTECT: 2,
  P3_MISSING_REFRESH_CARRY: 3,
  P4_VERIFIED_RECENT_UPKEEP: 4,
  P9_SOURCE_CURRENT_CEILING: 9,
});

export function classifyRefreshPriority(row, nowMs = Date.now(), policy = FRESHNESS_POLICY_V32) {
  // classifyProductFreshness keys off lastSuccessfulRefreshAt/lastCheckedAt/fetchedAt; honor lastVerifiedAt too.
  const p =
    row?.lastVerifiedAt && !row.lastSuccessfulRefreshAt && !row.lastCheckedAt && !row.fetchedAt
      ? { ...row, lastCheckedAt: row.lastVerifiedAt }
      : row;
  const fr = classifyProductFreshness(p, nowMs, policy);
  const clocks = productCurrencyClocks(p, nowMs, policy);
  const sourceTrusted = clocks.sourceTrusted === true;
  const carried = p?.lkgCarried === true;
  const sourceAgeMs =
    sourceTrusted && clocks.sourceUpdatedAt ? Math.max(0, nowMs - Date.parse(clocks.sourceUpdatedAt)) : null;
  let tier;
  let label;
  if (sourceTrusted) {
    const stale =
      fr.freshnessStatus === FRESHNESS_STATUS.STALE ||
      fr.freshnessStatus === FRESHNESS_STATUS.HIDDEN_STALE ||
      fr.freshnessStatus === FRESHNESS_STATUS.UNVERIFIED;
    tier = stale
      ? PRIORITY_TIER.P1_SOURCE_CURRENT_RESTORE
      : PRIORITY_TIER.P2_SOURCE_CURRENT_PROTECT;
    label = stale ? "SOURCE_CURRENT_RESTORE" : "SOURCE_CURRENT_PROTECT";
  } else if (carried) {
    tier = PRIORITY_TIER.P3_MISSING_REFRESH_CARRY;
    label = "MISSING_REFRESH_CARRY_NO_SOURCE_TS";
  } else if (fr.freshnessStatus === FRESHNESS_STATUS.FETCH_RECENT_SOURCE_AGE_UNKNOWN) {
    tier = PRIORITY_TIER.P4_VERIFIED_RECENT_UPKEEP;
    label = "VERIFIED_RECENT_UPKEEP";
  } else {
    tier = PRIORITY_TIER.P9_SOURCE_CURRENT_CEILING;
    label = "SOURCE_CURRENT_CEILING_NO_SOURCE_TS";
  }
  return {
    tier,
    label,
    freshnessStatus: fr.freshnessStatus,
    sourceTrusted,
    sourceAgeMs,
    canReachSourceCurrent: sourceTrusted,
  };
}

/**
 * Plan a bounded, ordered refresh list. Honors durable retry-queue backoff (no double attempt).
 * Pure: no network, no mutation of doc.
 */
export function planSourceCurrentPriorityRefresh(doc, opts = {}) {
  const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  const budget = Math.max(1, Number(opts.budget) || 200);
  const rows = [];
  const seen = new Set();
  for (const sec of doc?.sections || []) {
    for (const p of sec.products || []) {
      const adv = String(p?.advertiserId || "").trim();
      const pid = String(p?.productId || "").trim();
      const variant = String(p?.productVariant || "").trim();
      if (!adv || !pid) continue;
      const key = variant ? `${adv}|${pid}|${variant}` : `${adv}|${pid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pr = classifyRefreshPriority(p, nowMs);
      rows.push({
        key,
        advertiserId: adv,
        productId: pid,
        ...(variant ? { productVariant: variant } : {}),
        title: p.title || null,
        ...pr,
        lastVerifiedMs: Date.parse(p.lastVerifiedAt || p.lastSuccessfulRefreshAt || p.fetchedAt || "") || 0,
      });
    }
  }
  // Backoff: drop keys whose durable retry item is not yet due.
  const merged = mergeTargetsWithRetryQueue(
    selectMissingRefreshTargets(doc, { nowMs }).targets,
    opts.retryQueue || null,
    { nowMs },
  );
  const dueKeys = new Set(merged.targets.map((t) => t.key));
  const notDueKeys = new Set();
  for (const [k, item] of Object.entries(opts.retryQueue?.items || {})) {
    const next = Date.parse(item?.nextAttemptAt || "");
    if (item && item.closed !== true && Number.isFinite(next) && next > nowMs) notDueKeys.add(k);
  }
  const eligible = rows.filter((r) => !notDueKeys.has(r.key));
  eligible.sort(
    (a, b) =>
      a.tier - b.tier ||
      (b.sourceAgeMs || 0) - (a.sourceAgeMs || 0) ||
      a.lastVerifiedMs - b.lastVerifiedMs ||
      a.key.localeCompare(b.key),
  );
  const selected = eligible
    .filter((r) => opts.includeCeiling === true || r.tier !== PRIORITY_TIER.P9_SOURCE_CURRENT_CEILING)
    .slice(0, budget);
  const byTier = {};
  for (const r of rows) byTier[r.label] = (byTier[r.label] || 0) + 1;
  return {
    schema: "iu-cj-affiliate-phase3z-source-current-priority-plan-v51-8",
    growthArmed: false,
    budget,
    totalProducts: rows.length,
    eligibleCount: eligible.length,
    deferredByBackoff: notDueKeys.size,
    dueMissingRefreshCount: dueKeys.size,
    selectedCount: selected.length,
    sourceCurrentCapable: rows.filter((r) => r.canReachSourceCurrent).length,
    sourceCurrentCeiling: rows.filter((r) => !r.canReachSourceCurrent).length,
    byTier,
    selected,
    note:
      "SOURCE_CURRENT is never invented. Rows without CJ sourceUpdatedAt keep the ceiling regardless of refresh success.",
  };
}

/** Append classification as an observation event and re-evaluate the 48h window. */
export function recordResidualInObservationLedger(ledger, classification, opts = {}) {
  const at = opts.at || classification?.at || new Date().toISOString();
  const doc = loadObservationLedger(ledger);
  return appendObservationEvent(doc, {
    at,
    kind: "refreshed_zero_residual",
    eventName: "refreshed_zero_classifier",
    runId: classification?.runId || opts.runId || `residual-${at}`,
    conclusion: classification?.blocking ? "failure" : "success",
    notes: `RESIDUAL:${classification?.residualClass || "UNKNOWN"}`,
    residual: {
      residualClass: classification?.residualClass || null,
      refreshed: classification?.refreshed ?? null,
      targetCount: classification?.targetCount ?? null,
      blocking: classification?.blocking === true,
      reason: classification?.reason || null,
    },
  });
}

async function main() {
  const attemptsPath = process.env.IU_CJ_LKG_REFRESH_ATTEMPTS_OUT || "";
  const ledgerPath =
    process.env.IU_CJ_OBSERVATION_LEDGER_PATH ||
    path.join(process.env.TEMP || "/tmp", "iu-48h-observation-ledger.json");
  const attempt =
    attemptsPath && fs.existsSync(attemptsPath)
      ? JSON.parse(fs.readFileSync(attemptsPath, "utf8"))
      : null;
  const classification = classifyRefreshedZeroResidual(attempt);
  let doc = fs.existsSync(ledgerPath)
    ? loadObservationLedger(JSON.parse(fs.readFileSync(ledgerPath, "utf8")))
    : emptyObservationLedger();
  if (process.env.IU_CJ_OBSERVATION_APPEND === "1") {
    doc = recordResidualInObservationLedger(doc, classification);
    writeObservationLedger(ledgerPath, doc);
  } else {
    doc.evaluation = evaluateObservationWindow(doc);
  }
  console.log(JSON.stringify({ ok: true, classification, evaluation: doc.evaluation }, null, 2));
}

const isDirect =
  process.argv[1] &&
  process.argv[1]
    .replace(/\\/g, "/")
    .endsWith("iu-cj-affiliate-phase3z-observation-refreshed-zero-classifier-v51-8.mjs");
if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
