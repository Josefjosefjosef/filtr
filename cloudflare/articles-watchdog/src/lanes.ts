/**
 * Dual-lane watchdog: fast publishable_pool path + slow full pipeline path.
 */
import {
  decideWatchdog,
  DEFAULT_QUEUED_STALE_MINUTES,
  parseIsoToMs,
  type WatchdogDecision,
  type WorkflowRunLite,
} from "./decision";

export type LaneKind = "fast" | "slow";

export type LaneConfig = {
  kind: LaneKind;
  workflowFile: string;
  freshnessUrl: string;
  staleAfterMinutes: number;
};

export type LaneTelemetry = {
  lane: LaneKind;
  workflow_file: string;
  freshness_url: string;
  stale_after_minutes: number;
  generated_at: string | null;
  stale_minutes: number | null;
  dispatch_attempted: boolean;
  dispatched: boolean;
  skipped_busy: boolean;
  skipped_not_stale: boolean;
  decision: WatchdogDecision;
  blocking_run_ids: number[];
  zombie_queued_cancelled: number;
  dispatch_error: string | null;
};

export type DualDispatchTelemetry = {
  WATCHDOG_DUAL_DISPATCH_STATUS: "ok" | "partial" | "error";
  FAST_DISPATCH_ATTEMPTED: boolean;
  FAST_DISPATCHED: boolean;
  FAST_SKIPPED_BUSY: boolean;
  FAST_SKIPPED_NOT_STALE: boolean;
  FAST_STALE_MINUTES: number | null;
  SLOW_DISPATCH_ATTEMPTED: boolean;
  SLOW_DISPATCHED: boolean;
  SLOW_SKIPPED_BUSY: boolean;
  SLOW_STALE_MINUTES: number | null;
  lanes: LaneTelemetry[];
};

type GhRun = {
  status: string;
  event: string;
  conclusion: string | null;
  created_at: string;
  id?: number;
};

export type LaneDeps = {
  fetchGeneratedAt: (url: string) => Promise<string | null>;
  fetchWorkflowRuns: (workflowFile: string) => Promise<GhRun[]>;
  cancelStaleQueuedRuns: (workflowFile: string, queuedStaleMinutes: number) => Promise<number>;
  dispatchWorkflow: (workflowFile: string) => Promise<void>;
  nowMs?: number;
};

function toRunLite(run: GhRun): WorkflowRunLite {
  return { status: run.status, event: run.event, created_at: run.created_at };
}

function blockingRunIds(runs: GhRun[], nowMs: number): number[] {
  return runs
    .filter((r) => {
      if (r.status === "in_progress") return true;
      if (r.status !== "queued") return false;
      const createdMs = parseIsoToMs(r.created_at);
      if (createdMs === null) return true;
      return (nowMs - createdMs) / 60_000 < DEFAULT_QUEUED_STALE_MINUTES;
    })
    .map((r) => r.id)
    .filter((id): id is number => typeof id === "number");
}

