#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPORT_PATH = path.join(__dirname, "silver-production-gap-fix-v1-report.json");
const FIXED_NOW = new Date("2026-05-29T12:00:00Z");

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function seedCtx() {
  const notes = [
    { id: "n_auto", title: "Auto", content: "auto mělo modrou barvu", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n_stul", title: "Stůl", content: "stůl má šířku 120 cm", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n_tomas", title: "Tomáš", content: "Tomáš má narozeniny v květnu", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n_wifi", title: "WiFi", content: "heslo k wifi je doma u routeru", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n_taska", title: "Taška", content: "Taška má červenou barvu", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
    { id: "n_botan", title: "Botanická zahrada", content: "adresa Botanické zahrady je Vinohradská 3 Praha", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }
  ];
  const tasks = [
    { id: "t1", title: "koupit mléko", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 },
    { id: "t2", title: "posekat trávu", status: "todo", dueAt: null, note: "", priority: "medium", createdAt: 1, updatedAt: 1 }
  ];
  return {
    now: FIXED_NOW,
    getEventsSnapshot: function () {
      return [];
    },
    getTasksSnapshot: function () {
      return tasks;
    },
    getNotesSnapshot: function () {
      return notes;
    }
  };
}

function turnMsg(turn) {
  return String((turn.readAnswer && turn.readAnswer.message) || turn.assistantLead || turn.userFacingSummary || "");
}

function asciiLeak(msg) {
  const m = String(msg || "");
  if (/\btomas\b/i.test(m) && !/Tomáš/i.test(m)) return "tomas_leak";
  if (/\bstul\b/i.test(m) && !/stůl/i.test(m)) return "stul_leak";
  if (/\bkveten\b/i.test(m) && !/květen/i.test(m)) return "kveten_leak";
  return null;
}

const GAP_A = {
  id: "GAP_A",
  anchor: "Co mám rozdělané",
  expectedIntent: "tasks.read",
  family: [
    "Co mám rozdělané",
    "Co mám rozpracované",
    "Co mám nedodělané",
    "Co ještě nemám hotové",
    "Co mám dokončit",
    "Co mi zbývá udělat",
    "Co mám splnit",
    "Jaké mám úkoly",
    "Co mám v úkolech"
  ]
};

const GAP_B = {
  id: "GAP_B",
  anchor: "Co jsem si poznamenal o autě",
  expectedIntent: "notes.read",
  expectNoteHit: true,
  family: [
    "Co jsem si poznamenal o autě",
    "Co mám poznamenané o autě",
    "Co mám poznamenané k autu",
    "Co jsem si uložil o autě",
    "Co mám uložené o autě",
    "Co vím o autě",
    "Co víš o autě",
    "Mám něco o autě",
    "Mám něco k autu",
    "Informace o autě",
    "Poznámky o autě",
    "Ohledně auta"
  ]
};

const GAP_C = {
  id: "GAP_C",
  anchor: "Jakou má stůl šířku",
  expectedIntent: "notes.read",
  expectDiacritics: true,
  family: [
    { input: "Jakou má stůl šířku", expectRx: /stůl/i },
    { input: "Kdy má Tomáš narozeniny", expectRx: /Tomáš|květen/i },
    { input: "Heslo k wifi", expectRx: /wifi|heslo/i },
    { input: "Barva tašky", expectRx: /taška|červen/i },
    { input: "Adresa Botanické zahrady", expectRx: /Botanick|Vinohradsk/i }
  ]
};

function evaluateTaskFamily(eng, ctx, gap) {
  const rows = [];
  for (let i = 0; i < gap.family.length; i++) {
    const input = gap.family[i];
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    const msg = turnMsg(turn);
    const pass = intent === gap.expectedIntent;
    rows.push({ input: input, expected: gap.expectedIntent, observed: intent, message: msg.slice(0, 160), pass: pass });
  }
  return rows;
}

function evaluateNoteRecallFamily(eng, ctx, gap) {
  const rows = [];
  for (let i = 0; i < gap.family.length; i++) {
    const input = gap.family[i];
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    const msg = turnMsg(turn);
    const pass =
      intent === gap.expectedIntent &&
      !/Nic jsem k tomu nena[sš]el/i.test(msg) &&
      /auto|modr/i.test(msg);
    rows.push({ input: input, expected: gap.expectedIntent, observed: intent, message: msg.slice(0, 160), pass: pass });
  }
  return rows;
}

function evaluateDiacriticsFamily(eng, ctx, gap) {
  const rows = [];
  for (let i = 0; i < gap.family.length; i++) {
    const item = gap.family[i];
    const input = item.input;
    const turn = eng.processUserTurn(input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    const msg = turnMsg(turn);
    const leak = asciiLeak(msg);
    const pass =
      intent === gap.expectedIntent &&
      !/Nic jsem k tomu nena[sš]el/i.test(msg) &&
      item.expectRx.test(msg) &&
      !leak;
    rows.push({
      input: input,
      expected: gap.expectedIntent,
      observed: intent,
      message: msg.slice(0, 160),
      ascii_leak: leak,
      pass: pass
    });
  }
  return rows;
}

function summarizeGap(id, anchor, rows) {
  const pass = rows.filter(function (r) {
    return r.pass;
  }).length;
  const anchorRow = rows.find(function (r) {
    return r.input === anchor;
  });
  return {
    gap_id: id,
    anchor: anchor,
    anchor_expected: anchorRow && anchorRow.expected,
    anchor_observed: anchorRow && anchorRow.observed,
    anchor_message: anchorRow && anchorRow.message,
    anchor_pass: !!(anchorRow && anchorRow.pass),
    family_total: rows.length,
    family_pass: pass,
    family_fail: rows.length - pass,
    rows: rows
  };
}

function main() {
  const eng = loadEngine();
  const ctx = seedCtx();

  const gapA = evaluateTaskFamily(eng, ctx, GAP_A);
  const gapB = evaluateNoteRecallFamily(eng, ctx, GAP_B);
  const gapC = evaluateDiacriticsFamily(eng, ctx, GAP_C);

  const report = {
    guard_id: "silver_production_gap_fix_v1_diagnostic",
    generated_at: new Date().toISOString(),
    GAP_A: summarizeGap("GAP_A", GAP_A.anchor, gapA),
    GAP_B: summarizeGap("GAP_B", GAP_B.anchor, gapB),
    GAP_C: summarizeGap("GAP_C", GAP_C.anchor, gapC),
    root_causes: {
      GAP_A: "co mam + in-progress cue (rozdělané) classified as notes topic_list before task read steal",
      GAP_B: "relevance contract qSearch joined recall cue poznamenal with entity auto, filtering out note hits",
      GAP_C: "exact_answer builder used folded entityToken label (stul/tomas/kveten) instead of original note title/body span"
    },
    PASS_FAIL:
      gapA.every(function (r) {
        return r.pass;
      }) &&
      gapB.every(function (r) {
        return r.pass;
      }) &&
      gapC.every(function (r) {
        return r.pass;
      })
        ? "PASS"
        : "FAIL"
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

  console.log("=== SILVER_PRODUCTION_GAP_FIX_V1_DIAGNOSTIC ===");
  console.log("GAP_A_ANCHOR=" + report.GAP_A.anchor);
  console.log("GAP_A_OBSERVED=" + report.GAP_A.anchor_observed);
  console.log("GAP_A_PASS=" + (report.GAP_A.anchor_pass ? "YES" : "NO"));
  console.log("GAP_A_FAMILY=" + report.GAP_A.family_pass + "/" + report.GAP_A.family_total);
  console.log("GAP_B_ANCHOR=" + report.GAP_B.anchor);
  console.log("GAP_B_OBSERVED=" + report.GAP_B.anchor_observed);
  console.log("GAP_B_PASS=" + (report.GAP_B.anchor_pass ? "YES" : "NO"));
  console.log("GAP_B_FAMILY=" + report.GAP_B.family_pass + "/" + report.GAP_B.family_total);
  console.log("GAP_C_ANCHOR=" + report.GAP_C.anchor);
  console.log("GAP_C_OBSERVED=" + report.GAP_C.anchor_observed);
  console.log("GAP_C_PASS=" + (report.GAP_C.anchor_pass ? "YES" : "NO"));
  console.log("GAP_C_FAMILY=" + report.GAP_C.family_pass + "/" + report.GAP_C.family_total);
  console.log("report_path=" + REPORT_PATH);
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END_SILVER_PRODUCTION_GAP_FIX_V1_DIAGNOSTIC ===");

  process.exit(report.PASS_FAIL === "PASS" ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  seedCtx,
  GAP_A,
  GAP_B,
  GAP_C,
  foldCs,
  asciiLeak,
  turnMsg,
  evaluateTaskFamily,
  evaluateNoteRecallFamily,
  evaluateDiacriticsFamily
};
