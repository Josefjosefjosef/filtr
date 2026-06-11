#!/usr/bin/env node
/**
 * SW_FIRST_INSTALL_GUARD
 *
 * Replay guard for P1 performance fix #7 (SW first-install reload elimination).
 *
 * Root cause: sw.js activate broadcast IU_SW_DEPLOY_RELOAD to ALL window clients
 * on EVERY activation — including the very first install. The inline PWA boot in
 * projects/index.html reacts with location.reload(), so every cold visitor (and
 * every Lighthouse/GTmetrix run) loaded the page twice.
 *
 * Scenario A (per viewport DESKTOP / MOBILE / TABLET_PORTRAIT / TABLET_LANDSCAPE):
 *   fresh profile, no SW -> exactly 1 navigation, navigation.type=navigate,
 *   no iu:pwa:sw-deploy-reload session key, SW controller attached, 0 errors.
 *
 * Scenario B (DESKTOP):
 *   old SW (guard-v1) -> new SW deploy (guard-v2) -> deploy refresh preserved
 *   (page reloads exactly once, deploy reload marker present).
 *
 * Usage:
 *   node scripts/sw-first-install-guard.cjs
 *   IU_GUARD_SW_FILE=C:\path\to\sw_before.js node scripts/sw-first-install-guard.cjs   (A/B vs jiné sw.js)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");
const {
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const REPO = path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_GUARD_PORT || 8753);
const SW_FILE = process.env.IU_GUARD_SW_FILE
  ? path.resolve(process.env.IU_GUARD_SW_FILE)
  : path.join(REPO, "sw.js");

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

/* Mutable deploy tag: scenario B flips v1 -> v2 to simulate a new SW deploy. */
const swState = { tag: "guard-v1" };

function buildSwBody() {
  const src = fs.readFileSync(SW_FILE, "utf8");
  return src.replace(
    /const CACHE_VERSION = "[^"]*";/,
    'const CACHE_VERSION = "' + swState.tag + '";'
  );
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (p === "/sw.js") {
          res.writeHead(200, {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(buildSwBody());
          return;
        }
        if (p.endsWith("/")) p += "index.html";
        const fp = path.join(REPO, p.replace(/^\/+/, ""));
        if (!fp.startsWith(REPO) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("not found");
          return;
        }
        res.writeHead(200, {
          "content-type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream",
        });
        res.end(fs.readFileSync(fp));
      } catch (_) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function attachErrorCollectors(page) {
  const tracker = createIgnorableResourceTracker();
  tracker.attachToPage(page);
  const consoleErrors = [];
  const pageErrors = [];
  const isNoise = (t) =>
    /ServiceWorker/i.test(t) ||
    isIgnorableGuardConsoleError(t, { hadRecentIgnorableFailure: tracker.hadRecentIgnorableFailure });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = String(m.text()).slice(0, 250);
    if (!isNoise(t)) consoleErrors.push(t);
  });
  page.on("pageerror", (e) => {
    const t = String(e.message || e).slice(0, 250);
    if (!isNoise(t)) pageErrors.push(t);
  });
  return { consoleErrors, pageErrors };
}

function attachNavCounter(page) {
  const navs = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navs.push(f.url());
  });
  return navs;
}

async function pageSwInfo(page) {
  return page.evaluate(() => {
    const navEntry = performance.getEntriesByType("navigation")[0];
    let sd = null;
    let silent = null;
    try {
      sd = sessionStorage.getItem("iu:pwa:sw-deploy-reload");
      silent = sessionStorage.getItem("iu_sw_update_reload_used");
    } catch (_) {}
    return {
      controller: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      navType: navEntry ? navEntry.type : null,
      deployReloadKey: sd,
      silentReloadKey: silent,
    };
  });
}

async function waitForController(page, timeoutMs) {
  await page
    .waitForFunction(
      () => navigator.serviceWorker && !!navigator.serviceWorker.controller,
      { timeout: timeoutMs }
    )
    .catch(() => {});
}

