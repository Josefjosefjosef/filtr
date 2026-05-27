#!/usr/bin/env node
"use strict";

const shared = require("./silver-note-write-warranty-object-v1-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const cases = shared.NOTE_WRITE_WARRANTY_NO_CALENDAR_LEAK_REPLAY.map(function (c) {
    return Object.assign({ forbidCalendar: true }, c);
  });
  const report = shared.runReplayCases(eng, cases, shared.defaultCtx(), shared.evaluateNoteWrite);
  const ok = shared.printGuardHeader("silver_note_write_warranty_no_calendar_leak_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
