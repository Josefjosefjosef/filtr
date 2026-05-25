#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-understanding-audit-shared.cjs");

const CASES = [
  { id: "TC01", input: "Zítra koupit rohlíky", expect: "task", titleNeed: ["rohl"] },
  { id: "TC02", input: "V pondělí vyměnit olej", expect: "task", titleNeed: ["olej"] },
  { id: "TC03", input: "Večer zaplatit nájem", expect: "task", titleNeed: ["najem", "nájem"] },
  { id: "TC04", input: "Zítra zavolat doktorovi", expect: "task", titleNeed: ["zavolat", "doktor"] },
  { id: "TC05", input: "Připomeň mi koupit mléko", expect: "task", titleNeed: ["mléko", "mleko"] },
  { id: "TC06", input: "Zítra schůzka s Kubou", expect: "calendar", titleNeed: ["schuz", "kub"] },
  { id: "TC07", input: "V pondělí porada v 10", expect: "calendar", titleNeed: ["porad"] },
  { id: "TC08", input: "Zítra večeře s Janou", expect: "calendar", titleNeed: ["vecer", "večeř", "jana"] },
  { id: "TC09", input: "Ve 14 hodin servis auta", expect: "calendar", titleNeed: ["servis"] },
  { id: "TC10", input: "Zítra doktor v 9", expect: "calendar", titleNeed: ["doktor"] },
  {
    id: "TC11",
    input: "Zítra schůzka s Kubou a připomeň mi vzít smlouvu",
    expect: "mixed_calendar",
    titleNeed: ["schuz", "kub"]
  },
  {
    id: "TC12",
    input: "V pondělí porada a napiš si že mám vzít dokumentaci",
    expect: "mixed_calendar",
    titleNeed: ["porad"]
  },
  {
    id: "TC13",
    input: "Zítra servis auta a připomeň mi techničák",
    expect: "mixed_calendar",
    titleNeed: ["servis"]
  }
];

if (require.main === module) {
  shared.runAudit(
    "silver_task_vs_calendar_ownership_audit_v1",
    CASES,
    path.join(__dirname, "silver-task-vs-calendar-ownership-audit-v1-report.json")
  );
}

module.exports = { CASES };
