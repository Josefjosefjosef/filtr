#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const diag = require("./silver-note-answer-quality-fallback-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-note-answer-quality-fallback-guard-report.json");
const WRITE_INTENTS = new Set(["calendar.create", "tasks.create", "notes.create", "create.storage_disambiguation"]);

const NOTE_FULL_ANSWER_FAMILY = [
  {
    id: "NFAQ_001",
    input: "Jaký je pin k vstupním dveřím",
    mustRx: [/pin|PIN/i, /vstupn/i, /\d{3}/, /Pozn[aá]mka vytvo[řr]en[aá] dne/i],
    mustNotRx: [/^od vstupn/i, /^k trezor/i]
  },
  {
    id: "NFAQ_002",
    input: "Jaký je kód k trezoru",
    mustRx: [/k[oó]d/i, /trezor/i, /234/, /Pozn[aá]mka vytvo[řr]en[aá] dne/i],
    mustNotRx: [/^k trezor je 234/i]
  },
  {
    id: "NFAQ_003",
    input: "Jakou má Volvo SPZ",
    mustRx: [/volv/i, /SPZ/i, /ABC|4243/, /Pozn[aá]mka vytvo[řr]en[aá] dne/i]
  },
  {
    id: "NFAQ_004",
    input: "Kdy končí záruka na televizi",
    mustRx: [/z[aá]ruk/i, /televiz/i, /2027|lednu/i, /Pozn[aá]mka vytvo[řr]en[aá] dne/i]
  },
  {
    id: "NFAQ_005",
    input: "Jaké je heslo k wifi",
    mustRx: [/heslo/i, /wifi/i, /Modra|2024/i, /Pozn[aá]mka vytvo[řr]en[aá] dne/i]
  }
];

const FORBIDDEN_FRAGMENT_EXACT = diag.FORBIDDEN_FRAGMENTS;

const HELP_EXCLUSION = diag.HELP_EXCLUSION_FAMILY;

const SAVE_PREFIX = diag.SAVE_PREFIX_FAMILY;

const TASK_REGRESSION = [
  { input: "Jaké mám úkoly", expected: "tasks.read" },
  { input: "Co mám rozdělané", expected: "tasks.read" },
  { input: "Připomeň mi zítra v 15 zavolat mámě", expected: "tasks.create" }
];

const SAFETY_NEGATION = [
  "nic neukládej",
  "jen čti",
  "pouze čti",
  "neukládej"
];

function turnMsg(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
}

