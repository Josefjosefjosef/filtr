#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-long-session-firewall-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-stale-draft-resurrection-guard-v1-report.json");

function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(120), ["stale_draft_resurrection", "conversation_ownership_reset"]);
  const res = shared.runAudit("silver_stale_draft_resurrection_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_stale_draft_resurrection_v1", res.report, 98) ? 0 : 1);
}
if (require.main === module) main();
