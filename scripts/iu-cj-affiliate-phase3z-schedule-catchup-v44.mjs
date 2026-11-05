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
 *
 * GitHub Actions cron is NOT a guarantee of exact 3h delivery.
 */
export const CATCHUP_COOLDOWN_HOURS = 3;
export const MAX_CATCHUPS_PER_UTC_DAY = 1;

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
  const dispatchesToday = runs.filter((r) => {
    if (String(r.event || "") !== "workflow_dispatch") return false;
    const t = r.created_at ? new Date(r.created_at) : null;
    if (!t || Number.isNaN(t.getTime())) return false;
    return t.toISOString().slice(0, 10) === dayKey;
  });
  if (dispatchesToday.length >= maxPerDay) {
    return {
      allow: false,
      reason: "MAX_CATCHUPS_PER_UTC_DAY",
      mode: null,
      dispatchesToday: dispatchesToday.length,
      evidenceClass: "CURRENT_PRODUCTION",
    };
  }

  const latestDispatch = runs
    .filter((r) => String(r.event || "") === "workflow_dispatch")
    .map((r) => ({ ...r, t: new Date(r.created_at || 0) }))
    .filter((r) => !Number.isNaN(r.t.getTime()))
    .sort((a, b) => b.t - a.t)[0];
  if (latestDispatch) {
    const ageH = (now.getTime() - latestDispatch.t.getTime()) / 3600000;
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
