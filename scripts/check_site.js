#!/usr/bin/env node
/**
 * check_site.js - Headless site checks for infoUzel health report
 * Output: reports/check_site.json (stable input for health_report.py)
 * Schema: url, cls, lcpMs, jsErrors, layout, bundle
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSS_PATH = path.join(ROOT, 'assets/app.css');
const JS_PATH = path.join(ROOT, 'assets/app.js');
const REPORTS_DIR = path.join(ROOT, 'reports');
const OUTPUT_PATH = path.join(REPORTS_DIR, 'check_site.json');
const SITE_URL = process.env.SITE_URL || 'https://infouzel.cz/projects/?debug=1&nosw=1&section=media';

const SETTLE_MS = 500;
const PAGE_TIMEOUT_MS = 25000;
const NETWORK_SETTLE_MS = 2000;

function getBundleSizes() {
  const result = { cssKb: 0, jsKb: 0 };
  try {
    if (fs.existsSync(CSS_PATH)) {
      result.cssKb = Math.round(fs.statSync(CSS_PATH).size / 1024);
    }
    if (fs.existsSync(JS_PATH)) {
      result.jsKb = Math.round(fs.statSync(JS_PATH).size / 1024);
    }
  } catch (e) {
    result.error = String(e.message || e);
  }
  return result;
}

async function runHeadlessChecks() {
  const result = {
    cls: null,
    lcpMs: null,
    jsErrors: [],
    layout: {
      topbarHeight: null,
      railShift: null,
      hasLeftRail: false,
      hasMindMenu: false,
      hasTopbarGrid: false,
      hasOverflowX: false,
      topbarHasGradient: false,
      topbarBg: null,
      brandTitleExists: false,
      subtitleExists: false,
      subtitleTextExactMatch: false,
      subtitleBelowTitle: false,
      subtitleWraps: false,
      topbarOverflow: false,
      subtitleComputedColor: null,
      subtitleVisible: false,
    },
    error: null,
  };

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    result.error = 'puppeteer not installed: run npm install';
    return result;
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();

    const jsErrors = [];
    page.on('pageerror', (err) => jsErrors.push(String(err.message || err)));

    await page.evaluateOnNewDocument(function () {
      window.__CLS_VALUE = 0;
      window.__RAIL_SHIFT = 0;
      window.__RAIL_T0 = null;
      if (typeof PerformanceObserver !== 'undefined') {
        try {
          var obs = new PerformanceObserver(function (list) {
            var entries = list.getEntries();
            for (var i = 0; i < entries.length; i++) {
              var e = entries[i];
              if (!e.hadRecentInput) window.__CLS_VALUE += (e.value || 0);
            }
          });
          obs.observe({ type: 'layout-shift', buffered: true });
        } catch (err) {}
      }
      function measureRail() {
        var railEl = document.querySelector('.accordionCol, aside.accordionCol');
        if (railEl) {
          window.__RAIL_T0 = railEl.getBoundingClientRect().left;
          setTimeout(function () {
            if (railEl && typeof window.__RAIL_T0 === 'number') {
              window.__RAIL_SHIFT = Math.round(Math.abs(railEl.getBoundingClientRect().left - window.__RAIL_T0));
            }
          }, 500);
        }
      }
      if (document.readyState === 'complete') measureRail();
      else window.addEventListener('load', measureRail);
    });

    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    await new Promise((r) => setTimeout(r, NETWORK_SETTLE_MS));
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    let metrics;
    try {
      var clsValue = await page.evaluate(function () { return typeof window.__CLS_VALUE === 'number' ? window.__CLS_VALUE : 0; });
      var railShiftValue = await page.evaluate(function () { return typeof window.__RAIL_SHIFT === 'number' ? window.__RAIL_SHIFT : 0; });

      metrics = await page.evaluate(function () {
        var out = {
          cls: typeof window.__CLS_VALUE === 'number' ? window.__CLS_VALUE : 0,
          lcpMs: null,
          layout: {
            topbarHeight: null,
            railShift: typeof window.__RAIL_SHIFT === 'number' ? window.__RAIL_SHIFT : 0,
            hasLeftRail: false,
            hasMindMenu: false,
            hasTopbarGrid: false,
            hasOverflowX: false,
            topbarHasGradient: false,
            topbarBg: null,
            brandTitleExists: false,
            subtitleExists: false,
            subtitleTextExactMatch: false,
            subtitleBelowTitle: false,
            subtitleWraps: false,
            topbarOverflow: false,
            subtitleComputedColor: null,
            subtitleVisible: false,
          },
        };
        try {
          var lcpEntries = performance.getEntriesByType ? performance.getEntriesByType('largest-contentful-paint') : [];
          var last = lcpEntries[lcpEntries.length - 1];
          out.lcpMs = last && last.startTime ? Math.round(last.startTime) : null;
        } catch (e) { out.lcpError = String(e); }
        try {
          var topbar = document.querySelector('#topbarWrap, .iuTopbar, .topbar-new');
          if (topbar) {
            var style = window.getComputedStyle(topbar);
            out.layout.topbarHeight = topbar.getBoundingClientRect().height;
            out.layout.topbarBg = style.backgroundColor || style.background || null;
            var bg = (style.background || style.backgroundColor || '').toLowerCase();
            out.layout.topbarHasGradient = bg.indexOf('linear-gradient') >= 0 || bg.indexOf('gradient') >= 0;
          }
          var brandTitle = document.querySelector('.iuTopbarLeft .iuBrand, .iuBrand');
          var subtitleEl = document.querySelector('.iuBrandSubtitle');
          var expectedSubtitle = 'Zprávy • Služby • Nástroje • Silver – váš osobní asistent pro každý den';
          out.layout.brandTitleExists = !!(brandTitle && (brandTitle.textContent || '').replace(/\s+/g, '').indexOf('infoUzel') >= 0);
          out.layout.subtitleExists = !!subtitleEl;
          out.layout.subtitleTextExactMatch = !!(subtitleEl && (subtitleEl.textContent || '').trim() === expectedSubtitle);
          var subtitleBelowTitle = false, subtitleWraps = false;
          if (brandTitle && subtitleEl) {
            var r1 = brandTitle.getBoundingClientRect(), r2 = subtitleEl.getBoundingClientRect();
            subtitleBelowTitle = r2.top >= r1.bottom - 2;
            var cs = window.getComputedStyle(subtitleEl), lineHeight = parseFloat(cs.lineHeight) || 14;
            subtitleWraps = subtitleEl.scrollHeight > lineHeight * 1.8;
          }
          out.layout.subtitleBelowTitle = subtitleBelowTitle;
          out.layout.subtitleWraps = subtitleWraps;
          out.layout.topbarOverflow = topbar ? (topbar.scrollWidth > topbar.clientWidth + 2) : false;
          if (subtitleEl) {
            out.layout.subtitleComputedColor = window.getComputedStyle(subtitleEl).color || null;
            var r = subtitleEl.getBoundingClientRect();
            out.layout.subtitleVisible = r.width > 0 && r.height > 0 && subtitleEl.offsetParent !== null;
          }
          var railEl = document.querySelector('.accordionCol, aside.accordionCol');
          out.layout.hasLeftRail = !!railEl || !!document.querySelector('[class*="accordionCol"]');
          out.layout.hasMindMenu = !!document.querySelector('.iu-mmQuickLinks, [class*="iu-mm"], .iu-mmSectionHead');
          out.layout.hasTopbarGrid = !!document.querySelector('.iuTopbarContent, .iuTopbarSlot');
          out.layout.hasOverflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth;
        } catch (e) { out.layoutError = String(e); }
        return out;
      });
      metrics.cls = typeof clsValue === 'number' ? clsValue : 0;
      metrics.layout = metrics.layout || {};
      metrics.layout.railShift = typeof railShiftValue === 'number' ? railShiftValue : 0;
    } catch (e) {
      result.error = String(e.message || e);
      result.layoutEvaluateError = String(e.message || e);
      if (browser) await browser.close();
      return result;
    }

    result.cls = metrics.cls != null ? metrics.cls : 0;
    result.lcpMs = metrics.lcpMs;
    result.jsErrors = jsErrors;
    result.layout = metrics.layout || result.layout;
    if (result.layout) {
      result.layout.railShift = result.layout.railShift != null && !Number.isNaN(Number(result.layout.railShift)) ? Number(result.layout.railShift) : 0;
    }
  } catch (e) {
    result.error = String(e.message || e);
  } finally {
    if (browser) await browser.close();
  }
  return result;
}

async function main() {
  const [bundle, headless] = await Promise.all([
    Promise.resolve(getBundleSizes()),
    runHeadlessChecks(),
  ]);

  const output = {
    url: SITE_URL,
    timestamp: new Date().toISOString(),
    cls: headless.cls != null && !Number.isNaN(Number(headless.cls)) ? Number(headless.cls) : 0,
    lcpMs: headless.lcpMs,
    jsErrors: headless.jsErrors || [],
    layout: (function () {
      const L = headless.layout || {};
      const normalized = Object.assign({
        topbarHeight: null,
        railShift: 0,
        hasLeftRail: false,
        hasMindMenu: false,
        hasTopbarGrid: false,
        hasOverflowX: false,
        topbarHasGradient: false,
        topbarBg: null,
        brandTitleExists: false,
        subtitleExists: false,
        subtitleTextExactMatch: false,
        subtitleBelowTitle: false,
        subtitleWraps: false,
        topbarOverflow: false,
        subtitleComputedColor: null,
        subtitleVisible: false,
      }, L);
      normalized.railShift = L.railShift != null && !Number.isNaN(Number(L.railShift)) ? Number(L.railShift) : 0;
      return normalized;
    })(),
    bundle: {
      cssKb: bundle.cssKb ?? headless.bundle?.cssKb ?? 0,
      jsKb: bundle.jsKb ?? headless.bundle?.jsKb ?? 0,
    },
  };

  if (headless.error) {
    output.error = headless.error;
  }
  if (headless.layoutEvaluateError) {
    output.layoutEvaluateError = headless.layoutEvaluateError;
  }

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
}

main().catch((e) => {
  const fallback = {
    url: SITE_URL,
    timestamp: new Date().toISOString(),
    cls: 0,
    lcpMs: null,
    jsErrors: [],
    layout: { topbarHeight: null, railShift: 0, hasLeftRail: false, hasMindMenu: false, hasTopbarGrid: false, hasOverflowX: false, topbarHasGradient: false, topbarBg: null, brandTitleExists: false, subtitleExists: false, subtitleTextExactMatch: false, subtitleBelowTitle: false, subtitleWraps: false, topbarOverflow: false, subtitleComputedColor: null, subtitleVisible: false },
    bundle: getBundleSizes(),
    error: String(e.message || e),
  };
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(fallback, null, 2), 'utf8');
});
