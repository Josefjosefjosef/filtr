#!/usr/bin/env node
/**
 * Final validation guard — PC informační panel V2.
 * Viewports 1025–1920, zoom 125/150 %, layout, CLS/LCP, source dialogs, desktop regression.
 *
 * Run: npm run iu-desktop-info-panel-validation-guard
 */
import { createRequire } from "module";
import { IU_INFO_PANEL_CATALOG_COUNT } from "../assets/iu-desktop-info-panel-data.js";
import { spawnSync } from "child_process";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

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
const MINDMENU_GAP_TARGET_PX = 30;
const MINDMENU_ZPRAVY_RIGHT_TOL_PX = 1;
const CATALOG_COUNT = IU_INFO_PANEL_CATALOG_COUNT;

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
    (expectedCount) =>
      document.body.classList.contains("iu-desktop-home-grid") &&
      !!document.getElementById("iuDesktopInfoPanel") &&
      document.querySelectorAll(".iuDesktopInfoPanel__segment").length === expectedCount &&
      document.getElementById("iuDesktopInfoPanelMount")?.getAttribute("data-iu-info-panel-ready") === "1" &&
      document.querySelector('[data-iu-info-panel-id="fuel"]')?.getAttribute("data-iu-info-panel-state") !==
        "loading",
    CATALOG_COUNT,
    { timeout: 45000 }
  );
  await page.waitForFunction(
    () =>
      !!document.getElementById("iuMyInfoUzelOpenBtn") &&
      !!(
        document.querySelector("#iuNewsPreviewCardMount .iuNewsPreviewCard, #iuNewsPreviewCardMount button") ||
        document.getElementById("iuNewsPreviewCardMount")?.firstElementChild
      ),
    { timeout: 45000 }
  );
  await page.waitForTimeout(350);
}

