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
ok(
  "static_settings_join_on_persist",
  /void ensureTrafficCatalogForCurrentFilters\(1\)\.catch/.test(prehled),
  "persistDraft must join full hydrate when filters need catalog"
);
ok(
  "static_settings_await_on_close",
  /await ensureTrafficCatalogForCurrentFilters\(1\)/.test(prehled),
  "closeSettings dirty path must await catalog"
);

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
  const types = ["nehoda", "prace", "omezeni", "prekazka", "kolona"];
  const et = types[i % types.length];
  const peid = "iu-te-" + Number(i).toString(16).padStart(32, "0");
  return {
    publicEventId: peid,
    id: "t-" + i,
    title: "Test událost " + i,
    summary: "Souhrn " + i,
    road: "D1",
    municipality: "Praha",
    location: "Praha",
    status: "ACTIVE",
    lifecycleStatus: "ACTIVE",
    eventType: et,
    category: et,
    impact: "Omezení " + et + " " + i,
    impactFull: "Omezení " + et + " " + i + " Praha",
    updatedAt: new Date(Date.now() - i * 1000).toISOString(),
    lastMeaningfulChangeAt: new Date(Date.now() - i * 1000).toISOString(),
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
const FULL_LATENCY_MS = 1800;
const TRAFFIC_MOD =
  "/assets/iu-traffic-overview-v1.js?v=ndic-info-loss-forensic-v1-20260813-perf-loop-iter004-lazy-presenter-v1-20260820-perf-loop-iter005-defer-presenter-v1-20260820-doprava-snap-first-paint-hydrate-v1-20260821-chmi-asset-waterfall-v1-20260822-traffic-first-batch-v1-20260906-traffic-auto-bg-full-hydrate-v1-20260906";

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
  midFlight: {
    fullAtClick: 0,
    fullAfterFilter: 0,
    promiseAliveAtClick: false,
    filterResultCount: null,
    fullRecordCount: 0,
    overFullCatalog: false,
  },
};
try {
  const context = await bootstrapGuardContext(browser, { viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const reqLog = [];

  await page.route("**/assets/iu-prehled-dne-ui-v1.js*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: prehled,
    });
  });

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
    // Simulate network latency so mid-flight filter is observable.
    await new Promise((r) => setTimeout(r, FULL_LATENCY_MS));
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
  await page.evaluate(() => {
    try {
      window.__IU_INFO_SYSTEM_CUTOVER__ = true;
    } catch (_) {}
    document.documentElement.classList.add("iu-info-system-cutover");
    const root = document.getElementById("iuPrehledDneRoot");
    if (root) {
      root.style.display = "block";
      root.hidden = false;
    }
    const vpEl = document.getElementById("iuSilverTallScrollViewport");
    if (vpEl) {
      vpEl.style.display = "block";
      vpEl.hidden = false;
    }
    if (window.IUInfoSystem && typeof window.IUInfoSystem.applyCutoverDom === "function") {
      window.IUInfoSystem.applyCutoverDom();
    }
  });

  // Open Doprava (no filter, no Další).
  await page.evaluate(() => {
    document.querySelector("[data-act='feed-quick-view'][data-view='traffic']").click();
  });

  // Wait first-batch DOM before measuring / mid-flight filter.
  const firstDomDeadline = Date.now() + 25000;
  while (Date.now() < firstDomDeadline) {
    runtime.headCount = reqLog.filter((r) => r.kind === "head").length;
    runtime.fullCount = reqLog.filter((r) => r.kind === "full").length;
    runtime.domAfterFirst = await page.evaluate(() => {
      const feed = document.querySelector("#iuPrehledDneTimeline");
      if (!feed) return 0;
      return (
        feed.querySelectorAll(
          "li.iuPdCard, li[data-iu-card], article, .iuTrafficCard, [data-iu-traffic-card], li[data-id]"
        ).length || feed.querySelectorAll("li").length
      );
    });
    if (runtime.headCount >= 1 && runtime.domAfterFirst >= 20) break;
    await page.waitForTimeout(120);
  }

  const firstHeadIdx = reqLog.findIndex((r) => r.kind === "head");
  const firstFullIdx = reqLog.findIndex((r) => r.kind === "full");
  runtime.headBeforeFull = firstHeadIdx >= 0 && (firstFullIdx < 0 || firstHeadIdx < firstFullIdx);

  // Wait until full hydrate is in-flight (single GET started, promise alive).
  const hydrateDeadline = Date.now() + 20000;
  while (Date.now() < hydrateDeadline) {
    runtime.fullCount = reqLog.filter((r) => r.kind === "full").length;
    const alive = await page.evaluate(async (modUrl) => {
      try {
        const mod = await import(modUrl);
        const p = mod.getTrafficFullHydratePromise && mod.getTrafficFullHydratePromise();
        return !!(p && typeof p.then === "function");
      } catch (_) {
        return false;
      }
    }, TRAFFIC_MOD);
    if (runtime.fullCount >= 1 && alive) {
      runtime.midFlight.promiseAliveAtClick = true;
      break;
    }
    await page.waitForTimeout(100);
  }
  runtime.midFlight.fullAtClick = reqLog.filter((r) => r.kind === "full").length;

  // Mid-flight: open settings → Doprava → Události → only Nehody (real UI filter).
  await page.evaluate(() => {
    const s = document.querySelector("[data-act='open-settings']");
    if (s) s.click();
  });
  await page.waitForSelector("#iuPdSettings", { timeout: 15000 });
  await page.evaluate(() => {
    const open = document.querySelector("[data-act='feed-open-detail'][data-kind='traffic']");
    if (open) open.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const acc = [...document.querySelectorAll("[data-act='feed-acc-toggle']")].find((el) =>
      /Události/i.test(el.textContent || "")
    );
    if (acc) acc.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const all = document.querySelector("[data-act='feed-events-all']");
    if (all) all.click();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const box =
      document.querySelector("input[data-act='feed-event-toggle'][data-value='nehody']") ||
      document.querySelector("[data-act='feed-event-toggle'][data-value='nehody']");
    if (box && !box.checked) box.click();
  });
  // Vault persist is async — join must fire before hydrate finishes.
  await page.waitForTimeout(1200);
  runtime.midFlight.fullAfterFilter = reqLog.filter((r) => r.kind === "full").length;
  runtime.filterJoined = runtime.midFlight.fullAfterFilter === runtime.midFlight.fullAtClick;

  await page.evaluate(() => {
    const c = document.querySelector("#iuPdSettings [data-act='settings-close']");
    if (c) c.click();
  });

  // Wait hydrate finish + filtered paint over full catalog.
  const expectedNehoda = Math.ceil(FULL_N / 5);
  const doneDeadline = Date.now() + FULL_LATENCY_MS + 20000;
  while (Date.now() < doneDeadline) {
    const st = await page.evaluate(async (modUrl) => {
      try {
        const mod = await import(modUrl);
        const snap = mod.loadOfflineTrafficSnapshot();
        const t = document.querySelector("#iuPdCount");
        const m = t && String(t.textContent || "").match(/(\d+)/);
        return {
          capped: mod.isTrafficSnapshotCapped(snap),
          n: snap && Array.isArray(snap.cards) ? snap.cards.length : 0,
          listed: m ? Number(m[1]) : null,
        };
      } catch (_) {
        return { capped: true, n: 0, listed: null };
      }
    }, TRAFFIC_MOD);
    if (st && st.capped === false && st.n >= FULL_N) {
      runtime.fullReady = true;
      runtime.midFlight.fullRecordCount = st.n;
      runtime.midFlight.filterResultCount = st.listed;
      if (st.listed === expectedNehoda) break;
    }
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(400);

  runtime.domAfterHydrate = await page.evaluate(() => {
    const feed = document.querySelector("#iuPrehledDneTimeline");
    if (!feed) return 0;
    return feed.querySelectorAll("li").length;
  });
  runtime.midFlight.filterResultCount = await page.evaluate(() => {
    const t = document.querySelector("#iuPdCount");
    const m = t && String(t.textContent || "").match(/(\d+)/);
    return m ? Number(m[1]) : null;
  });
  const headOnlyNehoda = Math.ceil(HEAD_N / 5);
  runtime.midFlight.overFullCatalog =
    runtime.midFlight.filterResultCount === expectedNehoda &&
    runtime.midFlight.filterResultCount > headOnlyNehoda;

  runtime.fullCount = reqLog.filter((r) => r.kind === "full").length;
  runtime.headCount = reqLog.filter((r) => r.kind === "head").length;

  // Toggle CHMU ↔ Doprava after hydrate.
  const fullBeforeToggle = runtime.fullCount;
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const c = document.querySelector("[data-act='feed-quick-view'][data-view='chmu']");
      if (c) c.click();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const t = document.querySelector("[data-act='feed-quick-view'][data-view='traffic']");
      if (t) t.click();
    });
    await page.waitForTimeout(200);
  }
  runtime.toggleFullCount = reqLog.filter((r) => r.kind === "full").length - fullBeforeToggle;

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
  ok("runtime_midflight_promise", runtime.midFlight.promiseAliveAtClick === true);
  ok("runtime_midflight_join_no_extra_full", runtime.filterJoined);
  ok(
    "runtime_midflight_filter_full_catalog",
    runtime.midFlight.overFullCatalog === true,
    "listed=" + runtime.midFlight.filterResultCount
  );
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

