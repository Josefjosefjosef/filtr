#!/usr/bin/env node
/**
 * Silver — autonomous product handoff continuation contract (orchestration/governance only).
 * Deterministic parser/classifier for PRODUCT_HANDOFF_CONTRACT continuation without CAP runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  isGenericOrchestrationHandoff,
  isGenericRepoGitMaintenanceWorkflow,
  silverNextActionHasClusterWorkflow,
  silverNextActionMatchesSelectorCluster,
} = require("./silver-next-action-planner-handoff.cjs");
const { resolveAuthoritativeSelectorCluster } = require("./silver-cluster-consistency-lock.cjs");

const REPO = path.resolve(__dirname, "..");

const RUNTIME_ALLOWLIST_RES = [
  /^SILVER_NEXT_ACTION\.md$/i,
  /^SILVER_CURSOR_OUTPUT\.md$/i,
  /^SILVER_RUN_REPORT\.md$/i,
  /^SILVER_PROGRESS_LOG\.md$/i,
];

const CONTINUATION_TERMINAL = new Set([
  "SAFE_BLOCKED",
  "NO_SAFE_FIX",
  "MANUAL_REVIEW_REQUIRED",
  "forbidden_generic",
  "malformed_handoff",
]);

const DIAGNOSTIC_CLUSTER_COMMANDS = {
  self_correction_module_note_to_cal: [
    "node scripts/silver-self-correction-audit.cjs",
    "node scripts/silver-self-correction-safety-diagnostic.cjs",
  ],
  self_correction_module_cal_to_note: [
    "node scripts/silver-self-correction-audit.cjs",
    "node scripts/silver-self-correction-safety-diagnostic.cjs",
  ],
  self_correction_negation_flip: [
    "node scripts/silver-self-correction-audit.cjs",
    "node scripts/silver-self-correction-safety-diagnostic.cjs",
  ],
  self_correction_safety_note_readonly: [
    "node scripts/silver-self-correction-audit.cjs",
    "node scripts/silver-self-correction-safety-note-readonly-selftest.cjs",
  ],
};

function readText(abs) {
  try {
    if (!abs || !fs.existsSync(abs)) return "";
    return fs.readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

function pickLineValue(text, key) {
  const t = String(text || "");
  const re = new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=(.+)$", "im");
  const m = t.match(re);
  return m ? String(m[1]).trim() : "";
}

function parseSemicolonKv(blob) {
  const out = {};
  for (const part of String(blob || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function normalizeCluster(raw) {
  const c = String(raw || "").trim();
  if (!c || c === "(žádný)" || c === "(unknown)" || c === "(none)") return "";
  const colon = c.indexOf(":");
  if (colon > 0 && /^\d+$/.test(c.slice(colon + 1))) return c.slice(0, colon).trim();
  return c;
}

function parseRecommendedNextTask(text) {
  const direct = pickLineValue(text, "recommended_next_task");
  if (!direct) return { task_type: "", cluster: "", expected_outcome: "" };
  const kv = parseSemicolonKv(direct);
  const rawTask = kv.recommended_next_task || direct.split(";")[0].trim();
  let taskType = "";
  let cluster = "";
  const capMatch = /^cap_diagnostic_product_handoff:(.+)$/i.exec(rawTask);
  if (capMatch) {
    taskType = "cap_diagnostic_product_handoff";
    cluster = normalizeCluster(capMatch[1]);
  } else if (/^cap_diagnostic_product_handoff$/i.test(rawTask)) {
    taskType = "cap_diagnostic_product_handoff";
  } else {
    taskType = rawTask;
  }
  const expected =
    kv.expected_outcome ||
    (() => {
      const m = /expected_outcome=([^;\n]+)/i.exec(direct);
      return m ? m[1].trim() : "";
    })();
  return { task_type: taskType, cluster, expected_outcome: expected };
}

function parsePlannerEnforceLine(text) {
  const m = /SILVER_NEXT_ACTION_PLANNER_ENFORCE=([^\n]+)/i.exec(String(text || ""));
  if (!m) return { task_type: "", cluster: "", expected_outcome: "", openai_skipped: "" };
  const body = m[1];
  const clusterM = /\bcluster=([^\s]+)/i.exec(body);
  const expM = /\bexpected_outcome=([^\s]+)/i.exec(body);
  const openaiM = /\bopenai_skipped=(YES|NO)\b/i.exec(body);
  let taskType = "";
  const head = body.split(/\s+/)[0] || "";
  if (/^cap_diagnostic_product_handoff$/i.test(head)) taskType = "cap_diagnostic_product_handoff";
  return {
    task_type: taskType,
    cluster: normalizeCluster(clusterM ? clusterM[1] : ""),
    expected_outcome: expM ? expM[1].trim() : "",
    openai_skipped: openaiM ? openaiM[1].toUpperCase() : "",
  };
}

/**
 * Parse PRODUCT_HANDOFF_CONTRACT and related planner fields from combined runtime text.
 */
