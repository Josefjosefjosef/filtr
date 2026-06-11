#!/usr/bin/env node
/**
 * WEATHER_CALENDAR_LAZY_MOUNT_GUARD
 *
 * Replay guard for the weather + calendar lazy-mount fix (P1 performance fix #6).
 * Lazy-mounted roots:
 *   - weather view  (#iuWeatherView)            — <template id="iuLazyViewTpl-pocasi">,
 *     mounts via the section-views lazy mount on first open of ?section=pocasi.
 *     SEO (h1 + .iuWeatherHistorySeo) stays in hidden stubs at load.
 *   - weather geo overlay (#iuSilverWeatherGeoOverlay) — <template id="iuLazyOverlayTpl-weathergeo">,
 *     mounts on first open from the Silver weather card.
 *   - calendar (#iuCalendarOverlay + #iuCalTimeWheelHost + #iuCalendarDayOverlay)
 *     — <template id="iuLazyOverlayTpl-calendar">, mounts on first open;
 *     premium overlay DOM (#iuCalEventBottomSheet, #iuCalEventSearchOverlay,
 *     #iuCalDeleteConfirm) is also built on first open (was: at boot).
 *
 * NOT lazy (stay eager by design):
 *   - #iuSilverWeatherCard (visible Silver home card)
 *   - #svatekOverlay, #iuNamedayWishOverlay (startup-bound nameday flow)
 *
 * Per viewport (DESKTOP / MOBILE / TABLET_PORTRAIT / TABLET_LANDSCAPE):
 *   1. load  -> roots absent, templates + SEO stubs present, nameday/clock boot intact
 *   2. first open -> mounts, visible, UX content present
 *   3. close -> hidden/left, 4. reopen -> visible again
 *   5. regression -> prior lazy-mount fixes + module roots unchanged
 *   6. consoleErrors=0, pageErrors=0
 *
 * Usage:
 *   node scripts/weather-calendar-lazy-mount-guard.cjs
 *   IU_GUARD_URL=https://infouzel.cz/projects/ node scripts/weather-calendar-lazy-mount-guard.cjs
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
const PORT = Number(process.env.IU_GUARD_PORT || 8747);

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
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (p.endsWith("/")) p += "index.html";
        const fp = path.join(REPO, p.replace(/^\/+/, ""));
        if (!fp.startsWith(REPO) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("not found");
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

async function rootsState(page) {
  return page.evaluate(() => {
    function vis(el) {
      if (!el || el.hidden) return false;
      const st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function viewVis(el) {
      // section views keep [hidden]; CSS [data-view] overrides when active
      if (!el) return false;
      const st = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return st.display !== "none" && st.visibility !== "hidden" && r.width > 0 && r.height > 0;
    }
    const byId = (id) => document.getElementById(id);
    return {
      weatherView: { mounted: !!byId("iuWeatherView"), visible: viewVis(byId("iuWeatherView")) },
      weatherTpl: !!byId("iuLazyViewTpl-pocasi"),
      weatherStubH1: !!document.querySelector('[data-iu-seo-stub="pocasi:h1"]'),
      weatherStubSeo: !!document.querySelector('[data-iu-seo-stub="pocasi:seo"]'),
      h1InDom: !!byId("iuWeatherCityH1"),
      geo: { mounted: !!byId("iuSilverWeatherGeoOverlay"), visible: vis(byId("iuSilverWeatherGeoOverlay")) },
      geoTpl: !!byId("iuLazyOverlayTpl-weathergeo"),
      cal: { mounted: !!byId("iuCalendarOverlay"), visible: vis(byId("iuCalendarOverlay")) },
      calDay: { mounted: !!byId("iuCalendarDayOverlay") },
      calWheel: { mounted: !!byId("iuCalTimeWheelHost") },
      calPremium: {
        bottomSheet: !!byId("iuCalEventBottomSheet"),
        search: !!byId("iuCalEventSearchOverlay"),
        delConfirm: !!byId("iuCalDeleteConfirm"),
      },
      calTpl: !!byId("iuLazyOverlayTpl-calendar"),
      domTotal: document.querySelectorAll("*").length,
    };
  });
}

async function spaNavigate(page, key) {
  await page.evaluate((k) => {
    const u = new URL(window.location.href);
    if (k) u.searchParams.set("section", k);
    else u.searchParams.delete("section");
    history.pushState({}, "", u.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, key);
  await page.waitForTimeout(1400);
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

  const netFailures = [];
  page.on("response", (r) => {
    try {
      if (r.status() >= 400) netFailures.push(r.status() + " " + r.url().slice(0, 160));
    } catch (_) {}
  });
  page.on("requestfailed", (req) => {
    try {
      netFailures.push("FAILED " + req.url().slice(0, 160));
    } catch (_) {}
  });

  /* Deterministic external weather/thumbnail responses (same stub as smoke/CI guards). */
  await installProofGuardNetworkStubs(page);

  const checks = {};

  await page.goto(baseUrl, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1200, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // 1) load: not mounted, templates + SEO stubs present
  const s0 = await rootsState(page);
  checks.weather_load_not_mounted = !s0.weatherView.mounted && s0.weatherTpl;
  checks.weather_load_seo_stubs_present = s0.weatherStubH1 && s0.weatherStubSeo && s0.h1InDom;
  checks.weathergeo_load_not_mounted = !s0.geo.mounted && s0.geoTpl;
  checks.calendar_load_not_mounted =
    !s0.cal.mounted && !s0.calDay.mounted && !s0.calWheel.mounted && s0.calTpl;
  checks.calendar_load_premium_not_built =
    !s0.calPremium.bottomSheet && !s0.calPremium.search && !s0.calPremium.delConfirm;
  const domLoad = s0.domTotal;

  // nameday/clock boot path must still run without the weather view (topbar svátek source)
  const namedayBoot = await page.evaluate(() => ({
    dailyTimerArmed: !!window.__iu_daily_timer,
    namedaySuffixDefined: typeof window.__iuNamedaySuffixFromSource !== "undefined",
  }));
  checks.weather_load_daily_panel_boot_intact = namedayBoot.dailyTimerArmed && namedayBoot.namedaySuffixDefined;

  // ---- WEATHER VIEW: first open (SPA nav, same router path as left nav) -> close -> reopen
  await spaNavigate(page, "pocasi");
  await page.waitForTimeout(1200);
  let s = await rootsState(page);
  const wxUx = await page.evaluate(() => {
    const wv = document.getElementById("iuWeatherView");
    const sticky = document.getElementById("iuWxStickyTime");
    return {
      h1Inside: !!(wv && wv.querySelector("h1") && wv.contains(document.getElementById("iuWeatherCityH1"))),
      seoInside: !!(wv && wv.querySelector(".iuWeatherHistorySeo")),
      slotsGone:
        !document.querySelector('[data-iu-seo-slot="pocasi:h1"]') &&
        !document.querySelector('[data-iu-seo-slot="pocasi:seo"]') &&
        !document.querySelector('[data-iu-seo-stub="pocasi:h1"]') &&
        !document.querySelector('[data-iu-seo-stub="pocasi:seo"]'),
      geoBtn: !!document.getElementById("iuWeatherGeoBtn"),
      cityBtn: !!document.getElementById("iuWeatherCityChange"),
      sevenDay: !!document.getElementById("iuWx7Day"),
      dailyWeather: !!document.getElementById("iuDailyWeather"),
      historySection: !!(wv && wv.querySelector(".iuWeatherHistorySection")),
      clockTicked: !!(sticky && /\d{1,2}[.:]\d{2}/.test(String(sticky.textContent || ""))),
      initDone: !!window.__iuWeatherInitDone,
      templateGone: !document.getElementById("iuLazyViewTpl-pocasi"),
    };
  });
  checks.weather_first_open = s.weatherView.mounted && s.weatherView.visible;
  checks.weather_open_ux =
    wxUx.h1Inside &&
    wxUx.seoInside &&
    wxUx.slotsGone &&
    wxUx.geoBtn &&
    wxUx.cityBtn &&
    wxUx.sevenDay &&
    wxUx.dailyWeather &&
    wxUx.historySection &&
    wxUx.clockTicked &&
    wxUx.initDone &&
    wxUx.templateGone;
  await spaNavigate(page, null);
  s = await rootsState(page);
  checks.weather_close = s.weatherView.mounted && !s.weatherView.visible;
  await spaNavigate(page, "pocasi");
  s = await rootsState(page);
  checks.weather_reopen = s.weatherView.visible;
  await spaNavigate(page, null);

  // ---- WEATHER GEO OVERLAY: open via Silver weather card (firstVisit phase), close, reopen
  const geoOpen = () =>
    page.evaluate(() => {
      const card = document.getElementById("iuSilverWeatherCard");
      if (card) card.click();
    });
  await geoOpen();
  await page.waitForTimeout(600);
  s = await rootsState(page);
  const geoUx = await page.evaluate(() => {
    const ov = document.getElementById("iuSilverWeatherGeoOverlay");
    return {
      title: !!document.getElementById("iuSilverWeatherGeoOverlayTitle"),
      allow: !!document.getElementById("iuSilverWeatherGeoOverlayAllow"),
      deny: !!document.getElementById("iuSilverWeatherGeoOverlayDeny"),
      closeBtn: !!(ov && ov.querySelector("[data-iu-silver-wx-geo-overlay-close]")),
      onBody: !!(ov && ov.parentElement === document.body),
      templateGone: !document.getElementById("iuLazyOverlayTpl-weathergeo"),
    };
  });
  checks.weathergeo_first_open = s.geo.mounted && s.geo.visible;
  checks.weathergeo_open_ux =
    geoUx.title && geoUx.allow && geoUx.deny && geoUx.closeBtn && geoUx.onBody && geoUx.templateGone;
  await page.evaluate(() => {
    const ov = document.getElementById("iuSilverWeatherGeoOverlay");
    const b = ov && ov.querySelector(".iuSilverWeatherGeoOverlay__btn--ghost[data-iu-silver-wx-geo-overlay-close]");
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  s = await rootsState(page);
  checks.weathergeo_close = s.geo.mounted && !s.geo.visible;
  await geoOpen();
  await page.waitForTimeout(400);
  s = await rootsState(page);
  checks.weathergeo_reopen = s.geo.visible;
  await page.evaluate(() => {
    const ov = document.getElementById("iuSilverWeatherGeoOverlay");
    const b = ov && ov.querySelector(".iuSilverWeatherGeoOverlay__btn--ghost[data-iu-silver-wx-geo-overlay-close]");
    if (b) b.click();
  });
  await page.waitForTimeout(300);

  // ---- CALENDAR: open via public service (same openOverlay used by all triggers), close, reopen
  await page.evaluate(() => {
    window.iuCalendarService.openOverlay();
  });
  await page.waitForTimeout(800);
  s = await rootsState(page);
  const calUx = await page.evaluate(() => {
    const ov = document.getElementById("iuCalendarOverlay");
    const root = document.getElementById("iuCalendarViewRoot");
    const period = document.getElementById("iuCalendarPeriodLabel");
    return {
      title: !!document.getElementById("iuCalendarTitle"),
      viewRootFilled: !!(root && root.children.length > 0),
      periodLabel: !!(period && String(period.textContent || "").trim().length > 0),
      monthBtn: !!(ov && ov.querySelector('[data-iu-cal-view="month"]')),
      closeBtn: !!(ov && ov.querySelector('[data-iu-calendar-close="button"]')),
      form: !!document.getElementById("iuCalendarEventForm"),
      dayOverlay: !!document.getElementById("iuCalendarDayOverlay"),
      wheelHost: !!document.getElementById("iuCalTimeWheelHost"),
      templateGone: !document.getElementById("iuLazyOverlayTpl-calendar"),
    };
  });
  checks.calendar_first_open = s.cal.mounted && s.cal.visible;
  checks.calendar_open_ux =
    calUx.title &&
    calUx.viewRootFilled &&
    calUx.periodLabel &&
    calUx.monthBtn &&
    calUx.closeBtn &&
    calUx.form &&
    calUx.dayOverlay &&
    calUx.wheelHost &&
    calUx.templateGone;
  checks.calendar_premium_dom_built = s.calPremium.bottomSheet && s.calPremium.search && s.calPremium.delConfirm;
  await page.evaluate(() => {
    const b = document.querySelector('#iuCalendarOverlay [data-iu-calendar-close="button"]');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  s = await rootsState(page);
  checks.calendar_close = s.cal.mounted && !s.cal.visible;
  await page.evaluate(() => {
    window.iuCalendarService.openOverlay();
  });
  await page.waitForTimeout(400);
  s = await rootsState(page);
  checks.calendar_reopen = s.cal.visible;
  await page.evaluate(() => {
    window.iuCalendarService.closeOverlay();
  });
  await page.waitForTimeout(300);

  // ---- regression: other modules untouched (fresh load)
  await page.goto(baseUrl, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1200, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
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
      info_center_template: !!document.getElementById("iuTopbarInfoOverlayTpl"),
      info_center_overlay_absent: !document.getElementById("iuTopbarInfoOverlay"),
      section_view_templates: ["jr", "tvprogram", "travel", "mapy", "radio", "tvonline", "pocasi"].filter(
        (k) => !!document.getElementById("iuLazyViewTpl-" + k),
      ).length,
      overlay_cluster_templates: ["custombuttons", "datovka", "videomodal"].filter(
        (k) => !!document.getElementById("iuLazyOverlayTpl-" + k),
      ).length,
      notes_overlay_absent: !document.getElementById("iuNotesOverlay"),
      tasks_overlay_absent: !document.getElementById("iuTasksOverlay"),
      silver_stack: state("iuSilverTopCardsStack"),
      weather_card: state("iuSilverWeatherCard"),
      finance_card: state("iuSilverFinanceHomeCard"),
      parcel_card: state("iuSilverParcelWatch"),
      parcel_modal_present: !!document.getElementById("iuParcelsPopover"),
      svatek_overlay: state("svatekOverlay"),
      nameday_wish_overlay: state("iuNamedayWishOverlay"),
      articles_feed_children: (document.getElementById("feed") || { children: { length: 0 } }).children.length,
      mind_menu: state("iuMindMenuView"),
      bottom_nav: state("iuMobileBottomNav"),
      consent_layer: document.getElementById("iuConsentLayer") ? "PRESENT" : "MISSING",
      calendar_service: !!(window.iuCalendarService && typeof window.iuCalendarService.calendarGetTodayEvents === "function"),
      lcp_fast_path_img: !!document.querySelector('link[rel="preload"][as="image"], img[fetchpriority="high"]'),
    };
  });
  checks.regression_info_center_lazy = regression.info_center_template && regression.info_center_overlay_absent;
  checks.regression_section_views_lazy = regression.section_view_templates === 7;
  checks.regression_overlay_cluster_lazy =
    regression.overlay_cluster_templates === 3 && regression.notes_overlay_absent && regression.tasks_overlay_absent;
  checks.regression_silver = regression.silver_stack !== "MISSING";
  checks.regression_weather_card = regression.weather_card !== "MISSING";
  checks.regression_finance = regression.finance_card !== "MISSING";
  checks.regression_parcelwatch = regression.parcel_card !== "MISSING" && regression.parcel_modal_present;
  checks.regression_svatek_eager = regression.svatek_overlay === "PRESENT_HIDDEN";
  checks.regression_nameday_wish_eager = regression.nameday_wish_overlay === "PRESENT_HIDDEN";
  checks.regression_articles = regression.articles_feed_children > 0;
  checks.regression_menu = regression.mind_menu !== "MISSING";
  checks.regression_bottom_nav = regression.bottom_nav !== "MISSING";
  checks.regression_consent = regression.consent_layer === "PRESENT";
  checks.regression_calendar_service = regression.calendar_service;
  checks.regression_lcp_fast_path = regression.lcp_fast_path_img;

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
    domLoad,
    regression,
    consoleErrors,
    pageErrors,
    netFailures,
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
    guard: "WEATHER_CALENDAR_LAZY_MOUNT_GUARD",
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
