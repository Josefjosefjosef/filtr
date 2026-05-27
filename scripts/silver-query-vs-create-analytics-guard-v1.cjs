#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-conversational-product-understanding-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_QUERY_VS_CREATE_ANALYTICS_CASES || "3000", 10);
const REPORT = path.join(__dirname, "silver-query-vs-create-analytics-guard-v1-report.json");

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const cases = all
    .filter(function (c) {
      return c.mode === "analytics" || c.family === "analytics_vs_create_confusion";
    })
    .concat(shared.TIER_A_REPLAY_PACK.filter(function (r) {
      return r.mode === "analytics";
    }));
  const res = shared.runAudit("silver_query_vs_create_analytics_guard_v1", cases, REPORT);
  const ok =
    (res.report.tier_a_query_create_leaks || 0) === 0 &&
    res.report.tier_a_pass === res.report.tier_a_total &&
    shared.printAuditHeader("silver_query_vs_create_analytics_v1", res.report, null);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
