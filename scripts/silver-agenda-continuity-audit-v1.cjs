#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "AGC_E1",
    steps: ["Co mám zítra?", "Přidej tam ještě servis auta"],
    expectIntent: "calendar.create",
    titleNeed: ["servis"],
    maxDuplicateCreates: 0
  },
  {
    id: "AGC_E2",
    steps: ["Jak vypadá pátek?", "A dej tam ještě doktora"],
    expectIntent: "calendar.create",
    titleNeed: ["doktor"],
    maxDuplicateCreates: 0
  },
  {
    id: "AGC_E3",
    steps: ["Co mám tento týden?", "Přidej tam poradu s Kubou"],
    expectIntent: "calendar.create",
    titleNeed: ["schuz", "kub"],
    maxDuplicateCreates: 0
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_agenda_continuity_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-agenda-continuity-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
