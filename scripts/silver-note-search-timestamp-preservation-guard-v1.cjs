#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-note-search-read-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-note-search-timestamp-preservation-guard-v1-report.json");

function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(400), ["timestamp_preservation", "person_money", "object_service"]);
  const res = shared.runAudit("silver_note_search_timestamp_preservation_guard_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_note_search_timestamp_preservation_guard_v1", res.report, 98) ? 0 : 1);
}

if (require.main === module) main();
