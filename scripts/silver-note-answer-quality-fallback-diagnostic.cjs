#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-note-answer-quality-fallback-report.json");
const WRITE_INTENTS = new Set(["calendar.create", "tasks.create", "notes.create", "create.storage_disambiguation"]);
const FIXED_NOW = new Date(2026, 5, 3, 12, 0, 0);
const TS_PIN = new Date(2026, 5, 3, 1, 28, 0).getTime();
const TS_TREZOR = new Date(2026, 5, 3, 2, 25, 0).getTime();
const TS_VOLVO = new Date(2026, 5, 2, 14, 0, 0).getTime();
const TS_TV = new Date(2026, 5, 1, 9, 15, 0).getTime();
const TS_WIFI = new Date(2026, 5, 3, 3, 10, 0).getTime();
const TS_KATKA = new Date(2026, 4, 20, 11, 0, 0).getTime();
const TS_SML = new Date(2026, 4, 15, 16, 30, 0).getTime();
const TS_GARAZ = new Date(2026, 4, 10, 8, 0, 0).getTime();

const FORBIDDEN_FRAGMENTS = [
  "od vstupních dveří je.",
  "k trezor je 234.",
  "je 321.",
  "mám ABC 4243.",
  "končí v."
];

const NOTE_VALUE_FAMILY = [
  { id: "NV_PIN", input: "Jaký je pin k vstupním dveřím", expectRx: /pin|PIN/i, expectEntity: /vstupn/i, expectValue: /321|\d{3}/, noteId: "n_pin" },
  { id: "NV_PIN2", input: "Jaký je PIN od vstupních dveří", expectRx: /pin|PIN/i, expectEntity: /vstupn/i, expectValue: /321|\d{3}/, noteId: "n_pin" },
  { id: "NV_TREZOR", input: "Jaký je kód k trezoru", expectRx: /k[oó]d/i, expectEntity: /trezor/i, expectValue: /234/, noteId: "n_trezor" },
  { id: "NV_WIFI", input: "Jaké je heslo k wifi", expectRx: /heslo/i, expectEntity: /wifi/i, expectValue: /Modra|2024|\w{4,}/i, noteId: "n_wifi" },
  { id: "NV_VOLVO", input: "Jakou má Volvo SPZ", expectRx: /volv/i, expectEntity: /SPZ/i, expectValue: /ABC\s*4243|4243/, noteId: "n_volvo" },
  { id: "NV_TV", input: "Kdy končí záruka na televizi", expectRx: /z[aá]ruk/i, expectEntity: /televiz/i, expectValue: /lednu\s+2027|2027/i, noteId: "n_tv" },
  { id: "NV_KATKA", input: "Kdy má Katka narozeniny", expectRx: /narozenin|Katka/i, expectValue: /břez|3\.|12\./i, noteId: "n_katka" },
  { id: "NV_SML", input: "Jaké je číslo smlouvy", expectRx: /smlouv|číslo/i, expectValue: /\d{4,}/, noteId: "n_sml" },
  { id: "NV_GARAZ", input: "Jaká je adresa garáže", expectRx: /adres|gar[aá][žz]/i, expectValue: /praha|ul\.|\d/i, noteId: "n_garaz" }
];

const HELP_EXCLUSION_FAMILY = [
  "Kolik si můžu uložit poznámek",
  "Kam se ukládají poznámky",
  "Vymaže se to z telefonu",
  "Jak fungují poznámky",
  "Kolik poznámek můžu mít"
];

const SAVE_PREFIX_FAMILY = [
  { input: "Do poznámek záruka na televizi mi končí v lednu 2027", expected: "notes.create" },
  { input: "Do poznámek SPZ Volva je ABC 4243", expected: "notes.create" },
  { input: "Do kalendáře zítra v 15 schůzka s Tomášem", expected: "calendar.create" },
  { input: "Připomeň mi zítra v 15 zavolat mámě", expected: "tasks.create" }
];

