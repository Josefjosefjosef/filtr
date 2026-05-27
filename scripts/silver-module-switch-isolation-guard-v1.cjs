#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-conversational-orchestration-cap-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-module-switch-isolation-guard-v1-report.json");
function main() {
  const cases = shared.filterFamily(shared.buildCapCorpusV1(150), ["module_switch"]);
  const res = shared.runAudit("silver_module_switch_isolation_v1", cases, REPORT);
  const ok = shared.printHeader("silver_module_switch_isolation_v1", res.report, 98);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
