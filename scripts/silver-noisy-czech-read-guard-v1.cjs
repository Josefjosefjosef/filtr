#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-temporal-task-query-routing-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-noisy-czech-read-guard-v1-report.json");
function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(220), ["noisy_czech_read"]);
  const res = shared.runAudit("silver_noisy_czech_read_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_noisy_czech_read_v1", res.report, 95) ? 0 : 1);
}
if (require.main === module) main();
