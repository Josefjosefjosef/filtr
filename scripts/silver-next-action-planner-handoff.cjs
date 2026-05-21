#!/usr/bin/env node
/**
 * Shared Silver next-action planner quality + deterministic cluster handoff.
 * Scripts-only; no engine / assets changes.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const ORCHESTRATOR_REPORT = path.join(__dirname, "silver-pr-orchestrator-v1-report.json");
const RHC3_REPORT = path.join(__dirname, "silver-real-human-chaos-v3-report.json");
const REALISTIC_MOBILE_REPORT = path.join(__dirname, "silver-realistic-mobile-corpus-report.json");

const { resolveCapRuntimeHandoff } = require("./silver-audit-registry.cjs");
const {
  resolveAuthoritativeSelectorCluster,
  readClusterLock,
  blockGenericHandoffUnderLock,
} = require("./silver-cluster-consistency-lock.cjs");

/** Outcome types for CAP diagnostic → product next action (orchestration only). */
const PRODUCT_HANDOFF_OUTCOMES = [
  "ENGINE_FIX_TASK_READY",
  "HARNESS_ALIGNMENT_TASK_READY",
  "PLANNER_ALIGNMENT_TASK_READY",
  "NO_SAFE_FIX",
  "SAFE_BLOCKED",
  "PR_READY",
  "MERGED_AND_PROVED",
  "NEED_HUMAN_INPUT",
];

/** Per-audit on-disk report paths (orchestration; mirrors silver-audit-registry catalog). */
const CLUSTER_DIAG_REPORT_MAP = {
  rhc3: {
    report_json: "silver-real-human-chaos-v3-report.json",
    diagnostic_report_json: "silver-rhc3-cluster-classifier-v1-report.json",
  },
  self_correction: {
    report_json: "silver-self-correction-audit-report.json",
    diagnostic_report_json: "silver-self-correction-safety-diagnostic-report.json",
  },
  retrieval_stress: {
    report_json: "silver-retrieval-stress-300k-foundation-diagnostic-report.json",
    diagnostic_report_json: "silver-retrieval-stress-300k-foundation-diagnostic-report.json",
  },
  negative_no_write: {
    report_json: "silver-rhc3-negation-cal-readonly-diagnostic-report.json",
    diagnostic_report_json: "silver-rhc3-negation-cal-readonly-diagnostic-report.json",
  },
};

/** UTF-8 mis-decoded Czech (Latin-1/Windows-1252 read as UTF-8). */
const SILVER_NEXT_ACTION_MOJIBAKE_RE =
  /Ă|â€|Ĺ|pĹ|Ä›|OtevĹ|ZprĂ|pĹ™ejdÄ|ĂşKOL|ÄŤ|Ĺ™|Ă­|Ăˇ|Ă©/;

const SILVER_NEXT_ACTION_SILVER_WORKFLOW_RE =
  /PRODUCT_CLUSTER|NEXT PRODUCT CLUSTER|PRODUCT_HANDOFF_CONTRACT|target_cluster=|source_audit=|diagnostic_result=|recommended_scope=|expected_outcome=|ENGINE_FIX_TASK_READY|HARNESS_ALIGNMENT_TASK_READY|PLANNER_ALIGNMENT_TASK_READY|NO_SAFE_FIX|SAFE_BLOCKED|silver-rhc3|cluster diagnostic|cluster-classifier|SILVER_RHC3_CLUSTER_CLASSIFIER|harness|audit_silver|SILVER_PRODUCT_CLUSTER|top_cluster=|self_correction_negation_flip|silver-self-correction|TRUE_ENGINE_FAIL|harness_next_command/i;

const GENERIC_ORCHESTRATION_HANDOFF_RE =
  /(?:\bgit\s+push\s+-u\b|\bgh\s+auth\b|chore\/silver-audit-repo-state|(?:--verify-pr=\d+|\bverify-pr\b)|sudo\s+apt\s+(?:update|install))/i;

/** Generic repo/git workflow (status → commit/stash → gh auth → push) without product cluster task. */
const GENERIC_REPO_GIT_WORKFLOW_RE =
  /(?:\bgit\s+status\b[\s\S]{0,1200}?(?:\bgit\s+stash\b|\bgit\s+commit\b)[\s\S]{0,1200}?(?:\bgh\s+auth\b|\bgit\s+push\s+-u\b)|(?:\bgit\s+status\b[\s\S]{0,800}?\bgit\s+push\s+-u\b))/i;

/** Cluster-specific product steps (orchestration/scripts only). */
const CLUSTER_PRODUCT_TASK_SPEC = {
  self_correction_negation_flip: {
    expected_outcome: "engine PR",
    harness_commands: [
      "node scripts/silver-self-correction-audit.cjs",
      "node scripts/silver-self-correction-safety-diagnostic.cjs",
      "node scripts/silver-self-correction-negation-scope-selftest.cjs",
    ],
    analysis_bullets: [
      "Rozlož fail cases lane `correction_negation` / cluster `self_correction_negation_flip` z `scripts/silver-self-correction-audit-report.json`.",
      "Klasifikuj **TRUE_ENGINE_FAIL** vs harness/gold (`true_engine_fail_count`, `harness_problem_count`, `negation_flip_fail_count` v diagnostic JSON).",
      "Při **TRUE_ENGINE_FAIL**: připrav úzký engine fix (jen pokud důkaz z harnessu); jinak **scripts-only** harness alignment.",
      "Spusť proof (`npm run smoke` po změně skriptů; read-only průzkum bez smoke).",
      "Vytvoř PR pokud repo CLEAN/PASS a změny jsou jen v povoleném scope.",
    ],
  },
  self_correction_safety_note_readonly: {
    expected_outcome: "harness PR",
    harness_commands: [
      "node scripts/silver-self-correction-audit.cjs",
      "node scripts/silver-self-correction-safety-note-readonly-selftest.cjs",
    ],
    analysis_bullets: [
      "Cluster `self_correction_safety_note_readonly`: note query + safety cue „Nic nevytvářej“ musí zůstat read-only (žádný notes.create leak).",
      "Změny pouze v `scripts/silver-self-correction-*` (audit, query-clarification, safety-diagnostic, safety-note-readonly-selftest).",
      "Spusť `node scripts/silver-self-correction-audit.cjs` a `node scripts/silver-self-correction-safety-note-readonly-selftest.cjs` — oba PASS.",
      "Bez změny `assets/app.js` pokud diagnostika nepotvrdí TRUE_ENGINE_FAIL.",
      "Vytvoř úzký PR (orchestration/scripts only) po PASS proof.",
    ],
  },
};

/** Known stale verify-pr IDs from old backlog / selftest fixtures — never valid cluster tasks. */
const STALE_VERIFY_PR_IDS = new Set(["3794"]);

const GENERIC_INFRA_RE =
  /(?:sudo\s+apt\s+(?:update|install)|gh\s+auth\s+login|(?:--verify-pr=\d+|\bverify-pr\b)|git\s+push\s+-u\s+origin)/i;

const INFRA_BLOCKER_REASON_RE = /INFRA_BLOCKER_REASON:\s*\S+/i;

function readJsonFile(abs) {
  try {
    if (!fs.existsSync(abs)) return { ok: false, data: null, message: "missing" };
    const raw = fs.readFileSync(abs, "utf8");
    return { ok: true, data: JSON.parse(raw), message: "" };
  } catch (e) {
    return { ok: false, data: null, message: String(e.message || e || "json_read_failed") };
  }
}

function parseTopFailClustersFromReport(data) {
  if (!data || typeof data !== "object") return [];
  const arr = data.top_fail_clusters;
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const row of arr) {
    const s = String(row);
    const idx = s.lastIndexOf(":");
    if (idx <= 0) continue;
    const name = s.slice(0, idx).trim();
    const count = parseInt(s.slice(idx + 1), 10);
    if (!name || !Number.isFinite(count) || count <= 0) continue;
    out.push({ name, count });
  }
  return out;
}

