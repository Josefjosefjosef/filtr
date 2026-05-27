#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-conversational-orchestration-cap-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-followup-context-ownership-guard-v1-report.json");
function main() {
  const cases = shared.filterFamily(shared.buildCapCorpusV1(150), ["followup_ownership"]);
  const res = shared.runAudit("silver_followup_context_ownership_v1", cases, REPORT);
  const ok = shared.printHeader("silver_followup_context_ownership_v1", res.report, 98);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
