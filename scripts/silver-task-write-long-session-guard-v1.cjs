#!/usr/bin/env node
"use strict";

const shared = require("./silver-task-write-hardening-v1-shared.cjs");

const LONG_SESSION_REPLAY = [
  { id: "TWLS_001", input: "help", expect: "help", allowClarification: true },
  {
    id: "TWLS_002",
    input: "Co mám dnes v kalendáři?",
    expect: "calendar.read",
    allowClarification: true
  },
  { id: "TWLS_003", input: "Není to poznámka, přidej úkol zaplatit fakturu.", expect: "tasks.create" }
];

function evaluateLongSession(c, turn) {
  const issues = shared.evaluateTaskWrite(c, turn);
  if (c.id === "TWLS_001" && String(turn.normalizedIntent || "").indexOf("help") < 0) {
    issues.push("help_expected");
  }
  if (c.id === "TWLS_002" && String(turn.normalizedIntent || "").indexOf("calendar") < 0) {
    issues.push("calendar_query_expected");
  }
  return issues;
}

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(eng, LONG_SESSION_REPLAY, shared.defaultCtx(), evaluateLongSession);
  const ok = shared.printGuardHeader("silver_task_write_long_session_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
