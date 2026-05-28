#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-long-session-firewall-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-query-after-timestamp-render-guard-v1-report.json");

function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(100), ["query_after_timestamp_render"]);
  const res = shared.runAudit("silver_query_after_timestamp_render_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_query_after_timestamp_render_v1", res.report, 98) ? 0 : 1);
}
if (require.main === module) main();
