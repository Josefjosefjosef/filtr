#!/usr/bin/env node
import {
  evaluateCircuitBreaker,
  evidenceFreshness,
  scheduleWatchdog,
  distinguishEndedVsPartial,
} from "./iu-cj-affiliate-phase3z-ops-guards-v9.mjs";

const failures = [];
function expect(id, cond) {
  if (!cond) failures.push(id);
}

const cbPartial = evaluateCircuitBreaker({
  previousJoinedCount: 175,
  nextJoinedCount: 10,
  partialSnapshot: true,
});
expect("cb_partial_keep_lkg", cbPartial.trip === true && cbPartial.action === "KEEP_LKG_NO_MASS_DELETE");

const cbMass = evaluateCircuitBreaker({
  previousJoinedCount: 175,
  nextJoinedCount: 50,
  confirmedEndedIds: [],
  partialSnapshot: false,
});
expect("cb_mass_trip", cbMass.trip === true);

const cbOk = evaluateCircuitBreaker({
  previousJoinedCount: 175,
  nextJoinedCount: 174,
  confirmedEndedIds: ["1"],
  partialSnapshot: false,
});
expect("cb_ok", cbOk.trip === false);

const fresh = evidenceFreshness({ lastReviewedAt: new Date().toISOString(), maxAgeHours: 168 });
expect("evidence_fresh", fresh.fresh === true);

const stale = evidenceFreshness({
  lastReviewedAt: new Date(Date.now() - 400 * 3600000).toISOString(),
  maxAgeHours: 168,
});
expect("evidence_stale", stale.fresh === false);

const wd = scheduleWatchdog({ lastScheduleSuccessAt: null });
expect("schedule_pending", wd.status === "PENDING");

const ended = distinguishEndedVsPartial({
  missingFromSnapshotIds: ["a", "b"],
  confirmedEndedIds: ["a"],
});
expect("ended_vs_partial", ended.treatAsEnded.length === 1 && ended.treatAsPartial[0] === "b");

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, IU_CJ_PHASE3Z_OPS_GUARDS_SELFTEST: "OK" }));
