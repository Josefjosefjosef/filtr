#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-conversational-ownership-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-conversational-ownership-diagnostic-v1-report.json");

function main() {
  const cases = shared.buildCorpusV1(700);
  const res = shared.runAudit("silver_conversational_ownership_diagnostic_v1", cases, REPORT, {
    diagnostic: true,
    corpus_size: cases.length
  });
  shared.printDiagnosticSummary(res);
  process.exit(res.report.fail === 0 ? 0 : 1);
}
if (require.main === module) main();
