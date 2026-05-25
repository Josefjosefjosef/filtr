#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-understanding-audit-shared.cjs");

const CASES = [
  { id: "RS01", input: "Připomeň mi zítra koupit 10 rohlíků", expect: "task", titleNeed: ["rohl"] },
  { id: "RS02", input: "Připomeň mi v pondělí že musím vyměnit olej", expect: "task", titleNeed: ["olej", "vymen"] },
  { id: "RS03", input: "Připomeň mi dneska že musím jít brzo spát", expect: "task", titleNeed: ["sp"] },
  { id: "RS04", input: "Připomeň mi zaplatit nájem", expect: "task", titleNeed: ["najem", "nájem"] },
  { id: "RS05", input: "Připomeň mi zavolat právníkovi", expect: "task", titleNeed: ["zavolat", "pravn"] },
  { id: "RS06", input: "Připomeň mi objednat servis", expect: "task", titleNeed: ["servis", "objednat"] },
  { id: "RS07", input: "Připomeň mi koupit nabíječku", expect: "task", titleNeed: ["nabij"] },
  { id: "RS08", input: "Připomeň mi vzít deštník", expect: "task", titleNeed: ["deštn", "destn"] },
  { id: "RS09", input: "Připomeň mi vyzvednout balík", expect: "task", titleNeed: ["vyzved", "bal"] },
  { id: "RS10", input: "Připomeň mi zítra v 8 nakoupit mléko", expect: "task", titleNeed: ["mléko", "mleko"] },
  { id: "RS11", input: "Připomeň mi koupit mléko", expect: "task", titleNeed: ["mléko", "mleko"] },
  { id: "RS12", input: "Připomeň mi zalít květiny", expect: "task", titleNeed: ["kvetin", "květin"] },
  { id: "RS13", input: "Připomeň mi zítra schůzku s Kubou", expect: "calendar", titleNeed: ["schuz", "kub"] },
  { id: "RS14", input: "Připomeň mi ve 14 hodin servis auta", expect: "calendar", titleNeed: ["servis"] },
  {
    id: "SS_RVC",
    input: "Připomeň mi zítra v 8 nakoupit mléko.",
    expect: "task",
    titleNeed: ["mléko", "mleko"]
  }
];

if (require.main === module) {
  shared.runAudit(
    "silver_reminder_semantics_audit_v1",
    CASES,
    path.join(__dirname, "silver-reminder-semantics-audit-v1-report.json")
  );
}

module.exports = { CASES };
