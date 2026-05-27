#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-conversational-retrieval-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_CONVERSATIONAL_RETRIEVAL_CASES || "2100", 10);
const REPORT = path.join(__dirname, "silver-conversational-retrieval-guard-v1-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_CONVERSATIONAL_RETRIEVAL_MIN_PCT || "95", 10);

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const cases = shared.filterFamilies(all, [
    "conversational_retrieval_without_find",
    "conversational_search_realism",
    "public_beta_memory_queries"
  ]);
  const res = shared.runAudit("silver_conversational_retrieval_v1", cases, REPORT, {
    conversational_retrieval_cases: cases.length
  });
  const ok = shared.printHeader("silver_conversational_retrieval_v1", res.report, MIN_PCT);
  if (!ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
