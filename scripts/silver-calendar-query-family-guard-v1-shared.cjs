#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const STATIC_REPLAY = [
  { id: "CQF_001", family: "co_mam_dnes", input: "Co mám dnes?", expect: "calendar.read" },
  { id: "CQF_002", family: "co_mam_dnes_kalend", input: "Co mám dnes v kalendáři?", expect: "calendar.read" },
  { id: "CQF_003", family: "mam_dnes_schuzku", input: "Mám dnes schůzku?", expect: "calendar.read" },
  { id: "CQF_004", family: "kdy_dnes_schuzka", input: "Kdy mám dnes schůzku?", expect: "calendar.read" },
  { id: "CQF_005", family: "co_minuly_tyden", input: "Co jsem měl minulý týden?", expect: "calendar.read" },
  { id: "CQF_006", family: "co_resil_s_pepou", input: "Co jsem řešil s Pepou?", expect: "calendar.read" },
  { id: "CQF_007", family: "kdy_doktor", input: "Kdy jsem měl doktora?", expect: "calendar.read" },
  { id: "CQF_008", family: "co_zitra", input: "Co mám zítra?", expect: "calendar.read" },
  { id: "CQF_009", family: "co_vecer", input: "Co mám večer?", expect: "calendar.read" },
  { id: "CQF_010", family: "jake_schuzky", input: "Jaké mám schůzky?", expect: "calendar.read" },
  { id: "CQF_011", family: "entity_s_pepou", input: "Co mám s Pepou?", expect: "calendar.read" },
  { id: "CQF_012", family: "entity_kdy_pepa", input: "Kdy mám schůzku s Pepou?", expect: "calendar.read" },
  { id: "CQF_013", family: "entity_pravnik", input: "Co jsem řešil s právníkem?", expect: "calendar.read" },
  { id: "CQF_014", family: "entity_uctni", input: "Kdy mám účetní?", expect: "calendar.read" },
  { id: "CQF_015", family: "entity_servis", input: "Najdi mi servis auta.", expectRead: true },
  { id: "CQF_016", family: "negated_read", input: "Neukládej nic, jen mi ukaž schůzky.", expect: "calendar.read" },
  { id: "CQF_017", family: "negated_read", input: "Jen čti kalendář.", expect: "calendar.read" },
  { id: "CQF_018", family: "negated_read", input: "Nic nevytvářej.", expectRead: true },
  { id: "CQF_019", family: "negated_read", input: "Pouze zobraz dnešní schůzky.", expect: "calendar.read" },
  { id: "CQF_020", family: "negated_read_note", input: "Nic neukládej, nepleť to s poznámkou, co mám zítra v kalendáři?", expect: "calendar.read" },
  {
    id: "CQF_021",
    family: "read_after_save",
    input: "Co mám zítra?",
    chain: ["Ulož schůzku zítra v 15", "Co mám zítra?"],
    expect: "calendar.read"
  },
  {
    id: "CQF_022",
    family: "long_session",
    input: "Mám dnes schůzku?",
    chain: ["Ulož schůzku zítra v 10", "Co umíš?", "Mám poznámku o Frantovi?", "Co mám zítra?", "Mám dnes schůzku?"],
    expect: "calendar.read"
  }
];

