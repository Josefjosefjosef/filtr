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

  it("dispatches slot_miss_uncovered when latest due slot has no covering sync", () => {
    // now=14:00; latest due past 180m is 09:17. Last success 06:00 is before 09:17 → uncovered.
    // staleAfter=480 so freshness path does not fire first (age from 06:00 = 480m exactly boundary).
    const d = decideCjCatalogWatchdog({
      generatedAt: "2026-11-12T06:00:00.000Z",
      nowMs: now,
      staleAfterMinutes: 481,
      slotDelayBudgetMinutes: 180,
      runs: [
        {
          status: "completed",
          conclusion: "success",
          created_at: "2026-11-12T06:00:00.000Z",
          event: "schedule",
        },
      ],
    });
    assert.equal(d.action, "dispatch");
    assert.equal(d.reason, "slot_miss_uncovered");
    if (d.action === "dispatch" && d.reason === "slot_miss_uncovered") {
      assert.equal(d.expectedSlotUtc, "2026-11-12T09:17:00.000Z");
    }
  });

  it("does not slot-dispatch when catch-up covered the latest due slot", () => {
    const d = decideCjCatalogWatchdog({
      generatedAt: "2026-11-12T10:00:00.000Z",
      nowMs: now,
      staleAfterMinutes: 480,
      slotDelayBudgetMinutes: 180,
      catchupCooldownMinutes: 30,
      runs: [
        {
          status: "completed",
          conclusion: "success",
          created_at: "2026-11-12T06:00:00.000Z",
          event: "schedule",
        },
        {
          status: "completed",
          conclusion: "success",
          created_at: "2026-11-12T10:05:00.000Z",
          event: "workflow_dispatch",
          display_title: "CATCHUP_DISPATCH_NOT_SCHEDULE 99",
        },
      ],
    });
    // 10:05 is after 09:17 → effective coverage; freshness age from 10:05 < 480 → not_stale
    assert.equal(d.action, "skip");
    assert.equal(d.reason, "not_stale");
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
