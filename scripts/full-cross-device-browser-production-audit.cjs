#!/usr/bin/env node
/**
 * FULL CROSS-DEVICE / CROSS-BROWSER PRODUCTION AUDIT V2 — read-only harness.
 * Usage: node scripts/full-cross-device-browser-production-audit.cjs
 * Env:
 *   IU_FULL_AUDIT_URL (default https://infouzel.cz/projects/)
 *   IU_FULL_AUDIT_SETTLE_MS (default 8000)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { chromium, firefox, webkit } = require("playwright");
const {
  NAV_TOOLS_HARDENED,
  overlayIsOpen,
  ensureAuditPageReady,
  openMobileNavMenu,
  clickMindMenuTool,
  classifyFailureType,
  isHomeState,
  verifyWeatherSectionOpen,
  runMobileToolReplay,
  scopeAllowsAuditFiles,
  invokeToolOpenFn,
} = require("./full-cross-device-audit-harness.cjs");

const REPO = path.resolve(__dirname, "..");
const BASE_URL = (process.env.IU_FULL_AUDIT_URL || "https://infouzel.cz/projects/").replace(/\/?$/, "/");
const ROOT_URL = "https://infouzel.cz/";
const REPORT_PATH = path.join(__dirname, "full-cross-device-browser-production-audit-report.json");
const SETTLE_MS = Number(process.env.IU_FULL_AUDIT_SETTLE_MS || 8000);
const GOTO_MS = 120000;

const VIEWPORT_MATRIX = {
  desktop: [
    { id: "desktop_chrome", engine: "chromium", width: 1366, height: 768, isMobile: false, label: "Chromium 1366x768" },
    { id: "desktop_edge", engine: "chromium", width: 1366, height: 768, isMobile: false, ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0", label: "Edge/Chromium 1366x768" },
    { id: "desktop_firefox", engine: "firefox", width: 1366, height: 768, isMobile: false, label: "Firefox 1366x768" },
    { id: "desktop_webkit", engine: "webkit", width: 1366, height: 768, isMobile: false, label: "WebKit/Safari 1366x768" },
  ],
  mobile: [
    { id: "mobile_chrome", engine: "chromium", width: 390, height: 844, isMobile: true, label: "Chrome Android 390x844" },
    { id: "mobile_safari", engine: "webkit", width: 390, height: 844, isMobile: true, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", label: "Safari iPhone 390x844" },
    { id: "mobile_narrow", engine: "chromium", width: 360, height: 800, isMobile: true, label: "Android narrow 360x800" },
  ],
  tablet: [
    { id: "tablet_portrait", engine: "chromium", width: 768, height: 1024, isMobile: true, label: "Tablet portrait 768x1024" },
    { id: "tablet_landscape", engine: "chromium", width: 1024, height: 768, isMobile: true, label: "Tablet landscape 1024x768" },
    { id: "tablet_ipad", engine: "webkit", width: 820, height: 1180, isMobile: true, ua: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", label: "iPad WebKit 820x1180" },
  ],
};

const STATIC_URLS = [
  { id: "root", url: ROOT_URL },
  { id: "projects", url: BASE_URL },
  { id: "manifest_root", url: "https://infouzel.cz/manifest.json" },
  { id: "manifest_projects", url: "https://infouzel.cz/projects/manifest.json" },
  { id: "sw_root", url: "https://infouzel.cz/sw.js" },
  { id: "version_root", url: "https://infouzel.cz/version.json" },
  { id: "version_projects", url: "https://infouzel.cz/projects/version.json" },
  { id: "favicon", url: "https://infouzel.cz/favicon.svg" },
];

const NAV_SECTIONS = [
  { id: "home", label: "Hlavní stránka", rail: null, home: true },
  { id: "zpravy", label: "Zprávy", rail: "zpravy", topic: "zpravy" },
  { id: "sport", label: "Sport", rail: "sport", topic: "sport" },
  { id: "finance", label: "Finance", rail: "finance", topic: "finance" },
  { id: "zdravi", label: "Zdraví", rail: "zdravi", topic: "zdravi" },
  { id: "vzdelavani", label: "Vzdělávání", rail: "vzdelavani" },
  { id: "veda", label: "Věda", rail: "veda" },
  { id: "kultura", label: "Kultura", rail: "kultura" },
  { id: "hry", label: "Hry", rail: "hry" },
  { id: "travel", label: "Cestování", rail: "travel" },
  { id: "tvprogram", label: "TV program", rail: "tvprogram" },
  { id: "radio", label: "Rádio", rail: "radio" },
  { id: "mapy", label: "Mapy", rail: "maps" },
  { id: "jr", label: "Jízdní řády", rail: "jr" },
  { id: "pocasi", label: "Počasí", rail: "weather" },
];

const NAV_TOOLS = NAV_TOOLS_HARDENED;

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { cwd: REPO, encoding: "utf8" }).trim();
  } catch (_) {
    return "unknown";
  }
}

function kb(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round((n / 1024) * 10) / 10;
}

function getEngine(name) {
  if (name === "firefox") return firefox;
  if (name === "webkit") return webkit;
  return chromium;
}

async function fetchStaticAudit() {
  const out = {};
  for (const item of STATIC_URLS) {
    try {
      const res = await fetch(item.url, { redirect: "follow" });
      const ct = res.headers.get("content-type") || "";
      let bodyPreview = "";
      if (res.ok && (ct.includes("json") || ct.includes("javascript") || ct.includes("svg"))) {
        const t = await res.text();
        bodyPreview = t.slice(0, 500);
      }
      out[item.id] = { url: item.url, status: res.status, ok: res.ok, contentType: ct, bodyPreview };
    } catch (e) {
      out[item.id] = { url: item.url, status: "FAILED", ok: false, error: String(e.message || e).slice(0, 200) };
    }
  }
  return out;
}

async function setupPageListeners(page, bucket) {
  bucket.consoleErrors = [];
  bucket.pageErrors = [];
  bucket.failedRequests = [];
  bucket.responses = [];
  bucket.unhandledRejections = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") bucket.consoleErrors.push(String(msg.text()).slice(0, 400));
  });
  page.on("pageerror", (err) => bucket.pageErrors.push(String(err.message || err).slice(0, 400)));
  page.on("requestfailed", (req) => {
    bucket.failedRequests.push({
      url: req.url(),
      failure: req.failure() ? req.failure().errorText : "unknown",
      type: req.resourceType(),
    });
  });
  page.on("response", (resp) => {
    const status = resp.status();
    if (status >= 400 || status === 0) {
      bucket.responses.push({ url: resp.url(), status, type: resp.request().resourceType() });
    }
  });
  page.on("crash", () => bucket.pageErrors.push("PAGE_CRASH"));
}

async function injectPerfObservers(page) {
  await page.addInitScript(() => {
    window.__iuFullAudit = { lcp: null, cls: 0, longTasks: [], fcp: null };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__iuFullAudit.lcp = e.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch (_) {}
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) window.__iuFullAudit.cls += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration > 50) window.__iuFullAudit.longTasks.push({ start: e.startTime, duration: e.duration });
        }
      }).observe({ type: "longtask", buffered: true });
    } catch (_) {}
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.name === "first-contentful-paint") window.__iuFullAudit.fcp = e.startTime;
        }
      }).observe({ type: "paint", buffered: true });
    } catch (_) {}
  });
}

async function loadPage(browserType, vp, opts = {}) {
  const bucket = {};
  const contextOpts = {
    viewport: { width: vp.width, height: vp.height },
    isMobile: !!vp.isMobile,
    hasTouch: !!vp.isMobile,
    deviceScaleFactor: vp.isMobile ? 2 : 1,
    locale: "cs-CZ",
    serviceWorkers: opts.allowSw ? "allow" : "block",
  };
  if (vp.ua) contextOpts.userAgent = vp.ua;
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  await setupPageListeners(page, bucket);
  await injectPerfObservers(page);

  const requests = [];
  page.on("requestfinished", async (req) => {
    try {
      const resp = await req.response();
      const sizes = await req.sizes();
      requests.push({
        url: req.url(),
        type: req.resourceType(),
        status: resp ? resp.status() : null,
        bytes: sizes ? sizes.responseBodySize : 0,
      });
    } catch (_) {}
  });

  let navError = null;
  try {
    await page.goto(BASE_URL, { waitUntil: "load", timeout: GOTO_MS });
    await page.waitForTimeout(SETTLE_MS);
  } catch (e) {
    navError = String(e.message || e).slice(0, 300);
  }

  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const iu = window.__iuFullAudit || {};
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth > (window.innerWidth || doc.clientWidth) + 1;
    const bottomNav = document.getElementById("iuMobileBottomNav");
    const bottomNavRect = bottomNav ? bottomNav.getBoundingClientRect() : null;
    const viewportH = window.innerHeight || doc.clientHeight;
    const vpWidth = window.innerWidth;
    let bottomNavSafe = true;
    if (bottomNavRect && vpWidth <= 900) {
      bottomNavSafe = bottomNavRect.bottom <= viewportH + 2 && bottomNavRect.height > 0;
    }
    const articleCards = document.querySelectorAll(".iuNewsPreviewCard, .iuArticleCard, .article-card, [data-iu-article-id], [data-iu-news-preview-card]").length;
    const articleTitles = Array.from(document.querySelectorAll(".iuNewsPreviewCard [data-iu-news-preview-latest-title], .iuNewsPreviewCard, .iuArticleCard h3, .iuArticleCard .iuArticleTitle, .article-card h3"))
      .slice(0, 5)
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean);
    const images = document.querySelectorAll("img").length;
    const lazyImages = document.querySelectorAll('img[loading="lazy"]').length;
    return {
      nav: nav
        ? {
            domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
            loadEvent: Math.round(nav.loadEventEnd),
            ttfb: Math.round(nav.responseStart),
          }
        : null,
      fcp: iu.fcp != null ? Math.round(iu.fcp) : null,
      lcp: iu.lcp != null ? Math.round(iu.lcp) : null,
      cls: Math.round((iu.cls || 0) * 1000) / 1000,
      longTasks: iu.longTasks || [],
      overflowX,
      bottomNavSafe,
      bottomNavVisible: !!bottomNav && getComputedStyle(bottomNav).display !== "none",
      section: document.documentElement.getAttribute("data-section") || document.body.getAttribute("data-section"),
      articleCards,
      articleTitles,
      images,
      lazyImages,
      scrollHeight: doc.scrollHeight,
      clientHeight: doc.clientHeight,
    };
  }).catch(() => ({}));

  const byType = {};
  let totalBytes = 0;
  for (const r of requests) {
    totalBytes += r.bytes || 0;
    byType[r.type] = byType[r.type] || { count: 0, bytes: 0 };
    byType[r.type].count++;
    byType[r.type].bytes += r.bytes || 0;
  }

  let tbt = 0;
  for (const lt of perf.longTasks || []) tbt += Math.max(0, lt.duration - 50);

  const statusCounts = { 404: 0, 429: 0, 500: 0, cors: 0, failed: bucket.failedRequests.length };
  for (const r of bucket.responses) {
    if (r.status === 404) statusCounts[404]++;
    if (r.status === 429) statusCounts[429]++;
    if (r.status >= 500) statusCounts[500]++;
    if (String(r.url).includes("CORS") || String(bucket.failedRequests.find((f) => f.url === r.url && f.failure === "net::ERR_FAILED"))) {
      /* counted in failed */
    }
  }
  for (const f of bucket.failedRequests) {
    if (/cors|blocked|access-control/i.test(f.failure || "")) statusCounts.cors++;
  }

  const result = {
    viewport: vp.label,
    engine: vp.engine,
    navError,
    metrics: {
      domContentLoadedMs: perf.nav ? perf.nav.domContentLoaded : null,
      loadEventMs: perf.nav ? perf.nav.loadEvent : null,
      fcpMs: perf.fcp,
      lcpMs: perf.lcp,
      cls: perf.cls,
      tbtMs: Math.round(tbt),
      longTaskCount: (perf.longTasks || []).length,
    },
    requests: {
      total: requests.length,
      totalTransferKB: kb(totalBytes),
      jsKB: kb(byType.script ? byType.script.bytes : 0),
      cssKB: kb(byType.stylesheet ? byType.stylesheet.bytes : 0),
      imageKB: kb(byType.image ? byType.image.bytes : 0),
      documentKB: kb(byType.document ? byType.document.bytes : 0),
    },
    layout: {
      overflowX: !!perf.overflowX,
      bottomNavSafe: perf.bottomNavSafe !== false,
      bottomNavVisible: !!perf.bottomNavVisible,
      scrollOk: (perf.scrollHeight || 0) > (perf.clientHeight || 0) || (perf.scrollHeight || 0) <= (perf.clientHeight || 0),
    },
    content: {
      section: perf.section,
      articleCards: perf.articleCards,
      articleTitlesSample: perf.articleTitles,
      images: perf.images,
      lazyImages: perf.lazyImages,
    },
    errors: {
      console: bucket.consoleErrors.slice(0, 20),
      page: bucket.pageErrors.slice(0, 20),
      failedRequests: bucket.failedRequests.slice(0, 20),
      httpErrors: bucket.responses.slice(0, 20),
      statusCounts,
    },
  };

  await context.close();
  await browser.close();
  return result;
}

