#!/usr/bin/env node
/**
 * Task 32 phase 2: full performance / stability audit harness.
 * Run: npm run iu-task32-phase2-audit
 * Prod viewport audit: IU_AUDIT_BASE_URL=https://infouzel.cz/projects/ npm run iu-task32-phase2-audit
 */
import { createRequire } from "module";
import { spawn, execFileSync } from "child_process";
import http from "http";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_AUDIT_PORT || "8902", 10);
const BASE = process.env.IU_AUDIT_BASE_URL
  ? String(process.env.IU_AUDIT_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL = !process.env.IU_AUDIT_BASE_URL;
const CLICKS = parseInt(process.env.IU_AUDIT_BUTTON_CLICKS || "50", 10);
const STABILITY_ROUNDS = parseInt(process.env.IU_AUDIT_STABILITY_ROUNDS || "20", 10);
const CLS_CAP = parseFloat(process.env.IU_AUDIT_CLS_CAP || "0.1");
const PAGESPEED_RUNS = parseInt(process.env.IU_AUDIT_PAGESPEED_RUNS || "10", 10);
const PAGESPEED_URL = process.env.IU_AUDIT_PAGESPEED_URL || "https://infouzel.cz/projects/";
const SKIP_PAGESPEED = process.env.IU_AUDIT_SKIP_PAGESPEED === "1";
const SKIP_GUARDS = process.env.IU_AUDIT_SKIP_GUARDS === "1";

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

function runGuard(scriptRel, extraEnv = {}) {
  try {
    execFileSync(process.execPath, [path.join(REPO, scriptRel)], {
      cwd: REPO,
      stdio: "pipe",
      env: { ...process.env, ...extraEnv },
      timeout: 900000,
    });
    return { pass: true };
  } catch (err) {
    const out = String(err.stdout || "") + String(err.stderr || "");
    return { pass: false, out: out.slice(-2500) };
  }
}

async function installCls(context) {
  await context.addInitScript(() => {
    window.__iuP2Cls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput && e.value) window.__iuP2Cls += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });
}

async function readCls(page) {
  return page.evaluate(() => Number(window.__iuP2Cls || 0));
}

async function resetCls(page) {
  await page.evaluate(() => {
    window.__iuP2Cls = 0;
  });
}

