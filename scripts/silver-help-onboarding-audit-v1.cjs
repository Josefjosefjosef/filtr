#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-line-o-capability-audit-shared.cjs");

const ONBOARDING = [
  { input: "jak začít se Silverem", topic: "silver", need: ["silver", "prikaz"] },
  { input: "co je Silver", topic: "silver", need: ["asistent", "lokal"] },
  { input: "nápověda", topic: "general", need: ["kalend", "ukol"] },
  { input: "pomoc", topic: "general", need: ["pomoc", "ukol"] },
  { input: "help", topic: "general", need: ["kalend"] },
  { input: "jak to používat", topic: "commands", need: ["prikaz", "jasn"] }
];

function buildCases() {
  const cases = [];
  const prefixes = ["", "Hele ", "Prosím "];
  let n = 0;
  for (let i = 0; i < ONBOARDING.length; i++) {
    n++;
    const o = ONBOARDING[i];
    cases.push({
      id: "ONB_" + String(n).padStart(4, "0"),
      input: o.input + "?",
      topic: o.topic,
      needTokens: o.need,
      forbidTokens: ["chatgpt", "jsem chatgpt"]
    });
  }
  const spokenChaos = ["hele ", "no ", "prosim "];
  for (let pi = 0; pi < spokenChaos.length; pi++) {
    for (let i = 0; i < ONBOARDING.length; i++) {
      n++;
      const o = ONBOARDING[i];
      cases.push({
        id: "ONB_" + String(n).padStart(4, "0"),
        input: spokenChaos[pi] + o.input + "?",
        topic: o.topic,
        relaxed: true
      });
    }
  }
  return cases;
}

if (require.main === module) {
  shared.runAudit(
    "silver_help_onboarding_audit_v1",
    buildCases(),
    path.join(__dirname, "silver-help-onboarding-audit-v1-report.json")
  );
}

module.exports = { buildCases };