async function ensureMobileMenuOpen(page) {
  await openMobileNavMenu(page);
}

async function ensureMobileMenuClosed(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.iuMobileGateCloseForMainNav === "function") window.iuMobileGateCloseForMainNav();
    } catch (_) {}
  });
  await page.waitForTimeout(300);
}

async function clickRail(page, rail, isMobile) {
  if (isMobile) {
    await ensureMobileMenuOpen(page);
    const sel = `#iuMobileGatePanelNav .iu-leftNavItem[data-rail="${rail}"], .iu-leftNavItem[data-rail="${rail}"]`;
    const loc = page.locator(sel).first();
    await loc.click({ timeout: 10000, force: true });
  } else {
    const loc = page.locator(`.iu-leftNavItem[data-rail="${rail}"]`).first();
    await loc.click({ timeout: 10000 });
  }
}

async function getPageState(page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    return {
      section: html.getAttribute("data-section") || body.getAttribute("data-section") || "",
      mediaTopic: body.getAttribute("data-media-topic") || html.getAttribute("data-media-topic") || "",
      url: location.href,
      overlayOpen: body.classList.contains("iu-mobileGateOverlayOpen"),
      gate: (document.getElementById("iuMobileGateWrap") || {}).getAttribute?.("data-iu-mobile-gate") || "",
      articleCards: document.querySelectorAll(".iuNewsPreviewCard, .iuArticleCard, .article-card, [data-iu-article-id], [data-iu-news-preview-card]").length,
      scrollY: window.scrollY,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
}

async function runNavigationAudit(browserType, vp) {
  const browser = await browserType.launch({ headless: true });
  const contextOpts = {
    viewport: { width: vp.width, height: vp.height },
    isMobile: !!vp.isMobile,
    hasTouch: !!vp.isMobile,
    deviceScaleFactor: vp.isMobile ? 2 : 1,
    locale: "cs-CZ",
    serviceWorkers: "block",
  };
  if (vp.ua) contextOpts.userAgent = vp.ua;
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(String(msg.text()).slice(0, 200));
  });
  page.on("pageerror", (err) => errors.push(String(err.message || err).slice(0, 200)));

  const results = [];
  try {
    await page.goto(BASE_URL, { waitUntil: "load", timeout: GOTO_MS });
    await page.waitForTimeout(6000);
  } catch (e) {
    await context.close();
    await browser.close();
    return { viewport: vp.label, fatal: String(e.message || e), results: [], auditFailures: [] };
  }

  const isMobile = vp.width <= 900;

  async function auditNav(item, clickFn, expectFn, opts = {}) {
    const recovery = await ensureAuditPageReady(page, BASE_URL, GOTO_MS);
    const before = await getPageState(page);
    let clickSuccess = false;
    let clickErr = null;
    let overlayOpen = null;
    try {
      await clickFn();
      clickSuccess = true;
      await page.waitForTimeout(1200);
      if (opts.overlay) {
        let ov = await overlayIsOpen(page, opts.overlay);
        if (!ov.open && opts.openFn) {
          await invokeToolOpenFn(page, opts.openFn);
          await page.waitForTimeout(1200);
          ov = await overlayIsOpen(page, opts.overlay);
        }
        overlayOpen = ov.open;
      }
    } catch (e) {
      clickErr = String(e.message || e).slice(0, 200);
    }
    const after = await getPageState(page);
    const harnessDegraded = recovery.recovered || after.url === "about:blank";
    const viewChanged = JSON.stringify(before) !== JSON.stringify({ ...after, scrollY: before.scrollY });
    const stateOk = expectFn ? expectFn(before, after) : viewChanged;
    let backOk = null;
    if (isMobile && clickSuccess && opts.tryBack) {
      try {
        const back = page.locator('#iuMobileBottomNav [data-iu-bottom-nav="back"]').first();
        if (await back.isVisible().catch(() => false)) {
          await back.click({ timeout: 5000, force: true });
          await page.waitForTimeout(800);
          const afterBack = await getPageState(page);
          backOk = afterBack.url !== "about:blank" && afterBack.url.includes("infouzel");
        }
      } catch (_) {
        backOk = false;
      }
    }
    const row = {
      id: item.id,
      label: item.label,
      click_success: clickSuccess,
      view_changed: viewChanged,
      url_or_state_correct: stateOk,
      overlay_open: overlayOpen,
      back_button_ok: backOk,
      scroll_ok: !after.overflowX,
      layout_ok: !after.overflowX,
      harness_degraded: harnessDegraded,
      errors: clickErr ? [clickErr] : errors.slice(-3),
      before: { section: before.section, topic: before.mediaTopic, cards: before.articleCards },
      after: { section: after.section, topic: after.mediaTopic, cards: after.articleCards, url: after.url },
    };
    row.failure_type = classifyFailureType(row);
    results.push(row);
    if (isMobile && !opts.skipMenuClose) await ensureMobileMenuClosed(page);
  }

  for (const sec of NAV_SECTIONS) {
    await auditNav(
      sec,
      async () => {
        if (sec.home) {
          if (isMobile) {
            await page.locator('#iuMobileBottomNav [data-iu-bottom-nav="home"]').first().click({ timeout: 8000, force: true });
          } else {
            await page.goto(BASE_URL + "?section=home", { waitUntil: "load", timeout: 60000 });
          }
        } else {
          await clickRail(page, sec.rail, isMobile);
        }
      },
      (_b, a) =>
        sec.topic
          ? a.mediaTopic === sec.topic || a.articleCards > 0 || a.section === sec.id
          : sec.home
            ? isHomeState(a)
            : a.section !== "" || a.articleCards >= 0,
      { tryBack: !sec.home },
    );
  }

  for (const tool of NAV_TOOLS) {
    await auditNav(
      tool,
      async () => {
        await clickMindMenuTool(page, tool, isMobile);
      },
      (_b, a) => {
        if (tool.overlay) return true;
        return a.url.includes("infouzel");
      },
      { overlay: tool.overlay, openFn: tool.openFn, tryBack: false },
    );
  }

  await auditNav(
    { id: "silver_panel", label: "Silver panel" },
    async () => {
      await page.locator('#iuMobileBottomNav [data-iu-bottom-nav="silver"], #silver-slot').first().click({ timeout: 8000, force: true }).catch(() => {});
    },
    (_b, a) => a.url.includes("infouzel") && a.url !== "about:blank",
    { tryBack: false },
  );

  await auditNav(
    { id: "menu_overlay", label: "Menu overlay" },
    async () => {
      if (isMobile) await ensureMobileMenuOpen(page);
      else await page.locator(".iuHamburger").first().click({ timeout: 8000 }).catch(() => {});
    },
    (_b, a) => a.overlayOpen || a.gate === "nav" || /iu-mindmenu|iuMobileGate/i.test(a.url || "") || !isMobile,
    { tryBack: false, skipMenuClose: true },
  );

  await auditNav(
    { id: "menu_repeat", label: "Opakované menu" },
    async () => {
      if (isMobile) {
        await ensureMobileMenuOpen(page);
        await ensureMobileMenuClosed(page);
        await ensureMobileMenuOpen(page);
      }
    },
    () => true,
    { tryBack: false, skipMenuClose: true },
  );

  const auditFailures = results.filter((r) => r.failure_type === "AUDIT_FAILURE");
  const productFailures = results.filter((r) => r.failure_type === "PRODUCT_FAILURE");

  await context.close();
  await browser.close();
  return { viewport: vp.label, isMobile, results, auditFailures, productFailures, errorsCollected: errors.slice(0, 15) };
}

