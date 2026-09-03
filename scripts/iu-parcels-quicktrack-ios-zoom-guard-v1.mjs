/**
 * Parcels overlay: Univerzální vyhledávač (#iuParcelQuickInput) must stay ≥16px
 * on mobile/tablet so iOS Safari does not auto-zoom on focus.
 *
 * Root cause: equal-specificity cascade —
 *   .iu-parcels-quicktrack-input { font-size:16px } (earlier)
 *   .iu-parcel-input { font-size:13px } (later) → computed 13px
 * Quicktrack sits outside .iu-parcel-carrier, so the existing
 * @media (max-width:1023px) .iu-parcel-carrier .iu-parcel-input { 16px } never applied.
 *
 * Fix: .iu-parcel-input.iu-parcels-quicktrack-input { font-size:16px } (after base rule).
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

const CSS = fs.readFileSync(path.join(REPO, "assets", "iu-parcel-overlay.css"), "utf8");
const INDEX = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
const FAILS = [];

function fail(id) {
  FAILS.push(id);
}

// Static: markup retains dual classes on quicktrack + postal inputs
if (!/id="iuParcelQuickInput"[\s\S]{0,220}?class="iu-parcel-input iu-parcels-quicktrack-input"/.test(INDEX)) {
  fail("static_quick_input_classes_missing");
}
if (!/id="iuParcelQuickPostal"[\s\S]{0,220}?class="iu-parcel-input iu-parcels-quicktrack-postal-input"/.test(INDEX)) {
  fail("static_postal_input_classes_missing");
}

// Static: compound override after base .iu-parcel-input, with root-cause comment
if (!/\.iu-parcel-input\.iu-parcels-quicktrack-input\s*\{[\s\S]{0,180}?font-size:\s*16px/.test(CSS)) {
  fail("static_compound_quick_font16_missing");
}
if (!/\.iu-parcel-input\.iu-parcels-quicktrack-postal-input\s*\{[\s\S]{0,180}?font-size:\s*16px/.test(CSS)) {
  fail("static_compound_postal_font16_missing");
}
if (!/equal-specificity cascade|auto-zooms focused inputs when font-size < 16px/i.test(CSS)) {
  fail("static_root_cause_comment_missing");
}

// Base carrier/shared input still 13px (desktop path for carrier rows)
if (!/\.iu-parcel-input\s*\{[\s\S]{0,220}?font-size:\s*13px/.test(CSS)) {
  fail("static_base_parcel_input_13_missing");
}

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

async function activateDeferredOverlayCss(page) {
  await page.evaluate(() => {
    document.querySelectorAll("link[data-iu-defer-overlay-css]").forEach((l) => {
      if (l.media === "print") l.media = "all";
      const href = l.getAttribute("data-iu-href");
      if (href && !l.getAttribute("href")) l.setAttribute("href", href);
    });
  });
}

async function openParcels(page) {
  await page.evaluate(() => {
    if (typeof window.iuParcelsOpenSurface === "function") window.iuParcelsOpenSurface();
  });
  await page.waitForSelector("#iuParcelQuickInput", { timeout: 15000 });
  await activateDeferredOverlayCss(page);
  await page.waitForTimeout(300);
}

async function measureViewport(browser, label, width, height, expectQuickMin, expectCarrierMin) {
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
    await page.waitForTimeout(600);
    await openParcels(page);

    const quickPx = await fontPx(page, "#iuParcelQuickInput");
    if (quickPx == null) fail(`${label}_quick_input_missing`);
    else if (!(quickPx + 0.01 >= expectQuickMin)) {
      fail(`${label}_quick_font_${quickPx}_lt_${expectQuickMin}`);
    }

    const carrierPx = await fontPx(page, ".iu-parcel-carrier .iu-parcel-input");
    if (carrierPx == null) fail(`${label}_carrier_input_missing`);
    else if (expectCarrierMin != null && !(carrierPx + 0.01 >= expectCarrierMin)) {
      fail(`${label}_carrier_font_${carrierPx}_lt_${expectCarrierMin}`);
    } else if (expectCarrierMin == null && carrierPx >= 15.5) {
      fail(`${label}_carrier_unexpected_font16_on_desktop_${carrierPx}`);
    }

    const before = await page.evaluate(() => ({
      iw: window.innerWidth,
      dw: document.documentElement.clientWidth,
      vv: window.visualViewport ? window.visualViewport.scale : 1,
    }));
    await page.locator("#iuParcelQuickInput").click({ force: true });
    await page.waitForTimeout(200);
    await page.locator("#iuParcelQuickInput").fill("Z1234567890");
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({
      iw: window.innerWidth,
      dw: document.documentElement.clientWidth,
      vv: window.visualViewport ? window.visualViewport.scale : 1,
    }));
    if (before.iw !== after.iw || before.dw !== after.dw) {
      fail(`${label}_layout_viewport_changed`);
    }
    if (Math.abs((before.vv || 1) - (after.vv || 1)) > 0.01) {
      fail(`${label}_visual_scale_changed`);
    }

    const overflow = await page.evaluate(() => {
      const card = document.querySelector(".iu-parcels-quicktrack");
      if (!card) return null;
      const r = card.getBoundingClientRect();
      return {
        right: r.right,
        iw: window.innerWidth,
        overflows: r.right > window.innerWidth + 1,
      };
    });
    if (!overflow) fail(`${label}_quicktrack_card_missing`);
    else if (overflow.overflows) fail(`${label}_quicktrack_overflows_viewport`);

    await page.locator("#iuParcelQuickInput").evaluate((el) => el.blur());
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function main() {
  const started = await startGuardStaticServer(pickGuardPort(9542, 400));
  process.env.IU_GUARD_BASE = `http://127.0.0.1:${started.port}/projects/`;
  const browser = await chromium.launch({ headless: true });
  try {
    await measureViewport(browser, "mobile", 390, 844, 16, 16);
    await measureViewport(browser, "tablet", 768, 1024, 16, 16);
    await measureViewport(browser, "desktop", 1400, 900, 16, null);
  } finally {
    await browser.close().catch(() => {});
    await stopGuardProcess(started.proc);
  }

  if (FAILS.length) {
    console.error("IU_PARCELS_QUICKTRACK_IOS_ZOOM_FAIL=" + FAILS.join(","));
    process.exitCode = 1;
    return;
  }
  console.log("IU_PARCELS_QUICKTRACK_IOS_ZOOM_PASS=true");
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
