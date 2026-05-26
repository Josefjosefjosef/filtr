#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const corpus = require("./silver-screenshot-governance-v1-shared.cjs");
const guard = require("./silver-screenshot-help-guard-v1-shared.cjs");

const TARGET = parseInt(process.env.SILVER_PRIVACY_STORAGE_CASES || "800", 10);
const REPORT = path.join(__dirname, "silver-help-privacy-storage-governance-guard-v1-report.json");
const MIN_PCT = parseFloat(process.env.SILVER_PRIVACY_STORAGE_MIN_PCT || "99", 10);

function main() {
  const cases = corpus.buildPrivacyStorageCorpusV1(TARGET);
  const res = guard.runScreenshotHelpGuardV1({
    packName: "privacy_storage",
    harnessId: "silver_help_privacy_storage_governance_v1",
    reportPath: REPORT,
    criticalInputs: corpus.CRITICAL_SCREENSHOT_PACK.privacy_storage,
    corpusCases: cases,
    minPct: MIN_PCT,
    extra: { privacy_storage_cases: cases.length }
  });
  fs.writeFileSync(REPORT, JSON.stringify(res.report, null, 2), "utf8");
  guard.printScreenshotHelpGuardHeader("silver_help_privacy_storage_governance_v1", res.report);
  if (!res.ok) console.log("min_pass_pct=" + MIN_PCT);
  process.exit(res.ok ? 0 : 1);
}

if (require.main === module) main();
