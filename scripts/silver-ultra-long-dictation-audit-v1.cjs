#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "ULD_D1",
    steps: [
      "Zítra Kuba a doktor v pátek a servis auta a Kubovi notebook a doktorovi výsledky a servisu techničák a Novotný ve čtvrtek a servis až ve čtvrtek a Kubovi dej adresu Václavák a k servisu zelenou kartu"
    ],
    expectIntent: "calendar.create",
    titleNeed: ["doktor"],
    maxDuplicateCreates: 1
  },
    {
      id: "ULD_D2",
      steps: [
        "Servis auta ve čtvrtek",
        "K servisu napiš zelenou kartu"
      ],
      expectIntent: "calendar.create",
      titleNeed: ["servis"],
      noteNeed: ["zelen"],
      maxDuplicateCreates: 0,
      requireUpdateAction: true
    }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_ultra_long_dictation_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-ultra-long-dictation-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
