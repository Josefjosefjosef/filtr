#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "IFR_C1",
    steps: [
      "Zítra schůzka s Kubou",
      "Jo počkej",
      "Vlastně nejdřív doktor",
      "V 9 ráno",
      "A pak ta schůzka s Kubou ve 14"
    ],
    expectIntent: "calendar.create",
    titleNeed: ["schuz", "kub"],
    timeNeed: "14:00",
    maxDuplicateCreates: 1
  },
  {
    id: "IFR_C2",
    steps: ["Servis auta", "Ne počkej", "To dej na čtvrtek", "A ještě k tomu techničák"],
    expectIntent: "calendar.create",
    titleNeed: ["servis"],
    noteNeed: ["techn"],
    maxDuplicateCreates: 0
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_interrupted_flow_recovery_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-interrupted-flow-recovery-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
