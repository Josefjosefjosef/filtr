#!/usr/bin/env node
"use strict";

/**
 * TASK ITEM FALLBACK SEARCH V1 — read-only retrieval guard.
 */
const fs = require("fs");
const path = require("path");
const noteDiag = require("./silver-note-answer-quality-fallback-diagnostic.cjs");
const taskDiag = require("./silver-task-query-family-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-task-item-fallback-guard-v1-report.json");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const DEADLINE_FAMILY = [
  { id: "TD_01", input: "Kdy mám zaplatit nájem", entityRx: /n[aá]jem/i, valueRx: /5\.|6\.|2026|term[ií]n|zaplatit/i },
  { id: "TD_02", input: "Kdy mám koupit dárek", entityRx: /d[aá]rek|narozenin/i, valueRx: /10\.|narozenin|term[ií]n/i, wrongEntityRx: /^Našel jsem úkol: Koupit dárek m[aá]m[eě]\./i },
  { id: "TD_03", input: "Kdy mám zavolat doktorovi", entityRx: /doktor/i, valueRx: /6\.|9:00|term[ií]n|zavolat/i },
  { id: "TD_04", input: "Kdy mám vyzvednout Eli", entityRx: /eli/i, valueRx: /4\.|15:30|term[ií]n/i }
];

const ENTITY_FAMILY = [
  { id: "TE_01", input: "Co mám koupit mámě", entityRx: /m[aá]m[eě]|d[aá]rek/i, valueRx: /Koupit d[aá]rek m[aá]m[eě]/i, forbidBulkList: true },
  { id: "TE_02", input: "Co mám udělat s právníkem", entityRx: /pr[aá]vn/i, valueRx: /pr[aá]vn|smlouv/i },
  { id: "TE_03", input: "Co mám zařídit kolem auta", entityRx: /aut|stk|pojist/i, valueRx: /auta|STK|pojist/i },
  { id: "TE_04", input: "Co mám vyřešit s doktorem", entityRx: /doktor/i, valueRx: /doktor|zavolat/i }
];

const SYNONYM_FAMILY = [
  { id: "SY_01", input: "uhradit nájem", entityRx: /n[aá]jem|zaplatit/i, valueRx: /n[aá]jem|zaplatit|term[ií]n/i, allowClarification: false },
  { id: "SY_02", input: "kontaktovat doktora", entityRx: /doktor|zavolat/i, valueRx: /doktor|zavolat|term[ií]n/i, allowClarification: false },
  { id: "SY_03", input: "pořídit dárek", entityRx: /d[aá]rek|koupit|narozenin/i, valueRx: /d[aá]rek|koupit|narozenin|term[ií]n/i, allowClarification: false },
  { id: "SY_04", input: "zařídit auto", entityRx: /aut|stk|pojist/i, valueRx: /aut|STK|pojist/i, allowClarification: false }
];

const NOTE_PROTECTION = [
  { id: "NP_01", input: "Jakou má Volvo SPZ", expected: "notes.read" },
  { id: "NP_02", input: "Jaké je heslo k wifi", expected: "notes.read" },
  { id: "NP_03", input: "Jaký je kód k trezoru", expected: "notes.read" },
  { id: "NP_04", input: "Kdy končí záruka na televizi", expected: "notes.read" }
];

const CALENDAR_PROTECTION = [
  { id: "CP_01", input: "Kdy mám zubaře", expected: "calendar.read" },
  { id: "CP_02", input: "Kdy mám právníka", expected: "calendar.read" },
  { id: "CP_03", input: "Kdy mám schůzku s Tomášem", expected: "calendar.read" },
  { id: "CP_04", input: "Kdy mám poradu", expected: "calendar.read" }
];

const SAVE_PREFIX = noteDiag.SAVE_PREFIX_FAMILY;

function turnMsg(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
}

function isBulkTaskList(msg) {
  return /M[aá][šs]\s+\d+\s+aktivn[ií]\s+úkoly/i.test(msg) || /:\s*1\.\s+/i.test(msg);
}

function evaluateItem(c, intent, msg) {
  const issues = [];
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak");
  if (intent === "calendar.read") issues.push("calendar_steal");
  if (intent === "notes.read") issues.push("note_steal");
  if (intent !== "tasks.read" && intent !== "tasks.query" && intent !== "global.search") {
    if (!(c.allowClarification && (intent === "unknown" || intent === "clarification"))) {
      issues.push("wrong_module:" + intent);
    }
  }
  if (!msg.trim() || /Nic jsem k tomu nena[sš]el/i.test(msg)) issues.push("empty_response");
  if (c.forbidBulkList && isBulkTaskList(msg)) issues.push("bulk_list");
  if (c.entityRx && !c.entityRx.test(msg)) issues.push("entity_miss");
  if (c.valueRx && !c.valueRx.test(msg)) issues.push("value_miss");
  if (c.wrongEntityRx && c.wrongEntityRx.test(msg.split("\n")[0].trim())) issues.push("wrong_ranked_task");
  return issues;
}

