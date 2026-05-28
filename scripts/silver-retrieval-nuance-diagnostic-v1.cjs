#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-public-readiness-chaos-100k-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-retrieval-nuance-diagnostic-v1-report.json");
const SAMPLE = parseInt(process.env.SILVER_RETRIEVAL_NUANCE_DIAG_SAMPLE || "500", 10);

function main() {
  const cases = shared.buildLaneCorpus("retrieval_nuance", SAMPLE);
  const report = shared.runPublicReadinessAudit(cases, REPORT);
  console.log("=== SILVER_RETRIEVAL_NUANCE_DIAGNOSTIC_V1 ===");
  console.log("sample_cases=" + report.total_cases);
  console.log("overall_accuracy=" + report.overall_accuracy);
  console.log("true_engine_fail_count=" + report.classification.true_engine_fail_count);
  console.log("top_fail_families=" + (report.top_fail_families || []).join("|"));
  console.log("report_file=" + REPORT);
  console.log("=== END_SILVER_RETRIEVAL_NUANCE_DIAGNOSTIC_V1 ===");
  process.exit(0);
}

if (require.main === module) main();
