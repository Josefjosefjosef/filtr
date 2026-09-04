#!/usr/bin/env node
"use strict";
/**
 * Weather offline → online recovery guard.
 * Proves: failed network weather fetch → reconnect → auto re-fetch → UI/state update
 * and selected location fingerprint is unchanged (no silent Praha reset).
 */
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { createRequire } = require("module");
const http = require("http");
const REPO = path.resolve(__dirname, "..");
const req = createRequire(path.join(REPO, "package.json"));
const { chromium } = req("playwright");
const OUT = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "iu_weather_offline_online_recovery_guard.json");
const PORT = 8847;
const PIPELINE_REL = "assets/iu-app-feed-pipeline-v1.js";
const SMOKE_REL = path.join(".github", "workflows", "smoke.yml");

const BRNO = { lat: 49.1951, lon: 16.6068, name: "Brno" };

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

function staticContract(pipeline, smokeYml) {
  const fails = [];
  const reconnect = extractFunction(pipeline, "iuWeatherOnNetworkReconnect");
  const prepare = extractFunction(pipeline, "iuWeatherPrepareLiveRetryAfterReconnect");
  const needs = extractFunction(pipeline, "iuWeatherNeedsNetworkRecovery");
  if (!reconnect) fails.push("static_missing_OnNetworkReconnect");
  else {
    if (reconnect.indexOf("iuWeatherPrepareLiveRetryAfterReconnect") < 0) fails.push("static_reconnect_no_prepare");
    if (reconnect.indexOf("iuWeatherEnsureState") < 0) fails.push("static_reconnect_no_ensure");
    if (reconnect.indexOf("iuWeatherRefreshUiAfterReconnect") < 0) fails.push("static_reconnect_no_ui_refresh");
    if (reconnect.indexOf("__iuWeatherReconnectInFlight") < 0) fails.push("static_reconnect_no_single_flight");
    if (reconnect.indexOf("iuWeatherLocationFingerprint") < 0) fails.push("static_reconnect_no_location_fingerprint");
  }
  if (!prepare) fails.push("static_missing_PrepareLiveRetry");
  else {
    if (prepare.indexOf("iuWeatherClearOpenMeteoCache") < 0) fails.push("static_prepare_no_clear_cache");
    if (prepare.indexOf("iuWeatherClearLiveBackoffOnSuccess") < 0) fails.push("static_prepare_no_clear_backoff");
  }
  if (!needs) fails.push("static_missing_NeedsNetworkRecovery");
  if (pipeline.indexOf("iuWeatherOnNetworkReconnect") < 0) fails.push("static_export_missing");
  if (pipeline.indexOf('reason: "network"') < 0 && pipeline.indexOf("reason: \"network\"") < 0) {
    if (pipeline.indexOf('reason: "network"') < 0 && pipeline.indexOf("reason: 'network'") < 0) {
      fails.push("static_network_reconnect_not_wired");
    }
  }
  if (pipeline.indexOf('iuNetworkControlledReconnect') >= 0) {
    const idx = pipeline.indexOf("function iuNetworkControlledReconnect");
    const slice = idx >= 0 ? pipeline.slice(idx, idx + 1200) : "";
    if (slice && slice.indexOf("iuWeatherOnNetworkReconnect") < 0) {
      fails.push("static_iuNetworkControlledReconnect_missing_weather_hook");
    }
  } else if (pipeline.indexOf("iuWeatherOnNetworkReconnect({ reason: \"network\" })") < 0 &&
             pipeline.indexOf("iuWeatherOnNetworkReconnect({ reason: 'network' })") < 0) {
    fails.push("static_network_callback_missing_weather_hook");
  }
  if (pipeline.indexOf('reason: "visibility"') < 0 && pipeline.indexOf("reason: 'visibility'") < 0) {
    fails.push("static_visibility_reconnect_missing");
  }
  if (String(smokeYml || "").indexOf("iu-weather-offline-online-recovery-guard") < 0) {
    fails.push("static_smoke_yml_missing_guard");
  }
  return fails;
}

