#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");
const helpGov = require("./silver-help-guidance-render-governance-v1-shared.cjs");
const noteShared = require("./silver-note-write-hardening-v1-shared.cjs");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);
const READ_INTENTS = new Set([
  "calendar.read",
  "tasks.read",
  "notes.read",
  "global.search",
  "assistant.help",
  "assistant.capability"
]);

const STATIC_REPLAY = [
  { id: "RUX_001", family: "wrong_collection_chaos", input: "ne do poznamek Ne do kalendare, jen do poznamek: heslo od trezoru je 9999.", expect: "notes.create", forbidCalendar: true },
  { id: "RUX_002", family: "wrong_collection_chaos", input: "Ne do kalendáře, jen do poznámek: heslo od trezoru je 9999.", expect: "notes.create", forbidCalendar: true },
  { id: "RUX_003", family: "wrong_collection_chaos", input: "Není to úkol ale poznámka o smlouvě", expect: "notes.create", allowClarification: true },
  { id: "RUX_004", family: "wrong_collection_chaos", input: "Dej to do kalendáře a ne jako poznámku", expect: "calendar.create", forbidNote: true },
  { id: "RUX_005", family: "wrong_collection_chaos", input: "Jen poznámka, ne událost", expect: "notes.create", allowClarification: true },
  { id: "RUX_006", family: "wrong_collection_chaos", input: "Jen úkol, ne poznámka", expect: "tasks.create", forbidNote: true, allowClarification: true },
  { id: "RUX_007", family: "wrong_collection_chaos", input: "Ne do kalendáře, do úkolů", expect: "tasks.create", forbidCalendar: true, allowClarification: true },
  { id: "RUX_008", family: "save_search_collision", input: "Ulož schůzku zítra v 15 a ještě mi najdi co mám v pátek", chain: ["Ulož schůzku zítra v 15 a ještě mi najdi co mám v pátek"] },
  { id: "RUX_009", family: "save_search_collision", input: "Jen mi ukaž co mám zítra a pak ulož servis do úkolů", chain: ["Jen mi ukaž co mám zítra", "Ulož servis do úkolů"] },
  { id: "RUX_010", family: "save_search_collision", input: "Neukládej nic, jen mi řekni co mám kolem auta", expectRead: true },
  { id: "RUX_011", family: "save_search_collision", input: "Co mám v poznámkách o pojištění a ještě ulož schůzku na pondělí", chain: ["Co mám v poznámkách o pojištění a ještě ulož schůzku na pondělí"] },
  { id: "RUX_012", family: "save_search_collision", input: "Jen search, nic nevytvářej", expectRead: true },
  { id: "RUX_013", family: "save_search_collision", input: "A teď mi najdi co jsem řešil s Pepou", expectRead: true },
  { id: "RUX_014", family: "help_save_collision", input: "Co umíš a pak ulož připomínku", expectWrite: true, forbidHelpLeak: true },
  { id: "RUX_015", family: "help_save_collision", input: "Co umíš?", expectRead: true },
  { id: "RUX_016", family: "help_save_collision", input: "Jak fungují poznámky?", expectRead: true },
  { id: "RUX_017", family: "followup_ownership_chaos", input: "Ne, to druhé neukládej", chain: ["Ulož schůzku zítra v 15", "A ulož si ještě že servis je v úterý", "Ne, to druhé neukládej"] },
  { id: "RUX_018", family: "followup_ownership_chaos", input: "Jen to první", chain: ["Ulož schůzku zítra v 15", "A ulož si ještě že servis je v úterý", "Jen to první"] },
  { id: "RUX_019", family: "followup_ownership_chaos", input: "To poslední smaž", chain: ["Ulož poznámku o pojištění", "A ulož schůzku na pondělí", "To poslední smaž"] },
  { id: "RUX_020", family: "followup_ownership_chaos", input: "A ještě k tomu přidej poznámku", chain: ["Ulož schůzku zítra v 15", "A ještě k tomu přidej poznámku"] },
  { id: "RUX_021", family: "long_chain_command", input: "Ulož schůzku zítra v 15 a ještě mi najdi co mám v pátek a pak mi řekni co umíš", chain: ["Ulož schůzku zítra v 15 a ještě mi najdi co mám v pátek a pak mi řekni co umíš"] },
  { id: "RUX_022", family: "long_chain_command", input: "Co mám zítra, ulož servis do úkolů a ještě najdi pojištění", chain: ["Co mám zítra, ulož servis do úkolů a ještě najdi pojištění"] },
  { id: "RUX_023", family: "conversational_drift", input: "A teď mi najdi co mám příští týden", chain: ["Ulož poznámku o autě", "A teď mi najdi co mám příští týden"] },
  { id: "RUX_024", family: "conversational_drift", input: "Co jsem měl minulý měsíc kolem auta", expectRead: true },
  { id: "RUX_025", family: "conversational_drift", input: "Jen mi to ukaž", chain: ["Ulož schůzku zítra v 15", "Jen mi to ukaž"] },
  { id: "RUX_026", family: "conversational_drift", input: "Neptám se na vytvoření", expectRead: true },
  { id: "RUX_027", family: "mobile_multi_intent", input: "Pridej mi ukol zavolat Petrovi a zaroven si do poznamek napis, ze chce resit strechu.", chain: ["Pridej mi ukol zavolat Petrovi a zaroven si do poznamek napis, ze chce resit strechu."] },
  { id: "RUX_028", family: "mobile_multi_intent", input: "Hoď mi do kalendáře schůzku s Novákem a jako úkol mi napiš, že mu mám poslat podklady.", chain: ["Hoď mi do kalendáře schůzku s Novákem a jako úkol mi napiš, že mu mám poslat podklady."] },
  { id: "RUX_029", family: "stale_draft_chaos", input: "Nic neukládej", chain: ["Ulož schůzku zítra v 15", "Nic neukládej"], expectRead: true },
  { id: "RUX_030", family: "stale_retrieval_chaos", input: "Jen hledám", chain: ["Ulož si že Pepa dluží 500", "Jen hledám"], expectRead: true },
  { id: "RUX_031", family: "real_user_chaos_routing", input: "A ještě mi najdi co jsem řešil s Pepou", expectRead: true },
  { id: "RUX_032", family: "real_user_chaos_routing", input: "Jen poznámka, ne událost", expect: "notes.create", allowClarification: true }
];

