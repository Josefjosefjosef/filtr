#!/usr/bin/env node
/**
 * silver-production-line-v2-regression-guard.cjs
 * Permanent guard: production_line_v2 must stay PASS.
 */
"use strict";

const { execSync } = require("child_process");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const SCRIPT = path.join(__dirname, "silver-clean-save-payload-production-line-v2.cjs");

function main() {
  let out = "";
  let exitCode = 0;
  try {
    out = execSync("node " + JSON.stringify(SCRIPT), {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 600000
    });
  } catch (e) {
    exitCode = e.status || 1;
    out = String(e.stdout || "") + String(e.stderr || "");
  }

  const passMatch = out.match(/PASS_FAIL=(PASS|FAIL)/);
  const passFail = passMatch ? passMatch[1] : exitCode === 0 ? "PASS" : "FAIL";
  const ok = passFail === "PASS" && exitCode === 0;

  console.log("=== SILVER_PRODUCTION_LINE_V2_REGRESSION_GUARD ===");
  console.log("guard_id=silver_production_line_v2_regression_guard_v1");
  console.log("script=silver-clean-save-payload-production-line-v2.cjs");
  console.log("before_target=PASS");
  console.log("after_target=PASS");
  if (!ok) {
    const failLine = out.split("\n").find((l) => /first_fail|FAIL|error/i.test(l)) || "(see production line output)";
    console.log("first_fail=" + failLine.trim());
  } else {
    console.log("first_fail=(none)");
  }
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_PRODUCTION_LINE_V2_REGRESSION_GUARD ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
