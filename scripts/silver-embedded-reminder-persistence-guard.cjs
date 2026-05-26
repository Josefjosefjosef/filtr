#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const shared = require("./silver-orchestration-payload-governance-v3-shared.cjs");

const REPORT = path.join(__dirname, "silver-embedded-reminder-persistence-guard-report.json");

function main() {
  const eng = harness.loadEngine();
  const ctx = harness.ctxForCase("calendar_write");
  const cases = shared.EMBEDDED_REMINDER_REAL_UX;
  let pass = 0;
  let tailLoss = 0;
  let companionPreempt = 0;
  const fails = [];

  for (let i = 0; i < cases.length; i++) {
    const r = shared.runEmbeddedCase(eng, cases[i], ctx);
    if (r.pass) pass++;
    else {
      if (r.issues.indexOf("embedded_tail_drop") >= 0) tailLoss++;
      if (r.issues.indexOf("companion_task_preempted_embedded_note") >= 0) companionPreempt++;
      if (fails.length < 20) fails.push({ id: cases[i].id, input: cases[i].input, issues: r.issues });
    }
  }

  const total = cases.length;
  const acc = total ? Math.round((pass / total) * 10000) / 100 : 0;
  const ok = pass === total && tailLoss === 0 && companionPreempt === 0;

  fs.writeFileSync(
    REPORT,
    JSON.stringify(
      {
        harness_id: "silver_embedded_reminder_persistence_guard_v3",
        main_commit: shared.mainCommit(),
        cases_total: total,
        pass_count: pass,
        embedded_tail_loss_count: tailLoss,
        companion_preempt_count: companionPreempt,
        embedded_reminder_accuracy_pct: acc,
        fails: fails
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("=== SILVER_EMBEDDED_REMINDER_PERSISTENCE_GUARD ===");
  console.log("cases_total=" + total);
  console.log("pass_count=" + pass);
  console.log("embedded_tail_loss_count=" + tailLoss);
  console.log("companion_preempt_count=" + companionPreempt);
  console.log("embedded_reminder_accuracy_pct=" + acc);
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_EMBEDDED_REMINDER_PERSISTENCE_GUARD ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
