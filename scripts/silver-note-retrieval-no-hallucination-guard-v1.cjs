#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-note-retrieval-platform-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-note-retrieval-no-hallucination-guard-v1-report.json");
function main() {
  const all = shared.buildCorpusV1(800);
  const cases = all.filter(function (c) {
    return c.expectEmpty || c.family === "device_password";
  });
  const res = shared.runAudit("note_retrieval_no_hallucination_guard", cases, REPORT);
  const ff = res.report.fail_families || {};
  const ok =
    (ff.hallucination_fail || 0) === 0 &&
    shared.printAuditHeader("note_retrieval_no_hallucination_guard", res.report, 90);
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
