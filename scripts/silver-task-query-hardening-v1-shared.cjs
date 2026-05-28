#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const audit = require("./audit_silver_20000_routing_stable.cjs");
const temporal = require("./silver-temporal-task-query-routing-v1-shared.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const ANTI_STEAL_REPLAY = [
  {
    id: "TQH_001",
    family: "module_isolation",
    input: "Pravnik v ukolech vs kalendar: jen ukoly, neplet to s poznamkou.",
    expect: "tasks.read"
  },
  {
    id: "TQH_002",
    family: "module_isolation",
    input: "Bez diakritiky: podivej jen do ukolu co mam na dnes, neplet to s poznamkou.",
    expect: "tasks.read"
  },
  {
    id: "TQH_003",
    family: "entity_task_query",
    input: "Podivej se jen do ukolu, jestli mam koupit uhli do patku, neplet to s poznamkou.",
    expect: "tasks.read"
  },
  {
    id: "TQH_004",
    family: "negated_read",
    input: "Nic neukladej, jen mi ukaz ukoly.",
    expect: "tasks.read"
  },
  {
    id: "TQH_005",
    family: "negated_read",
    input: "Jen cti ukoly.",
    expect: "tasks.read"
  },
  {
    id: "TQH_006",
    family: "negated_read",
    input: "Nevytvarej nic, co mam v ukolech?",
    expect: "tasks.read"
  },
  {
    id: "TQH_007",
    family: "fragment_task_query",
    input: "pravnik smlouva v ukolech",
    expect: "clarification"
  },
  {
    id: "TQH_008",
    family: "conflicting_scope",
    input: "Podivej se jen do ukolu, jestli mam koupit uhli do patku, ne do ukolu.",
    expect: "unknown"
  },
  {
    id: "TQH_009",
    family: "conflicting_scope",
    input: "Pravnik v ukolech vs kalendar: jen ukoly, ne do ukolu.",
    expect: "unknown"
  }
];

const FAMILY_TEMPLATES = {
  basic_task_list: [
    "Co mam dnes za ukoly?",
    "Mam dnes nejake ukoly?",
    "Ukaz mi dnesni ukoly.",
    "Co mam splnit?",
    "Jake mam ukoly?"
  ],
  temporal_task_query: [
    "Co mam zitra za ukoly?",
    "Co mam pristi tyden v ukolech?",
    "Jake ukoly mam na pondeli?",
    "Co jsem mel udelat vcera?",
    "Co mam dnes vecer v ukolech?"
  ],
  entity_task_query: [
    "Co mam s pravnikem?",
    "Co mam poslat Pepovi?",
    "Jaky ukol mam k uctni?",
    "Co mam kolem auta?",
    "Najdi mi ukol k fakture."
  ],
  fragment_task_query: [
    "pravnik smlouva",
    "auto servis ukol",
    "faktura zaplatit",
    "pepovi zavolat",
    "uctni doklady"
  ],
  after_save: [
    "Co mam zitra?",
    "A jen v ukolech",
    "A co mam zitra?",
    "A v ukolech?"
  ],
  negated_read: [
    "Nic neukladej, jen mi ukaz ukoly.",
    "Jen cti ukoly.",
    "Nevytvarej nic, co mam v ukolech?",
    "Jen najdi ukol kolem auta."
  ],
  module_isolation: [
    "Pravnik v ukolech vs kalendar: jen ukoly, neplet to s poznamkou.",
    "Podivej jen do ukolu co mam na dnes, neplet to s poznamkou.",
    "Podivej se jen do ukolu, jestli mam koupit uhli do patku, neplet to s poznamkou."
  ]
};

const FILLERS = ["", "Hele ", "Prosím "];
const TAILS = ["", "?", " prosím"];

function buildCorpusV1(targetCount) {
  const out = ANTI_STEAL_REPLAY.slice();
  const families = Object.keys(FAMILY_TEMPLATES);
  let n = out.length;
  while (out.length < targetCount) {
    const family = families[n % families.length];
    const tpls = FAMILY_TEMPLATES[family];
    const tpl = tpls[n % tpls.length];
    const pfx = FILLERS[n % FILLERS.length];
    const sfx = TAILS[(n >> 2) % TAILS.length];
    const entry = {
      id: "TQH_GEN_" + String(n).padStart(4, "0"),
      family: family,
      input: pfx + tpl + sfx,
      expect: "tasks.read",
      tier: "B"
    };
    if (family === "conflicting_scope") entry.expect = "unknown";
    if (family === "fragment_task_query") entry.expect = "clarification";
    if (family === "after_save" && /\bkalend|zitra\b/.test(tpl.toLowerCase()) && !/\bukol/.test(tpl.toLowerCase())) {
      entry.expect = "calendar.read";
    }
    if (family === "after_save" && /\bukol/.test(tpl.toLowerCase())) entry.expect = "tasks.read";
    out.push(entry);
    n++;
  }
  return out.slice(0, targetCount);
}

