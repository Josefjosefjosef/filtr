#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-note-retrieval-platform-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-note-retrieval-exact-answer-guard-v1-report.json");
function main() {
  const all = shared.buildCorpusV1(1500);
  const cases = all.filter(function (c) {
    return c.mode === "exact_answer" && c.tier !== "B";
  });
  const res = shared.runAudit("note_retrieval_exact_answer_guard", cases, REPORT);
  const ff = res.report.fail_families || {};
  const ok =
    (ff.answer_vs_list_fail || 0) === 0 &&
    (ff.attribute_extraction_fail || 0) === 0 &&
    shared.printAuditHeader("note_retrieval_exact_answer_guard", res.report, 85);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
