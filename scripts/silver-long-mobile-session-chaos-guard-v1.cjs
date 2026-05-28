#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-long-session-firewall-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-long-mobile-session-chaos-guard-v1-report.json");

function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(80), ["long_mobile_session", "save_help_query", "save_then_query"]);
  const res = shared.runAudit("silver_long_mobile_session_chaos_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_long_mobile_session_chaos_v1", res.report, 98) ? 0 : 1);
}
if (require.main === module) main();
