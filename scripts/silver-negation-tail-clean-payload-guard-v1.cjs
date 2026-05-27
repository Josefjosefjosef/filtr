#!/usr/bin/env node
"use strict";

const shared = require("./silver-cross-module-negation-target-v1-shared.cjs");

function evaluatePayload(c, turn) {
  const issues = shared.evaluateCrossModuleCase(c, turn);
  const intent = String(turn.normalizedIntent || "");
  if (intent === "notes.create") {
    const body = shared.foldCs((turn.draft && turn.draft.silverNoteText) || "");
    if (c.bodyNeed) {
      for (let i = 0; i < c.bodyNeed.length; i++) {
        if (body.indexOf(shared.foldCs(c.bodyNeed[i])) < 0) issues.push("body_miss:" + c.bodyNeed[i]);
      }
    }
    if (c.bodyLacks) {
      for (let j = 0; j < c.bodyLacks.length; j++) {
        if (body.indexOf(shared.foldCs(c.bodyLacks[j])) >= 0) issues.push("body_pollution:" + c.bodyLacks[j]);
      }
    }
  }
  if (intent === "tasks.create" || intent === "calendar.create") {
    const title = shared.foldCs((turn.draft && turn.draft.title) || "");
    if (c.titleNeed) {
      for (let k = 0; k < c.titleNeed.length; k++) {
        if (title.indexOf(shared.foldCs(c.titleNeed[k])) < 0) issues.push("title_miss:" + c.titleNeed[k]);
      }
    }
    if (c.titleLacks) {
      for (let m = 0; m < c.titleLacks.length; m++) {
        if (title.indexOf(shared.foldCs(c.titleLacks[m])) >= 0) issues.push("title_pollution:" + c.titleLacks[m]);
      }
    }
  }
  return issues;
}

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(
    eng,
    shared.NEGATION_TAIL_CLEAN_PAYLOAD_REPLAY,
    shared.defaultCtx(),
    evaluatePayload
  );
  const ok = shared.printGuardHeader("silver_negation_tail_clean_payload_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
