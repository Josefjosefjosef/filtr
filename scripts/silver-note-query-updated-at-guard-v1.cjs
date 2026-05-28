#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-note-query-timestamp-display-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-note-query-updated-at-guard-v1-report.json");
function main() {
  const all = shared.buildCorpusV1(120);
  const cases = shared.filterFamilies(all, ["updated_at", "service_record"]);
  const res = shared.runAudit("silver_note_query_updated_at_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_note_query_updated_at_v1", res.report, 95) ? 0 : 1);
}
if (require.main === module) main();
