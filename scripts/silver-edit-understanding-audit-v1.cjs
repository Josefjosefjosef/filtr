#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "EU_1",
    steps: ["Zítra schůzka s Kubou", "Vlastně v pátek"],
    expectIntent: "calendar.create",
    titleNeed: ["schuz", "kub"],
    dateNeed: "2026-05-08",
    maxDuplicateCreates: 0,
    requireUpdateAction: true
  },
  {
    id: "EU_2",
    steps: ["Zítra doktor v 9", "Změň čas na 10"],
    expectIntent: "calendar.create",
    titleNeed: ["doktor"],
    timeNeed: "10:00",
    maxDuplicateCreates: 0
  },
  {
    id: "EU_3",
    steps: ["Zítra schůzka na Václaváku", "Přesuň to na Anděl"],
    expectIntent: "calendar.create",
    titleNeed: ["schuz"],
    locNeed: ["andel"],
    maxDuplicateCreates: 0
  },
  {
    id: "EU_4",
    steps: ["Zítra porada", "Přidej poznámku že mám vzít smlouvu"],
    expectIntent: "calendar.create",
    titleNeed: ["porad"],
    noteNeed: ["smlouv"],
    maxDuplicateCreates: 0
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_edit_understanding_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-edit-understanding-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
