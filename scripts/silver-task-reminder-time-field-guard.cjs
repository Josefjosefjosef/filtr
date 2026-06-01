#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const diag = require("./silver-task-reminder-time-field-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-task-reminder-time-field-guard-report.json");
const WRITE_INTENTS = new Set(["calendar.create", "tasks.create", "notes.create", "create.storage_disambiguation"]);

const REGRESSION_FAMILY = [
  { input: "Do poznámek heslo k wifi je 1234", expected: "notes.create" },
  { input: "Co mám rozdělané", expected: "tasks.read" },
  { input: "Co jsem si poznamenal o autě", expected: "notes.read" },
  { input: "Jakou má stůl šířku", expected: "notes.read", expectRx: /stůl/i },
  { input: "Jaké mám úkoly", expected: "tasks.read" }
];

const NEGATION_SAFETY_FAMILY = [
  "Připomeň mi nic neukládej, jen se podívej na úkoly",
  "Ulož do úkolů nic neukládej, jen přečti úkoly"
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

function evaluateRegressionReads(eng, ctx) {
  const notes = [
    { id: "n_auto", title: "Auto", content: "auto mělo modrou barvu", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n_stul", title: "Stůl", content: "stůl má šířku 120 cm", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }
  ];
  const tasks = [
    { id: "t1", title: "koupit mléko", status: "todo", dueAt: null, dueTime: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t2", title: "posekat trávu", status: "in_progress", dueAt: null, dueTime: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 }
  ];
  const richCtx = {
    now: ctx.now,
    getEventsSnapshot: function () { return []; },
    getTasksSnapshot: function () { return tasks; },
    getNotesSnapshot: function () { return notes; }
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
    if (item.input === "Co jsem si poznamenal o autě") pass = intent === "notes.read" && /auto|modr/i.test(msg);
    if (item.expectRx) pass = pass && item.expectRx.test(msg) && !/\bstul\b/i.test(msg);
    rows.push({ input: item.input, expected: item.expected, observed: intent, pass: pass });
  }
  return rows;
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
    rows.push({ input: input, observed: intent, processingState: turn.processingState, pass: !isWrite });
  }
  return rows;
}

function evaluateSafetyCounters(eng, ctx) {
  let dangerous_write_count = 0;
  let false_write_count = 0;
  let write_when_negated_count = 0;
  let query_created_write_count = 0;
  const readOnlyRegression = REGRESSION_FAMILY.filter(function (r) {
    return String(r.expected || "").indexOf(".read") >= 0;
  });
  const allInputs = NEGATION_SAFETY_FAMILY.concat(readOnlyRegression.map(function (r) { return r.input; }));
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
    if (turn.processingState === "READY_TO_SAVE" && REGRESSION_FAMILY.some(function (r) { return r.input === input; })) {
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

function simulateManualSave(eng) {
  const svc = eng.iuTasksServiceMock || null;
  void svc;
  const appJs = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
  const form = diag.inspectManualForm(appJs);
  const hasStorageDueTime = /dueTime:/.test(appJs) && /tasksCreateFromSilver/.test(appJs);
  return {
    pass: form.pass && hasStorageDueTime,
    form: form,
    hasStorageDueTime: hasStorageDueTime
  };
}

function main() {
  const eng = loadEngine();
  const ctx = diag.seedCtx();
  const appJs = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");

  const taskRows = diag.TASK_TIME_FIELD_FAMILY.map(function (item) {
    return diag.evaluateTaskTimeRow(eng, ctx, item);
  });
  const calendarRows = diag.CALENDAR_SEPARATION_FAMILY.map(function (item) {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(item.input, eng.createEmptyDraft(), ctx);
    return {
      input: item.input,
      expectedRoute: item.expectedRoute,
      observedRoute: String(turn.normalizedIntent || ""),
      pass: String(turn.normalizedIntent || "") === item.expectedRoute
    };
  });
  const taskNotCalRows = diag.TASK_NOT_CALENDAR_FAMILY.map(function (item) {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(item.input, eng.createEmptyDraft(), ctx);
    const route = String(turn.normalizedIntent || "");
    return {
      input: item.input,
      expectedRoute: item.expectedRoute,
      observedRoute: route,
      pass: route === item.expectedRoute && route !== "calendar.create"
    };
  });
  const manualForm = diag.inspectManualForm(appJs);
  const manualSave = simulateManualSave(eng);
  const regRows = evaluateRegressionReads(eng, ctx);
  const negRows = evaluateNegationSafety(eng, ctx);
  const safety = evaluateSafetyCounters(eng, ctx);

  const pass =
    taskRows.every(function (r) { return r.pass; }) &&
    calendarRows.every(function (r) { return r.pass; }) &&
    taskNotCalRows.every(function (r) { return r.pass; }) &&
    manualForm.pass &&
    manualSave.pass &&
    regRows.every(function (r) { return r.pass; }) &&
    negRows.every(function (r) { return r.pass; }) &&
    safety.dangerous_write_count === 0 &&
    safety.false_write_count === 0 &&
    safety.write_when_negated_count === 0 &&
    safety.query_created_write_count === 0;

  const report = {
    generatedAt: new Date().toISOString(),
    pass: pass,
    taskTimeFieldFamily: taskRows,
    calendarSeparationFamily: calendarRows,
    taskNotCalendarFamily: taskNotCalRows,
    manualFormFamily: manualForm,
    manualSaveInspection: manualSave,
    regressionFamily: regRows,
    negationSafetyFamily: negRows,
    safetyCounters: safety
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  console.log("PASS=" + pass);
  console.log("TASK_TIME_FIELD_FAMILY=" + taskRows.filter(function (r) { return r.pass; }).length + "/" + taskRows.length);
  console.log("CALENDAR_SEPARATION=" + calendarRows.filter(function (r) { return r.pass; }).length + "/" + calendarRows.length);
  console.log("TASK_NOT_CALENDAR=" + taskNotCalRows.filter(function (r) { return r.pass; }).length + "/" + taskNotCalRows.length);
  console.log("MANUAL_FORM_TIME=" + manualForm.pass);
  console.log("DANGEROUS_WRITE_COUNT=" + safety.dangerous_write_count);
  console.log("REPORT=" + REPORT_PATH);
  process.exit(pass ? 0 : 1);
}

if (require.main === module) main();
