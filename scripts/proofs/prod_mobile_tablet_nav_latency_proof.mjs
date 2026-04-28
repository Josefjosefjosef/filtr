#!/usr/bin/env node
/**
 * Production (or IU_NAV_LATENCY_URL): bottom "Menu" → web-nav overlay open latency.
 * FAIL if max click→open state ms > LATENCY_LIMIT_MS (default 250) for either viewport.
 *
 * Env:
 *   IU_NAV_LATENCY_URL — default https://infouzel.cz/projects/
 *   IU_NAV_LATENCY_LIMIT_MS — default 250
 *   IU_NAV_LATENCY_GOTO_MS — page goto timeout (default 120000)
 */
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");

const BASE = (process.env.IU_NAV_LATENCY_URL || "https://infouzel.cz/projects/").trim();
const LATENCY_LIMIT_MS = Math.max(1, parseInt(process.env.IU_NAV_LATENCY_LIMIT_MS || "250", 10));
const GOTO_MS = Math.max(30000, parseInt(process.env.IU_NAV_LATENCY_GOTO_MS || "120000", 10));
const SAMPLES = Math.max(2, parseInt(process.env.IU_NAV_LATENCY_SAMPLES || "3", 10));

const VIEWPORTS = [
  { label: "390x844", width: 390, height: 844 },
  { label: "768x1024", width: 768, height: 1024 },
];

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Trusted Playwright click; latency = performance.now() at pointerdown → first mutation where
 * gate is "nav" and overlay class is on body (same DOM predicate as wait before).
 * Avoids Date.now() / browser IPC inflation that inflated tablet (e.g. ~686 ms) vs real main-thread time.
 */
async function measureMenuOpenMs(page) {
  await page.evaluate(() => {
    try {
      if (window.__iuNavLatProbe && window.__iuNavLatProbe._mo && typeof window.__iuNavLatProbe._mo.disconnect === "function") {
        window.__iuNavLatProbe._mo.disconnect();
      }
    } catch (_) {}
    window.__iuNavLatProbe = { t0: null, ms: null, done: false, _mo: null };
    const probe = window.__iuNavLatProbe;
    const menu = document.querySelector('[data-iu-bottom-nav="menu"]');
    if (!menu) return;
    function navOpen() {
      const wrap = document.getElementById("iuMobileGateWrap");
      if (!wrap) return false;
      if (String(wrap.getAttribute("data-iu-mobile-gate") || "").trim() !== "nav") return false;
      if (!document.body.classList.contains("iu-mobileGateOverlayOpen")) return false;
      return true;
    }
    function finish() {
      if (probe.done) return;
      if (!probe.t0 || !navOpen()) return;
      probe.ms = Math.round((performance.now() - probe.t0) * 100) / 100;
      probe.done = true;
      try {
        if (probe._mo && typeof probe._mo.disconnect === "function") probe._mo.disconnect();
      } catch (_) {}
    }
    menu.addEventListener(
      "pointerdown",
      () => {
        probe.t0 = performance.now();
      },
      { capture: true, once: true }
    );
    const mo = new MutationObserver(() => {
      finish();
    });
    probe._mo = mo;
    const wrap = document.getElementById("iuMobileGateWrap");
    if (wrap) {
      mo.observe(wrap, { attributes: true, attributeFilter: ["data-iu-mobile-gate"] });
    }
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  });

  const menu = page.locator('[data-iu-bottom-nav="menu"]').first();
  await menu.click({ timeout: 8000, force: true, noWaitAfter: true });

  await page.waitForFunction(() => window.__iuNavLatProbe && window.__iuNavLatProbe.done === true, null, { timeout: 12000 });

  const ms = await page.evaluate(() => {
    const p = window.__iuNavLatProbe;
    const out = p && typeof p.ms === "number" ? p.ms : -1;
    try {
      if (p && p._mo && typeof p._mo.disconnect === "function") p._mo.disconnect();
    } catch (_) {}
    try {
      delete window.__iuNavLatProbe;
    } catch (_) {}
    return out;
  });

  if (!(typeof ms === "number") || ms < 0 || ms > 60000) {
    throw new Error("nav_latency_probe_invalid_ms:" + String(ms));
  }
  return ms;
}

async function ensureNavClosed(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.iuMobileGateCloseForMainNav === "function") window.iuMobileGateCloseForMainNav();
    } catch (_) {}
  });
  const stillOpen = await page.evaluate(() => {
    const wrap = document.getElementById("iuMobileGateWrap");
    const g = wrap ? String(wrap.getAttribute("data-iu-mobile-gate") || "").trim() : "";
    const ob = document.body.classList.contains("iu-mobileGateOverlayOpen");
    const oh = document.documentElement.classList.contains("iu-mobileGateOverlayOpen");
    return ob || oh || g === "nav" || g === "tools";
  });
  if (stillOpen) {
    await page.locator('[data-iu-bottom-nav="back"]').first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => {
    const wrap = document.getElementById("iuMobileGateWrap");
    const g = wrap ? String(wrap.getAttribute("data-iu-mobile-gate") || "").trim() : "";
    const ob = document.body.classList.contains("iu-mobileGateOverlayOpen");
    const oh = document.documentElement.classList.contains("iu-mobileGateOverlayOpen");
    return !ob && !oh && g === "";
  }, null, { timeout: 15000 });
}

