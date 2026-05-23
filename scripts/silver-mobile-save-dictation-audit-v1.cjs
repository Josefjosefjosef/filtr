#!/usr/bin/env node
"use strict";
const { runAudit } = require("./silver-product-gap-audit-v1-core.cjs");

runAudit({
  harnessId: "silver_mobile_save_dictation_audit_v1",
  reportFile: "silver-mobile-save-dictation-audit-v1-report.json",
  seedSalt: 406,
  minAccuracy: 0.9,
  casesPerFamily: parseInt(process.env.SPG_CASES_PER_FAMILY || "2500", 10),
  families: ["mob_voice_cal", "mob_voice_task", "mob_voice_note"],
  templates: {
    mob_voice_cal: [
      "hele prosimte silver vloz mi do kalendare {date} v {time} {person}",
      "no jo silver dej schuzku s {person} {date}",
    ],
    mob_voice_task: [
      "silvere pridej ukol {task} {date} prosim",
      "hej silver ukol {task} {date}",
    ],
    mob_voice_note: [
      "ahoj silver uloz mi do poznamek ze {note}",
      "silver uloz poznamku ze {note}",
    ],
  },
  entities: {
    person: ["instalater", "technik", "novotnym"],
    date: ["zejtra", "v patek", "pristi stredu"],
    time: ["9:00", "10:00"],
    task: ["koupit mleko", "zavolat prawnikovi"],
    note: ["pracka ma zaruku", "pin od karty"],
  },
  groupForCase: function (family) {
    if (family.indexOf("task") >= 0) return "task_write";
    if (family.indexOf("note") >= 0) return "note_write";
    return "calendar_write";
  },
  extraPass: function (turn) {
    const blob = JSON.stringify(turn.draft || {}).toLowerCase();
    return !/\bsilver[eau]?\b/.test(blob);
  },
  probes: [
    {
      id: "L",
      input: "Hej Silver úkol zavolat právníkovi zítra odpoledne",
      intent: "tasks.create",
      group: "task_write",
      checks: { titleHas: "právn" },
    },
  ],
});
