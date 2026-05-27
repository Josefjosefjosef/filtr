#!/usr/bin/env node
"use strict";

const noteShared = require("./silver-note-write-hardening-v1-shared.cjs");
const aliasData = require("./silver-czech-person-alias-registry-v1-data.cjs");

function foldCs(s) {
  return aliasData.foldCs(s);
}
const calShared = require("./silver-search-read-hardening-v1-shared.cjs");
const taskShared = require("./silver-task-write-hardening-v1-shared.cjs");

const TIER_A_NOTE = [
  { id: "CMN_001", input: "Ulož poznámku o záruce, ne do kalendáře", expect: "notes.create", forbidCalendar: true },
  { id: "CMN_002", input: "Zapiš si informaci o smlouvě, ne jako úkol", expect: "notes.create", forbidTask: true },
  { id: "CMN_003", input: "Ulož fakt o Pepovi do poznámek, ne jako událost", expect: "notes.create", forbidCalendar: true },
  { id: "CMN_004", input: "Poznamenej si účtenku k notebooku, ne do kalendáře", expect: "notes.create", forbidCalendar: true },
  { id: "CMN_005", input: "Zapamatuj si že Franta dluží 500, ne jako úkol", expect: "notes.create", forbidTask: true },
  { id: "CMN_006", input: "Ulož: Není to událost, jen poznámka", expect: "notes.create", allowClarification: true },
  { id: "CMN_007", input: "Není to úkol, jen informace", expect: "notes.create", allowClarification: true },
  { id: "CMN_008", input: "Neukládej to do kalendáře, dej to do poznámek", expect: "notes.create", forbidCalendar: true },
  { id: "CMN_009", input: "Neukládej jako úkol, je to poznámka", expect: "notes.create", forbidTask: true, allowClarification: true }
];

const TIER_A_CALENDAR = [
  { id: "CMC_001", input: "Ulož schůzku do kalendáře, ne jako úkol", expect: "calendar.create", forbidTask: true },
  { id: "CMC_002", input: "Přidej událost zítra v 15, ne do poznámek", expect: "calendar.create", forbidNote: true },
  { id: "CMC_003", input: "Ulož: Není to poznámka, je to událost", expect: "calendar.create", allowClarification: true },
  { id: "CMC_004", input: "Ulož: Není to úkol, je to schůzka v kalendáři", expect: "calendar.create", allowClarification: true },
  { id: "CMC_005", input: "Dej to do kalendáře, ne do úkolů", expect: "calendar.create", forbidTask: true },
  { id: "CMC_006", input: "Neukládej jako úkol, dej to do kalendáře", expect: "calendar.create", forbidTask: true }
];

const TIER_A_TASK = [
  { id: "CMT_001", input: "Ulož úkol koupit mlíko, ne do kalendáře", expect: "tasks.create", forbidCalendar: true },
  { id: "CMT_002", input: "Dej to do úkolů, ne jako poznámku", expect: "tasks.create", forbidNote: true },
  { id: "CMT_003", input: "Ulož: Není to událost, je to úkol", expect: "tasks.create", allowClarification: true },
  { id: "CMT_004", input: "Ulož: Není to poznámka, je to úkol", expect: "tasks.create", allowClarification: true },
  { id: "CMT_005", input: "Neukládej do kalendáře, dej to do úkolů", expect: "tasks.create", forbidCalendar: true }
];

