#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-task-query-hardening-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-task-query-gap-diagnostic-v1-report.json");

function main() {
  shared.runGapDiagnostic(REPORT);
  process.exit(0);
}

if (require.main === module) main();
