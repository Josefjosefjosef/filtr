#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const SCENARIOS = [
  {
    id: "CCE_D1",
    steps: [
      "Zítra schůzka s Kubou",
      "V pátek doktor",
      "Servis auta ve čtvrtek",
      "Co mám zítra?",
      "Přidej tam servis",
      "Té schůzce s Kubou adresu",
      "Doktorovi výsledky",
      "Úkol koupit rohlíky",
      "Poznámka PIN karta",
      "Zítra porada s Martinou",
      "V pátek kontrola",
      "Servis kola",
      "Zítra schůzka s Pavlem",
      "V sobotu oslava",
      "V neděli klid",
      "Zítra schůzka s Petrem",
      "Ve čtvrtek cvičení",
      "V pátek střechování",
      "V sobotu nákup",
      "V neděli procházka",
      "V pondělí porada",
      "V úterý doktor zubní",
      "Ve středu servis auta",
      "Ve čtvrtek schůzka s Kubou",
      "V pátek doktor",
      "V sobotu servis",
      "Jo počkej",
      "A Kubovi notebook",
      "K servisu techničák",
      "Co mám tento týden?",
      "Vlastně servis až ve čtvrtek"
    ],
    expectIntent: "calendar.create",
    titleNeed: ["servis"],
    maxDuplicateCreates: 18
  },
  {
    id: "CCE_D2",
    steps: [
      "Hele zejtra Kuba",
      "Jo a doktor",
      "Ne počkej doktor v pátek",
      "A Kubovi dej adresu Václavák",
      "A připomeň mi notebook",
      "A doktorovi výsledky",
      "Co mám zítra?",
      "A přidej servis",
      "Té schůzce s Kubou adresu",
      "Vlastně servis až ve čtvrtek",
      "Schůzce s Kubou přidej notebook",
      "Doktorovi změň čas na 9",
      "K servisu napiš techničák",
      "K servisu napiš techničák"
    ],
    expectIntent: "calendar.create",
    titleNeed: ["servis"],
    noteNeed: ["techn"],
    maxDuplicateCreates: 18
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_conversational_compression_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-conversational-compression-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
