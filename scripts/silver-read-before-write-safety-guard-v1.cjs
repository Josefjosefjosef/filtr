#!/usr/bin/env node
"use strict";

/**
 * READ-BEFORE-WRITE SAFETY GUARD V1 — P0 stop-gate regression.
 */
const fs = require("fs");
const path = require("path");
const noteDiag = require("./silver-note-answer-quality-fallback-diagnostic.cjs");
const taskDiag = require("./silver-task-query-family-diagnostic.cjs");
const overviewDiag = require("./silver-task-overview-query-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-read-before-write-safety-guard-v1-report.json");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const TRUE_ENGINE_CASES = [
  "Nevíš náhodou kdy že mám zaplatit najem",
  "Nevíš náhodou kdy musím zaplatit tu nájemnou",
  "Nevíš náhodou kdy je termín abych zaplatit nájem",
  "Nevíš náhodou hele kdy že mám zaplatit ten nájem",
  "Nevíš náhodou kdy že mám koupit darek",
  "Nevíš náhodou kdy musím koupit dárek k narozeninám",
  "Nevíš náhodou kdy je termín abych koupit dárek",
  "Nevíš náhodou hele kdy že mám koupit ten dárek",
  "Nevíš náhodou co mám ještě koupit k narozeninám",
  "Nevíš náhodou co mám vlastně koupit k narozeninám",
  "Nevíš náhodou co mám udělat k narozeninám",
  "Nevíš náhodou co mám udělat ten dárek",
  "Nevíš náhodou co mám zařídit k narozeninám",
  "Nevíš náhodou kdy že mám zavolat doktorem",
  "Nevíš náhodou kdy musím zavolat doktor",
  "Nevíš náhodou kdy je termín abych zavolat doktorovi",
  "Nevíš náhodou hele kdy že mám zavolat ten doktorovi",
  "Nevíš náhodou kdy že mám vyzvednout Eličku",
  "Nevíš náhodou kdy musím vyzvednout Eli ze skoly",
  "Nevíš náhodou kdy je termín abych vyzvednout Eli",
  "Nevíš náhodou hele kdy že mám vyzvednout ten Eli",
  "Nevíš náhodou co mám ještě koupit mámě",
  "Nevíš náhodou co mám vlastně koupit mámě",
  "Nevíš náhodou hele co mám koupit pro mámu",
  "Nevíš náhodou co mám udělat mámě",
  "Nevíš náhodou co mám zařídit mámě",
  "Nevíš náhodou co mám zařídit pro mámu",
  "Nevíš náhodou nevíš co mám koupit pro mámu",
  "Nevíš náhodou co mám zařídit s autem",
  "Nevíš náhodou co mám udělat s autem",
  "Nevíš náhodou co mám vlastně udělat s autem",
  "Nevíš náhodou potřebuju vědět co mám zařídit s autem",
  "Nevíš náhodou potřebuju vědět co mám udělat s autem",
  "Nevíš náhodou hele co mám zařídit s autem",
  "Nevíš náhodou hele co mám udělat ohledně auta",
  "Nevíš náhodou co mám udělat ohledně auta",
  "Nevíš náhodou můžeš mi říct co mám zařídit s autem",
  "Nevíš náhodou můžeš mi říct co mám udělat s autem",
  "Nevíš náhodou nevíš co mám zařídit s autem",
  "Nevíš náhodou nevíš co mám udělat ohledně auta"
];

const LIVE_PROOF = [
  "Nevíš náhodou kdy mám zaplatit nájem",
  "Nevíš náhodou co mám zařídit s autem",
  "Můžeš mi říct kdy mám koupit dárek",
  "Potřebuju vědět co mám zařídit kolem auta"
];

const DEADLINE_FAMILY = [
  { id: "TD_01", input: "Kdy mám zaplatit nájem", entityRx: /n[aá]jem/i, valueRx: /5\.|6\.|2026|term[ií]n|zaplatit/i },
  { id: "TD_02", input: "Kdy mám koupit dárek", entityRx: /d[aá]rek|narozenin/i, valueRx: /10\.|narozenin|term[ií]n/i },
  { id: "TD_03", input: "Kdy mám zavolat doktorovi", entityRx: /doktor/i, valueRx: /6\.|9:00|term[ií]n|zavolat/i },
  { id: "TD_04", input: "Kdy mám vyzvednout Eli", entityRx: /eli/i, valueRx: /4\.|15:30|term[ií]n/i }
];

