#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-long-session-firewall-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-multi-turn-module-isolation-guard-v1-report.json");

function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(160), [
    "note_calendar_isolation",
    "task_calendar_isolation",
    "multi_turn_module_isolation"
  ]);
  const res = shared.runAudit("silver_multi_turn_module_isolation_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_multi_turn_module_isolation_v1", res.report, 98) ? 0 : 1);
}
if (require.main === module) main();
