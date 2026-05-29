#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-task-query-hardening-guard-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-task-query-hardening-guard-v1-report.json");
const TARGET = parseInt(process.env.SILVER_TASK_QUERY_HARDENING_CASES || "10000", 10);

function main() {
  const cases = shared.buildCorpusV1(TARGET);
  const res = shared.runAudit("silver_task_query_hardening_guard_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_task_query_hardening_guard_v1", res.report, 99) ? 0 : 1);
}

if (require.main === module) main();
