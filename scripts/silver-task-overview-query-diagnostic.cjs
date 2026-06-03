#!/usr/bin/env node
"use strict";

/**
 * TASK OVERVIEW QUERY VARIANTS — diagnostic only (read-only engine).
 */
const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-task-overview-query-diagnostic-report.json");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const FIXED_NOW = new Date(2026, 5, 3, 12, 0, 0);

const CASES = [
  { id: "A_01", bucket: "ACTIVE", input: "Co mám za úkoly", expected: "tasks.read", expectKind: "active_list" },
  { id: "A_02", bucket: "ACTIVE", input: "Jaké mám úkoly", expected: "tasks.read", expectKind: "active_list" },
  { id: "A_03", bucket: "ACTIVE", input: "Jaké mám aktivní úkoly", expected: "tasks.read", expectKind: "active_list" },
  { id: "B_01", bucket: "UNFINISHED", input: "Co mám ještě udělat", expected: "tasks.read", expectKind: "active_list" },
  { id: "B_02", bucket: "UNFINISHED", input: "Co mi zbývá", expected: "tasks.read", expectKind: "active_list" },
  { id: "B_03", bucket: "UNFINISHED", input: "Co ještě nemám hotové", expected: "tasks.read", expectKind: "active_list" },
  { id: "B_04", bucket: "UNFINISHED", input: "Co mě čeká", expected: "tasks.read", expectKind: "active_list" },
  { id: "C_01", bucket: "COMPLETED", input: "Co jsem dokončil", expected: "tasks.read", expectKind: "status_done" },
  { id: "C_02", bucket: "COMPLETED", input: "Co jsem splnil", expected: "tasks.read", expectKind: "status_done" },
  { id: "C_03", bucket: "COMPLETED", input: "Jaké mám hotové úkoly", expected: "tasks.read", expectKind: "status_done" },
  { id: "D_01", bucket: "SYNONYM", input: "Jaké mám hotové úkoly", expected: "tasks.read", expectKind: "status_done" },
  { id: "D_02", bucket: "SYNONYM", input: "Co mám rozdělané", expected: "tasks.read", expectKind: "status_in_progress" },
  { id: "D_03", bucket: "SYNONYM", input: "Jaké mám nesplněné úkoly", expected: "tasks.read", expectKind: "status_todo" },
  { id: "D_04", bucket: "SYNONYM", input: "Jaké mám otevřené úkoly", expected: "tasks.read", expectKind: "status_todo" }
];

