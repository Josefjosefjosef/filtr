#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const diag = require("./silver-explicit-save-prefix-routing-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-explicit-save-prefix-routing-guard-report.json");
const WRITE_INTENTS = new Set(["calendar.create", "tasks.create", "notes.create", "create.storage_disambiguation"]);

const NEGATION_SAFETY_FAMILY = [
  "Do kalendáře nic neukládej, jen se podívej na zubaře",
  "Připomeň mi nic neukládej, jen se podívej na úkoly",
  "Do poznámek nic neukládej, jen přečti poznámky"
];

const REGRESSION_READ_FAMILY = [
  { input: "Kdy mám zubaře", expected: "calendar.read" },
  { input: "Jaké mám úkoly", expected: "tasks.read" },
  { input: "Co mám o autě", expected: "notes.read" },
  { input: "Co mám rozdělané", expected: "tasks.read" },
  { input: "Co jsem si poznamenal o autě", expected: "notes.read" },
  { input: "Jakou má stůl šířku", expected: "notes.read", expectRx: /stůl/i }
];

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function turnMsg(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
}

function evaluateNegationSafety(eng, ctx) {
  const rows = [];
  for (let i = 0; i < NEGATION_SAFETY_FAMILY.length; i++) {
    const input = NEGATION_SAFETY_FAMILY[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    const isWrite = WRITE_INTENTS.has(intent) || turn.processingState === "READY_TO_SAVE";
    const pass = !isWrite;
    rows.push({ input: input, observed: intent, processingState: turn.processingState, pass: pass });
  }
  return rows;
}

function evaluateRegressionReads(eng, ctx) {
  const notes = [
    { id: "n_auto", title: "Auto", content: "auto mělo modrou barvu", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n_stul", title: "Stůl", content: "stůl má šířku 120 cm", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }
  ];
  const tasks = [
    { id: "t1", title: "koupit mléko", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t2", title: "posekat trávu", status: "in_progress", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 }
  ];
  const richCtx = {
    now: ctx.now,
    getEventsSnapshot: function () {
      return [];
    },
    getTasksSnapshot: function () {
      return tasks;
    },
    getNotesSnapshot: function () {
      return notes;
    }
  };
  const rows = [];
  for (let i = 0; i < REGRESSION_READ_FAMILY.length; i++) {
    const item = REGRESSION_READ_FAMILY[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(item.input, eng.createEmptyDraft(), richCtx);
    const intent = String(turn.normalizedIntent || "");
    const msg = turnMsg(turn);
    let pass = intent === item.expected;
    if (item.input === "Co mám o autě") pass = intent === "notes.read" && /auto|modr/i.test(msg);
    if (item.input === "Co jsem si poznamenal o autě") pass = intent === "notes.read" && /auto|modr/i.test(msg);
    if (item.input === "Co mám rozdělané") pass = intent === "tasks.read";
    if (item.expectRx) pass = pass && item.expectRx.test(msg) && !/\bstul\b/i.test(msg);
    rows.push({ input: item.input, expected: item.expected, observed: intent, message: msg.slice(0, 120), pass: pass });
  }
  return rows;
}

function evaluateSafetyCounters(eng, ctx) {
  let dangerous_write_count = 0;
  let false_write_count = 0;
  let write_when_negated_count = 0;
  let query_created_write_count = 0;
  const allInputs = NEGATION_SAFETY_FAMILY.concat(
    REGRESSION_READ_FAMILY.map(function (r) {
      return r.input;
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
    if (turn.processingState === "READY_TO_SAVE" && REGRESSION_READ_FAMILY.some(function (r) { return r.input === input; })) {
      false_write_count++;
      query_created_write_count++;
    }
    if (/\bne\s+(?:ukladej|vytvarej)\b/i.test(input) && WRITE_INTENTS.has(intent)) {
      write_when_negated_count++;
    }
  }
  return {
    dangerous_write_count: dangerous_write_count,
    false_write_count: false_write_count,
    write_when_negated_count: write_when_negated_count,
    query_created_write_count: query_created_write_count
  };
}

function main() {
  const eng = loadEngine();
  const ctx = diag.seedCtx();

  const calendarRows = diag.evaluateFamily(eng, ctx, diag.CALENDAR_FAMILY, "calendar.create", "calendar", ["Do kalendáře", "do kalendare"]);
  const taskRows = diag.evaluateFamily(eng, ctx, diag.TASK_FAMILY, "tasks.create", "task", ["Připomeň mi", "Připomeň", "pripomen mi", "pripomen"]);
  const noteRows = diag.evaluateFamily(eng, ctx, diag.NOTE_FAMILY, "notes.create", "note", ["Do poznámek", "Do poznámky", "do poznamek", "do poznamky"]);
  const negRows = evaluateNegationSafety(eng, ctx);
  const regRows = evaluateRegressionReads(eng, ctx);
  const safety = evaluateSafetyCounters(eng, ctx);

  const prefixPass =
    calendarRows.every(function (r) { return r.pass; }) &&
    taskRows.every(function (r) { return r.pass; }) &&
    noteRows.every(function (r) { return r.pass; });
  const negPass = negRows.every(function (r) { return r.pass; });
  const regPass = regRows.every(function (r) { return r.pass; });
  const safetyPass =
    safety.dangerous_write_count === 0 &&
    safety.false_write_count === 0 &&
    safety.write_when_negated_count === 0 &&
    safety.query_created_write_count === 0;
  const ok = prefixPass && negPass && regPass && safetyPass;

  const report = {
    guard_id: "silver_explicit_save_prefix_routing_guard",
    calendar_family_pass: calendarRows.every(function (r) { return r.pass; }),
    task_family_pass: taskRows.every(function (r) { return r.pass; }),
    note_family_pass: noteRows.every(function (r) { return r.pass; }),
    negation_safety_pass: negPass,
    regression_read_pass: regPass,
    safety_counters: safety,
    calendar_rows: calendarRows,
    task_rows: taskRows,
    note_rows: noteRows,
    negation_rows: negRows,
    regression_rows: regRows,
    PASS_FAIL: ok ? "PASS" : "FAIL"
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_EXPLICIT_SAVE_PREFIX_ROUTING_GUARD ===");
  console.log("CALENDAR_FAMILY_PASS=" + (report.calendar_family_pass ? "YES" : "NO"));
  console.log("TASK_FAMILY_PASS=" + (report.task_family_pass ? "YES" : "NO"));
  console.log("NOTE_FAMILY_PASS=" + (report.note_family_pass ? "YES" : "NO"));
  console.log("NEGATION_SAFETY_PASS=" + (negPass ? "YES" : "NO"));
  console.log("REGRESSION_READ_PASS=" + (regPass ? "YES" : "NO"));
  console.log("dangerous_write_count=" + safety.dangerous_write_count);
  console.log("false_write_count=" + safety.false_write_count);
  console.log("write_when_negated_count=" + safety.write_when_negated_count);
  console.log("query_created_write_count=" + safety.query_created_write_count);
  console.log("report_path=" + REPORT_PATH);
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END_SILVER_EXPLICIT_SAVE_PREFIX_ROUTING_GUARD ===");

  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
