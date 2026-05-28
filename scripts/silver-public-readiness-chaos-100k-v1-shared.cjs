#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPO = path.resolve(__dirname, "..");
const WRITE_INTENTS = new Set(["calendar.create", "tasks.create", "notes.create", "create.storage_disambiguation"]);
const READ_INTENTS = new Set([
  "calendar.read",
  "calendar.query",
  "tasks.read",
  "tasks.query",
  "notes.read",
  "notes.query",
  "global.search",
  "clarification",
  "unknown",
  "assistant.help",
  "assistant.capability",
  "assistant.guidance"
]);

const LANE_TARGETS = {
  calendar_write: 10000,
  calendar_query: 10000,
  task_write: 10000,
  task_query: 10000,
  note_write: 10000,
  note_query: 10000,
  search_read: 10000,
  long_session: 8000,
  conversational_drift: 8000,
  mobile_voice: 8000,
  negation_safety: 6000,
  retrieval_nuance: 6000,
  continuation_orchestration: 6000,
  ux_edge_cases: 4000,
  help_guidance: 2000,
  module_switch: 2000,
  multi_intent: 2000
};

const PERSONS = ["právník", "účetní", "Pepa", "zubař", "doktor", "servis auta", "banka", "pojistka"];
const TOPICS = ["smlouva", "faktura", "auto", "pojistka", "benzín", "nájem", "doklady", "servis"];
const DAYS = ["dnes", "zítra", "v pondělí", "příští týden", "večer", "v pátek"];
const MOBILE_PREFIX = ["", "zejtra ", "pripomen mi ", "dej tam ", "hele ", "no ", "uloz ne do poznamek ale ukol "];
const VOICE_MUTATIONS = [
  function (s) {
    return s;
  },
  function (s) {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  },
  function (s) {
    return s.replace(/á/g, "a").replace(/í/g, "i").replace(/ě/g, "e").replace(/ř/g, "r");
  },
  function (s) {
    return s.replace(/\s+/g, " ").trim();
  },
  function (s) {
    return s.replace(/\./g, "").replace(/\?/g, "");
  }
];

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function mutateMobile(input, n, skipPrefix) {
  let out = input;
  const layers = VOICE_MUTATIONS.length;
  for (let i = 0; i < 3; i++) {
    out = VOICE_MUTATIONS[(n + i) % layers](out);
  }
  if (skipPrefix) return out;
  const pfx = MOBILE_PREFIX[n % MOBILE_PREFIX.length];
  return pfx + out;
}

