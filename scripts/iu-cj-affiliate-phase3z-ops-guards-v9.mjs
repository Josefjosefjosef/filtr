/**
 * Phase 3Z ops guards: circuit breaker, evidence TTL, schedule watchdog helpers.
 * Fail-closed; never mass-delete on partial snapshots.
 */
export function evaluateCircuitBreaker({ previousJoinedCount, nextJoinedCount, confirmedEndedIds = [], partialSnapshot = false }) {
  const prev = Number(previousJoinedCount || 0);
  const next = Number(nextJoinedCount || 0);
  if (partialSnapshot) {
    return {
      trip: true,
      action: "KEEP_LKG_NO_MASS_DELETE",
      reason: "partial_cj_snapshot",
    };
  }
  if (prev > 0 && next < prev * 0.7 && (!confirmedEndedIds || confirmedEndedIds.length < prev - next)) {
    return {
      trip: true,
      action: "KEEP_LKG_REQUIRE_HUMAN",
      reason: "suspicious_mass_drop_without_confirmed_ended",
      drop: prev - next,
    };
  }
  return { trip: false, action: "PROCEED", reason: null };
}

export function evidenceFreshness({ lastReviewedAt, maxAgeHours = 168, now = Date.now() }) {
  if (!lastReviewedAt) return { fresh: false, reason: "missing_lastReviewedAt" };
  const t = Date.parse(lastReviewedAt);
  if (!Number.isFinite(t)) return { fresh: false, reason: "invalid_lastReviewedAt" };
  const ageH = (now - t) / 3600000;
  return { fresh: ageH <= maxAgeHours, ageHours: ageH, maxAgeHours };
}

export function scheduleWatchdog({ lastScheduleSuccessAt, maxLagHours = 36, now = Date.now() }) {
  if (!lastScheduleSuccessAt) {
    return { ok: false, status: "PENDING", reason: "no_schedule_success_recorded" };
  }
  const t = Date.parse(lastScheduleSuccessAt);
  if (!Number.isFinite(t)) return { ok: false, status: "PENDING", reason: "invalid_schedule_timestamp" };
  const lagH = (now - t) / 3600000;
  if (lagH > maxLagHours) return { ok: false, status: "STALE", reason: "schedule_lag_hours=" + lagH.toFixed(1) };
  return { ok: true, status: "OK", lagHours: lagH };
}

export function distinguishEndedVsPartial({ missingFromSnapshotIds, confirmedEndedIds }) {
  const missing = new Set((missingFromSnapshotIds || []).map(String));
  const ended = new Set((confirmedEndedIds || []).map(String));
  const treatAsEnded = [...missing].filter((id) => ended.has(id));
  const treatAsPartial = [...missing].filter((id) => !ended.has(id));
  return { treatAsEnded, treatAsPartial, failClosedKeep: treatAsPartial };
}
