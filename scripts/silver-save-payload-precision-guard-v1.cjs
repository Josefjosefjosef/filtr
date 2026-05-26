#!/usr/bin/env node
"use strict";
const { execSync } = require("child_process");
const path = require("path");
const REPO = path.resolve(__dirname, "..");
const SCRIPT = path.join(__dirname, "silver-save-payload-precision-production-line-v1.cjs");

function main() {
  let out = "";
  let exitCode = 0;
  try {
    out = execSync("node " + JSON.stringify(SCRIPT), {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 900000,
      env: Object.assign({}, process.env, { CSPP_V1_CASES_PER_FAMILY: "580" }),
    });
  } catch (e) {
    exitCode = e.status || 1;
    out = String(e.stdout || "") + String(e.stderr || "");
  }
  process.stdout.write(out);
  const ok = /PASS_FAIL=PASS/.test(out) && exitCode === 0;
  console.log("=== SILVER_SAVE_PAYLOAD_PRECISION_GUARD_V1 ===");
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_SAVE_PAYLOAD_PRECISION_GUARD_V1 ===");
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
