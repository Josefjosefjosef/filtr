/**
 * V44: bounded catch-up for missed catalog-sync schedule slots.
 *
 * Rules (single owner, no parallel publisher):
 * - Never invent a "schedule" event — catch-up is workflow_dispatch only.
 * - Never fire when a catalog-sync run is already in_progress/queued/pending/waiting.
 * - Never fire when a natural schedule run is pending/queued (prefer schedule over catch-up).
 * - At most six catch-ups per UTC day (default) — eight :17 slots exist; daycap 4
 *   left multi-miss days unrecovered after catch-up budget exhaust. Cap 6 still
 *   bounds storms while covering cascading GHA undelivery.
 * - At most one catch-up within CATCHUP_COOLDOWN_HOURS (still blocks storms).
 * - When miss>=2 (cascading undelivery), cooldown softens to
 *   CATCHUP_COOLDOWN_HOURS_MULTI_MISS so recovery is not frozen behind a 2h wait
 *   while later slots keep vanishing — daycap still bounds storms.
 * - Only when there is a real SLOT_MISS (not mere PENDING_OBSERVATION).
 * - Catch-up joins the same concurrency group as catalog-sync (caller must
 *   dispatch that workflow; cancel-in-progress remains false).
 * - Diagnostic / manual workflow_dispatch MUST NOT consume the catch-up budget
 *   (only runs marked catchup_dispatch / CATCHUP_DISPATCH_NOT_SCHEDULE count).
 * - Gap-deepen may also apply to catch-up dispatches after a long miss window
 *   (still one owner / one concurrency group; never invents a schedule event).
 *
 * GitHub Actions cron is NOT a guarantee of exact 3h delivery.
 * Watch crons (:47/:57) can also vanish — hourly watch heartbeat is required.
 */
export const CATCHUP_COOLDOWN_HOURS = 2;
/** Softened cooldown when ≥2 SLOT_MISS are open (cascading GHA undelivery). */
export const CATCHUP_COOLDOWN_HOURS_MULTI_MISS = 1;
export const MAX_CATCHUPS_PER_UTC_DAY = 6;
export const CATCHUP_DISPATCH_MARKER = "CATCHUP_DISPATCH_NOT_SCHEDULE";

/** True when a catalog run is an audit-honest catch-up (not diagnostic dispatch). */
export function isCatchupDispatchRun(run) {
  if (!run || typeof run !== "object") return false;
  if (String(run.event || "") !== "workflow_dispatch") return false;
  if (run.catchup_dispatch === true || run.catchup_dispatch === 1 || run.catchup_dispatch === "1") {
    return true;
  }
  const title = String(run.display_title || run.name || run.displayTitle || "");
  if (title.includes(CATCHUP_DISPATCH_MARKER) || /\bCATCHUP\b/i.test(title)) return true;
  if (run.inputs && (run.inputs.catchup_dispatch === "1" || run.inputs.catchup_dispatch === 1)) {
    return true;
  }
  return false;
}

/**
 * @param {object} opts
 * @param {{ counts?: { miss?: number, pending?: number }, slots?: Array<{classification?: string, hour?: number, expectedUtc?: string}>, latestSchedule?: { ageHours?: number|null }|null }} opts.slotReport
 * @param {number} [opts.catalogInProgressCount]
 * @param {number} [opts.schedulePendingCount] pending/queued/waiting natural schedule runs
 * @param {Array<{ created_at?: string, event?: string, status?: string, conclusion?: string|null }>} [opts.recentCatalogRuns]
 * @param {Date} [opts.now]
 * @param {number} [opts.maxCatchupsPerUtcDay]
 * @param {number} [opts.cooldownHours]
 */
export const CATALOG_BUSY_STATUSES = new Set([
  "in_progress",
  "queued",
  "pending",
  "waiting",
  "requested",
]);

export function isCatalogRunBusy(run) {
  if (!run || typeof run !== "object") return false;
  return CATALOG_BUSY_STATUSES.has(String(run.status || ""));
}

