#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-task-reminder-time-field-diagnostic-report.json");
const FIXED_NOW = new Date("2026-06-01T12:00:00Z");

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function seedCtx() {
  return {
    now: FIXED_NOW,
    getEventsSnapshot: function () {
      return [];
    },
    getTasksSnapshot: function () {
      return [];
    },
    getNotesSnapshot: function () {
      return [];
    }
  };
}

function includesFold(hay, needle) {
  return foldCs(hay).indexOf(foldCs(needle)) >= 0;
}

function taskTimeDisplay(d) {
  const t = d && d.taskDueTime ? String(d.taskDueTime).trim() : "";
  if (/^\d{1,2}:\d{2}$/.test(t)) {
    const tp = t.split(":");
    return String(Number(tp[0])).padStart(2, "0") + ":" + tp[1];
  }
  if (d && d.meta && d.meta.taskDueTimeLabel) return String(d.meta.taskDueTimeLabel);
  return "";
}

const TASK_TIME_FIELD_FAMILY = [
  {
    input: "Ulož do úkolů že v pátek v 15 hod. musím zavolat advokátovi",
    expectedRoute: "tasks.create",
    expectedTitleNeed: ["Zavolat advokátovi"],
    expectedTitleForbid: ["v pátek", "15", "musím", "Ulož do úkolů"],
    expectedTime: "15:00"
  },
  {
    input: "Připomeň mi zítra v 15 hod. zavolat mámě",
    expectedRoute: "tasks.create",
    expectedTitleNeed: ["Zavolat mámě"],
    expectedTitleForbid: ["zítra", "15", "Připomeň mi"],
    expectedTime: "15:00"
  },
  {
    input: "Připomeň mi Abych zítra nezapomněl vyzvednout tetu v nemocnici ve 14 hod.",
    expectedRoute: "tasks.create",
    expectedTitleNeed: ["Vyzvednout tetu v nemocnici"],
    expectedTitleForbid: ["zítra", "14", "nezapomněl"],
    expectedTime: "14:00"
  },
  {
    input: "Do úkolů dnes v 16:30 vyzvednout Eli ve škole",
    expectedRoute: "tasks.create",
    expectedTitleNeed: ["Vyzvednout Eli ve škole"],
    expectedTitleForbid: ["dnes", "16:30"],
    expectedTime: "16:30"
  },
  {
    input: "Připomeň mi večer koupit mléko",
    expectedRoute: "tasks.create",
    expectedTitleNeed: ["Koupit mléko"],
    expectedTitleForbid: ["Připomeň mi", "večer"],
    expectedTimeAny: ["18:00", "večer"]
  }
];

const CALENDAR_SEPARATION_FAMILY = [
  { input: "Do kalendáře dnes v 16:30 vyzvednout Eli ve škole", expectedRoute: "calendar.create" },
  { input: "Do kalendáře zítra v 15 schůzka s Tomášem", expectedRoute: "calendar.create" },
  { input: "Kdy mám zubaře", expectedRoute: "calendar.read" }
];

const TASK_NOT_CALENDAR_FAMILY = [
  { input: "Připomeň mi dnes v 16:30 vyzvednout Eli ve škole", expectedRoute: "tasks.create" },
  { input: "Ulož do úkolů že v pátek v 15 hod. musím zavolat advokátovi", expectedRoute: "tasks.create" },
  { input: "Do úkolů zítra v 8 koupit mléko", expectedRoute: "tasks.create" }
];

