#!/usr/bin/env node
"use strict";

const shared = require("./silver-note-write-warranty-object-v1-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(
    eng,
    shared.NOTE_WRITE_WARRANTY_CLEAN_PAYLOAD_REPLAY,
    shared.defaultCtx(),
    shared.evaluateNoteWrite
  );
  const ok = shared.printGuardHeader("silver_note_write_warranty_clean_payload_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