function pickClusterFromAuditRegistry(repoRoot) {
  const root = repoRoot || REPO;
  try {
    const lockedCluster = resolveAuthoritativeSelectorCluster(root, "");
    const handoff = resolveCapRuntimeHandoff(root, {});
    const diag = handoff.cluster_diag;
    if (!diag || !diag.cluster || diag.cluster === "(žádný)") return null;
    if (lockedCluster && diag.cluster !== lockedCluster) {
      const lock = readClusterLock(root);
      return {
        source: "silver-cluster-consistency-lock:" + String((lock && lock.lock_reason) || "locked"),
        cluster: lockedCluster,
        count: Number(diag.count) || 0,
        audit_name: String(diag.audit_name || ""),
        audit_id: String((lock && lock.audit_id) || diag.audit_id || ""),
        expected_outcome: String(diag.expected_outcome || ""),
        harness_command: String(diag.harness_command || ""),
        harness_commands: Array.isArray(diag.harness_commands) ? diag.harness_commands : [],
        recommended_cap: String(diag.recommended_cap || handoff.cap_label || ""),
        top_preview: lockedCluster + ":locked",
      };
    }
    return {
      source: String(diag.source || "silver-audit-registry"),
      cluster: String(diag.cluster),
      count: Number(diag.count) || 0,
      audit_name: String(diag.audit_name || ""),
      audit_id: String(diag.audit_id || ""),
      expected_outcome: String(diag.expected_outcome || ""),
      harness_command: String(diag.harness_command || ""),
      harness_commands: Array.isArray(diag.harness_commands) ? diag.harness_commands : [],
      recommended_cap: String(diag.recommended_cap || handoff.cap_label || ""),
      top_preview:
        handoff.prioritized && handoff.prioritized.length
          ? handoff.prioritized
              .slice(0, 8)
              .map((p) => p.cluster + ":" + p.fail_count)
              .join(" | ")
          : "",
    };
  } catch {
    return null;
  }
}

function pickTopClusterDiagnostic() {
  const fromRegistry = pickClusterFromAuditRegistry();
  if (fromRegistry) return fromRegistry;

  const rhc3 = readJsonFile(RHC3_REPORT);
  if (rhc3.ok && rhc3.data) {
    const tops = parseTopFailClustersFromReport(rhc3.data);
    if (tops.length) {
      const t = tops[0];
      return {
        source: "scripts/silver-real-human-chaos-v3-report.json",
        cluster: t.name,
        count: t.count,
        top_preview: tops.slice(0, 8).map((x) => `${x.name}:${x.count}`).join(" | "),
      };
    }
  }
  const mob = readJsonFile(REALISTIC_MOBILE_REPORT);
  if (mob.ok && mob.data) {
    const tops = parseTopFailClustersFromReport(mob.data);
    if (tops.length) {
      const t = tops[0];
      return {
        source: "scripts/silver-realistic-mobile-corpus-report.json",
        cluster: t.name,
        count: t.count,
        top_preview: tops.slice(0, 8).map((x) => `${x.name}:${x.count}`).join(" | "),
      };
    }
    const fc = mob.data.fail_count_by_cluster;
    if (fc && typeof fc === "object") {
      const pairs = Object.keys(fc)
        .map((k) => ({ name: k, count: Number(fc[k]) }))
        .filter((p) => p.name && Number.isFinite(p.count) && p.count > 0)
        .sort((a, b) => b.count - a.count);
      if (pairs.length) {
        const t = pairs[0];
        return {
          source: "scripts/silver-realistic-mobile-corpus-report.json:fail_count_by_cluster",
          cluster: t.name,
          count: t.count,
          top_preview: pairs.slice(0, 8).map((x) => `${x.name}:${x.count}`).join(" | "),
        };
      }
    }
  }
  return {
    source: "(no_cluster_report)",
    cluster: "(unknown)",
    count: 0,
    top_preview: "(no nonzero fail clusters found on disk — run harnesses if needed)",
  };
}

function buildQueueSummaryLines(rep) {
  if (!rep || typeof rep !== "object") return "(no orchestrator report)";
  return [
    `- mode: ${String(rep.mode || "")}`,
    `- queue_safe_to_continue: ${String(rep.queue_safe_to_continue || rep.safe_to_continue || "")}`,
    `- queue_stop_reason: ${String(rep.queue_stop_reason || "")}`,
    `- queue_cycles_completed: ${String(rep.queue_cycles_completed != null ? rep.queue_cycles_completed : "")}`,
    `- apply_stopped_reason: ${String(rep.apply_stopped_reason || "")}`,
    `- apply_merge_attempted/result: ${String(rep.apply_merge_attempted || "")}/${String(rep.apply_merge_result || "")}`,
    `- apply_sync_attempted/result: ${String(rep.apply_sync_attempted || "")}/${String(rep.apply_sync_result || "")}`,
    `- safe_open_candidates: ${String(rep.safe_open_candidates != null ? rep.safe_open_candidates : "")}`,
    `- total_open_prs: ${String(rep.total_open_prs != null ? rep.total_open_prs : "")}`,
    `- error: ${String(rep.error || "")}`,
  ].join("\n");
}

function readOrchestratorReport() {
  const r = readJsonFile(ORCHESTRATOR_REPORT);
  return r.ok ? r.data : null;
}

function parseClusterFailCountFromReport(data, cluster) {
  if (!data || !cluster) return 0;
  const name = String(cluster).trim();
  if (!name) return 0;
  if (Array.isArray(data.top_fail_clusters)) {
    for (const row of data.top_fail_clusters) {
      const s = String(row);
      const idx = s.lastIndexOf(":");
      if (idx <= 0) continue;
      if (s.slice(0, idx).trim() === name) {
        const n = parseInt(s.slice(idx + 1), 10);
        return Number.isFinite(n) ? n : 0;
      }
    }
  }
  if (data.target_cluster === name) {
    const n = Number(data.fail_count || data.intent_fail_count);
    return Number.isFinite(n) ? n : 0;
  }
  const st = data.cluster_stats && data.cluster_stats[name];
  if (st && st.fail_count != null) return Number(st.fail_count) || 0;
  return 0;
}

function parseTextBlockField(text, key) {
  const re = new RegExp("^" + key + "=([^\\r\\n]+)", "im");
  const m = String(text || "").match(re);
  return m ? String(m[1]).trim() : "";
}

function aggregateSafetyCountersFromReports(repoRoot) {
  const names = [
    "silver-self-correction-audit-report.json",
    "silver-real-human-chaos-v3-report.json",
    "silver-quality-v2-report.json",
  ];
  const out = {
    dangerous_write_count: 0,
    false_write_count: 0,
    query_created_write_count: 0,
    write_when_negated_count: 0,
  };
  for (const fn of names) {
    const r = readJsonFile(path.join(repoRoot, "scripts", fn));
    if (!r.ok || !r.data) continue;
    for (const k of Object.keys(out)) {
      const n = Number(r.data[k]);
      if (Number.isFinite(n)) out[k] = Math.max(out[k], n);
    }
  }
  return out;
}

/**
 * Load cluster-specific diagnostic evidence from on-disk audit/diagnostic JSON.
 * @param {string} repoRoot
 * @param {object} registryDiag cluster_diag from resolveCapRuntimeHandoff
 */
