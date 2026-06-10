#!/usr/bin/env node
"use strict";

/* Runner: MOBILE/TABLET STABILITY V1 — spustí lokální statický server nad checkoutem
   a všech 5 regression guardů. Souhrnné gate řádky na konci. */

const shared = require("./mobile-stability-guards-v1-shared.cjs");

const GUARDS = [
  { key: "BOTTOM_NAVIGATION_VISIBILITY", mod: "./bottom-navigation-visibility-guard-v1.cjs" },
  { key: "MOBILE_NAVIGATION_STABILITY", mod: "./mobile-navigation-stability-guard-v1.cjs" },
  { key: "MEDIA_CLS", mod: "./media-cls-guard-v1.cjs" },
  { key: "MEDIA_LOAD_MORE_SCROLL", mod: "./media-load-more-scroll-guard-v1.cjs" },
  { key: "SILVER_COPY", mod: "./silver-copy-guard-v1.cjs" },
];

async function main() {
  const envUrl = String(process.env.MOBILE_STABILITY_GUARDS_URL || "").trim();
  let server = null;
  if (!envUrl) server = await shared.startStaticServer(shared.DEFAULT_PORT);
  const summary = [];
  try {
    for (const g of GUARDS) {
      const guard = require(g.mod);
      const out = await guard.runGuard(shared.envBaseUrl());
      shared.emitBanner(guard.GUARD_NAME, out, guard.REPORT);
      process.stdout.write("\n");
      summary.push({ key: g.key, pass: out.pass });
    }
  } finally {
    if (server) server.close();
  }
  process.stdout.write("=== MOBILE_STABILITY_GUARDS_V1_SUMMARY ===\n");
  for (const s of summary) {
    process.stdout.write(s.key + "=" + (s.pass ? "PASS" : "FAIL") + "\n");
  }
  const allPass = summary.every((s) => s.pass);
  process.stdout.write("REGRESSION_GUARDS=" + (allPass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("=== END_MOBILE_STABILITY_GUARDS_V1_SUMMARY ===\n");
  if (!allPass) process.exitCode = 1;
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
