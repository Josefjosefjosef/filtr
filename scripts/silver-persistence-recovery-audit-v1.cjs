#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const { SILVER_RELOAD_SENTINEL, SILVER_DELAY_SENTINEL } = shared;

const SCENARIOS = [
  {
    id: "PR_A1",
    steps: ["Zítra Kuba", SILVER_RELOAD_SENTINEL, "Přidej adresu"],
    expectIntent: "calendar.create",
    titleNeed: ["kub"],
    locNeed: ["adres"],
    maxDuplicateCreates: 0,
    requireUpdateAction: true
  },
  {
    id: "PR_A2",
    steps: ["Doktor v pátek", SILVER_RELOAD_SENTINEL, "Změň čas na 10"],
    expectIntent: "calendar.create",
    titleNeed: ["doktor"],
    timeNeed: "10:00",
    maxDuplicateCreates: 0,
    requireUpdateAction: true
  },
  {
    id: "PR_A3",
    steps: ["Servis auta", SILVER_DELAY_SENTINEL, "Přidej techničák"],
    expectIntent: "calendar.create",
    titleNeed: ["servis"],
    noteNeed: ["techn"],
    maxDuplicateCreates: 0,
    requireUpdateAction: true
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_persistence_recovery_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-persistence-recovery-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