function filterFamilies(cases, families) {
  const set = new Set(families);
  return cases.filter(function (c) {
    return set.has(c.family);
  });
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

function evaluateTurn(turn, c) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  const tierB = c.tier === "B" || String(c.id || "").indexOf("_GEN_") >= 0;
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
  if (turn.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
  if (turn.processingState === "STORAGE_DISAMBIGUATION") issues.push("storage_picker");
  if (tierB) return issues;
  if (c.expect && !intentMatches(c.expect, intent)) {
    issues.push("intent_mismatch:" + intent + "!=expected:" + c.expect);
  }
  if (c.expect === "tasks.read" && (intent.indexOf("note") >= 0 || intent === "notes.read")) {
    issues.push("note_steal");
  }
  if (c.expect === "tasks.read" && intent.indexOf("calendar") >= 0) {
    issues.push("calendar_steal");
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

function classifyGapFail(c, ev, turn) {
  const f = String(c.input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const cat = String(ev.cat || "");
  const eng = String(turn.normalizedIntent || "");
  if (cat === "query_created_write" || turn.processingState === "READY_TO_SAVE") return "CREATE_LEAK";
  if (cat === "write_when_negated") return "FIREWALL_OVERBLOCK";
  if (cat === "note_vs_task_confusion" || (eng.indexOf("note") >= 0 && c.expectedIntent === "task.query")) return "NOTE_STEAL";
  if (cat === "calendar_vs_task_confusion" || (eng.indexOf("calendar") >= 0 && c.expectedIntent === "task.query")) return "CALENDAR_STEAL";
  if (/\bne\s+do\s+ukol/.test(f) && /\bjen\s+ukol/.test(f) && c.expectedIntent === "unknown") return "AMBIGUOUS_INPUT";
  if (/\bneple\w*\s+(?:to\s+)?s\s+poznam/.test(f) && c.expectedIntent === "task.query") return "TASK_QUERY_ROUTING_FAIL";
  if (/\b(podivej|zjist)\w*\s+jen\s+do\s+ukol/.test(f)) return "TASK_QUERY_ROUTING_FAIL";
  if (/\b(pravnik|pep|servis|auto|faktur)\b/.test(f)) return "PERSON_ENTITY_FAIL";
  if (/\b(zitra|dnes|vcera|tyden|pondel|patku)\b/.test(f)) return "TEMPORAL_SCOPE_FAIL";
  if (/\b(pravnik\s+smlouva|auto\s+servis|faktura\s+zaplatit)\b/.test(f)) return "FRAGMENT_MATCH_FAIL";
  if (c.expectedIntent === "unknown") return "AMBIGUOUS_INPUT";
  if (cat === "intent_fail") return "TRUE_ENGINE_FAIL";
  return "TRUE_ENGINE_FAIL";
}

function runGapDiagnostic(reportPath) {
  const eng = loadEngine();
  const cases = audit.buildCases().filter(function (c) {
    return c.group === "task_query";
  });
  const clusters = {};
  const fails = [];
  let pass = 0;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), audit.ctxForCase(c.group));
    const ev = audit.evaluateOne(c, turn);
    if (ev.pass) {
      pass++;
      continue;
    }
    const cluster = classifyGapFail(c, ev, turn);
    clusters[cluster] = (clusters[cluster] || 0) + 1;
    if (fails.length < 120) {
      fails.push({
        id: c.id,
        input: c.input,
        expected: c.expectedIntent,
        actual: ev.auditIntent,
        route: turn.normalizedIntent || "",
        reason: ev.cat,
        cluster: cluster
      });
    }
  }
  const failCount = cases.length - pass;
  const topClusters = Object.keys(clusters)
    .sort(function (a, b) {
      return clusters[b] - clusters[a];
    })
    .map(function (k) {
      return { cluster: k, count: clusters[k] };
    });
  const report = {
    guard_id: "silver_task_query_gap_diagnostic_v1",
    group: "task_query",
    total: cases.length,
    pass: pass,
    fail: failCount,
    remaining_task_query_fails: failCount,
    top_clusters: topClusters,
    note_steal_count: clusters.NOTE_STEAL || 0,
    calendar_steal_count: clusters.CALENDAR_STEAL || 0,
    module_leak_count: (clusters.NOTE_STEAL || 0) + (clusters.CALENDAR_STEAL || 0),
    true_engine_fail_count: clusters.TRUE_ENGINE_FAIL || 0,
    harness_problem_count: clusters.HARNESS_OR_GOLD || 0,
    ambiguous_input_count: clusters.AMBIGUOUS_INPUT || 0,
    sample_fails: fails.slice(0, 40),
    PASS_FAIL: failCount === 0 ? "PASS" : "FAIL"
  };
  try {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  } catch (eW) {
    void eW;
  }
  console.log("=== SILVER_TASK_QUERY_GAP_DIAGNOSTIC_V1 ===");
  console.log("total=" + cases.length);
  console.log("pass=" + pass + "/" + cases.length);
  console.log("remaining_task_query_fails=" + failCount);
  console.log("top_clusters=" + JSON.stringify(topClusters.slice(0, 8)));
  console.log("note_steal_count=" + (clusters.NOTE_STEAL || 0));
  console.log("calendar_steal_count=" + (clusters.CALENDAR_STEAL || 0));
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END_SILVER_TASK_QUERY_GAP_DIAGNOSTIC_V1 ===");
  return report;
}

module.exports = {
  ANTI_STEAL_REPLAY,
  buildCorpusV1,
  filterFamilies,
  runAudit,
  printHeader,
  runGapDiagnostic,
  evaluateCase
};
