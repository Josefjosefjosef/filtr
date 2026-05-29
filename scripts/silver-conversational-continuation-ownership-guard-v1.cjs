#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-conversational-continuation-ownership-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-conversational-continuation-ownership-guard-v1-report.json");
const TARGET = parseInt(process.env.SILVER_CONTINUATION_OWNERSHIP_CASES || "5000", 10);

function main() {
  const cases = shared.buildCorpusV1(TARGET);
  const res = shared.runAudit("silver_conversational_continuation_ownership_v1", cases, REPORT, {
    corpus_size: cases.length,
    families: [
      "note_continuation",
      "calendar_continuation",
      "query_to_save",
      "task_true_positive",
      "appointment_continuation",
      "note_memory_continuation",
      "cross_module"
    ]
  });
  process.exit(shared.printHeader("silver_conversational_continuation_ownership_v1", res.report) ? 0 : 1);
}

if (require.main === module) main();