const NOTE_LEADS = [
  "Ulož poznámku o {topic}, ne do kalendáře",
  "Zapiš si informaci o {topic}, ne jako úkol",
  "Ulož fakt o {topic} do poznámek, ne jako událost",
  "Poznamenej si {topic}, ne do kalendáře",
  "Zapamatuj si {topic}, ne jako úkol",
  "Neukládej do kalendáře, dej do poznámek {topic}",
  "Neukládej jako úkol, je to poznámka o {topic}",
  "Není to událost, jen poznámka o {topic}",
  "Není to úkol, jen informace o {topic}"
];
const CAL_LEADS = [
  "Ulož schůzku {topic} do kalendáře, ne jako úkol",
  "Přidej událost {topic}, ne do poznámek",
  "Dej to do kalendáře {topic}, ne do úkolů",
  "Neukládej jako úkol, dej to do kalendáře {topic}",
  "Není to poznámka, je to událost {topic}",
  "Není to úkol, je to schůzka {topic}"
];
const TASK_LEADS = [
  "Ulož úkol {topic}, ne do kalendáře",
  "Dej to do úkolů {topic}, ne jako poznámku",
  "Neukládej do kalendáře, dej to do úkolů {topic}",
  "Není to událost, je to úkol {topic}",
  "Není to poznámka, je to úkol {topic}"
];
const TOPICS = [
  "záruce",
  "smlouvě",
  "Pepovi",
  "notebooku",
  "servisu auta",
  "pojištění",
  "nájmu",
  "doktorovi",
  "účetní",
  "záloze",
  "PINu",
  "mobilu",
  "pračce",
  "televizi"
];
const FILLERS = ["", "Hele ", "Prosím ", "No "];
const MOBILE = ["", "ehm ", "prosim ", "bez diakritiky: "];

function tagCase(entry, pool) {
  if (pool === NOTE_LEADS) {
    entry.forbidCalendar = /kalend|udalost/.test(entry.input);
    entry.forbidTask = /ukol/.test(entry.input) && /ne\s+jako\s+ukol|ne\s+ukol|neni\s+to\s+ukol/i.test(entry.input);
  }
  if (pool === CAL_LEADS) {
    entry.forbidTask = /ukol/.test(entry.input);
    entry.forbidNote = /poznam/.test(entry.input);
  }
  if (pool === TASK_LEADS) {
    entry.forbidCalendar = /kalend/.test(entry.input);
    entry.forbidNote = /poznam/.test(entry.input);
  }
  return entry;
}

function buildPool(leads, expect, prefix, targetCount) {
  const out = [];
  let n = 0;
  while (out.length < targetCount) {
    const tpl = leads[n % leads.length];
    const topic = TOPICS[(n * 5) % TOPICS.length];
    const pfx = FILLERS[n % FILLERS.length];
    const mob = MOBILE[(n >> 1) % MOBILE.length];
    const entry = tagCase(
      {
        id: prefix + String(n).padStart(4, "0"),
        input: mob + pfx + tpl.replace("{topic}", topic),
        expect: expect,
        tier: "B"
      },
      leads
    );
    const foldIn = foldCs(entry.input);
    if (/\bneni\s+to\b/.test(foldIn) && !/\buloz|dej\s+to|zapis|poznamenej|zapamatuj/.test(foldIn)) {
      entry.input = "Ulož: " + entry.input;
      entry.allowClarification = true;
    }
    out.push(entry);
    n++;
  }
  return out;
}

function buildCorpusV1(targetCount) {
  const perModule = Math.max(60, Math.floor((targetCount - 20) / 3));
  const note = TIER_A_NOTE.concat(buildPool(NOTE_LEADS, "notes.create", "CMN_GEN_", perModule));
  const cal = TIER_A_CALENDAR.concat(buildPool(CAL_LEADS, "calendar.create", "CMC_GEN_", perModule));
  const task = TIER_A_TASK.concat(buildPool(TASK_LEADS, "tasks.create", "CMT_GEN_", perModule));
  return note.concat(cal).concat(task).slice(0, targetCount);
}

const CROSS_MODULE_NEGATION_TARGET_REPLAY = buildCorpusV1(192);

