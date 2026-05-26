#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "CC_A",
    steps: [
      "Zítra schůzka s Kubou",
      "A napiš si že mám vzít smlouvu",
      "A ještě tam dej adresu Václavské náměstí",
      "Vlastně ne zítra ale v pátek",
      "A změň čas na 14:00"
    ],
    expectIntent: "calendar.create",
    titleNeed: ["schuz", "kub"],
    noteNeed: ["smlouv"],
    locNeed: ["vaclav"],
    dateNeed: "2026-05-08",
    timeNeed: "14:00",
    maxDuplicateCreates: 0,
    requireUpdateAction: true
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_conversational_continuation_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-conversational-continuation-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
