#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);
const READ_INTENTS = new Set([
  "calendar.read",
  "calendar.query",
  "tasks.read",
  "tasks.query",
  "notes.read",
  "notes.query",
  "global.search",
  "clarification",
  "unknown"
]);

const TIER_A_REPLAY = [
  { id: "TTQ_001", family: "realistic_mobile_task_query", input: "co mam zitra za ukoly", expect: "tasks.read" },
  { id: "TTQ_002", family: "past_query", input: "co jsem mel vcera", expect: "tasks.read" },
  { id: "TTQ_003", family: "future_query", input: "co mam udelat pristi tyden", expect: "tasks.read" },
  { id: "TTQ_004", family: "past_query", input: "co jsem resil minuly tyden", expect: "tasks.read" },
  { id: "TTQ_005", family: "future_query", input: "mam neco na pondeli", expect: "tasks.read" },
  { id: "TTQ_006", family: "realistic_mobile_task_query", input: "co mam kolem auta", expect: "tasks.read" },
  { id: "TTQ_007", family: "realistic_mobile_task_query", input: "co mam ohledne servisu", expect: "tasks.read" },
  { id: "TTQ_008", family: "mobile_voice_query", input: "mam zavolat doktorovi?", expect: "tasks.read" },
  { id: "TTQ_009", family: "realistic_mobile_task_query", input: "co mam s pepou", expect: "tasks.read" },
  { id: "TTQ_010", family: "past_query", input: "co jsem resil s pepou", expect: "tasks.read" },
  { id: "TTQ_011", family: "realistic_mobile_task_query", input: "co mam kolem pojisteni", expect: "tasks.read" },
  { id: "TTQ_012", family: "realistic_mobile_task_query", input: "mam neco ohledne najmu", expect: "tasks.read" },
  { id: "TTQ_013", family: "past_query", input: "co jsem si psal o aute", expect: "global.search" },
  { id: "TTQ_014", family: "future_query", input: "co mam na dnes", expect: "calendar.read" },
  { id: "TTQ_015", family: "future_query", input: "co mam na zitra", expect: "calendar.read" },
  { id: "TTQ_016", family: "future_query", input: "co mam pristi pondeli", expect: "tasks.read" },
  { id: "TTQ_017", family: "past_query", input: "co jsem mel minulou stredu", expect: "tasks.read" },
  { id: "TTQ_018", family: "realistic_mobile_task_query", input: "mam neco kolem smlouvy", expect: "tasks.read" },
  { id: "TTQ_019", family: "realistic_mobile_task_query", input: "co mam udelat kolem banky", expect: "tasks.read" },
  { id: "TTQ_020", family: "query_no_create", input: "jen mi to ukaz", expect: "tasks.read" },
  { id: "TTQ_021", family: "query_no_create", input: "nic neukladej", expect: "clarification" },
  { id: "TTQ_022", family: "query_no_create", input: "jen hledam", expect: "clarification" },
  { id: "TTQ_023", family: "query_no_create", input: "neptam se na vytvoreni", expect: "clarification" },
  { id: "TTQ_024", family: "realistic_mobile_task_query", input: "co musim zaplatit?", expect: "tasks.read" },
  { id: "TTQ_025", family: "noisy_czech_read", input: "co musim zaplatit", expect: "tasks.read" },
  { id: "TTQ_026", family: "fragment_task_query", input: "kolem auta", expect: "clarification" },
  { id: "TTQ_027", family: "fragment_task_query", input: "ohledne servisu", expect: "clarification" },
  { id: "TTQ_028", family: "task_query_followup", input: "A ted v kalendari", chain: ["Co mam zitra?", "A ted v kalendari"], expect: "calendar.read" },
  { id: "TTQ_029", family: "task_query_followup", input: "A to same v poznamkach", chain: ["Co mam zitra?", "A to same v poznamkach"], expect: "notes.read" },
  { id: "TTQ_030", family: "task_query_followup", input: "A jen v ukolech", chain: ["Co mam zitra?", "A jen v ukolech"], expect: "tasks.read" },
  { id: "TTQ_031", family: "retrieval_drift", input: "A co mam zitra?", chain: ["Uloz schuzku zitra v 15", "A co mam zitra?"], expect: "calendar.read" },
  { id: "TTQ_032", family: "temporal_ownership", input: "co mam zitra v ukolech", expect: "tasks.read" },
  { id: "TTQ_033", family: "rcz_future_past", input: "co jsem mel minulej tejden v ukolech", expect: "tasks.read" },
  { id: "TTQ_034", family: "rcz_future_past", input: "co mam udelat zitra rano", expect: "tasks.read" },
  { id: "TTQ_035", family: "mobile_voice_query", input: "hele co mam zitra za ukoly", expect: "tasks.read" }
];

