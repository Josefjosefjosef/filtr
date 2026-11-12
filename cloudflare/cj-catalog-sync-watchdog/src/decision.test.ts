import { decideCjCatalogWatchdog, isCatchupDispatchRun } from "./decision.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("decideCjCatalogWatchdog", () => {
  const now = Date.parse("2026-11-12T14:00:00.000Z");

  it("dispatches when last success older than stale window", () => {
    const d = decideCjCatalogWatchdog({
      generatedAt: "2026-11-12T08:00:00.000Z",
      nowMs: now,
      staleAfterMinutes: 240,
      runs: [
        {
          status: "completed",
          conclusion: "success",
          created_at: "2026-11-12T08:00:00.000Z",
          event: "schedule",
        },
      ],
    });
    assert.equal(d.action, "dispatch");
    assert.equal(d.reason, "stale");
  });

  it("skips when recent success", () => {
    const d = decideCjCatalogWatchdog({
      generatedAt: "2026-11-12T13:00:00.000Z",
      nowMs: now,
      staleAfterMinutes: 240,
      runs: [
        {
          status: "completed",
          conclusion: "success",
          created_at: "2026-11-12T13:00:00.000Z",
          event: "schedule",
        },
      ],
    });
    assert.equal(d.action, "skip");
    assert.equal(d.reason, "not_stale");
  });

  it("skips when busy even if stale", () => {
    const d = decideCjCatalogWatchdog({
      generatedAt: "2026-11-12T08:00:00.000Z",
      nowMs: now,
      staleAfterMinutes: 240,
      runs: [{ status: "in_progress", conclusion: null, created_at: "2026-11-12T13:55:00.000Z" }],
    });
    assert.equal(d.action, "skip");
    assert.equal(d.reason, "busy");
  });

  it("skips during catch-up cooldown", () => {
    const d = decideCjCatalogWatchdog({
      generatedAt: "2026-11-12T08:00:00.000Z",
      nowMs: now,
      staleAfterMinutes: 240,
      catchupCooldownMinutes: 60,
      runs: [
        {
          status: "completed",
          conclusion: "success",
          created_at: "2026-11-12T08:00:00.000Z",
          event: "schedule",
        },
        {
          status: "completed",
          conclusion: "success",
          created_at: "2026-11-12T13:30:00.000Z",
          event: "workflow_dispatch",
          display_title: "CATCHUP_DISPATCH_NOT_SCHEDULE 1",
        },
      ],
    });
    assert.equal(d.action, "skip");
    assert.equal(d.reason, "catchup_cooldown");
  });

  it("skips when daycap exhausted", () => {
    const runs = [
      {
        status: "completed",
        conclusion: "success",
        created_at: "2026-11-12T08:00:00.000Z",
        event: "schedule",
      },
    ];
    for (let i = 0; i < 4; i++) {
      runs.push({
        status: "completed",
        conclusion: "success",
        created_at: `2026-11-12T0${i}:00:00.000Z`,
        event: "workflow_dispatch",
        display_title: `CATCHUP_DISPATCH_NOT_SCHEDULE ${i}`,
      });
    }
    const d = decideCjCatalogWatchdog({
      generatedAt: "2026-11-12T08:00:00.000Z",
      nowMs: now,
      staleAfterMinutes: 240,
      catchupCooldownMinutes: 1,
      maxCatchupsPerUtcDay: 4,
      runs,
    });
    assert.equal(d.action, "skip");
    assert.equal(d.reason, "max_catchups_per_utc_day");
  });

  it("skips when freshness unavailable", () => {
    const d = decideCjCatalogWatchdog({
      generatedAt: null,
      nowMs: now,
      staleAfterMinutes: 240,
      runs: [],
    });
    assert.equal(d.action, "skip");
    assert.equal(d.reason, "freshness_unavailable");
  });
});

describe("isCatchupDispatchRun", () => {
  it("detects catch-up marker", () => {
    assert.equal(
      isCatchupDispatchRun({
        event: "workflow_dispatch",
        display_title: "CATCHUP_DISPATCH_NOT_SCHEDULE 99",
      }),
      true,
    );
    assert.equal(isCatchupDispatchRun({ event: "schedule", display_title: "CJ catalog sync" }), false);
  });
});
