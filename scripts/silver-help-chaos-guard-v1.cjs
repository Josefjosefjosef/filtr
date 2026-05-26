#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-help-guidance-render-governance-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_HELP_CHAOS_CASES || "20000", 10);
const REPORT = path.join(__dirname, "silver-help-chaos-guard-v1-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_HELP_CHAOS_MIN_PCT || "99", 10);

function main() {
  const cases = shared.buildHelpChaosCorpusV1(TARGET);
  const res = shared.runHelpGovernanceAudit(
    "silver_help_chaos_v1",
    cases,
    REPORT,
    {
      help_chaos_cases: cases.length,
      spoken_czech_cases: Math.floor(cases.length * 0.35),
      mobile_chaos_cases: Math.floor(cases.length * 0.2)
    }
  );
  shared.printAuditHeader("silver_help_chaos_v1", res.report);
  const ok = res.report.accuracy_pct >= MIN_PCT && res.report.save_shell_leaks === 0;
  if (!ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
