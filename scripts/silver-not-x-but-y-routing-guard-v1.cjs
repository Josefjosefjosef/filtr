#!/usr/bin/env node
"use strict";

const shared = require("./silver-cross-module-negation-target-v1-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(
    eng,
    shared.NOT_X_BUT_Y_ROUTING_REPLAY,
    shared.defaultCtx(),
    shared.evaluateCrossModuleCase
  );
  const ok = shared.printGuardHeader("silver_not_x_but_y_routing_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
