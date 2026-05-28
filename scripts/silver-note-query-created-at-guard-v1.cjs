#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-note-query-timestamp-display-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-note-query-created-at-guard-v1-report.json");
function main() {
  const all = shared.buildCorpusV1(120);
  const cases = shared.filterFamilies(all, [
    "finance_advance",
    "payment_record",
    "service_record",
    "insurance_record",
    "loan_record",
    "contract_record",
    "car_record",
    "person_record",
    "health_record",
    "relative_time"
  ]);
  const res = shared.runAudit("silver_note_query_created_at_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_note_query_created_at_v1", res.report, 95) ? 0 : 1);
}
if (require.main === module) main();
