#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "ASG_C1",
    steps: ["Co mám zítra?"],
    expectReadIntent: "calendar.read",
    mustNotWrite: true,
    readQueryNeed: ["agenda_for_day"]
  },
  {
    id: "ASG_C2",
    steps: ["Shrň mi pátek"],
    expectReadIntent: "calendar.read",
    mustNotWrite: true,
    readQueryNeed: ["agenda_for_day"]
  },
  {
    id: "ASG_C3",
    steps: ["Jak vypadá tento týden?"],
    expectReadIntent: "calendar.read",
    mustNotWrite: true,
    readQueryNeed: ["agenda_for_week"]
  },
  {
    id: "ASG_C4",
    steps: ["Co mám kolem doktora?"],
    expectReadIntent: "calendar.read",
    mustNotWrite: true,
    readQueryNeed: ["find_by_title"]
  },
  {
    id: "ASG_C5",
    steps: ["Co mám kolem servisu?"],
    expectReadIntent: "calendar.read",
    mustNotWrite: true,
    readQueryNeed: ["find_by_title"]
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_agenda_summary_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-agenda-summary-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
