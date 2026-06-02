#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const diag = require("./silver-explicit-save-prefix-routing-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-explicit-save-prefix-regression-guard-report.json");
const WRITE_INTENTS = new Set(["calendar.create", "tasks.create", "notes.create", "create.storage_disambiguation"]);

const NOTE_FORCE_SAVE_FAMILY = [
  {
    input: "Do poznámek záruka na televizi mi končí v lednu 2027",
    expectedRoute: "notes.create",
    expectedContentRx: /zaruk\w*\s+na\s+televiz/i,
    prefixTokens: ["Do poznámek", "do poznamek"]
  },
  {
    input: "Do poznámek záruka na televizi mi končí v lednu 2028",
    expectedRoute: "notes.create",
    expectedContentRx: /zaruk\w*\s+na\s+televiz/i,
    prefixTokens: ["Do poznámek"]
  },
  {
    input: "Do poznámek SPZ Volva je ABC 4243",
    expectedRoute: "notes.create",
    expectedContentRx: /SPZ\s+Volva/i,
    prefixTokens: ["Do poznámek"]
  },
  {
    input: "Do poznámek heslo k Wi-Fi je 1234",
    expectedRoute: "notes.create",
    expectedContentRx: /heslo|wifi|1234/i,
    prefixTokens: ["Do poznámek"]
  },
  {
    input: "Do poznámky Katka má narozeniny 31. ledna",
    expectedRoute: "notes.create",
    expectedContentRx: /Katka|narozenin/i,
    prefixTokens: ["Do poznámky"]
  },
  {
    input: "Do poznamek auto má SPZ 32 53",
    expectedRoute: "notes.create",
    expectedContentRx: /SPZ|32\s*53/i,
    prefixTokens: ["Do poznamek"]
  },
  {
    input: "Do poznámek televize Samsung 65 palců koupená v Alze",
    expectedRoute: "notes.create",
    expectedContentRx: /Samsung|televiz/i,
    prefixTokens: ["Do poznámek"]
  },
  {
    input: "Do poznámek: záruka na notebook končí v červnu 2027",
    expectedRoute: "notes.create",
    expectedContentRx: /zaruk\w*\s+na\s+notebook/i,
    prefixTokens: ["Do poznámek"]
  }
];

const TASK_FORCE_SAVE_FAMILY = [
  { input: "Připomeň mi zítra v 15 zavolat mámě", expectedRoute: "tasks.create", prefixTokens: ["Připomeň mi"] },
  { input: "Připomeň mi dnes v 16:30 vyzvednout Eli ve škole", expectedRoute: "tasks.create", prefixTokens: ["Připomeň mi"] },
  { input: "Do úkolů koupit rohlíky", expectedRoute: "tasks.create", prefixTokens: ["Do úkolů"] },
  { input: "Do úkolů zítra v 8 koupit mléko", expectedRoute: "tasks.create", prefixTokens: ["Do úkolů"] },
  {
    input: "Ulož do úkolů že v pátek v 15 hod. musím zavolat advokátovi",
    expectedRoute: "tasks.create",
    prefixTokens: ["Ulož do úkolů"]
  },
  { input: "Pripomen mi vecer koupit chleba", expectedRoute: "tasks.create", prefixTokens: ["Pripomen mi"] }
];

const CALENDAR_FORCE_SAVE_FAMILY = [
  { input: "Do kalendáře zítra v 15 schůzka s Tomášem", expectedRoute: "calendar.create", prefixTokens: ["Do kalendáře"] },
  { input: "Do kalendáře pátek 16:00 zubař", expectedRoute: "calendar.create", prefixTokens: ["Do kalendáře"] },
  { input: "Do kalendáře schůzka s právníkem příští středu", expectedRoute: "calendar.create", prefixTokens: ["Do kalendáře"] },
  { input: "Do kalendare zitra v 10 doktor", expectedRoute: "calendar.create", prefixTokens: ["Do kalendare"] }
];

const SAFETY_NO_WRITE_FAMILY = [
  "Do poznámek nic neukládej, jen přečti poznámky",
  "Do kalendáře nic neukládej, jen se podívej na zubaře",
  "Připomeň mi nic neukládej, jen se podívej na úkoly"
];

