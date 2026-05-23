#!/usr/bin/env node
"use strict";
const { runAudit } = require("./silver-product-gap-audit-v1-core.cjs");

const CASES = parseInt(process.env.SPG_CASES_PER_FAMILY || "2500", 10);

runAudit({
  harnessId: "silver_assistant_name_stripper_audit_v1",
  reportFile: "silver-assistant-name-stripper-audit-v1-report.json",
  seedSalt: 401,
  minAccuracy: 0.98,
  casesPerFamily: CASES,
  families: ["assistant_vocative_cal", "assistant_vocative_task", "assistant_vocative_note"],
  templates: {
    assistant_vocative_cal: [
      "Silver vlož mi do kalendáře {date} v {time} schůzku s {person}",
      "Silvere dej do kalendáře že má přijít {person} {date} v {time}",
      "Ahoj Silver ulož mi schůzku s {person} {date} v {time} v {place}",
      "Prosím tě Silver zítra v {time} oběd s {person}",
    ],
    assistant_vocative_task: [
      "Silvere přidej mi úkol {task} {date}",
      "Hej Silver úkol {task} {date}",
      "silver připomeň mi {task} {date}",
    ],
    assistant_vocative_note: [
      "Ahoj Silver ulož mi do poznámek že {note}",
      "Silvere zapiš si že {note}",
      "Silver napiš do poznámek že {note}",
    ],
  },
  entities: {
    person: ["instalatér", "technik", "Novotným", "Pavlem"],
    date: ["zítra", "v pátek", "příští středu"],
    time: ["9:00", "10:00", "15:00"],
    place: ["Brně", "Praze 4"],
    task: ["koupit mléko", "zavolat mámě", "poslat podklady"],
    note: ["pračka má záruku", "PIN je v šuplíku", "klíče u mámy"],
  },
  groupForCase: function (family) {
    if (family.indexOf("task") >= 0) return "task_write";
    if (family.indexOf("note") >= 0) return "note_write";
    return "calendar_write";
  },
  extraPass: function (turn) {
    const title = String((turn.draft && turn.draft.title) || "");
    const body = String((turn.draft && turn.draft.silverNoteText) || "");
    const note = String((turn.draft && turn.draft.note) || turn.draft.taskNote || "");
    const loc = String((turn.draft && turn.draft.location) || "");
    const blob = (title + " " + body + " " + note + " " + loc).toLowerCase();
    return !/\bsilver[eau]?\b/.test(blob);
  },
  probes: [
    {
      id: "A",
      input:
        "Silver vlož mi prosím tě do kalendáře že příští týden ve středu v 9 hod. ráno má přijít instalatér",
      intent: "calendar.create",
      group: "calendar_write",
      checks: { titleHas: "instalat" },
    },
    {
      id: "C",
      input: "Ahoj Silver ulož mi do poznámek že pračka má záruku do prosince 2028",
      intent: "notes.create",
      group: "note_write",
      checks: { bodyHas: "prač" },
    },
  ],
});
