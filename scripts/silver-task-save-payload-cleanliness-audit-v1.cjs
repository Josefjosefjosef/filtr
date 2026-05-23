#!/usr/bin/env node
"use strict";
const { runAudit } = require("./silver-product-gap-audit-v1-core.cjs");

runAudit({
  harnessId: "silver_task_save_payload_cleanliness_audit_v1",
  reportFile: "silver-task-save-payload-cleanliness-audit-v1-report.json",
  seedSalt: 403,
  minAccuracy: 0.95,
  casesPerFamily: parseInt(process.env.SPG_CASES_PER_FAMILY || "2500", 10),
  families: ["task_title_clean", "task_note_clean", "task_deadline_clean"],
  templates: {
    task_title_clean: [
      "Přidej mi úkol {task} {date}",
      "Silvere do úkolů mi hoď {task} {date}",
    ],
    task_note_clean: [
      "Úkol {task} {date} a napiš tam že {note}",
      "Připomeň {task} {date} dej tam poznámku že {note}",
    ],
    task_deadline_clean: ["Silver připomeň {task} {date}"],
  },
  entities: {
    task: ["koupit mléko", "zavolat mámě", "poslat podklady"],
    date: ["zítra ráno", "v pátek", "v pondělí"],
    note: ["probrat léky", "přiložit faktury"],
  },
  groupForCase: function () {
    return "task_write";
  },
  probes: [
    {
      id: "B",
      input: "Silvere přidej mi úkol koupit mléko zítra ráno",
      intent: "tasks.create",
      group: "task_write",
      checks: { titleHas: "mléko" },
    },
    {
      id: "E",
      input: "Silvere do úkolů mi hoď v pátek ráno zavolat mámě a ať nezapomenu probrat léky",
      intent: "tasks.create",
      group: "task_write",
      checks: { titleHas: "mámě", noteHas: "lék" },
    },
  ],
});
