#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-public-readiness-chaos-100k-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-public-readiness-chaos-100k-v1-report.json");
const TARGET = parseInt(process.env.SILVER_PUBLIC_READINESS_CHAOS_CASES || "0", 10);

function main() {
  const cases = TARGET > 0 ? shared.buildFullCorpus(TARGET) : shared.buildFullCorpus();
  const report = shared.runPublicReadinessAudit(cases, REPORT);
  shared.printPublicReport(report);
  const c = report.counters || {};
  const p0Ok = report.p0_real_user_basics_lane_pass !== false;
  const ok =
    c.dangerous_write_count === 0 &&
    c.query_created_write_count === 0 &&
    c.write_when_negated_count === 0 &&
    parseFloat(report.overall_accuracy) >= 95 &&
    p0Ok;
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
