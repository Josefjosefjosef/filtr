#!/usr/bin/env node
"use strict";

const path = require("path");
const { runCardGuard, emitGuardBanner } = require("./silver-mobile-tablet-card-cleanup-guard-shared.cjs");

async function main() {
  const out = await runCardGuard({ replayMode: "privacy-cleanup" });
  emitGuardBanner(
    "SILVER_MOBILE_TABLET_CARD_PRIVACY_CLEANUP_GUARD_V1",
    path.join("scripts", "silver-mobile-tablet-card-privacy-cleanup-guard-v1-report.json"),
    out
  );
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
