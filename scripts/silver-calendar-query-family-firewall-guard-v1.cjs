#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-calendar-query-family-guard-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-calendar-query-family-firewall-guard-v1-report.json");
const TARGET = parseInt(process.env.SILVER_CALENDAR_QUERY_FAMILY_CASES || "280", 10);
function main() {
  const cases = shared.buildCorpusV1(TARGET);
  const res = shared.runAudit("silver_calendar_query_family_firewall_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_calendar_query_family_firewall_v1", res.report, 95) ? 0 : 1);
}
if (require.main === module) main();
