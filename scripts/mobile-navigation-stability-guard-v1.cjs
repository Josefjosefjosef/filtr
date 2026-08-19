#!/usr/bin/env node
"use strict";

/* mobile_navigation_stability_guard
   Ověřuje: přechody mezi sekcemi (Domů → Zprávy → Domů → Sport, MindMenu roundtrip) řízené
   reálnými kliknutími (jako uživatel) — bez layout flash: kumulativní layout shift
   (bez hadRecentInput okna) během přechodů pod capem. */

const { chromium } = require("playwright");
const shared = require("./mobile-stability-guards-v1-shared.cjs");

const GUARD_NAME = "MOBILE_NAVIGATION_STABILITY_GUARD_V1";
const REPORT = "scripts/mobile-navigation-stability-guard-v1-report.json";
const TRANSITION_CLS_CAP = 0.02;

async function clickIfVisible(page, selector) {
  const el = page.locator(selector).first();
  try {
    await el.scrollIntoViewIfNeeded({ timeout: 4000 });
    if (await el.isVisible()) {
      await el.click();
      return true;
    }
  } catch (_) {}
  return false;
}

async function runGuard(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  await shared.installStabilityGuardContext(ctx);
  const results = [];
  try {
    for (const vp of shared.VIEWPORTS) {
      const page = await ctx.newPage();
      try {
        await shared.preparePage(page);
        await page.setViewportSize({ width: vp.w, height: vp.h });
        await page.goto(baseUrl + shared.withLegacyMediaParams("/"), {
          waitUntil: "domcontentloaded",
          timeout: 90000,
        });
        await shared.dismissGuardOverlays(page);
        await page.waitForTimeout(3600);
        // LDP can re-open during idle settle; clear again so CLS measures real section taps.
        await shared.dismissGuardOverlays(page);

        const transitions = [];

        /* Domů → Zprávy (tap na Silver media preview kartu) */
        await shared.resetCls(page);
        const zpravyClicked = await clickIfVisible(page, '[data-iu-news-preview-card="1"]');
        await page.waitForTimeout(3400);
        transitions.push({ id: "home_to_zpravy_click", cls: await shared.readCls(page), clicked: zpravyClicked });

        /* Zprávy → Domů (spodní navigace) */
        await shared.resetCls(page);
        const homeClicked = await clickIfVisible(page, '[data-iu-bottom-nav="home"]');
        await page.waitForTimeout(3000);
        transitions.push({ id: "zpravy_to_home_bottom_nav", cls: await shared.readCls(page), clicked: homeClicked });

        /* Domů → Sport (tap na Silver sport preview kartu) */
        await shared.resetCls(page);
        const sportClicked = await clickIfVisible(page, '[data-iu-sport-preview-card="1"]');
        await page.waitForTimeout(3400);
        transitions.push({ id: "home_to_sport_click", cls: await shared.readCls(page), clicked: sportClicked });

        /* Sport → Domů → MindMenu → Domů (spodní navigace) */
        await shared.resetCls(page);
        const homeClicked2 = await clickIfVisible(page, '[data-iu-bottom-nav="home"]');
        await page.waitForTimeout(1800);
        const mindClicked = await clickIfVisible(page, '[data-iu-bottom-nav="mindmenu"]');
        await page.waitForTimeout(1600);
        const backHome = await clickIfVisible(page, '[data-iu-bottom-nav="home"]');
        await page.waitForTimeout(1600);
        transitions.push({
          id: "mindmenu_roundtrip",
          cls: await shared.readCls(page),
          clicked: homeClicked2 && mindClicked && backHome,
        });

        const merged = {
          viewport: vp.w + "x" + vp.h,
          mode: vp.mode,
          transitions: transitions.map((t) => ({ id: t.id, cls: Number(Number(t.cls).toFixed(4)), clicked: t.clicked !== false })),
          cls_cap: TRANSITION_CLS_CAP,
        };
        merged._pass = transitions.every((t) => Number(t.cls) <= TRANSITION_CLS_CAP && t.clicked !== false);
        results.push(merged);
      } finally {
        await page.close();
      }
    }
  } finally {
    await ctx.close();
    await browser.close();
  }
  return { pass: results.every((r) => r._pass), results, url: baseUrl };
}

module.exports = { runGuard, GUARD_NAME, REPORT };

if (require.main === module) {
  shared.runStandalone(runGuard, GUARD_NAME, REPORT).catch((e) => {
    process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
    process.exit(1);
  });
}
