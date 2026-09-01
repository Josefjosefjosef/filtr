#!/usr/bin/env node
/**
 * RYCHLÝ PŘEHLED — horizontal content must not vanish under the blue title (mobile/tablet).
 * Root cause regression: hideInfoPanelMount must not wipe #iuMobileInfoPanelMount for
 * transient CSS gates; paint on viewport; reinits on gate clear / pageshow / visibility.
 * Run: npm run iu-rychly-prehled-horizontal-content-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PANEL_JS = path.join(REPO, "assets", "iu-desktop-info-panel.js");
const INDEX = path.join(REPO, "projects", "index.html");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8895", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;
const CACHE_BUST = "remove-environment-info-panel-v1-20260901";

const VIEWPORTS = [
  { name: "MOBILE", width: 390, height: 844 },
  { name: "TABLET", width: 768, height: 1024 },
];

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function staticGate() {
  const panelJs = fs.readFileSync(PANEL_JS, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const checks = [
    {
      id: "has_mobile_viewport_helper",
      pass: /function isMobileTabletViewport\(/.test(panelJs),
    },
    {
      id: "has_gate_blocking_helper",
      pass: /function isMobileTabletGateBlocking\(/.test(panelJs),
    },
    {
      id: "has_mobile_mount_needs_paint",
      pass: /function mobileMountNeedsPaint\(/.test(panelJs),
    },
    {
      id: "no_wipe_on_transient_gates",
      pass:
        /do NOT wipe mobile mount for transient CSS gates/.test(panelJs) &&
        /if \(mobileMount && !mobileViewport\)/.test(panelJs) &&
        !/if \(mobileMount && !mobileActive\) \{\s*hideInfoPanelMount\(mobileMount\)/.test(panelJs),
    },
    {
      id: "paint_on_mobile_viewport",
      pass: /if \(mobileViewport && mobileMount\)/.test(panelJs),
    },
    {
      id: "recheck_after_await",
      pass: /const mobileViewportAfter = isMobileTabletViewport\(/.test(panelJs),
    },
    {
      id: "pending_render_followup",
      pass: /pendingRenderOptions/.test(panelJs),
    },
    {
      id: "pageshow_handler",
      pass: /addEventListener\("pageshow"/.test(panelJs),
    },
    {
      id: "body_context_observer",
      pass: /attributeFilter:\s*\["class",\s*"data-iu-fc"\]/.test(panelJs),
    },
    {
      id: "ensure_mobile_on_visibility",
      pass: /ensureMobilePanelContent/.test(panelJs),
    },
    {
      id: "index_cache_bust",
      pass: new RegExp(`iu-desktop-info-panel\\.js\\?v=[^"']*${CACHE_BUST}`).test(index),
    },
    {
      id: "title_outside_mount",
      pass:
        /data-iu-home-section-bar="rychly-prehled"/.test(index) &&
        /id="iuMobileInfoPanelMount"/.test(index),
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

async function clearTransientGates(page) {
  await page.evaluate(() => {
    const body = document.body;
    if (!body) return;
    body.classList.remove("iu-mobileMainVisible");
    body.classList.remove("iu-mobileGateOverlayOpen");
    body.setAttribute("data-iu-fc", "1");
  });
}

async function waitForHorizontalContent(page) {
  await clearTransientGates(page);
  await page.waitForFunction(() => {
    const mount = document.getElementById("iuMobileInfoPanelMount");
    const panel = document.getElementById("iuMobileInfoPanel");
    const segs = panel ? panel.querySelectorAll(".iuDesktopInfoPanel__segment") : [];
    return (
      !!mount &&
      !!panel &&
      segs.length >= 2 &&
      (mount.getAttribute("data-iu-info-panel-ready") === "1" || segs.length >= 2)
    );
  }, { timeout: 45000 });
  await clearTransientGates(page);
  await page.waitForTimeout(300);
}

async function measureContent(page, label) {
  return page.evaluate((label) => {
    const bar = document.querySelector('[data-iu-home-section-bar="rychly-prehled"]');
    const mount = document.getElementById("iuMobileInfoPanelMount");
    const panel = document.getElementById("iuMobileInfoPanel");
    const scroll = panel ? panel.querySelector(".iuDesktopInfoPanel__scroll") : null;
    const segs = panel ? Array.from(panel.querySelectorAll(".iuDesktopInfoPanel__segment")) : [];
    const environment = panel ? panel.querySelector('[data-iu-info-panel-id="environment"]') : null;
    const environmentText = panel ? (panel.textContent || "").includes("Investice na ochranu") : false;
    const parcel = document.querySelector('[data-iu-home-section-bar="sledovani-zasilek"]');
    const barRect = bar ? bar.getBoundingClientRect() : null;
    const mountRect = mount ? mount.getBoundingClientRect() : null;
    const parcelRect = parcel ? parcel.getBoundingClientRect() : null;
    const mountCs = mount ? getComputedStyle(mount) : null;
    const pass =
      !!bar &&
      !!mount &&
      !!panel &&
      segs.length >= 2 &&
      !environment &&
      !environmentText &&
      mountRect &&
      mountRect.height > 40 &&
      mountCs &&
      mountCs.display !== "none" &&
      mountCs.visibility !== "hidden" &&
      !mount.hidden &&
      !mount.hasAttribute("hidden") &&
      (!parcelRect || !mountRect || mountRect.top >= parcelRect.bottom - 2);
    return {
      label,
      pass,
      barVisible: !!(barRect && barRect.height > 8),
      segmentCount: segs.length,
      noEnvironmentSegment: !environment && !environmentText,
      mountHeight: mountRect ? Math.round(mountRect.height) : 0,
      mountHiddenAttr: !!(mount && (mount.hidden || mount.hasAttribute("hidden"))),
      mountDisplay: mountCs ? mountCs.display : null,
      hasScroll: !!scroll,
      scrollWidth: scroll ? scroll.scrollWidth : 0,
      clientWidth: scroll ? scroll.clientWidth : 0,
      parcelBelow:
        !parcelRect || !mountRect ? null : Math.round(mountRect.top - parcelRect.bottom),
    };
  }, label);
}

async function simulateTransientGateWipeAttempt(page) {
  return page.evaluate(async () => {
    const mount = document.getElementById("iuMobileInfoPanelMount");
    const beforeSegs = mount
      ? mount.querySelectorAll(".iuDesktopInfoPanel__segment").length
      : 0;
    const body = document.body;
    body.classList.add("iu-mobileMainVisible");
    await new Promise((r) => setTimeout(r, 80));
    if (typeof window.__iuInfoPanelEnsureMobileContent === "function") {
      window.__iuInfoPanelEnsureMobileContent();
    }
    body.classList.remove("iu-mobileMainVisible");
    body.setAttribute("data-iu-fc", "1");
    await new Promise((r) => setTimeout(r, 250));
    const afterSegs = mount
      ? mount.querySelectorAll(".iuDesktopInfoPanel__segment").length
      : 0;
    const wiped = afterSegs === 0 && beforeSegs > 0;
    return { beforeSegs, afterSegs, wiped };
  });
}

async function runViewport(browser, vp) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const cycles = [];

  await page.goto(`${BASE}?section=media&iuInfoSystem=off&nosw=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 });
  await waitForHorizontalContent(page);
  cycles.push(await measureContent(page, "first_open"));

  for (let i = 1; i <= 3; i += 1) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForHorizontalContent(page);
    cycles.push(await measureContent(page, `reload_${i}`));
  }

  await page.goto(`${BASE}?section=hry&iuInfoSystem=off&nosw=1`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(600);
  await page.goto(`${BASE}?section=media&iuInfoSystem=off&nosw=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForHorizontalContent(page);
  cycles.push(await measureContent(page, "nav_away_back"));

  const gateProbe = await simulateTransientGateWipeAttempt(page);
  await waitForHorizontalContent(page);
  cycles.push(await measureContent(page, "after_transient_gate"));

  const duplicate = await page.evaluate(() => {
    return document.querySelectorAll("#iuMobileInfoPanel").length;
  });

  await context.close();
  const pass = cycles.every((c) => c.pass) && !gateProbe.wiped && duplicate === 1;
  return {
    viewport: vp.name,
    pass,
    cycles,
    gateProbe,
    duplicatePanels: duplicate,
  };
}

async function runDesktopSmoke(browser) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: 1280, height: 900 },
    isMobile: false,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}?section=media&iuInfoSystem=off&nosw=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  const metrics = await page.evaluate(() => {
    const mobileMount = document.getElementById("iuMobileInfoPanelMount");
    const desktopMount = document.getElementById("iuDesktopInfoPanelMount");
    const bar = document.querySelector('[data-iu-home-section-bar="rychly-prehled"]');
    const barCs = bar ? getComputedStyle(bar) : null;
    return {
      mobileHidden:
        !mobileMount ||
        getComputedStyle(mobileMount).display === "none" ||
        mobileMount.offsetParent === null,
      desktopPresent: !!desktopMount,
      barHiddenOnPc: !bar || (barCs && barCs.display === "none"),
    };
  });
  await context.close();
  const pass = metrics.mobileHidden && metrics.barHiddenOnPc;
  return { viewport: "DESKTOP", pass, ...metrics };
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log(JSON.stringify({ result: "FAIL", phase: "static", ...staticResult }, null, 2));
    process.exit(1);
  }

  let serverProc = null;
  if (USE_LOCAL_SERVER) {
    serverProc = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
      cwd: REPO,
      stdio: "ignore",
      env: { ...process.env, PORT: String(PORT) },
    });
    await waitForPort("127.0.0.1", PORT, 30000);
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const vp of VIEWPORTS) {
      results.push(await runViewport(browser, vp));
    }
    results.push(await runDesktopSmoke(browser));
  } finally {
    await browser.close();
    if (serverProc) {
      try { serverProc.kill("SIGTERM"); } catch (_) {}
    }
  }

  const pass = results.every((r) => r.pass);
  console.log(JSON.stringify({ result: pass ? "PASS" : "FAIL", static: staticResult, viewports: results }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
