#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-product-trust-layer-v2-shared.cjs");
const REPORT = path.join(__dirname, "silver-help-no-draft-guard-v1-report.json");
function main() {
  const all = shared.buildCorpusV1(1100);
  const cases = all.filter(function (c) {
    return (
      c.family === "help_no_save_contamination" ||
      c.family === "capability_no_draft" ||
      c.family === "help_no_storage_picker" ||
      c.family === "capability_questions"
    );
  });
  const res = shared.runAudit("silver_help_no_draft_guard_v1", cases, REPORT);
  const ok = res.report.tier_a_pass === res.report.tier_a_total && res.report.tier_a_save_leaks === 0 && shared.printAuditHeader("silver_help_no_draft_v1", res.report, null);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
