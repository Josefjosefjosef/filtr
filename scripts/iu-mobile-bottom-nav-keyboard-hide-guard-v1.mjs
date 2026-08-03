#!/usr/bin/env node
/**
 * P0: mobil/tablet — #iuMobileBottomNav skrytá při soft keyboard.
 * v2: iOS Safari často dává gap≈0 (innerHeight klesá s VV) → #8461 falešné PASS.
 * Guard musí pokrýt VV gap větev I touch/coarse fallback bez gapu.
 * Run: npm run iu-mobile-bottom-nav-keyboard-hide-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const APP = path.join(REPO, "assets", "app.js");
const UNIFIED = path.join(REPO, "assets", "iu-overlay-mobile-tablet-unified-v1.css");
const INDEX = path.join(REPO, "projects", "index.html");
const SW = path.join(REPO, "sw.js");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8898", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const CSS_BUST =
  "ds-mobile-overlay-nav-flush-v1-20260713-bottom-nav-keyboard-hide-v1-20260802-ds-full-height-v1-20260803-kb-hide-v2-20260803";
const JS_BUST_TOKEN = "kb-hide-v2-20260803";
const SW_VER = "2026-08-03-date-time-fit-v2";

const VIEWPORTS = [
  { name: "MOBILE", width: 390, height: 844 },
  { name: "TABLET", width: 768, height: 1024 },
];

function staticGate() {
  const app = fs.readFileSync(APP, "utf8");
  const unified = fs.readFileSync(UNIFIED, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const sw = fs.readFileSync(SW, "utf8");

  const hideChunk = (() => {
    const parts = app.split("function iuMobileBottomNavKeyboardHideInit()");
    return parts[1] ? parts[1].split(/\n  function /)[0] : "";
  })();

  const checks = [
    { id: "hide_init_fn", pass: /function iuMobileBottomNavKeyboardHideInit\(\)/.test(app) },
    { id: "hide_init_boot", pass: /iuMobileBottomNavKeyboardHideInit\(\)/.test(app) },
    { id: "hide_sets_iu_keyboard_open", pass: /classList\.add\("iu-keyboard-open"\)/.test(hideChunk) },
    { id: "hide_uses_visual_viewport", pass: /visualViewport/.test(hideChunk) },
    { id: "hide_stable_baseline", pass: /stableViewportH/.test(hideChunk) },
    { id: "hide_adaptive_gap", pass: /adaptiveGapMin|KEYBOARD_GAP_PCT/.test(hideChunk) },
    { id: "hide_touch_coarse_fallback", pass: /isTouchCoarseMobile|pointer:\s*coarse/.test(hideChunk) },
    { id: "hide_text_keyboard_likely", pass: /focusTextKeyboardLikely|isTextKeyboardLikelyEl/.test(hideChunk) },
    { id: "hide_no_fixed_gap_100_only", pass: !/KEYBOARD_GAP_MIN\s*=\s*100/.test(hideChunk) },
    { id: "hide_max_width_1024", pass: /max-width:\s*1024px/.test(hideChunk) },
    { id: "hide_excludes_select", pass: /tag === "SELECT"/.test(hideChunk) },
    { id: "hide_excludes_readonly", pass: /readOnly/.test(hideChunk) },
    { id: "hide_excludes_inputmode_none", pass: /inputMode === "none"/.test(hideChunk) },
    { id: "hide_idempotent_guard", pass: /__iuMobileBottomNavKeyboardHideInit/.test(hideChunk) },
    { id: "hide_no_translate_pin", pass: !/translate3d\(0,\s*"\s*\+\s*gap/.test(hideChunk) },
    {
      id: "alias_pin_calls_hide",
      pass: /function iuMojeSluzbyFormBottomNavKeyboardPinInit\(\)\s*\{\s*iuMobileBottomNavKeyboardHideInit\(\);\s*\}/.test(
        app
      ),
    },
    {
      id: "unified_keyboard_open_vars",
      pass: /html\.iu-keyboard-open\s*\{[\s\S]*--bottom-nav-height:\s*0px/.test(unified),
    },
    {
      id: "unified_keeps_safe_var_env",
      pass:
        /--iu-mobile-bottom-safe:\s*env\(safe-area-inset-bottom/.test(unified) &&
        !/html\.iu-keyboard-open\s*\{[\s\S]*--iu-mobile-bottom-safe:\s*0px/.test(unified),
    },
    {
      id: "unified_keyboard_open_nav_display_none",
      pass: /html\.iu-keyboard-open #iuMobileBottomNav\.iu-mobileBottomNav[\s\S]*display:\s*none !important/.test(
        unified
      ),
    },
    {
      id: "unified_beats_overlay_pointer_events",
      pass: /html\.iu-keyboard-open body\.iu-mobileGateOverlayOpen #iuMobileBottomNav/.test(unified),
    },
    {
      id: "index_keyboard_open_nav_display_none",
      pass:
        /html\.iu-keyboard-open #iuMobileBottomNav\.iu-mobileBottomNav/.test(index) &&
        /iu-keyboard-open #iuMobileBottomNav[\s\S]*display:none!important/.test(index),
    },
    {
      id: "index_css_cache_bust",
      pass: new RegExp(`iu-overlay-mobile-tablet-unified-v1\\.css\\?v=${CSS_BUST}`).test(index),
    },
    {
      id: "index_app_cache_bust",
      pass: new RegExp(`app\\.js\\?v=[^"']*${JS_BUST_TOKEN}`).test(index),
    },
    {
      id: "sw_cache_version",
      pass: new RegExp(`CACHE_VERSION = "${SW_VER}"`).test(sw),
    },
  ];

  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, fails, checks };
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

/** Mock VV. open=true shrinks height; open="iosZeroGap" keeps height (== iOS innerHeight shrink). */
async function installVvMock(page) {
  await page.addInitScript(() => {
    const state = { heightFactor: 1, offsetTop: 0, mode: "normal" };
    const listeners = { resize: new Set(), scroll: new Set() };
    const fire = () => {
      listeners.resize.forEach((fn) => {
        try {
          fn();
        } catch (_) {}
      });
    };
    const vv = {
      get width() {
        return window.innerWidth;
      },
      get height() {
        return Math.max(1, Math.round(window.innerHeight * state.heightFactor));
      },
      get offsetTop() {
        return state.offsetTop;
      },
      get offsetLeft() {
        return 0;
      },
      get scale() {
        return 1;
      },
      addEventListener(type, fn) {
        if (listeners[type]) listeners[type].add(fn);
      },
      removeEventListener(type, fn) {
        if (listeners[type]) listeners[type].delete(fn);
      },
      __iuSetKeyboard(mode) {
        if (mode === true || mode === "gap") {
          state.mode = "gap";
          state.heightFactor = 0.55;
          state.offsetTop = 0;
        } else if (mode === "iosZeroGap") {
          /* Simulate iOS: VV height tracks innerHeight → classic gap formula ≈ 0. */
          state.mode = "iosZeroGap";
          state.heightFactor = 1;
          state.offsetTop = 0;
        } else {
          state.mode = "closed";
          state.heightFactor = 1;
          state.offsetTop = 0;
        }
        fire();
      },
    };
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      get() {
        return vv;
      },
    });
    window.__iuMockKeyboard = (mode) => vv.__iuSetKeyboard(mode);
  });
}

