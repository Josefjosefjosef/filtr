#!/usr/bin/env node
/**
 * Perf-loop iter-004: traffic-card-presenter must not be a static import of traffic-overview
 * (homepage module graph). Browser loads presenter via ensureTrafficPresenter().
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

must(/export function ensureTrafficPresenter\(/.test(overview), "overview:ensureTrafficPresenter_export");
must(/IU_TRAFFIC_PRESENTER_URL\s*=\s*[\"']\.\/iu-traffic-card-presenter-v1\.js/.test(overview), "overview:presenter_url_const");
must(!/from\s+[\"']\.\/iu-traffic-card-presenter-v1\.js/.test(overview), "overview:no_static_presenter_from");
must(/typeof window === \"undefined\"[\s\S]{0,160}await import\(IU_TRAFFIC_PRESENTER_URL\)/.test(overview), "overview:node_tla_prime");
must(!/queueMicrotask\(\(\) => \{\s*void ensureTrafficPresenter\(\)/.test(overview), "overview:no_browser_microtask_warm");
must(/ensureTrafficPresenter/.test(ui), "ui:ensure_presenter_import");
must(/perf-loop-iter004-lazy-presenter-v1-20260820/.test(ui), "ui:cache_bust_iter004");
must(/perf-loop-iter004-lazy-presenter-v1-20260820/.test(index), "index:cache_bust_iter004");

if (fails.length) {
  console.error("[iu-perf-loop-iter004-lazy-presenter-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter004-lazy-presenter-guard] PASS");
