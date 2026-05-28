#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-note-search-read-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-note-search-read-diagnostic-v1-report.json");

function main() {
  const res = shared.runDiagnostic(REPORT);
  const ok = shared.printHeader("silver_note_search_read_diagnostic_v1", res.report, 95);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
