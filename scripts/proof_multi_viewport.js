#!/usr/bin/env node
/**
 * P0 Proof: multi-viewport CLS, gap (mobile-only when applicable), rail shift delta.
 * Guard: gap only when Silver visible; railShift = delta (not absolute position).
 * Usage: SITE_URL=... node scripts/proof_multi_viewport.js
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SITE_URL = process.env.SITE_URL || 'https://infouzel.cz/projects/?debug=1&nosw=1&section=media';
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 393, height: 852 },
  { width: 412, height: 915 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
];
const WAIT_MS = 2500;
const TIMEOUT_MS = 35000;

const TOPBAR_SEL = '#topbarWrap, .iuTopbar, header.topbar-new';
const SILVER_SEL = '#iuMobileSilverSlot, #iuMobileGateWrap, .silver-slot';
const RAIL_SEL = '.accordionCol, aside.accordionCol';

const observerInject = function() {
  window.__iuProofShifts = [];
  window.__iuProofRailLeftT0 = null;
  try {
    var po = new PerformanceObserver(function(list) {
      for (var i = 0; i < list.getEntries().length; i++) {
        var e = list.getEntries()[i];
        window.__iuProofShifts.push({ value: e.value, hadRecentInput: e.hadRecentInput });
      }
    });
    po.observe({ type: 'layout-shift', buffered: true });
  } catch (err) {
    window.__iuProofShifts = [{ error: String(err.message) }];
  }
  function captureRailT0() {
    if (window.__iuProofRailLeftT0 !== null) return;
    var rail = document.querySelector('.accordionCol, aside.accordionCol');
    if (rail) {
      var r = rail.getBoundingClientRect();
      window.__iuProofRailLeftT0 = r.left;
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      requestAnimationFrame(function() {
        requestAnimationFrame(captureRailT0);
      });
    });
  } else {
    requestAnimationFrame(function() { requestAnimationFrame(captureRailT0); });
  }
  window.addEventListener('load', function() {
    requestAnimationFrame(function() { requestAnimationFrame(captureRailT0); });
  });
};

async function runOne(page, vp) {
  await page.setViewport({ width: vp.width, height: vp.height });
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e.message || e)));
  await page.evaluateOnNewDocument(observerInject);
  await page.goto(SITE_URL, { waitUntil: 'load', timeout: TIMEOUT_MS });
  await new Promise((r) => setTimeout(r, WAIT_MS));
  const out = await page.evaluate((topbarSel, silverSel, railSel) => {
    const shifts = window.__iuProofShifts || [];
    const real = shifts.filter(function(e) { return !e.error && !e.hadRecentInput; });
    const cls = real.reduce(function(s, e) { return s + (e.value || 0); }, 0);
    const topbar = document.querySelector(topbarSel);
    const silver = document.querySelector(silverSel);
    let gapBetweenTopbarAndSilver = null;
    let gapMetricApplicable = false;
    if (topbar && silver) {
      const silverStyle = window.getComputedStyle(silver);
      const sr = silver.getBoundingClientRect();
      const visible = silverStyle.display !== 'none' && sr.width > 0 && sr.height > 0;
      if (visible) {
        const tr = topbar.getBoundingClientRect();
        gapBetweenTopbarAndSilver = Math.round(sr.top - tr.bottom);
        gapMetricApplicable = true;
      }
    }
    const rail = document.querySelector(railSel);
    let railLeft = null;
    let railShift = 0;
    if (rail) {
      const r = rail.getBoundingClientRect();
      railLeft = Math.round(r.left);
      const t0 = window.__iuProofRailLeftT0;
      if (typeof t0 === 'number' && !Number.isNaN(t0)) {
        railShift = Math.round(Math.abs(r.left - t0));
      }
    }
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth > doc.clientWidth;
    return {
      cls,
      gapBetweenTopbarAndSilver,
      gapMetricApplicable,
      overflowX,
      railShift,
      railLeft,
      layoutShiftEntriesCount: real.length,
    };
  }, TOPBAR_SEL, SILVER_SEL, RAIL_SEL);
  out.consoleErrorsCount = jsErrors.length;
  return out;
}

function isGuardViewport(vp) {
  return vp.width >= 820;
}

async function main() {
  const puppeteer = require(path.join(ROOT, 'node_modules', 'puppeteer'));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const results = { mobile: {}, guard: {} };
  for (const vp of VIEWPORTS) {
    const key = vp.width + 'x' + vp.height;
    const page = await browser.newPage();
    try {
      const data = await runOne(page, vp);
      if (isGuardViewport(vp)) {
        results.guard[key] = data;
      } else {
        results.mobile[key] = data;
      }
    } catch (e) {
      const err = { error: String(e.message) };
      if (isGuardViewport(vp)) results.guard[key] = err;
      else results.mobile[key] = err;
    }
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(results, null, 0));
}

main().catch((e) => {
  console.log(JSON.stringify({ error: String(e.message) }));
  process.exit(1);
});
