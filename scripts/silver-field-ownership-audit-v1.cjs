#!/usr/bin/env node
/**
 * SILVER_FIELD_OWNERSHIP_AUDIT_V1 — field isolation real UX pack.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const shared = require("./silver-normalizer-field-ownership-v1-shared.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine } = harness;

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-field-ownership-audit-v1-report.json");
const MIN_ACCURACY = parseFloat(process.env.SFO_MIN_ACCURACY || "0.95");

function main() {
  const eng = loadEngine();
  const pack = shared.runFieldIsolationPack(eng);
  const rep = {
    harness_id: "silver_field_ownership_audit_v1",
    main_commit: execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim(),
    field_isolation_accuracy: pack.accuracy,
    real_ux_pass: pack.pass + "/" + pack.total,
    fails: pack.fails,
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2));
  console.log("=== SILVER_FIELD_OWNERSHIP_AUDIT_V1 ===");
  console.log("field_isolation_accuracy=" + (pack.accuracy * 100).toFixed(2) + "%");
  console.log("real_ux_pass=" + pack.pass + "/" + pack.total);
  console.log("PASS_FAIL=" + (pack.accuracy >= MIN_ACCURACY ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_FIELD_OWNERSHIP_AUDIT_V1 ===");
  process.exit(pack.accuracy >= MIN_ACCURACY ? 0 : 1);
}

if (require.main === module) main();
