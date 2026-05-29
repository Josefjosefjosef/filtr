#!/usr/bin/env node
"use strict";

const { chromium } = require("playwright");
const base = require("./silver-mobile-tablet-home-ux-v1-shared.cjs");
const {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const TICKER_INTRO = "Zeptej se Silvera:";
const TEMPLATE_MAX_H = { 390: 88, 430: 90, 768: 84 };

function parseRgb(color) {
  const s = String(color || "").trim();
  const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

function luminance(rgb) {
  if (!rgb) return 0;
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

async function collectV2Checks(page, w) {
  const data = await page.evaluate(() => {
    const ux = document.getElementById("iuSilverHomeInputUx");
    const inp = document.getElementById("iuSilverHomeInput");
    const send = document.getElementById("iuSilverHomeSend");
    const row = document.querySelector(".iuSilverHomeInputSendRow");
    const field = document.querySelector(".iuSilverHomeInputFieldWrap[data-iu-silver-home-input-field]");
    const lines = ux ? ux.querySelectorAll(".iuSilverHomeInputUxLine") : [];
    const tickerText = document.querySelector(".iuSilverHomeQueryTickerText");
    const tickerSt = tickerText ? getComputedStyle(tickerText) : null;
    let linesSingleRowOk = lines.length >= 3;
    let linesNoClipOk = true;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lh = parseFloat(getComputedStyle(line).lineHeight) || 16;
      if (line.scrollHeight > lh * 1.4) linesSingleRowOk = false;
      if (line.scrollWidth > line.clientWidth + 2) linesNoClipOk = false;
    }
    const sendSt = send ? getComputedStyle(send) : null;
    const rowRect = row ? row.getBoundingClientRect() : null;
    const fieldRect = field ? field.getBoundingClientRect() : null;
    const inpRect = inp ? inp.getBoundingClientRect() : null;
    return {
      template_class: !!(field && field.classList.contains("iuSilverHomeInputFieldWrap--template")),
      template_row_class: !!(row && row.classList.contains("iuSilverHomeInputSendRow--templateMode")),
      send_hidden: !!(sendSt && (sendSt.display === "none" || sendSt.visibility === "hidden" || Number(sendSt.width) < 4)),
      send_visible_style: sendSt ? sendSt.display : "",
      full_width_ratio: rowRect && fieldRect && rowRect.width > 0 ? fieldRect.width / rowRect.width : 0,
      lines_single_row_ok: linesSingleRowOk,
      lines_no_clip_ok: linesNoClipOk,
      input_h: inpRect ? Math.round(inpRect.height) : 0,
      row_h: rowRect ? Math.round(rowRect.height) : 0,
      ticker_intro_ok: !!(tickerText && String(tickerText.textContent || "").indexOf("Zeptej se Silvera:") >= 0),
      ticker_color: tickerSt ? tickerSt.color : "",
    };
  });

  data.ticker_contrast_ok = luminance(parseRgb(data.ticker_color)) >= 170;
  data.full_width_template_ok = data.template_row_class && data.send_hidden && data.full_width_ratio >= 0.96;
  data.block_compact_ok = data.input_h > 0 && data.input_h <= (TEMPLATE_MAX_H[w] || 92);
  return data;
}

async function collectComposeChecks(page) {
  return page.evaluate(() => {
    const send = document.getElementById("iuSilverHomeSend");
    const ux = document.getElementById("iuSilverHomeInputUx");
    const inp = document.getElementById("iuSilverHomeInput");
    inp.focus();
    if (typeof window.__iuSilverSyncHomeUxEmptyState === "function") window.__iuSilverSyncHomeUxEmptyState();
    const sendSt = send ? getComputedStyle(send) : null;
    const uxSt = ux ? getComputedStyle(ux) : null;
    const sendVisible = !!(sendSt && sendSt.display !== "none" && parseFloat(sendSt.width) > 20);
    const uxHidden = uxSt ? uxSt.display === "none" : true;
    const focused = document.activeElement === inp;
    return { focus_send_visible_ok: sendVisible, focus_ux_hidden_ok: uxHidden, focus_ok: focused };
  });
}

function applyV2Pass(core, v2, compose, replayMode) {
  const checks = Object.assign({}, core, v2, compose);
  delete checks._pass;
  let pass = !!core._pass;
  if (replayMode === "full-width-template-replay") {
    pass = checks.full_width_template_ok && checks.send_hidden && checks.template_class && !checks.overflow_x;
  } else if (replayMode === "single-line-replay") {
    pass = checks.lines_single_row_ok && checks.lines_no_clip_ok && checks.ux_visible && !checks.overflow_x;
  } else if (replayMode === "ticker-replay") {
    pass = checks.ticker_intro_ok && checks.ticker_contrast_ok && checks.ticker_visible && !checks.overflow_x;
  } else if (replayMode === "compact-replay") {
    pass = checks.block_compact_ok && checks.lines_single_row_ok && !checks.overflow_x;
  } else if (replayMode === "ux-replay") {
    pass = !!core._pass && checks.full_width_template_ok && checks.lines_single_row_ok && checks.ticker_intro_ok;
  } else {
    if (!checks.full_width_template_ok) pass = false;
    if (!checks.lines_single_row_ok) pass = false;
    if (!checks.lines_no_clip_ok) pass = false;
    if (!checks.ticker_intro_ok) pass = false;
    if (!checks.ticker_contrast_ok) pass = false;
    if (!checks.block_compact_ok) pass = false;
    if (!checks.focus_send_visible_ok) pass = false;
    if (!checks.focus_ux_hidden_ok) pass = false;
  }
  checks._pass = pass;
  return checks;
}

async function runV2Guard(opts) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  await base.installClsObserver(ctx);
  const viewports = (opts && opts.viewports) || [
    { w: 390, h: 844, mode: "mobile" },
    { w: 430, h: 844, mode: "mobile430" },
    { w: 768, h: 1024, mode: "tablet" },
  ];
  const replayMode = opts && opts.replayMode ? opts.replayMode : "full";
  const results = [];
  try {
    for (let i = 0; i < viewports.length; i++) {
      const vp = viewports[i];
      const p = await ctx.newPage();
      try {
        await installProofGuardNetworkStubs(p);
        const ignorableTracker = createIgnorableResourceTracker();
        ignorableTracker.attachToPage(p);
        p.on("pageerror", (err) => {
          const t = String(err && err.message ? err.message : err);
          if (isIgnorableGuardConsoleError(t)) return;
        });
        const coreMode = vp.mode === "tablet" ? "tablet" : "mobile";
        const core = await base.runViewport(p, vp.w, vp.h, { mode: coreMode });
        const v2 = await collectV2Checks(p, vp.w);
        const compose = replayMode.indexOf("ticker") >= 0 || replayMode.indexOf("compact") >= 0 || replayMode.indexOf("single-line") >= 0
          ? {}
          : await collectComposeChecks(p);
        const merged = applyV2Pass(core, v2, compose, replayMode);
        merged.viewport = vp.w + "x" + vp.h;
        merged.mode = vp.mode || coreMode;
        results.push(merged);
      } finally {
        await p.close();
      }
    }
  } finally {
    await ctx.close();
    await browser.close();
  }
  const pass = results.every((r) => r._pass);
  return { pass, results, url: base.envUrl() };
}

async function measureHeights(url) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await installProofGuardNetworkStubs(page);
  const out = {};
  try {
    for (const vp of [{ w: 390, key: "mobile390" }, { w: 430, key: "mobile430" }, { w: 768, key: "tablet768" }]) {
      await page.setViewportSize({ width: vp.w, height: 844 });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(2800);
      const h = await collectV2Checks(page, vp.w);
      out[vp.key] = { input_h: h.input_h, row_h: h.row_h };
    }
  } finally {
    await browser.close();
  }
  return out;
}

module.exports = {
  runV2Guard,
  measureHeights,
  emitV2Banner: base.emitGuardBanner,
  TICKER_INTRO,
};