const TEMPLATE_BANK = {
  wrong_collection_chaos: [
    "Ne do kalendare, jen do poznamek: {body}",
    "Neni to ukol ale poznamka o {body}",
    "Jen poznamka, ne udalost o {body}",
    "Jen ukol, ne poznamka: {body}",
    "Ne do kalendare, do ukolu: {body}"
  ],
  mobile_multi_intent: [
    "Pridej ukol {body} a zaroven do poznamek napis {body2}",
    "Hod do kalendare schuzku {body} a jako ukol napis {body2}",
    "Uloz {body} a jeste mi najdi {q}"
  ],
  save_search_collision: [
    "Uloz {body} a jeste mi najdi {q}",
    "Jen mi ukaz {q} a pak uloz {body}",
    "Neukladej nic, jen mi rekni {q}",
    "Jen search {q}, nic nevytvarej"
  ],
  help_save_collision: [
    "Co umis a pak uloz {body}",
    "Jak fungujou ukoly?",
    "Co umis?"
  ],
  conversational_drift: [
    "A ted mi najdi {q}",
    "Co jsem mel minuly mesic {q}",
    "Jen mi to ukaz",
    "Neptam se na vytvoreni"
  ],
  followup_ownership_chaos: [
    "Ne, to druhe neukladej",
    "Jen to prvni",
    "To posledni smaz",
    "A jeste k tomu pridej poznamku"
  ],
  long_chain_command: [
    "Uloz {body} a jeste najdi {q} a pak mi rekni co umis",
    "Co mam zitra, uloz {body} a jeste najdi {q}"
  ],
  stale_draft_chaos: ["Nic neukladej", "Jen to neukladej", "Neukladej nic"],
  stale_retrieval_chaos: ["Jen hledam", "Jen search", "Jen mi ukaz"],
  real_user_chaos_routing: [
    "A jeste mi najdi {q}",
    "Jen poznamka, ne udalost",
    "Ne do kalendare, do ukolu {body}"
  ]
};

const FILLERS = ["", "Hele ", "No ", "Prosím ", "Krátce "];
const BODIES = ["servis v utery", "koupit mleko", "schuzku s novakem", "heslo od trezoru", "pojistku auta"];
const QUERIES = ["co mam zitra", "pojisteni", "kolem auta", "s pepou", "pristi tyden"];

function buildCorpusV1(targetCount) {
  const out = STATIC_REPLAY.slice();
  let n = out.length;
  const families = Object.keys(TEMPLATE_BANK);
  while (out.length < targetCount) {
    const family = families[n % families.length];
    const tpls = TEMPLATE_BANK[family];
    const tpl = tpls[n % tpls.length];
    const body = BODIES[n % BODIES.length];
    const q = QUERIES[n % QUERIES.length];
    const pfx = FILLERS[n % FILLERS.length];
    let input = tpl.replace("{body}", body).replace("{body2}", "strechu").replace("{q}", q);
    input = pfx + input;
    const entry = {
      id: "RUX_GEN_" + String(n).padStart(4, "0"),
      family: family,
      input: input
    };
    if (family === "wrong_collection_chaos") {
      if (/poznam|heslo|smlouv|pojist/.test(input.toLowerCase())) {
        entry.expect = "notes.create";
        entry.forbidCalendar = true;
      } else if (/ukol|koupit|servis/.test(input.toLowerCase())) {
        entry.expect = "tasks.create";
        entry.forbidCalendar = true;
        entry.forbidNote = true;
      }
    }
    if (family === "save_search_collision" || family === "mobile_multi_intent" || family === "long_chain_command") {
      entry.chain = [input];
    }
    if (family === "followup_ownership_chaos" || family === "stale_draft_chaos" || family === "stale_retrieval_chaos") {
      entry.chain = ["Ulož schůzku zítra v 15", "A ulož si ještě že servis je v úterý", input];
    }
    if (family === "conversational_drift" && /najdi|ukaz|minuly|neptam/.test(input.toLowerCase())) {
      entry.expectRead = true;
    }
    if (family === "help_save_collision" && /co umis|jak funguj/.test(input.toLowerCase()) && !/pak uloz/.test(input.toLowerCase())) {
      entry.expectRead = true;
    }
    out.push(entry);
    n++;
  }
  return out.slice(0, targetCount);
}

