#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const path = require("path");

const REPO = path.resolve(__dirname, "..");

const LOCKS = [
  "silver-reminder-semantics-regression-guard.cjs",
  "silver-task-vs-calendar-ownership-regression-guard.cjs",
  "silver-conversational-continuation-regression-guard.cjs",
  "silver-conversational-memory-regression-guard.cjs",
  "silver-interrupted-flow-recovery-regression-guard.cjs",
  "silver-persistence-recovery-regression-guard.cjs",
  "silver-historical-reference-regression-guard.cjs",
  "silver-draft-lifecycle-regression-guard.cjs",
  "silver-assistant-capability-regression-guard.cjs",
  "silver-help-onboarding-regression-guard.cjs",
  "silver-agenda-continuity-regression-guard.cjs",
  "silver-query-safety-regression-guard.cjs",
  "silver-production-line-v2-regression-guard.cjs"
];

function main() {
  const results = [];
  let pass = 0;
  for (let i = 0; i < LOCKS.length; i++) {
    const script = path.join(__dirname, LOCKS[i]);
    let ok = false;
    let detail = "";
    try {
      const out = execSync("node " + JSON.stringify(script), {
        cwd: REPO,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        timeout: 600000
      });
      ok = /PASS_FAIL=PASS/.test(out);
      detail = ok ? "PASS" : "FAIL_OUTPUT";
    } catch (e) {
      detail = "EXIT_" + (e.status || 1);
    }
    results.push({ guard: LOCKS[i], ok: ok, detail: detail });
    if (ok) pass++;
  }
  console.log("=== SILVER_PERMANENT_INVARIANT_LOCKS_V1 ===");
  console.log("locks_total=" + LOCKS.length);
  console.log("locks_pass=" + pass);
  console.log("locks_fail=" + (LOCKS.length - pass));
  for (let j = 0; j < results.length; j++) {
    console.log("lock_" + results[j].guard + "=" + (results[j].ok ? "PASS" : "FAIL") + "(" + results[j].detail + ")");
  }
  console.log("PASS_FAIL=" + (pass === LOCKS.length ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_PERMANENT_INVARIANT_LOCKS_V1 ===");
  process.exit(pass === LOCKS.length ? 0 : 1);
}

if (require.main === module) main();

module.exports = { LOCKS };
