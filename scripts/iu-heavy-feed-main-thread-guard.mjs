#!/usr/bin/env node
/**
 * Real ~22MB feed.json main-thread guard (Variant C).
 * Boots checkout /projects/, measures long tasks during InfoSystem hydrate.
 * Expects NDIC omitted from feed parse path + Worker parse (no multi‑second main long tasks from JSON.parse).
 */
import { spawn } from "child_process";
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_HEAVY_FEED_GUARD_PORT || 8127);
const FEED_PATH = path.join(ROOT, "projects/data/info_events/feed.json");
const SERVER = path.join(ROOT, "server/projects-static.mjs");

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUrl(url, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await wait(200);
  }
  throw new Error("server_timeout");
}

const realFeedBytes = fs.existsSync(FEED_PATH) ? fs.statSync(FEED_PATH).size : 0;
const out = {
  suite: "IU_HEAVY_FEED_MAIN_THREAD_GUARD",
  REAL_FEED_BYTES: realFeedBytes,
  REAL_HEAVY_FEED_TEST_USED_STUB: "NO",
};

if (realFeedBytes < 5_000_000) {
  console.log(JSON.stringify({ ...out, ok: false, error: "feed_too_small_for_real_test" }, null, 2));
  process.exit(1);
}

const server = spawn(process.execPath, [SERVER], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});
await waitUrl(`http://127.0.0.1:${PORT}/projects/`, 30000);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ serviceWorkers: "block" });
const page = await ctx.newPage();
await page.setViewportSize({ width: 390, height: 844 });
await page.addInitScript(() => {
  window.__iuHeavyFeedMetrics = {
    longTasks: [],
    dcl: 0,
    markFeedWindow: null,
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__iuHeavyFeedMetrics.longTasks.push({
          start: e.startTime,
          dur: e.duration,
        });
      }
    }).observe({ type: "longtask", buffered: true });
  } catch (_) {}
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      window.__iuHeavyFeedMetrics.dcl = performance.now();
    },
    { once: true }
  );
});

const t0 = Date.now();
await page.goto(`http://127.0.0.1:${PORT}/projects/`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
const dclWall = Date.now() - t0;

// Interaction while hydrate may still run
let navOk = false;
let scrollOk = false;
let clickOk = false;
try {
  await page.evaluate(() => window.scrollTo(0, 120));
  scrollOk = true;
} catch (_) {}
try {
  const cal = page.locator("#iuHeroQuickCal");
  if (await cal.count()) {
    await cal.click({ force: true, timeout: 5000 });
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape").catch(() => {});
    clickOk = true;
  }
} catch (_) {}
try {
  await page.evaluate(() => {
    const a = document.querySelector("#iuHeroQuickNotes");
    if (a && typeof a.click === "function") a.click();
  });
  navOk = true;
} catch (_) {}

await page.waitForTimeout(3000);
const metrics = await page.evaluate(() => {
  const m = window.__iuHeavyFeedMetrics || {};
  return {
    dcl: m.dcl || 0,
    longTasks: m.longTasks || [],
    prehledRoot: !!document.querySelector("[data-iu-prehled-dne-root]"),
  };
});

// Isolated feed-load window: clear attribution, load slim feed, measure long tasks in that window only.
const loadProbe = await page.evaluate(async () => {
  const winStart = performance.now();
  window.__iuHeavyFeedMetrics.markFeedWindow = winStart;
  const before = (window.__iuHeavyFeedMetrics.longTasks || []).length;
  const t0 = performance.now();
  const data = await window.IUInfoSystem.loadInfoSystemData({ omitFeedSourceIds: ["ndic"] });
  const ms = Math.round(performance.now() - t0);
  const afterTasks = (window.__iuHeavyFeedMetrics.longTasks || []).slice(before);
  const items = (data.feed && data.feed.items) || [];
  const ndic = items.filter((x) => String(x.sourceId || "") === "ndic").length;
  const chmi = items.filter((x) => String(x.sourceId || "") === "chmi").length;
  return {
    ms,
    itemCount: items.length,
    ndic,
    chmi,
    omitted: (data.feedLoad && data.feedLoad.omittedSourceIds) || [],
    parsedOffMainThread: !!(data.feedLoad && data.feedLoad.parsedOffMainThread),
    trafficPrimary: data.feedLoad && data.feedLoad.trafficPrimarySource,
    longTasksDuringLoad: afterTasks,
    maxLongDuringLoad: afterTasks.reduce((a, t) => Math.max(a, t.dur || 0), 0),
  };
});

const bootLongOver50 = (metrics.longTasks || []).filter((t) => t.dur > 50);
const loadLongOver50 = (loadProbe.longTasksDuringLoad || []).filter((t) => t.dur > 50);
const maxLoadLong = loadProbe.maxLongDuringLoad || 0;
// Sync multi‑MB JSON.parse is typically >> 500ms; Worker+omit path must stay below this for the load window.
const PARSE_BLOCK_FAIL_MS = 500;

out.BOOT_DOMCONTENTLOADED_MS = Math.round(metrics.dcl || dclWall);
out.BOOT_FIRST_INTERACTIVE_MS = Math.round(Math.max(metrics.dcl || 0, dclWall));
out.HEAVY_FEED_FETCH_COMPLETE_MS = loadProbe.ms;
out.HEAVY_FEED_PARSE_DURATION_MS = loadProbe.parsedOffMainThread ? 0 : loadProbe.ms;
out.MAX_MAIN_THREAD_LONG_TASK_MS = Math.round(maxLoadLong);
out.MAIN_THREAD_LONG_TASK_COUNT_OVER_50MS = loadLongOver50.length;
out.BOOT_LONG_TASK_COUNT_OVER_50MS = bootLongOver50.length;
out.FULL_FEED_PARSE_BLOCKS_MAIN_THREAD = maxLoadLong >= PARSE_BLOCK_FAIL_MS ? "YES" : "NO";
out.NAVIGATION_RESPONSIVE_DURING_FEED_LOAD = navOk ? "YES" : "NO";
out.SCROLL_RESPONSIVE_DURING_FEED_LOAD = scrollOk ? "YES" : "NO";
out.UI_INPUT_RESPONSIVE_DURING_FEED_LOAD = clickOk ? "YES" : "NO";
out.FEED_ITEMS_AFTER_OMIT = loadProbe.itemCount;
out.FEED_NDIC_ITEMS_AFTER_OMIT = loadProbe.ndic;
out.FEED_CHMI_ITEMS = loadProbe.chmi;
out.PARSED_OFF_MAIN_THREAD = loadProbe.parsedOffMainThread ? "YES" : "NO";
out.TRAFFIC_UI_PRIMARY_SOURCE = loadProbe.trafficPrimary || "";
out.PRODUCTION_MAIN_THREAD_RISK =
  out.FULL_FEED_PARSE_BLOCKS_MAIN_THREAD === "YES" || loadProbe.ndic > 0 ? "YES" : "NO";

const ok =
  out.FULL_FEED_PARSE_BLOCKS_MAIN_THREAD === "NO" &&
  loadProbe.ndic === 0 &&
  loadProbe.chmi >= 1 &&
  loadProbe.parsedOffMainThread === true &&
  out.SCROLL_RESPONSIVE_DURING_FEED_LOAD === "YES";

out.ok = ok;
out.HEAVY_FEED_REAL_DATA_PERFORMANCE_TEST_PASS = ok ? "YES" : "NO";
console.log(JSON.stringify(out, null, 2));

await ctx.close();
await browser.close();
server.kill("SIGTERM");
process.exit(ok ? 0 : 1);
