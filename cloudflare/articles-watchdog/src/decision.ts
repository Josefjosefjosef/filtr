/**
 * Pure watchdog policy (unit-tested). Worker I/O lives in index.ts.
 */

export type WorkflowRunLite = { status: string; event?: string };

export type WatchdogDecision =
  | { action: "skip_fresh"; ageMinutes: number; staleAfterMinutes: number }
  | { action: "skip_busy"; ageMinutes: number; busyStatuses: string[] }
  | { action: "dispatch"; ageMinutes: number; reason: string };

export function parseIsoToMs(iso: string | undefined | null): number | null {
  if (!iso || typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function ageMinutes(nowMs: number, generatedMs: number): number {
  return (nowMs - generatedMs) / 60_000;
}

export function hasRunningOrQueued(runs: WorkflowRunLite[]): boolean {
  return runs.some((r) => r.status === "queued" || r.status === "in_progress");
}

/**
 * Stale or missing public timestamp → may dispatch. Fresh → skip.
 * Duplicate protection: any queued/in_progress run for this workflow blocks a new dispatch (GitHub API list is per-workflow).
 */
export function decideWatchdog(input: {
  generatedAtIso: string | null | undefined;
  staleAfterMinutes: number;
  nowMs: number;
  runs: WorkflowRunLite[];
}): WatchdogDecision {
  const { staleAfterMinutes, nowMs, runs } = input;
  const ms = parseIsoToMs(input.generatedAtIso ?? undefined);

  if (ms !== null) {
    const ageMin = ageMinutes(nowMs, ms);
    if (ageMin < staleAfterMinutes) {
      return { action: "skip_fresh", ageMinutes: ageMin, staleAfterMinutes };
    }
    if (hasRunningOrQueued(runs)) {
      return { action: "skip_busy", ageMinutes: ageMin, busyStatuses: runs.map((r) => r.status) };
    }
    return { action: "dispatch", ageMinutes: ageMin, reason: "stale_data" };
  }

  // Missing or invalid timestamp → treat as stale (prod must heal)
  if (hasRunningOrQueued(runs)) {
    return { action: "skip_busy", ageMinutes: NaN, busyStatuses: runs.map((r) => r.status) };
  }
  return { action: "dispatch", ageMinutes: NaN, reason: "missing_or_invalid_generatedAt" };
}
