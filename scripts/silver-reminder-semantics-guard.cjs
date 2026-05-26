#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-orchestration-stabilization-v2-shared.cjs");

const REPORT = path.join(__dirname, "silver-reminder-semantics-guard-report.json");

function main() {
  const cases = shared.buildReminderSemanticsCases();
  const res = shared.runSaveAuditExtended("silver_reminder_semantics_v2", cases, REPORT);
  process.exit(res.ok ? 0 : 1);
}

if (require.main === module) main();