async function readNavState(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const nav = document.getElementById("iuMobileBottomNav");
    const cs = nav ? getComputedStyle(nav) : null;
    const rootCs = getComputedStyle(root);
    const rect = nav ? nav.getBoundingClientRect() : null;
    return {
      hasClass: root.classList.contains("iu-keyboard-open"),
      bodyClass: !!(document.body && document.body.classList.contains("iu-keyboard-open")),
      display: cs ? cs.display : "missing",
      visibility: cs ? cs.visibility : "missing",
      pointerEvents: cs ? cs.pointerEvents : "missing",
      height: rect ? Math.round(rect.height) : -1,
      bottomNavHeight: String(rootCs.getPropertyValue("--bottom-nav-height") || "").trim(),
      safeSpace: String(rootCs.getPropertyValue("--iu-mobile-bottom-nav-safe-space") || "").trim(),
      safeVar: String(rootCs.getPropertyValue("--iu-mobile-bottom-safe") || "").trim(),
      navId: nav ? nav.id : null,
    };
  });
}

function isHidden(state) {
  return (
    state.hasClass === true &&
    state.display === "none" &&
    state.pointerEvents === "none" &&
    state.height === 0 &&
    (/^0px$/.test(state.bottomNavHeight) || state.bottomNavHeight === "0")
  );
}

