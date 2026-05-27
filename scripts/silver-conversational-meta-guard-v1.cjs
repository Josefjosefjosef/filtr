#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-conversational-product-understanding-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_CONVERSATIONAL_META_CASES || "2000", 10);
const REPORT = path.join(__dirname, "silver-conversational-meta-guard-v1-report.json");

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const cases = all.filter(function (c) {
    return c.mode === "meta";
  });
  const res = shared.runAudit("silver_conversational_meta_guard_v1", cases, REPORT);
  const ok =
    res.report.tier_a_pass === res.report.tier_a_total &&
    shared.printAuditHeader("silver_conversational_meta_v1", res.report, null);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
