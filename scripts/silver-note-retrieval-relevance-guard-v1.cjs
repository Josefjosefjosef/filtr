#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-note-retrieval-platform-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-note-retrieval-relevance-guard-v1-report.json");
function main() {
  const all = shared.buildCorpusV1(1200);
  const cases = all.filter(function (c) {
    return c.expectNotRx && c.tier !== "B";
  });
  const res = shared.runAudit("note_retrieval_relevance_guard", cases, REPORT);
  const ff = res.report.fail_families || {};
  const ok =
    (ff.topic_pollution_fail || 0) === 0 &&
    (ff.relevance_cutoff_fail || 0) === 0 &&
    shared.printAuditHeader("note_retrieval_relevance_guard", res.report, 85);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
