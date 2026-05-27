#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-conversational-retrieval-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_CONVERSATIONAL_FOLLOWUP_RECALL_CASES || "2100", 10);
const REPORT = path.join(__dirname, "silver-conversational-followup-recall-guard-v1-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_CONVERSATIONAL_FOLLOWUP_RECALL_MIN_PCT || "95", 10);

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const cases = shared.filterFamilies(all, [
    "conversational_followup_recall",
    "retrieval_after_help_turn",
    "retrieval_after_update_turn",
    "retrieval_after_save_turn",
    "stale_retrieval_ownership"
  ]);
  const res = shared.runAudit("silver_conversational_followup_recall_v1", cases, REPORT, {
    conversational_followup_recall_cases: cases.length
  });
  const ok = shared.printHeader("silver_conversational_followup_recall_v1", res.report, MIN_PCT);
  if (!ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
