#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "PSR_E1",
    steps: [
      "Hele zejtra Kuba",
      "Jo a doktor",
      "Ne počkej doktor v pátek",
      "A Kubovi notebook",
      "Co mám zítra?",
      "A přidej servis",
      "Té schůzce s Kubou adresu",
      "A doktorovi výsledky",
      "Co mám tento týden?",
      "Vlastně servis až ve čtvrtek"
    ],
    expectIntent: "calendar.create",
    titleNeed: ["servis"],
    maxDuplicateCreates: 3
  },
  {
    id: "PSR_E2",
    steps: [
      "No prostě servis auta",
      "A k tomu techničák",
      "Ne počkej servis až ve čtvrtek",
      "A ještě schůzka s Novotným",
      "Co mám kolem servisu?",
      "K servisu napiš techničák"
    ],
    expectIntent: "calendar.create",
    titleNeed: ["servis"],
    noteNeed: ["techn"],
    maxDuplicateCreates: 2
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_public_stress_realism_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-public-stress-realism-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
