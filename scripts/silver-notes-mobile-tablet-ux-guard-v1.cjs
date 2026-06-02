#!/usr/bin/env node
"use strict";

const path = require("path");
const { runGuard, emitGuardBanner } = require("./silver-notes-mobile-tablet-ux-guard-v1-shared.cjs");

async function main() {
  const out = await runGuard();
  emitGuardBanner(
    "SILVER_NOTES_MOBILE_TABLET_UX_GUARD_V1",
    path.join("scripts", "silver-notes-mobile-tablet-ux-guard-v1-report.json"),
    out
  );
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exitCode = 1;
});
