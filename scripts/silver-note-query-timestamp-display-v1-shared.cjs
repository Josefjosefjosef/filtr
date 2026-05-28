#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");
const aliasData = require("./silver-czech-person-alias-registry-v1-data.cjs");

function foldCs(s) {
  return aliasData.foldCs(s);
}

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const FIXED_NOW = new Date(2026, 4, 4, 12, 0, 0);
const TS_TODAY_0737 = new Date(2026, 4, 4, 7, 37, 0).getTime();
const TS_YESTERDAY_1810 = new Date(2026, 4, 3, 18, 10, 0).getTime();
const TS_3DAYS = new Date(2026, 4, 1, 10, 0, 0).getTime();
const TS_SERVIS_CREATED = new Date(2026, 4, 1, 8, 0, 0).getTime();
const TS_SERVIS_UPDATED = new Date(2026, 4, 3, 14, 20, 0).getTime();
const TS_OLD_ABS = new Date(2026, 3, 20, 7, 37, 0).getTime();

const STATIC_REPLAY = [
  { id: "NQT_001", family: "finance_advance", input: "Kdy jsem dal Frantovi zálohu?", expectRx: /1000|zaloh/i, expectTs: /Uloženo:\s*(dnes v 07:37|4\.\s*5\.\s*2026\s*07:37)/i },
  { id: "NQT_002", family: "finance_advance", input: "Najdi mi zálohu Franta", expectRx: /Frant|zaloh|1000/i, expectTs: /Uloženo:/i },
  { id: "NQT_003", family: "finance_advance", input: "Ukaž poznámky o zálohách", expectRx: /zaloh/i, expectTs: /Uloženo:/i },
  { id: "NQT_004", family: "service_record", input: "Kdy jsem platil servis?", expectRx: /servis|3500/i, expectTs: /Uloženo:|Upraveno:/i },
  { id: "NQT_005", family: "insurance_record", input: "Najdi poznámku o pojištění", expectRx: /pojist/i, expectTs: /Uloženo:/i },
  { id: "NQT_006", family: "loan_record", input: "Co mám v poznámkách o půjčce?", expectRx: /poznámkách|pujck|bank/i, expectTs: /Uloženo:/i },
  { id: "NQT_007", family: "contract_record", input: "Kdy jsem si poznamenal smlouvu?", expectRx: /smlouv/i, expectTs: /Uloženo:/i },
  { id: "NQT_008", family: "car_record", input: "Najdi poslední poznámku o autě", expectRx: /auto|servis/i, expectTs: /Uloženo:/i },
  { id: "NQT_009", family: "person_record", input: "Co mám uložené o Frantovi?", expectRx: /Frant|zaloh/i, expectTs: /Uloženo:/i },
  { id: "NQT_010", family: "finance_advance", input: "Kdy jsem dával zálohu?", expectRx: /zaloh|Kč/i, expectTs: /Uloženo:/i },
  { id: "NQT_011", family: "finance_advance", input: "Ukaž mi všechny zálohy", expectRx: /zaloh/i, expectTs: /Uloženo:/i },
  { id: "NQT_012", family: "payment_record", input: "Najdi poznámku o platbě", expectRx: /platb|Kč/i, expectTs: /Uloženo:/i },
  { id: "NQT_013", family: "health_record", input: "Kdy jsem si uložil poznámku o doktorovi?", expectRx: /doktor|zubar/i, expectTs: /Uloženo:/i },
  { id: "NQT_014", family: "insurance_record", input: "Co mám v poznámkách o pojišťovně?", expectRx: /pojist/i, expectTs: /Uloženo:/i },
  { id: "NQT_015", family: "car_record", input: "Najdi záznam o opravě auta", expectRx: /oprav|auto/i, expectTs: /Uloženo:/i },
  {
    id: "NQT_016",
    family: "updated_at",
    input: "Najdi poznámku o servisu auta",
    expectRx: /servis/i,
    expectTs: /Upraveno:\s*(včera v 18:10|3\.\s*5\.\s*2026\s*14:20)/i
  },
  {
    id: "NQT_017",
    family: "missing_timestamp",
    input: "Najdi poznámku bez data",
    expectRx: /bez\s+data|poznam/i,
    expectTs: /Datum uložení není dostupné/i,
    notesOverride: "missing_only"
  },
  {
    id: "NQT_018",
    family: "relative_time",
    input: "Najdi starší zálohu Frantovi",
    expectRx: /zaloh|500/i,
    expectTs: /Uloženo:\s*(před 3 dny|1\.\s*5\.\s*2026)/i
  }
];

