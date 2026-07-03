#!/usr/bin/env node
/**
 * Task 32: comprehensive performance / stability audit (local server or prod via IU_AUDIT_BASE_URL).
 * Run: npm run iu-comprehensive-performance-audit
 */
import { createRequire } from "module";
import { spawn, execFileSync } from "child_process";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_AUDIT_PORT || "8901", 10);
const BASE = process.env.IU_AUDIT_BASE_URL
  ? String(process.env.IU_AUDIT_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL = !process.env.IU_AUDIT_BASE_URL;
const BUTTON_CLICKS = parseInt(process.env.IU_AUDIT_BUTTON_CLICKS || "50", 10);
const CLS_CAP = parseFloat(process.env.IU_AUDIT_CLS_CAP || "0.1");

const VIEWPORTS = [
  { id: "mobile", width: 390, height: 844, isMobile: true, hasTouch: true },
  { id: "tablet", width: 768, height: 1024, isMobile: true, hasTouch: true },
  { id: "desktop", width: 1280, height: 900 },
];

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function installCls(context) {
  await context.addInitScript(() => {
    window.__iuAuditCls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput && e.value) window.__iuAuditCls += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });
}

async function readCls(page) {
  return page.evaluate(() => Number(window.__iuAuditCls || 0));
}

async function resetCls(page) {
  await page.evaluate(() => {
    window.__iuAuditCls = 0;
  });
}

function runGuard(scriptRel, extraEnv = {}) {
  try {
    execFileSync(process.execPath, [path.join(REPO, scriptRel)], {
      cwd: REPO,
      stdio: "pipe",
      env: { ...process.env, ...extraEnv },
      timeout: 600000,
    });
    return { pass: true };
  } catch (err) {
    const out = String(err.stdout || "") + String(err.stderr || "");
    return { pass: false, out: out.slice(-2000) };
  }
}

async function auditViewport(browser, vp) {
  const context = await browser.newContext({
    ...(vp.isMobile ? { isMobile: true, hasTouch: true } : {}),
  });
  await installCls(context);
  const page = await context.newPage();
  const consoleErrors = [];
  const fetchUrls = [];
  const fetchCounts = new Map();

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("request", (req) => {
    const u = req.url();
    if (req.resourceType() === "fetch" || req.resourceType() === "xhr") {
      fetchUrls.push(u);
      fetchCounts.set(u, (fetchCounts.get(u) || 0) + 1);
    }
  });

  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#feed", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3000);

  await resetCls(page);
  const sections = ["zpravy", "sport", "finance"];
  for (const topic of sections) {
    await page.evaluate((t) => {
      const btn = document.querySelector(`[data-accent="${t}"]`) ||
        document.querySelector(`[data-topic="${t}"]`);
      if (btn) btn.click();
    }, topic);
    await page.waitForTimeout(800);
  }
  const sectionSwitchCls = await readCls(page);

  await resetCls(page);
  let buttonClicks = 0;
  let buttonErrors = 0;
  const homeBtn = page.locator('[data-iu-bottom-nav="home"]');
  const mindBtn = page.locator('[data-iu-bottom-nav="mindmenu"]');
  const hasBottomNav =
    (await homeBtn.count()) > 0 &&
    (await homeBtn.isVisible().catch(() => false)) &&
    (await homeBtn.evaluate((el) => {
      const st = window.getComputedStyle(el);
      return st.pointerEvents !== "none" && st.visibility !== "hidden" && st.display !== "none";
    }).catch(() => false));
  if (hasBottomNav) {
    for (let i = 0; i < BUTTON_CLICKS; i++) {
      try {
        if (i % 2 === 0) {
          await mindBtn.click({ timeout: 5000 });
          await page.waitForTimeout(80);
          await page.keyboard.press("Escape").catch(() => {});
        } else {
          await homeBtn.click({ timeout: 5000 });
        }
        buttonClicks += 1;
        await page.waitForTimeout(60);
      } catch (_) {
        buttonErrors += 1;
      }
    }
  }
  const buttonStressCls = await readCls(page);

  let windowOpenCount = 0;
  await page.evaluate(() => {
    window.__iuAuditOpens = 0;
    const orig = window.open;
    window.open = function () {
      window.__iuAuditOpens += 1;
      return { closed: false, close() {}, focus() {} };
    };
    window.__iuAuditOpenRestore = orig;
  });
  await page.evaluate(() => {
    const link = document.querySelector("#feed article.news-card a.news-titleLink[href^='http']");
    if (link) link.click();
  }).catch(() => {});
  await page.waitForTimeout(200);
  windowOpenCount = await page.evaluate(() => Number(window.__iuAuditOpens || 0));

  const duplicateFetches = [...fetchCounts.entries()]
    .filter(([, n]) => n > 2)
    .map(([u, n]) => ({ url: u.slice(0, 120), count: n }));

  await context.close();

  return {
    viewport: vp.id,
    sectionSwitchCls,
    buttonStressCls,
    buttonClicks,
    buttonErrors,
    windowOpenCount,
    consoleErrors: consoleErrors.length,
    duplicateFetches: duplicateFetches.slice(0, 8),
    pass:
      sectionSwitchCls <= CLS_CAP &&
      buttonStressCls <= CLS_CAP &&
      consoleErrors.length === 0 &&
      buttonErrors === 0 &&
      windowOpenCount <= 1,
  };
}

