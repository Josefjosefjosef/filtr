#!/usr/bin/env node
"use strict";

const path = require("path");
const orch = require("./silver-orchestration-stabilization-v2-shared.cjs");
const helpShared = require("./silver-help-guidance-render-governance-v1-shared.cjs");
const cpuShared = require("./silver-conversational-product-understanding-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_HELP_REALISTIC_MOBILE_CASES || "5000", 10);
const REPORT = path.join(__dirname, "silver-help-realistic-mobile-guard-v1-report.json");

function main() {
  const base = orch.buildHelpGuidanceCorpusV2(Math.floor(TARGET * 0.7));
  const replay = cpuShared.TIER_A_REPLAY_PACK.filter(function (r) {
    return r.mode === "help";
  }).map(function (r, i) {
    return { id: "HRM_REPLAY_" + String(i + 1).padStart(3, "0"), input: r.input, relaxed: true, topic: "replay" };
  });
  const cases = base.concat(replay).slice(0, TARGET);
  const res = helpShared.runHelpGovernanceAudit("silver_help_realistic_mobile_v1", cases, REPORT, {
    tier_a_replay: replay.length,
    audit_families: cpuShared.AUDIT_FAMILIES.length
  });
  helpShared.printAuditHeader("silver_help_realistic_mobile_v1", res.report);
  const ok = res.report.save_shell_leaks === 0 && res.report.pass_count === res.report.cases_total;
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
