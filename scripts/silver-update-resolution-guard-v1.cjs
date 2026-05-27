#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-product-trust-layer-v2-shared.cjs");
const REPORT = path.join(__dirname, "silver-update-resolution-guard-v1-report.json");
function main() {
  const all = shared.buildCorpusV1(1100);
  const cases = all.filter(function (c) {
    return c.family.indexOf("update_") === 0;
  });
  const res = shared.runAudit("silver_update_resolution_guard_v1", cases, REPORT);
  const ok =
    res.report.false_create_count === 0 &&
    res.report.tier_a_pass === res.report.tier_a_total &&
    shared.printAuditHeader("silver_update_resolution_v1", res.report, 90);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
