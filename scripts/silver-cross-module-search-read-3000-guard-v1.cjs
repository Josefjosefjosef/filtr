#!/usr/bin/env node
"use strict";

const shared = require("./silver-search-read-hardening-v1-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const cases = shared.buildCrossModuleCorpusV1();
  const report = shared.runReplayCases(eng, cases, shared.moneySeedCtx(), shared.evaluateCrossModuleSearchRead);
  const cal = cases.filter((c) => c.module === "calendar").length;
  const task = cases.filter((c) => c.module === "task").length;
  const note = cases.filter((c) => c.module === "note").length;
  console.log("calendar_search_cases=" + cal);
  console.log("task_search_cases=" + task);
  console.log("note_search_cases=" + note);
  console.log("total_search_read_cases=" + cases.length);
  const minPct = parseFloat(process.env.SILVER_CROSS_MODULE_SEARCH_READ_MIN_PCT || "98", 10);
  const pct = report.total ? (report.pass / report.total) * 100 : 0;
  console.log("pass_pct=" + pct.toFixed(2));
  const ok = pct >= minPct;
  shared.printGuardHeader("silver_cross_module_search_read_3000_v1", report);
  console.log("min_pass_pct=" + minPct);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
