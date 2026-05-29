#!/usr/bin/env node
"use strict";

const path = require("path");
const { runGuard, emitGuardBanner } = require("./silver-mobile-tablet-home-ux-v1-shared.cjs");

async function main() {
  const out = await runGuard({
    viewports: [
      { w: 390, h: 844, mode: "mobile" },
      { w: 768, h: 1024, mode: "tablet" },
      { w: 1280, h: 800, mode: "responsive-desktop" },
    ],
  });
  emitGuardBanner("SILVER_MOBILE_TABLET_HOME_UX_RESPONSIVE_GUARD_V1", path.join("scripts", "silver-mobile-tablet-home-ux-responsive-guard-v1-report.json"), out);
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
