#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-p0-real-user-basics-shared-v1.cjs");

const REPORT = path.join(__dirname, "silver-p0-real-user-basics-diagnostic-v1-report.json");
const SAMPLE = parseInt(process.env.SILVER_P0_DIAG_SAMPLE || "0", 10);

function main() {
  const cases = SAMPLE > 0 ? shared.buildP0Corpus(SAMPLE) : shared.SCREENSHOT_SEEDS.slice();
  const report = shared.runP0Audit(cases, REPORT);
  const topClusters = report.top_20_fail_clusters || [];

  console.log("=== SILVER_P0_REAL_USER_BASICS_DIAGNOSTIC_V1 ===");
  console.log("total_cases=" + report.total_cases);
  console.log("pass=" + report.pass);
  console.log("fail=" + report.fail);
  console.log("overall_accuracy=" + report.overall_accuracy);
  console.log("read_create_leak_count=" + (report.counters.read_create_leak_count || 0));
  console.log("module_ownership_fail_count=" + (report.counters.module_ownership_fail_count || 0));
  console.log("calendar_query_fail_count=" + (report.counters.calendar_query_fail_count || 0));
  console.log("calendar_temporal_fail_count=" + (report.counters.calendar_temporal_fail_count || 0));
  console.log("retrieval_relevance_fail_count=" + (report.counters.retrieval_relevance_fail_count || 0));
  console.log("note_relevance_fail_count=" + (report.counters.note_relevance_fail_count || 0));
  console.log("task_steal_count=" + (report.counters.task_steal_count || 0));
  console.log("note_steal_count=" + (report.counters.note_steal_count || 0));
  console.log("calendar_steal_count=" + (report.counters.calendar_steal_count || 0));
  console.log("firewall_overblock_count=" + (report.counters.firewall_overblock_count || 0));
  console.log("true_engine_fail_count=" + (report.counters.true_engine_fail_count || 0));
  console.log("harness_or_gold_count=" + (report.counters.harness_or_gold_count || 0));
  console.log("ambiguous_input_count=" + (report.counters.ambiguous_input_count || 0));
  console.log("safe_clarification_ok_count=" + (report.counters.safe_clarification_ok_count || 0));
  console.log("template_dna_problem_count=" + (report.counters.template_dna_problem_count || 0));
  console.log("safety_risk_count=" + (report.counters.safety_risk_count || 0));
  console.log("top_fail_families=" + (report.top_fail_families || []).join("|"));
  console.log("top_20_fail_clusters=" + topClusters.join("|"));
  console.log("sample_failures=" + JSON.stringify(report.sample_failures || []));
  console.log("recommended_next_fix=" + ((report.top_fail_families || [])[0] || "none"));
  console.log("safe_to_fix=" + ((report.counters.safety_risk_count || 0) === 0 ? "YES" : "NO"));
  console.log("stop_reason=" + ((report.counters.safety_risk_count || 0) > 0 ? "safety_risk" : ""));
  console.log("=== END_SILVER_P0_REAL_USER_BASICS_DIAGNOSTIC_V1 ===");
  process.exit(0);
}

if (require.main === module) main();
