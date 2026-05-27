#!/usr/bin/env node
"use strict";

const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");
const aliasData = require("./silver-czech-person-alias-registry-v1-data.cjs");

function foldCs(s) {
  return aliasData.foldCs(s);
}

const FIXED_NOW = new Date("2026-05-04T12:00:00");
const WRITE_INTENTS = new Set(["calendar.create", "tasks.create", "notes.create", "create.storage_disambiguation"]);

const NOTE_WRITE_MANDATORY_REPLAY = [
  { id: "NWM_001", input: "Ulož fakt o Pepovi do poznámek", expect: "notes.create" },
  { id: "NWM_002", input: "Ulož informaci o smlouvě do poznámek", expect: "notes.create" },
  { id: "NWM_003", input: "Zapiš si že Franta dluží 5000", expect: "notes.create" },
  { id: "NWM_004", input: "Ulož poznámku o autě", expect: "notes.create" },
  { id: "NWM_005", input: "Poznamenej si že servis je v pondělí", expect: "notes.create" },
  { id: "NWM_006", input: "Jen poznámka, ne kalendář", expect: "notes.create", allowClarification: true },
  { id: "NWM_007", input: "Neukládej do kalendáře, ulož do poznámek, že PIN je doma", expect: "notes.create" },
  { id: "NWM_008", input: "Ulož do poznámek, že PIN je doma, není to úkol", expect: "notes.create" },
  { id: "NWM_009", input: "Ulož si informaci o pojištění", expect: "notes.create" },
  { id: "NWM_010", input: "Zapamatuj si že PIN je v šuplíku", expect: "notes.create" },
  { id: "NWM_011", input: "Poznamenej si fakt že soused má klíč", expect: "notes.create" },
  { id: "NWM_012", input: "Ulož info o faktuře do poznámek", expect: "notes.create" },
  { id: "NWM_013", input: "Jen memo, ne událost", expect: "notes.create", allowClarification: true },
  { id: "NWM_014", input: "Jen informace, ne kalendář", expect: "notes.create", allowClarification: true },
  { id: "NWM_015", input: "Ulož poznámku že auto mělo modrou barvu", expect: "notes.create" },
  { id: "NWM_016", input: "Zapiš si že advokát potřebuje plnou moc", expect: "notes.create" }
];

const NOTE_WRITE_CHAOS_REPLAY = NOTE_WRITE_MANDATORY_REPLAY.slice();

const NOTE_WRITE_MOBILE_REPLAY = [
  { id: "NWR_001", input: "ehm uloz fakt o pojistce do poznamek", expect: "notes.create" },
  { id: "NWR_002", input: "prosim uloz info o smlouve do poznamek diky", expect: "notes.create" },
  { id: "NWR_003", input: "bez diakritiky: dej do poznamek ze pin je doma", expect: "notes.create" }
];

const NOTE_WRITE_NEGATED_CAL_REPLAY = [
  { id: "NWNC_001", input: "Neukládej do kalendáře, ulož do poznámek, že PIN je doma", expect: "notes.create" },
  { id: "NWNC_002", input: "Jen poznámka, ne kalendář", expect: "notes.create", allowClarification: true },
  { id: "NWNC_003", input: "Dej mi do poznámky, že auto mělo modrou barvu, nevytvářej událost, ne úkol.", expect: "notes.create" }
];

const NOTE_WRITE_NO_CALENDAR_LEAK_REPLAY = [
  { id: "NWCL_001", input: "Ulož fakt o Praze 1 do poznámek, ne jako událost", forbidCalendar: true, expect: "notes.create" },
  { id: "NWCL_002", input: "Poznamenej si PIN ke kartě, není to kalendář", forbidCalendar: true, expect: "notes.create" },
  { id: "NWCL_003", input: "Zapamatuj si velikost bot 33, ne kalendář", forbidCalendar: true, expect: "notes.create" }
];

const NOTE_WRITE_NO_TASK_LEAK_REPLAY = [
  { id: "NWTL_001", input: "Dej mi do poznámky, že auto mělo modrou barvu, ne úkol", forbidTask: true, expect: "notes.create" },
  { id: "NWTL_002", input: "Ulož fakt o autě do poznámek, ne úkol", forbidTask: true, expect: "notes.create" },
  { id: "NWTL_003", input: "Dej mi do poznámky, že auto mělo modrou barvu, ne úkol", forbidTask: true, expect: "notes.create" }
];

