#!/usr/bin/env node
/**
 * P0: mobil/tablet — spodní navigace se při otevřené systémové klávesnici skryje
 * a uvolní reserved prostor (--bottom-nav-height / safe-space). Desktop beze změny.
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
const PORT = parseInt(process.env.IU_GUARD_PORT || "8898", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const CSS_BUST = "ds-mobile-overlay-nav-flush-v1-20260713-bottom-nav-keyboard-hide-v1-20260802";
const JS_BUST_TOKEN = "bottom-nav-keyboard-hide-v1-20260802";

const VIEWPORTS = [
  { name: "MOBILE", width: 390, height: 844 },
  { name: "TABLET", width: 768, height: 1024 },
];

function staticGate() {
  const app = fs.readFileSync(APP, "utf8");
  const unified = fs.readFileSync(UNIFIED, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");

  const hideChunk = (() => {
    const parts = app.split("function iuMobileBottomNavKeyboardHideInit()");
    return parts[1] ? parts[1].split(/\n  function /)[0] : "";
  })();

  const checks = [
    { id: "hide_init_fn", pass: /function iuMobileBottomNavKeyboardHideInit\(\)/.test(app) },
    { id: "hide_init_boot", pass: /iuMobileBottomNavKeyboardHideInit\(\)/.test(app) },
    { id: "hide_sets_iu_keyboard_open", pass: /classList\.add\("iu-keyboard-open"\)/.test(hideChunk) },
    { id: "hide_uses_visual_viewport", pass: /visualViewport/.test(hideChunk) },
    { id: "hide_max_width_1024", pass: /max-width:\s*1024px/.test(hideChunk) },
    { id: "hide_requires_focus_and_gap", pass: /focusEditable/.test(hideChunk) && /KEYBOARD_GAP_MIN/.test(hideChunk) },
    { id: "hide_no_gap_only_hard", pass: !/KEYBOARD_GAP_HARD/.test(hideChunk) },
    { id: "hide_excludes_select", pass: /tag === "SELECT"/.test(hideChunk) },
    { id: "hide_excludes_readonly", pass: /readOnly/.test(hideChunk) },
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

async function installVvMock(page) {
  await page.addInitScript(() => {
    const state = { heightFactor: 1, offsetTop: 0 };
    const listeners = { resize: new Set(), scroll: new Set() };
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
      __iuSetKeyboard(open) {
        state.heightFactor = open ? 0.55 : 1;
        state.offsetTop = 0;
        listeners.resize.forEach((fn) => {
          try {
            fn();
          } catch (_) {}
        });
      },
    };
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      get() {
        return vv;
      },
    });
    window.__iuMockKeyboard = (open) => vv.__iuSetKeyboard(!!open);
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
      display: cs ? cs.display : "missing",
      visibility: cs ? cs.visibility : "missing",
      pointerEvents: cs ? cs.pointerEvents : "missing",
      height: rect ? Math.round(rect.height) : -1,
      bottomNavHeight: String(rootCs.getPropertyValue("--bottom-nav-height") || "").trim(),
      safeSpace: String(rootCs.getPropertyValue("--iu-mobile-bottom-nav-safe-space") || "").trim(),
      safeVar: String(rootCs.getPropertyValue("--iu-mobile-bottom-safe") || "").trim(),
    };
  });
}

async function ensureProbeInputs(page) {
  await page.evaluate(() => {
    let host = document.getElementById("iuKbHideGuardHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "iuKbHideGuardHost";
      host.style.cssText = "position:fixed;left:8px;top:8px;z-index:20000;display:flex;gap:8px;";
      host.innerHTML =
        '<input id="iuKbHideA" type="text" autocomplete="off" />' +
        '<input id="iuKbHideB" type="text" autocomplete="off" />' +
        '<input id="iuKbHideRo" type="text" readonly value="ro" />' +
        '<input id="iuKbHideCb" type="checkbox" />';
      document.body.appendChild(host);
    }
  });
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

    await page.focus("#iuKbHideA");
    await page.waitForTimeout(80);
    const focusOnly = await readNavState(page);

    await page.evaluate(() => window.__iuMockKeyboard(true));
    await page.waitForTimeout(120);
    const open = await readNavState(page);

    const blinkSamples = [];
    await page.focus("#iuKbHideB");
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(30);
      blinkSamples.push(await readNavState(page));
    }
    const noBlink = blinkSamples.every((s) => s.hasClass === true && s.display === "none");

    await page.evaluate(() => window.__iuMockKeyboard(false));
    await page.evaluate(() => {
      const el = document.activeElement;
      if (el && typeof el.blur === "function") el.blur();
    });
    await page.waitForTimeout(220);
    const restored = await readNavState(page);

    await page.focus("#iuKbHideRo");
    await page.evaluate(() => window.__iuMockKeyboard(true));
    await page.waitForTimeout(120);
    const readonlyOpen = await readNavState(page);
    await page.evaluate(() => window.__iuMockKeyboard(false));
    await page.evaluate(() => {
      const el = document.activeElement;
      if (el && typeof el.blur === "function") el.blur();
    });
    await page.waitForTimeout(220);

    await page.focus("#iuKbHideCb");
    await page.evaluate(() => window.__iuMockKeyboard(true));
    await page.waitForTimeout(120);
    const checkboxOpen = await readNavState(page);
    await page.evaluate(() => window.__iuMockKeyboard(false));
    await page.evaluate(() => {
      const el = document.activeElement;
      if (el && typeof el.blur === "function") el.blur();
    });
    await page.waitForTimeout(220);

    await page.evaluate(() => {
      window.__iuMobileBottomNavKeyboardHideInit = 0;
      if (typeof iuMobileBottomNavKeyboardHideInit === "function") {
        /* not global */
      }
    });
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    const idleOk =
      idle.display !== "none" && idle.height > 40 && !/^0px$/.test(idle.bottomNavHeight);
    const focusOnlyOk = focusOnly.hasClass === false && focusOnly.display !== "none";
    const openOk =
      open.hasClass === true &&
      open.display === "none" &&
      open.pointerEvents === "none" &&
      open.height === 0 &&
      (/^0px$/.test(open.bottomNavHeight) || open.bottomNavHeight === "0") &&
      (/^0px$/.test(open.safeSpace) || open.safeSpace === "0");
    const restoredOk =
      restored.hasClass === false &&
      restored.display !== "none" &&
      restored.height > 40 &&
      !/^0px$/.test(restored.bottomNavHeight);
    const readonlyOk = readonlyOpen.hasClass === false;
    const checkboxOk = checkboxOpen.hasClass === false;

    return {
      viewport: vp.name,
      pass: idleOk && focusOnlyOk && openOk && restoredOk && noBlink && readonlyOk && checkboxOk,
      idleOk,
      focusOnlyOk,
      openOk,
      restoredOk,
      noBlink,
      readonlyOk,
      checkboxOk,
      idle,
      focusOnly,
      open,
      restored,
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
    /* Gap bez focusu nesmí skrýt nav. */
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
