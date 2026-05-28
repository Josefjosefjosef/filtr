#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-calendar-query-family-guard-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-calendar-query-entity-guard-v1-report.json");
function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(120), [
    "entity_s_pepou",
    "entity_kdy_pepa",
    "entity_pravnik",
    "entity_uctni",
    "entity_servis",
    "co_resil_s_pepou"
  ]);
  const res = shared.runAudit("silver_calendar_query_entity_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_calendar_query_entity_v1", res.report, 95) ? 0 : 1);
}
if (require.main === module) main();