const TEMPLATE_BANK = {
  finance_advance: [
    "Kdy jsem dal {person} zálohu?",
    "Najdi mi zálohu {person}",
    "Ukaž poznámky o zálohách",
    "Kdy jsem dával zálohu?",
    "Co mám uložené o {person}?",
    "Najdi zálohu {person}",
    "Kolik jsem dal {person} na zálohách?"
  ],
  payment_record: [
    "Najdi poznámku o platbě",
    "Kdy jsem platil {topic}?",
    "Co jsem si uložil o platbě za {topic}?",
    "Najdi záznam o platbě {topic}"
  ],
  service_record: [
    "Kdy jsem platil servis?",
    "Najdi poznámku o servisu {topic}",
    "Co jsem si poznamenal o servisu?",
    "Kdy jsem byl na servisu auta?"
  ],
  insurance_record: [
    "Najdi poznámku o pojištění",
    "Co jsem psal o pojišťovně?",
    "Co mám v poznámkách o pojistce?",
    "Najdi záznam o pojištění {topic}"
  ],
  loan_record: [
    "Co jsem si uložil o půjčce?",
    "Najdi poznámku o půjčce",
    "Kdy jsem si poznamenal půjčku?",
    "Co mám o půjčce v poznámkách?"
  ],
  contract_record: [
    "Kdy jsem si poznamenal smlouvu?",
    "Najdi smlouvu v poznámkách",
    "Co jsem si uložil o smlouvě?",
    "Ukaž poznámku o smlouvě"
  ],
  car_record: [
    "Najdi poslední poznámku o autě",
    "Najdi záznam o opravě auta",
    "Co jsem si psal o autě?",
    "Najdi v poznámkách info o autě"
  ],
  person_record: [
    "Co mám uložené o {person}?",
    "Najdi poznámky o {person}",
    "Co jsem si zapsal o {person}?",
    "Ukaž vše o {person} v poznámkách"
  ],
  health_record: [
    "Kdy jsem si uložil poznámku o doktorovi?",
    "Najdi poznámku o doktorovi",
    "Co mám o zubaři v poznámkách?",
    "Najdi zdravotní poznámku"
  ],
  updated_at: [
    "Najdi poznámku o servisu auta",
    "Co mám o servisu v poznámkách?",
    "Ukaž servisní záznam auta"
  ],
  relative_time: [
    "Co jsem si psal o záloze před pár dny?",
    "Najdi starší zálohu {person}",
    "Kdy jsem dal {person} tu menší zálohu?"
  ],
  missing_timestamp: [
    "Najdi poznámku bez data",
    "Co mám v poznámkách bez data?",
    "Ukaž poznámku kde chybí datum"
  ],
  no_create_guard: [
    "Jen najdi poznámku o {topic}, nic neukládej",
    "Neukládej nic, jen mi ukaž zálohu {person}",
    "Jen najdi v poznámkách {topic}, nic neukládej",
    "Nic nevytvářej, najdi {topic} v poznámkách"
  ]
};

const PERSONS = ["Frantovi", "Pepovi", "Martinovi", "Janovi"];
const TOPICS = ["auta", "servisu", "pojištění", "smlouvy", "platbě", "půjčce"];

function fillTemplate(tpl, n) {
  return tpl
    .replace(/\{person\}/g, PERSONS[n % PERSONS.length])
    .replace(/\{topic\}/g, TOPICS[n % TOPICS.length]);
}