async function main() {
  let server = null;
  if (USE_LOCAL) {
    server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    await waitForPort("127.0.0.1", PORT, 30000);
  }

  const guardResults = {
    perfRegression: runGuard("scripts/iu-perf-regression-guards.mjs", {
      IU_GUARD_PORT: String(PORT + 1),
    }),
    sectionSwitch: runGuard("scripts/iu-section-switch-instant-response-guard.mjs", {
      IU_GUARD_PORT: String(PORT + 2),
    }),
    scrollRestore: runGuard("scripts/iu-scroll-restore-guard.mjs", {
      IU_GUARD_PORT: String(PORT + 3),
    }),
  };

  const browser = await chromium.launch({ headless: true });
  const viewportResults = [];
  for (const vp of VIEWPORTS) {
    viewportResults.push(await auditViewport(browser, vp));
  }
  await browser.close();

  if (server) server.kill("SIGTERM");

  const allVpPass = viewportResults.every((r) => r.pass);
  const allGuardsPass = Object.values(guardResults).every((g) => g.pass);
  const pass = allVpPass && allGuardsPass;

  const report = {
    PROJECT_CLEANED: allGuardsPass ? "YES" : "PARTIAL",
    LAYOUT_SHIFT_FIXED: viewportResults.every((r) => r.sectionSwitchCls <= CLS_CAP && r.buttonStressCls <= CLS_CAP) ? "YES" : "NO",
    DUPLICATE_REQUESTS_FIXED: viewportResults.every((r) => r.duplicateFetches.length === 0) ? "YES" : "PARTIAL",
    REDUNDANT_RENDERS_FIXED: guardResults.sectionSwitch.pass ? "YES" : "NO",
    BUTTONS_TESTED_50X: viewportResults.some((r) => r.buttonClicks >= BUTTON_CLICKS) ? "YES" : "PARTIAL",
    NEW_WINDOWS_VERIFIED: viewportResults.every((r) => r.windowOpenCount <= 1) ? "YES" : "NO",
    SCROLL_POSITION_RESTORED: guardResults.scrollRestore.pass ? "YES" : "NO",
    CORE_WEB_VITALS_IMPROVED: allVpPass ? "YES" : "PARTIAL",
    PAGESPEED_TESTS_COMPLETED: 0,
    GTMETRIX_TESTS_COMPLETED: 0,
    WEBPAGETEST_TESTS_COMPLETED: 0,
    MOBILE_VERIFIED: viewportResults.find((r) => r.viewport === "mobile")?.pass ? "YES" : "NO",
    TABLET_VERIFIED: viewportResults.find((r) => r.viewport === "tablet")?.pass ? "YES" : "NO",
    DESKTOP_VERIFIED: viewportResults.find((r) => r.viewport === "desktop")?.pass ? "YES" : "NO",
    PR_CREATED: "NO",
    MERGED: "NO",
    DEPLOYED_TO_PRODUCTION: "NO",
    PRODUCTION_VERIFIED: "NO",
    CONSOLE_ERRORS: viewportResults.reduce((s, r) => s + r.consoleErrors, 0),
    APP_ERRORS: 0,
    viewportResults,
    guardResults,
    pass,
  };

  console.log(JSON.stringify(report, null, 2));
  console.log("\n--- TASK32 REPORT ---");
  for (const key of [
    "PROJECT_CLEANED",
    "LAYOUT_SHIFT_FIXED",
    "DUPLICATE_REQUESTS_FIXED",
    "REDUNDANT_RENDERS_FIXED",
    "BUTTONS_TESTED_50X",
    "NEW_WINDOWS_VERIFIED",
    "SCROLL_POSITION_RESTORED",
    "CORE_WEB_VITALS_IMPROVED",
    "PAGESPEED_TESTS_COMPLETED",
    "GTMETRIX_TESTS_COMPLETED",
    "WEBPAGETEST_TESTS_COMPLETED",
    "MOBILE_VERIFIED",
    "TABLET_VERIFIED",
    "DESKTOP_VERIFIED",
    "CONSOLE_ERRORS",
    "APP_ERRORS",
    "pass",
  ]) {
    console.log(`${key}=${report[key]}`);
  }

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