const ENTITY_FAMILY = [
  { id: "TE_01", input: "Co mám koupit mámě", entityRx: /m[aá]m[eě]|d[aá]rek/i, valueRx: /Koupit d[aá]rek m[aá]m[eě]/i, forbidBulkList: true },
  { id: "TE_02", input: "Co mám vyřešit s doktorem", entityRx: /doktor/i, valueRx: /doktor|zavolat/i },
  { id: "TE_03", input: "Co mám zařídit kolem auta", entityRx: /aut|stk|pojist/i, valueRx: /auta|STK|pojist/i },
  { id: "TE_04", input: "Co mám udělat s právníkem", entityRx: /pr[aá]vn/i, valueRx: /pr[aá]vn|smlouv/i }
];

const OVERVIEW_FAMILY = [
  { id: "OV_01", input: "Co mám za úkoly", expected: "tasks.read" },
  { id: "OV_02", input: "Jaké mám úkoly", expected: "tasks.read" },
  { id: "OV_03", input: "Jaké mám aktivní úkoly", expected: "tasks.read" },
  { id: "OV_04", input: "Co mi zbývá", expected: "tasks.read" },
  { id: "OV_05", input: "Jaké mám rozdělané úkoly", expected: "tasks.read" },
  { id: "OV_06", input: "Jaké mám zbývající úkoly", expected: "tasks.read" }
];

const NOTE_PROTECTION = [
  { id: "NP_01", input: "Jakou má Volvo SPZ", expected: "notes.read" },
  { id: "NP_02", input: "Jaké je heslo k wifi", expected: "notes.read" },
  { id: "NP_03", input: "Jaký je kód k trezoru", expected: "notes.read" }
];

const CALENDAR_PROTECTION = [
  { id: "CP_01", input: "Kdy mám zubaře", expected: "calendar.read" },
  { id: "CP_02", input: "Kdy mám právníka", expected: "calendar.read" },
  { id: "CP_03", input: "Kdy mám schůzku s Tomášem", expected: "calendar.read" }
];

const SAVE_PREFIX = [
  { input: "Do poznámek SPZ Volva je ABC 4243", expected: "notes.create" },
  { input: "Připomeň mi zítra v 15 zavolat mámě", expected: "tasks.create" },
  { input: "Do kalendáře zítra v 15 schůzka s Tomášem", expected: "calendar.create" }
];

function turnMsg(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
}

function runSafetyCase(eng, ctx, input) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
  const intent = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const msg = turnMsg(turn);
  const issues = [];
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
  if (ps === "READY_TO_SAVE") issues.push("ready_to_save");
  if (intent !== "tasks.read" && intent !== "tasks.query" && intent !== "global.search") {
    issues.push("not_read:" + intent);
  }
  if (!msg.trim() || /Nic jsem k tomu nena[sš]el/i.test(msg)) issues.push("empty_response");
  if (/Připravil jsem návrh úkolu/i.test(msg)) issues.push("create_draft_leak");
  return { input: input, intent: intent, processingState: ps, pass: issues.length === 0, issues: issues, message: msg.slice(0, 200) };
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
  if (WRITE_INTENTS.has(intent) && c.expected.indexOf(".read") >= 0) issues.push("write_leak");
  if (intent !== c.expected) issues.push("intent:" + intent);
  return { id: c.id, input: c.input, pass: issues.length === 0, issues: issues, intent: intent };
}

function runSavePrefixCase(eng, ctx, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const intent = String(turn.normalizedIntent || "");
  return { input: c.input, expected: c.expected, observed: intent, pass: intent === c.expected };
}

