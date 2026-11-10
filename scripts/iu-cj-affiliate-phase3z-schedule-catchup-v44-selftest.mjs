import {
  decideScheduleCatchup,
  decideGapDeepen,
  CATCHUP_COOLDOWN_HOURS,
  MAX_CATCHUPS_PER_UTC_DAY,
} from "./iu-cj-affiliate-phase3z-schedule-catchup-v44.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const now = new Date("2026-11-05T07:00:00Z");

const denyInProg = decideScheduleCatchup({
  now,
  catalogInProgressCount: 1,
  slotReport: { counts: { miss: 2 }, slots: [{ classification: "SLOT_MISS", hour: 0 }] },
});
assert(denyInProg.allow === false && denyInProg.reason === "CATALOG_IN_PROGRESS", "in-progress");

const denyNoMiss = decideScheduleCatchup({
  now,
  catalogInProgressCount: 0,
  slotReport: { counts: { miss: 0, pending: 2 }, slots: [{ classification: "PENDING_OBSERVATION" }] },
});
assert(denyNoMiss.allow === false && denyNoMiss.reason === "NO_SLOT_MISS", "no miss");

const denyDayCap = decideScheduleCatchup({
  now,
  catalogInProgressCount: 0,
  slotReport: { counts: { miss: 2 }, slots: [{ classification: "SLOT_MISS", hour: 0, expectedUtc: "2026-11-05T00:17:00Z" }] },
  recentCatalogRuns: [
    {
      event: "workflow_dispatch",
      created_at: "2026-11-05T01:00:00Z",
      display_title: "CATCHUP_DISPATCH_NOT_SCHEDULE refresh",
      catchup_dispatch: "1",
    },
  ],
  maxCatchupsPerUtcDay: 1,
});
assert(denyDayCap.allow === false && denyDayCap.reason === "MAX_CATCHUPS_PER_UTC_DAY", "day cap");

// Diagnostic / maintenance dispatch must NOT consume catch-up budget (#13843 aftermath).
const allowAfterDiagnostic = decideScheduleCatchup({
  now,
  catalogInProgressCount: 0,
  slotReport: { counts: { miss: 2 }, slots: [{ classification: "SLOT_MISS", hour: 0, expectedUtc: "2026-11-05T00:17:00Z" }] },
  recentCatalogRuns: [
    {
      event: "workflow_dispatch",
      created_at: "2026-11-05T01:00:00Z",
      display_title: "CJ Affiliate catalog sync (fetch ? publish)",
    },
  ],
  maxCatchupsPerUtcDay: 1,
});
assert(allowAfterDiagnostic.allow === true, "diagnostic dispatch ignored for catch-up cap");

const denyCooldown = decideScheduleCatchup({
  now,
  catalogInProgressCount: 0,
  slotReport: { counts: { miss: 1 }, slots: [{ classification: "SLOT_MISS", hour: 3 }] },
  // Same UTC day but under day-cap=2; age 2h < cooldown 3h → CATCHUP_COOLDOWN.
  recentCatalogRuns: [
    {
      event: "workflow_dispatch",
      created_at: "2026-11-05T05:00:00Z",
      display_title: "CATCHUP_DISPATCH_NOT_SCHEDULE",
      catchup_dispatch: "1",
    },
  ],
  cooldownHours: CATCHUP_COOLDOWN_HOURS,
  maxCatchupsPerUtcDay: 2,
});
assert(denyCooldown.allow === false && denyCooldown.reason === "CATCHUP_COOLDOWN", "cooldown");

const allow = decideScheduleCatchup({
  now,
  catalogInProgressCount: 0,
  slotReport: {
    counts: { miss: 2 },
    slots: [
      { classification: "SLOT_MISS", hour: 0, expectedUtc: "2026-11-05T00:17:00Z" },
      { classification: "SLOT_MISS", hour: 3, expectedUtc: "2026-11-05T03:17:00Z" },
    ],
  },
  recentCatalogRuns: [
    { event: "schedule", created_at: "2026-11-04T23:45:07Z" },
    { event: "workflow_dispatch", created_at: "2026-11-03T12:00:00Z" },
  ],
});
assert(allow.allow === true, "allow catchup");
assert(allow.mode === "refresh_priority", "mode");
assert(allow.eventLabel === "CATCHUP_DISPATCH_NOT_SCHEDULE", "label");
assert(allow.missedSlots.length === 2, "missed slots");
assert(MAX_CATCHUPS_PER_UTC_DAY === 2, "default day cap");

// Second catch-up same UTC day allowed after cooldown when day-cap is 2
// (covers multi-slot GitHub scheduler misses without unlimited runs).
const allowSecond = decideScheduleCatchup({
  now: new Date("2026-11-05T10:00:00Z"),
  catalogInProgressCount: 0,
  slotReport: { counts: { miss: 1 }, slots: [{ classification: "SLOT_MISS", hour: 9, expectedUtc: "2026-11-05T09:17:00Z" }] },
  recentCatalogRuns: [
    {
      event: "workflow_dispatch",
      created_at: "2026-11-05T03:51:00Z",
      display_title: "CATCHUP_DISPATCH_NOT_SCHEDULE",
      catchup_dispatch: "1",
    },
  ],
});
assert(allowSecond.allow === true && allowSecond.reason === "SLOT_MISS_BOUNDED_CATCHUP", "second catchup after cooldown");

const denySecondCap = decideScheduleCatchup({
  now: new Date("2026-11-05T14:00:00Z"),
  catalogInProgressCount: 0,
  slotReport: { counts: { miss: 1 }, slots: [{ classification: "SLOT_MISS", hour: 12, expectedUtc: "2026-11-05T12:17:00Z" }] },
  recentCatalogRuns: [
    {
      event: "workflow_dispatch",
      created_at: "2026-11-05T03:51:00Z",
      display_title: "CATCHUP_DISPATCH_NOT_SCHEDULE",
      catchup_dispatch: "1",
    },
    {
      event: "workflow_dispatch",
      created_at: "2026-11-05T10:05:00Z",
      display_title: "CATCHUP_DISPATCH_NOT_SCHEDULE",
      catchup_dispatch: "1",
    },
  ],
});
assert(denySecondCap.allow === false && denySecondCap.reason === "MAX_CATCHUPS_PER_UTC_DAY", "day cap at 2");

const gapNo = decideGapDeepen({
  eventName: "schedule",
  scheduleExpr: "17 6 * * *",
  latestScheduleAgeHours: 2,
});
assert(gapNo.deepen === false, "small gap");

const gapYes = decideGapDeepen({
  eventName: "schedule",
  scheduleExpr: "17 6 * * *",
  latestScheduleAgeHours: 7,
});
assert(gapYes.deepen === true && gapYes.productMaxPages === 3, "deepen");

const gapDaily = decideGapDeepen({
  eventName: "schedule",
  scheduleExpr: "17 3 * * *",
  latestScheduleAgeHours: 30,
});
assert(gapDaily.deepen === false && gapDaily.reason === "DAILY_FULL_ALREADY", "daily full");

console.log("PASS iu-cj-affiliate-phase3z-schedule-catchup-v44-selftest");
