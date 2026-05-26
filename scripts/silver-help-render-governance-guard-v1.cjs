#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-help-guidance-render-governance-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-help-render-governance-guard-v1-report.json");

function main() {
  const cases = shared.CRITICAL_HELP_PACK.map(function (input, i) {
    return { id: "HGOV_" + String(i + 1).padStart(3, "0"), input: input, relaxed: true, topic: "critical" };
  });
  const res = shared.runHelpGovernanceAudit("silver_help_render_governance_v1", cases, REPORT);
  shared.printAuditHeader("silver_help_render_governance_v1", res.report);
  const minPct = parseFloat(process.env.SILVER_HELP_RENDER_GOV_MIN_PCT || "100", 10);
  const ok = res.report.accuracy_pct >= minPct && res.report.save_shell_leaks === 0 && res.report.false_clarification_count === 0;
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
