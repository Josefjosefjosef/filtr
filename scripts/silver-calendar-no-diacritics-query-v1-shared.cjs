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

const TEMPORALS = ["zitra", "dnes", "v pondeli", "za tyden", "pristi tyden", "v patek", "vcera"];
const TEMPORALS_DIA = ["zítra", "dnes", "v pondělí", "za týden", "příští týden", "v pátek", "včera"];

const FAMILY_A = [
  "podivej se do kalendare co mam {t}",
  "podivejte se do kalendare co mam {t}",
  "podivej se do kalendare co mame {t}"
];
const FAMILY_B = [
  "co mam {t} v kalendari",
  "co mame {t} v kalendari",
  "co mam {t} v kalendare"
];
const FAMILY_C = [
  "mam neco {t} v kalendari",
  "mam neco {t} v kalendare",
  "mam nejake schuzky {t} v kalendari"
];
const FAMILY_D = [
  "ukaz kalendar na {t}",
  "ukaz muj kalendar na {t}",
  "zobraz kalendar na {t}",
  "otevri kalendar a ukaz {t}"
];

const CHAOS_PREFIX = ["", "hele ", "no ", "prosim ", "vlastne ", "kratce "];
const CHAOS_PREFIX_FAMILY_C = ["", "hele ", "prosim ", "vlastne ", "kratce "];
const CHAOS_SUFFIX = ["", ".", "?", " prosim", " diky"];

