#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");
const temporal = require("./silver-temporal-task-query-routing-v1-shared.cjs");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const TEMPORALS = ["dnes", "zitra", "v pondeli", "v patek", "pristi tyden"];
const TEMPORALS_DIA = ["dnes", "zítra", "v pondělí", "v pátek", "příští týden"];
const CAL_NEG = [
  "ne v kalendari",
  "ne do kalendare",
  "nevracej schuzku",
  "nevytvarej udalost",
  "neplet to s kalendarem"
];
const TOPICS = ["dedovi", "deda", "kytce", "kytku", "najmu", "najem"];
const PREFIX = ["", "Hele ", "Prosím ", "Bez diakritiky: "];
const SUFFIX = ["", ".", "?", " prosím"];

function stripDiak(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function foldCs(s) {
  return stripDiak(String(s || "").toLowerCase());
}

function intentMatches(expect, actual) {
  const e = String(expect || "");
  const a = String(actual || "");
  if (e === a) return true;
  if (e === "tasks.read" && (a === "tasks.query" || a === "global.search")) return true;
  if (e === "calendar.read" && a === "calendar.query") return true;
  if (e === "notes.read" && a === "notes.query") return true;
  if (e === "clarification" && (a === "clarification" || a === "unknown")) return true;
  if (e === "unknown" && (a === "unknown" || a === "clarification")) return true;
  return false;
}

function buildFamilyA(count) {
  const tpls = [
    "podivej jen do ukolu co mam na {t}",
    "podivej se jen do ukolu co mam na {t}",
    "co mam na {t} za ukoly",
    "mam nejake ukoly na {t}",
    "co mam {t} za ukoly"
  ];
  const out = [];
  for (let i = 0; i < count; i++) {
    const tpl = tpls[i % tpls.length];
    const t = TEMPORALS[i % TEMPORALS.length];
    const useDiak = i % 9 === 0;
    const tFill = useDiak ? TEMPORALS_DIA[i % TEMPORALS_DIA.length] : t;
    let input = PREFIX[i % PREFIX.length] + tpl.replace(/\{t\}/g, tFill) + SUFFIX[i % SUFFIX.length];
    if (i % 4 !== 0) input = stripDiak(input);
    out.push({
      id: "TQHGA_" + String(out.length).padStart(5, "0"),
      family: "no_diacritics_task_read",
      input: input,
      expect: "tasks.read",
      tier: i % 23 === 0 ? "A" : "B"
    });
  }
  return out;
}

function buildFamilyB(count) {
  const tpls = [
    "Podivej se jen do ukolu, jestli mam koupit uhli do patku, {neg}",
    "Pravnik v ukolech vs kalendar: jen ukoly, {neg}",
    "Co mam splnit do patku, jen ukoly, {neg}",
    "Najdi ukol rohliky, {neg}, nevracej schuzku",
    "Podivej se jen do ukolu co mam na dnes, {neg}"
  ];
  const negs = [
    "neplet to s poznamkou",
    "nevracej schuzku",
    "nevytvarej udalost",
    "neplet to s kalendarem",
    "nic neukladej"
  ];
  const out = [];
  for (let i = 0; i < count; i++) {
    const tpl = tpls[i % tpls.length];
    const neg = negs[i % negs.length];
    let input = PREFIX[i % PREFIX.length] + tpl.replace(/\{neg\}/g, neg) + SUFFIX[i % SUFFIX.length];
    if (i % 3 !== 0) input = stripDiak(input);
    const f = foldCs(input);
    const conflict =
      /\b(podivej|zjist)\w*\s+jen\s+do\s+ukol/.test(f) &&
      /\bco\s+m(am|ame)\b/.test(f) &&
      (/\bne\s+v\s+kalend/.test(f) || /\bne\s+do\s+kalend/.test(f));
    out.push({
      id: "TQHGB_" + String(out.length).padStart(5, "0"),
      family: "task_only_not_calendar",
      input: input,
      expect: conflict ? "unknown" : "tasks.read",
      tier: conflict ? "A" : "B"
    });
  }
  return out;
}

function buildFamilyC(count) {
  const tpls = [
    "Co mam s {topic}?",
    "Co mam poslat {topic}?",
    "Najdi mi ukol k {topic}",
    "Podivej se jen do ukolu, jestli mam neco o {topic}",
    "Jaky ukol mam k {topic}?"
  ];
  const topics = ["pravnikem", "Pepovi", "uctni", "auta", " fakture"];
  const out = [];
  for (let i = 0; i < count; i++) {
    const tpl = tpls[i % tpls.length];
    const topic = topics[i % topics.length].trim();
    let input = PREFIX[i % PREFIX.length] + tpl.replace(/\{topic\}/g, topic) + SUFFIX[i % SUFFIX.length];
    if (i % 5 !== 0) input = stripDiak(input);
    out.push({
      id: "TQHGC_" + String(out.length).padStart(5, "0"),
      family: "topic_task_query",
      input: input,
      expect: "tasks.read",
      tier: i % 19 === 0 ? "A" : "B"
    });
  }
  return out;
}

function buildFamilyD(count) {
  const tpls = [
    "kdy mam koupit {topic}",
    "do kdy mam zaplatit {topic}",
    "kdy mam zavolat {topic}",
    "Podivej se jen do ukolu, jestli mam koupit {topic} do patku",
    "Co mam splnit do patku, jen ukoly"
  ];
  const topics = ["uhli", "najem", "rohliky", "Pavlovi"];
  const out = [];
  for (let i = 0; i < count; i++) {
    const tpl = tpls[i % tpls.length];
    const topic = topics[i % topics.length];
    let input = PREFIX[i % PREFIX.length] + tpl.replace(/\{topic\}/g, topic) + SUFFIX[i % SUFFIX.length];
    if (i % 4 !== 0) input = stripDiak(input);
    out.push({
      id: "TQHGD_" + String(out.length).padStart(5, "0"),
      family: "due_date_task_query",
      input: input,
      expect: "tasks.read",
      tier: i % 17 === 0 ? "A" : "B"
    });
  }
  return out;
}

function buildReplayAnchor(count) {
  const seeds = [
    {
      id: "TQH_REP_001",
      family: "no_diacritics_task_read",
      input: "Bez diakritiky: podivej jen do ukolu co mam na dnes, ne v kalendari.",
      expect: "unknown",
      tier: "A"
    },
    {
      id: "TQH_REP_002",
      family: "no_diacritics_task_read",
      input: "Bez diakritiky: podivej jen do ukolu co mam na dnes, ne do kalendare.",
      expect: "unknown",
      tier: "A"
    },
    {
      id: "TQH_REP_003",
      family: "no_diacritics_task_read",
      input: "Bez diakritiky: podivej jen do ukolu co mam na dnes, nevracej schuzku.",
      expect: "tasks.read",
      tier: "A"
    },
    {
      id: "TQH_REP_004",
      family: "no_diacritics_task_read",
      input: "Bez diakritiky: podivej jen do ukolu co mam na dnes, nevytvarej udalost.",
      expect: "tasks.read",
      tier: "A"
    },
    {
      id: "TQH_REP_005",
      family: "no_diacritics_task_read",
      input: "Bez diakritiky: podivej jen do ukolu co mam na dnes, neplet to s kalendarem.",
      expect: "tasks.read",
      tier: "A"
    }
  ];
  const out = seeds.slice();
  for (let i = seeds.length; i < count; i++) {
    const s = seeds[i % seeds.length];
    out.push({
      id: "TQH_REP_" + String(i).padStart(3, "0"),
      family: s.family,
      input: s.input,
      expect: s.expect,
      tier: "A"
    });
  }
  return out;
}

function buildCorpusV1(targetCount) {
  const perFamily = Math.ceil((targetCount - 50) / 4);
  const replay = buildReplayAnchor(50);
  const a = buildFamilyA(perFamily);
  const b = buildFamilyB(perFamily);
  const c = buildFamilyC(perFamily);
  const d = buildFamilyD(perFamily);
  return replay.concat(a, b, c, d).slice(0, targetCount);
}

function evaluateTurn(turn, c) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  const tierB = c.tier === "B";
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
  if (turn.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
  if (turn.processingState === "STORAGE_DISAMBIGUATION") issues.push("storage_picker");
  if (intent.indexOf("calendar") >= 0 && c.expect !== "calendar.read") issues.push("calendar_steal");
  if ((intent.indexOf("note") >= 0 || intent === "notes.read") && c.expect === "tasks.read") issues.push("note_steal");
  if (tierB) return issues;
  if (c.expect && !intentMatches(c.expect, intent)) {
    issues.push("intent_mismatch:" + intent + "!=expected:" + c.expect);
  }
  return issues;
}

function evaluateCase(eng, c, ctx) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const issues = evaluateTurn(turn, c);
  return { id: c.id, family: c.family, input: c.input, issues: issues, pass: issues.length === 0 };
}

function runAudit(guardId, cases, reportPath, extra) {
  const eng = loadEngine();
  const ctx = temporal.seedCtx();
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
  const need = minPct != null ? minPct : 99;
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
  buildCorpusV1,
  runAudit,
  printHeader,
  evaluateCase,
  foldCs
};
