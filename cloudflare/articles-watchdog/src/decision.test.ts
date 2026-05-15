import { describe, expect, it } from "vitest";
import {
  ageMinutes,
  decideWatchdog,
  hasRunningOrQueued,
  parseIsoToMs,
} from "./decision";

describe("parseIsoToMs", () => {
  it("parses Zulu ISO", () => {
    const ms = parseIsoToMs("2026-04-06T00:35:35.002848Z");
    expect(ms).toBe(Date.parse("2026-04-06T00:35:35.002848Z"));
  });
  it("returns null for empty", () => {
    expect(parseIsoToMs("")).toBeNull();
    expect(parseIsoToMs(null)).toBeNull();
  });
});

describe("hasRunningOrQueued", () => {
  it("is true when queued", () => {
    expect(hasRunningOrQueued([{ status: "queued" }])).toBe(true);
  });
  it("is true when in_progress", () => {
    expect(hasRunningOrQueued([{ status: "in_progress" }])).toBe(true);
  });
  it("is false when only completed", () => {
    expect(hasRunningOrQueued([{ status: "completed" }])).toBe(false);
  });
});

describe("decideWatchdog", () => {
  const base = new Date("2026-04-06T12:00:00.000Z").getTime();

  it("skip_fresh when age < staleAfterMinutes", () => {
    const gen = new Date(base - 5 * 60_000).toISOString(); // 5 min ago
    const d = decideWatchdog({
      generatedAtIso: gen,
      staleAfterMinutes: 10,
      nowMs: base,
      runs: [],
    });
    expect(d.action).toBe("skip_fresh");
  });

  it("dispatch when stale and idle", () => {
    const gen = new Date(base - 20 * 60_000).toISOString();
    const d = decideWatchdog({
      generatedAtIso: gen,
      staleAfterMinutes: 10,
      nowMs: base,
      runs: [{ status: "completed" }],
    });
    expect(d.action).toBe("dispatch");
    if (d.action === "dispatch") expect(d.reason).toBe("stale_data");
  });

  it("skip_busy when stale but queued", () => {
    const gen = new Date(base - 20 * 60_000).toISOString();
    const d = decideWatchdog({
      generatedAtIso: gen,
      staleAfterMinutes: 10,
      nowMs: base,
      runs: [{ status: "queued" }],
    });
    expect(d.action).toBe("skip_busy");
  });

  it("skip_busy when a newer run is queued (duplicate tick)", () => {
    const gen = new Date(base - 20 * 60_000).toISOString();
    const d = decideWatchdog({
      generatedAtIso: gen,
      staleAfterMinutes: 10,
      nowMs: base,
      runs: [
        { status: "completed" },
        { status: "queued" },
      ],
    });
    expect(d.action).toBe("skip_busy");
  });

  it("dispatch when timestamp missing and idle", () => {
    const d = decideWatchdog({
      generatedAtIso: null,
      staleAfterMinutes: 10,
      nowMs: base,
      runs: [{ status: "completed" }],
    });
    expect(d.action).toBe("dispatch");
    if (d.action === "dispatch") expect(d.reason).toBe("missing_or_invalid_generatedAt");
  });

  it("skip_busy when timestamp missing but run in progress", () => {
    const d = decideWatchdog({
      generatedAtIso: null,
      staleAfterMinutes: 10,
      nowMs: base,
      runs: [{ status: "in_progress" }],
    });
    expect(d.action).toBe("skip_busy");
  });
});

describe("ageMinutes", () => {
  it("computes delta", () => {
    const now = Date.parse("2026-04-06T12:10:00.000Z");
    const gen = Date.parse("2026-04-06T12:00:00.000Z");
    expect(ageMinutes(now, gen)).toBeCloseTo(10, 5);
  });
});