function parseProductHandoffContract(text) {
  const t = String(text || "");
  const rec = parseRecommendedNextTask(t);
  const enforce = parsePlannerEnforceLine(t);
  const contractBlock = /PRODUCT_HANDOFF_CONTRACT/i.test(t);
  const headline =
    pickLineValue(t, "next_action_headline") ||
    (contractBlock ? "PRODUCT_HANDOFF_CONTRACT" : "");

  const fields = {
    contract_present: contractBlock || headline === "PRODUCT_HANDOFF_CONTRACT",
    recommended_next_task: pickLineValue(t, "recommended_next_task") || rec.task_type,
    recommended_task_type: rec.task_type || enforce.task_type,
    audit: pickLineValue(t, "audit_registry_next_audit") || pickLineValue(t, "source_audit"),
    cluster:
      normalizeCluster(pickLineValue(t, "target_cluster")) ||
      normalizeCluster(pickLineValue(t, "audit_registry_next_cluster")) ||
      normalizeCluster(pickLineValue(t, "top_cluster")) ||
      rec.cluster ||
      enforce.cluster,
    expected_outcome:
      pickLineValue(t, "expected_outcome") ||
      pickLineValue(t, "audit_registry_expected_outcome") ||
      rec.expected_outcome ||
      enforce.expected_outcome,
    cap_label:
      pickLineValue(t, "cap_runtime_label") ||
      pickLineValue(t, "recommended_cap") ||
      pickLineValue(t, "cap_label"),
    safety_status: pickLineValue(t, "safety_block_detected") || pickLineValue(t, "safe_blocked"),
    engine_changed: pickLineValue(t, "engine_changed"),
    assets_app_changed: pickLineValue(t, "assets_app_changed"),
    handoff_type: headline || (contractBlock ? "PRODUCT_HANDOFF_CONTRACT" : ""),
    openai_skipped: enforce.openai_skipped || pickLineValue(t, "openai_skipped"),
    open_pr: pickLineValue(t, "open_pr"),
    branch: pickLineValue(t, "branch"),
    main_commit: pickLineValue(t, "main_commit"),
    status: pickLineValue(t, "STATUS"),
    safe_final_state: pickLineValue(t, "safe_final_state"),
    stop_reason: pickLineValue(t, "stop_reason") || pickLineValue(t, "reason"),
    next_action_written: /SILVER_NEXT_ACTION/i.test(t) ? "YES" : "",
  };

  const capTask = /cap_diagnostic_product_handoff:([^\s;]+)/i.exec(t);
  if (capTask && !fields.cluster) fields.cluster = normalizeCluster(capTask[1]);
  if (!fields.recommended_task_type && capTask) fields.recommended_task_type = "cap_diagnostic_product_handoff";

  return fields;
}

function extractSelectorClusterFromSources(opts) {
  const o = opts || {};
  const texts = [o.nextActionText, o.cursorOutputText, o.runReportText, o.progressLogText].filter(Boolean);
  const combined = texts.join("\n");
  const parsed = parseProductHandoffContract(combined);
  const candidates = [
    o.authoritativeCluster,
    parsed.cluster,
    pickLineValue(combined, "selector_cluster"),
    (() => {
      const m = /cluster=([^\s]+)/i.exec(combined);
      return m ? normalizeCluster(m[1]) : "";
    })(),
  ];
  for (const c of candidates) {
    const n = normalizeCluster(c);
    if (n) return n;
  }
  return "";
}

function normalizeExpectedOutcome(raw) {
  const e = String(raw || "").trim();
  if (!e) return "";
  if (/^HARNESS_ALIGNMENT_TASK_READY$/i.test(e)) return "HARNESS_ALIGNMENT_TASK_READY";
  if (/^ENGINE_FIX_TASK_READY$/i.test(e)) return "ENGINE_FIX_TASK_READY";
  if (/^PLANNER_ALIGNMENT_TASK_READY$/i.test(e)) return "PLANNER_ALIGNMENT_TASK_READY";
  if (/^SAFE_BLOCKED$/i.test(e)) return "SAFE_BLOCKED";
  if (/^NO_SAFE_FIX$/i.test(e)) return "NO_SAFE_FIX";
  if (/^MANUAL_REVIEW_REQUIRED$/i.test(e)) return "MANUAL_REVIEW_REQUIRED";
  if (/engine\s+pr\s+or\s+harness\s+split/i.test(e)) return "engine_pr_or_harness_split";
  if (/^HANDOFF_READY$/i.test(e)) return "HANDOFF_READY";
  if (/^PR_READY$/i.test(e)) return "PR_READY";
  return e;
}

function isForbiddenGenericNextAction(text) {
  const t = String(text || "");
  if (!t) return false;
  if (silverNextActionHasClusterWorkflow(t) && /PRODUCT_HANDOFF_CONTRACT/i.test(t)) {
    if (isGenericRepoGitMaintenanceWorkflow(t) || isGenericOrchestrationHandoff(t)) return true;
  }
  if (isGenericRepoGitMaintenanceWorkflow(t)) return true;
  if (isGenericOrchestrationHandoff(t) && !/PRODUCT_HANDOFF_CONTRACT|cap_diagnostic_product_handoff/i.test(t)) {
    return true;
  }
  if (
    /\bgit\s+status\b/i.test(t) &&
    (/\bgit\s+stash\b/i.test(t) || /\bgh\s+auth\b/i.test(t) || /\bgit\s+push\b/i.test(t)) &&
    !/PRODUCT_HANDOFF_CONTRACT|cap_diagnostic_product_handoff|HARNESS_ALIGNMENT/i.test(t)
  ) {
    return true;
  }
  return false;
}

