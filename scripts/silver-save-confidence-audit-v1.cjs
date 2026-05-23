#!/usr/bin/env node
"use strict";
const { runAudit } = require("./silver-product-gap-audit-v1-core.cjs");

runAudit({
  harnessId: "silver_save_confidence_audit_v1",
  reportFile: "silver-save-confidence-audit-v1-report.json",
  seedSalt: 7304,
  minAccuracy: 0.9,
  casesPerFamily: parseInt(process.env.SPG_CASES_PER_FAMILY || "2500", 10),
  families: ["confidence_high", "confidence_medium"],
  templates: {
    confidence_high: [
      "Dej mi do kalendáře {date} v {time} schůzku s {person} v {place}",
      "Přidej úkol {task} {date}",
    ],
    confidence_medium: [
      "Hele Silver {date} někdy kolem {time} asi doktor {place} a napiš tam že {note}",
      "Silver možná {date} schůzku s {person}",
    ],
  },
  entities: {
    date: ["zítra", "v pátek"],
    time: ["10:00", "půl desáté"],
    place: ["Praha 4"],
    person: ["Petrem"],
    task: ["koupit mléko"],
    note: ["vzít kartičku"],
  },
  groupForCase: function (family, input) {
    if (/\bukol|úkol\b/i.test(input)) return "task_write";
    return "calendar_write";
  },
  extraPass: function (turn) {
    const meta = turn.draft && turn.draft.meta;
    if (!meta) return false;
    const conf = String(meta.saveUnderstandingConfidence || "");
    if (!conf) return false;
    if (conf === "low" && meta.saveUnderstandingNeedsClarification) return true;
    return conf === "high" || conf === "medium";
  },
});
