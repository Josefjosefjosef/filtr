#!/usr/bin/env node
"use strict";
const { runAudit } = require("./silver-product-gap-audit-v1-core.cjs");
const saveCore = require("./silver-save-understanding-validator-repair-v1-core.cjs");
const validator = require("./silver-clean-payload-validator-v1.cjs");

runAudit({
  harnessId: "silver_save_field_validator_audit_v1",
  reportFile: "silver-save-field-validator-audit-v1-report.json",
  seedSalt: 7302,
  minAccuracy: 0.95,
  casesPerFamily: parseInt(process.env.SPG_CASES_PER_FAMILY || "2500", 10),
  families: ["title_assistant", "title_command", "title_temporal", "location_filler", "note_wrapper"],
  templates: {
    title_assistant: ["Silver dej mi {date} v {time} schůzku s {person}", "Hej Silver {date} doktor {place}"],
    title_command: ["Ulož mi {date} v {time} že má přijít {person}", "Hoď mi schůzku s {person} {date}"],
    title_temporal: ["Schůzka s {person} {date} v {time} v {place}", "Doktor {date} v {time} {place}"],
    location_filler: ["{date} v {time} schůzka v {place} a napiš tam že {note}", "Oběd {date} {place} připomeň {note}"],
    note_wrapper: ["Schůzka {date} v {time} s {person} a napiš tam že {note}", "Úkol {task} a napiš tam že {note}"],
  },
  entities: {
    date: ["zítra", "v pátek"],
    time: ["10:00", "15:00"],
    place: ["Praze 4", "Brně"],
    person: ["Petrem", "technik"],
    task: ["koupit mléko"],
    note: ["vzít smlouvu", "nezapomenout"],
  },
  groupForCase: function (family, input) {
    if (/\bukol|úkol\b/i.test(input)) return "task_write";
    if (/\bpoznam|ulož\s+mi\s+n[eě]kam\b/i.test(input)) return "note_write";
    return "calendar_write";
  },
  extraPass: function (turn, c) {
    const v = saveCore.validateSaveUnderstanding(turn, c.input);
    const cv = validator.validateCleanPayload(turn, c.input);
    return v.pass && cv.pass;
  },
});
