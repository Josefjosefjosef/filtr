#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-product-trust-layer-v2-shared.cjs");

const TARGET = parseInt(process.env.SILVER_PRODUCT_TRUST_CASES || "1100", 10);
const MIN_PCT = parseFloat(process.env.SILVER_PRODUCT_TRUST_MIN_PCT || "88");
const REPORT = path.join(__dirname, "silver-product-trust-layer-v2-report.json");

function main() {
  const cases = shared.buildCorpusV1(TARGET);
  const res = shared.runAudit("silver_product_trust_layer_v2_audit", cases, REPORT, {
    generated_cases: cases.length,
    replay_guards_added: shared.TIER_A_REPLAY_PACK.length
  });
  const ok =
    res.report.tier_a_pass === res.report.tier_a_total &&
    res.report.tier_a_save_leaks === 0 &&
    res.report.wrong_day_count === 0 &&
    res.report.false_create_count === 0 &&
    res.report.alias_fail_count === 0 &&
    res.report.accuracy_pct >= MIN_PCT &&
    shared.printAuditHeader("silver_product_trust_layer_v2_audit", res.report, MIN_PCT);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