function openMeteoFixture(lat, lon) {
  const times = [];
  const temps = [];
  const codes = [];
  const now = new Date();
  now.setMinutes(0, 0, 0);
  for (let i = 0; i < 48; i++) {
    const t = new Date(now.getTime() + i * 3600 * 1000);
    times.push(t.toISOString().slice(0, 13) + ":00");
    temps.push(18 + (i % 5));
    codes.push(1);
  }
  const dailyTimes = [];
  const tmax = [];
  const tmin = [];
  const dcode = [];
  for (let d = 0; d < 7; d++) {
    const day = new Date(now.getTime() + d * 86400000);
    dailyTimes.push(day.toISOString().slice(0, 10));
    tmax.push(22);
    tmin.push(12);
    dcode.push(1);
  }
  return {
    latitude: lat,
    longitude: lon,
    current: {
      time: times[0],
      temperature_2m: 19.5,
      apparent_temperature: 18.2,
      weather_code: 1,
      is_day: 1,
      wind_speed_10m: 12,
      wind_gusts_10m: 20,
      wind_direction_10m: 180,
      pressure_msl: 1013,
      relative_humidity_2m: 55,
      visibility: 10000,
    },
    hourly: {
      time: times,
      temperature_2m: temps,
      apparent_temperature: temps,
      weather_code: codes,
      is_day: times.map((_, i) => (i % 24 < 18 ? 1 : 0)),
      precipitation_probability: temps.map(() => 10),
      precipitation: temps.map(() => 0),
      wind_speed_10m: temps.map(() => 10),
      wind_gusts_10m: temps.map(() => 15),
      wind_direction_10m: temps.map(() => 180),
      pressure_msl: temps.map(() => 1012),
      relative_humidity_2m: temps.map(() => 50),
      visibility: temps.map(() => 10000),
      uv_index: temps.map(() => 3),
    },
    daily: {
      time: dailyTimes,
      temperature_2m_max: tmax,
      temperature_2m_min: tmin,
      weather_code: dcode,
      uv_index_max: tmax.map(() => 4),
      sunrise: dailyTimes.map((d) => d + "T05:30"),
      sunset: dailyTimes.map((d) => d + "T19:30"),
    },
  };
}

function waitHttp(port, ms) {
  const deadline = Date.now() + ms;
  return (async function loop() {
    while (Date.now() < deadline) {
      try {
        await new Promise((resolve, reject) => {
          const reqHttp = http.get({ host: "127.0.0.1", port: port, path: "/projects/", timeout: 1500 }, (res) => {
            res.resume();
            if (res.statusCode && res.statusCode < 500) resolve();
            else reject(new Error("bad status"));
          });
          reqHttp.on("error", reject);
          reqHttp.on("timeout", () => {
            try {
              reqHttp.destroy();
            } catch (_) {}
            reject(new Error("timeout"));
          });
        });
        return;
      } catch (_) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw new Error("server not up");
  })();
}

async function startServer() {
  const script = path.join(REPO, "server", "projects-static.mjs");
  const child = spawn(process.execPath, [script], {
    cwd: REPO,
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, PORT: String(PORT) },
    shell: false,
  });
  let serverErr = "";
  child.stderr.on("data", (c) => {
    serverErr += String(c);
  });
  child.on("exit", (code) => {
    if (code && code !== 0 && !serverErr) serverErr = "static server exit " + code;
  });
  try {
    await waitHttp(PORT, 90000);
  } catch (err) {
    if (serverErr) console.error(String(serverErr).trim());
    try {
      child.kill("SIGTERM");
    } catch (_) {}
    throw err;
  }
  return child;
}

