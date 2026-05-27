#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-conversational-retrieval-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_LONG_SESSION_MEMORY_CASES || "2100", 10);
const REPORT = path.join(__dirname, "silver-long-session-memory-guard-v1-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_LONG_SESSION_MEMORY_MIN_PCT || "95", 10);

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const cases = shared.filterMode(all, "long_session");
  const res = shared.runAudit("silver_long_session_memory_v1", cases, REPORT, {
    long_session_memory_cases: cases.length
  });
  const ok = shared.printHeader("silver_long_session_memory_v1", res.report, MIN_PCT);
  if (!ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
