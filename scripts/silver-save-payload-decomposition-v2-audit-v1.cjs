#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-understanding-audit-shared.cjs");

const CASES = [
  {
    id: "SPD_B1",
    input: "Zítra v 15 hodin schůzka s Novotným na Václavském náměstí a napiš si že mu mám dát smlouvu k projektu Palmovka",
    expect: "calendar",
    titleNeed: ["novotn", "schuz"],
    noteNeed: ["smlouv", "palmovka"],
    locNeed: ["vaclav"],
    titleMustNot: ["napiš", "napis", "palmovka"]
  },
  {
    id: "SPD_B2",
    input: "V pátek doktor v 9 ráno na Vinohradské a připomeň mi že mám vzít výsledky",
    expect: "calendar",
    titleNeed: ["doktor"],
    noteNeed: ["vysled"],
    locNeed: ["vinohrad"],
    titleMustNot: ["pripomen", "vysled"]
  },
  {
    id: "SPD_B3",
    input: "Zítra servis auta a napiš si že mám vzít techničák a zelenou kartu",
    expect: "calendar",
    titleNeed: ["servis"],
    noteNeed: ["techn", "zelen"],
    titleMustNot: ["techn", "zelen"]
  },
  {
    id: "SPD_B4",
    input: "V pondělí porada v kanceláři a napiš si že mám vytisknout dokumentaci",
    expect: "calendar",
    titleNeed: ["porad"],
    noteNeed: ["dokument"],
    titleMustNot: ["dokument", "vytisk"]
  }
];

if (require.main === module) {
  shared.runAudit(
    "silver_save_payload_decomposition_v2_audit_v1",
    CASES,
    path.join(__dirname, "silver-save-payload-decomposition-v2-audit-v1-report.json")
  );
}

module.exports = { CASES };
