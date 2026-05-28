#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-calendar-query-family-guard-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-calendar-query-no-ready-to-save-guard-v1-report.json");
function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(100), ["negated_read", "negated_read_note", "no_draft_leak"]);
  const res = shared.runAudit("silver_calendar_query_no_ready_to_save_v1", cases, REPORT);
  const ok = res.report.fail === 0;
  console.log("=== SILVER_CALENDAR_QUERY_NO_READY_TO_SAVE_V1 ===");
  console.log("pass=" + res.report.pass + "/" + res.report.total);
  console.log("ready_to_save_leaks=" + res.fails.filter((f) => (f.issues || []).indexOf("ready_to_save") >= 0).length);
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_CALENDAR_QUERY_NO_READY_TO_SAVE_V1 ===");
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
