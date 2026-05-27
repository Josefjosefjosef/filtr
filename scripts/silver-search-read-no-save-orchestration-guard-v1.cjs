#!/usr/bin/env node
"use strict";

const shared = require("./silver-search-read-hardening-v1-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const cases = shared.SEARCH_READ_NO_SAVE_REPLAY.concat(shared.TASK_READ_NO_SAVE_REPLAY);
  const report = shared.runReplayCases(eng, cases, shared.moneySeedCtx(), shared.evaluateReadNoSave);
  console.log("read_to_save_leaks=" + report.issues.filter((x) => (x.issues || []).some((i) => i.indexOf("write") >= 0)).length);
  console.log("storage_picker_leaks=" + report.issues.filter((x) => (x.issues || []).some((i) => i === "storage_picker")).length);
  console.log("ready_to_save_leaks=" + report.issues.filter((x) => (x.issues || []).some((i) => i === "ready_to_save")).length);
  const ok = shared.printGuardHeader("silver_search_read_no_save_orchestration_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