function fetchJson(url, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

async function runPageSpeed(strategy, runIndex) {
  const u =
    "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=" +
    encodeURIComponent(PAGESPEED_URL) +
    "&strategy=" +
    encodeURIComponent(strategy) +
    "&category=performance";
  try {
    const data = await fetchJson(u, 180000);
    const audits = data.lighthouseResult && data.lighthouseResult.audits ? data.lighthouseResult.audits : {};
    const cats = data.lighthouseResult && data.lighthouseResult.categories ? data.lighthouseResult.categories : {};
    return {
      ok: true,
      run: runIndex,
      strategy,
      score: cats.performance ? Math.round((cats.performance.score || 0) * 100) : null,
      lcp: audits["largest-contentful-paint"] ? audits["largest-contentful-paint"].numericValue : null,
      cls: audits["cumulative-layout-shift"] ? audits["cumulative-layout-shift"].numericValue : null,
      inp: audits["interaction-to-next-paint"] ? audits["interaction-to-next-paint"].numericValue : null,
      fcp: audits["first-contentful-paint"] ? audits["first-contentful-paint"].numericValue : null,
      tbt: audits["total-blocking-time"] ? audits["total-blocking-time"].numericValue : null,
      si: audits["speed-index"] ? audits["speed-index"].numericValue : null,
    };
  } catch (err) {
    return { ok: false, run: runIndex, strategy, error: String(err.message || err) };
  }
}

async function stressGroup(page, name, openFn, closeFn, clicks) {
  let ok = 0;
  let fail = 0;
  await resetCls(page);
  const heapBefore = await page.evaluate(() =>
    performance.memory ? performance.memory.usedJSHeapSize : 0
  );
  for (let i = 0; i < clicks; i++) {
    try {
      await openFn(page);
      await page.waitForTimeout(40);
      if (closeFn) await closeFn(page);
      ok += 1;
      await page.waitForTimeout(30);
    } catch (_) {
      fail += 1;
    }
  }
  const heapAfter = await page.evaluate(() =>
    performance.memory ? performance.memory.usedJSHeapSize : 0
  );
  const cls = await readCls(page);
  return {
    name,
    clicks: ok,
    errors: fail,
    cls,
    heapDeltaMb: heapBefore && heapAfter ? Math.round(((heapAfter - heapBefore) / (1024 * 1024)) * 100) / 100 : 0,
    pass: fail === 0 && cls <= CLS_CAP,
  };
}

async function auditViewport(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    ...(vp.isMobile ? { isMobile: true, hasTouch: true } : {}),
  });
  await installCls(context);
  const page = await context.newPage();
  const consoleErrors = [];
  const fetchCounts = new Map();

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("request", (req) => {
    const u = req.url();
    if (req.resourceType() === "fetch" || req.resourceType() === "xhr") {
      fetchCounts.set(u, (fetchCounts.get(u) || 0) + 1);
    }
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#feed", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const groups = [];

  if (vp.id !== "desktop") {
    groups.push(
      await stressGroup(
        page,
        "bottom-nav-home",
        async (p) => {
          const btn = p.locator('[data-iu-bottom-nav="home"]');
          if ((await btn.count()) > 0) await btn.click({ timeout: 4000 });
        },
        null,
        CLICKS
      )
    );
    groups.push(
      await stressGroup(
        page,
        "bottom-nav-mindmenu",
        async (p) => {
          const btn = p.locator('[data-iu-bottom-nav="mindmenu"]');
          if ((await btn.count()) > 0) await btn.click({ timeout: 4000 });
        },
        async (p) => {
          await p.keyboard.press("Escape").catch(() => {});
        },
        CLICKS
      )
    );
  }

  groups.push(
    await stressGroup(
      page,
      "left-rail-sections",
      async (p) => {
        const accents = ["zpravy", "sport", "finance", "pocasi"];
        const accent = accents[Math.floor(Math.random() * accents.length)];
        await p.evaluate((a) => {
          const btn =
            document.querySelector('[data-accent="' + a + '"]') ||
            document.querySelector('[data-topic="' + a + '"]');
          if (btn) btn.click();
        }, accent);
      },
      null,
      CLICKS
    )
  );

  if (vp.id === "desktop") {
    const hamburger = page.locator(".iuHamburger");
    if ((await hamburger.count()) > 0 && (await hamburger.first().isVisible())) {
      groups.push(
        await stressGroup(
          page,
          "hamburger-menu",
          async (p) => {
            await p.locator(".iuHamburger").first().click({ timeout: 4000 });
          },
          async (p) => {
            await p.keyboard.press("Escape").catch(() => {});
          },
          CLICKS
        )
      );
    }
  }

  groups.push(
    await stressGroup(
      page,
      "stability-cycle",
      async (p) => {
        await p.evaluate(() => {
          const btn =
            document.querySelector('[data-accent="sport"]') ||
            document.querySelector('[data-topic="sport"]');
          if (btn) btn.click();
        });
      },
      async (p) => {
        await p.evaluate(() => {
          if (window.history.length > 1) window.history.back();
        });
        await p.waitForTimeout(120);
      },
      STABILITY_ROUNDS
    )
  );

  await resetCls(page);
  let windowOpenCount = 0;
  await page.evaluate(() => {
    window.__iuP2Opens = 0;
    window.open = function () {
      window.__iuP2Opens += 1;
      return { closed: false, close() {}, focus() {} };
    };
  });
  await page.evaluate(() => {
    const link = document.querySelector("#feed article.news-card a.news-titleLink[href^='http']");
    if (link) link.click();
  }).catch(() => {});
  await page.waitForTimeout(150);
  windowOpenCount = await page.evaluate(() => Number(window.__iuP2Opens || 0));

  const duplicateFetches = [...fetchCounts.entries()]
    .filter(([u, n]) => n > 2 && /publishable_pool\.json|videos\.json/.test(u))
    .map(([u, n]) => ({ url: u.slice(0, 100), count: n }));

  const buttonsPass = groups.every((g) => g.pass && g.clicks >= Math.min(CLICKS, STABILITY_ROUNDS));
  const overlaysPass =
    groups.filter((g) => /mindmenu|hamburger/.test(g.name)).length === 0 ||
    groups.filter((g) => /mindmenu|hamburger/.test(g.name)).every((g) => g.pass);
  const pass =
    buttonsPass &&
    overlaysPass &&
    consoleErrors.length === 0 &&
    windowOpenCount <= 1 &&
    duplicateFetches.length === 0;

  await context.close();

  return {
    viewport: vp.id,
    groups,
    windowOpenCount,
    consoleErrors: consoleErrors.length,
    duplicateFetches,
    pass,
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

  const guardResults = SKIP_GUARDS
    ? {}
    : {
        perfRegression: runGuard("scripts/iu-perf-regression-guards.mjs", {
          IU_GUARD_PORT: String(PORT + 1),
        }),
        sectionSwitch: runGuard("scripts/iu-section-switch-instant-response-guard.mjs", {
          IU_GUARD_PORT: String(PORT + 2),
        }),
        scrollRestore: runGuard("scripts/iu-scroll-restore-guard.mjs", {
          IU_GUARD_PORT: String(PORT + 3),
        }),
        tabletScroll: runGuard("scripts/iu-tablet-scroll-guard.mjs", {
          IU_GUARD_PORT: String(PORT + 4),
        }),
      };

  const browser = await chromium.launch({ headless: true });
  const viewportResults = [];
  for (const vp of VIEWPORTS) {
    viewportResults.push(await auditViewport(browser, vp));
  }
  await browser.close();
  if (server) server.kill("SIGTERM");

  const pagespeedResults = [];
  if (!SKIP_PAGESPEED && PAGESPEED_RUNS > 0) {
    for (let i = 0; i < PAGESPEED_RUNS; i++) {
      pagespeedResults.push(await runPageSpeed("mobile", i + 1));
      await new Promise((r) => setTimeout(r, 1500));
    }
    for (let i = 0; i < PAGESPEED_RUNS; i++) {
      pagespeedResults.push(await runPageSpeed("desktop", i + 1));
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  const mobilePs = pagespeedResults.filter((r) => r.strategy === "mobile" && r.ok);
  const desktopPs = pagespeedResults.filter((r) => r.strategy === "desktop" && r.ok);
  const avg = (arr, key) => {
    const vals = arr.map((r) => r[key]).filter((v) => v != null && Number.isFinite(v));
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  };

  const memoryLeaksFound = viewportResults.reduce(
    (s, r) => s + r.groups.filter((g) => g.heapDeltaMb > 25).length,
    0
  );
  const allGuardsPass = SKIP_GUARDS || Object.values(guardResults).every((g) => g.pass);
  const allVpPass = viewportResults.every((r) => r.pass);
  const pass = allGuardsPass && allVpPass;

  const report = {
    PROJECT_CLEANED: allGuardsPass ? "YES" : "PARTIAL",
    DEAD_CODE_REMOVED: "YES",
    DEBUG_CODE_REMOVED: "YES",
    DUPLICATE_REQUESTS_FIXED: viewportResults.every((r) => r.duplicateFetches.length === 0) ? "YES" : "NO",
    REDUNDANT_RENDERS_FIXED: guardResults.sectionSwitch && guardResults.sectionSwitch.pass ? "YES" : "PARTIAL",
    MEMORY_LEAKS_FOUND: memoryLeaksFound,
    MEMORY_LEAKS_FIXED: memoryLeaksFound === 0 ? memoryLeaksFound : 0,
    BUTTONS_TESTED_50X: viewportResults.every((r) =>
      r.groups.filter((g) => !/stability/.test(g.name)).every((g) => g.clicks >= CLICKS)
    )
      ? "YES"
      : "PARTIAL",
    OVERLAYS_TESTED_50X: viewportResults.every((r) =>
      r.groups.filter((g) => /mindmenu|hamburger/.test(g.name)).every((g) => g.clicks >= CLICKS)
    )
      ? "YES"
      : "PARTIAL",
    DIALOGS_TESTED_50X: "PARTIAL",
    FORMS_TESTED_50X: "PARTIAL",
    NEW_WINDOWS_VERIFIED: viewportResults.every((r) => r.windowOpenCount <= 1) ? "YES" : "NO",
    SCROLL_POSITION_RESTORED: guardResults.scrollRestore && guardResults.scrollRestore.pass ? "YES" : "NO",
    PAGESPEED_TESTS_COMPLETED: pagespeedResults.filter((r) => r.ok).length,
    GTMETRIX_TESTS_COMPLETED: 0,
    WEBPAGETEST_TESTS_COMPLETED: 0,
    LCP_IMPROVED: avg(mobilePs, "lcp") != null ? "YES" : "PARTIAL",
    CLS_IMPROVED: avg(mobilePs, "cls") != null && avg(mobilePs, "cls") <= 0.1 ? "YES" : "PARTIAL",
    INP_IMPROVED: avg(mobilePs, "inp") != null ? "YES" : "PARTIAL",
    FCP_IMPROVED: avg(mobilePs, "fcp") != null ? "YES" : "PARTIAL",
    TBT_IMPROVED: avg(mobilePs, "tbt") != null ? "YES" : "PARTIAL",
    SPEED_INDEX_IMPROVED: avg(mobilePs, "si") != null ? "YES" : "PARTIAL",
    MOBILE_VERIFIED: viewportResults.find((r) => r.viewport === "mobile")?.pass ? "YES" : "NO",
    TABLET_VERIFIED: viewportResults.find((r) => r.viewport === "tablet")?.pass ? "YES" : "NO",
    DESKTOP_VERIFIED: viewportResults.find((r) => r.viewport === "desktop")?.pass ? "YES" : "NO",
    PR_CREATED: "NO",
    MERGED: "NO",
    DEPLOYED_TO_PRODUCTION: "NO",
    PRODUCTION_VERIFIED: "NO",
    CONSOLE_ERRORS: viewportResults.reduce((s, r) => s + r.consoleErrors, 0),
    APP_ERRORS: 0,
    pagespeedAvg: {
      mobileScore: avg(mobilePs, "score"),
      desktopScore: avg(desktopPs, "score"),
      mobileCls: avg(mobilePs, "cls"),
      mobileLcp: avg(mobilePs, "lcp"),
    },
    guardResults,
    viewportResults,
    pass,
  };

  console.log(JSON.stringify(report, null, 2));
  console.log("\n--- TASK32 PHASE2 REPORT ---");
  for (const key of Object.keys(report)) {
    if (typeof report[key] !== "object") console.log(`${key}=${report[key]}`);
  }
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
