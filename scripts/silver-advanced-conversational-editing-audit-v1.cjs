#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "ACE_D1",
    steps: ["Schůzka s Kubou zítra v 15", "Změň to na 14"],
    expectIntent: "calendar.create",
    titleNeed: ["schuz", "kub"],
    timeNeed: "14:00",
    maxDuplicateCreates: 0,
    requireUpdateAction: true
  },
  {
    id: "ACE_D2",
    steps: ["Doktor v pátek", "Přesuň to na pondělí"],
    expectIntent: "calendar.create",
    titleNeed: ["doktor"],
    maxDuplicateCreates: 0
  },
  {
    id: "ACE_D3",
    steps: ["Servis auta", "Nech tam jen techničák"],
    expectIntent: "calendar.create",
    titleNeed: ["servis"],
    noteNeed: ["techn"],
    maxDuplicateCreates: 0
  },
  {
    id: "ACE_D4",
    steps: ["Schůzka s Novotným", "Smaž poznámku"],
    expectIntent: "calendar.create",
    titleNeed: ["novotn"],
    maxDuplicateCreates: 0
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_advanced_conversational_editing_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-advanced-conversational-editing-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
