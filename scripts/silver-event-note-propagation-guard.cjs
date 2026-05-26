#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const shared = require("./silver-orchestration-payload-governance-v3-shared.cjs");

const REPORT = path.join(__dirname, "silver-event-note-propagation-guard-report.json");

const EVENT_NOTE_CASES = shared.EMBEDDED_REMINDER_REAL_UX.filter(function (c) {
  return (
    c.input.indexOf("poznam") >= 0 ||
    c.input.indexOf("poznám") >= 0 ||
    c.input.indexOf("napiš") >= 0 ||
    c.input.indexOf("napis") >= 0
  );
}).concat([
  {
    id: "EN11",
    input: "Ulož meeting zítra a napiš do poznámky adresu kanceláře",
    noteNeed: ["adres", "kancel"]
  },
  {
    id: "EN12",
    input: "Přidej poradu a napiš do poznámky že klient přijde pozdě",
    noteNeed: ["pozd", "klient"]
  }
]);

function main() {
  const eng = harness.loadEngine();
  const ctx = harness.ctxForCase("calendar_write");
  let pass = 0;
  let eventNoteLoss = 0;
  let notesCreateLeak = 0;
  const fails = [];

  for (let i = 0; i < EVENT_NOTE_CASES.length; i++) {
    const c = EVENT_NOTE_CASES[i];
    const r = shared.runEmbeddedCase(eng, c, ctx);
    if (r.intent === "notes.create") {
      notesCreateLeak++;
      r.pass = false;
      r.issues.push("event_note_leaked_to_notes_create");
    }
    if (r.pass) pass++;
    else {
      if (r.issues.indexOf("embedded_tail_drop") >= 0 || r.issues.some(function (x) {
        return x.indexOf("note_missing") === 0;
      })) {
        eventNoteLoss++;
      }
      if (fails.length < 20) fails.push({ id: c.id, issues: r.issues, intent: r.intent });
    }
  }

  const total = EVENT_NOTE_CASES.length;
  const acc = total ? Math.round((pass / total) * 10000) / 100 : 0;
  const ok = pass === total && eventNoteLoss === 0 && notesCreateLeak === 0;

  fs.writeFileSync(
    REPORT,
    JSON.stringify(
      {
        harness_id: "silver_event_note_propagation_guard_v3",
        main_commit: shared.mainCommit(),
        cases_total: total,
        pass_count: pass,
        event_note_loss_count: eventNoteLoss,
        notes_create_leak_count: notesCreateLeak,
        event_note_accuracy_pct: acc,
        fails: fails
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("=== SILVER_EVENT_NOTE_PROPAGATION_GUARD ===");
  console.log("cases_total=" + total);
  console.log("pass_count=" + pass);
  console.log("event_note_loss_count=" + eventNoteLoss);
  console.log("notes_create_leak_count=" + notesCreateLeak);
  console.log("event_note_accuracy_pct=" + acc);
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_EVENT_NOTE_PROPAGATION_GUARD ===");
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