function runItemCase(eng, ctx, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const intent = String(turn.normalizedIntent || "");
  const msg = turnMsg(turn);
  const issues = evaluateItem(c, intent, msg);
  return { id: c.id, input: c.input, intent: intent, pass: issues.length === 0, issues: issues, message: msg.slice(0, 200) };
}

function runIntentCase(eng, ctx, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const intent = String(turn.normalizedIntent || "");
  const issues = [];
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak");
  if (intent !== c.expected) issues.push("intent:" + intent);
  return { id: c.id, input: c.input, pass: issues.length === 0, issues: issues };
}

function evaluateSafety(eng, ctx) {
  let dangerous_write_count = 0;
  let false_write_count = 0;
  let write_when_negated_count = 0;
  let query_created_write_count = 0;
  const readInputs = DEADLINE_FAMILY.concat(ENTITY_FAMILY)
    .map(function (c) {
      return c.input;
    })
    .concat(
      NOTE_PROTECTION.map(function (c) {
        return c.input;
      })
    );
  for (let i = 0; i < readInputs.length; i++) {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(readInputs[i], eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    if (WRITE_INTENTS.has(intent)) {
      dangerous_write_count++;
      false_write_count++;
    }
    if (turn.processingState === "READY_TO_SAVE") {
      query_created_write_count++;
      false_write_count++;
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
  const ctx = taskDiag.seedCtx();
  const deadline = DEADLINE_FAMILY.map(function (c) {
    return runItemCase(eng, ctx, c);
  });
  const entity = ENTITY_FAMILY.map(function (c) {
    return runItemCase(eng, ctx, c);
  });
  const synonyms = SYNONYM_FAMILY.map(function (c) {
    return runItemCase(eng, ctx, c);
  });
  const notes = NOTE_PROTECTION.map(function (c) {
    return runIntentCase(eng, ctx, c);
  });
  const calendar = CALENDAR_PROTECTION.map(function (c) {
    return runIntentCase(eng, ctx, c);
  });
  const savePrefix = SAVE_PREFIX.map(function (c) {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    return {
      input: c.input,
      expected: c.expected,
      observed: intent,
      pass: intent === c.expected
    };
  });
  const safety = evaluateSafety(eng, ctx);
  const corePass =
    deadline.every(function (r) {
      return r.pass;
    }) &&
    entity.every(function (r) {
      return r.pass;
    });
  const synonymPass = synonyms.every(function (r) {
    return r.pass;
  });
  const pass =
    corePass &&
    synonymPass &&
    notes.every(function (r) {
      return r.pass;
    }) &&
    calendar.every(function (r) {
      return r.pass;
    }) &&
    savePrefix.every(function (r) {
      return r.pass;
    }) &&
    safety.dangerous_write_count === 0 &&
    safety.false_write_count === 0 &&
    safety.write_when_negated_count === 0 &&
    safety.query_created_write_count === 0;

  const report = {
    generatedAt: new Date().toISOString(),
    pass: pass,
    core_pass: corePass,
    synonym_pass: synonymPass,
    deadline_family: deadline,
    entity_family: entity,
    synonym_family: synonyms,
    note_protection: notes,
    calendar_protection: calendar,
    save_prefix: savePrefix,
    safety: safety
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log("=== SILVER_TASK_ITEM_FALLBACK_GUARD_V1 ===");
  console.log("PASS=" + (pass ? "true" : "false"));
  console.log("CORE_PASS=" + (corePass ? "true" : "false"));
  console.log("DEADLINE=" + deadline.filter(function (r) { return r.pass; }).length + "/" + deadline.length);
  console.log("ENTITY=" + entity.filter(function (r) { return r.pass; }).length + "/" + entity.length);
  console.log("SYNONYM=" + synonyms.filter(function (r) { return r.pass; }).length + "/" + synonyms.length);
  console.log("NOTE_PROTECTION=" + (notes.every(function (r) { return r.pass; }) ? "PASS" : "FAIL"));
  console.log("CALENDAR_PROTECTION=" + (calendar.every(function (r) { return r.pass; }) ? "PASS" : "FAIL"));
  console.log("SAVE_PREFIX=" + (savePrefix.every(function (r) { return r.pass; }) ? "PASS" : "FAIL"));
  console.log("DANGEROUS_WRITE_COUNT=" + safety.dangerous_write_count);
  console.log("FALSE_WRITE_COUNT=" + safety.false_write_count);
  console.log("WRITE_WHEN_NEGATED_COUNT=" + safety.write_when_negated_count);
  console.log("QUERY_CREATED_WRITE_COUNT=" + safety.query_created_write_count);
  console.log("REPORT=" + REPORT_PATH);
  console.log("=== END_SILVER_TASK_ITEM_FALLBACK_GUARD_V1 ===");
  process.exit(pass ? 0 : 1);
}

if (require.main === module) main();
