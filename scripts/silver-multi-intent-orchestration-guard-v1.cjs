#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-conversational-orchestration-cap-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-multi-intent-orchestration-guard-v1-report.json");
function main() {
  const cases = shared.filterFamily(shared.buildCapCorpusV1(180), [
    "search_after_save",
    "save_after_search",
    "negated_save",
    "module_switch"
  ]);
  const res = shared.runAudit("silver_multi_intent_orchestration_v1", cases, REPORT);
  const ok = shared.printHeader("silver_multi_intent_orchestration_v1", res.report, 98);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
