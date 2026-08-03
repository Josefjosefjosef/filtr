#!/usr/bin/env node
/**
 * Datová schránka — mobil/tablet: spodní hrana panelu musí navazovat na horní hranu spodní navigace (bez mezery).
 * Také: max-height none (top+bottom only), žádný page bleed pod panelem, 901–1024 bez nav insetu.
 * Run: npm run iu-ds-mobile-overlay-nav-flush-guard
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

const UNIFIED = path.join(REPO, "assets", "iu-overlay-mobile-tablet-unified-v1.css");
const RESTORE = path.join(REPO, "assets", "iu-mindmenu-bottom-nav-restore-v1.css");
const APP_JS = path.join(REPO, "assets", "app.js");
const INDEX = path.join(REPO, "projects", "index.html");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8899", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const CACHE_BUST =
  "ds-mobile-overlay-nav-flush-v1-20260713-bottom-nav-keyboard-hide-v1-20260802-ds-full-height-v1-20260803";

const VIEWPORTS = [
  { name: "MOBILE", width: 390, height: 844, expectNav: true },
  { name: "TABLET", width: 768, height: 1024, expectNav: true },
  { name: "TABLET_WIDE", width: 1024, height: 768, expectNav: false },
];

function staticGate() {
  const unified = fs.readFileSync(UNIFIED, "utf8");
  const restore = fs.readFileSync(RESTORE, "utf8");
  const appJs = fs.readFileSync(APP_JS, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const dsBlock = unified.match(
    /body\.iu-modal-open\.iu-ds-overlay-open #iuDsPanel\.iu-ds-panel\.iuSectionDS\[data-open="1"\]:not\(\[hidden\]\)\s*\{[\s\S]*?\}/
  );
  const block = dsBlock ? dsBlock[0] : "";
  const checks = [
    {
      id: "unified_ds_panel_bottom_nav_height",
      pass: /--iu-tool-overlay-panel-bottom/.test(block),
    },
    {
      id: "unified_ds_panel_max_height_none",
      pass: /max-height:\s*none !important/.test(block),
    },
    {
      id: "unified_ds_no_svh_cap_on_panel",
      pass: !/body\.iu-modal-open\.iu-ds-overlay-open #iuDsPanel[\s\S]{0,220}100svh/.test(unified),
    },
    {
      id: "unified_no_mobile_safe_space_panel_override",
      pass: !/@media \(max-width: 900px\)[\s\S]*iu-ds-overlay-open[\s\S]*--iu-mobile-bottom-nav-safe-space/.test(unified),
    },
    {
      id: "unified_no_tablet_raw_bottom_zero",
      pass: !/@media \(min-width: 901px\)[\s\S]{0,400}?iu-ds-overlay-open[\s\S]{0,200}?(?<![-\w])bottom:\s*0\s*!important/.test(
        unified
      ),
    },
    {
      id: "unified_tablet_nav_hidden_panel_bottom_token_zero",
      pass: /@media \(min-width: 901px\)\s*\{\s*body\.iu-modal-open\.iu-ds-overlay-open\s*\{\s*--iu-tool-overlay-panel-bottom:\s*0px/.test(
        unified
      ),
    },
    {
      id: "restore_ds_panel_bottom_nav_height",
      pass: /body\.iu-modal-open\.iu-ds-overlay-open #iuDsPanel\.iu-ds-panel\[data-open="1"\]:not\(\[hidden\]\)[\s\S]*--(?:iu-tool-overlay-panel-bottom|bottom-nav-height)/.test(
        restore
      ),
    },
    {
      id: "restore_ds_panel_max_height_none",
      pass: /body\.iu-modal-open\.iu-ds-overlay-open #iuDsPanel\.iu-ds-panel\[data-open="1"\]:not\(\[hidden\]\)[\s\S]*max-height:\s*none !important/.test(
        restore
      ),
    },
    {
      id: "restore_ds_panel_no_safe_space_anchor",
      pass: !/body\.iu-modal-open\.iu-ds-overlay-open #iuDsPanel\.iu-ds-panel\[data-open="1"\]:not\(\[hidden\]\)[\s\S]*--iu-mobile-bottom-nav-safe-space/.test(
        restore
      ),
    },
    {
      id: "app_js_inject_uses_tool_overlay_panel_bottom",
      pass: /iuDsInjectMobileTabletCssOnce[\s\S]*bottom:var\(--iu-tool-overlay-panel-bottom/.test(appJs),
    },
    {
      id: "app_js_inject_panel_max_height_none",
      pass: /iuDsInjectMobileTabletCssOnce[\s\S]*#iuDsPanel\.iu-ds-panel\.iuSectionDS\[data-open=\\"1\\"\][\s\S]*max-height:none!important/.test(
        appJs
      ),
    },
    {
      id: "index_cache_bust_unified",
      pass: new RegExp(`iu-overlay-mobile-tablet-unified-v1\\.css\\?v=${CACHE_BUST}`).test(index),
    },
    {
      id: "index_cache_bust_restore",
      pass: new RegExp(`iu-mindmenu-bottom-nav-restore-v1\\.css\\?v=${CACHE_BUST}`).test(index),
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

async function openDatovkaViaGate(page) {
  await page.evaluate(() => {
    const gateTab = document.getElementById("iuMobileGateTabTools");
    if (gateTab) gateTab.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const btn = document.querySelector('[data-iuq="datovka"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(900);
}

async function measurePanelNavFlush(page, expectNav) {
  return page.evaluate((expectNav) => {
    const nav = document.getElementById("iuMobileBottomNav");
    const panel = document.getElementById("iuDsPanel");
    const overlay = document.getElementById("iuDsOverlay");
    const navRect = nav ? nav.getBoundingClientRect() : null;
    const panelRect = panel ? panel.getBoundingClientRect() : null;
    const overlayRect = overlay ? overlay.getBoundingClientRect() : null;
    const navVisible = !!(nav && navRect && navRect.height > 0 && getComputedStyle(nav).display !== "none");
    const panelOpen =
      panel &&
      !panel.hidden &&
      panel.dataset.open === "1" &&
      getComputedStyle(panel).display !== "none" &&
      panelRect &&
      panelRect.height > 40;
    const cs = panel ? getComputedStyle(panel) : null;
    const maxHeightNone = !!(cs && (cs.maxHeight === "none" || cs.maxHeight === "" || Number.parseFloat(cs.maxHeight) > 9000));
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const gapPx =
      navVisible && panelRect && navRect ? Math.round(navRect.top - panelRect.bottom) : null;
    const viewportBottomGap =
      !navVisible && panelRect ? Math.round(vh - panelRect.bottom) : null;

    let midHitOk = false;
    let midHitTag = null;
    if (panelOpen && panelRect) {
      const y =
        expectNav && navVisible && navRect
          ? (panelRect.bottom + navRect.top) / 2
          : panelRect.bottom - 2;
      const x = Math.round((panelRect.left + panelRect.right) / 2);
      const el = document.elementFromPoint(x, Math.max(0, Math.round(y)));
      midHitTag = el ? `${el.id || ""}|${el.className || ""}`.slice(0, 120) : null;
      if (el && panel.contains(el)) midHitOk = true;
      if (el && nav && nav.contains(el)) midHitOk = true;
      if (el && (el.id === "iuDsPanel" || el.closest?.("#iuDsPanel"))) midHitOk = true;
    }

    const overlayFlush =
      !!(overlayRect && panelRect && Math.abs(Math.round(overlayRect.bottom) - Math.round(panelRect.bottom)) <= 2);

    const passNav = expectNav
      ? panelOpen &&
        navVisible &&
        gapPx !== null &&
        Math.abs(gapPx) <= 1 &&
        maxHeightNone &&
        midHitOk &&
        overlayFlush
      : panelOpen &&
        !navVisible &&
        viewportBottomGap !== null &&
        viewportBottomGap <= 2 &&
        maxHeightNone &&
        midHitOk &&
        overlayFlush;

    return {
      pass: passNav,
      expectNav,
      navVisible,
      panelOpen,
      gapPx,
      viewportBottomGap,
      maxHeightNone,
      midHitOk,
      midHitTag,
      overlayFlush,
      panelBottom: panelRect ? Math.round(panelRect.bottom) : null,
      overlayBottom: overlayRect ? Math.round(overlayRect.bottom) : null,
      navTop: navRect ? Math.round(navRect.top) : null,
      viewportH: Math.round(vh),
    };
  }, expectNav);
}

async function runViewport(browser, vp) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await openDatovkaViaGate(page);
  const measure = await measurePanelNavFlush(page, vp.expectNav);
  await context.close();
  return { viewport: vp.name, ...measure };
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log(JSON.stringify({ result: "FAIL", phase: "static", ...staticResult }, null, 2));
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
        fp.endsWith(".css") ? "text/css; charset=utf-8" :
        fp.endsWith(".js") ? "text/javascript; charset=utf-8" :
        fp.endsWith(".html") ? "text/html; charset=utf-8" :
        "application/octet-stream";
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
  for (const vp of VIEWPORTS) {
    results.push(await runViewport(browser, vp));
  }
  await browser.close();
  server.close();

  const pass = results.every((r) => r.pass);
  console.log(JSON.stringify({ result: pass ? "PASS" : "FAIL", static: staticResult, viewports: results }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
