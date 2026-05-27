#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-conversational-product-understanding-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_CAPABILITY_HELP_CASES || "4000", 10);
const MIN_PCT = parseFloat(process.env.SILVER_CAPABILITY_HELP_MIN_PCT || "99", 10);
const REPORT = path.join(__dirname, "silver-capability-help-guard-v1-report.json");

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const cases = all.filter(function (c) {
    return c.mode === "help";
  });
  const res = shared.runAudit("silver_capability_help_guard_v1", cases, REPORT, {
    generated_cases: all.length,
    help_cases: cases.length
  });
  const ok =
    (res.report.tier_a_save_leaks || 0) === 0 &&
    res.report.tier_a_pass === res.report.tier_a_total &&
    shared.printAuditHeader("silver_capability_help_v1", res.report, null);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