function buildCorpusV1(targetCount) {
  const out = STATIC_REPLAY.slice();
  let n = out.length;
  const families = Object.keys(TEMPLATE_BANK);
  while (out.length < targetCount) {
    const family = families[n % families.length];
    const tpls = TEMPLATE_BANK[family];
    const tpl = tpls[n % tpls.length];
    const input = fillTemplate(tpl, n);
    const entry = {
      id: "NQT_GEN_" + String(n).padStart(4, "0"),
      family: family,
      input: input,
      expectTs: /Uloženo:|Datum uložení není dostupné|Upraveno:/i,
      tier: "B"
    };
    if (family === "finance_advance" || family === "person_record") {
      entry.expectRx = /zaloh|Frant|Pepa|Kč/i;
    } else if (family === "insurance_record") {
      entry.expectRx = /pojist/i;
    } else if (family === "loan_record") {
      entry.expectRx = /pujc|bank/i;
    } else if (family === "service_record" || family === "car_record") {
      entry.expectRx = /servis|auto|oprav/i;
    } else if (family === "health_record") {
      entry.expectRx = /doktor|zubar|zdrav/i;
    } else if (family === "contract_record") {
      entry.expectRx = /smlouv/i;
    } else if (family === "payment_record") {
      entry.expectRx = /platb|Kč/i;
    } else if (family === "updated_at") {
      entry.expectRx = /servis/i;
      entry.expectTs = /Upraveno:/i;
    } else if (family === "missing_timestamp") {
      entry.expectRx = /bez\s+data|poznam/i;
      entry.expectTs = /Datum uložení není dostupné/i;
      entry.notesOverride = "missing_only";
    } else if (family === "relative_time") {
      entry.expectRx = /zaloh|500/i;
      entry.expectTs = /před 3 dny|Uloženo:/i;
    } else {
      entry.expectRx = /poznam|Našel|V poznámkách|Nic jsem/i;
    }
    out.push(entry);
    n++;
  }
  return out.slice(0, targetCount);
}

function filterFamilies(cases, families) {
  const set = new Set(families);
  return cases.filter((c) => set.has(c.family));
}

function seedNotes(override) {
  if (override === "missing_only") {
    return [
      {
        id: "n_missing",
        title: "Poznámka bez data",
        content: "text bez data uložení",
        createdAt: 0,
        updatedAt: 0,
        pinned: false,
        tags: [],
        deleted: false
      }
    ];
  }
  return [
    {
      id: "n_franta_1000",
      title: "Franta záloha",
      content: "Frantovi záloha 1000 Kč",
      createdAt: TS_TODAY_0737,
      updatedAt: TS_TODAY_0737,
      pinned: false,
      tags: [],
      deleted: false
    },
    {
      id: "n_franta_500",
      title: "Záloha Franta starší",
      content: "Frantovi záloha 500 Kč",
      createdAt: TS_3DAYS,
      updatedAt: TS_3DAYS,
      pinned: false,
      tags: [],
      deleted: false
    },
    {
      id: "n_pepa",
      title: "Záloha Pepa",
      content: "Pepovi záloha 800 Kč",
      createdAt: TS_YESTERDAY_1810,
      updatedAt: TS_YESTERDAY_1810,
      pinned: false,
      tags: [],
      deleted: false
    },
    {
      id: "n_servis",
      title: "Servis auto",
      content: "platba servis auta 3500 Kč oprava",
      createdAt: TS_SERVIS_CREATED,
      updatedAt: TS_SERVIS_UPDATED,
      pinned: false,
      tags: [],
      deleted: false
    },
    {
      id: "n_pojist",
      title: "Pojištění",
      content: "pojistka auto Allianz",
      createdAt: TS_OLD_ABS,
      updatedAt: TS_OLD_ABS,
      pinned: false,
      tags: [],
      deleted: false
    },
    {
      id: "n_pujcka",
      title: "Půjčka banka",
      content: "půjčka od banky splátka",
      createdAt: TS_YESTERDAY_1810,
      updatedAt: TS_YESTERDAY_1810,
      pinned: false,
      tags: [],
      deleted: false
    },
    {
      id: "n_smlouva",
      title: "Smlouva nájem",
      content: "smlouva o nájmu bytu",
      createdAt: TS_3DAYS,
      updatedAt: TS_3DAYS,
      pinned: false,
      tags: [],
      deleted: false
    },
    {
      id: "n_doktor",
      title: "Doktor",
      content: "zubař kontrola termín",
      createdAt: TS_TODAY_0737,
      updatedAt: TS_TODAY_0737,
      pinned: false,
      tags: [],
      deleted: false
    },
    {
      id: "n_platba",
      title: "Platba energie",
      content: "platba za elektřinu 2200 Kč",
      createdAt: TS_YESTERDAY_1810,
      updatedAt: TS_YESTERDAY_1810,
      pinned: false,
      tags: [],
      deleted: false
    }
  ];
}