export function decideScheduleCatchup(opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const slotReport = opts.slotReport || {};
  const miss = Number(slotReport.counts?.miss || 0);
  const inProg = Number(opts.catalogInProgressCount || 0);
  const maxPerDay = opts.maxCatchupsPerUtcDay ?? MAX_CATCHUPS_PER_UTC_DAY;
  const baseCooldownH = opts.cooldownHours ?? CATCHUP_COOLDOWN_HOURS;
  const multiMissCooldownH =
    opts.cooldownHoursMultiMiss ?? CATCHUP_COOLDOWN_HOURS_MULTI_MISS;
  const runs = Array.isArray(opts.recentCatalogRuns) ? opts.recentCatalogRuns : [];

  // Prefer a natural schedule that is already accepted by GHA but waiting on concurrency.
  // Catch-up must not jump the queue ahead of schedule (evidence: 45370496099 vs 45370997169).
  const schedulePendingExplicit = Number(opts.schedulePendingCount || 0);
  const schedulePendingFromRuns = runs.filter(
    (r) => String(r.event || "") === "schedule" && isCatalogRunBusy(r),
  ).length;
  const schedulePending = Math.max(schedulePendingExplicit, schedulePendingFromRuns);
  if (schedulePending > 0) {
    return {
      allow: false,
      reason: "SCHEDULE_PENDING_OR_QUEUED",
      mode: null,
      schedulePendingCount: schedulePending,
      evidenceClass: "CURRENT_PRODUCTION",
      note: "Natural schedule already pending/queued — catch-up must not occupy concurrency ahead of it.",
    };
  }

  // Recount busy runs from recent list (covers status=pending that older jq missed).
  const busyFromRuns = runs.filter((r) => isCatalogRunBusy(r)).length;
  const busy = Math.max(inProg, busyFromRuns);
  if (busy > 0) {
    return {
      allow: false,
      reason: "CATALOG_IN_PROGRESS",
      mode: null,
      catalogBusyCount: busy,
      evidenceClass: "CURRENT_PRODUCTION",
    };
  }
  if (miss < 1) {
    return {
      allow: false,
      reason: "NO_SLOT_MISS",
      mode: null,
      evidenceClass: "CURRENT_PRODUCTION",
      note: "PENDING_OBSERVATION alone must not trigger catch-up",
    };
  }

  // Cascading undelivery: do not freeze recovery behind the full 2h cooldown when
  // multiple SLOT_MISS are already open. Daycap still bounds storms.
  const cooldownH =
    miss >= 2 ? Math.min(baseCooldownH, Number(multiMissCooldownH) || 1) : baseCooldownH;
  const cooldownSoftened = miss >= 2 && cooldownH < baseCooldownH;

  const dayKey = now.toISOString().slice(0, 10);
  // Only true catch-up dispatches consume the daily budget (diagnostic dispatch ignored).
  const catchupsToday = runs.filter((r) => {
    if (!isCatchupDispatchRun(r)) return false;
    const t = r.created_at ? new Date(r.created_at) : null;
    if (!t || Number.isNaN(t.getTime())) return false;
    return t.toISOString().slice(0, 10) === dayKey;
  });
  if (catchupsToday.length >= maxPerDay) {
    return {
      allow: false,
      reason: "MAX_CATCHUPS_PER_UTC_DAY",
      mode: null,
      dispatchesToday: catchupsToday.length,
      catchupsToday: catchupsToday.length,
      evidenceClass: "CURRENT_PRODUCTION",
    };
  }

  const latestCatchup = runs
    .filter((r) => isCatchupDispatchRun(r))
    .map((r) => ({ ...r, t: new Date(r.created_at || 0) }))
    .filter((r) => !Number.isNaN(r.t.getTime()))
    .sort((a, b) => b.t - a.t)[0];
  if (latestCatchup) {
    const ageH = (now.getTime() - latestCatchup.t.getTime()) / 3600000;
    if (ageH < cooldownH) {
      return {
        allow: false,
        reason: "CATCHUP_COOLDOWN",
        mode: null,
        cooldownHours: cooldownH,
        cooldownSoftened,
        missCount: miss,
        latestDispatchAgeHours: Math.round(ageH * 100) / 100,
        evidenceClass: "CURRENT_PRODUCTION",
      };
    }
  }

  const missedSlots = (slotReport.slots || []).filter((s) => s.classification === "SLOT_MISS");
  return {
    allow: true,
    reason: "SLOT_MISS_BOUNDED_CATCHUP",
    mode: "refresh_priority",
    eventLabel: "CATCHUP_DISPATCH_NOT_SCHEDULE",
    missedSlots: missedSlots.map((s) => ({
      hour: s.hour,
      expectedUtc: s.expectedUtc,
    })),
    maxCatchupsPerUtcDay: maxPerDay,
    cooldownHoursApplied: cooldownH,
    cooldownSoftened,
    missCount: miss,
    evidenceClass: "CURRENT_PRODUCTION",
    note:
      "workflow_dispatch catch-up is audit-honest: never counted as schedule. Same concurrency group as catalog-sync; no second publisher.",
  };
}

/**
 * Escalate refresh depth when a schedule (or bounded catch-up) runs after a long gap.
 * Still one owner / one run — not a parallel cron.
 */
export function decideGapDeepen(opts = {}) {
  const latestAgeHours = opts.latestScheduleAgeHours;
  const thresholdH = opts.gapThresholdHours ?? 4;
  const eventName = String(opts.eventName || "");
  const scheduleExpr = String(opts.scheduleExpr || "");
  const catchupDispatch =
    opts.catchupDispatch === true ||
    opts.catchupDispatch === 1 ||
    opts.catchupDispatch === "1";
  const isDailyFull = eventName === "schedule" && scheduleExpr === "17 3 * * *";
  const isScheduleRefresh = eventName === "schedule" && !isDailyFull;
  const isCatchupRefresh = catchupDispatch === true && eventName === "workflow_dispatch";
  if (isDailyFull) {
    return {
      deepen: false,
      reason: "DAILY_FULL_ALREADY",
      productMaxPages: null,
    };
  }
  if (!isScheduleRefresh && !isCatchupRefresh) {
    return {
      deepen: false,
      reason: "NOT_SCHEDULE_OR_CATCHUP_REFRESH",
      productMaxPages: null,
    };
  }
  if (latestAgeHours == null || !Number.isFinite(Number(latestAgeHours))) {
    return { deepen: false, reason: "UNKNOWN_PRIOR_AGE", productMaxPages: null };
  }
  if (Number(latestAgeHours) < thresholdH) {
    return {
      deepen: false,
      reason: "GAP_WITHIN_THRESHOLD",
      productMaxPages: null,
      latestScheduleAgeHours: Number(latestAgeHours),
    };
  }
  return {
    deepen: true,
    reason: isCatchupRefresh
      ? "CATCHUP_GAP_GT_THRESHOLD"
      : "SCHEDULE_GAP_GT_THRESHOLD",
    productMaxPages: 3,
    latestScheduleAgeHours: Number(latestAgeHours),
    gapThresholdHours: thresholdH,
    catchupDispatch: isCatchupRefresh,
    note: "Deepen discovery pages for this single run only; concurrency unchanged; catch-up never counted as schedule.",
  };
}
