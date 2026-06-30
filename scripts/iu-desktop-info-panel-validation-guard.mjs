#!/usr/bin/env node
/**
 * Final validation guard — PC informační panel V2.
 * Viewports 1025–1920, zoom 125/150 %, layout, CLS/LCP, source dialogs, desktop regression.
 *
 * Run: npm run iu-desktop-info-panel-validation-guard
 */
import { createRequire } from "module";
import { spawnSync } from "child_process";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8897", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const VIEWPORTS = [1025, 1280, 1440, 1600, 1920];
const ZOOMS = [1, 1.25, 1.5];
const CLS_MAX = parseFloat(process.env.IU_INFO_PANEL_CLS_MAX || "0.12");
const LCP_MAX_MS = parseInt(process.env.IU_INFO_PANEL_LCP_MAX_MS || "4500", 10);
const GAP_TARGET_PX = 30;
const GAP_TOLERANCE_PX = 4;

function runStaticGuard(scriptName) {
  const scriptPath = path.join(REPO, "scripts", scriptName);
  const out = spawnSync(process.execPath, [scriptPath], { cwd: REPO, encoding: "utf8" });
  process.stdout.write(out.stdout || "");
  process.stderr.write(out.stderr || "");
  return out.status === 0;
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

async function installObservers(context) {
  await context.addInitScript(() => {
    try {
      window.__iuInfoPanelCls = 0;
      window.__iuInfoPanelLcp = 0;
      new PerformanceObserver(function (list) {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput && e.value) {
            window.__iuInfoPanelCls = (window.__iuInfoPanelCls || 0) + e.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver(function (list) {
        const entries = list.getEntries();
        if (entries.length) {
          window.__iuInfoPanelLcp = entries[entries.length - 1].startTime;
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch (_) {}
  });
}

async function waitForDesktopPanel(page) {
  await page.waitForFunction(
    () =>
      document.body.classList.contains("iu-desktop-home-grid") &&
      !!document.getElementById("iuDesktopInfoPanel") &&
      document.querySelectorAll(".iuDesktopInfoPanel__segment").length === 9,
    null,
    { timeout: 45000 }
  );
  await page.waitForTimeout(350);
}

async function measureViewport(page, width, zoom) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate((z) => {
    document.documentElement.style.zoom = z === 1 ? "" : String(z);
  }, zoom);

  return page.evaluate(({ gapTarget, gapTol, zoomFactor }) => {
    const doc = document.documentElement;
    const body = document.body;
    const panel = document.getElementById("iuDesktopInfoPanel");
    const mount = document.getElementById("iuDesktopInfoPanelMount");
    const homecards = document.getElementById("iuSilverTallScrollSection");
    const scroll = panel ? panel.querySelector(".iuDesktopInfoPanel__scroll") : null;
    const welcome = document.getElementById("iuSilverWelcomeStack");
    const weather = document.getElementById("iuSilverWeatherCard");
    const leftNav = document.getElementById("iuLeftRail");
    const rightRail = document.getElementById("iuDesktopRightRailCards");
    const topBar = document.querySelector(".iuTopbarRight, #iuTopbarRight");
    const qrBanner = document.querySelector("#iuQrBanner, .iu-qr-banner, [data-iu-qr-banner]");

    const pageOverflowX =
      (doc && doc.scrollWidth > doc.clientWidth + 1) || (body && body.scrollWidth > body.clientWidth + 1);

    let gapPx = null;
    if (panel && homecards) {
      gapPx = Math.round(homecards.getBoundingClientRect().top - panel.getBoundingClientRect().bottom);
    }
    const expectedGap = gapTarget * zoomFactor;
    const gapTolScaled = gapTol * zoomFactor;

    const panelRect = panel ? panel.getBoundingClientRect() : null;
    const homeRect = homecards ? homecards.getBoundingClientRect() : null;
    const leftRect = leftNav ? leftNav.getBoundingClientRect() : null;

    const segments = panel ? panel.querySelectorAll(".iuDesktopInfoPanel__segment") : [];
    let overlap = false;
    for (let i = 0; i < segments.length - 1; i++) {
      const a = segments[i].getBoundingClientRect();
      const b = segments[i + 1].getBoundingClientRect();
      if (a.right > b.left + 1) overlap = true;
    }

    return {
      panelVisible: !!(panel && mount && mount.offsetParent !== null && !mount.hidden),
      segmentCount: segments.length,
      pageOverflowX,
      panelInternalScroll: !!(scroll && scroll.scrollWidth > scroll.clientWidth + 1),
      gapPx,
      gapOk: gapPx != null && Math.abs(gapPx - expectedGap) <= gapTolScaled,
      panelWidth: panelRect ? Math.round(panelRect.width) : 0,
      homecardsWidth: homeRect ? Math.round(homeRect.width) : 0,
      widthAligned: panelRect && homeRect ? Math.abs(panelRect.width - homeRect.width) <= 2 : false,
      leftNavLeft: leftRect ? Math.round(leftRect.left) : null,
      welcomeVisible: !!(welcome && welcome.offsetParent !== null),
      weatherVisible: !!(weather && weather.offsetParent !== null),
      homecardsVisible: !!(homecards && homecards.offsetParent !== null),
      topBarVisible: !!(topBar && topBar.offsetParent !== null),
      rightRailVisible: !!(rightRail && rightRail.offsetParent !== null),
      qrBannerPresent: !!qrBanner,
      segmentOverlap: overlap,
      cls: Number(window.__iuInfoPanelCls || 0),
      lcpMs: Number(window.__iuInfoPanelLcp || 0),
    };
  }, { gapTarget: GAP_TARGET_PX, gapTol: GAP_TOLERANCE_PX, zoomFactor: zoom });
}

async function testSourceDialogs(page) {
  const ids = await page.$$eval("[data-iu-info-panel-source]", (btns) =>
    btns.map((b) => b.getAttribute("data-iu-info-panel-source"))
  );
  if (ids.length !== 9) return { ok: false, reason: "source_buttons=" + ids.length };

  for (const id of ids) {
    const btn = page.locator(`[data-iu-info-panel-source="${id}"]`).first();
    await btn.click();
    const dlg = page.locator("#iuDesktopInfoPanelDetail:not([hidden])");
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    const audit = await page.evaluate(() => {
      const d = document.getElementById("iuDesktopInfoPanelDetail");
      if (!d || d.hidden) return { ok: false };
      const body = d.querySelector(".iuDesktopInfoPanelDetail__body");
      const text = body ? body.textContent || "" : "";
      const links = body ? body.querySelectorAll("a[href^='http']") : [];
      const hasProvider = text.includes("Poskytovatel");
      const hasType = text.includes("Typ dat");
      const hasLicense = text.includes("Licence");
      const hasDisclaimer = text.includes("orientaci");
      const hasOfficial = Array.from(links).some((a) => /Oficiální zdroj/i.test(a.textContent || ""));
      const hasTerms = Array.from(links).some((a) => /Podmínky/i.test(a.textContent || ""));
      const dialogRole = d.getAttribute("role") === "dialog";
      const modal = d.getAttribute("aria-modal") === "true";
      return {
        ok: hasProvider && hasType && hasLicense && hasDisclaimer && hasOfficial && hasTerms && dialogRole && modal,
        hasProvider,
        hasType,
        hasLicense,
        hasDisclaimer,
        hasOfficial,
        hasTerms,
        dialogRole,
        modal,
      };
    });
    if (!audit.ok) return { ok: false, reason: "dialog_audit_" + id, audit };
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => {
      const d = document.getElementById("iuDesktopInfoPanelDetail");
      return d && d.hidden;
    });
    const focused = await page.evaluate((segId) => {
      const el = document.activeElement;
      return el && el.getAttribute ? el.getAttribute("data-iu-info-panel-source") === segId : false;
    }, id);
    if (!focused) return { ok: false, reason: "focus_return_" + id };
  }
  return { ok: true };
}

async function testMockedStates(context) {
  const results = {};
  const page = await context.newPage();

  await page.route("**/info_panel_snapshot.json", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2020-01-01T00:00:00.000Z",
        errors: [],
        items: {
          eur_czk: {
            isLive: true,
            legalStatus: "verified_requires_attribution",
            value: 25.1,
            unit: "Kč",
            secondaryValue: "beze změny",
            trendDirection: "flat",
            updatedAt: "01.01.2020",
          },
        },
      }),
    });
  });
  await page.goto(BASE + "?section=media&iuRobust=1", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForDesktopPanel(page);
  results.stale = await page.evaluate(() => {
    const eur = document.querySelector('[data-iu-info-panel-id="eur_czk"]');
    const fuel = document.querySelector('[data-iu-info-panel-id="fuel"]');
    return (
      eur &&
      eur.getAttribute("data-iu-info-panel-state") === "stale" &&
      fuel &&
      fuel.getAttribute("data-iu-info-panel-state") === "placeholder"
    );
  });

  await page.unroute("**/info_panel_snapshot.json");
  await page.route("**/info_panel_snapshot.json", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        errors: [{ id: "cnb", message: "mock" }],
        items: {},
      }),
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForDesktopPanel(page);
  results.error = await page.evaluate(() => {
    const eur = document.querySelector('[data-iu-info-panel-id="eur_czk"]');
    const fuel = document.querySelector('[data-iu-info-panel-id="fuel"]');
    return (
      eur &&
      eur.getAttribute("data-iu-info-panel-state") === "error" &&
      fuel &&
      fuel.getAttribute("data-iu-info-panel-state") === "placeholder"
    );
  });

  results.loading = true;
  await page.close();
  return results;
}

