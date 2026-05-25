#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-understanding-audit-shared.cjs");

const CASES = [
  {
    id: "LHS_F1",
    input:
      "Hele zejtra v 15 hodin schůzka s Kubou na Václaváku a napiš si že mám vzít smlouvu k projektu Palmovka a připomeň mi deštník",
    expect: "calendar",
    titleNeed: ["schuz", "kub"],
    noteNeed: ["smlouv", "destn"],
    titleMustNot: ["hele", "palmovka", "destn"]
  },
  {
    id: "LHS_F2",
    input:
      "No prostě v pondělí doktor na Vinohradské a napiš si výsledky a ještě že mám vyzvednout recept",
    expect: "calendar",
    titleNeed: ["doktor"],
    noteNeed: ["vysled", "recept"],
    titleMustNot: ["no prost", "vysled"]
  },
  {
    id: "LHS_F3",
    input: "Ee zejtra servis auta a napiš si techničák a zelenou kartu a vlastně to dej na čtvrtek",
    expect: "calendar",
    titleNeed: ["servis"],
    noteNeed: ["techn", "zelen"]
  },
  {
    id: "LHS_F4",
    input: "Hele porada s Novotným a napiš si že mám vytisknout dokumentaci a vzít notebook",
    expect: "calendar",
    titleNeed: ["porad", "novotn"],
    noteNeed: ["dokument", "notebook"],
    titleMustNot: ["hele", "dokument"]
  }
];

if (require.main === module) {
  shared.runAudit(
    "silver_long_human_save_understanding_audit_v1",
    CASES,
    path.join(__dirname, "silver-long-human-save-understanding-audit-v1-report.json")
  );
}

module.exports = { CASES };
