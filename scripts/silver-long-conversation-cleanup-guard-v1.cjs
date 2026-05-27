#!/usr/bin/env node
"use strict";
const shared = require("./silver-normalizer-title-cleaning-v1-shared.cjs");
function main() {
  process.exit(
    shared.runGuard(
      "long_conversation",
      "silver_long_conversation_cleanup_guard_v1",
      "silver-long-conversation-cleanup-guard-v1-report.json"
    )
  );
}
if (require.main === module) main();
