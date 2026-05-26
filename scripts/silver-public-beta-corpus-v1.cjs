#!/usr/bin/env node
/**
 * SILVER_PUBLIC_BETA_CORPUS_V1 — 100k+ deterministic replay cases (broken/spoken/mobile Czech).
 */
"use strict";

const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const TOTAL = parseInt(process.env.SPG_PUBLIC_BETA_CORPUS_CASES || "100000", 10);

function main() {
  const env = Object.assign({}, process.env, {
    RHC_V3_TOTAL_CASES: String(TOTAL),
    RHC_V3_REPORT_JSON: path.join(__dirname, "silver-public-beta-corpus-v1-report.json")
  });
  let out = "";
  let code = 0;
  try {
    out = execSync("node " + JSON.stringify(path.join("scripts", "silver-real-human-chaos-v3.cjs")), {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      timeout: 900000,
      env
    });
  } catch (e) {
    code = e.status || 1;
    out = String(e.stdout || "") + String(e.stderr || "");
  }
  process.stdout.write(out);
  const passMatch = out.match(/PASS_FAIL=(PASS|FAIL)/g);
  const pf = passMatch && passMatch.length ? passMatch[passMatch.length - 1].split("=")[1] : code === 0 ? "PASS" : "FAIL";
  const totalM = out.match(/total_cases=(\d+)/);
  const spokenM = out.match(/spoken_czech_cases=(\d+)/);
  const mobileM = out.match(/mobile_chaos_cases=(\d+)/);
  const interruptM = out.match(/interruption_cases=(\d+)/);
  const switchM = out.match(/save_query_switch_cases=(\d+)/);

  console.log("=== SILVER_PUBLIC_BETA_CORPUS_V1 ===");
  console.log("total_cases=" + (totalM ? totalM[1] : String(TOTAL)));
  console.log("spoken_czech_cases=" + (spokenM ? spokenM[1] : "0"));
  console.log("mobile_chaos_cases=" + (mobileM ? mobileM[1] : "0"));
  console.log("interruption_cases=" + (interruptM ? interruptM[1] : "0"));
  console.log("save_query_switch_cases=" + (switchM ? switchM[1] : "0"));
  console.log("PASS_FAIL=" + pf);
  console.log("=== END_SILVER_PUBLIC_BETA_CORPUS_V1 ===");
  process.exit(pf === "PASS" ? 0 : 1);
}

if (require.main === module) main();