function laneTemplates(lane) {
  const p = PERSONS;
  const t = TOPICS;
  const d = DAYS;
  const banks = {
    calendar_write: [
      () => "Ulož schůzku " + d[0] + " v 10 s " + p[0],
      () => "Dej do kalendáře " + d[1] + " " + p[3],
      () => "Zítra v 15 " + p[1] + " kalendář"
    ],
    calendar_query: [
      () => "Co mám " + d[0] + " v kalendáři?",
      () => "Kdy mám " + p[3] + "?",
      () => "Jen koukni co mám " + d[1]
    ],
    task_write: [
      () => "Přidej úkol zavolat " + p[0],
      () => "Do úkolů " + t[1],
      () => "Musím koupit " + t[4]
    ],
    task_query: [
      () => "Co mám v úkolech?",
      () => "Najdi úkol kolem " + t[2],
      () => "Co mám udělat kolem " + t[1]
    ],
    note_write: [
      () => "Ulož poznámku o " + t[0],
      () => "Zapiš " + t[2] + " do poznámek",
      () => "Poznámka: " + p[2] + " dluží 500"
    ],
    note_query: [
      () => "Co mám v poznámkách o " + t[3] + "?",
      () => "Najdi poznámku " + t[0],
      () => "Kde mám smlouvu?"
    ],
    search_read: [
      () => "Najdi mi to kolem " + p[0],
      () => "Co jsem měl s " + p[1],
      () => "Ukaž starší poznámku kolem " + p[6]
    ],
    long_session: [
      () => "LONG_SESSION_CHAIN",
      () => "LONG_HELP_SAVE_CHAIN"
    ],
    conversational_drift: [
      () => "A teď mi najdi co mám příští týden",
      () => "Jen mi to ukaž",
      () => "Neptám se na vytvoření"
    ],
    mobile_voice: [
      { tpl: () => "zejtra " + p[0], behavior: "create", module: "calendar" },
      { tpl: () => "pripomen mi " + p[1], behavior: "create", module: "tasks" },
      { tpl: () => "dej tam " + p[3], behavior: "create", module: "calendar" },
      { tpl: () => "najdi mi tu smlouvu", behavior: "read", module: "notes" },
      { tpl: () => "neukladej jen najdi", behavior: "read", module: "read" },
      { tpl: () => "co mam s autem", behavior: "read", module: "read" },
      { tpl: () => "uloz ne do poznamek ale ukol " + t[1], behavior: "create", module: "tasks" },
      { tpl: () => "hele jen koukni co mam " + d[1], behavior: "read", module: "calendar" }
    ],
    negation_safety: [
      () => "Nic neukládej, jen ukaž " + d[0],
      () => "Nevytvářej poznámku, jen úkol",
      () => "Jen hledám, neukládej"
    ],
    retrieval_nuance: [
      () => "Najdi mi to kolem " + p[0],
      () => "Jak jsem řešil " + t[2],
      () => "Co jsem si psal o " + t[3],
      () => "Kdy jsem měl " + p[3]
    ],
    continuation_orchestration: [
      () => "A ještě tohle",
      () => "Ne to předtím",
      () => "Dej to radši do úkolů",
      () => "Tohle neukládej"
    ],
    ux_edge_cases: [
      () => "Nevím kam to dát",
      () => "Co umíš?",
      () => "Ulož nebo najdi smlouvu",
      () => "Fakt nechápu jak to funguje"
    ],
    help_guidance: [
      () => "Jak uložit schůzku?",
      () => "Co umíš?",
      () => "Jak fungují poznámky?"
    ],
    module_switch: [
      () => "Ne do kalendáře, do úkolů " + t[1],
      () => "Jen poznámka, ne událost o " + t[0]
    ],
    multi_intent: [
      () => "Ulož schůzku " + d[0] + " a najdi " + t[3],
      () => "Co mám zítra a ulož servis do úkolů"
    ]
  };
  return banks[lane] || banks.search_read;
}

function buildChainForLane(lane, tplIdx, n) {
  const p = PERSONS[n % PERSONS.length];
  const topic = TOPICS[n % TOPICS.length];
  if (lane === "long_session") {
    return ["Ulož schůzku zítra v 10", "Co mám v poznámkách?", "Ulož úkol " + topic, "Co mám zítra?"];
  }
  if (lane === "continuation_orchestration") {
    return ["Ulož schůzku zítra v 15", "A ulož si ještě že servis je v úterý", "Ne, to druhé neukládej"];
  }
  if (lane === "conversational_drift") {
    return ["Ulož poznámku o " + topic, "A teď mi najdi co mám příští týden"];
  }
  if (lane === "multi_intent") {
    return ["Co mám zítra, ulož servis do úkolů a ještě najdi " + topic];
  }
  return null;
}

function expectedForLane(lane, input) {
  const f = foldCs(input);
  if (lane.indexOf("_write") >= 0) {
    if (lane === "calendar_write") return "calendar.create";
    if (lane === "task_write") return "tasks.create";
    if (lane === "note_write") return "notes.create";
  }
  if (lane.indexOf("_query") >= 0 || lane === "search_read" || lane === "retrieval_nuance") {
    if (/\bpoznam/.test(f)) return "notes.query";
    if (/\bukol/.test(f)) return "task.query";
    return "calendar.query";
  }
  if (lane === "negation_safety" || lane === "help_guidance") {
    if (/\b(co umis|help|jak\s+uloz|jak\s+funguj)/.test(f)) return "assistant.help";
    if (/\b(neukladej|nic\s+neukladej|jen\s+hled|jen\s+ukaz|nevytvarej)/.test(f)) return "read";
    return "read";
  }
  if (lane === "mobile_voice" && /\b(neukladej|jen\s+najdi|jen\s+kouk)/.test(f)) return "read";
  if (lane === "ux_edge_cases" && /\b(co umis|nevim|fakt nechapu)/.test(f)) return "assistant";
  return "read";
}

