export type WatchdogDecision =
  | { action: "skip"; reason: "not_stale"; ageMinutes: number | null; staleAfterMinutes: number }
  | { action: "skip"; reason: "busy"; ageMinutes: number | null; staleAfterMinutes: number }
  | { action: "dispatch"; reason: "stale"; ageMinutes: number | null; staleAfterMinutes: number }
  | { action: "skip"; reason: "freshness_unavailable"; ageMinutes: null; staleAfterMinutes: number };

export function parseIsoToMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function decideWatchdog(input: {
  generatedAt: string | null;
  nowMs: number;
  staleAfterMinutes: number;
  runs: Array<{ status: string; conclusion: string | null }>;
}): WatchdogDecision {
  const staleAfterMinutes = Math.max(1, Number(input.staleAfterMinutes) || 8);
  const busy = (input.runs || []).some(
    (r) => r.status === "queued" || r.status === "in_progress" || r.status === "waiting" || r.status === "pending"
  );
  const genMs = parseIsoToMs(input.generatedAt);
  if (genMs == null) {
    return { action: "skip", reason: "freshness_unavailable", ageMinutes: null, staleAfterMinutes };
  }
  const ageMinutes = (input.nowMs - genMs) / 60_000;
  if (busy) {
    return { action: "skip", reason: "busy", ageMinutes, staleAfterMinutes };
  }
  if (ageMinutes >= staleAfterMinutes) {
    return { action: "dispatch", reason: "stale", ageMinutes, staleAfterMinutes };
  }
  return { action: "skip", reason: "not_stale", ageMinutes, staleAfterMinutes };
}