function stripDiak(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function foldCs(s) {
  return stripDiak(String(s || "").toLowerCase());
}

function mutateCase(s, n) {
  if (n % 5 === 1) return s.toUpperCase();
  if (n % 5 === 2) return s.toLowerCase();
  if (n % 5 === 3) return s.replace(/\b\w/g, (c) => c.toUpperCase());
  return s;
}

function mutatePunct(s, n) {
  if (n % 4 === 1) return s.replace(/[.,!?]/g, "");
  if (n % 4 === 2) return s.replace(/\s+/g, "  ");
  return s;
}

function fillTpl(tpl, t, n) {
  return tpl.replace(/\{t\}/g, t);
}

function buildPositiveFamilies(targetCount) {
  const out = [];
  const banks = [
    { family: "family_a", tpls: FAMILY_A },
    { family: "family_b", tpls: FAMILY_B },
    { family: "family_c", tpls: FAMILY_C },
    { family: "family_d", tpls: FAMILY_D }
  ];
  let n = 0;
  while (out.length < targetCount) {
    const bank = banks[n % banks.length];
    const tpl = bank.tpls[n % bank.tpls.length];
    const t = TEMPORALS[n % TEMPORALS.length];
    const tDia = TEMPORALS_DIA[n % TEMPORALS_DIA.length];
    const useDiak = n % 7 === 0;
    const base = fillTpl(tpl, useDiak ? tDia : t, n);
    const prefList = bank.family === "family_c" ? CHAOS_PREFIX_FAMILY_C : CHAOS_PREFIX;
    const pref = prefList[n % prefList.length];
    const suf = CHAOS_SUFFIX[n % CHAOS_SUFFIX.length];
    let input = pref + base + suf;
    if (n % 11 !== 0) input = stripDiak(input);
    if (n % 13 !== 0) input = mutatePunct(input, n);
    else input = input.replace(/\s+/g, " ").trim();
    if (bank.family !== "family_c" || n % 9 !== 0) input = mutateCase(input, n);
    out.push({
      id: "NDQ_POS_" + String(out.length).padStart(5, "0"),
      family: bank.family,
      input: input,
      expect: "calendar.read",
      tier: n % 17 === 0 ? "A" : "B",
      metamorphic_key: bank.family + ":" + t
    });
    n++;
  }
  return out;
}

function buildConflictFamilies(count) {
  const out = [];
  const seeds = [
    "podivej se do kalendare co mam zitra, ne v kalendari.",
    "Podívej se do kalendáře co mám zítra, ne v kalendáři.",
    "Co mám zítra v kalendáři, ale ne v kalendáři?",
    "co mam zitra v kalendari ale ne v kalendari",
    "BEZ DIAKRITIKY: podivej se do kalendare co mam zitra, ne v kalendari."
  ];
  for (let i = 0; i < count; i++) {
    let input = seeds[i % seeds.length];
    if (i % 3 === 1) input = stripDiak(input);
    if (i % 3 === 2) input = mutateCase(input, i);
    out.push({
      id: "NDQ_CON_" + String(i).padStart(5, "0"),
      family: "conflict_ne_v_kalendari",
      input: input,
      expect: "unknown",
      tier: "A"
    });
  }
  return out;
}

function buildCorpusV1(targetCount) {
  const positive = buildPositiveFamilies(Math.max(4500, targetCount - 500));
  const conflict = buildConflictFamilies(Math.max(500, targetCount - positive.length));
  return positive.concat(conflict).slice(0, targetCount);
}

function seedCtx() {
  return {
    now: new Date("2026-05-04T12:00:00"),
    getEventsSnapshot: function () {
      return [
        { id: "e1", title: "Schůzka s Pepou", startAt: "2026-05-05T10:00:00", endAt: "2026-05-05T11:00:00" },
        { id: "e2", title: "Schůzka s právníkem", startAt: "2026-05-04T15:00:00", endAt: "2026-05-04T16:00:00" }
      ];
    },
    getTasksSnapshot: function () {
      return [];
    },
    getNotesSnapshot: function () {
      return [];
    }
  };
}

function intentOk(expect, actual) {
  const e = String(expect || "");
  const a = String(actual || "");
  if (!e) return true;
  if (e === a) return true;
  if (e === "calendar.read" && (a === "calendar.query" || a === "calendar.read" || a === "global.search")) return true;
  if (e === "unknown" && (a === "unknown" || a === "clarification")) return true;
  return false;
}

function evaluateTurn(turn, c) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
  if (turn.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
  if (c.expect === "calendar.read" && (intent === "tasks.read" || intent === "notes.read")) {
    issues.push("module_leak:" + intent);
  }
  if (c.expect === "unknown" && intent === "calendar.read") issues.push("should_be_unknown");
  if (c.expect && !intentOk(c.expect, intent)) {
    issues.push("intent_mismatch:" + intent + "!=expected:" + c.expect);
  }
  return issues;
}

function runAudit(harnessId, cases, reportPath) {
  const eng = loadEngine();
  const ctx = seedCtx();
  let pass = 0;
  const fails = [];
  const familyStats = {};
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const issues = evaluateTurn(turn, c);
    if (!issues.length) {
      pass++;
      continue;
    }
    const fam = c.family || "unknown";
    familyStats[fam] = familyStats[fam] || { pass: 0, fail: 0 };
    familyStats[fam].fail++;
    if (fails.length < 200) {
      fails.push({
        id: c.id,
        family: fam,
        input: c.input,
        expected: c.expect,
        actual: turn.normalizedIntent,
        issues: issues
      });
    }
  }
  for (let i = 0; i < cases.length; i++) {
    const fam = cases[i].family || "unknown";
    if (!familyStats[fam]) familyStats[fam] = { pass: 0, fail: 0 };
  }
  const report = {
    harness_id: harnessId,
    total_cases: cases.length,
    pass: pass,
    fail: cases.length - pass,
    accuracy: cases.length ? ((pass / cases.length) * 100).toFixed(2) : "0.00",
    family_stats: familyStats,
    sample_fails: fails.slice(0, 40),
    PASS_FAIL: pass === cases.length ? "PASS" : "FAIL"
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

function printGuardHeader(harnessId, report, minPct) {
  const acc = parseFloat(report.accuracy);
  const ok = report.PASS_FAIL === "PASS" && acc >= (minPct || 98);
  console.log("=== SILVER_CALENDAR_NO_DIACRITICS_QUERY_GUARD_V1 ===");
  console.log("harness_id=" + harnessId);
  console.log("total_cases=" + report.total_cases);
  console.log("pass=" + report.pass + "/" + report.total_cases);
  console.log("accuracy=" + report.accuracy + "%");
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_CALENDAR_NO_DIACRITICS_QUERY_GUARD_V1 ===");
  return ok;
}

module.exports = {
  buildCorpusV1,
  buildConflictFamilies,
  buildPositiveFamilies,
  runAudit,
  printGuardHeader,
  foldCs,
  stripDiak
};