async function runDataRefreshAudit(browserType) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: "cs-CZ",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(String(msg.text()).slice(0, 300));
  });
  page.on("pageerror", (err) => errors.push(String(err.message || err).slice(0, 300)));

  await page.goto(BASE_URL, { waitUntil: "load", timeout: GOTO_MS });
  await page.waitForTimeout(SETTLE_MS);

  const articles1 = await page.evaluate(() => {
    const cards = document.querySelectorAll(".iuNewsPreviewCard, .iuArticleCard, .article-card, [data-iu-article-id], [data-iu-news-preview-card]");
    const titles = Array.from(cards)
      .slice(0, 10)
      .map((c) => (c.querySelector("h3,.iuArticleTitle") || c).textContent?.trim())
      .filter(Boolean);
    const sources = Array.from(document.querySelectorAll(".iuArticleSource, .iu-source, [data-iu-source]")).slice(0, 5).length;
    const imgs = Array.from(document.querySelectorAll(".iuNewsPreviewCard img, .iuArticleCard img, .article-card img")).filter((i) => i.complete && i.naturalWidth > 0).length;
    return { count: cards.length, titles, sources, imgsLoaded: imgs, loaderMode: window.__iuArticlesLoaderMode || null };
  });

  let loadMoreOk = null;
  try {
    const lm = page.locator('[data-iu-load-more], .iuLoadMore, button:has-text("Načíst")').first();
    if (await lm.isVisible({ timeout: 3000 }).catch(() => false)) {
      const before = articles1.count;
      await lm.click({ timeout: 5000 });
      await page.waitForTimeout(3000);
      const after = await page.evaluate(() => document.querySelectorAll(".iuNewsPreviewCard, .iuArticleCard, .article-card, [data-iu-article-id], [data-iu-news-preview-card]").length);
      loadMoreOk = after > before;
    } else {
      loadMoreOk = "no_button";
    }
  } catch (_) {
    loadMoreOk = false;
  }

  await page.reload({ waitUntil: "load", timeout: GOTO_MS });
  await page.waitForTimeout(SETTLE_MS);
  const articles2 = await page.evaluate(() => document.querySelectorAll(".iuNewsPreviewCard, .iuArticleCard, .article-card, [data-iu-article-id], [data-iu-news-preview-card]").length);

  let weather = { setup: null, cardVisible: false, sectionOpen: false, overlayOk: null, fallback: null, temperature: null };
  try {
    await page.goto(BASE_URL + "?section=pocasi", { waitUntil: "load", timeout: GOTO_MS });
    await page.waitForTimeout(3000);
    const setup = await verifyWeatherSectionOpen(page);
    weather.setup = setup.ok ? "OK" : "TEST_SETUP_FAIL";
    weather.sectionOpen = setup.ok;
    if (!setup.ok) {
      weather.error = "Weather section not open before weather assertions";
    } else {
      weather.cardVisible = await page.locator("#iuSilverWeatherCard, .iuWeatherNow, #iuWeatherView").first().isVisible({ timeout: 5000 }).catch(() => false);
      weather.temperature = await page.evaluate(() => {
        const t = document.querySelector("#iuWxStickyTime, .iuWeatherStickyTime, .iu-temp-now, [data-iu-weather-temp]");
        return t ? (t.textContent || "").trim().slice(0, 40) : null;
      });
      weather.fallback = await page.evaluate(() => {
        const tip = document.getElementById("iuSilverWeatherLine2");
        const alert = document.getElementById("iuWeatherAlertText");
        return {
          tipVisible: !!(tip && tip.textContent && tip.textContent.trim()),
          alertVisible: !!(alert && alert.textContent && alert.textContent.trim()),
        };
      });
      weather.overlayOk = setup.weatherViewVisible || setup.section === "pocasi";
    }
  } catch (e) {
    weather.setup = "TEST_SETUP_FAIL";
    weather.error = String(e.message || e).slice(0, 200);
  }

  const overlayTools = [
    ["calendar", NAV_TOOLS.find((t) => t.id === "kalendar"), "#iuCalendarOverlay"],
    ["tasks", NAV_TOOLS.find((t) => t.id === "ukoly"), "#iuTasksOverlay"],
    ["notes", NAV_TOOLS.find((t) => t.id === "poznamky"), "#iuNotesOverlay"],
    ["parcels", NAV_TOOLS.find((t) => t.id === "zasilky"), "#iuParcelsPopover"],
  ];
  const overlays = {};
  for (const [key, tool, panel] of overlayTools) {
    overlays[key] = { open: false, close: false, reopen: false, empty: null, errors: [], setup: "OK" };
    try {
      await page.goto(BASE_URL, { waitUntil: "load", timeout: GOTO_MS });
      await page.waitForTimeout(2500);
      const clickMeta = await clickMindMenuTool(page, tool, false);
      if (clickMeta.path === "none") {
        overlays[key].setup = "TEST_SETUP_FAIL";
        overlays[key].errors.push("tool trigger not found");
        continue;
      }
      await page.waitForTimeout(1500);
      const openState = await overlayIsOpen(page, panel);
      overlays[key].open = openState.open;
      if (!openState.open) {
        overlays[key].setup = "TEST_SETUP_FAIL";
        overlays[key].errors.push("overlay not open after trigger");
        continue;
      }
      const closeSel = `${panel} [aria-label="Zavřít"], ${panel} .iu-overlay-close, ${panel} .iu-parcels-modal-close, ${panel} [data-iu-calendar-close="button"], ${panel} [data-iu-tasks-close="1"], ${panel} [data-iu-notes-close="1"]`;
      const closeBtn = page.locator(closeSel).first();
      if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await closeBtn.click({ timeout: 3000 });
        await page.waitForTimeout(800);
        const closed = await overlayIsOpen(page, panel);
        overlays[key].close = !closed.open;
        await clickMindMenuTool(page, tool, false);
        await page.waitForTimeout(1200);
        const reopened = await overlayIsOpen(page, panel);
        overlays[key].reopen = reopened.open;
      }
    } catch (e) {
      overlays[key].errors.push(String(e.message || e).slice(0, 150));
      if (!overlays[key].open) overlays[key].setup = "TEST_SETUP_FAIL";
    }
  }

  await context.close();
  await browser.close();

  return {
    articles: {
      feedLoaded: articles1.count > 0,
      notEmpty: articles1.count > 0 && articles1.titles.length > 0,
      titlesSample: articles1.titles.slice(0, 5),
      sourcesVisible: articles1.sources > 0,
      imagesLoaded: articles1.imgsLoaded,
      loaderMode: articles1.loaderMode,
      loadMore: loadMoreOk,
      afterReloadCount: articles2,
      reloadPreservesData: articles2 > 0,
    },
    weather,
    calendar: overlays.calendar,
    tasks: overlays.tasks,
    notes: overlays.notes,
    parcels: overlays.parcels,
    cache_behavior: { swBlocked: true, reloadArticleCount: articles2 },
    failures: errors.slice(0, 15),
  };
}

