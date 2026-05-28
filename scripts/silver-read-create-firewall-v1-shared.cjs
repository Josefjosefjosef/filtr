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

const STATIC_REPLAY = [
  { id: "RCF_001", family: "calendar_read_no_create", input: "Mám dneska nějaký schůzky?", expect: "calendar.read" },
  { id: "RCF_002", family: "calendar_read_no_create", input: "Mám dnes nějaké schůzky?", expect: "calendar.read" },
  { id: "RCF_003", family: "calendar_read_no_create", input: "Mám dneska nějakou schůzku?", expect: "calendar.read" },
  { id: "RCF_004", family: "calendar_read_no_create", input: "Co mám dneska za schůzky?", expect: "calendar.read" },
  { id: "RCF_005", family: "calendar_read_no_create", input: "Jaké mám dnes schůzky?", expect: "calendar.read" },
  { id: "RCF_006", family: "calendar_read_no_create", input: "Mám dnes něco v kalendáři?", expect: "calendar.read" },
  { id: "RCF_007", family: "calendar_read_no_create", input: "Čeká mě dnes něco?", expect: "calendar.read" },
  { id: "RCF_008", family: "calendar_read_no_create", input: "Kdy mám dnes schůzku?", expect: "calendar.read" },
  { id: "RCF_009", family: "calendar_read_no_create", input: "Ukaž mi dnešní schůzky.", expect: "calendar.read" },
  { id: "RCF_010", family: "calendar_read_no_create", input: "Najdi mi schůzky na dnešek.", expect: "calendar.read" },
  { id: "RCF_011", family: "task_read_no_create", input: "Mám dneska nějaké úkoly?", expect: "tasks.read" },
  { id: "RCF_012", family: "task_read_no_create", input: "Co mám dnes v úkolech?", expect: "tasks.read" },
  { id: "RCF_013", family: "task_read_no_create", input: "Ukaž mi úkoly na dnešek.", expect: "tasks.read" },
  { id: "RCF_014", family: "task_read_no_create", input: "Čeká mě nějaký úkol?", expect: "tasks.read" },
  { id: "RCF_015", family: "task_read_no_create", input: "Najdi mi úkol kolem auta.", expect: "tasks.read" },
  { id: "RCF_016", family: "note_read_no_create", input: "Mám poznámku o Frantovi?", expect: "notes.read" },
  { id: "RCF_017", family: "note_read_no_create", input: "Co mám v poznámkách o záloze?", expect: "notes.read" },
  { id: "RCF_018", family: "note_read_no_create", input: "Najdi mi poznámku o pojištění.", expect: "notes.read" },
  { id: "RCF_019", family: "note_read_no_create", input: "Ukaž mi poznámky o autě.", expect: "notes.read" },
  { id: "RCF_020", family: "note_read_no_create", input: "Kdy jsem si poznamenal zálohu?", expect: "notes.read" },
  {
    id: "RCF_021",
    family: "read_after_save",
    input: "Mám dneska nějaký schůzky?",
    chain: ["Ulož mi do kalendáře schůzku s Pepou Skalickým v 10:30", "Mám dneska nějaký schůzky?"],
    expectRead: true
  },
  {
    id: "RCF_022",
    family: "read_after_help",
    input: "Mám dnes něco v kalendáři?",
    chain: ["Co umíš?", "Mám dnes něco v kalendáři?"],
    expect: "calendar.read"
  },
  {
    id: "RCF_023",
    family: "negated_read",
    input: "Neukládej nic, jen mi ukaž dnešní schůzky.",
    expect: "calendar.read"
  },
  {
    id: "RCF_024",
    family: "negated_read",
    input: "Nic nevytvářej, jen mi najdi úkoly.",
    expectRead: true
  },
  {
    id: "RCF_025",
    family: "negated_read",
    input: "Jen čti, co mám v poznámkách.",
    expectRead: true
  }
];

