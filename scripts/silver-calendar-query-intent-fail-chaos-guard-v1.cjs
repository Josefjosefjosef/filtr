#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-calendar-query-intent-routing-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-calendar-query-intent-fail-chaos-guard-v1-report.json");
function main() {
  const cases = shared.buildCorpusV1(320);
  const res = shared.runAudit("silver_calendar_query_intent_fail_chaos_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_calendar_query_intent_fail_chaos_v1", res.report, 95) ? 0 : 1);
}
if (require.main === module) main();