async function runScenarioA(browser, vp, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
    userAgent: vp.isMobile ? MOBILE_UA : undefined,
    locale: "cs-CZ",
    /* SW intentionally ENABLED — first-install behavior is the subject under test. */
  });
  const page = await context.newPage();
  const errs = attachErrorCollectors(page);
  const navs = attachNavCounter(page);

  await page.goto(baseUrl, { waitUntil: "load", timeout: 60000 });
  await waitForController(page, 15000);
  /* Broken version reloaded ~1s after the controller attached — give it room. */
  await page.waitForTimeout(8000);

  const info = await pageSwInfo(page);
  const checks = {
    sw_controller_attached: info.controller === true,
    single_navigation: navs.length === 1,
    nav_type_navigate: info.navType === "navigate",
    no_deploy_reload_key: info.deployReloadKey === null,
    console_errors_zero: errs.consoleErrors.length === 0,
    page_errors_zero: errs.pageErrors.length === 0,
  };
  const pass = Object.values(checks).every((v) => v === true);
  const result = {
    viewport: vp.name,
    scenario: "A_FIRST_INSTALL",
    pass,
    checks,
    navigations: navs.length,
    navType: info.navType,
    deployReloadKey: info.deployReloadKey,
    consoleErrors: errs.consoleErrors.slice(0, 5),
    pageErrors: errs.pageErrors.slice(0, 5),
  };
  await context.close();
  return result;
}

async function runScenarioB(browser, baseUrl) {
  swState.tag = "guard-v1";
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    locale: "cs-CZ",
  });
  const page = await context.newPage();
  const errs = attachErrorCollectors(page);
  const navs = attachNavCounter(page);

  /* Phase 1: install guard-v1 (first install — must NOT reload). */
  await page.goto(baseUrl, { waitUntil: "load", timeout: 60000 });
  await waitForController(page, 15000);
  await page.waitForTimeout(5000);
  const navsAfterInstall = navs.length;

  /* Phase 2: deploy guard-v2 and ask the registration to update. */
  swState.tag = "guard-v2";
  await page.evaluate(() => {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then((r) => {
        if (r) r.update();
      });
    }
  });
  /* Deploy refresh = one more navigation (either silent SW reload or inline boot reload). */
  await page
    .waitForFunction(
      () => {
        try {
          return (
            sessionStorage.getItem("iu:pwa:sw-deploy-reload") === "1" ||
            sessionStorage.getItem("iu_sw_update_reload_used") === "1"
          );
        } catch (_) {
          return false;
        }
      },
      { timeout: 25000 }
    )
    .catch(() => {});
  await page.waitForTimeout(4000);

  const info = await pageSwInfo(page).catch(() => ({}));
  const checks = {
    first_install_no_reload: navsAfterInstall === 1,
    update_reload_happened: navs.length === navsAfterInstall + 1,
    update_reload_marker:
      info.deployReloadKey === "1" || info.silentReloadKey === "1",
    console_errors_zero: errs.consoleErrors.length === 0,
    page_errors_zero: errs.pageErrors.length === 0,
  };
  const pass = Object.values(checks).every((v) => v === true);
  const result = {
    viewport: "DESKTOP",
    scenario: "B_SW_UPDATE",
    pass,
    checks,
    navigationsAfterInstall: navsAfterInstall,
    navigationsTotal: navs.length,
    deployReloadKey: info.deployReloadKey,
    silentReloadKey: info.silentReloadKey,
    consoleErrors: errs.consoleErrors.slice(0, 5),
    pageErrors: errs.pageErrors.slice(0, 5),
  };
  await context.close();
  return result;
}

async function main() {
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${PORT}/projects/`;
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const vp of VIEWPORTS) {
    swState.tag = "guard-v1";
    process.stderr.write(`[guard] A ${vp.name}...\n`);
    results.push(await runScenarioA(browser, vp, baseUrl));
  }
  process.stderr.write("[guard] B DESKTOP update...\n");
  results.push(await runScenarioB(browser, baseUrl));
  await browser.close();
  server.close();
  const pass = results.every((r) => r.pass);
  console.log(
    JSON.stringify(
      {
        guard: "SW_FIRST_INSTALL_GUARD",
        targetUrl: baseUrl,
        swFile: SW_FILE,
        finishedAt: new Date().toISOString(),
        result: pass ? "PASS" : "FAIL",
        scenarios: results,
      },
      null,
      2
    )
  );
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(String((e && e.stack) || e));
  process.exit(1);
});