function isVisible(state) {
  return state.hasClass === false && state.display !== "none" && state.height > 40;
}

async function ensureProbeInputs(page) {
  await page.evaluate(() => {
    let host = document.getElementById("iuKbHideGuardHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "iuKbHideGuardHost";
      host.style.cssText = "position:fixed;left:8px;top:8px;z-index:20000;display:flex;gap:8px;flex-wrap:wrap;";
      host.innerHTML =
        '<input id="iuKbHideA" type="text" autocomplete="off" />' +
        '<input id="iuKbHideB" type="text" autocomplete="off" />' +
        '<input id="iuKbHideRo" type="text" readonly value="ro" />' +
        '<input id="iuKbHideCb" type="checkbox" />' +
        '<input id="iuKbHideFile" type="file" />' +
        '<input id="iuKbHideNone" type="text" inputmode="none" />' +
        '<input id="iuKbHideDate" type="date" />';
      document.body.appendChild(host);
    }
  });
}

async function blurActive(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === "function") el.blur();
  });
  await page.waitForTimeout(220);
}

async function runViewport(browser, vp) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await installVvMock(page);
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector("#iuMobileBottomNav", { timeout: 15000 });
    await page.waitForFunction(() => typeof window.__iuMockKeyboard === "function", { timeout: 15000 });
    await page.waitForTimeout(500);
    await ensureProbeInputs(page);

    const idle = await readNavState(page);

    /* A: standard VV gap + focus */
    await page.focus("#iuKbHideA");
    await page.evaluate(() => window.__iuMockKeyboard(true));
    await page.waitForTimeout(120);
    const scenarioA = await readNavState(page);

    /* E: switch fields — no blink */
    const blinkSamples = [];
    await page.focus("#iuKbHideB");
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(30);
      blinkSamples.push(await readNavState(page));
    }
    const noBlink = blinkSamples.every((s) => isHidden(s));

    await page.evaluate(() => window.__iuMockKeyboard(false));
    await blurActive(page);
    const restored = await readNavState(page);

    /* B: iOS zero-gap + text focus → still hide via coarse/touch fallback */
    await page.focus("#iuKbHideA");
    await page.evaluate(() => window.__iuMockKeyboard("iosZeroGap"));
    await page.waitForTimeout(140);
    const scenarioB = await readNavState(page);

    await page.evaluate(() => window.__iuMockKeyboard(false));
    await blurActive(page);

    /* C: gap without focus — must NOT hide */
    await page.evaluate(() => window.__iuMockKeyboard(true));
    await page.waitForTimeout(120);
    const scenarioC = await readNavState(page);
    await page.evaluate(() => window.__iuMockKeyboard(false));
    await page.waitForTimeout(80);

    /* D: unsupported inputs */
    await page.focus("#iuKbHideRo");
    await page.evaluate(() => window.__iuMockKeyboard("iosZeroGap"));
    await page.waitForTimeout(100);
    const readonlyOpen = await readNavState(page);
    await page.evaluate(() => window.__iuMockKeyboard(false));
    await blurActive(page);

    await page.focus("#iuKbHideCb");
    await page.evaluate(() => window.__iuMockKeyboard("iosZeroGap"));
    await page.waitForTimeout(100);
    const checkboxOpen = await readNavState(page);
    await page.evaluate(() => window.__iuMockKeyboard(false));
    await blurActive(page);

    await page.focus("#iuKbHideFile");
    await page.evaluate(() => window.__iuMockKeyboard("iosZeroGap"));
    await page.waitForTimeout(100);
    const fileOpen = await readNavState(page);
    await page.evaluate(() => window.__iuMockKeyboard(false));
    await blurActive(page);

    await page.focus("#iuKbHideNone");
    await page.evaluate(() => window.__iuMockKeyboard("iosZeroGap"));
    await page.waitForTimeout(100);
    const inputModeNone = await readNavState(page);
    await page.evaluate(() => window.__iuMockKeyboard(false));
    await blurActive(page);

    /* H: idempotent re-init flag already set — second call no-op; listeners not multiplied */
    const flagOk = await page.evaluate(() => window.__iuMobileBottomNavKeyboardHideInit === 1);

    /* Real selector */
    const selectorOk = idle.navId === "iuMobileBottomNav";

    const pass =
      isVisible(idle) &&
      isHidden(scenarioA) &&
      isHidden(scenarioB) &&
      isVisible(scenarioC) &&
      isVisible(restored) &&
      noBlink &&
      !readonlyOpen.hasClass &&
      !checkboxOpen.hasClass &&
      !fileOpen.hasClass &&
      !inputModeNone.hasClass &&
      flagOk &&
      selectorOk;

    return {
      viewport: vp.name,
      pass,
      idleOk: isVisible(idle),
      scenarioA: isHidden(scenarioA),
      scenarioB_iosZeroGap: isHidden(scenarioB),
      scenarioC_gapOnly: isVisible(scenarioC),
      restoredOk: isVisible(restored),
      noBlink,
      readonlyOk: !readonlyOpen.hasClass,
      checkboxOk: !checkboxOpen.hasClass,
      fileOk: !fileOpen.hasClass,
      inputModeNoneOk: !inputModeNone.hasClass,
      flagOk,
      selectorOk,
    };
  } finally {
    await context.close();
  }
}

