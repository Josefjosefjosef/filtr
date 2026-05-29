#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const p0Shared = require("./silver-p0-real-user-basics-shared-v1.cjs");
const chaosShared = require("./silver-public-readiness-chaos-100k-v1-shared.cjs");
const convShared = require("./silver-conversational-ownership-v1-shared.cjs");
const contShared = require("./silver-conversational-continuation-ownership-v1-shared.cjs");

const REPO = path.resolve(__dirname, "..");
const REPORT = path.join(__dirname, "silver-public-beta-candidate-report.json");

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function readJsonIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {}
  return null;
}

function aggregateCounters(reports) {
  const out = {
    true_engine_fails: 0,
    ownership_drifts: 0,
    read_create_leaks: 0,
    retrieval_fails: 0,
    note_relevance_fails: 0,
    safety_fails: 0
  };
  for (let i = 0; i < reports.length; i++) {
    const r = reports[i];
    if (!r) continue;
    const c = r.counters || r.classification || {};
    out.true_engine_fails += c.true_engine_fail_count || 0;
    out.ownership_drifts +=
      (c.module_ownership_fail_count || 0) +
      (c.module_steal_count || 0) +
      (c.task_steal_count || 0) +
      (c.note_steal_count || 0) +
      (c.calendar_steal_count || 0);
    out.read_create_leaks +=
      (c.read_create_leak_count || 0) +
      (c.read_created_write_count || 0) +
      (c.read_to_create_leak_count || 0);
    out.retrieval_fails += c.retrieval_relevance_fail_count || 0;
    out.note_relevance_fails += c.note_relevance_fail_count || 0;
    out.safety_fails +=
      (c.safety_risk_count || 0) +
      (c.dangerous_write_count || 0) +
      (c.query_created_write_count || 0) +
      (c.write_when_negated_count || 0);
  }
  return out;
}

function classifyTopFailFamily(aggregated, chaosReport, p0Report) {
  const families = []
    .concat(chaosReport && chaosReport.top_fail_families ? chaosReport.top_fail_families : [])
    .concat(p0Report && p0Report.top_fail_families ? p0Report.top_fail_families : []);
  if (families.length > 0) return families[0];
  if (aggregated.true_engine_fails > 0) return "true_engine_fail_unclassified";
  return "none";
}

function runNluEvaluation() {
  const screenshotSeeds = p0Shared.SCREENSHOT_SEEDS.slice();
  const p0Diag = p0Shared.runP0Audit(screenshotSeeds, null);
  const metamorphicSample = p0Shared.buildP0Corpus().slice(0, 500);
  const metamorphic = p0Shared.runP0Audit(metamorphicSample, null);
  const dialogSample = p0Shared.buildP0Corpus().filter(function (c) {
    return c.lane === "TURN_BY_TURN_BASIC_DIALOGS";
  }).slice(0, 300);
  const dialog = p0Shared.runP0Audit(dialogSample.length ? dialogSample : screenshotSeeds, null);
  const chaosSample = chaosShared.buildFullCorpus(200);
  const chaos = chaosShared.runPublicReadinessAudit(chaosSample, null);
  const conv = convShared.runAudit("public_beta_conv_ownership_probe", convShared.buildCorpusV1(200), null, {});
  const cont = contShared.runAudit("public_beta_continuation_probe", contShared.buildCorpusV1(500), null, {});

  return {
    property_based: {
      total: metamorphic.total_cases,
      pass: metamorphic.pass,
      fail: metamorphic.fail,
      accuracy: metamorphic.overall_accuracy
    },
    metamorphic: {
      families_fail: metamorphic.metamorphic_families_fail || [],
      pass_all: (metamorphic.metamorphic_families_fail || []).length === 0
    },
    turn_by_turn: {
      total: dialog.total_cases,
      pass: dialog.pass,
      fail: dialog.fail,
      accuracy: dialog.overall_accuracy
    },
    nlu_axes: {
      intent: { pass: chaos.pass, total: chaos.total_cases, accuracy: chaos.overall_accuracy },
      module: { module_steal: chaos.counters.module_steal_count || 0 },
      action: { query_created_write: chaos.counters.query_created_write_count || 0 },
      slot: { fragment_reuse_fail: chaos.counters.fragment_reuse_fail_count || 0 },
      retrieval: { relevance_fail: (p0Diag.counters.retrieval_relevance_fail_count || 0) + (metamorphic.counters.retrieval_relevance_fail_count || 0) },
      ownership: {
        conv_pass: conv.report.pass,
        conv_total: conv.report.total,
        cont_pass: cont.report.pass,
        cont_total: cont.report.total
      },
      safety: {
        dangerous_write: chaos.counters.dangerous_write_count || 0,
        negated_write: chaos.counters.write_when_negated_count || 0
      }
    },
    screenshot_seeds: {
      total: p0Diag.total_cases,
      pass: p0Diag.pass,
      fail: p0Diag.fail
    }
  };
}

