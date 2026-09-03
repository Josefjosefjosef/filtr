/**
 * RYCHLÝ PŘEHLED (mobile/tablet): horizontal strip must NOT block vertical page scroll.
 *
 * Root cause: .iuDesktopInfoPanel__scroll had touch-action:pan-x alone → WebKit/Blink
 * accepted only horizontal pans; vertical gestures starting on the strip were dead.
 * Fix: touch-action: pan-x pan-y (horizontal swipe kept; vertical page scroll allowed).
 * Desktop CSS (iu-desktop-info-panel.css) must remain without a forced pan-x-only rule.
 *
 * Run: npm run iu-rychly-prehled-vertical-scroll-guard
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

const MOBILE_CSS = fs.readFileSync(path.join(REPO, "assets", "iu-mobile-info-panel.css"), "utf8");
const DESKTOP_CSS = fs.readFileSync(path.join(REPO, "assets", "iu-desktop-info-panel.css"), "utf8");
const PANEL_JS = fs.readFileSync(path.join(REPO, "assets", "iu-desktop-info-panel.js"), "utf8");
const INDEX = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
const FAILS = [];

function fail(id) {
  FAILS.push(id);
}

// Static: mobile scroll rule allows both axes
const scrollRule = MOBILE_CSS.match(
  /\.iuMobileInfoPanel\s+\.iuDesktopInfoPanel__scroll\s*\{([\s\S]*?)\}/
);
if (!scrollRule) fail("static_mobile_scroll_rule_missing");
else {
  const body = scrollRule[1];
  if (!/touch-action:\s*pan-x\s+pan-y\s*;/.test(body)) fail("static_mobile_touch_action_not_pan_x_pan_y");
  if (/touch-action:\s*pan-x\s*;/.test(body)) fail("static_mobile_sole_pan_x_still_present");
  if (!/overflow-x:\s*auto/.test(body)) fail("static_mobile_overflow_x_auto_missing");
  if (!/Root cause: touch-action:pan-x alone/i.test(MOBILE_CSS)) fail("static_root_cause_comment_missing");
}

// Desktop must not introduce sole pan-x on the shared scroll class
if (/touch-action:\s*pan-x\s*;/.test(DESKTOP_CSS)) fail("static_desktop_sole_pan_x_present");

// No custom touchmove preventDefault carousel hijack in panel JS
if (/addEventListener\(\s*["']touchmove["']/.test(PANEL_JS)) fail("static_js_touchmove_listener");

// Markup + cache bust
if (!/data-iu-home-section-bar="rychly-prehled"/.test(INDEX)) fail("static_rychly_prehled_bar_missing");
if (!/iu-mobile-info-panel\.css\?v=[^"']*rychly-prehled-vertical-scroll/.test(INDEX)) {
  fail("static_css_cache_bust_missing");
}

async function clearTransientGates(page) {
  await page.evaluate(() => {
    try {
      document.body.classList.remove("iu-mobileMainVisible", "iu-mobileGateOverlayOpen");
      document.body.removeAttribute("data-iu-fc");
    } catch (_) {}
  });
}

async function measureViewport(browser, label, width, height) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
    isMobile: width < 600,
  });
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
    await clearTransientGates(page);
    await page.waitForSelector("#iuMobileInfoPanelMount .iuDesktopInfoPanel__scroll", {
      timeout: 45000,
    });
    const info = await page.evaluate(() => {
      const scroll = document.querySelector("#iuMobileInfoPanelMount .iuDesktopInfoPanel__scroll");
      if (!scroll) return null;
      const cs = getComputedStyle(scroll);
      return {
        touchAction: String(cs.touchAction || "").toLowerCase(),
        canScrollX: scroll.scrollWidth > scroll.clientWidth + 2,
        overflowX: cs.overflowX,
      };
    });
    if (!info) {
      fail(`${label}_scroll_missing`);
      return;
    }
    const ta = info.touchAction.replace(/\s+/g, " ");
    const allowsX = /\bpan-x\b/.test(ta) || ta === "auto" || ta === "manipulation";
    const allowsY = /\bpan-y\b/.test(ta) || ta === "auto" || ta === "manipulation";
    if (!allowsX) fail(`${label}_touch_action_blocks_pan_x_${info.touchAction}`);
    if (!allowsY) fail(`${label}_touch_action_blocks_pan_y_${info.touchAction}`);
    if (/\bpan-x\b/.test(ta) && !/\bpan-y\b/.test(ta) && ta !== "manipulation" && ta !== "auto") {
      fail(`${label}_sole_pan_x_${info.touchAction}`);
    }
    if (!info.canScrollX) fail(`${label}_horizontal_scroll_lost`);

    // Horizontal scroll still works (force auto behavior — CSS uses scroll-behavior:smooth)
    const scrolled = await page.evaluate(() => {
      const scroll = document.querySelector("#iuMobileInfoPanelMount .iuDesktopInfoPanel__scroll");
      if (!scroll) return false;
      const before = scroll.scrollLeft;
      const prev = scroll.style.scrollBehavior;
      scroll.style.scrollBehavior = "auto";
      scroll.scrollLeft = Math.min(before + 160, Math.max(0, scroll.scrollWidth - scroll.clientWidth));
      const after = scroll.scrollLeft;
      scroll.style.scrollBehavior = prev;
      return after > before + 2;
    });
    if (!scrolled) fail(`${label}_horizontal_scrollLeft_noop`);
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function main() {
  const started = await startGuardStaticServer(pickGuardPort(9552, 400));
  process.env.IU_GUARD_BASE = `http://127.0.0.1:${started.port}/projects/`;
  const browser = await chromium.launch({ headless: true });
  try {
    await measureViewport(browser, "mobile", 390, 844);
    await measureViewport(browser, "tablet", 768, 1024);
  } finally {
    await browser.close().catch(() => {});
    await stopGuardProcess(started.proc);
  }

  if (FAILS.length) {
    console.error("IU_RYCHLY_PREHLED_VERTICAL_SCROLL_FAIL=" + FAILS.join(","));
    process.exitCode = 1;
    return;
  }
  console.log("IU_RYCHLY_PREHLED_VERTICAL_SCROLL_PASS=true");
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
