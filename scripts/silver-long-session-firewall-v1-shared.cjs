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

const READ_OK_INTENTS = new Set([
  "calendar.read",
  "calendar.query",
  "tasks.read",
  "tasks.query",
  "notes.read",
  "notes.query",
  "global.search",
  "clarification",
  "unknown"
]);

const STATIC_REPLAY = [
  {
    id: "LSF_001",
    family: "save_then_query",
    chain: ["Ulož schůzku zítra v 10 s Pepou", "Co mám dnes?"],
    input: "Co mám dnes?",
    expectRead: true,
    expectModule: "calendar"
  },
  {
    id: "LSF_002",
    family: "save_help_query",
    chain: ["Ulož schůzku zítra v 15", "Co umíš?", "Co mám dnes?"],
    input: "Co mám dnes?",
    expectRead: true,
    expectModule: "calendar"
  },
  {
    id: "LSF_003",
    family: "failed_save_query",
    chain: ["Ulož to", "Kam to uložit?", "Co mám zítra v kalendáři?"],
    input: "Co mám zítra v kalendáři?",
    expectRead: true,
    expectModule: "calendar"
  },
  {
    id: "LSF_004",
    family: "note_calendar_isolation",
    chain: ["Mám poznámku o Frantovi?", "Jaké mám dnes schůzky?"],
    input: "Jaké mám dnes schůzky?",
    expectRead: true,
    expectModule: "calendar"
  },
  {
    id: "LSF_005",
    family: "task_calendar_isolation",
    chain: ["Co mám dnes v úkolech?", "Co mám dnes v kalendáři?"],
    input: "Co mám dnes v kalendáři?",
    expectRead: true,
    expectModule: "calendar"
  },
  {
    id: "LSF_006",
    family: "read_after_clarification",
    chain: ["Do kalendáře nebo úkolů?", "Mám dnes nějaké schůzky?"],
    input: "Mám dnes nějaké schůzky?",
    expectRead: true,
    expectModule: "calendar"
  },
  {
    id: "LSF_007",
    family: "stale_draft_resurrection",
    chain: ["Ulož schůzku zítra v 10", "Nic neukládej", "Co mám dnes?"],
    input: "Co mám dnes?",
    expectRead: true
  },
  {
    id: "LSF_008",
    family: "query_after_failed_save",
    chain: ["Ulož mi to prosím", "Co mám dnes v kalendáři?"],
    input: "Co mám dnes v kalendáři?",
    expectRead: true,
    expectModule: "calendar"
  },
  {
    id: "LSF_009",
    family: "query_after_timestamp_render",
    chain: ["Kdy jsem si poznamenal zálohu?", "Co mám dnes v kalendáři?"],
    input: "Co mám dnes v kalendáři?",
    expectRead: true,
    expectModule: "calendar"
  },
  {
    id: "LSF_010",
    family: "multi_turn_module_isolation",
    chain: ["Najdi poznámku o pojištění", "A teď jen kalendář na zítra"],
    input: "A teď jen kalendář na zítra",
    expectRead: true,
    expectModule: "calendar"
  },
  {
    id: "LSF_011",
    family: "conversation_ownership_reset",
    chain: ["Ulož schůzku zítra v 15", "A ulož si ještě že servis je v úterý", "Ne, to druhé neukládej"],
    input: "Ne, to druhé neukládej",
    expectRead: true
  },
  {
    id: "LSF_012",
    family: "long_mobile_session",
    chain: [
      "Ulož schůzku zítra v 10",
      "Co mám dnes?",
      "Co umíš?",
      "Mám poznámku o autě?",
      "Co mám v úkolech?",
      "Nic neukládej",
      "Co mám zítra?"
    ],
    input: "Co mám zítra?",
    expectRead: true,
    expectModule: "calendar"
  }
];

