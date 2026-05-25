#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "PHS_C1",
    steps: [
      "Hele zejtra Kuba",
      "A jo doktor",
      "Vlastně ne",
      "Počkej",
      "Kubovi notebook",
      "No a doktor",
      "Výsledky",
      "Servis auta",
      "Čtvrtek",
      "Ne pátek"
    ],
    expectIntent: "calendar.create",
    titleNeed: ["servis"],
    maxDuplicateCreates: 2
  },
  {
    id: "PHS_C2",
    steps: ["Hele zejtra Kuba", "Počkej", "Výsledky", "Doktor v pátek"],
    expectIntent: "calendar.create",
    titleNeed: ["doktor"],
    maxDuplicateCreates: 2
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_pathological_human_session_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-pathological-human-session-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
