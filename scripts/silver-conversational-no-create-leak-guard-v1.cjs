#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-conversational-ownership-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-conversational-no-create-leak-guard-v1-report.json");

function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(700), [
    "save_to_query",
    "help_to_save",
    "negation_read_safety",
    "module_switch"
  ]);
  const res = shared.runAudit("silver_conversational_no_create_leak_v1", cases, REPORT);
  const ok =
    shared.printHeader("silver_conversational_no_create_leak_v1", res.report, 98) &&
    (res.report.read_to_create_leak_count || 0) === 0;
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
