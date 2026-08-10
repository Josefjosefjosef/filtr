#!/usr/bin/env node
/**
 * Synthetic fixtures for the armed automatic NDIC schedule (offline only).
 *
 * TARGET_OPERATION_MODE=AUTOMATIC_SCHEDULED_NDIC_SYNC_WITH_CONTINUOUS_SELF_HOSTED_RUNNER
 *
 * Never dispatches a workflow, never sets a repository variable, never touches NDIC.
 * Scenarios A–L cover arming, inline preflight, duplicate suppression, runner binding
 * and the invariants that must survive the schedule (writer lock scope, data PR contract).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAutomationArmed,
  shouldSkipSchedule,
  resolveScheduledMode,
  evaluateScheduleGate,
  countOtherInflightRuns,
  AUTOMATION_VARIABLE_NAME,
  SKIP_NOT_ARMED,
  SKIP_DUPLICATE_INFLIGHT,
  SKIP_INFLIGHT_QUERY_FAILED,
  SKIP_NOT_SCHEDULE_EVENT,
} from "./ndic-schedule-arming.mjs";
import {
  PREFLIGHT_STATUS_CONTEXT,
  buildAttestationDescription,
  buildAttestationId,
  computeExpiresAtIso,
  verifyAttestationStatus,
} from "./ndic-staging-preflight-attestation.mjs";
import { jobChunk, stripComments } from "./ndic-staging-preflight-architecture-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NET_WF = path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml");
const VERIFY_JS = path.join(ROOT, "scripts", "ndic-verify-preflight-attestation.mjs");

export const CONSERVATIVE_CRON = "8,23,38,53 * * * *";

const fails = [];
let passCount = 0;
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail != null ? ":" + String(detail) : ""));
  else passCount += 1;
}

/**
 * Static contract of the armed automatic schedule inside the network workflow.
 * Exported so meta-fixtures can prove each mutation is detected.
 */
