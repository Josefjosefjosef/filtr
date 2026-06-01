#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-explicit-save-prefix-routing-diagnostic-report.json");
const FIXED_NOW = new Date("2026-06-01T12:00:00Z");

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function seedCtx() {
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

function savedContent(turn) {
  const d = turn && turn.draft ? turn.draft : {};
  if (String(d.silverNoteText || "").trim()) return String(d.silverNoteText || "").trim();
  if (String(d.title || "").trim()) return String(d.title || "").trim();
  if (String(d.note || "").trim()) return String(d.note || "").trim();
  return "";
}

function prefixLeaked(content, prefixTokens) {
  const c = foldCs(content);
  for (let i = 0; i < prefixTokens.length; i++) {
    if (c.indexOf(foldCs(prefixTokens[i])) >= 0) return prefixTokens[i];
  }
  return null;
}

function expectedClean(input, family) {
  const det = null;
  const eng = loadEngine();
  const d = eng.iuSilverDetectExplicitSavePrefixV1(input);
  if (d && d.cleanedInput) return d.cleanedInput;
  if (family === "calendar") return input.replace(/^do\s+kalend[aá]?[rř]?e?\s*:?\s*/iu, "").trim();
  if (family === "task") return input.replace(/^pripom\w*\s+(?:mi\s+)?/iu, "").trim();
  if (family === "note") return input.replace(/^do\s+pozn[aá]m\w*\s*:?\s*/iu, "").trim();
  return input;
}

const CALENDAR_FAMILY = [
  "Do kalendáře dnes v 16:30 vyzvednout Eli ve škole",
  "Do kalendáře zítra v 15 schůzka s Tomášem",
  "Do kalendáře koupit mléko zítra v 8",
  "Do kalendáře připomeň mi zubaře v pátek",
  "Do kalendáře poznámka že mám zavolat Petrovi"
];

const TASK_FAMILY = [
  "Připomeň mi zítra zaplatit nájem",
  "Připomeň mi dnes v 16:30 vyzvednout Eli ve škole",
  "Připomeň mi schůzka s Tomášem zítra v 15",
  "Připomeň koupit mléko",
  "Připomeň mi poznámka auto má modrou barvu"
];

const NOTE_FAMILY = [
  "Do poznámek heslo k wifi je 1234",
  "Do poznámky auto má modrou barvu",
  "Do poznámek zítra v 15 schůzka s Tomášem",
  "Do poznámek připomeň mi zaplatit nájem",
  "Do poznámky koupit mléko"
];

function evaluateFamily(eng, ctx, inputs, expectedRoute, family, leakTokens) {
  const rows = [];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
    const observedRoute = String(turn.normalizedIntent || "");
    const content = savedContent(turn);
    const leak = prefixLeaked(content, leakTokens);
    const det = eng.iuSilverDetectExplicitSavePrefixV1(input);
    const routePass = observedRoute === expectedRoute;
    const contentPass = !leak;
    const pass = routePass && contentPass;
    let rootCause = null;
    let failFamily = null;
    let regularRoutingInsteadOfPrefix = false;
    if (!routePass) {
      failFamily = family + "_route_mismatch";
      rootCause = "expected " + expectedRoute + " got " + observedRoute;
      regularRoutingInsteadOfPrefix = !!det && observedRoute !== expectedRoute;
    } else if (!contentPass) {
      failFamily = family + "_prefix_leak";
      rootCause = "prefix leaked into saved content: " + leak;
    }
    rows.push({
      input: input,
      family: family,
      expected_route: expectedRoute,
      observed_route: observedRoute,
      expected_cleaned_content: det ? det.cleanedInput : expectedClean(input, family),
      observed_saved_content: content,
      prefix_leaked: leak,
      fail_family: failFamily,
      root_cause: rootCause,
      regular_routing_instead_of_prefix_override: regularRoutingInsteadOfPrefix,
      pass: pass
    });
  }
  return rows;
}

function main() {
  const eng = loadEngine();
  const ctx = seedCtx();

  const calendarRows = evaluateFamily(eng, ctx, CALENDAR_FAMILY, "calendar.create", "calendar", ["Do kalendáře", "do kalendare"]);
  const taskRows = evaluateFamily(eng, ctx, TASK_FAMILY, "tasks.create", "task", ["Připomeň mi", "Připomeň", "pripomen mi", "pripomen"]);
  const noteRows = evaluateFamily(eng, ctx, NOTE_FAMILY, "notes.create", "note", ["Do poznámek", "Do poznámky", "do poznamek", "do poznamky"]);

  const allRows = calendarRows.concat(taskRows).concat(noteRows);
  const passCount = allRows.filter(function (r) {
    return r.pass;
  }).length;
  const ok = passCount === allRows.length;

  const report = {
    diagnostic_id: "silver_explicit_save_prefix_routing_diagnostic",
    calendar_family: calendarRows,
    task_family: taskRows,
    note_family: noteRows,
    pass_count: passCount,
    total: allRows.length,
    PASS_FAIL: ok ? "PASS" : "FAIL"
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_EXPLICIT_SAVE_PREFIX_ROUTING_DIAGNOSTIC ===");
  console.log("CALENDAR_PASS=" + calendarRows.filter(function (r) { return r.pass; }).length + "/" + calendarRows.length);
  console.log("TASK_PASS=" + taskRows.filter(function (r) { return r.pass; }).length + "/" + taskRows.length);
  console.log("NOTE_PASS=" + noteRows.filter(function (r) { return r.pass; }).length + "/" + noteRows.length);
  console.log("report_path=" + REPORT_PATH);
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END_SILVER_EXPLICIT_SAVE_PREFIX_ROUTING_DIAGNOSTIC ===");

  if (!ok) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  CALENDAR_FAMILY: CALENDAR_FAMILY,
  TASK_FAMILY: TASK_FAMILY,
  NOTE_FAMILY: NOTE_FAMILY,
  seedCtx: seedCtx,
  savedContent: savedContent,
  prefixLeaked: prefixLeaked,
  evaluateFamily: evaluateFamily
};
