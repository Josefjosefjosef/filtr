#!/usr/bin/env node
/**
 * INFO_CENTER_LAZY_MOUNT_GUARD
 *
 * Replay guard for the Info Center lazy-mount fix. For each viewport
 * (DESKTOP / MOBILE / TABLET_PORTRAIT / TABLET_LANDSCAPE) verifies:
 *  1. homepage load  -> overlay NOT mounted, inert <template> present
 *  2. first open     -> overlay mounted, visible, inner navigation works
 *  3. close          -> overlay hidden (close button)
 *  4. reopen         -> overlay visible again, Escape closes
 *  5. consoleErrors=0, pageErrors=0
 *  6. regression     -> other module roots unchanged (silver, calendar,
 *     tasks, notes, weather, finance, parcelwatch, articles, menu, bottom nav)
 *
 * Usage:
 *   node scripts/info-center-lazy-mount-guard.cjs            (local repo server)
 *   IU_GUARD_URL=https://infouzel.cz/projects/ node scripts/info-center-lazy-mount-guard.cjs
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");
const {
  installProofGuardNetworkStubs,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const REPO = path.resolve(__dirname, "..");
const EXTERNAL_URL = process.env.IU_GUARD_URL || null;
const PORT = Number(process.env.IU_GUARD_PORT || 8741);

const VIEWPORTS = [
  { name: "DESKTOP", width: 1366, height: 768, isMobile: false, deviceScaleFactor: 1 },
  { name: "MOBILE", width: 390, height: 844, isMobile: true, deviceScaleFactor: 3 },
  { name: "TABLET_PORTRAIT", width: 768, height: 1024, isMobile: true, deviceScaleFactor: 2 },
  { name: "TABLET_LANDSCAPE", width: 1024, height: 768, isMobile: true, deviceScaleFactor: 2 },
];

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (urlPath.endsWith("/")) urlPath += "index.html";
        const filePath = path.join(REPO, urlPath.replace(/^\/+/, ""));
        if (!filePath.startsWith(REPO) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("not found");
          return;
        }
        res.writeHead(200, { "content-type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
        res.end(fs.readFileSync(filePath));
      } catch (e) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function overlayState(page) {
  return page.evaluate(() => {
    const overlay = document.getElementById("iuTopbarInfoOverlay");
    const tpl = document.getElementById("iuTopbarInfoOverlayTpl");
    let visible = false;
    if (overlay && !overlay.hidden) {
      const r = overlay.getBoundingClientRect();
      const st = window.getComputedStyle(overlay);
      visible = st.display !== "none" && st.visibility !== "hidden" && r.width > 0 && r.height > 0;
    }
    return {
      overlayInDom: !!overlay,
      overlayHidden: overlay ? overlay.hidden : null,
      overlayVisible: visible,
      templateInDom: !!tpl,
      inited: overlay ? overlay.getAttribute("data-iu-info-center-v2-inited") : null,
      domTotal: document.querySelectorAll("*").length,
      menuTiles: overlay ? overlay.querySelectorAll(".iuInfoCenter__tile[data-iu-info-section]").length : 0,
    };
  });
}

async function clickTrigger(page) {
  return page.evaluate(() => {
    const candidates = [
      document.getElementById("iuTopbarInfoBtn"),
      document.getElementById("iuSilverWelcomeInfoBtn"),
    ].filter(Boolean);
    if (!candidates.length) return { clicked: false, reason: "no trigger in DOM" };
    let target = candidates.find((el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return st.display !== "none" && st.visibility !== "hidden" && r.width > 0 && r.height > 0;
    });
    const mode = target ? "visible" : "programmatic";
    target = target || candidates[0];
    target.click();
    return { clicked: true, mode, id: target.id };
  });
}

async function runViewport(browser, vp, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
    userAgent: vp.isMobile ? MOBILE_UA : undefined,
    locale: "cs-CZ",
    /* SW-controlled fetches bypass page.route — block SW so the open-meteo
       stub stays deterministic (same policy as weather_emphasis_guard). */
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const isEnvNoise = (t) => /ServiceWorker/i.test(t) || isIgnorableGuardConsoleError(t);
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = String(m.text()).slice(0, 250);
    if (!isEnvNoise(t)) consoleErrors.push(t);
  });
  page.on("pageerror", (e) => {
    const t = String(e.message || e).slice(0, 250);
    if (!isEnvNoise(t)) pageErrors.push(t);
  });

  /* Deterministic external weather/thumbnail responses (same stub as smoke/CI guards). */
  await installProofGuardNetworkStubs(page);

  const checks = {};
  await page.goto(baseUrl, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(4500);

  // 1) load: overlay must not be mounted, template must be present
  const s0 = await overlayState(page);
  checks.load_overlay_not_mounted = !s0.overlayInDom;
  checks.load_template_present = s0.templateInDom;
  const domBeforeMount = s0.domTotal;

  // 2) first open
  const c1 = await clickTrigger(page);
  await page.waitForTimeout(400);
  const s1 = await overlayState(page);
  checks.first_open_overlay_mounted = s1.overlayInDom;
  checks.first_open_overlay_visible = s1.overlayVisible === true;
  checks.first_open_template_removed = !s1.templateInDom;
  checks.first_open_nav_inited = s1.inited === "1";
  checks.first_open_menu_tiles = s1.menuTiles > 0;

  // 2b) inner navigation: open a detail section + back
  const nav = await page.evaluate(() => {
    const overlay = document.getElementById("iuTopbarInfoOverlay");
    if (!overlay) return { ok: false, reason: "no overlay" };
    const tile = overlay.querySelector('.iuInfoCenter__tile[data-iu-info-section="about"]');
    if (!tile) return { ok: false, reason: "no about tile" };
    tile.click();
    const detail = overlay.querySelector('.iuInfoCenter__detail[data-iu-info-section="about"]');
    const menu = document.getElementById("iuInfoCenterMenu");
    const back = document.getElementById("iuInfoCenterBack");
    const detailShown = detail && !detail.hidden;
    const menuHidden = menu && menu.hidden;
    if (back) back.click();
    const menuBack = menu && !menu.hidden;
    return { ok: !!(detailShown && menuHidden && menuBack), detailShown, menuHidden, menuBack };
  });
  checks.first_open_section_navigation = nav.ok === true;

  // 3) close via close button
  await page.evaluate(() => {
    const btn = document.getElementById("iuTopbarInfoOverlayClose");
    if (btn) btn.click();
  });
  await page.waitForTimeout(300);
  const s2 = await overlayState(page);
  checks.close_overlay_hidden = s2.overlayInDom && s2.overlayHidden === true && !s2.overlayVisible;

  // 4) reopen
  await clickTrigger(page);
  await page.waitForTimeout(300);
  const s3 = await overlayState(page);
  checks.reopen_overlay_visible = s3.overlayVisible === true;

  // 4b) Escape closes
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const s4 = await overlayState(page);
  checks.escape_close = s4.overlayHidden === true;

  // 6) regression: other module roots present and in expected start state
  const regression = await page.evaluate(() => {
    function state(id) {
      const el = document.getElementById(id);
      if (!el) return "MISSING";
      const st = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const vis = !el.hidden && st.display !== "none" && st.visibility !== "hidden" && r.width > 0 && r.height > 0;
      return vis ? "VISIBLE" : "PRESENT_HIDDEN";
    }
    return {
      silver_stack: state("iuSilverTopCardsStack"),
      silver_welcome: state("iuSilverWelcomeCard"),
      calendar_overlay: state("iuCalendarOverlay"),
      tasks_overlay: state("iuTasksOverlay"),
      notes_overlay: state("iuNotesOverlay"),
      weather_card: state("iuSilverWeatherCard"),
      weather_view: state("iuWeatherView"),
      finance_card: state("iuSilverFinanceHomeCard"),
      parcel_card: state("iuSilverParcelWatch"),
      parcel_modal: state("iuParcelsPopover"),
      articles_feed_children: (document.getElementById("feed") || { children: { length: 0 } }).children.length,
      mind_menu: state("iuMindMenuView"),
      bottom_nav: state("iuMobileBottomNav"),
      consent_layer: document.getElementById("iuConsentLayer") ? "PRESENT" : "MISSING",
      topbar: state("topbarWrap"),
    };
  });
  checks.regression_silver = regression.silver_stack !== "MISSING";
  /* Weather+Calendar lazy mount (P1 fix #6): calendar overlay + weather view
     no longer exist at load — they mount on first open. MISSING at load is
     the new expected state; PRESENT_HIDDEN kept for pre-fix builds. */
  checks.regression_calendar = regression.calendar_overlay === "PRESENT_HIDDEN" || regression.calendar_overlay === "MISSING";
  checks.regression_tasks = regression.tasks_overlay === "PRESENT_HIDDEN" || regression.tasks_overlay === "MISSING";
  checks.regression_notes = regression.notes_overlay === "PRESENT_HIDDEN" || regression.notes_overlay === "MISSING";
  checks.regression_weather = regression.weather_card !== "MISSING";
  checks.regression_finance = regression.finance_card !== "MISSING";
  checks.regression_parcelwatch = regression.parcel_card !== "MISSING" && regression.parcel_modal !== "MISSING";
  checks.regression_articles = regression.articles_feed_children > 0;
  checks.regression_menu = regression.mind_menu !== "MISSING" && regression.topbar !== "MISSING";
  checks.regression_bottom_nav = regression.bottom_nav !== "MISSING";
  checks.regression_consent = regression.consent_layer === "PRESENT";

  // 5) errors
  checks.console_errors_zero = consoleErrors.length === 0;
  checks.page_errors_zero = pageErrors.length === 0;

  await context.close();

  const failed = Object.entries(checks).filter(([, v]) => v !== true).map(([k]) => k);
  return {
    viewport: vp.name,
    size: `${vp.width}x${vp.height}`,
    pass: failed.length === 0,
    failedChecks: failed,
    checks,
    trigger: c1,
    domBeforeMount,
    domAfterMount: s1.domTotal,
    domMountDelta: s1.domTotal - domBeforeMount,
    regression,
    consoleErrors,
    pageErrors,
  };
}

async function main() {
  let server = null;
  let baseUrl = EXTERNAL_URL;
  if (!baseUrl) {
    server = await startServer();
    baseUrl = `http://127.0.0.1:${PORT}/projects/`;
  }
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const vp of VIEWPORTS) {
    process.stderr.write(`[guard] ${vp.name}...\n`);
    try {
      results.push(await runViewport(browser, vp, baseUrl));
    } catch (e) {
      results.push({ viewport: vp.name, pass: false, error: String(e.message || e).slice(0, 400) });
    }
  }
  await browser.close();
  if (server) server.close();

  const allPass = results.every((r) => r.pass);
  const out = {
    guard: "INFO_CENTER_LAZY_MOUNT_GUARD",
    targetUrl: baseUrl,
    finishedAt: new Date().toISOString(),
    result: allPass ? "PASS" : "FAIL",
    viewports: results,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("GUARD_FAILED", e);
  process.exit(2);
});
