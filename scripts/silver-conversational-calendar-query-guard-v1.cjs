#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-calendar-query-intent-routing-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-conversational-calendar-query-guard-v1-report.json");
function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(320), [
    "conversational_retrieval",
    "multi_turn_retrieval"
  ]);
  const res = shared.runAudit("silver_conversational_calendar_query_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_conversational_calendar_query_v1", res.report, 95) ? 0 : 1);
}
if (require.main === module) main();
