#!/usr/bin/env node
"use strict";

const path = require("path");
const { runGuard, emitGuardBanner } = require("./silver-home-input-quick-action-icons-shared.cjs");

async function main() {
  const out = await runGuard({ replayMode: "full" });
  emitGuardBanner(
    "SILVER_HOME_INPUT_QUICK_ACTION_ICONS_GUARD_V1",
    path.join("scripts", "silver-home-input-quick-action-icons-guard-v1-report.json"),
    out
  );
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
