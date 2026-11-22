#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  appendObservationEvent,
  emptyObservationLedger,
  evaluateObservationWindow,
} from "./iu-cj-affiliate-phase3z-48h-observation-ledger-v51-8.mjs";

let doc = emptyObservationLedger({ anchorSha: "abc" });
assert.equal(evaluateObservationWindow(doc).reason, "WINDOW_NOT_STARTED");

doc = appendObservationEvent(doc, {
  at: "2026-11-21T23:26:40.000Z",
  eventName: "schedule",
  conclusion: "success",
  runId: "1",
  headSha: "sha1",
});
assert.equal(doc.startedAt, "2026-11-21T23:26:40.000Z");
assert.equal(evaluateObservationWindow(doc, { nowIso: "2026-11-22T12:00:00.000Z" }).complete, false);
assert.equal(
  evaluateObservationWindow(doc, { nowIso: "2026-11-22T12:00:00.000Z" }).reason,
  "PENDING_48H_ELAPSED",
);

doc = appendObservationEvent(doc, {
  at: "2026-11-22T07:01:56.000Z",
  eventName: "schedule",
  conclusion: "success",
  runId: "2",
});
doc = appendObservationEvent(doc, {
  at: "2026-11-22T17:13:15.000Z",
  eventName: "schedule",
  conclusion: "failure",
  offersLiveSync: "failure",
  runId: "3",
});
const mid = evaluateObservationWindow(doc, { nowIso: "2026-11-24T00:00:00.000Z" });
assert.equal(mid.complete, false);
assert.equal(mid.reason, "CRITICAL_SCHEDULE_FAILURES_IN_WINDOW");

let clean = emptyObservationLedger();
clean = appendObservationEvent(clean, {
  at: "2026-11-20T00:00:00.000Z",
  eventName: "schedule",
  conclusion: "success",
  runId: "a",
});
clean = appendObservationEvent(clean, {
  at: "2026-11-20T12:00:00.000Z",
  eventName: "schedule",
  conclusion: "success",
  runId: "b",
});
const done = evaluateObservationWindow(clean, { nowIso: "2026-11-22T01:00:00.000Z" });
assert.equal(done.complete, true);
assert.equal(done.reason, "OBSERVATION_48H_CLEAN");

console.log(JSON.stringify({ IU_CJ_48H_OBSERVATION_LEDGER_SELFTEST: "PASS" }));
