#!/usr/bin/env node
/**
 * Perf-loop iter-006 + early-wx: feed-pipeline stays off early critical path,
 * but slow-net delay must not be 20s (blocked Silver weather). Early Open-Meteo lives in index.html HEAD.
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

const boot = app.match(/function iuBootFeedPipelineLazy\(\)[\s\S]{0,4500}/)?.[0] || "";
must(/keep 240KB feed-pipeline off the slow-net/.test(boot), "app:iter006_comment");
must(/function isSlowNet\(/.test(boot), "app:isSlowNet");
must(/delayMs = slow \? 4000 : 0/.test(boot), "app:delay_slow_capped");
must(/afterFcpThen/.test(boot), "app:after_fcp_gate");
must(/desktopMq\.matches && !slow/.test(boot), "app:desktop_skip_on_slow");
must(/early-wx-v1-20260822/.test(boot), "app:feed_url_bust");
must(/early-wx-v1-20260822/.test(shell) || /early-wx-v1-20260822/.test(index), "shell_or_index:feed_mod_bust");
must(/__iuEarlyWxP/.test(index), "index:early_wx_fetch");
must(/__iuEarlyWxOnData/.test(index), "index:early_wx_paint");
must(/data-iu-early-wx-painted/.test(index), "index:early_wx_mark");
must(/iuEarlyWxCacheV1/.test(index), "index:early_wx_ls_cache");

if (fails.length) {
  console.error("[iu-perf-loop-iter006-defer-pipeline-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter006-defer-pipeline-guard] PASS");
