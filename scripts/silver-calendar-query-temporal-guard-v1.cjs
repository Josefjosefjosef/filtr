#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-calendar-query-family-guard-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-calendar-query-temporal-guard-v1-report.json");
function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(120), [
    "temporal",
    "co_minuly_tyden",
    "kdy_doktor",
    "co_vecer",
    "co_zitra",
    "kdy_dnes_schuzka"
  ]);
  const res = shared.runAudit("silver_calendar_query_temporal_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_calendar_query_temporal_v1", res.report, 95) ? 0 : 1);
}
if (require.main === module) main();
