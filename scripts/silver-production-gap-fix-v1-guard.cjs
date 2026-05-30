#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const diag = require("./silver-production-gap-fix-v1-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-production-gap-fix-v1-guard-report.json");
const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const TASK_FAMILY = diag.GAP_A.family;
const NOTES_RECALL_FAMILY = [
  "Co jsem si poznamenal o autě",
  "Co mám poznamenané o autě",
  "Co jsem si uložil o autě",
  "Co mám uložené o autě",
  "Co vím o autě",
  "Co víš o autě",
  "Mám něco o autě",
  "Ohledně auta",
  "K autu",
  "Informace o autě"
];

const DIAKRITIKA_FAMILY = [
  { input: "Kdy má Tomáš narozeniny", expectRx: /Tomáš|květen/i },
  { input: "Jakou má stůl šířku", expectRx: /stůl/i },
  { input: "Heslo k wifi", expectRx: /wifi|heslo/i },
  { input: "Barva tašky", expectRx: /taška|červen/i },
  { input: "Adresa Botanické zahrady", expectRx: /Botanick|Vinohradsk/i }
];

function evaluateSafety(eng, ctx) {
  let dangerous_write_count = 0;
  let false_write_count = 0;
  let write_when_negated_count = 0;
  const allInputs = TASK_FAMILY.concat(NOTES_RECALL_FAMILY).concat(
    DIAKRITIKA_FAMILY.map(function (d) {
      return d.input;
    })
  );
  for (let i = 0; i < allInputs.length; i++) {
    const input = allInputs[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    if (WRITE_INTENTS.has(intent)) {
      dangerous_write_count++;
      false_write_count++;
    }
    if (turn.processingState === "READY_TO_SAVE") false_write_count++;
    if (/\bne\s+(?:ukladej|vytvarej|pridavej)\b/i.test(input) && WRITE_INTENTS.has(intent)) {
      write_when_negated_count++;
    }
  }
  return { dangerous_write_count: dangerous_write_count, false_write_count: false_write_count, write_when_negated_count: write_when_negated_count };
}

function main() {
  const eng = loadEngine();
  const ctx = diag.seedCtx();

  const taskRows = diag.evaluateTaskFamily(eng, ctx, diag.GAP_A);
  const noteRows = [];
  for (let i = 0; i < NOTES_RECALL_FAMILY.length; i++) {
    const input = NOTES_RECALL_FAMILY[i];
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    const msg = diag.turnMsg(turn);
    const pass =
      intent === "notes.read" && !/Nic jsem k tomu nena[sš]el/i.test(msg) && /auto|modr/i.test(msg);
    noteRows.push({ input: input, observed: intent, message: msg.slice(0, 160), pass: pass });
  }

  const diaRows = [];
  for (let i = 0; i < DIAKRITIKA_FAMILY.length; i++) {
    const item = DIAKRITIKA_FAMILY[i];
    const turn = eng.processUserTurn(item.input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    const msg = diag.turnMsg(turn);
    const leak = diag.asciiLeak(msg);
    const pass =
      intent === "notes.read" &&
      !/Nic jsem k tomu nena[sš]el/i.test(msg) &&
      item.expectRx.test(msg) &&
      !leak;
    diaRows.push({ input: item.input, observed: intent, message: msg.slice(0, 160), ascii_leak: leak, pass: pass });
  }

  const safety = evaluateSafety(eng, ctx);
  const taskPass = taskRows.every(function (r) {
    return r.pass;
  });
  const notesPass = noteRows.every(function (r) {
    return r.pass;
  });
  const diaPass = diaRows.every(function (r) {
    return r.pass;
  });
  const safetyPass =
    safety.dangerous_write_count === 0 &&
    safety.false_write_count === 0 &&
    safety.write_when_negated_count === 0;
  const ok = taskPass && notesPass && diaPass && safetyPass;

  const report = {
    guard_id: "silver_production_gap_fix_v1_guard",
    task_family_pass: taskPass,
    notes_recall_family_pass: notesPass,
    diacritics_family_pass: diaPass,
    safety_counters: safety,
    task_rows: taskRows,
    notes_rows: noteRows,
    diacritics_rows: diaRows,
    PASS_FAIL: ok ? "PASS" : "FAIL"
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_PRODUCTION_GAP_FIX_V1_GUARD ===");
  console.log("TASK_FAMILY_PASS=" + (taskPass ? "YES" : "NO"));
  console.log("NOTES_RECALL_FAMILY_PASS=" + (notesPass ? "YES" : "NO"));
  console.log("DIAKRITIKA_FAMILY_PASS=" + (diaPass ? "YES" : "NO"));
  console.log("dangerous_write_count=" + safety.dangerous_write_count);
  console.log("false_write_count=" + safety.false_write_count);
  console.log("write_when_negated_count=" + safety.write_when_negated_count);
  console.log("report_path=" + REPORT_PATH);
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END_SILVER_PRODUCTION_GAP_FIX_V1_GUARD ===");

  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
