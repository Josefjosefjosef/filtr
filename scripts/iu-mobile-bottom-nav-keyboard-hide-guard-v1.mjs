#!/usr/bin/env node
/**
 * P0: mobil/tablet — #iuMobileBottomNav skrytá při soft keyboard.
 * v3: okamžitá obnova po zavření VV i bez blur (iOS); focus fallback jen opening grace.
 * Run: npm run iu-mobile-bottom-nav-keyboard-hide-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";
import {
  RESTORE_DEADLINE_MS,
  HIDE_DEADLINE_MS,
  DETECT_DEADLINE_MS,
  waitForNavPredicate,
  inPageWaitNav,
  assertKeyboardHideIdle,
} from "./guards/iu-mobile-kb-hide-wait.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const APP = path.join(REPO, "assets", "app.js");
const UNIFIED = path.join(REPO, "assets", "iu-overlay-mobile-tablet-unified-v1.css");
const INDEX = path.join(REPO, "projects", "index.html");
const SW = path.join(REPO, "sw.js");
/* 0 = ephemeral free port (avoids EADDRINUSE under process stress). */
let PORT = parseInt(process.env.IU_GUARD_PORT || "0", 10);
if (!Number.isFinite(PORT) || PORT < 0) PORT = 0;
let BASE = "";
const CSS_BUST =
  "ds-mobile-overlay-nav-flush-v1-20260713-bottom-nav-keyboard-hide-v1-20260802-ds-full-height-v1-20260803-kb-hide-v2-20260803-kb-restore-v3-20260803-bottom-nav-unify-v1-20260804";
const JS_BUST_TOKEN = "bottom-nav-unify-v1-20260804";
const SW_VER = "2026-08-14-i34-km-range-signs-windsocks-v1";
/* Must match assets/app.js FOCUS_OPEN_GRACE_MS — do not change product grace. */
const FOCUS_OPEN_GRACE_MS = 420;

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
    { id: "hide_opening_grace", pass: /FOCUS_OPEN_GRACE_MS|focusOpenGraceUntil/.test(hideChunk) },
    { id: "hide_geom_keyboard_open", pass: /geomKeyboardOpen|isGeomKeyboardOpenNow/.test(hideChunk) },
    { id: "hide_sync_hide_now", pass: /syncHideNow/.test(hideChunk) },
    { id: "hide_blur_handoff_short", pass: /BLUR_HANDOFF_MS\s*=\s*70/.test(hideChunk) },
    { id: "hide_no_permanent_focus_only", pass: !/if \(focusTextKeyboardLikely && isTouchCoarseMobile\(\)\) return true;/.test(hideChunk) },
    { id: "hide_scroll_snap", pass: /captureScrollSnap|restoreScrollIfNeeded|userScrolledWhileKb/.test(hideChunk) },
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
      const req = http.request({ host, port, path: "/", method: "HEAD", timeout: 800 }, (res) => {
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
    window.__iuVvListenerCounts = () => ({
      resize: listeners.resize.size,
      scroll: listeners.scroll.size,
    });
  });
}

async function readNavState(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const nav = document.getElementById("iuMobileBottomNav");
    const cs = nav ? getComputedStyle(nav) : null;
    const rootCs = getComputedStyle(root);
    const rect = nav ? nav.getBoundingClientRect() : null;
    const ae = document.activeElement;
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
      activeId: ae && ae.id ? String(ae.id) : "",
      scrollY: window.scrollY || window.pageYOffset || 0,
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
      host.style.cssText =
        "position:fixed;left:8px;top:8px;z-index:20000;display:flex;gap:8px;flex-wrap:wrap;";
      host.innerHTML =
        '<input id="iuKbHideA" type="text" autocomplete="off" />' +
        '<input id="iuKbHideB" type="text" autocomplete="off" />' +
        '<input id="iuKbHideRo" type="text" readonly value="ro" />' +
        '<input id="iuKbHideCb" type="checkbox" />' +
        '<input id="iuKbHideFile" type="file" />' +
        '<input id="iuKbHideNone" type="text" inputmode="none" />' +
        '<input id="iuKbHideDate" type="date" />' +
        '<div id="iuCustomButtonsScrollHost" style="position:fixed;left:8px;top:120px;width:280px;height:160px;overflow:auto;z-index:20000;background:#fff;border:1px solid #ccc;">' +
        '<div style="height:800px;padding:8px;">overlay scroll probe</div></div>';
      document.body.appendChild(host);
    }
  });
}

