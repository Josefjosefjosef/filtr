import { decideWatchdog } from "./decision.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("decideWatchdog", () => {
  const now = Date.parse("2026-07-31T14:00:00.000Z");

  it("dispatches when stale and idle", () => {
    const d = decideWatchdog({
      generatedAt: "2026-07-31T13:40:00.000Z",
      nowMs: now,
      staleAfterMinutes: 8,
      runs: [],
    });
    assert.equal(d.action, "dispatch");
    assert.equal(d.reason, "stale");
  });

  it("skips when not stale", () => {
    const d = decideWatchdog({
      generatedAt: "2026-07-31T13:55:00.000Z",
      nowMs: now,
      staleAfterMinutes: 8,
      runs: [],
    });
    assert.equal(d.action, "skip");
    assert.equal(d.reason, "not_stale");
  });

  it("skips when busy even if stale", () => {
    const d = decideWatchdog({
      generatedAt: "2026-07-31T13:40:00.000Z",
      nowMs: now,
      staleAfterMinutes: 8,
      runs: [{ status: "in_progress", conclusion: null }],
    });
    assert.equal(d.action, "skip");
    assert.equal(d.reason, "busy");
  });

  it("skips when freshness missing", () => {
    const d = decideWatchdog({
      generatedAt: null,
      nowMs: now,
      staleAfterMinutes: 8,
      runs: [],
    });
    assert.equal(d.action, "skip");
    assert.equal(d.reason, "freshness_unavailable");
  });
});
