#!/usr/bin/env node
"use strict";

const shared = require("./silver-real-user-search-read-screenshot-v1-shared.cjs");

function main() {
  const all = shared.buildScreenshotCorpus();
  const cases = all.filter(function (c) {
    return c.lane === "STRUCTURED_EXTRACTION" || c.family === "notes_structured_money_person_amount_extraction";
  });
  const report = shared.runScreenshotAudit(cases, null);
  const c = report.counters;
  const ok = (c.structured_extraction_fail_count || 0) === 0 && (c.safety_risk_count || 0) === 0;

  console.log("=== SILVER_STRUCTURED_NOTES_EXTRACTION_GUARD_V1 ===");
  console.log("total_cases=" + report.total_cases);
  console.log("pass=" + report.pass);
  console.log("fail=" + report.fail);
  console.log("structured_extraction_fail_count=" + (c.structured_extraction_fail_count || 0));
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_STRUCTURED_NOTES_EXTRACTION_GUARD_V1 ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