async function blurActive(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === "function") el.blur();
  });
  await page.waitForTimeout(100);
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
    const scrollBefore = idle.scrollY;

    /* A: standard VV gap + focus → hide */
    await page.focus("#iuKbHideA");
    await inPageWaitNav(page, {
      expectHidden: true,
      deadlineMs: HIDE_DEADLINE_MS,
      action: "open",
    });
    const scenarioA = await readNavState(page);

    /* D: switch fields — no blink */
    const blinkSamples = [];
    await page.focus("#iuKbHideB");
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(25);
      blinkSamples.push(await readNavState(page));
    }
    const noBlink = blinkSamples.every((s) => isHidden(s));

    /* C: close with blur — in-page restore timing (≤350ms assert). */
    const restoredBlurWait = await page.evaluate(async () => {
      const readVisible = () => {
        const root = document.documentElement;
        const nav = document.getElementById("iuMobileBottomNav");
        const cs = nav ? getComputedStyle(nav) : null;
        const rect = nav ? nav.getBoundingClientRect() : null;
        const hasClass = root.classList.contains("iu-keyboard-open");
        const height = rect ? Math.round(rect.height) : -1;
        const display = cs ? cs.display : "missing";
        return hasClass === false && display !== "none" && height > 40;
      };
      window.__iuMockKeyboard(false);
      const el = document.activeElement;
      if (el && typeof el.blur === "function") el.blur();
      const t0 = performance.now();
      while (performance.now() - t0 <= 350) {
        if (readVisible()) return { ok: true, elapsedMs: performance.now() - t0 };
        await new Promise((r) => requestAnimationFrame(() => r(true)));
      }
      return { ok: false, elapsedMs: performance.now() - t0 };
    });
    const restoredBlur = await readNavState(page);
    const restoreBlurMs = restoredBlurWait.elapsedMs;

    /* B: close WITHOUT blur — input stays focused, VV returns → instant restore */
    await page.focus("#iuKbHideA");
    await page.type("#iuKbHideA", "x");
    const openBeforeWait = await inPageWaitNav(page, {
      expectHidden: true,
      deadlineMs: HIDE_DEADLINE_MS,
      action: "open",
    });
    const openBeforeCloseNoBlur = await readNavState(page);
    const closeWait = await inPageWaitNav(page, {
      expectHidden: false,
      deadlineMs: RESTORE_DEADLINE_MS,
      action: "close",
    });
    const closeNoBlur = await readNavState(page);
    const restoreNoBlurMs = closeWait.elapsedMs;
    const stillFocused = closeNoBlur.activeId === "iuKbHideA";
    const formValueOk = await page.evaluate(() => {
      const el = document.getElementById("iuKbHideA");
      return !!(el && el.value && el.value.indexOf("x") >= 0);
    });
    const restoreNoBlurWithinDeadline =
      closeWait.ok === true &&
      openBeforeWait.ok === true &&
      restoreNoBlurMs <= RESTORE_DEADLINE_MS;

    /* Opening grace (iosZeroGap within grace) → hide without VV gap.
       Focus + mock MUST be same turn: a later iosZeroGap resize while open===true
       clears focusOpenGraceUntil (product keyboard-closed path) and races the assert. */
    await blurActive(page);
    const tGrace0 = Date.now();
    const openingGraceWait = await page.evaluate(async (graceMs) => {
      const el = document.getElementById("iuKbHideA");
      if (el) el.focus();
      window.__iuMockKeyboard("iosZeroGap");
      const readHidden = () => {
        const root = document.documentElement;
        const nav = document.getElementById("iuMobileBottomNav");
        const cs = nav ? getComputedStyle(nav) : null;
        const rect = nav ? nav.getBoundingClientRect() : null;
        const rootCs = getComputedStyle(root);
        const hasClass = root.classList.contains("iu-keyboard-open");
        const height = rect ? Math.round(rect.height) : -1;
        const display = cs ? cs.display : "missing";
        const pointerEvents = cs ? cs.pointerEvents : "missing";
        const bottomNavHeight = String(rootCs.getPropertyValue("--bottom-nav-height") || "").trim();
        return (
          hasClass === true &&
          display === "none" &&
          pointerEvents === "none" &&
          height === 0 &&
          (/^0px$/.test(bottomNavHeight) || bottomNavHeight === "0")
        );
      };
      const t0 = performance.now();
      const deadline = Math.max(80, graceMs - 80);
      while (performance.now() - t0 <= deadline) {
        if (readHidden()) return { ok: true, elapsedMs: performance.now() - t0 };
        await new Promise((r) => requestAnimationFrame(() => r(true)));
      }
      return { ok: false, elapsedMs: performance.now() - t0 };
    }, FOCUS_OPEN_GRACE_MS);
    const openingGrace = await readNavState(page);

    /* After grace without geom evidence → must NOT stay stuck hidden */
    const graceEndAt = tGrace0 + FOCUS_OPEN_GRACE_MS + 48;
    const remainAfterGrace = Math.max(0, graceEndAt - Date.now());
    if (remainAfterGrace > 0) await page.waitForTimeout(remainAfterGrace);
    const graceExpiredWait = await waitForNavPredicate(page, isVisible, DETECT_DEADLINE_MS, () =>
      readNavState(page)
    );
    const graceExpired = graceExpiredWait.state || (await readNavState(page));
    await page.evaluate(() => window.__iuMockKeyboard(false));
    await blurActive(page);

    /* Gap without focus — must NOT hide */
    await page.evaluate(() => {
      ["iuKbHideA", "iuKbHideB", "iuKbHideRo", "iuKbHideNone"].forEach((id) => {
        const el = document.getElementById(id);
        if (el && typeof el.blur === "function") el.blur();
      });
      window.__iuMockKeyboard(false);
    });
    await page.waitForTimeout(90);
    await waitForNavPredicate(page, isVisible, RESTORE_DEADLINE_MS, () => readNavState(page));
    await page.evaluate(() => window.__iuMockKeyboard(true));
    let gapOnlyOk = true;
    let gapOnly = await readNavState(page);
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(25);
      gapOnly = await readNavState(page);
      if (!isVisible(gapOnly)) gapOnlyOk = false;
    }
    await page.evaluate(() => window.__iuMockKeyboard(false));
    await waitForNavPredicate(page, isVisible, RESTORE_DEADLINE_MS, () => readNavState(page));

    /* Unsupported inputs */
    await page.focus("#iuKbHideRo");
    await page.evaluate(() => window.__iuMockKeyboard("iosZeroGap"));
    await page.waitForTimeout(80);
    const readonlyOpen = await readNavState(page);
    await page.evaluate(() => window.__iuMockKeyboard(false));
    await blurActive(page);

    await page.focus("#iuKbHideCb");
    await page.evaluate(() => window.__iuMockKeyboard("iosZeroGap"));
    await page.waitForTimeout(80);
    const checkboxOpen = await readNavState(page);
    await page.evaluate(() => window.__iuMockKeyboard(false));
    await blurActive(page);

    await page.focus("#iuKbHideFile");
    await page.evaluate(() => window.__iuMockKeyboard("iosZeroGap"));
    await page.waitForTimeout(80);
    const fileOpen = await readNavState(page);
    await page.evaluate(() => window.__iuMockKeyboard(false));
    await blurActive(page);

    await page.focus("#iuKbHideNone");
    await page.evaluate(() => window.__iuMockKeyboard("iosZeroGap"));
    await page.waitForTimeout(80);
    const inputModeNone = await readNavState(page);
    await page.evaluate(() => window.__iuMockKeyboard(false));
    await blurActive(page);

    /* G: overlay scroll preserved across open/close without user scroll */
    await page.evaluate(() => {
      const ov = document.getElementById("iuCustomButtonsScrollHost");
      if (ov) ov.scrollTop = 220;
    });
    const overlayBefore = await page.evaluate(() => {
      const ov = document.getElementById("iuCustomButtonsScrollHost");
      return ov ? ov.scrollTop : -1;
    });
    await page.focus("#iuKbHideA");
    await inPageWaitNav(page, {
      expectHidden: true,
      deadlineMs: HIDE_DEADLINE_MS,
      action: "open",
    });
    await inPageWaitNav(page, {
      expectHidden: false,
      deadlineMs: RESTORE_DEADLINE_MS,
      action: "close",
    });
    const overlayAfter = await page.evaluate(() => {
      const ov = document.getElementById("iuCustomButtonsScrollHost");
      return ov ? ov.scrollTop : -1;
    });
    await blurActive(page);

    /* H: ten open/close cycles — condition wait (DETECT budget; product 200ms is scenario B). */
    let tenOk = true;
    let pendingTimerCheckOk = true;
    let listenerCleanupOk = true;
    let tenReason = "ok";
    const listenerBaseline = await page.evaluate(() =>
      typeof window.__iuVvListenerCounts === "function" ? window.__iuVvListenerCounts() : null
    );
    for (let i = 0; i < 10; i++) {
      const before = await readNavState(page);
      if (!isVisible(before)) {
        tenOk = false;
        tenReason = "dirty_start";
        break;
      }
      await page.focus("#iuKbHideA");
      await page.evaluate(() => window.__iuMockKeyboard(true));
      const midWait = await waitForNavPredicate(page, isHidden, DETECT_DEADLINE_MS, () =>
        readNavState(page)
      );
      if (!midWait.ok) {
        tenOk = false;
        tenReason = "hide_timeout";
        break;
      }
      await page.evaluate(() => window.__iuMockKeyboard(false));
      const endWait = await waitForNavPredicate(page, isVisible, DETECT_DEADLINE_MS, () =>
        readNavState(page)
      );
      if (!endWait.ok) {
        tenOk = false;
        tenReason = "restore_timeout";
        break;
      }
      const idleCheck = await assertKeyboardHideIdle(page, () => readNavState(page), isVisible);
      if (!idleCheck.ok) {
        tenOk = false;
        pendingTimerCheckOk = false;
        tenReason = "pending_class";
        break;
      }
      const listenerNow = await page.evaluate(() =>
        typeof window.__iuVvListenerCounts === "function" ? window.__iuVvListenerCounts() : null
      );
      if (
        !listenerBaseline ||
        !listenerNow ||
        listenerNow.resize !== listenerBaseline.resize ||
        listenerNow.scroll !== listenerBaseline.scroll
      ) {
        tenOk = false;
        listenerCleanupOk = false;
        tenReason = "listener_drift";
        break;
      }
    }
    const tenResult = { ok: tenOk, reason: tenReason };
    await blurActive(page);

    const flagOk = await page.evaluate(() => window.__iuMobileBottomNavKeyboardHideInit === 1);
    const selectorOk = idle.navId === "iuMobileBottomNav";
    const scrollPreserved = Math.abs((await readNavState(page)).scrollY - scrollBefore) <= 2;

    const pass =
      isVisible(idle) &&
      isHidden(scenarioA) &&
      isHidden(openBeforeCloseNoBlur) &&
      isVisible(closeNoBlur) &&
      stillFocused &&
      formValueOk &&
      restoreNoBlurWithinDeadline &&
      isVisible(restoredBlur) &&
      restoreBlurMs <= 350 &&
      isHidden(openingGrace) &&
      isVisible(graceExpired) &&
      gapOnlyOk &&
      noBlink &&
      !readonlyOpen.hasClass &&
      !checkboxOpen.hasClass &&
      !fileOpen.hasClass &&
      !inputModeNone.hasClass &&
      overlayBefore === 220 &&
      Math.abs(overlayAfter - overlayBefore) <= 2 &&
      tenOk &&
      scrollPreserved &&
      flagOk &&
      selectorOk;

    return {
      viewport: vp.name,
      pass,
      idleOk: isVisible(idle),
      scenarioA_open: isHidden(scenarioA),
      scenarioB_closeNoBlur: isVisible(closeNoBlur) && stillFocused,
      restoreNoBlurMs,
      scenarioC_closeWithBlur: isVisible(restoredBlur),
      restoreBlurMs,
      scenarioD_noBlink: noBlink,
      openingGraceOk: isHidden(openingGrace),
      graceExpiredNotStuck: isVisible(graceExpired),
      gapOnlyOk,
      formStateOk: formValueOk,
      overlayScrollOk: Math.abs(overlayAfter - overlayBefore) <= 2,
      tenCyclesOk: tenOk,
      tenCyclesReason: tenResult.reason || null,
      pendingTimerCheckOk,
      listenerCleanupOk,
      scrollPreserved,
      restoreDelayOk: restoreNoBlurWithinDeadline,
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
      /* Prod-parity: app hub is site root (projects/index.html). */
      if (p === "/" || p === "") p = "/projects/index.html";
      else if (p.endsWith("/")) p += "index.html";
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

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT > 0 ? PORT : 0, "127.0.0.1", resolve);
  });
  PORT = server.address().port;
  BASE = `http://127.0.0.1:${PORT}/`;
  await waitForPort("127.0.0.1", PORT, 10000);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  const only = String(process.env.IU_KB_HIDE_ONLY || "ALL").toUpperCase();
  try {
    if (only === "ALL" || only === "MOBILE" || only === "TABLET") {
      for (const vp of VIEWPORTS) {
        if (only !== "ALL" && only !== vp.name) continue;
        results.push(await runViewport(browser, vp));
      }
    }
    if (only === "ALL" || only === "DESKTOP") {
      results.push(await runDesktop(browser));
    }
    if (only === "ALL" || only === "NARROW" || only === "NARROW_GAP_ONLY") {
      results.push(await runDesktopNarrowFalsePositive(browser));
    }
    if (!results.length) {
      throw new Error("IU_KB_HIDE_ONLY empty selection: " + only);
    }
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
