#!/usr/bin/env node
"use strict";
const { runAudit } = require("./silver-product-gap-audit-v1-core.cjs");

runAudit({
  harnessId: "silver_calendar_save_payload_cleanliness_audit_v1",
  reportFile: "silver-calendar-save-payload-cleanliness-audit-v1-report.json",
  seedSalt: 402,
  minAccuracy: 0.95,
  casesPerFamily: parseInt(process.env.SPG_CASES_PER_FAMILY || "2500", 10),
  families: ["cal_title_clean", "cal_slot_split", "cal_event_note"],
  templates: {
    cal_title_clean: [
      "Ulož mi do kalendáře {date} v {time} že má přijít {person}",
      "Silver dej schůzku s {person} {date} v {time}",
    ],
    cal_slot_split: [
      "Schůzka s {person} {date} v {time} v {place} připomeň {note}",
      "Doktor {date} v {time} {place} napiš tam {note}",
    ],
    cal_event_note: [
      "Ulož {date} v {time} schůzku s {person} a napiš tam že {note}",
    ],
  },
  entities: {
    person: ["instalatér", "technik", "Petrem"],
    date: ["zítra", "příští středu", "v pátek"],
    time: ["9:00", "10:00", "15:00"],
    place: ["Praze 4", "Brně", "u Anděla"],
    note: ["vzít kartičku", "vzít smlouvu"],
  },
  groupForCase: function () {
    return "calendar_write";
  },
  probes: [
    {
      id: "D",
      input: "Silver dej mi do kalendáře zítra v 10 doktor Praha 4 a napiš tam že vzít kartičku",
      intent: "calendar.create",
      group: "calendar_write",
      checks: { titleHas: "doktor", locHas: "praha", noteHas: "kart" },
    },
  ],
});
