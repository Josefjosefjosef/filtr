#!/usr/bin/env node
/**
 * Meta-tests for the armed automatic NDIC schedule: every weakening mutation must FAIL.
 * Offline only. No dispatch, no repository variable writes, no NDIC network.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAutomaticScheduleContract, CONSERVATIVE_CRON } from "./ndic-automatic-schedule-fixtures.mjs";
import { jobChunk } from "./ndic-staging-preflight-architecture-fixtures.mjs";
import {
  isAutomationArmed,
  shouldSkipSchedule,
  evaluateScheduleGate,
} from "./ndic-schedule-arming.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NET_WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");

const fails = [];
let metaPass = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else metaPass += 1;
}

const netSrc = fs.readFileSync(NET_WF, "utf8");

function mutateMustFail(id, mutateFn) {
  const mutated = mutateFn(netSrc);
  const result = assertAutomaticScheduleContract(mutated);
  ok(id, result.ok === false, result.ok ? "FALSE_GREEN" : (result.fails || []).slice(0, 3).join("|"));
}

ok("baseline_contract_pass", assertAutomaticScheduleContract(netSrc).ok, "baseline");

// 1) Remove the arming gate entirely.
mutateMustFail("meta_remove_schedule_gate_job", (s) =>
  s.replace(new RegExp("(?:^|\\n) {2}schedule-gate:\\n(?: {4}.*\\n|\\n)*"), "\n")
);

// 2) Keep the gate job but drop the arming variable (always armed).
mutateMustFail("meta_remove_arming_variable", (s) =>
  s.replace(/vars\.NDIC_AUTOMATION_ENABLED/g, "'true'")
);

// 3) Hardcode the arming variable to true inside the workflow.
mutateMustFail("meta_hardcode_arming_true", (s) =>
  s.replace(
    /IU_NDIC_AUTOMATION_ENABLED: \$\{\{ vars\.NDIC_AUTOMATION_ENABLED \}\}/,
    "NDIC_AUTOMATION_ENABLED: true"
  )
);

// 4) Remove the duplicate-inflight guard script.
mutateMustFail("meta_remove_inflight_guard", (s) =>
  s.replace(/ndic-schedule-arming\.mjs/g, "echo-no-gate.mjs")
);

// 5) Remove the inline scheduled preflight job.
mutateMustFail("meta_remove_scheduled_preflight_job", (s) =>
  s.replace(new RegExp("(?:^|\\n) {2}scheduled-preflight:\\n(?: {4}.*\\n|\\n)*"), "\n")
);

// 6) Scheduled preflight no longer publishes an attestation.
mutateMustFail("meta_scheduled_preflight_stops_publishing", (s) =>
  s.replace(/node scripts\/ndic-publish-preflight-attestation\.mjs/, "echo SKIPPED_PUBLISH")
);

// 7) Give NDIC secrets to the GitHub-hosted scheduled preflight.
mutateMustFail("meta_scheduled_preflight_gains_ndic_secrets", (s) => {
  const spf = jobChunk(s, "scheduled-preflight");
  if (!spf) return s;
  return s.replace(
    spf,
    spf.replace(
      /IU_NDIC_PREFLIGHT_TTL_SECONDS: "7200"/,
      'IU_NDIC_PREFLIGHT_TTL_SECONDS: "7200"\n          IU_NDIC_PULL_URL: ${{ secrets.IU_NDIC_PULL_URL }}'
    )
  );
});

// 7b) Short TTL would expire while self-hosted prep is queued (incident 31344963532).
mutateMustFail("meta_scheduled_preflight_ttl_too_short", (s) =>
  s.replace(/IU_NDIC_PREFLIGHT_TTL_SECONDS: "7200"/, 'IU_NDIC_PREFLIGHT_TTL_SECONDS: "1800"')
);

// 7c) Remove bounded disk cleanup from prep.
mutateMustFail("meta_remove_prep_disk_cleanup", (s) =>
  s.replace(/node scripts\/ndic-runner-disk-cleanup\.mjs/g, "echo SKIPPED_CLEANUP")
);

// 8) Let prep run even when the inline preflight failed.
mutateMustFail("meta_prep_ignores_preflight_failure", (s) =>
  s.replace(/&& needs\.scheduled-preflight\.result == 'success'/, "")
);

// 9) Let prep run even when the gate said skip.
mutateMustFail("meta_prep_ignores_arming_gate", (s) =>
  s.replace(/&& needs\.schedule-gate\.outputs\.proceed == 'true'\n/, "")
);

// 10) cancel-in-progress: true on the NDIC orchestration (network staging) group.
mutateMustFail("meta_orchestration_cancel_in_progress_true", (s) =>
  s.replace(
    /group: ndic-datex-v1-internal-staging\n      cancel-in-progress: false/,
    "group: ndic-datex-v1-internal-staging\n      cancel-in-progress: true"
  )
);

// 10b) Whole-run lock would queue the gate and defeat the early duplicate skip.
mutateMustFail("meta_add_whole_run_lock", (s) =>
  s.replace(
    /\npermissions:/,
    "\nconcurrency:\n  group: ndic-datex-v1-orchestration\n  cancel-in-progress: false\n\npermissions:"
  )
);

// 11) Move ndic-prep onto a GitHub-hosted runner.
mutateMustFail("meta_prep_on_ubuntu", (s) => {
  const prep = jobChunk(s, "ndic-prep");
  if (!prep) return s;
  return s.replace(
    prep,
    prep.replace(
      /runs-on:\n\s+- self-hosted\n\s+- Linux\n\s+- X64\n\s+- ndic-cz-egress/,
      "runs-on: ubuntu-latest"
    )
  );
});

// 12) Dynamic runs-on fallback to a GitHub-hosted runner.
mutateMustFail("meta_prep_dynamic_runs_on_fallback", (s) => {
  const prep = jobChunk(s, "ndic-prep");
  if (!prep) return s;
  return s.replace(
    prep,
    prep.replace(
      /runs-on:\n\s+- self-hosted\n\s+- Linux\n\s+- X64\n\s+- ndic-cz-egress/,
      "runs-on: ${{ github.event_name == 'schedule' && 'ubuntu-latest' || 'self-hosted' }}"
    )
  );
});

// 13) Reintroduce the whole-workflow shared writer lock with CHMI/IE.
mutateMustFail("meta_restore_whole_workflow_shared_lock", (s) =>
  s.replace(
    /\npermissions:/,
    "\nconcurrency:\n  group: info-events-data-writers\n  cancel-in-progress: false\n\npermissions:"
  )
);

// 14) Put the shared writer lock on the network prep job.
mutateMustFail("meta_prep_takes_shared_writer_lock", (s) => {
  const prep = jobChunk(s, "ndic-prep");
  if (!prep) return s;
  return s.replace(
    prep,
    prep.replace(/group: ndic-datex-v1-internal-staging/, "group: info-events-data-writers")
  );
});

// 15) Aggressive cron cadence.
mutateMustFail("meta_aggressive_cron", (s) =>
  s.replace(new RegExp(`- cron: "${CONSERVATIVE_CRON.replace(/\*/g, "\\*")}"`), '- cron: "* * * * *"')
);

