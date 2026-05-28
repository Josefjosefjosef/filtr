#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-long-session-firewall-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-long-session-firewall-v1-report.json");

function main() {
  const cases = shared.buildCorpusV1(380);
  const res = shared.runAudit("silver_long_session_firewall_v1", cases, REPORT, {
    new_replay_cases: cases.length,
    generator_based: true
  });
  process.exit(shared.printHeader("silver_long_session_firewall_v1", res.report, 98) ? 0 : 1);
}
if (require.main === module) main();
