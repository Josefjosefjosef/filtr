#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-line-o-capability-audit-shared.cjs");

const GUIDANCE = [
  { input: "ukaž příklad příkazu pro schůzku", topic: "guidance_calendar", need: ["priklad", "schuz"] },
  { input: "příklad úkolu", topic: "guidance_tasks", need: ["priklad", "ukol"] },
  { input: "jak správně formulovat příkazy", topic: "guidance_commands", need: ["jasn", "datum"] },
  { input: "jak napsat follow-up", topic: "continuation", need: ["navaz", "pridej"] },
  { input: "jak pokračovat v konverzaci", topic: "continuation", need: ["navaz"] }
];

function buildCases() {
  const cases = [];
  let n = 0;
  const prefixes = ["", "Hele ", "Krátce "];
  for (let pi = 0; pi < prefixes.length; pi++) {
    for (let i = 0; i < GUIDANCE.length; i++) {
      n++;
      const g = GUIDANCE[i];
      cases.push({
        id: "GUD_" + String(n).padStart(4, "0"),
        input: prefixes[pi] + g.input + "?",
        topic: g.topic,
        needTokens: g.need,
        forbidTokens: ["chatgpt"]
      });
    }
  }
  return cases;
}

if (require.main === module) {
  shared.runAudit(
    "silver_product_guidance_audit_v1",
    buildCases(),
    path.join(__dirname, "silver-product-guidance-audit-v1-report.json")
  );
}

module.exports = { buildCases };
