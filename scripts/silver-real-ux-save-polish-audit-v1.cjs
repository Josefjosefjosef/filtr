#!/usr/bin/env node
/**
 * SILVER_REAL_UX_SAVE_POLISH_AUDIT_V1 — combined title + field isolation real UX.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const shared = require("./silver-normalizer-field-ownership-v1-shared.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine } = harness;

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-real-ux-save-polish-audit-v1-report.json");

function main() {
  const eng = loadEngine();
  const title = shared.runTitlePack(eng);
  const field = shared.runFieldIsolationPack(eng);
  const combined = title.pass + field.pass;
  const total = title.total + field.total;
  const accuracy = total ? combined / total : 1;
  const rep = {
    harness_id: "silver_real_ux_save_polish_audit_v1",
    main_commit: execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim(),
    combined_accuracy: accuracy,
    title_pass: title.pass + "/" + title.total,
    field_pass: field.pass + "/" + field.total,
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2));
  const ok = accuracy >= 0.94;
  console.log("=== SILVER_REAL_UX_SAVE_POLISH_AUDIT_V1 ===");
  console.log("combined_accuracy=" + (accuracy * 100).toFixed(2) + "%");
  console.log("title_pass=" + rep.title_pass);
  console.log("field_pass=" + rep.field_pass);
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_REAL_UX_SAVE_POLISH_AUDIT_V1 ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
