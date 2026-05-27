#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-conversational-product-understanding-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_HELP_VS_SAVE_CASES || "3000", 10);
const REPORT = path.join(__dirname, "silver-help-vs-save-isolation-guard-v1-report.json");

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const families = new Set([
    "save_vs_help_confusion",
    "capability_vs_storage_confusion",
    "guidance_without_save",
    "how_to_questions",
    "instructional_questions"
  ]);
  const cases = all.filter(function (c) {
    return families.has(c.family) || c.mode === "help";
  });
  const res = shared.runAudit("silver_help_vs_save_isolation_guard_v1", cases, REPORT);
  const ok =
    (res.report.tier_a_save_leaks || 0) === 0 &&
    res.report.tier_a_pass === res.report.tier_a_total &&
    shared.printAuditHeader("silver_help_vs_save_isolation_v1", res.report, null);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
