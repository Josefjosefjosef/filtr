#!/usr/bin/env node
/**
 * SILVER_NORMALIZER_TITLE_CLEANING_V1 — full production-line audit.
 */
"use strict";

const path = require("path");
const shared = require("./silver-normalizer-title-cleaning-v1-shared.cjs");

const REPORT = path.join(__dirname, "silver-normalizer-title-cleaning-v1-report.json");

function main() {
  const res = shared.runTitleCleaningAudit({
    harnessId: "silver_normalizer_title_cleaning_v1",
    reportFile: path.basename(REPORT),
    targetCases: parseInt(process.env.SNTC_CASES || "800", 10),
  });
  shared.printBanner("SILVER_NORMALIZER_TITLE_CLEANING_V1", res);
  console.log("NEW_AUDIT_FAMILIES=" + shared.AUDIT_FAMILIES.join(","));
  console.log("replay_guards_added=" + shared.TIER_A_REPLAY_PACK.length);
  process.exit(res.ok ? 0 : 1);
}

if (require.main === module) main();
