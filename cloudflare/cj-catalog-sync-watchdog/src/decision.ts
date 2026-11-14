export type CjWatchdogDecision =
  | {
      action: "skip";
      reason: "not_stale";
      ageMinutes: number | null;
      staleAfterMinutes: number;
    }
  | {
      action: "skip";
      reason: "busy";
      ageMinutes: number | null;
      staleAfterMinutes: number;
    }
  | {
      action: "skip";
      reason: "catchup_cooldown";
      ageMinutes: number | null;
      staleAfterMinutes: number;
      cooldownMinutes: number;
      latestCatchupAgeMinutes: number;
    }
  | {
      action: "skip";
      reason: "max_catchups_per_utc_day";
      ageMinutes: number | null;
      staleAfterMinutes: number;
      catchupsToday: number;
      maxCatchupsPerUtcDay: number;
    }
  | {
      action: "skip";
      reason: "freshness_unavailable";
      ageMinutes: null;
      staleAfterMinutes: number;
    }
  | {
      action: "dispatch";
      reason: "stale";
      ageMinutes: number | null;
      staleAfterMinutes: number;
    }
  | {
      action: "dispatch";
      reason: "slot_miss_uncovered";
      ageMinutes: number | null;
      staleAfterMinutes: number;
      expectedSlotUtc: string;
      slotAgeMinutes: number;
      slotDelayBudgetMinutes: number;
    };

/** Catalog cadence hours (UTC :17). Kept in sync with GHA cron. */
export const EXPECTED_SLOT_HOURS_UTC = Object.freeze([0, 3, 6, 9, 12, 15, 18, 21]);

/** Aligns with GHA schedule-watch delay budget — not a relaxation of gates. */
export const DEFAULT_SLOT_DELAY_BUDGET_MINUTES = 180;

export type GhRunLike = {
  status?: string;
  conclusion?: string | null;
  created_at?: string;
  event?: string;
  display_title?: string;
  name?: string;
  displayTitle?: string;
};

export function parseIsoToMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function isCatchupDispatchRun(run: GhRunLike | null | undefined): boolean {
  if (!run || typeof run !== "object") return false;
  if (String(run.event || "") !== "workflow_dispatch") return false;
  const title = String(run.display_title || run.name || run.displayTitle || "");
  return title.includes("CATCHUP_DISPATCH_NOT_SCHEDULE") || /\bCATCHUP\b/i.test(title);
}

function isBusyStatus(status: string | undefined): boolean {
  const s = String(status || "").toLowerCase();
  return s === "queued" || s === "in_progress" || s === "waiting" || s === "pending";
}

/** Prefer latest successful catalog sync age; fall back to production generatedAt. */
export function resolveFreshnessAgeMinutes(input: {
  generatedAt: string | null;
  runs: GhRunLike[];
  nowMs: number;
}): { ageMinutes: number | null; source: "run_success" | "generated_at" | "none" } {
  const successes = (input.runs || [])
    .filter((r) => String(r.conclusion || "").toLowerCase() === "success")
    .map((r) => parseIsoToMs(r.created_at))
    .filter((t): t is number => t != null)
    .sort((a, b) => b - a);
  if (successes.length > 0) {
    return {
      ageMinutes: (input.nowMs - successes[0]) / 60_000,
      source: "run_success",
    };
  }
  const genMs = parseIsoToMs(input.generatedAt);
  if (genMs == null) return { ageMinutes: null, source: "none" };
  return {
    ageMinutes: (input.nowMs - genMs) / 60_000,
    source: "generated_at",
  };
}

/**
 * Effective coverage for recovery: any successful catalog run (schedule or catch-up)
 * at/after the slot start (with 5m early tolerance). This is NOT a GitHub schedule HIT —
 * schedule HIT still requires created_at within delayBudget (audit scripts).
 */
export function runCoversSlot(
  run: GhRunLike,
  slotMs: number,
  _delayBudgetMin?: number,
): boolean {
  if (String(run.conclusion || "").toLowerCase() !== "success") return false;
  const t = parseIsoToMs(run.created_at);
  if (t == null) return false;
  return t >= slotMs - 5 * 60_000;
}

/**
 * Latest expected :17 slot whose delay budget has elapsed. If that slot has no
 * covering successful sync (schedule OR catch-up), return it for recovery.
 * Older historical misses do not keep firing once a newer due slot is covered.
 * Independent of GHA cron delivery / schedule HIT classification.
 */
