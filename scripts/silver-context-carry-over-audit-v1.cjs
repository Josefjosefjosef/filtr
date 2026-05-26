#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "CCO_1",
    steps: ["Zítra porada", "A připomeň mi dokumentaci"],
    expectIntent: "calendar.create",
    titleNeed: ["porad"],
    noteNeed: ["dokument"],
    maxDuplicateCreates: 0
  },
  {
    id: "CCO_2",
    steps: ["Zítra schůzka s právníkem", "A napiš si smlouvu"],
    expectIntent: "calendar.create",
    titleNeed: ["pravn", "schuz"],
    noteNeed: ["smlouv"],
    maxDuplicateCreates: 0
  },
  {
    id: "CCO_3",
    steps: ["V pátek servis auta", "A vezmi techničák"],
    expectIntent: "calendar.create",
    titleNeed: ["servis"],
    noteNeed: ["techn"],
    maxDuplicateCreates: 0
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_context_carry_over_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-context-carry-over-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
