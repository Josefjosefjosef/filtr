#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-orchestration-stabilization-v2-shared.cjs");

const TARGET = parseInt(process.env.SILVER_HELP_GUIDANCE_CASES || "1000", 10);
const REPORT = path.join(__dirname, "silver-help-guidance-firewall-real-ux-guard-report.json");

function main() {
  const cases = shared.buildHelpGuidanceCorpusV2(TARGET);
  const res = shared.runHelpFirewallAudit("silver_help_guidance_firewall_real_ux_v2", cases, REPORT);
  const minPct = parseFloat(process.env.SILVER_HELP_FIREWALL_MIN_PCT || "99", 10);
  const pct = res.report.cases_total
    ? Math.round((res.report.pass_count / res.report.cases_total) * 1000) / 10
    : 0;
  const ok = res.report.draft_card_leaks === 0 && res.report.guidance_payload_leaks === 0 && pct >= minPct;
  if (!ok) {
    console.log("min_pass_pct=" + minPct);
    console.log("accuracy_pct=" + pct);
    console.log("PASS_FAIL=FAIL");
  }
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
