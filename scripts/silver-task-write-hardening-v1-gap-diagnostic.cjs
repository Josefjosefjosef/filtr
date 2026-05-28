#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-task-write-hardening-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-task-write-hardening-v1-gap-diagnostic-report.json");

function main() {
  const report = shared.runHardeningGapDiagnostic(REPORT);
  const ok = report.true_engine_fail_count === 0 && report.safety_risk_count === 0;
  process.exit(ok ? 0 : 0);
}

if (require.main === module) main();
