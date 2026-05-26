#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-line-o-capability-audit-shared.cjs");

if (require.main === module) {
  const cases = shared.buildCapabilityCorpusV1();
  shared.runAudit(
    "silver_assistant_capability_audit_v1",
    cases,
    path.join(__dirname, "silver-assistant-capability-audit-v1-report.json")
  );
}

module.exports = { buildCases: shared.buildCapabilityCorpusV1 };
