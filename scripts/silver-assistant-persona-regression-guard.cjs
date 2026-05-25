#!/usr/bin/env node
"use strict";
const { execSync } = require("child_process");
const path = require("path");
const REPO = path.resolve(__dirname, "..");
const SCRIPT = path.join(__dirname, "silver-assistant-persona-audit-v1.cjs");
function main() {
  let out = "";
  let exitCode = 0;
  try {
    out = execSync("node " + JSON.stringify(SCRIPT), { cwd: REPO, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
  } catch (e) {
    exitCode = e.status || 1;
    out = String(e.stdout || "") + String(e.stderr || "");
  }
  process.stdout.write(out);
  const passMatch = out.match(/PASS_FAIL=(PASS|FAIL)/);
  const ok = (passMatch ? passMatch[1] : exitCode === 0 ? "PASS" : "FAIL") === "PASS" && exitCode === 0;
  console.log("=== SILVER_ASSISTANT_PERSONA_REGRESSION_GUARD ===");
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_ASSISTANT_PERSONA_REGRESSION_GUARD ===");
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
