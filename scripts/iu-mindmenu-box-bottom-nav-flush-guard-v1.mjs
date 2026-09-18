#!/usr/bin/env node
/**
 * Freeze guard: MindMenu white-box bottom flush to fixed bottom nav
 * (mobile / tablet browser + standalone PWA).
 *
 * Root cause of PWA-only gap (browser OK): #iuMobileGateContent
 * padding-bottom: env(safe-area-inset-bottom) + panel padding-bottom:
 * --bottom-nav-height (measured nav already includes safe-area) double-counted
 * the home-indicator strip under the white .mindMenu box.
 *
 * Modes:
 *  - browser: viewport only (safe≈0 path that Safari already passed)
 *  - pwa-standalone: navigator.standalone + display-mode:standalone PLUS
 *    injected safe-area (34px) on content+nav so Chromium cannot false-PASS
 *    without exercising the double-count path
 *
 * Geometry at scroll-end (4 / 10 / 20 + live add/remove):
 *   |box.bottom − nav.top| ≤ GAP_MAX_PX
 *   last.bottom < box.bottom ≤ nav.top (+tol)
 *   inner pad (last → box bottom) ≥ INNER_PAD_MIN
 *
 * Run: npm run iu-mindmenu-box-bottom-nav-flush-guard
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext, waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";
import { swHasAllowedCacheVersion } from "./guards/iu-sw-cache-version-allowlist.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const APP_CSS = path.join(REPO, "assets", "app.css");
const INDEX = path.join(REPO, "projects", "index.html");
const SW = path.join(REPO, "sw.js");
const ALLOW = path.join(REPO, "scripts", "guards", "iu-sw-cache-version-allowlist.cjs");
const REPORT = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "iu_mindmenu_box_bottom_nav_flush_guard.json");
const CACHE_TOKEN = "2026-09-17-mindmenu-box-nav-flush-v1";
const APP_CSS_BUST = "mindmenu-box-nav-flush-v1-20260917";
const PWA_FLUSH_BUST = "mindmenu-pwa-box-nav-flush-v1-20260918";
const PORT = parseInt(process.env.IU_GUARD_PORT || "8847", 10);
const GAP_MAX_PX = 2;
const INNER_PAD_MIN = 8;
const OVERLAP_TOL = 1;
const PWA_SAFE_BOTTOM_PX = 34;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const VIEWPORTS = [
  { id: "browser-phone", width: 390, height: 844, isMobile: true, mode: "browser" },
  { id: "browser-tablet", width: 820, height: 1180, isMobile: false, mode: "browser" },
  { id: "pwa-standalone", width: 390, height: 844, isMobile: true, mode: "pwa" },
];

function staticGate() {
  const css = fs.readFileSync(APP_CSS, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const sw = fs.readFileSync(SW, "utf8");
  const allow = fs.readFileSync(ALLOW, "utf8");
  const fails = [];
  const ok = (id, cond) => {
    if (!cond) fails.push(id);
  };

  ok("cache_bust_index_app_css", index.includes(APP_CSS_BUST) && /app\.css\?v=/.test(index));
  ok("cache_bust_pwa_flush_token", index.includes(PWA_FLUSH_BUST) || css.includes("P0 PWA MindMenu gap"));
  ok("sw_cache_allowed", swHasAllowedCacheVersion(sw));
  ok("allowlist_lineage_mm_flush", allow.includes(CACHE_TOKEN) || allow.includes("mindmenu-box-nav-flush-v1"));

  const toolsPadBlock = css.match(
    /body\.iu-mobileGateOverlayOpen\s+#iuMobileGateContent\s+#iuMobileGatePanelTools\.iu-mobileGatePanel:not\(\[hidden\]\)\s*\{[^}]*\}/
  );
  const toolsPadCss = toolsPadBlock ? toolsPadBlock[0] : "";
  ok("tools_pad_uses_bottom_nav_height", /--bottom-nav-height/.test(toolsPadCss));
  ok("tools_pad_not_safe_space_plus40", !/--iu-mobile-bottom-nav-safe-space/.test(toolsPadCss));
  ok(
    "tools_content_pad_bottom_zero",
    /data-iu-mobile-gate="tools"[\s\S]{0,220}#iuMobileGateContent[\s\S]{0,180}padding-bottom:\s*0\s*!important/.test(
      css
    )
  );
  ok(
    "mm_minheight_no_double_safe_bottom",
    /body\.iu-mobileGateOverlayOpen\s+#iuMobileGatePanelTools\s+\.mindMenu\s*\{[\s\S]{0,700}min-height:\s*calc\(\s*100dvh[\s\S]{0,200}?--bottom-nav-height/.test(
      css
    ) &&
      !/body\.iu-mobileGateOverlayOpen\s+#iuMobileGatePanelTools\s+\.mindMenu\s*\{[\s\S]{0,500}min-height:\s*calc\(\s*100dvh\s*-\s*env\(safe-area-inset-top[\s\S]{0,80}env\(safe-area-inset-bottom/.test(
        css
      )
  );
  ok(
    "mm_flow_no_stale_minheight",
    /body\.iu-mobileGateOverlayOpen\s+#iuMobileGatePanelTools\s+#iuMobileMindMenuFlow\s*\{[\s\S]{0,400}min-height:\s*0\s*!important/.test(
      css
    )
  );
  ok(
    "mm_box_min_height_above_nav",
    /body\.iu-mobileGateOverlayOpen\s+#iuMobileGatePanelTools\s+\.mindMenu\s*\{[\s\S]{0,600}min-height:\s*calc\(\s*100dvh/.test(
      css
    )
  );
  ok("scoped_max_900", /@media\s*\(max-width:\s*900px\)/.test(css));
  ok(
    "home_chmu_flush_intact",
    /body:not\(\.iu-mobileMainVisible\):not\(\.iu-mobileGateOverlayOpen\)\s+#iuMobileGateWrap\s*\{[^}]*--bottom-nav-height/.test(
      css
    )
  );
  return { pass: fails.length === 0, fails };
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((reqIn, res) => {
      try {
        let p = decodeURIComponent(new URL(reqIn.url, "http://x").pathname);
        if (p.endsWith("/")) p += "index.html";
        const fp = path.join(REPO, p.replace(/^\/+/, ""));
        if (!fp.startsWith(REPO) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
          res.writeHead(404);
          res.end("nf");
          return;
        }
        res.writeHead(200, { "content-type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream" });
        res.end(fs.readFileSync(fp));
      } catch (_) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function openMindMenu(page) {
  await page.waitForFunction(
    () =>
      typeof window.__iuEnsureFeedPipeline === "function" ||
      document.getElementById("iuMobileGateWrap") ||
      document.getElementById("iuMobileBottomNav"),
    null,
    { timeout: 120000 }
  );
  let lastErr = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await page.evaluate(async () => {
        if (typeof window.__iuEnsureFeedPipeline === "function") {
          try {
            await window.__iuEnsureFeedPipeline();
          } catch (_) {}
        }
      });
      const opened = await page.evaluate(() => {
        const wrap = document.getElementById("iuMobileGateWrap");
        if (wrap && typeof wrap.__iuMobileGateSetTab === "function") {
          wrap.__iuMobileGateSetTab("tools");
          return "setTab";
        }
        const btn = document.querySelector('#iuMobileBottomNav [data-iu-bottom-nav="mindmenu"]');
        if (btn) {
          btn.click();
          return "click";
        }
        return null;
      });
      if (!opened) {
        await page.waitForTimeout(400);
        continue;
      }
      await page.waitForFunction(
        () => {
          const panel = document.getElementById("iuMobileGatePanelTools");
          const box = document.querySelector("#iuMobileGatePanelTools .mindMenu, #iuMobileMindMenuFlow .mindMenu, .mindMenu");
          return (
            document.body.classList.contains("iu-mobileGateOverlayOpen") &&
            panel &&
            !panel.hidden &&
            box &&
            box.getBoundingClientRect().height > 40
          );
        },
        null,
        { timeout: 45000 }
      );
      await page.waitForTimeout(250);
      return;
    } catch (err) {
      lastErr = err;
      await page.waitForTimeout(400);
    }
  }
  throw lastErr || new Error("openMindMenu_timeout");
}

/** Force iOS-PWA-like safe-area geometry Chromium does not expose via env(). */
async function applyStandaloneSafeArea(page, safePx) {
  await page.evaluate((sb) => {
    const style = document.createElement("style");
    style.id = "iu-mm-flush-guard-safe-area";
    style.textContent =
      "#iuMobileBottomNav.iu-mobileBottomNav{" +
      "padding-bottom:calc(10px + " +
      sb +
      "px + 6px)!important}" +
      "/* Simulate env(safe-area-inset-bottom) on the generic gate content rule. " +
      "Production tools-gate CSS must override to 0 with higher specificity — " +
      "do NOT force tools=0 here or a broken build would false-PASS. */" +
      "body.iu-mobileGateOverlayOpen #iuMobileGateContent.iu-mobileGateContent[aria-hidden=\"false\"]{" +
      "padding-bottom:" +
      sb +
      "px!important}";
    document.documentElement.appendChild(style);
    const nav = document.getElementById("iuMobileBottomNav");
    if (nav) {
      const r = nav.getBoundingClientRect();
      const h = Math.round(r.height || 0);
      if (h > 24) {
        const root = document.documentElement;
        root.style.setProperty("--bottom-nav-height", h + "px");
        root.style.setProperty("--iu-mobile-bottom-nav-total-h", h + "px");
        root.style.setProperty("--iu-mobile-bottom-nav-measured-h", h + "px");
        root.style.setProperty("--iu-tool-overlay-panel-bottom", h + "px");
        root.style.setProperty("--iu-mobile-bottom-nav-safe-space", h + 40 + "px");
      }
    }
    try {
      window.dispatchEvent(new Event("resize"));
    } catch (_) {}
  }, safePx);
  await page.waitForTimeout(120);
}

