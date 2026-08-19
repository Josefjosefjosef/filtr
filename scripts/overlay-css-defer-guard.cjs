#!/usr/bin/env node
/**
 * OVERLAY_CSS_DEFER_GUARD
 *
 * Replay guard for deferred overlay stylesheets (P2 fix #1).
 * Verifies per viewport: load blocking count, overlay open/close/reopen styled, regression.
 *
 * Usage:
 *   node scripts/overlay-css-defer-guard.cjs
 *   IU_GUARD_URL=https://infouzel.cz/projects/ node scripts/overlay-css-defer-guard.cjs
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
const PORT = Number(process.env.IU_GUARD_PORT || 8747);

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

function styledOverlay(el) {
  if (!el) return false;
  const st = window.getComputedStyle(el);
  if (st.display === "none" || st.visibility === "hidden") return false;
  const r = el.getBoundingClientRect();
  if (r.width < 40 || r.height < 40) return false;
  const pos = st.position;
  const br = parseFloat(st.borderRadius || "0");
  const z = parseInt(st.zIndex || "0", 10);
  return (pos === "fixed" || pos === "absolute") && (br > 0 || z > 1000);
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
  const consoleErrors = [];
  const pageErrors = [];
  const isEnvNoise = (t) => /ServiceWorker/i.test(t) || isIgnorableGuardConsoleError(t);
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = String(m.text()).slice(0, 250);
    if (!isEnvNoise(t)) consoleErrors.push(t);
  });
  page.on("pageerror", (e) => {
    const t = String(e.message || e).slice(0, 250);
    if (!isEnvNoise(t)) pageErrors.push(t);
  });

  await installProofGuardNetworkStubs(page);

  const checks = {};

  await page.goto(baseUrl, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const loadMetrics = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
    const deferred = links.filter((l) => l.getAttribute("data-iu-defer-overlay-css") === "1");
    const blocking = links.filter((l) => l.getAttribute("data-iu-defer-overlay-css") !== "1");
    let fcp = null;
    let lcp = null;
    try {
      const paints = performance.getEntriesByType("paint");
      const fcpE = paints.find((e) => e.name === "first-contentful-paint");
      if (fcpE) fcp = Math.round(fcpE.startTime);
      const lcpE = performance.getEntriesByType("largest-contentful-paint");
      if (lcpE.length) lcp = Math.round(lcpE[lcpE.length - 1].startTime);
    } catch (_) {}
    return {
      blockingCount: blocking.length,
      deferredOverlayCount: deferred.length,
      fcpMs: fcp,
      lcpMs: lcp,
      guardInit: !!window.__iuOverlayCssDeferGuardInit,
      ensureFn: typeof window.iuEnsureOverlayCss === "function",
    };
  });

  checks.load_pass = loadMetrics.blockingCount === 4 && loadMetrics.deferredOverlayCount === 8;
  checks.deferred_overlay_css_present = loadMetrics.deferredOverlayCount >= 4;
  checks.open_guard_boot = loadMetrics.guardInit && loadMetrics.ensureFn;

  async function overlayCycle(openFn, closeSel, overlaySel, key, closeFn) {
    await page.evaluate(openFn);
    await page.waitForTimeout(700);
    const openState = await page.evaluate((sel) => {
      const ov = document.querySelector(sel);
      function isStyled(node) {
        if (!node || node.hidden) return false;
        const st = window.getComputedStyle(node);
        if (st.display === "none" || st.visibility === "hidden") return false;
        const r = node.getBoundingClientRect();
        if (r.width < 80 || r.height < 80) return false;
        const title = node.querySelector("h2, [class*='__title'], [class*='-h2']");
        if (title) {
          const ts = window.getComputedStyle(title);
          if (parseInt(ts.fontWeight, 10) >= 600) return true;
        }
        const br = parseFloat(st.borderRadius || "0");
        return br >= 4 || r.width > 200;
      }
      return {
        visible: isStyled(ov),
        styled: isStyled(ov),
      };
    }, overlaySel);
    checks[key + "_open"] = openState.visible;
    checks[key + "_styled"] = openState.styled;
    if (closeFn) {
      await page.evaluate(closeFn);
    } else {
      await page.evaluate((sel) => {
        const b = document.querySelector(sel);
        if (b) b.click();
      }, closeSel);
    }
    await page.waitForTimeout(400);
    const closed = await page.evaluate((sel) => {
      const ov = document.querySelector(sel);
      if (!ov) return true;
      if (ov.hidden) return true;
      const st = window.getComputedStyle(ov);
      return st.display === "none" || st.visibility === "hidden";
    }, overlaySel);
    checks[key + "_close"] = closed;
    await page.evaluate(openFn);
    await page.waitForTimeout(400);
    const reopen = await page.evaluate((sel) => {
      const ov = document.querySelector(sel);
      if (!ov || ov.hidden) return false;
      const st = window.getComputedStyle(ov);
      return st.display !== "none" && st.visibility !== "hidden";
    }, overlaySel);
    checks[key + "_reopen"] = reopen;
    if (closeFn) {
      await page.evaluate(closeFn);
    } else {
      await page.evaluate((sel) => {
        const b = document.querySelector(sel);
        if (b) b.click();
      }, closeSel);
    }
    await page.waitForTimeout(300);
  }

  await overlayCycle(
    async () => {
      if (typeof window.__iuEnsureNotesOverlay === "function") await window.__iuEnsureNotesOverlay();
      window.iuNotesService.openOverlay();
    },
    null,
    "#iuNotesOverlay",
    "notes",
    async () => {
      if (window.iuNotesService && typeof window.iuNotesService.closeOverlay === "function") {
        await window.iuNotesService.closeOverlay();
      }
    }
  );

  await overlayCycle(
    () => { window.iuTasksService.openOverlay(); },
    null,
    "#iuTasksOverlay",
    "tasks",
    () => { window.iuTasksService.closeOverlay(); }
  );

  await overlayCycle(
    async () => {
      if (typeof window.iuEnsureFinancialCalcOverlayBoot === "function") await window.iuEnsureFinancialCalcOverlayBoot();
      if (typeof window.iuEnsureOverlayCss === "function") await window.iuEnsureOverlayCss("iu-financial-overlay.css");
      if (typeof window.iuFinancialCalcOpenSurface === "function") window.iuFinancialCalcOpenSurface();
    },
    "#iuFinancialCalcClose",
    "#iuFinancialCalcPanel",
    "financial"
  );

  await overlayCycle(
    async () => {
      if (typeof window.iuEnsureLegalDocsOverlayBoot === "function") await window.iuEnsureLegalDocsOverlayBoot();
      if (typeof window.iuEnsureOverlayCss === "function") await window.iuEnsureOverlayCss("iu-legal-documents-overlay.css");
      if (typeof window.iuLegalDocsOpenSurface === "function") window.iuLegalDocsOpenSurface();
    },
    "#iuLegalDocsClose",
    "#iuLegalDocsPanel",
    "legal"
  );

  await overlayCycle(
    async () => {
      if (typeof window.iuEnsureInvoiceOverlayBoot === "function") await window.iuEnsureInvoiceOverlayBoot();
      if (typeof window.iuEnsureOverlayCss === "function") await window.iuEnsureOverlayCss("iu-invoice-overlay.css");
      if (typeof window.iuInvoiceOpenSurface === "function") window.iuInvoiceOpenSurface();
    },
    "#iuInvoiceClose",
    "#iuInvoicePanel",
    "invoice"
  );

  await overlayCycle(
    () => { if (typeof window.iuParcelsOpenSurface === "function") window.iuParcelsOpenSurface(); },
    "#iuParcelsPopover .iu-parcels-modal-close",
    "#iuParcelsPopover",
    "parcel"
  );

  await page.goto(baseUrl, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const regression = await page.evaluate(() => {
    function state(id) {
      const el = document.getElementById(id);
      if (!el) return "MISSING";
      const st = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const vis = !el.hidden && st.display !== "none" && st.visibility !== "hidden" && r.width > 0 && r.height > 0;
      return vis ? "VISIBLE" : "PRESENT_HIDDEN";
    }
    return {
      info_center_template: !!document.getElementById("iuTopbarInfoOverlayTpl"),
      section_view_templates: ["jr", "tvprogram", "travel", "mapy", "radio", "tvonline"].filter((k) => !!document.getElementById("iuLazyViewTpl-" + k)).length,
      silver_stack: state("iuSilverTopCardsStack"),
      weather_card: state("iuSilverWeatherCard"),
      finance_card: state("iuSilverFinanceHomeCard"),
      parcel_card: state("iuSilverParcelWatch"),
      articles_feed: (document.getElementById("feed") || { children: { length: 0 } }).children.length,
      mind_menu: state("iuMindMenuView"),
      bottom_nav: state("iuMobileBottomNav"),
      consent_layer: document.getElementById("iuConsentLayer") ? "PRESENT" : "MISSING",
    };
  });

  checks.regression_info_center = regression.info_center_template;
  checks.regression_section_views = regression.section_view_templates === 6;
  checks.regression_silver = regression.silver_stack !== "MISSING";
  checks.regression_weather = regression.weather_card !== "MISSING";
  checks.regression_finance = regression.finance_card !== "MISSING";
  checks.regression_parcelwatch = regression.parcel_card !== "MISSING";
  checks.regression_articles = regression.articles_feed > 0;
  checks.regression_menu = regression.mind_menu !== "MISSING";
  checks.regression_bottom_nav = regression.bottom_nav !== "MISSING";
  checks.regression_consent = regression.consent_layer === "PRESENT";
  checks.console_errors_zero = consoleErrors.length === 0;
  checks.page_errors_zero = pageErrors.length === 0;

  await context.close();
  const failed = Object.entries(checks).filter(([, v]) => v !== true).map(([k]) => k);
  return {
    viewport: vp.name,
    size: `${vp.width}x${vp.height}`,
    pass: failed.length === 0,
    failedChecks: failed,
    checks,
    loadMetrics,
    regression,
    consoleErrors,
    pageErrors,
  };
}

async function main() {
  let server = null;
  let baseUrl = EXTERNAL_URL;
  if (!baseUrl) {
    server = await startServer();
    baseUrl = `http://127.0.0.1:${PORT}/projects/`;
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const vp of VIEWPORTS) {
    process.stderr.write(`[guard] ${vp.name}...\n`);
    try {
      results.push(await runViewport(browser, vp, baseUrl));
    } catch (e) {
      results.push({ viewport: vp.name, pass: false, error: String(e.message || e).slice(0, 400) });
    }
  }
  await browser.close();
  if (server) server.close();

  const allPass = results.every((r) => r.pass);
  const out = {
    guard: "OVERLAY_CSS_DEFER_GUARD",
    targetUrl: baseUrl,
    finishedAt: new Date().toISOString(),
    result: allPass ? "PASS" : "FAIL",
    viewports: results,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("GUARD_FAILED", e);
  process.exit(2);
});
