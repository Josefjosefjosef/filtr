/**
 * Durable decision provenance for CJ catalog-sync watchdog.
 * No KV/R2 bindings exist on this worker — durable chain is:
 *   decisionId → workflow_dispatch input + run-name → GitHub Actions run/logs
 * plus structured REPORT (Workers observability + /probe HTTP body).
 * Does NOT reclassify historical runs as WATCHDOG_RECOVERY_CONFIRMED.
 */

import type { CjWatchdogDecision } from "./decision.ts";

export const PROVENANCE_SCHEMA = "iu-cj-catalog-sync-watchdog-decision-provenance-v1";

/** Prefix embedded in GHA run-name for audit grep / linkage. */
export const WD_RUN_NAME_MARKER = "wd=";

export type DispatchStatus =
  | "not_attempted"
  | "skipped"
  | "observe_only"
  | "dispatched_ok"
  | "dispatch_failed";

export type ProductionReadback = {
  generatedAt: string | null;
  ageMinutes: number | null;
  observedAt: string | null;
} | null;

/**
 * One decision cycle's provenance. Nullable fields stay null when unknown
 * (fail-closed honesty — never invent githubRunId / promotion / readback).
 */
export type WatchdogDecisionProvenance = {
  schema: typeof PROVENANCE_SCHEMA;
  decisionId: string;
  time: string;
  reason: string | null;
  detectedState: string | null;
  slaDeadline: string | null;
  dispatchStatus: DispatchStatus | null;
  githubRunId: number | null;
  sha: string | null;
  result: string | null;
  promotionDecision: string | null;
  productionReadback: ProductionReadback;
};

export type BuildProvenanceInput = {
  decisionId: string;
  timeIso: string;
  decision: CjWatchdogDecision | { action: string; reason: string; ageMinutes?: number | null };
  dispatchStatus: DispatchStatus;
  githubRunId?: number | null;
  sha?: string | null;
  result?: string | null;
  promotionDecision?: string | null;
  productionReadback?: ProductionReadback;
  /** Minutes after decision time when recovery SLA is considered due (default 180). */
  slaBudgetMinutes?: number;
};

/** Stable-ish unique id: time + random (crypto when available). */
export function createDecisionId(nowMs: number = Date.now()): string {
  const t = new Date(nowMs).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  let rand = Math.floor(Math.random() * 0x100000000)
    .toString(16)
    .padStart(8, "0");
  try {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const buf = new Uint8Array(4);
      crypto.getRandomValues(buf);
      rand = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    /* keep Math.random fallback */
  }
  return `cjwd_${t}_${rand}`;
}

export function computeSlaDeadline(
  timeIso: string,
  slaBudgetMinutes: number = 180,
): string | null {
  const ms = Date.parse(timeIso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + Math.max(1, slaBudgetMinutes) * 60_000).toISOString();
}

export function detectedStateFromDecision(
  decision: { action: string; reason: string },
): string {
  return `${decision.action}:${decision.reason}`;
}

export function buildProvenance(input: BuildProvenanceInput): WatchdogDecisionProvenance {
  const decision = input.decision;
  return {
    schema: PROVENANCE_SCHEMA,
    decisionId: input.decisionId,
    time: input.timeIso,
    reason: decision && "reason" in decision ? String(decision.reason) : null,
    detectedState: decision ? detectedStateFromDecision(decision as { action: string; reason: string }) : null,
    slaDeadline: computeSlaDeadline(input.timeIso, input.slaBudgetMinutes ?? 180),
    dispatchStatus: input.dispatchStatus ?? null,
    githubRunId: input.githubRunId ?? null,
    sha: input.sha ?? null,
    result: input.result ?? null,
    promotionDecision: input.promotionDecision ?? null,
    productionReadback: input.productionReadback ?? null,
  };
}

/** Extract decisionId from GHA run display_title / name (wd=<id>). */
export function extractDecisionIdFromRunTitle(
  title: string | null | undefined,
): string | null {
  const s = String(title || "");
  const m = s.match(/\bwd=(cjwd_[A-Za-z0-9._-]+)/);
  return m ? m[1] : null;
}

/**
 * After workflow_dispatch (204), find the newest catch-up run that embeds our decisionId
 * in display_title, or the newest catch-up created at/after dispatchStartedMs.
 * Returns null if unproven — never guess.
 */
export function resolveGithubRunIdFromRuns(input: {
  runs: Array<{
    id?: number | string;
    created_at?: string;
    event?: string;
    display_title?: string;
    name?: string;
    displayTitle?: string;
  }>;
  decisionId: string;
  dispatchStartedMs: number;
  /** Allow clock skew / API lag (default 120s before dispatch). */
  lookbackMs?: number;
}): number | null {
  const lookback = Number.isFinite(input.lookbackMs) ? Number(input.lookbackMs) : 120_000;
  const floor = input.dispatchStartedMs - lookback;
  const candidates = (input.runs || [])
    .map((r) => {
      const idRaw = r.id;
      const id = typeof idRaw === "number" ? idRaw : Number(idRaw);
      const created = Date.parse(String(r.created_at || ""));
      const title = String(r.display_title || r.name || r.displayTitle || "");
      const event = String(r.event || "");
      return { id, created, title, event };
    })
    .filter((r) => Number.isFinite(r.id) && Number.isFinite(r.created) && r.event === "workflow_dispatch");

  const byId = candidates.find((r) => extractDecisionIdFromRunTitle(r.title) === input.decisionId);
  if (byId) return byId.id;

  // Without wd= in title yet (race before run-name lands), do not invent a match
  // from time alone — require CATCHUP marker AND decisionId substring if present in title,
  // else null (githubRunId stays unknown until a later observe cycle).
  const withMarker = candidates
    .filter((r) => r.created >= floor)
    .filter((r) => r.title.includes("CATCHUP_DISPATCH_NOT_SCHEDULE") || /\bCATCHUP\b/i.test(r.title))
    .filter((r) => r.title.includes(input.decisionId))
    .sort((a, b) => b.created - a.created);
  if (withMarker[0]) return withMarker[0].id;
  return null;
}

export function dispatchStatusForCycle(input: {
  action: string;
  allowMutations: boolean;
  dispatch: { ok: boolean } | null;
}): DispatchStatus {
  if (input.action !== "dispatch") return "skipped";
  if (!input.allowMutations) return "observe_only";
  if (!input.dispatch) return "not_attempted";
  return input.dispatch.ok ? "dispatched_ok" : "dispatch_failed";
}
