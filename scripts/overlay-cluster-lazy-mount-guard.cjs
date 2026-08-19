#!/usr/bin/env node
/**
 * OVERLAY_CLUSTER_LAZY_MOUNT_GUARD
 *
 * Replay guard for the overlay-cluster lazy-mount fix (P1 performance fix #4).
 * Lazy-mounted overlays:
 *   - notes  (#iuNotesOverlay)        — JS-built on first open (was: built at init)
 *   - tasks  (#iuTasksOverlay)        — JS-built on first open (was: built at init)
 *   - custombuttons (#iuCustomButtonsBackdrop + #iuCustomButtonsPanel) — <template>
 *   - datovka (#iuDsOverlay + #iuDsPanel)                              — <template>
 *   - videomodal (#iuVideoModal)      — <template>; no opener exists (dead overlay),
 *     so only load_not_mounted is verified for it.
 *
 * Per viewport (DESKTOP / MOBILE / TABLET_PORTRAIT / TABLET_LANDSCAPE):
 *   1. load  -> overlay DOM absent, templates present
 *   2. first open  -> mounts, visible, UX content present
 *   3. close -> hidden, 4. reopen -> visible again
 *   5. regression  -> info center + section views lazy intact, module roots unchanged
 *   6. consoleErrors=0, pageErrors=0
 *
 * Usage:
 *   node scripts/overlay-cluster-lazy-mount-guard.cjs
 *   IU_GUARD_URL=https://infouzel.cz/projects/ node scripts/overlay-cluster-lazy-mount-guard.cjs
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
const PORT = Number(process.env.IU_GUARD_PORT || 8746);

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

async function overlayState(page) {
  return page.evaluate(() => {
    function vis(el) {
      if (!el || el.hidden) return false;
      const st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    const byId = (id) => document.getElementById(id);
    return {
      notes: { mounted: !!byId("iuNotesOverlay"), visible: vis(byId("iuNotesOverlay")) },
      tasks: { mounted: !!byId("iuTasksOverlay"), visible: vis(byId("iuTasksOverlay")) },
      custombuttons: {
        mounted: !!byId("iuCustomButtonsPanel"),
        backdropMounted: !!byId("iuCustomButtonsBackdrop"),
        template: !!byId("iuLazyOverlayTpl-custombuttons"),
        visible: vis(byId("iuCustomButtonsPanel")),
      },
      datovka: {
        mounted: !!byId("iuDsPanel"),
        overlayMounted: !!byId("iuDsOverlay"),
        template: !!byId("iuLazyOverlayTpl-datovka"),
        visible: vis(byId("iuDsPanel")),
      },
      videomodal: {
        mounted: !!byId("iuVideoModal"),
        template: !!byId("iuLazyOverlayTpl-videomodal"),
      },
      domTotal: document.querySelectorAll("*").length,
    };
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
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // 1) load: not mounted, templates present
  const s0 = await overlayState(page);
  checks.notes_load_not_mounted = !s0.notes.mounted;
  checks.tasks_load_not_mounted = !s0.tasks.mounted;
  checks.custombuttons_load_not_mounted = !s0.custombuttons.mounted && !s0.custombuttons.backdropMounted;
  checks.custombuttons_load_template_present = s0.custombuttons.template;
  checks.datovka_load_not_mounted = !s0.datovka.mounted && !s0.datovka.overlayMounted;
  checks.datovka_load_template_present = s0.datovka.template;
  checks.videomodal_load_not_mounted = !s0.videomodal.mounted;
  checks.videomodal_load_template_present = s0.videomodal.template;
  const domLoad = s0.domTotal;

  // ---- NOTES: open -> close -> reopen (public service path = same openOverlay used by triggers)
  await page.evaluate(async () => {
    if (typeof window.__iuEnsureNotesOverlay === "function") {
      await window.__iuEnsureNotesOverlay();
    }
    window.iuNotesService.openOverlay();
  });
  await page.waitForTimeout(600);
  let s = await overlayState(page);
  const notesUx = await page.evaluate(() => {
    const ov = document.getElementById("iuNotesOverlay");
    return {
      dialog: !!(ov && ov.querySelector(".iu-notesOverlay__dialog")),
      newBtn: !!(ov && ov.querySelector("[data-iu-notes-new]")),
      list: !!(ov && ov.querySelector("#iuNotesList")),
      search: !!(ov && ov.querySelector("#iuNotesSearch")),
    };
  });
  checks.notes_first_open = s.notes.mounted && s.notes.visible;
  checks.notes_open_ux = notesUx.dialog && notesUx.newBtn && notesUx.list && notesUx.search;
  await page.evaluate(() => {
    const b = document.querySelector('#iuNotesOverlay .iu-notesOverlay__close[data-iu-notes-close="1"]');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  s = await overlayState(page);
  checks.notes_close = s.notes.mounted && !s.notes.visible;
  await page.evaluate(() => { window.iuNotesService.openOverlay(); });
  await page.waitForTimeout(400);
  s = await overlayState(page);
  checks.notes_reopen = s.notes.visible;
  await page.evaluate(() => { window.iuNotesService.closeOverlay(); });
  await page.waitForTimeout(300);

  // ---- TASKS: open -> close -> reopen
  await page.evaluate(() => { window.iuTasksService.openOverlay(); });
  await page.waitForTimeout(600);
  s = await overlayState(page);
  const tasksUx = await page.evaluate(() => {
    const ov = document.getElementById("iuTasksOverlay");
    return {
      dialog: !!(ov && ov.querySelector(".iu-tasksOverlay__dialog")),
      newBtn: !!(ov && ov.querySelector("[data-iu-tasks-new]")),
      filters: !!(ov && ov.querySelector("#iuTasksFilters")),
      main: !!(ov && ov.querySelector("#iuTasksMain") && ov.querySelector("#iuTasksMain").children.length > 0),
    };
  });
  checks.tasks_first_open = s.tasks.mounted && s.tasks.visible;
  checks.tasks_open_ux = tasksUx.dialog && tasksUx.newBtn && tasksUx.filters && tasksUx.main;
  await page.evaluate(() => {
    const b = document.querySelector('#iuTasksOverlay .iu-tasksOverlay__close[data-iu-tasks-close="1"]');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  s = await overlayState(page);
  checks.tasks_close = s.tasks.mounted && !s.tasks.visible;
  await page.evaluate(() => { window.iuTasksService.openOverlay(); });
  await page.waitForTimeout(400);
  s = await overlayState(page);
  checks.tasks_reopen = s.tasks.visible;
  await page.evaluate(() => { window.iuTasksService.closeOverlay(); });
  await page.waitForTimeout(300);

  // ---- CUSTOM BUTTONS: open via real trigger (document-delegated), close, reopen
  // On mobile/tablet-portrait the trigger lives inside the bottom-nav gate
  // ("MindMenu a nástroje" tab) — open it first, exactly like a real user.
  const openCustomButtons = () =>
    page.evaluate(() => {
      const gateTab = document.getElementById("iuMobileGateTabTools");
      const gatePanel = document.getElementById("iuMobileGatePanelTools");
      if (gateTab && gatePanel && gatePanel.hidden) gateTab.click();
      const t = document.querySelector('[data-iu-action="custom-buttons"]');
      if (t) t.click();
      else if (typeof window.iuCustomButtonsOverlayOpen === "function") window.iuCustomButtonsOverlayOpen();
    });
  await openCustomButtons();
  await page.waitForTimeout(600);
  s = await overlayState(page);
  const cbUx = await page.evaluate(() => {
    return {
      form: !!document.getElementById("iuCustomButtonsForm"),
      name: !!document.getElementById("iuCustomButtonsName"),
      url: !!document.getElementById("iuCustomButtonsUrl"),
      list: !!document.getElementById("iuCustomButtonsList"),
      listFilled: !!(document.getElementById("iuCustomButtonsList") && document.getElementById("iuCustomButtonsList").children.length > 0),
      closeBtn: !!document.getElementById("iuCustomButtonsClose"),
      templateGone: !document.getElementById("iuLazyOverlayTpl-custombuttons"),
    };
  });
  checks.custombuttons_first_open = s.custombuttons.mounted && s.custombuttons.visible;
  checks.custombuttons_open_ux = cbUx.form && cbUx.name && cbUx.url && cbUx.list && cbUx.listFilled && cbUx.closeBtn && cbUx.templateGone;
  await page.evaluate(() => {
    const b = document.getElementById("iuCustomButtonsClose");
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  s = await overlayState(page);
  checks.custombuttons_close = s.custombuttons.mounted && !s.custombuttons.visible;
  await openCustomButtons();
  await page.waitForTimeout(400);
  s = await overlayState(page);
  checks.custombuttons_reopen = s.custombuttons.visible;
  await page.evaluate(() => {
    const b = document.getElementById("iuCustomButtonsClose");
    if (b) b.click();
  });
  await page.waitForTimeout(300);

  // ---- DATOVKA: open via public surface (same fn real triggers call), close via panel close btn, reopen
  await page.evaluate(() => { window.iuDatovkaOpenSurface(); });
  await page.waitForTimeout(600);
  s = await overlayState(page);
  const dsUx = await page.evaluate(() => {
    const host = document.getElementById("iuDsProfileListHost");
    return {
      profileCards: host ? host.querySelectorAll(".iu-ds-profile").length : 0,
      addBtn: !!document.getElementById("iuDsAddBtn"),
      closeBtn: !!document.querySelector("#iuDsPanel .iu-ds-close"),
      deleteConfirmMounted: !!document.getElementById("iuDsDeleteConfirm"),
      templateGone: !document.getElementById("iuLazyOverlayTpl-datovka"),
    };
  });
  checks.datovka_first_open = s.datovka.mounted && s.datovka.visible;
  checks.datovka_open_ux = dsUx.profileCards > 0 && dsUx.addBtn && dsUx.closeBtn && dsUx.deleteConfirmMounted && dsUx.templateGone;
  await page.evaluate(() => {
    const b = document.querySelector("#iuDsPanel .iu-ds-close");
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  s = await overlayState(page);
  checks.datovka_close = s.datovka.mounted && !s.datovka.visible;
  await page.evaluate(() => { window.iuDatovkaOpenSurface(); });
  await page.waitForTimeout(400);
  s = await overlayState(page);
  checks.datovka_reopen = s.datovka.visible;
  await page.evaluate(() => {
    if (typeof window.iuDatovkaCloseSurface === "function") window.iuDatovkaCloseSurface();
  });
  await page.waitForTimeout(300);

  // ---- regression: other modules untouched (fresh load)
  await page.goto(baseUrl, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 }).catch(() => {});
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
      section_view_templates: ["jr", "tvprogram", "travel", "mapy", "radio", "tvonline"].filter((k) => !!document.getElementById("iuLazyViewTpl-" + k)).length,
      silver_stack: state("iuSilverTopCardsStack"),
      calendar_overlay: state("iuCalendarOverlay"),
      weather_view_present: !!document.getElementById("iuWeatherView"),
      weather_card: state("iuSilverWeatherCard"),
      finance_card: state("iuSilverFinanceHomeCard"),
      parcel_card: state("iuSilverParcelWatch"),
      parcel_modal_present: !!document.getElementById("iuParcelsPopover"),
      ai_panel_present: !!document.getElementById("iu-aiPanel"),
      pwa_overlay_present: !!document.getElementById("iuPwaIosOverlay"),
      articles_feed_children: (document.getElementById("feed") || { children: { length: 0 } }).children.length,
      mind_menu: state("iuMindMenuView"),
      bottom_nav: state("iuMobileBottomNav"),
      consent_layer: document.getElementById("iuConsentLayer") ? "PRESENT" : "MISSING",
    };
  });
  checks.regression_info_center_lazy = regression.info_center_template && regression.info_center_overlay_absent;
  checks.regression_section_views_lazy = regression.section_view_templates === 6;
  checks.regression_silver = regression.silver_stack !== "MISSING";
  /* Weather+Calendar lazy mount (P1 fix #6): calendar overlay + weather view
     no longer exist at load — they mount on first open. MISSING at load is
     the new expected state; PRESENT_HIDDEN kept for pre-fix builds. */
  checks.regression_calendar = regression.calendar_overlay === "PRESENT_HIDDEN" || regression.calendar_overlay === "MISSING";
  checks.regression_weather = regression.weather_card !== "MISSING";
  checks.regression_finance = regression.finance_card !== "MISSING";
  checks.regression_parcelwatch_card = regression.parcel_card !== "MISSING";
  checks.regression_parcelwatch_modal_eager = regression.parcel_modal_present; // BLOCKED overlay stays eager
  checks.regression_ai_panel_eager = regression.ai_panel_present; // BLOCKED overlay stays eager
  checks.regression_pwa_overlay_eager = regression.pwa_overlay_present; // BLOCKED overlay stays eager
  checks.regression_articles = regression.articles_feed_children > 0;
  checks.regression_menu = regression.mind_menu !== "MISSING";
  checks.regression_bottom_nav = regression.bottom_nav !== "MISSING";
  checks.regression_consent = regression.consent_layer === "PRESENT";

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
    guard: "OVERLAY_CLUSTER_LAZY_MOUNT_GUARD",
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
