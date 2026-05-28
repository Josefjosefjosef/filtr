#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-public-readiness-chaos-100k-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-ux-edge-case-diagnostic-v1-report.json");
const SAMPLE = parseInt(process.env.SILVER_UX_EDGE_DIAG_SAMPLE || "500", 10);

function main() {
  const cases = shared.buildLaneCorpus("ux_edge_cases", SAMPLE);
  const report = shared.runPublicReadinessAudit(cases, REPORT);
  console.log("=== SILVER_UX_EDGE_CASE_DIAGNOSTIC_V1 ===");
  console.log("sample_cases=" + report.total_cases);
  console.log("overall_accuracy=" + report.overall_accuracy);
  console.log("true_engine_fail_count=" + report.classification.true_engine_fail_count);
  console.log("report_file=" + REPORT);
  console.log("=== END_SILVER_UX_EDGE_CASE_DIAGNOSTIC_V1 ===");
  process.exit(0);
}

if (require.main === module) main();
