#!/usr/bin/env node
/**
 * Startup single-paint guard: no double bootstrap/reload, no weather CTA flash on
 * unresolved geo authority, PWA splash bg matches first paint, SW reload paths share one latch.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  pickGuardPort,
  startGuardStaticServer,
  stopGuardProcess,
} from "./guards/guard-playwright-lifecycle.mjs";
import { waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";
import { swHasAllowedCacheVersion } from "./guards/iu-sw-cache-version-allowlist.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");
const OUT = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "iu_startup_single_paint_guard.json");
const CTA = "Zobrazit počasí pro tvoji polohu?";
const PAGE_BG = "#e5eef6";

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function staticContract() {
  const fails = [];
  const index = read("projects/index.html");
  const pipe = read("assets/iu-app-feed-pipeline-v1.js");
  const pwa = read("assets/iu-pwa-version-check.js");
  const app = read("assets/app.js");
  const sw = read("sw.js");
  const manRoot = JSON.parse(read("manifest.json"));
  const manProj = JSON.parse(read("projects/manifest.json"));
  const pkg = read("package.json");
  const smoke = read(".github/workflows/smoke.yml");

  if (String(manRoot.background_color || "").toLowerCase() !== PAGE_BG) {
    fails.push("manifest_root_bg_mismatch");
  }
  if (String(manProj.background_color || "").toLowerCase() !== PAGE_BG) {
    fails.push("manifest_projects_bg_mismatch");
  }
  if (!/background-color:\s*#e5eef6/.test(index)) fails.push("index_missing_page_bg_e5eef6");
  if (!/apple-mobile-web-app-capable/.test(index)) fails.push("index_missing_apple_capable");

  const compute = pipe.indexOf("function iuSilverWeatherComputePhase");
  if (compute < 0) fails.push("pipeline_missing_ComputePhase");
  else {
    const slice = pipe.slice(compute, compute + 1800);
    if (slice.indexOf('perm === "unknown"') < 0) fails.push("pipeline_unknown_not_gated");
    if (slice.indexOf('perm === "denied"') < 0) fails.push("pipeline_denied_not_gated");
    if (slice.indexOf("__iuSilverWxGeoAuthorityResolved") < 0) {
      fails.push("pipeline_missing_authority_resolved");
    }
  }

  if (pwa.indexOf('sessionStorage.getItem(SS_SW_DEPLOY_RELOAD) === "1"') < 0) {
    fails.push("pwa_version_missing_sw_deploy_latch");
  }
  if (app.indexOf('sessionStorage.setItem("iu:pwa:sw-deploy-reload", "1")') < 0) {
    fails.push("appjs_silent_sw_reload_missing_deploy_latch");
  }
  if (index.indexOf('sessionStorage.getItem(SD)==="1"') < 0) {
    fails.push("index_inline_pwa_missing_sw_deploy_skip");
  }
  if (!swHasAllowedCacheVersion(sw)) fails.push("sw_cache_version_not_allowlisted");
  if (sw.indexOf("2026-09-12-startup-single-paint-v1") < 0) {
    fails.push("sw_cache_version_token_missing");
  }

  if (pkg.indexOf("iu-startup-single-paint-guard") < 0) fails.push("package_json_missing_script");
  if (smoke.indexOf("iu-startup-single-paint-guard") < 0) fails.push("smoke_yml_missing_guard");
  return fails;
}

async function installConsent(context) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted-version:v1", "2026-09-08-v1");
      localStorage.setItem("iu:terms:accepted-at:v1", new Date().toISOString());
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
      localStorage.setItem("iu:consent:layer:dismissed:v1", "1");
    } catch (_) {}
  });
}

async function runDesktopCold(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await installConsent(context);
  const page = await context.newPage();
  const navs = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navs.push(frame.url());
  });

  await page.addInitScript(() => {
    try {
      const w = window;
      w.__iuBootDiag = { reloads: 0, inits: 0, phases: [] };
      const origReload = location.reload.bind(location);
      location.reload = function () {
        w.__iuBootDiag.reloads += 1;
        return origReload();
      };
      const mark = () => {
        try {
          const card = document.getElementById("iuSilverWeatherCard");
          w.__iuBootDiag.phases.push({
            t: Math.round(performance.now()),
            phase: card ? card.getAttribute("data-iu-silver-wx-phase") : null,
            init: !!w.__iuAppInitDone,
            feedInit: !!w.__iuFeedInitDone,
          });
        } catch (_) {}
      };
      setInterval(mark, 80);
    } catch (_) {}
  });

  await page.goto(`${base}?nosw=1&cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForTimeout(4500);
  try {
    await waitForVaultReady(page, 90000);
  } catch (_) {}
  await page.waitForTimeout(1500);

  const snap = await page.evaluate((cta) => {
    const card = document.getElementById("iuSilverWeatherCard");
    const l1 = document.getElementById("iuSilverWeatherLine1");
    const text = l1 ? String(l1.textContent || "") : "";
    const d = window.__iuBootDiag || {};
    return {
      reloads: d.reloads || 0,
      appInit: !!window.__iuAppInitDone,
      feedInit: !!window.__iuFeedInitDone,
      feedInitCount: window.__iuFeedInitDeferState
        ? window.__iuFeedInitDeferState.initCallCount
        : null,
      phase: card ? card.getAttribute("data-iu-silver-wx-phase") : null,
      hasCta: text.indexOf(cta) !== -1,
      phases: Array.isArray(d.phases) ? d.phases.slice(0, 80) : [],
    };
  }, CTA);

  await context.close();
  const fails = [];
  if (navs.length !== 1) fails.push("desktop_nav_count:" + navs.length);
  if (snap.reloads !== 0) fails.push("desktop_reload_calls:" + snap.reloads);
  if (snap.feedInitCount != null && snap.feedInitCount !== 1) {
    fails.push("desktop_feed_init_count:" + snap.feedInitCount);
  }
  if (!snap.appInit) fails.push("desktop_app_init_missing");
  const ctaPhases = (snap.phases || []).filter((p) => p && p.phase === "firstVisit");
  /* Desktop cold without geo mock may settle to firstVisit — allowed only after authority resolve.
     Fail if firstVisit appears while still booting before app init. */
  const earlyCta = ctaPhases.find((p) => p.t < 400 && !p.init);
  if (earlyCta) fails.push("desktop_early_firstVisit_before_init");
  return { fails, navs: navs.length, snap };
}

