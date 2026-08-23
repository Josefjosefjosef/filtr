#!/usr/bin/env node
/**
 * Regression guard: Silver weather line — temperature emphasis (.silver-weather-outside-temp).
 * Supports compact strip: numeric "X °C" / "—°C" in .silver-weather-outside-temp plus optional "Venku je " prefix sibling.
 * DOM + computed style + CLS/overflow/rail/console.
 *
 * Run: node scripts/proofs/weather_emphasis_guard.mjs
 */
import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const {
  installProofGuardNetworkStubs,
  isIgnorableGuardConsoleError,
} = require("./open_meteo_guard_stub.cjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const VIEWPORTS = [
  { w: 390, h: 844 },
  { w: 768, h: 1024 },
  { w: 1366, h: 768 }
];

function mime(p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

/** Strip CSP meta so Playwright page.evaluate / waitForFunction work locally (matches TEMP proof pattern). */
function stripCspFromHtml(buf) {
  const s = buf.toString("utf8");
  const stripped = s.replace(/<meta\s[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/gi, "");
  return Buffer.from(stripped, "utf8");
}

function startStaticServer() {
  const rootResolved = path.resolve(ROOT);
  const server = http.createServer(async (req, res) => {
    try {
      let u = (req.url || "/").split("?")[0];
      if (u === "/" || u === "") u = "/projects/index.html";
      let rel = decodeURIComponent(u.replace(/^\//, "")).replace(/\\/g, "/");
      if (rel.endsWith("/")) rel += "index.html";
      const fp = path.resolve(rootResolved, rel);
      const relToRoot = path.relative(rootResolved, fp);
      if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
        res.statusCode = 403;
        res.end();
        return;
      }
      let buf = await fs.readFile(fp);
      if (/\.html?$/i.test(fp)) buf = stripCspFromHtml(buf);
      res.setHeader("Content-Type", mime(fp));
      res.statusCode = 200;
      res.end(buf);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port, base: "http://127.0.0.1:" + addr.port });
    });
    server.on("error", reject);
  });
}

const WEATHER_GUARD_LAT = 50.0755;
const WEATHER_GUARD_LON = 14.4378;
const WEATHER_GUARD_LABEL = "Praha";

function buildEarlyWxCachePayload() {
  const now = Date.now();
  const pad2 = (n) => String(n).padStart(2, "0");
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
  for (let i = 1; i <= 48; i++) {
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
  return {
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
}

async function armWeatherGuardSeed(context) {
  const payload = buildEarlyWxCachePayload();
  await context.addInitScript(
    ({ lat, lon, label, cachePayload }) => {
      try {
        localStorage.setItem("iu_location_mode", "manual");
        localStorage.setItem(
          "iu_manual_location",
          JSON.stringify({ lat, lon, label })
        );
        localStorage.setItem(
          "iuEarlyWxCacheV1",
          JSON.stringify({
            lat,
            lon,
            at: Date.now(),
            data: cachePayload,
          })
        );
      } catch (_) {}
    },
    {
      lat: WEATHER_GUARD_LAT,
      lon: WEATHER_GUARD_LON,
      label: WEATHER_GUARD_LABEL,
      cachePayload: payload,
    }
  );
}

async function waitForDeferredAppCss(page) {
  await page.waitForFunction(
    () => {
      const link = document.querySelector('link[data-iu-defer-app-css="1"]');
      if (!link) return false;
      if (link.dataset && link.dataset.iuDeferReady === "1") return true;
      try {
        return !!(link.sheet && link.media === "all");
      } catch (_) {
        return false;
      }
    },
    { timeout: 30000 }
  );
  try {
    await page.evaluate(async () => {
      try {
        await document.fonts.ready;
      } catch (_) {}
    });
  } catch (_) {}
}

function silverWeatherDataLineReady() {
  const el = document.getElementById("iuSilverWeatherLine1");
  const card = document.getElementById("iuSilverWeatherCard");
  if (!el || !card) return false;
  const lineTxt = String(el.textContent || "");
  const emph = el.querySelector(".silver-weather-outside-temp");
  const emphTxt = emph ? String(emph.textContent || "").trim() : "";
  if (/Venku\s+je/i.test(lineTxt)) return true;
  if (card.getAttribute("data-iu-silver-wx-phase") === "data" && /^-?\d+\s*°C$/.test(emphTxt)) {
    return true;
  }
  return false;
}

async function waitForSilverWeatherDataLine(page) {
  await page.waitForFunction(silverWeatherDataLineReady, null, { timeout: 45000 });
}

async function forceSilverWeatherDataRefresh(page) {
  await page.evaluate(
    ({ lat, lon }) => {
      try {
        localStorage.setItem("iu_location_mode", "manual");
        localStorage.setItem(
          "iu_manual_location",
          JSON.stringify({ lat, lon, label: "Praha" })
        );
        try {
          delete window.__iuWeatherRuntimeCity;
        } catch (_) {
          window.__iuWeatherRuntimeCity = null;
        }
      } catch (_) {}
      window.__iuWeatherState = {
        lat,
        lon,
        current: {
          temperatureC: 3,
          feelsLikeC: 1,
          weatherCode: 3,
          isDay: true,
        },
        nextHours: [],
        rawDaily: null,
      };
      if (typeof window.iuSilverWeatherRefresh === "function") {
        window.iuSilverWeatherRefresh();
      }
      try {
        window.dispatchEvent(new Event("iu-silver-wx-refresh"));
      } catch (_) {}
    },
    { lat: WEATHER_GUARD_LAT, lon: WEATHER_GUARD_LON }
  );
}

async function waitForLayoutSettle(page) {
  await page
    .waitForFunction(
      () => typeof window.iuMobileLayoutReorder === "function",
      null,
      { timeout: 30000 }
    )
    .catch(() => {});
  await page
    .evaluate(() => {
      try {
        if (typeof window.iuMobileLayoutReorder === "function") {
          window.iuMobileLayoutReorder();
        }
      } catch (_) {}
    })
    .catch(() => {});
  await page.waitForTimeout(180);
}

async function installClsHarness(page) {
  await page.evaluate(async () => {
    try {
      await document.fonts.ready;
    } catch {}
    try {
      if (window.__iuClsPO) window.__iuClsPO.disconnect();
    } catch {}
    window.__iuClsSum = 0;
    window.__iuClsPO = new PerformanceObserver(function (list) {
      const entries = list.getEntries();
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e.hadRecentInput) window.__iuClsSum = (window.__iuClsSum || 0) + e.value;
      }
    });
    window.__iuClsPO.observe({ type: "layout-shift", buffered: false });
  });
  await page.waitForTimeout(200);
}

