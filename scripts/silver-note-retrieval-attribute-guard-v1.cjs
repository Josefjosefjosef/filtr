#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-note-retrieval-platform-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-note-retrieval-attribute-guard-v1-report.json");
function main() {
  const all = shared.buildCorpusV1(1200);
  const cases = all.filter(function (c) {
    return (
      (c.family === "person_attribute" ||
        c.family === "object_attribute" ||
        c.family === "place_address" ||
        c.family === "device_password") &&
      c.tier !== "B"
    );
  });
  const res = shared.runAudit("note_retrieval_attribute_guard", cases, REPORT);
  process.exit(shared.printAuditHeader("note_retrieval_attribute_guard", res.report, 85) ? 0 : 1);
}
if (require.main === module) main();
