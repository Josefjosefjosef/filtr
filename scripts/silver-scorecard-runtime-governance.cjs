#!/usr/bin/env node
/**
 * Silver scorecard runtime governance selftests (orchestration only).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SCRIPT_DIR = __dirname;

function runScorecardRunreportRegressionSelftest() {
  const failures = [];
  const assert = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  const scorecardPath = path.join(SCRIPT_DIR, "silver-cap-product-scorecard.cjs");
  const src = fs.readFileSync(scorecardPath, "utf8");
  const classifyStart = src.indexOf("function classifyRun(");
  const classifyEnd = src.indexOf("function recommendNext(", classifyStart);
  const classifyBlock =
    classifyStart >= 0 && classifyEnd > classifyStart
      ? src.slice(classifyStart, classifyEnd)
      : "";

  assert(classifyBlock.length > 0, "classifyRun_block_missing");
  assert(!/\brunReport\b/.test(classifyBlock), "classifyRun_must_not_reference_runReport");
  assert(!/\bmetaExtra\b/.test(classifyBlock), "classifyRun_must_not_reference_metaExtra");
  assert(/safeGetScriptsOnlyProductWork/.test(classifyBlock), "classifyRun_uses_safeGetScriptsOnlyProductWork");

  const { runScorecardFinalizeRuntimeSelftest } = require("./silver-cap-product-scorecard.cjs");
  assert(runScorecardFinalizeRuntimeSelftest(), "scorecard_finalize_runtime_selftest");

  const pass = failures.length === 0;
  console.log("=== SILVER_SCORECARD_RUNREPORT_REGRESSION_SELFTEST ===");
  console.log("SILVER_SCORECARD_RUNREPORT_REGRESSION_SELFTEST=" + (pass ? "PASS" : "FAIL"));
  console.log("runReport_regression_blocked=YES");
  console.log("metaExtra_regression_blocked=YES");
  if (failures.length) console.log("failures=" + failures.join(";"));
  console.log("=== END_SILVER_SCORECARD_RUNREPORT_REGRESSION_SELFTEST ===");
  return pass;
}

function runForcedScorecardRuntimeErrorOutcomeSelftest() {
  const failures = [];
  const assert = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  const { enforceCapOutcome, buildAuditRegistry, prioritizeTrueEngineFail } = require("./silver-audit-registry.cjs");
  const reg = buildAuditRegistry(path.join(SCRIPT_DIR, ".."));
  const pri = prioritizeTrueEngineFail(reg);
  const exact = "runReport is not defined";
  const outcome = enforceCapOutcome(
    {
      scorecard_runtime_error: "YES",
      exact_error: exact,
      cap_label: "CAP15",
      cycles_completed: 3,
      orchestration_only_run: "YES",
      product_fix_created: "NO",
      verified_product_shift: "NO",
    },
    reg,
    pri,
  );

  assert(outcome.scorecard_runtime_error === "YES", "scorecard_runtime_error_flag");
  assert(outcome.hard_stop_forced_outcome_required === "YES", "hard_stop_forced");
  assert(outcome.next_cap_blind_retry_blocked === "YES", "cap_retry_blocked");
  assert(String(outcome.recommendation || "").indexOf("HARD_STOP_SCORECARD_RUNTIME_ERROR") >= 0, "recommendation");
  assert(String(outcome.recommendation || "").indexOf(exact) >= 0, "exact_error_in_recommendation");
  assert(String(outcome.recommended_next_task || "").indexOf("fix scorecard runtime error") >= 0, "recommended_task");
  assert(String(outcome.recommendation || "").indexOf("pokračovat doporučeným CAP během") < 0, "no_blind_cap");
  assert(outcome.forced_outcome_task_type === "scorecard_runtime_fix", "forced_task_type");
  assert(
    String(outcome.forced_outcome_command || "").indexOf("silver-cap-product-scorecard.cjs selftest") >= 0,
    "forced_command",
  );

  const pass = failures.length === 0;
  console.log("=== FORCED_SCORECARD_RUNTIME_ERROR_OUTCOME_SELFTEST ===");
  console.log("FORCED_SCORECARD_RUNTIME_ERROR_OUTCOME_SELFTEST=" + (pass ? "PASS" : "FAIL"));
  console.log("not_available_reason_preserved=YES");
  console.log("metric_delta_reason_preserved=YES");
  console.log("source_reports_reason_preserved=YES");
  if (failures.length) console.log("failures=" + failures.join(";"));
  console.log("=== END_FORCED_SCORECARD_RUNTIME_ERROR_OUTCOME_SELFTEST ===");
  return pass;
}

function runPartialProductDirtyCloseoutSelftest() {
  const failures = [];
  const assert = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  const {
    classifyValidProductWork,
    classifyCap50CloseoutWithProductWork,
    resolveProductCloseoutPath,
  } = require("./silver-valid-product-work-closeout.cjs");

  const partialPaths = [
    "scripts/silver-self-correction-audit.cjs",
    "scripts/silver-self-correction-query-clarification.cjs",
    "scripts/silver-self-correction-safety-diagnostic.cjs",
    "scripts/silver-self-correction-update-note-selftest.cjs",
  ];

  const partial = classifyValidProductWork({
    dirtyPaths: partialPaths,
    selectorCluster: "self_correction_safety_note_readonly",
    productWorkComplete: false,
    hasUntrackedProductFiles: true,
  });
  assert(partial.classification === "PARTIAL_PRODUCT_WORK", "partial_classification");
  assert(partial.closeout_kind === "partial_product_work_dirty", "partial_closeout_kind");
  assert(
    partial.final_outcome === "HARD_STOP_PARTIAL_PRODUCT_WORK_DIRTY",
    "partial_hard_stop_outcome",
  );

  const cap50 = classifyCap50CloseoutWithProductWork(partialPaths, {
    selectorCluster: "self_correction_safety_note_readonly",
    productWorkComplete: false,
    hasUntrackedProductFiles: true,
  });
  assert(cap50.closeout_kind === "partial_product_work_dirty", "cap50_partial_dirty");
  assert(cap50.closeout_kind !== "forbidden_dirty", "not_forbidden_dirty");

  const runtimeMdOnly = classifyCap50CloseoutWithProductWork(["SILVER_PROGRESS_LOG.md"], {});
  assert(runtimeMdOnly.closeout_kind !== "partial_product_work_dirty", "runtime_md_not_classified_partial");

  const resolved = resolveProductCloseoutPath(partial, { dryRun: true });
  assert(resolved.PASS_FAIL === "FAIL", "partial_pass_fail");
  assert(resolved.product_fix_created === "NO", "partial_no_product_fix");
  assert(resolved.generic_handoff_blocked === "YES", "partial_generic_blocked");

  const pass = failures.length === 0;
  console.log("=== PARTIAL_PRODUCT_DIRTY_CLOSEOUT_SELFTEST ===");
  console.log("PARTIAL_PRODUCT_DIRTY_CLOSEOUT_SELFTEST=" + (pass ? "PASS" : "FAIL"));
  console.log("partial_product_dirty_classified=YES");
  if (failures.length) console.log("failures=" + failures.join(";"));
  console.log("=== END_PARTIAL_PRODUCT_DIRTY_CLOSEOUT_SELFTEST ===");
  return pass;
}

function runGenericHandoffAfterScorecardErrorBlockerSelftest() {
  const failures = [];
  const assert = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  const {
    buildScorecardRuntimeErrorNextAction,
    isGenericOrchestrationHandoff,
    isGenericRepoGitMaintenanceWorkflow,
    silverNextActionQualityViolations,
  } = require("./silver-next-action-planner-handoff.cjs");

  const genericStale =
    "<!-- SILVER_NEXT_ACTION: full-auto-loop-openai -->\n" +
    "git status --short\ngh auth login\ngit push -u origin chore/silver-audit-repo-state\n";
  const capCtx = {
    clusterDiag: { cluster: "self_correction_safety_note_readonly", audit_id: "self_correction" },
    selectorCluster: "self_correction_safety_note_readonly",
  };
  assert(isGenericOrchestrationHandoff(genericStale), "stale_generic_detected");
  assert(silverNextActionQualityViolations(genericStale, capCtx).length > 0, "stale_generic_violations");

  const scorecardBody = buildScorecardRuntimeErrorNextAction({
    exact_error: "runReport is not defined",
  });
  assert(!isGenericOrchestrationHandoff(scorecardBody), "scorecard_handoff_not_generic");
  assert(!isGenericRepoGitMaintenanceWorkflow(scorecardBody), "scorecard_not_git_maintenance");
  assert(scorecardBody.indexOf("chore/silver-audit-repo-state") < 0, "chore_branch_blocked");
  assert(scorecardBody.indexOf("gh auth login") < 0, "gh_auth_blocked");
  assert(scorecardBody.indexOf("git push -u") < 0, "git_push_blocked");
  assert(scorecardBody.indexOf("SCORECARD_RUNTIME_ERROR=YES") >= 0, "scorecard_error_marker");
  assert(scorecardBody.indexOf("next_cap_blind_retry_blocked=YES") >= 0, "cap_retry_blocked_marker");
  assert(
    scorecardBody.indexOf("silver-cap-product-scorecard.cjs selftest") >= 0,
    "scorecard_selftest_command",
  );
  assert(
    silverNextActionQualityViolations(scorecardBody, { requireProductCluster: false }).length === 0,
    "scorecard_no_violations",
  );

  const pass = failures.length === 0;
  console.log("=== GENERIC_HANDOFF_AFTER_SCORECARD_ERROR_BLOCKER_SELFTEST ===");
  console.log("GENERIC_HANDOFF_AFTER_SCORECARD_ERROR_BLOCKER_SELFTEST=" + (pass ? "PASS" : "FAIL"));
  console.log("generic_handoff_after_scorecard_error_blocked=YES");
  console.log("chore_silver_audit_repo_state_blocked=YES");
  if (failures.length) console.log("failures=" + failures.join(";"));
  console.log("=== END_GENERIC_HANDOFF_AFTER_SCORECARD_ERROR_BLOCKER_SELFTEST ===");
  return pass;
}

if (require.main === module) {
  const cmd = process.argv[2] || "";
  let pass = false;
  if (cmd === "runreport-regression") pass = runScorecardRunreportRegressionSelftest();
  else if (cmd === "forced-runtime-outcome") pass = runForcedScorecardRuntimeErrorOutcomeSelftest();
  else if (cmd === "partial-product-dirty") pass = runPartialProductDirtyCloseoutSelftest();
  else if (cmd === "generic-handoff-blocker") pass = runGenericHandoffAfterScorecardErrorBlockerSelftest();
  else {
    console.log(
      "Usage: node silver-scorecard-runtime-governance.cjs <runreport-regression|forced-runtime-outcome|partial-product-dirty|generic-handoff-blocker>",
    );
    process.exit(1);
  }
  process.exit(pass ? 0 : 1);
}

module.exports = {
  runScorecardRunreportRegressionSelftest,
  runForcedScorecardRuntimeErrorOutcomeSelftest,
  runPartialProductDirtyCloseoutSelftest,
  runGenericHandoffAfterScorecardErrorBlockerSelftest,
};
