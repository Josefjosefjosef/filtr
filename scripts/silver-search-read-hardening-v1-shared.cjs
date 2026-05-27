#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");
const aliasData = require("./silver-czech-person-alias-registry-v1-data.cjs");
const core = require("./rhc-v3-deterministic-core.cjs");

const REPO = path.resolve(__dirname, "..");
const FIXED_NOW = new Date("2026-05-04T12:00:00");
const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

function foldCs(s) {
  return aliasData.foldCs(s);
}

function moneySeedCtx() {
  return {
    now: FIXED_NOW,
    getEventsSnapshot: function () {
      return [];
    },
    getTasksSnapshot: function () {
      return [{ id: "t_zitra", title: "koupit mléko", status: "todo", dueAt: "2026-05-05", note: "", priority: "medium", createdAt: 1, updatedAt: 1 }];
    },
    getNotesSnapshot: function () {
      return [
        { id: "n_pepa_1", title: "Záloha Pepa 1", content: "Pepovi záloha 1000 Kč", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
        { id: "n_pepa_2", title: "Záloha Pepa 2", content: "Pepovi dal jsem 500 Kč zálohu", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
        { id: "n_franta_1", title: "Záloha Franta", content: "Frantovi záloha 500 Kč", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }
      ];
    }
  };
}

function defaultCtx() {
  return moneySeedCtx();
}

const CALENDAR_WRITE_NEGATED_TASK_REPLAY = [
  { id: "CWNT_001", input: "ulož do kalendáře, neukládej jako úkol", expect: "calendar.create" },
  { id: "CWNT_002", input: "přidej do kalendáře, ne do úkolů", expect: "calendar.create" },
  { id: "CWNT_003", input: "dej mi to do kalendáře a ne jako úkol", expect: "calendar.create" },
  { id: "CWNT_004", input: "zapiš schůzku do kalendáře, ne do úkolů", expect: "calendar.create" },
  { id: "CWNT_005", input: "vytvoř událost v kalendáři, ne úkol", expect: "calendar.create" },
  { id: "CWNT_006", input: "kalendář, ne úkol", expect: "calendar.create" },
  { id: "CWNT_007", input: "neukládej to jako úkol, dej to do kalendáře", expect: "calendar.create" },
  { id: "CWNT_008", input: "není to úkol, je to událost", expect: "calendar.create", allowClarification: true },
  { id: "CWNT_009", input: "není to připomínka, je to schůzka v kalendáři", expect: "calendar.create", allowClarification: true },
  {
    id: "CWNT_010",
    input: "nepleť to s kalendarem. Rodinný kontext: příští měsíc odpoledne mám u lékaře Tomasek, ulož do kalendáře, neukládej jako úkol.",
    expect: "calendar.create"
  }
];

const MONEY_PERSON_REPLAY = [
  { id: "MPR_001", input: "Kolik jsem dal zálohu Pepovi?", expectSum: 1500, expectRx: /1500/ },
  { id: "MPR_002", input: "Kolik jsem dal Pepovi na zálohách?", expectSum: 1500, expectRx: /1500/ },
  { id: "MPR_003", input: "Najdi mi v poznámkách kolik jsem dal Frantovi zálohu.", expectSum: 500, expectRx: /500/ },
  { id: "MPR_004", input: "Dal jsem nějaké zálohy Frantovi?", expectRx: /500|ano/i },
  { id: "MPR_005", input: "Dával jsem Pepovi nějakou zálohu?", expectRx: /1500|1000.*500|ano/i },
  { id: "MPR_006", input: "Kolik jsem dal celkem na zálohách Pepovi a Frantovi?", expectRx: /2000|Pepovi.*1500|Frantovi.*500|1500.*500/i }
];

const TASK_READ_NO_SAVE_REPLAY = [
  { id: "TRNS_001", input: "Mám na zítra nějaké úkoly?", forbidWrite: true, expectRead: true },
  { id: "TRNS_002", input: "Co mám na zítra v úkolech?", forbidWrite: true, expectRead: true },
  { id: "TRNS_003", input: "Podívej se jen do úkolů, jestli mám koupit uhlí do pátku", forbidWrite: true, expectRead: true }
];

const SEARCH_READ_NO_SAVE_REPLAY = [
  { id: "SRNS_001", input: "Najdi v poznámkách barvu auta", forbidWrite: true },
  { id: "SRNS_002", input: "Co mám zítra v kalendáři?", forbidWrite: true },
  { id: "SRNS_003", input: "Kolik jsem dal Pepovi na zálohách?", forbidWrite: true }
];

const CROSS_MODULE_TEMPLATES = {
  calendar: [
    "co mam zitra v kalendari",
    "kdy mam doktora",
    "najdi schuzku s petrem",
    "jen zjisti co mam v kalendari",
    "kolik mam tento tyden schuzek",
    "co mame pristi pondeli v kalendari ohledne pravnik",
    "nepleť to s poznámkou co mam zitra v kalendari",
    "bez poznamek co mam zitra",
    "implicitne co mam naplanovane na zitra",
    "jestli mam dnes neco v kalendari"
  ],
  task: [
    "co mam udelat dnes",
    "mam na zitra nejake ukoly",
    "najdi ukol rohliky",
    "kolik mam ukolu s deadlinem zitra",
    "jen do ukolu co mam splnit do patku",
    "co mam splnit do patku jen ukoly",
    "mam zavolat pavlovi v ukolech",
    "nepleť to s kalendarem co mam v ukolech",
    "podivej jen do ukolu",
    "kolik mam otevrenych ukolu"
  ],
  note: [
    "najdi v poznamkach barvu auta",
    "kde mam klice",
    "kolik jsem dal pepovi na zalohach",
    "co mam v poznamkach o mariane",
    "tu poznamku o tricku",
    "to co sem resil s kubou",
    "jestli sem daval pepovi zalohu",
    "najdi pin v poznamkach",
    "co jsem si poznamenal o aute",
    "hledam poznamku smlouva"
  ]
};

function buildCrossModuleCorpusV1() {
  const cases = [];
  const mods = ["calendar", "task", "note"];
  for (let mi = 0; mi < mods.length; mi++) {
    const mod = mods[mi];
    const tpls = CROSS_MODULE_TEMPLATES[mod];
    for (let i = 0; i < 1000; i++) {
      const base = tpls[i % tpls.length];
      const mask = core.deriveMutationMask(mod + "_search_read", i, 0x53525231);
      const rng = core.mulberry32(0x53525231 ^ i ^ mi);
      let input = core.applyMutationLayers(base, mask, rng);
      if (i % 4 === 0) input = "Hele " + input;
      if (i % 5 === 0) input = input + "?";
      cases.push({
        id: "XSRR_" + mod.toUpperCase() + "_" + String(i).padStart(4, "0"),
        module: mod,
        input: input,
        tier: i < 12 ? "A" : "B"
      });
    }
  }
  return cases;
}

function turnMsg(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
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

function evaluateCalendarWriteNegated(c, turn) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  if (intent !== "calendar.create") {
    if (!(c.allowClarification && intent === "clarification" && turn.processingState === "NEEDS_CLARIFICATION")) {
      issues.push("intent:" + intent);
    }
  }
  if (intent === "tasks.create" || intent === "tasks.read") issues.push("task_leak");
  if (turn.processingState === "STORAGE_DISAMBIGUATION") issues.push("storage_picker");
  return issues;
}

function evaluateMoneyPerson(c, turn) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
  if (intent.indexOf(".read") < 0 && turn.processingState !== "READ_OK") issues.push("not_read:" + intent);
  const msg = turnMsg(turn);
  if (c.expectRx && !c.expectRx.test(msg)) issues.push("message_miss:" + msg.slice(0, 120));
  if (c.expectSum && !new RegExp(String(c.expectSum)).test(msg.replace(/\s/g, ""))) issues.push("sum_miss");
  return issues;
}

function evaluateReadNoSave(c, turn) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
  if (turn.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
  if (turn.processingState === "STORAGE_DISAMBIGUATION") issues.push("storage_picker");
  if (c.expectRead && intent.indexOf(".read") < 0 && intent !== "global.search") issues.push("not_read:" + intent);
  if (c.forbidWrite && (WRITE_INTENTS.has(intent) || turn.draft && turn.draft.targetContainer && turn.draft.targetContainer !== "none")) {
    issues.push("draft_or_write");
  }
  return issues;
}

function evaluateCrossModuleSearchRead(c, turn) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
  if (turn.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
  if (turn.processingState === "STORAGE_DISAMBIGUATION") issues.push("storage_picker");
  if (c.module === "calendar" && intent === "tasks.create") issues.push("task_create_leak");
  if (c.module === "task" && intent === "calendar.create") issues.push("calendar_create_leak");
  if (c.module === "note" && (intent === "tasks.create" || intent === "calendar.create")) issues.push("wrong_create");
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
  moneySeedCtx,
  defaultCtx,
  loadEngine,
  CALENDAR_WRITE_NEGATED_TASK_REPLAY,
  MONEY_PERSON_REPLAY,
  TASK_READ_NO_SAVE_REPLAY,
  SEARCH_READ_NO_SAVE_REPLAY,
  buildCrossModuleCorpusV1,
  runReplayCases,
  evaluateCalendarWriteNegated,
  evaluateMoneyPerson,
  evaluateReadNoSave,
  evaluateCrossModuleSearchRead,
  printGuardHeader,
  foldCs
};
