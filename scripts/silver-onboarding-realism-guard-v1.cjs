#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-public-beta-ux-hardening-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_ONBOARDING_REALISM_CASES || "1600", 10);
const REPORT = path.join(__dirname, "silver-onboarding-realism-guard-v1-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_ONBOARDING_REALISM_MIN_PCT || "99", 10);

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const cases = shared.filterFamilies(all, [
    "onboarding_realism",
    "onboarding_chaos_mobile",
    "dirty_czech_onboarding",
    "realistic_mobile_help"
  ]);
  const res = shared.runAudit("silver_onboarding_realism_v1", cases, REPORT, { onboarding_cases: cases.length });
  const ok = shared.printHeader("silver_onboarding_realism_v1", res.report, MIN_PCT);
  if (!ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
