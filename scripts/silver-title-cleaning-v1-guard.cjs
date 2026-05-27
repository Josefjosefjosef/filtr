#!/usr/bin/env node
"use strict";
const shared = require("./silver-normalizer-title-cleaning-v1-shared.cjs");
function main() {
  process.exit(
    shared.runGuard("title_cleaning", "silver_title_cleaning_guard_v1", "silver-title-cleaning-v1-report.json")
  );
}
if (require.main === module) main();
