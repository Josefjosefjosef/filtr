#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-real-user-search-read-screenshot-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-real-user-search-read-screenshot-report.json");
const TOTAL = parseInt(process.env.SILVER_REAL_USER_SEARCH_READ_CASES || "0", 10);

function main() {
  const cases = TOTAL > 0 ? shared.buildScreenshotCorpus(TOTAL) : shared.buildScreenshotCorpus();
  const report = shared.runScreenshotAudit(cases, REPORT);
  const c = report.counters;
  const screenshotOk = parseFloat(report.screenshot_seed_family_pass) >= 100;
  const p0Ok =
    (c.task_search_to_create_leak_count || 0) === 0 &&
    (c.note_query_wrong_module_count || 0) === 0 &&
    (c.calendar_metamorphic_fail_count || 0) === 0 &&
    (c.direct_fact_disambiguation_count || 0) === 0;
  const safetyOk = (c.safety_risk_count || 0) === 0;
  const metaOk = (report.metamorphic_families_fail || []).filter(function (k) {
    return k === "TOMORROW_AGENDA";
  }).length === 0;
  const ok = screenshotOk && p0Ok && safetyOk && metaOk;

  console.log("=== SILVER_REAL_USER_SEARCH_READ_SCREENSHOT_V1 ===");
  console.log("total_cases=" + report.total_cases);
  console.log("pass=" + report.pass);
  console.log("fail=" + report.fail);
  console.log("overall_accuracy=" + report.overall_accuracy);
  console.log("screenshot_seed_family_pass=" + report.screenshot_seed_family_pass);
  console.log("task_search_to_create_leak_count=" + (c.task_search_to_create_leak_count || 0));
  console.log("note_query_wrong_module_count=" + (c.note_query_wrong_module_count || 0));
  console.log("calendar_metamorphic_fail_count=" + (c.calendar_metamorphic_fail_count || 0));
  console.log("direct_fact_disambiguation_count=" + (c.direct_fact_disambiguation_count || 0));
  console.log("retrieval_miss_count=" + (c.retrieval_miss_count || 0));
  console.log("notes_overbroad_fallback_count=" + (c.notes_overbroad_fallback_count || 0));
  console.log("tasks_overbroad_fallback_count=" + (c.tasks_overbroad_fallback_count || 0));
  console.log("structured_extraction_fail_count=" + (c.structured_extraction_fail_count || 0));
  console.log("safety_risk_count=" + (c.safety_risk_count || 0));
  console.log("metamorphic_families_fail=" + (report.metamorphic_families_fail || []).join("|"));
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_REAL_USER_SEARCH_READ_SCREENSHOT_V1 ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
