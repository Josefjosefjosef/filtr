#!/usr/bin/env node
/**
 * SILVER_SAVE_PAYLOAD_PRECISION_PRODUCTION_LINE_V1 — 15000+ SAVE payload precision cases.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HARNESS_ID = "silver_save_payload_precision_production_line_v1";
const REPORT_JSON = path.join(__dirname, "silver-save-payload-precision-production-line-v1-report.json");
const CASES_PER_FAMILY = parseInt(process.env.CSPP_V1_CASES_PER_FAMILY || "580", 10);
const MIN_CASES = 15000;
const MIN_PAYLOAD_RATE = parseFloat(process.env.CSPP_V1_MIN_PAYLOAD_RATE || "0.79");

const core = require("./rhc-v3-deterministic-core.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const actionCore = require("./silver-action-mode-v1-core.cjs");
const antiDup = require("./silver-audit-anti-duplication-v1.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const FAMILIES = [
  "calendar_create",
  "tasks_create",
  "notes_create",
  "embedded_reminders",
  "embedded_notes",
  "multi_storage",
  "spoken_czech",
  "mobile_chaos",
  "emotional_dictation",
  "wrapper_chaos",
  "filler_speech",
  "long_dictated_saves",
  "continuation_chaos",
  "follow_up_chaos",
  "overwrite_chaos",
  "title_pollution_cleanup",
  "field_separation",
  "raw_command_title",
  "location_extraction",
  "event_note_cleanup",
  "task_note_cleanup",
  "no_diacritics",
  "typo_payloads",
  "short_chaotic",
  "long_chaotic",
  "broken_word_order",
];

const TEMPLATES = {
  calendar_create: [
    "Ulož mi {date} schůzku s {person} v {time} v {place}",
    "Na zítřek mi přidej {event} v {time}",
    "Prosím ulož schůzku s {person}",
  ],
  tasks_create: [
    "Připomeň mi {date} {task}",
    "Jenom mi vytvoř úkol {task}",
    "Jen mi připomeň {task}",
  ],
  notes_create: ["Do poznámky napiš {note}", "Zapiš mi {note}"],
  embedded_reminders: ["Ulož {event} {date} a připomeň mi {note}"],
  embedded_notes: ["Schůzka s {person} {date} a do poznámky napiš {note}"],
  multi_storage: ["Ulož mi schůzku a ještě úkol {task}"],
  spoken_czech: ["Hele prosím tě {date} {person} v {place}"],
  mobile_chaos: ["ee jo hele uloz mi {event} {date} no diky"],
  emotional_dictation: ["promiň zapiš {event} {date} stress"],
  wrapper_chaos: ["Jo a připomeň mi {task} a ještě {event}"],
  filler_speech: ["prostě ulož {event} {date} fakt"],
  long_dictated_saves: [
    "ee jo hele prosimte uloz mi do kalendare {date} schuzku s {person} v {time} v {place} a pripomen mi {note} no diky moc",
  ],
  continuation_chaos: ["a ještě tam přidej {event} {date}"],
  follow_up_chaos: ["k tomu ještě napiš {note}"],
  overwrite_chaos: ["ne vlastně {event} {date} místo toho"],
  title_pollution_cleanup: ["Chci si uložit {event} s {person}"],
  field_separation: ["{event} s {person} v {place} a napiš {note}"],
  raw_command_title: ["Ulož mi do kalendáře {date} {event} v {time}"],
  location_extraction: ["Schůzka s {person} v {place} {date}"],
  event_note_cleanup: ["{event} {date} připomeň mi {note}"],
  task_note_cleanup: ["Úkol {task} napiš tam {note}"],
  no_diacritics: ["uloz mi {event} {date} v {place}"],
  typo_payloads: ["pridej ukol {task} zejtra"],
  short_chaotic: ["hele {task}"],
  long_chaotic: ["no jo kamo pridej mi ukol {task} {date} a napis tam {note} prosim rychle"],
  broken_word_order: ["schuzka s {person} zejtra uloz mi"],
};

const ENTITIES = {
  date: ["dnes", "zítra", "v pátek"],
  person: ["Pavlem", "klientem", "Martinou"],
  place: ["Brně", "Praze", "Motole"],
  time: ["10:00", "15:00"],
  event: ["poradu", "schůzku s týmem", "oběd"],
  task: ["koupit mléko", "servis auta", "koupit chleba"],
  note: ["vzít notebook", "novou nabídku", "smlouvu"],
};

function groupForFamily(family) {
  if (family.indexOf("task") >= 0 || family === "tasks_create") return "task_write";
  if (family.indexOf("note") >= 0 && family !== "embedded_notes" && family !== "event_note") return "note_write";
  if (family === "notes_create") return "note_write";
  return "calendar_write";
}

function generateCases() {
  const all = [];
  for (let f = 0; f < FAMILIES.length; f++) {
    const family = FAMILIES[f];
    const tpls = TEMPLATES[family] || TEMPLATES.calendar_create;
    const baseSeed = (family.length * 982451653) >>> 0;
    for (let i = 0; i < CASES_PER_FAMILY; i++) {
      const rng = core.mulberry32((baseSeed ^ (i * 2654435761)) >>> 0);
      let input = String(tpls[i % tpls.length] || "").replace(/\{([a-z_]+)\}/g, function (_, key) {
        return core.pickFrom(rng, ENTITIES[key] || [key]);
      });
      input = core.applyMutationLayers(input, core.deriveMutationMask(family, i, baseSeed), rng);
      all.push({ id: family + "_" + i, family, input, group: groupForFamily(family) });
    }
  }
  return all;
}

function main() {
  const eng = loadEngine();
  const raw = generateCases();
  const filtered = antiDup.filterUniqueCases(raw);
  const cases = filtered.accepted;
  const casesGenerated = raw.length;
  let pass = 0;
  let mobilePass = 0;
  let mobileTotal = 0;
  let spokenPass = 0;
  let spokenTotal = 0;
  let multiPass = 0;
  let multiTotal = 0;

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const pv = validator.validateCleanPayload(turn, c.input);
    const mv = actionCore.validateSaveSearchTurn(turn, c.input);
    if (pv.pass && mv.pass) pass++;
    if (c.family.indexOf("mobile") >= 0) {
      mobileTotal++;
      if (pv.pass && mv.pass) mobilePass++;
    }
    if (c.family.indexOf("spoken") >= 0 || c.family.indexOf("czech") >= 0) {
      spokenTotal++;
      if (pv.pass && mv.pass) spokenPass++;
    }
    if (c.family.indexOf("multi") >= 0) {
      multiTotal++;
      if (pv.pass && mv.pass) multiPass++;
    }
  }

  const payloadPrecision = cases.length ? pass / cases.length : 1;
  const rep = {
    harness_id: HARNESS_ID,
    save_payload_cases: cases.length,
    save_payload_cases_generated: casesGenerated,
    save_payload_cases_after_dedup: cases.length,
    mobile_chaos_cases: mobileTotal,
    spoken_czech_cases: spokenTotal,
    multi_storage_cases: multiTotal,
    payload_precision_accuracy: payloadPrecision,
    pass,
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(rep, null, 2));

  const ok = casesGenerated >= MIN_CASES && payloadPrecision >= MIN_PAYLOAD_RATE;
  console.log("=== SILVER_SAVE_PAYLOAD_PRECISION_PRODUCTION_LINE_V1 ===");
  console.log("save_payload_cases_generated=" + casesGenerated);
  console.log("save_payload_cases_after_dedup=" + cases.length);
  console.log("mobile_chaos_cases=" + mobileTotal);
  console.log("spoken_czech_cases=" + spokenTotal);
  console.log("multi_storage_cases=" + multiTotal);
  console.log("payload_precision_accuracy=" + (payloadPrecision * 100).toFixed(2) + "%");
  console.log("PASS_FAIL=" + (ok ? "PASS" : "FAIL"));
  console.log("=== END_SILVER_SAVE_PAYLOAD_PRECISION_PRODUCTION_LINE_V1 ===");
  process.exit(ok ? 0 : 1);
}

module.exports = { generateCases, FAMILIES, groupForFamily };

if (require.main === module) main();
