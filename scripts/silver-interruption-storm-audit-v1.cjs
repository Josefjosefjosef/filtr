#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "IS_B1",
    steps: [
      "Zítra Kuba",
      "Jo počkej",
      "Ne vlastně doktor",
      "Ne počkej Kuba",
      "V pátek doktor",
      "A Kubovi adresu",
      "Jo a servis auta",
      "Ne počkej servis až ve čtvrtek",
      "A doktorovi výsledky"
    ],
    expectIntent: "calendar.create",
    titleNeed: ["doktor"],
    noteNeed: ["vysled"],
    maxDuplicateCreates: 3
  },
  {
    id: "IS_B2",
    steps: ["Zítra schůzka s Kubou", "Počkej", "Vlastně ne", "Doktor v pátek", "A Kubovi notebook"],
    expectIntent: "calendar.create",
    titleNeed: ["kub"],
    noteNeed: ["notebook"],
    maxDuplicateCreates: 1
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_interruption_storm_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-interruption-storm-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
