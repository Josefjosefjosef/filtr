#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "DLF_F1",
    steps: ["Zítra Kuba", "Úkol nakoupit", "Vrať se k té schůzce s Kubou", "Přidej lokaci Brno"],
    expectIntent: "calendar.create",
    titleNeed: ["kub"],
    locNeed: ["brno"],
    maxDuplicateCreates: 1,
    requireUpdateAction: false
  },
  {
    id: "DLF_F2",
    steps: ["Doktor v pátek", "Hotovo", "Vlastně změň čas na 10"],
    expectIntent: "calendar.create",
    titleNeed: ["doktor"],
    timeNeed: "10:00",
    maxDuplicateCreates: 0,
    requireUpdateAction: false
  },
  {
    id: "DLF_F3",
    steps: ["Zítra schůzka s Kubou", "Servis auta", "Hotovo", "Vrať se k té schůzce s Kubou", "Přidej tam adresu"],
    expectIntent: "calendar.create",
    titleNeed: ["kub"],
    locNeed: ["adres"],
    maxDuplicateCreates: 1
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_draft_lifecycle_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-draft-lifecycle-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
