#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-payload-intelligence-line-k-shared.cjs");

const FILLER = [
  "Zítra porada s Martinou",
  "Úkol koupit mléko",
  "Poznámka heslo wifi",
  "Zítra schůzka s Novotným",
  "V pátek kontrola",
  "Servis kola ve středu",
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
  "V sobotu servis"
];

const SCENARIOS = [
  {
    id: "LSM_A1",
    steps: ["Zítra schůzka s Kubou", "V pátek doktor", "Servis auta ve čtvrtek"].concat(FILLER).concat([
      "Té schůzce s Kubou přidej adresu",
      "Doktorovi připomeň výsledky",
      "K servisu napiš techničák"
    ]),
    expectIntent: "calendar.create",
    titleNeed: ["servis"],
    noteNeed: ["techn"],
    maxDuplicateCreates: 22,
    requireUpdateAction: false
  },
  {
    id: "LSM_A2",
    steps: ["Zítra schůzka s Kubou", "V pátek doktor", "Servis auta ve čtvrtek", "Zítra porada", "Úkol zavolat"].concat(FILLER.slice(0, 12)).concat([
      "Schůzce s Kubou přidej notebook",
      "Doktorovi změň čas na 10"
    ]),
    expectIntent: "calendar.create",
    titleNeed: ["doktor"],
    timeNeed: "10:00",
    maxDuplicateCreates: 18
  }
];

if (require.main === module) {
  process.exit(
    shared.runAudit(
      "silver_long_session_memory_audit_v1",
      SCENARIOS,
      path.join(__dirname, "silver-long-session-memory-audit-v1-report.json")
    )
  );
}

module.exports = { SCENARIOS };
