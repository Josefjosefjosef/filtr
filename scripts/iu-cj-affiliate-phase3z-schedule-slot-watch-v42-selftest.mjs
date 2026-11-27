#!/usr/bin/env node
/**
 * Offline selftest for V42 schedule slot classification.
 */
import {
  classifyScheduleSlots,
  DELAY_BUDGET_MIN,
  EXPECTED_HOURS_UTC,
} from "./iu-cj-affiliate-phase3z-schedule-slot-watch-v42.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// After delay budget past 21:17 — both 18 and 21 are SLOT_MISS.
const now = new Date("2026-11-05T00:30:00.000Z");

// Fixture: only morning/afternoon schedule hits — evening slots miss.
const runs = [
  {
    id: 41876748735,
    created_at: "2026-11-04T17:21:00Z",
    conclusion: "success",
    head_sha: "4afa0b5c7179c8714407242bb0aa570437fdc995",
  },
  {
    id: 41816980256,
    created_at: "2026-11-04T10:51:38Z",
    conclusion: "failure",
    head_sha: "02a9a5ac9bf0af48f200f5ad1b2a175630e3675d",
  },
  {
    id: 41786898592,
    created_at: "2026-11-04T06:38:44Z",
    conclusion: "success",
    head_sha: "814d67c120bdd773c1d10367c120dc7c9aaa0d8d",
  },
];

const report = classifyScheduleSlots(runs, now, { delayBudgetMin: DELAY_BUDGET_MIN });

assert(report.schema === "iu-cj-affiliate-phase3z-schedule-slot-watch-v42", "schema");
assert(EXPECTED_HOURS_UTC.includes(18), "hour 18 expected");

const byHour = Object.fromEntries(report.slots.map((s) => [s.hour, s]));
assert(byHour[6]?.classification === "SLOT_DELAYED" || byHour[6]?.classification === "SLOT_HIT", "06 slot hit/delayed");
assert(byHour[15]?.classification === "SLOT_DELAYED" || byHour[15]?.classification === "SLOT_HIT", "15 slot hit/delayed");
assert(byHour[18]?.classification === "SLOT_MISS", "18 must be SLOT_MISS beyond delay budget");
assert(byHour[21]?.classification === "SLOT_MISS", "21 must be SLOT_MISS beyond delay budget");
assert(byHour[9]?.classification === "SLOT_FAILED", "09 failure is not a delivered slot");
assert(report.counts.miss >= 2, "multiple misses");
assert(report.watchResult === "FAIL", "multiple misses → FAIL (do not mask with 48h success)");
assert(report.burninStatus === "CADENCE_DEGRADED_MULTIPLE_SLOT_MISS", "burnin status");

// Dispatch-only must not fake schedule hits when empty schedule list.
const empty = classifyScheduleSlots([], now);
assert(empty.counts.hitOrDelayed === 0, "no hits without schedule runs");
assert(empty.observedScheduleCount === 0, "observed 0");

// Inside delay budget → PENDING_OBSERVATION not MISS
const midEvening = new Date("2026-11-04T22:32:00.000Z"); // 21:17 + 75m < 180
const mid = classifyScheduleSlots(runs, midEvening);
const m18 = mid.slots.find((s) => s.hour === 18);
const m21 = mid.slots.find((s) => s.hour === 21);
assert(m18?.classification === "SLOT_MISS", "18 at 22:32 → miss");
assert(m21?.classification === "PENDING_OBSERVATION", "21 within budget → pending");

const failedSlot = classifyScheduleSlots(
  [
    {
      id: 46036632928,
      created_at: "2026-11-27T16:48:01Z",
      conclusion: "failure",
      head_sha: "cd05359a3e42b1a5d61430f2f7692463fdd3d8e2",
    },
  ],
  new Date("2026-11-27T18:18:00.000Z")
);
const failed15 = failedSlot.slots.find((s) => s.hour === 15);
const pending18 = failedSlot.slots.find((s) => s.hour === 18);
assert(failed15?.classification === "SLOT_FAILED", "15:17 selftest failure is not a delivered slot");
assert(pending18?.classification === "PENDING_OBSERVATION", "18:17 stays pending inside the delay budget");
assert(failedSlot.counts.hitOrDelayed === 0, "a failed run is not a hit");
assert(failedSlot.watchResult === "FAIL", "a failed schedule slot fails the watch");

console.log("PASS iu-cj-affiliate-phase3z-schedule-slot-watch-v42-selftest");
console.log(
  JSON.stringify(
    {
      miss: report.counts.miss,
      watchResult: report.watchResult,
      slot18: byHour[18]?.classification,
      slot21: byHour[21]?.classification,
    },
    null,
    2
  )
);
