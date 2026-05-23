#!/usr/bin/env node
"use strict";
const { runAudit } = require("./silver-product-gap-audit-v1-core.cjs");
runAudit({
  harnessId: "silver_long_chaotic_sentences_audit_v1",
  reportFile: "silver-long-chaotic-sentences-audit-v1-report.json",
  seedSalt: 44,
  minAccuracy: 0.9,
  casesPerFamily: 125,
  families: ["long_chaotic_cal", "long_chaotic_multi", "long_chaotic_task"],
  templates: {
    long_chaotic_cal: [
      "Hele prosím tě zejtra kolem desátý doktor v Praze 4 a napiš tam že mám vzít výsledky a ještě mi připomeň kartičku pojišťovny",
      "No jo kamo uloz mi do kalendare zejtra schuzku s {person} v {time} v {place} a napis tam ze {note} prosim",
    ],
    long_chaotic_multi: [
      "Hele zejtra kolem desátý doktor Praha 4 napiš tam že vzít výsledky a ještě úkol koupit léky",
      "Zítra v 10 doktor Praha 4 a přidej úkol koupit mléko a napiš tam že nesmím zapomenout",
    ],
    long_chaotic_task: [
      "Do úkolů mi přidej zavolat účetní a ať nezapomenu faktury prosím tě",
      "Hele pridej mi ukol {task} zejtra rano a napis tam ze {note}",
    ],
  },
  entities: {
    person: ["Petrem", "Pavlem"],
    time: ["10:00", "15:00"],
    place: ["Praze 4", "Brně"],
    note: ["vzít smlouvu", "nesmím zapomenout"],
    task: ["koupit mléko", "zavolat účetní"],
  },
  groupForCase: function (family, input) {
    const f = String(input || "").toLowerCase();
    if (family.indexOf("task") >= 0 || (/\bukol|úkol\b/.test(f) && !/\bdoktor|schůzk|kalend/.test(f))) return "task_write";
    return "calendar_write";
  },
  extraPass: function (turn) {
    const title = String((turn.draft && turn.draft.title) || "");
    if (!title) return turn.processingState === "READ_OK" || turn.normalizedIntent === "clarification";
    return !/\buloz\s+mi\b/i.test(title) && !/\bpridej\s+mi\s+ukol\b/i.test(title);
  },
  probes: [
    {
      id: "F",
      input: "Hele zejtra kolem desátý doktor Praha 4 napiš tam že vzít výsledky a ještě úkol koupit léky",
      intent: "calendar.create",
      group: "calendar_write",
      checks: { companionTask: true, titleHas: "doktor" },
    },
    {
      id: "G",
      input: "Ulož mi do kalendáře oběd s Pavlem ve 12 u Anděla a napiš tam že mám vzít smlouvu",
      intent: "calendar.create",
      group: "calendar_write",
      checks: { titleHas: "oběd", noteHas: "smlouv" },
    },
  ],
});
