#!/usr/bin/env node
"use strict";

const path = require("path");
const { runGuard, emitGuardBanner } = require("./silver-home-input-quick-action-icons-shared.cjs");

async function main() {
  const out = await runGuard({ replayMode: "template-regression" });
  emitGuardBanner(
    "SILVER_HOME_INPUT_TEMPLATE_REGRESSION_GUARD_V1",
    path.join("scripts", "silver-home-input-template-regression-guard-v1-report.json"),
    out
  );
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
