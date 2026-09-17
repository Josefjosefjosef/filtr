#!/usr/bin/env node
/**
 * Freeze guard: MindMenu white-box bottom flush to fixed bottom nav
 * (mobile / tablet / PWA). Geometry contract — not screenshot soft-match.
 *
 * At scroll-end for dynamic button counts (4 / 10 / 20) and after live
 * add/remove without reload:
 *   |box.bottom − nav.top| ≤ GAP_MAX_PX
 *   last content not under nav
 *   natural inner pad (last tile → box bottom) preserved (≥ INNER_PAD_MIN)
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
const PORT = parseInt(process.env.IU_GUARD_PORT || "8847", 10);
const GAP_MAX_PX = 2;
const INNER_PAD_MIN = 8;
const OVERLAP_TOL = 1;

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
  { id: "mobile", width: 390, height: 844, isMobile: true, pwa: false },
  { id: "tablet", width: 820, height: 1180, isMobile: false, pwa: false },
  { id: "pwa", width: 390, height: 844, isMobile: true, pwa: true },
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
  ok("sw_cache_allowed", swHasAllowedCacheVersion(sw));
  ok("allowlist_lineage_mm_flush", allow.includes(CACHE_TOKEN) || allow.includes("mindmenu-box-nav-flush-v1"));

  const toolsPadBlock = css.match(
    /body\.iu-mobileGateOverlayOpen\s+#iuMobileGateContent\s+#iuMobileGatePanelTools\.iu-mobileGatePanel:not\(\[hidden\]\)\s*\{[^}]*\}/
  );
  const toolsPadCss = toolsPadBlock ? toolsPadBlock[0] : "";
  ok("tools_pad_uses_bottom_nav_height", /--bottom-nav-height/.test(toolsPadCss));
  ok("tools_pad_not_safe_space_plus40", !/--iu-mobile-bottom-nav-safe-space/.test(toolsPadCss));
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
  // Home CHMU flush must remain intact (do not weaken sibling contract).
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
    // Short content: stay at 0 (box already fills above nav). Tall: scroll to end.
    const overflows = panel.scrollHeight > panel.clientHeight + 2;
    panel.scrollTop = overflows ? 1e9 : 0;
    window.scrollTo(0, overflows ? 1e9 : 0);
    const navR = nav.getBoundingClientRect();
    const boxR = box.getBoundingClientRect();
    const lastR = last.getBoundingClientRect();
    const gapBoxToNav = navR.top - boxR.bottom;
    const innerPad = boxR.bottom - lastR.bottom;
    const underNav = lastR.bottom > navR.top + overlapTol;
    const cs = getComputedStyle(panel);
    const rootCs = getComputedStyle(document.documentElement);
    return {
      ok: true,
      tileCount: document.querySelectorAll(".mindMenu .iuTile, .mindMenu .iu-mailbox-row").length,
      gapBoxToNav: Number(gapBoxToNav.toFixed(2)),
      innerPad: Number(innerPad.toFixed(2)),
      underNav,
      overflows,
      navH: Number(navR.height.toFixed(2)),
      panelPad: Number((parseFloat(cs.paddingBottom) || 0).toFixed(2)),
      bottomNavVar: rootCs.getPropertyValue("--bottom-nav-height").trim(),
      safeSpaceVar: rootCs.getPropertyValue("--iu-mobile-bottom-nav-safe-space").trim(),
    };
  }, OVERLAP_TOL);
}

function verdict(m, tag) {
  const fails = [];
  if (!m || !m.ok) {
    fails.push(tag + ":missing");
    return fails;
  }
  if (Math.abs(m.gapBoxToNav) > GAP_MAX_PX) fails.push(tag + ":gap_" + m.gapBoxToNav);
  if (m.underNav) fails.push(tag + ":under_nav");
  if (!(m.innerPad >= INNER_PAD_MIN)) fails.push(tag + ":inner_pad_" + m.innerPad);
  if (!(m.tileCount > 0)) fails.push(tag + ":no_tiles");
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
        userAgent: vp.isMobile
          ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
          : undefined,
      };
      if (vp.pwa) {
        ctxOpts.userAgent =
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
      }
      const context = await bootstrapGuardContext(browser, ctxOpts);
      if (vp.pwa) {
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

      for (const n of [4, 10, 20]) {
        await setTileCount(page, n);
        await page.waitForTimeout(200);
        const m = await measure(page);
        const tag = vp.id + "_n" + n;
        const f = verdict(m, tag);
        fails.push(...f);
        results.push({ tag, ...m, fails: f });
      }

      await liveAddRemove(page);
      await setTileCount(page, 10);
      await page.waitForTimeout(200);
      const live = await measure(page);
      const liveTag = vp.id + "_live_add_remove";
      const liveFails = verdict(live, liveTag);
      fails.push(...liveFails);
      results.push({ tag: liveTag, ...live, fails: liveFails });

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  const report = {
    gapMaxPx: GAP_MAX_PX,
    innerPadMin: INNER_PAD_MIN,
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