function main() {
  const mainCommitHash = mainCommit();
  const reportPaths = [
    path.join(__dirname, "silver-public-readiness-chaos-100k-v1-report.json"),
    path.join(__dirname, "silver-p0-real-user-basics-guard-v1-report.json"),
    path.join(__dirname, "silver-p0-real-user-basics-diagnostic-v1-report.json"),
    path.join(__dirname, "silver-conversational-ownership-guard-v1-report.json"),
    path.join(__dirname, "silver-conversational-continuation-ownership-guard-v1-report.json"),
    path.join(__dirname, "silver-read-create-firewall-v1-report.json"),
    path.join(__dirname, "silver-long-session-firewall-v1-report.json"),
    path.join(__dirname, "silver-mobile-voice-chaos-guard-v1-report.json")
  ];
  const loaded = reportPaths.map(readJsonIfExists);
  const aggregated = aggregateCounters(loaded);
  const chaosReport = loaded[0];
  const p0Report = loaded[1];
  const evaluation = runNluEvaluation();
  const topFamily = classifyTopFailFamily(aggregated, chaosReport, p0Report);

  const safetyOk = aggregated.safety_fails === 0;
  const engineOk = aggregated.true_engine_fails === 0;
  const ownershipOk = aggregated.ownership_drifts === 0;
  const leakOk = aggregated.read_create_leaks === 0;
  const retrievalOk = aggregated.retrieval_fails === 0;
  const noteOk = aggregated.note_relevance_fails === 0;
  const probesOk =
    evaluation.screenshot_seeds.fail === 0 &&
    evaluation.metamorphic.pass_all &&
    evaluation.nlu_axes.ownership.conv_pass === evaluation.nlu_axes.ownership.conv_total &&
    evaluation.nlu_axes.ownership.cont_pass === evaluation.nlu_axes.ownership.cont_total;

  const publicBetaCandidate = safetyOk && engineOk && ownershipOk && leakOk && retrievalOk && noteOk && probesOk;

  const report = {
    harness_id: "silver_public_beta_candidate_audit_v1",
    main_commit: mainCommitHash,
    generated_at: new Date().toISOString(),
    methods: [
      "property_based_testing",
      "metamorphic_testing",
      "turn_by_turn_dialog_testing",
      "nlu_evaluation_intent_module_action_slot_retrieval_ownership_safety"
    ],
    aggregated,
    evaluation,
    top_true_engine_fail_family: topFamily,
    public_beta_candidate: publicBetaCandidate ? "YES" : "NO",
    audit_pass: publicBetaCandidate,
    next_top_roi_cluster: {
      cluster: topFamily,
      count: aggregated.true_engine_fails,
      root_cause: topFamily === "none" ? "all_gates_green_no_true_engine_fail" : topFamily,
      safe_to_fix: topFamily === "none" ? "NO" : "YES",
      recommended_scope: topFamily === "none" ? "none" : "narrow_engine_fix",
      engine_or_harness: topFamily === "none" ? "none" : "engine",
      expected_roi: topFamily === "none" ? "0" : "high"
    },
    source_reports: reportPaths.map(function (p) {
      return path.basename(p);
    })
  };

  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_PUBLIC_BETA_CANDIDATE_AUDIT_V1 ===");
  console.log("main_commit=" + report.main_commit);
  console.log("public_beta_candidate=" + report.public_beta_candidate);
  console.log("true_engine_fails=" + aggregated.true_engine_fails);
  console.log("ownership_drifts=" + aggregated.ownership_drifts);
  console.log("read_create_leaks=" + aggregated.read_create_leaks);
  console.log("retrieval_fails=" + aggregated.retrieval_fails);
  console.log("note_relevance_fails=" + aggregated.note_relevance_fails);
  console.log("safety_fails=" + aggregated.safety_fails);
  console.log("screenshot_seeds=" + evaluation.screenshot_seeds.pass + "/" + evaluation.screenshot_seeds.total);
  console.log("metamorphic_pass_all=" + (evaluation.metamorphic.pass_all ? "YES" : "NO"));
  console.log("continuation_probe=" + evaluation.nlu_axes.ownership.cont_pass + "/" + evaluation.nlu_axes.ownership.cont_total);
  console.log("conversational_probe=" + evaluation.nlu_axes.ownership.conv_pass + "/" + evaluation.nlu_axes.ownership.conv_total);
  console.log("top_true_engine_fail_family=" + topFamily);
  console.log("PASS_FAIL=" + (publicBetaCandidate ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_PUBLIC_BETA_CANDIDATE_AUDIT_V1 ===");

  process.exit(publicBetaCandidate ? 0 : 1);
}

if (require.main === module) main();