const NOTE_WRITE_CLEAN_PAYLOAD_REPLAY = [
  {
    id: "NWCP_001",
    input: "Ulož fakt o Vinohradské 3 do poznámek",
    expect: "notes.create",
    bodyNeed: ["vinohrad"],
    bodyLacks: ["uloz"]
  },
  {
    id: "NWCP_002",
    input: "Zapiš si že Franta dluží 5000",
    expect: "notes.create",
    bodyNeed: ["franta", "5000"],
    bodyLacks: ["zapis si"]
  }
];

const NOTE_WRITE_FACTUAL_REPLAY = [
  { id: "NWF_001", input: "Ulož fakt o Pepovi do poznámek, ne jako událost", expect: "notes.create" },
  { id: "NWF_002", input: "Ulož informaci o smlouvě do poznámek", expect: "notes.create" },
  { id: "NWF_003", input: "Ulož info o pojištění do poznámek", expect: "notes.create" }
];

const NOTE_WRITE_INFO_MEMORY_REPLAY = [
  { id: "NWI_001", input: "Zapamatuj si že heslo je v trezoru", expect: "notes.create" },
  { id: "NWI_002", input: "Poznamenej si informaci že dodavatel je stejný", expect: "notes.create" },
  { id: "NWI_003", input: "Ulož si informaci o pojištění do poznámek", expect: "notes.create" }
];

const NOTE_WRITE_KNOWLEDGE_REPLAY = [
  { id: "NWK_001", input: "Jen memo: velikost bot 33", expect: "notes.create", allowClarification: true },
  { id: "NWK_002", input: "Jen informace o kartě, ne kalendář", expect: "notes.create", allowClarification: true }
];

const NOTE_WRITE_CONTINUATION_REPLAY = [
  {
    id: "NWC_001",
    input: "Ulož poznámku že auto mělo modrou barvu",
    expect: "notes.create",
    bodyNeed: ["modrou", "barvu"]
  }
];

/** 20k šablony: neg trail + do poznámek (replay z note_write_2800 cluster). */
const NOTE_WRITE_20K_NEG_TRAIL_REPLAY = (function build20kNegTrailReplay() {
  const negs = [
    "nevytvářej událost",
    "ne jako událost",
    "nevytvarej udalost",
    "ne jako udalost, nevytvarej ukol"
  ];
  const bodies = [
    "Dej mi do poznámky, že auto mělo modrou barvu, {neg}, ne úkol.",
    "Ulož fakt o Vinohradská 3 Praha do poznámek, {neg}, nevytvářej úkol.",
    "Poznamenej si PIN ke kartě je doma, není to úkol, {neg}.",
    "Zapamatuj si velikost bot 33, {neg}, ne kalendář.",
    "Ulož do poznámek, že advokát potřebuje plnou moc, {neg}."
  ];
  const out = [];
  let n = 0;
  for (let bi = 0; bi < bodies.length; bi++) {
    for (let ni = 0; ni < negs.length; ni++) {
      n++;
      out.push({
        id: "NW20_" + String(n).padStart(3, "0"),
        input: bodies[bi].replace("{neg}", negs[ni]),
        expect: "notes.create"
      });
      if (n >= 84) return out;
    }
  }
  return out;
})();

NOTE_WRITE_CHAOS_REPLAY.push.apply(NOTE_WRITE_CHAOS_REPLAY, NOTE_WRITE_20K_NEG_TRAIL_REPLAY.slice(0, 30));
NOTE_WRITE_MOBILE_REPLAY.push.apply(NOTE_WRITE_MOBILE_REPLAY, NOTE_WRITE_20K_NEG_TRAIL_REPLAY.slice(30, 45));
NOTE_WRITE_NEGATED_CAL_REPLAY.push.apply(NOTE_WRITE_NEGATED_CAL_REPLAY, NOTE_WRITE_20K_NEG_TRAIL_REPLAY.slice(45, 55));
NOTE_WRITE_NO_CALENDAR_LEAK_REPLAY.push.apply(
  NOTE_WRITE_NO_CALENDAR_LEAK_REPLAY,
  NOTE_WRITE_20K_NEG_TRAIL_REPLAY.slice(55, 65).map(function (c) {
    return Object.assign({}, c, { forbidCalendar: true });
  })
);
NOTE_WRITE_NO_TASK_LEAK_REPLAY.push.apply(
  NOTE_WRITE_NO_TASK_LEAK_REPLAY,
  NOTE_WRITE_20K_NEG_TRAIL_REPLAY.slice(65, 75).map(function (c) {
    return Object.assign({}, c, { forbidTask: true });
  })
);
NOTE_WRITE_FACTUAL_REPLAY.push.apply(NOTE_WRITE_FACTUAL_REPLAY, NOTE_WRITE_20K_NEG_TRAIL_REPLAY.slice(75, 84));
NOTE_WRITE_INFO_MEMORY_REPLAY.push.apply(NOTE_WRITE_INFO_MEMORY_REPLAY, NOTE_WRITE_MANDATORY_REPLAY.slice(8, 12));
NOTE_WRITE_KNOWLEDGE_REPLAY.push.apply(NOTE_WRITE_KNOWLEDGE_REPLAY, NOTE_WRITE_MANDATORY_REPLAY.slice(12, 14));
NOTE_WRITE_CLEAN_PAYLOAD_REPLAY.push.apply(NOTE_WRITE_CLEAN_PAYLOAD_REPLAY, NOTE_WRITE_MANDATORY_REPLAY.slice(2, 6));
NOTE_WRITE_CONTINUATION_REPLAY.push.apply(NOTE_WRITE_CONTINUATION_REPLAY, NOTE_WRITE_MANDATORY_REPLAY.slice(14, 16));

