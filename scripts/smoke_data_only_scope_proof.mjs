#!/usr/bin/env node
import { isDataOnlyScope } from "./smoke-data-only-scope.mjs";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL: " + msg);
    failed += 1;
  }
}

assert(isDataOnlyScope(["projects/data/publishable_pool.json"]), "pool file is data-only");
assert(isDataOnlyScope(["projects/data/articles/index.json", "projects/data/article_feed_chunks/feed/init.json"]), "chunks are data-only");
assert(!isDataOnlyScope(["assets/app.js"]), "assets not data-only");
assert(!isDataOnlyScope(["projects/data/x.json", "assets/app.js"]), "mixed not data-only");
assert(!isDataOnlyScope([]), "empty not data-only");

console.log("SMOKE_DATA_ONLY_SCOPE_PROOF=" + (failed === 0 ? "PASS" : "FAIL"));
process.exit(failed === 0 ? 0 : 1);