// 16) Add an automatic push trigger next to the schedule.
mutateMustFail("meta_add_push_trigger", (s) => s.replace(/\non:\n  schedule:/, "\non:\n  push:\n  schedule:"));

// 17) Skip attestation verification before NDIC secrets.
mutateMustFail("meta_remove_attestation_verify", (s) =>
  s.replace(/ndic-verify-preflight-attestation\.mjs/g, "echo-skip-verify.mjs")
);

// 18) Drop the manual break-glass dispatch trigger.
mutateMustFail("meta_remove_manual_break_glass", (s) =>
  s.replace(/  workflow_dispatch:\n(?:    .*\n|\n)*/, "")
);

// 19) Bypass the skipped-job gating with always().
mutateMustFail("meta_prep_always_bypass", (s) => s.replace(/if: >\n      !cancelled\(\)/, "if: always()"));

// 20) Scheduled path silently downgraded to a non-resolved mode.
mutateMustFail("meta_remove_resolved_mode", (s) =>
  s.replace(/github\.event_name == 'schedule' && 'active'/, "'shadow'")
);

// ---- pure arming logic must not be loosened ----------------------------------
ok("meta_arming_rejects_one", isAutomationArmed("1") === false, "1");
ok("meta_arming_rejects_yes", isAutomationArmed("yes") === false, "yes");
ok("meta_arming_rejects_enabled", isAutomationArmed("enabled") === false, "enabled");
ok("meta_arming_rejects_undefined", isAutomationArmed(undefined) === false, "undefined");
ok(
  "meta_unarmed_never_proceeds",
  evaluateScheduleGate({ eventName: "schedule", varsValue: "false", inflightCount: 0, inflightQueryOk: true })
    .proceed === false,
  "unarmed"
);
ok(
  "meta_inflight_never_proceeds",
  shouldSkipSchedule({ armed: true, inflightCount: 1, eventName: "schedule" }).skip === true,
  "inflight"
);
ok(
  "meta_unknown_inflight_never_proceeds",
  shouldSkipSchedule({ armed: true, inflightCount: Number.NaN, eventName: "schedule" }).skip === true,
  "nan"
);
ok(
  "meta_negative_inflight_never_proceeds",
  shouldSkipSchedule({ armed: true, inflightCount: -1, eventName: "schedule" }).skip === true,
  "negative"
);

const report = {
  suite: "NDIC_AUTOMATIC_SCHEDULE_META",
  META_TEST_COUNT: metaPass + fails.length,
  META_TEST_SUCCESS_COUNT: metaPass,
  META_TEST_FAILURE_COUNT: fails.length,
  ARMING_GATE_META_GUARD_PASS: fails.length === 0 ? "YES" : "NO",
  INLINE_PREFLIGHT_META_GUARD_PASS: fails.length === 0 ? "YES" : "NO",
  DUPLICATE_RUN_META_GUARD_PASS: fails.length === 0 ? "YES" : "NO",
  SELF_HOSTED_BINDING_META_GUARD_PASS: fails.length === 0 ? "YES" : "NO",
  TEST_RUNNER_FALSE_GREEN_POSSIBLE: fails.length ? "YES" : "NO",
  fails,
};

if (fails.length) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));