async function snapMetrics(page) {
  const overflowX = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth > el.clientWidth + 1;
  });
  const railShift = await page.evaluate(() =>
    typeof window.__iuRailShiftProbe === "number" ? window.__iuRailShiftProbe : 0
  );
  const clsSum = await page.evaluate(() => Number(window.__iuClsSum || 0));
  return { overflowX, railShift, clsSum };
}

function fail(msg) {
  console.error("[WEATHER_EMPHASIS_GUARD FAIL]", msg);
  process.exit(1);
}

async function main() {
  const { server, base } = await startStaticServer();
  const browser = await chromium.launch({ headless: true });

  const aggregate = { cls: [], overflowX: [], railShift: [], consoleErrors: 0 };

  try {
    for (const vp of VIEWPORTS) {
      const consoleErrors = [];
      const context = await browser.newContext({
        viewport: { width: vp.w, height: vp.h },
        serviceWorkers: "block"
      });
      const page = await context.newPage();
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const t = msg.text();
          if (!isIgnorableGuardConsoleError(t)) consoleErrors.push(t);
        }
      });
      page.on("pageerror", (err) => {
        const t = String(err && err.message ? err.message : err);
        if (!isIgnorableGuardConsoleError(t)) consoleErrors.push(t);
      });

      await installProofGuardNetworkStubs(page);

      await armWeatherGuardSeed(context);

      await page.goto(base + "/projects/", { waitUntil: "load", timeout: 120000 });
      await waitForDeferredAppCss(page);
      await page.waitForFunction(() => typeof window.iuSilverWeatherRefresh === "function", null, {
        timeout: 120000
      });
      await waitForLayoutSettle(page);
      await installClsHarness(page);
      await page.evaluate(() => {
        window.__iuClsSum = 0;
      });

      await forceSilverWeatherDataRefresh(page);
      await waitForSilverWeatherDataLine(page);

      /* Po stabilním „Venku je …“ vynulovat CLS: měří jen posuny po finálním paintu (grid / řádky Silver). */
      await page.waitForTimeout(120);
      await page.evaluate(() => {
        try {
          window.__iuClsSum = 0;
        } catch {}
      });

      const check = await page.evaluate(() => {
        function parseRgb(cssColor) {
          const s = String(cssColor || "").trim();
          let m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
          if (m) return { r: +m[1], g: +m[2], b: +m[3] };
          m = s.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/i);
          if (m) return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255 };
          return null;
        }

        /** Sky / blue emphasis: blue channel dominant vs gray (r≈g≈b). */
        function isBlueSpectrum(rgb) {
          if (!rgb) return false;
          const { r, g, b } = rgb;
          const maxc = Math.max(r, g, b);
          const minc = Math.min(r, g, b);
          const chroma = maxc - minc;
          if (chroma < 6) return false;
          return b >= maxc - 3 && b >= r && b >= g && (b > r || b > g);
        }

        const line1 = document.getElementById("iuSilverWeatherLine1");
        const emph = line1 ? line1.querySelector(".silver-weather-outside-temp") : null;
        const icon = line1 ? line1.querySelector(".silver-weather-dpart") : null;
        const feels = line1 ? line1.querySelector('[data-iu-silver-weather-hook="feels"]') : null;
        const status = line1 ? line1.querySelector('[data-iu-silver-weather-hook="status"]') : null;

        const kids = line1 ? Array.from(line1.children) : [];
        const firstIsIcon =
          kids.length > 0 &&
          kids[0].classList &&
          kids[0].classList.contains("silver-weather-dpart");

        const txt = emph ? String(emph.textContent || "").trim() : "";
        const lineTxt = line1 ? String(line1.textContent || "").trim() : "";
        const venkuOk =
          /Venku\s+je\s+-?\d+\s*°C/i.test(txt) || /Venku\s+je\s+-?\d+\s*°C/i.test(lineTxt);
        const compactTempOk = /^-?\d+\s*°C$/.test(txt) || txt === "—°C";
        const tempOk = venkuOk || compactTempOk;
        const noLeak =
          !/Pocitově/i.test(txt) &&
          !/Oblačno/i.test(txt) &&
          !/\|\s*$/.test(txt) &&
          txt.indexOf("|") === -1 &&
          emph &&
          emph.querySelector("*") === null;

        const iconInEmph = !!(icon && emph && emph.contains(icon));
        const feelsInEmph = !!(feels && emph && emph.contains(feels));
        const statusInEmph = !!(status && emph && emph.contains(status));

        const cs = emph ? window.getComputedStyle(emph) : null;
        const line1Display = line1 ? String(window.getComputedStyle(line1).display || "") : "";
        const lineAnchor =
          line1 && line1Display === "contents"
            ? line1.closest("#iuSilverWeatherCard") || line1.parentElement
            : line1;
        const lineCS = lineAnchor ? window.getComputedStyle(lineAnchor) : null;
        const feelsCS = feels ? window.getComputedStyle(feels) : null;

        const wEm = cs ? parseFloat(cs.fontWeight) || 0 : 0;
        const wFeels = feelsCS ? parseFloat(feelsCS.fontWeight) || 0 : 0;

        const rgbEm = cs ? parseRgb(cs.color) : null;
        const rgbLine = lineCS ? parseRgb(lineCS.color) : null;

        const colorDiffFromLine = !!(cs && lineCS && cs.color !== lineCS.color);
        const blueOk = isBlueSpectrum(rgbEm);

        return {
          line1Exists: !!line1,
          emphExists: !!emph,
          venkuOk,
          compactTempOk,
          tempOk,
          firstIsIcon,
          noLeak,
          iconInEmph,
          feelsInEmph,
          statusInEmph,
          emphBoldVsFeels: wEm > wFeels || wEm >= 600,
          colorDiffFromLine,
          blueOk,
          wEm,
          wFeels
        };
      });

      const m = await snapMetrics(page);
      aggregate.cls.push(m.clsSum);
      aggregate.overflowX.push(m.overflowX);
      aggregate.railShift.push(m.railShift);
      aggregate.consoleErrors += consoleErrors.length;

      const ok =
        check.line1Exists &&
        check.emphExists &&
        check.tempOk &&
        check.firstIsIcon &&
        check.noLeak &&
        !check.iconInEmph &&
        !check.feelsInEmph &&
        !check.statusInEmph &&
        check.emphBoldVsFeels &&
        check.colorDiffFromLine &&
        check.blueOk &&
        m.clsSum === 0 &&
        !m.overflowX &&
        m.railShift === 0 &&
        consoleErrors.length === 0;

      if (!ok) {
        console.error(
          JSON.stringify(
            {
              viewport: `${vp.w}x${vp.h}`,
              check,
              cls: m.clsSum,
              overflowX: m.overflowX,
              railShift: m.railShift,
              consoleErrorsCount: consoleErrors.length
            },
            null,
            2
          )
        );
        fail(`viewport ${vp.w}x${vp.h}`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(
    JSON.stringify({
      WEATHER_EMPHASIS_GUARD: "PASS",
      viewports: VIEWPORTS.map((v) => `${v.w}x${v.h}`),
      clsAll: aggregate.cls,
      overflowXAll: aggregate.overflowX,
      railShiftAll: aggregate.railShift,
      consoleErrorsTotal: aggregate.consoleErrors
    })
  );
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
