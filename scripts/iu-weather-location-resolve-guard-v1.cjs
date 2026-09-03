#!/usr/bin/env node
"use strict";
/**
 * Weather location resolve guard — production contract after PR #10191.
 *
 * Runtime (Playwright against checkout) + static source contracts so a
 * performance/boot/cache refactor cannot reintroduce:
 *   RC1 silent Praha fallback
 *   RC2 GPS without freshness `at`
 *   RC3 early-boot ignoring iu_location_mode
 *
 * Negative proofs mutate in-memory source copies only (never the working tree).
 */
const path = require("path");
const http = require("http");
const fs = require("fs");
const { createRequire } = require("module");
const REPO = path.resolve(__dirname, "..");
const req = createRequire(path.join(REPO, "package.json"));
const { chromium } = req("playwright");
const PORT = 8831;
const OUT = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "iu_weather_location_resolve_guard.json");

const PIPELINE_REL = "assets/iu-app-feed-pipeline-v1.js";
const INDEX_REL = "projects/index.html";
const SMOKE_REL = path.join(".github", "workflows", "smoke.yml");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const PRAHA = { lat: 50.0755, lon: 14.4378, name: "Praha" };
const BRNO = { lat: 49.1951, lon: 16.6068, name: "Brno" };
const PLZEN = { lat: 49.7384, lon: 13.3736, name: "Plzeň" };
const OSTRAVA = { lat: 49.8209, lon: 18.2625, name: "Ostrava" };