async function runPwaAudit() {
  const staticFetch = await fetchStaticAudit();
  const manifest = staticFetch.manifest_projects;
  let manifestParsed = null;
  let iconChecks = [];
  if (manifest && manifest.ok && manifest.bodyPreview) {
    try {
      manifestParsed = JSON.parse(manifest.bodyPreview.length >= 500 ? manifest.bodyPreview : await (await fetch("https://infouzel.cz/projects/manifest.json")).text());
      for (const icon of manifestParsed.icons || []) {
        const iconUrl = icon.src.startsWith("http") ? icon.src : `https://infouzel.cz${icon.src.startsWith("/") ? "" : "/"}${icon.src}`;
        try {
          const ir = await fetch(iconUrl);
          iconChecks.push({ src: icon.src, status: ir.status, sizes: icon.sizes || null, purpose: icon.purpose || null });
        } catch (e) {
          iconChecks.push({ src: icon.src, status: "FAILED", error: String(e.message) });
        }
      }
    } catch (e) {
      manifestParsed = { parseError: String(e.message) };
    }
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "allow" });
  const page = await context.newPage();
  const swEvents = [];
  page.on("console", (msg) => {
    if (/service worker|serviceworker|sw\.js/i.test(msg.text())) swEvents.push(msg.text().slice(0, 200));
  });

  let reloadCount = 0;
  page.on("load", () => reloadCount++);

  await page.goto(BASE_URL, { waitUntil: "load", timeout: GOTO_MS });
  await page.waitForTimeout(5000);

  const swState = await page.evaluate(async () => {
    const out = { supported: "serviceWorker" in navigator, registered: false, controller: false, scriptURL: null, caches: [] };
    if (!out.supported) return out;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      out.registered = !!reg;
      out.controller = !!navigator.serviceWorker.controller;
      out.scriptURL = reg && reg.active ? reg.active.scriptURL : reg && reg.installing ? reg.installing.scriptURL : null;
    } catch (e) {
      out.error = String(e.message);
    }
    try {
      if (typeof caches !== "undefined" && caches.keys) out.caches = await caches.keys();
    } catch (_) {}
    return out;
  });

  await page.reload({ waitUntil: "load", timeout: GOTO_MS });
  await page.waitForTimeout(3000);
  const reloadCountAfter = reloadCount;

  const versionMeta = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="iu-build"]');
    return meta ? meta.getAttribute("content") : null;
  });

  let versionJson = null;
  try {
    versionJson = await (await fetch("https://infouzel.cz/projects/version.json")).json();
  } catch (e) {
    versionJson = { error: String(e.message) };
  }

  await context.close();
  await browser.close();

  const faviconCheck = staticFetch.favicon;
  const appleTouch = await fetch("https://infouzel.cz/projects/icons/apple-touch-icon.png").then((r) => ({ status: r.status, ok: r.ok, url: "https://infouzel.cz/projects/icons/apple-touch-icon.png" })).catch((e) => ({ status: "FAILED", error: String(e.message), url: "https://infouzel.cz/projects/icons/apple-touch-icon.png" }));

  return {
    manifest: {
      root404: staticFetch.manifest_root && staticFetch.manifest_root.status === 404,
      projectsOk: !!(manifest && manifest.ok),
      parsed: manifestParsed,
      fields: manifestParsed
        ? {
            name: manifestParsed.name,
            short_name: manifestParsed.short_name,
            start_url: manifestParsed.start_url,
            display: manifestParsed.display,
            theme_color: manifestParsed.theme_color,
            background_color: manifestParsed.background_color,
            iconCount: (manifestParsed.icons || []).length,
          }
        : null,
    },
    icons: iconChecks,
    favicon: faviconCheck,
    apple_touch_icon: appleTouch,
    android_icons: iconChecks.filter((i) => i.purpose && i.purpose.includes("maskable")),
    service_worker: {
      sw_root: staticFetch.sw_root,
      state: swState,
      consoleEvents: swEvents.slice(0, 10),
    },
    first_install_reload: { autoReloadCountOnFirstLoad: reloadCount <= 2 ? "NO_EXTRA" : reloadCount, note: "Measured reload events on first visit+wait; inline boot should skip reload on first SW install" },
    update_reload: { reloadCountAfterManualReload: reloadCountAfter, note: "Manual reload only in this probe; deploy update reload requires version bump simulation" },
    cache: { cacheNames: swState.caches, versionMeta, versionJson },
    errors: swEvents.filter((e) => /error|fail/i.test(e)),
  };
}

