#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "CDC_F1",
    steps: ["Včera Kuba", "Dnes přidej adresu"],
    expectIntent: "calendar.create",
    titleNeed: ["kub"],
    locNeed: ["adres"],
    maxDuplicateCreates: 0,
    requireUpdateAction: true
  },
  {
    id: "CDC_F2",
    steps: ["Ráno doktor", "Večer změň čas na 10"],
    expectIntent: "calendar.create",
    titleNeed: ["doktor"],
    timeNeed: "10:00",
    maxDuplicateCreates: 0,
    requireUpdateAction: true
  },
  {
    id: "CDC_F3",
    steps: ["V pondělí servis auta", "Ve středu přidej poznámku"],
    expectIntent: "calendar.create",
    titleNeed: ["servis"],
    noteNeed: ["poznam"],
    maxDuplicateCreates: 0,
    requireUpdateAction: true
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_cross_day_continuity_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-cross-day-continuity-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
