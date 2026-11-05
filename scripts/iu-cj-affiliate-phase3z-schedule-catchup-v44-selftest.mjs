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
  recentCatalogRuns: [{ event: "workflow_dispatch", created_at: "2026-11-05T01:00:00Z" }],
  maxCatchupsPerUtcDay: 1,
});
assert(denyDayCap.allow === false && denyDayCap.reason === "MAX_CATCHUPS_PER_UTC_DAY", "day cap");

const denyCooldown = decideScheduleCatchup({
  now,
  catalogInProgressCount: 0,
  slotReport: { counts: { miss: 1 }, slots: [{ classification: "SLOT_MISS", hour: 3 }] },
  // Same UTC day but under day-cap=2; age 2h < cooldown 3h → CATCHUP_COOLDOWN.
  recentCatalogRuns: [{ event: "workflow_dispatch", created_at: "2026-11-05T05:00:00Z" }],
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
assert(MAX_CATCHUPS_PER_UTC_DAY === 1, "default day cap");

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