function seedTasks() {
  return [
    { id: "t_najem", title: "Zaplatit nájem", status: "todo", updatedAt: 1 },
    { id: "t_mama", title: "Koupit dárek mámě", status: "todo", updatedAt: 1 },
    { id: "t_eli", title: "Vyzvednout Eli ze školy", status: "todo", updatedAt: 1 },
    { id: "t_pravnik", title: "Zavolat právníkovi ohledně smlouvy", status: "in_progress", updatedAt: 2 },
    { id: "t_doktor", title: "Zavolat doktorovi", status: "todo", updatedAt: 1 },
    { id: "t_auto", title: "Zařídit STK a pojištění auta", status: "todo", updatedAt: 1 },
    { id: "t_darek", title: "Koupit dárek k narozeninám", status: "todo", updatedAt: 1 },
    { id: "t_done", title: "Objednat toner", status: "done", updatedAt: 1 },
    { id: "t_prog", title: "Dokončit prezentaci", status: "in_progress", updatedAt: 3 }
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

function evaluatePass(c, intent, msg) {
  const issues = [];
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak");
  if (intent !== c.expected) issues.push("wrong_module:" + intent);
  if (!msg.trim() || /Nic jsem k tomu nenašel/i.test(msg)) issues.push("empty_response");
  if (c.expectKind === "status_done") {
    if (!/Objednat toner|hotov/i.test(msg)) issues.push("status_done_miss");
  }
  if (c.expectKind === "status_in_progress") {
    if (isBulkTaskList(msg) || !/prezentac|rozd[eě]lan|in.?progress|pravnik/i.test(msg)) {
      issues.push("status_in_progress_miss");
    }
  }
  if (c.expectKind === "status_todo") {
    if (isBulkTaskList(msg)) issues.push("status_todo_miss");
  }
  return issues;
}

function classifyFail(c, intent, issues) {
  if (issues.indexOf("write_leak") >= 0) return { kind: "TRUE_ENGINE_FAIL", root: "query_write_leak" };
  if (issues.some(function (x) {
    return x.indexOf("wrong_module:") === 0;
  })) {
    if (intent === "notes.read") return { kind: "TRUE_ENGINE_FAIL", root: "note_module_steals_task_overview" };
    if (intent === "global.search") return { kind: "SYNONYM_GAP", root: "vague_future_queue_not_mapped_to_tasks" };
    return { kind: "TRUE_ENGINE_FAIL", root: "routing_fail:" + intent };
  }
  if (issues.indexOf("status_in_progress_miss") >= 0 || issues.indexOf("status_todo_miss") >= 0) {
    return { kind: "TRUE_ENGINE_FAIL", root: "task_status_filter_not_applied" };
  }
  if (issues.indexOf("empty_response") >= 0) return { kind: "SYNONYM_GAP", root: "overview_empty_read_answer" };
  if (issues.length) return { kind: "HARNESS_FAIL", root: issues.join("|") };
  return { kind: "OK", root: "overview_ok" };
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
    const issues = evaluatePass(c, intent, msg);
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
  const trueEngine = rows.filter(function (r) {
    return r.CLASSIFICATION === "TRUE_ENGINE_FAIL";
  }).length;
  const harness = rows.filter(function (r) {
    return r.CLASSIFICATION === "HARNESS_FAIL";
  }).length;
  const ambiguous = rows.filter(function (r) {
    return r.CLASSIFICATION === "AMBIGUITY";
  }).length;

  const clusters = {};
  for (let j = 0; j < rows.length; j++) {
    if (rows[j].PASS) continue;
    const k = rows[j].ROOT_CAUSE;
    clusters[k] = (clusters[k] || 0) + 1;
  }
  let topCluster = "(none)";
  let topCount = 0;
  const keys = Object.keys(clusters);
  for (let k = 0; k < keys.length; k++) {
    if (clusters[keys[k]] > topCount) {
      topCount = clusters[keys[k]];
      topCluster = keys[k];
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    cases: rows,
    summary: {
      TOTAL_CASES: rows.length,
      PASS: pass,
      FAIL: rows.length - pass,
      ACTIVE_PASS: bucketPass(rows, "ACTIVE"),
      UNFINISHED_PASS: bucketPass(rows, "UNFINISHED"),
      COMPLETED_PASS: bucketPass(rows, "COMPLETED"),
      SYNONYM_PASS: bucketPass(rows, "SYNONYM"),
      TRUE_ENGINE_FAILS: trueEngine,
      HARNESS_FAILS: harness,
      AMBIGUOUS_CASES: ambiguous,
      TOP_TRUE_ENGINE_CLUSTER: topCluster
    }
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log("=== TASK_OVERVIEW_DIAGNOSTIC_REPORT ===");
  console.log("TOTAL_CASES=" + report.summary.TOTAL_CASES);
  console.log("PASS=" + report.summary.PASS);
  console.log("FAIL=" + report.summary.FAIL);
  console.log("ACTIVE_PASS=" + report.summary.ACTIVE_PASS);
  console.log("UNFINISHED_PASS=" + report.summary.UNFINISHED_PASS);
  console.log("COMPLETED_PASS=" + report.summary.COMPLETED_PASS);
  console.log("SYNONYM_PASS=" + report.summary.SYNONYM_PASS);
  console.log("TRUE_ENGINE_FAILS=" + report.summary.TRUE_ENGINE_FAILS);
  console.log("HARNESS_FAILS=" + report.summary.HARNESS_FAILS);
  console.log("AMBIGUOUS_CASES=" + report.summary.AMBIGUOUS_CASES);
  console.log("TOP_TRUE_ENGINE_CLUSTER=" + report.summary.TOP_TRUE_ENGINE_CLUSTER);
  console.log("ROOT_CAUSE_BREAKDOWN=" + JSON.stringify(clusters));
  console.log("REPORT=" + REPORT_PATH);
  console.log("=== END_TASK_OVERVIEW_DIAGNOSTIC_REPORT ===");

  process.exit(pass === rows.length ? 0 : 1);
}

if (require.main === module) main();

module.exports = { CASES: CASES, seedCtx: seedCtx };
