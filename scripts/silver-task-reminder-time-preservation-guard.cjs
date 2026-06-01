#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const diag = require("./silver-task-reminder-time-preservation-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-task-reminder-time-preservation-guard-report.json");
const WRITE_INTENTS = new Set(["calendar.create", "tasks.create", "notes.create", "create.storage_disambiguation"]);

const TASK_TIME_FAMILY = [
  {
    input: "Připomeň mi zítra v 15 hod. zavolat mámě",
    route: "tasks.create",
    need: ["15", "zavolat mámě"],
    forbid: ["Připomeň mi"]
  },
  {
    input: "Připomeň mi Abych zítra nezapomněl vyzvednout tetu v nemocnici ve 14 hod.",
    route: "tasks.create",
    need: ["14", "vyzvednout tetu v nemocnici"],
    forbid: ["Připomeň mi"]
  },
  {
    input: "Připomeň mi dnes v 16:30 vyzvednout Eli ve škole",
    route: "tasks.create",
    need: ["16:30", "vyzvednout Eli ve škole"],
    forbid: ["Připomeň mi"]
  },
  {
    input: "Připomeň mi v pátek ve 12:00 zaplatit nájem",
    route: "tasks.create",
    need: ["12:00", "zaplatit nájem"],
    forbid: ["Připomeň mi"]
  },
  {
    input: "Připomeň mi za hodinu zavolat doktorovi",
    route: "tasks.create",
    need: ["za hodinu", "zavolat doktorovi"],
    forbid: ["Připomeň mi"]
  },
  {
    input: "Připomeň mi večer koupit mléko",
    route: "tasks.create",
    need: ["večer", "koupit mléko"],
    forbid: ["Připomeň mi"]
  },
  {
    input: "Připomeň zítra ráno vzít léky",
    route: "tasks.create",
    need: ["vzít léky"],
    needAny: ["zítra ráno", "ráno"],
    forbid: ["Připomeň"]
  }
];

const REGRESSION_FAMILY = [
  { input: "Do kalendáře dnes v 16:30 vyzvednout Eli ve škole", route: "calendar.create" },
  { input: "Připomeň mi že mám vyzvednout Eli ve škole", route: "tasks.create", forbid: ["Připomeň mi"] },
  { input: "Do poznámek heslo k wifi je 1234", route: "notes.create" },
  { input: "Kdy mám zubaře", route: "calendar.read" },
  { input: "Jaké mám úkoly", route: "tasks.read" },
  { input: "Co mám o autě", route: "notes.read" },
  { input: "Co mám rozdělané", route: "tasks.read" },
  { input: "Co jsem si poznamenal o autě", route: "notes.read" },
  { input: "Jakou má stůl šířku", route: "notes.read", needRx: /stůl/i }
];

const NEGATION_SAFETY = ["Připomeň mi nic neukládej, jen se podívej na úkoly"];

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function contentOf(turn) {
  return diag.savedContent(turn);
}

function evaluateTaskTime(eng, ctx) {
  const rows = [];
  for (let i = 0; i < TASK_TIME_FAMILY.length; i++) {
    const c = TASK_TIME_FAMILY[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const route = String(turn.normalizedIntent || "");
    const content = contentOf(turn);
    const cf = foldCs(content);
    let pass = route === c.route;
    for (let j = 0; j < c.need.length; j++) {
      if (cf.indexOf(foldCs(c.need[j])) < 0) pass = false;
    }
    if (c.needAny) {
      const anyHit = c.needAny.some(function (tok) {
        return cf.indexOf(foldCs(tok)) >= 0;
      });
      if (!anyHit) pass = false;
    }
    for (let k = 0; k < (c.forbid || []).length; k++) {
      if (cf.indexOf(foldCs(c.forbid[k])) >= 0) pass = false;
    }
    rows.push({ input: c.input, observed_route: route, observed_title: content, pass: pass });
  }
  return rows;
}

function turnMsg(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
}

function evaluateRegression(eng, ctx) {
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
    const c = REGRESSION_FAMILY[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), richCtx);
    const route = String(turn.normalizedIntent || "");
    const content = contentOf(turn);
    const msg = turnMsg(turn);
    let pass = route === c.route;
    if (c.input === "Co mám o autě") pass = route === "notes.read" && /auto|modr/i.test(msg);
    if (c.input === "Co jsem si poznamenal o autě") pass = route === "notes.read" && /auto|modr/i.test(msg);
    if (c.input === "Co mám rozdělané") pass = route === "tasks.read";
    if (c.forbid) {
      for (let j = 0; j < c.forbid.length; j++) {
        if (foldCs(content).indexOf(foldCs(c.forbid[j])) >= 0) pass = false;
      }
    }
    if (c.needRx) pass = pass && c.needRx.test(msg) && !/\bstul\b/i.test(msg);
    rows.push({ input: c.input, expected: c.route, observed: route, pass: pass });
  }
  return rows;
}

function evaluateNegation(eng, ctx) {
  const rows = [];
  for (let i = 0; i < NEGATION_SAFETY.length; i++) {
    const input = NEGATION_SAFETY[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
    const route = String(turn.normalizedIntent || "");
    const isWrite = WRITE_INTENTS.has(route) || turn.processingState === "READY_TO_SAVE";
    rows.push({ input: input, observed: route, pass: !isWrite });
  }
  return rows;
}

function main() {
  const eng = loadEngine();
  const ctx = diag.seedCtx();
  const taskRows = evaluateTaskTime(eng, ctx);
  const regRows = evaluateRegression(eng, ctx);
  const negRows = evaluateNegation(eng, ctx);
  const taskPass = taskRows.every(function (r) {
    return r.pass;
  });
  const regPass = regRows.every(function (r) {
    return r.pass;
  });
  const negPass = negRows.every(function (r) {
    return r.pass;
  });
  const ok = taskPass && regPass && negPass;
  const report = {
    guard_id: "silver_task_reminder_time_preservation_guard",
    task_time_family_pass: taskPass,
    regression_family_pass: regPass,
    negation_safety_pass: negPass,
    task_rows: taskRows,
    regression_rows: regRows,
    negation_rows: negRows,
    PASS_FAIL: ok ? "PASS" : "FAIL"
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log("=== SILVER_TASK_REMINDER_TIME_PRESERVATION_GUARD ===");
  console.log("TASK_TIME_FAMILY_PASS=" + (taskPass ? "YES" : "NO"));
  console.log("REGRESSION_FAMILY_PASS=" + (regPass ? "YES" : "NO"));
  console.log("NEGATION_SAFETY_PASS=" + (negPass ? "YES" : "NO"));
  console.log("report_path=" + REPORT_PATH);
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END_SILVER_TASK_REMINDER_TIME_PRESERVATION_GUARD ===");
  if (!ok) process.exit(1);
}

if (require.main === module) main();
