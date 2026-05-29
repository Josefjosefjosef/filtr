#!/usr/bin/env node
"use strict";

const base = require("./silver-mobile-tablet-home-ux-v1-shared.cjs");
const { chromium } = require("playwright");
const {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const PREFIX_KEYS = ["calendar", "reminder", "notes"];
const PREFIX_NO_COLON = {
  calendar: "Do kalendáře",
  reminder: "Připomeň mi",
  notes: "Do poznámek",
};
const MIN_LINE_GAP_PX = 2;
const BASE_ACTION_GAP_PX = 3;
const TARGET_ACTION_GAP_PX = 5;
const MIN_ACTION_GAP_PX = 4.5;
const MAX_LEAD_GAP_PX = 2.5;

async function runNoColonInsert(page) {
  const results = {};
  let pass = true;
  for (let i = 0; i < PREFIX_KEYS.length; i++) {
    const key = PREFIX_KEYS[i];
    const expected = PREFIX_NO_COLON[key];
    const ok = await page.evaluate(({ k, exp }) => {
      const btn = document.querySelector('[data-iu-silver-home-prefix="' + k + '"]');
      const inp = document.getElementById("iuSilverHomeInput");
      if (!btn || !inp) return false;
      btn.click();
      const val = String(inp.value || "");
      return val === exp && !val.endsWith(":") && val.indexOf(":") < 0;
    }, { k: key, exp: expected });
    results[key] = ok;
    if (!ok) pass = false;
    await page.evaluate(() => {
      const inp = document.getElementById("iuSilverHomeInput");
      if (!inp) return;
      inp.value = "";
      try {
        inp.blur();
      } catch (_) {}
      if (typeof window.__iuSilverResetHomeTemplateMode === "function") window.__iuSilverResetHomeTemplateMode();
      else if (typeof window.__iuSilverSyncHomeUxEmptyState === "function") window.__iuSilverSyncHomeUxEmptyState();
    });
    await page.waitForTimeout(120);
  }
  return { no_colon_insert_ok: pass, prefix_no_colon_results: results };
}

async function runTouchSpacing(page) {
  return page.evaluate((cfg) => {
    const ux = document.getElementById("iuSilverHomeInputUx");
    if (!ux) {
      return {
        touch_spacing_ok: false,
        line_gaps_px: [],
        lead_gap_px: null,
        action_gap_target_px: cfg.target,
      };
    }
    const lead = ux.querySelector(".iuSilverHomeInputUxLead");
    const lines = Array.from(ux.querySelectorAll(".iuSilverHomeInputUxLine"));
    const gaps = [];
    for (let i = 0; i < lines.length - 1; i++) {
      const top = lines[i].getBoundingClientRect();
      const bottom = lines[i + 1].getBoundingClientRect();
      gaps.push(Math.round((bottom.top - top.bottom) * 100) / 100);
    }
    let leadGap = null;
    if (lead && lines[0]) {
      const leadRect = lead.getBoundingClientRect();
      const firstRect = lines[0].getBoundingClientRect();
      leadGap = Math.round((firstRect.top - leadRect.bottom) * 100) / 100;
    }
    const actionOk = gaps.length >= 2 && gaps.every((g) => g >= cfg.minAction);
    const leadOk = leadGap === null || leadGap <= cfg.maxLead;
    return {
      touch_spacing_ok: actionOk && leadOk,
      line_gaps_px: gaps,
      lead_gap_px: leadGap,
      action_gap_target_px: cfg.target,
      action_gap_min_px: cfg.minAction,
      lead_gap_max_px: cfg.maxLead,
    };
  }, {
    target: TARGET_ACTION_GAP_PX,
    minAction: MIN_ACTION_GAP_PX,
    maxLead: MAX_LEAD_GAP_PX,
  });
}

async function runTemplateReset(page) {
  return page.evaluate(() => {
    function isTemplateModeRestored() {
      const inp = document.getElementById("iuSilverHomeInput");
      const field = document.querySelector(".iuSilverHomeInputFieldWrap[data-iu-silver-home-input-field]");
      const ux = document.getElementById("iuSilverHomeInputUx");
      const send = document.getElementById("iuSilverHomeSend");
      const row = document.querySelector(".iuSilverHomeInputSendRow");
      if (!inp || !field || !ux || !send || !row) return false;
      const uxSt = getComputedStyle(ux);
      const sendSt = getComputedStyle(send);
      const empty = !String(inp.value || "").length;
      const focused = document.activeElement === inp;
      const templateClass = field.classList.contains("iuSilverHomeInputFieldWrap--template");
      const rowTemplate = row.classList.contains("iuSilverHomeInputSendRow--templateMode");
      const sendHidden = sendSt.display === "none" || Number(sendSt.width) < 4 || sendSt.visibility === "hidden";
      const uxVisible = uxSt.display !== "none";
      const lead = ux.querySelector(".iuSilverHomeInputUxLead");
      const leadOk = !!(lead && String(lead.textContent || "").indexOf("Dej mi pokyn") >= 0);
      return empty && !focused && templateClass && rowTemplate && sendHidden && uxVisible && leadOk;
    }
    const inp = document.getElementById("iuSilverHomeInput");
    if (!inp) return { template_reset_ok: false };
    inp.focus();
    inp.value = "Do kalendáře zítra v 15 hod. schůzka s mámou";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    if (typeof window.__iuSilverSyncHomeUxEmptyState === "function") window.__iuSilverSyncHomeUxEmptyState();
    const composeBefore = !isTemplateModeRestored();
    if (typeof window.__iuSilverResetHomeTemplateMode !== "function") return { template_reset_ok: false, compose_before: composeBefore };
    window.__iuSilverResetHomeTemplateMode();
    return { template_reset_ok: composeBefore && isTemplateModeRestored(), compose_before: composeBefore };
  });
}

async function openHomeOverlay(page) {
  await page.evaluate(() => {
    const inp = document.getElementById("iuSilverHomeInput");
    if (!inp) return;
    inp.focus();
    inp.value = "Do kalendáře zítra v 15 hod. schůzka s mámou";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    if (typeof window.__iuSilverSyncHomeUxEmptyState === "function") window.__iuSilverSyncHomeUxEmptyState();
  });
  await page.click("#iuSilverHomeSend");
  await page.waitForTimeout(900);
  return page.evaluate(() => {
    const ov = document.getElementById("iuSilverChatOverlay");
    return !!(ov && !ov.hidden);
  });
}

async function runCloseModalReset(page) {
  const overlayOpen = await openHomeOverlay(page);
  if (!overlayOpen) return { close_modal_reset_ok: false, overlay_open: false };
  await page.click("#iuSilverChatClose");
  await page.waitForTimeout(500);
  const ok = await page.evaluate(() => {
    function isTemplateModeRestored() {
      const inp = document.getElementById("iuSilverHomeInput");
      const field = document.querySelector(".iuSilverHomeInputFieldWrap[data-iu-silver-home-input-field]");
      const ux = document.getElementById("iuSilverHomeInputUx");
      const send = document.getElementById("iuSilverHomeSend");
      const row = document.querySelector(".iuSilverHomeInputSendRow");
      if (!inp || !field || !ux || !send || !row) return false;
      const uxSt = getComputedStyle(ux);
      const sendSt = getComputedStyle(send);
      const empty = !String(inp.value || "").length;
      const focused = document.activeElement === inp;
      const templateClass = field.classList.contains("iuSilverHomeInputFieldWrap--template");
      const rowTemplate = row.classList.contains("iuSilverHomeInputSendRow--templateMode");
      const sendHidden = sendSt.display === "none" || Number(sendSt.width) < 4 || sendSt.visibility === "hidden";
      const uxVisible = uxSt.display !== "none";
      const lead = ux.querySelector(".iuSilverHomeInputUxLead");
      const leadOk = !!(lead && String(lead.textContent || "").indexOf("Dej mi pokyn") >= 0);
      return empty && !focused && templateClass && rowTemplate && sendHidden && uxVisible && leadOk;
    }
    return isTemplateModeRestored();
  });
  return { close_modal_reset_ok: ok, overlay_open: true };
}

async function runSaveReset(page) {
  const overlayOpen = await openHomeOverlay(page);
  if (!overlayOpen) return { save_reset_ok: false, overlay_open: false };
  await page.evaluate(() => {
    const el = document.querySelector(".iuSilverChatBackdrop[data-iu-silver-chat-close]");
    if (el && typeof el.click === "function") el.click();
  });
  await page.waitForTimeout(500);
  const ok = await page.evaluate(() => {
    function isTemplateModeRestored() {
      const inp = document.getElementById("iuSilverHomeInput");
      const field = document.querySelector(".iuSilverHomeInputFieldWrap[data-iu-silver-home-input-field]");
      const ux = document.getElementById("iuSilverHomeInputUx");
      const send = document.getElementById("iuSilverHomeSend");
      const row = document.querySelector(".iuSilverHomeInputSendRow");
      if (!inp || !field || !ux || !send || !row) return false;
      const uxSt = getComputedStyle(ux);
      const sendSt = getComputedStyle(send);
      const empty = !String(inp.value || "").length;
      const focused = document.activeElement === inp;
      const templateClass = field.classList.contains("iuSilverHomeInputFieldWrap--template");
      const rowTemplate = row.classList.contains("iuSilverHomeInputSendRow--templateMode");
      const sendHidden = sendSt.display === "none" || Number(sendSt.width) < 4 || sendSt.visibility === "hidden";
      const uxVisible = uxSt.display !== "none";
      const lead = ux.querySelector(".iuSilverHomeInputUxLead");
      const leadOk = !!(lead && String(lead.textContent || "").indexOf("Dej mi pokyn") >= 0);
      return empty && !focused && templateClass && rowTemplate && sendHidden && uxVisible && leadOk;
    }
    return isTemplateModeRestored();
  });
  return { save_reset_ok: ok, overlay_open: true };
}

async function runViewportV3(page, w, h, replayMode) {
  await installProofGuardNetworkStubs(page);
  const ignorableTracker = createIgnorableResourceTracker();
  ignorableTracker.attachToPage(page);
  let appErrors = 0;
  page.on("pageerror", (err) => {
    try {
      const t = String(err && err.message ? err.message : err);
      if (isIgnorableGuardConsoleError(t)) return;
      appErrors += 1;
    } catch (_) {}
  });

  await page.setViewportSize({ width: w, height: h });
  await page.goto(base.envUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2600);

  const overflowX = await page.evaluate(() => {
    const docEl = document.documentElement;
    const body = document.body;
    return (docEl && docEl.scrollWidth > docEl.clientWidth + 1) || (body && body.scrollWidth > body.clientWidth + 1);
  });
  const clsIdle = await page.evaluate(() => Number(window.__iuSilverHomeUxCls || 0));

  let checks = {
    overflow_x: overflowX,
    cls_idle: clsIdle,
    cls_ok: clsIdle <= base.CLS_CAP,
    app_errors: appErrors,
  };

  if (replayMode === "no-colon-insert-replay") {
    checks = Object.assign(checks, await runNoColonInsert(page));
    checks._pass = checks.no_colon_insert_ok && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "touch-spacing-replay") {
    checks = Object.assign(checks, await runTouchSpacing(page));
    checks._pass = checks.touch_spacing_ok && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "template-reset-replay") {
    checks = Object.assign(checks, await runTemplateReset(page));
    checks._pass = checks.template_reset_ok && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "close-modal-reset-replay") {
    checks = Object.assign(checks, await runCloseModalReset(page));
    checks._pass = checks.close_modal_reset_ok && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "save-reset-replay") {
    checks = Object.assign(checks, await runSaveReset(page));
    checks._pass = checks.save_reset_ok && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else {
    checks._pass = false;
  }

  checks.viewport = w + "x" + h;
  checks.mode = replayMode;
  return checks;
}

async function runV3Guard(opts) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  await base.installClsObserver(ctx);
  const replayMode = opts && opts.replayMode ? opts.replayMode : "template-reset-replay";
  const viewports = (opts && opts.viewports) || [
    { w: 390, h: 844 },
    { w: 430, h: 844 },
    { w: 768, h: 1024 },
  ];
  const results = [];
  try {
    for (let i = 0; i < viewports.length; i++) {
      const vp = viewports[i];
      const p = await ctx.newPage();
      try {
        results.push(await runViewportV3(p, vp.w, vp.h, replayMode));
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

function emitV3Banner(title, reportPath, out) {
  base.emitGuardBanner(title, reportPath, out);
}

module.exports = {
  runV3Guard,
  emitV3Banner,
  PREFIX_NO_COLON,
  MIN_LINE_GAP_PX,
  BASE_ACTION_GAP_PX,
  TARGET_ACTION_GAP_PX,
  MIN_ACTION_GAP_PX,
  MAX_LEAD_GAP_PX,
};