const TEMPLATE_BANK = {
  save_then_query: [
    { save: "Ulož schůzku {day} v {time} s {person}", query: "Co mám {day}?" },
    { save: "Dej do kalendáře {day} zubař v {time}", query: "Mám {day} nějaké schůzky?" },
    { save: "Ulož {day} schůzku s {person}", query: "Jaké mám {day} schůzky?" }
  ],
  save_help_query: [
    { save: "Ulož schůzku {day} v {time}", help: "Co umíš?", query: "Co mám {day}?" },
    { save: "Zapiš {day} v {time} schůzku", help: "Jak to funguje?", query: "Mám {day} něco v kalendáři?" }
  ],
  failed_save_query: [
    { fail: "Ulož to", clarify: "Kam to uložit?", query: "Co mám {day} v kalendáři?" },
    { fail: "Ulož mi to prosím", query: "Ukaž mi {dayLabel} schůzky." }
  ],
  note_calendar_isolation: [
    { note: "Mám poznámku o {person}?", query: "Jaké mám {day} schůzky?" },
    { note: "Co mám v poznámkách o {topic}?", query: "Co mám {day} v kalendáři?" }
  ],
  task_calendar_isolation: [
    { task: "Co mám {day} v úkolech?", query: "Co mám {day} v kalendáři?" },
    { task: "Najdi úkol kolem {topic}", query: "Mám {day} něco v kalendáři?" }
  ],
  read_after_clarification: [
    { clarify: "Do kalendáře nebo úkolů?", query: "Mám {day} nějaké schůzky?" },
    { clarify: "Kam to mám dát?", query: "Co mám {day} za schůzky?" }
  ],
  stale_draft_resurrection: [
    { save: "Ulož schůzku {day} v {time}", neg: "Nic neukládej", query: "Co mám {day}?" },
    { save: "Ulož {day} v {time}", neg: "Jen to neukládej", query: "Mám {day} něco v kalendáři?" }
  ],
  query_after_failed_save: [
    { fail: "Ulož to", query: "Co mám {day} v kalendáři?" },
    { fail: "Ulož mi to prosím", query: "Ukaž mi {dayLabel} schůzky." }
  ],
  query_after_timestamp_render: [
    { note: "Kdy jsem si poznamenal {topic}?", query: "Co mám {day} v kalendáři?" },
    { note: "Co mám v poznámkách o {topic}?", query: "Mám {day} nějakou schůzku?" }
  ],
  multi_turn_module_isolation: [
    { a: "Najdi poznámku o {topic}", b: "A teď jen kalendář na {day}" },
    { a: "Co mám v úkolech o {topic}?", b: "A v kalendáři na {day}?" }
  ],
  conversation_ownership_reset: [
    {
      chain: ["Ulož schůzku {day} v {time}", "A ulož si ještě že {topic}", "Ne, to druhé neukládej"],
      query: "Ne, to druhé neukládej"
    },
    { chain: ["Ulož poznámku o {topic}", "A ulož schůzku na {day}", "To poslední smaž"], query: "To poslední smaž" }
  ],
  long_mobile_session: [
    {
      chain: [
        "Ulož schůzku {day} v {time}",
        "Co mám {day}?",
        "Co umíš?",
        "Mám poznámku o {topic}?",
        "Co mám v úkolech?",
        "Nic neukládej",
        "Co mám {day2}?"
      ],
      query: "Co mám {day2}?"
    }
  ]
};

const DAYS = ["dnes", "dneska", "zitra", "zittra", "pozitri"];
const DAY_LABELS = ["dnešní", "zítřejší", "pondělní"];
const PERSONS = ["Frantovi", "Pepou", "Martinou"];
const TOPICS = ["auta", "záloze", "pojištění", "servisu"];
const TIMES = ["10:00", "11:30", "15:00", "9:00"];

function fillTokens(s, n) {
  return String(s || "")
    .replace(/\{day\}/g, DAYS[n % DAYS.length])
    .replace(/\{day2\}/g, DAYS[(n + 1) % DAYS.length])
    .replace(/\{dayLabel\}/g, DAY_LABELS[n % DAY_LABELS.length])
    .replace(/\{person\}/g, PERSONS[n % PERSONS.length])
    .replace(/\{topic\}/g, TOPICS[n % TOPICS.length])
    .replace(/\{time\}/g, TIMES[n % TIMES.length]);
}

