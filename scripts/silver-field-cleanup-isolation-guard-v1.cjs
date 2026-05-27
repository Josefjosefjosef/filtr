#!/usr/bin/env node
"use strict";
const shared = require("./silver-normalizer-title-cleaning-v1-shared.cjs");
function main() {
  process.exit(
    shared.runGuard(
      "field_cleanup_isolation",
      "silver_field_cleanup_isolation_guard_v1",
      "silver-field-cleanup-isolation-guard-v1-report.json"
    )
  );
}
if (require.main === module) main();
