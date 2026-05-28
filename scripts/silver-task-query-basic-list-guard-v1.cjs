#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-task-query-hardening-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-task-query-basic-list-guard-v1-report.json");

function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(120), ["basic_task_list"]);
  const res = shared.runAudit("silver_task_query_basic_list_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_task_query_basic_list_v1", res.report, 95) ? 0 : 1);
}

if (require.main === module) main();