function buildChainFromTpl(family, tpl, n) {
  if (Array.isArray(tpl.chain)) {
    return tpl.chain.map((s) => fillTokens(s, n));
  }
  if (family === "save_then_query") {
    return [fillTokens(tpl.save, n), fillTokens(tpl.query, n)];
  }
  if (family === "save_help_query") {
    return [fillTokens(tpl.save, n), fillTokens(tpl.help, n), fillTokens(tpl.query, n)];
  }
  if (family === "failed_save_query") {
    const c = [fillTokens(tpl.fail, n)];
    if (tpl.clarify) c.push(fillTokens(tpl.clarify, n));
    c.push(fillTokens(tpl.query, n));
    return c;
  }
  if (family === "note_calendar_isolation") {
    return [fillTokens(tpl.note, n), fillTokens(tpl.query, n)];
  }
  if (family === "task_calendar_isolation") {
    return [fillTokens(tpl.task, n), fillTokens(tpl.query, n)];
  }
  if (family === "read_after_clarification") {
    return [fillTokens(tpl.clarify, n), fillTokens(tpl.query, n)];
  }
  if (family === "stale_draft_resurrection") {
    return [fillTokens(tpl.save, n), fillTokens(tpl.neg, n), fillTokens(tpl.query, n)];
  }
  if (family === "query_after_failed_save") {
    return [fillTokens(tpl.fail, n), fillTokens(tpl.query, n)];
  }
  if (family === "query_after_timestamp_render") {
    return [fillTokens(tpl.note, n), fillTokens(tpl.query, n)];
  }
  if (family === "multi_turn_module_isolation") {
    return [fillTokens(tpl.a, n), fillTokens(tpl.b, n)];
  }
  if (family === "conversation_ownership_reset") {
    return tpl.chain.map((s) => fillTokens(s, n));
  }
  if (family === "long_mobile_session") {
    return tpl.chain.map((s) => fillTokens(s, n));
  }
  return [fillTokens(tpl.query || tpl.input || "", n)];
}

function buildCorpusV1(targetCount) {
  const out = STATIC_REPLAY.slice();
  let n = out.length;
  const families = Object.keys(TEMPLATE_BANK);
  while (out.length < targetCount) {
    const family = families[n % families.length];
    const tpls = TEMPLATE_BANK[family];
    const tpl = tpls[n % tpls.length];
    const chain = buildChainFromTpl(family, tpl, n);
    const input = chain[chain.length - 1];
    const entry = {
      id: "LSF_GEN_" + String(n).padStart(4, "0"),
      family: family,
      chain: chain,
      input: input,
      expectRead: true,
      tier: "B"
    };
    if (
      family === "save_then_query" ||
      family === "save_help_query" ||
      family === "note_calendar_isolation" ||
      family === "task_calendar_isolation" ||
      family === "read_after_clarification" ||
      family === "query_after_failed_save" ||
      family === "query_after_timestamp_render" ||
      family === "long_mobile_session"
    ) {
      entry.expectModule = "calendar";
    }
    out.push(entry);
    n++;
  }
  return out.slice(0, targetCount);
}

function filterFamilies(cases, families) {
  const set = new Set(families);
  return cases.filter((c) => set.has(c.family));
}

function seedCtx() {
  return {
    now: new Date("2026-05-28T12:00:00"),
    getEventsSnapshot: function () {
      return [
        { id: "e1", title: "Schůzka s Pepou", startAt: "2026-05-28T10:00:00", endAt: "2026-05-28T11:00:00" },
        { id: "e2", title: "Schůzka s právníkem", startAt: "2026-05-29T15:00:00", endAt: "2026-05-29T16:00:00" }
      ];
    },
    getTasksSnapshot: function () {
      return [{ id: "t1", title: "Úkol kolem auta", status: "todo", dueAt: "2026-05-28", note: "", priority: "medium", createdAt: 1, updatedAt: 1 }];
    },
    getNotesSnapshot: function () {
      return [{ id: "n1", title: "Záloha", content: "záloha server", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }];
    }
  };
}

