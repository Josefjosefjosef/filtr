#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-orchestration-stabilization-v2-shared.cjs");

const REPORT = path.join(__dirname, "silver-primary-secondary-intent-guard-report.json");

function main() {
  const cases = shared.buildPrimarySecondaryCases();
  const res = shared.runSaveAuditExtended("silver_primary_secondary_intent_v2", cases, REPORT, shared.primarySecondaryExtraCheck);
  process.exit(res.ok ? 0 : 1);
}

if (require.main === module) main();
