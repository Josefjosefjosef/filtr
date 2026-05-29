#!/usr/bin/env node
"use strict";

const { measureHeights, emitV2Banner } = require("./silver-mobile-tablet-home-ux-v2-shared.cjs");
const base = require("./silver-mobile-tablet-home-ux-v1-shared.cjs");

async function main() {
  const url = base.envUrl();
  const heights = await measureHeights(url);
  const out = { pass: true, url, results: [{ heights }] };
  process.stdout.write("=== SILVER_MOBILE_TABLET_HOME_UX_V2_BLOCK_HEIGHT ===\n\n");
  process.stdout.write(JSON.stringify(heights, null, 2) + "\n\n");
  process.stdout.write("URL=" + url + "\n");
  process.stdout.write("=== END_SILVER_MOBILE_TABLET_HOME_UX_V2_BLOCK_HEIGHT ===\n");
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
