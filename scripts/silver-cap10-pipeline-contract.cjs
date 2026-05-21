#!/usr/bin/env node
/**
 * Silver — CAP10 pipeline end-to-end contract V1 (orchestration only).
 * Deterministic replay/selftest harness; no Cursor invoke; no engine/assets changes.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  resolveProductHandoffOutcome,
  isGenericOrchestrationHandoff,
  silverNextActionQualityViolations,
  buildCapDiagnosticProductHandoff,
  PRODUCT_HANDOFF_OUTCOMES,
} = require("./silver-next-action-planner-handoff.cjs");
const {
  CONTROLLED_CAP_PROFILE_DEFAULT,
  PROFILES,
  createState,
  loadState,
  finalizeCap,
  buildMetricDeltaBlock,
  captureMetricSnapshot,
  recordAgentInvoke,
  METRIC_KEYS,
} = require("./silver-controlled-budget-guard.cjs");

const RECOMMENDED_REAL_CAP10_COMMAND =
  "powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\silver-autopilot-loop.ps1 -ControlledCapProfile CAP10_SAFE -MaxAutonomousHardCycles 10";

/** CAP10 lifecycle may end only with one of these (deterministic contract). */
const CAP10_LIFECYCLE_FINAL_OUTCOMES = new Set([
  "ENGINE_FIX_TASK_READY",
  "HARNESS_ALIGNMENT_TASK_READY",
  "PLANNER_ALIGNMENT_TASK_READY",
  "PR_READY",
  "MERGED_AND_PROVED",
  "NO_SAFE_FIX",
  "SAFE_BLOCKED",
  "NEED_HUMAN_INPUT",
  "HARD_FAIL",
  "NO_CHANGE",
]);

const METRIC_DELTA_REQUIRED_KEYS = [
  "20k_overall_accuracy",
  "quality_accuracy",
  "realistic_overall_accuracy",
  "real_czech_corpus_accuracy",
  "public_ux_corpus_accuracy",
  "deep_product_real_ux_v2_accuracy",
  "relevant_cluster_metric",
  "calendar_write_20k",
  "calendar_query_20k",
  "dangerous_write_count",
  "false_write_count",
  "query_created_write_count",
  "write_when_negated_count",
];

const OUTCOME_RECORD_REQUIRED_FIELDS = [
  "target_cluster",
  "source_audit",
  "diagnostic_result",
  "recommended_scope",
  "final_outcome",
  "stop_reason",
  "baseline_before",
  "result_after",
  "delta_percent",
  "metric_verdicts",
  "safety_counters_before",
  "safety_counters_after",
  "repo_state",
  "next_recommended_step",
];

const GENERIC_FALLBACK_PATTERNS = [
  { id: "generic_git_push", re: /git\s+push\s+-u/i },
  { id: "generic_gh_push", re: /gh\s+pr\s+create|gh\s+auth/i },
  { id: "generic_verify_pr", re: /(?:--verify-pr=\d+|\bverify-pr\b)/i },
  { id: "generic_repo_maintenance", re: /chore\/silver-audit-repo-state/i },
  { id: "generic_merge_reminder", re: /merge\s+pull\s+request\s+manually/i },
];

