#!/usr/bin/env node
"use strict";

const path = require("path");
const { runGuard, emitGuardBanner } = require("./silver-mobile-tablet-home-ux-v1-shared.cjs");

async function main() {
  const out = await runGuard({
    viewports: [
      { w: 390, h: 844, mode: "cls-only" },
      { w: 768, h: 1024, mode: "cls-only" },
    ],
  });
  emitGuardBanner("SILVER_MOBILE_TABLET_HOME_UX_CLS_GUARD_V1", path.join("scripts", "silver-mobile-tablet-home-ux-cls-guard-v1-report.json"), out);
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
