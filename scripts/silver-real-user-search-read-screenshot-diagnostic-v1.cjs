#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-real-user-search-read-screenshot-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-real-user-search-read-screenshot-report.json");
const SAMPLE = parseInt(process.env.SILVER_REAL_USER_SEARCH_READ_DIAG_SAMPLE || "0", 10);

function main() {
  const cases = SAMPLE > 0 ? shared.buildScreenshotCorpus(SAMPLE) : shared.buildScreenshotCorpus();
  const report = shared.runScreenshotAudit(cases, REPORT);
  const c = report.counters;
  const top = report.top_fail_families || [];

  console.log("=== SILVER_REAL_USER_SEARCH_READ_SCREENSHOT_DIAGNOSTIC_V1 ===");
  console.log("total_cases=" + report.total_cases);
  console.log("pass=" + report.pass);
  console.log("fail=" + report.fail);
  console.log("overall_accuracy=" + report.overall_accuracy);
  console.log("");
  console.log("P0_COUNTS=");
  console.log("task_search_to_create_leak_count=" + (c.task_search_to_create_leak_count || 0));
  console.log("note_query_wrong_module_count=" + (c.note_query_wrong_module_count || 0));
  console.log("calendar_metamorphic_fail_count=" + (c.calendar_metamorphic_fail_count || 0));
  console.log("direct_fact_disambiguation_count=" + (c.direct_fact_disambiguation_count || 0));
  console.log("retrieval_miss_count=" + (c.retrieval_miss_count || 0));
  console.log("");
  console.log("P1_COUNTS=");
  console.log("notes_overbroad_fallback_count=" + (c.notes_overbroad_fallback_count || 0));
  console.log("tasks_overbroad_fallback_count=" + (c.tasks_overbroad_fallback_count || 0));
  console.log("structured_extraction_fail_count=" + (c.structured_extraction_fail_count || 0));
  console.log("person_entity_filter_fail_count=" + (c.person_entity_filter_fail_count || 0));
  console.log("object_property_filter_fail_count=" + (c.object_property_filter_fail_count || 0));
  console.log("ranking_order_fail_count=" + (c.ranking_order_fail_count || 0));
  console.log("");
  console.log("MODULE_COUNTS=");
  console.log("notes_read_pass=" + (c.notes_read_pass || 0));
  console.log("notes_read_fail=" + (c.notes_read_fail || 0));
  console.log("tasks_read_pass=" + (c.tasks_read_pass || 0));
  console.log("tasks_read_fail=" + (c.tasks_read_fail || 0));
  console.log("calendar_read_pass=" + (c.calendar_read_pass || 0));
  console.log("calendar_read_fail=" + (c.calendar_read_fail || 0));
  console.log("");
  console.log("FAIL_FAMILIES_TOP=");
  for (let i = 0; i < 5; i++) {
    console.log(i + 1 + "=" + (top[i] || "none"));
  }
  console.log("");
  console.log("TRUE_ENGINE_FAIL_COUNT=" + (c.true_engine_fail_count || 0));
  console.log("HARNESS_OR_GOLD_COUNT=" + (c.harness_or_gold_count || 0));
  console.log("SAFE_CLARIFICATION_OK_COUNT=" + (c.safe_clarification_ok_count || 0));
  console.log("TEMPLATE_DNA_PROBLEM_COUNT=" + (c.template_dna_problem_count || 0));
  console.log("SAFETY_RISK_COUNT=" + (c.safety_risk_count || 0));
  console.log("");
  console.log("recommended_fix_order=" + (report.recommended_fix_order || []).join(" > "));
  console.log("safe_to_fix=" + report.safe_to_fix);
  console.log("stop_reason=" + (report.stop_reason || ""));
  console.log("=== END_SILVER_REAL_USER_SEARCH_READ_SCREENSHOT_DIAGNOSTIC_V1 ===");
  process.exit(0);
}

if (require.main === module) main();
