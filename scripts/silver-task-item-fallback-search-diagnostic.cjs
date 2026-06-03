#!/usr/bin/env node
"use strict";

/**
 * TASK ITEM FALLBACK SEARCH — diagnostic only (read-only engine).
 */
const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPO = path.resolve(__dirname, "..");
const REPORT_PATH = path.join(__dirname, "silver-task-item-fallback-search-diagnostic-report.json");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const READ_TASK = new Set(["tasks.read", "tasks.query", "global.search"]);

const FIXED_NOW = new Date(2026, 5, 3, 12, 0, 0);

const CASES = [
  { id: "DL_01", bucket: "DEADLINE_ITEM", input: "Kdy mám zaplatit nájem", expected: "tasks.read", entityRx: /najem|nájem/i, valueRx: /5\.|6\.|2026|12:00|termín|bez termínu/i },
  { id: "DL_02", bucket: "DEADLINE_ITEM", input: "Kdy mám koupit dárek", expected: "tasks.read", entityRx: /d[aá]rek|narozenin/i, valueRx: /narozenin|10\.|koupit darek k/i },
  { id: "DL_03", bucket: "DEADLINE_ITEM", input: "Kdy mám zavolat doktorovi", expected: "tasks.read", entityRx: /doktor/i, valueRx: /6\.|9:00|termín|zavolat doktorovi/i },
  { id: "DL_04", bucket: "DEADLINE_ITEM", input: "Kdy mám vyzvednout Eli", expected: "tasks.read", entityRx: /eli/i, valueRx: /4\.|6\.|15:30|termín/i },
  { id: "EA_01", bucket: "ENTITY_ACTION", input: "Co mám koupit mámě", expected: "tasks.read", entityRx: /m[aá]m[eě]|darek/i, valueRx: /Koupit darek mame|mame/i, forbidBulkList: true },
  { id: "EA_02", bucket: "ENTITY_ACTION", input: "Co mám udělat s právníkem", expected: "tasks.read", entityRx: /pravn|právn/i, valueRx: /pravnik|právník|smlouv/i },
  { id: "EA_03", bucket: "ENTITY_ACTION", input: "Co mám zařídit kolem auta", expected: "tasks.read", entityRx: /aut|stk|pojist/i, valueRx: /auta|STK|pojist/i },
  { id: "EA_04", bucket: "ENTITY_ACTION", input: "Co mám vyřešit s doktorem", expected: "tasks.read", entityRx: /doktor/i, valueRx: /doktor|lékař|lekaf/i },
  { id: "EA_05", bucket: "ENTITY_ACTION", input: "Co mám vyřešit s pojišťovnou", expected: "tasks.read", entityRx: /pojist/i, valueRx: /pojist/i },
  { id: "SY_01", bucket: "SYNONYM_ACTION", input: "Kdy mám uhradit nájem", expected: "tasks.read", entityRx: /najem|nájem/i, valueRx: /5\.|6\.|2026|termín|bez termínu/i },
  { id: "SY_02", bucket: "SYNONYM_ACTION", input: "Kdy mám kontaktovat doktora", expected: "tasks.read", entityRx: /doktor/i, valueRx: /doktor|termín|9:00/i },
  { id: "SY_03", bucket: "SYNONYM_ACTION", input: "Kdy mám vyzvednout Eli ze školy", expected: "tasks.read", entityRx: /eli/i, valueRx: /4\.|6\.|15:30|termín/i },
  { id: "SY_04", bucket: "SYNONYM_ACTION", input: "Co mám pořídit mámě", expected: "tasks.read", entityRx: /m[aá]m[eě]|darek/i, valueRx: /mame|darek/i, forbidBulkList: true },
  { id: "CM_01", bucket: "CROSS_MODULE_STEAL", input: "Kdy mám zubaře", expected: "calendar.read", stealGuard: true },
  { id: "CM_02", bucket: "CROSS_MODULE_STEAL", input: "Jakou má Volvo SPZ", expected: "notes.read", stealGuard: true },
  { id: "CM_03", bucket: "CROSS_MODULE_STEAL", input: "Co mám za úkoly", expected: "tasks.read", stealGuard: true, overviewOnly: true }
];

