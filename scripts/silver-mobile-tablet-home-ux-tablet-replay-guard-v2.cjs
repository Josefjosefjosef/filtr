#!/usr/bin/env node
"use strict";

const path = require("path");
const { runV2Guard, emitV2Banner } = require("./silver-mobile-tablet-home-ux-v2-shared.cjs");

async function main() {
  const out = await runV2Guard({
    replayMode: "ux-replay",
    viewports: [{ w: 768, h: 1024, mode: "tablet" }],
  });
  emitV2Banner("SILVER_MOBILE_TABLET_HOME_UX_TABLET_REPLAY_GUARD_V2", path.join("scripts", "silver-mobile-tablet-home-ux-tablet-replay-guard-v2-report.json"), out);
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
