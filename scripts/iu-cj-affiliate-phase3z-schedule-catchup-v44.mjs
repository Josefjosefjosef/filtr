/**
 * V44: bounded catch-up for missed catalog-sync schedule slots.
 *
 * Rules (single owner, no parallel publisher):
 * - Never invent a "schedule" event — catch-up is workflow_dispatch only.
 * - Never fire when a catalog-sync run is already in_progress/queued.
 * - At most one catch-up per UTC day (default).
 * - At most one catch-up within CATCHUP_COOLDOWN_HOURS.
 * - Only when there is a real SLOT_MISS (not mere PENDING_OBSERVATION).
 * - Catch-up joins the same concurrency group as catalog-sync (caller must
 *   dispatch that workflow; cancel-in-progress remains false).
 * - Diagnostic / manual workflow_dispatch MUST NOT consume the catch-up budget
 *   (only runs marked catchup_dispatch / CATCHUP_DISPATCH_NOT_SCHEDULE count).
 *
 * GitHub Actions cron is NOT a guarantee of exact 3h delivery.
 */
export const CATCHUP_COOLDOWN_HOURS = 3;
export const MAX_CATCHUPS_PER_UTC_DAY = 1;
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
 * @param {Array<{ created_at?: string, event?: string, conclusion?: string|null }>} [opts.recentCatalogRuns]
 * @param {Date} [opts.now]
 * @param {number} [opts.maxCatchupsPerUtcDay]
 * @param {number} [opts.cooldownHours]
 */
export function decideScheduleCatchup(opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const slotReport = opts.slotReport || {};
  const miss = Number(slotReport.counts?.miss || 0);
  const inProg = Number(opts.catalogInProgressCount || 0);
  const maxPerDay = opts.maxCatchupsPerUtcDay ?? MAX_CATCHUPS_PER_UTC_DAY;
  const cooldownH = opts.cooldownHours ?? CATCHUP_COOLDOWN_HOURS;
  const runs = Array.isArray(opts.recentCatalogRuns) ? opts.recentCatalogRuns : [];

  if (inProg > 0) {
    return {
      allow: false,
      reason: "CATALOG_IN_PROGRESS",
      mode: null,
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
    evidenceClass: "CURRENT_PRODUCTION",
    note:
      "workflow_dispatch catch-up is audit-honest: never counted as schedule. Same concurrency group as catalog-sync; no second publisher.",
  };
}

/**
 * Escalate refresh depth when a schedule finally fires after a long gap.
 * Still one owner / one run — not a parallel cron.
 */
export function decideGapDeepen(opts = {}) {
  const latestAgeHours = opts.latestScheduleAgeHours;
  const thresholdH = opts.gapThresholdHours ?? 4;
  const eventName = String(opts.eventName || "");
  const scheduleExpr = String(opts.scheduleExpr || "");
  const isDailyFull = eventName === "schedule" && scheduleExpr === "17 3 * * *";
  if (eventName !== "schedule" || isDailyFull) {
    return {
      deepen: false,
      reason: isDailyFull ? "DAILY_FULL_ALREADY" : "NOT_SCHEDULE_REFRESH",
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
    reason: "SCHEDULE_GAP_GT_THRESHOLD",
    productMaxPages: 3,
    latestScheduleAgeHours: Number(latestAgeHours),
    gapThresholdHours: thresholdH,
    note: "Deepen discovery pages for this single schedule run only; concurrency unchanged.",
  };
}
