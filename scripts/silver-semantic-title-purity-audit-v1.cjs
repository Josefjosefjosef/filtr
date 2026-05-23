#!/usr/bin/env node
"use strict";
const { runAudit } = require("./silver-product-gap-audit-v1-core.cjs");
const ENT = {
  person: ["Petrem", "Pavlem", "doktorem", "Kubou"],
  date: ["zítra", "dnes", "v pátek"],
  time: ["10:00", "15:00", "odpoledne"],
  task: ["koupit mléko", "zavolat účetní", "poslat email"],
};
runAudit({
  harnessId: "silver_semantic_title_purity_audit_v1",
  reportFile: "silver-semantic-title-purity-audit-v1-report.json",
  seedSalt: 11,
  minAccuracy: 0.94,
  families: ["title_purity_calendar", "title_purity_task", "instruction_prefix_title", "temporal_title_strip", "kterou_mam_jit_title"],
  templates: {
    title_purity_calendar: [
      "Schůzka kterou mám zítra s {person}",
      "Zítra v {time} doktor v Praze 4",
      "Potřebuju zítra oběd s {person}",
    ],
    title_purity_task: ["Ulož mi úkol {task} zítra ráno", "Přidej mi úkol {task}", "Hele prosím tě přidej úkol {task}"],
    instruction_prefix_title: [
      "Ulož mi do kalendáře schůzku s {person} {date}",
      "Hoď mi úkol {task} v pátek",
    ],
    temporal_title_strip: ["Zítra v {time} schůzka s {person}", "Dnes odpoledne kontrola u {person}"],
    kterou_mam_jit_title: ["Schůzku kterou mám jít {date} s {person}", "Mám jít {date} k {person}"],
  },
  entities: ENT,
  groupForCase: function (family, input) {
    const f = String(input || "").toLowerCase();
    if (/\bukol|úkol\b/.test(f) && !/\bkalend|schůzk/.test(f)) return "task_write";
    return "calendar_write";
  },
  probes: [
    { id: "A", input: "Ulož mi úkol koupit mléko zítra ráno", intent: "tasks.create", group: "task_write", checks: { titleHas: "mléko" } },
    { id: "B", input: "Zítra v 10 doktor Praha 4", intent: "calendar.create", group: "calendar_write", checks: { titleHas: "doktor" } },
  ],
});
