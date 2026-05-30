#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-note-retrieval-platform-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-note-retrieval-topic-guard-v1-report.json");
function main() {
  const cases = shared.filterFamily(shared.buildCorpusV1(800), [
    "topic_list",
    "metamorphic_topic"
  ]);
  const res = shared.runAudit("note_retrieval_topic_guard", cases, REPORT);
  process.exit(shared.printAuditHeader("note_retrieval_topic_guard", res.report, 85) ? 0 : 1);
}
if (require.main === module) main();
