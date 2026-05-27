#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-temporal-task-query-routing-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-realistic-mobile-task-query-guard-v1-report.json");
function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(220), ["realistic_mobile_task_query"]);
  const res = shared.runAudit("silver_realistic_mobile_task_query_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_realistic_mobile_task_query_v1", res.report, 95) ? 0 : 1);
}
if (require.main === module) main();
