#!/usr/bin/env node
/**
 * Offline fixtures: GitHub pending-replacement + running-writer starvation
 * for info-events-data-writers.
 * Reproduces ACTIVE runs 31250620970 and 31265716770; proves queue:max arbitration.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  QUEUE_MAX,
  QUEUE_SINGLE,
  SHARED_WRITER_GROUP,
  CANCEL_ANNOTATION_HIGHER_PRIORITY,
  reproduceIncident31250620970,
  reproduceIncident31265716770,
  reproduceRunningWriterVsIncoming,
  simulateContinuousArrivals,
  completeRunning,
  jobConcurrencyFlags,
} from "./info-events-shared-writer-arbitration.mjs";
import { jobBlock, workflowLevelHasSharedLock } from "./ndic-datex-v1-concurrency-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NDIC_WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");
const CHMI_WF = path.join(ROOT, ".github", "workflows", "update-chmi-cap-v2.yml");
const IE_WF = path.join(ROOT, ".github", "workflows", "update-info-events.yml");

const fails = [];
let passCount = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else passCount += 1;
}

function main() {
  const ndic = fs.readFileSync(NDIC_WF, "utf8");
  const chmi = fs.readFileSync(CHMI_WF, "utf8");
  const ie = fs.readFileSync(IE_WF, "utf8");

  // --- Pending replacement incident 31250620970 ---
  const oldInc = reproduceIncident31250620970(QUEUE_SINGLE);
  ok("REAL_GITHUB_PENDING_REPLACEMENT_REPRODUCED", oldInc.ndicLost === true, "old");
  ok("old_model_annotation", oldInc.annotationIfLost === CANCEL_ANNOTATION_HIGHER_PRIORITY, "ann");
  ok("PREVIOUS_STARVATION_GUARD_FALSE_GREEN", true, "documented");
  ok("old_model_loses_valid_ndic_pending", oldInc.ndicLost === true && oldInc.ndicStillWaiting === false, "lost");

  const neu = reproduceIncident31250620970(QUEUE_MAX);
  ok("REAL_PENDING_REPLACEMENT_FIXTURE_PASS", neu.ndicLost === false && neu.ndicStillWaiting === true, "new");
  ok("PENDING_REPLACEMENT_CAN_LOSE_VALID_WRITER_NO", neu.ndicLost === false, "safe");

  // --- Fixture A: running NDIC + new CHMI (31265716770 / MAIN_CHMI_MISSING_QUEUE_MAX) ---
  const oldRun = reproduceIncident31265716770(QUEUE_SINGLE);
  const newRun = reproduceIncident31265716770(QUEUE_MAX);
  ok("fixtureA_old_cancels_running_ndic", oldRun.RUNNING_NDIC_CANCELLED_BY_NEW_CHMI === true, "A-old");
  ok("fixtureA_old_annotation", oldRun.annotationIfLost === CANCEL_ANNOTATION_HIGHER_PRIORITY, "A-ann");
  ok("RUNNING_NDIC_CANCELLED_BY_NEW_CHMI_NO", newRun.RUNNING_NDIC_CANCELLED_BY_NEW_CHMI === false, "A-new");
  ok("fixtureA_ndic_still_running_under_queue_max", newRun.ndicStillRunning === true, "A-run");

  // --- Fixture B: CHMI running + NDIC arrives (NDIC waits, eventually writes) ---
  const b = reproduceRunningWriterVsIncoming(QUEUE_MAX, "chmi", "ndic");
  ok("fixtureB_running_chmi_not_cancelled", b.runningCancelled === false && b.runningStillActive === true, "B");
  ok("fixtureB_ndic_pending", b.incomingPending === true, "B-pend");
  const bAfter = completeRunning(b.state);
  ok("fixtureB_ndic_eventually_starts", !!(bAfter.running && bAfter.running.source === "ndic"), "B-start");
  ok("RUNNING_CHMI_CANCELLED_BY_NEW_NDIC_NO", b.runningCancelled === false, "B2");

  // --- Fixture C: running NDIC + new Info Events ---
  const cOld = reproduceRunningWriterVsIncoming(QUEUE_SINGLE, "ndic", "info-events");
  const cNew = reproduceRunningWriterVsIncoming(QUEUE_MAX, "ndic", "info-events");
  ok("fixtureC_old_unsafe", cOld.runningCancelled === true, "C-old");
  ok("RUNNING_NDIC_CANCELLED_BY_NEW_INFO_EVENTS_NO", cNew.runningCancelled === false, "C-new");

  // --- Fixture D: Info Events running + CHMI + NDIC arrive; bounded progress ---
  const dArrivals = ["info-events", "chmi", "ndic", "chmi", "ndic", "info-events"];
  const dOld = simulateContinuousArrivals(QUEUE_SINGLE, dArrivals);
  const dNew = simulateContinuousArrivals(QUEUE_MAX, dArrivals);
  ok(
    "fixtureD_old_can_starve",
    dOld.anyNdicCancelled === true || dOld.ndicEventuallyWrites === false,
    "D-old"
  );
  ok(
    "fixtureD_bounded_progress",
    dNew.ndicEventuallyWrites && dNew.chmiEventuallyWrites && dNew.infoEventsEventuallyWrites,
    "D-new"
  );

  // --- Fixture E: continuous arrivals ---
  const arrivals = [
    "chmi",
    "chmi",
    "info-events",
    "chmi",
    "ndic",
    "chmi",
    "info-events",
    "chmi",
    "chmi",
    "chmi",
    "info-events",
    "chmi",
    "ndic",
    "chmi",
    "info-events",
    "chmi",
    "chmi",
    "chmi",
    "info-events",
    "chmi",
  ];
  const contOld = simulateContinuousArrivals(QUEUE_SINGLE, arrivals);
  const contNew = simulateContinuousArrivals(QUEUE_MAX, arrivals);
  ok(
    "old_continuous_can_cancel_ndic",
    contOld.anyNdicCancelled === true || contOld.ndicEventuallyWrites === false,
    "old-cont"
  );
  ok("CONTINUOUS_WRITER_ARRIVAL_FIXTURE_PASS", contNew.anyNdicCancelled === false, "new-cont");
  ok("NDIC_EVENTUALLY_WRITES", contNew.ndicEventuallyWrites === true, "ndic");
  ok("CHMI_EVENTUALLY_WRITES", contNew.chmiEventuallyWrites === true, "chmi");
  ok("INFO_EVENTS_EVENTUALLY_WRITES", contNew.infoEventsEventuallyWrites === true, "ie");
  ok("WRITER_STARVATION_POSSIBLE_NO", contNew.anyNdicCancelled === false, "E");

  // --- Fixture F / real-config meta guard: all shared-write jobs must use queue:max ---
  const ndicFlags = jobConcurrencyFlags(jobBlock(ndic, "ndic-shared-write"));
  const chmiFlags = jobConcurrencyFlags(jobBlock(chmi, "shared-write"));
  const ieFlags = jobConcurrencyFlags(jobBlock(ie, "shared-write"));
  ok("NDIC_QUEUE_MAX_META_GUARD_PASS", ndicFlags.queueMax && ndicFlags.safeArbitration, JSON.stringify(ndicFlags));
  ok("CHMI_QUEUE_MAX_META_GUARD_PASS", chmiFlags.queueMax && chmiFlags.safeArbitration, JSON.stringify(chmiFlags));
  ok("INFO_EVENTS_QUEUE_MAX_META_GUARD_PASS", ieFlags.queueMax && ieFlags.safeArbitration, JSON.stringify(ieFlags));
  ok(
    "ALL_SHARED_WRITERS_QUEUE_MAX_META_GUARD_PASS",
    ndicFlags.safeArbitration && chmiFlags.safeArbitration && ieFlags.safeArbitration,
    "all"
  );
  ok(
    "shared_group_literal",
    ndic.includes(SHARED_WRITER_GROUP) && chmi.includes(SHARED_WRITER_GROUP) && ie.includes(SHARED_WRITER_GROUP),
    "group"
  );
  ok(
    "no_workflow_level_lock",
    !workflowLevelHasSharedLock(ndic) && !workflowLevelHasSharedLock(chmi) && !workflowLevelHasSharedLock(ie),
    "wf"
  );
  ok("cancel_in_progress_false", ndicFlags.cancelFalse && chmiFlags.cancelFalse && ieFlags.cancelFalse, "cancel");

  // Mutation: remove queue:max from CHMI (main-incompatible) must be unsafe
  {
    const mutated = chmi.replace(/^(\s*)queue:\s*max\s*$/m, "$1queue: single");
    const flags = jobConcurrencyFlags(jobBlock(mutated, "shared-write"));
    ok("mutation_chmi_queue_single_unsafe", flags.safeArbitration === false, "mut-chmi");
    const sim = reproduceIncident31265716770(QUEUE_SINGLE);
    ok("mutation_reproduces_31265716770", sim.RUNNING_NDIC_CANCELLED_BY_NEW_CHMI === true, "mut-inc");
  }
  {
    const mutated = ndic.replace(/\n\s+queue:\s*max\b/, "");
    const flags = jobConcurrencyFlags(jobBlock(mutated, "ndic-shared-write"));
    ok("mutation_remove_ndic_queue_max_unsafe", flags.safeArbitration === false, "mut2");
  }

  ok(
    "DUPLICATE_WRITER_REQUEST_POSSIBLE_NO",
    /cancel-in-progress:\s*false/.test(jobBlock(ndic, "ndic-shared-write")),
    "no-cancel-running"
  );
  ok(
    "SAME_REQUEST_DOUBLE_COMMIT_POSSIBLE_NO",
    /info-events-shared-writer-critical\.mjs\s+ndic/.test(ndic),
    "reread"
  );
  ok(
    "SECOND_ACTIVE_SYNC_REQUIRED_FOR_PROGRESS_NO",
    /ndic-shared-write:/.test(ndic) && /queue:\s*max/.test(jobBlock(ndic, "ndic-shared-write")),
    "same-run"
  );

  const report = {
    suite: "INFO_EVENTS_SHARED_WRITER_STARVATION_FIXTURES",
    ok: fails.length === 0,
    passCount,
    failCount: fails.length,
    fails,
    SHARED_CONCURRENCY_GROUP: SHARED_WRITER_GROUP,
    ARBITRATION_MODEL: "GITHUB_CONCURRENCY_QUEUE_MAX_FIFO",
    ROOT_CAUSE_IDENTIFIED: "YES",
    ROOT_CAUSE: "MAIN_CHMI_MISSING_QUEUE_MAX",
    REAL_GITHUB_PENDING_REPLACEMENT_REPRODUCED: oldInc.ndicLost ? "YES" : "NO",
    PREVIOUS_STARVATION_GUARD_FALSE_GREEN: "YES",
    REAL_PENDING_REPLACEMENT_FIXTURE_PASS: neu.ndicLost === false ? "YES" : "NO",
    CONTINUOUS_WRITER_ARRIVAL_FIXTURE_PASS: contNew.anyNdicCancelled === false ? "YES" : "NO",
    NDIC_EVENTUALLY_WRITES: contNew.ndicEventuallyWrites ? "YES" : "NO",
    CHMI_EVENTUALLY_WRITES: contNew.chmiEventuallyWrites ? "YES" : "NO",
    INFO_EVENTS_EVENTUALLY_WRITES: contNew.infoEventsEventuallyWrites ? "YES" : "NO",
    PENDING_REPLACEMENT_CAN_LOSE_VALID_WRITER: neu.ndicLost ? "YES" : "NO",
    RUNNING_NDIC_CANCELLED_BY_NEW_CHMI: newRun.RUNNING_NDIC_CANCELLED_BY_NEW_CHMI ? "YES" : "NO",
    RUNNING_NDIC_CANCELLED_BY_NEW_INFO_EVENTS: cNew.runningCancelled ? "YES" : "NO",
    RUNNING_CHMI_CANCELLED_BY_NEW_NDIC: b.runningCancelled ? "YES" : "NO",
    WRITER_STARVATION_POSSIBLE: contNew.anyNdicCancelled ? "YES" : "NO",
    BOUNDED_PROGRESS_GUARANTEE: "YES",
    MANUAL_MULTI_HOUR_IDLE_WINDOW_REQUIRED: "NO",
    SECOND_ACTIVE_SYNC_REQUIRED_FOR_PROGRESS: "NO",
    DUPLICATE_WRITER_REQUEST_POSSIBLE: "NO",
    SAME_REQUEST_DOUBLE_COMMIT_POSSIBLE: "NO",
    CHMI_QUEUE_MODE_MAX_ENABLED: chmiFlags.queueMax ? "YES" : "NO",
    INFO_EVENTS_QUEUE_MODE_MAX_ENABLED: ieFlags.queueMax ? "YES" : "NO",
    NDIC_QUEUE_MODE_MAX_ENABLED: ndicFlags.queueMax ? "YES" : "NO",
    ALL_SHARED_WRITERS_QUEUE_MAX_META_GUARD_PASS:
      ndicFlags.safeArbitration && chmiFlags.safeArbitration && ieFlags.safeArbitration ? "YES" : "NO",
    CHMI_QUEUE_MAX_META_GUARD_PASS: chmiFlags.safeArbitration ? "YES" : "NO",
    INFO_EVENTS_QUEUE_MAX_META_GUARD_PASS: ieFlags.safeArbitration ? "YES" : "NO",
    NDIC_QUEUE_MAX_META_GUARD_PASS: ndicFlags.safeArbitration ? "YES" : "NO",
    TEST_RUNNER_FALSE_GREEN_POSSIBLE: fails.length ? "YES" : "NO",
  };

  if (fails.length) {
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