const TASK_REGRESSION_FAMILY = [
  { input: "Jaké mám úkoly", expected: "tasks.read" },
  { input: "Co mám rozdělané", expected: "tasks.read" },
  { input: "Připomeň mi zítra v 15 zavolat mámě", expected: "tasks.create" }
];

const SAFETY_FAMILY = [
  "nic neukládej",
  "jen čti",
  "pouze čti",
  "neukládej"
];

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function turnMsg(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
}

function seedNotes() {
  return [
    { id: "n_pin", title: "PIN dveře", content: "PIN od vstupních dveří je 321", createdAt: TS_PIN, updatedAt: TS_PIN, pinned: false, tags: [], deleted: false },
    { id: "n_trezor", title: "Trezor", content: "kód k trezoru je 234", createdAt: TS_TREZOR, updatedAt: TS_TREZOR, pinned: false, tags: [], deleted: false },
    { id: "n_wifi", title: "Wifi", content: "heslo na wifi je ModraSIT2024", createdAt: TS_WIFI, updatedAt: TS_WIFI, pinned: false, tags: [], deleted: false },
    { id: "n_volvo", title: "Volvo", content: "SPZ Volva je ABC 4243", createdAt: TS_VOLVO, updatedAt: TS_VOLVO, pinned: false, tags: [], deleted: false },
    { id: "n_tv", title: "TV záruka", content: "záruka na televizi končí v lednu 2027", createdAt: TS_TV, updatedAt: TS_TV, pinned: false, tags: [], deleted: false },
    { id: "n_katka", title: "Katka narozeniny", content: "Katka má narozeniny 12. března", createdAt: TS_KATKA, updatedAt: TS_KATKA, pinned: false, tags: [], deleted: false },
    { id: "n_sml", title: "Smlouva", content: "číslo smlouvy je 8844221", createdAt: TS_SML, updatedAt: TS_SML, pinned: false, tags: [], deleted: false },
    { id: "n_garaz", title: "Garáž", content: "adresa garáže je Vinohradská 12 Praha", createdAt: TS_GARAZ, updatedAt: TS_GARAZ, pinned: false, tags: [], deleted: false }
  ];
}