function moduleOfIntent(intent) {
  const i = String(intent || "");
  if (i.indexOf("calendar") === 0) return "calendar";
  if (i.indexOf("tasks") === 0) return "tasks";
  if (i.indexOf("notes") === 0) return "notes";
  if (i === "global.search") return "search";
  return "other";
}

function classifyFail(c, r) {
  const issues = r.issues || [];
  const intent = String(r.intent || "");
  if (issues.some((x) => x === "ready_to_save" || x.indexOf("write_leak") >= 0)) {
    if (c.family === "read_after_clarification" || c.family === "failed_save_query") return "CLARIFICATION_LEAK";
    return "READ_CREATE_CONFLICT";
  }
  if (issues.some((x) => x.indexOf("module_leak") >= 0)) return "MODULE_LEAK";
  if (c.expectModule && moduleOfIntent(intent) !== c.expectModule) return "MODULE_LEAK";
  if (
    c.family === "stale_draft_resurrection" ||
    c.family === "conversation_ownership_reset" ||
    c.family === "query_after_failed_save"
  ) {
    return "STALE_CONTEXT_LEAK";
  }
  if (intent === "clarification" && c.expectRead) return "CLARIFICATION_LEAK";
  if (issues.length === 0) return "HARNESS_OR_GOLD";
  return "TRUE_ENGINE_FAIL";
}

function evaluateTurn(turn, c, isLast) {
  const issues = [];
  if (!isLast) return issues;
  const intent = String(turn.normalizedIntent || "");
  const ps = String(turn.processingState || "");
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
  if (ps === "READY_TO_SAVE") issues.push("ready_to_save");
  if (ps === "STORAGE_DISAMBIGUATION") issues.push("storage_picker");
  if (c.expectRead) {
    if (!READ_OK_INTENTS.has(intent) && !intent.endsWith(".read") && !intent.endsWith(".query")) {
      issues.push("intent_mismatch:" + intent);
    }
    if (c.expectModule) {
      const mod = moduleOfIntent(intent);
      if (mod !== c.expectModule && mod !== "search" && intent !== "global.search") {
        if (c.expectModule === "calendar" && (intent === "tasks.read" || intent === "tasks.query" || intent === "notes.read" || intent === "notes.query")) {
          issues.push("module_leak:" + intent);
        }
        if (c.expectModule === "tasks" && (intent === "calendar.read" || intent === "calendar.query")) {
          issues.push("module_leak:" + intent);
        }
        if (c.expectModule === "notes" && (intent === "calendar.create" || intent === "tasks.create")) {
          issues.push("module_leak:" + intent);
        }
      }
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
      if (WRITE_INTENTS.has(midIntent) && c.family !== "save_then_query" && c.family !== "save_help_query" && c.family !== "long_mobile_session") {
        prev = last.draft && last.draft.targetContainer !== "none" ? last.draft : eng.createEmptyDraft();
      } else if (last.draft && last.draft.targetContainer !== "none" && c.family.indexOf("save") >= 0) {
        prev = last.draft;
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
    intent: last.normalizedIntent,
    ps: last.processingState,
    failClass: issues.length ? classifyFail(c, { issues: issues, intent: last.normalizedIntent }) : null
  };
}

function runAudit(guardId, cases, reportPath, extraMeta) {
  const eng = loadEngine();
  const ctx = seedCtx();
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
    console.log("first_fail_intent=" + (report.first_fail.intent || ""));
  }
  console.log("=== END_" + name.toUpperCase() + " ===");
  return ok;
}

module.exports = {
  STATIC_REPLAY,
  buildCorpusV1,
  filterFamilies,
  runAudit,
  printHeader,
  seedCtx,
  classifyFail,
  WRITE_INTENTS
};
