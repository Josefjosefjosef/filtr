#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-public-readiness-chaos-100k-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_UX_EDGE_CHAOS_CASES || "10000", 10);
const REPORT = path.join(__dirname, "silver-ux-edge-case-chaos-guard-v1-report.json");

function main() {
  const cases = shared.buildLaneCorpus("ux_edge_cases", TARGET);
  const report = shared.runPublicReadinessAudit(cases, REPORT);
  console.log("=== SILVER_UX_EDGE_CASE_CHAOS_V1 ===");
  console.log("accuracy=" + report.overall_accuracy);
  console.log("total=" + report.total_cases);
  console.log("dangerous_write_count=" + (report.counters.dangerous_write_count || 0));
  console.log("PASS_FAIL=" + (report.counters.dangerous_write_count === 0 ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_UX_EDGE_CASE_CHAOS_V1 ===");
  process.exit(report.counters.dangerous_write_count === 0 ? 0 : 1);
}

if (require.main === module) main();
