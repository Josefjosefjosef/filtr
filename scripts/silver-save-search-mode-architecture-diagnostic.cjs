/**
 * SILVER_SAVE_SEARCH_MODE_ARCHITECTURE_V1 — narrow engine integration diagnostic.
 * 20 save/search audit families + manual product probes.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HARNESS_ID = "silver_save_search_mode_architecture_v1";
const REPORT_JSON = path.join(__dirname, "silver-save-search-mode-architecture-diagnostic-report.json");
const FIXED_NOW_ISO = "2026-05-04T12:00:00";

const core = require("./rhc-v3-deterministic-core.cjs");
const actionCore = require("./silver-action-mode-v1-core.cjs");
const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const searchCore = require("./silver-search-understanding-v1-core.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const antiDup = require("./silver-audit-anti-duplication-v1.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, ctxForCase, foldCs, hasNegWrite } = harness;

const AUDIT_FAMILIES = [
  "save_mode_structured_draft_card",
  "search_mode_direct_answer",
  "create_never_direct_answer_without_card",
  "query_never_draft_card",
  "calendar_create_card_required",
  "task_create_card_required",
  "note_create_card_required",
  "calendar_query_no_card",
  "task_query_no_card",
  "note_query_no_card",
  "global_search_no_card",
  "count_query_no_card",
  "filter_query_no_card",
  "continue_query_no_card",
  "full_list_query_no_card",
  "completed_tasks_query_no_card",
  "event_note_not_notes_create",
  "task_note_not_note_body",
  "clean_search_answer_no_duplicates",
  "save_payload_clean_before_card",
];

const MANUAL_SAVE_PROBES = [
  {
    id: "save_cal_novotny",
    input: "Ulož mi do kalendáře zítra schůzku s Novotným v 15 hodin",
    expectIntent: "calendar.create",
    expectMode: "save",
    expectCard: "calendar_draft",
    group: "calendar_write",
  },
  {
    id: "save_task_rohliky",
    input: "Připomeň mi koupit 10 rohlíků zítra",
    expectIntent: "tasks.create",
    expectMode: "save",
    expectCard: "task_draft",
    group: "task_write",
  },
  {
    id: "save_note_pepsi",
    input: "Ulož mi do poznámky že pepsi colu prodávají v plastových lahvích",
    expectIntent: "notes.create",
    expectMode: "save",
    expectCard: "note_draft",
    group: "note_write",
  },
];

const MANUAL_SEARCH_PROBES = [
  {
    id: "search_cal_kdy_novotny",
    input: "Kdy mám schůzku s Novotným?",
    expectIntent: "calendar.read",
    expectMode: "search",
    expectCard: "read_card",
    group: "calendar_query",
  },
  {
    id: "search_cal_count_next_week",
    input: "Kolik mám příští týden schůzek?",
    expectIntent: "calendar.read",
    expectMode: "search",
    expectCard: "read_card",
    group: "calendar_query",
  },
  {
    id: "search_task_completed",
    input: "Jaké mám hotové úkoly?",
    expectIntent: "tasks.read",
    expectMode: "search",
    expectCard: "read_card",
    group: "task_query",
  },
  {
    id: "search_note_adamek",
    input: "Najdi mi v poznámkách kdy má Adámek narozeniny",
    expectIntent: "notes.read",
    expectMode: "search",
    expectCard: "read_card",
    group: "note_query",
  },
  {
    id: "search_note_full_list",
    input: "Vypiš všech 18 poznámek",
    expectIntent: "notes.read",
    expectMode: "search",
    expectCard: "read_card",
    group: "note_query",
  },
  {
    id: "search_continue",
    input: "Vypiš zbytek",
    expectIntent: "global.search",
    expectMode: "search",
    expectCard: "read_card",
    group: "note_query",
    acceptIntents: ["notes.read", "global.search", "tasks.read", "calendar.read"],
  },
];

const CASES_PER_FAMILY = parseInt(process.env.SSMAV1_CASES_PER_FAMILY || "20", 10);

function escapeField(s) {
  return String(s == null ? "" : s)
    .replace(/\r?\n/g, "\\n")
    .replace(/=/g, "\uFF1D");
}

function pickFrom(rng, arr) {
  return core.pickFrom(rng, arr);
}

function buildFamilyTemplates() {
  return {
    save_mode_structured_draft_card: [
      "Ulož mi schůzku s {person} {date} v {time}",
      "Přidej {date} v {time} schůzku s {person}",
      "Hoď mi do kalendáře {date} schůzku s {person}",
    ],
    search_mode_direct_answer: [
      "Kdy mám schůzku s {person}?",
      "Co mám {range} v kalendáři?",
      "Najdi {topic} v poznámkách",
    ],
    create_never_direct_answer_without_card: [
      "Ulož mi {date} v {time} schůzku s {person}",
      "Připomeň mi {task} {date}",
      "Ulož poznámku {note}",
    ],
    query_never_draft_card: [
      "Kolik mám {range} schůzek?",
      "Jaké mám hotové úkoly?",
      "Kde je {topic} v poznámkách?",
    ],
    calendar_create_card_required: [
      "Ulož mi do kalendáře {date} schůzku s {person} v {time}",
      "Dej mi do kalendáře {date} v {time} schůzku s {person}",
    ],
    task_create_card_required: [
      "Připomeň mi {task} {date}",
      "Ulož úkol {task} do {date}",
    ],
    note_create_card_required: [
      "Ulož mi do poznámky {note}",
      "Nová poznámka {note}",
    ],
    calendar_query_no_card: [
      "Kdy mám schůzku s {person}?",
      "Kolik mám {range} schůzek?",
      "Co mám {range} naplánované?",
    ],
    task_query_no_card: [
      "Jaké mám hotové úkoly?",
      "Vypiš aktivní úkoly",
      "Kolik mám dokončených úkolů?",
    ],
    note_query_no_card: [
      "Najdi {topic} v poznámkách",
      "Kde je {note} v poznámkách?",
      "Vypiš všech {count} poznámek",
    ],
    global_search_no_card: [
      "Najdi {topic} všude",
      "Kde mám {topic}?",
      "Hledej {person} v datech",
    ],
    count_query_no_card: [
      "Kolik mám {range} schůzek?",
      "Kolik mám hotových úkolů?",
      "Kolik poznámek mám k {topic}?",
    ],
    filter_query_no_card: [
      "Jen hotové úkoly",
      "Jen aktivní úkoly {range}",
      "Jen pracovní úkoly",
    ],
    continue_query_no_card: ["vypiš zbytek", "ukaž další", "pokračuj ve výpisu"],
    full_list_query_no_card: [
      "Vypiš všech {count} poznámek",
      "Vypiš všechny schůzky {range}",
    ],
    completed_tasks_query_no_card: [
      "Jaké mám hotové úkoly?",
      "Vypiš dokončené úkoly",
      "Kolik mám splněných úkolů?",
    ],
    event_note_not_notes_create: [
      "Schůzka s {person} {date} v {time} a do poznámky {note}",
      "Ulož schůzku s {person} {date} a připomeň si {note}",
    ],
    task_note_not_note_body: [
      "Úkol {task} do poznámky k úkolu {note}",
      "Přidej úkol {task} s poznámkou {note}",
    ],
    clean_search_answer_no_duplicates: [
      "Najdi v poznámkách {note}",
      "Kde je {topic} v poznámkách?",
    ],
    save_payload_clean_before_card: [
      "Ulož mi schůzku kterou mám jít {date} s {person} v {time} v {place} a připomeň mi {note}",
      "Hoď mi do kalendáře {date} v {time} schůzku s {person} v {place} poznámka {note}",
    ],
  };
}

const ENTITIES = {
  person: ["Novotným", "Petrem", "Martinou", "Janou", "Adámkem"],
  date: ["dnes", "zítra", "ve čtvrtek", "příští týden"],
  time: ["9:00", "10:30", "15:00", "17:00"],
  place: ["Praze 1", "Brně", "Na Pankráci"],
  note: ["vzít nabíječku", "kontrola smlouvy", "narozeniny 26.6."],
  task: ["koupit rohlíky", "zavolat právníkovi", "poslat dokumenty"],
  topic: ["banka", "smlouva", "narozeniny Adámka"],
  range: ["dnes", "zítra", "příští týden"],
  count: ["18", "12", "25"],
};

function fillTemplate(tpl, rng) {
  return tpl.replace(/\{([a-z_]+)\}/g, function (_, key) {
    return pickFrom(rng, ENTITIES[key] || [key]);
  });
}

function groupForFamily(family) {
  if (family.indexOf("calendar_create") >= 0 || family.indexOf("save_mode") >= 0 && family.indexOf("query") < 0) {
    if (family.indexOf("task") >= 0) return "task_write";
    if (family.indexOf("note") >= 0 && family.indexOf("event") < 0) return "note_write";
    if (family.indexOf("calendar") >= 0 || family.indexOf("save_payload") >= 0) return "calendar_write";
  }
  if (family.indexOf("task_create") >= 0 || family.indexOf("task_note") >= 0) return "task_write";
  if (family.indexOf("note_create") >= 0) return "note_write";
  if (family.indexOf("calendar") >= 0 && family.indexOf("create") < 0) return "calendar_query";
  if (family.indexOf("task") >= 0) return "task_query";
  if (family.indexOf("note") >= 0 || family.indexOf("continue") >= 0 || family.indexOf("full_list") >= 0) return "note_query";
  if (family.indexOf("global") >= 0) return "note_query";
  if (family.indexOf("save") >= 0 || family.indexOf("create") >= 0 || family.indexOf("event_note") >= 0) return "calendar_write";
  return "calendar_query";
}

function generateFamilyCases(family, count) {
  const templates = buildFamilyTemplates()[family] || ["test {person} {date}"];
  const cases = [];
  const baseSeed = (family.length * 1915423911) >>> 0;
  for (let i = 0; i < count; i++) {
    const rng = core.mulberry32((baseSeed ^ (i * 3654435761)) >>> 0);
    const tpl = templates[i % templates.length];
    const mask = core.deriveMutationMask(family, i, baseSeed);
    let input = fillTemplate(tpl, rng);
    input = core.applyMutationLayers(input, mask, rng);
    cases.push({
      id: family + "_" + String(i).padStart(4, "0"),
      family,
      input,
      group: groupForFamily(family),
    });
  }
  return cases;
}

function generateAllCases() {
  const all = [];
  for (let f = 0; f < AUDIT_FAMILIES.length; f++) {
    all.push.apply(all, generateFamilyCases(AUDIT_FAMILIES[f], CASES_PER_FAMILY));
  }
  return all;
}

function evaluateSaveSearchCase(c, turn) {
  const v = actionCore.validateSaveSearchTurn(turn, c.input);
  const card = actionCore.cardTypeFromTurn(turn);
  const mode = v.mode;
  let pass = v.pass;

  if (c.family.indexOf("save") >= 0 || c.family.indexOf("create") >= 0) {
    if (c.family.indexOf("query") < 0 && c.family.indexOf("search") < 0) {
      if (mode !== "save" && mode !== "update" && mode !== "clarification") pass = false;
      if (c.family.indexOf("calendar") >= 0 && turn.normalizedIntent === "calendar.create" && card !== "calendar_draft") pass = false;
      if (c.family.indexOf("task") >= 0 && turn.normalizedIntent === "tasks.create" && card !== "task_draft") pass = false;
      if (c.family.indexOf("note") >= 0 && turn.normalizedIntent === "notes.create" && card !== "note_draft") pass = false;
    }
  }

  if (c.family.indexOf("query") >= 0 || c.family.indexOf("search") >= 0 || c.family.indexOf("count") >= 0) {
    if (mode === "search" || actionCore.isSearchIntent(turn.normalizedIntent)) {
      if (card === "calendar_draft" || card === "task_draft" || card === "note_draft") pass = false;
      if (!actionCore.turnIsDirectSearchAnswer(turn) && !turn.silverMultiIntentComposite) pass = false;
    }
  }

  if (c.family === "event_note_not_notes_create" && turn.normalizedIntent === "notes.create") pass = false;
  if (c.family === "task_note_not_note_body" && turn.normalizedIntent === "notes.create") pass = false;

  const payloadVal = validator.validateCleanPayload(turn, c.input, {
    searchSemantics: searchCore.parseSearchSemantics(c.input),
  });
  if (c.family === "save_payload_clean_before_card" && !payloadVal.pass) pass = false;

  return { pass, mode, card, violations: v.violations, payloadVal };
}

function runManualProbes(eng) {
  const results = [];
  const all = MANUAL_SAVE_PROBES.concat(MANUAL_SEARCH_PROBES);
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(p.input, eng.createEmptyDraft(), ctxForCase(p.group));
    const v = actionCore.validateSaveSearchTurn(turn, p.input);
    const card = actionCore.cardTypeFromTurn(turn);
    const mode = turn.actionMode || v.mode;
    let pass = v.pass;
    if (p.expectMode && mode !== p.expectMode && !(p.expectMode === "search" && mode === "clarification")) pass = false;
    if (p.expectCard && card !== p.expectCard && !(p.expectCard === "read_card" && card === "search_read")) pass = false;
    if (p.expectIntent && String(turn.normalizedIntent || "").indexOf(p.expectIntent.split(".")[0]) < 0) {
      if (turn.normalizedIntent !== p.expectIntent) {
        if (!p.acceptIntents || p.acceptIntents.indexOf(turn.normalizedIntent) < 0) pass = false;
      }
    }
    results.push({ id: p.id, pass, mode, card, intent: turn.normalizedIntent, violations: v.violations });
  }
  return results;
}

function runDiagnostic(writeReport) {
  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + escapeField(e && e.message));
    process.exit(1);
  }

  const rawCases = generateAllCases();
  const gov = antiDup.auditGovernanceReport(rawCases);
  const unique = antiDup.filterUniqueCases(rawCases);
  const cases = unique.accepted;

  let saveModePass = 0;
  let saveModeTotal = 0;
  let searchModePass = 0;
  let searchModeTotal = 0;
  let createWithoutCard = 0;
  let queryWithDraftCard = 0;
  let autoSaveWithoutCard = 0;
  let dangerousWrite = 0;
  let falseWrite = 0;
  let queryCreatedWrite = 0;
  let writeWhenNegated = 0;
  const familyStats = {};
  const violationHistogram = {};

  for (let i = 0; i < AUDIT_FAMILIES.length; i++) {
    familyStats[AUDIT_FAMILIES[i]] = { total: 0, pass: 0 };
  }

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    familyStats[c.family].total++;
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e1) {
      void e1;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const ev = evaluateSaveSearchCase(c, turn);
    if (ev.pass) familyStats[c.family].pass++;

    const mode = ev.mode;
    if (mode === "save") {
      saveModeTotal++;
      if (ev.pass && actionCore.turnHasStructuredDraftCard(turn)) saveModePass++;
      if (actionCore.isCreateIntent(turn.normalizedIntent) && !actionCore.turnHasStructuredDraftCard(turn)) createWithoutCard++;
    }
    if (mode === "search" || actionCore.isSearchIntent(turn.normalizedIntent)) {
      searchModeTotal++;
      if (ev.pass && actionCore.turnIsDirectSearchAnswer(turn)) searchModePass++;
      if (actionCore.turnHasDraftCardArtifact(turn) && !turn.silverMultiIntentComposite) queryWithDraftCard++;
    }

    for (let vi = 0; vi < ev.violations.length; vi++) {
      const v = ev.violations[vi];
      violationHistogram[v] = (violationHistogram[v] || 0) + 1;
    }

    const evalR = evaluateOne(c, turn);
    const cat = String(evalR.cat || "");
    const fi = foldCs(c.input);
    if (cat === "query_created_write") queryCreatedWrite++;
    if (cat === "write_when_negated" || (hasNegWrite(fi) && turn.processingState === "READY_TO_SAVE")) writeWhenNegated++;
    if (cat === "query_created_write" || cat === "write_when_negated") dangerousWrite++;
    if (!evalR.pass && cat === "query_created_write") falseWrite++;
    if (turn.processingState === "READY_TO_SAVE" && !actionCore.turnHasStructuredDraftCard(turn) && actionCore.isCreateIntent(turn.normalizedIntent)) {
      autoSaveWithoutCard++;
    }
  }

  const manualResults = runManualProbes(eng);
  const manualSavePass = manualResults.filter(function (r) {
    return r.id.indexOf("save_") === 0 && r.pass;
  }).length;
  const manualSearchPass = manualResults.filter(function (r) {
    return r.id.indexOf("search_") === 0 && r.pass;
  }).length;

  let mainCommit = "";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e2) {
    void e2;
  }

  const saveAcc = saveModeTotal ? saveModePass / saveModeTotal : 1;
  const searchAcc = searchModeTotal ? searchModePass / searchModeTotal : 1;

  const report = {
    harness_id: HARNESS_ID,
    main_commit: mainCommit,
    fixed_now: FIXED_NOW_ISO,
    audit_families: AUDIT_FAMILIES,
    cases_generated: rawCases.length,
    cases_after_anti_duplication: cases.length,
    governance: gov,
    save_mode_card_accuracy: saveAcc,
    search_mode_direct_answer_accuracy: searchAcc,
    create_without_card_count: createWithoutCard,
    query_with_draft_card_count: queryWithDraftCard,
    auto_save_without_card_count: autoSaveWithoutCard,
    family_stats: familyStats,
    violation_histogram: violationHistogram,
    manual_probes: manualResults,
    manual_save_mode_probes: manualSavePass + "/" + MANUAL_SAVE_PROBES.length,
    manual_search_mode_probes: manualSearchPass + "/" + MANUAL_SEARCH_PROBES.length,
    safety: {
      dangerous_write_count: dangerousWrite,
      false_write_count: falseWrite,
      query_created_write_count: queryCreatedWrite,
      write_when_negated_count: writeWhenNegated,
    },
    regression_detected: dangerousWrite > 0 || queryWithDraftCard > 0 || createWithoutCard > 0 ? "YES" : "NO",
    safe_to_continue_next_phase: dangerousWrite === 0 && queryWithDraftCard === 0 && createWithoutCard === 0 ? "YES" : "NO",
  };

  if (writeReport) {
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  }

  return report;
}

function pct(n) {
  return Math.round(n * 10000) / 100 + "%";
}

function main() {
  const writeReport = process.argv.indexOf("--write-report") >= 0;
  const report = runDiagnostic(writeReport);

  console.log("=== SILVER_SAVE_SEARCH_MODE_ARCHITECTURE_V1 ===");
  console.log("harness_id=" + escapeField(HARNESS_ID));
  console.log("main_commit=" + escapeField(report.main_commit));
  console.log("cases_generated=" + report.cases_generated);
  console.log("cases_after_anti_duplication=" + report.cases_after_anti_duplication);
  console.log("save_mode_structured_draft_card=" + pct(report.save_mode_card_accuracy));
  console.log("search_mode_direct_answer=" + pct(report.search_mode_direct_answer_accuracy));
  console.log("create_without_card_count=" + report.create_without_card_count);
  console.log("query_with_draft_card_count=" + report.query_with_draft_card_count);
  console.log("auto_save_without_card_count=" + report.auto_save_without_card_count);
  console.log("manual_save_mode_probes=" + report.manual_save_mode_probes);
  console.log("manual_search_mode_probes=" + report.manual_search_mode_probes);
  console.log("dangerous_write_count=" + report.safety.dangerous_write_count);
  console.log("false_write_count=" + report.safety.false_write_count);
  console.log("query_created_write_count=" + report.safety.query_created_write_count);
  console.log("write_when_negated_count=" + report.safety.write_when_negated_count);
  console.log("regression_detected=" + report.regression_detected);
  console.log("safe_to_continue_next_phase=" + report.safe_to_continue_next_phase);
  console.log("=== END_SILVER_SAVE_SEARCH_MODE_ARCHITECTURE_V1 ===");

  if (report.safety.dangerous_write_count > 0 || report.query_with_draft_card_count > 0 || report.create_without_card_count > 0) {
    process.exit(1);
  }
}

module.exports = {
  HARNESS_ID,
  AUDIT_FAMILIES,
  MANUAL_SAVE_PROBES,
  MANUAL_SEARCH_PROBES,
  generateAllCases,
  runDiagnostic,
  evaluateSaveSearchCase,
};

if (require.main === module) {
  main();
}
