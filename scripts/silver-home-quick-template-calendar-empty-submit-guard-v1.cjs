#!/usr/bin/env node
"use strict";

const path = require("path");
const { runGuard, emitGuardBanner } = require("./silver-home-quick-template-empty-submit-shared.cjs");

async function main() {
  const out = await runGuard({ replayMode: "calendar-empty-submit" });
  emitGuardBanner(
    "SILVER_HOME_QUICK_TEMPLATE_CALENDAR_EMPTY_SUBMIT_GUARD_V1",
    path.join("scripts", "silver-home-quick-template-calendar-empty-submit-guard-v1-report.json"),
    out
  );
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
