#!/usr/bin/env node
/**
 * Guard: PWA offline resilience (external links, shell restore, network layer).
 * Run: npm run iu-pwa-offline-resilience-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/projects/ npm run iu-pwa-offline-resilience-guard
 */
import { createRequire } from "module";
import { spawn } from "child_process";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_SCRIPT = path.join(REPO, "server", "projects-static.mjs");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8926", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;

function auditStatic() {
  const fails = [];
  const netJs = fs.readFileSync(path.join(REPO, "assets", "iu-network-connectivity-v1.js"), "utf8");
  const appJs = fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(REPO, "sw.js"), "utf8");
  const chunk = fs.readFileSync(path.join(REPO, "assets", "iu-article-chunk-loader.js"), "utf8");
  if (!netJs.includes("openExternalUrl")) fails.push("network:missing openExternalUrl");
  if (!netJs.includes("restoreAppShellAfterReturn")) fails.push("network:missing restoreAppShellAfterReturn");
  if (!netJs.includes("probeReachability")) fails.push("network:missing probeReachability");
  if (!netJs.includes("hideOfflineHint")) fails.push("network:missing hideOfflineHint");
  if (!netJs.includes("openExternalSync")) fails.push("network:missing openExternalSync");
  if (!netJs.includes("AbortController")) fails.push("network:missing AbortController usage in module");
  if (!netJs.includes("--iu-mobile-bottom-nav-safe-space") && !netJs.includes("--iu-mobile-bottom-nav-h")) {
    fails.push("network:offline hint missing bottom nav offset");
  }
  if (!netJs.includes("Tuto stránku nelze bez připojení k internetu otevřít.")) {
    fails.push("network:missing exact offline external message");
  }
  if (netJs.includes('"iu-mindmenu-open"')) fails.push("network:restore must not remove iu-mindmenu-open");
  if (!appJs.includes("iuUpdateNameday")) fails.push("app:missing iuUpdateNameday export");
  if (!appJs.includes("iu:nameday:cache:v1")) fails.push("app:missing nameday cache");
  if (!appJs.includes("loadDataWatchdogMs")) fails.push("app:missing loadDataWatchdogMs offline fast path");
  if (!appJs.includes("iuWeatherHistoryReconnect")) fails.push("app:missing iuWeatherHistoryReconnect");
  if (!appJs.includes("iu-local-store-changed")) fails.push("app:missing local store changed event");
  if (!appJs.includes("iuNetworkControlledReconnect")) fails.push("app:missing controlled reconnect");
  if (!appJs.includes("iuNetwork.openExternalUrl")) fails.push("app:missing iuNetwork integration");
  if (!appJs.includes("loadDataWatchdog")) fails.push("app:missing loadDataWatchdog");
  if (!sw.includes("FEED_OFFLINE_CACHE")) fails.push("sw:missing FEED_OFFLINE_CACHE");
  if (!sw.includes("IMG_OFFLINE_CACHE")) fails.push("sw:missing IMG_OFFLINE_CACHE");
  if (!sw.includes("OFFLINE_DOC_CACHE")) fails.push("sw:missing OFFLINE_DOC_CACHE");
  if (!sw.includes("offlineNavigationFallback")) fails.push("sw:missing offlineNavigationFallback");
  if (!sw.includes("iu-financial-calculators-module.js")) fails.push("sw:missing financial module precache");
  if (!sw.includes("iu-invoice-module.js")) fails.push("sw:missing invoice module precache");
  if (!fs.existsSync(path.join(REPO, "offline.html"))) fails.push("missing offline.html");
  if (!appJs.includes("iuTasksRestoreSearchFocus")) fails.push("app:missing tasks search focus restore");
  if (!appJs.includes('section === "kultura"')) fails.push("app:missing kultura notes early-return");
  if (!appJs.includes("iuOfflinePaging")) fails.push("app:missing offline paging guard");
  if (!html.includes("iu-network-connectivity-v1.js")) fails.push("index:missing network script");
  if (!sw.includes("iu-network-connectivity-v1.js")) fails.push("sw:missing network precache");
  if (!chunk.includes("AbortController")) fails.push("chunk:missing AbortController timeout");
  return fails;
}

async function preparePage(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
  });
  // Keep info-system cutover off: this guard asserts network APIs, not feed hydrate.
  // Default cutover + multi‑MB feed.json can starve deferred iu-network bootstrap on CI.
  const url = BASE.includes("?")
    ? BASE + "&iuInfoSystem=off&nosw=1"
    : BASE + "?iuInfoSystem=off&nosw=1";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => window.iuNetwork && typeof window.iuNetwork.openExternalUrl === "function", null, {
    timeout: 60000,
  });
}

async function testOfflineExternalBlocked(page) {
  await page.context().setOffline(true);
  const result = await page.evaluate(async () => {
    document.body.classList.add("iu-modal-open");
    document.body.style.overflow = "hidden";
    const res = await window.iuNetwork.openExternalUrl("https://example.com/offline-test");
    return {
      ok: res && res.ok === false && res.reason === "offline",
      modalOpen: document.body.classList.contains("iu-modal-open"),
      hint: !!document.getElementById("iuNetworkOfflineHint"),
    };
  });
  await page.context().setOffline(false);
  return result;
}

async function testShellRestore(page) {
  return page.evaluate(() => {
    try {
      sessionStorage.setItem("iu_external_nav_armed", "1");
    } catch (_) {}
    document.body.classList.add("iu-modal-open");
    document.body.style.overflow = "hidden";
    document.body.style.pointerEvents = "none";
    window.iuNetwork.restoreAppShellAfterReturn();
    return {
      modalGone: !document.body.classList.contains("iu-modal-open"),
      overflowClear: document.body.style.overflow !== "hidden",
      pointerOk: document.body.style.pointerEvents !== "none",
    };
  });
}

async function main() {
  const staticFails = auditStatic();
  if (staticFails.length) {
    console.log(JSON.stringify({ pass: false, staticFails }, null, 2));
    process.exit(1);
  }

  let serverProc = null;
  if (USE_LOCAL_SERVER) {
    serverProc = spawn(process.execPath, [SERVER_SCRIPT], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 30000;
      const tick = () => {
        const req = http.get(`http://127.0.0.1:${PORT}/projects/`, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) resolve();
          else if (Date.now() >= deadline) reject(new Error("server not ready"));
          else setTimeout(tick, 300);
        });
        req.on("error", () => {
          if (Date.now() >= deadline) reject(new Error("server not ready"));
          else setTimeout(tick, 300);
        });
      };
      tick();
    });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const failures = [];
  const passes = [];

  try {
    await preparePage(page);
    passes.push("network_module_loaded");

    const offline = await testOfflineExternalBlocked(page);
    if (offline.ok && offline.hint) passes.push("offline_external_blocked");
    else failures.push({ test: "offline_external_blocked", detail: offline });

    await preparePage(page);
    const restore = await testShellRestore(page);
    if (restore.modalGone && restore.overflowClear) passes.push("shell_restore");
    else failures.push({ test: "shell_restore", detail: restore });
  } finally {
    await browser.close();
    if (serverProc && !serverProc.killed) serverProc.kill("SIGTERM");
  }

  const pass = failures.length === 0;
  console.log(JSON.stringify({ pass, base: BASE, passes: passes.length, failures, staticAudit: "PASS" }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
