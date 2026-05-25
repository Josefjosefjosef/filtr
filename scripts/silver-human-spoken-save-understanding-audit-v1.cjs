#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-understanding-audit-shared.cjs");

const CASES = [
  { id: "HS01", input: "No prostě zejtra koupit rohlíky", expect: "task", titleNeed: ["rohl"] },
  { id: "HS02", input: "Ee připomeň mi koupit mléko", expect: "task", titleNeed: ["mléko", "mleko"] },
  {
    id: "HS03",
    input: "Hele zejtra schůzka s Kubou a napiš si smlouvu",
    expect: "calendar",
    titleNeed: ["schuz", "kub"]
  },
  { id: "HS04", input: "Hele zejtra servis auta", expect: "calendar", titleNeed: ["servis"] },
  { id: "HS05", input: "Ee zejtra doktor a připomeň výsledky", expect: "calendar", titleNeed: ["doktor"] },
  { id: "HS06", input: "Jo a ještě připomeň deštník", expect: "task", titleNeed: ["deštn", "destn"] },
  {
    id: "HS07",
    input: "No a napiš si že mám vzít techničák",
    expect: "notes",
    titleNeed: ["techn"]
  },
  {
    id: "HS08",
    input: "Ulož mi prosím tě Silvere do kalendáře zítra schůzku na václavském náměstí v Praze s panem Novotným a připomeň mi ať si vezmu dokumentaci k tomu projektu Palmovka",
    expect: "calendar",
    titleNeed: ["novotn", "schuz"],
    noteNeed: ["dokument", "palmovka"],
    noStorageDisambiguation: true
  },
  {
    id: "HS09",
    input: "Dej mě do poznámky že si sebou mám vzít 500 Kč na zítřejší schůzku s panem Novotným kterou mám mít na václavském náměstí v Praze",
    expect: "calendar",
    titleNeed: ["novotn", "schuz"],
    noteNeed: ["500"],
    noStorageDisambiguation: true
  }
];

if (require.main === module) {
  shared.runAudit(
    "silver_human_spoken_save_understanding_audit_v1",
    CASES,
    path.join(__dirname, "silver-human-spoken-save-understanding-audit-v1-report.json")
  );
}

module.exports = { CASES };
