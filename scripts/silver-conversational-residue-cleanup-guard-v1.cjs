#!/usr/bin/env node
"use strict";
const shared = require("./silver-normalizer-title-cleaning-v1-shared.cjs");
function main() {
  process.exit(
    shared.runGuard(
      "conversational_residue",
      "silver_conversational_residue_cleanup_guard_v1",
      "silver-conversational-residue-cleanup-guard-v1-report.json"
    )
  );
}
if (require.main === module) main();