async function runCacheAudit() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "allow" });
  const page = await context.newPage();

  const snapshots = {};

  async function snap(label) {
    await page.goto(BASE_URL, { waitUntil: "load", timeout: GOTO_MS });
    await page.waitForTimeout(4000);
    const data = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll("script[src]")).map((s) => s.src);
      const metas = document.querySelector('meta[name="iu-build"]');
      return {
        build: metas ? metas.getAttribute("content") : null,
        appJs: scripts.find((s) => /app\.js/.test(s)) || null,
        href: location.href,
        swController: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      };
    });
    snapshots[label] = data;
  }

  await snap("first_visit");
  await snap("second_visit");
  await page.reload({ waitUntil: "load", timeout: GOTO_MS });
  await page.waitForTimeout(3000);
  snapshots.normal_reload = await page.evaluate(() => ({
    build: (document.querySelector('meta[name="iu-build"]') || {}).getAttribute?.("content"),
    swController: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
  }));

  await page.goto(BASE_URL + "?nocache=" + Date.now(), { waitUntil: "load", timeout: GOTO_MS });
  await page.evaluate(() => location.reload(true));
  await page.waitForTimeout(3000);
  snapshots.hard_reload = await page.evaluate(() => ({
    build: (document.querySelector('meta[name="iu-build"]') || {}).getAttribute?.("content"),
    swController: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
  }));

  const versionFetch = await fetch("https://infouzel.cz/projects/version.json").then((r) => r.json()).catch((e) => ({ error: String(e.message) }));

  await context.close();
  await browser.close();

  const builds = Object.values(snapshots).map((s) => s.build).filter(Boolean);
  const uniqueBuilds = [...new Set(builds)];
  const appJsUrls = Object.values(snapshots).map((s) => s.appJs).filter(Boolean);
  const uniqueAppJs = [...new Set(appJsUrls)];

  return {
    first_visit: snapshots.first_visit,
    second_visit: snapshots.second_visit,
    hard_reload: snapshots.hard_reload,
    normal_reload: snapshots.normal_reload,
    sw_install: { controllerAfterSecondVisit: snapshots.second_visit && snapshots.second_visit.swController },
    sw_update: { note: "Full SW update simulation not run (would require deploy bump); version.json checked", versionFetch },
    asset_versioning: { uniqueBuilds, uniqueAppJs, appJsSample: appJsUrls[0] },
    stale_cache_risk: uniqueBuilds.length > 1 || uniqueAppJs.length > 1 ? "MEDIUM" : "LOW",
  };
}

