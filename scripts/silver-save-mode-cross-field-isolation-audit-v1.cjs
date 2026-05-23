#!/usr/bin/env node
"use strict";
const { runAudit } = require("./silver-product-gap-audit-v1-core.cjs");

runAudit({
  harnessId: "silver_save_mode_cross_field_isolation_audit_v1",
  reportFile: "silver-save-mode-cross-field-isolation-audit-v1-report.json",
  seedSalt: 405,
  minAccuracy: 0.94,
  casesPerFamily: parseInt(process.env.SPG_CASES_PER_FAMILY || "2500", 10),
  families: ["title_loc_split", "title_note_split", "task_note_isolation"],
  templates: {
    title_loc_split: [
      "Schůzka s {person} {date} v {time} v {place}",
      "Silver vlož schůzku s {person} {date} {time} {place}",
    ],
    title_note_split: [
      "Ulož {date} v {time} {person} a napiš tam že {note}",
    ],
    task_note_isolation: ["Přidej {task} {date} napiš tam že {note}"],
  },
  entities: {
    person: ["Novotným", "technik", "doktor"],
    date: ["zítra", "příští úterý"],
    time: ["10:00", "15:00"],
    place: ["Brno", "Praha 4", "servis Brno"],
    task: ["kontrola auta", "zavolat mámě"],
    note: ["vzít techničák", "přiložit faktury"],
  },
  groupForCase: function (family, input) {
    const f = String(input || "").toLowerCase();
    if (family.indexOf("task") >= 0 || /\bukol|úkol\b/.test(f)) return "task_write";
    return "calendar_write";
  },
  probes: [
    {
      id: "I",
      input: "Silver vlož mi schůzku s Novotným příští úterý v 15 v Brně",
      intent: "calendar.create",
      group: "calendar_write",
      checks: { titleHas: "novotn", locHas: "brn" },
    },
    {
      id: "M",
      input:
        "Silver ulož mi do kalendáře příští týden v pondělí v 11 kontrola auta v servisu Brno a poznámka vzít techničák",
      intent: "calendar.create",
      group: "calendar_write",
      checks: { titleHas: "kontrol", locHas: "brn", noteHas: "technič" },
    },
  ],
});