function filterFamily(cases, families) {
  const set = new Set(families);
  return cases.filter((c) => set.has(c.family));
}

function runChain(eng, steps, ctx, c) {
  const issues = [];
  const allowMidWrite = new Set([
    "followup_ownership_chaos",
    "stale_draft_chaos",
    "stale_retrieval_chaos",
    "conversational_drift",
    "save_search_collision"
  ]);
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
    if (!allowMidWrite.has(c.family) && !isLast && WRITE_INTENTS.has(intent)) {
      issues.push("mid_turn_write_leak:" + intent);
    }
    if (isLast) {
      if (c.expectRead && WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
      if (c.expectRead && last.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
      if (c.forbidHelpLeak && (intent === "assistant.help" || intent === "assistant.capability")) {
        const shell = helpGov.turnWouldLeakSaveShell(last, eng);
        for (let hi = 0; hi < shell.length; hi++) issues.push(shell[hi]);
      }
    }
  }
  return { issues: issues, lastTurn: last };
}

function evaluateCase(eng, c, ctx) {
  if (Array.isArray(c.chain) && c.chain.length > 1) {
    const r = runChain(eng, c.chain, ctx, c);
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
  if (c.expect === "notes.create") {
    const noteIssues = noteShared.evaluateNoteWrite(c, turn);
    for (let ni = 0; ni < noteIssues.length; ni++) issues.push(noteIssues[ni]);
  }
  if (c.expect && intent !== c.expect) {
    const readSibling = c.expect.replace(".create", ".read");
    if (
      !(
        c.allowClarification &&
        (intent === "clarification" || intent === "unknown" || intent === readSibling)
      )
    ) {
      issues.push("intent:" + intent);
    }
  }
  if (c.forbidCalendar && intent === "calendar.create") issues.push("calendar_leak");
  if (c.forbidNote && intent === "notes.create") issues.push("note_leak");
  if (c.forbidTask && intent === "tasks.create") issues.push("task_leak");
  if (c.expectRead) {
    if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
    if (turn.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
    if (!READ_INTENTS.has(intent) && intent !== "clarification" && intent !== "unknown") issues.push("not_read:" + intent);
  }
  if (c.expectWrite && !WRITE_INTENTS.has(intent) && intent !== "clarification") issues.push("missing_write:" + intent);
  if (c.forbidHelpLeak && (intent === "assistant.help" || intent === "assistant.capability")) {
    const shell = helpGov.turnWouldLeakSaveShell(turn, eng);
    for (let hi = 0; hi < shell.length; hi++) issues.push(shell[hi]);
  }
  if (c.expectRead && issues.length) {
    const onlyIntent = issues.length === 1 && issues[0].indexOf("intent:") === 0;
    if (onlyIntent && (intent === "clarification" || intent === "unknown")) {
      issues.length = 0;
    }
  }
  return { id: c.id, family: c.family, input: c.input, issues: issues, pass: issues.length === 0 };
}

function defaultCtx() {
  return {
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
        { id: "n2", title: "Pepa", content: "Pepa dluží 500", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }
      ];
    }
  };
}

function runAudit(guardId, cases, reportPath) {
  const eng = loadEngine();
  const ctx = defaultCtx();
  let pass = 0;
  const fails = [];
  for (let i = 0; i < cases.length; i++) {
    const r = evaluateCase(eng, cases[i], ctx);
    if (r.pass) pass++;
    else fails.push(r);
  }
  const report = {
    guard_id: guardId,
    pass: pass,
    fail: fails.length,
    total: cases.length,
    PASS_FAIL: fails.length === 0 ? "PASS" : "FAIL",
    first_fail: fails[0] || null
  };
  if (reportPath) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  }
  return { report: report, fails: fails };
}

function printHeader(name, report) {
  console.log("=== " + name.toUpperCase() + " ===");
  console.log("pass=" + report.pass + "/" + report.total);
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  if (report.first_fail) {
    console.log("first_fail_id=" + report.first_fail.id);
    console.log("first_fail_input=" + report.first_fail.input);
    console.log("first_fail_issues=" + (report.first_fail.issues || []).join(","));
  }
  console.log("=== END_" + name.toUpperCase() + " ===");
  return report.PASS_FAIL === "PASS";
}

module.exports = {
  buildCorpusV1,
  filterFamily,
  runAudit,
  printHeader,
  loadEngine,
  defaultCtx,
  STATIC_REPLAY
};