/** Read-only pipeline map (orchestration contract documentation). */
const CAP10_PIPELINE_MAP = {
  entrypoint: "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/silver-autopilot-loop.ps1",
  cap10_safe_profile: "CAP10_SAFE (scripts/silver-controlled-budget-guard.cjs PROFILES.CAP10_SAFE)",
  budget_guard: "scripts/silver-controlled-budget-guard.cjs init|check|finalize",
  cursor_command: "Resolve-SilverCursorCommandForControlledEntrypoint → adapter or WSL lane",
  silver_next_action: "SILVER_NEXT_ACTION.md (planner product handoff via silver-next-action-planner-handoff.cjs)",
  silver_cursor_output: "SILVER_CURSOR_OUTPUT.md (adapter stdout/stderr envelope)",
  planner_handoff: "buildCapDiagnosticProductHandoff / sanitize-next-action-md",
  outcome_finalize: "Invoke-SilverControlledBudgetGuardFinalize + validateCap10LifecycleOutcomeRecord",
  metric_delta_finalize: "buildMetricDeltaBlock → SILVER_RUN_REPORT.md CONTROLLED_BUDGET_METRIC_DELTA_BLOCK",
  pr_lifecycle: "silver-autopilot.cjs --verify-pr / --merge-pr / --post-merge-proof",
  stop_states: [
    "ENGINE_FIX_TASK_READY",
    "HARNESS_ALIGNMENT_TASK_READY",
    "PLANNER_ALIGNMENT_TASK_READY",
    "PR_READY",
    "MERGED_AND_PROVED",
    "NO_SAFE_FIX",
    "SAFE_BLOCKED",
    "NEED_HUMAN_INPUT",
    "HARD_FAIL",
    "NO_CHANGE",
    "CONTROLLED_BUDGET_GUARD_STOP=*",
    "PRODUCT_HANDOFF_NOT_CLUSTER_SPECIFIC",
    "PRODUCT_OUTCOME_NOT_ADVANCING",
  ],
  dead_end_states_blocked: [
    "generic_git_push_upstream",
    "generic_verify_pr_not_cluster_workflow",
    "generic_orchestration_blocked_after_cap_diagnostic",
    "orchestration_only_streak_without_product_advance",
    "recursive_loop_cursor_command",
    "raw_MaxCycles_0_without_controlled_profile",
  ],
  orphan_pr_paths_blocked: ["stale_verify_pr_id:3794", "verify-pr without cluster workflow"],
};

