#!/usr/bin/env node
/**
 * Mobile/tablet iCentrum boot FOUC guard.
 * Critical CSS must hide/correct #iuSilverWelcomeInfoBtn before deferred app.css applies.
 * Desktop viewport is regression-only (must stay unchanged by this contract).
 *
 * Run: npm run iu-mobile-icentrum-boot-fouc-guard
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
  const appCss = fs.readFileSync(path.join(ROOT, "assets/app.css"), "utf8");

  must(/mobile-icentrum-boot-fouc-v1-20260910/.test(index), "static:marker");
  must(/data-iu-defer-app-css="1"/.test(index), "static:defer_app_css");
  must(/id="iuSilverWelcomeInfoBtn"/.test(index), "static:welcome_btn");
  must(/iuTopbarInfoBtn--mobileFloat/.test(index), "static:mobile_float_class");

  // Critical CSS block (≤1024) must include hide + fixed show (before deferred app.css).
  const critIdx = index.indexOf("mobile-icentrum-boot-fouc-v1-20260910");
  must(critIdx > 0, "static:marker_pos");
  const critSlice = index.slice(Math.max(0, critIdx - 200), critIdx + 2200);
  must(/\.iuTopbarInfoBtn--mobileFloat\s*\{\s*display\s*:\s*none\s*!important/i.test(critSlice), "static:crit_hide");
  must(
    /body\.iu-home:not\(\.iu-mobileMainVisible\)\s*\.iuTopbarInfoBtn--mobileFloat/.test(critSlice),
    "static:crit_show_home"
  );
  must(/position\s*:\s*fixed\s*!important/i.test(critSlice), "static:crit_fixed");
  must(/right\s*:\s*calc\(\s*env\(\s*safe-area-inset-right/i.test(critSlice), "static:crit_right");
  must(/background\s*:\s*transparent/i.test(critSlice), "static:crit_transparent");

  // app.css still owns the long-term mobileFloat contract.
  must(/\.iuTopbarInfoBtn--mobileFloat\s*\{\s*display\s*:\s*none\s*!important/i.test(appCss), "static:app_hide");
  must(
    /body\.iu-home:not\(\.iu-mobileMainVisible\)\s*\.iuTopbarInfoBtn--mobileFloat/.test(appCss),
    "static:app_show_home"
  );
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
  const PORT = 9180 + Math.floor(Math.random() * 40);
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

function isBadBootFlash(sample) {
  if (!sample || sample.missing) return false;
  if (!sample.visible) return false;
  // Wrong mezistav: in-flow light button near top-left before final fixed-right.
  if (sample.position === "static" || sample.position === "relative") {
    if (sample.x < 80 && sample.y < 80) return true;
  }
  if (sample.bgRgb && sample.bgRgb[0] > 200 && sample.bgRgb[1] > 200 && sample.bgRgb[2] > 200) {
    if (sample.x < 80 && sample.y < 80) return true;
  }
  return false;
}

async function probeViewport(browser, origin, label, viewport) {
  const isDesktop = viewport.width >= 1025;
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: viewport.width <= 900,
    hasTouch: viewport.width <= 1024,
  });
  await ctx.addInitScript(() => {
    try {
      window.__IU_FORCE_TERMS_GATE__ = true;
      localStorage.clear();
    } catch (_) {}
    window.__iuIcentrumBootGuard = {
      samples: [],
      cls: 0,
      icentrumCls: 0,
    };
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.hadRecentInput) continue;
          window.__iuIcentrumBootGuard.cls += e.value;
          const hit = (e.sources || []).some((s) => {
            try {
              const n = s.node;
              if (!n) return false;
              if (n.id === "iuSilverWelcomeInfoBtn") return true;
              if (n.classList && n.classList.contains("iuTopbarInfoBtn--mobileFloat")) return true;
            } catch (_) {}
            return false;
          });
          if (hit) window.__iuIcentrumBootGuard.icentrumCls += e.value;
        }
      });
      po.observe({ type: "layout-shift", buffered: true });
    } catch (_) {}

    function snap(tag) {
      try {
        const btn = document.getElementById("iuSilverWelcomeInfoBtn");
        if (!btn) return;
        const cs = getComputedStyle(btn);
        const r = btn.getBoundingClientRect();
        const bg = cs.backgroundColor || "";
        let bgRgb = null;
        const m = bg.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
        if (m) bgRgb = [Number(m[1]), Number(m[2]), Number(m[3])];
        const defer = document.querySelector('link[data-iu-defer-app-css="1"]');
        window.__iuIcentrumBootGuard.samples.push({
          tag: String(tag || ""),
          t: performance.now(),
          display: cs.display,
          position: cs.position,
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          visible: r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden",
          bg: bg,
          bgRgb: bgRgb,
          appCssMedia: defer ? defer.media : null,
          bodyHasHome: !!(document.body && document.body.classList.contains("iu-home")),
        });
      } catch (_) {}
    }

    const mo = new MutationObserver(() => {
      if (document.getElementById("iuSilverWelcomeInfoBtn")) {
        snap("mutation");
        mo.disconnect();
      }
    });
    try {
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {}
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        snap("domcontentloaded");
      },
      { once: true }
    );
  });

  const page = await ctx.newPage();
  // Only delay app.css on mobile/tablet. Desktop keeps matching-media CSS render-blocking in production.
  if (!isDesktop) {
    await page.route("**/assets/app.css**", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
  }

  await page.goto(origin + "/projects/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#iuSilverWelcomeInfoBtn", { state: "attached", timeout: 15000 });
  await page.waitForTimeout(120);
  const early = await page.evaluate(() => {
    const btn = document.getElementById("iuSilverWelcomeInfoBtn");
    if (!btn) return { missing: true };
    const cs = getComputedStyle(btn);
    const r = btn.getBoundingClientRect();
    const bg = cs.backgroundColor || "";
    let bgRgb = null;
    const m = bg.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (m) bgRgb = [Number(m[1]), Number(m[2]), Number(m[3])];
    const defer = document.querySelector('link[data-iu-defer-app-css="1"]');
    return {
      tag: "early",
      missing: false,
      display: cs.display,
      position: cs.position,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      visible: r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden",
      bg: bg,
      bgRgb: bgRgb,
      appCssMedia: defer ? defer.media : null,
      bodyHasHome: !!(document.body && document.body.classList.contains("iu-home")),
    };
  });
  await page.waitForTimeout(2400);
  const late = await page.evaluate(() => {
    const btn = document.getElementById("iuSilverWelcomeInfoBtn");
    if (!btn) return { missing: true };
    const cs = getComputedStyle(btn);
    const r = btn.getBoundingClientRect();
    return {
      tag: "late",
      missing: false,
      display: cs.display,
      position: cs.position,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      visible: r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden",
      bodyHasHome: !!(document.body && document.body.classList.contains("iu-home")),
    };
  });
  const probe = await page.evaluate(() => window.__iuIcentrumBootGuard);
  await ctx.close();
  return { label, viewport, early, late, probe };
}

