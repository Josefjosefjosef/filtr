#!/usr/bin/env node
"use strict";
const shared = require("./silver-normalizer-title-cleaning-v1-shared.cjs");
function main() {
  process.exit(
    shared.runGuard(
      "mobile_chaos",
      "silver_mobile_chaos_cleanup_guard_v1",
      "silver-mobile-chaos-cleanup-guard-v1-report.json"
    )
  );
}
if (require.main === module) main();
