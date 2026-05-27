#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-conversational-product-understanding-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_HALLUCINATION_CASES || "2000", 10);
const REPORT = path.join(__dirname, "silver-hallucination-prevention-guard-v1-report.json");

function main() {
  const all = shared.buildCorpusV1(TARGET);
  const cases = all.filter(function (c) {
    return c.family === "hallucination_prevention_queries" || c.mode === "retrieval_empty";
  });
  const res = shared.runAudit("silver_hallucination_prevention_guard_v1", cases, REPORT);
  const ok =
    res.report.hallucination_leaks === 0 &&
    shared.printAuditHeader("silver_hallucination_prevention_v1", res.report, 99);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