async function runMobileGranted(browser, base) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await installConsent(context);
  await context.addInitScript(() => {
    try {
      window.__iuSilverWxGeoPerm = "pending";
      window.__iuSilverWxGeoAuthorityResolved = false;
      if (!navigator.permissions) navigator.permissions = {};
      navigator.permissions.query = async (desc) => {
        if (desc && String(desc.name) === "geolocation") {
          return { state: "granted", onchange: null, addEventListener() {}, removeEventListener() {} };
        }
        return { state: "prompt", onchange: null, addEventListener() {}, removeEventListener() {} };
      };
      localStorage.setItem(
        "iuEarlyWxCacheV1",
        JSON.stringify({
          lat: 50.0755,
          lon: 14.4378,
          at: Date.now(),
          data: {
            current: {
              temperature_2m: 18,
              apparent_temperature: 17,
              weather_code: 3,
              is_day: 1,
              wind_speed_10m: 5,
              wind_gusts_10m: 8,
              wind_direction_10m: 90,
              pressure_msl: 1015,
              relative_humidity_2m: 60,
              visibility: 10000,
            },
          },
        })
      );
    } catch (_) {}
  });
  try {
    await context.grantPermissions(["geolocation"], { origin: base.replace(/\/projects\/?$/, "") });
    await context.setGeolocation({ latitude: 50.0755, longitude: 14.4378 });
  } catch (_) {}

  const page = await context.newPage();
  const navs = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navs.push(frame.url());
  });

  await page.goto(`${base}?nosw=1&cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });

  const samples = await page.evaluate(async (args) => {
    const out = [];
    const push = () => {
      const card = document.getElementById("iuSilverWeatherCard");
      const l1 = document.getElementById("iuSilverWeatherLine1");
      const text = l1 ? String(l1.textContent || "") : "";
      out.push({
        t: Math.round(performance.now()),
        phase: card ? card.getAttribute("data-iu-silver-wx-phase") : null,
        hasCta: text.indexOf(args.cta) !== -1,
        perm: window.__iuSilverWxGeoPerm || null,
        resolved: window.__iuSilverWxGeoAuthorityResolved === true,
      });
    };
    push();
    const iv = setInterval(push, 50);
    await new Promise((r) => setTimeout(r, 4000));
    clearInterval(iv);
    push();
    return out;
  }, { cta: CTA });

  try {
    await waitForVaultReady(page, 90000);
  } catch (_) {}

  const late = await page.evaluate((cta) => {
    const card = document.getElementById("iuSilverWeatherCard");
    const l1 = document.getElementById("iuSilverWeatherLine1");
    const text = l1 ? String(l1.textContent || "") : "";
    return {
      phase: card ? card.getAttribute("data-iu-silver-wx-phase") : null,
      hasCta: text.indexOf(cta) !== -1,
      feedInitCount: window.__iuFeedInitDeferState
        ? window.__iuFeedInitDeferState.initCallCount
        : null,
      bottomNav: (() => {
        const nav = document.getElementById("iuMobileBottomNav");
        if (!nav) return null;
        const r = nav.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
      })(),
      logo: (() => {
        const brand = document.querySelector(".iuBrand");
        if (!brand) return null;
        const r = brand.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
      })(),
    };
  }, CTA);

  await context.close();
  const fails = [];
  if (navs.length !== 1) fails.push("mobile_nav_count:" + navs.length);
  const ctaHits = samples.filter((s) => s.hasCta || s.phase === "firstVisit");
  if (ctaHits.length) fails.push("granted_cta_or_firstVisit:" + ctaHits.length);
  if (late.hasCta || late.phase === "firstVisit") fails.push("granted_ended_as_firstVisit");
  if (late.feedInitCount != null && late.feedInitCount !== 1) {
    fails.push("mobile_feed_init_count:" + late.feedInitCount);
  }
  if (late.bottomNav && late.bottomNav.h > 120) fails.push("mobile_bottom_nav_too_tall:" + late.bottomNav.h);
  return { fails, navs: navs.length, sampleCount: samples.length, late };
}

async function runUnknownNoCta(browser, base) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await installConsent(context);
  await context.addInitScript(() => {
    try {
      window.__iuSilverWxGeoPerm = "unknown";
      window.__iuSilverWxGeoAuthorityResolved = false;
      navigator.permissions = {
        query: async () => {
          throw new Error("no-permissions-api");
        },
      };
    } catch (_) {}
  });
  const page = await context.newPage();
  await page.goto(`${base}?nosw=1&cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  const early = await page.evaluate((cta) => {
    const rows = [];
    for (let i = 0; i < 25; i++) {
      const card = document.getElementById("iuSilverWeatherCard");
      const l1 = document.getElementById("iuSilverWeatherLine1");
      const text = l1 ? String(l1.textContent || "") : "";
      rows.push({
        i,
        phase: card ? card.getAttribute("data-iu-silver-wx-phase") : null,
        hasCta: text.indexOf(cta) !== -1,
        resolved: window.__iuSilverWxGeoAuthorityResolved === true,
      });
    }
    return rows;
  }, CTA);
  /* Sample synchronously in a tight loop isn't time-based — use timed sample. */
  const timed = await page.evaluate(async (cta) => {
    const out = [];
    const push = () => {
      const card = document.getElementById("iuSilverWeatherCard");
      const l1 = document.getElementById("iuSilverWeatherLine1");
      const text = l1 ? String(l1.textContent || "") : "";
      out.push({
        t: Math.round(performance.now()),
        phase: card ? card.getAttribute("data-iu-silver-wx-phase") : null,
        hasCta: text.indexOf(cta) !== -1,
        resolved: window.__iuSilverWxGeoAuthorityResolved === true,
      });
    };
    push();
    const iv = setInterval(push, 40);
    await new Promise((r) => setTimeout(r, 1200));
    clearInterval(iv);
    push();
    return out;
  }, CTA);
  await context.close();
  const fails = [];
  const premature = timed.filter((s) => (s.hasCta || s.phase === "firstVisit") && !s.resolved);
  if (premature.length) fails.push("unknown_cta_before_authority_resolved:" + premature.length);
  return { fails, earlyCount: early.length, timedCount: timed.length };
}

async function main() {
  const fails = staticContract();
  const evidence = { staticFails: fails.slice() };
  let server = null;
  let browser = null;
  try {
    const started = await startGuardStaticServer(pickGuardPort(9620, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;
    browser = await chromium.launch({ headless: true });

    const desktop = await runDesktopCold(browser, base);
    evidence.desktop = desktop;
    fails.push(...desktop.fails);

    const mobile = await runMobileGranted(browser, base);
    evidence.mobileGranted = mobile;
    fails.push(...mobile.fails);

    const unknown = await runUnknownNoCta(browser, base);
    evidence.unknown = unknown;
    fails.push(...unknown.fails);

    const report = {
      IU_STARTUP_SINGLE_PAINT_GUARD: fails.length === 0 ? "PASS" : "FAIL",
      fails,
      evidence,
    };
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify(report, null, 2));
    if (fails.length) process.exit(1);
  } catch (err) {
    console.error(String(err && err.stack ? err.stack : err));
    process.exit(1);
  } finally {
    try {
      if (browser) await browser.close();
    } catch (_) {}
    if (server) await stopGuardProcess(server.proc || null);
  }
}

main();