async function runDesktop(browser) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  try {
    await installVvMock(page);
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await ensureProbeInputs(page);
    await page.focus("#iuKbHideA");
    await page.evaluate(() => window.__iuMockKeyboard(true));
    await page.waitForTimeout(150);
    const desk = await readNavState(page);
    return {
      viewport: "DESKTOP",
      pass: desk.hasClass === false && desk.display === "none",
      desk,
    };
  } finally {
    await context.close();
  }
}

async function runDesktopNarrowFalsePositive(browser) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: 900, height: 700 },
  });
  const page = await context.newPage();
  try {
    await installVvMock(page);
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__iuMockKeyboard(true));
    await page.waitForTimeout(150);
    const gapOnly = await readNavState(page);
    return {
      viewport: "NARROW_GAP_ONLY",
      pass: gapOnly.hasClass === false && gapOnly.display !== "none" && gapOnly.height > 40,
      gapOnly,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log("IU_MOBILE_BOTTOM_NAV_KEYBOARD_HIDE_GUARD_FAIL");
    staticResult.fails.forEach((f) => console.error("static:" + f));
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const fp = path.join(REPO, p.replace(/^\/+/, ""));
      if (!fp.startsWith(REPO) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const mime =
        fp.endsWith(".css")
          ? "text/css; charset=utf-8"
          : fp.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : fp.endsWith(".html")
              ? "text/html; charset=utf-8"
              : "application/octet-stream";
      res.writeHead(200, { "content-type": mime });
      res.end(fs.readFileSync(fp));
    } catch (_) {
      res.writeHead(500);
      res.end("err");
    }
  });

  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  await waitForPort("127.0.0.1", PORT, 10000);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const vp of VIEWPORTS) {
      results.push(await runViewport(browser, vp));
    }
    results.push(await runDesktop(browser));
    results.push(await runDesktopNarrowFalsePositive(browser));
  } finally {
    await browser.close();
    server.close();
  }

  const pass = results.every((r) => r.pass);
  if (!pass) {
    console.log("IU_MOBILE_BOTTOM_NAV_KEYBOARD_HIDE_GUARD_FAIL");
    results.filter((r) => !r.pass).forEach((f) => console.error(JSON.stringify(f)));
    process.exit(1);
  }
  console.log("IU_MOBILE_BOTTOM_NAV_KEYBOARD_HIDE_GUARD_PASS");
  results.forEach((r) => console.log(r.viewport + ":PASS"));
}

main().catch((err) => {
  console.log("IU_MOBILE_BOTTOM_NAV_KEYBOARD_HIDE_GUARD_FAIL");
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
