#!/usr/bin/env node
/**
 * Desktop cold-start FOUC / CLS guard.
 * Static contract + Playwright: sample early layout + LayoutShift during first paint path.
 * Does not weaken mobile deferrals; desktop-only viewport (1280x800).
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

function staticGate() {
  const index = fs.readFileSync(path.join(ROOT, "projects/index.html"), "utf8");
  const homePremium = fs.readFileSync(path.join(ROOT, "assets/iu-desktop-home-premium.css"), "utf8");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");

  must(/desktop-css-before-paint-v1-20260909/.test(index), "static:desktop_css_marker");
  must(/desktop-cold-start-app-css-media-v1-20260909/.test(index), "static:app_css_desktop_marker");
  must(/id="iuDesktopLayoutV3PreAppCss"/.test(index), "static:pre_app_css_3col");
  must(
    /href="[^"]*iu-desktop-home-premium\.css/.test(index) &&
      !/data-iu-href="[^"]*iu-desktop-home-premium\.css/.test(index),
    "static:home_premium_href_not_data_only"
  );
  must(
    /<link[^>]*href="[^"]*iu-terms-gate-v1\.css[^"]*"[^>]*>/.test(index) &&
      !/<link[^>]*href="[^"]*iu-terms-gate-v1\.css[^"]*"[^>]*media="print"/.test(index) &&
      !/<link[^>]*media="print"[^>]*href="[^"]*iu-terms-gate-v1\.css/.test(index),
    "static:terms_css_not_print_deferred"
  );
  must(/data-iu-desktop-app-css="1"/.test(index), "static:desktop_app_css");
  must(
    !/body\.iu-desktop-home-grid\s+#newsList\s*>\s+#iuCenterStage\s*\{\s*opacity:\s*0/.test(homePremium),
    "static:no_center_opacity0"
  );
  must(/iu-terms-gate-v1\.css/.test(sw), "static:sw_terms_css_network_first");
  must(/2026-09-09-desktop-cold-start-fouc-v1/.test(sw), "static:sw_cache_version");
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
        if (Date.now() > deadline) reject(new Error("port_timeout"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function withServer(fn) {
  const PORT = 8971 + Math.floor(Math.random() * 40);
  const child = spawn(process.execPath, [path.join(ROOT, "server", "projects-static.mjs")], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });
  try {
    await waitForPort("127.0.0.1", PORT, 25000);
    await fn("http://127.0.0.1:" + PORT);
  } finally {
    try {
      child.kill();
    } catch (_) {}
  }
}

async function runtime() {
  const browser = await chromium.launch({ headless: true });
  try {
    await withServer(async (origin) => {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      });
      await ctx.addInitScript(() => {
        try {
          window.__IU_FORCE_TERMS_GATE__ = true;
          localStorage.clear();
        } catch (_) {}
        try {
          window.__iuColdStartProbe = {
            samples: [],
            cls: 0,
            fcp: 0,
            longTasks: 0,
          };
          const probe = window.__iuColdStartProbe;
          function sample(tag) {
            try {
              const layout = document.querySelector(".layout");
              const welcome = document.getElementById("iuSilverWelcomeCard");
              const weather = document.getElementById("iuSilverWeatherCard");
              const stage = document.getElementById("iuCenterStage");
              const terms = document.getElementById("iuTermsGate");
              const cs = layout ? getComputedStyle(layout) : null;
              const cols = cs ? String(cs.gridTemplateColumns || "") : "";
              const colParts = cols.split(/\s+/).filter(Boolean);
              probe.samples.push({
                tag: String(tag || ""),
                t: performance.now(),
                colCount: colParts.length,
                hasDesktopGrid: !!(document.body && document.body.classList.contains("iu-desktop-home-grid")),
                welcomeW: welcome ? Math.round(welcome.getBoundingClientRect().width) : 0,
                weatherW: weather ? Math.round(weather.getBoundingClientRect().width) : 0,
                stageOpacity: stage ? String(getComputedStyle(stage).opacity || "") : "",
                termsVisible: !!(terms && !terms.hidden),
                termsFixed: !!(
                  terms &&
                  !terms.hidden &&
                  getComputedStyle(terms).position === "fixed"
                ),
              });
            } catch (_) {}
          }
          try {
            const po = new PerformanceObserver((list) => {
              const ents = list.getEntries();
              for (let i = 0; i < ents.length; i++) {
                const e = ents[i];
                if (e.entryType === "layout-shift" && !e.hadRecentInput) {
                  probe.cls += e.value;
                }
                if (e.entryType === "paint" && e.name === "first-contentful-paint") {
                  probe.fcp = e.startTime;
                }
                if (e.entryType === "longtask") {
                  probe.longTasks += 1;
                }
              }
            });
            try {
              po.observe({ type: "layout-shift", buffered: true });
            } catch (_) {}
            try {
              po.observe({ type: "paint", buffered: true });
            } catch (_) {}
            try {
              po.observe({ type: "longtask", buffered: true });
            } catch (_) {}
          } catch (_) {}
          document.addEventListener("DOMContentLoaded", function () {
            sample("domcontentloaded");
          });
          window.addEventListener("load", function () {
            sample("load");
          });
          let n = 0;
          function tick() {
            sample("raf-" + n);
            n += 1;
            if (n < 24) requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        } catch (_) {}
      });

      const page = await ctx.newPage();
      await page.goto(origin + "/projects/?iuColdStart=1", {
        waitUntil: "networkidle",
        timeout: 90000,
      });
      await page.waitForTimeout(900);
      const snap = await page.evaluate(() => {
        const probe = window.__iuColdStartProbe || { samples: [], cls: 0, fcp: 0, longTasks: 0 };
        const layout = document.querySelector(".layout");
        const cs = layout ? getComputedStyle(layout) : null;
        const cols = cs ? String(cs.gridTemplateColumns || "") : "";
        const welcome = document.getElementById("iuSilverWelcomeCard");
        const weather = document.getElementById("iuSilverWeatherCard");
        const terms = document.getElementById("iuTermsGate");
        const stack = document.getElementById("iuSilverWelcomeStack");
        const stackCs = stack ? getComputedStyle(stack) : null;
        return {
          cls: probe.cls,
          fcp: probe.fcp,
          longTasks: probe.longTasks,
          samples: probe.samples,
          finalCols: cols.split(/\s+/).filter(Boolean).length,
          hasDesktopGrid: !!(document.body && document.body.classList.contains("iu-desktop-home-grid")),
          welcomeW: welcome ? Math.round(welcome.getBoundingClientRect().width) : 0,
          weatherW: weather ? Math.round(weather.getBoundingClientRect().width) : 0,
          stackCols: stackCs ? String(stackCs.gridTemplateColumns || "") : "",
          termsVisible: !!(terms && !terms.hidden),
          termsFixed: !!(terms && !terms.hidden && getComputedStyle(terms).position === "fixed"),
          termsZ: terms && !terms.hidden ? parseInt(getComputedStyle(terms).zIndex || "0", 10) : 0,
        };
      });

      must(snap.hasDesktopGrid, "rt:desktop_grid_class");
      must(snap.finalCols >= 3, "rt:final_three_cols");
      must(snap.termsVisible, "rt:terms_visible");
      must(snap.termsFixed, "rt:terms_fixed");
      must(snap.termsZ >= 10050, "rt:terms_z");
      /* Layout CLS budget: ignore tiny content reflows; stop 2↔3 column jumps. */
      must(snap.cls < 0.05, "rt:cls_low:" + String(snap.cls));
      must(snap.weatherW >= 300 && snap.weatherW <= 380, "rt:weather_desktop_width:" + snap.weatherW);

      const early = (snap.samples || []).filter(
        (s) => s.t < 2500 && s.colCount > 0 && s.hasDesktopGrid && !(s.colCount === 2 && s.welcomeW === 0 && s.weatherW === 0)
      );
      const earlyBadCols = early.filter((s) => s.colCount > 0 && s.colCount < 3 && (s.welcomeW > 0 || s.weatherW > 0 || s.t > 200));
      must(earlyBadCols.length === 0, "rt:no_early_sub3_cols:" + earlyBadCols.length);

      const opacityFlash = (snap.samples || []).some(
        (s) => s.stageOpacity === "0" || s.stageOpacity === "0.0"
      );
      must(!opacityFlash, "rt:no_center_opacity_flash");

      const stackLooksTwoCol =
        /minmax|fr/.test(String(snap.stackCols || "")) &&
        String(snap.stackCols || "").indexOf("340") !== -1;
      must(stackLooksTwoCol || snap.weatherW >= 300, "rt:silver_hero_two_col");

      const colFlip = (snap.samples || []).some((s, i, arr) => {
        if (i === 0) return false;
        const prev = arr[i - 1];
        return prev.colCount >= 3 && s.colCount === 2 && s.t < 2000;
      });
      must(!colFlip, "rt:no_3_to_2_flip");
    });
  } finally {
    await browser.close();
  }
}

staticGate();
await runtime();

if (fails.length) {
  console.error("[iu-desktop-cold-start-fouc-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-desktop-cold-start-fouc-guard] PASS");
