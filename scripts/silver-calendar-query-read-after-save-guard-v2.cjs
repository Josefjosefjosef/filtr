#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-calendar-query-family-guard-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-calendar-query-read-after-save-guard-v2-report.json");
function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(80), ["read_after_save", "no_draft_leak"]);
  const res = shared.runAudit("silver_calendar_query_read_after_save_v2", cases, REPORT);
  process.exit(shared.printHeader("silver_calendar_query_read_after_save_v2", res.report, 95) ? 0 : 1);
}
if (require.main === module) main();
