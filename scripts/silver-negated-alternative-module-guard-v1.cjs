#!/usr/bin/env node
"use strict";

const shared = require("./silver-cross-module-negation-target-v1-shared.cjs");

function main() {
  const eng = shared.loadEngine();
  const report = shared.runReplayCases(
    eng,
    shared.NEGATED_ALTERNATIVE_MODULE_REPLAY,
    shared.defaultCtx(),
    shared.evaluateCrossModuleCase
  );
  const ok = shared.printGuardHeader("silver_negated_alternative_module_v1", report);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
