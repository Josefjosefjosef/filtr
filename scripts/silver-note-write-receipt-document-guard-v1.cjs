#!/usr/bin/env node
"use strict";

const shared = require("./silver-note-write-warranty-object-v1-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const cases =
    shared.NOTE_WRITE_RECEIPT_DOCUMENT_REPLAY.length >= 15
      ? shared.NOTE_WRITE_RECEIPT_DOCUMENT_REPLAY
      : shared.NOTE_WRITE_WARRANTY_OBJECT_REPLAY.slice(0, 20);
  const report = shared.runReplayCases(eng, cases, shared.defaultCtx(), shared.evaluateNoteWrite);
  const ok = shared.printGuardHeader("silver_note_write_receipt_document_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
