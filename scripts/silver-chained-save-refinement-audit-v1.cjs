#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "CSR_1",
    steps: ["Zítra schůzka", "S Kubou", "Ve 14 hodin", "Na Václaváku", "A vezmu smlouvu"],
    expectIntent: "calendar.create",
    titleNeed: ["schuz", "kub"],
    noteNeed: ["smlouv"],
    locNeed: ["vaclav"],
    timeNeed: "14:00",
    maxDuplicateCreates: 0,
    requireUpdateAction: true
  },
  {
    id: "CSR_2",
    steps: ["Zítra doktor", "Vlastně v pátek", "V 9 ráno", "Na Vinohradské"],
    expectIntent: "calendar.create",
    titleNeed: ["doktor"],
    locNeed: ["vinohrad"],
    dateNeed: "2026-05-08",
    maxDuplicateCreates: 0,
    requireUpdateAction: true
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_chained_save_refinement_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-chained-save-refinement-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
