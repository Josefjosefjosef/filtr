#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");
const tsShared = require("./silver-note-query-timestamp-display-v1-shared.cjs");
const lsfShared = require("./silver-long-session-firewall-v1-shared.cjs");
const aliasData = require("./silver-czech-person-alias-registry-v1-data.cjs");
const core = require("./rhc-v3-deterministic-core.cjs");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const FIXED_NOW = tsShared.FIXED_NOW;

const SEED_NOTES_BASE = [
  { id: "ns_franta", title: "Franta záloha", content: "Frantovi záloha 1000 Kč", person: "franta", money: 1000, topic: "zaloha" },
  { id: "ns_pepa", title: "Pepa půjčka", content: "Pepovi půjčka 500 Kč", person: "pepa", money: 500, topic: "pujcka" },
  { id: "ns_martin", title: "Martin doplatek", content: "Martinovi doplatek 2500 Kč", person: "martin", money: 2500, topic: "doplatek" },
  { id: "ns_ucetni", title: "účetní platba", content: "platba účetní 1200 Kč", person: "ucetni", money: 1200, topic: "platba" },
  { id: "ns_servis", title: "auto servis", content: "Oktavka servis STK 3500 Kč", topic: "servis", object: "auto" },
  { id: "ns_tel", title: "telefon záruka", content: "iPhone záruka do 2027", topic: "zaruka", object: "telefon" },
  { id: "ns_led", title: "lednice oprava", content: "oprava lednice servis", topic: "oprava", object: "lednice" },
  { id: "ns_nb", title: "notebook reklamace", content: "notebook reklamace Alza", topic: "reklamace", object: "notebook" },
  { id: "ns_poj", title: "pojistka auta", content: "Allianz pojištění auta", topic: "pojisteni", object: "auto" },
  { id: "ns_sml", title: "smlouva nájem", content: "smlouva o nájmu bytu", topic: "smlouva" },
  { id: "ns_prav", title: "právník exekuce", content: "právník exekuce dohoda", topic: "pravnik" },
  { id: "ns_fak", title: "faktura elektřina", content: "faktura elektřina 2200 Kč", topic: "faktura", money: 2200 }
];

function foldCs(s) {
  return aliasData.foldCs(s);
}

function seedNotesRuntime() {
  const t0 = FIXED_NOW.getTime();
  return SEED_NOTES_BASE.map(function (row, i) {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      createdAt: t0 - (i + 1) * 3600000,
      updatedAt: t0 - (i + 1) * 3600000,
      pinned: false,
      tags: [],
      deleted: false
    };
  });
}

