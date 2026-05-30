#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");
const audit = require("./audit_silver_20000_routing_stable.cjs");

const PROD_SEED_NOTES = [
  { id: "nr_tomas_bday", title: "Tom narozeniny", content: "Tomáš má narozeniny v květnu" },
  { id: "nr_auto_servis", title: "Auto servis", content: "Oktavka servis STK 3500 Kč" },
  { id: "nr_stul_width", title: "Stůl šířka", content: "Stůl má šířku 2 m" },
  { id: "nr_wifi_pass", title: "Wifi heslo", content: "heslo na wifi je ModraSIT2024" }
];

const REPO = path.resolve(__dirname, "..");
const FIXED_NOW = new Date("2026-05-29T12:00:00Z");

const TASK_QUERIES = [
  "Jaké mám úkoly",
  "Co mám v úkolech",
  "Vypiš moje úkoly",
  "Co mám splnit",
  "Co mám rozdělané"
];

const CALENDAR_QUERIES = [
  "Kdy mám zubaře",
  "Kdy mám pediatra",
  "Kdy mám právníka",
  "Kdy mám schůzku"
];

const NOTES_QUERIES = [
  "Co mám o autě",
  "Co jsem si poznamenal o autě",
  "Mám něco o autě",
  "Co víš o autě"
];

const DIACRITICS_QUERIES = [
  "Kdy má Tomáš narozeniny",
  "Jakou má stůl šířku",
  "Heslo k wifi"
];