export function findUncoveredMissedSlot(input: {
  nowMs: number;
  runs: GhRunLike[];
  slotDelayBudgetMinutes?: number;
  windowHours?: number;
}): { expectedSlotUtc: string; slotAgeMinutes: number; slotDelayBudgetMinutes: number } | null {
  const delayBudgetMin = Math.max(
    1,
    Number(input.slotDelayBudgetMinutes) || DEFAULT_SLOT_DELAY_BUDGET_MINUTES,
  );
  const windowHours = Math.max(3, Number(input.windowHours) || 24);
  const now = new Date(input.nowMs);
  const runs = input.runs || [];

  let latestDue: { slotMs: number; ageMin: number } | null = null;

  for (const h of EXPECTED_SLOT_HOURS_UTC) {
    let slot = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, 17, 0, 0),
    );
    if (slot.getTime() > input.nowMs) {
      slot = new Date(slot.getTime() - 24 * 3600 * 1000);
    }
    const ageMin = (input.nowMs - slot.getTime()) / 60_000;
    if (ageMin > windowHours * 60) continue;
    // Still inside observation window — do not treat as miss yet.
    if (ageMin <= delayBudgetMin) continue;
    if (!latestDue || slot.getTime() > latestDue.slotMs) {
      latestDue = { slotMs: slot.getTime(), ageMin };
    }
  }

  if (!latestDue) return null;
  const covered = runs.some((r) => runCoversSlot(r, latestDue!.slotMs, delayBudgetMin));
  if (covered) return null;
  return {
    expectedSlotUtc: new Date(latestDue.slotMs).toISOString(),
    slotAgeMinutes: Math.round(latestDue.ageMin * 10) / 10,
    slotDelayBudgetMinutes: delayBudgetMin,
  };
}

export function decideCjCatalogWatchdog(input: {
  generatedAt: string | null;
  nowMs: number;
  staleAfterMinutes: number;
  runs: GhRunLike[];
  maxCatchupsPerUtcDay?: number;
  catchupCooldownMinutes?: number;
  slotDelayBudgetMinutes?: number;
}): CjWatchdogDecision {
  const staleAfterMinutes = Math.max(1, Number(input.staleAfterMinutes) || 240);
  const maxCatchupsPerUtcDay = Math.max(
    1,
    Number(input.maxCatchupsPerUtcDay) || 6,
  );
  const cooldownMinutes = Math.max(1, Number(input.catchupCooldownMinutes) || 60);
  const runs = input.runs || [];

  const busy = runs.some((r) => isBusyStatus(r.status));
  const freshness = resolveFreshnessAgeMinutes({
    generatedAt: input.generatedAt,
    runs,
    nowMs: input.nowMs,
  });
  const ageMinutes = freshness.ageMinutes;

  if (busy) {
    return { action: "skip", reason: "busy", ageMinutes, staleAfterMinutes };
  }
  if (ageMinutes == null) {
    return {
      action: "skip",
      reason: "freshness_unavailable",
      ageMinutes: null,
      staleAfterMinutes,
    };
  }

  const dayKey = new Date(input.nowMs).toISOString().slice(0, 10);
  const catchupsToday = runs.filter((r) => {
    if (!isCatchupDispatchRun(r)) return false;
    const t = parseIsoToMs(r.created_at);
    if (t == null) return false;
    return new Date(t).toISOString().slice(0, 10) === dayKey;
  });
  if (catchupsToday.length >= maxCatchupsPerUtcDay) {
    return {
      action: "skip",
      reason: "max_catchups_per_utc_day",
      ageMinutes,
      staleAfterMinutes,
      catchupsToday: catchupsToday.length,
      maxCatchupsPerUtcDay,
    };
  }

  const latestCatchupMs = runs
    .filter((r) => isCatchupDispatchRun(r))
    .map((r) => parseIsoToMs(r.created_at))
    .filter((t): t is number => t != null)
    .sort((a, b) => b - a)[0];
  if (latestCatchupMs != null) {
    const latestCatchupAgeMinutes = (input.nowMs - latestCatchupMs) / 60_000;
    if (latestCatchupAgeMinutes < cooldownMinutes) {
      return {
        action: "skip",
        reason: "catchup_cooldown",
        ageMinutes,
        staleAfterMinutes,
        cooldownMinutes,
        latestCatchupAgeMinutes,
      };
    }
  }

  if (ageMinutes >= staleAfterMinutes) {
    return { action: "dispatch", reason: "stale", ageMinutes, staleAfterMinutes };
  }

  // Slot-aware path: GHA cron may under-deliver while freshness still looks OK
  // (e.g. last success ~3h ago). Independent of schedule HIT classification.
  const uncovered = findUncoveredMissedSlot({
    nowMs: input.nowMs,
    runs,
    slotDelayBudgetMinutes: input.slotDelayBudgetMinutes,
  });
  if (uncovered) {
    return {
      action: "dispatch",
      reason: "slot_miss_uncovered",
      ageMinutes,
      staleAfterMinutes,
      ...uncovered,
    };
  }

  return { action: "skip", reason: "not_stale", ageMinutes, staleAfterMinutes };
}
