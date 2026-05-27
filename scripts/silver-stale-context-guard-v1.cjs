#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-public-beta-ux-hardening-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_STALE_CONTEXT_CASES || "1600", 10);
const REPORT = path.join(__dirname, "silver-stale-context-guard-v1-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_STALE_CONTEXT_MIN_PCT || "98", 10);

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const cases = shared.filterFamilies(all, ["stale_context_reset", "stale_clarification_protection"]);
  const res = shared.runAudit("silver_stale_context_v1", cases, REPORT, { stale_context_cases: cases.length });
  const ok = shared.printHeader("silver_stale_context_v1", res.report, MIN_PCT);
  if (!ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