function defaultCtx() {
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

function runReplayCases(eng, cases, ctx, evaluate) {
  const report = { pass: 0, fail: 0, total: cases.length, first_fail: null, issues: [] };
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const issues = evaluate(c, turn);
    if (!issues.length) {
      report.pass++;
      continue;
    }
    report.fail++;
    report.issues.push({ id: c.id, input: c.input, issues: issues });
    if (!report.first_fail) {
      report.first_fail = { id: c.id, input: c.input, issues: issues, intent: turn.normalizedIntent, ps: turn.processingState };
    }
  }
  report.PASS_FAIL = report.fail === 0 ? "PASS" : "FAIL";
  return report;
}

function evaluateNoteWrite(c, turn) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  if (intent !== c.expect) {
    if (!(c.allowClarification && (intent === "clarification" || intent === "unknown"))) {
      issues.push("intent:" + intent);
    }
  }
  if (turn.processingState !== "READY_TO_SAVE" && intent === "notes.create") {
    issues.push("ps:" + turn.processingState);
  }
  if (c.forbidCalendar && intent === "calendar.create") issues.push("calendar_leak");
  if (c.forbidTask && intent === "tasks.create") issues.push("task_leak");
  if (WRITE_INTENTS.has(intent) && c.expect !== intent && intent !== "notes.create") issues.push("wrong_write:" + intent);
  if (turn.processingState === "STORAGE_DISAMBIGUATION") issues.push("storage_picker");
  const body = foldCs((turn.draft && turn.draft.silverNoteText) || "");
  if (c.bodyNeed) {
    for (let i = 0; i < c.bodyNeed.length; i++) {
      if (body.indexOf(foldCs(c.bodyNeed[i])) < 0) issues.push("body_miss:" + c.bodyNeed[i]);
    }
  }
  if (c.bodyLacks) {
    for (let j = 0; j < c.bodyLacks.length; j++) {
      if (body.indexOf(foldCs(c.bodyLacks[j])) >= 0) issues.push("body_pollution:" + c.bodyLacks[j]);
    }
  }
  return issues;
}

function printGuardHeader(name, report) {
  console.log("=== " + name.toUpperCase() + " ===");
  console.log("pass=" + report.pass + "/" + report.total);
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  if (report.first_fail) {
    console.log("first_fail_id=" + report.first_fail.id);
    console.log("first_fail_input=" + report.first_fail.input);
    console.log("first_fail_issues=" + (report.first_fail.issues || []).join(","));
    console.log("first_fail_intent=" + (report.first_fail.intent || ""));
  }
  console.log("=== END_" + name.toUpperCase() + " ===");
  return report.PASS_FAIL === "PASS";
}

module.exports = {
  FIXED_NOW,
  defaultCtx,
  loadEngine,
  NOTE_WRITE_CHAOS_REPLAY,
  NOTE_WRITE_MOBILE_REPLAY,
  NOTE_WRITE_NEGATED_CAL_REPLAY,
  NOTE_WRITE_NO_CALENDAR_LEAK_REPLAY,
  NOTE_WRITE_NO_TASK_LEAK_REPLAY,
  NOTE_WRITE_CLEAN_PAYLOAD_REPLAY,
  NOTE_WRITE_FACTUAL_REPLAY,
  NOTE_WRITE_INFO_MEMORY_REPLAY,
  NOTE_WRITE_KNOWLEDGE_REPLAY,
  NOTE_WRITE_CONTINUATION_REPLAY,
  NOTE_WRITE_20K_NEG_TRAIL_REPLAY,
  runReplayCases,
  evaluateNoteWrite,
  printGuardHeader
};
