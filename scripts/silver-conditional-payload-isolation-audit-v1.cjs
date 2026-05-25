#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-save-understanding-audit-shared.cjs");

const CASES = [
  {
    id: "CP01",
    input: "Připomeň mi zítra až budeme mít poradu že se musí udělat bezpečnostní plán",
    expect: "task",
    titleNeed: ["bezpec", "plán", "plan"],
    titleMustNot: ["až budeme", "az budeme", "poradu ze"]
  },
  {
    id: "CP02",
    input: "Až budu u doktora připomeň mi zeptat se na výsledky",
    expect: "task",
    titleNeed: ["vysled", "výsled", "zeptat"],
    titleMustNot: ["až budu", "az budu", "doktora"]
  },
  {
    id: "CP03",
    input: "Jakmile přijedu domů připomeň mi zavolat Kubovi",
    expect: "task",
    titleNeed: ["zavolat", "kub"],
    titleMustNot: ["jakmile", "prijedu", "přijedu"]
  },
  {
    id: "CP04",
    input: "Když budu v obchodě připomeň mi koupit mléko",
    expect: "task",
    titleNeed: ["mléko", "mleko", "koupit"],
    titleMustNot: ["když budu", "kdyz budu", "obchod"]
  }
];

if (require.main === module) {
  shared.runAudit(
    "silver_conditional_payload_isolation_audit_v1",
    CASES,
    path.join(__dirname, "silver-conditional-payload-isolation-audit-v1-report.json")
  );
}

module.exports = { CASES };