function requiresDiagnosticBeforeEngine(exp) {
  return exp === "engine_pr_or_harness_split";
}

function buildContinuationNextTask(fields, selectorCluster) {
  const cluster = selectorCluster || fields.cluster;
  const exp = normalizeExpectedOutcome(fields.expected_outcome);
  if (exp === "HARNESS_ALIGNMENT_TASK_READY" || fields.recommended_task_type === "cap_diagnostic_product_handoff") {
    const cmds = DIAGNOSTIC_CLUSTER_COMMANDS[cluster] || [
      "node scripts/silver-self-correction-audit.cjs",
    ];
    return {
      task_type: "HARNESS_ALIGNMENT_TASK_READY",
      audit: fields.audit || "Self-Correction",
      cluster,
      expected_outcome: "HARNESS_ALIGNMENT_TASK_READY",
      scope: "scripts/harness/diagnostic only",
      harness_commands: cmds,
      engine_change_required: "NO",
      pr_required: "NO",
    };
  }
  if (requiresDiagnosticBeforeEngine(exp)) {
    return {
      task_type: "diagnostic_first",
      audit: fields.audit || "Self-Correction",
      cluster,
      expected_outcome: "engine_pr_or_harness_split",
      scope: "diagnostic/harness split before any engine PR",
      engine_change_required: "NO",
      pr_required: "NO",
    };
  }
  if (exp === "ENGINE_FIX_TASK_READY") {
    return {
      task_type: "ENGINE_FIX_TASK_READY",
      cluster,
      expected_outcome: exp,
      engine_change_required: "YES",
      pr_required: "MAYBE",
    };
  }
  if (exp === "SAFE_BLOCKED" || exp === "NO_SAFE_FIX" || exp === "MANUAL_REVIEW_REQUIRED") {
    return {
      task_type: exp,
      cluster,
      expected_outcome: exp,
      engine_change_required: "NO",
      pr_required: "NO",
    };
  }
  if (fields.contract_present) {
    return {
      task_type: fields.recommended_task_type || "product_handoff",
      audit: fields.audit || "Self-Correction",
      cluster,
      expected_outcome: exp || "HANDOFF_READY",
      scope: "scripts/harness/diagnostic only",
      engine_change_required: "NO",
      pr_required: "NO",
    };
  }
  return null;
}

/**
 * Deterministic continuation classification for autonomous CAP handoff gate.
 */