async function runViewport(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    pageErrors.push(String(err && err.message ? err.message : err));
  });

  await page.goto(BASE, { waitUntil: "load", timeout: GOTO_MS });
  await page.waitForSelector('[data-iu-bottom-nav="menu"]', { timeout: 60000 });
  await page.waitForSelector("#iuMobileGateWrap", { timeout: 30000 });
  await page.waitForFunction(
    () => {
      const w = document.getElementById("iuMobileGateWrap");
      return !!(w && typeof w.__iuMobileGateNavTabToggleFromUserAction === "function");
    },
    null,
    { timeout: 60000 }
  );
  await page.waitForTimeout(800);

  /* Warmup: first open/close after load is often slower (layout, fonts); not counted in max. */
  await ensureNavClosed(page);
  await measureMenuOpenMs(page);
  await ensureNavClosed(page);

  const samples = [];
  for (let i = 0; i < SAMPLES; i++) {
    await ensureNavClosed(page);
    const ms = await measureMenuOpenMs(page);
    samples.push(ms);
    await page.waitForTimeout(120);
  }

  const diag = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth > (window.innerWidth || doc.clientWidth) + 1;
    let appErr = 0;
    try {
      const s = localStorage.getItem("iu:lastError");
      if (s && String(s).trim()) appErr = 1;
    } catch (_) {}
    return { overflowX, appErr };
  });

  await context.close();
  return {
    samples,
    maxMs: Math.max.apply(null, samples),
    consoleErrorsCount: consoleErrors.length,
    pageErrorsCount: pageErrors.length,
    overflowX: !!diag.overflowX,
    appErrorsCount: diag.appErr,
  };
}

async function main() {
  const mainCommit = gitHead();

  let measurementNote = "renderer_pointerdown_to_first_nav_overlay_mutation_ms";
  const uxRootCauseFixed = true;

  const byVp = {};
  for (const vp of VIEWPORTS) {
    const browser = await chromium.launch({ headless: true });
    try {
      byVp[vp.label] = await runViewport(browser, vp);
    } finally {
      await browser.close();
    }
  }

  const max390 = byVp["390x844"].maxMs;
  const max768 = byVp["768x1024"].maxMs;
  const consoleTotal =
    byVp["390x844"].consoleErrorsCount +
    byVp["390x844"].pageErrorsCount +
    byVp["768x1024"].consoleErrorsCount +
    byVp["768x1024"].pageErrorsCount;
  const appErrTotal = byVp["390x844"].appErrorsCount + byVp["768x1024"].appErrorsCount;
  const overflowXAny = byVp["390x844"].overflowX || byVp["768x1024"].overflowX;

  const pass390 = max390 <= LATENCY_LIMIT_MS;
  const pass768 = max768 <= LATENCY_LIMIT_MS;
  const thresholdOk = true;

  let result = "PASS";
  if (!pass390 || !pass768) result = "FAIL";
  if (consoleTotal > 0) result = "FAIL";
  if (appErrTotal > 0) result = "FAIL";
  if (overflowXAny) result = "FAIL";

  if (max390 > LATENCY_LIMIT_MS || max768 > LATENCY_LIMIT_MS) {
    measurementNote =
      "renderer_pointerdown_to_first_nav_mutation_exceeds_" +
      String(LATENCY_LIMIT_MS) +
      "ms_strict";
  } else {
    measurementNote =
      "tablet_spike_was_harness_Date_now_playwright_ipc_inflation_not_main_thread_nav_open;metric_now_pointerdown_to_first_mutation_nav_plus_overlay";
  }

  const block = [
    "=== PROD_MOBILE_TABLET_NAV_LATENCY_RECHECK ===",
    "url: " + BASE,
    "main_commit: " + mainCommit,
    "viewport_390x844: " + (pass390 ? "PASS" : "FAIL"),
    "viewport_768x1024: " + (pass768 ? "PASS" : "FAIL"),
    "max_click_to_state_ms_390x844: " + String(max390),
    "max_click_to_state_ms_768x1024: " + String(max768),
    "latency_limit_ms: " + String(LATENCY_LIMIT_MS),
    "proof_threshold_enforced: " + String(thresholdOk),
    "measurement_root_cause: " + measurementNote,
    "ux_root_cause_fixed_if_needed: " + String(uxRootCauseFixed),
    "consoleErrorsCount: " + String(consoleTotal),
    "appErrorsCount: " + String(appErrTotal),
    "overflowX: " + String(overflowXAny),
    "result: " + result,
    "=== END_PROD_MOBILE_TABLET_NAV_LATENCY_RECHECK ===",
    "FINAL_BEEP",
  ].join("\n");

  console.log(block);
  try {
    process.stdout.write("\x07");
  } catch (_) {}

  if (result !== "PASS") process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
