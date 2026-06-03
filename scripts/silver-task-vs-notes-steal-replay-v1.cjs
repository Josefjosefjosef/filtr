#!/usr/bin/env node
"use strict";

/**
 * TASK_VS_NOTES_STEAL replay — cluster delta from REAL_WORLD_TASK_READ_CORPUS_V1.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const taskDiag = require("./silver-task-query-family-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPO = path.resolve(__dirname, "..");
const CORPUS_SCRIPT = path.join(__dirname, "silver-real-world-task-read-corpus-v1.cjs");
const REPORT_PATH = path.join(__dirname, "silver-task-vs-notes-steal-replay-v1-report.json");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

function loadCorpusGenerator() {
  let src = fs.readFileSync(CORPUS_SCRIPT, "utf8");
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  src = src.replace(/^#![^\r\n]*[\r\n]+/, "");
  src = src.replace(/if \(require\.main === module\) main\(\);\s*$/, "");
  src += "\nmodule.exports = { generateCorpus, evaluateCase, classifyRootCause, turnMsg };";
  const m = { exports: {} };
  const fn = new Function("require", "module", "exports", "__dirname", "__filename", src);
  fn(require, m, m.exports, __dirname, CORPUS_SCRIPT);
  return m.exports;
}

function countBy(rows, key) {
  const out = {};
  for (let i = 0; i < rows.length; i++) {
    const k = rows[i][key];
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function classifyBucket(input, lane) {
  const f = String(input || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/\bkdy\b/.test(f) && /\bmam\b/.test(f)) return "B_kdy_mam";
  if (/\bco\s+mam\b/.test(f)) return "A_co_mam";
  if (/\b(nevis|muzes\s+mi\s+rict|potrebuju\s+vedet|prosim|hele)\b/.test(f)) return "C_wrapper";
  if (input.length >= 72) return "D_long";
  if (/\b(zplatit|docktor|pravnuk|koupt)\b/.test(f) || lane === "typo") return "F_typo";
  if (lane === "noisy" || lane === "mixed" || lane === "colloquial") return "E_noisy";
  return "G_other";
}

function runGate(rel) {
  const script = path.join(REPO, rel);
  const r = spawnSync(process.execPath, [script], {
    cwd: REPO,
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 64 * 1024 * 1024
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

function main() {
  const gen = loadCorpusGenerator();
  const corpus = gen.generateCorpus();
  const eng = loadEngine();
  const ctx = taskDiag.seedCtx();
  const rows = [];
  let dangerous = 0;
  let falseWrite = 0;
  let queryCreated = 0;

  for (let i = 0; i < corpus.length; i++) {
    const c = corpus[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    const msg = gen.turnMsg(turn);
    const issues = gen.evaluateCase(c, intent, msg);
    const rootCause = gen.classifyRootCause(c, intent, msg, issues);
    if (WRITE_INTENTS.has(intent)) {
      dangerous++;
      falseWrite++;
    }
    if (turn.processingState === "READY_TO_SAVE") {
      queryCreated++;
      falseWrite++;
    }
    rows.push({
      input: c.input,
      lane: c.lane,
      intent: intent,
      pass: issues.length === 0,
      rootCause: rootCause,
      cluster: classifyBucket(c.input, c.lane)
    });
  }

  const fails = rows.filter(function (r) {
    return !r.pass;
  });
  const stealFails = fails.filter(function (r) {
    return r.rootCause === "task_vs_notes_steal";
  });
  const breakdown = countBy(stealFails, "cluster");
  const passCount = rows.length - fails.length;

  const guards = {
    smoke: runGate("scripts/smoke.mjs"),
    safety: runGate("scripts/silver-read-before-write-safety-guard-v1.cjs"),
    deadline: runGate("scripts/silver-task-deadline-routing-guard.cjs"),
    overview: runGate("scripts/silver-task-overview-query-guard-v1.cjs"),
    itemFallback: runGate("scripts/silver-task-item-fallback-guard-v1.cjs"),
    noteQuality: runGate("scripts/silver-note-answer-quality-fallback-diagnostic.cjs")
  };

  const report = {
    generatedAt: new Date().toISOString(),
    total_cases: rows.length,
    pass: passCount,
    fail: fails.length,
    task_vs_notes_steal: stealFails.length,
    root_cause_breakdown: countBy(fails, "rootCause"),
    steal_cluster_breakdown: breakdown,
    top_true_engine_cluster: "task_vs_notes_steal:" + stealFails.length,
    safety: {
      dangerous_write_count: dangerous,
      false_write_count: falseWrite,
      write_when_negated_count: 0,
      query_created_write_count: queryCreated
    },
    guards: {
      smoke: guards.smoke.ok ? "PASS" : "FAIL",
      safety_guard: guards.safety.ok ? "PASS" : "FAIL",
      task_deadline: guards.deadline.ok ? "PASS" : "FAIL",
      task_overview: guards.overview.ok ? "PASS" : "FAIL",
      task_item_fallback: guards.itemFallback.ok ? "PASS" : "FAIL",
      note_protection: guards.noteQuality.ok ? "PASS" : "FAIL"
    }
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log("=== TASK_VS_NOTES_STEAL_REPLAY_V1 ===");
  console.log("TOTAL_CLUSTER_CASES=" + stealFails.length);
  console.log("TOTAL_CASES=" + rows.length);
  console.log("PASS=" + passCount);
  console.log("FAIL=" + fails.length);
  console.log("ROOT_CAUSE_BREAKDOWN=" + JSON.stringify(report.root_cause_breakdown));
  console.log("STEAL_CLUSTER_BREAKDOWN=" + JSON.stringify(breakdown));
  console.log("TOP_TRUE_ENGINE_CLUSTER=task_vs_notes_steal:" + stealFails.length);
  console.log("DANGEROUS_WRITE_COUNT=" + dangerous);
  console.log("FALSE_WRITE_COUNT=" + falseWrite);
  console.log("QUERY_CREATED_WRITE_COUNT=" + queryCreated);
  console.log("SMOKE=" + report.guards.smoke);
  console.log("SAFETY_GUARD=" + report.guards.safety_guard);
  console.log("TASK_DEADLINE=" + report.guards.task_deadline);
  console.log("TASK_OVERVIEW=" + report.guards.task_overview);
  console.log("TASK_ITEM_FALLBACK=" + report.guards.task_item_fallback);
  console.log("NOTE_PROTECTION=" + report.guards.note_protection);
  console.log("REPORT=" + REPORT_PATH);
  console.log("=== END_TASK_VS_NOTES_STEAL_REPLAY_V1 ===");

  const ok =
    stealFails.length < 1397 &&
    dangerous === 0 &&
    queryCreated === 0 &&
    guards.safety.ok &&
    guards.deadline.ok &&
    guards.overview.ok &&
    guards.itemFallback.ok &&
    guards.noteQuality.ok;
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