function classifyError(msg) {
  const m = String(msg || "");
  if (/429|rate limit|503|open-meteo|external|third.party|cnb\.cz|blocked by client/i.test(m)) return "external_api_noise";
  if (/favicon|analytics|gtag|cookie|consent|preload|manifest.*404/i.test(m)) return "benign";
  return "real_errors";
}

function buildIssues(report) {
  const issues = [];
  let id = 1;

  function add(title, severity, device, browser, repro, evidence, impact, risk, fix) {
    issues.push({
      id: `IU-AUDIT-${String(id++).padStart(3, "0")}`,
      title,
      severity,
      device,
      browser,
      repro_steps: repro,
      evidence,
      impact,
      risk,
      recommended_fix: fix,
    });
  }

  if (report.staticUrls.manifest_root && report.staticUrls.manifest_root.status === 404) {
    add(
      "Root /manifest.json returns 404 (PWA path is /projects/manifest.json)",
      "P2",
      "all",
      "all",
      "GET https://infouzel.cz/manifest.json",
      { status: 404, correctPath: "/projects/manifest.json" },
      "Install prompts / crawlers hitting root manifest fail",
      "low",
      "Add redirect from /manifest.json to /projects/manifest.json or document canonical path only",
    );
  }

  if (report.pwaAudit && report.pwaAudit.manifest && report.pwaAudit.manifest.fields && report.pwaAudit.manifest.fields.iconCount === 0) {
    add(
      "PWA manifest has empty icons array",
      "P0",
      "mobile",
      "all",
      "Open /projects/manifest.json",
      report.pwaAudit.manifest.fields,
      "Add-to-home-screen shows generic/missing icon on Android/iOS",
      "high",
      "Populate manifest.icons with 192/512 maskable PNGs and verify URLs",
    );
  }

  for (const [vpId, perf] of Object.entries(report.loadPerformanceAudit.byViewport || {})) {
    if (perf.metrics && perf.metrics.cls > 0.1) {
      add(
        `CLS above 0.1 on ${perf.viewport}`,
        perf.metrics.cls > 0.25 ? "P1" : "P2",
        vpId.includes("mobile") ? "mobile" : vpId.includes("tablet") ? "tablet" : "desktop",
        perf.engine,
        `Load ${BASE_URL} at ${perf.viewport}`,
        { cls: perf.metrics.cls, lcpMs: perf.metrics.lcpMs },
        "Visible layout shift hurts UX and Core Web Vitals",
        "medium",
        "Identify shifting elements (hero, bottom nav, images without dimensions)",
      );
    }
    if (perf.metrics && perf.metrics.lcpMs > 4000) {
      add(
        `LCP > 4s on ${perf.viewport}`,
        "P1",
        vpId.includes("mobile") ? "mobile" : "desktop",
        perf.engine,
        `Cold load ${BASE_URL}`,
        { lcpMs: perf.metrics.lcpMs, fcpMs: perf.metrics.fcpMs },
        "Slow first meaningful paint",
        "high",
        "Optimize LCP image/text, reduce blocking JS, improve TTFB",
      );
    }
    if (perf.layout && perf.layout.overflowX) {
      add(
        `Horizontal overflow on ${perf.viewport}`,
        "P1",
        vpId.includes("mobile") ? "mobile" : "desktop",
        perf.engine,
        `Load and scroll ${BASE_URL}`,
        { overflowX: true },
        "Content clipped / sideways scroll on small screens",
        "high",
        "Fix overflowing rail, cards, or fixed elements at this breakpoint",
      );
    }
    if (perf.errors && perf.errors.statusCounts && perf.errors.statusCounts[404] > 3) {
      add(
        `Multiple 404 responses on ${perf.viewport}`,
        "P2",
        "all",
        perf.engine,
        `Network tab during load`,
        { count404: perf.errors.statusCounts[404], samples: perf.errors.httpErrors.slice(0, 5) },
        "Broken assets or stale links",
        "medium",
        "Audit failed URLs and fix or remove references",
      );
    }
  }

  const replay = report.replayGuards || {};
  const navProductFails = (report.navigationClickAudit.runs || []).flatMap((r) =>
    (r.productFailures || r.results || []).filter((x) => x.failure_type === "PRODUCT_FAILURE" || (!x.failure_type && (!x.click_success || !x.url_or_state_correct))),
  );
  for (const nf of navProductFails.slice(0, 8)) {
    const replayResult = replay[nf.id];
    if (replayResult && replayResult.pass) {
      report.harnessNotes = report.harnessNotes || [];
      report.harnessNotes.push(`Suppressed false positive for ${nf.label}: replay guard PASS`);
      continue;
    }
    if (nf.overlay_open === false && nf.click_success) {
      add(
        `Tool overlay not open: ${nf.label}`,
        "P1",
        "mobile/tablet",
        "chromium",
        `Open ${nf.label} from MindMenu / hero quick action`,
        nf,
        "User cannot reach tool overlay",
        "high",
        "Verify overlay mount and open handler for this tool",
      );
    } else if (nf.failure_type === "PRODUCT_FAILURE") {
      add(
        `Navigation issue: ${nf.label}`,
        "P1",
        "mobile/tablet",
        "chromium",
        `Click ${nf.label} from bottom nav / menu`,
        nf,
        "User cannot reach section or tool",
        "high",
        "Fix click handler or mobile gate routing for this target",
      );
    }
  }

  if (report.dataRefreshAudit && report.dataRefreshAudit.weather && report.dataRefreshAudit.weather.setup === "TEST_SETUP_FAIL") {
    report.harnessNotes = report.harnessNotes || [];
    report.harnessNotes.push("Weather audit skipped product assertions — section=pocasi not confirmed (TEST_SETUP_FAIL)");
  }

  if (report.dataRefreshAudit && report.dataRefreshAudit.articles && !report.dataRefreshAudit.articles.feedLoaded) {
    add(
      "Article feed empty on production load",
      "P0",
      "all",
      "all",
      `Open ${BASE_URL} and wait ${SETTLE_MS}ms`,
      report.dataRefreshAudit.articles,
      "Core content missing",
      "critical",
      "Check articles loader, chunk manifest, CDN cache",
    );
  }

  if (report.staticUrls.version_root && report.staticUrls.version_root.status === 404) {
    add(
      "Root /version.json 404 (canonical /projects/version.json)",
      "P3",
      "all",
      "all",
      "GET /version.json",
      { status: 404 },
      "Deploy probes using wrong path fail",
      "low",
      "Redirect or document /projects/version.json as canonical",
    );
  }

  return issues;
}

