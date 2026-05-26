#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "MDO_A1",
    steps: [
      "Zítra schůzka s Kubou",
      "V pátek doktor",
      "Té schůzce s Kubou přidej adresu",
      "Doktorovi změň čas na 10"
    ],
    expectIntent: "calendar.create",
    titleNeed: ["doktor"],
    timeNeed: "10:00",
    maxDuplicateCreates: 1,
    requireUpdateAction: false
  },
  {
    id: "MDO_A2",
    steps: [
      "Zítra schůzka s Kubou",
      "Zítra servis auta",
      "A k tomu servisu napiš techničák",
      "Schůzce s Kubou přidej notebook"
    ],
    expectIntent: "calendar.create",
    titleNeed: ["schuz", "kub"],
    noteNeed: ["notebook"],
    maxDuplicateCreates: 2
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_multi_draft_orchestration_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-multi-draft-orchestration-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
