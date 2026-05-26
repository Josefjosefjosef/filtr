#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "CM_B1",
    steps: ["Zítra schůzka s Kubou", "Přidej tam adresu"],
    expectIntent: "calendar.create",
    titleNeed: ["schuz", "kub"],
    locNeed: ["adres"],
    maxDuplicateCreates: 0,
    requireUpdateAction: true
  },
  {
    id: "CM_B2",
    steps: ["V pátek doktor", "K tomu napiš výsledky"],
    expectIntent: "calendar.create",
    titleNeed: ["doktor"],
    noteNeed: ["vysled"],
    maxDuplicateCreates: 0
  },
  {
    id: "CM_B3",
    steps: ["Servis auta", "Přidej tam techničák"],
    expectIntent: "calendar.create",
    titleNeed: ["servis"],
    noteNeed: ["techn"],
    maxDuplicateCreates: 0
  },
  {
    id: "CM_B4",
    steps: ["Schůzka s Novotným", "A k tomu notebook"],
    expectIntent: "calendar.create",
    titleNeed: ["novotn"],
    noteNeed: ["notebook"],
    maxDuplicateCreates: 0
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_conversational_memory_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-conversational-memory-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
