#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const SCRIPT = path.join(__dirname, "silver-chaotic-spoken-save-slot-ownership-audit-v1.cjs");

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
  process.stdout.write(out);
  const accM = out.match(/chaotic_save_slot_ownership_accuracy=([\d.]+)%/);
  const acc = accM ? parseFloat(accM[1]) : 0;
  const eventLeak = /event_note_leaked_to_notes_create_count=0/.test(out);
  const storageFp = /storage_disambiguation_false_positive_count=0/.test(out);
  const ok = eventLeak && storageFp && acc >= 76.5;
  console.log("=== SILVER_SLOT_OWNERSHIP_CONTRACT_GUARD ===");
  console.log("guard_id=silver_slot_ownership_contract_guard_v2");
  console.log("chaotic_save_slot_ownership_accuracy=" + acc);
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_SLOT_OWNERSHIP_CONTRACT_GUARD ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
