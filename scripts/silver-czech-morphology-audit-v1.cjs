#!/usr/bin/env node
"use strict";

const path = require("path");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");

const PAIRS = [
  ["doktor", "doktorovi"],
  ["doktor", "doktora"],
  ["doktor", "doktorem"],
  ["schuzka", "schuzce"],
  ["schuzka", "schuzku"],
  ["servis", "servisu"],
  ["servis", "servisem"],
  ["ukol", "ukolu"],
  ["ukol", "ukolem"],
  ["poznamka", "poznamce"],
  ["poznamka", "poznamku"],
  ["kuba", "kubovi"],
  ["kuba", "kubou"],
  ["zaloha", "zalohy"],
  ["novak", "novaka"],
  ["novak", "novakovi"],
  ["telefon", "telefonu"],
  ["banka", "bance"],
  ["faktura", "faktury"],
  ["projekt", "projektu"],
  ["lekarna", "lekarny"],
  ["revize", "revizi"],
  ["pojistovna", "pojistovne"],
  ["technik", "technika"],
  ["manazer", "manazera"],
  ["kolega", "kolegovi"],
  ["zakaznik", "zakaznika"],
  ["servisak", "servisaka"]
];

const QUERY_VERBS = ["najdi", "ukaz", "kde je", "hledej", "co je v", "vyhledej"];
const QUERY_MODULES = ["note_query", "calendar_query", "task_query"];

const TIME_PHRASES = [
  { input: "mel jsem schuzku s doktorem", aspect: "past", need: ["doktor"] },
  { input: "mam schuzku s doktorem", aspect: "present", need: ["doktor"] },
  { input: "budu mit schuzku s doktorem", aspect: "future", need: ["doktor"] },
  { input: "co jsem resil vcera", aspect: "past", need: [] },
  { input: "co resim dnes", aspect: "present", need: [] },
  { input: "co budu resit zitra", aspect: "future", need: [] }
];

function buildCases() {
  const cases = [];
  let n = 0;
  const engLoader = harness.loadEngine;
  for (let i = 0; i < PAIRS.length; i++) {
    const canon = PAIRS[i][0];
    const variant = PAIRS[i][1];
    n++;
    cases.push({ id: "MOR_" + n, canon: canon, variant: variant, type: "norm_pair" });
  }
  for (let t = 0; t < TIME_PHRASES.length; t++) {
    n++;
    cases.push({ id: "TIM_" + n, phrase: TIME_PHRASES[t].input, aspect: TIME_PHRASES[t].aspect, type: "time_aspect" });
  }
  const fillers = ["", "hele ", "prosim ", "kratce ", "rekni "];
  for (let mi = 0; mi < QUERY_MODULES.length; mi++) {
    for (let pi = 0; pi < fillers.length; pi++) {
      for (let qi = 0; qi < QUERY_VERBS.length; qi++) {
        for (let i = 0; i < PAIRS.length; i++) {
          if (QUERY_VERBS[qi] === "co je v" && PAIRS[i][0] === "schuzka") continue;
          for (let vi = 1; vi < PAIRS[i].length; vi++) {
            n++;
            cases.push({
              id: "MORQ_" + n,
              input: fillers[pi] + QUERY_VERBS[qi] + " " + PAIRS[i][vi],
              type: "query_variant",
              module: QUERY_MODULES[mi],
              canon: PAIRS[i][0]
            });
          }
        }
      }
    }
  }
  return cases;
}

function runCase(eng, c) {
  const issues = [];
  if (c.type === "norm_pair") {
    const a = eng.iuSilverNormalizeForSearch(c.canon);
    const b = eng.iuSilverNormalizeForSearch(c.variant);
    if (a !== b) issues.push("norm_mismatch:" + c.canon + "|" + c.variant + "|" + a + "|" + b);
  } else if (c.type === "time_aspect" && eng.iuSilverCzechTemporalAspectTagV1) {
    const tag = eng.iuSilverCzechTemporalAspectTagV1(c.phrase);
    if (tag !== c.aspect) issues.push("aspect_expected_" + c.aspect + "_got_" + tag);
  } else if (c.type === "query_variant") {
    const mod = c.module || "note_query";
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), harness.ctxForCase(mod));
    const intent = String(turn.normalizedIntent || "");
    if (
      intent === "calendar.create" ||
      intent === "tasks.create" ||
      intent === "notes.create" ||
      turn.processingState === "READY_TO_SAVE"
    ) {
      issues.push("morph_query_created_write:" + intent);
    }
  }
  return { id: c.id, issues, pass: issues.length === 0 };
}

function main() {
  const eng = harness.loadEngine();
  const cases = buildCases();
  let pass = 0;
  const fails = [];
  for (let i = 0; i < cases.length; i++) {
    const r = runCase(eng, cases[i]);
    if (r.pass) pass++;
    else fails.push(r);
  }
  const total = cases.length;
  console.log("=== SILVER_CZECH_MORPHOLOGY_AUDIT_V1 ===");
  console.log("cases_total=" + total);
  console.log("pass_count=" + pass);
  console.log("fail_count=" + (total - pass));
  console.log("PASS_FAIL=" + (pass === total ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_CZECH_MORPHOLOGY_AUDIT_V1 ===");
  process.exit(pass === total ? 0 : 1);
}

if (require.main === module) main();

module.exports = { buildCases, PAIRS };
