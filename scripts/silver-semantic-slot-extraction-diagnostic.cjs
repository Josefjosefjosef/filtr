/**
 * SILVER_SEMANTIC_SLOT_EXTRACTION_ENGINE_V1 — diagnostic + 20 audit families.
 * Narrow SAVE MODE field precision; engine via VM harness.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HARNESS_ID = "silver_semantic_slot_extraction_v1";
const REPORT_JSON = path.join(__dirname, "silver-semantic-slot-extraction-diagnostic-report.json");
const CASES_PER_FAMILY = parseInt(process.env.SSES_CASES_PER_FAMILY || "20", 10);

const core = require("./rhc-v3-deterministic-core.cjs");
const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const actionCore = require("./silver-action-mode-v1-core.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const antiDup = require("./silver-audit-anti-duplication-v1.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const AUDIT_FAMILIES = [
  "semantic_slot_extraction",
  "calendar_field_cleanup",
  "task_field_cleanup",
  "notes_field_cleanup",
  "instruction_leakage_detection",
  "title_pollution_detection",
  "location_extraction_accuracy",
  "event_note_cleanup",
  "task_note_cleanup",
  "raw_command_rejection",
  "draft_card_field_cleanliness",
  "mobile_dictation_slot_extraction",
  "long_chaotic_czech_slot_extraction",
  "person_location_separation",
  "time_location_title_separation",
  "duplicate_field_suppression",
  "semantic_payload_cleanliness",
  "save_mode_field_accuracy",
  "field_contamination_detection",
  "structured_payload_accuracy",
];

const MANUAL_PROBES = [
  {
    id: "probe_cal_novotny",
    input:
      "Ulož mi do kalendáře schůzku kterou mám jít dneska s panem Novotným v 15 hodin máme se potkat v Praze jedna a připomeň mi ať si vezmu nabíječku",
    intent: "calendar.create",
    checks: { titleHas: "novotn", titleLacks: "praha", noteLacks: "pripomen", locHas: "praha" },
  },
  {
    id: "probe_task_rohliky",
    input: "Připomeň mi že mám zítra koupit 10 rohlíků a napiš tam že je to důležité",
    intent: "tasks.create",
    checks: { titleHas: "rohl", titleLacks: "pripomen", taskNoteHas: "důležit" },
  },
  {
    id: "probe_note_pracka",
    input: "Ulož mi do poznámek že pračka má záruku do prosince 2028",
    intent: "notes.create",
    checks: { bodyHas: "pračka", bodyLacks: "uloz mi" },
  },
  {
    id: "probe_cal_obed",
    input: "Ulož mi do kalendáře oběd s Pavlem zítra ve 12 v restauraci u Anděla",
    intent: "calendar.create",
    checks: { titleHas: "oběd", titleLacks: "restaurac", locHas: "anděl" },
  },
  {
    id: "probe_task_pravnik",
    input: "Přidej mi úkol zavolat právníkovi v pátek ráno",
    intent: "tasks.create",
    checks: { titleHas: "právník", titleLacks: "pridej" },
  },
];

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
    semantic_slot_extraction: [
      "Ulož mi schůzku s {person} {date} v {time} a připomeň mi ať si vezmu {item}",
      "Přidej úkol {task} {date} a napiš tam {note}",
    ],
    calendar_field_cleanup: [
      "Hoď mi do kalendáře {date} v {time} schůzku s {person} v {place}",
      "Zapiš schůzku kterou mám jít {date} s {person} v {time}",
    ],
    task_field_cleanup: ["Připomeň mi že mám {date} {task}", "Přidej mi úkol {task} do {date}"],
    notes_field_cleanup: ["Ulož mi do poznámek že {note}", "Nová poznámka {note}"],
    instruction_leakage_detection: [
      "Ulož mi do kalendáře schůzku s {person} {date}",
      "Připomeň mi {task} {date}",
    ],
    title_pollution_detection: [
      "Schůzka s {person} {date} v {time} v {place} máme se potkat",
      "Oběd s {person} {date} ve {time} v restauraci u {place}",
    ],
    location_extraction_accuracy: [
      "Schůzka s {person} {date} máme se potkat v {place}",
      "Oběd s {person} {date} v restauraci u {place}",
    ],
    event_note_cleanup: [
      "Schůzka s {person} {date} a připomeň mi ať si vezmu {item}",
      "Dej schůzku s {person} {date} připomeň mi {note}",
    ],
    task_note_cleanup: ["Úkol {task} a napiš tam {note}", "Přidej {task} napiš tam že {note}"],
    raw_command_rejection: [
      "Ulož mi do kalendáře že {note}",
      "Přidej mi do úkolů {task}",
    ],
    draft_card_field_cleanliness: [
      "Ulož schůzku s {person} {date} v {time} v {place} poznámka {note}",
    ],
    mobile_dictation_slot_extraction: [
      "jo hele ulož mi schůzku s {person} {date} v {time} no",
      "teda přidej {date} schůzku s {person} prosím",
    ],
    long_chaotic_czech_slot_extraction: [
      "Hele prosím tě ulož mi schůzku s {person} {date} v {time} v {place} a připomeň mi {note}",
    ],
    person_location_separation: [
      "Schůzka s panem {person} {date} potkáme se v {place}",
    ],
    time_location_title_separation: [
      "Oběd s {person} {date} ve {time} v restauraci u {place}",
    ],
    duplicate_field_suppression: [
      "Schůzka s {person} {date} v {time} v {place} adresa {place}",
    ],
    semantic_payload_cleanliness: [
      "Ulož mi schůzku s {person} {date} v {time}",
    ],
    save_mode_field_accuracy: [
      "Hoď mi do kalendáře {date} schůzku s {person} v {time}",
    ],
    field_contamination_detection: [
      "Schůzka kterou mám jít {date} s {person} v {time} v {place}",
    ],
    structured_payload_accuracy: [
      "Přidej úkol {task} {date} poznámka {note}",
      "Ulož poznámku {note}",
    ],
  };
}

const ENTITIES = {
  person: ["Novotným", "Petrem", "Pavlem", "Martinou"],
  date: ["dnes", "zítra", "ve čtvrtek"],
  time: ["9:00", "12:00", "15:00"],
  place: ["Praze 1", "Anděla", "Brně"],
  note: ["záruka do 2028", "je to důležité"],
  task: ["koupit rohlíky", "zavolat právníkovi"],
  item: ["nabíječku", "deštník"],
};

function fillTemplate(tpl, rng) {
  return tpl.replace(/\{([a-z_]+)\}/g, function (_, key) {
    return pickFrom(rng, ENTITIES[key] || [key]);
  });
}

function groupForFamily(family) {
  if (family.indexOf("task") >= 0 && family.indexOf("note") < 0) return "task_write";
  if (family.indexOf("note") >= 0) return "note_write";
  return "calendar_write";
}

function generateAllCases() {
  const all = [];
  for (let f = 0; f < AUDIT_FAMILIES.length; f++) {
    const family = AUDIT_FAMILIES[f];
    const templates = buildFamilyTemplates()[family] || ["test {person}"];
    const baseSeed = (family.length * 1915423911) >>> 0;
    for (let i = 0; i < CASES_PER_FAMILY; i++) {
      const rng = core.mulberry32((baseSeed ^ (i * 3654435761)) >>> 0);
      const tpl = templates[i % templates.length];
      const mask = core.deriveMutationMask(family, i, baseSeed);
      let input = fillTemplate(tpl, rng);
      input = core.applyMutationLayers(input, mask, rng);
      all.push({ id: family + "_" + String(i).padStart(4, "0"), family, input, group: groupForFamily(family) });
    }
  }
  return all;
}

function draftField(turn, name) {
  const d = turn.draft || {};
  if (name === "title") return String(d.title || "");
  if (name === "note") return String(d.note || d.taskNote || "");
  if (name === "body") return String(d.silverNoteText || "");
  if (name === "location") return String(d.location || d.address || "");
  return "";
}

function evaluateCase(c, turn) {
  const payloadVal = validator.validateCleanPayload(turn, c.input);
  const modeVal = actionCore.validateSaveSearchTurn(turn, c.input);
  let pass = payloadVal.pass;
  if (c.family.indexOf("save_mode") >= 0 && !modeVal.pass) pass = false;
  if (c.family.indexOf("instruction") >= 0) {
    const title = draftField(turn, "title");
    if (title && payloadCore.hasInstructionLeakage(title)) pass = false;
  }
  return { pass, payloadVal, modeVal };
}

function runManualProbes(eng) {
  const results = [];
  for (let i = 0; i < MANUAL_PROBES.length; i++) {
    const p = MANUAL_PROBES[i];
    const turn = eng.processUserTurn(p.input, eng.createEmptyDraft(), ctxForCase("calendar_write"));
    const d = turn.draft || {};
    const title = foldCs(draftField(turn, "title"));
    const note = foldCs(draftField(turn, "note"));
    const body = foldCs(draftField(turn, "body"));
    const loc = foldCs(draftField(turn, "location"));
    const ch = p.checks || {};
    let pass = String(turn.normalizedIntent || "") === p.intent;
    if (ch.titleHas && title.indexOf(foldCs(ch.titleHas)) < 0) pass = false;
    if (ch.titleLacks && title.indexOf(foldCs(ch.titleLacks)) >= 0) pass = false;
    if (ch.noteLacks && note.indexOf(foldCs(ch.noteLacks)) >= 0) pass = false;
    if (ch.locHas && loc.indexOf(foldCs(ch.locHas)) < 0) pass = false;
    if (ch.bodyHas && body.indexOf(foldCs(ch.bodyHas)) < 0) pass = false;
    if (ch.bodyLacks && body.indexOf(foldCs(ch.bodyLacks)) >= 0) pass = false;
    if (ch.taskNoteHas && note.indexOf(foldCs(ch.taskNoteHas)) < 0) pass = false;
    results.push({ id: p.id, pass, intent: turn.normalizedIntent, title: d.title, note: d.note || d.taskNote, body: d.silverNoteText, location: d.location });
  }
  return results;
}

function mainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function main() {
  const writeReport = process.argv.indexOf("--write-report") >= 0;
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

  let passCount = 0;
  let payloadClean = 0;
  const familyStats = {};
  for (let i = 0; i < AUDIT_FAMILIES.length; i++) {
    familyStats[AUDIT_FAMILIES[i]] = { total: 0, pass: 0, payload_clean: 0 };
  }

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    familyStats[c.family].total++;
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const ev = evaluateCase(c, turn);
    if (ev.pass) {
      passCount++;
      familyStats[c.family].pass++;
    }
    if (ev.payloadVal.pass) {
      payloadClean++;
      familyStats[c.family].payload_clean++;
    }
  }

  const manual = runManualProbes(eng);
  const manualPass = manual.filter((m) => m.pass).length;

  const payloadCleanRate = cases.length ? payloadClean / cases.length : 1;
  const fieldCleanRate = cases.length ? passCount / cases.length : 1;
  const regression = manualPass < MANUAL_PROBES.length ? "YES" : "NO";

  const report = {
    harness_id: HARNESS_ID,
    main_commit: mainCommit(),
    cases_generated: rawCases.length,
    cases_after_anti_duplication: cases.length,
    governance: gov.summary,
    payload_clean_rate: payloadCleanRate,
    field_cleanliness: fieldCleanRate,
    manual_product_probes: manual,
    manual_pass: manualPass + "/" + MANUAL_PROBES.length,
    family_stats: familyStats,
    regression_detected: regression,
    safe_to_continue_next_phase: regression === "NO",
    pass: regression === "NO",
  };

  if (writeReport) {
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  }

  console.log("=== SILVER_SEMANTIC_SLOT_EXTRACTION_ENGINE_V1 ===");
  console.log("harness_id=" + HARNESS_ID);
  console.log("main_commit=" + report.main_commit);
  console.log("cases=" + cases.length);
  console.log("payload_clean_rate=" + Math.round(payloadCleanRate * 10000) / 100 + "%");
  console.log("field_cleanliness=" + Math.round(fieldCleanRate * 10000) / 100 + "%");
  console.log("manual_product_probes=" + report.manual_pass);
  console.log("regression_detected=" + regression);
  console.log("safe_to_continue_next_phase=" + (report.safe_to_continue_next_phase ? "YES" : "NO"));
  console.log("=== END_SILVER_SEMANTIC_SLOT_EXTRACTION_ENGINE_V1 ===");

  process.exit(report.pass ? 0 : 1);
}

main();
