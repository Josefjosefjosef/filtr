#!/usr/bin/env node
"use strict";

const path = require("path");
const { runV3Guard, emitV3Banner } = require("./silver-home-ux-v3-shared.cjs");

async function main() {
  const out = await runV3Guard({ replayMode: "save-reset-replay" });
  emitV3Banner("SILVER_HOME_SAVE_RESET_REPLAY_GUARD_V1", path.join("scripts", "silver-home-save-reset-replay-guard-v1-report.json"), out);
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
