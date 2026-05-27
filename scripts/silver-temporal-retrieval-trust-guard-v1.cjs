#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-product-trust-layer-v2-shared.cjs");
const REPORT = path.join(__dirname, "silver-temporal-retrieval-trust-guard-v1-report.json");
function main() {
  const all = shared.buildCorpusV1(1100);
  const cases = all.filter(function (c) {
    return (
      c.family.indexOf("temporal_") === 0 ||
      c.family === "date_correctness_validation"
    );
  });
  const res = shared.runAudit("silver_temporal_retrieval_trust_guard_v1", cases, REPORT);
  const ok = res.report.wrong_day_count === 0 && shared.printAuditHeader("silver_temporal_retrieval_trust_v1", res.report, 95);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
