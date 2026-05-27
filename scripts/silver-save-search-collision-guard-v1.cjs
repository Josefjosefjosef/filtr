#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-real-ux-multi-intent-chaos-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-save-search-collision-guard-v1-report.json");
function main() {
  const cases = shared.filterFamily(shared.buildCorpusV1(280), ["save_search_collision"]);
  const res = shared.runAudit("silver_save_search_collision_v1", cases, REPORT);
  const ok = shared.printHeader("silver_save_search_collision_v1", res.report);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
