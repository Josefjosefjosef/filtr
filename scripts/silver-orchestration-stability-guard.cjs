#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const SCRIPTS = [
  "silver-multi-module-orchestration-audit-v1.cjs",
  "silver-session-state-governance-audit-v1.cjs",
  "silver-primary-secondary-intent-guard.cjs"
];

function main() {
  let ok = true;
  for (let i = 0; i < SCRIPTS.length; i++) {
    let out = "";
    let code = 0;
    try {
      out = execSync("node " + JSON.stringify(path.join(__dirname, SCRIPTS[i])), {
        cwd: REPO,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 600000
      });
    } catch (e) {
      code = e.status || 1;
      out = String(e.stdout || "") + String(e.stderr || "");
      ok = false;
    }
    process.stdout.write(out);
    if (!/PASS_FAIL=PASS/.test(out) && !/accuracy_pct=100/.test(out)) ok = false;
    if (code !== 0 && !/accuracy_pct=100/.test(out)) ok = false;
  }
  console.log("=== SILVER_ORCHESTRATION_STABILITY_GUARD ===");
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_ORCHESTRATION_STABILITY_GUARD ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
