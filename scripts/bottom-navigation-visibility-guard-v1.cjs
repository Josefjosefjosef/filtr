#!/usr/bin/env node
"use strict";

/* bottom_navigation_visibility_guard
   Ověřuje: poslední prvek obsahu (po doscrollování na konec) je plně viditelný NAD fixní
   spodní navigací (#iuMobileBottomNav) — Domů/Silver, mediální sekce, mediální hub.
   Mobil (390×844), tablet portrait (768×1024), telefon landscape (844×390 — pokrývá
   tablet/landscape větev 768–900). */

const { chromium } = require("playwright");
const shared = require("./mobile-stability-guards-v1-shared.cjs");

const GUARD_NAME = "BOTTOM_NAVIGATION_VISIBILITY_GUARD_V1";
const REPORT = "scripts/bottom-navigation-visibility-guard-v1-report.json";
const TOLERANCE_PX = 2;

const SCREENS = [
  { id: "home", path: "/projects/" },
  { id: "media_zpravy", path: "/projects/?section=media&topic=zpravy" },
  { id: "media_sport", path: "/projects/?section=media&topic=sport" },
];

const VIEWPORTS = [
  { w: 390, h: 844, mode: "mobile" },
  { w: 768, h: 1024, mode: "tablet" },
  { w: 844, h: 390, mode: "phone-landscape" },
];

async function measureScreen(page) {
  return page.evaluate((tolerance) => {
    function visible(el) {
      if (!el) return false;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.width > 0;
    }
    const nav = document.getElementById("iuMobileBottomNav");
    if (!visible(nav)) return { nav_visible: false };
    const navTop = nav.getBoundingClientRect().top;
    /* Bottom-most viditelný obsahový prvek mezi hlavními scroll rooty. */
    const roots = [
      document.getElementById("feed"),
      document.getElementById("iuMobileGateWrap"),
      document.querySelector('#iuCenterStage[data-iu-view="quick"]'),
    ].filter(Boolean);
    let maxBottom = null;
    let maxBottomTag = null;
    for (const root of roots) {
      if (!visible(root)) continue;
      const nodes = root.querySelectorAll("*");
      for (const el of nodes) {
        if (el.id === "iuMobileBottomNav" || (nav && nav.contains(el))) continue;
        if (!visible(el)) continue;
        const st = getComputedStyle(el);
        if (st.position === "fixed") continue;
        const r = el.getBoundingClientRect();
        if (r.bottom > (maxBottom === null ? -Infinity : maxBottom)) {
          maxBottom = r.bottom;
          maxBottomTag = (el.tagName || "") + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "");
        }
      }
    }
    const scrollBottomReached =
      Math.abs(window.scrollY + window.innerHeight - document.documentElement.scrollHeight) <= 2;
    return {
      nav_visible: true,
      nav_top: Number(navTop.toFixed(2)),
      max_content_bottom: maxBottom === null ? null : Number(maxBottom.toFixed(2)),
      max_content_el: maxBottomTag,
      content_clears_nav: maxBottom === null ? false : maxBottom <= navTop + tolerance,
      scroll_bottom_reached: scrollBottomReached,
    };
  }, TOLERANCE_PX);
}

async function runGuard(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      try {
        for (const screen of SCREENS) {
          const page = await ctx.newPage();
          try {
            await shared.preparePage(page);
            await page.goto(baseUrl + screen.path, { waitUntil: "domcontentloaded", timeout: 90000 });
            await page.waitForTimeout(3200);
            await shared.scrollAllToBottom(page);
            await page.waitForTimeout(600);
            await shared.scrollAllToBottom(page);
            await page.waitForTimeout(300);
            const m = await measureScreen(page);
            m.viewport = vp.w + "x" + vp.h;
            m.mode = vp.mode;
            m.screen = screen.id;
            m._pass = !!(m.nav_visible && m.content_clears_nav);
            results.push(m);
          } finally {
            await page.close();
          }
        }
      } finally {
        await ctx.close();
      }
    }
  } finally {
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
