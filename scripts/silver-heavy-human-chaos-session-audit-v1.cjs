#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "HHC_F1",
    steps: [
      "Hele zejtra schůzka s Kubou",
      "Jo a vlastně doktor",
      "Ne počkej doktor až v pátek",
      "A Kubovi dej adresu Václavák",
      "A připomeň mi notebook",
      "A doktorovi výsledky"
    ],
    expectIntent: "calendar.create",
    titleNeed: ["doktor"],
    noteNeed: ["vysled"],
    maxDuplicateCreates: 2
  },
  {
    id: "HHC_F2",
    steps: [
      "No prostě servis auta",
      "A k tomu techničák",
      "Ne počkej servis až ve čtvrtek",
      "A ještě schůzka s Novotným"
    ],
    expectIntent: "calendar.create",
    titleNeed: ["novotn"],
    maxDuplicateCreates: 1
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_heavy_human_chaos_session_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-heavy-human-chaos-session-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
