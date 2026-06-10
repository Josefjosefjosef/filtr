#!/usr/bin/env node
"use strict";

/* media_load_more_scroll_guard
   Ověřuje: "Načíst další" zachovává čtecí pozici a stabilitu seznamu:
   1. reading_position_stable — viditelný referenční článek zůstává na stejné viewport pozici
      (raw scrollY je pod content-visibility re-estimacemi off-screen karet nevypovídající);
   2. order_preserved — už zobrazené články drží své pořadí (žádné přeskupení);
   3. appended_below — nové články se přidají až pod poslední předchozí položku;
   4. grew — seznam narostl. */

const { chromium } = require("playwright");
const shared = require("./mobile-stability-guards-v1-shared.cjs");

const GUARD_NAME = "MEDIA_LOAD_MORE_SCROLL_GUARD_V1";
const REPORT = "scripts/media-load-more-scroll-guard-v1-report.json";
const READING_POSITION_TOLERANCE_PX = 8;
const WAIT_TIMEOUT_MS = 60000;

/* Deterministický layout-settle (quiescence detection): signatura layoutu (scroll pozice +
   pozice/výšky karet) se nesmí změnit po dobu LAYOUT_QUIET_MS — čeká se na reálný stav DOM,
   ne na pevný odhad doby renderu. */
const LAYOUT_QUIET_MS = 400;
async function waitForLayoutSettle(page) {
  await page.evaluate(() => {
    window.__iuGuardLayoutSig = null;
    window.__iuGuardLayoutSigSince = 0;
  });
  await page.waitForFunction(
    (quietMs) => {
      const arts = document.querySelectorAll('#feed article.news-card[data-feed-type="article"]');
      if (!arts.length) return false;
      let sig = String(Math.round(window.scrollY));
      const n = Math.min(arts.length, 60);
      for (let i = 0; i < n; i++) {
        const r = arts[i].getBoundingClientRect();
        sig += "|" + Math.round(r.top) + ":" + Math.round(r.height);
      }
      const now = performance.now();
      if (window.__iuGuardLayoutSig !== sig) {
        window.__iuGuardLayoutSig = sig;
        window.__iuGuardLayoutSigSince = now;
        return false;
      }
      return now - window.__iuGuardLayoutSigSince >= quietMs;
    },
    LAYOUT_QUIET_MS,
    { timeout: WAIT_TIMEOUT_MS }
  );
}

