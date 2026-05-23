#!/usr/bin/env node
"use strict";
const { runAudit } = require("./silver-product-gap-audit-v1-core.cjs");
runAudit({
  harnessId: "silver_multi_intent_orchestration_audit_v1",
  reportFile: "silver-multi-intent-orchestration-audit-v1-report.json",
  seedSalt: 33,
  minAccuracy: 0.9,
  families: ["cal_plus_task", "cal_plus_note_tail", "read_plus_write_blocked"],
  templates: {
    cal_plus_task: [
      "Zítra v 10 doktor a přidej úkol koupit léky",
      "Dnes v 15 schůzka s Petrem a přidej úkol zavolat účetní",
      "Zejtra doktor Praha 4 a přidej úkol koupit mléko",
    ],
    cal_plus_note_tail: [
      "Zítra v 10 doktor a napiš tam že vzít kartičku",
      "Oběd s Pavlem zítra a napiš tam že smlouva",
    ],
    read_plus_write_blocked: ["Kdy mám doktora a přidej úkol koupit mléko"],
  },
  entities: { person: ["Petrem", "Pavlem"], task: ["koupit mléko", "zavolat účetní"] },
  groupForCase: function () {
    return "calendar_write";
  },
  extraPass: function (turn, c) {
    const f = String(c.family || "");
    if (f === "cal_plus_task") {
      return turn.normalizedIntent === "calendar.create" && !!turn.silverCompanionTaskIntent;
    }
    if (f === "cal_plus_note_tail") {
      return turn.normalizedIntent === "calendar.create" && String((turn.draft && turn.draft.note) || "").length > 2;
    }
    return true;
  },
  probes: [
    {
      id: "D",
      input: "Zejtra v 10 doktor a přidej úkol koupit léky",
      intent: "calendar.create",
      group: "calendar_write",
      checks: { companionTask: true, titleHas: "doktor" },
    },
    {
      id: "F",
      input: "Hele zejtra kolem desáté doktor Praha 4 napiš tam že vzít výsledky a ještě úkol koupit léky",
      intent: "calendar.create",
      group: "calendar_write",
      checks: { companionTask: true },
    },
  ],
});