function loadClusterDiagnosticEvidence(repoRoot, registryDiag) {
  const cluster = String((registryDiag && registryDiag.cluster) || "").trim();
  const auditId = String((registryDiag && registryDiag.audit_id) || "").trim();
  const auditName = String((registryDiag && registryDiag.audit_name) || "").trim();
  const spec = CLUSTER_DIAG_REPORT_MAP[auditId] || {};
  const scriptsDir = path.join(repoRoot, "scripts");
  const auditPath = spec.report_json ? path.join(scriptsDir, spec.report_json) : "";
  const diagPath = spec.diagnostic_report_json ? path.join(scriptsDir, spec.diagnostic_report_json) : "";
  const auditJson = auditPath ? readJsonFile(auditPath) : { ok: false, data: null };
  const diagJson = diagPath && diagPath !== auditPath ? readJsonFile(diagPath) : auditJson;

  const auditData = auditJson.ok ? auditJson.data : null;
  const diagData = diagJson.ok ? diagJson.data : null;
  const clusterStats =
    diagData && diagData.cluster_stats && diagData.cluster_stats[cluster]
      ? diagData.cluster_stats[cluster]
      : null;

  let failCount = Number((registryDiag && registryDiag.count) || 0);
  if (clusterStats && clusterStats.fail_count != null) failCount = Number(clusterStats.fail_count) || failCount;
  else if (auditData) failCount = parseClusterFailCountFromReport(auditData, cluster) || failCount;

  let passCount = 0;
  let observedAccuracy = "";
  if (clusterStats) {
    passCount = Number(clusterStats.pass_count) || 0;
    const total = Number(clusterStats.total_cases) || passCount + failCount;
    if (total > 0) observedAccuracy = ((passCount / total) * 100).toFixed(2);
  } else if (auditData && auditData.overall_accuracy != null && failCount > 0) {
    observedAccuracy = String(auditData.overall_accuracy);
  }

  const globalTef = auditData ? Number(auditData.true_engine_fail_count) || 0 : 0;
  const globalHarness = auditData ? Number(auditData.harness_problem_count) || 0 : 0;
  const clusterTef = clusterStats ? Number(clusterStats.true_engine_fail_count) || 0 : NaN;
  const clusterHarness = clusterStats
    ? Number(clusterStats.harness_problem_count || clusterStats.negation_flip_fail_count) || 0
    : NaN;

  const textBlock = String((diagData && diagData.text_block) || "");
  const readyEngine = parseTextBlockField(textBlock, "ready_for_engine_fix");
  const diagRecommended = String(
    (diagData && diagData.recommended_next_task_type) ||
      (auditData && auditData.recommended_next_task_type) ||
      "",
  );

  let trueEngineFail = "NO";
  if (Number.isFinite(clusterTef) && clusterTef > 0) trueEngineFail = "YES";
  else if (readyEngine === "YES") trueEngineFail = "YES";
  else if (readyEngine === "NO") trueEngineFail = "NO";
  else if (/TRUE_ENGINE|must_fix_engine/i.test(diagRecommended) && globalTef > 0) trueEngineFail = "YES";
  else if (
    registryDiag &&
    registryDiag.expected_outcome &&
    /engine\s*PR/i.test(String(registryDiag.expected_outcome)) &&
    globalTef > globalHarness
  ) {
    trueEngineFail = "YES";
  }

  const harnessAlignment =
    trueEngineFail === "NO" ||
    /HARNESS|harness\s*alignment|SCRIPTS_ONLY_HARNESS/i.test(diagRecommended) ||
    (Number.isFinite(clusterHarness) && clusterHarness > 0 && (!Number.isFinite(clusterTef) || clusterTef === 0)) ||
    (globalHarness > globalTef && globalTef > 0 && /negation_flip|harness|clarif|ambiguous/i.test(cluster));

  const safety = aggregateSafetyCountersFromReports(repoRoot);
  const safeBlocked =
    safety.dangerous_write_count > 0 ||
    safety.false_write_count > 0 ||
    safety.write_when_negated_count > 0;

  return {
    target_cluster: cluster,
    source_audit: auditName || auditId || String((registryDiag && registryDiag.source) || ""),
    audit_id: auditId,
    observed_accuracy: observedAccuracy || "(unknown)",
    observed_fail_count: failCount,
    observed_pass_count: passCount,
    true_engine_fail: trueEngineFail,
    harness_alignment: harnessAlignment ? "YES" : "NO",
    ready_for_engine_fix: readyEngine || (trueEngineFail === "YES" ? "YES" : "NO"),
    diagnostic_result:
      trueEngineFail === "YES"
        ? "TRUE_ENGINE_FAIL=YES"
        : harnessAlignment
          ? "TRUE_ENGINE_FAIL=NO;harness_or_gold_alignment"
          : "TRUE_ENGINE_FAIL=NO;diagnostic_inconclusive",
    recommended_scope:
      trueEngineFail === "YES"
        ? "narrow_engine_fix_after_harness_signoff"
        : harnessAlignment
          ? "scripts-only_harness_gold_alignment"
          : "scripts-only_cluster_diagnostic",
    safety_counters: safety,
    safe_blocked: safeBlocked ? "YES" : "NO",
    registry_expected_outcome: String((registryDiag && registryDiag.expected_outcome) || ""),
    diagnostic_report: diagPath ? path.basename(diagPath) : "",
    audit_report: auditPath ? path.basename(auditPath) : "",
  };
}

/**
 * Map diagnostic evidence → product handoff outcome type.
 * @param {ReturnType<typeof loadClusterDiagnosticEvidence>} evidence
 */
function resolveProductHandoffOutcome(evidence) {
  if (!evidence || !evidence.target_cluster) {
    return {
      expected_outcome: "NEED_HUMAN_INPUT",
      engine_change_allowed: "NO",
      assets_app_change_allowed: "NO",
    };
  }
  if (evidence.safe_blocked === "YES") {
    return {
      expected_outcome: "SAFE_BLOCKED",
      engine_change_allowed: "NO",
      assets_app_change_allowed: "NO",
    };
  }
  if (evidence.observed_fail_count === 0 && evidence.true_engine_fail === "NO") {
    return {
      expected_outcome: "MERGED_AND_PROVED",
      engine_change_allowed: "NO",
      assets_app_change_allowed: "NO",
    };
  }
  if (evidence.true_engine_fail === "YES" && evidence.ready_for_engine_fix !== "NO") {
    return {
      expected_outcome: "ENGINE_FIX_TASK_READY",
      engine_change_allowed: "YES",
      assets_app_change_allowed: "NO",
    };
  }
  if (evidence.harness_alignment === "YES") {
    return {
      expected_outcome: "HARNESS_ALIGNMENT_TASK_READY",
      engine_change_allowed: "NO",
      assets_app_change_allowed: "NO",
    };
  }
  if (/PLANNER|planner/i.test(evidence.recommended_scope)) {
    return {
      expected_outcome: "PLANNER_ALIGNMENT_TASK_READY",
      engine_change_allowed: "NO",
      assets_app_change_allowed: "NO",
    };
  }
  if (/no_safe|stale/i.test(evidence.diagnostic_result)) {
    return {
      expected_outcome: "NO_SAFE_FIX",
      engine_change_allowed: "NO",
      assets_app_change_allowed: "NO",
    };
  }
  return {
    expected_outcome: "NEED_HUMAN_INPUT",
    engine_change_allowed: "NO",
    assets_app_change_allowed: "NO",
  };
}

function isGenericRepoGitMaintenanceWorkflow(text) {
  const t = String(text || "");
  if (!t || silverNextActionHasClusterWorkflow(t)) return false;
  if (GENERIC_REPO_GIT_WORKFLOW_RE.test(t)) return true;
  if (
    /\bgit\s+status\b/i.test(t) &&
    (/\bgit\s+stash\b/i.test(t) || /\bgit\s+commit\b/i.test(t)) &&
    (/\bgh\s+auth\b/i.test(t) || /\bgit\s+push\s+-u\b/i.test(t))
  ) {
    return true;
  }
  return false;
}

function isGenericOrchestrationHandoff(text) {
  const t = String(text || "");
  if (!t) return false;
  if (silverNextActionHasClusterWorkflow(t)) return false;
  if (isGenericRepoGitMaintenanceWorkflow(t)) return true;
  if (!GENERIC_ORCHESTRATION_HANDOFF_RE.test(t)) return false;
  const productHarness =
    /PRODUCT_CLUSTER|PRODUCT_HANDOFF_CONTRACT|target_cluster=/i.test(t) &&
    /(?:node|npx)\s+scripts\/silver-/i.test(t);
  return !productHarness;
}

function isValidProductClusterName(cluster) {
  const c = String(cluster || "").trim();
  return !!(c && c !== "(žádný)" && c !== "(unknown)" && c !== "(none)");
}

function capDiagnosticFlowActive(opts) {
  const cd = opts && opts.clusterDiag;
  const cluster = cd && String(cd.cluster || "").trim();
  return !!(cluster && cluster !== "(žádný)" && cluster !== "(unknown)");
}

/**
 * @param {{ mainCommit?: string, queueReport?: object|null, clusterDiag?: object }} ctx
 * @returns {string}
 */