const FAMILY_TEMPLATES = {
  realistic_mobile_task_query: [
    "co mam zitra za ukoly",
    "co mam kolem auta",
    "co mam ohledne servisu",
    "co mam s pepou",
    "co mam kolem pojisteni",
    "mam neco ohledne najmu",
    "mam neco kolem smlouvy",
    "co mam udelat kolem banky",
    "co musim zaplatit",
    "co mam splnit do patku",
    "co mam jeste zaridit",
    "co mam vyrizit tento tyden",
    "mam neco na zitra v ukolech",
    "co mam dnes za ukoly",
    "ukaz mi ukoly na zitra"
  ],
  future_query: [
    "co mam udelat pristi tyden",
    "mam neco na pondeli",
    "co mam na dnes",
    "co mam na zitra",
    "co mam pristi pondeli",
    "co mam zitra rano",
    "co mam udelat zitra",
    "co mam pristi utery",
    "mam zitra neco na ukolech",
    "co mam splnit pristi mesic"
  ],
  past_query: [
    "co jsem mel vcera",
    "co jsem resil minuly tyden",
    "co jsem mel minulou stredu",
    "co jsem resil s pepou",
    "co jsem mel v ukolech vcera",
    "co jsem resil minulej tejden",
    "co jsem mel dokoncit minuly tyden",
    "co jsem resil ohledne auta",
    "co jsem mel na vcerejsku",
    "co jsem resil kolem banky"
  ],
  noisy_czech_read: [
    "co musim zaplatit",
    "co mam zaplatit",
    "co mam udelat",
    "co mam splnit",
    "co mam vyrizit",
    "mam zavolat doktorovi",
    "co mam kolem auta",
    "co mam ohledne servisu",
    "co mam s pravnikem",
    "co mam na zitra v ukolech"
  ],
  mobile_voice_query: [
    "hele co mam zitra za ukoly",
    "no co mam dnes za ukoly",
    "prosim co mam splnit zitra",
    "mam zavolat doktorovi",
    "co mam kolem auta prosim",
    "kratce co mam ohledne servisu",
    "vlastne co mam s pepou",
    "co mam udelat pristi tyden diky"
  ],
  fragment_task_query: [
    "kolem auta",
    "ohledne servisu",
    "s pepou",
    "kolem pojisteni",
    "ohledne najmu",
    "kolem banky"
  ],
  retrieval_drift: [
    "A co mam zitra?",
    "A v ukolech?",
    "A kolik z toho?",
    "A co dál?",
    "A ted v kalendari",
    "A to same v poznamkach"
  ],
  temporal_ownership: [
    "co mam zitra v ukolech",
    "co mam dnes v ukolech",
    "co mam vcera v ukolech",
    "co mam pristi tyden v ukolech",
    "co jsem mel v ukolech",
    "co mam kolem auta v ukolech"
  ],
  query_no_create: [
    "jen mi to ukaz",
    "nic neukladej",
    "jen hledam",
    "neptam se na vytvoreni",
    "jen search",
    "neukladej nic",
    "jen to neukladej",
    "nic neukladej co mam zitra"
  ],
  task_query_followup: [
    "A ted v kalendari",
    "A to same v poznamkach",
    "A jen v ukolech",
    "A co mam zitra?",
    "A v ukolech?"
  ],
  rcz_future_past: [
    "co jsem mel minulej tejden v ukolech",
    "co mam udelat zitra rano",
    "co jsem resil minuly mesic",
    "co mam pristi pondeli v ukolech",
    "co jsem mel vcera v ukolech",
    "co mam udelat pristi tyden",
    "co jsem resil vcera",
    "co mam zitra za ukoly"
  ]
};

const FILLERS = ["", "Hele ", "No ", "Prosím ", "Vlastně ", "Krátce "];
const TAILS = ["", "?", " prosím", " díky"];

function buildCorpusV1(targetCount) {
  const out = TIER_A_REPLAY.slice();
  let n = out.length;
  const families = Object.keys(FAMILY_TEMPLATES);
  while (out.length < targetCount) {
    const family = families[n % families.length];
    const tpls = FAMILY_TEMPLATES[family];
    const tpl = tpls[n % tpls.length];
    const pfx = FILLERS[n % FILLERS.length];
    const sfx = TAILS[(n >> 2) % TAILS.length];
    let input = pfx + tpl + sfx;
    const entry = {
      id: "TTQ_GEN_" + String(n).padStart(4, "0"),
      family: family,
      input: input,
      expect: "tasks.read",
      tier: "B"
    };
    if (family === "task_query_followup" || family === "retrieval_drift") {
      entry.chain = ["Co mam zitra?", input];
      if (/\bco\s+mam\s+zitra\b/.test(input.toLowerCase())) entry.expect = "calendar.read";
      if (/\bpoznam/.test(input.toLowerCase())) entry.expect = "notes.read";
    }
    if (family === "past_query" && /\bminulou stredu\b/.test(input.toLowerCase())) entry.expect = "tasks.read";
    if (family === "fragment_task_query") entry.expect = "clarification";
    entry.tier = "B";
    out.push(entry);
    n++;
  }
  return out.slice(0, targetCount);
}

