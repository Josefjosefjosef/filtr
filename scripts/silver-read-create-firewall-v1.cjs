#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-read-create-firewall-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-read-create-firewall-v1-report.json");
const TARGET = parseInt(process.env.SILVER_READ_CREATE_FIREWALL_CASES || "470", 10);
function main() {
  const cases = shared.buildCorpusV1(TARGET);
  const res = shared.runAudit("silver_read_create_firewall_v1", cases, REPORT, {
    new_replay_cases: cases.length,
    generator_based: true
  });
  process.exit(shared.printHeader("silver_read_create_firewall_v1", res.report, 95) ? 0 : 1);
}
if (require.main === module) main();
