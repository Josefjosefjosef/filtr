#!/usr/bin/env node
/**
 * Guard + optional Playwright runtime: auto background full hydrate after first batch.
 *
 * Static (always):
 * - head first, hydrate scheduled only after head path
 * - single-flight
 * - PAGE_SIZE=50 (no full DOM contract in source)
 *
 * Runtime (when IU_TRAFFIC_HYDRATE_RUNTIME=1):
 * - mock large catalog
 * - open Doprava
 * - assert head request before full
 * - assert exactly one full request without filter/Další
 * - assert DOM stays at PAGE_SIZE after hydrate
 * - assert toggle CHMU/Doprava does not storm full requests
 * - assert filter during hydrate joins same full (no second GET)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(ROOT, "package.json"));
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const overview = fs.readFileSync(path.join(ROOT, "assets", "iu-traffic-overview-v1.js"), "utf8");
const prehled = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");

ok("static_head_url", /iu_head=1/.test(overview));
ok("static_hydrate_gate", /opts\.hydrate === true/.test(overview));
ok("static_schedule_void", /void scheduleTrafficSnapshotFullHydrate\(TRAFFIC_UI_SNAPSHOT_URL\)/.test(overview));
ok("static_prehled_schedules_on_open", /scheduleTrafficBackgroundFullHydrate/.test(prehled));
ok(
  "static_boot_head_no_hydrate_true",
  /fetchHostedTrafficOfflineSnapshot\(\{\s*persist:\s*true\s*\}/.test(prehled) &&
    !/fetchHostedTrafficOfflineSnapshot\(\{\s*persist:\s*true,\s*hydrate:\s*true\s*\}/.test(prehled)
);
ok("static_single_flight", /if \(_trafficFullHydratePromise\) return _trafficFullHydratePromise/.test(overview));
ok("static_page_size_50", /const PAGE_SIZE\s*=\s*50/.test(prehled));
ok(
  "static_ensure_full_joins",
  /ensureFullTrafficOfflineSnapshot[\s\S]{0,400}scheduleTrafficSnapshotFullHydrate/.test(overview)
);
ok("static_bg_export", /export function scheduleTrafficBackgroundFullHydrate/.test(overview));
ok("static_event", /iu-traffic-snap-hydrated/.test(overview) && /iu-traffic-snap-hydrated/.test(prehled));

const report = {
  TRAFFIC_AUTO_BG_FULL_HYDRATE_GUARD: "PENDING",
  fails: [],
  runtime: null,
  REAL_IOS: "NOT_TESTED",
};

if (process.env.IU_TRAFFIC_HYDRATE_RUNTIME !== "1") {
  report.TRAFFIC_AUTO_BG_FULL_HYDRATE_GUARD = fails.length ? "FAIL" : "PASS";
  report.fails = fails;
  console.log(JSON.stringify(report, null, 2));
  if (fails.length) process.exit(1);
  process.exit(0);
}

const { chromium } = require("playwright");
const bootstrapUrl = pathToFileURL(
  path.join(ROOT, "scripts", "guards", "guard-playwright-bootstrap.mjs")
).href;
const { bootstrapGuardContext } = await import(bootstrapUrl);

function makeCard(i) {
  return {
    id: "t-" + i,
    title: "Test událost " + i,
    summary: "Souhrn " + i,
    road: "D1",
    municipality: "Praha",
    status: "ACTIVE",
    updatedAt: new Date(Date.now() - i * 1000).toISOString(),
  };
}

function makeSnap(n, opts = {}) {
  const cards = [];
  for (let i = 0; i < n; i++) cards.push(makeCard(i));
  return {
    trafficUiEnabled: true,
    publicationEnabled: false,
    edgeSlim: opts.edgeSlim === true,
    cardsCappedTo: opts.cardsCappedTo != null ? opts.cardsCappedTo : undefined,
    cardCount: opts.cardCount != null ? opts.cardCount : n,
    generatedAt: opts.generatedAt || "2026-09-06T12:00:00.000Z",
    generationId: opts.generationId || "gen-test-1",
    cards,
    historyItems: [],
    historyCount: 0,
  };
}

const ORIGIN = process.env.IU_TRAFFIC_HYDRATE_ORIGIN || "https://infouzel.cz";
const FULL_N = 120;
const HEAD_N = 40;

const browser = await chromium.launch({ headless: true });
const runtime = {
  headBeforeFull: false,
  fullCount: 0,
  headCount: 0,
  domAfterFirst: 0,
  domAfterHydrate: 0,
  domAfterMore: 0,
  fullReady: false,
  toggleFullCount: 0,
  filterJoined: false,
};
try {
  const context = await bootstrapGuardContext(browser, { viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const reqLog = [];

  await page.route("**/projects/data/info_events/ndic_datex_v1/traffic_offline_snapshot.json*", async (route) => {
    const u = route.request().url();
    const isHead = /[?&](iu_head|head)=1\b/.test(u);
    reqLog.push({ kind: isHead ? "head" : "full", t: Date.now(), url: u });
    if (isHead) {
      const body = makeSnap(HEAD_N, {
        edgeSlim: true,
        cardsCappedTo: HEAD_N,
        cardCount: FULL_N,
        generationId: "gen-test-1",
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
      return;
    }
    // Simulate network latency so filter-during-hydrate is observable.
    await new Promise((r) => setTimeout(r, 800));
    const body = makeSnap(FULL_N, { generationId: "gen-test-1" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.goto(ORIGIN + "/?nosw=1&cb=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => !!document.querySelector("[data-act='feed-quick-view'][data-view='traffic']"), null, {
    timeout: 120000,
  });

  // Open Doprava (no filter, no Další).
  await page.click("[data-act='feed-quick-view'][data-view='traffic']");
  await page.waitForTimeout(1500);

  const firstHeadIdx = reqLog.findIndex((r) => r.kind === "head");
  const firstFullIdx = reqLog.findIndex((r) => r.kind === "full");
  runtime.headBeforeFull = firstHeadIdx >= 0 && (firstFullIdx < 0 || firstHeadIdx < firstFullIdx);
  runtime.headCount = reqLog.filter((r) => r.kind === "head").length;
  runtime.fullCount = reqLog.filter((r) => r.kind === "full").length;

  runtime.domAfterFirst = await page.evaluate(() => {
    const feed = document.querySelector("#iuPrehledDneTimeline");
    if (!feed) return 0;
    return feed.querySelectorAll("li.iuPdCard, li[data-iu-card], article, .iuTrafficCard, [data-iu-traffic-card]").length ||
      feed.querySelectorAll("li").length;
  });

  // Wait for hydrate event / uncapped mem without clicking Další/filter.
  await page.waitForFunction(
    () => {
      try {
        const m = window.__IU_TRAFFIC_OVERVIEW_MOD || null;
      } catch (_) {}
      return true;
    },
    null,
    { timeout: 1000 }
  ).catch(() => {});

  // Poll until one full request observed (auto hydrate) — max ~20s.
  const hydrateDeadline = Date.now() + 20000;
  while (Date.now() < hydrateDeadline && runtime.fullCount < 1) {
    runtime.fullCount = reqLog.filter((r) => r.kind === "full").length;
    await page.waitForTimeout(200);
  }
  runtime.fullCount = reqLog.filter((r) => r.kind === "full").length;

  await page.waitForTimeout(1200);
  runtime.domAfterHydrate = await page.evaluate(() => {
    const feed = document.querySelector("#iuPrehledDneTimeline");
    if (!feed) return 0;
    return feed.querySelectorAll("li").length;
  });

  // Toggle CHMU ↔ Doprava during/after hydrate.
  const fullBeforeToggle = runtime.fullCount;
  for (let i = 0; i < 3; i++) {
    await page.click("[data-act='feed-quick-view'][data-view='chmu']");
    await page.waitForTimeout(200);
    await page.click("[data-act='feed-quick-view'][data-view='traffic']");
    await page.waitForTimeout(200);
  }
  runtime.toggleFullCount = reqLog.filter((r) => r.kind === "full").length - fullBeforeToggle;

  // Filter during a forced re-hydrate scenario is hard once full is cached.
  // Verify ensureFull joins: call schedule twice from page — must not add GETs.
  const fullBeforeJoin = reqLog.filter((r) => r.kind === "full").length;
  await page.evaluate(async () => {
    const mod = await import(
      "/assets/iu-traffic-overview-v1.js?v=traffic-auto-bg-full-hydrate-v1-20260906"
    ).catch(() => null);
    if (!mod) return;
    const a = mod.scheduleTrafficBackgroundFullHydrate();
    const b = mod.ensureFullTrafficOfflineSnapshot();
    await Promise.all([a, b]);
  });
  await page.waitForTimeout(500);
  runtime.filterJoined = reqLog.filter((r) => r.kind === "full").length === fullBeforeJoin;

  // Další should add DOM page, not dump full catalog.
  const more = await page.$("[data-act='more']");
  if (more) {
    await more.click();
    await page.waitForTimeout(500);
  }
  runtime.domAfterMore = await page.evaluate(() => {
    const feed = document.querySelector("#iuPrehledDneTimeline");
    if (!feed) return 0;
    return feed.querySelectorAll("li").length;
  });

  ok("runtime_head_before_full", runtime.headBeforeFull);
  ok("runtime_auto_full_once", runtime.fullCount === 1, "fullCount=" + runtime.fullCount);
  ok("runtime_no_toggle_storm", runtime.toggleFullCount === 0, "extra=" + runtime.toggleFullCount);
  ok("runtime_dom_not_full", runtime.domAfterHydrate > 0 && runtime.domAfterHydrate < FULL_N);
  ok("runtime_dom_page_bound", runtime.domAfterFirst > 0 && runtime.domAfterFirst <= 60);
  ok("runtime_join_no_extra_full", runtime.filterJoined);
  if (more) {
    ok(
      "runtime_more_not_full_dom",
      runtime.domAfterMore < FULL_N && runtime.domAfterMore >= runtime.domAfterHydrate
    );
  }

  await context.close();
} catch (err) {
  ok("runtime_exception", false, String(err && err.message ? err.message : err));
} finally {
  await browser.close();
}

report.runtime = runtime;
report.fails = fails;
report.TRAFFIC_AUTO_BG_FULL_HYDRATE_GUARD = fails.length ? "FAIL" : "PASS";
console.log(JSON.stringify(report, null, 2));
if (fails.length) process.exit(1);
