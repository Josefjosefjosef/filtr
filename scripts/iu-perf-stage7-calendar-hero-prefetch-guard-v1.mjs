#!/usr/bin/env node
/**
 * Stage 7: hero quick cal must prefetch calendar overlay (not only mind-menu cal).
 * Run: npm run iu-perf-stage7-calendar-hero-prefetch-guard
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

must(/#iuHeroQuickCal/.test(app), "app:hero_quick_cal_selector");
must(/data-iu-hero-quick=\\"cal\\"/.test(app), "app:hero_quick_data_attr");
must(
  /isCalTrigger[\s\S]{0,420}#iuHeroQuickCal[\s\S]{0,120}data-iu-hero-quick/.test(app),
  "app:isCalTrigger_includes_hero"
);
must(/pointerdown[\s\S]{0,800}isCalTrigger\(t\)[\s\S]{0,120}void ensure\(\)/.test(app), "app:pointerdown_prefetch");
must(/perf-stage7-calendar-hero-prefetch-v1-20260819/.test(index), "index:cache_bust");
must(/iuHeroQuickCal/.test(index), "index:hero_quick_markup");

if (fails.length) {
  console.error("[iu-perf-stage7-calendar-hero-prefetch-guard] FAIL");
  for (const id of fails) console.error("[iu-perf-stage7-calendar-hero-prefetch-guard] " + id);
  process.exit(1);
}
console.log("[iu-perf-stage7-calendar-hero-prefetch-guard] PASS");
console.log("RESULT=PASS");
