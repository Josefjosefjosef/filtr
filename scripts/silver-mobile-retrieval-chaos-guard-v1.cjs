#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-calendar-query-intent-routing-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-mobile-retrieval-chaos-guard-v1-report.json");
function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(320), [
    "mobile_voice_phrasing",
    "noisy_czech_retrieval"
  ]);
  const res = shared.runAudit("silver_mobile_retrieval_chaos_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_mobile_retrieval_chaos_v1", res.report, 95) ? 0 : 1);
}
if (require.main === module) main();