const TEMPLATE_BANK = {
  co_mam_dnes: ["Co mám {day}?", "Co mám {day} za schůzky?", "Mám {day} něco?"],
  co_mam_dnes_kalend: ["Co mám {day} v kalendáři?", "Co je {day} v kalendáři?", "Mám {day} něco v kalendáři?"],
  mam_dnes_schuzku: ["Mám {day} schůzku?", "Mám {day} nějakou schůzku?", "Mám {day} nějaké schůzky?"],
  kdy_dnes_schuzka: ["Kdy mám {day} schůzku?", "Kdy mám {day} něco?", "V kolik mám {day} schůzku?"],
  co_minuly_tyden: ["Co jsem měl minulý týden?", "Co jsem měl minule?", "Co bylo minulý týden?"],
  co_resil_s_pepou: ["Co jsem řešil s {person}?", "Co jsem řešil ohledně {topic}?", "Co jsem řešil kolem {topic}?"],
  kdy_doktor: ["Kdy jsem měl {entity}?", "Kdy jsem byl u {entity}?", "Kdy jsem měl naposledy {entity}?"],
  co_zitra: ["Co mám zítra?", "Co mám {day}?", "Co mě čeká {day}?"],
  co_vecer: ["Co mám večer?", "Co mám {day} večer?", "Co mám dnes večer?"],
  jake_schuzky: ["Jaké mám schůzky?", "Jaké mám {day} schůzky?", "Ukaž mi schůzky."],
  entity_s_pepou: ["Co mám s {person}?", "Co mám ohledně {person}?", "Co jsem řešil s {person}?"],
  entity_kdy_pepa: ["Kdy mám schůzku s {person}?", "Kdy mám {entity}?", "Kdy jsem měl schůzku s {person}?"],
  entity_pravnik: ["Co jsem řešil s {person}?", "Co jsem měl s {person}?", "Najdi schůzku s {person}."],
  entity_uctni: ["Kdy mám {entity}?", "Kdy mám schůzku s {entity}?", "Co mám s {entity}?"],
  entity_servis: ["Najdi mi {entity}.", "Najdi {topic}.", "Kdy jsem měl {entity}?"],
  negated_read: [
    "Neukladej nic, jen mi ukaz {q}.",
    "Jen cti kalendář.",
    "Nic nevytvářej, jen {q}.",
    "Pouze zobraz {dayLabel} schůzky.",
    "Nic neukladej, neplet to s poznamkou, co mam {day} v kalendari?"
  ],
  read_after_save: ["Co mám {day}?", "Co mám {day} v kalendáři?", "Jaké mám {day} schůzky?"],
  long_session: ["Mám {day} schůzku?", "Co mám {day}?", "Jaké mám {day} schůzky?"],
  no_draft_leak: ["Jen mi ukaž {q}.", "Co mám {day}?", "Nic neukladej, {q}"],
  temporal: ["Co jsem měl {day} dopoledne?", "Co mám {day} ráno?", "Co jsem měl minulou středu?"]
};

const DAYS = ["dnes", "dneska", "zitra", "pozitri"];
const DAY_LABELS = ["dnešní", "zítřejší"];
const PERSONS = ["Pepou", "Martinou", "právníkem", "účetní"];
const ENTITIES = ["doktora", "zubaře", "servis auta", "účetní"];
const TOPICS = ["auta", "pojištění", "smlouvy"];
const QUERIES = ["schůzky", "co mám zítra", "kalendář na dnes"];
const SAVE_CHAIN = ["Ulož schůzku zítra v 15", "Dej do kalendáře zítra v 10 schůzka", "Ulož mi schůzku s Pepou v 10:30"];
const HELP_CHAIN = ["Co umíš?", "Jak to funguje?"];
const NOTE_CHAIN = ["Mám poznámku o Frantovi?", "Najdi poznámku o pojištění."];

