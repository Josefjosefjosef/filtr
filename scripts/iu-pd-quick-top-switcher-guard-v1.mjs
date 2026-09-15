#!/usr/bin/env node
/**
 * Behavioral guard: Můj přehled dne top strip = Dopravní ⇄ ČHMÚ switcher (mobile/tablet/PWA).
 * - Default new visit = ČHMÚ (sky bar + label)
 * - No "MŮJ PŘEHLED DNE" label
 * - No duplicate large quick-view buttons under hero
 * - Tap toggles traffic orange ⇄ ČHMÚ sky using existing feed-quick-view act
 * - touch-action: pan-y (vertical scroll not blocked)
 * - Desktop (≥1025) keeps inline buttons; top bar hidden
 * Run: npm run iu-pd-quick-top-switcher-guard
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

const PORT = parseInt(process.env.IU_GUARD_PORT || "8998", 10);
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
  const ui = read("assets/iu-prehled-dne-ui-v1.js");
  const css = read("assets/iu-prehled-dne-v1.css");

  must(/data-iu-pd-quick-switcher="1"/.test(index), "static:switcher_in_index");
  must(/data-iu-pd-quick-active="chmu"/.test(index), "static:default_chmu_attr");
  must(/data-iu-pd-quick-view="chmu"/.test(index), "static:section_default_chmu");
  must(/VÝSTRAHY ČHMÚ/.test(index), "static:chmu_label");
  must(!/>MŮJ PŘEHLED DNE</.test(index), "static:no_muj_prehled");
  must(/function pdQuickSwitcherHtml\(/.test(ui), "static:helper");
  must(/function syncPdQuickSwitcher\(/.test(ui), "static:sync");
  must(/isPdDesktopQuickViewLayout\(/.test(ui), "static:desktop_gate");
  must(/feedQuickView:\s*"chmu"/.test(ui), "static:state_default_chmu");
  must(/data-act="feed-quick-view"/.test(ui), "static:reuses_feed_quick_view");
  must(/iu\.prehled\.feedQuickView\.pwa\.v1/.test(ui), "static:no_new_ls_key_still_pwa");
  must(!/iu\.prehled\.feedQuickView\.topSwitcher/.test(ui), "static:no_extra_ls_key");
  must(/iuHomeSectionBar--pdQuick[\s\S]{0,240}--iu-home-section-bar-h:\s*40px/.test(index), "static:h40");
  must(/touch-action:\s*pan-y/.test(index), "static:touch_pan_y");
  must(/#38bdf8/.test(index) || /var\(--iu-pd-chmu/.test(css), "static:chmu_color");
  must(/#ea580c/.test(index) || /var\(--iu-pd-traffic/.test(css), "static:traffic_color");
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

function parseRgb(color) {
  const m = String(color || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

function nearChmu(rgb) {
  return rgb && rgb.r >= 30 && rgb.r <= 90 && rgb.g >= 160 && rgb.b >= 200;
}
function nearOrange(rgb) {
  return rgb && rgb.r > 180 && rgb.g < 140 && rgb.b < 80;
}

async function snap(page) {
  return page.evaluate(() => {
    const sw = document.querySelector("[data-iu-pd-quick-switcher='1']");
    const root = document.querySelector(".iuPrehledDne");
    const cs = sw ? getComputedStyle(sw) : null;
    const r = sw ? sw.getBoundingClientRect() : null;
    const quick = document.querySelector(".iuPrehledDne .iuPdQuickView--primary");
    const quickCs = quick ? getComputedStyle(quick) : null;
    const toggles = [...document.querySelectorAll(".iuPdToggle")].map((t) => String(t.textContent || "").trim());
    const settings = document.querySelector('[data-testid="prehled-dne-settings-cta"]');
    const banner = document.querySelector('[data-testid="prehled-dne-homecard"]');
    return {
      hasSw: !!sw,
      active: sw ? sw.getAttribute("data-iu-pd-quick-active") : null,
      viewAttr: root ? root.getAttribute("data-iu-pd-quick-view") : null,
      label: sw ? String((sw.querySelector("[data-iu-pd-quick-label]") || {}).textContent || "").trim() : "",
      text: sw ? String(sw.textContent || "").replace(/\s+/g, " ").trim() : "",
      h: r ? Math.round(r.height * 100) / 100 : 0,
      bg: cs ? cs.backgroundColor : "",
      touch: cs ? cs.touchAction : "",
      pointer: cs ? cs.pointerEvents : "",
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      duplicateQuickDom: !!quick,
      duplicateQuickVisible: !!(quick && quickCs && quickCs.display !== "none" && quickCs.visibility !== "hidden"),
      toggles,
      settingsOk: !!(settings && /Nastavení/i.test(settings.textContent || "")),
      bannerOk: !!banner,
      mujVisible: (() => {
        const bar = document.querySelector('[data-iu-home-section-bar="muj-prehled-dne"]');
        return !!(bar && /MŮJ PŘEHLED DNE/i.test(String(bar.textContent || "")));
      })(),
      aria: sw ? sw.getAttribute("aria-label") || "" : "",
      tag: sw ? sw.tagName : "",
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
      { name: "m320", width: 320, height: 640 },
      { name: "m360", width: 360, height: 740 },
      { name: "m390", width: 390, height: 844 },
      { name: "m412", width: 412, height: 915 },
      { name: "m430", width: 430, height: 932 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "tablet-land", width: 1024, height: 768 },
      { name: "pc", width: 1280, height: 900 },
    ];
    try {
      for (const vp of viewports) {
        const context = await bootstrapGuardContext(browser, {
          viewport: { width: vp.width, height: vp.height },
          isMobile: vp.width <= 1024,
          hasTouch: vp.width <= 1024,
        });
        // Clear session so default ČHMÚ applies (web visit, not PWA restore).
        await context.addInitScript(() => {
          try {
            sessionStorage.removeItem("iu.prehled.feedQuickView.v1");
          } catch (_) {}
        });
        const page = await bootstrapGuardPage(context);
        await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForFunction(
          () =>
            !!document.querySelector('[data-testid="prehled-dne-homecard"]') &&
            !!document.querySelector('[data-testid="prehled-dne-settings-cta"][data-act="open-settings"]'),
          { timeout: 45000 }
        );
        await page.waitForTimeout(600);
        const p = vp.name + ":";

        if (vp.width >= 1025) {
          const desk = await page.evaluate(() => {
            const sw = document.querySelector("[data-iu-pd-quick-switcher='1']");
            const swCs = sw ? getComputedStyle(sw) : null;
            const quick = document.querySelector(".iuPrehledDne .iuPdQuickView--primary");
            const qCs = quick ? getComputedStyle(quick) : null;
            return {
              swHidden: !sw || (swCs && swCs.display === "none"),
              quickVisible: !!(quick && qCs && qCs.display !== "none"),
              trafficBtn: !!document.querySelector(".iuPdQuickView__btn--traffic"),
              chmuBtn: !!document.querySelector(".iuPdQuickView__btn--chmu"),
            };
          });
          must(desk.swHidden, p + "pc_switcher_hidden");
          must(desk.quickVisible, p + "pc_quick_buttons_visible");
          must(desk.trafficBtn && desk.chmuBtn, p + "pc_both_buttons");
          await context.close();
          continue;
        }

        let s = await snap(page);
        must(s.hasSw, p + "switcher_present");
        must(s.tag === "BUTTON", p + "switcher_button");
        must(!s.mujVisible, p + "no_muj_prehled_label");
        must(!s.duplicateQuickVisible, p + "no_duplicate_buttons");
        must(s.active === "chmu", p + "default_active_chmu:" + s.active);
        must(s.viewAttr === "chmu", p + "default_attr_chmu:" + s.viewAttr);
        must(/VÝSTRAHY ČHMÚ/i.test(s.label || s.text), p + "default_label:" + s.label);
        must(nearChmu(parseRgb(s.bg)), p + "default_bg_chmu:" + s.bg);
        must(s.h >= 38 && s.h <= 48, p + "height_40:" + s.h);
        must(/pan-y/i.test(s.touch || ""), p + "touch_pan_y:" + s.touch);
        must(s.pointer === "auto", p + "pointer_auto");
        must(!s.overflowX, p + "no_h_overflow");
        must(s.settingsOk, p + "settings");
        must(s.bannerOk, p + "banner");
        must(s.toggles.includes("Vše") && s.toggles.includes("Uložené") && s.toggles.includes("Skryté"), p + "toggles");
        must(/ČHMÚ|Výstrahy/i.test(s.aria), p + "aria");

        await page.click('[data-iu-pd-quick-switcher="1"]');
        await page.waitForTimeout(280);
        s = await snap(page);
        must(s.active === "traffic", p + "tap_traffic_active:" + s.active);
        must(/DOPRAVNÍ INFORMACE/i.test(s.label || s.text), p + "tap_traffic_label:" + s.label);
        must(nearOrange(parseRgb(s.bg)), p + "tap_traffic_bg:" + s.bg);
        must(s.viewAttr === "traffic", p + "tap_traffic_attr:" + s.viewAttr);

        await page.click('[data-iu-pd-quick-switcher="1"]');
        await page.waitForTimeout(280);
        s = await snap(page);
        must(s.active === "chmu", p + "tap_back_chmu:" + s.active);
        must(/VÝSTRAHY ČHMÚ/i.test(s.label || s.text), p + "tap_back_label:" + s.label);
        must(nearChmu(parseRgb(s.bg)), p + "tap_back_bg:" + s.bg);

        // Mode toggles still work after switcher use.
        await page.click('.iuPdToggle[data-mode="saved"]');
        await page.waitForTimeout(120);
        const modeOk = await page.evaluate(() => {
          const btn = document.querySelector('.iuPdToggle[data-mode="saved"]');
          return !!(btn && btn.classList.contains("is-active"));
        });
        must(modeOk, p + "saved_toggle");
        await page.click('.iuPdToggle[data-mode="all"]');

        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    try {
      server.kill("SIGTERM");
    } catch (_) {}
  }
}

async function main() {
  staticGate();
  if (fails.length) {
    console.log("FAIL " + fails.join(" | "));
    process.exit(1);
  }
  await runPlaywright();
  if (fails.length) {
    console.log("FAIL " + fails.join(" | "));
    process.exit(1);
  }
  console.log("PASS iu-pd-quick-top-switcher-guard");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
