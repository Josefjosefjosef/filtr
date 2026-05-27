#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-public-beta-ux-hardening-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_CROSS_TURN_ORCH_CASES || "1600", 10);
const REPORT = path.join(__dirname, "silver-cross-turn-orchestration-guard-v1-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_CROSS_TURN_ORCH_MIN_PCT || "98", 10);

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const cases = shared.filterFamilies(all, [
    "orchestration_cross_turn_isolation",
    "search_after_save_flow",
    "update_after_help_flow",
    "conversational_followup_turns"
  ]);
  const res = shared.runAudit("silver_cross_turn_orchestration_v1", cases, REPORT, {
    cross_turn_cases: cases.length
  });
  const ok = shared.printHeader("silver_cross_turn_orchestration_v1", res.report, MIN_PCT);
  if (!ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
