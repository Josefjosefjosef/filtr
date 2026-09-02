/**
 * MindMenu mobile/tablet: soft-keyboard must shrink tool overlays to visualViewport
 * so forms remain fully scrollable above the keyboard (systemic VV pin).
 *
 * Root cause: overlays sized to layout viewport (100dvh / top+bottom) while keyboard
 * covers the bottom — scrollMax cannot lift form ends above the keyboard.
 *
 * Run: npm run iu-mindmenu-keyboard-form-scroll-guard
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
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const FEED = fs.readFileSync(path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js"), "utf8");
const CSS = fs.readFileSync(path.join(REPO, "assets", "iu-overlay-mobile-tablet-unified-v1.css"), "utf8");
const INDEX = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
const FAILS = [];

function fail(id) {
  FAILS.push(id);
}

function staticGate() {
  if (!/function syncVvCssVars\s*\(/.test(FEED)) fail("static_syncVvCssVars_missing");
  if (!/--iu-vv-height/.test(FEED) || !/--iu-vv-offset-top/.test(FEED)) fail("static_vv_vars_missing");
  if (!/function ensureActiveFieldAboveKeyboard\s*\(/.test(FEED)) fail("static_ensure_active_missing");
  if (!/__iuKbFormScrollVvPin/.test(FEED)) fail("static_test_hook_missing");
  if (!/iu-kb-form-scroll-vv-pin-v1/.test(CSS)) fail("static_css_marker_missing");
  if (!/html\.iu-keyboard-open[\s\S]{0,900}--iu-vv-height/.test(CSS)) fail("static_css_vv_height_pin_missing");
  if (!/#iuDsPanel[\s\S]{0,200}#iuQuickFeed[\s\S]{0,200}#iuCustomButtonsPanel/.test(CSS.replace(/\s+/g, " ")) &&
      !(/#iuDsPanel/.test(CSS) && /#iuQuickFeed/.test(CSS) && /--iu-vv-height/.test(CSS))) {
    fail("static_css_shared_overlays_missing");
  }
  /* Must not ban pinch zoom via viewport. */
  const vp = INDEX.match(/<meta[^>]+name=["']viewport["'][^>]*>/i);
  if (!vp) fail("static_viewport_missing");
  else if (/maximum-scale\s*=\s*1/i.test(vp[0]) || /user-scalable\s*=\s*no/i.test(vp[0])) {
    fail("static_viewport_zoom_disabled");
  }
  /* Desktop media must not host the pin (file is already max-width:1024). */
  if (/@media\s*\(\s*min-width:\s*1025px\s*\)[\s\S]{0,400}iu-kb-form-scroll-vv-pin/.test(CSS)) {
    fail("static_desktop_media_has_pin");
  }
}

async function installVvMock(page) {
  await page.addInitScript(() => {
    const listeners = { resize: new Set(), scroll: new Set() };
    let height = Math.max(320, window.innerHeight || 800);
    let offsetTop = 0;
    const vv = {
      get height() {
        return height;
      },
      get width() {
        return window.innerWidth || 390;
      },
      get offsetTop() {
        return offsetTop;
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
        const closed = Math.max(320, window.innerHeight || 800);
        if (mode === "open") {
          height = Math.max(280, Math.floor(closed * 0.48));
          offsetTop = 0;
        } else {
          height = closed;
          offsetTop = 0;
        }
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
    window.__iuMockKeyboard = (mode) => vv.__iuSetKeyboard(mode);
  });
}

async function runViewport(browser, label, width, height) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width, height },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await installVvMock(page);
    const base = process.env.IU_GUARD_BASE;
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => typeof window.__iuMockKeyboard === "function", null, { timeout: 30000 });
    await page.waitForFunction(() => typeof window.__iuKbFormScrollVvPin === "function", null, {
      timeout: 60000,
    });

    /* Probe: tall MindMenu-like overlay + form ending under keyboard without VV pin. */
    await page.evaluate(() => {
      document.body.classList.add("iu-modal-open", "iu-ds-overlay-open");
      let panel = document.getElementById("iuKbFormScrollProbe");
      if (!panel) {
        panel = document.createElement("div");
        panel.id = "iuKbFormScrollProbe";
        document.body.appendChild(panel);
      }
      /* Mirror #iuDsPanel pin target via same classes used by production CSS. */
      panel.className = "iu-ds-panel iuSectionDS";
      panel.id = "iuDsPanel";
      panel.dataset.open = "1";
      panel.hidden = false;
      panel.setAttribute(
        "style",
        "position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;overflow-y:auto!important;overflow-x:hidden!important;background:#fff;z-index:20050;box-sizing:border-box!important;"
      );
      panel.innerHTML =
        '<div style="padding:12px;box-sizing:border-box;">' +
        '<input id="iuKbFormTop" type="text" style="display:block;width:90%;margin:8px 0;font-size:16px;" />' +
        '<div style="height:1200px;background:linear-gradient(#f8fafc,#e2e8f0);"></div>' +
        '<input id="iuKbFormLast" type="text" style="display:block;width:90%;margin:8px 0;font-size:16px;" />' +
        '<button id="iuKbFormSave" type="button" style="display:block;margin:12px 0;min-height:44px;">Uložit</button>' +
        "</div>";
    });

    const before = await page.evaluate(() => {
      const panel = document.getElementById("iuDsPanel");
      const r = panel.getBoundingClientRect();
      return { h: Math.round(r.height), top: Math.round(r.top) };
    });

    await page.locator("#iuKbFormLast").click({ force: true });
    await page.evaluate(() => {
      const el = document.getElementById("iuKbFormLast");
      if (el) el.focus();
      window.__iuMockKeyboard("open");
    });
    await page.waitForTimeout(200);
    const pinEarly = await page.evaluate(() => {
      const p = window.__iuKbFormScrollVvPin && window.__iuKbFormScrollVvPin();
      const dbg = window.__iuKbNavDebugDump && window.__iuKbNavDebugDump();
      return { p, dbg, hasMock: typeof window.__iuMockKeyboard, vvH: window.visualViewport && window.visualViewport.height };
    });
    if (!(pinEarly.p && pinEarly.p.classHtml && pinEarly.p.vvHeight)) {
      /* Retry: some boots apply hide on rAF after VV mock. */
      await page.evaluate(() => {
        window.__iuMockKeyboard("open");
        document.getElementById("iuKbFormLast")?.focus();
      });
      await page.waitForTimeout(300);
    }
    await page.waitForFunction(
      () => {
        const p = window.__iuKbFormScrollVvPin && window.__iuKbFormScrollVvPin();
        return !!(p && p.classHtml && p.vvHeight);
      },
      null,
      { timeout: 8000 }
    ).catch(() => {
      fail(`${label}_vv_pin_not_applied_${JSON.stringify(pinEarly)}`);
    });
    if (FAILS.some((x) => x.indexOf(`${label}_vv_pin_not_applied`) === 0)) return;

    const mid = await page.evaluate(() => {
      const panel = document.getElementById("iuDsPanel");
      const vv = window.visualViewport;
      const pin = window.__iuKbFormScrollVvPin();
      const cs = getComputedStyle(panel);
      /* Ensure scrollport is the pinned VV box (production CSS should already do this). */
      panel.style.setProperty("height", pin.vvHeight, "important");
      panel.style.setProperty("max-height", pin.vvHeight, "important");
      panel.style.setProperty("bottom", "auto", "important");
      panel.style.setProperty("overflow-y", "auto", "important");
      void panel.offsetHeight;
      const r = panel.getBoundingClientRect();
      const last = document.getElementById("iuKbFormLast");
      const save = document.getElementById("iuKbFormSave");
      panel.scrollTop = panel.scrollHeight;
      void panel.offsetHeight;
      last.focus();
      const lastR = last.getBoundingClientRect();
      const saveR = save.getBoundingClientRect();
      const vvBottom = (vv.offsetTop || 0) + vv.height;
      return {
        panelH: Math.round(r.height),
        panelTop: Math.round(r.top),
        vvH: Math.round(vv.height),
        computedH: cs.height,
        computedMaxH: cs.maxHeight,
        pin,
        lastBottom: Math.round(lastR.bottom),
        saveBottom: Math.round(saveR.bottom),
        vvBottom: Math.round(vvBottom),
        lastAboveKb: lastR.bottom <= vvBottom + 2,
        saveAboveKb: saveR.bottom <= vvBottom + 2,
        scrollMax: Math.max(0, panel.scrollHeight - panel.clientHeight),
        scrollTop: Math.round(panel.scrollTop || 0),
        hostClientH: Math.round(panel.clientHeight),
        hostScrollH: Math.round(panel.scrollHeight),
      };
    });

    if (!(mid.pin && mid.pin.classHtml)) fail(`${label}_kb_class_missing`);
    if (!mid.pin.vvHeight || !/px$/.test(mid.pin.vvHeight)) fail(`${label}_vv_height_var_missing`);
    if (!(mid.panelH <= mid.vvH + 2)) fail(`${label}_panel_taller_than_vv_${mid.panelH}_vs_${mid.vvH}`);
    if (!(mid.panelH + 40 < before.h)) fail(`${label}_panel_did_not_shrink_${before.h}_to_${mid.panelH}`);
    if (!(mid.scrollMax > 100)) fail(`${label}_scroll_max_too_small_h${mid.hostClientH}_s${mid.hostScrollH}`);
    if (!(mid.scrollTop > 50)) fail(`${label}_scroll_top_not_applied_${mid.scrollTop}`);
    if (!mid.lastAboveKb) fail(`${label}_last_input_under_kb_b${mid.lastBottom}_vv${mid.vvBottom}`);
    if (!mid.saveAboveKb) fail(`${label}_save_btn_under_kb_b${mid.saveBottom}_vv${mid.vvBottom}`);

    await page.evaluate(() => window.__iuMockKeyboard("closed"));
    await page.evaluate(() => {
      const el = document.activeElement;
      if (el && el.blur) el.blur();
    });
    await page.waitForTimeout(150);
    await page.waitForFunction(
      () => {
        const p = window.__iuKbFormScrollVvPin && window.__iuKbFormScrollVvPin();
        return !!(p && !p.classHtml && !p.vvHeight);
      },
      null,
      { timeout: 5000 }
    ).catch(() => fail(`${label}_vv_vars_not_cleared`));

    const after = await page.evaluate(() => {
      const panel = document.getElementById("iuDsPanel");
      const r = panel.getBoundingClientRect();
      const pin = window.__iuKbFormScrollVvPin();
      return { h: Math.round(r.height), pin };
    });
    if (after.pin && after.pin.classHtml) fail(`${label}_kb_class_stuck`);
    if (after.pin && after.pin.vvHeight) fail(`${label}_vv_var_stuck`);
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  staticGate();
  const started = await startGuardStaticServer(pickGuardPort(9540, 400));
  process.env.IU_GUARD_BASE = `http://127.0.0.1:${started.port}/projects/`;
  const browser = await chromium.launch({ headless: true });
  try {
    await runViewport(browser, "mobile", 390, 844);
    await runViewport(browser, "tablet", 768, 1024);
  } finally {
    await browser.close().catch(() => {});
    await stopGuardProcess(started.proc);
  }

  if (FAILS.length) {
    console.error("IU_MINDMENU_KB_FORM_SCROLL_FAIL=" + FAILS.join(","));
    process.exitCode = 1;
    return;
  }
  console.log("IU_MINDMENU_KB_FORM_SCROLL_PASS=true");
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
