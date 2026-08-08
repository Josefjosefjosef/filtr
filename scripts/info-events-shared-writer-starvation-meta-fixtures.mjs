#!/usr/bin/env node
/**
 * Meta/mutation: removing queue:max / shared lock / reread / starvation fixture must FAIL closed.
 * Also guards CHMI queue:max (incident 31265716770 / MAIN_CHMI_MISSING_QUEUE_MAX).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  QUEUE_MAX,
  QUEUE_SINGLE,
  reproduceIncident31250620970,
  reproduceIncident31265716770,
  jobConcurrencyFlags,
} from "./info-events-shared-writer-arbitration.mjs";
import { jobBlock, workflowLevelHasSharedLock } from "./ndic-datex-v1-concurrency-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NDIC_WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");
const CHMI_WF = path.join(ROOT, ".github", "workflows", "update-chmi-cap-v2.yml");
const IE_WF = path.join(ROOT, ".github", "workflows", "update-info-events.yml");
const STARVE_FIX = path.join(ROOT, "scripts", "info-events-shared-writer-starvation-fixtures.mjs");
const SUITE = path.join(ROOT, "scripts", "ndic-staging-preflight-suite.mjs");

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
}

const ndic = fs.readFileSync(NDIC_WF, "utf8");
const chmi = fs.readFileSync(CHMI_WF, "utf8");
const ie = fs.readFileSync(IE_WF, "utf8");
const starveSrc = fs.readFileSync(STARVE_FIX, "utf8");
const suiteSrc = fs.readFileSync(SUITE, "utf8");

const ndicFlags = jobConcurrencyFlags(jobBlock(ndic, "ndic-shared-write"));
const chmiFlags = jobConcurrencyFlags(jobBlock(chmi, "shared-write"));
const ieFlags = jobConcurrencyFlags(jobBlock(ie, "shared-write"));

ok("baseline_ndic_queue_max", ndicFlags.safeArbitration);
ok("baseline_chmi_queue_max", chmiFlags.safeArbitration);
ok("baseline_ie_queue_max", ieFlags.safeArbitration);
ok(
  "ALL_SHARED_WRITERS_QUEUE_MAX_META_GUARD_PASS",
  ndicFlags.safeArbitration && chmiFlags.safeArbitration && ieFlags.safeArbitration
);
ok("baseline_incident_pending_new_safe", reproduceIncident31250620970(QUEUE_MAX).ndicLost === false);
ok("baseline_incident_pending_old_unsafe", reproduceIncident31250620970(QUEUE_SINGLE).ndicLost === true);
ok(
  "baseline_incident_31265716770_new_safe",
  reproduceIncident31265716770(QUEUE_MAX).RUNNING_NDIC_CANCELLED_BY_NEW_CHMI === false
);
ok(
  "baseline_incident_31265716770_old_unsafe",
  reproduceIncident31265716770(QUEUE_SINGLE).RUNNING_NDIC_CANCELLED_BY_NEW_CHMI === true
);

{
  const mutated = ndic.replace(/\n\s+queue:\s*max\b/, "");
  ok(
    "meta_remove_ndic_queue_max_caught",
    jobConcurrencyFlags(jobBlock(mutated, "ndic-shared-write")).safeArbitration === false
  );
}
{
  const mutated = chmi.replace(/^(\s*)queue:\s*max\s*$/m, "");
  ok(
    "meta_remove_chmi_queue_max_caught",
    jobConcurrencyFlags(jobBlock(mutated, "shared-write")).safeArbitration === false
  );
}
{
  const mutated = ie.replace(/\n\s+queue:\s*max\b/, "");
  ok(
    "meta_remove_ie_queue_max_caught",
    jobConcurrencyFlags(jobBlock(mutated, "shared-write")).safeArbitration === false
  );
}
{
  const mutated = ndic.replace(/group:\s*info-events-data-writers/, "group: ndic-only-writers");
  ok(
    "meta_remove_shared_lock_caught",
    !/group:\s*info-events-data-writers/.test(jobBlock(mutated, "ndic-shared-write"))
  );
}
{
  const mutated = ndic.replace(/info-events-shared-writer-critical\.mjs ndic/g, "echo NO_REREAD");
  ok("meta_remove_reread_caught", !/info-events-shared-writer-critical\.mjs ndic/.test(mutated));
}
{
  const mutated =
    "concurrency:\n  group: info-events-data-writers\n  cancel-in-progress: false\n\n" + chmi;
  ok("meta_whole_workflow_lock_caught", workflowLevelHasSharedLock(mutated) === true);
}
{
  const mutated = starveSrc.replace(/REAL_PENDING_REPLACEMENT_FIXTURE_PASS/g, "REMOVED");
  ok("meta_remove_pending_replacement_fixture_caught", !/REAL_PENDING_REPLACEMENT_FIXTURE_PASS/.test(mutated));
}
{
  const mutated = starveSrc.replace(/RUNNING_NDIC_CANCELLED_BY_NEW_CHMI/g, "REMOVED");
  ok("meta_remove_31265716770_fixture_caught", !/RUNNING_NDIC_CANCELLED_BY_NEW_CHMI/.test(mutated));
}
{
  const mutated = suiteSrc.replace(
    /iu-info-events-shared-writer-starvation-fixtures/g,
    "iu-info-events-shared-writer-starvation-REMOVED"
  );
  ok(
    "meta_remove_starvation_suite_wire_caught",
    !/iu-info-events-shared-writer-starvation-fixtures/.test(mutated)
  );
}
ok("suite_wires_starvation_fixtures", /iu-info-events-shared-writer-starvation-fixtures/.test(suiteSrc));
ok(
  "starvation_fixture_keeps_incident_repro",
  /reproduceIncident31250620970/.test(starveSrc) &&
    /reproduceIncident31265716770/.test(starveSrc) &&
    /REAL_PENDING_REPLACEMENT_FIXTURE_PASS/.test(starveSrc) &&
    /RUNNING_NDIC_CANCELLED_BY_NEW_CHMI/.test(starveSrc)
);

const report = {
  suite: "INFO_EVENTS_SHARED_WRITER_STARVATION_META",
  ok: fails.length === 0,
  failCount: fails.length,
  fails,
  ALL_SHARED_WRITERS_QUEUE_MAX_META_GUARD_PASS:
    ndicFlags.safeArbitration && chmiFlags.safeArbitration && ieFlags.safeArbitration ? "YES" : "NO",
  CHMI_QUEUE_MAX_META_GUARD_PASS: chmiFlags.safeArbitration ? "YES" : "NO",
  INFO_EVENTS_QUEUE_MAX_META_GUARD_PASS: ieFlags.safeArbitration ? "YES" : "NO",
  NDIC_QUEUE_MAX_META_GUARD_PASS: ndicFlags.safeArbitration ? "YES" : "NO",
  META_TEST_PASS: fails.length === 0 ? "YES" : "NO",
  MUTATION_TEST_PASS: fails.length === 0 ? "YES" : "NO",
  TEST_RUNNER_FALSE_GREEN_POSSIBLE: fails.length ? "YES" : "NO",
};
console.log(JSON.stringify(report, null, 2));
process.exit(fails.length ? 1 : 0);
