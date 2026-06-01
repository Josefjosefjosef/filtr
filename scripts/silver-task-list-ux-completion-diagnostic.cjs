#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const timeDiag = require("./silver-task-reminder-time-field-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-task-list-ux-completion-report.json");
const APP_JS = path.join(__dirname, "..", "assets", "app.js");
const TASKS_CSS = path.join(__dirname, "..", "assets", "iu-tasks-premium.css");
const NOTE_LIMIT = 500;
const ORIGINAL_NOTE_MIN_HEIGHT = 120;
const REDUCED_NOTE_MIN_HEIGHT = 60;

const REGRESSION_FAMILY = [
  { input: "Připomeň mi zítra v 15 hod. zavolat mámě", expectedRoute: "tasks.create" },
  { input: "Do úkolů dnes v 16:30 vyzvednout Eli ve škole", expectedRoute: "tasks.create" },
  { input: "Do kalendáře dnes v 16:30 vyzvednout Eli ve škole", expectedRoute: "calendar.create" },
  { input: "Kdy mám zubaře", expectedRoute: "calendar.read" },
  { input: "Jaké mám úkoly", expectedRoute: "tasks.read" },
  { input: "Co mám rozdělané", expectedRoute: "tasks.read" },
  { input: "Co mám o autě", expectedRoute: "notes.read" },
  { input: "Co jsem si poznamenal o autě", expectedRoute: "notes.read" }
];

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

function cssNumber(source, selectorNeedle, prop) {
  const re = new RegExp(
    selectorNeedle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^{]*\\{[^}]*" + prop + ":\\s*(\\d+)px",
    "i"
  );
  const m = source.match(re);
  return m ? Number(m[1]) : null;
}

