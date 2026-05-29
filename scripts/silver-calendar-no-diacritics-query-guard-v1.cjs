#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-calendar-no-diacritics-query-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-calendar-no-diacritics-query-guard-v1-report.json");
const TARGET = parseInt(process.env.SILVER_CALENDAR_NO_DIACRITICS_CASES || "5000", 10);

function main() {
  const cases = shared.buildCorpusV1(TARGET);
  const res = shared.runAudit("silver_calendar_no_diacritics_query_guard_v1", cases, REPORT);
  const ok = shared.printGuardHeader("silver_calendar_no_diacritics_query_guard_v1", res.report, 99);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