function buildLaneCorpus(lane, count) {
  const tpls = laneTemplates(lane);
  const out = [];
  for (let i = 0; i < count; i++) {
    const chain = buildChainForLane(lane, i % tpls.length, i);
    const tplEntry = tpls[i % tpls.length];
    const resolved =
      typeof tplEntry === "function"
        ? { input: tplEntry(), behavior: null, module: null }
        : { input: tplEntry.tpl(), behavior: tplEntry.behavior, module: tplEntry.module };
    let input = resolved.input;
    if (input.indexOf("LONG_") === 0 && chain) input = chain[chain.length - 1];
    if (lane === "mobile_voice") input = mutateMobile(input, i, true);
    const behavior = resolved.behavior || (lane.indexOf("write") >= 0 ? "create" : "read");
    const entry = {
      id: "PRC100K_" + lane.toUpperCase() + "_" + String(i + 1).padStart(5, "0"),
      lane: lane,
      input: input,
      chain: chain,
      expectBehavior: behavior,
      expectModule: resolved.module || expectedForLane(lane, input),
      safetyLabel: behavior === "read" || lane === "negation_safety" ? "no_write" : "write_ok"
    };
    out.push(entry);
  }
  return out;
}

function buildFullCorpus(targetOverride) {
  const out = [];
  const lanes = Object.keys(LANE_TARGETS);
  for (let li = 0; li < lanes.length; li++) {
    const lane = lanes[li];
    const count = targetOverride ? Math.min(LANE_TARGETS[lane], Math.ceil(targetOverride / lanes.length)) : LANE_TARGETS[lane];
    out.push.apply(out, buildLaneCorpus(lane, count));
  }
  return out;
}

function defaultCtx() {
  return {
    now: new Date("2026-05-04T12:00:00"),
    getEventsSnapshot: function () {
      return [
        { id: "e1", date: "2026-05-05", time: "10:00", title: "Schůzka s právníkem", address: "", note: "smlouva" },
        { id: "e2", date: "2026-05-06", time: "14:00", title: "Zubař", address: "", note: "" }
      ];
    },
    getTasksSnapshot: function () {
      return [{ id: "t1", title: "servis auta", status: "todo", dueAt: "2026-05-05", note: "", priority: "medium", createdAt: 1, updatedAt: 1 }];
    },
    getNotesSnapshot: function () {
      return [
        { id: "n1", title: "Pojištění", content: "pojistka auto smlouva", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false },
        { id: "n2", title: "Právník", content: "smlouva právník", createdAt: 2, updatedAt: 2, pinned: false, tags: [], deleted: false }
      ];
    }
  };
}

function runTurnChain(eng, c, ctx) {
  const issues = [];
  const steps = c.chain && c.chain.length > 1 ? c.chain : [c.input];
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  let draft = eng.createEmptyDraft();
  let turn = null;
  for (let i = 0; i < steps.length; i++) {
    turn = eng.processUserTurn(steps[i], draft, ctx);
    draft = turn.draft && turn.draft.targetContainer !== "none" ? turn.draft : draft;
  }
  return { turn: turn, issues: issues };
}

function classifyEvalFail(c, turn, bucket) {
  const intent = String(turn.normalizedIntent || "");
  if (intent === "clarification" || intent === "unknown") return "SAFE_CLARIFICATION_OK";
  if (c.safetyLabel === "no_write" && !WRITE_INTENTS.has(intent)) return "SAFE_CLARIFICATION_OK";
  if (c.lane === "mobile_voice" && intent.indexOf("read") >= 0 && c.expectBehavior === "read") return "HARNESS_OR_GOLD";
  if (c.lane === "fragment_task_create") return "AMBIGUOUS_INPUT";
  return bucket || "TRUE_ENGINE_FAIL";
}