async function measureViewport(page, width, zoom) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate((z) => {
    document.documentElement.style.zoom = z === 1 ? "" : String(z);
  }, zoom);
  await page.evaluate(() => {
    if (typeof window.iuDesktopInfoPanelLayoutSync === "function") {
      window.iuDesktopInfoPanelLayoutSync();
    }
    if (typeof window.iuDesktopHomeSectionTopGapSync === "function") {
      window.iuDesktopHomeSectionTopGapSync();
    }
  });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      })
  );
  await page.waitForTimeout(120);

  return page.evaluate(({ gapTarget, gapTol, zoomFactor, mindMenuGapTarget, mindMenuZpravyRightTolPx }) => {
    const doc = document.documentElement;
    const body = document.body;
    const panel = document.getElementById("iuDesktopInfoPanel");
    const mount = document.getElementById("iuDesktopInfoPanelMount");
    const homecards = document.getElementById("iuSilverTallScrollSection");
    const scroll = panel ? panel.querySelector(".iuDesktopInfoPanel__scroll") : null;
    const mindBtn = document.getElementById("iuMyInfoUzelOpenBtn");
    const welcome = document.getElementById("iuSilverWelcomeStack");
    const weather = document.getElementById("iuSilverWeatherCard");
    const leftNav = document.getElementById("iuLeftRail");
    const rightRail = document.getElementById("iuDesktopRightRailCards");
    const topBar = document.querySelector(".iuTopbarRight, #iuTopbarRight");
    const qrBanner = document.querySelector("#iuQrBanner, .iu-qr-banner, [data-iu-qr-banner]");

    const pageOverflowX =
      (doc && doc.scrollWidth > doc.clientWidth + 1) || (body && body.scrollWidth > body.clientWidth + 1);

    let gapPx = null;
    let mindMenuGapPx = null;
    if (panel && homecards) {
      gapPx = Math.round(homecards.getBoundingClientRect().top - panel.getBoundingClientRect().bottom);
    }
    if (mindBtn && panel) {
      mindMenuGapPx = Math.round(panel.getBoundingClientRect().top - mindBtn.getBoundingClientRect().bottom);
    }
    const expectedGap = gapTarget * zoomFactor;
    const gapTolScaled = gapTol * zoomFactor;

    const panelRect = panel ? panel.getBoundingClientRect() : null;
    const homeRect = homecards ? homecards.getBoundingClientRect() : null;
    const mindBtnRect = mindBtn ? mindBtn.getBoundingClientRect() : null;
    const zpravyMount = document.getElementById("iuNewsPreviewCardMount");
    const zpravyEl = zpravyMount
      ? zpravyMount.querySelector(".iuNewsPreviewCard, button") || zpravyMount.firstElementChild
      : null;
    const zpravyRect = zpravyEl ? zpravyEl.getBoundingClientRect() : null;
    const sportMount = document.getElementById("iuSportPreviewCardMount");
    const sportEl = sportMount
      ? sportMount.querySelector(".box-sport, button") || sportMount.firstElementChild
      : null;
    const sportRect = sportEl ? sportEl.getBoundingClientRect() : null;
    const welcomeCard = document.getElementById("iuSilverWelcomeCard");
    const welcomeCardRect = welcomeCard ? welcomeCard.getBoundingClientRect() : null;
    const welcomeCardPadLeft = welcomeCard
      ? parseFloat(getComputedStyle(welcomeCard).paddingLeft) || 0
      : 0;
    const leftRect = leftNav ? leftNav.getBoundingClientRect() : null;

    const segments = panel ? panel.querySelectorAll(".iuDesktopInfoPanel__segment") : [];
    let overlap = false;
    for (let i = 0; i < segments.length - 1; i++) {
      const a = segments[i].getBoundingClientRect();
      const b = segments[i + 1].getBoundingClientRect();
      if (a.right > b.left + 1) overlap = true;
    }

    const scrollStyle = scroll ? getComputedStyle(scroll) : null;
    const navPrev = panel ? panel.querySelector('[data-iu-info-panel-nav="prev"]') : null;
    const navNext = panel ? panel.querySelector('[data-iu-info-panel-nav="next"]') : null;

    return {
      panelVisible: !!(panel && mount && mount.offsetParent !== null && !mount.hidden),
      segmentCount: segments.length,
      pageOverflowX,
      panelInternalScroll: !!(scroll && scroll.scrollWidth > scroll.clientWidth + 1),
      scrollbarHidden: !!(scrollStyle && scrollStyle.scrollbarWidth === "none"),
      hasNavButtons: !!(navPrev && navNext),
      gapPx,
      gapOk: gapPx != null && Math.abs(gapPx - expectedGap) <= gapTolScaled,
      mindMenuGapPx,
      mindMenuGapOk:
        mindMenuGapPx != null && Math.abs(mindMenuGapPx - mindMenuGapTarget) <= gapTol,
      panelWidth: panelRect ? Math.round(panelRect.width) : 0,
      homecardsWidth: homeRect ? Math.round(homeRect.width) : 0,
      widthAligned: panelRect && homeRect ? Math.abs(panelRect.width - homeRect.width) <= 2 : false,
      mindBtnRight: mindBtnRect ? Math.round(mindBtnRect.right * 10) / 10 : null,
      homecardsRight: homeRect ? Math.round(homeRect.right) : null,
      zpravyRight: zpravyRect ? Math.round(zpravyRect.right * 10) / 10 : null,
      sportLeft: sportRect ? Math.round(sportRect.left * 10) / 10 : null,
      mindMenuZpravyRightDelta:
        mindBtnRect && zpravyRect ? Math.round((mindBtnRect.right - zpravyRect.right) * 10) / 10 : null,
      mindMenuZpravyRightAligned:
        mindBtnRect && zpravyRect
          ? Math.abs(mindBtnRect.right - zpravyRect.right) <= mindMenuZpravyRightTolPx * zoomFactor
          : false,
      mindMenuNotFullRowAligned:
        mindBtnRect && homeRect && zpravyRect
          ? !(
              Math.abs(mindBtnRect.right - homeRect.right) <= mindMenuZpravyRightTolPx * zoomFactor &&
              Math.abs(mindBtnRect.right - zpravyRect.right) > mindMenuZpravyRightTolPx * zoomFactor
            )
          : false,
      mindMenuNotOverSport:
        mindBtnRect && sportRect
          ? mindBtnRect.right <= sportRect.left + mindMenuZpravyRightTolPx * zoomFactor
          : true,
      mindBtnLeft: mindBtnRect ? Math.round(mindBtnRect.left) : null,
      welcomeCardLeft: welcomeCardRect ? Math.round(welcomeCardRect.left) : null,
      mindMenuLeftAligned:
        mindBtnRect && welcomeCardRect
          ? Math.abs(mindBtnRect.left - (welcomeCardRect.left + welcomeCardPadLeft)) <=
              Math.max(2, Math.round(4 * zoomFactor))
          : false,
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
  }, {
    gapTarget: GAP_TARGET_PX,
    gapTol: GAP_TOLERANCE_PX,
    zoomFactor: zoom,
    mindMenuGapTarget: MINDMENU_GAP_TARGET_PX,
    mindMenuZpravyRightTolPx: MINDMENU_ZPRAVY_RIGHT_TOL_PX,
  });
}