function seedCtx() {
  const notes = seedNotesRuntime();
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

function classifyFail(c, turn, issues) {
  const intent = String(turn.normalizedIntent || "");
  const msg = turnMsg(turn);
  if (issues.some(function (x) {
    return String(x).indexOf("write_leak") >= 0 || String(x).indexOf("ready_to_save") >= 0 || String(x).indexOf("draft_leak") >= 0;
  })) {
    return "SAFETY_RISK";
  }
  if (issues.some(function (x) {
    return String(x).indexOf("module_leak") >= 0;
  })) {
    return "MODULE_LEAK";
  }
  if (issues.some(function (x) {
    return String(x).indexOf("create_leak") >= 0;
  })) {
    return "CREATE_LEAK";
  }
  if (issues.some(function (x) {
    return String(x).indexOf("timestamp") >= 0;
  })) {
    return "TIMESTAMP_RENDER_LEAK";
  }
  if (issues.some(function (x) {
    return String(x).indexOf("ranking") >= 0 || String(x).indexOf("content_miss") >= 0;
  })) {
    return "RETRIEVAL_RANKING_FAIL";
  }
  if (issues.some(function (x) {
    return String(x).indexOf("not_read") >= 0 || String(x).indexOf("clarification") >= 0;
  })) {
    if (/\b(frant|pep|auto|pojist|servis)\b/.test(foldCs(c.input)) && intent === "clarification") return "TRUE_ENGINE_FAIL";
    return "TRUE_ENGINE_FAIL";
  }
  if (c.tier === "B") return "AMBIGUOUS_INPUT";
  return "HARNESS_OR_GOLD";
}

function evaluateCase(c, turn) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  const msg = turnMsg(turn);
  const msgFold = foldCs(msg);
  const tierB = c.tier === "B" || String(c.id || "").indexOf("_GEN_") >= 0;

  if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
  if (turn.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
  if (turn.processingState === "STORAGE_DISAMBIGUATION") issues.push("storage_picker");
  if (turn.draft && turn.draft.targetContainer && turn.draft.targetContainer !== "none") issues.push("draft_leak");

  if (c.forbidWrite && (WRITE_INTENTS.has(intent) || turn.processingState === "READY_TO_SAVE")) {
    issues.push("create_leak");
  }

  if (!tierB) {
    if (intent.indexOf("calendar") >= 0 && c.expectModule === "notes") issues.push("module_leak:calendar");
    if (intent.indexOf("task") >= 0 && c.expectModule === "notes") issues.push("module_leak:task");
    if (c.expectModule === "notes" && intent !== "notes.read" && intent !== "global.search" && intent !== "clarification") {
      issues.push("not_read:" + intent);
    }
    if (c.expectModule === "notes" && intent === "global.search" && c.requireNotesRead) {
      issues.push("module_leak:global.search");
    }
    if (c.expectModule === "notes" && intent === "clarification") issues.push("clarification_instead_of_read");
    if (c.expectRx && !c.expectRx.test(msg) && !c.expectRx.test(msgFold)) issues.push("content_miss:" + msg.slice(0, 120));
    if (c.expectNotRx && (c.expectNotRx.test(msg) || c.expectNotRx.test(msgFold))) issues.push("ranking:" + msg.slice(0, 120));
    if (c.expectTs && !c.expectTs.test(msg) && !c.expectTs.test(msgFold)) issues.push("timestamp_miss");
    if (
      c.expectTs &&
      turn.processingState === "READ_OK" &&
      !/Nic jsem k tomu nenašel/i.test(msg) &&
      !/Uloženo:|Upraveno:|Datum uložení není dostupné/i.test(msg)
    ) {
      issues.push("timestamp_absent");
    }
  }

  return issues;
}

function evaluateTurn(eng, c) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const ctx = seedCtx();
  let turn;
  if (Array.isArray(c.chain) && c.chain.length) {
    let draft = eng.createEmptyDraft();
    for (let ci = 0; ci < c.chain.length; ci++) {
      turn = eng.processUserTurn(c.chain[ci], draft, ctx);
      draft = turn.draft || eng.createEmptyDraft();
    }
  } else {
    turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  }
  const issues = evaluateCase(c, turn);
  return {
    id: c.id,
    family: c.family,
    input: c.input,
    issues: issues,
    pass: issues.length === 0,
    failClass: issues.length ? classifyFail(c, turn, issues) : "PASS",
    intent: turn.normalizedIntent,
    message: turnMsg(turn).slice(0, 220)
  };
}