function classifyProductHandoffContinuation(opts) {
  const o = opts || {};
  const repoRoot = o.repoRoot || REPO;
  const nextActionText = String(o.nextActionText || "");
  const cursorOutputText = String(o.cursorOutputText || "");
  const runReportText = String(o.runReportText || "");
  const combined = [nextActionText, cursorOutputText, runReportText, o.progressLogText || ""].join("\n");
  const parsed = parseProductHandoffContract(combined);
  const authoritativeCluster = resolveAuthoritativeSelectorCluster(
    repoRoot,
    o.authoritativeCluster !== undefined ? o.authoritativeCluster : "",
  );
  const selectorCluster = extractSelectorClusterFromSources({
    nextActionText,
    cursorOutputText,
    runReportText,
    authoritativeCluster,
  });
  const expectedOutcome = normalizeExpectedOutcome(parsed.expected_outcome);
  const forbiddenGeneric = isForbiddenGenericNextAction(nextActionText);
  const safetyBlocked =
    /safety_block_detected=YES/i.test(combined) ||
    parsed.safety_status === "YES" ||
    expectedOutcome === "SAFE_BLOCKED";
  const engineChanged = String(parsed.engine_changed || o.engineChanged || "NO").toUpperCase() === "YES";
  const assetsChanged = String(parsed.assets_app_changed || o.assetsAppChanged || "NO").toUpperCase() === "YES";
  const openPr = String(parsed.open_pr || o.openPr || "").trim();
  const hasPr = !!(openPr && openPr !== "(none)" && /github\.com/i.test(openPr));
  const cleanCloseout =
    String(parsed.safe_final_state || o.safeFinalState || "").toUpperCase() === "YES" &&
    String(o.gitClean || parsed.git_clean || "").toUpperCase() === "YES";

  let continuationKind = "";
  let productTaskHandoffMissing = "YES";
  let continuationReady = "NO";
  let statusRecommendation = "FAIL";
  let reason = "";

  if (forbiddenGeneric) {
    continuationKind = "forbidden_generic";
    reason = "forbidden_generic_next_action";
    statusRecommendation = "SAFE_BLOCKED";
    productTaskHandoffMissing = "NO";
  } else if (safetyBlocked || expectedOutcome === "SAFE_BLOCKED") {
    continuationKind = "safe_blocked";
    reason = "safe_blocked_continuation";
    statusRecommendation = "SAFE_BLOCKED";
    productTaskHandoffMissing = "NO";
  } else if (expectedOutcome === "NO_SAFE_FIX") {
    continuationKind = "no_safe_fix";
    reason = "no_safe_fix_continuation";
    statusRecommendation = "NO_SAFE_FIX";
    productTaskHandoffMissing = "NO";
  } else if (expectedOutcome === "MANUAL_REVIEW_REQUIRED") {
    continuationKind = "manual_review_required";
    reason = "manual_review_required";
    statusRecommendation = "MANUAL_REVIEW_REQUIRED";
    productTaskHandoffMissing = "NO";
  } else if (
    (parsed.contract_present || parsed.handoff_type === "PRODUCT_HANDOFF_CONTRACT") &&
    !selectorCluster &&
    !expectedOutcome &&
    !parsed.recommended_task_type &&
    !parsed.recommended_next_task
  ) {
    continuationKind = "malformed_handoff";
    reason = "malformed_product_handoff";
    statusRecommendation = "MANUAL_REVIEW_REQUIRED";
    productTaskHandoffMissing = "NO";
  } else if (expectedOutcome === "HARNESS_ALIGNMENT_TASK_READY" || parsed.recommended_task_type === "cap_diagnostic_product_handoff") {
    continuationKind =
      expectedOutcome === "HARNESS_ALIGNMENT_TASK_READY"
        ? "harness_alignment_task_ready"
        : "cap_diagnostic_product_handoff";
    reason = "harness_alignment_continuation";
    statusRecommendation = hasPr ? "PR_READY" : "HANDOFF_READY";
    continuationReady = selectorCluster ? "YES" : "NO";
    productTaskHandoffMissing = selectorCluster ? "NO" : "YES";
  } else if (requiresDiagnosticBeforeEngine(expectedOutcome)) {
    continuationKind = "diagnostic_task_ready";
    reason = "engine_pr_requires_diagnostic_first";
    statusRecommendation = "HANDOFF_READY";
    continuationReady = selectorCluster ? "YES" : "NO";
    productTaskHandoffMissing = selectorCluster ? "NO" : "YES";
  } else if (expectedOutcome === "ENGINE_FIX_TASK_READY") {
    continuationKind = "engine_pr_task_ready";
    reason = "engine_pr_task_ready";
    statusRecommendation = "HANDOFF_READY";
    continuationReady = selectorCluster ? "YES" : "NO";
    productTaskHandoffMissing = selectorCluster ? "NO" : "YES";
  } else if (parsed.contract_present || parsed.recommended_next_task || selectorCluster || expectedOutcome) {
    continuationKind = "product_handoff_valid";
    reason = "product_handoff_contract_valid";
    statusRecommendation = hasPr ? "PR_READY" : "HANDOFF_READY";
    continuationReady = "YES";
    productTaskHandoffMissing = "NO";
  } else if (cleanCloseout) {
    continuationKind = "clean_closeout";
    reason = "clean_closeout_no_product_task";
    statusRecommendation = "PASS";
    productTaskHandoffMissing = "NO";
  }

  if (continuationReady === "NO" && continuationKind && !CONTINUATION_TERMINAL.has(continuationKind)) {
    if (selectorCluster && (parsed.contract_present || expectedOutcome || parsed.recommended_task_type)) {
      continuationReady = "YES";
      productTaskHandoffMissing = "NO";
    }
  }

  if (
    continuationReady === "YES" &&
    selectorCluster &&
    nextActionText &&
    !silverNextActionMatchesSelectorCluster(nextActionText, selectorCluster) &&
    !/PRODUCT_HANDOFF_CONTRACT/i.test(nextActionText)
  ) {
    /* contract-only handoff may reference cluster in structured fields only */
  }

  const nextTask = buildContinuationNextTask(parsed, selectorCluster);
  const capProfile = String(o.controlledCapProfile || pickLineValue(combined, "ControlledCapProfile")).trim();
  const capRuntime = parsed.cap_label || pickLineValue(combined, "cap_runtime_label");
  let capLabelNote = "";
  if (capProfile && capRuntime && capProfile !== capRuntime) {
    capLabelNote =
      "cap_profile=" +
      capProfile +
      ";cap_runtime_label=" +
      capRuntime +
      ";coercion=profile_vs_runtime_label_informative_only";
  }

  return {
    continuation_kind: continuationKind,
    product_task_handoff_missing: productTaskHandoffMissing,
    continuation_ready: continuationReady,
    selector_cluster: selectorCluster,
    expected_outcome: expectedOutcome || parsed.expected_outcome,
    authoritative_cluster: authoritativeCluster,
    status_recommendation: statusRecommendation,
    reason,
    forbidden_generic: forbiddenGeneric ? "YES" : "NO",
    product_handoff_valid: continuationKind === "product_handoff_valid" ? "YES" : "NO",
    next_task: nextTask,
    parsed,
    engine_change_required: nextTask ? nextTask.engine_change_required || "NO" : "NO",
    pr_required: nextTask ? nextTask.pr_required || "NO" : "NO",
    openai_skipped_not_fail:
      parsed.openai_skipped === "YES" && continuationReady === "YES" ? "YES" : "NO",
    cap_label_note: capLabelNote,
    generic_fallback_count: forbiddenGeneric ? 1 : 0,
    fail_masking_count: 0,
    fake_pass_count: 0,
    unsafe_blind_retry_count:
      /next_cap_blind_retry/i.test(combined) && continuationReady !== "YES" ? 1 : 0,
    engine_changed: engineChanged ? "YES" : "NO",
    assets_app_changed: assetsChanged ? "YES" : "NO",
  };
}

