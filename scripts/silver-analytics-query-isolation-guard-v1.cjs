#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-conversational-product-understanding-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_ANALYTICS_QUERY_CASES || "2500", 10);
const REPORT = path.join(__dirname, "silver-analytics-query-isolation-guard-v1-report.json");

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const cases = all.filter(function (c) {
    return c.mode === "analytics";
  });
  const res = shared.runAudit("silver_analytics_query_isolation_guard_v1", cases, REPORT);
  const ok =
    res.report.query_create_leaks === 0 &&
    shared.printAuditHeader("silver_analytics_query_isolation_v1", res.report, null);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
