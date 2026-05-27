#!/usr/bin/env node
"use strict";
const shared = require("./silver-normalizer-title-cleaning-v1-shared.cjs");
function main() {
  process.exit(
    shared.runGuard(
      "semantic_preservation",
      "silver_semantic_preservation_guard_v1",
      "silver-semantic-preservation-guard-v1-report.json"
    )
  );
}
if (require.main === module) main();
