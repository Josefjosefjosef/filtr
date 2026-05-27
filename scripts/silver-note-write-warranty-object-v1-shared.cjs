#!/usr/bin/env node
"use strict";

const shared = require("./silver-note-write-hardening-v1-shared.cjs");

const TIER_A_MANDATORY = [
  { id: "NWW_001", input: "Ulož fakt o záruce na televizi do poznámek", expect: "notes.create" },
  { id: "NWW_002", input: "Ulož informaci o záruce na pračku", expect: "notes.create" },
  { id: "NWW_003", input: "Poznamenej si záruka na telefon končí v lednu", expect: "notes.create" },
  { id: "NWW_004", input: "Ulož účtenku k notebooku do poznámek", expect: "notes.create" },
  { id: "NWW_005", input: "Zapiš si doklad k autu", expect: "notes.create" },
  { id: "NWW_006", input: "Ulož info o reklamaci lednice", expect: "notes.create" },
  { id: "NWW_007", input: "Jen poznámka o záruce, ne kalendář", expect: "notes.create", allowClarification: true },
  { id: "NWW_008", input: "Neukládej do kalendáře, dej to do poznámek, že záruka na mobil je dva roky", expect: "notes.create" },
  { id: "NWW_009", input: "Není to úkol, jen informace o záruce", expect: "notes.create" },
  { id: "NWW_010", input: "Zapamatuj si že záruka na mobil je dva roky", expect: "notes.create" }
];

const OBJECTS = [
  "televizi",
  "pračku",
  "telefon",
  "notebook",
  "auto",
  "lednici",
  "mobil",
  "pračku",
  "myčku",
  "kávovar",
  "tablet",
  "sluchátka",
  "kolo",
  "sekačku"
];
const LEADS = [
  "Ulož fakt o záruce na {obj} do poznámek",
  "Ulož informaci o záruce na {obj}",
  "Ulož info o reklamaci {obj}",
  "Ulož účtenku k {obj} do poznámek",
  "Zapiš si doklad k {obj}",
  "Poznamenej si záruka na {obj} končí v lednu",
  "Zapamatuj si že záruka na {obj} je dva roky",
  "Ulož záruční list k {obj} do poznámek",
  "Ulož fakturu za {obj} do poznámek",
  "Ulož info o platnosti záruky na {obj}"
];
const NEG_CAL = [
  "Jen poznámka o záruce na {obj}, ne kalendář",
  "Neukládej do kalendáře, ulož do poznámek info o záruce na {obj}",
  "Dej to do poznámek, záruka na {obj}, ne událost"
];
const NEG_TASK = [
  "Není to úkol, jen informace o záruce na {obj}",
  "Ulož do poznámek záruku na {obj}, ne úkol",
  "Jen informace o záruce na {obj}, ne úkol"
];
const FILLERS = ["", "Hele ", "Prosím ", "No ", "Krátce "];
const MOBILE = ["", "ehm ", "prosim ", "bez diakritiky: "];

function buildCorpusV1(targetCount) {
  const out = TIER_A_MANDATORY.slice();
  let n = out.length;
  const pools = [LEADS, NEG_CAL, NEG_TASK];
  while (out.length < targetCount) {
    const pool = pools[n % pools.length];
    const tpl = pool[n % pool.length];
    const obj = OBJECTS[(n * 3) % OBJECTS.length];
    const pfx = FILLERS[n % FILLERS.length];
    const mob = MOBILE[(n >> 2) % MOBILE.length];
    const input = mob + pfx + tpl.replace("{obj}", obj);
    const entry = {
      id: "NWW_GEN_" + String(n).padStart(4, "0"),
      input: input,
      expect: "notes.create",
      tier: "B"
    };
    if (pool === NEG_CAL) {
      entry.forbidCalendar = true;
      entry.allowClarification = /jen\s+pozn[aá]m/i.test(input);
    }
    if (pool === NEG_TASK) {
      entry.forbidTask = true;
    }
    if (/neukl[aá]dej\s+do\s+kalend/i.test(input)) entry.forbidCalendar = true;
    out.push(entry);
    n++;
  }
  return out.slice(0, targetCount);
}

const NOTE_WRITE_WARRANTY_OBJECT_REPLAY = buildCorpusV1(130);
const NOTE_WRITE_OBJECT_MEMORY_REPLAY = NOTE_WRITE_WARRANTY_OBJECT_REPLAY.filter(function (c) {
  return /\bzapamatuj|poznamenej|informac/i.test(c.input);
});
const NOTE_WRITE_RECEIPT_DOCUMENT_REPLAY = NOTE_WRITE_WARRANTY_OBJECT_REPLAY.filter(function (c) {
  return /\bucten|doklad|faktur/i.test(c.input);
});
const NOTE_WRITE_WARRANTY_NO_CALENDAR_LEAK_REPLAY = NOTE_WRITE_WARRANTY_OBJECT_REPLAY.filter(function (c) {
  return c.forbidCalendar === true;
});
const NOTE_WRITE_WARRANTY_NO_TASK_LEAK_REPLAY = NOTE_WRITE_WARRANTY_OBJECT_REPLAY.filter(function (c) {
  return c.forbidTask === true;
});
const NOTE_WRITE_WARRANTY_CLEAN_PAYLOAD_REPLAY = [
  {
    id: "NWCP_001",
    input: "Ulož fakt o záruce na televizi do poznámek",
    expect: "notes.create",
    bodyNeed: ["televiz"],
    bodyLacks: ["uloz fakt"]
  },
  {
    id: "NWCP_002",
    input: "Zapamatuj si že záruka na mobil je dva roky",
    expect: "notes.create",
    bodyNeed: ["mobil"],
    bodyLacks: ["zapamatuj si ze"]
  }
];

module.exports = {
  TIER_A_MANDATORY,
  buildCorpusV1,
  NOTE_WRITE_WARRANTY_OBJECT_REPLAY,
  NOTE_WRITE_OBJECT_MEMORY_REPLAY,
  NOTE_WRITE_RECEIPT_DOCUMENT_REPLAY,
  NOTE_WRITE_WARRANTY_NO_CALENDAR_LEAK_REPLAY,
  NOTE_WRITE_WARRANTY_NO_TASK_LEAK_REPLAY,
  NOTE_WRITE_WARRANTY_CLEAN_PAYLOAD_REPLAY,
  runReplayCases: shared.runReplayCases,
  evaluateNoteWrite: shared.evaluateNoteWrite,
  printGuardHeader: shared.printGuardHeader,
  loadEngine: shared.loadEngine,
  defaultCtx: shared.defaultCtx
};
