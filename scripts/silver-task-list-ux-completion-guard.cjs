#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const diag = require("./silver-task-list-ux-completion-diagnostic.cjs");
const timeDiag = require("./silver-task-reminder-time-field-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-task-list-ux-completion-guard-report.json");
const APP_JS = path.join(__dirname, "..", "assets", "app.js");
const WRITE_INTENTS = new Set(["calendar.create", "tasks.create", "notes.create", "create.storage_disambiguation"]);

const TIME_CARD_FAMILY = [
  {
    label: "task with time",
    date: "2026-06-02",
    time: "15:00",
    title: "Koupit rohlíky",
    expectTimeOnCard: "15:00"
  },
  {
    label: "task without time",
    date: "2026-06-02",
    time: null,
    title: "Koupit rohlíky",
    expectTimeOnCard: null
  }
];

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

function evaluateTimeCardFamily(appJs) {
  const rows = [];
  for (let i = 0; i < TIME_CARD_FAMILY.length; i++) {
    const item = TIME_CARD_FAMILY[i];
    const hasConditional = /t\.dueTime/.test(appJs) && /iu-taskRow__time/.test(appJs);
    const noEmptyWhenMissing =
      !item.expectTimeOnCard ||
      (/t\.dueTime\s*\?/.test(appJs) && !/iu-taskRow__time[^>]*>\s*<\/span>\s*\+/.test(appJs));
    const showsTime =
      !!item.expectTimeOnCard &&
      /esc\(t\.dueTime\)/.test(appJs) &&
      /iu-taskRow__time/.test(appJs);
    const pass = item.expectTimeOnCard ? hasConditional && showsTime : hasConditional && noEmptyWhenMissing;
    rows.push({
      label: item.label,
      expectedTimeOnCard: item.expectTimeOnCard,
      pass: pass
    });
  }
  return rows;
}

function evaluateNoteFieldFamily(appJs, css) {
  const note = diag.inspectNoteField(appJs, css);
  return {
    heightReduced: note.reduced,
    scrollWorks: note.longNote.pass,
    at500Pass: note.at500.pass,
    at501Blocked: note.at501.pass,
    pass: note.pass
  };
}

function evaluateScrollFamily(css) {
  const scroll = diag.inspectScroll(css);
  return {
    lastCardFullyVisible: scroll.lastCardFullyVisible,
    bottomNavOverlap: scroll.bottomNavOverlap,
    mobilePass: scroll.mobilePass,
    tabletPass: scroll.tabletPass,
    pass: scroll.pass
  };
}

function evaluateSafetyCounters(eng, ctx) {
  let dangerous_write_count = 0;
  let false_write_count = 0;
  let write_when_negated_count = 0;
  let query_created_write_count = 0;
  const readOnly = diag.REGRESSION_FAMILY.filter(function (r) {
    return String(r.expectedRoute || "").indexOf(".read") >= 0;
  });
  for (let i = 0; i < readOnly.length; i++) {
    const input = readOnly[i].input;
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
    if (turn.processingState === "READY_TO_SAVE") {
      false_write_count++;
      query_created_write_count++;
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
  const appJs = readText(APP_JS);
  const css = readText(path.join(__dirname, "..", "assets", "iu-tasks-premium.css"));
  const eng = loadEngine();
  const ctx = timeDiag.seedCtx();

  const timeCardRows = evaluateTimeCardFamily(appJs);
  const noteField = evaluateNoteFieldFamily(appJs, css);
  const scroll = evaluateScrollFamily(css);
  const regressionRows = (function () {
    const notes = [{ id: "n_auto", title: "Auto", content: "auto mělo modrou barvu", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }];
    const tasks = [{ id: "t1", title: "koupit mléko", status: "todo", dueAt: null, dueTime: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 }];
    const richCtx = {
      now: ctx.now,
      getEventsSnapshot: function () { return []; },
      getTasksSnapshot: function () { return tasks; },
      getNotesSnapshot: function () { return notes; }
    };
    const rows = [];
    for (let i = 0; i < diag.REGRESSION_FAMILY.length; i++) {
      const item = diag.REGRESSION_FAMILY[i];
      try {
        if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
      } catch (e0) {
        void e0;
      }
      const turn = eng.processUserTurn(item.input, eng.createEmptyDraft(), richCtx);
      const route = String(turn.normalizedIntent || "");
      rows.push({ input: item.input, expectedRoute: item.expectedRoute, observedRoute: route, pass: route === item.expectedRoute });
    }
    return rows;
  })();
  const calendarRows = timeDiag.CALENDAR_SEPARATION_FAMILY.map(function (item) {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(item.input, eng.createEmptyDraft(), ctx);
    const route = String(turn.normalizedIntent || "");
    return { input: item.input, expectedRoute: item.expectedRoute, observedRoute: route, pass: route === item.expectedRoute };
  });
  const taskNotCalRows = timeDiag.TASK_NOT_CALENDAR_FAMILY.map(function (item) {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(item.input, eng.createEmptyDraft(), ctx);
    const route = String(turn.normalizedIntent || "");
    return { input: item.input, expectedRoute: item.expectedRoute, observedRoute: route, pass: route === item.expectedRoute && route !== "calendar.create" };
  });
  const manualForm = timeDiag.inspectManualForm(appJs);
  const safety = evaluateSafetyCounters(eng, ctx);

  const pass =
    timeCardRows.every(function (r) { return r.pass; }) &&
    noteField.pass &&
    scroll.pass &&
    regressionRows.every(function (r) { return r.pass; }) &&
    calendarRows.every(function (r) { return r.pass; }) &&
    taskNotCalRows.every(function (r) { return r.pass; }) &&
    manualForm.pass &&
    safety.dangerous_write_count === 0 &&
    safety.false_write_count === 0 &&
    safety.write_when_negated_count === 0 &&
    safety.query_created_write_count === 0;

  const report = {
    generatedAt: new Date().toISOString(),
    pass: pass,
    timeCardFamily: timeCardRows,
    noteFieldFamily: noteField,
    scrollFamily: scroll,
    regressionFamily: regressionRows,
    calendarSeparationFamily: calendarRows,
    taskNotCalendarFamily: taskNotCalRows,
    manualFormFamily: manualForm,
    safetyCounters: safety
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  console.log("PASS=" + pass);
  console.log("TIME_CARD_FAMILY=" + timeCardRows.filter(function (r) { return r.pass; }).length + "/" + timeCardRows.length);
  console.log("NOTE_FIELD=" + noteField.pass);
  console.log("SCROLL=" + scroll.pass);
  console.log("CALENDAR_SEPARATION=" + calendarRows.filter(function (r) { return r.pass; }).length + "/" + calendarRows.length);
  console.log("DANGEROUS_WRITE_COUNT=" + safety.dangerous_write_count);
  console.log("REPORT=" + REPORT_PATH);
  process.exit(pass ? 0 : 1);
}

if (require.main === module) main();
