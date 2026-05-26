#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const SCRIPT = path.join(__dirname, "silver-late-stage-payload-overwrite-diagnostic.cjs");

function main() {
  let out = "";
  let code = 0;
  try {
    out = execSync("node " + JSON.stringify(SCRIPT), {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 600000
    });
  } catch (e) {
    code = e.status || 1;
    out = String(e.stdout || "") + String(e.stderr || "");
  }
  process.stdout.write(out);
  const collisions = /slot_collision_count=(\d+)/.exec(out);
  const count = collisions ? parseInt(collisions[1], 10) : 999;
  const ok = /PASS_FAIL=PASS/.test(out) && code === 0 && count === 0;
  console.log("=== SILVER_LATE_STAGE_OVERWRITE_GUARD ===");
  console.log("slot_collision_count=" + count);
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_LATE_STAGE_OVERWRITE_GUARD ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
