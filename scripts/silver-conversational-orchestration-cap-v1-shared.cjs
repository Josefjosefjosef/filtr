#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");
const helpGov = require("./silver-help-guidance-render-governance-v1-shared.cjs");
const pbux = require("./silver-public-beta-ux-hardening-v1-shared.cjs");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const STATIC_REPLAY = [
  { id: "CAP_001", family: "search_after_save", input: "Ulož schůzku zítra v 15", chain: ["Ulož schůzku zítra v 15", "A teď mi najdi co mám zítra"] },
  { id: "CAP_002", family: "search_after_save", input: "Jen to neukládej", chain: ["Ulož schůzku zítra v 15", "Jen to neukládej"] },
  { id: "CAP_003", family: "help_no_save", input: "Co umíš?" },
  { id: "CAP_004", family: "save_after_search", input: "Dobře, tak to ulož do poznámek", chain: ["Najdi mi Pepovy zálohy", "Dobře, tak to ulož do poznámek"] },
  { id: "CAP_005", family: "search_after_save", input: "Ne, jen mi to ukaž", chain: ["Ulož si že Pepa dluží 500", "Ne, jen mi to ukaž"] },
  { id: "CAP_006", family: "search_after_save", input: "Najdi mi Pepovy zálohy" },
  { id: "CAP_007", family: "search_after_save", input: "A teď to neukládej", chain: ["Ulož poznámku o pojištění", "A teď to neukládej"] },
  { id: "CAP_008", family: "save_after_search", input: "Ulož si že Pepa dluží 500", chain: ["Co mám v poznámkách o autě?", "Ulož si že Pepa dluží 500"] },
  { id: "CAP_009", family: "search_after_save", input: "A kolik dluží celkem?", chain: ["Ulož si že Pepa dluží 500", "A kolik dluží celkem?"] },
  { id: "CAP_010", family: "save_after_search", input: "Jen informace, ne úkol" },
  { id: "CAP_011", family: "save_after_search", input: "To poslední smaž" },
  { id: "CAP_012", family: "module_switch", input: "Ne do kalendáře, do poznámek" },
  { id: "CAP_013", family: "search_after_save", input: "A co mám v pondělí?", chain: ["Ulož schůzku zítra v 15", "A co mám v pondělí?"] },
  { id: "CAP_014", family: "search_after_save", input: "Jen mi řekni co tam je", chain: ["Ulož schůzku zítra v 15", "Jen mi řekni co tam je"] },
  { id: "CAP_015", family: "negated_save", input: "Neukládej nic" },
  { id: "CAP_016", family: "negated_save", input: "Neptám se na vytvoření" },
  { id: "CAP_017", family: "search_after_save", input: "Jen hledám" },
  { id: "CAP_018", family: "help_no_save", input: "Jen help" },
  { id: "CAP_019", family: "search_after_save", input: "Co jsem měl minulý týden?" },
  { id: "CAP_020", family: "save_after_search", input: "A ulož si ještě že servis je v úterý", chain: ["Co mám zítra?", "A ulož si ještě že servis je v úterý"] },
  { id: "CAP_021", family: "search_after_save", input: "Ne, to druhé neukládej", chain: ["Ulož schůzku zítra v 15", "A ulož si ještě že servis je v úterý", "Ne, to druhé neukládej"] },
  { id: "CAP_022", family: "search_after_save", input: "Co mám v poznámkách o autě?" },
  { id: "CAP_023", family: "save_after_search", input: "Ulož poznámku o pojištění" },
  { id: "CAP_024", family: "search_after_save", input: "A teď mi najdi pojištění", chain: ["Ulož poznámku o pojištění", "A teď mi najdi pojištění"] },
  { id: "CAP_025", family: "search_after_save", input: "Jen search" },
  { id: "CAP_026", family: "help_no_save", input: "Jak fungují poznámky?" },
  { id: "CAP_027", family: "help_no_save", input: "Co umíš s úkoly?" },
  { id: "CAP_028", family: "help_no_save", input: "Jak najdu poznámky?" }
];

const TEMPLATE_BANK = {
  search_after_save: [
    "A teď mi najdi {q}",
    "Jen mi ukaž {q}",
    "Jen search {q}",
    "Co mám {q}",
    "Najdi {q}"
  ],
  save_after_search: [
    "Dobře ulož {w}",
    "Tak to ulož do poznamek {w}",
    "Uloz si {w}",
    "Zapis {w}"
  ],
  help_no_save: [
    "Co umis?",
    "Jak fungujou ukoly?",
    "Jak najdu poznamky?",
    "Co mam napsat?",
    "Jak to funguje?"
  ],
  negated_save: [
    "Neukladej nic",
    "Jen hledam",
    "Neptam se na vytvoreni",
    "Jen to neukladej",
    "Nic neukladej"
  ],
  module_switch: [
    "Ne do kalendare do poznamek",
    "Ne do ukolu do kalendare",
    "Jen do poznamek ne kalendar"
  ],
  stale_context_reset: [
    "Jen se podivej co mam zitra v kalendari",
    "Nic neukladej co mam v poznamkach o aute",
    "Jen cti ukoly na zitra"
  ],
  conversational_continuation: [
    "A co dál?",
    "A v ukolech?",
    "A kolik z toho?",
    "A co mam zitra?"
  ],
  followup_ownership: [
    "A to same v poznamkach",
    "A ted v kalendari",
    "A jen v ukolech"
  ]
};