async function setTileCount(page, n) {
  await page.evaluate((keep) => {
    const grid =
      document.querySelector("#iuMobileGatePanelTools .mindMenu .iu-mmQuickGrid") ||
      document.querySelector("#iuMobileGatePanelTools .mindMenu section.iu-mmQuickLinks .iu-mmQuickGrid") ||
      document.querySelector(".mindMenu .iu-mmQuickGrid");
    const list =
      document.querySelector("#iuMobileGatePanelTools .mindMenu #iuMailboxList") ||
      document.querySelector(".mindMenu #iuMailboxList");
    const host = grid || list;
    if (!host) return;
    const sel = grid ? ".iuTile" : ".iu-mailbox-row";
    let tiles = [...host.querySelectorAll(sel)];
    if (tiles.length === 0) return;
    const proto = tiles[0];
    while (tiles.length < keep) {
      const clone = proto.cloneNode(true);
      clone.setAttribute("data-iu-mm-flush-guard-clone", "1");
      const t = clone.querySelector(".iuTileText, .iu-mailbox-pill, .iu-mmTopToolText, span");
      if (t) t.textContent = "Guard " + tiles.length;
      host.appendChild(clone);
      tiles = [...host.querySelectorAll(sel)];
    }
    tiles.forEach((c, i) => {
      if (i >= keep) c.remove();
    });
  }, n);
  await page.waitForTimeout(120);
}

