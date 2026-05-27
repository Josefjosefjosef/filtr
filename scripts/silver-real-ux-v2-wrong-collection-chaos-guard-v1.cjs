#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-real-ux-multi-intent-chaos-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-real-ux-v2-wrong-collection-chaos-guard-v1-report.json");
function main() {
  const cases = shared.filterFamily(shared.buildCorpusV1(280), ["wrong_collection_chaos"]);
  const res = shared.runAudit("silver_real_ux_v2_wrong_collection_chaos_v1", cases, REPORT);
  const ok = shared.printHeader("silver_real_ux_v2_wrong_collection_chaos_v1", res.report);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
