#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const saveShared = require("./silver-save-understanding-audit-shared.cjs");
const shared = require("./silver-orchestration-payload-governance-v3-shared.cjs");

const REPORT = path.join(__dirname, "silver-orchestration-ordering-guard-report.json");

function main() {
  const eng = harness.loadEngine();
  const ctx = harness.ctxForCase("calendar_write");
  const cases = shared.ORCHESTRATION_ORDERING_CASES;
  let pass = 0;
  const fails = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    let r;
    if (c.expect === "mixed_calendar" || c.noteNeed || c.forbidCompanion) {
      r = shared.runEmbeddedCase(eng, Object.assign({ expect: "mixed_calendar" }, c), ctx);
    } else {
      r = saveShared.runCase(eng, c, ctx);
    }
    if (r.pass) pass++;
    else if (fails.length < 20) fails.push({ id: c.id, issues: r.issues, intent: r.intent });
  }

  const total = cases.length;
  const ok = pass === total;

  fs.writeFileSync(
    REPORT,
    JSON.stringify(
      {
        harness_id: "silver_orchestration_ordering_guard_v3",
        main_commit: shared.mainCommit(),
        cases_total: total,
        pass_count: pass,
        fails: fails
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("=== SILVER_ORCHESTRATION_ORDERING_GUARD ===");
  console.log("cases_total=" + total);
  console.log("pass_count=" + pass);
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_ORCHESTRATION_ORDERING_GUARD ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