const REGRESSION_FAMILY = [
  { input: "Kdy mám zubaře", expected: "calendar.read" },
  { input: "Jaké mám úkoly", expected: "tasks.read" },
  { input: "Co mám rozdělané", expected: "tasks.read" },
  { input: "Co mám o autě", expected: "notes.read" },
  { input: "Co jsem si poznamenal o autě", expected: "notes.read" },
  { input: "Jakou má stůl šířku", expected: "notes.read", expectRx: /stůl/i },
  { input: "Do kalendáře dnes v 16:30 vyzvednout Eli ve škole", expected: "calendar.create" },
  { input: "Připomeň mi dnes v 16:30 vyzvednout Eli ve škole", expected: "tasks.create" },
  { input: "Do poznámek heslo k wifi je 1234", expected: "notes.create" },
  {
    input: "Ulož do úkolů že v pátek v 15 hod. musím zavolat advokátovi",
    expected: "tasks.create"
  }
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

function evaluateForceSaveFamily(eng, ctx, family, defaultPrefixTokens) {
  const rows = [];
  for (let i = 0; i < family.length; i++) {
    const item = family[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(item.input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    const msg = turnMsg(turn);
    const content = diag.savedContent(turn);
    const leakTokens = item.prefixTokens || defaultPrefixTokens;
    const leak = diag.prefixLeaked(content, leakTokens);
    const routePass = intent === item.expectedRoute;
    const noRetrieval =
      !/Nic jsem k tomu nenašel/i.test(msg) &&
      !/Našel jsem/i.test(msg) &&
      !/V poznámkách/i.test(msg) &&
      !/V úkolech/i.test(msg);
    const contentPass =
      !item.expectedContentRx ||
      (content && item.expectedContentRx.test(foldCs(content)));
    const notEmpty = !!String(content || "").trim();
    const pass = routePass && noRetrieval && !leak && contentPass && notEmpty;
    rows.push({
      input: item.input,
      expected_route: item.expectedRoute,
      observed_route: intent,
      observed_content: content,
      observed_message: msg.slice(0, 120),
      prefix_leaked: leak,
      pass: pass
    });
  }
  return rows;
}

function evaluateSafetyNoWrite(eng, ctx) {
  const rows = [];
  for (let i = 0; i < SAFETY_NO_WRITE_FAMILY.length; i++) {
    const input = SAFETY_NO_WRITE_FAMILY[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    const isWrite = WRITE_INTENTS.has(intent) || turn.processingState === "READY_TO_SAVE";
    rows.push({ input: input, observed: intent, processingState: turn.processingState, pass: !isWrite });
  }
  return rows;
}

function evaluateRegressionFamily(eng, ctx) {
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
  for (let i = 0; i < REGRESSION_FAMILY.length; i++) {
    const item = REGRESSION_FAMILY[i];
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
  const allInputs = SAFETY_NO_WRITE_FAMILY.concat(
    REGRESSION_FAMILY.filter(function (r) {
      return r.expected.indexOf(".read") > 0;
    }).map(function (r) {
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
    if (turn.processingState === "READY_TO_SAVE" && /read/.test(String(REGRESSION_FAMILY.find(function (r) { return r.input === input; })?.expected || ""))) {
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

  const noteRows = evaluateForceSaveFamily(eng, ctx, NOTE_FORCE_SAVE_FAMILY, ["Do poznámek", "Do poznámky", "do poznamek"]);
  const taskRows = evaluateForceSaveFamily(eng, ctx, TASK_FORCE_SAVE_FAMILY, ["Připomeň mi", "Připomeň", "Do úkolů", "Ulož do úkolů"]);
  const calendarRows = evaluateForceSaveFamily(eng, ctx, CALENDAR_FORCE_SAVE_FAMILY, ["Do kalendáře", "do kalendare"]);
  const safetyRows = evaluateSafetyNoWrite(eng, ctx);
  const regressionRows = evaluateRegressionFamily(eng, ctx);
  const safety = evaluateSafetyCounters(eng, ctx);

  const ok =
    noteRows.every(function (r) { return r.pass; }) &&
    taskRows.every(function (r) { return r.pass; }) &&
    calendarRows.every(function (r) { return r.pass; }) &&
    safetyRows.every(function (r) { return r.pass; }) &&
    regressionRows.every(function (r) { return r.pass; }) &&
    safety.dangerous_write_count === 0 &&
    safety.false_write_count === 0 &&
    safety.write_when_negated_count === 0 &&
    safety.query_created_write_count === 0;

  const report = {
    guard_id: "silver_explicit_save_prefix_regression_guard",
    note_force_save_pass: noteRows.every(function (r) { return r.pass; }),
    task_force_save_pass: taskRows.every(function (r) { return r.pass; }),
    calendar_force_save_pass: calendarRows.every(function (r) { return r.pass; }),
    safety_no_write_pass: safetyRows.every(function (r) { return r.pass; }),
    regression_replay_pass: regressionRows.every(function (r) { return r.pass; }),
    safety_counters: safety,
    note_rows: noteRows,
    task_rows: taskRows,
    calendar_rows: calendarRows,
    safety_rows: safetyRows,
    regression_rows: regressionRows,
    PASS_FAIL: ok ? "PASS" : "FAIL"
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_EXPLICIT_SAVE_PREFIX_REGRESSION_GUARD ===");
  console.log("NOTE_FORCE_SAVE_PASS=" + (report.note_force_save_pass ? "YES" : "NO"));
  console.log("TASK_FORCE_SAVE_PASS=" + (report.task_force_save_pass ? "YES" : "NO"));
  console.log("CALENDAR_FORCE_SAVE_PASS=" + (report.calendar_force_save_pass ? "YES" : "NO"));
  console.log("SAFETY_NO_WRITE_PASS=" + (report.safety_no_write_pass ? "YES" : "NO"));
  console.log("REGRESSION_REPLAY_PASS=" + (report.regression_replay_pass ? "YES" : "NO"));
  console.log("dangerous_write_count=" + safety.dangerous_write_count);
  console.log("false_write_count=" + safety.false_write_count);
  console.log("write_when_negated_count=" + safety.write_when_negated_count);
  console.log("query_created_write_count=" + safety.query_created_write_count);
  console.log("report_path=" + REPORT_PATH);
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END_SILVER_EXPLICIT_SAVE_PREFIX_REGRESSION_GUARD ===");

  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
