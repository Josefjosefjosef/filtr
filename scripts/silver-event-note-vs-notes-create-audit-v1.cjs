#!/usr/bin/env node
/**
 * SILVER_EVENT_NOTE_VS_NOTES_CREATE_AUDIT_V1 — CAP53 event.note vs notes.create ≥99%.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const core = require("./rhc-v3-deterministic-core.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const payloadCore = require("./silver-semantic-payload-engine-v1-core.cjs");
const antiDup = require("./silver-audit-anti-duplication-v1.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase } = harness;

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-event-note-vs-notes-create-audit-v1-report.json");
const CASES_PER_FAMILY = parseInt(process.env.SPG_CASES_PER_FAMILY || "150", 10);
const MIN_ACCURACY = 0.99;

const FAMILIES = ["cal_event_note", "cal_reminder_tail", "pure_note", "negated_cal_note"];

const TEMPLATES = {
  cal_event_note: [
    "Silver {date} schůzku s {person} v {place} a do poznámky napiš {note}",
    "hele {date} v {time} doktor {place} připomeň mi {note}",
    "uloz mi tam ze mam {date} {person} a jeste tam napis {note}",
  ],
  cal_reminder_tail: [
    "{date} {person} v {place} a napiš tam že {note}",
    "Silver {date} servis připomeň {note}",
  ],
  pure_note: [
    "Silver ulož mi někam že {note}",
    "zapiš si že {note}",
    "ulož poznámku {note}",
  ],
  negated_cal_note: ["ne do kalendáře ulož do poznámek že {note}"],
};

const ENTITIES = {
  date: ["zítra", "v pátek", "ve středu"],
  time: ["v 10", "odpoledne"],
  place: ["Praha", "Vinohradech", "Brně"],
  person: ["Petrem", "pravnikem", "Pavlem"],
  note: ["vzít smlouvy", "roušku", "zavolat"],
};

function expectedIntent(c) {
  if (c.family === "pure_note" || c.family === "negated_cal_note") return "notes.create";
  return "calendar.create";
}

function main() {
  const eng = loadEngine();
  const rawCases = [];
  for (let fi = 0; fi < FAMILIES.length; fi++) {
    const family = FAMILIES[fi];
    const tpls = TEMPLATES[family];
    const baseSeed = ((family.length * 982451653) ^ 5317) >>> 0;
    for (let i = 0; i < CASES_PER_FAMILY; i++) {
      const rng = core.mulberry32((baseSeed ^ (i * 2654435761)) >>> 0);
      let input = String(tpls[i % tpls.length] || "")
        .replace(/\{([a-z_]+)\}/g, function (_, key) {
          return core.pickFrom(rng, ENTITIES[key] || [key]);
        });
      input = core.applyMutationLayers(input, core.deriveMutationMask(family, i, baseSeed), rng);
      rawCases.push({
        id: family + "_" + String(i).padStart(4, "0"),
        family,
        input,
        group: family.indexOf("pure") >= 0 || family.indexOf("negated") >= 0 ? "note_write" : "calendar_write",
        expected: expectedIntent({ family }),
      });
    }
  }
  const cases = antiDup.filterUniqueCases(rawCases).accepted;
  let pass = 0;
  let eventNoteLeak = 0;
  let falseCalFromNote = 0;
  let falseNotesFromCal = 0;
  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const intent = String(turn.normalizedIntent || "");
    let ok = true;
    if (c.expected === "calendar.create") {
      if (intent === "notes.create") {
        eventNoteLeak++;
        falseNotesFromCal++;
        ok = false;
      }
      const v = validator.validateCleanPayload(turn, c.input);
      if (v.violations.indexOf("event_note_leaked_to_notes_create") >= 0) {
        eventNoteLeak++;
        ok = false;
      }
    } else if (c.expected === "notes.create") {
      if (intent === "calendar.create") {
        falseCalFromNote++;
        ok = false;
      }
    }
    if (ok) pass++;
  }
  const accuracy = cases.length ? pass / cases.length : 1;
  const report = {
    harness_id: "silver_event_note_vs_notes_create_audit_v1",
    cases_total: cases.length,
    event_note_vs_notes_create_accuracy: accuracy,
    event_note_leaked_to_notes_create_count: eventNoteLeak,
    false_notes_create_from_calendar_count: falseNotesFromCal,
    false_calendar_create_from_pure_note_count: falseCalFromNote,
    pass_fail:
      accuracy >= MIN_ACCURACY && eventNoteLeak === 0 && falseCalFromNote === 0 ? "PASS" : "FAIL",
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  console.log("=== SILVER_EVENT_NOTE_VS_NOTES_CREATE_AUDIT_V1 ===");
  console.log("event_note_vs_notes_create_accuracy=" + Math.round(accuracy * 10000) / 100 + "%");
  console.log("event_note_leaked_to_notes_create_count=" + eventNoteLeak);
  console.log("false_calendar_create_from_pure_note_count=" + falseCalFromNote);
  console.log("PASS_FAIL=" + report.pass_fail);
  console.log("=== END_SILVER_EVENT_NOTE_VS_NOTES_CREATE_AUDIT_V1 ===");
  process.exit(report.pass_fail === "PASS" ? 0 : 1);
}

main();
