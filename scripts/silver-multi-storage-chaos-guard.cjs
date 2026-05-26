#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const shared = require("./silver-orchestration-payload-governance-v3-shared.cjs");

const REPORT = path.join(__dirname, "silver-multi-storage-chaos-guard-report.json");

function main() {
  const eng = harness.loadEngine();
  const ctx = harness.ctxForCase("calendar_write");
  const cases = shared.MULTI_STORAGE_CHAOS_PACK;
  let pass = 0;
  let calendarTaskMix = 0;
  let noteTaskMix = 0;
  const fails = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const r = shared.runMultiStorageCase(eng, c, ctx);
    if (r.pass) pass++;
    else {
      if (c.expect === "mixed_calendar" && r.intent !== "calendar.create") calendarTaskMix++;
      if (c.expect === "notes" && r.intent !== "notes.create") noteTaskMix++;
      if (fails.length < 20) fails.push({ id: c.id, issues: r.issues, intent: r.intent });
    }
  }

  const total = cases.length;
  const acc = total ? Math.round((pass / total) * 10000) / 100 : 0;
  const ok = pass === total;

  fs.writeFileSync(
    REPORT,
    JSON.stringify(
      {
        harness_id: "silver_multi_storage_chaos_guard_v3",
        main_commit: shared.mainCommit(),
        cases_total: total,
        pass_count: pass,
        calendar_task_mix_fail_count: calendarTaskMix,
        note_task_mix_fail_count: noteTaskMix,
        multi_storage_accuracy_pct: acc,
        fails: fails
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("=== SILVER_MULTI_STORAGE_CHAOS_GUARD ===");
  console.log("cases_total=" + total);
  console.log("pass_count=" + pass);
  console.log("calendar_task_mix_fail_count=" + calendarTaskMix);
  console.log("note_task_mix_fail_count=" + noteTaskMix);
  console.log("multi_storage_accuracy_pct=" + acc);
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_MULTI_STORAGE_CHAOS_GUARD ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
