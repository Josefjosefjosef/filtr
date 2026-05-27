#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-public-beta-ux-hardening-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_HELP_TIERB_CASES || "1600", 10);
const REPORT = path.join(__dirname, "silver-help-tierb-chaos-guard-v1-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_HELP_TIERB_MIN_PCT || "99", 10);

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const cases = shared.filterFamilies(all, [
    "help_tier_b_chaos",
    "confused_user_help",
    "dirty_czech_onboarding",
    "spoken_czech_help",
    "capability_question_mutations",
    "public_beta_confused_users"
  ]);
  const res = shared.runAudit("silver_help_tierb_chaos_v1", cases, REPORT, { tierb_chaos_cases: cases.length });
  const ok = shared.printHeader("silver_help_tierb_chaos_v1", res.report, MIN_PCT);
  if (!ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