async function runGuard(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const results = [];
  try {
    for (const vp of shared.VIEWPORTS) {
      const page = await ctx.newPage();
      try {
        await shared.preparePage(page);
        await page.setViewportSize({ width: vp.w, height: vp.h });
        await page.goto(baseUrl + "/projects/?section=media&topic=zpravy", {
          waitUntil: "domcontentloaded",
          timeout: 90000,
        });
        /* Deterministicky: čekat na reálný DOM stav (button viditelný + články vykreslené),
           žádný fixní waitForTimeout — robustní i proti pomalé síti / produkční URL. */
        let btnVisible = true;
        try {
          await page.waitForSelector("#feed .iuLoadMoreBtn", { state: "visible", timeout: WAIT_TIMEOUT_MS });
          await page.waitForFunction(
            () => document.querySelectorAll('#feed article.news-card[data-feed-type="article"]').length > 0,
            undefined,
            { timeout: WAIT_TIMEOUT_MS }
          );
        } catch (_) {
          btnVisible = false;
        }
        if (!btnVisible) {
          results.push({ viewport: vp.w + "x" + vp.h, mode: vp.mode, btn_found: false, btn_visible: false, _pass: false });
          continue;
        }
        /* Locator re-queryuje element — feed se může mezi waity přerendrovat (nový node).
           block:center = stejná geometrie měření jako reálné dočtení k tlačítku. */
        await page.locator("#feed .iuLoadMoreBtn").evaluate((el) => el.scrollIntoView({ block: "center" }));
        /* Nechat content-visibility doreneded viditelné karty po scrollIntoView. */
        await waitForLayoutSettle(page);

        const preClick = await page.evaluate(() => {
          function hrefOf(el) {
            const a = el.querySelector("a.news-titleLink[href]");
            return a ? String(a.getAttribute("href") || "") : "";
          }
          const articles = Array.from(document.querySelectorAll('#feed article.news-card[data-feed-type="article"]'));
          const order = articles.map(hrefOf).filter(Boolean);
          /* Referenční čtecí pozice = nejvyšší článek viditelný ve viewportu. */
          let refHref = null;
          let refTop = null;
          for (const art of articles) {
            const r = art.getBoundingClientRect();
            if (r.bottom > 0 && r.top < window.innerHeight) {
              refHref = hrefOf(art);
              refTop = r.top;
              break;
            }
          }
          return {
            article_count: articles.length,
            order,
            ref_href: refHref,
            ref_top: refTop,
            anchor_href: order.length ? order[order.length - 1] : null,
          };
        });

        if (!preClick.article_count || !preClick.ref_href || !preClick.anchor_href) {
          results.push({ viewport: vp.w + "x" + vp.h, mode: vp.mode, btn_found: true, articles_found: preClick.article_count, _pass: false });
          continue;
        }

        /* page.click = actionability checks (visible, stable, enabled, receives events). */
        await page.click("#feed .iuLoadMoreBtn", { timeout: WAIT_TIMEOUT_MS });
        let growthSeen = true;
        try {
          await page.waitForFunction(
            (prevCount) => document.querySelectorAll('#feed article.news-card[data-feed-type="article"]').length > prevCount,
            preClick.article_count,
            { timeout: WAIT_TIMEOUT_MS }
          );
        } catch (_) {
          growthSeen = false;
        }
        /* Deterministicky počkat na release append-stability vrstvy (phase: "released")
           a na ustálený layout — místo fixního čekání. */
        try {
          await page.waitForFunction(
            () => !window.__iuAppendStab || window.__iuAppendStab.phase === "released",
            undefined,
            { timeout: WAIT_TIMEOUT_MS }
          );
        } catch (_) {}
        await waitForLayoutSettle(page);

        const after = await page.evaluate(({ refHref, anchorHref }) => {
          function hrefOf(el) {
            const a = el.querySelector("a.news-titleLink[href]");
            return a ? String(a.getAttribute("href") || "") : "";
          }
          const articles = Array.from(document.querySelectorAll('#feed article.news-card[data-feed-type="article"]'));
          const order = articles.map(hrefOf).filter(Boolean);
          let refTop = null;
          for (const art of articles) {
            if (hrefOf(art) === refHref) {
              refTop = art.getBoundingClientRect().top;
              break;
            }
          }
          return {
            article_count: articles.length,
            order,
            ref_top: refTop,
            anchor_idx: order.indexOf(anchorHref),
            stab: window.__iuAppendStab || null,
          };
        }, { refHref: preClick.ref_href, anchorHref: preClick.anchor_href });

        const grew = after.article_count > preClick.article_count;
        const refDelta = after.ref_top === null || preClick.ref_top === null ? null : Math.abs(after.ref_top - preClick.ref_top);
        const readingPositionStable = refDelta !== null && refDelta <= READING_POSITION_TOLERANCE_PX;
        /* Pořadí: dříve zobrazené články musí tvořit prefix nového seznamu ve stejném pořadí. */
        const prefix = after.order.slice(0, preClick.order.length);
        const orderPreserved = preClick.order.length > 0 && prefix.join("\n") === preClick.order.join("\n");
        /* Nové články jen pod poslední předchozí položkou. */
        const appendedBelow = after.anchor_idx === preClick.order.length - 1;

        const r = {
          viewport: vp.w + "x" + vp.h,
          mode: vp.mode,
          btn_found: true,
          btn_visible: true,
          btn_clicked: true,
          growth_seen: growthSeen,
          before_count: preClick.article_count,
          after_count: after.article_count,
          grew,
          reading_position_delta_px: refDelta === null ? null : Number(refDelta.toFixed(2)),
          reading_position_stable: readingPositionStable,
          order_preserved: orderPreserved,
          appended_below: appendedBelow,
          anchor_idx_after: after.anchor_idx,
          stab_release: after.stab ? after.stab.releaseReason : null,
          tolerance_px: READING_POSITION_TOLERANCE_PX,
        };
        r._pass = grew && readingPositionStable && orderPreserved && appendedBelow;
        results.push(r);
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