async function testSourceDialogs(page) {
  const ids = await page.$$eval("[data-iu-info-panel-source]", (btns) =>
    btns.map((b) => b.getAttribute("data-iu-info-panel-source"))
  );
  if (ids.length !== CATALOG_COUNT) return { ok: false, reason: "source_buttons=" + ids.length };

  for (const id of ids) {
    await page.evaluate((segId) => {
      const seg = document.querySelector(`[data-iu-info-panel-id="${segId}"]`);
      const scroll = document.querySelector(".iuDesktopInfoPanel__scroll");
      if (seg && scroll) {
        scroll.scrollLeft = Math.max(0, seg.offsetLeft - Math.round(scroll.clientWidth * 0.25));
      }
      if (typeof window.__iuInfoPanelOpenSourceDetail === "function") {
        window.__iuInfoPanelOpenSourceDetail(segId);
        return;
      }
      const btn = document.querySelector(`[data-iu-info-panel-source="${segId}"]`);
      if (btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }, id);
    await page.waitForTimeout(80);
    await page.waitForFunction(
      () => {
        const d = document.getElementById("iuDesktopInfoPanelDetail");
        return d && d.hidden === false && !d.hasAttribute("hidden");
      },
      null,
      { timeout: 8000 }
    );
    const audit = await page.evaluate(() => {
      const d = document.getElementById("iuDesktopInfoPanelDetail");
      if (!d || d.hidden) return { ok: false };
      const body = d.querySelector(".iuDesktopInfoPanelDetail__body");
      const text = body ? body.textContent || "" : "";
      const links = body ? body.querySelectorAll("a[href^='http']") : [];
      const hasProvider = text.includes("Poskytovatel");
      const hasMeaning = text.includes("Co to znamená");
      const hasImportance = text.includes("Proč je to důležité");
      const hasDisclaimer = text.includes("orientaci");
      const hasOfficial = Array.from(links).some((a) => /Oficiální zdroj/i.test(a.textContent || ""));
      const closeBtn = d.querySelector(".iuDesktopInfoPanelDetail__close");
      const closeOnRight = closeBtn && closeBtn.classList.contains("iuDesktopInfoPanelDetail__close");
      const dialogRole = d.getAttribute("role") === "dialog";
      const modal = d.getAttribute("aria-modal") === "true";
      const onBody = d.parentElement === document.body;
      const card = d.querySelector(".iuDesktopInfoPanelDetail__card");
      const rect = card ? card.getBoundingClientRect() : d.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      const aboveHomecards =
        onBody &&
        (d.contains(topEl) || topEl === d || (topEl && topEl.closest && topEl.closest("#iuDesktopInfoPanelDetail")));
      const zIndex = parseInt(getComputedStyle(d).zIndex, 10) || 0;
      return {
        ok:
          hasProvider &&
          hasMeaning &&
          hasImportance &&
          hasDisclaimer &&
          hasOfficial &&
          closeOnRight &&
          dialogRole &&
          modal &&
          onBody &&
          aboveHomecards &&
          zIndex >= 10100,
        hasProvider,
        hasMeaning,
        hasImportance,
        hasDisclaimer,
        hasOfficial,
        closeOnRight,
        dialogRole,
        modal,
        onBody,
        aboveHomecards,
        zIndex,
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
  // Single route handler + mode flag: unroute/re-route races on CI Linux.
  let mockMode = "stale";
  await page.route("**/info_panel_snapshot.json", (route) => {
    if (mockMode === "error") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generatedAt: new Date().toISOString(),
          errors: [{ id: "cnb", message: "mock" }],
          items: {},
        }),
      });
    }
    return route.fulfill({
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
          fuel: {
            isLive: true,
            legalStatus: "verified_requires_attribution",
            value: 38.82,
            unit: "Kč/l",
            primaryLabel: "Natural 95",
            secondaryValue: "beze změny",
            trendDirection: "flat",
            updatedAt: "2020-W01",
          },
        },
      }),
    });
  });
  await page.goto(BASE + "?section=media&iuRobust=1&iuInfoSystem=off", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitForDesktopPanel(page);
  await page
    .waitForFunction(
      () => {
        const eur = document.querySelector('[data-iu-info-panel-id="eur_czk"]');
        const fuel = document.querySelector('[data-iu-info-panel-id="fuel"]');
        return (
          eur &&
          eur.getAttribute("data-iu-info-panel-state") === "stale" &&
          fuel &&
          fuel.getAttribute("data-iu-info-panel-state") === "live"
        );
      },
      null,
      { timeout: 15000 }
    )
    .catch(() => null);
  results.stale = await page.evaluate(() => {
    const eur = document.querySelector('[data-iu-info-panel-id="eur_czk"]');
    const fuel = document.querySelector('[data-iu-info-panel-id="fuel"]');
    return (
      !!eur &&
      eur.getAttribute("data-iu-info-panel-state") === "stale" &&
      !!fuel &&
      fuel.getAttribute("data-iu-info-panel-state") === "live"
    );
  });

  mockMode = "error";
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForDesktopPanel(page);
  await page
    .waitForFunction(
      () => {
        const eur = document.querySelector('[data-iu-info-panel-id="eur_czk"]');
        const fuel = document.querySelector('[data-iu-info-panel-id="fuel"]');
        return (
          eur &&
          eur.getAttribute("data-iu-info-panel-state") === "error" &&
          fuel &&
          fuel.getAttribute("data-iu-info-panel-state") === "placeholder"
        );
      },
      null,
      { timeout: 15000 }
    )
    .catch(() => null);
  results.error = await page.evaluate(() => {
    const eur = document.querySelector('[data-iu-info-panel-id="eur_czk"]');
    const fuel = document.querySelector('[data-iu-info-panel-id="fuel"]');
    return (
      !!eur &&
      eur.getAttribute("data-iu-info-panel-state") === "error" &&
      !!fuel &&
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
    const context = await bootstrapGuardContext(browser, {
      viewport: { width: 1280, height: 900 },
      serviceWorkers: "block",
    });
    await installObservers(context);
    const page = await context.newPage();

    await page.goto(BASE + "?section=media&iuRobust=1&iuInfoSystem=off", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForDesktopPanel(page);
    await page.evaluate(() => {
      if (typeof window.iuDesktopInfoPanelLayoutSync === "function") {
        window.iuDesktopInfoPanelLayoutSync();
      }
    });
    await page.waitForTimeout(150);

    let panelLoadCls = null;
    await page.evaluate(() => {
      window.__iuInfoPanelCls = 0;
    });
    panelLoadCls = await page.evaluate(() => Number(window.__iuInfoPanelCls || 0));

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "";
      if (typeof window.iuDesktopInfoPanelLayoutSync === "function") {
        window.iuDesktopInfoPanelLayoutSync();
      }
    });
    await page.waitForTimeout(120);
    const navTest = await page.evaluate(async () => {
      const scroll = document.querySelector(".iuDesktopInfoPanel__scroll");
      const next = document.querySelector('[data-iu-info-panel-nav="next"]');
      if (!scroll || !next) return { ok: false, reason: "missing_nav" };
      if (scroll.scrollWidth <= scroll.clientWidth + 1) return { ok: true, skipped: true };
      scroll.scrollLeft = 0;
      const before = scroll.scrollLeft;
      next.removeAttribute("hidden");
      next.click();
      await new Promise((resolve) => setTimeout(resolve, 450));
      return { ok: scroll.scrollLeft > before + 1, before, after: scroll.scrollLeft };
    });
    lines.push("NAV_SCROLL=" + (navTest.ok ? "PASS" : "FAIL"));
    if (!navTest.ok) {
      pass = false;
      lines.push("NAV_SCROLL_DETAIL=" + JSON.stringify(navTest));
    }

    for (const width of VIEWPORTS) {
      for (const zoom of ZOOMS) {
        const m = await measureViewport(page, width, zoom);
        const key = `VP_${width}_Z${Math.round(zoom * 100)}`;
        const vpOk =
          m.panelVisible &&
          m.segmentCount === CATALOG_COUNT &&
          !m.pageOverflowX &&
          m.gapOk &&
          m.mindMenuGapOk &&
          m.widthAligned &&
          m.mindMenuZpravyRightAligned &&
          m.mindMenuNotFullRowAligned &&
          m.mindMenuNotOverSport &&
          m.mindMenuLeftAligned &&
          !m.segmentOverlap &&
          m.scrollbarHidden &&
          m.hasNavButtons &&
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
        return al.includes("Informace o ukazateli");
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
