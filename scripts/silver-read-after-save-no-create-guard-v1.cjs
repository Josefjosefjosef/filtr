#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-read-create-firewall-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-read-after-save-no-create-guard-v1-report.json");
function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(220), ["read_after_save", "long_session_read_create_firewall"]);
  const res = shared.runAudit("silver_read_after_save_no_create_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_read_after_save_no_create_v1", res.report, 95) ? 0 : 1);
}
if (require.main === module) main();
