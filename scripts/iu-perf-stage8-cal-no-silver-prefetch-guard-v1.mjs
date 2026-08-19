#!/usr/bin/env node
/**
 * Stage 8: hero Calendar pointerdown must NOT prefetch Silver P0 engine.
 * Calendar still prefetches via isCalTrigger (Stage 7).
 * Run: npm run iu-perf-stage8-cal-no-silver-prefetch-guard
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

must(/function shouldPrefetch\(t\)/.test(app), "app:shouldPrefetch_exists");
must(
  /shouldPrefetch[\s\S]{0,500}#iuHeroQuickCal[\s\S]{0,120}data-iu-hero-quick=\\"cal\\"[\s\S]{0,80}return false/.test(
    app
  ),
  "app:hero_cal_returns_false"
);
must(
  !/shouldPrefetch[\s\S]{0,420}#iuHeroQuickCal,\s*#iuHeroQuickTasks/.test(app),
  "app:no_legacy_cal_in_silver_prefetch_list"
);
must(
  /isCalTrigger[\s\S]{0,420}#iuHeroQuickCal[\s\S]{0,120}data-iu-hero-quick/.test(app),
  "app:stage7_cal_prefetch_kept"
);
must(/perf-stage8-cal-no-silver-prefetch-v1-20260819/.test(index), "index:cache_bust");
must(/perf-stage7-calendar-hero-prefetch-v1-20260819/.test(index), "index:stage7_marker_kept");

if (fails.length) {
  console.error("[iu-perf-stage8-cal-no-silver-prefetch-guard] FAIL");
  for (const id of fails) console.error("[iu-perf-stage8-cal-no-silver-prefetch-guard] " + id);
  process.exit(1);
}
console.log("[iu-perf-stage8-cal-no-silver-prefetch-guard] PASS");
console.log("RESULT=PASS");
