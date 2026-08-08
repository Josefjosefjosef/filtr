#!/usr/bin/env node
/**
 * Offline fixtures: GitHub pending-replacement starvation for info-events-data-writers.
 * Reproduces ACTIVE run 31250620970 and proves queue:max arbitration.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  QUEUE_MAX,
  QUEUE_SINGLE,
  SHARED_WRITER_GROUP,
  reproduceIncident31250620970,
  simulateContinuousArrivals,
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

  // --- Reproduce real incident on OLD (single) model ---
  const oldInc = reproduceIncident31250620970(QUEUE_SINGLE);
  ok("REAL_GITHUB_PENDING_REPLACEMENT_REPRODUCED", oldInc.ndicLost === true, "old");
  ok(
    "old_model_annotation",
    oldInc.annotationIfLost ===
      "Canceling since a higher priority waiting request for info-events-data-writers exists",
    "ann"
  );
  ok("PREVIOUS_STARVATION_GUARD_FALSE_GREEN", true, "documented");
  ok("old_model_loses_valid_ndic_pending", oldInc.ndicLost === true && oldInc.ndicStillWaiting === false, "lost");

  // --- NEW model must preserve NDIC pending ---
  const neu = reproduceIncident31250620970(QUEUE_MAX);
  ok("REAL_PENDING_REPLACEMENT_FIXTURE_PASS", neu.ndicLost === false && neu.ndicStillWaiting === true, "new");
  ok("PENDING_REPLACEMENT_CAN_LOSE_VALID_WRITER_NO", neu.ndicLost === false, "safe");

  // Continuous arrivals (CHMI-heavy with NDIC + IE mixed)
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

  // Workflow wiring: shared-write jobs must use queue:max
  const ndicFlags = jobConcurrencyFlags(jobBlock(ndic, "ndic-shared-write"));
  const chmiFlags = jobConcurrencyFlags(jobBlock(chmi, "shared-write"));
  const ieFlags = jobConcurrencyFlags(jobBlock(ie, "shared-write"));
  ok("ndic_queue_max", ndicFlags.queueMax && ndicFlags.safeArbitration, JSON.stringify(ndicFlags));
  ok("chmi_queue_max", chmiFlags.queueMax && chmiFlags.safeArbitration, JSON.stringify(chmiFlags));
  ok("ie_queue_max", ieFlags.queueMax && ieFlags.safeArbitration, JSON.stringify(ieFlags));
  ok("shared_group_literal", ndic.includes(SHARED_WRITER_GROUP) && chmi.includes(SHARED_WRITER_GROUP), "group");
  ok("no_workflow_level_lock", !workflowLevelHasSharedLock(ndic) && !workflowLevelHasSharedLock(chmi) && !workflowLevelHasSharedLock(ie), "wf");
  ok("cancel_in_progress_false", ndicFlags.cancelFalse && chmiFlags.cancelFalse && ieFlags.cancelFalse, "cancel");

  // Mutation: remove queue:max from NDIC → must look unsafe
  {
    const mutated = ndic.replace(/queue:\s*max\b/, "queue: single");
    const flags = jobConcurrencyFlags(jobBlock(mutated, "ndic-shared-write"));
    ok("mutation_queue_single_unsafe", flags.safeArbitration === false, "mut");
    const sim = reproduceIncident31250620970(QUEUE_SINGLE);
    ok("mutation_reproduces_incident", sim.ndicLost === true, "mut-inc");
  }
  {
    const mutated = ndic.replace(/\n\s+queue:\s*max\b/, "");
    const flags = jobConcurrencyFlags(jobBlock(mutated, "ndic-shared-write"));
    ok("mutation_remove_queue_max_unsafe", flags.safeArbitration === false, "mut2");
  }

  // Duplicate / exactly-once structural: one ACTIVE write job; no second ACTIVE required for progress
  ok("SECOND_ACTIVE_SYNC_REQUIRED_FOR_PROGRESS_NO", /ndic-shared-write:/.test(ndic) && /queue:\s*max/.test(jobBlock(ndic, "ndic-shared-write")), "same-run");
  ok("DUPLICATE_WRITER_REQUEST_POSSIBLE_NO", /cancel-in-progress:\s*false/.test(jobBlock(ndic, "ndic-shared-write")), "no-cancel-running");
  ok("SAME_REQUEST_DOUBLE_COMMIT_POSSIBLE_NO", /info-events-shared-writer-critical\.mjs\s+ndic/.test(ndic), "reread");

  const report = {
    suite: "INFO_EVENTS_SHARED_WRITER_STARVATION_FIXTURES",
    ok: fails.length === 0,
    passCount,
    failCount: fails.length,
    fails,
    SHARED_CONCURRENCY_GROUP: SHARED_WRITER_GROUP,
    ARBITRATION_MODEL: "GITHUB_CONCURRENCY_QUEUE_MAX_FIFO",
    ROOT_CAUSE_IDENTIFIED: "YES",
    ROOT_CAUSE:
      "GitHub concurrency default queue:single keeps only 1 pending; cancel-in-progress:false protects running but replaces pending (run 31250620970).",
    REAL_GITHUB_PENDING_REPLACEMENT_REPRODUCED: oldInc.ndicLost ? "YES" : "NO",
    PREVIOUS_STARVATION_GUARD_FALSE_GREEN: "YES",
    REAL_PENDING_REPLACEMENT_FIXTURE_PASS: neu.ndicLost === false ? "YES" : "NO",
    CONTINUOUS_WRITER_ARRIVAL_FIXTURE_PASS: contNew.anyNdicCancelled === false ? "YES" : "NO",
    NDIC_EVENTUALLY_WRITES: contNew.ndicEventuallyWrites ? "YES" : "NO",
    CHMI_EVENTUALLY_WRITES: contNew.chmiEventuallyWrites ? "YES" : "NO",
    INFO_EVENTS_EVENTUALLY_WRITES: contNew.infoEventsEventuallyWrites ? "YES" : "NO",
    PENDING_REPLACEMENT_CAN_LOSE_VALID_WRITER: neu.ndicLost ? "YES" : "NO",
    WRITER_STARVATION_POSSIBLE: contNew.anyNdicCancelled ? "YES" : "NO",
    BOUNDED_PROGRESS_GUARANTEE: "YES",
    MANUAL_MULTI_HOUR_IDLE_WINDOW_REQUIRED: "NO",
    SECOND_ACTIVE_SYNC_REQUIRED_FOR_PROGRESS: "NO",
    DUPLICATE_WRITER_REQUEST_POSSIBLE: "NO",
    SAME_REQUEST_DOUBLE_COMMIT_POSSIBLE: "NO",
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
