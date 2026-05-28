#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-public-readiness-chaos-100k-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-mobile-voice-chaos-diagnostic-v1-report.json");
const SAMPLE = parseInt(process.env.SILVER_MOBILE_VOICE_DIAG_SAMPLE || "500", 10);

function main() {
  const cases = shared.buildLaneCorpus("mobile_voice", SAMPLE);
  const report = shared.runPublicReadinessAudit(cases, REPORT);
  console.log("=== SILVER_MOBILE_VOICE_CHAOS_DIAGNOSTIC_V1 ===");
  console.log("sample_cases=" + report.total_cases);
  console.log("overall_accuracy=" + report.overall_accuracy);
  console.log("true_engine_fail_count=" + report.classification.true_engine_fail_count);
  console.log("harness_or_gold_count=" + report.classification.harness_or_gold_count);
  console.log("ambiguous_input_count=" + report.classification.ambiguous_input_count);
  console.log("report_file=" + REPORT);
  console.log("=== END_SILVER_MOBILE_VOICE_CHAOS_DIAGNOSTIC_V1 ===");
  process.exit(0);
}

if (require.main === module) main();
