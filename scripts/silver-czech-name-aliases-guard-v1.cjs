#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-product-trust-layer-v2-shared.cjs");
const REPORT = path.join(__dirname, "silver-czech-name-aliases-guard-v1-report.json");
function main() {
  const all = shared.buildCorpusV1(1100);
  const cases = all.filter(function (c) {
    return c.family === "czech_name_aliases_male" || c.family === "czech_name_aliases_female";
  });
  const res = shared.runAudit("silver_czech_name_aliases_guard_v1", cases, REPORT);
  const ok = shared.printAuditHeader("silver_czech_name_aliases_v1", res.report, 85);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
