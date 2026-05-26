#!/usr/bin/env node
"use strict";

const path = require("path");
const shared = require("./silver-line-o-capability-audit-shared.cjs");

const PERSONA = [
  { input: "kdo jsi", topic: "silver", need: ["silver", "asistent"], forbid: ["chatgpt", "gpt"] },
  { input: "jsi umělá inteligence", topic: "boundaries", need: ["lokal"], forbid: ["umela inteligence z cloud"] },
  { input: "co neumíš", topic: "boundaries", need: ["internet", "ne"], forbid: ["umim vsechno"] }
];

function buildCases() {
  const cases = [];
  let n = 0;
  for (let i = 0; i < PERSONA.length; i++) {
    const p = PERSONA[i];
    n++;
    cases.push({
      id: "PER_" + String(n).padStart(4, "0"),
      input: p.input + "?",
      topic: p.topic,
      needTokens: p.need,
      forbidTokens: p.forbid
    });
  }
  return cases;
}

if (require.main === module) {
  shared.runAudit(
    "silver_assistant_persona_audit_v1",
    buildCases(),
    path.join(__dirname, "silver-assistant-persona-audit-v1-report.json")
  );
}

module.exports = { buildCases };