export async function runLane(
  config: LaneConfig,
  deps: LaneDeps,
): Promise<LaneTelemetry> {
  const nowMs = deps.nowMs ?? Date.now();
  const zombieCancelled = await deps.cancelStaleQueuedRuns(
    config.workflowFile,
    DEFAULT_QUEUED_STALE_MINUTES,
  );

  const generatedAtIso = await deps.fetchGeneratedAt(config.freshnessUrl);
  const generatedMs = parseIsoToMs(generatedAtIso ?? undefined);
  const staleMinutes =
    generatedMs !== null ? (nowMs - generatedMs) / 60_000 : null;

  const runs = await deps.fetchWorkflowRuns(config.workflowFile);
  const decision = decideWatchdog({
    generatedAtIso,
    staleAfterMinutes: config.staleAfterMinutes,
    nowMs,
    runs: runs.map(toRunLite),
  });

  const telemetry: LaneTelemetry = {
    lane: config.kind,
    workflow_file: config.workflowFile,
    freshness_url: config.freshnessUrl,
    stale_after_minutes: config.staleAfterMinutes,
    generated_at: generatedAtIso,
    stale_minutes: staleMinutes,
    dispatch_attempted: true,
    dispatched: false,
    skipped_busy: decision.action === "skip_busy",
    skipped_not_stale: decision.action === "skip_fresh",
    decision,
    blocking_run_ids: blockingRunIds(runs, nowMs),
    zombie_queued_cancelled: zombieCancelled,
    dispatch_error: null,
  };

  if (decision.action === "dispatch") {
    try {
      await deps.dispatchWorkflow(config.workflowFile);
      telemetry.dispatched = true;
    } catch (e) {
      telemetry.dispatch_error = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  return telemetry;
}

export function buildDualTelemetry(lanes: LaneTelemetry[]): DualDispatchTelemetry {
  const fast = lanes.find((l) => l.lane === "fast");
  const slow = lanes.find((l) => l.lane === "slow");
  const anyError = lanes.some((l) => l.dispatch_error);
  const anyDispatch = lanes.some((l) => l.dispatched);

  return {
    WATCHDOG_DUAL_DISPATCH_STATUS: anyError ? "error" : anyDispatch ? "ok" : "partial",
    FAST_DISPATCH_ATTEMPTED: Boolean(fast?.dispatch_attempted),
    FAST_DISPATCHED: Boolean(fast?.dispatched),
    FAST_SKIPPED_BUSY: Boolean(fast?.skipped_busy),
    FAST_SKIPPED_NOT_STALE: Boolean(fast?.skipped_not_stale),
    FAST_STALE_MINUTES: fast?.stale_minutes ?? null,
    SLOW_DISPATCH_ATTEMPTED: Boolean(slow?.dispatch_attempted),
    SLOW_DISPATCHED: Boolean(slow?.dispatched),
    SLOW_SKIPPED_BUSY: Boolean(slow?.skipped_busy),
    SLOW_STALE_MINUTES: slow?.stale_minutes ?? null,
    lanes,
  };
}

export function resolveLaneConfigs(env: {
  FAST_WORKFLOW_FILE?: string;
  SLOW_WORKFLOW_FILE?: string;
  WORKFLOW_FILE?: string;
  FAST_FRESHNESS_URL?: string;
  FRESHNESS_URL?: string;
  SLOW_FRESHNESS_URL?: string;
  FAST_STALE_AFTER_MINUTES?: string;
  STALE_AFTER_MINUTES?: string;
  SLOW_STALE_AFTER_MINUTES?: string;
}): LaneConfig[] {
  const slowWorkflow = (env.SLOW_WORKFLOW_FILE || env.WORKFLOW_FILE || "update-articles.yml").trim();
  const fastWorkflow = (env.FAST_WORKFLOW_FILE || "update-articles-fast-pool.yml").trim();
  const slowFreshness = (env.SLOW_FRESHNESS_URL || env.FRESHNESS_URL || "").trim();
  const fastFreshness = (env.FAST_FRESHNESS_URL || "").trim();
  const slowStale = Number.parseInt(
    env.SLOW_STALE_AFTER_MINUTES || env.STALE_AFTER_MINUTES || "5",
    10,
  );
  const fastStale = Number.parseInt(env.FAST_STALE_AFTER_MINUTES || "15", 10);

  if (!slowFreshness) throw new Error("SLOW_FRESHNESS_URL or FRESHNESS_URL required");
  if (!fastFreshness) throw new Error("FAST_FRESHNESS_URL required");
  if (!Number.isFinite(slowStale) || slowStale < 1) throw new Error("Invalid SLOW_STALE_AFTER_MINUTES");
  if (!Number.isFinite(fastStale) || fastStale < 1) throw new Error("Invalid FAST_STALE_AFTER_MINUTES");

  return [
    {
      kind: "fast",
      workflowFile: fastWorkflow,
      freshnessUrl: fastFreshness,
      staleAfterMinutes: fastStale,
    },
    {
      kind: "slow",
      workflowFile: slowWorkflow,
      freshnessUrl: slowFreshness,
      staleAfterMinutes: slowStale,
    },
  ];
}