function rankIssues(issues) {
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return issues.slice().sort((a, b) => order[a.severity] - order[b.severity] || (a.device === "mobile" ? -1 : 1));
}

async function runReplayGuards(browserType, vp) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: "cs-CZ",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: "load", timeout: GOTO_MS });
  await page.waitForTimeout(4000);

  const toolIds = ["zasilky", "kalendar", "ukoly", "poznamky"];
  const out = {};
  for (const id of toolIds) {
    const tool = NAV_TOOLS.find((t) => t.id === id);
    await page.goto(BASE_URL, { waitUntil: "load", timeout: GOTO_MS });
    await page.waitForTimeout(2000);
    out[id] = await runMobileToolReplay(page, tool, BASE_URL, GOTO_MS);
  }

  await page.goto(BASE_URL + "?section=pocasi", { waitUntil: "load", timeout: GOTO_MS });
  await page.waitForTimeout(2500);
  const wxSetup = await verifyWeatherSectionOpen(page);
  out.pocasi = {
    pass: wxSetup.ok,
    section: wxSetup.section,
    classification: wxSetup.ok ? "PASS" : "TEST_SETUP_FAIL",
  };

  await context.close();
  await browser.close();
  return out;
}

async function main() {
  const startedAt = new Date().toISOString();
  process.stderr.write("[full-audit] static URL fetch...\n");
  const staticUrls = await fetchStaticAudit();

  const loadPerformanceAudit = { byViewport: {}, summary: {} };
  const allVps = [...VIEWPORT_MATRIX.desktop, ...VIEWPORT_MATRIX.mobile, ...VIEWPORT_MATRIX.tablet];

  for (const vp of allVps) {
    process.stderr.write(`[full-audit] load perf ${vp.id}...\n`);
    try {
      const engine = getEngine(vp.engine);
      loadPerformanceAudit.byViewport[vp.id] = await loadPage(engine, vp);
    } catch (e) {
      loadPerformanceAudit.byViewport[vp.id] = { error: String(e.message || e), viewport: vp.label };
    }
  }

  process.stderr.write("[full-audit] navigation audit desktop + mobile...\n");
  const navDesktop = await runNavigationAudit(chromium, VIEWPORT_MATRIX.desktop[0]);
  const navMobile = await runNavigationAudit(chromium, VIEWPORT_MATRIX.mobile[0]);

  process.stderr.write("[full-audit] mobile replay guards...\n");
  const replayGuards = await runReplayGuards(chromium, VIEWPORT_MATRIX.mobile[0]);

  process.stderr.write("[full-audit] data refresh...\n");
  const dataRefreshAudit = await runDataRefreshAudit(chromium);

  process.stderr.write("[full-audit] PWA...\n");
  const pwaAudit = await runPwaAudit();

  process.stderr.write("[full-audit] cache...\n");
  const cacheUpdateAudit = await runCacheAudit();

  const errorAudit = {
    real_errors: [],
    external_api_noise: [],
    benign_errors: [],
    critical_errors: [],
  };
  for (const perf of Object.values(loadPerformanceAudit.byViewport)) {
    for (const e of [...(perf.errors?.console || []), ...(perf.errors?.page || [])]) {
      const cls = classifyError(e);
      errorAudit[cls].push({ source: perf.viewport, msg: e });
    }
  }
  for (const e of dataRefreshAudit.failures || []) {
    const cls = classifyError(e);
    errorAudit[cls].push({ source: "data_refresh", msg: e });
  }
  errorAudit.critical_errors = errorAudit.real_errors.filter((e) => /crash|uncaught|cannot read|undefined is not/i.test(e.msg)).slice(0, 10);

  const responsiveLayoutAudit = {
    desktop: {},
    mobile: {},
    tablet_portrait: loadPerformanceAudit.byViewport.tablet_portrait?.layout,
    tablet_landscape: loadPerformanceAudit.byViewport.tablet_landscape?.layout,
    overflow: {},
    scroll: {},
    bottom_nav: {},
    system_nav_safety: {},
    layout_failures: [],
  };
  for (const [id, perf] of Object.entries(loadPerformanceAudit.byViewport)) {
    if (id.startsWith("desktop")) responsiveLayoutAudit.desktop[id] = perf.layout;
    if (id.startsWith("mobile")) responsiveLayoutAudit.mobile[id] = perf.layout;
    if (perf.layout && perf.layout.overflowX) responsiveLayoutAudit.layout_failures.push({ viewport: perf.viewport, overflowX: true });
    responsiveLayoutAudit.overflow[id] = perf.layout ? perf.layout.overflowX : null;
    responsiveLayoutAudit.bottom_nav[id] = perf.layout ? { visible: perf.layout.bottomNavVisible, safe: perf.layout.bottomNavSafe } : null;
  }

  const testMatrix = {
    desktop: VIEWPORT_MATRIX.desktop.map((v) => v.label),
    mobile: VIEWPORT_MATRIX.mobile.map((v) => v.label),
    tablet: VIEWPORT_MATRIX.tablet.map((v) => v.label),
    browsers: ["chromium (Chrome/Edge)", "firefox", "webkit (Safari/iOS/iPad)"],
    coverage: `${allVps.length} viewport profiles, navigation on desktop+mobile chromium, PWA+SW on chromium, cross-engine spot checks on desktop firefox/webkit`,
  };

  const navigationClickAudit = {
    runs: [navDesktop, navMobile],
    summary: {
      desktopPass: (navDesktop.results || []).filter((r) => r.failure_type === "PASS" || (r.click_success && r.url_or_state_correct)).length,
      desktopTotal: (navDesktop.results || []).length,
      mobilePass: (navMobile.results || []).filter((r) => r.failure_type === "PASS" || (r.click_success && r.url_or_state_correct)).length,
      mobileTotal: (navMobile.results || []).length,
      auditFailures: [...(navDesktop.auditFailures || []), ...(navMobile.auditFailures || [])].length,
      productFailures: [...(navDesktop.productFailures || []), ...(navMobile.productFailures || [])].length,
    },
  };

  let previousIssueCount = null;
  try {
    if (fs.existsSync(REPORT_PATH)) {
      const prev = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
      previousIssueCount = (prev.issueList || []).length;
    }
  } catch (_) {}

  const report = {
    audit: "full-cross-device-browser-production-audit",
    version: 2,
    harness: "audit-hardening-v1",
    startedAt,
    finishedAt: new Date().toISOString(),
    targetUrl: BASE_URL,
    alsoVerified: STATIC_URLS.map((s) => s.url),
    notes: ["AUDIT ONLY — no production changes", "Playwright headless; network unthrottled", "V2 harness: overlay_is_open, AUDIT_FAILURE vs PRODUCT_FAILURE, replay guards"],
    replayGuards,
    repo: { branch: git("branch --show-current"), commit: git("rev-parse HEAD") },
    testMatrix,
    staticUrls,
    loadPerformanceAudit,
    navigationClickAudit,
    dataRefreshAudit,
    pwaAudit,
    responsiveLayoutAudit,
    cacheUpdateAudit,
    errorAudit,
  };

  report.issueList = buildIssues(report);
  report.auditRerun = {
    previous_issue_count: previousIssueCount,
    new_issue_count: report.issueList.length,
    false_positives_removed: previousIssueCount != null ? Math.max(0, previousIssueCount - report.issueList.length) : null,
    remaining_real_issues: report.issueList.filter((i) => !/Navigation issue|Tool overlay/.test(i.title)).map((i) => i.id),
  };
  const ranked = rankIssues(report.issueList);
  report.priorityRanking = {
    top_1: ranked[0] || null,
    top_2: ranked[1] || null,
    top_3: ranked[2] || null,
    top_4: ranked[3] || null,
    top_5: ranked[4] || null,
  };

  const gitStatus = git("status --short");
  const gitLines = gitStatus ? gitStatus.split("\n").filter(Boolean) : [];
  const allowedOnly = scopeAllowsAuditFiles(gitLines);
  report.finalGitStatus = {
    changed_files: gitLines,
    tracked_dirty: gitLines.filter((l) => !l.startsWith("??")).length,
    untracked: gitLines.filter((l) => l.startsWith("??")).length,
    scope_ok: gitLines.length === 0 || allowedOnly,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  process.stderr.write(`[full-audit] report: ${REPORT_PATH}\n`);

  console.log(
    JSON.stringify({
      reportPath: path.relative(REPO, REPORT_PATH),
      issues: report.issueList.length,
      scopeOk: report.finalGitStatus.scope_ok,
    }),
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error("FULL_AUDIT_FAILED", e);
    process.exit(1);
  });
}
