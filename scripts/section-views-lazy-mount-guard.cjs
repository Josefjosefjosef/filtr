#!/usr/bin/env node
/**
 * SECTION_VIEWS_LAZY_MOUNT_GUARD
 *
 * Replay guard for the section views lazy-mount fix (jr, tvprogram, travel,
 * mapy, radio, tvonline). For each viewport verifies:
 *  1. homepage load -> no lazy view mounted, 6 templates + 5 SEO stubs present
 *  2. SEO guard     -> SEO blocks present in raw HTML OUTSIDE <template>
 *  3. open section  -> view mounts, becomes visible, SEO block inside view,
 *     radio chips rendered, tvprogram choice UI inited
 *  4. close (back to feed) -> view hidden again
 *  5. reopen        -> view visible again
 *  6. regression    -> info center lazy intact + other module roots unchanged
 *  7. consoleErrors=0, pageErrors=0
 *
 * Usage:
 *   node scripts/section-views-lazy-mount-guard.cjs
 *   IU_GUARD_URL=https://infouzel.cz/projects/ node scripts/section-views-lazy-mount-guard.cjs
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "..");
const EXTERNAL_URL = process.env.IU_GUARD_URL || null;
const PORT = Number(process.env.IU_GUARD_PORT || 8745);

const VIEWPORTS = [
  { name: "DESKTOP", width: 1366, height: 768, isMobile: false, deviceScaleFactor: 1 },
  { name: "MOBILE", width: 390, height: 844, isMobile: true, deviceScaleFactor: 3 },
  { name: "TABLET_PORTRAIT", width: 768, height: 1024, isMobile: true, deviceScaleFactor: 2 },
  { name: "TABLET_LANDSCAPE", width: 1024, height: 768, isMobile: true, deviceScaleFactor: 2 },
];

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const LAZY_VIEWS = [
  { key: "jr", id: "iuJrEmptyView", seoClass: "iu-timetables-seo-block" },
  { key: "tvprogram", id: "iuTvProgramView", seoClass: "iu-tv-seo-block" },
  { key: "travel", id: "iuTravelView", seoClass: null },
  { key: "mapy", id: "iuMapyView", seoClass: "iu-maps-seo-block" },
  { key: "radio", id: "iuRadioView", seoClass: "iu-radio-seo-block" },
  { key: "tvonline", id: "iuTvOnlineView", seoClass: "iu-tv-online-seo" },
];

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

function seoRawHtmlAudit(html) {
  // strip template contents, SEO classes must still be present (stubs are outside templates)
  const stripped = html.replace(/<template[\s\S]*?<\/template>/g, "");
  const out = {};
  for (const v of LAZY_VIEWS) {
    if (!v.seoClass) continue;
    out[v.key] = {
      inRawHtml: html.includes(v.seoClass),
      outsideTemplates: stripped.includes(v.seoClass),
    };
  }
  return out;
}

async function lazyState(page) {
  return page.evaluate((views) => {
    const out = {};
    for (const v of views) {
      const el = document.getElementById(v.id);
      const tpl = document.getElementById("iuLazyViewTpl-" + v.key);
      const stub = document.querySelector('[data-iu-seo-stub="' + v.key + '"]');
      let visible = false;
      if (el) {
        // NOTE: views keep the [hidden] attribute; CSS [data-view] rules override
        // it when the section is active (same as pre-fix behavior).
        const st = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        visible = st.display !== "none" && st.visibility !== "hidden" && r.width > 0 && r.height > 0;
      }
      out[v.key] = { mounted: !!el, template: !!tpl, stub: !!stub, visible };
    }
    out.__domTotal = document.querySelectorAll("*").length;
    return out;
  }, LAZY_VIEWS);
}

async function gotoSection(page, baseUrl, key) {
  const sep = baseUrl.includes("?") ? "&" : "?";
  await page.goto(key ? `${baseUrl}${sep}section=${key}` : baseUrl, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

async function spaNavigate(page, key) {
  // SPA navigation through the app router (same path real nav links use)
  await page.evaluate((k) => {
    const u = new URL(window.location.href);
    if (k) u.searchParams.set("section", k);
    else u.searchParams.delete("section");
    history.pushState({}, "", u.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, key);
  await page.waitForTimeout(1200);
}

async function runViewport(browser, vp, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
    userAgent: vp.isMobile ? MOBILE_UA : undefined,
    locale: "cs-CZ",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  // ServiceWorker update failures on the local static server / during CDN deploys
  // are environment artifacts, not app errors (same policy as info-center guard).
  const isEnvNoise = (t) => /ServiceWorker/i.test(t);
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = String(m.text()).slice(0, 250);
    if (!isEnvNoise(t)) consoleErrors.push(t);
  });
  page.on("pageerror", (e) => {
    const t = String(e.message || e).slice(0, 250);
    if (!isEnvNoise(t)) pageErrors.push(t);
  });

  const checks = {};

  // 1) homepage load
  await gotoSection(page, baseUrl, null);
  const s0 = await lazyState(page);
  checks.load_no_lazy_view_mounted = LAZY_VIEWS.every((v) => !s0[v.key].mounted);
  checks.load_all_templates_present = LAZY_VIEWS.every((v) => s0[v.key].template);
  checks.load_seo_stubs_present = LAZY_VIEWS.filter((v) => v.seoClass).every((v) => s0[v.key].stub);
  const domHomepage = s0.__domTotal;

  // 3) SPA open: radio
  await spaNavigate(page, "radio");
  let s = await lazyState(page);
  const radioDetail = await page.evaluate(() => {
    const view = document.getElementById("iuRadioView");
    return {
      chips: view ? view.querySelectorAll(".iuRadioChip").length : 0,
      seoInside: !!(view && view.querySelector(".iu-radio-seo-block")),
      slotGone: !document.querySelector('[data-iu-seo-slot="radio"]'),
      stubGone: !document.querySelector('[data-iu-seo-stub="radio"]'),
    };
  });
  checks.radio_open_mounted_visible = s.radio.mounted && s.radio.visible;
  checks.radio_chips_rendered = radioDetail.chips > 0;
  checks.radio_seo_moved_inside = radioDetail.seoInside && radioDetail.slotGone && radioDetail.stubGone;

  // 4) close (back to feed)
  await spaNavigate(page, null);
  s = await lazyState(page);
  checks.radio_close_hidden = s.radio.mounted && !s.radio.visible;

  // 5) reopen
  await spaNavigate(page, "radio");
  s = await lazyState(page);
  checks.radio_reopen_visible = s.radio.visible;

  // open remaining sections via SPA nav
  const perSection = {};
  for (const v of LAZY_VIEWS) {
    if (v.key === "radio") continue;
    await spaNavigate(page, v.key);
    s = await lazyState(page);
    perSection[v.key] = s[v.key];
    checks["open_" + v.key + "_mounted_visible"] = s[v.key].mounted && s[v.key].visible;
    if (v.seoClass) {
      const seoOk = await page.evaluate(
        (a) => {
          const view = document.getElementById(a.id);
          return !!(view && view.querySelector("." + a.seoClass));
        },
        { id: v.id, seoClass: v.seoClass },
      );
      checks["seo_inside_" + v.key] = seoOk;
    }
  }
  // tvprogram extras: boot renderers re-ran after lazy mount
  const tvDetail = await page.evaluate(() => {
    const tv = document.getElementById("iuTvProgramView");
    return {
      choiceInited: tv ? tv.getAttribute("data-iu-tv-choice-inited") === "1" : false,
      anyContent: tv ? tv.querySelectorAll("*").length : 0,
    };
  });
  checks.tvprogram_choice_ui_inited = tvDetail.choiceInited;

  // deep link: fresh load directly on ?section=tvonline (pre-mount path)
  await gotoSection(page, baseUrl, "tvonline");
  s = await lazyState(page);
  checks.deeplink_tvonline_mounted_visible = s.tvonline.mounted && s.tvonline.visible;

  // mobile focus tiles must not be disabled for lazy targets (mobile/tablet portrait)
  if (vp.width <= 900) {
    const tiles = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll(".iuMobileTile[data-target]"));
      const lazyTargets = ["#iuRadioView", "#iuTvOnlineView", "#iuJrEmptyView", "#iuMapyView", "#iuTravelView", "#iuTvProgramView"];
      const rel = all.filter((t) => lazyTargets.indexOf(t.getAttribute("data-target")) !== -1);
      return { total: rel.length, disabled: rel.filter((t) => t.disabled).length };
    });
    checks.mobile_tiles_not_disabled = tiles.total === 0 || tiles.disabled === 0;
  }

  // 6) regression
  await gotoSection(page, baseUrl, null);
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
      silver_stack: state("iuSilverTopCardsStack"),
      calendar_overlay: state("iuCalendarOverlay"),
      tasks_overlay: state("iuTasksOverlay"),
      notes_overlay: state("iuNotesOverlay"),
      weather_view_present: !!document.getElementById("iuWeatherView"),
      weather_card: state("iuSilverWeatherCard"),
      finance_card: state("iuSilverFinanceHomeCard"),
      parcel_card: state("iuSilverParcelWatch"),
      articles_feed_children: (document.getElementById("feed") || { children: { length: 0 } }).children.length,
      mind_menu: state("iuMindMenuView"),
      bottom_nav: state("iuMobileBottomNav"),
      consent_layer: document.getElementById("iuConsentLayer") ? "PRESENT" : "MISSING",
    };
  });
  checks.regression_info_center_lazy = regression.info_center_template && regression.info_center_overlay_absent;
  checks.regression_silver = regression.silver_stack !== "MISSING";
  checks.regression_calendar = regression.calendar_overlay === "PRESENT_HIDDEN";
  /* Overlay-cluster lazy mount (P1 fix #4): tasks/notes overlays no longer
     exist at load — they mount on first open. MISSING at load is the new
     expected state; PRESENT_HIDDEN kept for pre-fix builds. */
  checks.regression_tasks = regression.tasks_overlay === "PRESENT_HIDDEN" || regression.tasks_overlay === "MISSING";
  checks.regression_notes = regression.notes_overlay === "PRESENT_HIDDEN" || regression.notes_overlay === "MISSING";
  checks.regression_weather = regression.weather_view_present && regression.weather_card !== "MISSING";
  checks.regression_finance = regression.finance_card !== "MISSING";
  checks.regression_parcelwatch = regression.parcel_card !== "MISSING";
  checks.regression_articles = regression.articles_feed_children > 0;
  checks.regression_menu = regression.mind_menu !== "MISSING";
  checks.regression_bottom_nav = regression.bottom_nav !== "MISSING";
  checks.regression_consent = regression.consent_layer === "PRESENT";

  // 7) errors
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
    domHomepage,
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

  // 2) raw HTML SEO guard (no browser)
  let rawHtml;
  if (EXTERNAL_URL) {
    rawHtml = await new Promise((resolve, reject) => {
      require("https").get(EXTERNAL_URL, { headers: { "User-Agent": "iu-seo-guard" } }, (r) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }).on("error", reject);
    });
  } else {
    rawHtml = fs.readFileSync(path.join(REPO, "projects/index.html"), "utf8");
  }
  const seoAudit = seoRawHtmlAudit(rawHtml);
  const seoPass = Object.values(seoAudit).every((v) => v.inRawHtml && v.outsideTemplates);

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

  const allPass = seoPass && results.every((r) => r.pass);
  const out = {
    guard: "SECTION_VIEWS_LAZY_MOUNT_GUARD",
    targetUrl: baseUrl,
    finishedAt: new Date().toISOString(),
    result: allPass ? "PASS" : "FAIL",
    seoGuard: { pass: seoPass, detail: seoAudit },
    viewports: results,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("GUARD_FAILED", e);
  process.exit(2);
});
