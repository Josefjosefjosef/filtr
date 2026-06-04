#!/usr/bin/env node
/**
 * Guard: weather must not ship as "loaded" with placeholder —°C / empty hourly / empty 7-day.
 * Static: app.js contract. Browser: Počasí section after stubbed Open-Meteo with real-shaped payload.
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const {
  installProofGuardNetworkStubs,
  installOpenMeteoRejectRoute,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const appJs = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

const staticChecks = [
  ["iuOpenMeteoPayloadIsValid", /function\s+iuOpenMeteoPayloadIsValid\s*\(/],
  ["iuWeatherStateHasRealData", /function\s+iuWeatherStateHasRealData\s*\(/],
  ["iuWeatherDomShowsPlaceholder", /function\s+iuWeatherDomShowsPlaceholder\s*\(/],
  ["iuWeatherSnapshotPayloadIsValid", /function\s+iuWeatherSnapshotPayloadIsValid\s*\(/],
  ["iuWeatherLiveBackoffActive", /function\s+iuWeatherLiveBackoffActive\s*\(/],
  ["iuWeatherPersistState", /function\s+iuWeatherPersistState\s*\(/],
  ["iuWeatherReadPersistedState", /function\s+iuWeatherReadPersistedState\s*\(/],
  ["open_meteo_unusable", /open_meteo_unusable/],
  ["weather_dom_placeholder", /weather_dom_placeholder/],
  ["fallback noModels", /noModels:\s*true/],
  ["do not cache invalid", /iuOpenMeteoPayloadIsValid\(cached\.data\)/],
  ["snapshot before live refresh", /iuWeatherBuildStateFromSnapshot/],
  ["backoff failed marker", /failed:\s*true/],
];

let staticFail = 0;
for (const [label, re] of staticChecks) {
  if (!re.test(appJs)) {
    console.error("STATIC_FAIL:" + label);
    staticFail++;
  }
}
if (staticFail) process.exit(1);
console.log("STATIC_PASS:" + (staticChecks.length - staticFail) + "/" + staticChecks.length);

function mime(p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function stripCspFromHtml(buf) {
  const s = buf.toString("utf8");
  return Buffer.from(s.replace(/<meta\s[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/gi, ""), "utf8");
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
      let buf = fs.readFileSync(fp);
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
      resolve({
        server,
        close: () => new Promise((r) => server.close(() => r())),
        base: "http://127.0.0.1:" + addr.port,
      });
    });
    server.on("error", reject);
  });
}

async function runBrowserProof(base) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    if (isIgnorableGuardConsoleError(t)) return;
    consoleErrors.push(t);
  });
  await installProofGuardNetworkStubs(page);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("iu_location_mode", "manual");
      localStorage.setItem(
        "iu_manual_location",
        JSON.stringify({ lat: 50.0755, lon: 14.4378, label: "Praha" })
      );
    } catch {}
  });
  await page.goto(base + "/projects/index.html?section=pocasi", { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof window.iuWeatherLoadAndRender === "function", { timeout: 120000 });
  const loadErr = await page.evaluate(async () => {
    try {
      await window.iuWeatherLoadAndRender();
      return "";
    } catch (e) {
      return String(e && e.message ? e.message : e);
    }
  });
  if (loadErr) {
    console.error("BROWSER_LOAD_ERR:" + loadErr);
    process.exit(1);
  }
  let waitOk = false;
  try {
    await page.waitForFunction(
      () => {
        const temp = document.getElementById("iuWxTemp");
        const t = temp ? String(temp.textContent || "").trim() : "";
        if (!t || t === "—°C" || /—/.test(t)) return false;
        const hours = document.getElementById("iuWxHours");
        if (!hours) return false;
        const ht = hours.querySelectorAll(".iuWxHourTemp");
        if (ht.length < 6) return false;
        for (let i = 0; i < ht.length; i++) {
          const v = String(ht[i].textContent || "").trim();
          if (v === "—" || v === "") return false;
        }
        const d7 = document.getElementById("iuWx7Day");
        if (!d7) return false;
        const rows = d7.querySelectorAll(".iuWx7Row");
        if (rows.length < 7) return false;
        let ok = 0;
        for (let r = 0; r < rows.length; r++) {
          const temps = rows[r].querySelector(".iuWx7Temps");
          const tx = temps ? String(temps.textContent || "").trim() : "";
          if (tx && !/—\s*\/\s*—/.test(tx)) ok++;
        }
        return ok >= 7;
      },
      { timeout: 45000 }
    );
    waitOk = true;
  } catch (_) {
    const diag = await page.evaluate(() => {
      const temp = document.getElementById("iuWxTemp");
      const err = document.getElementById("iuDailyErr");
      const wx = document.getElementById("iuDailyWeather");
      return {
        temp: temp ? String(temp.textContent || "").trim() : "MISSING",
        errHidden: err ? err.hidden : null,
        wxHidden: wx ? wx.hidden : null,
        hourTemps: Array.from(document.querySelectorAll("#iuWxHours .iuWxHourTemp")).map((el) =>
          String(el.textContent || "").trim()
        ),
        dayTemps: Array.from(document.querySelectorAll("#iuWx7Day .iuWx7Temps")).map((el) =>
          String(el.textContent || "").trim()
        ),
        section: document.body ? document.body.dataset.section : "",
      };
    });
    console.error("BROWSER_WAIT_DIAG:" + JSON.stringify(diag));
    process.exit(1);
  }
  if (!waitOk) process.exit(1);
  const sample = await page.evaluate(() => {
    const temp = document.getElementById("iuWxTemp");
    const feels = document.getElementById("iuWxFeelsLike");
    const hourTemps = Array.from(document.querySelectorAll("#iuWxHours .iuWxHourTemp")).map((el) =>
      String(el.textContent || "").trim()
    );
    const dayTemps = Array.from(document.querySelectorAll("#iuWx7Day .iuWx7Temps")).map((el) =>
      String(el.textContent || "").trim()
    );
    return {
      temp: temp ? String(temp.textContent || "").trim() : "",
      feels: feels ? String(feels.textContent || "").trim() : "",
      hourTemps,
      dayTemps,
      placeholderFn:
        typeof window.iuWeatherDomShowsPlaceholder === "function" ? window.iuWeatherDomShowsPlaceholder() : null,
    };
  });
  await context.close();
  await browser.close();
  if (consoleErrors.length) {
    console.error("BROWSER_CONSOLE_ERRORS:" + consoleErrors.length);
    process.exit(1);
  }
  if (sample.placeholderFn !== false) {
    console.error("BROWSER_FAIL:iuWeatherDomShowsPlaceholder still true");
    process.exit(1);
  }
  console.log("BROWSER_PASS:temp=" + sample.temp);
  console.log("BROWSER_PASS:feels=" + sample.feels);
  console.log("BROWSER_PASS:hourly_slots=" + sample.hourTemps.length);
  console.log("BROWSER_PASS:daily_rows=" + sample.dayTemps.length);
}

async function runSnapshotFallbackProof(base) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await installOpenMeteoRejectRoute(page, 429);
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("iuWeatherPersistedStateV1");
      localStorage.removeItem("iuWeatherLiveBackoffUntilV1");
      localStorage.setItem("iu_location_mode", "manual");
      localStorage.setItem(
        "iu_manual_location",
        JSON.stringify({ lat: 50.0755, lon: 14.4378, label: "Praha" })
      );
      window.__iuWeatherDisableLiveRefresh = 1;
    } catch {}
  });
  await page.goto(base + "/projects/index.html?section=pocasi", { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof window.iuWeatherLoadAndRender === "function", { timeout: 120000 });
  const loadErr = await page.evaluate(async () => {
    try {
      await window.iuWeatherLoadAndRender();
      return "";
    } catch (e) {
      return String(e && e.message ? e.message : e);
    }
  });
  if (loadErr) {
    console.error("SNAPSHOT_FALLBACK_LOAD_ERR:" + loadErr);
    process.exit(1);
  }
  const diag = await page.evaluate(() => {
    return {
      source: typeof window.iuWeatherGetDataSource === "function" ? window.iuWeatherGetDataSource() : null,
      temp: document.getElementById("iuWxTemp") ? String(document.getElementById("iuWxTemp").textContent || "").trim() : "",
      feels: document.getElementById("iuWxFeelsLike")
        ? String(document.getElementById("iuWxFeelsLike").textContent || "").trim()
        : "",
      placeholder:
        typeof window.iuWeatherDomShowsPlaceholder === "function" ? window.iuWeatherDomShowsPlaceholder() : true,
    };
  });
  await context.close();
  await browser.close();
  if (diag.placeholder || diag.temp === "—°C" || !diag.temp) {
    console.error("SNAPSHOT_FALLBACK_FAIL:" + JSON.stringify(diag));
    process.exit(1);
  }
  if (diag.source !== "snapshot" && diag.source !== "stale_cache") {
    console.error("SNAPSHOT_FALLBACK_SOURCE_FAIL:" + JSON.stringify(diag));
    process.exit(1);
  }
  console.log("SNAPSHOT_FALLBACK_PASS:source=" + diag.source + " temp=" + diag.temp);
}

const srv = await startStaticServer();
try {
  await runBrowserProof(srv.base);
  await runSnapshotFallbackProof(srv.base);
  console.log("WEATHER_LOADED_GUARD=PASS");
} catch (e) {
  console.error("WEATHER_LOADED_GUARD=FAIL:" + (e && e.message ? e.message : String(e)));
  process.exit(1);
} finally {
  await srv.close();
}
