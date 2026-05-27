#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-temporal-task-query-routing-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-fragment-task-query-guard-v1-report.json");
function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(220), ["fragment_task_query"]);
  const res = shared.runAudit("silver_fragment_task_query_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_fragment_task_query_v1", res.report, 90) ? 0 : 1);
}
if (require.main === module) main();
