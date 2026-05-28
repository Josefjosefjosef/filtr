#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-calendar-query-family-guard-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-calendar-query-long-session-guard-v1-report.json");
function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(60), ["long_session"]);
  const res = shared.runAudit("silver_calendar_query_long_session_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_calendar_query_long_session_v1", res.report, 95) ? 0 : 1);
}
if (require.main === module) main();
