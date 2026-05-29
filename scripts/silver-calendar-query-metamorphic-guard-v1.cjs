#!/usr/bin/env node
"use strict";

const shared = require("./silver-real-user-search-read-screenshot-v1-shared.cjs");

function main() {
  const all = shared.buildScreenshotCorpus();
  const cases = all.filter(function (c) {
    return c.lane === "CALENDAR_METAMORPHIC" || c.family === "calendar_tomorrow_query_metamorphic_inconsistency";
  });
  const report = shared.runScreenshotAudit(cases, null);
  const c = report.counters;
  const ok = (c.calendar_metamorphic_fail_count || 0) === 0 && (report.metamorphic_families_fail || []).indexOf("TOMORROW_AGENDA") < 0;

  console.log("=== SILVER_CALENDAR_QUERY_METAMORPHIC_GUARD_V1 ===");
  console.log("total_cases=" + report.total_cases);
  console.log("pass=" + report.pass);
  console.log("fail=" + report.fail);
  console.log("calendar_metamorphic_fail_count=" + (c.calendar_metamorphic_fail_count || 0));
  console.log("metamorphic_families_fail=" + (report.metamorphic_families_fail || []).join("|"));
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_CALENDAR_QUERY_METAMORPHIC_GUARD_V1 ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