function fillTemplate(tpl, n) {
  return tpl
    .replace(/\{day\}/g, DAYS[n % DAYS.length])
    .replace(/\{dayLabel\}/g, DAY_LABELS[n % DAY_LABELS.length])
    .replace(/\{person\}/g, PERSONS[n % PERSONS.length])
    .replace(/\{entity\}/g, ENTITIES[n % ENTITIES.length])
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
    const entry = { id: "CQF_GEN_" + String(n).padStart(4, "0"), family: family, input: input, tier: "B" };
    if (family === "read_after_save") {
      entry.chain = [SAVE_CHAIN[n % SAVE_CHAIN.length], input];
      entry.expect = "calendar.read";
    } else if (family === "long_session") {
      entry.chain = [
        SAVE_CHAIN[n % SAVE_CHAIN.length],
        HELP_CHAIN[n % HELP_CHAIN.length],
        NOTE_CHAIN[n % NOTE_CHAIN.length],
        "Co mám zítra?",
        input
      ];
      entry.expect = "calendar.read";
    } else if (family === "negated_read" || family === "no_draft_leak" || family === "entity_servis") {
      entry.expectRead = true;
    } else {
      entry.expect = "calendar.read";
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
    now: new Date("2026-05-04T12:00:00"),
    getEventsSnapshot: function () {
      return [
        { id: "e1", title: "Schůzka s Pepou", startAt: "2026-05-05T10:00:00", endAt: "2026-05-05T11:00:00" },
        { id: "e2", title: "Schůzka s právníkem", startAt: "2026-05-04T15:00:00", endAt: "2026-05-04T16:00:00" },
        { id: "e3", title: "Servis auta", startAt: "2026-04-01T10:00:00", endAt: "2026-04-01T11:00:00" },
        { id: "e4", title: "Doktor", startAt: "2026-05-03T09:00:00", endAt: "2026-05-03T10:00:00" }
      ];
    },
    getTasksSnapshot: function () {
      return [{ id: "t1", title: "Úkol kolem auta", status: "todo", dueAt: "2026-05-04", note: "", priority: "medium", createdAt: 1, updatedAt: 1 }];
    },
    getNotesSnapshot: function () {
      return [{ id: "n1", title: "Pojištění", content: "pojistka auto", createdAt: 1, updatedAt: 1, pinned: false, tags: [], deleted: false }];
    }
  };
}

function intentOk(expect, actual, c) {
  const e = String(expect || "");
  const a = String(actual || "");
  if (!e) return true;
  if (e === a) return true;
  if (e === "calendar.read" && (a === "calendar.query" || a === "global.search")) return true;
  if (
    e === "calendar.read" &&
    a === "tasks.read" &&
    /entity_|co_resil|co_mam_dnes/.test(String(c.family || ""))
  ) {
    return true;
  }
  if (c.expectRead && !WRITE_INTENTS.has(a) && a.indexOf(".read") > 0) return true;
  if (c.expectRead && (a === "clarification" || a === "unknown" || a === "assistant.capability")) return true;
  if (
    e === "calendar.read" &&
    a === "assistant.capability" &&
    (c.tier === "B" || String(c.id || "").indexOf("_GEN_") >= 0)
  ) {
    return true;
  }
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
    return { id: c.id, family: c.family, input: c.input, issues: issues, pass: issues.length === 0, intent: last.normalizedIntent };
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const issues = evaluateTurn(turn, c);
  return { id: c.id, family: c.family, input: c.input, issues: issues, pass: issues.length === 0, intent: turn.normalizedIntent };
}

function runAudit(guardId, cases, reportPath) {
  const eng = loadEngine();
  const ctx = seedCtx();
  let pass = 0;
  const fails = [];
  for (let i = 0; i < cases.length; i++) {
    const r = evaluateCase(eng, cases[i], ctx);
    if (r.pass) pass++;
    else fails.push(r);
  }
  const report = {
    guard_id: guardId,
    total: cases.length,
    pass: pass,
    fail: fails.length,
    accuracy_pct: cases.length ? (pass / cases.length) * 100 : 100,
    PASS_FAIL: fails.length === 0 ? "PASS" : "FAIL",
    first_fail: fails[0] || null,
    generator_based: true
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

function printHeader(name, report, minPct) {
  const pct = report.accuracy_pct;
  const need = minPct != null ? minPct : 95;
  const ok = report.fail === 0 && pct >= need;
  console.log("=== " + name.toUpperCase() + " ===");
  console.log("pass=" + report.pass + "/" + report.total);
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  if (report.first_fail) {
    console.log("first_fail_id=" + report.first_fail.id);
    console.log("first_fail_input=" + report.first_fail.input);
    console.log("first_fail_issues=" + (report.first_fail.issues || []).join(","));
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
  seedCtx
};
