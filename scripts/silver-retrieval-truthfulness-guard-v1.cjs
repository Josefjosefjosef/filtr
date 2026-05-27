#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-product-trust-layer-v2-shared.cjs");
const REPORT = path.join(__dirname, "silver-retrieval-truthfulness-guard-v1-report.json");
function main() {
  const all = shared.buildCorpusV1(1100);
  const cases = all.filter(function (c) {
    return c.family === "retrieval_truthfulness" || c.family === "no_hallucinated_retrieval";
  });
  const res = shared.runAudit("silver_retrieval_truthfulness_guard_v1", cases, REPORT);
  const ok = res.report.hallucination_count === 0 && shared.printAuditHeader("silver_retrieval_truthfulness_v1", res.report, 90);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
