#!/usr/bin/env node
"use strict";

const path = require("path");
const { runGuard, emitGuardBanner } = require("./silver-notes-v2-ux-guard-v1-shared.cjs");

async function main() {
  const out = await runGuard();
  emitGuardBanner(
    "SILVER_NOTES_SCROLL_SAFE_GUARD_V1",
    path.join("scripts", "silver-notes-scroll-safe-guard-v1-report.json"),
    out
  );
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exitCode = 1;
});
