#!/usr/bin/env node
/**
 * SILVER_CROSS_FIELD_VALIDATION_CONTRACT_V1_AUDIT — cross-field guards ≥99%.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const core = require("./rhc-v3-deterministic-core.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");
const saveCore = require("./silver-save-understanding-validator-repair-v1-core.cjs");
const antiDup = require("./silver-audit-anti-duplication-v1.cjs");
const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, ctxForCase, foldCs } = harness;

const REPORT_JSON = path.join(__dirname, "silver-cross-field-validation-contract-v1-audit-report.json");
const CASES_PER_FAMILY = parseInt(process.env.SPG_CASES_PER_FAMILY || "120", 10);

const FAMILIES = ["wrapper_note", "address_title_bleed", "duplicate_title_note", "cal_event_note"];
const TEMPLATES = {
  wrapper_note: ["Silver {date} {person} v {place} do poznámky napiš {note}"],
  address_title_bleed: ["Schůzka s {person} {date} na adrese {place}"],
  duplicate_title_note: ["Silver {date} schůzka s {person} a napiš tam že {note}"],
  cal_event_note: ["hele {date} v {time} schuzka {person} {place} pripomen {note}"],
};
const ENTITIES = {
  date: ["zítra", "v pátek"],
  time: ["v 10"],
  place: ["Praha 4", "Vinohradech"],
  person: ["Petrem", "pravnikem"],
  note: ["vzít smlouvy", "roušku"],
};

function countCrossFieldIssues(turn, raw) {
  const issues = {
    location_in_title_after_validation_count: 0,
    note_in_title_after_validation_count: 0,
    wrapper_in_note_after_validation_count: 0,
    event_note_leaked_to_notes_create_count: 0,
    duplicate_text_between_title_and_note_count: 0,
  };
  const title = foldCs(validator.draftField(turn, "title"));
  const loc = foldCs(validator.draftField(turn, "location"));
  const note = foldCs(validator.draftField(turn, "note"));
  const v = validator.validateCleanPayload(turn, raw);
  const s = saveCore.validateSaveUnderstanding(turn, raw);
  if (v.violations.indexOf("address_remains_in_title") >= 0) issues.location_in_title_after_validation_count++;
  if (v.violations.indexOf("event_note_leaked_to_notes_create") >= 0) {
    issues.event_note_leaked_to_notes_create_count++;
  }
  if (s.issues.indexOf("event_note_contains_command_wrapper") >= 0 || v.violations.indexOf("instruction_prefix_in_note") >= 0) {
    issues.wrapper_in_note_after_validation_count++;
  }
  if (title && note && title.length > 8 && note.length > 8 && title.indexOf(note) >= 0) {
    issues.duplicate_text_between_title_and_note_count++;
  }
  if (title && loc && /\bpraha\b/.test(title) && /\bpraha\b/.test(loc)) {
    issues.location_in_title_after_validation_count++;
  }
  if (title && /\b(napis\s+tam|pripomen)\b/.test(title)) issues.note_in_title_after_validation_count++;
  return issues;
}

function main() {
  const eng = loadEngine();
  const rawCases = [];
  for (let fi = 0; fi < FAMILIES.length; fi++) {
    const family = FAMILIES[fi];
    const tpls = TEMPLATES[family];
    const baseSeed = ((family.length * 982451653) ^ 5321) >>> 0;
    for (let i = 0; i < CASES_PER_FAMILY; i++) {
      const rng = core.mulberry32((baseSeed ^ (i * 2654435761)) >>> 0);
      let input = String(tpls[i % tpls.length] || "").replace(/\{([a-z_]+)\}/g, function (_, key) {
        return core.pickFrom(rng, ENTITIES[key] || [key]);
      });
      input = core.applyMutationLayers(input, core.deriveMutationMask(family, i, baseSeed), rng);
      rawCases.push({ id: family + "_" + i, family, input, group: "calendar_write" });
    }
  }
  const cases = antiDup.filterUniqueCases(rawCases).accepted;
  let pass = 0;
  const totals = {
    location_in_title_after_validation_count: 0,
    note_in_title_after_validation_count: 0,
    wrapper_in_note_after_validation_count: 0,
    event_note_leaked_to_notes_create_count: 0,
    duplicate_text_between_title_and_note_count: 0,
  };
  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const issues = countCrossFieldIssues(turn, c.input);
    let bad = false;
    const keys = Object.keys(totals);
    for (let ki = 0; ki < keys.length; ki++) {
      const k = keys[ki];
      totals[k] += issues[k];
      if (issues[k] > 0) bad = true;
    }
    if (!bad && validator.validateCleanPayload(turn, c.input).pass) pass++;
  }
  const accuracy = cases.length ? pass / cases.length : 1;
  const report = {
    harness_id: "silver_cross_field_validation_contract_v1_audit",
    cross_field_validation_accuracy: accuracy,
    totals,
    pass_fail:
      accuracy >= 0.99 &&
      totals.event_note_leaked_to_notes_create_count === 0 &&
      totals.wrapper_in_note_after_validation_count === 0
        ? "PASS"
        : "FAIL",
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  console.log("=== SILVER_CROSS_FIELD_VALIDATION_CONTRACT_V1_AUDIT ===");
  console.log("cross_field_validation_accuracy=" + Math.round(accuracy * 10000) / 100 + "%");
  console.log(
    "event_note_leaked_to_notes_create_count=" + totals.event_note_leaked_to_notes_create_count
  );
  console.log("wrapper_in_note_after_validation_count=" + totals.wrapper_in_note_after_validation_count);
  console.log("PASS_FAIL=" + report.pass_fail);
  console.log("=== END_SILVER_CROSS_FIELD_VALIDATION_CONTRACT_V1_AUDIT ===");
  process.exit(report.pass_fail === "PASS" ? 0 : 1);
}

main();
