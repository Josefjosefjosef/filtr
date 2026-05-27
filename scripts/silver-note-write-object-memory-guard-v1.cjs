#!/usr/bin/env node
"use strict";

const shared = require("./silver-note-write-warranty-object-v1-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const cases =
    shared.NOTE_WRITE_OBJECT_MEMORY_REPLAY.length >= 20
      ? shared.NOTE_WRITE_OBJECT_MEMORY_REPLAY
      : shared.NOTE_WRITE_WARRANTY_OBJECT_REPLAY.slice(0, 25);
  const report = shared.runReplayCases(eng, cases, shared.defaultCtx(), shared.evaluateNoteWrite);
  const ok = shared.printGuardHeader("silver_note_write_object_memory_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