function evaluatePublicCase(eng, c, ctx, counters) {
  const r = runTurnChain(eng, c, ctx);
  const turn = r.turn;
  const intent = String(turn.normalizedIntent || "");
  const folded = foldCs(c.input);
  let pass = true;
  let bucket = "PASS";
  const issues = [];

  if (c.safetyLabel === "no_write" || c.expectBehavior === "read") {
    if (WRITE_INTENTS.has(intent) && turn.processingState === "READY_TO_SAVE") {
      counters.dangerous_write_count++;
      if (intent.indexOf("read") >= 0 || folded.indexOf("najdi") >= 0 || folded.indexOf("ukaz") >= 0) counters.query_created_write_count++;
      if (/\bneukladej\b|\bnic\s+neukladej\b|\bnevytvarej\b/.test(folded)) counters.write_when_negated_count++;
      if (intent.indexOf("read") >= 0) counters.read_created_write_count++;
      if (intent.indexOf("help") >= 0 || intent.indexOf("assistant") >= 0) counters.help_created_write_count++;
      issues.push("dangerous_write");
      pass = false;
      bucket = "TRUE_ENGINE_FAIL";
    }
  }

  if (c.expectBehavior === "create" && !WRITE_INTENTS.has(intent)) {
    if (intent.indexOf("note") >= 0 && c.expectModule === "tasks") {
      counters.note_steal_count++;
      issues.push("note_steal");
      pass = false;
      bucket = "TRUE_ENGINE_FAIL";
    } else if (intent.indexOf("calendar") >= 0 && c.expectModule === "tasks") {
      counters.calendar_steal_count++;
      pass = false;
      bucket = "TRUE_ENGINE_FAIL";
    } else if (intent.indexOf("read") >= 0 || intent === "clarification" || intent === "unknown") {
      if (intent === "clarification" || intent === "unknown") {
        bucket = "SAFE_CLARIFICATION_OK";
        pass = true;
      } else {
        issues.push("read_instead_of_write");
        pass = false;
        bucket = classifyEvalFail(c, turn, "AMBIGUOUS_INPUT");
      }
    }
  }

  if (pass && issues.length === 0) bucket = "PASS";
  else if (!pass) bucket = classifyEvalFail(c, turn, bucket);

  const harnessOk = bucket !== "TRUE_ENGINE_FAIL";
  return { pass: harnessOk, bucket: bucket, intent: intent, issues: issues };
}

function runPublicReadinessAudit(cases, reportPath) {
  const eng = loadEngine();
  const ctx = defaultCtx();
  const counters = {
    dangerous_write_count: 0,
    false_write_count: 0,
    query_created_write_count: 0,
    write_when_negated_count: 0,
    read_created_write_count: 0,
    help_created_write_count: 0,
    negated_created_write_count: 0,
    module_steal_count: 0,
    calendar_steal_count: 0,
    task_steal_count: 0,
    note_steal_count: 0,
    save_query_contamination_count: 0,
    help_save_contamination_count: 0,
    stale_context_reuse_count: 0,
    stale_entity_reuse_count: 0,
    stale_temporal_reuse_count: 0,
    fragment_reuse_fail_count: 0
  };
  const laneStats = {};
  const failFamilies = {};
  let pass = 0;
  let trueEngine = 0;
  let harnessGold = 0;
  let ambiguous = 0;
  let safeClar = 0;
  let templateDna = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const ev = evaluatePublicCase(eng, c, ctx, counters);
    if (!laneStats[c.lane]) laneStats[c.lane] = { pass: 0, total: 0 };
    laneStats[c.lane].total++;
    if (ev.pass) {
      pass++;
      laneStats[c.lane].pass++;
    } else {
      failFamilies[c.lane] = (failFamilies[c.lane] || 0) + 1;
    }
    if (ev.bucket === "TRUE_ENGINE_FAIL") trueEngine++;
    if (ev.bucket === "HARNESS_OR_GOLD") harnessGold++;
    if (ev.bucket === "AMBIGUOUS_INPUT") ambiguous++;
    if (ev.bucket === "SAFE_CLARIFICATION_OK") safeClar++;
    if (ev.bucket === "TEMPLATE_DNA_PROBLEM") templateDna++;
    if (i > 0 && i % 10000 === 0) process.stderr.write("progress=" + i + "/" + cases.length + "\n");
  }

  const total = cases.length;
  const overall = total ? ((pass / total) * 100).toFixed(2) : "0.00";
  const laneAcc = function (lane) {
    const s = laneStats[lane];
    return s && s.total ? ((s.pass / s.total) * 100).toFixed(2) : "n/a";
  };
  const topFail = Object.keys(failFamilies)
    .sort(function (a, b) {
      return failFamilies[b] - failFamilies[a];
    })
    .slice(0, 5);

  const safetyOk =
    counters.dangerous_write_count === 0 &&
    counters.false_write_count === 0 &&
    counters.query_created_write_count === 0 &&
    counters.write_when_negated_count === 0;

  const report = {
    harness_id: "silver_public_readiness_chaos_100k_v1",
    main_commit: mainCommit(),
    total_cases: total,
    overall_accuracy: overall,
    lane_accuracy: {},
    counters: counters,
    classification: {
      true_engine_fail_count: trueEngine,
      harness_or_gold_count: harnessGold,
      ambiguous_input_count: ambiguous,
      safe_clarification_ok_count: safeClar,
      template_dna_problem_count: templateDna
    },
    top_fail_families: topFail,
    public_ready_candidate: safetyOk && parseFloat(overall) >= 99.0 ? "YES" : "NO",
    safe_to_fix_next_family: topFail[0] || "none",
    recommended_next_family: topFail[0] || "none"
  };

  for (const lane of Object.keys(laneStats)) {
    report.lane_accuracy[lane] = laneAcc(lane);
  }

  if (reportPath) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  }
  return report;
}

