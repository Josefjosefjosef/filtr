#!/usr/bin/env node
/**
 * check_site.js - Headless site checks for infoUzel health report
 * Measures: CLS, LCP, JS errors, bundle sizes
 * Output: JSON to stdout for health_report.py
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSS_PATH = path.join(ROOT, 'assets/app.css');
const JS_PATH = path.join(ROOT, 'assets/app.js');
const SITE_URL = process.env.SITE_URL || 'https://infouzel.cz/projects/?debug=1&nosw=1&section=media';

async function getBundleSizes() {
  const result = { cssKb: null, jsKb: null };
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
    lcp: null,
    jsErrors: [],
    success: false,
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

    await page.goto(SITE_URL, { waitUntil: 'networkidle0', timeout: 30000 });

    await page.evaluate(() => {
      return new Promise((resolve) => {
        if (typeof requestAnimationFrame !== 'function') {
          resolve();
          return;
        }
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    });

    await new Promise((r) => setTimeout(r, 2000));

    const metrics = await page.evaluate(() => {
      return new Promise((resolve) => {
        try {
          let cls = typeof window.__iuCLSRealTotal === 'number' ? window.__iuCLSRealTotal : null;
          if (cls === null && typeof window.__iuDumpCLS === 'function') {
            const dump = window.__iuDumpCLS();
            cls = dump && typeof dump.realTotal === 'number' ? dump.realTotal : null;
          }
          resolve({ cls, lcp: null });
        } catch (e) {
          resolve({ cls: null, lcp: null, error: String(e) });
        }
      });
    });

    result.cls = metrics.cls;
    result.lcp = metrics.lcp;
    result.jsErrors = jsErrors;
    result.success = true;
  } catch (e) {
    result.error = String(e.message || e);
  } finally {
    if (browser) await browser.close();
  }
  return result;
}

async function main() {
  const [bundles, headless] = await Promise.all([
    getBundleSizes(),
    runHeadlessChecks(),
  ]);

  const output = {
    timestamp: new Date().toISOString(),
    url: SITE_URL,
    bundles,
    headless,
  };

  console.log(JSON.stringify(output, null, 0));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e.message || e) }));
  process.exit(1);
});
