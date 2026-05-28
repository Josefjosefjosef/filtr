#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-conversational-ownership-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-fragment-reuse-guard-v1-report.json");

function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(700), ["stale_entity", "module_switch"]);
  const res = shared.runAudit("silver_fragment_reuse_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_fragment_reuse_v1", res.report, 98) ? 0 : 1);
}
if (require.main === module) main();
