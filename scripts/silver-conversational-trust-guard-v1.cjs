#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-public-beta-ux-hardening-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_CONVERSATIONAL_TRUST_CASES || "1600", 10);
const REPORT = path.join(__dirname, "silver-conversational-trust-guard-v1-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_CONVERSATIONAL_TRUST_MIN_PCT || "99", 10);

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const cases = shared.filterFamilies(all, [
    "conversational_guidance_quality",
    "conversational_naturalness",
    "capability_help_realism",
    "conversational_followup_turns"
  ]);
  const res = shared.runAudit("silver_conversational_trust_v1", cases, REPORT, {
    conversational_trust_cases: cases.length
  });
  const ok = shared.printHeader("silver_conversational_trust_v1", res.report, MIN_PCT);
  if (!ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