export function assertAutomaticScheduleContract(src) {
  const raw = String(src || "");
  const c = stripComments(raw);
  const localFails = [];
  const check = (id, cond) => {
    if (!cond) localFails.push(id);
  };

  const gate = jobChunk(raw, "schedule-gate");
  const spf = jobChunk(raw, "scheduled-preflight");
  const prep = jobChunk(raw, "ndic-prep");
  const write = jobChunk(raw, "ndic-shared-write");

  check("schedule_trigger_conservative_cron", c.includes(`- cron: "${CONSERVATIVE_CRON}"`));
  check("workflow_dispatch_break_glass", /workflow_dispatch:/.test(c));
  check("no_push_trigger", !/\n {2}push:/.test(c));
  check("no_workflow_run_trigger", !/\n {2}workflow_run:/.test(c));

  check("gate_job_present", Boolean(gate));
  check("gate_arming_variable", /vars\.NDIC_AUTOMATION_ENABLED/.test(gate));
  check("gate_runs_arming_script", /ndic-schedule-arming\.mjs/.test(gate));
  check("gate_schedule_only", /github\.event_name == 'schedule'/.test(gate));
  check("gate_github_hosted_no_secrets", /ubuntu-latest/.test(gate) && !/secrets\.IU_NDIC_/.test(gate));

  check("scheduled_preflight_present", Boolean(spf));
  check("scheduled_preflight_needs_gate", /needs:\s*schedule-gate/.test(spf));
  check("scheduled_preflight_requires_proceed", /needs\.schedule-gate\.outputs\.proceed == 'true'/.test(spf));
  check("scheduled_preflight_publishes", /ndic-publish-preflight-attestation\.mjs/.test(spf));
  check("scheduled_preflight_runs_suite", /ndic-staging-preflight-suite\.mjs/.test(spf));
  check("scheduled_preflight_no_secrets", !/secrets\.IU_NDIC_/.test(spf));
  check("scheduled_preflight_binds_head", /IU_NDIC_PREFLIGHT_EXPECTED_HEAD:\s*\$\{\{\s*github\.sha\s*\}\}/.test(spf));
  check(
    "scheduled_preflight_ttl_covers_runner_queue",
    /IU_NDIC_PREFLIGHT_TTL_SECONDS:\s*"7200"/.test(spf)
  );
  check("prep_bounded_disk_cleanup", /ndic-runner-disk-cleanup\.mjs/.test(prep));
  check("write_bounded_disk_cleanup", /ndic-runner-disk-cleanup\.mjs/.test(write));
  check("write_low_disk_or_reclaim", /REFUSING_LOW_DISK|Reclaim workspace disk/.test(write) || /REFUSING_LOW_DISK/.test(prep));

  check("prep_requires_gate_proceed", /needs\.schedule-gate\.outputs\.proceed == 'true'/.test(prep));
  check("prep_requires_preflight_success", /needs\.scheduled-preflight\.result == 'success'/.test(prep));
  check("prep_verifies_attestation", /ndic-verify-preflight-attestation\.mjs/.test(prep));
  check("prep_scheduled_mode_active", /github\.event_name == 'schedule' && 'active'/.test(prep));
  check("prep_dispatch_path_kept", /github\.event_name == 'workflow_dispatch'/.test(prep));
  check("prep_no_always_bypass", !/if:\s*always\(\)/.test(prep.split("Upload redacted shadow forensic")[0] || prep));
  check("prep_no_ubuntu", !/ubuntu-latest/.test(prep));
  check("prep_static_czech_labels", /runs-on:\n\s+- self-hosted\n\s+- Linux\n\s+- X64\n\s+- ndic-cz-egress/.test(prep));
  check("prep_no_runs_on_expression", !/runs-on:[^\n]*\$\{\{/.test(prep));
  check("prep_staging_group_cancel_false", /group:\s*ndic-datex-v1-internal-staging\s*\n\s+cancel-in-progress:\s*false/.test(prep));
  check("prep_not_under_shared_writer_lock", !/group:\s*info-events-data-writers/.test(prep));

  check("write_shared_lock", /group:\s*info-events-data-writers/.test(write));
  check("write_no_ubuntu", !/ubuntu-latest/.test(write));
  check(
    "write_dispatch_or_schedule_active_gate",
    /github\.event\.inputs\.mode == 'active'/.test(write) &&
      /github\.event_name == 'schedule'/.test(write) &&
      /needs\.ndic-prep\.result == 'success'/.test(write) &&
      /!cancelled\(\)/.test(write) &&
      !/needs\.ndic-prep\.outputs\.candidate_ready == 'true'/.test(
        write.split("runs-on:")[0] || write
      )
  );
  check(
    "write_validates_candidate_in_job",
    /ndic-validate-shared-write-candidate\.mjs/.test(write)
  );

  check(
    "orchestration_group_cancel_false",
    /group:\s*ndic-datex-v1-internal-staging\s*\n\s+cancel-in-progress:\s*false/.test(prep)
  );
  check("no_whole_run_lock", !/^concurrency:\s*$/m.test(c.split(/\njobs:\s*\n/)[0] || ""));
  check(
    "no_whole_workflow_shared_lock",
    !/^concurrency:\s*\n\s+group:\s*info-events-data-writers/m.test(c)
  );
  check("arming_not_hardcoded_true", !/NDIC_AUTOMATION_ENABLED:\s*['"]?true/.test(c));

  return { ok: localFails.length === 0, fails: localFails };
}

function main() {
  const raw = fs.readFileSync(NET_WF, "utf8");
  const c = stripComments(raw);
  const verifySrc = fs.readFileSync(VERIFY_JS, "utf8");
  const prep = jobChunk(raw, "ndic-prep");
  const write = jobChunk(raw, "ndic-shared-write");
  const spf = jobChunk(raw, "scheduled-preflight");

  const contract = assertAutomaticScheduleContract(raw);
  ok("automatic_schedule_contract", contract.ok, contract.fails.join("|"));

  // ---- A) arming variable missing -> skip with success, no network -------------
  {
    const gate = evaluateScheduleGate({
      eventName: "schedule",
      varsValue: undefined,
      inflightCount: 0,
      inflightQueryOk: true,
    });
    ok("A_missing_var_not_armed", gate.armed === false, String(gate.armed));
    ok("A_missing_var_skips", gate.proceed === false, String(gate.proceed));
    ok("A_missing_var_reason", gate.skipReason === SKIP_NOT_ARMED, gate.skipReason);
    ok("A_missing_var_mode_off", gate.resolvedMode === "off", gate.resolvedMode);
  }

  // ---- B) arming variable false / near-miss values stay disarmed ---------------
  {
    ok("B_false_not_armed", isAutomationArmed("false") === false, "false");
    ok("B_empty_not_armed", isAutomationArmed("") === false, "empty");
    ok("B_one_not_armed", isAutomationArmed("1") === false, "1");
    ok("B_yes_not_armed", isAutomationArmed("yes") === false, "yes");
    ok("B_on_not_armed", isAutomationArmed("on") === false, "on");
    ok("B_truthy_suffix_not_armed", isAutomationArmed("true!") === false, "true!");
    ok("B_null_not_armed", isAutomationArmed(null) === false, "null");
    ok("B_bool_true_not_armed", isAutomationArmed(true) === false, "boolean");
    ok("B_true_is_armed", isAutomationArmed("true") === true, "true");
    ok("B_true_padded_is_armed", isAutomationArmed(" TRUE\n") === true, "padded");
    ok("B_variable_name", AUTOMATION_VARIABLE_NAME === "NDIC_AUTOMATION_ENABLED", AUTOMATION_VARIABLE_NAME);
  }

  // ---- C) armed + inline preflight PASS -> ACTIVE scheduled sync ---------------
  {
    const gate = evaluateScheduleGate({
      eventName: "schedule",
      varsValue: "true",
      inflightCount: 0,
      inflightQueryOk: true,
    });
    ok("C_armed_proceeds", gate.armed === true && gate.proceed === true, gate.skipReason);
    ok("C_scheduled_mode_active", gate.resolvedMode === "active", gate.resolvedMode);
    ok("C_no_skip_reason", gate.skipReason === "", gate.skipReason);
    ok(
      "C_workflow_schedule_mode_active",
      /NDIC_RESOLVED_MODE:\s*\$\{\{\s*github\.event_name == 'schedule' && 'active'/.test(prep),
      "wf-mode"
    );
    ok(
      "C_prep_uses_resolved_mode_for_sync",
      /IU_NDIC_DATEX_V1_MODE:\s*\$\{\{\s*env\.NDIC_RESOLVED_MODE\s*\}\}/.test(prep),
      "sync-mode"
    );
  }

  // ---- D) inline preflight FAIL -> no network prep -----------------------------
  {
    ok(
      "D_prep_blocked_on_preflight_failure",
      /needs\.scheduled-preflight\.result == 'success'/.test(prep),
      "gate"
    );
    const mutated = prep.replace(/needs\.scheduled-preflight\.result == 'success'/, "true");
    ok("D_mutation_detectable", !/needs\.scheduled-preflight\.result == 'success'/.test(mutated), "meta");
    ok(
      "D_preflight_suite_before_publish",
      spf.indexOf("ndic-staging-preflight-suite.mjs") <
        spf.indexOf("ndic-publish-preflight-attestation.mjs"),
      "order"
    );
  }

  // ---- E) attestation HEAD mismatch -> fail-closed ------------------------------
  {
    const head = "a".repeat(40);
    const other = "b".repeat(40);
    const now = Date.parse("2026-08-09T08:00:00.000Z");
    const desc = buildAttestationDescription({
      headSha: head,
      runId: "31323367965",
      expiresAtIso: computeExpiresAtIso(now, 1800),
      attestationId: buildAttestationId("31323367965", "scheduled-preflight"),
    });
    ok(
      "E_status_description_within_github_limit",
      desc.length <= 140,
      String(desc.length)
    );
    ok(
      "E_same_head_verifies",
      verifyAttestationStatus({
        context: PREFLIGHT_STATUS_CONTEXT,
        state: "success",
        description: desc,
        expectedHeadSha: head,
        nowMs: now + 1000,
      }).ok,
      "same-head"
    );
    ok(
      "E_head_mismatch_rejected",
      !verifyAttestationStatus({
        context: PREFLIGHT_STATUS_CONTEXT,
        state: "success",
        description: desc,
        expectedHeadSha: other,
        nowMs: now + 1000,
      }).ok,
      "mismatch"
    );
    ok(
      "E_prep_binds_github_sha",
      /IU_NDIC_PREFLIGHT_EXPECTED_HEAD:\s*\$\{\{\s*github\.sha\s*\}\}/.test(prep),
      "bind"
    );
    ok(
      "E_verify_allows_inline_publisher",
      /"Update NDIC DATEX v1"/.test(verifySrc) && /"NDIC staging preflight"/.test(verifySrc),
      "allowlist"
    );
    ok(
      "E_verify_allowlist_is_closed",
      /ALLOWED_PREFLIGHT_WORKFLOW_NAMES\.includes\(name\)/.test(verifySrc) &&
        !/name !== "NDIC staging preflight"/.test(verifySrc),
      "closed"
    );
  }

  // ---- F) self-hosted runner unavailable -> no GitHub-hosted fallback ----------
  {
    ok("F_prep_no_ubuntu", !/ubuntu-latest/.test(prep), "prep");
    ok("F_write_no_ubuntu", !/ubuntu-latest/.test(write), "write");
    ok("F_prep_refuses_hosted", /REFUSING_GITHUB_HOSTED/.test(prep), "refuse");
    ok("F_prep_no_continue_on_error", !/continue-on-error:\s*true/.test(prep), "coe");
    ok("F_no_fallback_runs_on_expression", !/runs-on:[^\n]*\$\{\{/.test(c), "dynamic");
    ok(
      "F_prep_expected_runner_name",
      /infouzel-ndic-cz-vps4204/.test(prep) && /infouzel-ndic-cz-vps4204/.test(write),
      "name"
    );
  }

  // ---- G) duplicate inflight run -> skip with success ---------------------------
  {
    const runs = [
      { id: "100", status: "in_progress" },
      { id: "200", status: "in_progress" },
      { id: "300", status: "completed" },
    ];
    ok("G_counts_other_inflight", countOtherInflightRuns({ runs, selfRunId: "200" }) === 1, "count");
    ok("G_self_run_excluded", countOtherInflightRuns({ runs: [{ id: "200", status: "in_progress" }], selfRunId: "200" }) === 0, "self");
    const gate = evaluateScheduleGate({
      eventName: "schedule",
      varsValue: "true",
      inflightCount: 1,
      inflightQueryOk: true,
    });
    ok("G_duplicate_skips", gate.proceed === false, "proceed");
    ok("G_duplicate_reason", gate.skipReason === SKIP_DUPLICATE_INFLIGHT, gate.skipReason);
    const degraded = evaluateScheduleGate({
      eventName: "schedule",
      varsValue: "true",
      inflightCount: 0,
      inflightQueryOk: false,
    });
    ok("G_query_failure_fails_closed", degraded.proceed === false, "degraded");
    ok("G_query_failure_reason", degraded.skipReason === SKIP_INFLIGHT_QUERY_FAILED, degraded.skipReason);
    const notSchedule = shouldSkipSchedule({ armed: true, inflightCount: 0, eventName: "push" });
    ok("G_non_schedule_event_skips", notSchedule.skip && notSchedule.reason === SKIP_NOT_SCHEDULE_EVENT, notSchedule.reason);
  }

  // ---- H) CHMI / info-events writers must not block NDIC prep -------------------
  {
    ok("H_prep_uses_staging_group", /group:\s*ndic-datex-v1-internal-staging/.test(prep), "staging");
    ok("H_prep_not_in_writer_lock", !/group:\s*info-events-data-writers/.test(prep), "prep-lock");
    ok("H_write_holds_writer_lock", /group:\s*info-events-data-writers/.test(write), "write-lock");
    ok(
      "H_no_whole_workflow_writer_lock",
      !/^concurrency:\s*\n\s+group:\s*info-events-data-writers/m.test(c),
      "wf-lock"
    );
    ok("H_writer_lock_queue_max", /queue:\s*max\b/.test(write), "queue");
  }

  // ---- I) schedule + manual dispatch -> at most one network run ------------------
  {
    ok(
      "I_orchestration_group_serialises_network",
      /group:\s*ndic-datex-v1-internal-staging/.test(prep),
      "orch"
    );
    ok(
      "I_orchestration_cancel_false",
      /group:\s*ndic-datex-v1-internal-staging\s*\n\s+cancel-in-progress:\s*false/.test(prep),
      "cancel"
    );
    ok("I_no_whole_run_lock_blocking_gate", !/^concurrency:\s*$/m.test(c.split(/\njobs:\s*\n/)[0] || ""), "whole-run");
    ok("I_inflight_guard_present", /ndic-schedule-arming\.mjs/.test(c), "inflight");
    const networkJobs = ["ndic-prep"].filter((j) => /ndic-datex-v1-prod-sync\.mjs/.test(jobChunk(raw, j)));
    ok("I_single_network_job", networkJobs.length === 1, networkJobs.join("+"));
    ok(
      "I_prep_paths_mutually_exclusive",
      /github\.event_name == 'workflow_dispatch'/.test(prep) && /github\.event_name == 'schedule'/.test(prep),
      "paths"
    );
  }

  // ---- J) data PR contract stays single-branch, no duplicate PR references -------
  {
    // Presence check (test -f) + exactly one node open/refresh (canonical PR).
    // Bounded reconcile runs in the same shared-write job (no second Data PR helper).
    const prNodeCalls = (c.match(/node\s+ndic-orch\/scripts\/ndic-open-or-refresh-data-pr\.mjs/g) || [])
      .length;
    const prRefs = (c.match(/ndic-open-or-refresh-data-pr\.mjs/g) || []).length;
    ok("J_single_data_pr_helper_call", prNodeCalls === 1 && prRefs === 2, String(prNodeCalls) + "/" + prRefs);
    ok("J_no_gh_pr_create", !/gh pr create/.test(c), "gh-cli");
    const branchRefs = new Set((c.match(/automation\/update-ndic-datex-v1/g) || []));
    ok("J_single_automation_branch", branchRefs.size === 1, String(branchRefs.size));
    ok("J_pr_only_in_shared_write", !/ndic-open-or-refresh-data-pr\.mjs/.test(prep), "prep-pr");
    ok("J_pr_after_push_only", /if:\s*steps\.commit_push\.outputs\.pushed == 'true'/.test(write), "guard");
    ok(
      "J_inline_bounded_reconcile",
      /ndic-data-pr-reconcile-against-main\.mjs/.test(write) &&
        !/\n {2}ndic-reconcile-data-pr:/.test(c),
      "inline"
    );
  }

  // ---- K) base freshness / finalization protocol survive the schedule ------------
  {
    ok(
      "K_finalization_binding_recorded",
      /iu-data-pr-finalization-protocol\.mjs record-binding/.test(write),
      "binding"
    );
    ok("K_reread_before_apply", /git -C ndic-main-data fetch origin main/.test(write), "reread");
    ok(
      "K_shared_writer_critical_reread",
      /info-events-shared-writer-critical\.mjs\s+ndic/.test(write),
      "critical"
    );
    ok("K_base_from_latest_main", /checkout -B "\$\{\{ env\.AUTOMATION_BRANCH \}\}" origin\/main/.test(write), "base");
    ok(
      "K_suite_includes_base_freshness",
      /iu-data-pr-base-freshness-guard/.test(
        fs.readFileSync(path.join(ROOT, "scripts", "ndic-staging-preflight-suite.mjs"), "utf8")
      ),
      "suite"
    );
  }

  // ---- L) default stays unarmed and manual break-glass is preserved --------------
  {
    ok("L_no_hardcoded_arming", !/NDIC_AUTOMATION_ENABLED:\s*['"]?true/.test(c), "hardcoded");
    ok("L_dispatch_mode_choice", /options:\n\s+- off\n\s+- shadow\n\s+- active/.test(c), "choice");
    ok("L_dispatch_default_off", /default:\s*off\b/.test(c), "default");
    ok("L_dispatch_attestation_input", /preflight_attestation_id:/.test(c), "aid");
    ok(
      "L_dispatch_attestation_used",
      /github\.event\.inputs\.preflight_attestation_id/.test(prep),
      "aid-used"
    );
    ok(
      "L_dispatch_mode_resolution",
      resolveScheduledMode({ eventName: "workflow_dispatch", dispatchMode: "shadow" }) === "shadow" &&
        resolveScheduledMode({ eventName: "workflow_dispatch", dispatchMode: "active" }) === "active" &&
        resolveScheduledMode({ eventName: "workflow_dispatch", dispatchMode: "off" }) === "off",
      "dispatch-modes"
    );
    ok(
      "L_schedule_mode_requires_proceed",
      resolveScheduledMode({ eventName: "schedule", proceed: false }) === "off" &&
        resolveScheduledMode({ eventName: "schedule", proceed: true }) === "active",
      "schedule-modes"
    );
  }

  const report = {
    suite: "NDIC_AUTOMATIC_SCHEDULE_FIXTURES",
    TARGET_OPERATION_MODE: "AUTOMATIC_SCHEDULED_NDIC_SYNC_WITH_CONTINUOUS_SELF_HOSTED_RUNNER",
    total: passCount + fails.length,
    success: passCount,
    failure: fails.length,
    cron: CONSERVATIVE_CRON,
    armingVariable: AUTOMATION_VARIABLE_NAME,
    ARMED_BY_DEFAULT: "NO",
    NETWORK_ON_GITHUB_HOSTED: "NO",
    fails,
  };
  if (fails.length) {
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(report, null, 2));
}

const isDirect =
  process.argv[1] &&
  String(process.argv[1]).replace(/\\/g, "/").endsWith("ndic-automatic-schedule-fixtures.mjs");
if (isDirect) main();
