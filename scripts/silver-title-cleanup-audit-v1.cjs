#!/usr/bin/env node
/**
 * SILVER_TITLE_CLEANUP_AUDIT_V1 — title wrapper/temporal cleanup accuracy.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const shared = require("./silver-normalizer-field-ownership-v1-shared.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine } = harness;

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-title-cleanup-audit-v1-report.json");
const MIN_ACCURACY = parseFloat(process.env.STC_MIN_ACCURACY || "0.93");

function main() {
  const eng = loadEngine();
  const pack = shared.runTitlePack(eng);
  const rep = {
    harness_id: "silver_title_cleanup_audit_v1",
    main_commit: execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim(),
    title_cleanup_accuracy: pack.accuracy,
    real_ux_pass: pack.pass + "/" + pack.total,
    fails: pack.fails,
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2));
  console.log("=== SILVER_TITLE_CLEANUP_AUDIT_V1 ===");
  console.log("title_cleanup_accuracy=" + (pack.accuracy * 100).toFixed(2) + "%");
  console.log("real_ux_pass=" + pack.pass + "/" + pack.total);
  console.log("wrapper_leak_count=" + (pack.total - pack.pass));
  console.log("PASS_FAIL=" + (pack.accuracy >= MIN_ACCURACY ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_TITLE_CLEANUP_AUDIT_V1 ===");
  process.exit(pack.accuracy >= MIN_ACCURACY ? 0 : 1);
}

if (require.main === module) main();
