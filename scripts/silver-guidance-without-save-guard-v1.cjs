#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-conversational-product-understanding-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_GUIDANCE_WITHOUT_SAVE_CASES || "2500", 10);
const REPORT = path.join(__dirname, "silver-guidance-without-save-guard-v1-report.json");

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const families = new Set(["guidance_without_save", "how_to_questions", "instructional_questions", "explain_features_queries"]);
  const cases = all.filter(function (c) {
    return families.has(c.family);
  });
  const res = shared.runAudit("silver_guidance_without_save_guard_v1", cases, REPORT);
  const ok =
    (res.report.tier_a_save_leaks || 0) === 0 &&
    shared.printAuditHeader("silver_guidance_without_save_v1", res.report, null);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