function filterFamilies(cases, families) {
  const set = new Set(families);
  return cases.filter((c) => set.has(c.family));
}

function seedCtx() {
  return {
    now: new Date("2026-05-04T12:00:00"),
    getEventsSnapshot: function () {
      return [{ id: "e1", title: "Doktor", startAt: "2026-05-05T09:00:00", endAt: "2026-05-05T09:30:00" }];
    },
    getTasksSnapshot: function () {
      return [
        { id: "t1", title: "zaplatit najem", status: "todo", dueAt: "2026-05-05", note: "auto servis", priority: "medium", createdAt: 1, updatedAt: 1 },
        { id: "t2", title: "zavolat doktorovi", status: "todo", dueAt: "2026-05-06", note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
        { id: "t3", title: "Pepa smlouva", status: "todo", dueAt: "2026-05-10", note: "", priority: "medium", createdAt: 1, updatedAt: 1 }
      ];
    },
    getNotesSnapshot: function () {
      return [
        { id: "n1", title: "Pojištění", content: "pojistka auto", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
        { id: "n2", title: "Pepa záloha", content: "Pepovi záloha 1000", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }
      ];
    }
  };
}

function intentMatches(expect, actual) {
  const e = String(expect || "");
  const a = String(actual || "");
  if (e === a) return true;
  if (e === "tasks.read" && (a === "tasks.query" || a === "global.search")) return true;
  if (e === "calendar.read" && a === "calendar.query") return true;
  if (e === "notes.read" && a === "notes.query") return true;
  if (e === "clarification" && (a === "clarification" || a === "unknown")) return true;
  if (e === "tasks.read" && a === "calendar.read") return false;
  if (e === "calendar.read" && a === "tasks.read") return false;
  return false;
}

function evaluateTurn(turn, c) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  const tierB = c.tier === "B" || String(c.id || "").indexOf("_GEN_") >= 0;
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
  if (turn.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
  if (turn.processingState === "STORAGE_DISAMBIGUATION") issues.push("storage_picker");
  if (intent === "assistant.help" || intent === "assistant.capability") issues.push("capability_leak:" + intent);
  if (tierB) return issues;
  if (c.expect && !intentMatches(c.expect, intent)) {
    if (!(c.family === "query_no_create" && READ_INTENTS.has(intent))) {
      issues.push("intent_mismatch:" + intent + "!=expected:" + c.expect);
    }
  }
  return issues;
}

function evaluateCase(eng, c, ctx) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  if (Array.isArray(c.chain) && c.chain.length > 1) {
    let prev = eng.createEmptyDraft();
    let last = null;
    for (let i = 0; i < c.chain.length; i++) {
      last = eng.processUserTurn(c.chain[i], prev, ctx);
      prev = last.draft && last.draft.targetContainer !== "none" ? last.draft : prev;
    }
    const issues = evaluateTurn(last, c);
    return { id: c.id, family: c.family, input: c.input, issues: issues, pass: issues.length === 0 };
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const issues = evaluateTurn(turn, c);
  return { id: c.id, family: c.family, input: c.input, issues: issues, pass: issues.length === 0 };
}

function runAudit(guardId, cases, reportPath, extra) {
  const eng = loadEngine();
  const ctx = seedCtx();
  let pass = 0;
  const issues = [];
  for (let i = 0; i < cases.length; i++) {
    const r = evaluateCase(eng, cases[i], ctx);
    if (r.pass) pass++;
    else issues.push(r);
  }
  const report = Object.assign(
    {
      guard_id: guardId,
      total: cases.length,
      pass: pass,
      fail: cases.length - pass,
      accuracy_pct: cases.length ? (pass / cases.length) * 100 : 100,
      first_fail: issues[0] || null
    },
    extra || {}
  );
  try {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  } catch (eW) {
    void eW;
  }
  return { report: report, issues: issues };
}

function printHeader(name, report, minPct) {
  const pct = report.accuracy_pct;
  const need = minPct != null ? minPct : 95;
  const okPct = pct >= need;
  const okZero = report.fail === 0;
  console.log("=== " + name.toUpperCase() + " ===");
  console.log("cases_total=" + report.total);
  console.log("pass_count=" + report.pass);
  console.log("accuracy_pct=" + pct.toFixed(2));
  if (report.first_fail) {
    console.log("first_fail_id=" + report.first_fail.id);
    console.log("first_fail_input=" + report.first_fail.input);
    console.log("first_fail_issues=" + (report.first_fail.issues || []).join(","));
  }
  console.log("PASS_FAIL=" + (okPct && okZero ? "PASS" : "FAIL"));
  console.log("=== END_" + name.toUpperCase() + " ===");
  return okPct && okZero;
}

module.exports = {
  TIER_A_REPLAY,
  buildCorpusV1,
  filterFamilies,
  runAudit,
  printHeader,
  evaluateCase,
  seedCtx
};
