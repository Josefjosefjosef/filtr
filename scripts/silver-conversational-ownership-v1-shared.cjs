#!/usr/bin/env node
"use strict";

const fs = require("fs");
const lsf = require("./silver-long-session-firewall-v1-shared.cjs");
const cap = require("./silver-conversational-orchestration-cap-v1-shared.cjs");
const helpGov = require("./silver-help-guidance-render-governance-v1-shared.cjs");

const WRITE_INTENTS = lsf.WRITE_INTENTS;
const READ_OK_INTENTS = new Set([
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

const OWNERSHIP_STATIC = [
  {
    id: "COV_001",
    family: "save_to_query",
    chain: ["Ulož úkol koupit mléko", "Co mám v úkolech?", "Mám poznámku o autě?", "Co mám zítra v kalendáři?", "Co mám v úkolech na zítra?"],
    input: "Co mám v úkolech na zítra?",
    expectRead: true,
    expectModule: "tasks"
  },
  {
    id: "COV_002",
    family: "help_to_save",
    chain: ["Co umíš?", "Jak fungují úkoly?", "Help", "Ulož úkol zavolat právníkovi", "Co mám v úkolech?"],
    input: "Co mám v úkolech?",
    expectRead: true,
    expectModule: "tasks"
  },
  {
    id: "COV_003",
    family: "module_switch",
    chain: ["Ulož poznámku o pojištění", "Ulož úkol servis auta", "Ulož schůzku zítra v 10", "Co mám zítra?", "Co mám v poznámkách?", "Co mám v úkolech?", "Co mám v kalendáři?"],
    input: "Co mám v kalendáři?",
    expectRead: true,
    expectModule: "calendar"
  },
  {
    id: "COV_004",
    family: "stale_entity",
    chain: ["Ulož schůzku s právníkem zítra", "Ulož schůzku s účetní v pátek", "Ulož poznámku o autě", "Najdi schůzku s účetní", "Ulož úkol kolem auta"],
    input: "Ulož úkol kolem auta",
    expectRead: false,
    expectModule: "tasks",
    allowWriteLast: true
  },
  {
    id: "COV_005",
    family: "stale_temporal",
    chain: ["Co mám dnes?", "Co mám zítra?", "Co mám příští týden?", "V pondělí mám zubaře", "Co mám v pondělí?", "Ulož schůzku v úterý v 9"],
    input: "Ulož schůzku v úterý v 9",
    expectRead: false,
    allowWriteLast: true,
    expectModule: "calendar"
  },
  {
    id: "COV_006",
    family: "negation_read_safety",
    chain: ["Nic neukládej", "Jen čti", "Pouze ukaž", "Nevytvářej nic", "Ulož úkol test", "Co mám zítra?"],
    input: "Co mám zítra?",
    expectRead: true,
    expectModule: "calendar"
  }
];

const OWNERSHIP_TEMPLATE_BANK = {
  save_to_query: [
    { save: "Ulož úkol {w}", queryNote: "Mám poznámku o {topic}?", queryCal: "Co mám {day} v kalendáři?", queryTask: "Co mám v úkolech?" },
    { save: "Ulož schůzku {day} v {time}", queryNote: "Co mám v poznámkách o {topic}?", queryCal: "Co mám {day}?", queryTask: "Co mám v úkolech na {day}?" }
  ],
  help_to_save: [
    { help: "Co umíš?", help2: "Jak fungují úkoly?", save: "Ulož úkol {w}", query: "Co mám v úkolech?" },
    { help: "Help", help2: "Jak najdu poznámky?", save: "Ulož poznámku o {topic}", query: "Co mám v poznámkách?" }
  ],
  module_switch: [
    { note: "Ulož poznámku o {topic}", task: "Ulož úkol {w}", cal: "Ulož schůzku {day} v {time}", qNote: "Co mám v poznámkách?", qTask: "Co mám v úkolech?", qCal: "Co mám {day} v kalendáři?" },
    { note: "Zapiš poznámku {topic}", task: "Přidej úkol {w}", cal: "Dej do kalendáře {day} v {time}", qNote: "Najdi poznámku o {topic}", qTask: "Najdi úkol {w}", qCal: "Mám {day} schůzky?" }
  ],
  stale_entity: [
    { e1: "Ulož schůzku s právníkem {day}", e2: "Ulož schůzku s účetní {day2}", e3: "Ulož poznámku o {topic}", q: "Najdi schůzku s účetní", save: "Ulož úkol kolem {topic}" },
    { e1: "Ulož poznámku o {person}", e2: "Ulož poznámku o {topic}", q: "Co mám v poznámkách o {topic}?", save: "Ulož úkol {w}" }
  ],
  stale_temporal: [
    { t1: "Co mám dnes?", t2: "Co mám zítra?", t3: "Co mám příští týden?", t4: "V pondělí mám zubaře", q: "Co mám v pondělí?", save: "Ulož schůzku {day} v {time}" },
    { t1: "Co mám {day}?", t2: "Co mám {day2}?", q: "Co mám {dayLabel} v kalendáři?", save: "Ulož schůzku {day2} v {time}" }
  ],
  negation_read_safety: [
    { neg: "Nic neukládej", neg2: "Jen čti", neg3: "Pouze ukaž", neg4: "Nevytvářej nic", save: "Ulož úkol {w}", query: "Co mám {day}?" },
    { neg: "Jen hledám", neg2: "Nic neukladej", save: "Ulož poznámku {topic}", query: "Co mám v poznámkách?" }
  ]
};

const ENTITIES = ["právník", "účetní", "auto", "Pepa", "servis"];
const WORK = ["zavolat právníkovi", "koupit mléko", "servis auta", "záloha server"];
const FILLERS = ["", "Hele ", "Prosím "];

function foldInput(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function expectModuleFromInput(input) {
  const inf = foldInput(input);
  if (/\bpoznam/.test(inf)) return "notes";
  if (/\bukol/.test(inf)) return "tasks";
  if (/\b(kalend|schuz)/.test(inf)) return "calendar";
  return null;
}

function fillOwn(s, n) {
  return String(s || "")
    .replace(/\{day\}/g, ["dnes", "zítra", "pozítří", "v pondělí"][n % 4])
    .replace(/\{day2\}/g, ["zítra", "pozítří", "v úterý", "v pátek"][(n + 1) % 4])
    .replace(/\{dayLabel\}/g, ["dnešní", "zítřejší", "pondělní"][n % 3])
    .replace(/\{person\}/g, ["Pepou", "Martinou", "Frantovi", ENTITIES[n % ENTITIES.length]][n % 4])
    .replace(/\{topic\}/g, ["auta", "pojištění", "zálohy"][n % 3])
    .replace(/\{time\}/g, ["10:00", "15:00", "9:00"][n % 3])
    .replace(/\{w\}/g, WORK[n % WORK.length]);
}

function buildChainForFamily(family, tpl, n) {
  if (family === "save_to_query") {
    return {
      chain: [fillOwn(tpl.save, n), fillOwn(tpl.queryNote, n), fillOwn(tpl.queryCal, n), fillOwn(tpl.queryTask, n)],
      expectModule: "tasks"
    };
  }
  if (family === "help_to_save") {
    const chain = [fillOwn(tpl.help, n)];
    if (tpl.help2) chain.push(fillOwn(tpl.help2, n));
    chain.push(fillOwn(tpl.save, n), fillOwn(tpl.query, n));
    const qLast = fillOwn(tpl.query, n);
    return { chain: chain, expectModule: expectModuleFromInput(qLast) || "tasks" };
  }
  if (family === "module_switch") {
    return {
      chain: [
        fillOwn(tpl.note, n),
        fillOwn(tpl.task, n),
        fillOwn(tpl.cal, n),
        fillOwn(tpl.qNote, n),
        fillOwn(tpl.qTask, n),
        fillOwn(tpl.qCal, n)
      ],
      expectModule: "calendar"
    };
  }
  if (family === "stale_entity") {
    const saveTxt = fillOwn(tpl.save, n);
    return {
      chain: [fillOwn(tpl.e1, n), fillOwn(tpl.e2, n), fillOwn(tpl.e3, n), fillOwn(tpl.q, n), saveTxt],
      expectModule: expectModuleFromInput(saveTxt) || "calendar",
      allowWriteLast: true
    };
  }
  if (family === "stale_temporal") {
    const c = [];
    if (tpl.t1) c.push(fillOwn(tpl.t1, n));
    if (tpl.t2) c.push(fillOwn(tpl.t2, n));
    if (tpl.t3) c.push(fillOwn(tpl.t3, n));
    if (tpl.t4) c.push(fillOwn(tpl.t4, n));
    c.push(fillOwn(tpl.q, n), fillOwn(tpl.save, n));
    return { chain: c, expectModule: "calendar", allowWriteLast: true };
  }
  if (family === "negation_read_safety") {
    const c = [];
    if (tpl.neg) c.push(fillOwn(tpl.neg, n));
    if (tpl.neg2) c.push(fillOwn(tpl.neg2, n));
    if (tpl.neg3) c.push(fillOwn(tpl.neg3, n));
    if (tpl.neg4) c.push(fillOwn(tpl.neg4, n));
    c.push(fillOwn(tpl.save, n), fillOwn(tpl.query, n));
    return { chain: c, expectModule: "calendar" };
  }
  return { chain: [fillOwn(tpl.input || "", n)] };
}

function buildCorpusV1(targetCount) {
  const base = lsf.buildCorpusV1(Math.max(120, Math.floor(targetCount * 0.35)));
  const capCases = cap.buildCapCorpusV1(Math.max(80, Math.floor(targetCount * 0.2)));
  const mappedCap = capCases.map((c, i) => {
    const orig = c.family;
    let family = orig;
    if (family === "search_after_save" || family === "save_after_search") family = "save_to_query";
    if (family === "help_no_save") family = "help_to_save";
    if (family === "module_switch" || family === "followup_ownership") family = "module_switch";
    if (family === "stale_context_reset" || family === "conversational_continuation") family = "module_switch";
    if (family === "negated_save") family = "negation_read_safety";
    const entry = Object.assign({}, c, {
      id: "COV_CAP_" + String(i).padStart(4, "0"),
      family: family,
      tier: "B"
    });
    if (orig === "save_after_search") {
      entry.expectRead = false;
      entry.allowWriteLast = true;
      entry.expectModule = "notes";
    } else if (orig === "search_after_save" || orig === "negated_save" || orig === "conversational_continuation") {
      entry.expectRead = true;
    } else if (orig === "help_no_save") {
      entry.expectRead = true;
    } else if (orig === "module_switch" || orig === "followup_ownership") {
      entry.expectRead = true;
    }
    return entry;
  });
  const out = OWNERSHIP_STATIC.slice().concat(
    base.map((c) => {
      const orig = c.family;
      let family = orig;
      if (family === "save_then_query" || family === "note_calendar_isolation" || family === "task_calendar_isolation") {
        family = "save_to_query";
      } else if (family === "save_help_query") family = "help_to_save";
      else if (family === "multi_turn_module_isolation") family = "module_switch";
      else if (family === "stale_draft_resurrection" || family === "conversation_ownership_reset") {
        family = "negation_read_safety";
      } else if (family === "query_after_timestamp_render") family = "save_to_query";
      else if (
        family !== "failed_save_query" &&
        family !== "read_after_clarification" &&
        family !== "query_after_failed_save" &&
        family !== "long_mobile_session"
      ) {
        family = "module_switch";
      }
      const entry = Object.assign({}, c, { family: family });
      if (orig === "conversation_ownership_reset" || orig === "stale_draft_resurrection") {
        entry.expectRead = true;
      }
      return entry;
    }),
    mappedCap
  );
  let n = out.length;
  const families = Object.keys(OWNERSHIP_TEMPLATE_BANK);
  while (out.length < targetCount) {
    const family = families[n % families.length];
    const tpls = OWNERSHIP_TEMPLATE_BANK[family];
    const tpl = tpls[n % tpls.length];
    const pfx = FILLERS[n % FILLERS.length];
    const built = buildChainForFamily(family, tpl, n);
    const chain = built.chain.map((s) => pfx + s);
    const input = chain[chain.length - 1];
    const expectRead = built.allowWriteLast ? false : !entryAllowsWrite(family, input);
    let expectModule = expectModuleFromInput(input) || built.expectModule;
    const entry = {
      id: "COV_GEN_" + String(n).padStart(4, "0"),
      family: family,
      chain: chain,
      input: input,
      expectRead: expectRead,
      expectModule: expectModule,
      allowWriteLast: built.allowWriteLast === true,
      tier: "B"
    };
    if (family === "stale_temporal" && !entry.allowWriteLast) {
      entry.expectModule = "calendar";
      entry.expectRead = true;
    }
    if (family === "help_to_save" && /\b(uloz|zapis)\b/i.test(input)) {
      entry.allowWriteLast = true;
      entry.expectRead = false;
    }
    out.push(entry);
    n++;
  }
  return out.slice(0, targetCount);
}

function entryAllowsWrite(family, input) {
  if (family === "stale_entity" || family === "stale_temporal") {
    return /\b(uloz|zapis|pridej|dej\s+do)\b/i.test(input);
  }
  if (family === "help_to_save") return /\b(uloz|zapis)\b/i.test(input);
  return false;
}

function filterFamilies(cases, families) {
  const set = new Set(families);
  return cases.filter((c) => set.has(c.family));
}

function moduleOfIntent(intent) {
  const i = String(intent || "");
  if (i.indexOf("calendar") === 0) return "calendar";
  if (i.indexOf("tasks") === 0) return "tasks";
  if (i.indexOf("notes") === 0) return "notes";
  if (i === "global.search") return "search";
  return "other";
}

function classifyOwnershipFail(c, r) {
  const issues = r.issues || [];
  const intent = String(r.intent || "");
  const family = c.family || "";
  if (issues.some((x) => x.indexOf("help_save") >= 0)) return "HELP_SAVE_CONTAMINATION";
  if (issues.some((x) => x.indexOf("write_leak") >= 0 || x === "ready_to_save")) {
    if (family === "negation_read_safety") return "FIREWALL_OVERBLOCK";
    if (family === "save_to_query" || family === "help_to_save") return "SAVE_QUERY_CONTAMINATION";
    return "READ_CREATE_CONTAMINATION";
  }
  if (issues.some((x) => x.indexOf("module_leak") >= 0)) {
    if (family === "module_switch" || family === "stale_entity") return "MODULE_CARRY_OVER";
    return "CONVERSATIONAL_DRIFT";
  }
  if (c.expectModule && moduleOfIntent(intent) !== c.expectModule && intent !== "global.search") {
    if (family === "stale_entity") return "ENTITY_REUSE_FAIL";
    if (family === "stale_temporal") return "TEMPORAL_REUSE_FAIL";
    if (family === "module_switch") return "MODULE_CARRY_OVER";
    if (family === "save_to_query") return "SAVE_QUERY_CONTAMINATION";
    return "CONVERSATIONAL_DRIFT";
  }
  if (family === "stale_entity" && issues.some((x) => x.indexOf("fragment") >= 0)) return "FRAGMENT_REUSE_FAIL";
  if (intent === "clarification" && c.expectRead && !c.allowWriteLast) return "AMBIGUOUS_INPUT";
  if (issues.length === 0) return "HARNESS_OR_GOLD";
  return "TRUE_ENGINE_FAIL";
}

function evaluateTurn(turn, c, isLast) {
  const issues = [];
  if (!isLast) {
    const intent = String(turn.normalizedIntent || "");
    const allowMidWrite =
      c.family === "save_to_query" ||
      c.family === "help_to_save" ||
      c.family === "module_switch" ||
      c.family === "stale_entity" ||
      c.family === "stale_temporal" ||
      c.family === "negation_read_safety";
    if (WRITE_INTENTS.has(intent) && intent !== "create.storage_disambiguation" && !allowMidWrite) {
      issues.push("mid_write_leak:" + intent);
    }
    if (c.family === "help_to_save" && (intent === "assistant.help" || intent === "assistant.capability")) {
      const shell = helpGov.turnWouldLeakSaveShell(turn, { processUserTurn: function () {} });
      for (let hi = 0; hi < shell.length; hi++) issues.push(shell[hi]);
    }
    return issues;
  }
  const intent = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  const allowWrite = c.allowWriteLast === true;
  if (!allowWrite && WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
  if (!allowWrite && ps === "READY_TO_SAVE") issues.push("ready_to_save");
  if (!allowWrite && ps === "STORAGE_DISAMBIGUATION") issues.push("storage_picker");
  if (c.family === "help_to_save" && (intent === "assistant.help" || intent === "assistant.capability") && !allowWrite) {
    const shell = helpGov.turnWouldLeakSaveShell(turn, { processUserTurn: function () {} });
    for (let hi = 0; hi < shell.length; hi++) issues.push("help_save:" + shell[hi]);
  }
  if (c.expectRead && !allowWrite) {
    const readOk =
      READ_OK_INTENTS.has(intent) || intent.indexOf(".read") >= 0 || intent.indexOf(".query") >= 0 || intent.indexOf("assistant.") === 0;
    if (!readOk) issues.push("intent_mismatch:" + intent);
    if (c.expectModule) {
      const mod = moduleOfIntent(intent);
      if (mod !== c.expectModule && mod !== "search" && intent !== "global.search") {
        issues.push("module_leak:" + intent + ":expected=" + c.expectModule);
      }
    }
  }
  if (allowWrite && c.expectModule) {
    const mod = moduleOfIntent(intent);
    if (
      mod !== c.expectModule &&
      WRITE_INTENTS.has(intent) &&
      intent !== "create.storage_disambiguation"
    ) {
      issues.push("module_leak:" + intent);
    }
  }
  return issues;
}

function evaluateCase(eng, c, ctx) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  const steps = Array.isArray(c.chain) && c.chain.length ? c.chain : [c.input];
  let prev = eng.createEmptyDraft();
  let last = null;
  for (let i = 0; i < steps.length; i++) {
    last = eng.processUserTurn(steps[i], prev, ctx);
    const isLast = i === steps.length - 1;
    if (!isLast) {
      const midIntent = String(last.normalizedIntent || "");
      if (c.family === "save_to_query" || c.family === "module_switch") {
        if (WRITE_INTENTS.has(midIntent)) prev = last.draft && last.draft.targetContainer !== "none" ? last.draft : prev;
        else prev = eng.createEmptyDraft();
      } else if (c.family === "help_to_save" && WRITE_INTENTS.has(midIntent)) {
        prev = last.draft && last.draft.targetContainer !== "none" ? last.draft : eng.createEmptyDraft();
      } else if (WRITE_INTENTS.has(midIntent) && c.family !== "negation_read_safety") {
        prev = last.draft && last.draft.targetContainer !== "none" ? last.draft : prev;
      } else {
        prev = eng.createEmptyDraft();
      }
    } else {
      prev = last.draft && last.draft.targetContainer !== "none" ? last.draft : eng.createEmptyDraft();
    }
  }
  const issues = evaluateTurn(last, c, true);
  return {
    id: c.id,
    family: c.family,
    input: c.input,
    issues: issues,
    pass: issues.length === 0,
    intent: last && last.normalizedIntent,
    failClass: issues.length ? classifyOwnershipFail(c, { issues: issues, intent: last && last.normalizedIntent }) : null
  };
}

function runAudit(guardId, cases, reportPath, extraMeta) {
  const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");
  const eng = loadEngine();
  const ctx = lsf.seedCtx();
  let pass = 0;
  let readToCreate = 0;
  const fails = [];
  const classCounts = {};
  for (let i = 0; i < cases.length; i++) {
    const r = evaluateCase(eng, cases[i], ctx);
    if (r.pass) pass++;
    else {
      fails.push(r);
      const fc = r.failClass || "TRUE_ENGINE_FAIL";
      classCounts[fc] = (classCounts[fc] || 0) + 1;
      if ((r.issues || []).some((x) => x.indexOf("write_leak") >= 0 || x === "ready_to_save")) readToCreate++;
    }
  }
  const report = Object.assign(
    {
      guard_id: guardId,
      total: cases.length,
      pass: pass,
      fail: fails.length,
      read_to_create_leak_count: readToCreate,
      accuracy_pct: cases.length ? (pass / cases.length) * 100 : 100,
      PASS_FAIL: fails.length === 0 ? "PASS" : "FAIL",
      first_fail: fails[0] || null,
      generator_based: true,
      replay_governed: true,
      fail_classification: classCounts
    },
    extraMeta || {}
  );
  if (reportPath) {
    try {
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    } catch (eW) {
      void eW;
    }
  }
  return { report: report, fails: fails, classCounts: classCounts };
}

function printHeader(name, report, minPct) {
  const pct = report.accuracy_pct;
  const need = minPct != null ? minPct : 98;
  const ok = report.fail === 0 && pct >= need;
  console.log("=== " + name.toUpperCase() + " ===");
  console.log("pass=" + report.pass + "/" + report.total);
  console.log("read_to_create_leak_count=" + (report.read_to_create_leak_count || 0));
  if (report.fail_classification) {
    console.log("fail_classification=" + JSON.stringify(report.fail_classification));
  }
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  if (report.first_fail) {
    console.log("first_fail_id=" + report.first_fail.id);
    console.log("first_fail_family=" + report.first_fail.family);
    console.log("first_fail_input=" + report.first_fail.input);
    console.log("first_fail_class=" + (report.first_fail.failClass || ""));
    console.log("first_fail_issues=" + (report.first_fail.issues || []).join(","));
  }
  console.log("=== END_" + name.toUpperCase() + " ===");
  return ok;
}

function printDiagnosticSummary(res) {
  const cc = res.classCounts || {};
  console.log("=== SILVER_CONVERSATIONAL_OWNERSHIP_DIAGNOSTIC_V1 ===");
  console.log("total=" + res.report.total);
  console.log("pass=" + res.report.pass);
  console.log("fail=" + res.report.fail);
  console.log("conversational_fail_count=" + res.report.fail);
  console.log("module_carry_over_count=" + (cc.MODULE_CARRY_OVER || 0));
  console.log("save_query_contamination_count=" + (cc.SAVE_QUERY_CONTAMINATION || 0));
  console.log("help_save_contamination_count=" + (cc.HELP_SAVE_CONTAMINATION || 0));
  console.log("fragment_reuse_fail_count=" + (cc.FRAGMENT_REUSE_FAIL || 0));
  console.log("temporal_reuse_fail_count=" + (cc.TEMPORAL_REUSE_FAIL || 0));
  console.log("entity_reuse_fail_count=" + (cc.ENTITY_REUSE_FAIL || 0));
  console.log("true_engine_fail_count=" + (cc.TRUE_ENGINE_FAIL || 0));
  console.log("harness_problem_count=" + (cc.HARNESS_OR_GOLD || 0));
  console.log("ambiguous_input_count=" + (cc.AMBIGUOUS_INPUT || 0));
  console.log("read_to_create_leak_count=" + (res.report.read_to_create_leak_count || 0));
  console.log("PASS_FAIL=" + (res.report.fail === 0 ? "PASS" : "FAIL"));
  if (res.fails[0]) {
    console.log("first_fail_id=" + res.fails[0].id);
    console.log("first_fail_class=" + (res.fails[0].failClass || ""));
    console.log("first_fail_issues=" + (res.fails[0].issues || []).join(","));
  }
  console.log("=== END_SILVER_CONVERSATIONAL_OWNERSHIP_DIAGNOSTIC_V1 ===");
}

module.exports = {
  buildCorpusV1,
  filterFamilies,
  runAudit,
  printHeader,
  printDiagnosticSummary,
  classifyOwnershipFail,
  WRITE_INTENTS
};
