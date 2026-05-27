#!/usr/bin/env node
"use strict";
const shared = require("./silver-normalizer-title-cleaning-v1-shared.cjs");
function main() {
  process.exit(
    shared.runGuard("dirty_czech", "silver_dirty_czech_cleanup_guard_v1", "silver-dirty-czech-cleanup-guard-v1-report.json")
  );
}
if (require.main === module) main();
