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
  { id: "CQ_001", family: "kdy_jsem_mel", input: "Kdy jsem měl servis auta", expect: "calendar.read" },
  { id: "CQ_002", family: "co_jsem_resil", input: "Co jsem řešil s Pepou minulý měsíc", expect: "calendar.read" },
  { id: "CQ_003", family: "pristi_tyden", input: "Jen mi ukaž co mám příští týden", expect: "calendar.read" },
  { id: "CQ_004", family: "query_readonly_ownership", input: "Neukládej nic, jen mi najdi schůzky s právníkem", expect: "calendar.read" },
  { id: "CQ_005", family: "vcera_dopoledne", input: "Co jsem měl včera dopoledne", expect: "calendar.read" },
  { id: "CQ_006", family: "conversational_retrieval", input: "A ještě mi ukaž co mám v pátek", expect: "calendar.read", chain: ["Co mám zítra?", "A ještě mi ukaž co mám v pátek"] },
  { id: "CQ_007", family: "no_create_chaos", input: "Jen search, nic nevytvářej", expectRead: true },
  { id: "CQ_008", family: "kolem_auta", input: "Co jsem řešil kolem pojištění", expect: "calendar.read" },
  { id: "CQ_009", family: "kdy_jsem_mel", input: "Kdy jsem byl naposledy u doktora", expect: "calendar.read" },
  { id: "CQ_010", family: "fragment_retrieval", input: "Jen mi to ukaž", chain: ["Ulož schůzku zítra v 15", "Jen mi to ukaž"], expectRead: true },
  { id: "CQ_011", family: "no_create_chaos", input: "Neptám se na vytvoření", expectRead: true },
  { id: "CQ_012", family: "kolem_auta", input: "Co mám v kalendáři o autě", expect: "calendar.read" },
  { id: "CQ_013", family: "co_jsem_resil", input: "Co jsem resil s Martinem", expect: "calendar.read" },
  { id: "CQ_014", family: "minuly_mesic", input: "Kolem smlouvy minulý měsíc", expectRead: true },
  { id: "CQ_015", family: "query_readonly_ownership", input: "Jen čtení", expectRead: true },
  { id: "CQ_016", family: "no_create_chaos", input: "Nic neukládej", expectRead: true },
  { id: "CQ_017", family: "conversational_retrieval", input: "A ještě k tomu najdi servis", chain: ["Co mám zítra?", "A ještě k tomu najdi servis"], expectRead: true },
  { id: "CQ_018", family: "pred_tydnem", input: "Co bylo před týdnem", expect: "calendar.read" },
  { id: "CQ_019", family: "pristi_tyden", input: "Co mám zítra", expect: "calendar.read" },
  { id: "CQ_020", family: "minuly_mesic", input: "Co jsem řešil minulý rok", expect: "calendar.read" },
  { id: "CQ_021", family: "s_kym_jsem_byl", input: "S kým jsem byl minulý týden", expect: "calendar.read" },
  { id: "CQ_022", family: "retrieval_after_save", input: "A teď mi najdi co mám příští týden", chain: ["Ulož schůzku zítra v 15", "A teď mi najdi co mám příští týden"], expectRead: true },
  { id: "CQ_023", family: "retrieval_after_help", input: "Co mám zítra v kalendáři", chain: ["Co umíš?", "Co mám zítra v kalendáři"], expect: "calendar.read" },
  { id: "CQ_024", family: "retrieval_under_stale_context", input: "Jen hledám", chain: ["Ulož si že Pepa dluží 500", "Jen hledám"], expectRead: true },
  { id: "CQ_025", family: "mobile_voice_phrasing", input: "Hele co jsem mel vcera u doktora", expect: "calendar.read" },
  { id: "CQ_026", family: "noisy_czech_retrieval", input: "no co mam zitra za schuzky", expect: "calendar.read" },
  { id: "CQ_027", family: "person_ambiguity", input: "Co jsem řešil s Novákem", expect: "calendar.read" },
  { id: "CQ_028", family: "temporal_ambiguity", input: "Co jsem mel minulou stredu", expect: "calendar.read" },
  { id: "CQ_029", family: "retrieval_under_negation", input: "Neukládej nic, jen mi ukaž schůzky", expect: "calendar.read" },
  { id: "CQ_030", family: "retrieval_under_multi_intent", input: "Co mám zítra a ještě mi najdi servis", expectRead: true }
];

