#!/usr/bin/env node
"use strict";

const shared = require("./silver-real-user-search-read-screenshot-v1-shared.cjs");

function main() {
  const all = shared.buildScreenshotCorpus();
  const cases = all.filter(function (c) {
    return c.lane === "TASKS_SEARCH_READ" || String(c.family || "").indexOf("task_") === 0;
  });
  const report = shared.runScreenshotAudit(cases, null);
  const c = report.counters;
  const ok = (c.task_search_to_create_leak_count || 0) === 0 && (c.safety_risk_count || 0) === 0;

  console.log("=== SILVER_TASK_SEARCH_READ_FIREWALL_GUARD_V1 ===");
  console.log("total_cases=" + report.total_cases);
  console.log("pass=" + report.pass);
  console.log("fail=" + report.fail);
  console.log("task_search_to_create_leak_count=" + (c.task_search_to_create_leak_count || 0));
  console.log("tasks_overbroad_fallback_count=" + (c.tasks_overbroad_fallback_count || 0));
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_TASK_SEARCH_READ_FIREWALL_GUARD_V1 ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