const TEMPLATE_BANK = {
  calendar_read_no_create: [
    "Mám {day} nějaké schůzky?",
    "Mám {day} nějakou schůzku?",
    "Co mám {day} za schůzky?",
    "Jaké mám {day} schůzky?",
    "Mám {day} něco v kalendáři?",
    "Čeká mě {day} něco?",
    "Kdy mám {day} schůzku?",
    "Ukaž mi {dayLabel} schůzky.",
    "Najdi mi schůzky na {day}.",
    "Co je v kalendáři {day}?"
  ],
  task_read_no_create: [
    "Mám {day} nějaké úkoly?",
    "Co mám {day} v úkolech?",
    "Ukaž mi úkoly na {day}.",
    "Čeká mě nějaký úkol {day}?",
    "Najdi mi úkol kolem {topic}.",
    "Co mám v úkolech o {topic}?"
  ],
  note_read_no_create: [
    "Mám poznámku o {person}?",
    "Co mám v poznámkách o {topic}?",
    "Najdi mi poznámku o {topic}.",
    "Ukaž mi poznámky o {topic}.",
    "Kdy jsem si poznamenal {topic}?"
  ],
  read_after_save: [
    "A teď {q}",
    "Mám {day} nějaký schůzky?",
    "Co mám {day} v kalendáři?"
  ],
  read_after_help: [
    "Co mám {day} v kalendáři?",
    "Mám {day} něco v kalendáři?",
    "Najdi schůzku s {person}"
  ],
  mobile_read_no_create: [
    "hele mam {day} nejaky schuzky",
    "no co mam {day} v kalendari",
    "prosim ukaz mi schuzky na {day}"
  ],
  noisy_czech_read_no_create: [
    "no co mam {day} za schuzky",
    "hele mam {day} neco v kalendari",
    "kratce cekej me {day} neco",
    "vlastne co mam {day} v ukolech"
  ],
  long_session_read_create_firewall: [
    "Mám {day} nějaké schůzky?",
    "Co mám {day}?",
    "Jen mi ukaž kalendář na {day}"
  ],
  negated_read: [
    "Neukladej nic, jen mi ukaz {q}",
    "Nic nevytvarej, jen mi najdi {q}",
    "Jen cti, co mam v poznamkach o {topic}"
  ]
};

const DAYS = ["dnes", "dneska", "zitra", "zittra", "pozitri"];
const DAY_LABELS = ["dnešní", "zítřejší", "pondělní"];
const PERSONS = ["Frantovi", "Pepou", "Martinou", "Novakem"];
const TOPICS = ["auta", "záloze", "pojištění", "servisu", "smlouvy"];
const QUERIES = ["dnešní schůzky", "úkoly na dnes", "schůzky s právníkem", "co mám zítra"];
const SAVE_CHAIN = [
  "Ulož mi do kalendáře schůzku s Pepou Skalickým v 10:30",
  "Ulož zítra v 10 schůzka s Kubou",
  "Dej do kalendáře zítra zubař v 11"
];
const HELP_CHAIN = ["Co umíš?", "Co všechno umíš?", "Jak to funguje?"];

function fillTemplate(tpl, n) {
  return tpl
    .replace(/\{day\}/g, DAYS[n % DAYS.length])
    .replace(/\{dayLabel\}/g, DAY_LABELS[n % DAY_LABELS.length])
    .replace(/\{person\}/g, PERSONS[n % PERSONS.length])
    .replace(/\{topic\}/g, TOPICS[n % TOPICS.length])
    .replace(/\{q\}/g, QUERIES[n % QUERIES.length]);
}