async function runtime() {
  const browser = await chromium.launch({ headless: true });
  try {
    await withServer(async (origin) => {
      const mobile = await probeViewport(browser, origin, "mobile", { width: 390, height: 844 });
      const tablet = await probeViewport(browser, origin, "tablet", { width: 768, height: 1024 });
      const desktop = await probeViewport(browser, origin, "desktop", { width: 1280, height: 800 });

      for (const row of [mobile, tablet]) {
        const prefix = "rt:" + row.label + ":";
        must(!isBadBootFlash(row.early), prefix + "no_bad_early_flash");
        for (const s of row.probe.samples || []) {
          must(!isBadBootFlash(s), prefix + "no_bad_sample:" + s.tag);
        }
        must(row.probe.icentrumCls < 0.01, prefix + "icentrum_cls_lt_0.01");
        // Final: when home, float is fixed on the right half.
        if (row.late.bodyHasHome && row.late.visible) {
          must(row.late.position === "fixed", prefix + "late_fixed");
          must(row.late.x > row.viewport.width * 0.45, prefix + "late_right");
        }
      }

      // Desktop regression: welcome mobileFloat must not paint as a left boot flash either.
      must(!isBadBootFlash(desktop.early), "rt:desktop:no_bad_early_flash");
      // On desktop the welcome float is hidden by app.css (≥1025); allow missing/hidden.
      if (desktop.late.visible) {
        must(desktop.late.x > 200, "rt:desktop:not_left_float");
      }

      console.log(
        JSON.stringify(
          {
            IU_MOBILE_ICENTRUM_BOOT_FOUC_GUARD: fails.length ? "FAIL" : "PASS",
            mobile_early: mobile.early,
            tablet_early: tablet.early,
            desktop_early_visible: desktop.early.visible,
            mobile_icentrumCls: mobile.probe.icentrumCls,
            tablet_icentrumCls: tablet.probe.icentrumCls,
            mobile_cls: mobile.probe.cls,
            tablet_cls: tablet.probe.cls,
          },
          null,
          2
        )
      );
    });
  } finally {
    await browser.close();
  }
}

staticGate();
await runtime();

if (fails.length) {
  console.error("[iu-mobile-icentrum-boot-fouc-guard] FAIL " + fails.join(","));
  process.exit(1);
}
console.log("[iu-mobile-icentrum-boot-fouc-guard] PASS");