function seedCtx(c) {
  const notes = seedNotes(c && c.notesOverride);
  return {
    now: FIXED_NOW,
    getEventsSnapshot: function () {
      return [];
    },
    getTasksSnapshot: function () {
      return [];
    },
    getNotesSnapshot: function () {
      return notes;
    }
  };
}

function turnMsg(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
}

function evaluateCase(c, turn) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  const msg = turnMsg(turn);
  const tierB = c.tier === "B" || String(c.id || "").indexOf("_GEN_") >= 0;
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
  if (turn.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
  if (turn.processingState === "STORAGE_DISAMBIGUATION") issues.push("storage_picker");
  if (turn.draft && turn.draft.targetContainer && turn.draft.targetContainer !== "none") issues.push("draft_leak");
  if (tierB) return issues;
  if (
    intent.indexOf(".read") < 0 &&
    intent !== "global.search" &&
    turn.processingState !== "READ_OK" &&
    intent !== "clarification"
  ) {
    issues.push("not_read:" + intent);
  }
  if (intent === "clarification") issues.push("clarification_instead_of_read");
  const msgFold = foldCs(msg);
  if (c.expectRx && !c.expectRx.test(msg) && !c.expectRx.test(msgFold)) issues.push("content_miss:" + msg.slice(0, 100));
  if (c.expectTs && !c.expectTs.test(msg) && !c.expectTs.test(msgFold)) issues.push("timestamp_miss:" + msg.slice(0, 160));
  if (
    turn.processingState === "READ_OK" &&
    !/Nic jsem k tomu nenašel/i.test(msg) &&
    !/Uloženo:|Datum uložení není dostupné|Upraveno:/i.test(msg) &&
    intent !== "clarification"
  ) {
    issues.push("timestamp_absent");
  }
  return issues;
}

function evaluateTurn(eng, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const ctx = seedCtx(c);
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const issues = evaluateCase(c, turn);
  return {
    id: c.id,
    family: c.family,
    input: c.input,
    issues: issues,
    pass: issues.length === 0,
    intent: turn.normalizedIntent,
    message: turnMsg(turn).slice(0, 200)
  };
}

function runAudit(guardId, cases, reportPath) {
  const eng = loadEngine();
  let pass = 0;
  const fails = [];
  const safety = { query_created_write_count: 0, false_write_count: 0 };
  for (let i = 0; i < cases.length; i++) {
    const r = evaluateTurn(eng, cases[i]);
    if (r.pass) {
      pass++;
      continue;
    }
    fails.push(r);
    if ((r.issues || []).some((x) => String(x).indexOf("write_leak") >= 0 || String(x).indexOf("ready_to_save") >= 0)) {
      safety.query_created_write_count++;
      safety.false_write_count++;
    }
  }
  const report = {
    guard_id: guardId,
    total: cases.length,
    pass: pass,
    fail: fails.length,
    query_created_write_count: safety.query_created_write_count,
    false_write_count: safety.false_write_count,
    PASS_FAIL: fails.length === 0 ? "PASS" : "FAIL",
    first_fail: fails[0] || null
  };
  if (reportPath) {
    try {
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    } catch (eW) {
      void eW;
    }
  }
  return { report: report, fails: fails };
}

function printHeader(name, report, minPct) {
  const pct = report.total ? (report.pass / report.total) * 100 : 100;
  const need = minPct != null ? minPct : 95;
  const ok = report.fail === 0 && pct >= need;
  console.log("=== " + name.toUpperCase() + " ===");
  console.log("pass=" + report.pass + "/" + report.total);
  console.log("query_created_write_count=" + (report.query_created_write_count || 0));
  console.log("false_write_count=" + (report.false_write_count || 0));
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  if (report.first_fail) {
    console.log("first_fail_id=" + report.first_fail.id);
    console.log("first_fail_input=" + report.first_fail.input);
    console.log("first_fail_issues=" + (report.first_fail.issues || []).join(","));
    console.log("first_fail_message=" + (report.first_fail.message || ""));
  }
  console.log("=== END_" + name.toUpperCase() + " ===");
  return ok;
}

module.exports = {
  STATIC_REPLAY,
  buildCorpusV1,
  filterFamilies,
  runAudit,
  printHeader,
  seedCtx,
  FIXED_NOW
};
