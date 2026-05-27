#!/usr/bin/env node
"use strict";

const shared = require("./silver-search-read-hardening-v2-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const cases = shared.QUERY_NO_CREATE_EXTRA.concat(shared.buildCrossModuleCorpusV1().slice(0, 60));
  const report = shared.runReplayCases(eng, cases, shared.moneySeedCtx(), shared.evaluateReadNoSave);
  const leaks = report.issues.filter((x) => (x.issues || []).some((i) => i.indexOf("write") >= 0)).length;
  console.log("save_leak_count=" + leaks);
  const ok = shared.printGuardHeader("silver_query_no_create_v2", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
