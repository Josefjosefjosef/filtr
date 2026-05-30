#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-note-retrieval-platform-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-note-retrieval-alias-guard-v1-report.json");
function main() {
  const cases = shared.filterFamily(shared.buildCorpusV1(600), ["alias"]);
  const res = shared.runAudit("note_retrieval_alias_guard", cases, REPORT);
  process.exit(shared.printAuditHeader("note_retrieval_alias_guard", res.report, 90) ? 0 : 1);
}
if (require.main === module) main();