async function runtimeProof() {
  const fails = [];
  let child = null;
  let browser = null;
  try {
    child = await startServer();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    let blockMeteo = true;
    let meteoHitsWhileBlocked = 0;
    let meteoHitsAfter = 0;

    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (/api\.open-meteo\.com/i.test(url)) {
        if (blockMeteo) {
          meteoHitsWhileBlocked += 1;
          await route.abort("failed");
          return;
        }
        meteoHitsAfter += 1;
        const u = new URL(url);
        const lat = Number(u.searchParams.get("latitude") || BRNO.lat);
        const lon = Number(u.searchParams.get("longitude") || BRNO.lon);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(openMeteoFixture(lat, lon)),
        });
        return;
      }
      await route.continue();
    });

    await page.addInitScript((city) => {
      try {
        localStorage.setItem("iu_location_mode", "manual");
        localStorage.setItem(
          "iu_manual_location",
          JSON.stringify({ lat: city.lat, lon: city.lon, label: city.name, name: city.name })
        );
        localStorage.setItem("iu:consent:layer:dismissed:v1", "1");
        localStorage.setItem("iu:consent:analytics:v1", "denied");
      } catch (_) {}
    }, BRNO);

    await page.goto("http://127.0.0.1:" + PORT + "/projects/?iu_wx_reconnect_guard=1", {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.waitForFunction(() => typeof window.iuWeatherOnNetworkReconnect === "function", null, {
      timeout: 90000,
    });

    /* Re-assert manual city after vault/boot may briefly race location keys. */
    await page.evaluate((city) => {
      try {
        localStorage.setItem("iu_location_mode", "manual");
        localStorage.setItem(
          "iu_manual_location",
          JSON.stringify({ lat: city.lat, lon: city.lon, label: city.name, name: city.name })
        );
        try {
          window.__iuWeatherState = null;
        } catch (_) {}
        try {
          window.__iuWeatherRuntimeCity = null;
        } catch (_) {}
      } catch (_) {}
    }, BRNO);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => typeof window.iuWeatherOnNetworkReconnect === "function", null, {
      timeout: 90000,
    });
    await page.evaluate((city) => {
      try {
        localStorage.setItem("iu_location_mode", "manual");
        localStorage.setItem(
          "iu_manual_location",
          JSON.stringify({ lat: city.lat, lon: city.lon, label: city.name, name: city.name })
        );
      } catch (_) {}
    }, BRNO);

    const before = await page.evaluate(() => {
      if (typeof window.iuWeatherLocationFingerprint === "function") return window.iuWeatherLocationFingerprint();
      return null;
    });
    if (!before || before.mode !== "manual" || Math.abs(Number(before.lat) - BRNO.lat) > 0.01) {
      fails.push("runtime_before_location_not_brno:" + JSON.stringify(before));
    }

    await page.evaluate(async () => {
      try {
        if (typeof window.iuWeatherClearOpenMeteoCache === "function") window.iuWeatherClearOpenMeteoCache();
      } catch (_) {}
      try {
        window.__iuWeatherState = null;
      } catch (_) {}
      try {
        window.__iuWeatherEnsurePromisesByKey = {};
      } catch (_) {}
      try {
        if (typeof window.iuWeatherEnsureState === "function") await window.iuWeatherEnsureState();
      } catch (_) {}
      try {
        if (typeof window.iuSilverWeatherRefresh === "function") window.iuSilverWeatherRefresh();
      } catch (_) {}
      try {
        if (typeof window.iuWeatherLoadAndRender === "function") await window.iuWeatherLoadAndRender();
      } catch (_) {}
    });

    const mid = await page.evaluate(() => {
      const st = window.__iuWeatherState;
      const hasReal =
        st &&
        st.current &&
        typeof st.current.temperatureC === "number" &&
        Array.isArray(st.nextHours) &&
        st.nextHours.length >= 6;
      const err = document.getElementById("iuDailyErr");
      return {
        hasReal: !!hasReal,
        errVisible: !!(err && !err.hidden),
        needs: typeof window.iuWeatherNeedsNetworkRecovery === "function" ? window.iuWeatherNeedsNetworkRecovery() : null,
      };
    });
    if (mid.hasReal) fails.push("runtime_expected_failed_state_still_has_real_data");

    blockMeteo = false;
    const result = await page.evaluate(async () => {
      const r = await window.iuWeatherOnNetworkReconnect({ reason: "network", force: true, maxAttempts: 3 });
      const st = window.__iuWeatherState;
      const hasReal =
        !!(st &&
          st.current &&
          typeof st.current.temperatureC === "number" &&
          Array.isArray(st.nextHours) &&
          st.nextHours.length >= 6);
      const after =
        typeof window.iuWeatherLocationFingerprint === "function" ? window.iuWeatherLocationFingerprint() : null;
      return { r: r || null, hasReal: hasReal, after: after };
    });

    if (!result.r || result.r.ok !== true) fails.push("runtime_reconnect_not_ok:" + JSON.stringify(result.r));
    if (!result.hasReal) fails.push("runtime_no_real_data_after_reconnect");
    if (!result.after || result.after.mode !== "manual") fails.push("runtime_mode_changed");
    if (!result.after || Math.abs(Number(result.after.lat) - BRNO.lat) > 0.01) fails.push("runtime_lat_reset");
    if (!result.after || Math.abs(Number(result.after.lon) - BRNO.lon) > 0.01) fails.push("runtime_lon_reset");
    if (result.r && result.r.locationStable === false) fails.push("runtime_location_unstable_flag");
    if (meteoHitsAfter < 1) fails.push("runtime_no_meteo_request_after_online");

    /* Dedup: second reconnect while healthy should single-flight / skip spam */
    const hitsBeforeDedup = meteoHitsAfter;
    const r2 = await page.evaluate(async () => {
      const a = window.iuWeatherOnNetworkReconnect({ reason: "network", force: true });
      const b = window.iuWeatherOnNetworkReconnect({ reason: "network", force: true });
      const same = a === b;
      await Promise.all([a, b]);
      return { same: same };
    });
    if (!r2.same) fails.push("runtime_reconnect_not_single_flight");

    return {
      fails: fails,
      meteoHitsWhileBlocked: meteoHitsWhileBlocked,
      meteoHitsAfter: meteoHitsAfter,
      hitsBeforeDedup: hitsBeforeDedup,
      before: before,
      mid: mid,
      result: result,
    };
  } finally {
    try {
      if (browser) await browser.close();
    } catch (_) {}
    try {
      if (child) child.kill("SIGTERM");
    } catch (_) {}
  }
}

(async function main() {
  const pipeline = readRepo(PIPELINE_REL);
  const smokeYml = readRepo(SMOKE_REL);
  const staticFails = staticContract(pipeline, smokeYml);
  let runtime = { fails: ["runtime_not_run"] };
  try {
    runtime = await runtimeProof();
  } catch (e) {
    runtime = { fails: ["runtime_throw:" + String((e && e.message) || e)] };
  }
  const fails = staticFails.concat(runtime.fails || []);
  const report = {
    IU_WEATHER_OFFLINE_ONLINE_RECOVERY_GUARD: fails.length ? "FAIL" : "PASS",
    fails: fails,
    staticFails: staticFails,
    runtime: runtime,
  };
  try {
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
  } catch (_) {}
  console.log(JSON.stringify(report));
  if (fails.length) {
    console.error("IU_WEATHER_OFFLINE_ONLINE_RECOVERY_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_WEATHER_OFFLINE_ONLINE_RECOVERY_GUARD_PASS");
})().catch((e) => {
  console.error(String((e && e.stack) || e));
  process.exit(1);
});
