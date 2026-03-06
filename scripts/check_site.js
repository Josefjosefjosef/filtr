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

const SETTLE_MS = 3000;
const PAGE_TIMEOUT_MS = 25000;

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

    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });

    await page.evaluate(() => {
      return new Promise((resolve) => {
        if (typeof requestAnimationFrame !== 'function') {
          resolve();
          return;
        }
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    });

    await new Promise((r) => setTimeout(r, SETTLE_MS));

    const metrics = await page.evaluate(() => {
      const out = {
        cls: null,
        lcpMs: null,
        layout: {
          topbarHeight: null,
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
        },
      };

      try {
        if (typeof window.__iuDumpCLS === 'function') {
          const dump = window.__iuDumpCLS();
          out.cls = dump && typeof dump.realTotal === 'number' ? dump.realTotal : null;
        }
        if (out.cls === null && typeof window.__iuCLSRealTotal === 'number') {
          out.cls = window.__iuCLSRealTotal;
        }
        if (out.cls === null) {
          const entries = performance.getEntriesByType ? performance.getEntriesByType('layout-shift') : [];
          out.cls = entries.reduce((sum, e) => sum + (e.value || 0), 0);
        }
      } catch (e) {
        out.clsError = String(e);
      }

      try {
        const lcpEntries = performance.getEntriesByType ? performance.getEntriesByType('largest-contentful-paint') : [];
        const last = lcpEntries[lcpEntries.length - 1];
        out.lcpMs = last && last.startTime ? Math.round(last.startTime) : null;
      } catch (e) {
        out.lcpError = String(e);
      }

      try {
        const topbar = document.querySelector('#topbarWrap, .iuTopbar, .topbar-new');
        if (topbar) {
          const style = window.getComputedStyle(topbar);
          out.layout.topbarHeight = topbar.getBoundingClientRect().height;
          out.layout.topbarBg = style.backgroundColor || style.background || null;
          const bg = (style.background || style.backgroundColor || '').toLowerCase();
          out.layout.topbarHasGradient = bg.includes('linear-gradient') || bg.includes('gradient');
        }

        const brandTitle = document.querySelector('.iuTopbarLeft .iuBrand, .iuBrand');
        const brandBlock = document.querySelector('.iuBrandBlock');
        const subtitleEl = document.querySelector('.iuBrandSubtitle');
        const expectedSubtitle = 'Zprávy • Služby • Nástroje • Silver – váš osobní asistent pro každý den';
        out.layout.brandTitleExists = !!(brandTitle && (brandTitle.textContent || '').replace(/\s+/g, '').includes('infoUzel'));
        out.layout.subtitleExists = !!subtitleEl;
        out.layout.subtitleTextExactMatch = !!(subtitleEl && (subtitleEl.textContent || '').trim() === expectedSubtitle);
        let subtitleBelowTitle = false;
        let subtitleWraps = false;
        if (brandTitle && subtitleEl) {
          const r1 = brandTitle.getBoundingClientRect();
          const r2 = subtitleEl.getBoundingClientRect();
          subtitleBelowTitle = r2.top >= r1.bottom - 2;
          const cs = window.getComputedStyle(subtitleEl);
          const lineHeight = parseFloat(cs.lineHeight) || 14;
          subtitleWraps = subtitleEl.scrollHeight > lineHeight * 1.8;
        }
        out.layout.subtitleBelowTitle = subtitleBelowTitle;
        out.layout.subtitleWraps = subtitleWraps;
        out.layout.topbarOverflow = topbar ? (topbar.scrollWidth > topbar.clientWidth + 2) : false;

        out.layout.hasLeftRail = !!document.querySelector('.accordionCol, aside.accordionCol, [class*="accordionCol"]');
        out.layout.hasMindMenu = !!document.querySelector('.iu-mmQuickLinks, [class*="iu-mm"], .iu-mmSectionHead');
        out.layout.hasTopbarGrid = !!document.querySelector('.iuTopbarContent, .iuTopbarSlot');

        const doc = document.documentElement;
        out.layout.hasOverflowX = doc.scrollWidth > doc.clientWidth;
      } catch (e) {
        out.layoutError = String(e);
      }

      return out;
    });

    result.cls = metrics.cls;
    result.lcpMs = metrics.lcpMs;
    result.jsErrors = jsErrors;
    result.layout = metrics.layout || result.layout;
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
    cls: headless.cls,
    lcpMs: headless.lcpMs,
    jsErrors: headless.jsErrors || [],
    layout: headless.layout || {
      topbarHeight: null,
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
    },
    bundle: {
      cssKb: bundle.cssKb ?? headless.bundle?.cssKb ?? 0,
      jsKb: bundle.jsKb ?? headless.bundle?.jsKb ?? 0,
    },
  };

  if (headless.error) {
    output.error = headless.error;
  }

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
}

main().catch((e) => {
  const fallback = {
    url: SITE_URL,
    timestamp: new Date().toISOString(),
    cls: null,
    lcpMs: null,
    jsErrors: [],
    layout: { topbarHeight: null, hasLeftRail: false, hasMindMenu: false, hasTopbarGrid: false, hasOverflowX: false, topbarHasGradient: false, topbarBg: null, brandTitleExists: false, subtitleExists: false, subtitleTextExactMatch: false, subtitleBelowTitle: false, subtitleWraps: false, topbarOverflow: false },
    bundle: getBundleSizes(),
    error: String(e.message || e),
  };
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(fallback, null, 2), 'utf8');
});
