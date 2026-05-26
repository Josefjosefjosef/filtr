#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-orchestration-stabilization-v2-shared.cjs");

const REPORT = path.join(__dirname, "silver-wrapper-hierarchy-guard-report.json");

function main() {
  const cases = shared.buildWrapperHierarchyCases();
  const res = shared.runSaveAuditExtended("silver_wrapper_hierarchy_v2", cases, REPORT);
  process.exit(res.ok ? 0 : 1);
}

if (require.main === module) main();
