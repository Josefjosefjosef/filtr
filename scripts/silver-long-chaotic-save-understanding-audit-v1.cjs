#!/usr/bin/env node
"use strict";
const { runAudit } = require("./silver-product-gap-audit-v1-core.cjs");
const saveCore = require("./silver-save-understanding-validator-repair-v1-core.cjs");

runAudit({
  harnessId: "silver_long_chaotic_save_understanding_audit_v1",
  reportFile: "silver-long-chaotic-save-understanding-audit-v1-report.json",
  seedSalt: 7301,
  minAccuracy: 0.95,
  casesPerFamily: parseInt(process.env.SPG_CASES_PER_FAMILY || "2500", 10),
  families: ["long_chaotic_calendar", "long_chaotic_task", "long_chaotic_note"],
  templates: {
    long_chaotic_calendar: [
      "Hele Silver prosím tě {date} kolem {time} doktor {place} a napiš tam že {note}",
      "Silver {date} někdy kolem {time} schůzku s {person} v {place} a napiš mi tam že {note}",
      "Silvere jen rychle — {date} servis auta v {place} v {time} a napiš tam že {note}",
    ],
    long_chaotic_task: [
      "Hele Silvere připomeň mi {date} {task} a ještě tam dej že {note}",
      "Silver dej mi do úkolů {date} {task} a připomeň že {note}",
    ],
    long_chaotic_note: [
      "Prosím tě Silver ulož mi někam že {note}",
      "Silver zapiš si prosím že {note}",
    ],
  },
  entities: {
    date: ["zítra", "v pátek", "příští středu", "pondělí ráno"],
    time: ["půl desáté", "v 9", "odpoledne", "kolem jedenácté"],
    place: ["Praha 4", "Brně", "u Anděla", "Praze 6"],
    person: ["Petrem", "Tománkem", "elektrikářem"],
    task: ["koupit mléko", "zavolat právníkovi", "poslat email"],
    note: ["vzít kartičku", "nachystat smlouvu", "děti budou u babičky"],
  },
  groupForCase: function (family) {
    if (family.indexOf("task") >= 0) return "task_write";
    if (family.indexOf("note") >= 0) return "note_write";
    return "calendar_write";
  },
  extraPass: function (turn, c) {
    const v = saveCore.validateSaveUnderstanding(turn, c.input);
    return v.pass;
  },
  probes: [
    {
      id: "A",
      input:
        "Hele Silver prosím tě já teď řídím takže jen rychle — zejtra někdy kolem půl desátý mám myslím toho doktora na Praze 4 jak jsme se o tom bavili a napiš mi tam prosím že si mám vzít výsledky krve a kartičku pojišťovny protože to zase zapomenu",
      intent: "calendar.create",
      group: "calendar_write",
      checks: { titleHas: "doktor", locHas: "praha", noteHas: "vzít" },
    },
  ],
});
