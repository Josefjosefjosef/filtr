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
const SITE_URL = process.argv[2] || process.env.SITE_URL || 'https://infouzel.cz/projects/?debug=1&nosw=1&section=media';

const SETTLE_MS = 5000;
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

    await page.evaluateOnNewDocument(() => {
      window.__CLS = 0;
      try {
        const obs = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              window.__CLS += entry.value;
            }
          }
        });
        obs.observe({ type: 'layout-shift', buffered: true });
      } catch (_) {}
    });

    await page.goto(SITE_URL, { waitUntil: 'networkidle0', timeout: PAGE_TIMEOUT_MS });

    await new Promise((r) => setTimeout(r, 500));

    let metrics;
    try {
      metrics = await page.evaluate(() => {
        const out = {
          cls: 0,
          lcpMs: null,
          layout: {
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
          },
        };

        let clsVal = typeof window.__CLS === 'number' ? window.__CLS : 0;
        if (clsVal === 0 && typeof window.__iuDumpCLS === 'function') {
          try {
            const dump = window.__iuDumpCLS();
            if (dump && typeof dump.realTotal === 'number') clsVal = dump.realTotal;
          } catch (_) {}
        }
        if (clsVal === 0 && typeof window.__iuCLSRealTotal === 'number') {
          clsVal = window.__iuCLSRealTotal;
        }
        if (clsVal === 0 && performance.getEntriesByType) {
          const entries = performance.getEntriesByType('layout-shift') || [];
          clsVal = entries.reduce((sum, e) => sum + (e.value || 0), 0);
        }
        out.cls = Number(clsVal) || 0;

        try {
          const lcpEntries = performance.getEntriesByType ? performance.getEntriesByType('largest-contentful-paint') : [];
          const last = lcpEntries[lcpEntries.length - 1];
          out.lcpMs = last && last.startTime ? Math.round(last.startTime) : null;
        } catch (_) {}

        const railEl = document.querySelector('.accordionCol, aside.accordionCol');
        let railLeftT0 = railEl ? railEl.getBoundingClientRect().left : NaN;
        let railLeftT1 = railEl ? railEl.getBoundingClientRect().left : NaN;

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
          if (subtitleEl) {
            const subStyle = window.getComputedStyle(subtitleEl);
            out.layout.subtitleComputedColor = subStyle.color || null;
            const r = subtitleEl.getBoundingClientRect();
            out.layout.subtitleVisible = r.width > 0 && r.height > 0 && (subtitleEl.offsetParent !== null);
          }

          out.layout.hasLeftRail = !!railEl || !!document.querySelector('[class*="accordionCol"]');
          out.layout.railShift = Number(Math.round(Math.abs(railLeftT1 - railLeftT0))) || 0;
          out.layout.hasMindMenu = !!document.querySelector('.iu-mmQuickLinks, [class*="iu-mm"], .iu-mmSectionHead');
          out.layout.hasTopbarGrid = !!document.querySelector('.iuTopbarContent, .iuTopbarSlot');

          const doc = document.documentElement;
          out.layout.hasOverflowX = doc.scrollWidth > doc.clientWidth;
        } catch (_) {
          out.layout.railShift = 0;
        }

        return out;
      });
    } catch (e) {
      result.error = String(e.message || e);
      result.layoutEvaluateError = String(e.message || e);
      if (browser) await browser.close();
      return result;
    }

    result.cls = typeof metrics.cls === 'number' ? metrics.cls : 0;
    result.lcpMs = metrics.lcpMs;
    result.jsErrors = jsErrors;
    result.layout = metrics.layout || result.layout;
    if (result.layout && (result.layout.railShift == null || typeof result.layout.railShift !== 'number')) {
      result.layout.railShift = 0;
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

  if (headless.error || headless.layoutEvaluateError) {
    const msg = headless.error || headless.layoutEvaluateError || 'EVALUATE_FAILED';
    console.log(JSON.stringify({ proof_error: 'EVALUATE_FAILED', message: String(msg) }));
    process.exit(2);
  }

  const layout = headless.layout || {};
  const output = {
    url: SITE_URL,
    timestamp: new Date().toISOString(),
    cls: typeof headless.cls === 'number' ? headless.cls : 0,
    lcpMs: headless.lcpMs,
    jsErrors: headless.jsErrors || [],
    layout: {
      topbarHeight: layout.topbarHeight ?? null,
      railShift: typeof layout.railShift === 'number' ? layout.railShift : 0,
      hasLeftRail: !!layout.hasLeftRail,
      hasMindMenu: !!layout.hasMindMenu,
      hasTopbarGrid: !!layout.hasTopbarGrid,
      hasOverflowX: !!layout.hasOverflowX,
      topbarHasGradient: !!layout.topbarHasGradient,
      topbarBg: layout.topbarBg ?? null,
      brandTitleExists: !!layout.brandTitleExists,
      subtitleExists: !!layout.subtitleExists,
      subtitleTextExactMatch: !!layout.subtitleTextExactMatch,
      subtitleBelowTitle: !!layout.subtitleBelowTitle,
      subtitleWraps: !!layout.subtitleWraps,
      topbarOverflow: !!layout.topbarOverflow,
      subtitleComputedColor: layout.subtitleComputedColor ?? null,
      subtitleVisible: !!layout.subtitleVisible,
    },
    bundle: {
      cssKb: bundle.cssKb ?? headless.bundle?.cssKb ?? 0,
      jsKb: bundle.jsKb ?? headless.bundle?.jsKb ?? 0,
    },
  };

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
}

main().catch((e) => {
  console.log(JSON.stringify({ proof_error: 'EVALUATE_FAILED', message: String(e.message || e) }));
  process.exit(2);
});
