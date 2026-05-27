#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-conversational-product-understanding-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_CPU_AUDIT_CASES || "12000", 10);
const REPORT = path.join(__dirname, "silver-conversational-product-understanding-audit-v1-report.json");

function main() {
  const cases = shared.buildCorpusV1(TARGET);
  const res = shared.runAudit(
    "silver_conversational_product_understanding_audit_v1",
    cases,
    REPORT,
    {
      generated_cases: cases.length,
      audit_families_count: shared.AUDIT_FAMILIES.length,
      tier_a_replay: shared.TIER_A_REPLAY_PACK.length
    }
  );
  const ok =
    res.report.tier_a_pass === res.report.tier_a_total &&
    res.report.help_save_leaks === 0 &&
    res.report.query_create_leaks === 0 &&
    res.report.hallucination_leaks === 0 &&
    shared.printAuditHeader("silver_conversational_product_understanding_v1", res.report, null);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
