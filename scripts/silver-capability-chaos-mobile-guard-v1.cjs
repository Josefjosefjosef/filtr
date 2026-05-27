#!/usr/bin/env node
"use strict";

const path = require("path");
const helpShared = require("./silver-help-guidance-render-governance-v1-shared.cjs");
const cpuShared = require("./silver-conversational-product-understanding-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_CAPABILITY_CHAOS_MOBILE_CASES || "8000", 10);
const MIN_PCT = parseFloat(process.env.SILVER_CAPABILITY_CHAOS_MIN_PCT || "95", 10);
const REPORT = path.join(__dirname, "silver-capability-chaos-mobile-guard-v1-report.json");

function main() {
  const chaos = helpShared.buildHelpChaosCorpusV1(Math.floor(TARGET * 0.6));
  const cpu = cpuShared.buildCorpusV1(Math.floor(TARGET * 0.4));
  const cases = chaos.concat(cpu.filter(function (c) {
    return c.mode === "help";
  }));
  const res = helpShared.runHelpGovernanceAudit("silver_capability_chaos_mobile_v1", cases.slice(0, TARGET), REPORT, {
    chaos_cases: chaos.length,
    cpu_help_cases: cpu.length,
    audit_families: cpuShared.AUDIT_FAMILIES
  });
  helpShared.printAuditHeader("silver_capability_chaos_mobile_v1", res.report);
  const tierARes = cpuShared.runAudit(
    "silver_capability_chaos_tier_a_v1",
    cpuShared.TIER_A_REPLAY_PACK,
    path.join(__dirname, "silver-capability-chaos-tier-a-v1-report.json")
  );
  const ok =
    res.report.accuracy_pct >= MIN_PCT &&
    (tierARes.report.tier_a_save_leaks || 0) === 0 &&
    tierARes.report.tier_a_pass === tierARes.report.tier_a_total;
  if (!ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
