#!/usr/bin/env node
"use strict";
const { runAudit } = require("./silver-product-gap-audit-v1-core.cjs");
const saveCore = require("./silver-save-understanding-validator-repair-v1-core.cjs");

runAudit({
  harnessId: "silver_save_continuation_validator_audit_v1",
  reportFile: "silver-save-continuation-validator-audit-v1-report.json",
  seedSalt: 7305,
  minAccuracy: 0.95,
  casesPerFamily: parseInt(process.env.SPG_CASES_PER_FAMILY || "2500", 10),
  families: ["event_note_not_notes", "task_note_not_notes", "calendar_not_task"],
  templates: {
    event_note_not_notes: [
      "Schůzka s {person} {date} v {time} a napiš tam že {note}",
      "Doktor {date} {place} napiš tam že {note}",
    ],
    task_note_not_notes: ["Úkol {task} {date} a napiš tam že {note}", "Přidej {task} a dej tam že {note}"],
    calendar_not_task: ["Silver {date} v {time} schůzku s {person} v {place}", "Kalendář {date} oběd s {person}"],
  },
  entities: {
    date: ["zítra", "v pátek"],
    time: ["10:00", "15:00"],
    place: ["Brně", "Praha 4"],
    person: ["Petrem"],
    task: ["zavolat právníkovi"],
    note: ["vzít smlouvu", "poslat dokumenty"],
  },
  groupForCase: function (family) {
    if (family.indexOf("task") >= 0) return "task_write";
    return "calendar_write";
  },
  extraPass: function (turn, c) {
    const intent = String(turn.normalizedIntent || "");
    if (saveCore.validateSaveUnderstanding(turn, c.input).issues.indexOf("event_note_leaked_to_notes_create") >= 0)
      return false;
    if (saveCore.validateSaveUnderstanding(turn, c.input).issues.indexOf("task_note_leaked_to_notes_create") >= 0)
      return false;
    if (/\bnapis\s+tam\b/i.test(c.input) && intent === "notes.create") return false;
    if (/\bschuz|doktor\b/i.test(c.input) && intent === "tasks.create" && !/\bukol|úkol\b/i.test(c.input)) return false;
    return intent.indexOf(".create") >= 0;
  },
});