function evaluateNoteFullAnswer(eng, ctx) {
  const rows = [];
  for (let i = 0; i < NOTE_FULL_ANSWER_FAMILY.length; i++) {
    const c = NOTE_FULL_ANSWER_FAMILY[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const msg = turnMsg(turn);
    const first = msg.split("\n")[0].trim();
    const issues = [];
    for (let mi = 0; mi < c.mustRx.length; mi++) {
      if (!c.mustRx[mi].test(msg)) issues.push("must:" + c.mustRx[mi]);
    }
    if (c.mustNotRx) {
      for (let ni = 0; ni < c.mustNotRx.length; ni++) {
        if (c.mustNotRx[ni].test(first)) issues.push("must_not:" + c.mustNotRx[ni]);
      }
    }
    if (diag.isForbiddenFragment(msg)) issues.push("forbidden_fragment");
    rows.push({ id: c.id, input: c.input, pass: issues.length === 0, issues: issues, message: msg.slice(0, 180) });
  }
  return rows;
}

function evaluateForbidden(eng, ctx) {
  const rows = [];
  for (let i = 0; i < NOTE_FULL_ANSWER_FAMILY.length; i++) {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(NOTE_FULL_ANSWER_FAMILY[i].input, eng.createEmptyDraft(), ctx);
    const first = turnMsg(turn).split("\n")[0].trim();
    for (let fi = 0; fi < FORBIDDEN_FRAGMENT_EXACT.length; fi++) {
      rows.push({
        input: NOTE_FULL_ANSWER_FAMILY[i].input,
        fragment: FORBIDDEN_FRAGMENT_EXACT[fi],
        pass: first.toLowerCase() !== FORBIDDEN_FRAGMENT_EXACT[fi].toLowerCase()
      });
    }
  }
  return rows;
}

function evaluateHelp(eng, ctx) {
  const rows = [];
  for (let i = 0; i < HELP_EXCLUSION.length; i++) {
    const input = HELP_EXCLUSION[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
    const usedFallback = !!(turn.readQuery && turn.readQuery.noteReadFallbackV1);
    const isWrite = WRITE_INTENTS.has(String(turn.normalizedIntent || "")) || turn.processingState === "READY_TO_SAVE";
    rows.push({ input: input, usedFallback: usedFallback, isWrite: isWrite, pass: !usedFallback && !isWrite });
  }
  return rows;
}

function evaluateSavePrefix(eng, ctx) {
  const rows = [];
  for (let i = 0; i < SAVE_PREFIX.length; i++) {
    const c = SAVE_PREFIX[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    rows.push({
      input: c.input,
      expected: c.expected,
      observed: intent,
      pass: intent === c.expected && !(turn.readQuery && turn.readQuery.noteReadFallbackV1)
    });
  }
  return rows;
}

function evaluateTaskRegression(eng, ctx) {
  const rows = [];
  for (let i = 0; i < TASK_REGRESSION.length; i++) {
    const c = TASK_REGRESSION[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    rows.push({ input: c.input, expected: c.expected, observed: String(turn.normalizedIntent || ""), pass: String(turn.normalizedIntent || "") === c.expected });
  }
  return rows;
}

function evaluateSafety(eng, ctx) {
  let dangerous_write_count = 0;
  let false_write_count = 0;
  let write_when_negated_count = 0;
  let query_created_write_count = 0;
  const rows = [];
  const inputs = NOTE_FULL_ANSWER_FAMILY.map(function (c) {
    return c.input;
  }).concat(
    HELP_EXCLUSION,
    SAVE_PREFIX.map(function (s) {
      return s.input;
    }),
    TASK_REGRESSION.map(function (t) {
      return t.input;
    })
  );
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    if (WRITE_INTENTS.has(intent) && NOTE_FULL_ANSWER_FAMILY.some(function (c) { return c.input === input; })) {
      dangerous_write_count++;
      false_write_count++;
    }
    if (turn.processingState === "READY_TO_SAVE" && NOTE_FULL_ANSWER_FAMILY.some(function (c) { return c.input === input; })) {
      query_created_write_count++;
      false_write_count++;
    }
  }
  for (let si = 0; si < SAFETY_NEGATION.length; si++) {
    const input = "Jen najdi PIN od dveří, " + SAFETY_NEGATION[si];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    const isWrite = WRITE_INTENTS.has(intent) || turn.processingState === "READY_TO_SAVE";
    if (isWrite) {
      dangerous_write_count++;
      write_when_negated_count++;
    }
    rows.push({ input: input, pass: !isWrite });
  }
  return {
    rows: rows,
    dangerous_write_count: dangerous_write_count,
    false_write_count: false_write_count,
    write_when_negated_count: write_when_negated_count,
    query_created_write_count: query_created_write_count
  };
}

function evaluateRuntime(eng, ctx) {
  const f = "jaky je kod k trezoru";
  const fb = eng.iuSilverNoteReadFallbackSearchV1("Jaký je kód k trezoru", f, ctx, ctx.now);
  const pass = fb.runtimeMs != null && fb.runtimeMs < 500;
  return { runtimeMs: fb.runtimeMs, pass: pass, score: fb.score };
}

function main() {
  const eng = loadEngine();
  const ctx = diag.seedCtx();
  const noteFull = evaluateNoteFullAnswer(eng, ctx);
  const forbidden = evaluateForbidden(eng, ctx);
  const help = evaluateHelp(eng, ctx);
  const savePrefix = evaluateSavePrefix(eng, ctx);
  const taskReg = evaluateTaskRegression(eng, ctx);
  const safety = evaluateSafety(eng, ctx);
  const runtime = evaluateRuntime(eng, ctx);

  const pass =
    noteFull.every(function (r) {
      return r.pass;
    }) &&
    forbidden.every(function (r) {
      return r.pass;
    }) &&
    help.every(function (r) {
      return r.pass;
    }) &&
    savePrefix.every(function (r) {
      return r.pass;
    }) &&
    taskReg.every(function (r) {
      return r.pass;
    }) &&
    safety.rows.every(function (r) {
      return r.pass;
    }) &&
    safety.dangerous_write_count === 0 &&
    safety.false_write_count === 0 &&
    safety.write_when_negated_count === 0 &&
    safety.query_created_write_count === 0 &&
    runtime.pass;

  const report = {
    generatedAt: new Date().toISOString(),
    pass: pass,
    note_full_answer_family: noteFull,
    forbidden_fragment_family: forbidden,
    help_exclusion_family: help,
    save_prefix_family: savePrefix,
    task_regression_family: taskReg,
    safety_family: safety,
    runtime_family: runtime,
    next_family_task_overview: ["Co mám za úkoly", "Jaké mám aktivní úkoly", "Co mám ještě udělat", "Jaké mám hotové úkoly"],
    next_family_task_item_fallback: ["Kdy mám zaplatit nájem", "Co mám koupit mámě", "Kdy mám vyzvednout Eli", "Co mám udělat s právníkem"]
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log("=== SILVER_NOTE_ANSWER_QUALITY_FALLBACK_GUARD ===");
  console.log("PASS=" + (pass ? "true" : "false"));
  console.log("NOTE_FULL_ANSWER=" + noteFull.filter(function (r) { return r.pass; }).length + "/" + noteFull.length);
  console.log("FORBIDDEN_FRAGMENT_PASS=" + (forbidden.every(function (r) { return r.pass; }) ? "true" : "false"));
  console.log("HELP_EXCLUSION_PASS=" + (help.every(function (r) { return r.pass; }) ? "true" : "false"));
  console.log("SAVE_PREFIX_PASS=" + (savePrefix.every(function (r) { return r.pass; }) ? "true" : "false"));
  console.log("TASK_REGRESSION_PASS=" + (taskReg.every(function (r) { return r.pass; }) ? "true" : "false"));
  console.log("FALLBACK_RUNTIME_MS=" + runtime.runtimeMs);
  console.log("DANGEROUS_WRITE_COUNT=" + safety.dangerous_write_count);
  console.log("FALSE_WRITE_COUNT=" + safety.false_write_count);
  console.log("WRITE_WHEN_NEGATED_COUNT=" + safety.write_when_negated_count);
  console.log("QUERY_CREATED_WRITE_COUNT=" + safety.query_created_write_count);
  console.log("REPORT=" + REPORT_PATH);
  console.log("=== END_SILVER_NOTE_ANSWER_QUALITY_FALLBACK_GUARD ===");
  process.exit(pass ? 0 : 1);
}

if (require.main === module) main();
