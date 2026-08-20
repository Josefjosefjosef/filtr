#!/usr/bin/env node
/**
 * Perf-loop iter-006: feed-pipeline must stay off slow-net / early-mobile critical path.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
const shell = fs.readFileSync(path.join(ROOT, "assets", "iu-mobile-bottom-nav-shell-v1.js"), "utf8");
const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

const boot = app.match(/function iuBootFeedPipelineLazy\(\)[\s\S]{0,2500}/)?.[0] || "";
must(/keep 240KB feed-pipeline off the slow-net/.test(boot), "app:iter006_comment");
must(/function isSlowNet\(/.test(boot), "app:isSlowNet");
must(/delayMs = slow \? 20000 : 2500/.test(boot), "app:delay_slow_only");
must(/desktopMq\.matches && !slow/.test(boot), "app:desktop_skip_on_slow");
must(/perf-loop-iter006-defer-pipeline-v1-20260820/.test(boot), "app:feed_url_bust");
must(/perf-loop-iter006-defer-pipeline-v1-20260820/.test(shell), "shell:feed_mod_bust");
must(/perf-loop-iter006-defer-pipeline-v1-20260820/.test(index), "index:cache_bust");

if (fails.length) {
  console.error("[iu-perf-loop-iter006-defer-pipeline-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter006-defer-pipeline-guard] PASS");
