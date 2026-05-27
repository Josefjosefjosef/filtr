#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-conversational-retrieval-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_RETRIEVAL_NO_FALSE_CLARIFICATION_CASES || "2100", 10);
const REPORT = path.join(__dirname, "silver-retrieval-no-false-clarification-guard-v1-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_RETRIEVAL_NO_FALSE_CLARIFICATION_MIN_PCT || "95", 10);

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const cases = shared.filterFamilies(all, ["retrieval_false_clarification", "retrieval_top_candidate_quality"]);
  const res = shared.runAudit("silver_retrieval_no_false_clarification_v1", cases, REPORT, {
    retrieval_false_clarification_cases: cases.length
  });
  const ok = shared.printHeader("silver_retrieval_no_false_clarification_v1", res.report, MIN_PCT);
  if (!ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
