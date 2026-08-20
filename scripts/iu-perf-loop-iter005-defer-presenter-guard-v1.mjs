#!/usr/bin/env node
/**
 * Perf-loop iter-005: traffic presenter must load AFTER feed paint, not via
 * queueMicrotask / parallel warm competing with FCP→card.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const overview = fs.readFileSync(path.join(ROOT, "assets", "iu-traffic-overview-v1.js"), "utf8");
const ui = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

must(!/queueMicrotask\(\(\) => \{\s*void ensureTrafficPresenter\(\)/.test(overview), "overview:no_microtask_warm");
must(!/await ensureTrafficPresenter\(\)/.test(overview.match(/fetchHostedTrafficOfflineSnapshot[\s\S]{0,400}/)?.[0] || ""), "fetch:no_presenter_before_snapshot");
must(!/const presenterWarm/.test(ui), "ui:no_parallel_presenter_warm");
must(/data-iu-pd-feed-ready[\s\S]{0,800}ensureTrafficPresenter/.test(ui), "ui:presenter_after_feed_ready");
must(/perf-loop-iter005-defer-presenter-v1-20260820/.test(ui), "ui:cache_bust");
must(/perf-loop-iter005-defer-presenter-v1-20260820/.test(index), "index:cache_bust");
must(/Presenter not required for snapshot fetch/.test(overview), "overview:comment_marker");

if (fails.length) {
  console.error("[iu-perf-loop-iter005-defer-presenter-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter005-defer-presenter-guard] PASS");
