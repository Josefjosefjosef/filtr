#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-real-ux-multi-intent-chaos-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-long-chain-command-guard-v1-report.json");
function main() {
  const cases = shared.filterFamily(shared.buildCorpusV1(280), ["long_chain_command"]);
  const res = shared.runAudit("silver_long_chain_command_v1", cases, REPORT);
  const ok = shared.printHeader("silver_long_chain_command_v1", res.report);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
