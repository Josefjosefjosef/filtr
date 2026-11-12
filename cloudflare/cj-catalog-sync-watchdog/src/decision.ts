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
    };

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

export function decideCjCatalogWatchdog(input: {
  generatedAt: string | null;
  nowMs: number;
  staleAfterMinutes: number;
  runs: GhRunLike[];
  maxCatchupsPerUtcDay?: number;
  catchupCooldownMinutes?: number;
}): CjWatchdogDecision {
  const staleAfterMinutes = Math.max(1, Number(input.staleAfterMinutes) || 240);
  const maxCatchupsPerUtcDay = Math.max(
    1,
    Number(input.maxCatchupsPerUtcDay) || 4,
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
  return { action: "skip", reason: "not_stale", ageMinutes, staleAfterMinutes };
}
