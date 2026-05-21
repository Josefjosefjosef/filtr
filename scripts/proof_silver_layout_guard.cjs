#!/usr/bin/env node
/**
 * Silver mobile/tablet layout anti-regression guard (Playwright, production).
 *
 * Rules (viewport 390×844 and 768×1024):
 * - image_to_input_gap = inputTop - imageBottom  → 0..2 px
 * - gap_input_to_buttons = buttonsTop - inputBottom
 * - gap_buttons_to_card_bottom = cardBottom - buttonsBottom
 * - button_gap_delta = |gap_input_to_buttons - gap_buttons_to_card_bottom| ≤ 8
 * - Calendar / Úkoly / Poznámky smoke; no mic; submit shows arrow only
 * - overflowX false; no console errors; no page errors; CLS cap after idle paint
 * - Open-Meteo fetch stubbed in proof (see proofs/open_meteo_guard_stub.cjs) — external API CORS is not layout signal
 *
 * Env: SILVER_LAYOUT_GUARD_URL (default https://infouzel.cz/projects/)
 */
"use strict";

const { chromium } = require("playwright");
const {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const DEFAULT_URL = "https://infouzel.cz/projects/";
const CLS_CAP = 0.02;

function envUrl() {
  const u = String(process.env.SILVER_LAYOUT_GUARD_URL || DEFAULT_URL).trim();
  return u || DEFAULT_URL;
}

async function installClsObserver(context) {
  await context.addInitScript(() => {
    try {
      window.__iuSilverLayoutCls = 0;
      new PerformanceObserver(function (list) {
        const entries = list.getEntries();
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (!e.hadRecentInput && e.value) {
            window.__iuSilverLayoutCls = (window.__iuSilverLayoutCls || 0) + e.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });
}

async function readCls(page) {
  return page.evaluate(() => Number(window.__iuSilverLayoutCls || 0));
}

async function runViewport(page, w, h) {
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

  const geom = await page.evaluate(() => {
    const hero =
      document.getElementById("iuSilverHeroPremium") ||
      document.querySelector(".iu-silver-hero-vertical-gap-p0");
    const img = document.querySelector("#iuSilverHeroPremium .iu-hero-figureImg");
    const inp = document.getElementById("iuSilverHomeInput");
    const sendBtn = document.getElementById("iuSilverHomeSend");
    const quick = document.querySelector("#iuSilverHeroPremium .iu-hero-quickActions.iu-hero-actions");
    const docEl = document.documentElement;
    const body = document.body;
    const overflowX =
      (docEl && docEl.scrollWidth > docEl.clientWidth + 1) ||
      (body && body.scrollWidth > body.clientWidth + 1);

    let imageBottom = null;
    let inputTop = null;
    let inputBottom = null;
    let buttonsTop = null;
    let buttonsBottom = null;
    let cardBottom = null;
    if (img) imageBottom = img.getBoundingClientRect().bottom;
    if (inp) {
      const r = inp.getBoundingClientRect();
      inputTop = r.top;
      inputBottom = r.bottom;
    }
    if (quick) {
      const r = quick.getBoundingClientRect();
      buttonsTop = r.top;
      buttonsBottom = r.bottom;
    }
    if (hero) cardBottom = hero.getBoundingClientRect().bottom;

    const imageToInputGap =
      imageBottom != null && inputTop != null ? Math.round(inputTop - imageBottom) : null;
    const gapInputToButtons =
      inputBottom != null && buttonsTop != null ? Math.max(0, Math.round(buttonsTop - inputBottom)) : null;
    const gapButtonsToCardBottom =
      cardBottom != null && buttonsBottom != null ? Math.max(0, Math.round(cardBottom - buttonsBottom)) : null;
    const buttonGapDelta =
      gapInputToButtons != null && gapButtonsToCardBottom != null
        ? Math.abs(gapInputToButtons - gapButtonsToCardBottom)
        : null;

    const micEl = sendBtn ? sendBtn.querySelector(".iuSilverHomeSendIcon--mic") : null;
    const sendEl = sendBtn ? sendBtn.querySelector(".iuSilverHomeSendIcon--send") : null;
    const micDisplay = micEl ? getComputedStyle(micEl).display : "none";
    const sendDisplay = sendEl ? getComputedStyle(sendEl).display : "";
    const micPresent = micDisplay !== "none" && micDisplay !== "";
    const submitArrowOnly = !micPresent && sendDisplay !== "none";

    return {
      heroFound: !!hero,
      imgFound: !!img,
      inpFound: !!inp,
      quickFound: !!quick,
      image_to_input_gap_px: imageToInputGap,
      gap_input_to_buttons_px: gapInputToButtons,
      gap_buttons_to_card_bottom_px: gapButtonsToCardBottom,
      button_gap_delta_px: buttonGapDelta,
      mic_present: micPresent,
      submit_arrow_only: submitArrowOnly,
      overflowX,
    };
  });

  const cls = await readCls(page);

  let calendarFlowOk = false;
  let tasksOk = false;
  let notesOk = false;
  try {
    await page.locator("#iuHeroQuickCal").scrollIntoViewIfNeeded();
    await page.click("#iuHeroQuickCal", { timeout: 15000, force: true });
    await page.waitForTimeout(600);
    calendarFlowOk = await page.evaluate(() => {
      const overlay = document.getElementById("iuCalendarOverlay");
      const open = !!(overlay && !overlay.hasAttribute("hidden") && overlay.getAttribute("aria-hidden") !== "true");
      const oldSave = document.querySelector('[data-iu-silver-guided="save"]');
      const oldSearch = document.querySelector('[data-iu-silver-guided="search"]');
      const oldCancel = document.querySelector('[data-iu-silver-guided="cal-back"]');
      const miniCalGrid = document.querySelector(".iuSilverMiniCal__grid");
      const composeAux = document.querySelector("[data-iu-silver-calendar-compose-aux]");
      function vis(el) {
        if (!el) return false;
        const st = window.getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      }
      if (vis(oldSave) || vis(oldSearch) || vis(oldCancel)) return false;
      if (miniCalGrid && vis(miniCalGrid)) return false;
      if (composeAux && vis(composeAux)) return false;
      return open;
    });
    try {
      await page.keyboard.press("Escape");
    } catch (_) {}
    await page.waitForTimeout(200);
  } catch (_) {
    calendarFlowOk = false;
  }
  try {
    await page.locator("#iuHeroQuickTasks").scrollIntoViewIfNeeded();
    await page.click("#iuHeroQuickTasks", { timeout: 15000, force: true });
    await page.waitForTimeout(350);
    tasksOk = true;
  } catch (_) {
    tasksOk = false;
  }
  try {
    await page.locator("#iuHeroQuickNotes").scrollIntoViewIfNeeded();
    await page.click("#iuHeroQuickNotes", { timeout: 15000, force: true });
    await page.waitForTimeout(350);
    notesOk = true;
  } catch (_) {
    notesOk = false;
  }

  page.off("console", onConsole);
  page.off("pageerror", onPageError);

  const ignorableOpts = {
    hadRecentIgnorableFailure: ignorableTracker.hadRecentIgnorableFailure.bind(ignorableTracker),
  };
  const consoleErrors = rawConsoleErrors.filter(
    (t) => !isIgnorableGuardConsoleError(t, ignorableOpts)
  );

  const g = geom;
  const imageGapPass =
    g.image_to_input_gap_px != null && g.image_to_input_gap_px >= 0 && g.image_to_input_gap_px <= 2;
  const buttonGapPass = g.button_gap_delta_px != null && g.button_gap_delta_px <= 8;
  const clsPass = cls <= CLS_CAP;

  const pass =
    g.heroFound &&
    g.imgFound &&
    g.inpFound &&
    g.quickFound &&
    imageGapPass &&
    buttonGapPass &&
    calendarFlowOk &&
    tasksOk &&
    notesOk &&
    !g.mic_present &&
    g.submit_arrow_only &&
    !g.overflowX &&
    consoleErrors.length === 0 &&
    appErrors === 0 &&
    clsPass;

  return {
    image_to_input_gap_px: g.image_to_input_gap_px,
    image_gap_pass: imageGapPass,
    gap_input_to_buttons_px: g.gap_input_to_buttons_px,
    gap_buttons_to_card_bottom_px: g.gap_buttons_to_card_bottom_px,
    button_gap_delta_px: g.button_gap_delta_px,
    button_gap_pass: buttonGapPass,
    calendar_flow_ok: calendarFlowOk,
    tasks_ok: tasksOk,
    notes_ok: notesOk,
    mic_present: g.mic_present,
    submit_arrow_only: g.submit_arrow_only,
    overflowX: g.overflowX,
    consoleErrorsCount: consoleErrors.length,
    appErrorsCount: appErrors,
    cls,
    cls_pass: clsPass,
    consoleErrorsText: consoleErrors.slice(),
    _pass: pass,
  };
}

function formatBlock(label, o) {
  const lines = [
    `${label}:`,
    "  image_to_input_gap_px: " + o.image_to_input_gap_px,
    "  image_gap_pass: " + o.image_gap_pass,
    "  gap_input_to_buttons_px: " + o.gap_input_to_buttons_px,
    "  gap_buttons_to_card_bottom_px: " + o.gap_buttons_to_card_bottom_px,
    "  button_gap_delta_px: " + o.button_gap_delta_px,
    "  button_gap_pass: " + o.button_gap_pass,
    "  calendar_flow_ok: " + o.calendar_flow_ok,
    "  tasks_ok: " + o.tasks_ok,
    "  notes_ok: " + o.notes_ok,
    "  mic_present: " + o.mic_present,
    "  submit_arrow_only: " + o.submit_arrow_only,
    "  overflowX: " + o.overflowX,
    "  consoleErrorsCount: " + o.consoleErrorsCount,
    "  appErrorsCount: " + o.appErrorsCount,
    "  cls: " + o.cls,
    "  cls_pass: " + o.cls_pass,
  ];
  if (Array.isArray(o.consoleErrorsText) && o.consoleErrorsText.length) {
    lines.push("  console_errors_text:");
    for (let ci = 0; ci < o.consoleErrorsText.length; ci++) {
      lines.push("    - " + String(o.consoleErrorsText[ci]).slice(0, 800));
    }
  }
  return lines.join("\n");
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  await installClsObserver(ctx);

  let v390;
  let v768;
  try {
    const p390 = await ctx.newPage();
    try {
      v390 = await runViewport(p390, 390, 844);
    } finally {
      await p390.close();
    }
    const p768 = await ctx.newPage();
    try {
      v768 = await runViewport(p768, 768, 1024);
    } finally {
      await p768.close();
    }
  } finally {
    await ctx.close();
    await browser.close();
  }

  const finalPass = v390._pass && v768._pass;
  delete v390._pass;
  delete v768._pass;

  process.stdout.write("=== SILVER_LAYOUT_GUARD ===\n\n");
  process.stdout.write(formatBlock("viewport_390x844", v390) + "\n\n");
  process.stdout.write(formatBlock("viewport_768x1024", v768) + "\n\n");
  process.stdout.write("FINAL_STATUS: " + (finalPass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("=== END_SILVER_LAYOUT_GUARD ===\n");

  if (!finalPass) process.exitCode = 1;
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