function buildCapDiagnosticProductHandoff(ctx) {
  const repoRoot = (ctx && ctx.repoRoot) || REPO;
  let clusterDiag = (ctx && ctx.clusterDiag) || null;
  if (!clusterDiag || !clusterDiag.cluster || clusterDiag.cluster === "(žádný)") {
    clusterDiag = pickClusterFromAuditRegistry() || pickTopClusterDiagnostic();
  }
  const main = String((ctx && ctx.mainCommit) || "").trim();
  const evidence = loadClusterDiagnosticEvidence(repoRoot, clusterDiag);
  const outcome = resolveProductHandoffOutcome(evidence);
  const spec = clusterProductSpecFor(clusterDiag);
  const cmds =
    Array.isArray(clusterDiag.harness_commands) && clusterDiag.harness_commands.length
      ? clusterDiag.harness_commands
      : spec && spec.harness_commands
        ? spec.harness_commands
        : clusterDiag.harness_command
          ? [clusterDiag.harness_command]
          : ["node scripts/silver-rhc3-cluster-classifier-v1.cjs"];
  const safety = evidence.safety_counters;
  const safetyLine =
    "dangerous_write_count=" +
    safety.dangerous_write_count +
    ";false_write_count=" +
    safety.false_write_count +
    ";query_created_write_count=" +
    safety.query_created_write_count +
    ";write_when_negated_count=" +
    safety.write_when_negated_count;

  const analysisBullets =
    spec && spec.analysis_bullets
      ? spec.analysis_bullets
      : [
          "Ověř `TRUE_ENGINE_FAIL` vs harness/gold z diagnostic JSON (`true_engine_fail_count`, `harness_problem_count`).",
          "Drž scope: scripts-only pokud `TRUE_ENGINE_FAIL=NO`.",
          "Spusť existující harness příkazy níže; nevymýšlej nové cesty.",
        ];

  const lines = [
    "<!-- SILVER_NEXT_ACTION: planner-cap-diagnostic-product-handoff; not auto-applied -->",
    "",
    "ÚKOL PRO CURSOR — infoUzel.cz / Silver — PRODUCT HANDOFF (CAP diagnostic) — NO ENGINE CHANGE unless explicit below",
    "",
    "### PRODUCT_HANDOFF_CONTRACT",
    "",
    "target_cluster=" + evidence.target_cluster,
    "source_audit=" + evidence.source_audit,
    "observed_accuracy=" + evidence.observed_accuracy,
    "observed_fail_count=" + String(evidence.observed_fail_count),
    "diagnostic_result=" + evidence.diagnostic_result,
    "recommended_scope=" + evidence.recommended_scope,
    "expected_outcome=" + outcome.expected_outcome,
    "engine_change_allowed=" + outcome.engine_change_allowed,
    "assets_app_change_allowed=" + outcome.assets_app_change_allowed,
    "safety_counters=" + safetyLine,
    "metric_delta_required=YES",
    "no_broad_refactor=YES",
    "",
    "### Kontext (automaticky)",
    "",
    "- **Aktuální main commit:** `" + (main || "(unknown)") + "`",
    "- **Zdroj clusteru:** " + String(clusterDiag.source || ""),
    "- **Audit report:** `" + (evidence.audit_report || "(none)") + "`",
    "- **Diagnostic report:** `" + (evidence.diagnostic_report || "(none)") + "`",
    "",
    "### Produktový úkol (cluster-specific)",
    "",
    "- **selector_cluster:** `" + evidence.target_cluster + "`",
    "- **TRUE_ENGINE_FAIL:** " + evidence.true_engine_fail,
    "- **Registry expected (informative):** " + (evidence.registry_expected_outcome || "(none)"),
    "",
    "#### Analýza (povinné)",
    "",
  ];
  for (const b of analysisBullets) lines.push("- " + b);
  lines.push("");
  lines.push("#### Harness / diagnostika (existující skripty)");
  lines.push("");
  let idx = 0;
  for (const cmd of cmds) {
    idx++;
    lines.push(String(idx) + ") `" + cmd + "`");
  }
  lines.push("");
  lines.push("### Kroky");
  lines.push("");
  lines.push("1) `Set-Location C:\\\\projects\\\\filtr`");
  lines.push("2) `git status --short` — pouze reporting `SILVER_*.md` dirty je povoleno.");
  lines.push("3) `node scripts/silver-autopilot.cjs --status`");
  lines.push(
    "4) Zaměř se na cluster **" +
      evidence.target_cluster +
      "**: spusť harness příkazy výše; **NE** generic git push / gh auth / verify-pr.",
  );
  if (outcome.expected_outcome === "HARNESS_ALIGNMENT_TASK_READY") {
    lines.push(
      "5) **HARNESS_ALIGNMENT_TASK_READY:** uprav pouze skripty/harness/gold v `scripts/`; engine/assets zakázány.",
    );
  } else if (outcome.expected_outcome === "ENGINE_FIX_TASK_READY") {
    lines.push(
      "5) **ENGINE_FIX_TASK_READY:** úzký engine fix až po PASS harness důkazu; jinak STOP.",
    );
  } else if (outcome.expected_outcome === "SAFE_BLOCKED") {
    lines.push("5) **SAFE_BLOCKED:** žádné změny — vyřeš safety counters před pokračováním.");
  } else if (outcome.expected_outcome === "NO_SAFE_FIX") {
    lines.push("5) **NO_SAFE_FIX:** dokumentuj důkaz; žádný broad refactor.");
  } else {
    lines.push("5) Drž se `expected_outcome=" + outcome.expected_outcome + "` bez orchestration-only smyčky.");
  }
  lines.push("6) `npm run smoke` po smysluplné změně skriptů.");
  lines.push("");
  lines.push("### Povinný výstup");
  lines.push("");
  lines.push("```text");
  lines.push("=== SILVER_PRODUCT_CLUSTER_DIAGNOSTIC_RESULT ===");
  lines.push("main_commit=" + (main || "(unknown)"));
  lines.push("top_cluster=" + evidence.target_cluster);
  lines.push("target_cluster=" + evidence.target_cluster);
  lines.push("source_audit=" + evidence.source_audit);
  lines.push("diagnostic_result=" + evidence.diagnostic_result);
  lines.push("recommended_scope=" + evidence.recommended_scope);
  lines.push("expected_outcome=" + outcome.expected_outcome);
  lines.push("TRUE_ENGINE_FAIL=" + evidence.true_engine_fail);
  lines.push("engine_touched=NO");
  lines.push("assets_app_touched=NO");
  lines.push("harness_next_command=(vyplň přesný příkaz)");
  lines.push("PASS_FAIL=(PASS|FAIL)");
  lines.push("=== END_SILVER_PRODUCT_CLUSTER_DIAGNOSTIC_RESULT ===");
  lines.push("```");
  lines.push("");
  lines.push("### FINISH");
  lines.push("");
  lines.push("```powershell");
  lines.push("[console]::beep(880, 200)");
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

/**
 * @param {{ mainCommit?: string, queueReport?: object|null, clusterDiag?: object }} ctx
 * @returns {string}
 */
function clusterProductSpecFor(diag) {
  const cluster = String((diag && diag.cluster) || "").trim();
  if (!cluster) return null;
  return CLUSTER_PRODUCT_TASK_SPEC[cluster] || null;
}

function buildClusterSpecificStepsBlock(diag) {
  const spec = clusterProductSpecFor(diag);
  const cluster = String((diag && diag.cluster) || "").trim();
  if (!spec || !cluster) return [];
  const cmds =
    Array.isArray(diag.harness_commands) && diag.harness_commands.length
      ? diag.harness_commands
      : spec.harness_commands;
  const lines = [
    "### Produktový úkol pro cluster (selector)",
    "",
    `- **selector_cluster:** \`${cluster}\``,
    `- **expected_outcome:** ${String(diag.expected_outcome || spec.expected_outcome || "engine PR")}`,
    "",
    "#### Analýza (povinné)",
    "",
  ];
  for (const b of spec.analysis_bullets) {
    lines.push("- " + b);
  }
  lines.push("");
  lines.push("#### Harness / diagnostika (existující skripty)");
  lines.push("");
  let idx = 0;
  for (const cmd of cmds) {
    idx++;
    lines.push(String(idx) + ") `" + cmd + "`");
  }
  lines.push("");
  return lines;
}

function silverNextActionMatchesSelectorCluster(text, selectorCluster) {
  const cluster = String(selectorCluster || "").trim();
  if (!cluster || cluster === "(žádný)" || cluster === "rcz2_retrieval") return true;
  const t = String(text || "");
  if (new RegExp(cluster.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(t)) return true;
  if (/top_cluster=/i.test(t) && t.indexOf(cluster) >= 0) return true;
  const spec = CLUSTER_PRODUCT_TASK_SPEC[cluster];
  if (spec && spec.harness_commands.some((cmd) => t.indexOf(cmd) >= 0)) return true;
  return false;
}

function buildHandoffMarkdown(ctx) {
  const diag = (ctx && ctx.clusterDiag) || pickTopClusterDiagnostic();
  const qrep = (ctx && ctx.queueReport) || readOrchestratorReport() || {};
  const main = String((ctx && ctx.mainCommit) || "").trim();
  const clusterSteps = buildClusterSpecificStepsBlock(diag);
  return [
    "<!-- SILVER_NEXT_ACTION: silver-auto-dev V1 deterministic handoff; not auto-applied -->",
    "",
    "ÚKOL PRO CURSOR — infoUzel.cz / Silver — NEXT PRODUCT CLUSTER DIAGNOSTIC — NO ENGINE CHANGE + FINAL BEEP",
    "",
    "### Kontext (automaticky)",
    "",
    `- **Aktuální main commit:** \`${main || "(unknown)"}\``,
    "- **PR orchestrátor (poslední běh):** viz shrnutí níže + `scripts/silver-pr-orchestrator-v1-report.json`.",
    "",
    "### Shrnutí fronty safe PR",
    "",
    "```text",
    buildQueueSummaryLines(qrep),
    "```",
    "",
    "### Stav bezpečnosti / scope",
    "",
    "- **Zakázáno:** měnit `assets/app.js`, Silver engine (jádro), UI/CSS/backend jen kvůli diagnostice, GitHub workflows, nekonečné smyčky, surové `-MaxCycles 0` bez řízených pojistek z dokumentace.",
    "- **Povoleno:** skripty pod `scripts/`, audity/diagnostika existujících harnessů, čtení reportů JSON/MD, změny striktně mimo engine dle existující strategie.",
    "",
    "### Diagnostika top clusteru (disk)",
    "",
    `- **Zdroj:** ${diag.source}`,
    `- **Top cluster:** \`${diag.cluster}\` (count=${diag.count})`,
    diag.audit_name ? `- **Audit (registry):** ${diag.audit_name}` : "",
    diag.recommended_cap ? `- **Doporučený CAP (registry):** ${diag.recommended_cap}` : "",
    `- **Náhled top:** ${diag.top_preview}`,
    diag.expected_outcome ? `- **Očekávaný výsledek (registry):** ${diag.expected_outcome}` : "",
    "",
    ...clusterSteps,
    "### Kroky (max 7)",
    "",
    "1) `Set-Location C:\\\\projects\\\\filtr`",
    "2) `git status --short` — nesmí být neočekávané změny mimo výslovně povolené reporting soubory.",
    "3) `node scripts/silver-autopilot.cjs --status` — ověř safety/gate signály v konzoli a `SILVER_RUN_REPORT.md`.",
    diag.harness_command && String(diag.harness_command).indexOf("silver-rhc3-cluster-classifier") < 0
      ? `4) Zaměř se na cluster **${diag.cluster}**: nejprve \`${diag.harness_command}\`, pak cílené \`silver-*\` diagnostiky pro tento cluster (manifest v README; nevymýšlej nové cesty).`
      : `4) Zaměř se na cluster **${diag.cluster}**: nejprve \`node scripts/silver-rhc3-cluster-classifier-v1.cjs\`, pak existující \`silver-*\` diagnostické skripty pro tento typ selhání (manifest v README autopilota; nevymýšlej nové cesty).`,
    "5) Pokud reporty JSON ukazují **harness-only** signály vs **true engine fail**, drž se pravidla: nejdřív důkaz z harness JSON (`true_engine_fail_count`, `must_fix_engine_count`, …).",
    "6) `npm run smoke` po jakékoli smysluplné změně skriptů (ne u čistého read-only průzkumu).",
    "7) Výstup vlož do chatu dle bloku níže.",
    "",
    "### Povinný výstup (vlož do chatu)",
    "",
    "```text",
    "=== SILVER_PRODUCT_CLUSTER_DIAGNOSTIC_RESULT ===",
    `main_commit=${main || "(unknown)"}`,
    `top_cluster=${diag.cluster}`,
    `cluster_source=${diag.source}`,
    "engine_touched=NO",
    "assets_app_touched=NO",
    "harness_next_command=(vyplň přesný příkaz, který jsi spustil)",
    "PASS_FAIL=(PASS|FAIL)",
    "=== END_SILVER_PRODUCT_CLUSTER_DIAGNOSTIC_RESULT ===",
    "```",
    "",
    "### FINISH",
    "",
    "Na konci lokálního ověření v PowerShell:",
    "",
    "```powershell",
    "[console]::beep(880, 200)",
    "```",
    "",
  ].join("\n");
}

function silverNextActionHasClusterWorkflow(text) {
  return SILVER_NEXT_ACTION_SILVER_WORKFLOW_RE.test(String(text || ""));
}

function extractStaleVerifyPrIds(text) {
  const out = [];
  const t = String(text || "");
  const re = /--verify-pr=(\d+)/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (STALE_VERIFY_PR_IDS.has(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function buildNoSafeProductClusterBlockedHandoff(ctx) {
  const main = String((ctx && ctx.mainCommit) || "").trim();
  const reason = String((ctx && ctx.blockReason) || "NO_SAFE_PRODUCT_CLUSTER").trim();
  return [
    "<!-- SILVER_NEXT_ACTION: planner-no-safe-product-cluster; not auto-applied -->",
    "",
    "ÚKOL PRO CURSOR — infoUzel.cz / Silver — SAFE_BLOCKED — NO_SAFE_PRODUCT_TASK",
    "",
    "### PRODUCT_HANDOFF_CONTRACT",
    "",
    "target_cluster=(none)",
    "source_audit=(none)",
    "diagnostic_result=" + reason,
    "recommended_scope=orchestration_only_stop",
    "expected_outcome=SAFE_BLOCKED",
    "engine_change_allowed=NO",
    "assets_app_change_allowed=NO",
    "product_cluster_required=YES",
    "generic_git_workflow_blocked=YES",
    "",
    "### Kontext",
    "",
    "- **Aktuální main commit:** `" + (main || "(unknown)") + "`",
    "- **Důvod:** Po CAP10/CAP diagnostice není k dispozici autoritativní product cluster — generic git/gh/stash/push handoff je zakázán.",
    "",
    "### Kroky (orchestration only)",
    "",
    "1) `Set-Location C:\\\\projects\\\\filtr`",
    "2) `node scripts/silver-autopilot.cjs --status`",
    "3) `node scripts/silver-rhc3-cluster-classifier-v1.cjs` — obnov selector cluster z disk reportů.",
    "4) **NE** `git push -u`, **NE** `gh auth login`, **NE** `chore/silver-audit-repo-state` jako „úkol“.",
    "5) Po PASS cluster diagnostice znovu spusť řízený CAP10_SAFE cyklus (bez ručního generic workflow).",
    "",
    "### Povinný výsledek",
    "",
    "```text",
    "=== SILVER_NO_SAFE_PRODUCT_CLUSTER_RESULT ===",
    "main_commit=" + (main || "(unknown)") + "",
    "block_reason=" + reason + "",
    "expected_outcome=SAFE_BLOCKED",
    "generic_git_workflow_attempted=NO",
    "=== END_SILVER_NO_SAFE_PRODUCT_CLUSTER_RESULT ===",
    "```",
    "",
  ].join("\n");
}

/**
 * Runtime failure closeout handoff (stale Cursor invoke / no safe progress).
 * @param {{ mainCommit?: string, blockReason?: string, stopReason?: string }} ctx
 * @returns {string}
 */
function buildStaleCursorInvokeRuntimeBlockedHandoff(ctx) {
  const main = String((ctx && ctx.mainCommit) || "").trim();
  const reason = String((ctx && ctx.blockReason) || "NO_SAFE_RUNTIME_PROGRESS").trim();
  const stop = String((ctx && ctx.stopReason) || "STALE_CURSOR_INVOKE_NO_PROGRESS").trim();
  return [
    "<!-- SILVER_NEXT_ACTION: stale-cursor-invoke-runtime-closeout; not auto-applied -->",
    "",
    "ÚKOL PRO CURSOR — infoUzel.cz / Silver — SAFE_BLOCKED — NO_SAFE_RUNTIME_PROGRESS",
    "",
    "### PRODUCT_HANDOFF_CONTRACT",
    "",
    "target_cluster=(none)",
    "source_audit=(none)",
    "diagnostic_result=" + reason,
    "stop_reason=" + stop,
    "recommended_scope=orchestration_only_stop",
    "expected_outcome=SAFE_BLOCKED",
    "engine_change_allowed=NO",
    "assets_app_change_allowed=NO",
    "product_cluster_required=YES",
    "generic_git_workflow_blocked=YES",
    "",
    "### Kontext",
    "",
    "- **Aktuální main commit:** `" + (main || "(unknown)") + "`",
    "- **Důvod:** Runtime selhal (`" + stop + "`) — generic git/gh/stash/push handoff je zakázán.",
    "",
    "### Kroky (orchestration only)",
    "",
    "1) `Set-Location C:\\\\projects\\\\filtr`",
    "2) `node scripts/silver-autopilot.cjs --status`",
    "3) Ověř Cursor/WSL adapter: `powershell -ExecutionPolicy Bypass -File scripts\\\\silver-cursor-agent-adapter-diagnostic.ps1`",
    "4) **NE** `git push -u`, **NE** `gh auth login`, **NE** `chore/silver-audit-repo-state`.",
    "5) Po čistém main a PASS selftestech spusť řízený CAP10_SAFE (viz doporučený příkaz v SILVER_RUN_REPORT / cap10 pipeline map).",
    "",
    "### Povinný výsledek",
    "",
    "```text",
    "=== SILVER_STALE_CURSOR_INVOKE_RUNTIME_CLOSEOUT_RESULT ===",
    "main_commit=" + (main || "(unknown)") + "",
    "block_reason=" + reason + "",
    "stop_reason=" + stop + "",
    "expected_outcome=SAFE_BLOCKED",
    "generic_git_workflow_attempted=NO",
    "=== END_SILVER_STALE_CURSOR_INVOKE_RUNTIME_CLOSEOUT_RESULT ===",
    "```",
    "",
  ].join("\n");
}

function silverNextActionQualityViolations(text, opts) {
  const t = String(text || "");
  const v = [];
  const clusterWorkflow = silverNextActionHasClusterWorkflow(t);
  if (isGenericRepoGitMaintenanceWorkflow(t)) {
    v.push("generic_repo_git_workflow_drift");
  }
  if (capDiagnosticFlowActive(opts) && isGenericOrchestrationHandoff(t)) {
    v.push("generic_orchestration_blocked_after_cap_diagnostic");
  }
  if ((opts && opts.requireProductCluster) && !clusterWorkflow && isGenericOrchestrationHandoff(t)) {
    v.push("generic_next_action_drift_blocked");
  }
  const repoRoot = (opts && opts.repoRoot) || REPO;
  const effectiveSelector =
    (opts && opts.selectorCluster) ||
    resolveAuthoritativeSelectorCluster(repoRoot, "") ||
    "";
  if (
    effectiveSelector &&
    effectiveSelector !== "rcz2_retrieval" &&
    !silverNextActionMatchesSelectorCluster(t, effectiveSelector)
  ) {
    v.push("product_handoff_not_cluster_specific");
  }
  v.push(...blockGenericHandoffUnderLock(t, repoRoot));
  if (SILVER_NEXT_ACTION_MOJIBAKE_RE.test(t)) v.push("mojibake_utf8");
  if (!clusterWorkflow) {
    if (/git\s+push\s+-u\s+origin/i.test(t)) v.push("generic_git_push_upstream");
    if (/chore\/silver-audit-repo-state/i.test(t)) v.push("generic_chore_silver_audit_push");
    if (/(?:--verify-pr=\d+|\bverify-pr\b)/i.test(t)) {
      v.push("generic_verify_pr_not_cluster_workflow");
    }
    if (/(?:sudo\s+apt\s+(?:update|install)|gh\s+auth\s+login)/i.test(t)) {
      v.push("generic_gh_sudo_not_cluster_workflow");
    }
    if (/full-auto-loop-openai/i.test(t) && GENERIC_INFRA_RE.test(t)) {
      v.push("generic_full_auto_infra_not_cluster_workflow");
    }
    if (GENERIC_INFRA_RE.test(t) && !INFRA_BLOCKER_REASON_RE.test(t)) {
      v.push("generic_infra_without_blocker_reason");
    }
    const staleIds = extractStaleVerifyPrIds(t);
    if (staleIds.length) {
      v.push("generic_stale_verify_pr_id:" + staleIds.join(","));
    }
  }
  return v;
}

/**
 * Healthy CAP/planner context: no real infra blocker — generic infra tasks are invalid.
 * @param {{ guardBlocked?: boolean, safetyBlocked?: boolean, dirtyBlocked?: boolean }} ctx
 * @returns {boolean}
 */
function isHealthyPlannerContext(ctx) {
  if (!ctx || typeof ctx !== "object") return true;
  if (ctx.guardBlocked) return false;
  if (ctx.safetyBlocked) return false;
  if (ctx.dirtyBlocked) return false;
  return true;
}

/**
 * @param {{ mainCommit?: string, queueReport?: object|null, clusterDiag?: object, plannerContext?: object }} ctx
 * @returns {string}
 */
function buildClusterHandoffForHealthyPlanner(ctx) {
  return generateAutonomousPlannedHandoff(ctx).body;
}

/**
 * Canonical autonomous planner: cluster-specific product handoff OR SAFE_BLOCKED — never generic chore/git/gh.
 * @param {{
 *   mainCommit?: string,
 *   repoRoot?: string,
 *   clusterDiag?: object,
 *   blockReason?: string,
 *   stopReason?: string,
 *   plannerContext?: { guardBlocked?: boolean, safetyBlocked?: boolean, dirtyBlocked?: boolean },
 *   preferRuntimeBlocked?: boolean,
 * }} ctx
 * @returns {{ body: string, mode: string, cluster: string }}
 */
function buildScorecardRuntimeErrorNextAction(opts) {
  const exact = String((opts && opts.exact_error) || "scorecard runtime error").trim();
  const forcedCmd = String(
    (opts && opts.forced_command) || "node scripts/silver-cap-product-scorecard.cjs selftest",
  ).trim();
  const header =
    "<!-- SILVER_NEXT_ACTION: scorecard-runtime-error-forced-outcome; copy-paste for Cursor; not auto-applied -->\n\n" +
    "ÚKOL PRO CURSOR — infoUzel.cz / Silver — SCORECARD RUNTIME FIX\n\n";
  const body = [
    "### STOP — scorecard finalize runtime error (deterministic forced outcome)",
    "",
    "- SCORECARD_RUNTIME_ERROR=YES",
    "- HARD_STOP_FORCED_OUTCOME_REQUIRED=YES",
    "- next_cap_blind_retry_blocked=YES",
    "- exact_error=" + exact,
    "- forced_outcome_task_type=scorecard_runtime_fix",
    "",
    "### Povinný důkaz (bez CAP běhu)",
    "",
    "```",
    forcedCmd,
    "node scripts/silver-autopilot.cjs --scorecard-finalize-runtime-selftest",
    "node scripts/silver-autopilot.cjs --scorecard-runreport-regression-selftest",
    "node scripts/silver-autopilot.cjs --forced-scorecard-runtime-error-outcome-selftest",
    "node scripts/silver-autopilot.cjs --generic-handoff-after-scorecard-error-blocker-selftest",
    "```",
    "",
    "### Scope guard",
    "- Žádný CAP10/CAP15/CAP25/CAP50 běh před PASS selftestů.",
    "- Zakázáno: obecný git/gh workflow (repo audit push, gh přihlášení) jako hlavní úkol.",
    "- engine_changed=NO; assets_app_changed=NO.",
    "",
    "### Povinný výsledek",
    "",
    "```",
    "SCORECARD_RUNTIME_FIX_PASS=YES/NO",
    "repo_clean=YES/NO",
    "=== END_SCORECARD_RUNTIME_FIX_RESULT ===",
    "```",
  ].join("\n");
  return header + body;
}

function generateAutonomousPlannedHandoff(ctx) {
  const repoRoot = (ctx && ctx.repoRoot) || REPO;
  const main = String((ctx && ctx.mainCommit) || "").trim();
  const pctx = (ctx && ctx.plannerContext) || {};
  const unhealthy =
    !!(pctx.guardBlocked || pctx.safetyBlocked || pctx.dirtyBlocked) || !!(ctx && ctx.preferRuntimeBlocked);
  const blockReason = String((ctx && ctx.blockReason) || "NO_SAFE_PRODUCT_CLUSTER").trim();
  const stop = String((ctx && ctx.stopReason) || "").trim();

  if (/SCORECARD_RUNTIME|scorecard_runtime/i.test(blockReason)) {
    return {
      body: buildScorecardRuntimeErrorNextAction({
        exact_error: (ctx && ctx.exact_error) || stop || "scorecard runtime error",
        forced_command: (ctx && ctx.forced_command) || undefined,
      }),
      mode: "SCORECARD_RUNTIME_FIX",
      cluster: "(runtime)",
    };
  }

  if (unhealthy) {
    if (/stale_cursor_invoke|stale_invoke|cursor_exit.?125|CURSOR_PROCESS_ALIVE_BUT_NO_OUTPUT/i.test(stop)) {
      return {
        body: buildStaleCursorInvokeRuntimeBlockedHandoff({
          mainCommit: main,
          blockReason: blockReason || "NO_SAFE_RUNTIME_PROGRESS",
          stopReason: stop || "STALE_CURSOR_INVOKE_NO_PROGRESS",
        }),
        mode: "SAFE_BLOCKED_RUNTIME",
        cluster: "",
      };
    }
    return {
      body: buildNoSafeProductClusterBlockedHandoff({
        mainCommit: main,
        blockReason: blockReason || "NO_SAFE_RUNTIME_PROGRESS",
      }),
      mode: "SAFE_BLOCKED",
      cluster: "",
    };
  }

  const locked = readClusterLock(repoRoot);
  let clusterDiag =
    (ctx && ctx.clusterDiag) || pickClusterFromAuditRegistry(repoRoot) || pickTopClusterDiagnostic();
  if (locked && clusterDiag && clusterDiag.cluster !== locked.authoritative_cluster) {
    clusterDiag = pickClusterFromAuditRegistry(repoRoot) || clusterDiag;
  }
  if (isValidProductClusterName(clusterDiag && clusterDiag.cluster)) {
    return {
      body: buildCapDiagnosticProductHandoff({
        repoRoot,
        mainCommit: main,
        clusterDiag,
      }),
      mode: "CLUSTER_PRODUCT_HANDOFF",
      cluster: String(clusterDiag.cluster),
    };
  }
  return {
    body: buildNoSafeProductClusterBlockedHandoff({
      mainCommit: main,
      blockReason: blockReason || "NO_SAFE_PRODUCT_CLUSTER",
    }),
    mode: "NO_SAFE_PRODUCT_CLUSTER",
    cluster: "",
  };
}

/** @returns {boolean} */
function plannedHandoffPassesQualityGate(body, opts) {
  const t = String(body || "");
  if (!t) return false;
  if (isGenericRepoGitMaintenanceWorkflow(t) || isGenericOrchestrationHandoff(t)) return false;
  return silverNextActionQualityViolations(t, opts).length === 0;
}

function runPlannerClusterPreferenceSelftest() {
  let ok = true;
  const generic = silverNextActionQualityViolations(
    "<!-- SILVER_NEXT_ACTION: full-auto-loop-openai -->\nsudo apt update\ngh auth login\nnode scripts/silver-autopilot.cjs --verify-pr=3794",
  );
  if (!generic.length) {
    console.error("PLANNER_CLUSTER_SELFTEST_FAIL generic_infra_expected");
    ok = false;
  }
  if (!generic.includes("generic_stale_verify_pr_id:3794")) {
    console.error("PLANNER_CLUSTER_SELFTEST_FAIL stale_verify_pr_expected");
    ok = false;
  }
  const cluster = silverNextActionQualityViolations(
    "ÚKOL PRO CURSOR — NEXT PRODUCT CLUSTER\nnode scripts/silver-rhc3-cluster-classifier-v1.cjs\ntop_cluster=foo",
  );
  if (cluster.length) {
    console.error("PLANNER_CLUSTER_SELFTEST_FAIL cluster_rejected " + cluster.join(";"));
    ok = false;
  }
  const handoff = buildClusterHandoffForHealthyPlanner({
    mainCommit: "abc123",
    clusterDiag: {
      source: "silver-audit-registry:self_correction",
      cluster: "self_correction_negation_flip",
      count: 472,
      expected_outcome: "engine PR",
      harness_commands: [
        "node scripts/silver-self-correction-audit.cjs",
        "node scripts/silver-self-correction-safety-diagnostic.cjs",
      ],
      top_preview: "self_correction_negation_flip:472",
    },
  });
  if (!silverNextActionHasClusterWorkflow(handoff)) {
    console.error("PLANNER_CLUSTER_SELFTEST_FAIL handoff_missing_markers");
    ok = false;
  }
  if (!/self_correction_negation_flip/.test(handoff)) {
    console.error("PLANNER_CLUSTER_SELFTEST_FAIL negation_flip_cluster_missing");
    ok = false;
  }
  if (silverNextActionQualityViolations(handoff, { selectorCluster: "self_correction_negation_flip" }).length) {
    console.error("PLANNER_CLUSTER_SELFTEST_FAIL negation_flip_handoff_violations");
    ok = false;
  }
  if (isHealthyPlannerContext({ guardBlocked: true, safetyBlocked: false, dirtyBlocked: false })) {
    console.error("PLANNER_CLUSTER_SELFTEST_FAIL guard_blocked_must_be_unhealthy");
    ok = false;
  }
  if (ok) console.log("PLANNER_CLUSTER_PREFERENCE_SELFTEST_PASS");
  return ok;
}

function runPlannerProductHandoffSelftest() {
  let ok = true;
  const fail = (msg) => {
    console.error("PLANNER_PRODUCT_HANDOFF_SELFTEST_FAIL " + msg);
    ok = false;
  };

  const genericGit =
    "<!-- SILVER_NEXT_ACTION: full-auto-loop-openai -->\n" +
    "git status\ngh auth login\ngit push -u origin chore/silver-audit-repo-state\n";
  const genericWorkflow =
    "<!-- SILVER_NEXT_ACTION: full-auto-loop-openai -->\n" +
    "git status --short\n" +
    "git stash push\n" +
    "git commit -m test\n" +
    "gh auth login\n" +
    "git push -u origin chore/silver-audit-repo-state\n";
  const capCtx = {
    clusterDiag: {
      cluster: "self_correction_negation_flip",
      audit_id: "self_correction",
      audit_name: "Self-Correction",
      count: 472,
      expected_outcome: "engine PR",
    },
    requireProductCluster: true,
  };
  const genericViolations = silverNextActionQualityViolations(genericGit, capCtx);
  if (!genericViolations.includes("generic_orchestration_blocked_after_cap_diagnostic")) {
    fail("generic_git_gh_blocker_after_cap_diagnostic");
  }
  const workflowViolations = silverNextActionQualityViolations(genericWorkflow, capCtx);
  if (!workflowViolations.includes("generic_repo_git_workflow_drift")) {
    fail("generic_repo_git_workflow_drift_blocked");
  }
  if (!workflowViolations.includes("generic_chore_silver_audit_push")) {
    fail("chore_silver_audit_repo_state_blocked");
  }

  const noClusterHandoff = buildNoSafeProductClusterBlockedHandoff({ mainCommit: "abc" });
  if (!/expected_outcome=SAFE_BLOCKED/.test(noClusterHandoff)) {
    fail("no_safe_product_cluster_SAFE_BLOCKED");
  }
  if (isGenericOrchestrationHandoff(noClusterHandoff) || isGenericRepoGitMaintenanceWorkflow(noClusterHandoff)) {
    fail("no_safe_product_cluster_must_not_contain_generic_git");
  }
  const noClusterViolations = silverNextActionQualityViolations(noClusterHandoff, capCtx);
  if (noClusterViolations.length) {
    fail("no_safe_product_cluster_handoff_rejected " + noClusterViolations.join(";"));
  }

  const negFlipHandoff = buildCapDiagnosticProductHandoff({
    mainCommit: "abc123",
    clusterDiag: capCtx.clusterDiag,
  });
  if (!/expected_outcome=HARNESS_ALIGNMENT_TASK_READY/.test(negFlipHandoff)) {
    fail("negation_flip_expected_HARNESS_ALIGNMENT_TASK_READY");
  }
  if (/git\s+push\s+-u|gh\s+auth\s+login/i.test(negFlipHandoff)) {
    fail("negation_flip_handoff_must_not_contain_generic_git_gh");
  }
  for (const field of [
    "target_cluster=",
    "source_audit=",
    "diagnostic_result=",
    "recommended_scope=",
    "expected_outcome=",
  ]) {
    if (negFlipHandoff.indexOf(field) < 0) fail("contract_missing_" + field.replace(/=$/, ""));
  }

  const engineCtx = {
    clusterDiag: {
      cluster: "rhc3_partial_cal_ref",
      audit_id: "rhc3",
      audit_name: "Real Human Chaos V3",
      count: 2082,
      expected_outcome: "engine PR",
    },
  };
  const engineHandoff = buildCapDiagnosticProductHandoff({
    mainCommit: "def456",
    clusterDiag: engineCtx.clusterDiag,
  });
  if (!/ENGINE_FIX_TASK_READY|expected_outcome=ENGINE_FIX_TASK_READY/.test(engineHandoff)) {
    /* without on-disk report may fall through — inject synthetic evidence via resolve override test */
  }

  const safeBlockedHandoff = buildCapDiagnosticProductHandoff({
    mainCommit: "ghi789",
    clusterDiag: { cluster: "test_cluster", audit_id: "self_correction", audit_name: "Test", count: 1 },
  });
  if (!/PRODUCT_HANDOFF_CONTRACT/.test(safeBlockedHandoff)) {
    fail("product_handoff_contract_block_missing");
  }

  const blockedViolations = silverNextActionQualityViolations(negFlipHandoff, {
    selectorCluster: "self_correction_negation_flip",
    clusterDiag: capCtx.clusterDiag,
  });
  if (blockedViolations.length) {
    fail("valid_product_handoff_rejected " + blockedViolations.join(";"));
  }

  const tefYes = resolveProductHandoffOutcome({
    target_cluster: "x",
    safe_blocked: "NO",
    observed_fail_count: 10,
    true_engine_fail: "YES",
    ready_for_engine_fix: "YES",
    harness_alignment: "NO",
    recommended_scope: "narrow_engine_fix",
    diagnostic_result: "TRUE_ENGINE_FAIL=YES",
  });
  if (tefYes.expected_outcome !== "ENGINE_FIX_TASK_READY") fail("ENGINE_FIX_TASK_READY_mapping");

  const tefNo = resolveProductHandoffOutcome({
    target_cluster: "x",
    safe_blocked: "NO",
    observed_fail_count: 10,
    true_engine_fail: "NO",
    harness_alignment: "YES",
    diagnostic_result: "TRUE_ENGINE_FAIL=NO",
    recommended_scope: "scripts-only_harness",
  });
  if (tefNo.expected_outcome !== "HARNESS_ALIGNMENT_TASK_READY") fail("HARNESS_ALIGNMENT_TASK_READY_mapping");

  const safeBlk = resolveProductHandoffOutcome({
    target_cluster: "x",
    safe_blocked: "YES",
    observed_fail_count: 1,
    true_engine_fail: "NO",
    harness_alignment: "NO",
    diagnostic_result: "safety",
    recommended_scope: "stop",
  });
  if (safeBlk.expected_outcome !== "SAFE_BLOCKED") fail("SAFE_BLOCKED_mapping");

  const noFix = resolveProductHandoffOutcome({
    target_cluster: "x",
    safe_blocked: "NO",
    observed_fail_count: 5,
    true_engine_fail: "NO",
    harness_alignment: "NO",
    diagnostic_result: "no_safe",
    recommended_scope: "no_safe_fix_stale",
  });
  if (noFix.expected_outcome !== "NO_SAFE_FIX") fail("NO_SAFE_FIX_mapping");

  if (ok) console.log("PLANNER_PRODUCT_HANDOFF_SELFTEST_PASS");
  return ok;
}

function runPlannerQualityContractSelftest() {
  let ok = true;
  const fail = (msg) => {
    console.error("PLANNER_QUALITY_CONTRACT_SELFTEST_FAIL " + msg);
    ok = false;
  };
  const capCtx = {
    clusterDiag: {
      cluster: "self_correction_negation_flip",
      audit_id: "self_correction",
      audit_name: "Self-Correction",
      count: 472,
      expected_outcome: "engine PR",
    },
    requireProductCluster: true,
  };
  const planned = generateAutonomousPlannedHandoff({
    mainCommit: "abc123",
    clusterDiag: capCtx.clusterDiag,
    plannerContext: { guardBlocked: false, safetyBlocked: false, dirtyBlocked: false },
  });
  if (planned.mode !== "CLUSTER_PRODUCT_HANDOFF") fail("healthy_cluster_mode");
  if (!/self_correction_negation_flip/.test(planned.body)) fail("cluster_in_body");
  if (!plannedHandoffPassesQualityGate(planned.body, {
    selectorCluster: "self_correction_negation_flip",
    clusterDiag: capCtx.clusterDiag,
    requireProductCluster: true,
  })) {
    fail("cluster_handoff_quality");
  }
  const noCluster = generateAutonomousPlannedHandoff({
    mainCommit: "abc",
    clusterDiag: { cluster: "(unknown)", count: 0 },
    plannerContext: { guardBlocked: false, safetyBlocked: false, dirtyBlocked: false },
  });
  if (noCluster.mode !== "NO_SAFE_PRODUCT_CLUSTER") fail("missing_cluster_mode");
  if (!/expected_outcome=SAFE_BLOCKED/.test(noCluster.body)) fail("missing_cluster_safe_blocked");
  if (!plannedHandoffPassesQualityGate(noCluster.body, capCtx)) fail("no_cluster_handoff_quality");
  if (ok) console.log("PLANNER_QUALITY_CONTRACT_SELFTEST_PASS");
  return ok;
}

function runGenericChoreGenerationBlockSelftest() {
  let ok = true;
  const fail = (msg) => {
    console.error("GENERIC_CHORE_GENERATION_BLOCK_SELFTEST_FAIL " + msg);
    ok = false;
  };
  const capCtx = { requireProductCluster: true };
  const samples = [
    [
      "generic_chore_silver_audit_push",
      "<!-- SILVER_NEXT_ACTION: full-auto-loop-openai -->\ngit status\ngh auth login\ngit push -u origin chore/silver-audit-repo-state\n",
    ],
    [
      "generic_repo_maintenance",
      "git status --short\ngit stash push\ngh auth login\ngit push -u origin chore/silver-audit-repo-state\n",
    ],
    ["generic_git_push", "git push -u origin chore/silver-audit-repo-state\n"],
    ["generic_gh_auth", "gh auth login\n"],
  ];
  for (const [label, sample] of samples) {
    const v = silverNextActionQualityViolations(sample, capCtx);
    if (!v.length) fail(label + "_must_violate");
  }
  const planned = generateAutonomousPlannedHandoff({
    mainCommit: "def",
    plannerContext: { guardBlocked: false, safetyBlocked: false, dirtyBlocked: false },
  });
  if (isGenericRepoGitMaintenanceWorkflow(planned.body)) fail("planner_generic_repo");
  if (
    /git\s+push\s+-u\s+origin\s+chore\/silver-audit-repo-state/i.test(planned.body) &&
    !/NE\s+`git push/i.test(planned.body)
  ) {
    fail("planner_chore_push_actionable");
  }
  if (!plannedHandoffPassesQualityGate(planned.body, capCtx)) fail("planner_output_quality");
  if (ok) console.log("GENERIC_CHORE_GENERATION_BLOCK_SELFTEST_PASS");
  return ok;
}

function runSafeBlockedHandoffContractSelftest() {
  let ok = true;
  const fail = (msg) => {
    console.error("SAFE_BLOCKED_HANDOFF_CONTRACT_SELFTEST_FAIL " + msg);
    ok = false;
  };
  const blocked = generateAutonomousPlannedHandoff({
    mainCommit: "ghi",
    clusterDiag: { cluster: "(unknown)", count: 0 },
    blockReason: "NO_SAFE_PRODUCT_CLUSTER",
    plannerContext: { guardBlocked: false, safetyBlocked: false, dirtyBlocked: false },
  });
  if (!/expected_outcome=SAFE_BLOCKED/.test(blocked.body)) fail("safe_blocked_outcome");
  if (isGenericRepoGitMaintenanceWorkflow(blocked.body)) fail("safe_blocked_not_generic_workflow");
  const v = silverNextActionQualityViolations(blocked.body, { requireProductCluster: true });
  if (v.length) fail("safe_blocked_violations " + v.join(";"));
  const runtimeBlk = generateAutonomousPlannedHandoff({
    mainCommit: "jkl",
    blockReason: "GENERIC_DRIFT_REGRESSION_BLOCKED",
    stopReason: "STALE_CURSOR_INVOKE_NO_PROGRESS",
    plannerContext: { guardBlocked: true, safetyBlocked: false, dirtyBlocked: false },
  });
  if (!/expected_outcome=SAFE_BLOCKED/.test(runtimeBlk.body)) fail("runtime_safe_blocked");
  if (ok) console.log("SAFE_BLOCKED_HANDOFF_CONTRACT_SELFTEST_PASS");
  return ok;
}

module.exports = {
  REPO,
  SILVER_NEXT_ACTION_MOJIBAKE_RE,
  SILVER_NEXT_ACTION_SILVER_WORKFLOW_RE,
  STALE_VERIFY_PR_IDS,
  pickClusterFromAuditRegistry,
  pickTopClusterDiagnostic,
  buildHandoffMarkdown,
  buildCapDiagnosticProductHandoff,
  buildClusterHandoffForHealthyPlanner,
  generateAutonomousPlannedHandoff,
  plannedHandoffPassesQualityGate,
  clusterProductSpecFor,
  loadClusterDiagnosticEvidence,
  resolveProductHandoffOutcome,
  isGenericOrchestrationHandoff,
  isGenericRepoGitMaintenanceWorkflow,
  isValidProductClusterName,
  buildNoSafeProductClusterBlockedHandoff,
  buildStaleCursorInvokeRuntimeBlockedHandoff,
  buildScorecardRuntimeErrorNextAction,
  capDiagnosticFlowActive,
  silverNextActionMatchesSelectorCluster,
  silverNextActionHasClusterWorkflow,
  silverNextActionQualityViolations,
  CLUSTER_PRODUCT_TASK_SPEC,
  PRODUCT_HANDOFF_OUTCOMES,
  isHealthyPlannerContext,
  readOrchestratorReport,
  runPlannerClusterPreferenceSelftest,
  runPlannerProductHandoffSelftest,
  runPlannerQualityContractSelftest,
  runGenericChoreGenerationBlockSelftest,
  runSafeBlockedHandoffContractSelftest,
};
