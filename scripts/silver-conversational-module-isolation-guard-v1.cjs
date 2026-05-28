#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-conversational-ownership-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-conversational-module-isolation-guard-v1-report.json");

function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(700), ["module_switch", "save_to_query"]);
  const res = shared.runAudit("silver_conversational_module_isolation_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_conversational_module_isolation_v1", res.report, 98) ? 0 : 1);
}
if (require.main === module) main();
