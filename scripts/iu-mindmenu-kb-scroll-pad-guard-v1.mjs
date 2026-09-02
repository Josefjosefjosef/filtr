/**
 * MindMenu keyboard form scroll via scroll-pad allowance (safe alternative to #10184).
 *
 * Root cause (clean checkpoint): scroll hosts keep ~0–15px padding-bottom while soft
 * keyboard covers ~40%+ of the viewport → scrollMax cannot lift form ends above kb.
 *
 * Fix: publish --iu-kb-scroll-pad + CSS padding-bottom on scroll hosts when
 * html.iu-keyboard-open. Must NOT pin overlay top/height to visualViewport (#10184
 * closed MindMenu sections on real devices).
 *
 * Guard also asserts: focus + keyboard-open ⇒ section stays open (data-open / not hidden).
 *
 * Run: npm run iu-mindmenu-kb-scroll-pad-guard
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
const FAILS = [];

function fail(id) {
  FAILS.push(id);
}

function staticGate() {
  /* Anti-regression of #10184 VV overlay pin */
  if (/function syncVvCssVars\s*\(/.test(FEED)) fail("static_forbidden_syncVvCssVars");
  if (/__iuKbFormScrollVvPin/.test(FEED)) fail("static_forbidden_vv_pin_hook");
  if (/iu-kb-form-scroll-vv-pin-v1/.test(CSS)) fail("static_forbidden_vv_pin_css_marker");
  if (/height:\s*var\(\s*--iu-vv-height/.test(CSS)) fail("static_forbidden_overlay_vv_height");
  if (/top:\s*var\(\s*--iu-vv-offset-top/.test(CSS)) fail("static_forbidden_overlay_vv_top");

  /* Required allowance fix */
  if (!/function syncKbScrollPad\s*\(/.test(FEED)) fail("static_syncKbScrollPad_missing");
  if (!/--iu-kb-scroll-pad/.test(FEED)) fail("static_js_kb_scroll_pad_missing");
  if (!/iu-kb-scroll-pad-allowance-v1/.test(CSS)) fail("static_css_marker_missing");
  if (!/html\.iu-keyboard-open[\s\S]{0,500}--iu-kb-scroll-pad/.test(CSS)) {
    fail("static_css_kb_scroll_pad_var_missing");
  }
  if (!/padding-bottom:\s*var\(\s*--iu-kb-scroll-pad\s*\)/.test(CSS)) {
    fail("static_css_padding_bottom_missing");
  }
  if (!/#iuDsPanel[\s\S]{0,400}--iu-kb-scroll-pad/.test(CSS.replace(/\s+/g, " ")) &&
      !(/#iuDsPanel/.test(CSS) && /--iu-kb-scroll-pad/.test(CSS) && /#iuQuickFeed/.test(CSS))) {
    fail("static_css_shared_hosts_missing");
  }
  if (!/never resize\/reposition overlays|#10184/.test(FEED)) {
    fail("static_safety_comment_missing");
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
          height = Math.max(280, Math.floor(closed * 0.52));
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
    await page.waitForFunction(() => typeof window.__iuKbScrollPadState === "function", null, {
      timeout: 60000,
    });

    await page.evaluate(() => {
      document.body.classList.add("iu-modal-open", "iu-ds-overlay-open");
      let panel = document.getElementById("iuDsPanel");
      if (!panel) {
        panel = document.createElement("div");
        document.body.appendChild(panel);
      }
      panel.id = "iuDsPanel";
      panel.className = "iu-ds-panel iuSectionDS";
      panel.dataset.open = "1";
      panel.hidden = false;
      panel.setAttribute(
        "style",
        "position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;height:auto!important;max-height:none!important;overflow-y:auto!important;background:#fff;z-index:20050;box-sizing:border-box!important;"
      );
      panel.innerHTML =
        '<div style="padding:12px;box-sizing:border-box;">' +
        '<input id="iuKbPadTop" type="text" style="display:block;width:90%;margin:8px 0;font-size:16px;" />' +
        '<div style="height:1000px;background:#e2e8f0;"></div>' +
        '<input id="iuKbPadLast" type="text" style="display:block;width:90%;margin:8px 0;font-size:16px;" />' +
        '<button id="iuKbPadSave" type="button" style="display:block;margin:12px 0;min-height:44px;">Uložit</button>' +
        "</div>";
    });

    const geomBefore = await page.evaluate(() => {
      const panel = document.getElementById("iuDsPanel");
      const r = panel.getBoundingClientRect();
      const cs = getComputedStyle(panel);
      return {
        top: Math.round(r.top),
        height: Math.round(r.height),
        pad: cs.paddingBottom,
        scrollMax: Math.max(0, panel.scrollHeight - panel.clientHeight),
        open: panel.dataset.open,
        hidden: !!panel.hidden,
      };
    });

    await page.locator("#iuKbPadLast").click({ force: true });
    await page.evaluate(() => {
      document.getElementById("iuKbPadLast")?.focus();
      window.__iuMockKeyboard("open");
    });
    await page.waitForTimeout(250);
    await page.waitForFunction(
      () => {
        const s = window.__iuKbScrollPadState && window.__iuKbScrollPadState();
        return !!(s && s.classHtml && s.kbScrollPad);
      },
      null,
      { timeout: 8000 }
    ).catch(() => fail(`${label}_kb_scroll_pad_not_published`));
    if (FAILS.some((x) => x.indexOf(`${label}_kb_scroll_pad_not_published`) === 0)) return;

    const mid = await page.evaluate(() => {
      const panel = document.getElementById("iuDsPanel");
      const r = panel.getBoundingClientRect();
      const cs = getComputedStyle(panel);
      const vv = window.visualViewport;
      const state = window.__iuKbScrollPadState();
      panel.scrollTop = panel.scrollHeight;
      const last = document.getElementById("iuKbPadLast").getBoundingClientRect();
      const save = document.getElementById("iuKbPadSave").getBoundingClientRect();
      const vvBottom = (vv.offsetTop || 0) + vv.height;
      return {
        top: Math.round(r.top),
        height: Math.round(r.height),
        pad: cs.paddingBottom,
        padPx: parseFloat(cs.paddingBottom) || 0,
        scrollMax: Math.max(0, panel.scrollHeight - panel.clientHeight),
        open: panel.dataset.open,
        hidden: !!panel.hidden,
        state,
        lastBottom: Math.round(last.bottom),
        saveBottom: Math.round(save.bottom),
        vvBottom: Math.round(vvBottom),
        lastAbove: last.bottom <= vvBottom + 2,
        saveAbove: save.bottom <= vvBottom + 2,
      };
    });

    /* Invariant A: section stays open */
    if (mid.open !== "1" || mid.hidden) fail(`${label}_section_closed_on_keyboard`);
    /* Anti-#10184: overlay box geometry must not jump to VV height pin */
    if (Math.abs(mid.top - geomBefore.top) > 2) fail(`${label}_overlay_top_changed_${geomBefore.top}_to_${mid.top}`);
    /* Pad + scroll range */
    if (!(mid.padPx >= 100)) fail(`${label}_pad_too_small_${mid.pad}`);
    if (!(mid.scrollMax > geomBefore.scrollMax + 80)) {
      fail(`${label}_scrollMax_not_increased_${geomBefore.scrollMax}_to_${mid.scrollMax}`);
    }
    if (!mid.lastAbove) fail(`${label}_last_under_kb_${mid.lastBottom}_vv${mid.vvBottom}`);
    if (!mid.saveAbove) fail(`${label}_save_under_kb_${mid.saveBottom}_vv${mid.vvBottom}`);

    await page.evaluate(() => {
      window.__iuMockKeyboard("closed");
      document.activeElement && document.activeElement.blur && document.activeElement.blur();
    });
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => {
      const panel = document.getElementById("iuDsPanel");
      const state = window.__iuKbScrollPadState();
      const cs = getComputedStyle(panel);
      return {
        open: panel.dataset.open,
        hidden: !!panel.hidden,
        state,
        padPx: parseFloat(cs.paddingBottom) || 0,
        classHtml: document.documentElement.classList.contains("iu-keyboard-open"),
      };
    });
    if (after.open !== "1" || after.hidden) fail(`${label}_section_closed_after_kb_close`);
    if (after.classHtml) fail(`${label}_kb_class_stuck`);
    if (after.state && after.state.kbScrollPad) fail(`${label}_kb_pad_var_stuck`);
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  staticGate();
  const started = await startGuardStaticServer(pickGuardPort(9550, 400));
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
    console.error("IU_MINDMENU_KB_SCROLL_PAD_FAIL=" + FAILS.join(","));
    process.exitCode = 1;
    return;
  }
  console.log("IU_MINDMENU_KB_SCROLL_PAD_PASS=true");
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
