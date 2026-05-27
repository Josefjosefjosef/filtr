#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-conversational-retrieval-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_FRAGMENT_RECALL_CASES || "2100", 10);
const REPORT = path.join(__dirname, "silver-fragment-recall-guard-v1-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_FRAGMENT_RECALL_MIN_PCT || "95", 10);

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const cases = shared.filterFamilies(all, [
    "fragment_recall_queries",
    "note_fragment_recall",
    "task_fragment_recall",
    "calendar_fragment_recall"
  ]);
  const res = shared.runAudit("silver_fragment_recall_v1", cases, REPORT, { fragment_recall_cases: cases.length });
  const ok = shared.printHeader("silver_fragment_recall_v1", res.report, MIN_PCT);
  if (!ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
