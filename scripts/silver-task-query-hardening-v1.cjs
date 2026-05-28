#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-task-query-hardening-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-task-query-hardening-v1-report.json");

function main() {
  const cases = shared.buildCorpusV1(360);
  const res = shared.runAudit("silver_task_query_hardening_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_task_query_hardening_v1", res.report, 98) ? 0 : 1);
}

if (require.main === module) main();
