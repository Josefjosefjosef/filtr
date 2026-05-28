#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-conversational-ownership-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-conversational-ownership-guard-v1-report.json");
const TARGET = parseInt(process.env.SILVER_CONVERSATIONAL_OWNERSHIP_CASES || "700", 10);

function main() {
  const cases = shared.buildCorpusV1(TARGET);
  const res = shared.runAudit("silver_conversational_ownership_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_conversational_ownership_v1", res.report, 98) ? 0 : 1);
}
if (require.main === module) main();