function evaluateTaskTimeRow(eng, ctx, item) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(item.input, eng.createEmptyDraft(), ctx);
  const d = turn.draft || {};
  const route = String(turn.normalizedIntent || "");
  const title = String(d.title || "").trim();
  const time = taskTimeDisplay(d);
  const date = String(d.taskDueAt || "").trim();
  let pass = route === item.expectedRoute;
  let rootCause = "";
  if (item.expectedTime && time !== item.expectedTime) {
    pass = false;
    rootCause = "taskDueTime mismatch expected " + item.expectedTime + " got " + time;
  }
  if (item.expectedTimeAny && !item.expectedTimeAny.some(function (x) { return time === x || includesFold(time, x); })) {
    pass = false;
    rootCause = rootCause || "taskDueTime not in expected set";
  }
  for (let i = 0; i < (item.expectedTitleNeed || []).length; i++) {
    if (!includesFold(title, item.expectedTitleNeed[i])) {
      pass = false;
      rootCause = rootCause || "title missing " + item.expectedTitleNeed[i];
    }
  }
  for (let j = 0; j < (item.expectedTitleForbid || []).length; j++) {
    if (includesFold(title, item.expectedTitleForbid[j])) {
      pass = false;
      rootCause = rootCause || "title leaked " + item.expectedTitleForbid[j];
    }
  }
  if (route === "calendar.create") {
    pass = false;
    rootCause = rootCause || "calendar leakage";
  }
  return {
    input: item.input,
    expectedRoute: item.expectedRoute,
    observedRoute: route,
    observedDate: date,
    observedTime: time,
    observedTitle: title,
    expectedTime: item.expectedTime || item.expectedTimeAny || "",
    timeFieldExists: !!String(d.taskDueTime || "").trim(),
    timeVisibleInDraft: !!time,
    calendarLeakage: route === "calendar.create",
    pass: pass,
    rootCause: pass ? "" : rootCause || "task time field family fail"
  };
}

function evaluateRouteFamily(eng, ctx, items) {
  const rows = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(item.input, eng.createEmptyDraft(), ctx);
    const route = String(turn.normalizedIntent || "");
    rows.push({
      input: item.input,
      expectedRoute: item.expectedRoute,
      observedRoute: route,
      pass: route === item.expectedRoute
    });
  }
  return rows;
}

function inspectManualForm(appJs) {
  const hasDate = /data-iu-silver-task-field="due"/.test(appJs);
  const hasTime = /data-iu-silver-task-field="time"/.test(appJs);
  const hasTitle = /data-iu-silver-task-field="title"/.test(appJs);
  const hasNote = /data-iu-silver-task-field="note"/.test(appJs);
  const reminderShell = /Nová připomínka/.test(appJs) && hasTime;
  return {
    hasDateField: hasDate,
    hasTimeField: hasTime,
    hasTitleField: hasTitle,
    hasNoteField: hasNote,
    manualReminderFormHasTime: reminderShell,
    pass: hasDate && hasTime && hasTitle && hasNote && reminderShell
  };
}

function main() {
  const eng = loadEngine();
  const ctx = seedCtx();
  const appJs = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");

  const taskRows = TASK_TIME_FIELD_FAMILY.map(function (item) {
    return evaluateTaskTimeRow(eng, ctx, item);
  });
  const calendarRows = evaluateRouteFamily(eng, ctx, CALENDAR_SEPARATION_FAMILY);
  const taskNotCalRows = evaluateRouteFamily(eng, ctx, TASK_NOT_CALENDAR_FAMILY);
  const manualForm = inspectManualForm(appJs);

  const pass =
    taskRows.every(function (r) { return r.pass; }) &&
    calendarRows.every(function (r) { return r.pass; }) &&
    taskNotCalRows.every(function (r) { return r.pass; }) &&
    manualForm.pass;

  const report = {
    generatedAt: new Date().toISOString(),
    pass: pass,
    taskTimeFieldFamily: taskRows,
    calendarSeparationFamily: calendarRows,
    taskNotCalendarFamily: taskNotCalRows,
    manualFormInspection: manualForm,
    rootCauseSummary: pass
      ? "taskDueTime field populated; title cleanup strips extracted date/time"
      : "see failing rows"
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  console.log("PASS=" + pass);
  console.log("REPORT=" + REPORT_PATH);
  process.exit(pass ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  seedCtx,
  TASK_TIME_FIELD_FAMILY,
  CALENDAR_SEPARATION_FAMILY,
  TASK_NOT_CALENDAR_FAMILY,
  taskTimeDisplay,
  evaluateTaskTimeRow,
  inspectManualForm
};
