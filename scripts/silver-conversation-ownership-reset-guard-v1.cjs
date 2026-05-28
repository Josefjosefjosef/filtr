#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-long-session-firewall-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-conversation-ownership-reset-guard-v1-report.json");

function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(120), ["conversation_ownership_reset", "stale_draft_resurrection"]);
  const res = shared.runAudit("silver_conversation_ownership_reset_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_conversation_ownership_reset_v1", res.report, 98) ? 0 : 1);
}
if (require.main === module) main();
