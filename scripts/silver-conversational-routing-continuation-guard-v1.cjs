#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-conversational-orchestration-cap-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-conversational-routing-continuation-guard-v1-report.json");
function main() {
  const cases = shared.filterFamily(shared.buildCapCorpusV1(150), ["conversational_continuation"]);
  const res = shared.runAudit("silver_conversational_routing_continuation_v1", cases, REPORT);
  const ok = shared.printHeader("silver_conversational_routing_continuation_v1", res.report, 98);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
