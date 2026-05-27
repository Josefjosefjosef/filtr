#!/usr/bin/env node
"use strict";

const shared = require("./silver-cross-module-negation-target-v1-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(
    eng,
    shared.NOTE_WRITE_NEG_TRAIL_WRONG_COLLECTION_REPLAY,
    shared.defaultCtx(),
    shared.evaluateNoteWrite
  );
  const ok = shared.printGuardHeader("silver_note_write_neg_trail_wrong_collection_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
