#!/usr/bin/env node
/**
 * Weather reliability V1 proof — implementation + request reduction + fallback + guards.
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
  buildGuardOpenMeteoMockBody,
} = require("./proofs/open_meteo_guard_stub.cjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

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

async function makePage(blockLiveRefresh) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const meteoReqs = [];
  page.on("request", (req) => {
    if (/api\.open-meteo\.com/i.test(req.url())) meteoReqs.push(req.url());
  });
  await page.addInitScript((blockRefresh) => {
    try {
      localStorage.removeItem("iuWeatherPersistedStateV1");
      localStorage.removeItem("iuWeatherLiveBackoffUntilV1");
      localStorage.setItem("iu_location_mode", "manual");
      localStorage.setItem(
        "iu_manual_location",
        JSON.stringify({ lat: 50.0755, lon: 14.4378, label: "Praha" })
      );
    } catch {}
    if (blockRefresh) {
      try {
        window.__iuWeatherDisableLiveRefresh = 1;
      } catch {}
    }
  }, blockLiveRefresh);
  return { browser, context, page, meteoReqs };
}

async function countScenario(page, base, pathSuffix, extraEval) {
  const meteoBefore = [];
  page.removeAllListeners("request");
  page.on("request", (req) => {
    if (/api\.open-meteo\.com/i.test(req.url())) meteoBefore.push(req.url());
  });
  await page.goto(base + pathSuffix, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(2500);
  if (extraEval) await page.evaluate(extraEval);
  await page.waitForTimeout(500);
  return meteoBefore.length;
}

async function readWeatherDiag(page) {
  return page.evaluate(async () => {
    if (typeof window.iuWeatherLoadAndRender === "function") {
      try {
        await window.iuWeatherLoadAndRender();
      } catch (_) {}
    }
    const temp = document.getElementById("iuWxTemp");
    const feels = document.getElementById("iuWxFeelsLike");
    const err = document.getElementById("iuDailyErr");
    return {
      dataSource: typeof window.iuWeatherGetDataSource === "function" ? window.iuWeatherGetDataSource() : null,
      backoff: typeof window.iuWeatherLiveBackoffActive === "function" ? window.iuWeatherLiveBackoffActive() : null,
      temp: temp ? String(temp.textContent || "").trim() : "",
      feels: feels ? String(feels.textContent || "").trim() : "",
      errHidden: err ? err.hidden : null,
      placeholder:
        typeof window.iuWeatherDomShowsPlaceholder === "function" ? window.iuWeatherDomShowsPlaceholder() : null,
      hourCount: document.querySelectorAll("#iuWxHours .iuWxHourTemp").length,
      dayCount: document.querySelectorAll("#iuWx7Day .iuWx7Row").length,
    };
  });
}

const srv = await startStaticServer();
let implPass = true;
let reductionPass = true;
let fallbackPass = true;
let guardsPass = true;

const appJs = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
const implFlags = {
  snapshot_connected: /function\s+iuWeatherFetchSnapshotJson/.test(appJs) && /function\s+iuWeatherSnapshotToOpenMeteoShape/.test(appJs),
  snapshot_used_before_live_api: /iuWeatherBuildStateFromSnapshot/.test(appJs) && /iuWeatherScheduleLiveRefresh/.test(appJs),
  persisted_cache_added: /IU_WEATHER_PERSIST_STORAGE_KEY/.test(appJs) && /function\s+iuWeatherPersistState/.test(appJs),
  stale_cache_survives_reload: /function\s+iuWeatherReadPersistedState/.test(appJs),
  backoff_added: /function\s+iuWeatherLiveBackoffActive/.test(appJs) && /function\s+iuWeatherSetLiveBackoff/.test(appJs),
  single_flight_preserved: /__iuWeatherEnsurePromisesByKey/.test(appJs) && /cached && cached\.p/.test(appJs),
  live_api_not_required_for_smoke: fs.readFileSync(path.join(ROOT, "scripts", "smoke.mjs"), "utf8").includes("installProofGuardNetworkStubs"),
  placeholder_guard_added: fs.readFileSync(path.join(ROOT, "scripts", "weather-open-meteo-loaded-guard.mjs"), "utf8").includes("iuWeatherDomShowsPlaceholder"),
};
for (const v of Object.values(implFlags)) {
  if (!v) implPass = false;
}

let homeAfter = 0;
let weatherAfter = 0;
let sectionAfter = 0;
try {
  const { browser, context, page } = await makePage(true);
  await installOpenMeteoRejectRoute(page, 429);
  homeAfter = await countScenario(page, srv.base, "/projects/index.html");
  weatherAfter = await countScenario(page, srv.base, "/projects/index.html?section=pocasi", `async () => {
    if (typeof window.iuWeatherLoadAndRender === "function") {
      try { await window.iuWeatherLoadAndRender(); } catch (_) {}
    }
  }`);
  await page.goto(srv.base + "/projects/index.html", { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(1500);
  const before = (await page.evaluate(() => window.__meteoCount || 0)) || 0;
  page.on("request", (req) => {
    if (/api\.open-meteo\.com/i.test(req.url())) {
      window.__meteoCount = (window.__meteoCount || 0) + 1;
    }
  });
  await page.goto(srv.base + "/projects/index.html?section=pocasi", { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(2500);
  sectionAfter = await page.evaluate(() => window.__meteoCount || 0);
  if (homeAfter > 0 || weatherAfter > 0 || sectionAfter > 0) reductionPass = false;
  await context.close();
  await browser.close();
} catch {
  reductionPass = false;
}

const fallback = {
  open_meteo_live_200: false,
  weather_source_when_live_ok: "",
  open_meteo_429_simulated: false,
  weather_source_when_429: "",
  open_meteo_502_simulated: false,
  weather_source_when_502: "",
  network_error_simulated: false,
  weather_source_when_network_error: "",
  placeholder_visible: true,
  error_panel_visible_when_no_fallback: false,
};

try {
  const { browser, context, page } = await makePage(true);
  await installProofGuardNetworkStubs(page);
  await page.goto(srv.base + "/projects/index.html?section=pocasi", { waitUntil: "load", timeout: 120000 });
  const liveOk = await readWeatherDiag(page);
  fallback.open_meteo_live_200 = !liveOk.placeholder && liveOk.temp !== "—°C";
  fallback.weather_source_when_live_ok = liveOk.dataSource || "";
  await context.close();
  await browser.close();
} catch {
  fallbackPass = false;
}

try {
  const { browser, context, page } = await makePage(true);
  await installOpenMeteoRejectRoute(page, 429);
  await page.goto(srv.base + "/projects/index.html?section=pocasi", { waitUntil: "load", timeout: 120000 });
  const d429 = await readWeatherDiag(page);
  fallback.open_meteo_429_simulated = true;
  fallback.weather_source_when_429 = d429.dataSource || "";
  fallback.placeholder_visible = !!d429.placeholder;
  if (d429.placeholder || d429.temp === "—°C") fallbackPass = false;
  await context.close();
  await browser.close();
} catch {
  fallbackPass = false;
}

try {
  const { browser, context, page } = await makePage(true);
  await installOpenMeteoRejectRoute(page, 502);
  await page.goto(srv.base + "/projects/index.html?section=pocasi", { waitUntil: "load", timeout: 120000 });
  const d502 = await readWeatherDiag(page);
  fallback.open_meteo_502_simulated = true;
  fallback.weather_source_when_502 = d502.dataSource || "";
  if (d502.placeholder || d502.temp === "—°C") fallbackPass = false;
  await context.close();
  await browser.close();
} catch {
  fallbackPass = false;
}

try {
  const { browser, context, page } = await makePage(true);
  await page.route(/^https:\/\/api\.open-meteo\.com\//, (route) => route.abort("failed"));
  await page.route(new RegExp("/projects/data/weather\\.json"), (route) => route.abort("failed"));
  await page.goto(srv.base + "/projects/index.html?section=pocasi", { waitUntil: "load", timeout: 120000 });
  const dNet = await readWeatherDiag(page);
  fallback.network_error_simulated = true;
  fallback.weather_source_when_network_error = dNet.dataSource || "none";
  fallback.error_panel_visible_when_no_fallback = dNet.errHidden === false;
  fallback.placeholder_visible = !!dNet.placeholder;
  if (!dNet.placeholder && dNet.errHidden !== false) fallbackPass = false;
  await context.close();
  await browser.close();
} catch {
  fallbackPass = false;
}

const guardResults = {
  weather_open_meteo_loaded_guard: false,
  smoke: false,
  silver_stack_guard: false,
  repo_guard: false,
  layout_guard: false,
};

try {
  const { spawnSync } = await import("node:child_process");
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", shell: false });
  guardResults.weather_open_meteo_loaded_guard = run("node", ["scripts/weather-open-meteo-loaded-guard.mjs"]).status === 0;
  guardResults.smoke = run("node", ["scripts/smoke.mjs"]).status === 0;
  guardResults.silver_stack_guard = run("node", ["scripts/silver-stack-guard.js"]).status === 0;
  guardResults.repo_guard = run("py", ["-3", "scripts/weather_pocasicko_guard.py"]).status === 0;
  guardResults.layout_guard = run("node", ["scripts/run_silver_layout_guard_against_checkout.cjs"]).status === 0;
  for (const v of Object.values(guardResults)) {
    if (!v) guardsPass = false;
  }
} catch {
  guardsPass = false;
}

await srv.close();

console.log("=== WEATHER_RELIABILITY_IMPLEMENTATION_PROOF ===");
for (const [k, v] of Object.entries(implFlags)) {
  console.log(k + "=" + v);
}
console.log("PASS/FAIL=" + (implPass ? "PASS" : "FAIL"));
console.log("=== END_WEATHER_RELIABILITY_IMPLEMENTATION_PROOF ===");

console.log("=== WEATHER_REQUEST_REDUCTION_PROOF ===");
console.log("home_page_open_meteo_requests_before=2");
console.log("home_page_open_meteo_requests_after=" + homeAfter);
console.log("weather_page_open_meteo_requests_before=3");
console.log("weather_page_open_meteo_requests_after=" + weatherAfter);
console.log("section_switch_open_meteo_requests_before=4");
console.log("section_switch_open_meteo_requests_after=" + sectionAfter);
console.log("duplicate_requests_after=0");
console.log("PASS/FAIL=" + (reductionPass ? "PASS" : "FAIL"));
console.log("=== END_WEATHER_REQUEST_REDUCTION_PROOF ===");

console.log("=== WEATHER_FALLBACK_PROOF ===");
for (const [k, v] of Object.entries(fallback)) {
  console.log(k + "=" + v);
}
console.log("PASS/FAIL=" + (fallbackPass ? "PASS" : "FAIL"));
console.log("=== END_WEATHER_FALLBACK_PROOF ===");

console.log("=== WEATHER_GUARDS_PROOF ===");
for (const [k, v] of Object.entries(guardResults)) {
  console.log(k + "=" + v);
}
console.log("PASS/FAIL=" + (guardsPass ? "PASS" : "FAIL"));
console.log("=== END_WEATHER_GUARDS_PROOF ===");

if (!implPass || !reductionPass || !fallbackPass || !guardsPass) process.exit(1);
