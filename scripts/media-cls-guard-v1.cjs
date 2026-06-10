#!/usr/bin/env node
"use strict";

/* media_cls_guard
   Ověřuje: stabilní render mediálních sekcí — po prvním paintu žádné pozdní doskakování
   obsahu (settle fáze) a žádné layout shifty při průchodu feedem (scroll fáze).
   Stejná konvence jako ostatní repo guardy (reset CLS po boot idle — parse-frame
   insertion-attribution artefakt Chromia v prvních ~150 ms není user-visible jump). */

const { chromium } = require("playwright");
const shared = require("./mobile-stability-guards-v1-shared.cjs");

const GUARD_NAME = "MEDIA_CLS_GUARD_V1";
const REPORT = "scripts/media-cls-guard-v1-report.json";
const SCROLL_CLS_CAP = 0.02;
const SETTLE_CLS_CAP = 0.02;
const BOOT_PAINT_SETTLE_MS = 1200;

const TOPICS = ["zpravy", "sport", "hry", "kultura"];

async function runGuard(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  await ctx.addInitScript(shared.clsInitScript());
  const results = [];
  try {
    for (const vp of shared.VIEWPORTS) {
      for (const topic of TOPICS) {
        const page = await ctx.newPage();
        try {
          await shared.preparePage(page);
          await page.setViewportSize({ width: vp.w, height: vp.h });
          await page.goto(baseUrl + "/projects/?section=media&topic=" + topic, {
            waitUntil: "domcontentloaded",
            timeout: 90000,
          });
          /* Settle fáze: po prvním paintu nesmí obsah dál doskakovat. */
          await page.waitForTimeout(BOOT_PAINT_SETTLE_MS);
          await shared.resetCls(page);
          await page.waitForTimeout(3000);
          const settleCls = await shared.readCls(page);

          /* Scroll fáze: postupný průchod feedem — obrázky/karty nesmí doskakovat. */
          await shared.resetCls(page);
          for (let i = 0; i < 8; i++) {
            await page.evaluate(() => {
              const lc = document.getElementById("leftContent");
              const lcScrolls = lc && lc.scrollHeight > lc.clientHeight + 4 && getComputedStyle(lc).overflowY !== "visible";
              if (lcScrolls) lc.scrollTop += Math.round(window.innerHeight * 0.85);
              else window.scrollBy(0, Math.round(window.innerHeight * 0.85));
            });
            await page.waitForTimeout(320);
          }
          await page.waitForTimeout(900);
          const scrollCls = await shared.readCls(page);

          const articleCount = await page.evaluate(() => document.querySelectorAll("#feed article.news-card").length);
          const r = {
            viewport: vp.w + "x" + vp.h,
            mode: vp.mode,
            topic,
            article_count: articleCount,
            settle_cls: Number(Number(settleCls).toFixed(4)),
            scroll_cls: Number(Number(scrollCls).toFixed(4)),
            settle_cls_cap: SETTLE_CLS_CAP,
            scroll_cls_cap: SCROLL_CLS_CAP,
          };
          r._pass = articleCount > 0 && settleCls <= SETTLE_CLS_CAP && scrollCls <= SCROLL_CLS_CAP;
          results.push(r);
        } finally {
          await page.close();
        }
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