const ASCII_LEAK_RX = /\b(tomas|stul|kveten|brezen|rijen)\b/i;
const DIACRITICS_NEED_RX = /\b(Tomáš|Tomáš|stůl|květen|březen|říjen)\b/;

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function buildProductionCtx() {
  const t0 = FIXED_NOW.getTime();
  const notes = PROD_SEED_NOTES.map(function (row, i) {
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
  const calNow = audit.FIXED_NOW || new Date("2026-05-04T12:00:00");
  const ctxQ = audit.ctxQuery();
  const seedEvents = ctxQ.getEventsSnapshot();
  const zitra = seedEvents.length && seedEvents[0].date ? seedEvents[0].date : "2026-05-05";
  const events = seedEvents.slice();
  events.push({
    id: "e_pediatr_prod",
    date: zitra,
    time: "11:00",
    title: "Pediatr",
    address: "Ordinace",
    note: "kontrola"
  });
  return {
    now: calNow,
    getEventsSnapshot: function () {
      return events;
    },
    getTasksSnapshot: function () {
      return ctxQ.getTasksSnapshot();
    },
    getNotesSnapshot: function () {
      return notes;
    }
  };
}

function turnMessage(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
}

function hasNormalizedTextLeak(msg) {
  const m = String(msg || "");
  if (!m) return false;
  if (!ASCII_LEAK_RX.test(m)) return false;
  if (DIACRITICS_NEED_RX.test(m)) return false;
  return true;
}

function evaluateQuery(eng, ctx, input, expectIntent) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
  const msg = turnMessage(turn);
  const intent = String(turn.normalizedIntent || "");
  const issues = [];
  if (intent !== expectIntent) {
    issues.push("intent=" + intent + " expected=" + expectIntent);
  }
  if (/Nic jsem k tomu nena[sš]el/i.test(msg)) {
    issues.push("not_found");
  }
  if (hasNormalizedTextLeak(msg)) {
    issues.push("normalized_text_leak");
  }
  if (expectIntent === "notes.read" && intent === "tasks.read") {
    issues.push("routing_regression_task");
  }
  if (expectIntent === "tasks.read" && intent === "notes.read") {
    issues.push("routing_regression_notes");
  }
  if (expectIntent === "calendar.read" && intent === "notes.read") {
    issues.push("routing_regression_notes");
  }
  return { input: input, intent: intent, msg: msg, pass: issues.length === 0, issues: issues };
}

function readProductionAppJsMeta() {
  let mainHash = "unknown";
  try {
    const { execSync } = require("child_process");
    mainHash = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e) {
    void e;
  }
  let productionCurrent = "local_engine";
  try {
    const appPath = path.join(REPO, "assets", "app.js");
    const st = fs.statSync(appPath);
    productionCurrent = "mtime_" + String(st.mtimeMs || 0);
  } catch (e2) {
    void e2;
  }
  return { currentMain: mainHash, productionAppJsCommit: productionCurrent };
}

function runProductionRealityRegression() {
  const eng = loadEngine();
  const ctxTasks = buildProductionCtx();
  const ctxCal = buildProductionCtx();
  const meta = readProductionAppJsMeta();

  let routingRegression = 0;
  let normalizedLeak = 0;
  let notFoundWrong = 0;

  const taskResults = TASK_QUERIES.map(function (q) {
    const r = evaluateQuery(eng, ctxTasks, q, "tasks.read");
    if (!r.pass) {
      if (r.issues.some(function (x) {
        return x.indexOf("routing_regression") >= 0;
      })) {
        routingRegression++;
      }
      if (r.issues.indexOf("not_found") >= 0) notFoundWrong++;
      if (r.issues.indexOf("normalized_text_leak") >= 0) normalizedLeak++;
    }
    return r;
  });

  const calResults = CALENDAR_QUERIES.map(function (q) {
    const r = evaluateQuery(eng, ctxCal, q, "calendar.read");
    if (!r.pass) {
      if (r.issues.some(function (x) {
        return x.indexOf("routing_regression") >= 0;
      })) {
        routingRegression++;
      }
      if (r.issues.indexOf("not_found") >= 0) notFoundWrong++;
      if (r.issues.indexOf("normalized_text_leak") >= 0) normalizedLeak++;
    }
    return r;
  });

  const noteResults = NOTES_QUERIES.map(function (q) {
    const r = evaluateQuery(eng, ctxCal, q, "notes.read");
    if (!r.pass) {
      if (r.issues.some(function (x) {
        return x.indexOf("routing_regression") >= 0;
      })) {
        routingRegression++;
      }
      if (r.issues.indexOf("not_found") >= 0) notFoundWrong++;
      if (r.issues.indexOf("normalized_text_leak") >= 0) normalizedLeak++;
    }
    return r;
  });

  const diaResults = DIACRITICS_QUERIES.map(function (q) {
    const r = evaluateQuery(eng, ctxCal, q, "notes.read");
    const msg = r.msg;
    const leak = hasNormalizedTextLeak(msg);
    const diaPass =
      !leak &&
      !/Nic jsem k tomu nena[sš]el/i.test(msg) &&
      (q.indexOf("Tomáš") >= 0 ? /Tomáš|květen/i.test(msg) : true) &&
      (q.indexOf("stůl") >= 0 ? /stůl|šířku/i.test(msg) : true);
    if (!diaPass) {
      if (leak) normalizedLeak++;
      if (/Nic jsem k tomu nena[sš]el/i.test(msg)) notFoundWrong++;
    }
    return { input: q, pass: diaPass, msg: msg, intent: r.intent, issues: diaPass ? [] : ["diacritics_or_empty"] };
  });

  const taskPass = taskResults.every(function (r) {
    return r.pass;
  });
  const calPass = calResults.every(function (r) {
    return r.pass;
  });
  const notesPass = noteResults.every(function (r) {
    return r.pass;
  });
  const diaPass = diaResults.every(function (r) {
    return r.pass;
  });
  const originalPass = normalizedLeak === 0;

  return {
    meta: meta,
    taskResults: taskResults,
    calResults: calResults,
    noteResults: noteResults,
    diaResults: diaResults,
    task_query_pass: taskPass,
    calendar_query_pass: calPass,
    notes_query_pass: notesPass,
    diacritics_pass: diaPass,
    original_text_preservation_pass: originalPass,
    routing_regression_count: routingRegression,
    normalized_text_leak_count: normalizedLeak,
    not_found_wrong_count: notFoundWrong,
    all_pass: taskPass && calPass && notesPass && diaPass && originalPass && routingRegression === 0
  };
}

module.exports = {
  TASK_QUERIES: TASK_QUERIES,
  CALENDAR_QUERIES: CALENDAR_QUERIES,
  NOTES_QUERIES: NOTES_QUERIES,
  DIACRITICS_QUERIES: DIACRITICS_QUERIES,
  buildProductionCtx: buildProductionCtx,
  evaluateQuery: evaluateQuery,
  hasNormalizedTextLeak: hasNormalizedTextLeak,
  runProductionRealityRegression: runProductionRealityRegression
};