function seedCtx() {
  const notes = seedNotes();
  return {
    now: FIXED_NOW,
    getEventsSnapshot: function () {
      return [];
    },
    getTasksSnapshot: function () {
      return [
        { id: "t1", title: "koupit mléko", status: "todo", dueAt: null, dueTime: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
        { id: "t2", title: "posekat trávu", status: "in_progress", dueAt: null, dueTime: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 }
      ];
    },
    getNotesSnapshot: function () {
      return notes;
    }
  };
}

function isForbiddenFragment(msg) {
  const first = String(msg || "").split("\n")[0].trim();
  if (!first) return true;
  for (let i = 0; i < FORBIDDEN_FRAGMENTS.length; i++) {
    if (first.toLowerCase() === FORBIDDEN_FRAGMENTS[i].toLowerCase()) return true;
  }
  return false;
}

function evaluateNoteValueFamily(eng, ctx) {
  const rows = [];
  for (let i = 0; i < NOTE_VALUE_FAMILY.length; i++) {
    const c = NOTE_VALUE_FAMILY[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const msg = turnMsg(turn);
    const intent = String(turn.normalizedIntent || "");
    const issues = [];
    if (WRITE_INTENTS.has(intent) || turn.processingState === "READY_TO_SAVE") issues.push("write_leak");
    if (intent !== "notes.read" && intent !== "global.search") issues.push("intent:" + intent);
    if (c.expectRx && !c.expectRx.test(msg)) issues.push("expect_miss");
    if (c.expectEntity && !c.expectEntity.test(msg)) issues.push("entity_miss");
    if (c.expectValue && !c.expectValue.test(msg)) issues.push("value_miss");
    if (isForbiddenFragment(msg)) issues.push("forbidden_fragment");
    if (!/Pozn[aá]mka vytvo[řr]en[aá] dne/i.test(msg)) issues.push("created_metadata_miss");
    const fbMs = turn.readQuery && turn.readQuery.fallbackRuntimeMs != null ? turn.readQuery.fallbackRuntimeMs : 0;
    rows.push({
      id: c.id,
      input: c.input,
      intent: intent,
      message: msg.slice(0, 240),
      fallbackRuntimeMs: fbMs,
      usedFallback: !!(turn.readQuery && turn.readQuery.noteReadFallbackV1),
      pass: issues.length === 0,
      issues: issues
    });
  }
  return rows;
}

function evaluateForbiddenFragments(eng, ctx) {
  const rows = [];
  for (let i = 0; i < NOTE_VALUE_FAMILY.length; i++) {
    const c = NOTE_VALUE_FAMILY[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const msg = turnMsg(turn);
    const first = msg.split("\n")[0].trim();
    for (let fi = 0; fi < FORBIDDEN_FRAGMENTS.length; fi++) {
      rows.push({
        input: c.input,
        forbidden: FORBIDDEN_FRAGMENTS[fi],
        hit: first.toLowerCase() === FORBIDDEN_FRAGMENTS[fi].toLowerCase(),
        pass: first.toLowerCase() !== FORBIDDEN_FRAGMENTS[fi].toLowerCase()
      });
    }
  }
  return rows;
}

function evaluateHelpExclusion(eng, ctx) {
  const rows = [];
  for (let i = 0; i < HELP_EXCLUSION_FAMILY.length; i++) {
    const input = HELP_EXCLUSION_FAMILY[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    const msg = turnMsg(turn);
    const usedFallback = !!(turn.readQuery && turn.readQuery.noteReadFallbackV1);
    const isWrite = WRITE_INTENTS.has(intent) || turn.processingState === "READY_TO_SAVE";
    const pass = !usedFallback && !isWrite && !/Pozn[aá]mka vytvo[řr]en[aá] dne/i.test(msg);
    rows.push({ input: input, intent: intent, usedFallback: usedFallback, isWrite: isWrite, pass: pass });
  }
  return rows;
}

function evaluateSavePrefix(eng, ctx) {
  const rows = [];
  for (let i = 0; i < SAVE_PREFIX_FAMILY.length; i++) {
    const c = SAVE_PREFIX_FAMILY[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    const usedFallback = !!(turn.readQuery && turn.readQuery.noteReadFallbackV1);
    rows.push({
      input: c.input,
      expected: c.expected,
      observed: intent,
      usedFallback: usedFallback,
      pass: intent === c.expected && !usedFallback
    });
  }
  return rows;
}

function evaluateTaskRegression(eng, ctx) {
  const rows = [];
  for (let i = 0; i < TASK_REGRESSION_FAMILY.length; i++) {
    const c = TASK_REGRESSION_FAMILY[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    rows.push({ input: c.input, expected: c.expected, observed: intent, pass: intent === c.expected });
  }
  return rows;
}

function evaluateSafety(eng, ctx) {
  const rows = [];
  for (let i = 0; i < SAFETY_FAMILY.length; i++) {
    const input = "Jen najdi PIN od dveří, " + SAFETY_FAMILY[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    const isWrite = WRITE_INTENTS.has(intent) || turn.processingState === "READY_TO_SAVE";
    rows.push({ input: input, observed: intent, processingState: turn.processingState, pass: !isWrite });
  }
  return rows;
}

function evaluateFallbackInternals(eng, ctx) {
  const rows = [];
  const f = foldCs("Jaký je kód k trezoru");
  const t0 = Date.now();
  const fb = eng.iuSilverNoteReadFallbackSearchV1("Jaký je kód k trezoru", f, ctx, ctx.now);
  const runtimeMs = fb.runtimeMs != null ? fb.runtimeMs : Date.now() - t0;
  const terms = eng.iuSilverNoteAnswerQualityExtractSearchTermsV1(f);
  rows.push({
    id: "FALLBACK_INTERNAL",
    terms: terms,
    score: fb.score,
    runtimeMs: runtimeMs,
    hasNote: !!fb.note,
    pass: terms.length >= 1 && runtimeMs < 500 && !!fb.note
  });
  return rows;
}

function evaluateHelpCapabilitySignal(eng) {
  const helpQ = foldCs("Kolik si můžu uložit poznámek");
  const factQ = foldCs("Jaký je kód k trezoru");
  return {
    helpDetected: eng.iuSilverNoteAnswerQualityIsHelpCapabilityQueryV1(helpQ),
    factNotHelp: !eng.iuSilverNoteAnswerQualityIsHelpCapabilityQueryV1(factQ),
    pass: eng.iuSilverNoteAnswerQualityIsHelpCapabilityQueryV1(helpQ) && !eng.iuSilverNoteAnswerQualityIsHelpCapabilityQueryV1(factQ)
  };
}

function main() {
  const eng = loadEngine();
  const ctx = seedCtx();
  const noteValue = evaluateNoteValueFamily(eng, ctx);
  const forbidden = evaluateForbiddenFragments(eng, ctx);
  const help = evaluateHelpExclusion(eng, ctx);
  const savePrefix = evaluateSavePrefix(eng, ctx);
  const taskReg = evaluateTaskRegression(eng, ctx);
  const safety = evaluateSafety(eng, ctx);
  const fallback = evaluateFallbackInternals(eng, ctx);
  const helpSignal = evaluateHelpCapabilitySignal(eng);

  const report = {
    generatedAt: new Date().toISOString(),
    note_value_family: noteValue,
    forbidden_fragment_family: forbidden,
    help_exclusion_family: help,
    save_prefix_family: savePrefix,
    task_regression_family: taskReg,
    safety_family: safety,
    fallback_internals: fallback,
    help_capability_signal: helpSignal,
    pass:
      noteValue.every(function (r) {
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
      safety.every(function (r) {
        return r.pass;
      }) &&
      fallback.every(function (r) {
        return r.pass;
      }) &&
      helpSignal.pass
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log("=== SILVER_NOTE_ANSWER_QUALITY_FALLBACK_DIAGNOSTIC ===");
  console.log("PASS=" + (report.pass ? "true" : "false"));
  console.log("NOTE_VALUE_PASS=" + noteValue.filter(function (r) { return r.pass; }).length + "/" + noteValue.length);
  console.log("FORBIDDEN_FRAGMENT_PASS=" + (forbidden.every(function (r) { return r.pass; }) ? "true" : "false"));
  console.log("HELP_EXCLUSION_PASS=" + (help.every(function (r) { return r.pass; }) ? "true" : "false"));
  console.log("SAVE_PREFIX_PASS=" + (savePrefix.every(function (r) { return r.pass; }) ? "true" : "false"));
  console.log("TASK_REGRESSION_PASS=" + (taskReg.every(function (r) { return r.pass; }) ? "true" : "false"));
  console.log("FALLBACK_RUNTIME_MS=" + (fallback[0] && fallback[0].runtimeMs));
  console.log("REPORT=" + REPORT_PATH);
  console.log("=== END_SILVER_NOTE_ANSWER_QUALITY_FALLBACK_DIAGNOSTIC ===");
  process.exit(report.pass ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  seedCtx: seedCtx,
  seedNotes: seedNotes,
  NOTE_VALUE_FAMILY: NOTE_VALUE_FAMILY,
  FORBIDDEN_FRAGMENTS: FORBIDDEN_FRAGMENTS,
  HELP_EXCLUSION_FAMILY: HELP_EXCLUSION_FAMILY,
  SAVE_PREFIX_FAMILY: SAVE_PREFIX_FAMILY,
  turnMsg: turnMsg,
  isForbiddenFragment: isForbiddenFragment
};
