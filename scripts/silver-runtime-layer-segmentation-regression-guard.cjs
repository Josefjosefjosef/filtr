#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const path = require("path");

const SCRIPT = path.join(__dirname, "silver-runtime-layer-segmentation-diagnostic-v1.cjs");

function main() {
  let out = "";
  let code = 0;
  try {
    out = execSync("node " + JSON.stringify(SCRIPT), {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024
    });
  } catch (e) {
    code = e.status || 1;
    out = String(e.stdout || "") + String(e.stderr || "");
  }
  const ok = /PASS_FAIL=PASS/.test(out) && code === 0;
  console.log("=== SILVER_RUNTIME_LAYER_SEGMENTATION_REGRESSION_GUARD ===");
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_RUNTIME_LAYER_SEGMENTATION_REGRESSION_GUARD ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
