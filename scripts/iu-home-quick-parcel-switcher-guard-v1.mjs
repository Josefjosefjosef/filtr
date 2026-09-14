#!/usr/bin/env node
/**
 * Mobile/tablet/PWA: RYCHLÝ PŘEHLED ⇄ SLEDOVÁNÍ ZÁSILEK combined switcher.
 * - One wrapper module
 * - Default mode = quick
 * - Header bar ~40px (+8 vs 32)
 * - Tap / header swipe toggles
 * - Content horizontal scroll must NOT toggle module
 * - Vertical pan must not lock page scroll (touch-action pan-y on header only)
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8997", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?section=media&iuInfoSystem=cutover&nosw=1`;
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function staticGate() {
  const index = read("projects/index.html");
  const css = read("assets/iu-home-quick-parcel-switcher-v1.css");
  const js = read("assets/iu-home-quick-parcel-switcher-v1.js");

  must(/home-quick-parcel-switcher-v1-20260914/.test(index), "static:marker");
  must(/id="iuHomeQuickParcelModule"/.test(index), "static:module");
  must(/id="iuHomeQuickParcelSwitcher"/.test(index), "static:switcher_btn");
  must(/id="iuHomeQuickParcelPanelQuick"/.test(index), "static:panel_quick");
  must(/id="iuHomeQuickParcelPanelParcel"/.test(index), "static:panel_parcel");
  must(/iu-home-quick-parcel-switcher-v1\.css/.test(index), "static:css_link");
  must(/iu-home-quick-parcel-switcher-v1\.js/.test(index), "static:js_link");

  const modIdx = index.indexOf('id="iuHomeQuickParcelModule"');
  const parcelIdx = index.indexOf('id="iuSilverParcelWatch"', modIdx);
  const mountIdx = index.indexOf('id="iuMobileInfoPanelMount"', modIdx);
  const endMod = index.indexOf("</div>", index.indexOf("iuHomeQuickParcelModule__body", modIdx) + 1);
  must(modIdx > 0 && parcelIdx > modIdx && mountIdx > modIdx, "static:both_inside_module_order");
  must(
    !/data-iu-home-section-bar="sledovani-zasilek"/.test(index),
    "static:no_standalone_parcel_bar"
  );
  must(
    !/data-iu-home-section-bar="rychly-prehled"/.test(index),
    "static:no_standalone_quick_bar"
  );

  must(/--iu-home-section-bar-h:\s*40px/.test(css), "static:css_bar_40");
  must(/touch-action:\s*pan-y/.test(css), "static:css_touch_pan_y");
  must(!/touch-action:\s*none/.test(css), "static:no_touch_none");
  must(/SWIPE_MIN_PX\s*=\s*48/.test(js), "static:js_swipe_threshold");
  must(/setPointerCapture/.test(js), "static:js_pointer");
  must(/prefers-reduced-motion/.test(js) || /reducedMotion/.test(js), "static:js_reduced_motion");
  must(/data-iu-qp-bound/.test(js), "static:js_single_bind");
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

async function measure(page) {
  return page.evaluate(() => {
    const mod = document.getElementById("iuHomeQuickParcelModule");
    const sw = document.getElementById("iuHomeQuickParcelSwitcher");
    const quick = document.getElementById("iuHomeQuickParcelPanelQuick");
    const parcelPanel = document.getElementById("iuHomeQuickParcelPanelParcel");
    const parcel = document.getElementById("iuSilverParcelWatch");
    const mount = document.getElementById("iuMobileInfoPanelMount");
    const swR = sw ? sw.getBoundingClientRect() : null;
    const cs = sw ? getComputedStyle(sw) : null;
    const standaloneParcelBar = Array.from(document.querySelectorAll(".iuHomeSectionBar")).find((el) =>
      /SLEDOVÁNÍ ZÁSILEK/i.test(el.textContent || "") && el.id !== "iuHomeQuickParcelSwitcher"
    );
    const standaloneQuickBar = Array.from(document.querySelectorAll(".iuHomeSectionBar")).find((el) =>
      /RYCHLÝ PŘEHLED/i.test(el.textContent || "") && el.id !== "iuHomeQuickParcelSwitcher"
    );
    return {
      mode: mod ? mod.getAttribute("data-iu-mode") : null,
      hasMod: !!mod,
      swH: swR ? swR.height : 0,
      swDisplay: cs ? cs.display : null,
      swPointer: cs ? cs.pointerEvents : null,
      swTouchAction: cs ? cs.touchAction : null,
      label: sw ? (sw.querySelector("[data-iu-switcher-label]") || {}).textContent || "" : "",
      quickHidden: quick ? !!quick.hidden : null,
      parcelHidden: parcelPanel ? !!parcelPanel.hidden : null,
      parcelInPanel: !!(parcelPanel && parcel && parcelPanel.contains(parcel)),
      mountInQuick: !!(quick && mount && quick.contains(mount)),
      standaloneParcelBar: !!standaloneParcelBar,
      standaloneQuickBar: !!standaloneQuickBar,
      modules: document.querySelectorAll("[data-iu-home-quick-parcel-module]").length,
    };
  });
}

async function runPlaywright() {
  const server = spawn(process.execPath, [path.join(ROOT, "server", "projects-static.mjs")], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });
  try {
    await waitForPort("127.0.0.1", PORT, 30000);
    const browser = await chromium.launch({ headless: true });
    const viewports = [
      { name: "MOBILE", width: 390, height: 844 },
      { name: "MOBILE_SM", width: 360, height: 640 },
      { name: "TABLET", width: 768, height: 1024 },
      { name: "PWA", width: 412, height: 915 },
    ];
    try {
      for (const vp of viewports) {
        const context = await bootstrapGuardContext(browser, {
          viewport: { width: vp.width, height: vp.height },
          isMobile: true,
          hasTouch: true,
        });
        const page = await bootstrapGuardPage(context);
        await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForFunction(() => document.getElementById("iuHomeQuickParcelModule"), {
          timeout: 45000,
        });
        await page.waitForTimeout(500);

        let m = await measure(page);
        const p = vp.name + ":";
        must(m.hasMod, p + "module_present");
        must(m.modules === 1, p + "single_module:" + m.modules);
        must(m.mode === "quick", p + "default_quick:" + m.mode);
        must(m.quickHidden === false, p + "quick_visible");
        must(m.parcelHidden === true, p + "parcel_hidden_default");
        must(m.mountInQuick, p + "mount_in_quick");
        must(m.parcelInPanel, p + "parcel_in_panel");
        must(!m.standaloneParcelBar, p + "no_standalone_parcel_bar");
        must(!m.standaloneQuickBar, p + "no_standalone_quick_bar");
        must(m.swH >= 38 && m.swH <= 48, p + "bar_height_~40:" + m.swH);
        must(/RYCHLÝ PŘEHLED/i.test(m.label), p + "label_quick");
        must(m.swPointer === "auto", p + "pointer_auto:" + m.swPointer);
        must(/pan-y/i.test(m.swTouchAction || ""), p + "touch_pan_y:" + m.swTouchAction);

        // Tap toggle → parcel
        await page.click("#iuHomeQuickParcelSwitcher");
        await page.waitForTimeout(120);
        m = await measure(page);
        must(m.mode === "parcel", p + "tap_to_parcel:" + m.mode);
        must(m.parcelHidden === false, p + "parcel_visible");
        must(m.quickHidden === true, p + "quick_hidden_after_tap");
        must(/SLEDOVÁNÍ ZÁSILEK/i.test(m.label), p + "label_parcel");

        // Tap back → quick
        await page.click("#iuHomeQuickParcelSwitcher");
        await page.waitForTimeout(120);
        m = await measure(page);
        must(m.mode === "quick", p + "tap_back_quick:" + m.mode);

        // Header swipe left → parcel
        const box = await page.locator("#iuHomeQuickParcelSwitcher").boundingBox();
        if (box) {
          const y = box.y + box.height / 2;
          await page.mouse.move(box.x + box.width * 0.75, y);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.2, y, { steps: 8 });
          await page.mouse.up();
          await page.waitForTimeout(150);
          m = await measure(page);
          must(m.mode === "parcel", p + "swipe_left_parcel:" + m.mode);

          await page.mouse.move(box.x + box.width * 0.2, y);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.8, y, { steps: 8 });
          await page.mouse.up();
          await page.waitForTimeout(150);
          m = await measure(page);
          must(m.mode === "quick", p + "swipe_right_quick:" + m.mode);
        } else {
          must(false, p + "switcher_bbox");
        }

        // Rapid toggle 20×
        for (let i = 0; i < 20; i++) {
          await page.click("#iuHomeQuickParcelSwitcher");
        }
        await page.waitForTimeout(100);
        m = await measure(page);
        must(m.modules === 1, p + "rapid_single_module");
        must(m.mode === "quick" || m.mode === "parcel", p + "rapid_valid_mode:" + m.mode);
        must(m.parcelInPanel, p + "rapid_parcel_still_in_panel");

        // Content swipe must not toggle (drag on quick panel body)
        await page.evaluate(() => {
          const mod = document.getElementById("iuHomeQuickParcelModule");
          if (mod && typeof window.iuHomeQuickParcelSetMode === "function") {
            window.iuHomeQuickParcelSetMode("quick");
          }
        });
        await page.waitForTimeout(80);
        const mountBox = await page.locator("#iuMobileInfoPanelMount").boundingBox();
        if (mountBox && mountBox.height > 20) {
          const y = mountBox.y + Math.min(40, mountBox.height / 2);
          await page.mouse.move(mountBox.x + mountBox.width * 0.8, y);
          await page.mouse.down();
          await page.mouse.move(mountBox.x + mountBox.width * 0.2, y, { steps: 10 });
          await page.mouse.up();
          await page.waitForTimeout(120);
          m = await measure(page);
          must(m.mode === "quick", p + "content_swipe_no_toggle:" + m.mode);
        }

        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
  }
}

staticGate();
await runPlaywright();

if (fails.length) {
  console.error("[iu-home-quick-parcel-switcher-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-home-quick-parcel-switcher-guard] PASS");