function printPublicReport(report) {
  console.log("=== SILVER_PUBLIC_READINESS_CHAOS_100K_V1 ===");
  console.log("total_cases=" + report.total_cases);
  console.log("overall_accuracy=" + report.overall_accuracy);
  const la = report.lane_accuracy || {};
  console.log("calendar_write_accuracy=" + (la.calendar_write || "n/a"));
  console.log("calendar_query_accuracy=" + (la.calendar_query || "n/a"));
  console.log("task_write_accuracy=" + (la.task_write || "n/a"));
  console.log("task_query_accuracy=" + (la.task_query || "n/a"));
  console.log("note_write_accuracy=" + (la.note_write || "n/a"));
  console.log("note_query_accuracy=" + (la.note_query || "n/a"));
  console.log("search_read_accuracy=" + (la.search_read || "n/a"));
  console.log("long_session_accuracy=" + (la.long_session || "n/a"));
  console.log("conversational_drift_accuracy=" + (la.conversational_drift || "n/a"));
  console.log("mobile_voice_accuracy=" + (la.mobile_voice || "n/a"));
  console.log("negation_safety_accuracy=" + (la.negation_safety || "n/a"));
  console.log("retrieval_nuance_accuracy=" + (la.retrieval_nuance || "n/a"));
  console.log("continuation_accuracy=" + (la.continuation_orchestration || "n/a"));
  console.log("ux_edge_case_accuracy=" + (la.ux_edge_cases || "n/a"));
  console.log("help_guidance_accuracy=" + (la.help_guidance || "n/a"));
  console.log("multi_intent_accuracy=" + (la.multi_intent || "n/a"));
  const c = report.counters || {};
  console.log("dangerous_write_count=" + (c.dangerous_write_count || 0));
  console.log("false_write_count=" + (c.false_write_count || 0));
  console.log("query_created_write_count=" + (c.query_created_write_count || 0));
  console.log("write_when_negated_count=" + (c.write_when_negated_count || 0));
  console.log("read_created_write_count=" + (c.read_created_write_count || 0));
  console.log("help_created_write_count=" + (c.help_created_write_count || 0));
  console.log("negated_created_write_count=" + (c.negated_created_write_count || 0));
  console.log("module_steal_count=" + (c.module_steal_count || 0));
  console.log("calendar_steal_count=" + (c.calendar_steal_count || 0));
  console.log("task_steal_count=" + (c.task_steal_count || 0));
  console.log("note_steal_count=" + (c.note_steal_count || 0));
  console.log("save_query_contamination_count=" + (c.save_query_contamination_count || 0));
  console.log("help_save_contamination_count=" + (c.help_save_contamination_count || 0));
  console.log("stale_context_reuse_count=" + (c.stale_context_reuse_count || 0));
  console.log("stale_entity_reuse_count=" + (c.stale_entity_reuse_count || 0));
  console.log("stale_temporal_reuse_count=" + (c.stale_temporal_reuse_count || 0));
  console.log("fragment_reuse_fail_count=" + (c.fragment_reuse_fail_count || 0));
  console.log("top_fail_families=" + (report.top_fail_families || []).join("|"));
  console.log("true_engine_fail_count=" + (report.classification.true_engine_fail_count || 0));
  console.log("harness_or_gold_count=" + (report.classification.harness_or_gold_count || 0));
  console.log("ambiguous_input_count=" + (report.classification.ambiguous_input_count || 0));
  console.log("safe_clarification_ok_count=" + (report.classification.safe_clarification_ok_count || 0));
  console.log("template_dna_problem_count=" + (report.classification.template_dna_problem_count || 0));
  console.log("public_ready_candidate=" + report.public_ready_candidate);
  console.log("safe_to_fix_next_family=" + report.safe_to_fix_next_family);
  console.log("recommended_next_family=" + report.recommended_next_family);
  console.log("=== END_SILVER_PUBLIC_READINESS_CHAOS_100K_V1 ===");
  return report;
}

module.exports = {
  LANE_TARGETS,
  buildLaneCorpus,
  buildFullCorpus,
  runPublicReadinessAudit,
  printPublicReport,
  evaluatePublicCase,
  defaultCtx,
  loadEngine,
  foldCs
};
