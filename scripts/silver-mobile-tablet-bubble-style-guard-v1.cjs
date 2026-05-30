#!/usr/bin/env node
"use strict";

const path = require("path");
const { runCardGuard, emitGuardBanner } = require("./silver-mobile-tablet-card-cleanup-guard-shared.cjs");

async function main() {
  const out = await runCardGuard({ replayMode: "bubble-style" });
  emitGuardBanner(
    "SILVER_MOBILE_TABLET_BUBBLE_STYLE_GUARD_V1",
    path.join("scripts", "silver-mobile-tablet-bubble-style-guard-v1-report.json"),
    out
  );
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