async function liveAddRemove(page) {
  await page.evaluate(() => {
    const grid =
      document.querySelector("#iuMobileGatePanelTools .mindMenu .iu-mmQuickGrid") ||
      document.querySelector(".mindMenu .iu-mmQuickGrid");
    const list =
      document.querySelector("#iuMobileGatePanelTools .mindMenu #iuMailboxList") ||
      document.querySelector(".mindMenu #iuMailboxList");
    const host = grid || list;
    if (!host) return;
    const sel = grid ? ".iuTile" : ".iu-mailbox-row";
    const proto = host.querySelector(sel);
    if (!proto) return;
    const clone = proto.cloneNode(true);
    clone.setAttribute("data-iu-mm-flush-guard-live", "1");
    host.appendChild(clone);
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    const live = document.querySelector("[data-iu-mm-flush-guard-live='1']");
    if (live) live.remove();
  });
  await page.waitForTimeout(120);
}

async function measure(page) {
  return page.evaluate((overlapTol) => {
    const panel = document.getElementById("iuMobileGatePanelTools");
    const nav = document.getElementById("iuMobileBottomNav");
    const content = document.getElementById("iuMobileGateContent");
    const box =
      document.querySelector("#iuMobileGatePanelTools .mindMenu") ||
      document.querySelector("#iuMobileMindMenuFlow .mindMenu") ||
      document.querySelector(".mindMenu");
    const last =
      [...document.querySelectorAll("#iuMobileGatePanelTools .mindMenu .iuTile, .mindMenu .iuTile")].pop() ||
      [...document.querySelectorAll("#iuMobileGatePanelTools .mindMenu .iu-mailbox-row, .mindMenu .iu-mailbox-row")].pop() ||
      [...document.querySelectorAll("#iuMobileGatePanelTools .mindMenu .iu-mmTopTool, .mindMenu .iu-mmTopTool")].pop() ||
      null;
    if (!nav || !box || !last || !panel) {
      return {
        ok: false,
        reason: "missing_nodes",
        tileCount: document.querySelectorAll(".mindMenu .iuTile, .mindMenu .iu-mailbox-row").length,
      };
    }
    const overflows = panel.scrollHeight > panel.clientHeight + 2;
    panel.scrollTop = overflows ? 1e9 : 0;
    window.scrollTo(0, overflows ? 1e9 : 0);
    const navR = nav.getBoundingClientRect();
    const boxR = box.getBoundingClientRect();
    const lastR = last.getBoundingClientRect();
    const gapBoxToNav = navR.top - boxR.bottom;
    const innerPad = boxR.bottom - lastR.bottom;
    const underNav = lastR.bottom > navR.top + overlapTol;
    const boxAboveOrFlushNav = boxR.bottom <= navR.top + overlapTol;
    const lastInsideBox = lastR.bottom < boxR.bottom - 0.5;
    const cs = getComputedStyle(panel);
    const contentCs = content ? getComputedStyle(content) : null;
    const rootCs = getComputedStyle(document.documentElement);
    let standalone = false;
    try {
      standalone =
        (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
        navigator.standalone === true;
    } catch (_) {}
    return {
      ok: true,
      tileCount: document.querySelectorAll(".mindMenu .iuTile, .mindMenu .iu-mailbox-row").length,
      gapBoxToNav: Number(gapBoxToNav.toFixed(2)),
      innerPad: Number(innerPad.toFixed(2)),
      underNav,
      lastInsideBox,
      boxAboveOrFlushNav,
      overflows,
      standalone,
      navH: Number(navR.height.toFixed(2)),
      panelPad: Number((parseFloat(cs.paddingBottom) || 0).toFixed(2)),
      contentPad: contentCs ? Number((parseFloat(contentCs.paddingBottom) || 0).toFixed(2)) : null,
      bottomNavVar: rootCs.getPropertyValue("--bottom-nav-height").trim(),
      safeSpaceVar: rootCs.getPropertyValue("--iu-mobile-bottom-nav-safe-space").trim(),
    };
  }, OVERLAP_TOL);
}

function verdict(m, tag, mode) {
  const fails = [];
  if (!m || !m.ok) {
    fails.push(tag + ":missing");
    return fails;
  }
  if (Math.abs(m.gapBoxToNav) > GAP_MAX_PX) fails.push(tag + ":gap_" + m.gapBoxToNav);
  if (m.underNav) fails.push(tag + ":under_nav");
  if (!m.boxAboveOrFlushNav) fails.push(tag + ":box_past_nav");
  if (!m.lastInsideBox) fails.push(tag + ":last_not_inside_box");
  if (!(m.innerPad >= INNER_PAD_MIN)) fails.push(tag + ":inner_pad_" + m.innerPad);
  if (!(m.tileCount > 0)) fails.push(tag + ":no_tiles");
  if (mode === "pwa") {
    if (!m.standalone) fails.push(tag + ":not_standalone_flag");
    /* Tools content pad must be 0 even when safe-area is simulated. */
    if (!(m.contentPad === 0)) fails.push(tag + ":content_pad_" + m.contentPad);
    /* Guard must not accept tens-of-px gaps that looked like "PASS" before. */
    if (Math.abs(m.gapBoxToNav) > GAP_MAX_PX) {
      /* already recorded */
    } else if (m.gapBoxToNav > 8) {
      fails.push(tag + ":pwa_large_gap_" + m.gapBoxToNav);
    }
  }
  return fails;
}

(async () => {
  const staticResult = staticGate();
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const fails = [...staticResult.fails];

  try {
    for (const vp of VIEWPORTS) {
      const ctxOpts = {
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.isMobile,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      };
      const context = await bootstrapGuardContext(browser, ctxOpts);
      if (vp.mode === "pwa") {
        await context.addInitScript(() => {
          try {
            Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true });
          } catch (_) {}
          try {
            const orig = window.matchMedia.bind(window);
            window.matchMedia = (q) => {
              if (String(q).includes("display-mode") && String(q).includes("standalone")) {
                return {
                  matches: true,
                  media: q,
                  addListener() {},
                  removeListener() {},
                  addEventListener() {},
                  removeEventListener() {},
                  onchange: null,
                  dispatchEvent() {
                    return false;
                  },
                };
              }
              return orig(q);
            };
          } catch (_) {}
        });
      }
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:" + PORT + "/projects/", { waitUntil: "domcontentloaded", timeout: 90000 });
      await waitForVaultReady(page, 120000).catch(() => {});
      await page.waitForTimeout(2500);
      await openMindMenu(page);
      if (vp.mode === "pwa") {
        await applyStandaloneSafeArea(page, PWA_SAFE_BOTTOM_PX);
      }

      for (const n of [4, 10, 20]) {
        await setTileCount(page, n);
        if (vp.mode === "pwa") await applyStandaloneSafeArea(page, PWA_SAFE_BOTTOM_PX);
        await page.waitForTimeout(200);
        const m = await measure(page);
        const tag = vp.id + "_n" + n;
        const f = verdict(m, tag, vp.mode);
        fails.push(...f);
        results.push({ tag, mode: vp.mode, ...m, fails: f });
      }

      await liveAddRemove(page);
      await setTileCount(page, 10);
      if (vp.mode === "pwa") await applyStandaloneSafeArea(page, PWA_SAFE_BOTTOM_PX);
      await page.waitForTimeout(200);
      const live = await measure(page);
      const liveTag = vp.id + "_live_add_remove";
      const liveFails = verdict(live, liveTag, vp.mode);
      fails.push(...liveFails);
      results.push({ tag: liveTag, mode: vp.mode, ...live, fails: liveFails });

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  const report = {
    gapMaxPx: GAP_MAX_PX,
    innerPadMin: INNER_PAD_MIN,
    pwaSafeBottomPx: PWA_SAFE_BOTTOM_PX,
    static: staticResult,
    results,
    fails,
    pass: fails.length === 0,
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(REPORT);
  console.log("PASS=" + report.pass + " fails=" + JSON.stringify(fails));
  process.exit(report.pass ? 0 : 1);
})().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
