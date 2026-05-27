#!/usr/bin/env node
"use strict";

const path = require("path");
const pbux = require("./silver-public-beta-ux-hardening-v1-shared.cjs");
const cap = require("./silver-conversational-orchestration-cap-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_CROSS_TURN_ORCH_V2_CASES || "1700", 10);
const REPORT = path.join(__dirname, "silver-cross-turn-orchestration-guard-v2-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_CROSS_TURN_ORCH_V2_MIN_PCT || "98", 10);

function main() {
  const capChains = cap
    .filterFamily(cap.buildCapCorpusV1(200), ["search_after_save", "save_after_search"])
    .filter((c) => Array.isArray(c.chain) && c.chain.length > 1);
  const pbCases = pbux.filterFamilies(pbux.buildCorpusV1(TARGET), [
    "orchestration_cross_turn_isolation",
    "search_after_save_flow",
    "conversational_followup_turns"
  ]);
  const resCap = cap.runAudit("silver_cross_turn_orchestration_v2_cap", capChains, REPORT + ".cap.json");
  const resPb = pbux.runAudit("silver_cross_turn_orchestration_v2", pbCases, REPORT, {
    cross_turn_v2_cases: pbCases.length + capChains.length,
    cap_chain_cases: capChains.length
  });
  const mergedPass = resCap.report.pass + resPb.report.pass_count;
  const mergedTotal = resCap.report.total + resPb.report.cases_total;
  const mergedPct = mergedTotal ? (mergedPass / mergedTotal) * 100 : 100;
  const report = {
    cases_total: mergedTotal,
    pass_count: mergedPass,
    accuracy_pct: mergedPct,
    help_contamination_count: resPb.report.help_contamination_count,
    wrong_top_candidate_count: resPb.report.wrong_top_candidate_count,
    stale_context_leaks: resPb.report.stale_context_leaks,
    cap_pass: resCap.report.pass,
    cap_total: resCap.report.total
  };
  const ok =
    mergedPct >= MIN_PCT &&
    resCap.report.fail === 0 &&
    resPb.report.help_contamination_count === 0 &&
    resPb.report.pass_count === resPb.report.cases_total;
  console.log("=== SILVER_CROSS_TURN_ORCHESTRATION_V2 ===");
  console.log("cases_total=" + report.cases_total);
  console.log("pass_count=" + report.pass_count);
  console.log("accuracy_pct=" + report.accuracy_pct.toFixed(2));
  console.log("cap_pass=" + report.cap_pass + "/" + report.cap_total);
  console.log("help_contamination_count=" + report.help_contamination_count);
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_CROSS_TURN_ORCHESTRATION_V2 ===");
  if (!ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
