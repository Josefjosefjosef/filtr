import { describe, expect, it, vi } from "vitest";
import {
  buildDualTelemetry,
  resolveLaneConfigs,
  runLane,
  type LaneDeps,
} from "./lanes";

describe("resolveLaneConfigs", () => {
  it("resolves fast and slow lanes from env", () => {
    const lanes = resolveLaneConfigs({
      FAST_WORKFLOW_FILE: "update-articles-fast-pool.yml",
      SLOW_WORKFLOW_FILE: "update-articles.yml",
      FAST_FRESHNESS_URL: "https://example.com/publishable_pool.json",
      FRESHNESS_URL: "https://example.com/articles/index.json",
      FAST_STALE_AFTER_MINUTES: "15",
      STALE_AFTER_MINUTES: "5",
    });
    expect(lanes).toHaveLength(2);
    expect(lanes[0].kind).toBe("fast");
    expect(lanes[0].staleAfterMinutes).toBe(15);
    expect(lanes[1].kind).toBe("slow");
    expect(lanes[1].staleAfterMinutes).toBe(5);
  });
});

describe("runLane", () => {
  const base = new Date("2026-06-09T12:00:00.000Z").getTime();
  const staleGen = new Date(base - 20 * 60_000).toISOString();

  function deps(overrides: Partial<LaneDeps> = {}): LaneDeps {
    return {
      fetchGeneratedAt: vi.fn(async () => staleGen),
      fetchWorkflowRuns: vi.fn(async () => []),
      cancelStaleQueuedRuns: vi.fn(async () => 0),
      dispatchWorkflow: vi.fn(async () => undefined),
      nowMs: base,
      ...overrides,
    };
  }

  it("dispatches fast lane when stale and idle", async () => {
    const d = deps();
    const lane = await runLane(
      {
        kind: "fast",
        workflowFile: "update-articles-fast-pool.yml",
        freshnessUrl: "https://example.com/publishable_pool.json",
        staleAfterMinutes: 15,
      },
      d,
    );
    expect(lane.dispatched).toBe(true);
    expect(lane.skipped_not_stale).toBe(false);
    expect(d.dispatchWorkflow).toHaveBeenCalledWith("update-articles-fast-pool.yml");
  });

  it("skips fast lane when fresh", async () => {
    const freshGen = new Date(base - 5 * 60_000).toISOString();
    const d = deps({
      fetchGeneratedAt: vi.fn(async () => freshGen),
    });
    const lane = await runLane(
      {
        kind: "fast",
        workflowFile: "update-articles-fast-pool.yml",
        freshnessUrl: "https://example.com/publishable_pool.json",
        staleAfterMinutes: 15,
      },
      d,
    );
    expect(lane.dispatched).toBe(false);
    expect(lane.skipped_not_stale).toBe(true);
    expect(d.dispatchWorkflow).not.toHaveBeenCalled();
  });

  it("skips when busy without affecting other lane concurrency scope", async () => {
    const d = deps({
      fetchWorkflowRuns: vi.fn(async () => [{ status: "in_progress", created_at: staleGen }]),
    });
    const lane = await runLane(
      {
        kind: "slow",
        workflowFile: "update-articles.yml",
        freshnessUrl: "https://example.com/articles/index.json",
        staleAfterMinutes: 5,
      },
      d,
    );
    expect(lane.dispatched).toBe(false);
    expect(lane.skipped_busy).toBe(true);
  });
});

describe("buildDualTelemetry", () => {
  it("maps lane telemetry to required fields", () => {
    const t = buildDualTelemetry([
      {
        lane: "fast",
        workflow_file: "update-articles-fast-pool.yml",
        freshness_url: "https://x/publishable_pool.json",
        stale_after_minutes: 15,
        generated_at: "2026-06-09T11:00:00Z",
        stale_minutes: 18,
        dispatch_attempted: true,
        dispatched: true,
        skipped_busy: false,
        skipped_not_stale: false,
        decision: { action: "dispatch", ageMinutes: 18, reason: "stale_data" },
        blocking_run_ids: [],
        zombie_queued_cancelled: 0,
        dispatch_error: null,
      },
      {
        lane: "slow",
        workflow_file: "update-articles.yml",
        freshness_url: "https://x/articles/index.json",
        stale_after_minutes: 5,
        generated_at: "2026-06-09T11:55:00Z",
        stale_minutes: 3,
        dispatch_attempted: true,
        dispatched: false,
        skipped_busy: false,
        skipped_not_stale: true,
        decision: { action: "skip_fresh", ageMinutes: 3, staleAfterMinutes: 5 },
        blocking_run_ids: [],
        zombie_queued_cancelled: 0,
        dispatch_error: null,
      },
    ]);
    expect(t.FAST_DISPATCHED).toBe(true);
    expect(t.FAST_STALE_MINUTES).toBe(18);
    expect(t.SLOW_DISPATCHED).toBe(false);
    expect(t.SLOW_SKIPPED_BUSY).toBe(false);
    expect(t.WATCHDOG_DUAL_DISPATCH_STATUS).toBe("ok");
  });
});