function seedTasks() {
  return [
    { id: "t_najem", title: "Zaplatit nájem", status: "todo", dueAt: "2026-06-05", dueTime: "12:00", note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t_mama", title: "Koupit dárek mámě", status: "todo", dueAt: null, dueTime: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t_eli", title: "Vyzvednout Eli ze školy", status: "todo", dueAt: "2026-06-04", dueTime: "15:30", note: "", priority: "high", createdAt: 1, updatedAt: 1 },
    { id: "t_pravnik", title: "Zavolat právníkovi ohledně smlouvy", status: "in_progress", dueAt: null, dueTime: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t_doktor", title: "Zavolat doktorovi", status: "todo", dueAt: "2026-06-06", dueTime: "09:00", note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t_auto", title: "Zařídit STK a pojištění auta", status: "todo", dueAt: null, dueTime: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t_darek", title: "Koupit dárek k narozeninám", status: "todo", dueAt: "2026-06-10", dueTime: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 }
  ];
}

function seedCtx() {
  return {
    now: FIXED_NOW,
    getEventsSnapshot: function () {
      return [];
    },
    getTasksSnapshot: function () {
      return seedTasks();
    },
    getNotesSnapshot: function () {
      return [];
    }
  };
}

function turnMsg(turn) {
  return String(
    (turn.readAnswer && turn.readAnswer.message) ||
      turn.assistantLead ||
      turn.userFacingSummary ||
      ""
  );
}

function isBulkTaskList(msg) {
  return /M[aá][šs]\s+\d+\s+aktivn[ií]\s+úkoly/i.test(msg) || /:\s*1\.\s+/i.test(msg);
}

function evaluateCase(c, intent, msg) {
  const issues = [];
  if (c.overviewOnly) {
    if (WRITE_INTENTS.has(intent)) issues.push("write_leak");
    if (intent !== c.expected) issues.push("wrong_module:" + intent);
    return issues;
  }
  if (c.stealGuard) {
    if (WRITE_INTENTS.has(intent)) issues.push("write_leak");
    if (intent !== c.expected) issues.push("steal:" + intent);
    return issues;
  }
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak");
  if (intent === "calendar.read") issues.push("task_vs_calendar_steal");
  if (intent === "notes.read") issues.push("task_vs_notes_steal");
  if (!READ_TASK.has(intent)) issues.push("routing_fail:" + intent);
  if (!msg.trim() || /Nic jsem k tomu nenašel/i.test(msg)) issues.push("retrieval_fail:empty");
  if (c.forbidBulkList && isBulkTaskList(msg)) issues.push("retrieval_fail:bulk_list");
  if (c.entityRx && READ_TASK.has(intent) && !c.entityRx.test(msg)) issues.push("retrieval_fail:entity_miss");
  if (c.valueRx && READ_TASK.has(intent) && !c.valueRx.test(msg)) issues.push("retrieval_fail:value_miss");
  return issues;
}

function classifyFail(c, intent, issues) {
  if (issues.length === 0) return { kind: "OK", root: "item_ok" };
  if (issues.indexOf("write_leak") >= 0) return { kind: "TRUE_ENGINE_FAIL", root: "routing_fail" };
  if (issues.some(function (x) {
    return x.indexOf("task_vs_calendar_steal") === 0;
  })) {
    return { kind: "TRUE_ENGINE_FAIL", root: "task_vs_calendar_steal" };
  }
  if (issues.some(function (x) {
    return x.indexOf("task_vs_notes_steal") === 0;
  })) {
    return { kind: "TRUE_ENGINE_FAIL", root: "task_vs_notes_steal" };
  }
  if (issues.some(function (x) {
    return x.indexOf("steal:") === 0;
  })) {
    return { kind: "TRUE_ENGINE_FAIL", root: "cross_module_steal" };
  }
  if (issues.some(function (x) {
    return x.indexOf("routing_fail") === 0;
  })) {
    return { kind: "TRUE_ENGINE_FAIL", root: "routing_fail" };
  }
  if (issues.some(function (x) {
    return x.indexOf("retrieval_fail:bulk") >= 0;
  })) {
    return { kind: "RETRIEVAL_FAIL", root: "ranking_fail" };
  }
  if (issues.some(function (x) {
    return x.indexOf("retrieval_fail") === 0;
  })) {
    return { kind: "RETRIEVAL_FAIL", root: "retrieval_fail" };
  }
  return { kind: "HARNESS_FAIL", root: issues.join("|") };
}

function bucketPass(rows, bucket) {
  const sub = rows.filter(function (r) {
    return r.bucket === bucket;
  });
  const ok = sub.filter(function (r) {
    return r.PASS;
  }).length;
  return ok + "/" + sub.length;
}

function main() {
  const eng = loadEngine();
  const ctx = seedCtx();
  const rows = [];
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    const msg = turnMsg(turn);
    const issues = evaluateCase(c, intent, msg);
    const cls = classifyFail(c, intent, issues);
    rows.push({
      id: c.id,
      bucket: c.bucket,
      INPUT: c.input,
      EXPECTED: c.expected,
      ACTUAL: intent,
      RESPONSE: msg.slice(0, 280),
      ISSUES: issues,
      PASS: issues.length === 0,
      CLASSIFICATION: cls.kind,
      ROOT_CAUSE: cls.root
    });
  }

  const pass = rows.filter(function (r) {
    return r.PASS;
  }).length;
  const breakdown = {};
  for (let j = 0; j < rows.length; j++) {
    if (rows[j].PASS) continue;
    const k = rows[j].ROOT_CAUSE;
    breakdown[k] = (breakdown[k] || 0) + 1;
  }
  let topCluster = "(none)";
  let topCount = 0;
  const keys = Object.keys(breakdown);
  for (let k = 0; k < keys.length; k++) {
    if (breakdown[keys[k]] > topCount) {
      topCount = breakdown[keys[k]];
      topCluster = keys[k];
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mainCommit: require("child_process").execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim(),
    engineChanged: false,
    cases: rows,
    summary: {
      TOTAL_CASES: rows.length,
      PASS: pass,
      FAIL: rows.length - pass,
      DEADLINE_ITEM_PASS: bucketPass(rows, "DEADLINE_ITEM"),
      ENTITY_ACTION_PASS: bucketPass(rows, "ENTITY_ACTION"),
      SYNONYM_ACTION_PASS: bucketPass(rows, "SYNONYM_ACTION"),
      CROSS_MODULE_STEAL_PASS: bucketPass(rows, "CROSS_MODULE_STEAL"),
      TRUE_ENGINE_FAILS: rows.filter(function (r) {
        return r.CLASSIFICATION === "TRUE_ENGINE_FAIL";
      }).length,
      HARNESS_FAILS: rows.filter(function (r) {
        return r.CLASSIFICATION === "HARNESS_FAIL";
      }).length,
      AMBIGUOUS_CASES: rows.filter(function (r) {
        return r.CLASSIFICATION === "AMBIGUITY";
      }).length,
      TOP_TRUE_ENGINE_CLUSTER: topCluster
    },
    rootCauseBreakdown: breakdown
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log("=== TASK_ITEM_FALLBACK_SEARCH_DIAGNOSTIC ===");
  console.log("TOTAL_CASES=" + report.summary.TOTAL_CASES);
  console.log("PASS=" + report.summary.PASS);
  console.log("FAIL=" + report.summary.FAIL);
  console.log("DEADLINE_ITEM_PASS=" + report.summary.DEADLINE_ITEM_PASS);
  console.log("ENTITY_ACTION_PASS=" + report.summary.ENTITY_ACTION_PASS);
  console.log("SYNONYM_ACTION_PASS=" + report.summary.SYNONYM_ACTION_PASS);
  console.log("CROSS_MODULE_STEAL_PASS=" + report.summary.CROSS_MODULE_STEAL_PASS);
  console.log("TRUE_ENGINE_FAILS=" + report.summary.TRUE_ENGINE_FAILS);
  console.log("HARNESS_FAILS=" + report.summary.HARNESS_FAILS);
  console.log("AMBIGUOUS_CASES=" + report.summary.AMBIGUOUS_CASES);
  console.log("ROOT_CAUSE_BREAKDOWN=" + JSON.stringify(breakdown));
  console.log("TOP_TRUE_ENGINE_CLUSTER=" + topCluster);
  console.log("RECOMMENDED_NEXT_FIX_SCOPE=P1: task item retrieval ranking + narrow task-read fallback search (mirror note fallback V1)");
  console.log("PHASE_B_ENGINE_CHANGED=NO");
  console.log("PHASE_B_ASSETS_APP_CHANGED=NO");
  console.log("REPORT=" + REPORT_PATH);
  console.log("PASS_FAIL=" + (pass === rows.length ? "PASS" : "FAIL"));
  console.log("=== END_TASK_ITEM_FALLBACK_SEARCH_DIAGNOSTIC ===");

  process.exit(0);
}

if (require.main === module) main();