function readRepo(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function extractFunction(src, name) {
  const needle = "function " + name;
  const i = src.indexOf(needle);
  if (i < 0) return "";
  const brace = src.indexOf("{", i);
  if (brace < 0) return "";
  let depth = 0;
  for (let j = brace; j < src.length; j++) {
    const ch = src[j];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  return src.slice(i);
}

function extractSoftStaleMs(pipeline) {
  const m = pipeline.match(/IU_WEATHER_GPS_SOFT_STALE_MS\s*=\s*([^;]+);/);
  if (!m) return null;
  try {
    const n = Function('"use strict"; return (' + m[1] + ");")();
    return typeof n === "number" && isFinite(n) && n > 0 ? n : null;
  } catch (_) {
    return null;
  }
}

function near(a, b, eps) {
  return Math.abs(Number(a) - Number(b)) < (eps || 0.01);
}

function staticContract(pipeline, indexHtml, smokeYml) {
  const fails = [];
  const getActive = extractFunction(pipeline, "iuWeatherGetActiveCity");
  const resolve = extractFunction(pipeline, "iuWeatherResolveLocation");
  const writeGps = extractFunction(pipeline, "iuWeatherWriteGpsSelected");
  const needsRefresh = extractFunction(pipeline, "iuWeatherGpsNeedsRefresh");
  const schedule = extractFunction(pipeline, "iuWeatherScheduleGpsRefreshIfNeeded");
  const ensure = extractFunction(pipeline, "iuWeatherEnsureState");
  const load = extractFunction(pipeline, "iuWeatherLoadAndRender");
  const silver = extractFunction(pipeline, "iuSilverWeatherInit");
  const daily = extractFunction(pipeline, "iuDailyPanelInit") || pipeline;
  const readLoc = extractFunction(indexHtml, "readLoc");

  if (!getActive) fails.push("static_missing_GetActiveCity");
  else {
    if (getActive.indexOf("iuWeatherResolveLocation") < 0) fails.push("static_GetActiveCity_not_using_resolver");
    if (getActive.indexOf("IU_WEATHER_DEFAULT_CITY") >= 0) fails.push("static_GetActiveCity_silent_praha_default");
  }

  if (!resolve) fails.push("static_missing_ResolveLocation");
  else {
    if (resolve.indexOf("IU_WEATHER_MODE_MANUAL") < 0) fails.push("static_ResolveLocation_no_manual_mode");
    if (resolve.indexOf("iuWeatherReadManualLocation") < 0) fails.push("static_ResolveLocation_no_manual_read");
    if (resolve.indexOf("iuWeatherReadGpsSelected") < 0) fails.push("static_ResolveLocation_no_gps_read");
    if (resolve.indexOf("needs_setup") < 0) fails.push("static_ResolveLocation_no_needs_setup");
    if (resolve.indexOf("IU_WEATHER_DEFAULT_CITY") >= 0) fails.push("static_ResolveLocation_silent_praha");
  }

  if (!writeGps) fails.push("static_missing_WriteGpsSelected");
  else if (!/\bat\s*:\s*Date\.now\s*\(/.test(writeGps)) fails.push("static_WriteGpsSelected_missing_at");

  if (!needsRefresh) fails.push("static_missing_GpsNeedsRefresh");
  else {
    if (needsRefresh.indexOf("IU_WEATHER_GPS_SOFT_STALE_MS") < 0) fails.push("static_GpsNeedsRefresh_no_soft_stale");
    if (needsRefresh.indexOf("age == null") < 0 && needsRefresh.indexOf("age === null") < 0) {
      fails.push("static_GpsNeedsRefresh_legacy_no_at_not_stale");
    }
    if (/return\s+false\s*;\s*}\s*$/.test(needsRefresh.replace(/\s+/g, " ")) && needsRefresh.indexOf("SOFT_STALE") < 0) {
      fails.push("static_GpsNeedsRefresh_always_fresh");
    }
  }

  if (!schedule) fails.push("static_missing_ScheduleGpsRefresh");
  else {
    if (schedule.indexOf("needsGpsRefresh") < 0) fails.push("static_Schedule_no_needsGpsRefresh");
    if (schedule.indexOf("iuWeatherActivateGpsViaGeolocation") < 0) fails.push("static_Schedule_no_activate");
  }

  if (pipeline.indexOf("visibilitychange") < 0 || pipeline.indexOf("iuWeatherScheduleGpsRefreshIfNeeded") < 0) {
    fails.push("static_no_resume_refresh_hook");
  }

  if (!readLoc) fails.push("static_missing_early_readLoc");
  else {
    const readsMode =
      readLoc.indexOf('localStorage.getItem("iu_location_mode")') >= 0 ||
      readLoc.indexOf("localStorage.getItem('iu_location_mode')") >= 0;
    if (!readsMode) fails.push("static_early_boot_ignores_mode");
    if (!/if\s*\(\s*mode\s*===\s*["']manual["']\s*\)/.test(readLoc)) {
      fails.push("static_early_boot_no_mode_branch");
    }
    if (readLoc.indexOf("iuWeatherGpsSelectedV1") < 0) fails.push("static_early_boot_no_gps_branch");
    const modeIdx = readLoc.indexOf("iu_location_mode");
    const manGet = readLoc.indexOf("iu_manual_location");
    const gpsIdx = readLoc.indexOf("iuWeatherGpsSelectedV1");
    if (modeIdx < 0 || (manGet >= 0 && manGet < modeIdx)) fails.push("static_early_boot_manual_before_mode");
    if (modeIdx >= 0 && gpsIdx >= 0 && gpsIdx < modeIdx) fails.push("static_early_boot_gps_before_mode");
  }

  if (!ensure || ensure.indexOf("iuWeatherGetActiveCity") < 0) fails.push("static_EnsureState_not_using_active_city");
  if (!load || load.indexOf("iuWeatherGetActiveCity") < 0) fails.push("static_LoadAndRender_not_using_active_city");
  if (daily.indexOf("iuWeatherGetActiveCity") < 0 && daily.indexOf("iuDailyPanelInit") >= 0) {
    fails.push("static_DailyPanel_not_using_active_city");
  }
  if (silver && /open-meteo\.com/i.test(silver)) fails.push("static_Silver_independent_open_meteo");

  if (String(smokeYml || "").indexOf("iu-weather-location-resolve-guard") < 0) {
    fails.push("static_smoke_yml_missing_guard");
  }

  if (extractSoftStaleMs(pipeline) == null) fails.push("static_missing_SOFT_STALE_MS");

  return fails;
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

async function boot(browser, seed, opts) {
  const o = opts || {};
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: o.geolocation || undefined,
    permissions: o.geolocation ? ["geolocation"] : [],
  });
  const page = await context.newPage();
  if (o.mockGeoFail) {
    await page.addInitScript(() => {
      try {
        navigator.geolocation.getCurrentPosition = function (_ok, err) {
          if (typeof err === "function") err({ code: 1, message: "User denied Geolocation" });
        };
      } catch (_) {}
    });
  }
  if (o.mockGeoTimeout) {
    await page.addInitScript(() => {
      try {
        navigator.geolocation.getCurrentPosition = function (_ok, err) {
          if (typeof err === "function") err({ code: 3, message: "Timeout expired" });
        };
      } catch (_) {}
    });
  }
  if (o.mockGeoUnavailable) {
    await page.addInitScript(() => {
      try {
        navigator.geolocation.getCurrentPosition = function (_ok, err) {
          if (typeof err === "function") err({ code: 2, message: "Position unavailable" });
        };
      } catch (_) {}
    });
  }
  await page.addInitScript((s) => {
    try {
      localStorage.clear();
    } catch (_) {}
    try {
      window.__iuVaultHydrationComplete = true;
    } catch (_) {}
    if (s && typeof s === "object") {
      Object.keys(s).forEach((k) => {
        try {
          localStorage.setItem(k, s[k]);
        } catch (_) {}
      });
    }
  }, seed || {});
  const meteo = [];
  page.on("request", (req) => {
    const u = req.url();
    if (u.indexOf("open-meteo.com") >= 0) meteo.push(u);
  });
  page.__iuMeteo = meteo;
  await page.goto("http://127.0.0.1:" + PORT + "/projects/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2800);
  await page.evaluate(() => {
    try {
      window.__iuVaultHydrationComplete = true;
    } catch (_) {}
  });
  await page.waitForFunction(() => typeof window.iuWeatherResolveLocation === "function", { timeout: 60000 });
  return { context, page, meteo };
}

async function snap(page, label) {
  return page.evaluate((lab) => {
    const resolve = window.iuWeatherResolveLocation();
    const active = typeof window.iuWeatherGetActiveCity === "function" ? window.iuWeatherGetActiveCity() : null;
    let gpsObj = null;
    let manObj = null;
    try {
      gpsObj = JSON.parse(localStorage.getItem("iuWeatherGpsSelectedV1") || "null");
    } catch (_) {}
    try {
      manObj = JSON.parse(localStorage.getItem("iu_manual_location") || "null");
    } catch (_) {}
    let early = null;
    try {
      early = window.__iuEarlyWxLoc || null;
    } catch (_) {}
    return {
      label: lab,
      resolve,
      active,
      mode: localStorage.getItem("iu_location_mode"),
      gpsObj,
      manObj,
      early,
      refreshReason: window.__iuWeatherGpsRefreshReason || null,
    };
  }, label);
}

function meteoHasCoords(urls, lat, lon) {
  const needleLat = "latitude=" + encodeURIComponent(String(lat));
  const altLat = "latitude=" + String(lat);
  return (urls || []).some((u) => {
    const hasLat = u.indexOf(needleLat) >= 0 || u.indexOf(altLat) >= 0;
    const hasLon = u.indexOf("longitude=") >= 0 && (u.indexOf(String(lon)) >= 0);
    return hasLat && hasLon;
  });
}

(async () => {
  const pipeline = readRepo(PIPELINE_REL);
  const indexHtml = readRepo(INDEX_REL);
  const smokeYml = readRepo(SMOKE_REL);
  const softStaleMs = extractSoftStaleMs(pipeline);
  const scenarios = {};
  const fails = [];
  const cases = [];

  const staticFails = staticContract(pipeline, indexHtml, smokeYml);
  scenarios.STATIC_SOURCE_CONTRACT = staticFails.length === 0 ? "PASS" : "FAIL";
  if (staticFails.length) fails.push.apply(fails, staticFails);

  const server = await startServer();
  const browser = await chromium.launch({ headless: true });

  try {
    // A — NO SILENT PRAGUE FALLBACK
    {
      const { context, page } = await boot(browser, { iu_location_mode: "gps" });
      const s = await snap(page, "A_empty_gps_mode");
      cases.push(s);
      const ok =
        !s.active &&
        s.resolve &&
        s.resolve.status === "needs_setup" &&
        !(s.active && /praha/i.test(String((s.active && s.active.name) || "")));
      scenarios.NO_SILENT_PRAGUE_FALLBACK = ok ? "PASS" : "FAIL";
      if (!ok) fails.push("A_silent_praha:" + JSON.stringify(s.resolve) + JSON.stringify(s.active));
      await context.close();
    }

    // B — MANUAL CITY AUTHORITY (+ early boot)
    {
      const { context, page } = await boot(browser, {
        iu_location_mode: "manual",
        iu_manual_location: JSON.stringify({ lat: BRNO.lat, lon: BRNO.lon, label: BRNO.name }),
        iuWeatherGpsSelectedV1: JSON.stringify({ name: PRAHA.name, lat: PRAHA.lat, lon: PRAHA.lon, at: Date.now() }),
      });
      const s = await snap(page, "B_manual_brno");
      cases.push(s);
      const ok =
        s.resolve &&
        s.resolve.source === "manual" &&
        s.active &&
        /brno/i.test(String(s.active.name || "")) &&
        near(s.active.lat, BRNO.lat) &&
        s.early &&
        s.early.src === "manual" &&
        near(s.early.lat, BRNO.lat) &&
        near(s.early.lat, s.active.lat) &&
        near(s.early.lon, s.active.lon);
      scenarios.MANUAL_CITY_AUTHORITY = ok ? "PASS" : "FAIL";
      if (!ok) fails.push("B_manual:" + JSON.stringify({ resolve: s.resolve, active: s.active, early: s.early }));
      await context.close();
    }

    // C — GPS MODE AUTHORITY
    {
      const { context, page } = await boot(browser, {
        iu_location_mode: "gps",
        iu_manual_location: JSON.stringify({ lat: PRAHA.lat, lon: PRAHA.lon, label: PRAHA.name }),
        iuWeatherGpsSelectedV1: JSON.stringify({
          name: PLZEN.name,
          lat: PLZEN.lat,
          lon: PLZEN.lon,
          at: Date.now(),
        }),
      });
      const s = await snap(page, "C_gps_plzen");
      cases.push(s);
      const ok =
        s.resolve &&
        s.resolve.source === "gps" &&
        s.active &&
        near(s.active.lat, PLZEN.lat) &&
        s.early &&
        s.early.src === "gps" &&
        near(s.early.lat, PLZEN.lat) &&
        s.resolve.needsGpsRefresh === false;
      scenarios.GPS_MODE_AUTHORITY = ok ? "PASS" : "FAIL";
      if (!ok) fails.push("C_gps:" + JSON.stringify({ resolve: s.resolve, active: s.active, early: s.early }));
      await context.close();
    }

    // D — GPS FRESHNESS (limit from production source, not a parallel copy)
    {
      if (softStaleMs == null) {
        scenarios.GPS_FRESHNESS = "FAIL";
        fails.push("D_no_soft_stale_ms");
      } else {
        const { context: cFresh, page: pFresh } = await boot(browser, {
          iu_location_mode: "gps",
          iuWeatherGpsSelectedV1: JSON.stringify({
            name: PLZEN.name,
            lat: PLZEN.lat,
            lon: PLZEN.lon,
            at: Date.now() - Math.max(1000, Math.floor(softStaleMs * 0.2)),
          }),
        });
        const fresh = await snap(pFresh, "D_fresh");
        await cFresh.close();

        const { context: cNoAt, page: pNoAt } = await boot(browser, {
          iu_location_mode: "gps",
          iuWeatherGpsSelectedV1: JSON.stringify({ name: PRAHA.name, lat: PRAHA.lat, lon: PRAHA.lon }),
        });
        const noAt = await snap(pNoAt, "D_no_at");
        await cNoAt.close();

        const { context: cStale, page: pStale } = await boot(browser, {
          iu_location_mode: "gps",
          iuWeatherGpsSelectedV1: JSON.stringify({
            name: PRAHA.name,
            lat: PRAHA.lat,
            lon: PRAHA.lon,
            at: Date.now() - (softStaleMs + 60 * 1000),
          }),
        });
        const stale = await snap(pStale, "D_stale");
        await cStale.close();

        cases.push(fresh, noAt, stale);
        const ok =
          fresh.resolve &&
          fresh.resolve.needsGpsRefresh === false &&
          noAt.resolve &&
          noAt.resolve.needsGpsRefresh === true &&
          stale.resolve &&
          stale.resolve.needsGpsRefresh === true;
        scenarios.GPS_FRESHNESS = ok ? "PASS" : "FAIL";
        if (!ok) {
          fails.push(
            "D_freshness:" +
              JSON.stringify({
                softStaleMs,
                fresh: fresh.resolve && fresh.resolve.needsGpsRefresh,
                noAt: noAt.resolve && noAt.resolve.needsGpsRefresh,
                stale: stale.resolve && stale.resolve.needsGpsRefresh,
              })
          );
        }
      }
    }

    // E — EARLY BOOT CONSISTENCY (same input → same coords/src family)
    {
      const { context, page } = await boot(browser, {
        iu_location_mode: "manual",
        iu_manual_location: JSON.stringify({ lat: OSTRAVA.lat, lon: OSTRAVA.lon, label: OSTRAVA.name }),
        iuWeatherGpsSelectedV1: JSON.stringify({
          name: PRAHA.name,
          lat: PRAHA.lat,
          lon: PRAHA.lon,
          at: Date.now(),
        }),
      });
      const s = await snap(page, "E_early_vs_resolve");
      cases.push(s);
      const ok =
        s.early &&
        s.active &&
        s.early.src === "manual" &&
        s.resolve.source === "manual" &&
        near(s.early.lat, s.active.lat) &&
        near(s.early.lon, s.active.lon) &&
        near(s.early.lat, OSTRAVA.lat);
      scenarios.EARLY_BOOT_CONSISTENCY = ok ? "PASS" : "FAIL";
      if (!ok) fails.push("E_early:" + JSON.stringify({ early: s.early, active: s.active, resolve: s.resolve }));
      await context.close();
    }

    // SINGLE RESOLVED LOCATION — runtime: place/active/ensure share coords; static already requires shared GetActiveCity
    {
      const { context, page } = await boot(browser, {
        iu_location_mode: "manual",
        iu_manual_location: JSON.stringify({ lat: BRNO.lat, lon: BRNO.lon, label: BRNO.name }),
      });
      const s = await page.evaluate(async () => {
        const r = window.iuWeatherResolveLocation();
        const a = window.iuWeatherGetActiveCity();
        let st = null;
        try {
          if (typeof window.iuWeatherEnsureState === "function") st = await window.iuWeatherEnsureState();
        } catch (_) {}
        const place = (document.getElementById("iuWxPlace") || {}).textContent || "";
        const dailyPlace = (document.getElementById("iuDailyPlace") || document.getElementById("iuWxPlace") || {})
          .textContent || "";
        return {
          r,
          a,
          stCity: st && st.city ? st.city : null,
          stLat: st && st.lat,
          stLon: st && st.lon,
          place,
          dailyPlace,
        };
      });
      cases.push({ label: "SINGLE_RESOLVED", s });
      const ok =
        s.r &&
        s.a &&
        near(s.a.lat, BRNO.lat) &&
        (s.stLat == null || near(s.stLat, BRNO.lat)) &&
        (s.stLon == null || near(s.stLon, BRNO.lon));
      scenarios.SINGLE_RESOLVED_LOCATION = ok && scenarios.STATIC_SOURCE_CONTRACT === "PASS" ? "PASS" : "FAIL";
      if (!ok) fails.push("SINGLE:" + JSON.stringify(s));
      await context.close();
    }

    // CITY CHANGE MUST CHANGE DATA SOURCE
    {
      const { context, page, meteo } = await boot(browser, {
        iu_location_mode: "manual",
        iu_manual_location: JSON.stringify({ lat: PRAHA.lat, lon: PRAHA.lon, label: PRAHA.name }),
      });
      const before = await snap(page, "G_city_before");
      const beforeMeteo = meteo.slice();
      await page.evaluate((city) => {
        try {
          window.__iuWeatherRuntimeCity = null;
        } catch (_) {}
        try {
          window.__iuWeatherState = null;
        } catch (_) {}
        localStorage.setItem("iu_location_mode", "manual");
        localStorage.setItem(
          "iu_manual_location",
          JSON.stringify({ lat: city.lat, lon: city.lon, label: city.name })
        );
      }, BRNO);
      await page.evaluate(async () => {
        try {
          if (typeof window.iuWeatherEnsureState === "function") await window.iuWeatherEnsureState();
        } catch (_) {}
      });
      await page.waitForTimeout(1500);
      const after = await snap(page, "G_city_after");
      const afterMeteo = meteo.slice();
      const newMeteo = afterMeteo.filter((u) => beforeMeteo.indexOf(u) < 0);
      const dataMoved =
        after.active &&
        near(after.active.lat, BRNO.lat) &&
        before.active &&
        near(before.active.lat, PRAHA.lat) &&
        (meteoHasCoords(newMeteo, BRNO.lat, BRNO.lon) || meteoHasCoords(afterMeteo, BRNO.lat, BRNO.lon));
      scenarios.CITY_CHANGE_CHANGES_DATA_SOURCE = dataMoved ? "PASS" : "FAIL";
      if (!dataMoved) {
        fails.push(
          "G_city_change:" +
            JSON.stringify({
              before: before.active,
              after: after.active,
              newMeteo: newMeteo.slice(-2),
            })
        );
      }
      cases.push({ label: "G_city_change", before: before.active, after: after.active, newMeteo: newMeteo.slice(-3) });
      await context.close();
    }

    // GPS FAILURE MUST NOT CORRUPT MANUAL STATE
    {
      const { context, page } = await boot(
        browser,
        {
          iu_location_mode: "manual",
          iu_manual_location: JSON.stringify({ lat: BRNO.lat, lon: BRNO.lon, label: BRNO.name }),
        },
        { mockGeoFail: true }
      );
      const before = await snap(page, "H_before_fail");
      await page.evaluate(() => {
        try {
          window.iuWeatherActivateGpsViaGeolocation();
        } catch (_) {}
      });
      await page.waitForTimeout(800);
      const afterDenied = await snap(page, "H_after_denied");
      await context.close();

      const { context: c2, page: p2 } = await boot(
        browser,
        {
          iu_location_mode: "manual",
          iu_manual_location: JSON.stringify({ lat: BRNO.lat, lon: BRNO.lon, label: BRNO.name }),
        },
        { mockGeoTimeout: true }
      );
      await p2.evaluate(() => {
        try {
          window.iuWeatherActivateGpsViaGeolocation();
        } catch (_) {}
      });
      await p2.waitForTimeout(800);
      const afterTimeout = await snap(p2, "H_after_timeout");
      await c2.close();

      const { context: c3, page: p3 } = await boot(
        browser,
        {
          iu_location_mode: "manual",
          iu_manual_location: JSON.stringify({ lat: BRNO.lat, lon: BRNO.lon, label: BRNO.name }),
        },
        { mockGeoUnavailable: true }
      );
      await p3.evaluate(() => {
        try {
          window.iuWeatherActivateGpsViaGeolocation();
        } catch (_) {}
      });
      await p3.waitForTimeout(800);
      const afterUnavail = await snap(p3, "H_after_unavailable");
      await c3.close();

      function manualIntact(s) {
        return (
          s.mode === "manual" &&
          s.manObj &&
          near(s.manObj.lat, BRNO.lat) &&
          /brno/i.test(String(s.manObj.label || s.active && s.active.name || "")) &&
          !(s.gpsObj && near(s.gpsObj.lat, PRAHA.lat) && /praha/i.test(String(s.gpsObj.name || "")))
        );
      }
      const ok =
        manualIntact(before) &&
        manualIntact(afterDenied) &&
        manualIntact(afterTimeout) &&
        manualIntact(afterUnavail) &&
        afterDenied.resolve &&
        afterDenied.resolve.source === "manual";
      scenarios.GPS_FAILURE_DOES_NOT_CORRUPT_MANUAL_STATE = ok ? "PASS" : "FAIL";
      if (!ok) {
        fails.push(
          "H_gps_fail:" +
            JSON.stringify({
              before: { mode: before.mode, man: before.manObj, gps: before.gpsObj },
              denied: { mode: afterDenied.mode, man: afterDenied.manObj, gps: afterDenied.gpsObj },
              timeout: { mode: afterTimeout.mode, man: afterTimeout.manObj },
              unavail: { mode: afterUnavail.mode, man: afterUnavail.manObj },
            })
        );
      }
      cases.push(afterDenied, afterTimeout, afterUnavail);
    }

    // NO STALE LOCATION AFTER RESUME — stale Praha GPS + live geo Brno must refresh
    {
      const { context, page } = await boot(
        browser,
        {
          iu_location_mode: "gps",
          iuWeatherGpsSelectedV1: JSON.stringify({
            name: PRAHA.name,
            lat: PRAHA.lat,
            lon: PRAHA.lon,
            at: Date.now() - ((softStaleMs || 30 * 60 * 1000) + 120000),
          }),
        },
        { geolocation: { latitude: BRNO.lat, longitude: BRNO.lon } }
      );
      await page.waitForTimeout(2500);
      await page.evaluate(() => {
        try {
          if (typeof window.iuWeatherScheduleGpsRefreshIfNeeded === "function") {
            window.iuWeatherScheduleGpsRefreshIfNeeded("guard-resume");
          }
        } catch (_) {}
      });
      await page.waitForTimeout(2500);
      const s = await snap(page, "I_resume_refresh");
      cases.push(s);
      const leftPraha =
        s.gpsObj &&
        (near(s.gpsObj.lat, BRNO.lat) || (s.resolve && s.resolve.needsGpsRefresh === true));
      const notFreshPraha = !(s.resolve && s.resolve.needsGpsRefresh === false && near(s.resolve.city && s.resolve.city.lat, PRAHA.lat));
      const ok = leftPraha && notFreshPraha;
      scenarios.NO_STALE_LOCATION_AFTER_RESUME = ok ? "PASS" : "FAIL";
      if (!ok) fails.push("I_resume:" + JSON.stringify({ resolve: s.resolve, gps: s.gpsObj, reason: s.refreshReason }));
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  // Historical RC negative proofs — in-memory source mutation only
  function expectDetect(label, mutatedPipeline, mutatedIndex) {
    const nf = staticContract(mutatedPipeline, mutatedIndex, smokeYml);
    const detected = nf.length > 0;
    scenarios[label] = detected ? "DETECTED" : "MISS";
    if (!detected) fails.push("NEG_MISS:" + label);
    return nf;
  }

  const rc1 = pipeline.replace(
    "function iuWeatherGetActiveCity(){\n    const resolved = iuWeatherResolveLocation();\n    return resolved && resolved.city ? resolved.city : null;\n  }",
    "function iuWeatherGetActiveCity(){\n    const resolved = iuWeatherResolveLocation();\n    if (resolved && resolved.city) return resolved.city;\n    return IU_WEATHER_DEFAULT_CITY;\n  }"
  );
  expectDetect("HISTORICAL_RC1_NEGATIVE", rc1, indexHtml);

  const rc2 = pipeline.replace(/\bat\s*:\s*Date\.now\s*\(\s*\)\s*,/, "");
  expectDetect("HISTORICAL_RC2_NEGATIVE", rc2, indexHtml);

  const rc3 = indexHtml.replace('localStorage.getItem("iu_location_mode")', 'localStorage.getItem("iu_other")');
  expectDetect("HISTORICAL_RC3_NEGATIVE", pipeline, rc3);

  const silent = pipeline.replace(
    "return resolved && resolved.city ? resolved.city : null;",
    "return IU_WEATHER_DEFAULT_CITY;"
  );
  expectDetect("NEG_SILENT_PRAGUE", silent, indexHtml);

  const ignoreManual = pipeline.replace("if (mode === IU_WEATHER_MODE_MANUAL)", "if (false)");
  expectDetect("NEG_IGNORE_MANUAL_MODE", ignoreManual, indexHtml);

  const dropStale = pipeline.replace(
    extractFunction(pipeline, "iuWeatherGpsNeedsRefresh"),
    "function iuWeatherGpsNeedsRefresh(gps){ return false; }"
  );
  expectDetect("NEG_DROP_STALE_GPS_CHECK", dropStale, indexHtml);

  const earlyBypass = indexHtml.replace("if(mode===\"manual\"){", "if(false){");
  expectDetect("NEG_EARLY_BOOT_BYPASS", pipeline, earlyBypass);

  const allPos = [
    "NO_SILENT_PRAGUE_FALLBACK",
    "MANUAL_CITY_AUTHORITY",
    "GPS_MODE_AUTHORITY",
    "GPS_FRESHNESS",
    "EARLY_BOOT_CONSISTENCY",
    "CITY_CHANGE_CHANGES_DATA_SOURCE",
    "GPS_FAILURE_DOES_NOT_CORRUPT_MANUAL_STATE",
    "NO_STALE_LOCATION_AFTER_RESUME",
    "SINGLE_RESOLVED_LOCATION",
  ];
  const allNeg = [
    "HISTORICAL_RC1_NEGATIVE",
    "HISTORICAL_RC2_NEGATIVE",
    "HISTORICAL_RC3_NEGATIVE",
    "NEG_SILENT_PRAGUE",
    "NEG_IGNORE_MANUAL_MODE",
    "NEG_DROP_STALE_GPS_CHECK",
    "NEG_EARLY_BOOT_BYPASS",
  ];
  const posPass = allPos.every((k) => scenarios[k] === "PASS");
  const negPass = allNeg.every((k) => scenarios[k] === "DETECTED");
  const pass = fails.length === 0 && posPass && negPass && scenarios.STATIC_SOURCE_CONTRACT === "PASS";

  const report = { pass, fails, scenarios, softStaleMs, cases };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(OUT);
  allPos.forEach((k) => console.log(k + "=" + scenarios[k]));
  console.log("STATIC_SOURCE_CONTRACT=" + scenarios.STATIC_SOURCE_CONTRACT);
  allNeg.forEach((k) => console.log(k + "=" + scenarios[k]));
  console.log("PASS=" + pass + " fails=" + JSON.stringify(fails));
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
