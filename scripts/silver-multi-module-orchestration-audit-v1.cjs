#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-understanding-audit-shared.cjs");

const CASES = [
  {
    id: "MM01",
    input: "Vytvoř do poznámek složku porada a přidávej tam úkoly",
    expect: "notes",
    titleNeed: ["porad"]
  },
  {
    id: "MM02",
    input: "Zítra schůzka s Kubou a do poznámek napiš že mám vzít smlouvu",
    expect: "calendar",
    titleNeed: ["schuz", "kub"],
    noteNeed: ["smlouv"]
  },
  {
    id: "MM03",
    input: "Připomeň mi koupit mléko a do poznámek napiš že dochází pečivo",
    expect: "mixed_task_note",
    titleNeed: ["mléko", "mleko"],
    requireCompanionNote: true,
    companionNoteNeed: ["pečiv", "peciv"]
  },
  {
    id: "MM04",
    input: "Zítra porada a vytvoř poznámku projekt Palmovka",
    expect: "calendar",
    titleNeed: ["porad"]
  },
  {
    id: "MM05",
    input: "Schůzka s právníkem a napiš si že mám vzít dokumentaci",
    expect: "calendar",
    titleNeed: ["schuz", "pravn"],
    noteNeed: ["dokument"]
  },
  {
    id: "MM06",
    input: "Zítra schůzka s Kubou a napiš si smlouvu",
    expect: "calendar",
    titleNeed: ["schuz", "kub"]
  }
];

if (require.main === module) {
  shared.runAudit(
    "silver_multi_module_orchestration_audit_v1",
    CASES,
    path.join(__dirname, "silver-multi-module-orchestration-audit-v1-report.json")
  );
}

module.exports = { CASES };
