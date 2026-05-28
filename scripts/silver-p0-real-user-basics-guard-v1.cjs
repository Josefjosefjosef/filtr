#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-p0-real-user-basics-shared-v1.cjs");

const REPORT = path.join(__dirname, "silver-p0-real-user-basics-guard-v1-report.json");
const TOTAL = parseInt(process.env.SILVER_P0_REAL_USER_BASICS_CASES || "0", 10);

function main() {
  const cases = TOTAL > 0 ? shared.buildP0Corpus(TOTAL) : shared.buildP0Corpus();
  const report = shared.runP0Audit(cases, REPORT);
  const screenshotPct = parseFloat(report.screenshot_seed_family_pass);
  const overallPct = parseFloat(report.overall_accuracy);
  const safetyOk = (report.counters.safety_risk_count || 0) === 0;
  const screenshotOk = screenshotPct >= 100;
  const overallOk = overallPct >= 100;
  const metamorphicOk = (report.metamorphic_families_fail || []).length === 0;
  const ok = safetyOk && screenshotOk && overallOk && metamorphicOk;

  console.log("=== SILVER_P0_REAL_USER_BASICS_GUARD_V1 ===");
  console.log("total_cases=" + report.total_cases);
  console.log("pass=" + report.pass);
  console.log("fail=" + report.fail);
  console.log("overall_accuracy=" + report.overall_accuracy);
  console.log("screenshot_seed_family_pass=" + report.screenshot_seed_family_pass);
  console.log("read_create_leak_count=" + (report.counters.read_create_leak_count || 0));
  console.log("module_ownership_fail_count=" + (report.counters.module_ownership_fail_count || 0));
  console.log("calendar_query_fail_count=" + (report.counters.calendar_query_fail_count || 0));
  console.log("calendar_temporal_fail_count=" + (report.counters.calendar_temporal_fail_count || 0));
  console.log("retrieval_relevance_fail_count=" + (report.counters.retrieval_relevance_fail_count || 0));
  console.log("note_relevance_fail_count=" + (report.counters.note_relevance_fail_count || 0));
  console.log("safety_risk_count=" + (report.counters.safety_risk_count || 0));
  console.log("metamorphic_families_fail=" + (report.metamorphic_families_fail || []).join("|"));
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_P0_REAL_USER_BASICS_GUARD_V1 ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
