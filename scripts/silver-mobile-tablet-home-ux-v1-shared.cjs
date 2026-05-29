#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const DEFAULT_URL = "https://infouzel.cz/projects/";
const CLS_CAP = 0.02;

const PREFIX_KEYS = ["calendar", "reminder", "notes"];
const PREFIX_EXPECTED = {
  calendar: "Do kalendáře:",
  reminder: "Připomeň mi:",
  notes: "Do poznámek:",
};

function envUrl() {
  const u = String(process.env.SILVER_HOME_UX_GUARD_URL || process.env.SILVER_LAYOUT_GUARD_URL || DEFAULT_URL).trim();
  return u || DEFAULT_URL;
}

async function installClsObserver(context) {
  await context.addInitScript(() => {
    try {
      window.__iuSilverHomeUxCls = 0;
      new PerformanceObserver(function (list) {
        const entries = list.getEntries();
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (!e.hadRecentInput && e.value) {
            window.__iuSilverHomeUxCls = (window.__iuSilverHomeUxCls || 0) + e.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });
}

async function readCls(page) {
  return page.evaluate(() => Number(window.__iuSilverHomeUxCls || 0));
}

async function runViewport(page, w, h, opts) {
  const mode = opts && opts.mode ? opts.mode : "full";
  await installProofGuardNetworkStubs(page);
  const ignorableTracker = createIgnorableResourceTracker();
  ignorableTracker.attachToPage(page);
  await page.setViewportSize({ width: w, height: h });
  const rawConsoleErrors = [];
  let appErrors = 0;
  const onConsole = (msg) => {
    try {
      if (msg.type() === "error") rawConsoleErrors.push(String(msg.text()));
    } catch (_) {}
  };
  const onPageError = (err) => {
    try {
      const t = String(err && err.message ? err.message : err);
      if (isIgnorableGuardConsoleError(t)) return;
      appErrors += 1;
      rawConsoleErrors.push(t);
    } catch (_) {}
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  await page.goto(envUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2600);

  const base = await page.evaluate(() => {
    function isVisibleStyle(st) {
      if (!st) return false;
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
      return true;
    }
    const inp = document.getElementById("iuSilverHomeInput");
    const ux = document.getElementById("iuSilverHomeInputUx");
    const ticker = document.getElementById("iuSilverHomeQueryTicker");
    const field = document.querySelector(".iuSilverHomeInputFieldWrap[data-iu-silver-home-input-field]");
    const lead = ux ? ux.querySelector(".iuSilverHomeInputUxLead") : null;
    const docEl = document.documentElement;
    const body = document.body;
    const overflowX =
      (docEl && docEl.scrollWidth > docEl.clientWidth + 1) ||
      (body && body.scrollWidth > body.clientWidth + 1);
    const uxSt = ux ? getComputedStyle(ux) : null;
    const tickerSt = ticker ? getComputedStyle(ticker) : null;
    const track = ticker ? ticker.querySelector(".iuSilverHomeQueryTickerTrack") : null;
    const trackSt = track ? getComputedStyle(track) : null;
    const prefixBtn = ux ? ux.querySelector('[data-iu-silver-home-prefix="calendar"]') : null;
    const prefixSt = prefixBtn ? getComputedStyle(prefixBtn) : null;
    const sample = ux ? ux.querySelector(".iuSilverHomeInputUxSample") : null;
    const sampleSt = sample ? getComputedStyle(sample) : null;
    return {
      inpFound: !!inp,
      uxFound: !!ux,
      tickerFound: !!ticker,
      fieldFound: !!field,
      fieldEmptyClass: !!(field && field.classList.contains("iuSilverHomeInputFieldWrap--empty")),
      leadText: lead ? String(lead.textContent || "").trim() : "",
      uxVisible: !!(ux && isVisibleStyle(uxSt)),
      tickerVisible: !!(ticker && isVisibleStyle(tickerSt)),
      tickerAnim: trackSt ? trackSt.animationName : "",
      prefixWeight: prefixSt ? prefixSt.fontWeight : "",
      prefixColor: prefixSt ? prefixSt.color : "",
      sampleColor: sampleSt ? sampleSt.color : "",
      overflowX,
    };
  });

  const clsIdle = await readCls(page);

  let prefixClicksOk = true;
  const prefixResults = {};
  if (mode !== "cls-only" && mode !== "responsive-desktop") {
    for (let i = 0; i < PREFIX_KEYS.length; i++) {
      const key = PREFIX_KEYS[i];
      const expected = PREFIX_EXPECTED[key];
      const ok = await page.evaluate(({ k, exp }) => {
        const btn = document.querySelector('[data-iu-silver-home-prefix="' + k + '"]');
        const inp = document.getElementById("iuSilverHomeInput");
        const field = document.querySelector(".iuSilverHomeInputFieldWrap[data-iu-silver-home-input-field]");
        if (!btn || !inp) return false;
        btn.click();
        const val = String(inp.value || "");
        const pos = inp.selectionStart;
        const emptyOff = field ? !field.classList.contains("iuSilverHomeInputFieldWrap--empty") : true;
        return val === exp && pos === exp.length && emptyOff;
      }, { k: key, exp: expected });
      prefixResults[key] = ok;
      if (!ok) prefixClicksOk = false;
      await page.evaluate(() => {
        const inp = document.getElementById("iuSilverHomeInput");
        if (inp) {
          inp.value = "";
          if (typeof window.__iuSilverSyncHomeUxEmptyState === "function") window.__iuSilverSyncHomeUxEmptyState();
        }
      });
      await page.waitForTimeout(120);
    }
  }

  let typeHideOk = true;
  let clearRestoreOk = true;
  if (mode !== "cls-only" && mode !== "responsive-desktop") {
    typeHideOk = await page.evaluate(() => {
      const inp = document.getElementById("iuSilverHomeInput");
      const ux = document.getElementById("iuSilverHomeInputUx");
      const field = document.querySelector(".iuSilverHomeInputFieldWrap[data-iu-silver-home-input-field]");
      if (!inp || !ux || !field) return false;
      inp.focus();
      inp.value = "A";
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      if (typeof window.__iuSilverSyncHomeUxEmptyState === "function") window.__iuSilverSyncHomeUxEmptyState();
      const uxHidden = getComputedStyle(ux).display === "none" || !field.classList.contains("iuSilverHomeInputFieldWrap--empty");
      return uxHidden;
    });
    clearRestoreOk = await page.evaluate(() => {
      const inp = document.getElementById("iuSilverHomeInput");
      const ux = document.getElementById("iuSilverHomeInputUx");
      const field = document.querySelector(".iuSilverHomeInputFieldWrap[data-iu-silver-home-input-field]");
      if (!inp || !ux || !field) return false;
      inp.value = "";
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      if (typeof window.__iuSilverSyncHomeUxEmptyState === "function") window.__iuSilverSyncHomeUxEmptyState();
      try {
        inp.blur();
      } catch (_) {}
      if (typeof window.__iuSilverSyncHomeUxEmptyState === "function") window.__iuSilverSyncHomeUxEmptyState();
      const uxVisible = getComputedStyle(ux).display !== "none";
      const templated = field.classList.contains("iuSilverHomeInputFieldWrap--template");
      return field.classList.contains("iuSilverHomeInputFieldWrap--empty") && (templated || uxVisible);
    });
  }

  let clsFinal = clsIdle;
  if (mode === "cls-only") {
    await page.waitForTimeout(2200);
    clsFinal = await readCls(page);
  }

  let desktopHideOk = true;
  if (mode === "responsive-desktop" || mode === "responsive") {
    desktopHideOk = await page.evaluate(() => {
      const ux = document.getElementById("iuSilverHomeInputUx");
      const ticker = document.getElementById("iuSilverHomeQueryTicker");
      if (!ux || !ticker) return false;
      const uxSt = getComputedStyle(ux);
      const tickerSt = getComputedStyle(ticker);
      return uxSt.display === "none" && tickerSt.display === "none";
    });
  }

  const checks = {
    inp_found: base.inpFound,
    ux_found: base.uxFound,
    ticker_found: base.tickerFound,
    field_empty_initial: base.fieldEmptyClass,
    lead_text_ok: base.leadText.indexOf("Dej mi pokyn") >= 0,
    ux_visible: base.uxVisible,
    ticker_visible: base.tickerVisible,
    ticker_anim_ok: base.tickerAnim && base.tickerAnim !== "none",
    prefix_clicks_ok: prefixClicksOk,
    prefix_results: prefixResults,
    type_hide_ok: typeHideOk,
    clear_restore_ok: clearRestoreOk,
    overflow_x: base.overflowX,
    cls_idle: clsIdle,
    cls_final: clsFinal,
    cls_ok: mode === "cls-only" ? clsFinal <= CLS_CAP : clsIdle <= CLS_CAP,
    desktop_hide_ok: desktopHideOk,
    console_errors: rawConsoleErrors.length,
    app_errors: appErrors,
  };

  let pass = true;
  if (!checks.inp_found || !checks.ux_found || !checks.ticker_found) pass = false;
  if (checks.overflow_x) pass = false;
  if (!checks.cls_ok) pass = false;
  if (checks.app_errors > 0) pass = false;

  if (mode === "mobile" || mode === "full") {
    if (!checks.ux_visible || !checks.ticker_visible) pass = false;
    if (!checks.lead_text_ok || !checks.field_empty_initial) pass = false;
    if (!checks.prefix_clicks_ok || !checks.type_hide_ok || !checks.clear_restore_ok) pass = false;
    if (w <= 430 && !checks.ticker_anim_ok) pass = false;
  }
  if (mode === "tablet") {
    if (!checks.ux_visible || !checks.ticker_visible) pass = false;
    if (!checks.prefix_clicks_ok || !checks.type_hide_ok || !checks.clear_restore_ok) pass = false;
  }
  if (mode === "cls-only") {
    pass = checks.cls_ok && !checks.overflow_x && checks.inp_found;
  }
  if (mode === "responsive-desktop") {
    pass = checks.desktop_hide_ok && !checks.overflow_x;
  }
  if (mode === "responsive") {
    pass = checks.desktop_hide_ok;
  }

  checks._pass = pass;
  checks.viewport = w + "x" + h;
  checks.mode = mode;
  return checks;
}

async function runGuard(opts) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  await installClsObserver(ctx);
  const viewports = (opts && opts.viewports) || [
    { w: 390, h: 844, mode: "mobile" },
    { w: 768, h: 1024, mode: "tablet" },
  ];
  const results = [];
  try {
    for (let i = 0; i < viewports.length; i++) {
      const vp = viewports[i];
      const p = await ctx.newPage();
      try {
        results.push(await runViewport(p, vp.w, vp.h, { mode: vp.mode || "full" }));
      } finally {
        await p.close();
      }
    }
  } finally {
    await ctx.close();
    await browser.close();
  }
  const pass = results.every((r) => r._pass);
  return { pass, results, url: envUrl() };
}

function writeReport(reportPath, payload) {
  try {
    fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  } catch (_) {}
}

function emitGuardBanner(title, reportPath, out) {
  const pass = out.pass;
  process.stdout.write("=== " + title + " ===\n\n");
  for (let i = 0; i < out.results.length; i++) {
    const r = out.results[i];
    const copy = Object.assign({}, r);
    delete copy._pass;
    process.stdout.write(JSON.stringify(copy, null, 2) + "\n\n");
  }
  process.stdout.write("PASS_FAIL=" + (pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("report=" + reportPath + "\n");
  process.stdout.write("=== END_" + title + " ===\n");
  writeReport(reportPath, { pass, url: out.url, results: out.results.map((r) => {
    const c = Object.assign({}, r);
    delete c._pass;
    return c;
  }) });
  if (!pass) process.exitCode = 1;
}

module.exports = {
  runGuard,
  runViewport,
  emitGuardBanner,
  envUrl,
  CLS_CAP,
  installClsObserver,
};