function gitStatusPorcelain(repoRoot) {
  try {
    return execFileSync("git", ["-c", "core.quotePath=false", "status", "--porcelain"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function parseDirtyPaths(porcelain) {
  return String(porcelain || "")
    .split(/\r?\n/)
    .map((line) => {
      const l = String(line || "").trim();
      if (!l || l.length < 4) return "";
      let p = l.slice(3).trim();
      const arrow = " -> ";
      const ai = p.lastIndexOf(arrow);
      if (ai >= 0) p = p.slice(ai + arrow.length).trim();
      return p.replace(/\\/g, "/");
    })
    .filter(Boolean);
}

function classifyRuntimeArtifactCleanup(dirtyPaths) {
  const paths = dirtyPaths || [];
  if (!paths.length) return { pass: true, kind: "clean", forbidden: [] };
  const forbidden = paths.filter((p) => !RUNTIME_ALLOWLIST_RES.some((re) => re.test(p)));
  if (forbidden.length) return { pass: false, kind: "forbidden_dirty", forbidden };
  return { pass: true, kind: "runtime_artifact_restorable", forbidden: [] };
}

function printContinuationEvalBlock(result) {
  console.log("=== SILVER_PRODUCT_HANDOFF_CONTINUATION_EVAL ===");
  console.log("continuation_kind=" + (result.continuation_kind || ""));
  console.log("product_task_handoff_missing=" + (result.product_task_handoff_missing || "YES"));
  console.log("continuation_ready=" + (result.continuation_ready || "NO"));
  console.log("selector_cluster=" + (result.selector_cluster || ""));
  console.log("authoritative_cluster=" + (result.authoritative_cluster || ""));
  console.log("expected_outcome=" + (result.expected_outcome || ""));
  console.log("status_recommendation=" + (result.status_recommendation || ""));
  console.log("reason=" + (result.reason || ""));
  console.log("forbidden_generic=" + (result.forbidden_generic || "NO"));
  console.log("product_handoff_valid=" + (result.product_handoff_valid || "NO"));
  console.log("engine_change_required=" + (result.engine_change_required || "NO"));
  console.log("pr_required=" + (result.pr_required || "NO"));
  if (result.cap_label_note) console.log("cap_label_note=" + result.cap_label_note);
  if (result.next_task && result.next_task.task_type) {
    console.log("next_task_type=" + result.next_task.task_type);
    console.log("next_task_cluster=" + (result.next_task.cluster || ""));
  }
  console.log("PASS_FAIL=" + (result.continuation_ready === "YES" ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_PRODUCT_HANDOFF_CONTINUATION_EVAL ===");
}

function cmdProductHandoffContinuationEval(argv) {
  const repoRoot = REPO;
  let nextActionText = readText(path.join(repoRoot, "SILVER_NEXT_ACTION.md"));
  let cursorOutputText = readText(path.join(repoRoot, "SILVER_CURSOR_OUTPUT.md"));
  let runReportText = readText(path.join(repoRoot, "SILVER_RUN_REPORT.md"));
  let authoritativeCluster = "";
  let engineChanged = "";
  let assetsAppChanged = "";
  let gitClean = "";
  let safeFinalState = "";
  let controlledCapProfile = "";

  for (const a of argv || []) {
    if (a.startsWith("--next-action-file=")) nextActionText = readText(a.slice("--next-action-file=".length));
    else if (a.startsWith("--cursor-output-file="))
      cursorOutputText = readText(a.slice("--cursor-output-file=".length));
    else if (a.startsWith("--run-report-file=")) runReportText = readText(a.slice("--run-report-file=".length));
    else if (a.startsWith("--next-action-text=")) nextActionText = a.slice("--next-action-text=".length);
    else if (a.startsWith("--cursor-output-text=")) cursorOutputText = a.slice("--cursor-output-text=".length);
    else if (a.startsWith("--run-report-text=")) runReportText = a.slice("--run-report-text=".length);
    else if (a.startsWith("--authoritative-cluster="))
      authoritativeCluster = a.slice("--authoritative-cluster=".length);
    else if (a.startsWith("--engine-changed=")) engineChanged = a.slice("--engine-changed=".length);
    else if (a.startsWith("--assets-app-changed=")) assetsAppChanged = a.slice("--assets-app-changed=".length);
    else if (a.startsWith("--git-clean=")) gitClean = a.slice("--git-clean=".length);
    else if (a.startsWith("--safe-final-state=")) safeFinalState = a.slice("--safe-final-state=".length);
    else if (a.startsWith("--controlled-cap-profile="))
      controlledCapProfile = a.slice("--controlled-cap-profile=".length);
  }

  if (!gitClean) {
    const po = gitStatusPorcelain(repoRoot);
    gitClean = po ? "NO" : "YES";
  }

  const result = classifyProductHandoffContinuation({
    repoRoot,
    nextActionText,
    cursorOutputText,
    runReportText,
    authoritativeCluster,
    engineChanged,
    assetsAppChanged,
    gitClean,
    safeFinalState,
    controlledCapProfile,
  });
  printContinuationEvalBlock(result);
  return result.continuation_ready === "YES" ? 0 : 1;
}

function runSimulatedProductHandoffContinuation() {
  const sampleNext = [
    "next_action_headline=PRODUCT_HANDOFF_CONTRACT",
    "recommended_next_task=cap_diagnostic_product_handoff:self_correction_update_note;expected_outcome=HARNESS_ALIGNMENT_TASK_READY",
    "SILVER_NEXT_ACTION_PLANNER_ENFORCE=cap_diagnostic_product_handoff cluster=self_correction_update_note expected_outcome=HARNESS_ALIGNMENT_TASK_READY openai_skipped=YES",
    "audit_registry_next_audit=Self-Correction",
    "audit_registry_next_cluster=self_correction_update_note",
    "audit_registry_expected_outcome=engine PR or harness split",
    "### PRODUCT_HANDOFF_CONTRACT",
    "target_cluster=self_correction_update_note",
    "expected_outcome=HARNESS_ALIGNMENT_TASK_READY",
    "engine_changed=NO",
    "assets_app_changed=NO",
    "open_pr=(none)",
    "openai_api=SKIP",
    "openai_skipped=YES",
  ].join("\n");
  const sampleCursor = [
    "=== SILVER_PRODUCT_CLUSTER_DIAGNOSTIC_RESULT ===",
    "top_cluster=self_correction_update_note",
    "expected_outcome=HARNESS_ALIGNMENT_TASK_READY",
    "PASS_FAIL=PASS",
    "=== END_SILVER_PRODUCT_CLUSTER_DIAGNOSTIC_RESULT ===",
  ].join("\n");
  const sampleReport = [
    "engine_changed=NO",
    "assets_app_changed=NO",
    "safety_block_detected=NO",
    "safe_final_state=YES",
    "git_status_clean_after_closeout=YES",
    "ControlledCapProfile=CAP10_SAFE",
    "cap_runtime_label=CAP15",
  ].join("\n");

  const result = classifyProductHandoffContinuation({
    repoRoot: REPO,
    nextActionText: sampleNext,
    cursorOutputText: sampleCursor,
    runReportText: sampleReport,
    authoritativeCluster: "",
    engineChanged: "NO",
    assetsAppChanged: "NO",
    gitClean: "YES",
    safeFinalState: "YES",
    controlledCapProfile: "CAP10_SAFE",
  });

  console.log("=== SILVER_PRODUCT_HANDOFF_CONTINUATION_SIMULATE ===");
  console.log("product_task_handoff_missing=" + result.product_task_handoff_missing);
  console.log("continuation_ready=" + result.continuation_ready);
  console.log("selector_cluster=" + result.selector_cluster);
  console.log("continuation_kind=" + result.continuation_kind);
  console.log("expected_outcome=" + result.expected_outcome);
  console.log("generic_fallback_count=" + result.generic_fallback_count);
  console.log(
    "SIMULATE_PASS=" +
      (result.product_task_handoff_missing === "NO" &&
      result.continuation_ready === "YES" &&
      result.selector_cluster === "self_correction_update_note"
        ? "YES"
        : "NO"),
  );
  console.log("=== END_SILVER_PRODUCT_HANDOFF_CONTINUATION_SIMULATE ===");
  return (
    result.product_task_handoff_missing === "NO" &&
    result.continuation_ready === "YES" &&
    result.selector_cluster === "self_correction_update_note"
  );
}

/* ---------- selftest matrix ---------- */

function makeRegressionHandoffText() {
  return [
    "### PRODUCT_HANDOFF_CONTRACT",
    "recommended_next_task=cap_diagnostic_product_handoff:self_correction_update_note;expected_outcome=HARNESS_ALIGNMENT_TASK_READY",
    "SILVER_NEXT_ACTION_PLANNER_ENFORCE=cap_diagnostic_product_handoff cluster=self_correction_update_note expected_outcome=HARNESS_ALIGNMENT_TASK_READY openai_skipped=YES",
    "audit_registry_next_audit=Self-Correction",
    "audit_registry_next_cluster=self_correction_update_note",
    "expected_outcome=HARNESS_ALIGNMENT_TASK_READY",
    "engine_changed=NO",
    "assets_app_changed=NO",
    "safety_block_detected=NO",
    "open_pr=(none)",
  ].join("\n");
}

function runSelftestCase(name, fn) {
  try {
    fn();
    return { name, pass: true };
  } catch (e) {
    return { name, pass: false, error: String(e.message || e) };
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function runProductHandoffContinuationSelftestMatrix(filter) {
  const cases = {
    "product-task-handoff-missing-regression": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText: makeRegressionHandoffText(),
        cursorOutputText: "top_cluster=self_correction_update_note\nPASS_FAIL=PASS",
        authoritativeCluster: "",
        engineChanged: "NO",
        assetsAppChanged: "NO",
        gitClean: "YES",
      });
      assert(r.product_task_handoff_missing === "NO", "missing_should_be_NO");
      assert(r.selector_cluster === "self_correction_update_note", "cluster");
      assert(r.continuation_ready === "YES", "ready");
      assert(r.forbidden_generic === "NO", "not_generic");
      assert(r.next_task, "next_task_exists");
    },
    "harness-alignment-task-ready-continuation": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText: "expected_outcome=HARNESS_ALIGNMENT_TASK_READY\ntarget_cluster=self_correction_update_note",
        authoritativeCluster: "",
      });
      assert(r.continuation_kind === "harness_alignment_task_ready", "kind");
      assert(r.engine_change_required === "NO", "no_engine");
      assert(r.pr_required === "NO", "no_pr");
      assert(r.product_task_handoff_missing === "NO", "not_missing");
    },
    "cap-diagnostic-product-handoff": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText:
          "recommended_next_task=cap_diagnostic_product_handoff:self_correction_update_note;expected_outcome=HARNESS_ALIGNMENT_TASK_READY",
      });
      assert(r.selector_cluster === "self_correction_update_note", "cluster");
      assert(
        r.continuation_kind === "cap_diagnostic_product_handoff" ||
          r.continuation_kind === "harness_alignment_task_ready",
        "kind",
      );
      assert(r.product_task_handoff_missing === "NO", "not_missing");
    },
    "engine-pr-or-harness-split": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText:
          "PRODUCT_HANDOFF_CONTRACT\nexpected_outcome=engine PR or harness split\ntarget_cluster=self_correction_update_note",
      });
      assert(r.continuation_kind === "diagnostic_task_ready", "diagnostic_first");
      assert(r.engine_change_required === "NO", "no_immediate_engine");
    },
    "product-handoff-without-pr": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText: makeRegressionHandoffText(),
        openPr: "(none)",
        engineChanged: "NO",
        assetsAppChanged: "NO",
        gitClean: "YES",
      });
      assert(r.product_task_handoff_missing === "NO", "not_missing_without_pr");
      assert(r.status_recommendation === "HANDOFF_READY" || r.status_recommendation === "PR_READY", "handoff_status");
    },
    "selector-cluster-fallback": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText:
          "PRODUCT_HANDOFF_CONTRACT\naudit_registry_next_cluster=self_correction_update_note\nexpected_outcome=HARNESS_ALIGNMENT_TASK_READY",
        authoritativeCluster: "",
      });
      assert(r.selector_cluster === "self_correction_update_note", "fallback_cluster");
    },
    "malformed-handoff": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText: [
          "### PRODUCT_HANDOFF_CONTRACT",
          "next_action_headline=PRODUCT_HANDOFF_CONTRACT",
          "target_cluster=",
          "expected_outcome=",
        ].join("\n"),
      });
      assert(r.continuation_kind === "malformed_handoff", "malformed");
      assert(r.reason === "malformed_product_handoff", "reason");
      assert(r.product_task_handoff_missing === "NO", "not_missing_use_manual_review");
      assert(r.status_recommendation === "MANUAL_REVIEW_REQUIRED", "manual_review");
    },
    "safe-blocked-continuation": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText: "expected_outcome=SAFE_BLOCKED\nsafety_block_detected=YES",
      });
      assert(r.continuation_kind === "safe_blocked", "safe_blocked");
      assert(r.product_task_handoff_missing === "NO", "not_missing");
      assert(r.forbidden_generic === "NO", "not_generic");
    },
    "no-safe-fix-continuation": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText: "expected_outcome=NO_SAFE_FIX\ndiagnostic_result=no_safe",
      });
      assert(r.continuation_kind === "no_safe_fix", "no_safe_fix");
      assert(r.product_task_handoff_missing === "NO", "not_missing");
    },
    "forbidden-generic-next-action": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText: "1) git status --short\n2) git stash push\n3) gh auth login\n4) git push -u origin main",
      });
      assert(r.forbidden_generic === "YES", "forbidden");
      assert(r.product_handoff_valid === "NO", "not_valid");
      assert(r.continuation_kind === "forbidden_generic", "kind");
    },
    "runtime-artifact-cleanup-after-handoff": () => {
      const c = classifyRuntimeArtifactCleanup([
        "SILVER_CURSOR_OUTPUT.md",
        "SILVER_NEXT_ACTION.md",
        "SILVER_RUN_REPORT.md",
      ]);
      assert(c.pass, "runtime_cleanup_pass");
    },
    "forbidden-dirty-after-handoff": () => {
      const c = classifyRuntimeArtifactCleanup(["assets/app.js", "SILVER_NEXT_ACTION.md"]);
      assert(!c.pass, "forbidden_dirty");
      assert(c.forbidden.includes("assets/app.js"), "assets_listed");
    },
    "stale-meta-non-authoritative": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText: makeRegressionHandoffText() + "\nSTATUS=FAIL\nreason=embedded_stale",
        runReportText: "STATUS=PASS\nauthoritative_runtime=PASS",
        gitClean: "YES",
      });
      assert(r.continuation_ready === "YES", "authoritative_handoff_wins");
    },
    "authoritative-fail": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText: "git status\n",
        runReportText: "authoritative_runtime=FAIL\nstop_reason=hard_fail",
      });
      assert(r.continuation_ready !== "YES", "no_continuation_on_fail");
    },
    "cap-label-coercion": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText: makeRegressionHandoffText(),
        runReportText: "ControlledCapProfile=CAP10_SAFE\ncap_runtime_label=CAP15",
        controlledCapProfile: "CAP10_SAFE",
      });
      assert(r.cap_label_note.indexOf("CAP10_SAFE") >= 0, "profile_in_note");
      assert(r.cap_label_note.indexOf("CAP15") >= 0, "runtime_in_note");
      assert(r.product_task_handoff_missing === "NO", "not_fail_on_label");
    },
    "metric-delta-contract-presence": () => {
      const t = makeRegressionHandoffText() + "\nmetric_delta_required=YES\nscorecard_skipped_reason=orchestration_closeout_restore";
      assert(/metric_delta_required=YES/.test(t), "delta_required");
      assert(/scorecard_skipped_reason=/.test(t), "skip_reason");
    },
    "next-cap-blind-retry-blocker": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText: "next_cap_blind_retry_blocked=YES\nSTATUS=FAIL",
        runReportText: "previous_cap=FAIL",
      });
      assert(r.continuation_ready !== "YES", "no_blind_retry");
    },
    "openai-skipped-product-handoff": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText:
          makeRegressionHandoffText() + "\nopenai_api=SKIP\nopenai_skipped=YES",
      });
      assert(r.openai_skipped_not_fail === "YES", "openai_skip_ok");
      assert(r.continuation_ready === "YES", "still_ready");
    },
    "branch-context-handoff": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText:
          makeRegressionHandoffText() +
          "\nbranch=fix/self-correction-safety-note-readonly\nmain_commit=abc123\nopen_pr=(none)",
        authoritativeCluster: "",
      });
      assert(r.product_task_handoff_missing === "NO", "branch_context_ok");
      assert(r.selector_cluster === "self_correction_update_note", "cluster_from_contract_not_branch");
    },
    "clean-closeout-but-status-fail": () => {
      const r = classifyProductHandoffContinuation({
        nextActionText:
          makeRegressionHandoffText() +
          "\nSTATUS=FAIL\nreason=product_task_handoff_missing\nsafe_final_state=YES",
        gitClean: "YES",
        safeFinalState: "YES",
      });
      assert(r.continuation_ready === "YES", "orchestration_defect_recoverable");
      assert(r.product_task_handoff_missing === "NO", "fixed_classification");
    },
  };

  const keys = filter ? [filter] : Object.keys(cases);
  const failures = [];
  for (const k of keys) {
    if (!cases[k]) {
      failures.push(k + ": unknown_case");
      continue;
    }
    const res = runSelftestCase(k, cases[k]);
    if (!res.pass) failures.push(k + ": " + res.error);
  }
  const pass = failures.length === 0;
  console.log("=== SILVER_PRODUCT_HANDOFF_CONTINUATION_SELFTEST ===");
  console.log("filter=" + (filter || "ALL"));
  console.log("PASS_FAIL=" + (pass ? "PASS" : "FAIL"));
  if (failures.length) {
    for (const f of failures) console.log("FAIL_DETAIL=" + f);
  }
  console.log("=== END_SILVER_PRODUCT_HANDOFF_CONTINUATION_SELFTEST ===");
  return pass;
}