const TEMPLATE_BANK = {
  kdy_jsem_mel: [
    "Kdy jsem mel {entity}",
    "Kdy jsem byl u {entity}",
    "Kdy jsem mel schuzku s {person}",
    "Kdy jsem mel naposledy {entity}"
  ],
  co_jsem_resil: [
    "Co jsem resil s {person}",
    "Co jsem resil kolem {topic}",
    "Co jsem resil ohledne {topic}",
    "Co jsem resil minuly mesic s {person}"
  ],
  s_kym_jsem_byl: [
    "S kym jsem byl minuly tyden",
    "S kym jsem mel schuzku minule",
    "S kym jsem byl vcera"
  ],
  kolem_auta: [
    "Co mam v kalendari o {topic}",
    "Co jsem resil kolem {topic}",
    "Kolem {topic} minuly mesic"
  ],
  minuly_mesic: [
    "Co jsem mel minuly mesic",
    "Co jsem resil minuly mesic",
    "Co jsem mel minule"
  ],
  pred_tydnem: [
    "Co bylo pred tydnem",
    "Co jsem mel pred tydnem",
    "Co jsem resil pred tydnem"
  ],
  vcera_dopoledne: [
    "Co jsem mel vcera dopoledne",
    "Co jsem mel vcera rano",
    "Co jsem mel vcera odpoledne"
  ],
  pristi_tyden: [
    "Jen mi ukaz co mam pristi tyden",
    "Co mam pristi tyden",
    "Co mam zitra",
    "Co mam v patek"
  ],
  fragment_retrieval: [
    "Jen mi to ukaz",
    "Jen to ukaz",
    "A jeste to ukaz"
  ],
  noisy_czech_retrieval: [
    "no co mam zitra",
    "hele co jsem mel vcera",
    "prosim co mam pristi tyden",
    "kratce co jsem resil s {person}"
  ],
  conversational_retrieval: [
    "A jeste mi ukaz co mam {day}",
    "A ted mi najdi {q}",
    "A co mam {day}"
  ],
  multi_turn_retrieval: [
    "A co dal",
    "A jeste jednou",
    "A v kalendari"
  ],
  retrieval_after_save: [
    "A ted mi najdi {q}",
    "A jeste mi ukaz {q}",
    "A co mam {day}"
  ],
  retrieval_after_help: [
    "Co mam zitra v kalendari",
    "Co mam {day}",
    "Najdi schuzku s {person}"
  ],
  retrieval_under_negation: [
    "Neukladej nic, jen mi najdi {q}",
    "Neptam se na vytvoreni, jen {q}"
  ],
  retrieval_under_multi_intent: [
    "Co mam zitra a jeste najdi {q}",
    "Jen mi ukaz {q} a pak nic neukladej"
  ],
  retrieval_under_stale_context: [
    "Jen hledam, nic neukladej",
    "Jen search, nic nevytvarej",
    "Jen mi ukaz, nic neukladej"
  ],
  temporal_ambiguity: [
    "Co jsem mel minulou stredu",
    "Co jsem mel minuly patek",
    "Co jsem resil minuly tyden"
  ],
  person_ambiguity: [
    "Co jsem resil s {person}",
    "S kym jsem mel schuzku o {topic}",
    "Kdy jsem mel schuzku s {person}"
  ],
  mobile_voice_phrasing: [
    "hele co jsem mel vcera u {entity}",
    "no co mam zitra za schuzky",
    "vlastne co jsem resil s {person}"
  ],
  query_readonly_ownership: [
    "Jen cteni, nic neukladej",
    "Jen search, nic nevytvarej",
    "Jen mi ukaz {q}, nic neukladej",
    "Neukladej nic, jen mi najdi {q}"
  ],
  no_create_chaos: [
    "Jen search, nic nevytvarej",
    "Nic neukladej",
    "Neptam se na vytvoreni",
    "Jen hledam, nic neukladej"
  ]
};

