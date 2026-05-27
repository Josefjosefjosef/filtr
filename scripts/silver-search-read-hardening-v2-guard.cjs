#!/usr/bin/env node
"use strict";

const shared = require("./silver-search-read-hardening-v2-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const cases = shared.buildSearchReadHardeningV2Corpus();
  const report = shared.runReplayCases(eng, cases, shared.moneySeedCtx(), shared.evaluateCrossModuleSearchRead);
  const cal = cases.filter((c) => c.module === "calendar").length;
  const task = cases.filter((c) => c.module === "task").length;
  const note = cases.filter((c) => c.module === "note").length;
  console.log("calendar_cases=" + cal);
  console.log("task_cases=" + task);
  console.log("note_cases=" + note);
  console.log("total_cases=" + cases.length);
  const pct = report.total ? (report.pass / report.total) * 100 : 0;
  console.log("cross_module_accuracy=" + pct.toFixed(2));
  const minPct = parseFloat(process.env.SILVER_SEARCH_READ_V2_MIN_PCT || "98", 10);
  const ok = pct >= minPct && shared.printGuardHeader("silver_search_read_hardening_v2", report);
  console.log("min_pass_pct=" + minPct);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
