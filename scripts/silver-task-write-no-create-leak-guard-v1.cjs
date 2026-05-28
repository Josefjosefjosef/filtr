#!/usr/bin/env node
"use strict";

const shared = require("./silver-task-write-hardening-v1-shared.cjs");

const READ_SHOULD_NOT_CREATE = [
  { id: "TWNL_001", input: "Co mám v poznámkách o právníkovi?", expect: "notes.read", allowWrite: false },
  { id: "TWNL_002", input: "Podívej se jen do úkolů, co mám na dnes?", expect: "tasks.read", allowWrite: false },
  { id: "TWNL_003", input: "Co mám zítra v kalendáři?", expect: "calendar.read", allowWrite: false }
];

function evaluateNoCreateLeak(c, turn) {
  const issues = [];
  const intent = String(turn.normalizedIntent || "");
  if (turn.processingState === "READY_TO_SAVE") issues.push("ready_to_save_leak");
  if (intent === "tasks.create" || intent === "notes.create" || intent === "calendar.create") {
    issues.push("create_leak:" + intent);
  }
  if (c.expect && intent !== c.expect && intent.indexOf(".read") < 0 && intent !== "global.search") {
    if (!(intent === "clarification" || intent === "unknown")) issues.push("intent:" + intent);
  }
  return issues;
}

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(eng, READ_SHOULD_NOT_CREATE, shared.defaultCtx(), evaluateNoCreateLeak);
  const ok = shared.printGuardHeader("silver_task_write_no_create_leak_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
