"use strict";

/**
 * Proof-only Open-Meteo stub for Playwright guards hitting production origin.
 * Avoids flaky CORS / network console errors when Silver weather enters loading state.
 */
function buildGuardOpenMeteoMockBody() {
  const pad2 = (n) => String(n).padStart(2, "0");
  const now = Date.now();
  const hourlyN = 48;
  const hourly = {
    time: [],
    temperature_2m: [],
    apparent_temperature: [],
    weather_code: [],
    precipitation_probability: [],
    precipitation: [],
    wind_speed_10m: [],
    wind_gusts_10m: [],
    wind_direction_10m: [],
    pressure_msl: [],
    relative_humidity_2m: [],
    visibility: [],
    uv_index: [],
    is_day: [],
  };
  for (let i = 1; i <= hourlyN; i++) {
    const t = new Date(now + i * 3600000);
    hourly.time.push(t.toISOString());
    hourly.temperature_2m.push(3);
    hourly.apparent_temperature.push(1);
    hourly.weather_code.push(3);
    hourly.precipitation_probability.push(10);
    hourly.precipitation.push(0);
    hourly.wind_speed_10m.push(12);
    hourly.wind_gusts_10m.push(18);
    hourly.wind_direction_10m.push(200);
    hourly.pressure_msl.push(1013);
    hourly.relative_humidity_2m.push(72);
    hourly.visibility.push(10000);
    hourly.uv_index.push(1);
    hourly.is_day.push(1);
  }
  const daily = {
    time: [],
    temperature_2m_max: [],
    temperature_2m_min: [],
    weather_code: [],
    uv_index_max: [],
    sunrise: [],
    sunset: [],
  };
  for (let d = 0; d < 7; d++) {
    const x = new Date(now + d * 86400000);
    const y = x.getUTCFullYear();
    const m = pad2(x.getUTCMonth() + 1);
    const day = pad2(x.getUTCDate());
    const ds = `${y}-${m}-${day}`;
    daily.time.push(ds);
    daily.temperature_2m_max.push(5);
    daily.temperature_2m_min.push(1);
    daily.weather_code.push(3);
    daily.uv_index_max.push(2);
    daily.sunrise.push(`${ds}T05:00`);
    daily.sunset.push(`${ds}T19:00`);
  }
  const payload = {
    current: {
      time: new Date(now).toISOString(),
      temperature_2m: 3,
      apparent_temperature: 1,
      weather_code: 3,
      is_day: 1,
      wind_speed_10m: 12,
      wind_gusts_10m: 18,
      wind_direction_10m: 200,
      pressure_msl: 1013,
      relative_humidity_2m: 72,
      visibility: 10000,
    },
    hourly,
    daily,
  };
  return JSON.stringify(payload);
}

async function installOpenMeteoStubRoute(page) {
  await page.route(/^https:\/\/api\.open-meteo\.com\/v1\/forecast/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: buildGuardOpenMeteoMockBody(),
    });
  });
}

/** 1×1 GIF — proof-only; stale YouTube thumb 404s are not layout/UI signal. */
const TINY_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

async function installYtimgThumbnailStubRoute(page) {
  await page.route(/^https:\/\/i\.ytimg\.com\//, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/gif",
      body: TINY_GIF,
    });
  });
}

async function installProofGuardNetworkStubs(page) {
  await installOpenMeteoStubRoute(page);
  await installYtimgThumbnailStubRoute(page);
}

/** Align with smoke.mjs — ignore known third-party resource noise in guards. */
function isIgnorableGuardConsoleError(text) {
  const s = String(text || "");
  if (!s) return true;
  if (/\/favicon\.ico/i.test(s)) return true;
  if (/i\.ytimg\.com|thumbnail/i.test(s)) return true;
  if (/Failed to load resource/i.test(s) && /ytimg|favicon|open-meteo/i.test(s)) return true;
  return false;
}

module.exports = {
  buildGuardOpenMeteoMockBody,
  installOpenMeteoStubRoute,
  installYtimgThumbnailStubRoute,
  installProofGuardNetworkStubs,
  isIgnorableGuardConsoleError,
};
