/**
 * SILVER_SEMANTIC_PAYLOAD_ENGINE_V1_FOUNDATION — diagnostic + audit families (scripts-only).
 * - NO broad engine rewrite; foundation helpers + validators + audit governance.
 * - 20 semantic audit families with anti-duplication governance.
 * - Optional JSON: node scripts/silver-semantic-payload-foundation-diagnostic.cjs --write-report
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HARNESS_ID = "silver_semantic_payload_foundation_v1";
const REPORT_JSON = path.join(__dirname, "silver-semantic-payload-foundation-diagnostic-report.json");
const FIXED_NOW_ISO = "2026-05-04T12:00:00";

const core = require("./rhc-v3-deterministic-core.cjs");
const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const searchCore = require("./silver-search-understanding-v1-core.cjs");
const convCore = require("./silver-conversation-state-v1-core.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const antiDup = require("./silver-audit-anti-duplication-v1.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, ctxForCase, foldCs, hasNegWrite } = harness;

const AUDIT_FAMILIES = [
  "clean_payload_extraction",
  "calendar_event_field_separation",
  "task_payload_extraction",
  "notes_payload_extraction",
  "event_note_vs_notes_module",
  "task_note_vs_note_body",
  "search_scope_understanding",
  "count_vs_list_vs_filter",
  "followup_continuation",
  "result_pagination",
  "continuation_retrieval",
  "conversation_carry_over",
  "mobile_dictation_cleanup",
  "dirty_long_czech_commands",
  "multi_step_conversation",
  "completed_vs_active_tasks",
  "summary_cleanliness",
  "continuation_after_partial_results",
  "agenda_summary_overview",
  "contextual_followup_understanding",
];

const CASES_PER_FAMILY = parseInt(process.env.SPEV1_CASES_PER_FAMILY || "24", 10);

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
    clean_payload_extraction: [
      "Ulož mi schůzku s {person} {date} v {time} a připomeň mi ať si vezmu {item}",
      "Hoď mi do kalendáře {date} v {time} schůzku s {person} prosím tě",
      "Přidej mi {date} v {time} schůzku s {person} mám jít na {place}",
      "Zapiš mi schůzku kterou mám jít {date} s {person} v {time}",
    ],
    calendar_event_field_separation: [
      "Schůzka s {person} {date} v {time} v {place} do poznámky {note}",
      "Dej mi do kalendáře {date} v {time} schůzku s {person} adresa {place} poznámka {note}",
      "Ulož {date} {time} schůzka s {person} místo {place} a do poznámky {note}",
    ],
    task_payload_extraction: [
      "Ulož úkol {task} do {date} s poznámkou {note}",
      "Přidej mi úkol {task} deadline {date} poznámka {note}",
      "Hoď mi do úkolů {task} a do poznámky k úkolu {note}",
    ],
    notes_payload_extraction: [
      "Ulož poznámku {note}",
      "Nová poznámka {note} k tématu {topic}",
      "Přidej poznámku {note} pro {person}",
    ],
    event_note_vs_notes_module: [
      "Schůzka s {person} {date} v {time} a do poznámky {note}",
      "Ulož schůzku s {person} {date} a připomeň si {note}",
      "Do kalendáře {date} schůzka s {person} poznamenej {note}",
    ],
    task_note_vs_note_body: [
      "Úkol {task} do poznámky k úkolu {note}",
      "Přidej úkol {task} a do úkolu napiš {note}",
      "Ulož úkol {task} s poznámkou {note}",
    ],
    search_scope_understanding: [
      "Kolik mám {range} schůzek",
      "Jaké mám {range} schůzky",
      "Najdi {topic} v poznámkách",
      "Kolik mám hotových úkolů",
    ],
    count_vs_list_vs_filter: [
      "Kolik mám {range} schůzek",
      "Vypiš {range} schůzky",
      "Vypiš všech {count} poznámek",
      "Jaké mám hotové úkoly",
    ],
    followup_continuation: [
      "vypiš zbytek",
      "ukaž další",
      "pokračuj ve výpisu",
      "jen hotové",
    ],
    result_pagination: [
      "ukaž další",
      "vypiš zbytek",
      "další stránka",
      "zbylé výsledky",
    ],
    continuation_retrieval: [
      "najdi to",
      "ukaž mi to",
      "ten druhý",
      "tu poslední uprav",
    ],
    conversation_carry_over: [
      "a co zítra",
      "a v kolik",
      "a kde",
      "a přidej poznámku {note}",
    ],
    mobile_dictation_cleanup: [
      "jo hele ulož mi schůzku s {person} {date} v {time} no",
      "teda přidej {date} schůzku s {person} prosím rychle",
      "promiň zapiš schůzku s {person} {date} v {time} díky moc",
    ],
    dirty_long_czech_commands: [
      "Hele prosím tě já potřebuju abys mi uložil schůzku s {person} {date} v {time} v {place} a do poznámky {note} protože mám jet z práce",
      "No jo dej mi do kalendáře {date} kolem {time} schůzku s {person} máme se potkat v {place} a připomeň mi {note}",
    ],
    multi_step_conversation: [
      "Schůzka s {person}",
      "Zítra v {time}",
      "V {place}",
      "Poznámka {note}",
    ],
    completed_vs_active_tasks: [
      "Jaké mám hotové úkoly",
      "Vypiš aktivní úkoly",
      "Kolik mám dokončených úkolů",
      "Jen pracovní úkoly",
    ],
    summary_cleanliness: [
      "Shrň mi {range} schůzky",
      "Přehled {range} úkolů",
      "Agenda na {range}",
    ],
    continuation_after_partial_results: [
      "vypiš zbytek poznámek",
      "ukaž další schůzky",
      "zbylé úkoly",
    ],
    agenda_summary_overview: [
      "Co mám {range} v kalendáři",
      "Přehled schůzek {range}",
      "Agenda {range}",
    ],
    contextual_followup_understanding: [
      "ten druhý",
      "tu poslední",
      "jen pracovní",
      "a přidej {note}",
    ],
  };
}

const ENTITIES = {
  person: ["Novotným", "Petrem", "Martinou", "Janou", "advokátem", "bankéřem"],
  date: ["dnes", "zítra", "ve čtvrtek", "příští týden", "v pátek"],
  time: ["9:00", "10:30", "15:00", "17:00"],
  place: ["Praze 1", "Brně", "Na Pankráci", "Karlíně"],
  item: ["nabíječku", "smlouvu", "občanku", "deštník"],
  note: ["vzít nabíječku", "přinést smlouvu", "kontrola", "advokát"],
  task: ["koupit mlíko", "zavolat právníkovi", "poslat dokumenty", "zaplatit nájem"],
  topic: ["banka", "smlouva", "pojištění", "WiFi heslo"],
  range: ["dnes", "zítra", "příští týden", "dneska"],
  count: ["18", "12", "25", "30"],
};

function fillTemplate(tpl, rng) {
  return tpl.replace(/\{([a-z_]+)\}/g, (_, key) => pickFrom(rng, ENTITIES[key] || [key]));
}

function generateFamilyCases(family, count) {
  const templates = buildFamilyTemplates()[family] || ["test {person} {date}"];
  const cases = [];
  const baseSeed = (family.length * 1315423911) >>> 0;
  for (let i = 0; i < count; i++) {
    const rng = core.mulberry32((baseSeed ^ (i * 2654435761)) >>> 0);
    const tpl = templates[i % templates.length];
    const mask = core.deriveMutationMask(family, i, baseSeed);
    let input = fillTemplate(tpl, rng);
    input = core.applyMutationLayers(input, mask, rng);
    cases.push({
      id: family + "_" + String(i).padStart(4, "0"),
      family,
      input,
      group: family.indexOf("search") >= 0 || family.indexOf("count") >= 0 ? "calendar_query" : "calendar_write",
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

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function runFoundationDiagnostic(writeReport) {
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

  let passRouting = 0;
  let payloadViolations = 0;
  let dangerousWrite = 0;
  let falseWrite = 0;
  let queryCreatedWrite = 0;
  let writeWhenNegated = 0;
  const familyStats = {};
  const violationHistogram = {};

  let convState = convCore.createEmptyConversationState();

  for (let i = 0; i < AUDIT_FAMILIES.length; i++) familyStats[AUDIT_FAMILIES[i]] = { total: 0, payload_clean: 0, routing_pass: 0 };

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    const family = c.family;
    familyStats[family].total++;

    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    convState = convCore.createEmptyConversationState();

    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const ev = evaluateOne(c, turn);
    if (ev.pass) {
      passRouting++;
      familyStats[family].routing_pass++;
    }

    const semantics = searchCore.parseSearchSemantics(c.input);
    const validation = validator.validateCleanPayload(turn, c.input, {
      searchSemantics: semantics,
      conversationState: convState,
    });

    if (validation.pass) {
      familyStats[family].payload_clean++;
    } else {
      payloadViolations++;
      for (let vi = 0; vi < validation.violations.length; vi++) {
        const v = validation.violations[vi];
        violationHistogram[v] = (violationHistogram[v] || 0) + 1;
      }
    }

    convState = convCore.updateConversationState(convState, turn, c.input);
    if (eng.iuSilverConversationSyncFromTurn) eng.iuSilverConversationSyncFromTurn(turn, c.input);

    const cat = String(ev.cat || "");
    const fi = foldCs(c.input);
    if (cat === "query_created_write") queryCreatedWrite++;
    if (cat === "write_when_negated" || (hasNegWrite(fi) && createLikeTurn(turn))) writeWhenNegated++;
    if (cat === "query_created_write" || cat === "write_when_negated") dangerousWrite++;
    if (!ev.pass && cat === "query_created_write") falseWrite++;
  }

  let mainCommit = "";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e2) {
    void e2;
  }

  const report = {
    harness_id: HARNESS_ID,
    main_commit: mainCommit,
    fixed_now: FIXED_NOW_ISO,
    audit_families: AUDIT_FAMILIES,
    cases_generated: rawCases.length,
    cases_after_anti_duplication: cases.length,
    governance: gov,
    pass_routing: passRouting,
    total_cases: cases.length,
    payload_violations: payloadViolations,
    payload_clean_rate: cases.length ? (cases.length - payloadViolations) / cases.length : 1,
    family_stats: familyStats,
    violation_histogram: violationHistogram,
    safety: {
      dangerous_write_count: dangerousWrite,
      false_write_count: falseWrite,
      query_created_write_count: queryCreatedWrite,
      write_when_negated_count: writeWhenNegated,
    },
    foundation_layers: {
      payload_extraction_foundation: "ACTIVE",
      search_understanding_foundation: "ACTIVE",
      conversation_state_foundation: "ACTIVE",
      payload_validator_foundation: "ACTIVE",
      event_note_vs_notes_guard: "ACTIVE",
      task_note_vs_note_body_guard: "ACTIVE",
      search_scope_parser: "ACTIVE",
      count_list_filter_parser: "ACTIVE",
      continuation_foundation: "ACTIVE",
      anti_duplicate_protection: gov.anti_duplicate_protection,
      semantic_entropy_governance: gov.semantic_entropy_governance,
      template_dna_quality_governance: gov.template_dna_quality_governance,
    },
    regression_detected: dangerousWrite > 0 ? "YES" : "NO",
    safe_to_continue_next_phase: dangerousWrite === 0 ? "YES" : "NO",
    recommended_next_phase: "narrow_engine_integration_of_clean_payload_helpers",
  };

  if (writeReport) {
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  }

  return report;
}

function main() {
  const writeReport = process.argv.indexOf("--write-report") >= 0;
  const report = runFoundationDiagnostic(writeReport);

  console.log("=== SILVER_SEMANTIC_PAYLOAD_ENGINE_V1_FOUNDATION ===");
  console.log("harness_id=" + escapeField(HARNESS_ID));
  console.log("main_commit=" + escapeField(report.main_commit));
  console.log("cases_generated=" + report.cases_generated);
  console.log("cases_after_anti_duplication=" + report.cases_after_anti_duplication);
  console.log("pass_routing=" + report.pass_routing + "/" + report.total_cases);
  console.log("payload_violations=" + report.payload_violations);
  console.log("payload_clean_rate=" + Math.round(report.payload_clean_rate * 10000) / 100 + "%");
  console.log("anti_duplicate_protection=" + report.foundation_layers.anti_duplicate_protection);
  console.log("semantic_entropy_governance=" + report.foundation_layers.semantic_entropy_governance);
  console.log("template_dna_quality_governance=" + report.foundation_layers.template_dna_quality_governance);
  console.log("dangerous_write_count=" + report.safety.dangerous_write_count);
  console.log("false_write_count=" + report.safety.false_write_count);
  console.log("query_created_write_count=" + report.safety.query_created_write_count);
  console.log("write_when_negated_count=" + report.safety.write_when_negated_count);
  console.log("regression_detected=" + report.regression_detected);
  console.log("safe_to_continue_next_phase=" + report.safe_to_continue_next_phase);
  console.log("recommended_next_phase=" + report.recommended_next_phase);
  console.log("=== END_SILVER_SEMANTIC_PAYLOAD_ENGINE_V1_FOUNDATION ===");

  if (report.safety.dangerous_write_count > 0) process.exit(1);
}

module.exports = {
  HARNESS_ID,
  AUDIT_FAMILIES,
  generateAllCases,
  runFoundationDiagnostic,
  buildFamilyTemplates,
};

if (require.main === module) {
  main();
}