const NOTE_WRITE_NEG_TRAIL_WRONG_COLLECTION_REPLAY = CROSS_MODULE_NEGATION_TARGET_REPLAY.filter(function (c) {
  return c.expect === "notes.create";
});
const CALENDAR_WRITE_NEG_TRAIL_REPLAY = CROSS_MODULE_NEGATION_TARGET_REPLAY.filter(function (c) {
  return c.expect === "calendar.create";
});
const TASK_WRITE_NEG_TRAIL_REPLAY = CROSS_MODULE_NEGATION_TARGET_REPLAY.filter(function (c) {
  return c.expect === "tasks.create";
});
const MODULE_SWITCH_SAVE_TARGET_REPLAY = CROSS_MODULE_NEGATION_TARGET_REPLAY.filter(function (c) {
  return /\bdej\s+to\s+do\b/i.test(c.input) || /\bneukladej\b/i.test(c.input);
});
const NOT_X_BUT_Y_ROUTING_REPLAY = CROSS_MODULE_NEGATION_TARGET_REPLAY.filter(function (c) {
  return /\bneni\s+to\b/.test(foldCs(c.input));
});
const NEGATED_ALTERNATIVE_MODULE_REPLAY = CROSS_MODULE_NEGATION_TARGET_REPLAY.filter(function (c) {
  return /\bne\s+(do|jako)\b/i.test(c.input) || /\bneukladej\b/i.test(c.input);
});
const NEGATION_TAIL_CLEAN_PAYLOAD_REPLAY = [
  {
    id: "CMNP_001",
    input: "Ulož fakt o záruce na televizi do poznámek, ne do kalendáře",
    expect: "notes.create",
    bodyNeed: ["televiz", "zaruc"],
    bodyLacks: ["ne do kalend", "uloz fakt"]
  },
  {
    id: "CMNP_002",
    input: "Ulož schůzku s Novákem zítra v 10, ne jako úkol",
    expect: "calendar.create",
    titleNeed: ["novak"],
    titleLacks: ["ne jako ukol"]
  },
  {
    id: "CMNP_003",
    input: "Ulož úkol koupit mlíko, ne do kalendáře",
    expect: "tasks.create",
    titleNeed: ["ml"],
    titleLacks: ["ne do kalend"]
  }
];
const STORAGE_PICKER_FALSE_CLARIFICATION_REPLAY = CROSS_MODULE_NEGATION_TARGET_REPLAY.filter(function (c) {
  return /\buloz|dej\s+to|zapis|pridej\b/i.test(c.input);
});

function evaluateCrossModuleCase(c, turn) {
  const expect = String(c.expect || "");
  if (expect === "notes.create") return noteShared.evaluateNoteWrite(c, turn);
  if (expect === "calendar.create") return calShared.evaluateCalendarWriteNegated(c, turn);
  if (expect === "tasks.create") return taskShared.evaluateTaskWrite(c, turn);
  return ["bad_expect:" + expect];
}

module.exports = {
  foldCs,
  buildCorpusV1,
  CROSS_MODULE_NEGATION_TARGET_REPLAY,
  NOTE_WRITE_NEG_TRAIL_WRONG_COLLECTION_REPLAY,
  CALENDAR_WRITE_NEG_TRAIL_REPLAY,
  TASK_WRITE_NEG_TRAIL_REPLAY,
  MODULE_SWITCH_SAVE_TARGET_REPLAY,
  NOT_X_BUT_Y_ROUTING_REPLAY,
  NEGATED_ALTERNATIVE_MODULE_REPLAY,
  NEGATION_TAIL_CLEAN_PAYLOAD_REPLAY,
  STORAGE_PICKER_FALSE_CLARIFICATION_REPLAY,
  runReplayCases: noteShared.runReplayCases,
  evaluateCrossModuleCase,
  evaluateNoteWrite: noteShared.evaluateNoteWrite,
  evaluateCalendarWriteNegated: calShared.evaluateCalendarWriteNegated,
  evaluateTaskWrite: taskShared.evaluateTaskWrite,
  printGuardHeader: noteShared.printGuardHeader,
  loadEngine: noteShared.loadEngine,
  defaultCtx: noteShared.defaultCtx
};
