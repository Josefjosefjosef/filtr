#!/usr/bin/env node
"use strict";
const shared = require("./silver-normalizer-title-cleaning-v1-shared.cjs");
function main() {
  process.exit(
    shared.runGuard("no_overtrim", "silver_no_overtrim_guard_v1", "silver-no-overtrim-guard-v1-report.json")
  );
}
if (require.main === module) main();
