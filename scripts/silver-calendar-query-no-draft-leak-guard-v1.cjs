#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-calendar-query-family-guard-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-calendar-query-no-draft-leak-guard-v1-report.json");
function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(100), [
    "read_after_save",
    "no_draft_leak",
    "negated_read",
    "long_session"
  ]);
  const res = shared.runAudit("silver_calendar_query_no_draft_leak_v1", cases, REPORT);
  const writeLeaks = res.fails.filter((f) =>
    (f.issues || []).some((x) => x.indexOf("write_leak") >= 0 || x === "ready_to_save")
  ).length;
  const ok = writeLeaks === 0 && res.report.fail === 0;
  console.log("=== SILVER_CALENDAR_QUERY_NO_DRAFT_LEAK_V1 ===");
  console.log("pass=" + res.report.pass + "/" + res.report.total);
  console.log("draft_write_leaks=" + writeLeaks);
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_CALENDAR_QUERY_NO_DRAFT_LEAK_V1 ===");
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
