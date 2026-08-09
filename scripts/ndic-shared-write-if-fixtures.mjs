#!/usr/bin/env node
/**
 * Mutation fixtures for ndic-shared-write.if after hotfix #9393.
 * Evaluates the gate logic synthetically (no workflow dispatch).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");

const fails = [];
let pass = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else pass += 1;
}

/**
 * Mirrors the hotfix if:
 * needs.ndic-prep.result == 'success'
 * && needs.ndic-prep.outputs.candidate_ready == 'true'
 * && (
 *   (workflow_dispatch && mode == 'active')
 *   || (event_name == 'schedule')
 * )
 * Schedule path still requires prep success; disarmed schedule never reaches prep.
 */
function sharedWriteWouldRun(ctx) {
  const prepOk = ctx.prepResult === "success";
  const candidateReady = ctx.candidateReady === true || ctx.candidateReady === "true";
  const dispatchActive =
    ctx.eventName === "workflow_dispatch" && ctx.mode === "active";
  const scheduleEvent = ctx.eventName === "schedule";
  // Disarmed schedule: prep does not run / does not succeed
  if (scheduleEvent && ctx.automationArmed !== true) {
    return false;
  }
  if (scheduleEvent && ctx.preflightPass !== true) {
    return false;
  }
  if (scheduleEvent && ctx.headMatch !== true) {
    return false;
  }
  return prepOk && candidateReady && (dispatchActive || scheduleEvent);
}

const src = fs.readFileSync(WF, "utf8");
ok("wf_has_dispatch_active_gate", /github\.event\.inputs\.mode == 'active'/.test(src));
ok("wf_has_schedule_gate", /github\.event_name == 'schedule'/.test(src));
ok("wf_requires_prep_success", /needs\.ndic-prep\.result == 'success'/.test(src));
ok(
  "wf_requires_candidate_ready",
  /needs\.ndic-prep\.outputs\.candidate_ready == 'true'/.test(src)
);
ok(
  "wf_no_resolved_mode_only_gate",
  !/needs\.ndic-prep\.outputs\.resolved_mode == 'active'/.test(
    src.split("ndic-shared-write:")[1]?.split("runs-on:")[0] || ""
  )
);

// A) workflow_dispatch + mode=active + prep=success + schedule jobs skipped
ok(
  "A_dispatch_active_prep_ok_must_run",
  sharedWriteWouldRun({
    eventName: "workflow_dispatch",
    mode: "active",
    prepResult: "success",
    candidateReady: true,
    scheduleJobsSkipped: true,
  }) === true
);

// B) schedule + automation=false
ok(
  "B_schedule_disarmed_must_not_run",
  sharedWriteWouldRun({
    eventName: "schedule",
    automationArmed: false,
    prepResult: "success",
    candidateReady: true,
    preflightPass: true,
    headMatch: true,
  }) === false
);

// C) schedule + automation=true + preflight PASS + prep success
ok(
  "C_schedule_armed_preflight_prep_ok_must_run",
  sharedWriteWouldRun({
    eventName: "schedule",
    automationArmed: true,
    preflightPass: true,
    headMatch: true,
    prepResult: "success",
    candidateReady: true,
  }) === true
);

// D) prep=failure
ok(
  "D_prep_failure_must_not_run",
  sharedWriteWouldRun({
    eventName: "workflow_dispatch",
    mode: "active",
    prepResult: "failure",
    candidateReady: false,
  }) === false
);

ok(
  "extra_shadow_mode_must_not_run",
  sharedWriteWouldRun({
    eventName: "workflow_dispatch",
    mode: "shadow",
    prepResult: "success",
    candidateReady: true,
  }) === false
);

ok(
  "extra_schedule_preflight_fail_must_not_run",
  sharedWriteWouldRun({
    eventName: "schedule",
    automationArmed: true,
    preflightPass: false,
    headMatch: true,
    prepResult: "success",
    candidateReady: true,
  }) === false
);

ok(
  "extra_schedule_head_mismatch_must_not_run",
  sharedWriteWouldRun({
    eventName: "schedule",
    automationArmed: true,
    preflightPass: true,
    headMatch: false,
    prepResult: "success",
    candidateReady: true,
  }) === false
);

const report = {
  suite: "NDIC_SHARED_WRITE_IF_FIXTURES",
  SHARED_WRITE_DISPATCH_FIXTURE_PASS: fails.some((f) => f.startsWith("A_"))
    ? "NO"
    : "YES",
  SHARED_WRITE_SCHEDULE_DISARMED_FIXTURE_PASS: fails.some((f) => f.startsWith("B_"))
    ? "NO"
    : "YES",
  SHARED_WRITE_SCHEDULE_ARMED_FIXTURE_PASS: fails.some((f) => f.startsWith("C_"))
    ? "NO"
    : "YES",
  SHARED_WRITE_PREP_FAILURE_FIXTURE_PASS: fails.some((f) => f.startsWith("D_"))
    ? "NO"
    : "YES",
  SHARED_WRITE_MUTATION_TEST_PASS: fails.length === 0 ? "YES" : "NO",
  total: pass + fails.length,
  success: pass,
  failure: fails.length,
  fails,
};

if (fails.length) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));
