#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-note-search-read-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-note-search-module-isolation-guard-v1-report.json");

function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(400), ["module_isolation"]);
  const res = shared.runAudit("silver_note_search_module_isolation_guard_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_note_search_module_isolation_guard_v1", res.report, 98) ? 0 : 1);
}

if (require.main === module) main();
