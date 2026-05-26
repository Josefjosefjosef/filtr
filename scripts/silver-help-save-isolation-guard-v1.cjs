#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-help-guidance-render-governance-v1-shared.cjs");
const orch = require("./silver-orchestration-stabilization-v2-shared.cjs");

const TARGET = parseInt(process.env.SILVER_HELP_SAVE_ISOLATION_CASES || "2000", 10);
const REPORT = path.join(__dirname, "silver-help-save-isolation-guard-v1-report.json");

function main() {
  const cases = orch.buildHelpGuidanceCorpusV2(TARGET);
  const res = shared.runHelpGovernanceAudit("silver_help_save_isolation_v1", cases, REPORT);
  shared.printAuditHeader("silver_help_save_isolation_v1", res.report);
  const ok = res.report.save_shell_leaks === 0 && res.report.draft_card_leaks === 0 && res.report.pass_count === res.report.cases_total;
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