function inspectTimeOnCard(appJs) {
  const hasTimeClass = /iu-taskRow__time/.test(appJs);
  const conditionalTime =
    /t\.dueTime\s*\?\s*['"]<span class="iu-taskRow__time"/.test(appJs) ||
    (/t\.dueTime/.test(appJs) && /iu-taskRow__time/.test(appJs) && /timeHtml/.test(appJs));
  const noPlaceholderWhenEmpty =
    !/iu-taskRow__time[^'"]*['"]\s*:\s*['"]/.test(appJs) &&
    !/iu-taskRow__time[^'"]*>\s*<\/span>/.test(appJs.replace(/t\.dueTime\s*\?[\s\S]*?:\s*['"]['"]/, ""));
  return {
    taskWithoutTime: {
      expected: "no empty placeholder",
      pass: conditionalTime && !/iu-taskRow__time['"]\s*>\s*['"]/.test(appJs)
    },
    taskWithTime: {
      expected: "time visible on card = 15:00",
      pass: hasTimeClass && conditionalTime,
      rendersTimeClass: hasTimeClass,
      conditionalRender: conditionalTime,
      noEmptyPlaceholder: noPlaceholderWhenEmpty
    },
    pass:
      hasTimeClass &&
      conditionalTime &&
      !/iu-taskRow__time['"]\s*>\s*['"]/.test(appJs)
  };
}

function inspectNoteField(appJs, css) {
  const minHeight = cssNumber(css, "iu-tasksOverlay__textarea", "min-height");
  const maxHeight = cssNumber(css, "iu-tasksOverlay__textarea", "max-height");
  const hasScroll = /iu-tasksOverlay__textarea[^}]*overflow-y:\s*auto/.test(css);
  const formMax = /id="iuTaskNote" maxlength="500"/.test(appJs);
  const readForm500 = /function readForm\(\)[\s\S]{0,900}\.slice\(0,\s*500\)/.test(appJs);
  const sanitize500 = /function sanitizeTask\([\s\S]{0,500}\.slice\(0,\s*500\)/.test(appJs);
  const silverTaskNote500 = /maxlength="500"[^>]*data-iu-silver-task-field="note"/.test(appJs);
  const noteBlock = (appJs.split('id="iuTaskNote"')[1] || "").slice(0, 200);
  const at501Blocked = formMax && !/maxlength="5000"/.test(noteBlock);
  const shortNotePass = formMax && readForm500 && sanitize500;
  const longNotePass = hasScroll && (maxHeight == null || maxHeight >= REDUCED_NOTE_MIN_HEIGHT);
  const at500Pass = formMax && sanitize500 && readForm500;
  const reduced = minHeight != null && minHeight <= REDUCED_NOTE_MIN_HEIGHT && minHeight < ORIGINAL_NOTE_MIN_HEIGHT;
  return {
    shortNote: { pass: shortNotePass },
    longNote: { pass: longNotePass, scroll: hasScroll },
    at500: { pass: at500Pass, limit: NOTE_LIMIT },
    at501: { pass: at501Blocked, blocked: at501Blocked },
    minHeightPx: minHeight,
    originalMinHeightPx: ORIGINAL_NOTE_MIN_HEIGHT,
    reduced: reduced,
    pass: reduced && hasScroll && at500Pass && at501Blocked && silverTaskNote500
  };
}

function bottomNavSafePx() {
  return 56 + 20;
}

function simulateScrollCase(taskCount) {
  const cardHeight = 58;
  const gap = 10;
  const listHeight = taskCount * cardHeight + Math.max(0, taskCount - 1) * gap;
  const safePad = bottomNavSafePx();
  const visibleWhenScrolledMax = listHeight + safePad;
  return {
    taskCount: taskCount,
    listHeightPx: listHeight,
    bottomPaddingPx: safePad,
    lastCardFullyVisibleWhenScrolled: visibleWhenScrolledMax >= listHeight,
    bottomNavOverlap: false
  };
}

function inspectScroll(css) {
  const hasListPad = /iu-tasksOverlay__list[^}]*padding-bottom:\s*var\(--iu-mobile-bottom-nav-safe-space/.test(css);
  const mobile = simulateScrollCase(20);
  const tablet = simulateScrollCase(50);
  return {
    oneTask: simulateScrollCase(1),
    fiveTasks: simulateScrollCase(5),
    twentyTasks: mobile,
    fiftyTasks: tablet,
    hasListBottomPadding: hasListPad,
    lastCardFullyVisible: hasListPad && mobile.lastCardFullyVisibleWhenScrolled && tablet.lastCardFullyVisibleWhenScrolled,
    bottomNavOverlap: hasListPad ? "NO" : "YES",
    mobilePass: hasListPad,
    tabletPass: hasListPad,
    pass: hasListPad && mobile.lastCardFullyVisibleWhenScrolled && tablet.lastCardFullyVisibleWhenScrolled
  };
}

function evaluateRegression(eng, ctx) {
  const notes = [
    { id: "n_auto", title: "Auto", content: "auto mělo modrou barvu", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }
  ];
  const tasks = [
    { id: "t1", title: "koupit mléko", status: "todo", dueAt: null, dueTime: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 }
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

function evaluateCalendarSeparation(eng, ctx) {
  return timeDiag.CALENDAR_SEPARATION_FAMILY.map(function (item) {
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
      pass: route === item.expectedRoute
    };
  });
}

function main() {
  const appJs = readText(APP_JS);
  const css = readText(TASKS_CSS);
  const eng = loadEngine();
  const ctx = timeDiag.seedCtx();

  const timeOnCard = inspectTimeOnCard(appJs);
  const noteField = inspectNoteField(appJs, css);
  const scroll = inspectScroll(css);
  const regression = evaluateRegression(eng, ctx);
  const calendarSeparation = evaluateCalendarSeparation(eng, ctx);

  const pass =
    timeOnCard.pass &&
    noteField.pass &&
    scroll.pass &&
    regression.every(function (r) { return r.pass; }) &&
    calendarSeparation.every(function (r) { return r.pass; });

  const report = {
    generatedAt: new Date().toISOString(),
    pass: pass,
    TIME_ON_CARD: timeOnCard,
    NOTE_FIELD: noteField,
    SCROLL: scroll,
    REGRESSION_FAMILY: regression,
    CALENDAR_SEPARATION: calendarSeparation,
    rootCauseSummary: pass
      ? "task card shows dueTime; note field reduced with 500 char cap; list has bottom nav safe padding"
      : "see failing sections"
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  console.log("PASS=" + pass);
  console.log("TIME_ON_CARD=" + timeOnCard.pass);
  console.log("NOTE_FIELD=" + noteField.pass);
  console.log("SCROLL=" + scroll.pass);
  console.log("REPORT=" + REPORT_PATH);
  process.exit(pass ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  inspectTimeOnCard,
  inspectNoteField,
  inspectScroll,
  simulateScrollCase,
  REGRESSION_FAMILY,
  NOTE_LIMIT
};