const STATIC_REPLAY = [
  { id: "NSR_PM_001", family: "person_money", input: "Co mám uložené o Frantovi?", expectRx: /frant|zaloh|1000/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_PM_002", family: "person_money", input: "Kdy jsem dal Frantovi zálohu?", expectRx: /frant|zaloh|1000/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_PM_003", family: "person_money", input: "Najdi mi zálohu Franta", expectRx: /frant|zaloh/i, expectNotRx: /pepa\s+p[uů]j[cč]k/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_PM_004", family: "person_money", input: "Kolik jsem dal Frantovi?", expectRx: /1000|frant|zaloh/i, expectModule: "notes", requireNotesRead: true },
  { id: "NSR_PM_005", family: "person_money", input: "Ukaž poznámku o půjčce", expectRx: /p[uů]j[cč]k|pep/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_PM_006", family: "person_money", input: "Najdi platbu účetní", expectRx: /ucetni|platb|1200/i, expectNotRx: /servis\s+stk/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_OS_001", family: "object_service", input: "Najdi poznámku o servisu auta", expectRx: /servis|auto|oktav/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_OS_002", family: "object_service", input: "Co mám uložené o pojištění?", expectRx: /pojist|allianz/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_OS_003", family: "object_service", input: "Kdy jsem řešil reklamaci notebooku?", expectRx: /reklam|notebook|alza/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_OS_004", family: "object_service", input: "Ukaž poznámky o autě", expectRx: /auto|servis|pojist/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_OS_005", family: "object_service", input: "Co mám k záruce telefonu?", expectRx: /zaruk|telefon|iphone/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_CI_001", family: "contract_insurance", input: "Najdi poznámku o smlouvě", expectRx: /smlouv|najem/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_CI_002", family: "contract_insurance", input: "Co jsem psal o právníkovi?", expectRx: /pravnik|exekuc/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_CI_003", family: "contract_insurance", input: "Ukaž poznámku k faktuře", expectRx: /faktur|elektr/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_FD_001", family: "fragment_diacritics", input: "frant zaloha", expectRx: /frant|zaloh|1000/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_FD_002", family: "fragment_diacritics", input: "pojisteni auto", expectRx: /pojist|auto|allianz/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_FD_003", family: "fragment_diacritics", input: "servis oktavka", expectRx: /servis|oktav/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_FD_004", family: "fragment_diacritics", input: "pravnik smlouva", expectRx: /pravnik|smlouv/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_FD_005", family: "fragment_diacritics", input: "faktura elektrina", expectRx: /faktur|elektr/i, expectModule: "notes", requireNotesRead: true, expectTs: /Uloženo:/i },
  { id: "NSR_LS_001", family: "long_session_note", chain: ["Ulož do poznámek Franta záloha 1000", "Co mám zítra v kalendáři?", "Co mám v úkolech?", "Najdi zálohu Franta"], input: "Najdi zálohu Franta", expectRx: /frant|zaloh/i, expectModule: "notes", requireNotesRead: true, forbidWrite: true, expectTs: /Uloženo:/i },
  { id: "NSR_NC_001", family: "no_create_leak", input: "Jen najdi zálohu Franta, nic neukládej", expectRx: /frant|zaloh/i, expectModule: "notes", requireNotesRead: true, forbidWrite: true, expectTs: /Uloženo:/i },
  { id: "NSR_MI_001", family: "module_isolation", input: "Najdi poznámku o pojištění", expectRx: /pojist/i, expectModule: "notes", requireNotesRead: true, forbidWrite: true, expectTs: /Uloženo:/i }
];

const TEMPLATE_BANK = {
  person_money: [
    "Co mám uložené o {person}?",
    "Kdy jsem dal {person} zálohu?",
    "Najdi mi zálohu {person}",
    "Kolik jsem dal {person}?",
    "Ukaž poznámku o půjčce {person}",
    "Najdi platbu {topic}",
    "Co mám o {topic} v poznámkách?"
  ],
  object_service: [
    "Najdi poznámku o servisu {object}",
    "Co mám uložené o pojištění?",
    "Kdy jsem řešil reklamaci {object}?",
    "Ukaž poznámky o {object}",
    "Co mám k záruce {object}?"
  ],
  contract_insurance: [
    "Najdi poznámku o smlouvě",
    "Co jsem psal o právníkovi?",
    "Ukaž poznámku k faktuře",
    "Kdy jsem si poznamenal dohodu?",
    "Najdi záznam o pojištění {object}"
  ],
  fragment_diacritics: [
    "{person} {topic}",
    "{topic} {object}",
    "servis {object}",
    "pravnik smlouva",
    "faktura elektrina",
    "pojisteni auto",
    "zaloha {person}"
  ],
  long_session_note: [
    { chain: ["Ulož poznámku {person} záloha", "Co mám v kalendáři na zítra?", "Najdi {topic} {person}"], input: "Najdi {topic} {person}" },
    { chain: ["Co umíš?", "Najdi poznámku o {object}", "Co mám v úkolech?", "Najdi {topic} {person}"], input: "Najdi {topic} {person}" }
  ],
  no_create_leak: [
    "Jen najdi {topic} {person}, nic neukládej",
    "Neukládej nic, jen mi ukaž {topic}",
    "Nic nevytvářej, najdi {topic} v poznámkách"
  ],
  module_isolation: [
    "Najdi poznámku o {topic}",
    "Co mám v poznámkách o {object}?",
    "Ukaž záznam o {topic}"
  ],
  timestamp_preservation: [
    "Kdy jsem dal {person} zálohu?",
    "Najdi poznámku o servisu {object}",
    "Co mám uložené o pojištění?"
  ]
};

const PERSONS = ["Frantovi", "Pepovi", "Martinovi", "účetní"];
const TOPICS = ["záloha", "půjčce", "platbě", "pojištění", "servisu"];
const OBJECTS = ["auta", "telefonu", "notebooku", "lednici"];

function fillTemplate(tpl, n) {
  return tpl
    .replace(/\{person\}/g, PERSONS[n % PERSONS.length])
    .replace(/\{topic\}/g, TOPICS[n % TOPICS.length])
    .replace(/\{object\}/g, OBJECTS[n % OBJECTS.length]);
}

function buildCorpusV1(targetCount) {
  const out = STATIC_REPLAY.slice();
  let n = out.length;
  const families = Object.keys(TEMPLATE_BANK);
  while (out.length < targetCount) {
    const family = families[n % families.length];
    const tpls = TEMPLATE_BANK[family];
    const tpl = tpls[n % tpls.length];
    let entry;
    if (family === "long_session_note" && tpl && tpl.chain) {
      entry = {
        id: "NSR_GEN_" + String(n).padStart(4, "0"),
        family: family,
        chain: tpl.chain.map(function (line) {
          return fillTemplate(line, n);
        }),
        input: fillTemplate(tpl.input, n),
        expectRx: /frant|zaloh|pep|pojist|servis|smlouv|faktur/i,
        expectModule: "notes",
        requireNotesRead: true,
        forbidWrite: true,
        expectTs: /Uloženo:/i,
        tier: "B"
      };
    } else {
      const input = fillTemplate(String(tpl), n);
      entry = {
        id: "NSR_GEN_" + String(n).padStart(4, "0"),
        family: family,
        input: input,
        expectRx: /poznam|frant|zaloh|pep|pojist|servis|smlouv|faktur|Našel|Nic jsem/i,
        expectModule: "notes",
        requireNotesRead: family !== "fragment_diacritics",
        forbidWrite: family === "no_create_leak",
        expectTs: /Uloženo:|Nic jsem/i,
        tier: "B"
      };
      if (family === "person_money") entry.expectRx = /frant|pep|martin|zaloh|pujc|platb|Kč/i;
      if (family === "fragment_diacritics") {
        entry.expectRx = /frant|zaloh|pojist|servis|pravnik|faktur|Našel/i;
        entry.requireNotesRead = true;
      }
    }
    out.push(entry);
    n++;
  }
  return out.slice(0, targetCount);
}

function filterFamilies(cases, families) {
  const set = new Set(families);
  return cases.filter(function (c) {
    return set.has(c.family);
  });
}

function runAudit(guardId, cases, reportPath) {
  const eng = loadEngine();
  let pass = 0;
  const fails = [];
  const safety = { query_created_write_count: 0, false_write_count: 0, dangerous_write_count: 0 };
  const failByClass = {};
  const failByFamily = {};

  for (let i = 0; i < cases.length; i++) {
    const r = evaluateTurn(eng, cases[i]);
    if (r.pass) {
      pass++;
      continue;
    }
    fails.push(r);
    failByClass[r.failClass] = (failByClass[r.failClass] || 0) + 1;
    failByFamily[r.family] = (failByFamily[r.family] || 0) + 1;
    if ((r.issues || []).some(function (x) {
      return String(x).indexOf("write") >= 0 || String(x).indexOf("ready_to_save") >= 0 || String(x).indexOf("create_leak") >= 0;
    })) {
      safety.query_created_write_count++;
      safety.false_write_count++;
      safety.dangerous_write_count++;
    }
  }

  const report = {
    guard_id: guardId,
    total: cases.length,
    pass: pass,
    fail: fails.length,
    fail_by_class: failByClass,
    fail_by_family: failByFamily,
    query_created_write_count: safety.query_created_write_count,
    false_write_count: safety.false_write_count,
    dangerous_write_count: safety.dangerous_write_count,
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

function runDiagnostic(reportPath) {
  const cases = buildCorpusV1(120);
  const res = runAudit("silver_note_search_read_diagnostic_v1", cases, reportPath);
  const diag = {
    guard_id: "silver_note_search_read_diagnostic_v1",
    note_search_fail_count: res.report.fail,
    person_money_fail_count: res.fails.filter(function (f) {
      return f.family === "person_money";
    }).length,
    object_service_fail_count: res.fails.filter(function (f) {
      return f.family === "object_service";
    }).length,
    contract_insurance_fail_count: res.fails.filter(function (f) {
      return f.family === "contract_insurance";
    }).length,
    fragment_diacritics_fail_count: res.fails.filter(function (f) {
      return f.family === "fragment_diacritics";
    }).length,
    long_session_note_fail_count: res.fails.filter(function (f) {
      return f.family === "long_session_note";
    }).length,
    module_leak_count: res.fails.filter(function (f) {
      return f.failClass === "MODULE_LEAK";
    }).length,
    create_leak_count: res.fails.filter(function (f) {
      return f.failClass === "SAFETY_RISK" || f.failClass === "CREATE_LEAK";
    }).length,
    timestamp_regress_count: res.fails.filter(function (f) {
      return f.failClass === "TIMESTAMP_RENDER_LEAK";
    }).length,
    true_engine_fail_count: res.fails.filter(function (f) {
      return f.failClass === "TRUE_ENGINE_FAIL" || f.failClass === "RETRIEVAL_RANKING_FAIL" || f.failClass === "NORMALIZATION_FAIL";
    }).length,
    harness_problem_count: res.fails.filter(function (f) {
      return f.failClass === "HARNESS_OR_GOLD" || f.failClass === "AMBIGUOUS_INPUT";
    }).length,
    ambiguous_input_count: res.fails.filter(function (f) {
      return f.failClass === "AMBIGUOUS_INPUT";
    }).length,
    fail_classification: res.report.fail_by_class,
    PASS_FAIL: res.report.PASS_FAIL,
    first_fail: res.report.first_fail
  };
  if (reportPath) {
    try {
      fs.writeFileSync(reportPath, JSON.stringify(diag, null, 2), "utf8");
    } catch (eW2) {
      void eW2;
    }
  }
  return { report: diag, fails: res.fails, audit: res.report };
}

function printHeader(name, report, minPct) {
  const pct = report.total ? (report.pass / report.total) * 100 : 100;
  const need = minPct != null ? minPct : 95;
  const ok = (report.fail == null ? report.note_search_fail_count === 0 : report.fail === 0) && pct >= need;
  console.log("=== " + name.toUpperCase() + " ===");
  if (report.pass != null && report.total != null) {
    console.log("pass=" + report.pass + "/" + report.total);
  }
  if (report.note_search_fail_count != null) {
    console.log("note_search_fail_count=" + report.note_search_fail_count);
    console.log("true_engine_fail_count=" + (report.true_engine_fail_count || 0));
    console.log("create_leak_count=" + (report.create_leak_count || 0));
  }
  console.log("query_created_write_count=" + (report.query_created_write_count || 0));
  console.log("false_write_count=" + (report.false_write_count || 0));
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  if (report.first_fail) {
    console.log("first_fail_id=" + report.first_fail.id);
    console.log("first_fail_input=" + report.first_fail.input);
    console.log("first_fail_issues=" + (report.first_fail.issues || []).join(","));
    console.log("first_fail_class=" + (report.first_fail.failClass || ""));
  }
  console.log("=== END_" + name.toUpperCase() + " ===");
  return ok;
}

module.exports = {
  STATIC_REPLAY,
  buildCorpusV1,
  filterFamilies,
  runAudit,
  runDiagnostic,
  printHeader,
  seedCtx,
  FIXED_NOW,
  classifyFail
};
