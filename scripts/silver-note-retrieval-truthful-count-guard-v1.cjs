#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-note-retrieval-platform-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-note-retrieval-truthful-count-guard-v1-report.json");
function main() {
  const all = shared.buildCorpusV1(1500);
  const cases = all.filter(function (c) {
    return c.mode === "topic_list" || c.mode === "list_all";
  });
  const res = shared.runAudit("note_retrieval_truthful_count_guard", cases, REPORT);
  const ff = res.report.fail_families || {};
  const ok =
    (ff.truthful_count_fail || 0) === 0 &&
    res.report.dangerous_write_count === 0 &&
    shared.printAuditHeader("note_retrieval_truthful_count_guard", res.report, 85);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