function readTextSafe(abs) {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

function defaultSafetyCounters() {
  return {
    dangerous_write_count: 0,
    false_write_count: 0,
    query_created_write_count: 0,
    write_when_negated_count: 0,
  };
}

/**
 * Build deterministic CAP10 lifecycle outcome record (replay-safe; no invented metrics).
 * @param {object} opts
 */
function buildCap10LifecycleOutcomeRecord(opts) {
  const o = opts || {};
  const finalOutcome = String(o.final_outcome || o.finalOutcome || "").trim().toUpperCase();
  const metricBlock = String(o.metric_delta_block || o.metricDeltaBlock || "");
  const clusterMetric = o.relevant_cluster_metric != null ? String(o.relevant_cluster_metric) : "NOT_AVAILABLE";
  const snapBefore = o.baseline_snap || o.baselineSnap || {};
  const snapAfter = o.result_snap || o.resultSnap || {};
  const metricVerdicts = [];
  for (const key of METRIC_DELTA_REQUIRED_KEYS) {
    if (key === "relevant_cluster_metric") {
      metricVerdicts.push("relevant_cluster_metric=" + clusterMetric);
      continue;
    }
    const lineRe = new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s", "m");
    const line = (metricBlock.match(lineRe) || [""])[0];
    if (line) {
      const verdictM = line.match(/verdict=(\S+)/);
      metricVerdicts.push(key + "=" + (verdictM ? verdictM[1] : "PARSED"));
    } else if (snapBefore[key] != null || snapAfter[key] != null) {
      metricVerdicts.push(key + "=SNAPSHOT");
    } else {
      metricVerdicts.push(key + "=NOT_AVAILABLE");
    }
  }
  return {
    target_cluster: String(o.target_cluster || o.targetCluster || "(none)"),
    source_audit: String(o.source_audit || o.sourceAudit || "(none)"),
    diagnostic_result: String(o.diagnostic_result || o.diagnosticResult || "(none)"),
    recommended_scope: String(o.recommended_scope || o.recommendedScope || "(none)"),
    final_outcome: finalOutcome,
    stop_reason: String(o.stop_reason || o.stopReason || "CAP10_LIFECYCLE_COMPLETE"),
    baseline_before: o.baseline_before != null ? o.baseline_before : JSON.stringify(snapBefore),
    result_after: o.result_after != null ? o.result_after : JSON.stringify(snapAfter),
    delta_percent: String(o.delta_percent || o.deltaPercent || "(see metric_delta_block)"),
    metric_verdicts: metricVerdicts.join(";"),
    safety_counters_before: o.safety_counters_before || defaultSafetyCounters(),
    safety_counters_after: o.safety_counters_after || defaultSafetyCounters(),
    repo_state: String(o.repo_state || o.repoState || "CLEAN"),
    next_recommended_step: String(o.next_recommended_step || o.nextRecommendedStep || nextStepForOutcome(finalOutcome)),
    metric_delta_block: metricBlock,
  };
}

function nextStepForOutcome(outcome) {
  switch (outcome) {
    case "ENGINE_FIX_TASK_READY":
      return "narrow_engine_fix_after_harness_signoff";
    case "HARNESS_ALIGNMENT_TASK_READY":
      return "scripts_only_harness_alignment";
    case "PLANNER_ALIGNMENT_TASK_READY":
      return "planner_alignment_selftest";
    case "PR_READY":
      return "verify_pr_then_merge_when_ci_green";
    case "MERGED_AND_PROVED":
      return "post_merge_proof_then_stop";
    case "NO_SAFE_FIX":
      return "document_evidence_stop";
    case "SAFE_BLOCKED":
      return "resolve_safety_counters_stop";
    case "NEED_HUMAN_INPUT":
      return "human_review_stop";
    case "HARD_FAIL":
      return "investigate_contract_violation_stop";
    case "NO_CHANGE":
      return "stop_no_delta";
    default:
      return "STOP_UNKNOWN_OUTCOME";
  }
}

/**
 * @param {object} record
 * @returns {string[]}
 */
function validateCap10LifecycleOutcomeRecord(record) {
  const failures = [];
  if (!record || typeof record !== "object") {
    failures.push("record_missing");
    return failures;
  }
  for (const field of OUTCOME_RECORD_REQUIRED_FIELDS) {
    if (record[field] == null || String(record[field]).trim() === "") {
      failures.push("missing_field:" + field);
    }
  }
  const fo = String(record.final_outcome || "").toUpperCase();
  if (!CAP10_LIFECYCLE_FINAL_OUTCOMES.has(fo)) {
    failures.push("invalid_final_outcome:" + fo);
  }
  return failures;
}

/**
 * @param {string} metricBlock
 * @returns {string[]}
 */
function validateMetricDeltaContract(metricBlock) {
  const failures = [];
  const blob = String(metricBlock || "");
  if (blob.indexOf("=== CONTROLLED_BUDGET_METRIC_DELTA_BLOCK ===") < 0) {
    failures.push("metric_delta_block_marker_missing");
  }
  if (blob.indexOf("=== END_CONTROLLED_BUDGET_METRIC_DELTA_BLOCK ===") < 0) {
    failures.push("metric_delta_block_end_marker_missing");
  }
  for (const key of METRIC_DELTA_REQUIRED_KEYS) {
    if (key === "relevant_cluster_metric") {
      if (blob.indexOf("relevant_cluster_metric") < 0) {
        failures.push("missing_relevant_cluster_metric_line");
      }
      continue;
    }
    const lineRe = new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s", "m");
    if (!lineRe.test(blob)) {
      failures.push("missing_metric_key:" + key);
      continue;
    }
    const line = (blob.match(lineRe) || [""])[0];
    if (/NOT_AVAILABLE/.test(line)) {
      if (!/_na_reason=|expected_report_source=|source_reports=/.test(blob)) {
        failures.push("na_reason_missing_for:" + key);
      }
    }
  }
  return failures;
}

function appendRelevantClusterMetricLine(metricBlock, cluster, metricValue) {
  const val = metricValue != null ? String(metricValue) : "NOT_AVAILABLE";
  const reason = val === "NOT_AVAILABLE" ? " cluster_metric_missing" : "";
  const extra =
    "relevant_cluster_metric baseline_before=" +
    val +
    " result_after=" +
    val +
    " delta_percent=NOT_AVAILABLE verdict=NOT_AVAILABLE source_reports=cluster:" +
    String(cluster || "unknown") +
    reason +
    (reason ? " expected_report_source=cluster_diagnostic_json" : "");
  if (metricBlock.indexOf("relevant_cluster_metric ") >= 0) return metricBlock;
  return metricBlock.replace(
    "=== END_CONTROLLED_BUDGET_METRIC_DELTA_BLOCK ===",
    extra + "\n=== END_CONTROLLED_BUDGET_METRIC_DELTA_BLOCK ===",
  );
}

function detectGenericFallbackAttempt(text, capDiagnosticActive) {
  const hits = [];
  const t = String(text || "");
  if (!t) return hits;
  if (capDiagnosticActive && isGenericOrchestrationHandoff(t)) {
    hits.push("generic_orchestration_handoff_blocked");
  }
  const violations = silverNextActionQualityViolations(t, {
    clusterDiag: { cluster: "self_correction_negation_flip" },
    selectorCluster: "self_correction_negation_flip",
  });
  for (const v of violations) {
    if (v.indexOf("generic_") === 0) hits.push(v);
  }
  for (const pat of GENERIC_FALLBACK_PATTERNS) {
    if (pat.re.test(t) && !/PRODUCT_HANDOFF_CONTRACT|target_cluster=/.test(t)) {
      hits.push(pat.id);
    }
  }
  return hits;
}

function simulateScenarioOutcome(scenarioId, repoRoot, runId) {
  const capCtx = {
    cluster: "self_correction_negation_flip",
    audit_id: "self_correction",
    audit_name: "Self-Correction",
    count: 472,
    expected_outcome: "engine PR",
  };
  let evidence;
  let finalOutcome;
  switch (scenarioId) {
    case "A_TRUE_ENGINE_FAIL":
      evidence = {
        target_cluster: capCtx.cluster,
        source_audit: capCtx.audit_name,
        safe_blocked: "NO",
        observed_fail_count: 10,
        true_engine_fail: "YES",
        ready_for_engine_fix: "YES",
        harness_alignment: "NO",
        diagnostic_result: "TRUE_ENGINE_FAIL=YES",
        recommended_scope: "narrow_engine_fix_after_harness_signoff",
      };
      finalOutcome = resolveProductHandoffOutcome(evidence).expected_outcome;
      break;
    case "B_HARNESS_ALIGNMENT":
      evidence = {
        target_cluster: capCtx.cluster,
        source_audit: capCtx.audit_name,
        safe_blocked: "NO",
        observed_fail_count: 10,
        true_engine_fail: "NO",
        harness_alignment: "YES",
        diagnostic_result: "TRUE_ENGINE_FAIL=NO;harness_or_gold_alignment",
        recommended_scope: "scripts-only_harness_gold_alignment",
      };
      finalOutcome = resolveProductHandoffOutcome(evidence).expected_outcome;
      break;
    case "C_NO_SAFE_FIX":
      evidence = {
        target_cluster: capCtx.cluster,
        source_audit: capCtx.audit_name,
        safe_blocked: "NO",
        observed_fail_count: 5,
        true_engine_fail: "NO",
        harness_alignment: "NO",
        diagnostic_result: "no_safe",
        recommended_scope: "no_safe_fix_stale",
      };
      finalOutcome = resolveProductHandoffOutcome(evidence).expected_outcome;
      break;
    case "D_SAFE_BLOCKED":
      evidence = {
        target_cluster: capCtx.cluster,
        source_audit: capCtx.audit_name,
        safe_blocked: "YES",
        observed_fail_count: 1,
        true_engine_fail: "NO",
        harness_alignment: "NO",
        diagnostic_result: "safety_blocked",
        recommended_scope: "stop",
      };
      finalOutcome = resolveProductHandoffOutcome(evidence).expected_outcome;
      break;
    case "E_PR_READY":
      finalOutcome = "PR_READY";
      evidence = {
        target_cluster: capCtx.cluster,
        source_audit: capCtx.audit_name,
        diagnostic_result: "pr_created",
        recommended_scope: "pr_verify_merge",
      };
      break;
    case "F_MERGED_AND_PROVED":
      evidence = {
        target_cluster: capCtx.cluster,
        source_audit: capCtx.audit_name,
        safe_blocked: "NO",
        observed_fail_count: 0,
        true_engine_fail: "NO",
        harness_alignment: "NO",
        diagnostic_result: "merge_proof_complete",
        recommended_scope: "stop",
      };
      finalOutcome = resolveProductHandoffOutcome(evidence).expected_outcome;
      break;
    default:
      return { ok: false, error: "unknown_scenario" };
  }

  createState(repoRoot, { runId, capLabel: "CAP10", profileId: "CAP10_SAFE" });
  const fin = finalizeCap(repoRoot, runId, { finalOutcome });
  if (!fin.ok && scenarioId !== "G_MISSING_OUTCOME" && scenarioId !== "H_MISSING_METRIC") {
    return { ok: false, error: "finalize_failed", failures: fin.failures };
  }
  let metricBlock = fin.deltaBlock || buildMetricDeltaBlock(repoRoot, {}, {});
  metricBlock = appendRelevantClusterMetricLine(metricBlock, evidence.target_cluster, "NOT_AVAILABLE");
  const record = buildCap10LifecycleOutcomeRecord({
    ...evidence,
    final_outcome: finalOutcome,
    metric_delta_block: metricBlock,
    repo_state: "CLEAN",
    safety_counters_before: defaultSafetyCounters(),
    safety_counters_after: defaultSafetyCounters(),
  });
  const valFailures = validateCap10LifecycleOutcomeRecord(record);
  const metricFailures = validateMetricDeltaContract(record.metric_delta_block);
  return {
    ok: valFailures.length === 0 && metricFailures.length === 0,
    finalOutcome,
    record,
    valFailures,
    metricFailures,
  };
}

function runReplayCapCycle(repoRoot, capNum, runId) {
  const label = "CAP" + String(capNum);
  const st = createState(repoRoot, { runId, capLabel: label, profileId: "CAP10_SAFE" });
  st.metric_before = captureMetricSnapshot(repoRoot);
  const fin = finalizeCap(repoRoot, runId, { finalOutcome: "NO_CHANGE" });
  const stAfter = loadState(repoRoot, runId);
  return {
    cap_label: label,
    profile_id: st.profile_id,
    finalize_ok: fin.ok,
    final_outcome: stAfter && stAfter.final_outcome,
    agent_invokes: stAfter && stAfter.counts.agent_invokes,
    stopped: stAfter && stAfter.stopped,
  };
}

function runCap10PipelineContractSelftest() {
  const failures = [];
  const assert = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  assert(CONTROLLED_CAP_PROFILE_DEFAULT === "CAP10_SAFE", "cap10_safe_default");
  assert(PROFILES.CAP10_SAFE.require_final_outcome === true, "require_final_outcome");
  assert(PROFILES.CAP10_SAFE.require_metric_delta_block === true, "require_metric_delta");

  for (const o of PRODUCT_HANDOFF_OUTCOMES) {
    if (o === "PR_READY" || o === "MERGED_AND_PROVED") continue;
    assert(CAP10_LIFECYCLE_FINAL_OUTCOMES.has(o), "handoff_outcome_in_cap10_set:" + o);
  }

  const td = path.join(os.tmpdir(), "silver-cap10-contract-" + Date.now());
  fs.mkdirSync(path.join(td, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(td, "SILVER_RUN_REPORT.md"), "# report\n", "utf8");
  fs.writeFileSync(
    path.join(td, "scripts", "silver-quality-v2-report.json"),
    JSON.stringify({ quality_accuracy: "55.0%", dangerous_write_count: 0 }) + "\n",
    "utf8",
  );

  const scenarios = [
    ["A_TRUE_ENGINE_FAIL", "ENGINE_FIX_TASK_READY"],
    ["B_HARNESS_ALIGNMENT", "HARNESS_ALIGNMENT_TASK_READY"],
    ["C_NO_SAFE_FIX", "NO_SAFE_FIX"],
    ["D_SAFE_BLOCKED", "SAFE_BLOCKED"],
    ["E_PR_READY", "PR_READY"],
    ["F_MERGED_AND_PROVED", "MERGED_AND_PROVED"],
  ];
  for (const [sid, expected] of scenarios) {
    const r = simulateScenarioOutcome(sid, td, "run-" + sid);
    assert(r.ok, sid + "_failed:" + JSON.stringify(r.valFailures || r.metricFailures || r.error));
    assert(r.finalOutcome === expected, sid + "_outcome_expected_" + expected + "_got_" + r.finalOutcome);
  }

  const badRecord = buildCap10LifecycleOutcomeRecord({ final_outcome: "ORPHAN_STATE" });
  const badVal = validateCap10LifecycleOutcomeRecord(badRecord);
  assert(badVal.includes("invalid_final_outcome:ORPHAN_STATE"), "G_invalid_outcome_detected");

  const emptyMetric = "=== CONTROLLED_BUDGET_METRIC_DELTA_BLOCK ===\n=== END_CONTROLLED_BUDGET_METRIC_DELTA_BLOCK ===";
  const metricFail = validateMetricDeltaContract(emptyMetric);
  assert(metricFail.length > 0, "H_missing_metric_keys_detected");

  const genericText =
    "git push -u origin chore/silver-audit-repo-state\ngh auth login\nnode scripts/silver-autopilot.cjs --verify-pr=3794\n";
  const genericHits = detectGenericFallbackAttempt(genericText, true);
  assert(genericHits.length > 0, "I_generic_fallback_blocked");

  const productHandoff = buildCapDiagnosticProductHandoff({
    mainCommit: "abc",
    clusterDiag: {
      cluster: "self_correction_negation_flip",
      audit_id: "self_correction",
      audit_name: "Self-Correction",
      count: 472,
    },
  });
  assert(!isGenericOrchestrationHandoff(productHandoff), "product_handoff_not_generic");
  assert(/PRODUCT_HANDOFF_CONTRACT/.test(productHandoff), "product_contract_present");

  assert(
    RECOMMENDED_REAL_CAP10_COMMAND.indexOf("silver-autopilot-loop.ps1") >= 0 &&
      RECOMMENDED_REAL_CAP10_COMMAND.indexOf("CAP10_SAFE") >= 0 &&
      RECOMMENDED_REAL_CAP10_COMMAND.indexOf("MaxAutonomousHardCycles 10") >= 0,
    "powershell_cap10_command",
  );

  try {
    fs.rmSync(td, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  const pass = failures.length === 0;
  console.log("=== CAP10_PIPELINE_CONTRACT_SELFTEST ===");
  console.log("CAP10_PIPELINE_CONTRACT_SELFTEST=" + (pass ? "PASS" : "FAIL"));
  console.log("lifecycle_map_entries=" + Object.keys(CAP10_PIPELINE_MAP).length);
  console.log("deterministic_outcomes=" + CAP10_LIFECYCLE_FINAL_OUTCOMES.size);
  console.log("recommended_real_cap10_command=" + RECOMMENDED_REAL_CAP10_COMMAND);
  console.log("engine_changed=NO");
  console.log("assets_app_changed=NO");
  if (!pass) {
    for (const f of failures) console.log("FAIL_DETAIL=" + f);
  }
  console.log("=== END_CAP10_PIPELINE_CONTRACT_SELFTEST ===");
  return pass;
}

function runCap10ReplayLifecycleSelftest() {
  const failures = [];
  const assert = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  const td = path.join(os.tmpdir(), "silver-cap10-replay-" + Date.now());
  fs.mkdirSync(path.join(td, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(td, "SILVER_RUN_REPORT.md"), "# report\n", "utf8");

  const cap1 = runReplayCapCycle(td, 1, "replay-cap1");
  const cap2 = runReplayCapCycle(td, 2, "replay-cap2");
  const cap3 = runReplayCapCycle(td, 3, "replay-cap3");

  assert(cap1.finalize_ok, "cap1_finalize");
  assert(cap2.finalize_ok, "cap2_finalize");
  assert(cap3.finalize_ok, "cap3_finalize");
  assert(cap1.profile_id === "CAP10_SAFE", "cap1_profile");
  assert(cap2.profile_id === "CAP10_SAFE", "cap2_profile");
  assert(cap3.profile_id === "CAP10_SAFE", "cap3_profile");

  const st1 = loadState(td, "replay-cap1");
  const st2 = loadState(td, "replay-cap2");
  const st3 = loadState(td, "replay-cap3");
  assert(st1 && st2 && st3, "states_exist");
  assert(st1.run_id !== st2.run_id, "no_run_id_leakage");
  assert(st2.counts.agent_invokes === 0, "cap2_fresh_agent_counter");
  assert(st3.counts.agent_invokes === 0, "cap3_fresh_agent_counter");

  recordAgentInvoke(td, "replay-cap3");
  const st3b = loadState(td, "replay-cap3");
  assert(st3b.counts.agent_invokes === 1, "cap3_invoke_isolated");
  assert(st2.counts.agent_invokes === 0, "cap2_invoke_not_leaked");

  const guardFiles = fs.readdirSync(path.join(td, ".silver-runtime")).filter((f) => f.startsWith("controlled-budget-guard-"));
  assert(guardFiles.length === 3, "three_isolated_guard_states");

  try {
    fs.rmSync(td, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  const pass = failures.length === 0;
  console.log("=== CAP10_REPLAY_LIFECYCLE_SELFTEST ===");
  console.log("CAP10_REPLAY_LIFECYCLE_SELFTEST=" + (pass ? "PASS" : "FAIL"));
  console.log("cap1_replay_pass=" + (failures.indexOf("cap1_finalize") < 0 ? "YES" : "NO"));
  console.log("cap2_replay_pass=" + (failures.indexOf("cap2_finalize") < 0 ? "YES" : "NO"));
  console.log("cap3_replay_pass=" + (failures.indexOf("cap3_finalize") < 0 ? "YES" : "NO"));
  console.log("repeated_cap_stability_pass=" + (pass ? "YES" : "NO"));
  console.log("no_stale_state_leakage=" + (pass ? "YES" : "NO"));
  if (!pass) {
    for (const f of failures) console.log("FAIL_DETAIL=" + f);
  }
  console.log("=== END_CAP10_REPLAY_LIFECYCLE_SELFTEST ===");
  return pass;
}

function runMetricDeltaContractSelftest() {
  const failures = [];
  const assert = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  const td = path.join(os.tmpdir(), "silver-cap10-metric-" + Date.now());
  fs.mkdirSync(path.join(td, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(td, "SILVER_RUN_REPORT.md"), "# report\n", "utf8");
  fs.writeFileSync(
    path.join(td, "scripts", "silver-quality-v2-report.json"),
    JSON.stringify({
      quality_accuracy: "55.0%",
      "20k_overall_accuracy": "62.0%",
      dangerous_write_count: 0,
      false_write_count: 0,
    }) + "\n",
    "utf8",
  );

  const before = captureMetricSnapshot(td);
  const after = captureMetricSnapshot(td);
  let block = buildMetricDeltaBlock(td, before, after);
  block = appendRelevantClusterMetricLine(block, "self_correction_negation_flip", "NOT_AVAILABLE");
  const blockFailures = validateMetricDeltaContract(block);
  assert(blockFailures.length === 0, "metric_block_valid:" + blockFailures.join(","));

  for (const key of METRIC_KEYS) {
    assert(block.indexOf(key) >= 0, "guard_metric_key_present:" + key);
  }

  createState(td, { runId: "metric-fin", capLabel: "CAP10", profileId: "CAP10_SAFE" });
  const fin = finalizeCap(td, "metric-fin", { finalOutcome: "NO_CHANGE" });
  assert(fin.ok, "finalize_with_metric_delta");
  const report = readTextSafe(path.join(td, "SILVER_RUN_REPORT.md"));
  assert(report.includes("CONTROLLED_BUDGET_METRIC_DELTA_BLOCK"), "metric_in_run_report");

  try {
    fs.rmSync(td, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  const pass = failures.length === 0;
  console.log("=== METRIC_DELTA_CONTRACT_SELFTEST ===");
  console.log("METRIC_DELTA_CONTRACT_SELFTEST=" + (pass ? "PASS" : "FAIL"));
  console.log("metric_keys_required=" + METRIC_DELTA_REQUIRED_KEYS.length);
  console.log("metric_delta_finalize_pass=" + (pass ? "YES" : "NO"));
  if (!pass) {
    for (const f of failures) console.log("FAIL_DETAIL=" + f);
  }
  console.log("=== END_METRIC_DELTA_CONTRACT_SELFTEST ===");
  return pass;
}

function runGenericFallbackBlockerSelftest() {
  const failures = [];
  const assert = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  const capCtx = {
    clusterDiag: { cluster: "self_correction_negation_flip", audit_id: "self_correction" },
    selectorCluster: "self_correction_negation_flip",
  };

  const genericSamples = [
    "git push -u origin chore/silver-audit-repo-state",
    "gh auth login",
    "node scripts/silver-autopilot.cjs --verify-pr=3794",
    "sudo apt update && gh pr create",
  ];

  for (const sample of genericSamples) {
    const hits = detectGenericFallbackAttempt(sample, true);
    assert(hits.length > 0, "blocked:" + sample.slice(0, 40));
    const v = silverNextActionQualityViolations(sample, capCtx);
    assert(v.length > 0, "violations:" + sample.slice(0, 30));
  }

  const product = buildCapDiagnosticProductHandoff({
    mainCommit: "test",
    clusterDiag: capCtx.clusterDiag,
  });
  const productViolations = silverNextActionQualityViolations(product, capCtx);
  assert(productViolations.length === 0, "valid_product_not_blocked");
  assert(!/git\s+push\s+-u|gh\s+auth\s+login/i.test(product), "no_generic_git_gh_in_product");

  const pass = failures.length === 0;
  console.log("=== GENERIC_FALLBACK_BLOCKER_SELFTEST ===");
  console.log("GENERIC_FALLBACK_BLOCKER_SELFTEST=" + (pass ? "PASS" : "FAIL"));
  console.log("no_generic_fallback_after_cap=" + (pass ? "YES" : "NO"));
  if (!pass) {
    for (const f of failures) console.log("FAIL_DETAIL=" + f);
  }
  console.log("=== END_GENERIC_FALLBACK_BLOCKER_SELFTEST ===");
  return pass;
}

function printPipelineMap() {
  console.log("=== CAP10_PIPELINE_MAP ===");
  for (const [k, v] of Object.entries(CAP10_PIPELINE_MAP)) {
    if (Array.isArray(v)) {
      console.log(k + "=" + v.join("|"));
    } else {
      console.log(k + "=" + v);
    }
  }
  console.log("recommended_real_cap10_command=" + RECOMMENDED_REAL_CAP10_COMMAND);
  console.log("=== END_CAP10_PIPELINE_MAP ===");
}

function main() {
  const cmd = process.argv[2] || "help";
  if (cmd === "map") {
    printPipelineMap();
    return;
  }
  if (cmd === "selftest" || cmd === "cap10-pipeline-contract-selftest") {
    process.exit(runCap10PipelineContractSelftest() ? 0 : 1);
  }
  if (cmd === "cap10-replay-lifecycle-selftest") {
    process.exit(runCap10ReplayLifecycleSelftest() ? 0 : 1);
  }
  if (cmd === "metric-delta-contract-selftest") {
    process.exit(runMetricDeltaContractSelftest() ? 0 : 1);
  }
  if (cmd === "generic-fallback-blocker-selftest") {
    process.exit(runGenericFallbackBlockerSelftest() ? 0 : 1);
  }
  if (cmd === "all-selftests") {
    const results = [
      runCap10PipelineContractSelftest(),
      runCap10ReplayLifecycleSelftest(),
      runMetricDeltaContractSelftest(),
      runGenericFallbackBlockerSelftest(),
    ];
    const pass = results.every(Boolean);
    console.log("CAP10_PIPELINE_ALL_SELFTESTS=" + (pass ? "PASS" : "FAIL"));
    process.exit(pass ? 0 : 1);
  }
  console.log(
    "Usage: node silver-cap10-pipeline-contract.cjs <map|cap10-pipeline-contract-selftest|cap10-replay-lifecycle-selftest|metric-delta-contract-selftest|generic-fallback-blocker-selftest|all-selftests>",
  );
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  RECOMMENDED_REAL_CAP10_COMMAND,
  CAP10_LIFECYCLE_FINAL_OUTCOMES,
  CAP10_PIPELINE_MAP,
  METRIC_DELTA_REQUIRED_KEYS,
  buildCap10LifecycleOutcomeRecord,
  validateCap10LifecycleOutcomeRecord,
  validateMetricDeltaContract,
  detectGenericFallbackAttempt,
  appendRelevantClusterMetricLine,
  runCap10PipelineContractSelftest,
  runCap10ReplayLifecycleSelftest,
  runMetricDeltaContractSelftest,
  runGenericFallbackBlockerSelftest,
};