function buildCorpusV1(targetCount) {
  const out = STATIC_REPLAY.slice();
  let n = out.length;
  const families = Object.keys(TEMPLATE_BANK);
  while (out.length < targetCount) {
    const family = families[n % families.length];
    const tpls = TEMPLATE_BANK[family];
    const tpl = tpls[n % tpls.length];
    const input = fillTemplate(tpl, n);
    const entry = { id: "RCF_GEN_" + String(n).padStart(4, "0"), family: family, input: input, tier: "B" };
    if (family === "read_after_save") {
      entry.chain = [SAVE_CHAIN[n % SAVE_CHAIN.length], input];
      entry.expectRead = true;
    } else if (family === "read_after_help") {
      entry.chain = [HELP_CHAIN[n % HELP_CHAIN.length], input];
      entry.expect = "calendar.read";
    } else if (family === "negated_read" || family === "mobile_read_no_create" || family === "noisy_czech_read_no_create") {
      entry.expectRead = true;
    } else if (family === "task_read_no_create") {
      entry.expect = "tasks.read";
    } else if (family === "note_read_no_create") {
      entry.expect = "notes.read";
    } else {
      entry.expect = "calendar.read";
    }
    if (family === "long_session_read_create_firewall") {
      entry.chain = [SAVE_CHAIN[n % SAVE_CHAIN.length], HELP_CHAIN[n % HELP_CHAIN.length], input];
      entry.expectRead = true;
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

function intentOk(expect, actual, c) {
  const e = String(expect || "");
  const a = String(actual || "");
  if (!e) return true;
  if (e === a) return true;
  if (e === "calendar.read" && (a === "calendar.query" || a === "global.search")) return true;
  if (e === "tasks.read" && a === "tasks.query") return true;
  if (e === "notes.read" && a === "notes.query") return true;
  if (c.expectRead && !WRITE_INTENTS.has(a) && a.indexOf(".read") > 0) return true;
  if (c.expectRead && (a === "clarification" || a === "unknown")) return true;
  return false;
}

function evaluateTurn(turn, c) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  const tierB = c.tier === "B" || String(c.id || "").indexOf("_GEN_") >= 0;
  if (WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
  if (turn.processingState === "READY_TO_SAVE") issues.push("ready_to_save");
  if (turn.processingState === "STORAGE_DISAMBIGUATION") issues.push("storage_picker");
  if (tierB && !c.expect && c.expectRead) return issues;
  if (c.expect && !intentOk(c.expect, intent, c)) {
    issues.push("intent_mismatch:" + intent + "!=expected:" + c.expect);
  }
  if (c.expectRead && WRITE_INTENTS.has(intent)) issues.push("write_leak:" + intent);
  return issues;
}

function evaluateCase(eng, c, ctx) {
  try {
    if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
  } catch (e0) {
    void e0;
  }
  if (Array.isArray(c.chain) && c.chain.length > 1) {
    let prev = eng.createEmptyDraft();
    let last = null;
    for (let i = 0; i < c.chain.length; i++) {
      last = eng.processUserTurn(c.chain[i], prev, ctx);
      prev = last.draft && last.draft.targetContainer !== "none" ? last.draft : eng.createEmptyDraft();
    }
    const issues = evaluateTurn(last, c);
    return { id: c.id, family: c.family, input: c.input, issues: issues, pass: issues.length === 0, intent: last.normalizedIntent, ps: last.processingState };
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const issues = evaluateTurn(turn, c);
  return { id: c.id, family: c.family, input: c.input, issues: issues, pass: issues.length === 0, intent: turn.normalizedIntent, ps: turn.processingState };
}

function runAudit(guardId, cases, reportPath, extraMeta) {
  const eng = loadEngine();
  const ctx = seedCtx();
  let pass = 0;
  let readToCreate = 0;
  const fails = [];
  for (let i = 0; i < cases.length; i++) {
    const r = evaluateCase(eng, cases[i], ctx);
    if (r.pass) pass++;
    else {
      fails.push(r);
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
      generator_based: true
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
  return { report: report, fails: fails };
}

function printHeader(name, report, minPct) {
  const pct = report.accuracy_pct;
  const need = minPct != null ? minPct : 95;
  const ok = report.fail === 0 && pct >= need;
  console.log("=== " + name.toUpperCase() + " ===");
  console.log("pass=" + report.pass + "/" + report.total);
  console.log("read_to_create_leak_count=" + (report.read_to_create_leak_count || 0));
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  if (report.first_fail) {
    console.log("first_fail_id=" + report.first_fail.id);
    console.log("first_fail_input=" + report.first_fail.input);
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
  WRITE_INTENTS
};
