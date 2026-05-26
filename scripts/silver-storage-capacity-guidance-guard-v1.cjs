#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const corpus = require("./silver-screenshot-governance-v1-shared.cjs");
const guard = require("./silver-screenshot-help-guard-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_STORAGE_CAPACITY_CASES || "600", 10);
const REPORT = path.join(__dirname, "silver-storage-capacity-guidance-guard-v1-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_STORAGE_CAPACITY_MIN_PCT || "99", 10);

function main() {
  const cases = corpus.buildStorageCapacityCorpusV1(TARGET);
  const res = guard.runScreenshotHelpGuardV1({
    packName: "storage_capacity",
    harnessId: "silver_storage_capacity_guidance_v1",
    reportPath: REPORT,
    criticalInputs: corpus.CRITICAL_SCREENSHOT_PACK.storage_capacity,
    corpusCases: cases,
    minPct: MIN_PCT,
    extra: { storage_capacity_cases: cases.length }
  });
  fs.writeFileSync(REPORT, JSON.stringify(res.report, null, 2), "utf8");
  guard.printScreenshotHelpGuardHeader("silver_storage_capacity_guidance_v1", res.report);
  if (!res.ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(res.ok ? 0 : 1);
}

if (require.main === module) main();