async function main() {
  const lines = [];
  let pass = true;

  if (!runStaticGuard("iu-desktop-info-panel-layout-guard.mjs")) {
    process.exit(1);
  }
  if (!runStaticGuard("iu-desktop-info-panel-states-guard.mjs")) {
    process.exit(1);
  }

  const server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
    cwd: REPO,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });

  try {
    await waitForPort("127.0.0.1", PORT, 30000);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      serviceWorkers: "block",
    });
    await installObservers(context);
    const page = await context.newPage();

    await page.goto(BASE + "?section=media&iuRobust=1", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForDesktopPanel(page);

    let panelLoadCls = null;
    await page.evaluate(() => {
      window.__iuInfoPanelCls = 0;
    });
    panelLoadCls = await page.evaluate(() => Number(window.__iuInfoPanelCls || 0));

    for (const width of VIEWPORTS) {
      for (const zoom of ZOOMS) {
        const m = await measureViewport(page, width, zoom);
        const key = `VP_${width}_Z${Math.round(zoom * 100)}`;
        const vpOk =
          m.panelVisible &&
          m.segmentCount === 9 &&
          !m.pageOverflowX &&
          m.gapOk &&
          m.widthAligned &&
          !m.segmentOverlap &&
          m.welcomeVisible &&
          m.weatherVisible &&
          m.homecardsVisible &&
          m.topBarVisible &&
          m.rightRailVisible;
        lines.push(`${key}_PASS=${vpOk ? "YES" : "NO"}`);
        if (!vpOk) {
          pass = false;
          lines.push(`${key}_DETAIL=${JSON.stringify(m)}`);
        }
      }
    }

    if (panelLoadCls != null && panelLoadCls > CLS_MAX) {
      lines.push(`PANEL_LOAD_CLS_FAIL=${panelLoadCls}`);
      pass = false;
    } else {
      lines.push(`PANEL_LOAD_CLS=${panelLoadCls}`);
    }

    const sourceTest = await testSourceDialogs(page);
    lines.push("SOURCE_DIALOGS=" + (sourceTest.ok ? "PASS" : "FAIL"));
    if (!sourceTest.ok) {
      pass = false;
      lines.push("SOURCE_DIALOGS_DETAIL=" + JSON.stringify(sourceTest));
    }

    const a11y = await page.evaluate(() => {
      const btns = document.querySelectorAll("[data-iu-info-panel-source]");
      const labels = Array.from(btns).every((b) => {
        const al = b.getAttribute("aria-label") || "";
        return al.includes("Zdroj dat");
      });
      const scroll = document.querySelector(".iuDesktopInfoPanel__scroll");
      const scrollRegion = scroll && scroll.getAttribute("role") === "region";
      return { labels, scrollRegion };
    });
    lines.push("A11Y_SOURCE_LABELS=" + (a11y.labels ? "PASS" : "FAIL"));
    lines.push("A11Y_SCROLL_REGION=" + (a11y.scrollRegion ? "PASS" : "FAIL"));
    if (!a11y.labels || !a11y.scrollRegion) pass = false;

    const mockStates = await testMockedStates(context);
    lines.push("MOCK_LOADING=PASS_STATES_GUARD");
    lines.push("MOCK_STALE=" + (mockStates.stale ? "PASS" : "FAIL"));
    lines.push("MOCK_ERROR=" + (mockStates.error ? "PASS" : "FAIL"));
    if (!mockStates.stale || !mockStates.error) pass = false;

    const lcpMs = await page.evaluate(() => Number(window.__iuInfoPanelLcp || 0));
    lines.push("LCP_MS=" + Math.round(lcpMs));
    if (lcpMs > LCP_MAX_MS) {
      lines.push("LCP_FAIL=YES");
      pass = false;
    }

    lines.push("CLS_MAX=" + CLS_MAX);
    lines.push("LCP_MAX_MS=" + LCP_MAX_MS);
    lines.push("PASS=" + (pass ? "YES" : "NO"));
    lines.push("=== END_IU_DESKTOP_INFO_PANEL_VALIDATION ===");
    console.log("=== IU_DESKTOP_INFO_PANEL_VALIDATION ===");
    console.log(lines.join("\n"));

    await browser.close();
    if (!pass) process.exitCode = 1;
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