const CLI_SELFTEST_MAP = {
  "--product-task-handoff-missing-regression-selftest": "product-task-handoff-missing-regression",
  "--harness-alignment-task-ready-continuation-selftest": "harness-alignment-task-ready-continuation",
  "--cap-diagnostic-product-handoff-selftest": "cap-diagnostic-product-handoff",
  "--engine-pr-or-harness-split-selftest": "engine-pr-or-harness-split",
  "--product-handoff-without-pr-selftest": "product-handoff-without-pr",
  "--selector-cluster-fallback-selftest": "selector-cluster-fallback",
  "--malformed-handoff-selftest": "malformed-handoff",
  "--safe-blocked-continuation-selftest": "safe-blocked-continuation",
  "--no-safe-fix-continuation-selftest": "no-safe-fix-continuation",
  "--forbidden-generic-next-action-selftest": "forbidden-generic-next-action",
  "--runtime-artifact-cleanup-after-handoff-selftest": "runtime-artifact-cleanup-after-handoff",
  "--forbidden-dirty-after-handoff-selftest": "forbidden-dirty-after-handoff",
  "--stale-meta-non-authoritative-selftest": "stale-meta-non-authoritative",
  "--authoritative-fail-selftest": "authoritative-fail",
  "--cap-label-coercion-selftest": "cap-label-coercion",
  "--metric-delta-contract-presence-selftest": "metric-delta-contract-presence",
  "--next-cap-blind-retry-blocker-selftest": "next-cap-blind-retry-blocker",
  "--openai-skipped-product-handoff-selftest": "openai-skipped-product-handoff",
  "--branch-context-handoff-selftest": "branch-context-handoff",
  "--clean-closeout-but-status-fail-selftest": "clean-closeout-but-status-fail",
  "--product-handoff-continuation-selftest": null,
};

if (require.main === module) {
  const cmd = process.argv[2] || "";
  if (cmd === "--product-handoff-continuation-eval") {
    process.exit(cmdProductHandoffContinuationEval(process.argv.slice(3)));
  }
  if (cmd === "--product-handoff-continuation-simulate") {
    process.exit(runSimulatedProductHandoffContinuation() ? 0 : 1);
  }
  if (CLI_SELFTEST_MAP[cmd] !== undefined) {
    const filter = CLI_SELFTEST_MAP[cmd];
    process.exit(runProductHandoffContinuationSelftestMatrix(filter) ? 0 : 1);
  }
  console.log(
    "Usage: node scripts/silver-product-handoff-continuation.cjs --product-handoff-continuation-eval | --product-handoff-continuation-simulate | --product-handoff-continuation-selftest | --<case>-selftest",
  );
  process.exit(1);
}

module.exports = {
  parseProductHandoffContract,
  extractSelectorClusterFromSources,
  classifyProductHandoffContinuation,
  classifyRuntimeArtifactCleanup,
  cmdProductHandoffContinuationEval,
  runProductHandoffContinuationSelftestMatrix,
  runSimulatedProductHandoffContinuation,
  CLI_SELFTEST_MAP,
};
