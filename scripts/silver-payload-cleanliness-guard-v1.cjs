#!/usr/bin/env node
"use strict";
const shared = require("./silver-normalizer-title-cleaning-v1-shared.cjs");
function main() {
  process.exit(
    shared.runGuard(
      "payload_cleanliness",
      "silver_payload_cleanliness_guard_v1",
      "silver-payload-cleanliness-guard-v1-report.json"
    )
  );
}
if (require.main === module) main();
