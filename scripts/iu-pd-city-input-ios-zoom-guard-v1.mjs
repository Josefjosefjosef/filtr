/**
 * Přehled dne settings: «Město / obec» (.iuPdFeedSearch) must stay ≥16px on mobile/tablet
 * so iOS Safari does not auto-zoom on focus. Shared by ČHMÚ + Dopravní informace.
 *
 * Root cause: body font-size 14px + .iuPdFeedSearch { font: inherit } → 14px < 16px.
 * Fix: @media (max-width: 1024px) { .iuPdFeedSearch { font-size: 16px } }
 * Must NOT disable pinch-to-zoom via viewport maximum-scale / user-scalable=no.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  pickGuardPort,
  startGuardStaticServer,
  stopGuardProcess,
} from "./guards/guard-playwright-lifecycle.mjs";
import { waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const CSS = fs.readFileSync(path.join(REPO, "assets", "iu-prehled-dne-v1.css"), "utf8");
const FEED = fs.readFileSync(path.join(REPO, "assets", "iu-prehled-dne-feed-settings-v1.js"), "utf8");
const INDEX = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
const FAILS = [];

function fail(id) {
  FAILS.push(id);
}

// Static: shared city search class for both panels
if (!/class="iuPdFeedSearch"[\s\S]{0,80}placeholder="Město \/ obec"/.test(FEED) && !/placeholder="Město \/ obec"[\s\S]{0,40}class="iuPdFeedSearch"/.test(FEED)) {
  fail("static_shared_city_input_missing");
}
if (!/data-act="feed-city-q"/.test(FEED)) fail("static_feed_city_q_missing");

// Static: mobile/tablet ≥16px rule present; desktop must not get a global forced 16px outside media
const mobileBlock = CSS.match(/@media\s*\(\s*max-width:\s*1024px\s*\)\s*\{[\s\S]*?\.iuPdFeedSearch\s*\{[\s\S]*?font-size:\s*16px[\s\S]*?\}/);
if (!mobileBlock) fail("static_mobile_font16_missing");
if (!/iOS Safari|auto-zoom|font: inherit/.test(CSS)) fail("static_root_cause_comment_missing");

// Base rule still inherits (desktop path)
if (!/\.iuPdFeedSearch\s*\{[\s\S]{0,220}?font:\s*inherit/.test(CSS)) fail("static_base_font_inherit_missing");

// Viewport must not ban user zoom
const vp = INDEX.match(/<meta[^>]+name=["']viewport["'][^>]*>/i);
if (!vp) fail("static_viewport_missing");
else {
  const content = vp[0];
  if (/maximum-scale\s*=\s*1/i.test(content) || /user-scalable\s*=\s*no/i.test(content)) {
    fail("static_viewport_zoom_disabled");
  }
}

function fontPx(page, sel) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    return parseFloat(getComputedStyle(el).fontSize);
  }, sel);
}

async function openSettingsAndDetail(page, kind) {
  await page.waitForFunction(() => !!document.querySelector('[data-act="open-settings"]'), null, {
    timeout: 60000,
  });
  await page.evaluate(() => {
    try {
      window.__IU_INFO_SYSTEM_CUTOVER__ = true;
    } catch (_) {}
    document.documentElement.classList.add("iu-info-system-cutover");
    const root = document.getElementById("iuPrehledDneRoot");
    if (root) {
      root.style.display = "block";
      root.hidden = false;
    }
  });
  await page.waitForFunction(
    () => {
      const root = document.getElementById("iuPrehledDneRoot");
      return !!(root && root.getAttribute("data-iu-pd-shell-ready") === "1");
    },
    null,
    { timeout: 60000 }
  );
  await page.evaluate(() => document.querySelector('[data-act="open-settings"]')?.click());
  await page.waitForSelector("#iuPdSettings", { timeout: 15000 });
  await page.evaluate((k) => {
    document.querySelector(`[data-act="feed-open-detail"][data-kind="${k}"]`)?.click();
  }, kind);
  await page.waitForSelector(`[data-iu-feed-detail="${kind}"]`, { timeout: 10000 });
  await page.waitForSelector('.iuPdFeedSearch[data-act="feed-city-q"]', { timeout: 10000 });
}

async function measureViewport(browser, label, width, height, expectMin) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
  });
  const page = await ctx.newPage();
  const base = process.env.IU_GUARD_BASE;
  try {
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page, 120000).catch(() => {});
    await page.waitForTimeout(800);

    for (const kind of ["chmu", "traffic"]) {
      if (kind === "traffic") {
        await page.evaluate(() => document.querySelector('[data-act="back-section"]')?.click());
        await page.waitForSelector("[data-iu-pd-feed-main]", { timeout: 10000 }).catch(() => {});
      } else {
        await openSettingsAndDetail(page, kind);
      }
      if (kind === "traffic") {
        await page.evaluate(() =>
          document.querySelector('[data-act="feed-open-detail"][data-kind="traffic"]')?.click()
        );
        await page.waitForSelector('[data-iu-feed-detail="traffic"]', { timeout: 10000 });
        await page.waitForSelector('.iuPdFeedSearch[data-act="feed-city-q"]', { timeout: 10000 });
      }

      const px = await fontPx(page, '.iuPdFeedSearch[data-act="feed-city-q"]');
      if (px == null) fail(`${label}_${kind}_input_missing`);
      else if (expectMin != null && !(px + 0.01 >= expectMin)) {
        fail(`${label}_${kind}_font_${px}_lt_${expectMin}`);
      } else if (expectMin == null && px >= 15.5) {
        /* desktop: must remain inherited (~14px from body), not forced to 16 by a global rule */
        fail(`${label}_${kind}_unexpected_font16_on_desktop_${px}`);
      }

      // Focus cycle: visual scale via layout viewport width must stay stable (Chromium proxy for zoom)
      const before = await page.evaluate(() => ({
        iw: window.innerWidth,
        dw: document.documentElement.clientWidth,
        vv: window.visualViewport ? window.visualViewport.scale : 1,
      }));
      await page.locator('.iuPdFeedSearch[data-act="feed-city-q"]').click({ force: true });
      await page.waitForTimeout(200);
      await page.locator('.iuPdFeedSearch[data-act="feed-city-q"]').fill("Pra");
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => ({
        iw: window.innerWidth,
        dw: document.documentElement.clientWidth,
        vv: window.visualViewport ? window.visualViewport.scale : 1,
      }));
      if (before.iw !== after.iw || before.dw !== after.dw) {
        fail(`${label}_${kind}_layout_viewport_changed`);
      }
      if (Math.abs((before.vv || 1) - (after.vv || 1)) > 0.01) {
        fail(`${label}_${kind}_visual_scale_changed`);
      }
      await page.locator('.iuPdFeedSearch[data-act="feed-city-q"]').evaluate((el) => el.blur());
    }
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function main() {
  const started = await startGuardStaticServer(pickGuardPort(9530, 400));
  process.env.IU_GUARD_BASE = `http://127.0.0.1:${started.port}/projects/`;
  const browser = await chromium.launch({ headless: true });
  try {
    await measureViewport(browser, "mobile", 390, 844, 16);
    await measureViewport(browser, "tablet", 768, 1024, 16);
    await measureViewport(browser, "desktop", 1400, 900, null);
  } finally {
    await browser.close().catch(() => {});
    await stopGuardProcess(started.proc);
  }

  if (FAILS.length) {
    console.error("IU_PD_CITY_INPUT_IOS_ZOOM_FAIL=" + FAILS.join(","));
    process.exitCode = 1;
    return;
  }
  console.log("IU_PD_CITY_INPUT_IOS_ZOOM_PASS=true");
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