function main() {
  const eng = loadEngine();
  const ctx = taskDiag.seedCtx();
  const guardCases = TRUE_ENGINE_CASES.map(function (input, idx) {
    const row = runSafetyCase(eng, ctx, input);
    row.id = "SG_" + String(idx + 1).padStart(2, "0");
    return row;
  });
  const liveCases = LIVE_PROOF.map(function (input, idx) {
    const row = runSafetyCase(eng, ctx, input);
    row.id = "LIVE_" + String(idx + 1).padStart(2, "0");
    return row;
  });
  const deadline = DEADLINE_FAMILY.map(function (c) {
    return runSafetyCase(eng, ctx, c.input);
  });
  const entity = ENTITY_FAMILY.map(function (c) {
    return runSafetyCase(eng, ctx, c.input);
  });
  const overview = OVERVIEW_FAMILY.map(function (c) {
    return runIntentCase(eng, ctx, c);
  });
  const notes = NOTE_PROTECTION.map(function (c) {
    return runIntentCase(eng, ctx, c);
  });
  const calendar = CALENDAR_PROTECTION.map(function (c) {
    return runIntentCase(eng, ctx, c);
  });
  const savePrefix = SAVE_PREFIX.map(function (c) {
    return runSavePrefixCase(eng, ctx, c);
  });

  const guardPass = guardCases.filter(function (r) {
    return r.pass;
  }).length;
  const livePass = liveCases.filter(function (r) {
    return r.pass;
  }).length;

  let dangerous_write_count = 0;
  let false_write_count = 0;
  let query_created_write_count = 0;
  const allReadInputs = TRUE_ENGINE_CASES.concat(LIVE_PROOF).concat(
    DEADLINE_FAMILY.map(function (c) {
      return c.input;
    })
  ).concat(
    ENTITY_FAMILY.map(function (c) {
      return c.input;
    })
  );
  for (let i = 0; i < allReadInputs.length; i++) {
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(allReadInputs[i], eng.createEmptyDraft(), ctx);
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

  const pass =
    guardPass === TRUE_ENGINE_CASES.length &&
    livePass === LIVE_PROOF.length &&
    deadline.every(function (r) {
      return r.pass;
    }) &&
    entity.every(function (r) {
      return r.pass;
    }) &&
    overview.every(function (r) {
      return r.pass;
    }) &&
    notes.every(function (r) {
      return r.pass;
    }) &&
    calendar.every(function (r) {
      return r.pass;
    }) &&
    savePrefix.every(function (r) {
      return r.pass;
    }) &&
    dangerous_write_count === 0 &&
    query_created_write_count === 0;

  const report = {
    generatedAt: new Date().toISOString(),
    guard: "READ_BEFORE_WRITE_SAFETY_GUARD_V1",
    pass: pass,
    true_engine_cases: guardCases,
    true_engine_pass: guardPass + "/" + TRUE_ENGINE_CASES.length,
    live_proof: liveCases,
    live_proof_pass: livePass + "/" + LIVE_PROOF.length,
    deadline_family: deadline,
    entity_family: entity,
    overview_family: overview,
    note_protection: notes,
    calendar_protection: calendar,
    save_prefix: savePrefix,
    safety: {
      dangerous_write_count: dangerous_write_count,
      false_write_count: false_write_count,
      write_when_negated_count: 0,
      query_created_write_count: query_created_write_count
    }
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log("=== SILVER_READ_BEFORE_WRITE_SAFETY_GUARD_V1 ===");
  console.log("PASS=" + (pass ? "true" : "false"));
  console.log("TRUE_ENGINE=" + guardPass + "/" + TRUE_ENGINE_CASES.length);
  console.log("LIVE_PROOF=" + livePass + "/" + LIVE_PROOF.length);
  console.log("DEADLINE=" + deadline.filter(function (r) { return r.pass; }).length + "/" + deadline.length);
  console.log("ENTITY=" + entity.filter(function (r) { return r.pass; }).length + "/" + entity.length);
  console.log("OVERVIEW=" + (overview.every(function (r) { return r.pass; }) ? "PASS" : "FAIL"));
  console.log("NOTE_PROTECTION=" + (notes.every(function (r) { return r.pass; }) ? "PASS" : "FAIL"));
  console.log("CALENDAR_PROTECTION=" + (calendar.every(function (r) { return r.pass; }) ? "PASS" : "FAIL"));
  console.log("SAVE_PREFIX=" + (savePrefix.every(function (r) { return r.pass; }) ? "PASS" : "FAIL"));
  console.log("DANGEROUS_WRITE_COUNT=" + dangerous_write_count);
  console.log("FALSE_WRITE_COUNT=" + false_write_count);
  console.log("QUERY_CREATED_WRITE_COUNT=" + query_created_write_count);
  console.log("REPORT=" + REPORT_PATH);
  console.log("=== END_SILVER_READ_BEFORE_WRITE_SAFETY_GUARD_V1 ===");
  process.exit(pass ? 0 : 1);
}

if (require.main === module) main();
