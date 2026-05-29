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
const TARGET_ACTION_GAP_PX = 14;
const MIN_ACTION_GAP_PX = 13.5;
const TARGET_LEAD_GAP_PX = 9;
const MIN_LEAD_GAP_PX = 8.5;
const BASE_BOX_HEIGHT_V33_PX = { 390: 101, 430: 101, 768: 94 };
const BOX_HEIGHT_ADD_PX = 17;
const EXPECTED_UX_PADDING_TOP_PX = { 390: 6, 430: 6, 768: 7 };
const EXPECTED_UX_PADDING_BOTTOM_PX = { 390: 6, 430: 6, 768: 7 };

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

async function runTouchSpacing(page, viewportW) {
  const w = viewportW || 390;
  const baseBox = BASE_BOX_HEIGHT_V33_PX[w] || BASE_BOX_HEIGHT_V33_PX[390];
  const cfg = {
    actionTarget: TARGET_ACTION_GAP_PX,
    minAction: MIN_ACTION_GAP_PX,
    leadTarget: TARGET_LEAD_GAP_PX,
    minLead: MIN_LEAD_GAP_PX,
    baseBoxH: baseBox,
    minBoxH: baseBox + BOX_HEIGHT_ADD_PX - 0.5,
    expectedPadTop: EXPECTED_UX_PADDING_TOP_PX[w] || EXPECTED_UX_PADDING_TOP_PX[390],
    expectedPadBottom: EXPECTED_UX_PADDING_BOTTOM_PX[w] || EXPECTED_UX_PADDING_BOTTOM_PX[390],
  };
  return page.evaluate((c) => {
    const ux = document.getElementById("iuSilverHomeInputUx");
    const inp = document.getElementById("iuSilverHomeInput");
    if (!ux || !inp) {
      return {
        touch_spacing_ok: false,
        line_gaps_px: [],
        lead_gap_px: null,
        action_gap_target_px: c.actionTarget,
      };
    }
    const uxSt = getComputedStyle(ux);
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
    const padTop = parseFloat(uxSt.paddingTop) || 0;
    const padBottom = parseFloat(uxSt.paddingBottom) || 0;
    const boxH = Math.round(inp.getBoundingClientRect().height);
    const boxAddPx = Math.round((boxH - c.baseBoxH) * 100) / 100;
    const reminderSample = ux.querySelector('[data-iu-silver-home-prefix="reminder"]');
    const reminderLine = reminderSample ? reminderSample.closest(".iuSilverHomeInputUxLine") : null;
    const reminderSampleEl = reminderLine ? reminderLine.querySelector(".iuSilverHomeInputUxSample") : null;
    const reminderText = reminderSampleEl ? String(reminderSampleEl.textContent || "").trim() : "";
    const reminderSampleOk = reminderText.indexOf("Zaplatit nájem v pátek") >= 0 && reminderText.indexOf("do pátku") < 0;
    const actionOk = gaps.length >= 2 && gaps.every((g) => g >= c.minAction);
    const leadOk = leadGap !== null && leadGap >= c.minLead;
    const boxOk = boxH >= c.minBoxH;
    const padStable = Math.abs(padTop - c.expectedPadTop) < 0.6 && Math.abs(padBottom - c.expectedPadBottom) < 0.6;
    return {
      touch_spacing_ok: actionOk && leadOk && boxOk && padStable && reminderSampleOk,
      reminder_sample_ok: reminderSampleOk,
      reminder_sample_text: reminderText,
      line_gaps_px: gaps,
      lead_gap_px: leadGap,
      action_gap_target_px: c.actionTarget,
      action_gap_min_px: c.minAction,
      lead_gap_target_px: c.leadTarget,
      lead_gap_min_px: c.minLead,
      box_height_px: boxH,
      box_height_base_px: c.baseBoxH,
      box_height_add_px: boxAddPx,
      top_padding_px: padTop,
      bottom_padding_px: padBottom,
    };
  }, cfg);
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
    checks = Object.assign(checks, await runTouchSpacing(page, w));
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
  TARGET_ACTION_GAP_PX,
  MIN_ACTION_GAP_PX,
  TARGET_LEAD_GAP_PX,
  MIN_LEAD_GAP_PX,
  BASE_BOX_HEIGHT_V33_PX,
  BOX_HEIGHT_ADD_PX,
};
