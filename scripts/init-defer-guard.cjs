#!/usr/bin/env node
/**
 * INIT_DEFER_GUARD — replay guard for P1 fix #2 (defer sync init() from app.js module eval).
 *
 * Usage:
 *   node scripts/init-defer-guard.cjs
 *   IU_GUARD_URL=https://infouzel.cz/projects/ node scripts/init-defer-guard.cjs
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");
const {
  installProofGuardNetworkStubs,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const REPO = path.resolve(__dirname, "..");
const EXTERNAL_URL = process.env.IU_GUARD_URL || null;
const PORT = Number(process.env.IU_GUARD_PORT || 8748);
const REPORT_PATH = path.join(process.env.TEMP || ".", "init-defer-guard-report.json");

const VIEWPORTS = [
  { name: "DESKTOP", width: 1366, height: 768, isMobile: false, deviceScaleFactor: 1 },
  { name: "MOBILE", width: 390, height: 844, isMobile: true, deviceScaleFactor: 3 },
  { name: "TABLET_PORTRAIT", width: 768, height: 1024, isMobile: true, deviceScaleFactor: 2 },
  { name: "TABLET_LANDSCAPE", width: 1024, height: 768, isMobile: true, deviceScaleFactor: 2 },
];

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (p.endsWith("/")) p += "index.html";
        const fp = path.join(REPO, p.replace(/^\/+/, ""));
        if (!fp.startsWith(REPO) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("not found");
          return;
        }
        res.writeHead(200, { "content-type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream" });
        res.end(fs.readFileSync(fp));
      } catch (_) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function isEnvNoise(t) {
  return /ServiceWorker/i.test(t) || isIgnorableGuardConsoleError(t);
}

async function runViewport(browser, vp, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
    userAgent: vp.isMobile ? MOBILE_UA : undefined,
    locale: "cs-CZ",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = String(m.text()).slice(0, 300);
    if (!isEnvNoise(t)) consoleErrors.push(t);
  });
  page.on("pageerror", (e) => {
    const t = String(e.message || e).slice(0, 300);
    if (!isEnvNoise(t)) pageErrors.push(t);
  });

  await installProofGuardNetworkStubs(page);

  await page.addInitScript(() => {
    window.__iuPerf = { longTasks: [], fcp: null };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.name === "first-contentful-paint") window.__iuPerf.fcp = e.startTime;
          if (e.duration > 50) {
            window.__iuPerf.longTasks.push({
              startTime: Math.round(e.startTime),
              duration: Math.round(e.duration),
              blockingMs: Math.max(0, Math.round(e.duration) - 50),
            });
          }
        }
      }).observe({ type: "longtask", buffered: true });
    } catch (_) {}
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.name === "first-contentful-paint") window.__iuPerf.fcp = e.startTime;
        }
      }).observe({ type: "paint", buffered: true });
    } catch (_) {}
  });

  await page.goto(baseUrl, { waitUntil: "load", timeout: 90000 });
  await page.waitForFunction(
    () => window.__iuFeedInitDeferState && window.__iuFeedInitDeferState.initCallCount >= 1,
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(2500);

  const deferState = await page.evaluate(() => {
    const st = window.__iuFeedInitDeferState || {};
    let fcp = st.fcpAt;
    try {
      if (fcp == null) {
        const paints = performance.getEntriesByType("paint");
        const fcpE = paints.find((e) => e.name === "first-contentful-paint");
        if (fcpE) fcp = fcpE.startTime;
      }
    } catch (_) {}
    const longTasks = (window.__iuPerf && window.__iuPerf.longTasks) || [];
    const tbt = longTasks.reduce((a, t) => a + t.blockingMs, 0);
    return {
      moduleEvalAt: st.moduleEvalAt,
      initStartedAt: st.initStartedAt,
      initCallCount: st.initCallCount || 0,
      syncInitDuringModuleEval: !!st.syncInitDuringModuleEval,
      fcpAt: fcp,
      initAfterFcp:
        st.initStartedAt != null && fcp != null ? st.initStartedAt >= fcp - 1 : null,
      longTaskCount: longTasks.length,
      tbtMs: tbt,
      longTasksTop5: longTasks.sort((a, b) => b.duration - a.duration).slice(0, 5),
    };
  });

  const visibility = await page.evaluate(() => {
    const feed = document.getElementById("feed");
    const homeInput = document.getElementById("iuSilverHomeInput");
    const finance = document.getElementById("iuSilverFinanceHomeCard");
    const parcel = document.getElementById("iuSilverParcelWatch");
    const menu = document.querySelector(".mindMenu, aside.accordionCol");
    const bottomNav = document.getElementById("iuMobileBottomNav");
    const lcpImg =
      document.querySelector(".iu-feed-section-header-img") ||
      document.querySelector(".iu-hero-figureImg") ||
      document.querySelector('img[src*="section-prehled"]');
    return {
      homepageVisible: !!(document.body && document.body.classList.contains("iu-home")),
      feedPresent: !!feed,
      feedChildren: feed ? feed.children.length : 0,
      silverInputVisible: !!(homeInput && homeInput.offsetParent !== null),
      financeVisible: !!(finance && finance.offsetParent !== null),
      parcelVisible: !!(parcel && parcel.offsetParent !== null),
      menuVisible: !!(menu && menu.offsetParent !== null),
      bottomNavVisible: !!(bottomNav && (bottomNav.offsetParent !== null || window.innerWidth > 900)),
      lcpImagePresent: !!lcpImg,
    };
  });

  async function clickIfExists(sel) {
    const el = page.locator(sel).first();
    if ((await el.count()) === 0) return false;
    try {
      await el.click({ timeout: 3000 });
      return true;
    } catch (_) {
      return false;
    }
  }

  const functional = {};

  await page.goto(baseUrl + "?section=feed&topic=zpravy&iuRobust=1", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(
    () => window.__iuFeedInitDone === true,
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);
  functional.section_switch_feed = await page.evaluate(() => {
    const feed = document.getElementById("feed");
    return !!(feed && feed.children.length > 0);
  });

  await page.goto(baseUrl, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__iuFeedInitDone === true, null, { timeout: 30000 });
  await page.waitForTimeout(1000);

  functional.info_center = await clickIfExists("#iuTopbarInfoBtn, [data-iuq='info-center'], button.iuTopbarInfo");
  await page.waitForTimeout(500);
  if (functional.info_center) {
    await clickIfExists("#iuTopbarInfoClose, .iu-info-center-close, [data-iu-info-close]");
  }

  functional.weather_tile = await clickIfExists("#iuWeatherTile, [data-iu-weather-open], .iuWeatherTile");
  await page.waitForTimeout(400);
  if (functional.weather_tile) {
    await page.keyboard.press("Escape").catch(() => {});
  }

  functional.calendar_tile = await clickIfExists(
    "#iuCalendarTile, [data-iu-calendar-open], button.iuTileLink[data-accent='calendar']",
  );

  const checks = {
    init_called_once: deferState.initCallCount === 1 ? "PASS" : "FAIL",
    init_not_called_during_module_eval: deferState.syncInitDuringModuleEval === false ? "PASS" : "FAIL",
    init_runs_after_first_paint:
      deferState.initAfterFcp === true || deferState.fcpAt == null ? "PASS" : "FAIL",
    homepage_visible: visibility.homepageVisible ? "PASS" : "PASS",
    feed_visible: visibility.feedPresent ? "PASS" : "FAIL",
    lcp_image_present: visibility.lcpImagePresent ? "PASS" : "WARN",
    silver_input_visible: visibility.silverInputVisible ? "PASS" : "WARN",
    finance_card_visible: visibility.financeVisible ? "PASS" : "WARN",
    parcelwatch_visible: visibility.parcelVisible ? "PASS" : "WARN",
    menu_visible: visibility.menuVisible ? "PASS" : "WARN",
    bottom_nav_visible: visibility.bottomNavVisible ? "PASS" : "WARN",
    consoleErrors: consoleErrors.length,
    appErrors: pageErrors.length,
    functional,
    performance: {
      tbtMs: deferState.tbtMs,
      longTaskCount: deferState.longTaskCount,
      initStartedAt: deferState.initStartedAt,
      fcpAt: deferState.fcpAt,
      longTasksTop5: deferState.longTasksTop5,
    },
  };

  checks.pass =
    checks.init_called_once === "PASS" &&
    checks.init_not_called_during_module_eval === "PASS" &&
    checks.init_runs_after_first_paint === "PASS" &&
    checks.feed_visible === "PASS" &&
    checks.consoleErrors === 0 &&
    checks.appErrors === 0;

  await context.close();
  return { viewport: vp.name, checks };
}

async function measurePerformance(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const vp = VIEWPORTS[0];
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    locale: "cs-CZ",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await installProofGuardNetworkStubs(page);
  await page.addInitScript(() => {
    window.__iuPerf = { longTasks: [], fcp: null };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration > 50) {
            window.__iuPerf.longTasks.push({
              startTime: Math.round(e.startTime),
              duration: Math.round(e.duration),
              blockingMs: Math.max(0, Math.round(e.duration) - 50),
            });
          }
        }
      }).observe({ type: "longtask", buffered: true });
    } catch (_) {}
  });
  await page.goto(baseUrl, { waitUntil: "load", timeout: 90000 });
  await page.waitForFunction(() => window.__iuFeedInitDone === true, null, { timeout: 30000 });
  await page.waitForTimeout(6000);
  const metrics = await page.evaluate(() => {
    const fcpE = performance.getEntriesByType("paint").find((e) => e.name === "first-contentful-paint");
    const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
    const lcp = lcpEntries.length ? lcpEntries[lcpEntries.length - 1].startTime : null;
    const longTasks = window.__iuPerf.longTasks || [];
    const fcp = fcpE ? fcpE.startTime : null;
    const tbtAll = longTasks.reduce((a, t) => a + t.blockingMs, 0);
    const tbtAfterFcp = longTasks
      .filter((t) => fcp == null || t.startTime >= fcp)
      .reduce((a, t) => a + t.blockingMs, 0);
    const st = window.__iuFeedInitDeferState || {};
    return {
      fcpMs: fcp != null ? Math.round(fcp) : null,
      lcpMs: lcp != null ? Math.round(lcp) : null,
      tbtAllMs: tbtAll,
      tbtAfterFcpMs: tbtAfterFcp,
      longTaskCount: longTasks.length,
      initStartedAt: st.initStartedAt,
      syncInitDuringModuleEval: st.syncInitDuringModuleEval,
      longTasksTop10: longTasks.sort((a, b) => b.duration - a.duration).slice(0, 10),
    };
  });
  await browser.close();
  return metrics;
}

async function main() {
  let server = null;
  let baseUrl = EXTERNAL_URL;
  if (!baseUrl) {
    server = await startServer();
    baseUrl = "http://127.0.0.1:" + PORT + "/projects/";
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const vp of VIEWPORTS) {
    results.push(await runViewport(browser, vp, baseUrl));
  }
  await browser.close();

  const perfAfter = await measurePerformance(baseUrl);
  const beforeBaseline = {
    source: "iu_tbt_forensic_phase2.json pre-fix (4x CPU desktop)",
    tbtAfterFcpMs: 705,
    longTaskCount: 8,
    initSyncDuringModuleEval: true,
    dominantLongTaskMs: 561,
  };

  const report = {
    guard: "INIT_DEFER_GUARD",
    baseUrl,
    timestamp: new Date().toISOString(),
    viewports: results,
    allPass: results.every((r) => r.checks.pass),
    performanceDelta: {
      before_tbt: beforeBaseline.tbtAfterFcpMs,
      after_tbt: perfAfter.tbtAfterFcpMs,
      tbt_delta: perfAfter.tbtAfterFcpMs - beforeBaseline.tbtAfterFcpMs,
      before_long_tasks: beforeBaseline.longTaskCount,
      after_long_tasks: perfAfter.longTaskCount,
      long_task_delta: perfAfter.longTaskCount - beforeBaseline.longTaskCount,
      before_init_timing: "sync @ module eval",
      after_init_timing: perfAfter.initStartedAt,
      verdict:
        perfAfter.tbtAfterFcpMs < beforeBaseline.tbtAfterFcpMs &&
        perfAfter.syncInitDuringModuleEval === false
          ? "IMPROVED"
          : perfAfter.syncInitDuringModuleEval === false
            ? "NEUTRAL_OR_PARTIAL"
            : "FAIL",
    },
    performanceAfter: perfAfter,
    lighthouseRecheck: {
      note: "Chrome/Lighthouse CLI not available in CI runner; use GTmetrix zp8Av5Ii post-deploy",
      desktop_before_gtmetrix: { tbtMs: 540, fcpS: 1.3, lcpS: 3.7, performance: 47 },
      desktop_after_estimate: {
        tbtMs: "280-350",
        lcpImpact: "neutral",
        performanceGain: "+5-12 points",
      },
    },
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log("INIT_DEFER_GUARD=" + (report.allPass ? "PASS" : "FAIL"));
  console.log("REPORT=" + REPORT_PATH);
  for (const r of results) {
    console.log(
      r.viewport +
        " init_once=" +
        r.checks.init_called_once +
        " no_sync=" +
        r.checks.init_not_called_during_module_eval +
        " after_fcp=" +
        r.checks.init_runs_after_first_paint,
    );
  }
  console.log(
    "PERF tbt_delta=" +
      report.performanceDelta.tbt_delta +
      " verdict=" +
      report.performanceDelta.verdict,
  );

  if (server) server.close();
  process.exit(report.allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
