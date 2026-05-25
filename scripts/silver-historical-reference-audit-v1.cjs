#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "HRE_B1",
    steps: ["Včera schůzka s Novotným", "Té schůzce přidej notebook"],
    expectIntent: "calendar.create",
    titleNeed: ["novotn"],
    noteNeed: ["notebook"],
    maxDuplicateCreates: 0,
    requireUpdateAction: true
  },
  {
    id: "HRE_B2",
    steps: ["Ráno doktor", "K tomu výsledky"],
    expectIntent: "calendar.create",
    titleNeed: ["doktor"],
    noteNeed: ["vysled"],
    maxDuplicateCreates: 0,
    requireUpdateAction: true
  },
  {
    id: "HRE_B3",
    steps: ["V pondělí servis auta", "Přidej tam zelenou kartu"],
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
      "silver_historical_reference_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-historical-reference-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
