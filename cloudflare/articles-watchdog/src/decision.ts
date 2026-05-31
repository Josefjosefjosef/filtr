/**
 * Pure watchdog policy (unit-tested). Worker I/O lives in index.ts.
 */

export type WorkflowRunLite = { status: string; event?: string; created_at?: string };

export type WatchdogDecision =
  | { action: "skip_fresh"; ageMinutes: number; staleAfterMinutes: number }
  | { action: "skip_busy"; ageMinutes: number; busyStatuses: string[] }
  | { action: "dispatch"; ageMinutes: number; reason: string };

/** Queued runs older than this are treated as dead (GitHub concurrency zombie). */
export const DEFAULT_QUEUED_STALE_MINUTES = 120;

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

export function isBlockingRun(
  run: WorkflowRunLite,
  nowMs: number,
  queuedStaleMinutes: number,
): boolean {
  if (run.status === "in_progress") return true;
  if (run.status !== "queued") return false;
  const createdMs = parseIsoToMs(run.created_at);
  if (createdMs === null) return true;
  return ageMinutes(nowMs, createdMs) < queuedStaleMinutes;
}

export function hasBlockingRuns(
  runs: WorkflowRunLite[],
  nowMs: number,
  queuedStaleMinutes: number = DEFAULT_QUEUED_STALE_MINUTES,
): boolean {
  return runs.some((r) => isBlockingRun(r, nowMs, queuedStaleMinutes));
}

/**
 * Stale or missing public timestamp → may dispatch. Fresh → skip.
 * Duplicate protection: in_progress or recently queued runs block dispatch.
 * Ancient queued runs (concurrency zombies) do not block — allows pipeline recovery.
 */
export function decideWatchdog(input: {
  generatedAtIso: string | null | undefined;
  staleAfterMinutes: number;
  nowMs: number;
  runs: WorkflowRunLite[];
  queuedStaleMinutes?: number;
}): WatchdogDecision {
  const { staleAfterMinutes, nowMs, runs } = input;
  const queuedStaleMinutes = input.queuedStaleMinutes ?? DEFAULT_QUEUED_STALE_MINUTES;
  const ms = parseIsoToMs(input.generatedAtIso ?? undefined);
  const blocking = runs.filter((r) => isBlockingRun(r, nowMs, queuedStaleMinutes));
  const busyStatuses = blocking.map((r) => r.status);

  if (ms !== null) {
    const ageMin = ageMinutes(nowMs, ms);
    if (ageMin < staleAfterMinutes) {
      return { action: "skip_fresh", ageMinutes: ageMin, staleAfterMinutes };
    }
    if (blocking.length > 0) {
      return { action: "skip_busy", ageMinutes: ageMin, busyStatuses };
    }
    return { action: "dispatch", ageMinutes: ageMin, reason: "stale_data" };
  }

  // Missing or invalid timestamp → treat as stale (prod must heal)
  if (blocking.length > 0) {
    return { action: "skip_busy", ageMinutes: NaN, busyStatuses };
  }
  return { action: "dispatch", ageMinutes: NaN, reason: "missing_or_invalid_generatedAt" };
}
