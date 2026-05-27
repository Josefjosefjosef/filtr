#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-conversational-retrieval-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_IMPLICIT_READ_INTENT_CASES || "2100", 10);
const REPORT = path.join(__dirname, "silver-implicit-read-intent-guard-v1-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_IMPLICIT_READ_INTENT_MIN_PCT || "95", 10);

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const cases = shared.filterFamilies(all, [
    "implicit_read_intent",
    "retrieval_without_search_verbs",
    "retrieval_no_save_contamination"
  ]);
  const res = shared.runAudit("silver_implicit_read_intent_v1", cases, REPORT, {
    implicit_read_intent_cases: cases.length
  });
  const ok = shared.printHeader("silver_implicit_read_intent_v1", res.report, MIN_PCT);
  if (!ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
