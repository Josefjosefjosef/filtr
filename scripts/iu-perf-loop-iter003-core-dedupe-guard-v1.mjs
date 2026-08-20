#!/usr/bin/env node
/**
 * Perf-loop iter-003: deploy must rewrite ALL ES imports of iu-info-system-core-v1
 * to the hashed SHA copy (not only prehled-dne-ui). Otherwise traffic-overview
 * loads a second unhashed core on the critical path.
 * Run: npm run iu-perf-loop-iter003-core-dedupe-guard
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pages = fs.readFileSync(path.join(ROOT, ".github", "workflows", "pages.yml"), "utf8");
const traffic = fs.readFileSync(path.join(ROOT, "assets", "iu-traffic-overview-v1.js"), "utf8");
const ui = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const smoke = fs.readFileSync(path.join(ROOT, ".github", "workflows", "smoke.yml"), "utf8");
const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

const CORE_BUST =
  "iu-info-system-core-v1.js?v=evening-theme-settings-v1-20260818-perf-loop-iter001-parallel-boot-v1-20260819-perf-loop-iter003-core-dedupe-v1-20260820";

must(pages.includes("without rewriting those, the browser downloads core twice"), "pages:dedupe_comment");
must(
  /find assets -type f -name '\*\.js'/.test(pages) &&
    /iu-info-system-core-v1\\\\.js\?v=\[A-Za-z0-9\._-\]\*/.test(pages),
  "pages:rewrite_all_asset_js_imports"
);
must(traffic.includes(CORE_BUST), "traffic:core_cache_bust_iter003");
must(ui.includes(CORE_BUST), "ui:core_cache_bust_iter003");
must(
  /Set required status context \(smoke\)[\s\S]{0,200}steps\.prgate\.outputs\.skip != 'true'/.test(smoke),
  "smoke:skip_push_no_required_status"
);

if (fails.length) {
  console.error("[iu-perf-loop-iter003-core-dedupe-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter003-core-dedupe-guard] PASS");