const FILLERS = ["", "Hele ", "No ", "Prosím ", "Vlastně ", "Krátce "];
const TAILS = ["", "?", " prosím", " díky", " — spěchám"];

function buildCapCorpusV1(targetCount) {
  const out = STATIC_REPLAY.slice();
  let n = out.length;
  const families = Object.keys(TEMPLATE_BANK);
  const seeds = {
    q: ["co mam zitra", "pojisteni", "ukoly na zitra", "schuzku s petrem", "barvu auta", "poznamku o aute"],
    w: ["ze servis je v utery", "ze pepa dluzi 500", "poznamku o pojistce", "ukol koupit mleko"]
  };
  while (out.length < targetCount) {
    const family = families[n % families.length];
    const tpls = TEMPLATE_BANK[family];
    const tpl = tpls[n % tpls.length];
    const pfx = FILLERS[n % FILLERS.length];
    const sfx = TAILS[(n >> 2) % TAILS.length];
    let input = tpl.replace("{q}", seeds.q[n % seeds.q.length]).replace("{w}", seeds.w[n % seeds.w.length]);
    input = pfx + input + sfx;
    out.push({
      id: "CAP_GEN_" + String(n).padStart(4, "0"),
      family: family,
      input: input
    });
    n++;
  }
  return out.slice(0, targetCount);
}

function filterFamily(cases, families) {
  const set = new Set(families);
  return cases.filter((c) => set.has(c.family));
}

function runChain(eng, steps, ctx, family) {
  const issues = [];
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  let prev = eng.createEmptyDraft();
  let last = null;
  for (let i = 0; i < steps.length; i++) {
    last = eng.processUserTurn(steps[i], prev, ctx);
    prev = last.draft && last.draft.targetContainer !== "none" ? last.draft : prev;
    const intent = String(last.normalizedIntent || "");
    const isLast = i === steps.length - 1;
    const allowWriteLast = family === "save_after_search" && isLast;
    const allowWriteMid = family === "search_after_save" && !isLast;
    if (!isLast && !allowWriteMid && WRITE_INTENTS.has(intent)) issues.push("mid_turn_write_leak:" + intent);
    if (isLast && !allowWriteLast && WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
    if (isLast && !allowWriteLast && last.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
    if (isLast && !allowWriteLast && last.processingState === "STORAGE_DISAMBIGUATION") issues.push("storage_picker");
    if (intent === "assistant.help" || intent === "assistant.capability") {
      const shell = helpGov.turnWouldLeakSaveShell(last, eng);
      for (let hi = 0; hi < shell.length; hi++) issues.push(shell[hi]);
    }
  }
  return { issues, lastTurn: last };
}

function evaluateCase(eng, c, ctx) {
  if (Array.isArray(c.chain) && c.chain.length > 1) {
    const r = runChain(eng, c.chain, ctx, c.family);
    return { id: c.id, family: c.family, input: c.input, issues: r.issues, pass: r.issues.length === 0 };
  }
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  if (c.family === "help_no_save" && WRITE_INTENTS.has(intent)) issues.push("help_save_leak:" + intent);
  if (
    c.family === "search_after_save" ||
    c.family === "negated_save" ||
    c.family === "stale_context_reset" ||
    c.family === "conversational_continuation" ||
    c.family === "followup_ownership"
  ) {
    if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
    if (turn.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
  }
  if (c.family === "help_no_save") {
    const shell = helpGov.turnWouldLeakSaveShell(turn, eng);
    for (let hi = 0; hi < shell.length; hi++) issues.push(shell[hi]);
  }
  return { id: c.id, family: c.family, input: c.input, issues: issues, pass: issues.length === 0 };
}

function runAudit(guardId, cases, reportPath, extra) {
  const eng = loadEngine();
  const ctx = {
    now: new Date("2026-05-04T12:00:00"),
    getEventsSnapshot: function () {
      return [];
    },
    getTasksSnapshot: function () {
      return [{ id: "t1", title: "koupit mleko", status: "todo", dueAt: "2026-05-05", note: "", priority: "medium", createdAt: 1, updatedAt: 1 }];
    },
    getNotesSnapshot: function () {
      return [
        { id: "n1", title: "Pojištění", content: "pojistka auto", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
        { id: "n2", title: "Pepa záloha", content: "Pepovi záloha 1000", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }
      ];
    }
  };
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
  const need = minPct != null ? minPct : 98;
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
  STATIC_REPLAY,
  buildCapCorpusV1,
  filterFamily,
  runAudit,
  printHeader,
  runChain,
  pbux
};
