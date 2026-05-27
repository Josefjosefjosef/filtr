#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-conversational-orchestration-cap-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-save-after-search-guard-v1-report.json");
function main() {
  const cases = shared.filterFamily(shared.buildCapCorpusV1(160), ["save_after_search"]);
  const res = shared.runAudit("silver_save_after_search_v1", cases, REPORT);
  const ok = shared.printHeader("silver_save_after_search_v1", res.report, 98);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