const ENTITIES = ["doktora", "zubare", "pravnika", "servis auta", "auto"];
const PERSONS = ["Pepou", "Martinou", "Novakem", "Petrem", "Marianou"];
const TOPICS = ["auta", "pojisteni", "smlouvy", "servisu", "banky"];
const DAYS = ["zitra", "patek", "pondeli", "pristi tyden"];
const QUERIES = ["co mam zitra", "schuzky s pravnikem", "servis", "kolem auta", "pristi tyden"];
const FILLERS = ["", "Hele ", "No ", "Prosím ", "Krátce "];

function fillTemplate(tpl, n) {
  return tpl
    .replace(/\{entity\}/g, ENTITIES[n % ENTITIES.length])
    .replace(/\{person\}/g, PERSONS[n % PERSONS.length])
    .replace(/\{topic\}/g, TOPICS[n % TOPICS.length])
    .replace(/\{day\}/g, DAYS[n % DAYS.length])
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
    const pfx = FILLERS[n % FILLERS.length];
    const input = pfx + fillTemplate(tpl, n);
    const entry = {
      id: "CQ_GEN_" + String(n).padStart(4, "0"),
      family: family,
      input: input,
      tier: "B"
    };
    if (
      family === "no_create_chaos" ||
      family === "query_readonly_ownership" ||
      family === "retrieval_under_stale_context" ||
      family === "fragment_retrieval"
    ) {
      entry.expectRead = true;
    } else {
      entry.expect = "calendar.read";
    }
    if (family === "kolem_auta" && /kolem smlouvy/.test(input.toLowerCase())) {
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
    now: new Date("2026-05-04T12:00:00"),
    getEventsSnapshot: function () {
      return [
        { id: "e1", title: "Schůzka s Pepou", startAt: "2026-04-15T10:00:00", endAt: "2026-04-15T11:00:00" },
        { id: "e2", title: "Schůzka s právníkem", startAt: "2026-05-05T15:00:00", endAt: "2026-05-05T16:00:00" },
        { id: "e3", title: "Servis auta", startAt: "2026-04-01T10:00:00", endAt: "2026-04-01T11:00:00" },
        { id: "e4", title: "Doktor dopoledne", startAt: "2026-05-03T09:00:00", endAt: "2026-05-03T10:00:00" }
      ];
    },
    getTasksSnapshot: function () {
      return [{ id: "t1", title: "Pepa smlouva", status: "todo", dueAt: "2026-04-20", note: "", priority: "medium", createdAt: 1, updatedAt: 1 }];
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
  if (e === "calendar.read" && a === "calendar.query") return true;
  if (e === "calendar.read" && a === "global.search") return true;
  if (c.expectRead && (a === "calendar.read" || a === "calendar.query" || a === "global.search" || a === "clarification" || a === "unknown")) {
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
  if (tierB && c.expect && !WRITE_INTENTS.has(intent) && intent !== "assistant.help" && intent !== "assistant.capability") {
    return issues;
  }
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
      prev = last.draft && last.draft.targetContainer !== "none" ? last.draft : prev;
    }
    const issues = evaluateTurn(last, c);
    return { id: c.id, family: c.family, input: c.input, issues: issues, pass: issues.length === 0 };
  }
  const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
  const issues = evaluateTurn(turn, c);
  return { id: c.id, family: c.family, input: c.input, issues: issues, pass: issues.length === 0 };
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
    first_fail: fails[0] || null
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
