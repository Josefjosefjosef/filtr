#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-product-trust-layer-v2-shared.cjs");
const REPORT = path.join(__dirname, "silver-person-alias-resolution-guard-v1-report.json");
function main() {
  const all = shared.buildCorpusV1(1100);
  const cases = all.filter(function (c) {
    return (
      c.family === "person_alias_resolution" ||
      c.family === "nickname_retrieval_matching" ||
      c.family === "alias_ambiguity_safety"
    );
  });
  const res = shared.runAudit("silver_person_alias_resolution_guard_v1", cases, REPORT);
  const ok = res.report.alias_fail_count === 0 && shared.printAuditHeader("silver_person_alias_resolution_v1", res.report, 90);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
