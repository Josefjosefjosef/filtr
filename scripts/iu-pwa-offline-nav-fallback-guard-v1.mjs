#!/usr/bin/env node
/**
 * Guard: offline navigation must not return unmanaged empty 503 when SW is active.
 * Run: npm run iu-pwa-offline-nav-fallback-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/ npm run iu-pwa-offline-nav-fallback-guard
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

const PORT = parseInt(process.env.IU_GUARD_PORT || "8931", 10);
const ORIGIN = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "")
  : `http://127.0.0.1:${PORT}`;
const APP_URL = ORIGIN + "/";
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;

function auditStatic() {
  const fails = [];
  const sw = fs.readFileSync(path.join(REPO, "sw.js"), "utf8");
  const offline = fs.readFileSync(path.join(REPO, "offline.html"), "utf8");
  if (!fs.existsSync(path.join(REPO, "offline.html"))) fails.push("missing offline.html");
  if (!sw.includes("offlineNavigationFallback")) fails.push("sw:missing offlineNavigationFallback");
  if (!sw.includes("OFFLINE_DOC_CACHE")) fails.push("sw:missing OFFLINE_DOC_CACHE");
  if (!sw.includes("HTML_LAST_GOOD_CACHE")) fails.push("sw:missing HTML_LAST_GOOD_CACHE");
  if (!/2026-08-14-d4-km-range-maintenance-v1|2026-08-14-accident-dod-moto-investigation-v1|2026-08-14-obstruction-stationary-vehicle-v1|2026-08-14-accident-participants-may-block-v1|2026-08-14-velky-ujezd-locality-sanitize-v1|2026-08-13-hradec-accident-i57-v1|2026-08-13-karlovy-vary-closure-access-v1|2026-08-13-decin-narrowed-lanes-reason-v1|2026-08-13-beroun-multi-street-work-reason-v1|2026-08-13-direction-abbrev-rich-situation-v1|2026-08-13-km-range-roadwork-detail-v1|2026-08-13-municipality-parenthetical-multi-road-v1|2026-08-13-traffic-fact-preservation-v1|2026-08-13-urban-numbered-road-parse-v1|2026-08-13-date-time-value-column-v4|2026-08-12-date-time-right-edge-v3|2026-08-09-heavy-feed-shell-first-v1|2026-08-08-traffic-ui-ls-mem-guard-v1|2026-08-08-traffic-ui-boot-nonblocking-v1|2026-08-06-traffic-overview-rsd-prehled-v1|2026-08-04-root-hub-no-projects-v1|2026-08-01-homecard-cta-square-v1|2026-07-31-chmi-info-events-passthrough-v2|2026-07-31-chmi-validfrom-timeline-v1|2026-07-31-chmi-title-locality-v1|2026-07-31-chmi-multibrowser-console-v1|2026-07-30-chmi-cap-no-segment-dedupe-v1|2026-07-30-chmi-cap-unified-public-click-v1|2026-07-30-chmi-cap-open-ended-public-url-v1|2026-07-30-chmi-cap-temporal-status-v1/.test(sw)) fails.push("sw:missing CACHE_VERSION bump");
  if (!sw.includes("iu-feed-offline-v2")) fails.push("sw:missing FEED_OFFLINE_CACHE v2 after media removal");
  if (!sw.includes("X-IU-Offline-Fallback")) fails.push("sw:missing offline fallback header marker");
  if (!offline.includes("Jste offline")) fails.push("offline.html:missing message");
  if (/cdn\.|googleapis|unpkg|jsdelivr/i.test(offline)) fails.push("offline.html:external deps");
  if (!sw.includes("isUnsafeHtmlCachePath")) fails.push("sw:missing unsafe HTML path guard");
  const index = fs.readFileSync(path.join(REPO, "projects/index.html"), "utf8");
  if (!/__iuSwDeployMsgBound/.test(index) || !/u\.catch\(function\(\)\{\}\)/.test(index)) {
    fails.push("index:swUp_update_invalidstate_guard");
  }
  return fails;
}

async function waitSw(page) {
  await page.waitForFunction(
    () => !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    null,
    { timeout: 90000 }
  );
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
        const req = http.get(`http://127.0.0.1:${PORT}/`, (res) => {
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
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = [];
  const passes = [];

  try {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
        localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
      } catch (_) {}
    });

    await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitSw(page);
    passes.push("sw_controlling");

    const offlineDocOnline = await page.evaluate(async () => {
      const res = await fetch("/offline.html", { cache: "no-store" });
      const text = await res.text();
      return { status: res.status, hasMsg: text.includes("Jste offline") };
    });
    if (offlineDocOnline.status === 200 && offlineDocOnline.hasMsg) passes.push("offline_html_online");
    else failures.push({ test: "offline_html_online", detail: offlineDocOnline });

    await context.setOffline(true);

    const nav = await page.evaluate(async () => {
      const res = await fetch("/", { cache: "no-store" });
      const text = await res.text();
      const ct = res.headers.get("content-type") || "";
      const fb = res.headers.get("x-iu-offline-fallback") || "";
      return {
        status: res.status,
        ct,
        fb,
        empty: !text || !String(text).trim(),
        hasOfflineMsg: /Jste offline|offline/i.test(text),
        isHtml: /text\/html/i.test(ct) || /<!doctype html/i.test(text),
      };
    });

    if (nav.status === 503 && nav.empty) {
      failures.push({ test: "offline_nav_no_bare_503", detail: nav });
    } else if (nav.status === 200 && nav.isHtml && (nav.hasOfflineMsg || nav.fb)) {
      passes.push("offline_nav_fallback_200");
    } else if (nav.status === 200 && nav.isHtml && !nav.empty) {
      passes.push("offline_nav_last_good_or_fallback");
    } else {
      failures.push({ test: "offline_nav_fallback", detail: nav });
    }

    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
    const afterReload = await page.evaluate(() => ({
      title: document.title || "",
      bodyLen: (document.body && document.body.innerText || "").length,
      hasOffline: /offline|připojení|internet/i.test(document.body && document.body.innerText || ""),
    }));
    if (afterReload.bodyLen > 20) passes.push("offline_reload_has_document");
    else failures.push({ test: "offline_reload_has_document", detail: afterReload });

    await context.setOffline(false);
    await page.waitForTimeout(500);
    const onlineBack = await page.evaluate(async () => {
      try {
        const res = await fetch("/projects/version.json", { cache: "no-store" });
        return { status: res.status, ok: res.ok };
      } catch (e) {
        return { status: 0, ok: false, err: String(e && e.message || e) };
      }
    });
    if (onlineBack.ok || onlineBack.status === 200) passes.push("online_recovery_fetch");
    else failures.push({ test: "online_recovery_fetch", detail: onlineBack });

    // SW deploy reload can navigate the page when coming back online — retry cache probe.
    let cachesOk = null;
    for (let i = 0; i < 6; i++) {
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
        cachesOk = await page.evaluate(async () => {
          const keys = await caches.keys();
          const hasOfflineDoc = keys.includes("iu-offline-doc-v1");
          const versioned = keys.filter((k) => /^iu-(app|data)/.test(k));
          return { hasOfflineDoc, versionedCount: versioned.length, keys };
        });
        break;
      } catch (e) {
        if (i >= 5) {
          failures.push({
            test: "offline_doc_cache_present",
            detail: { err: String((e && e.message) || e) },
          });
          cachesOk = null;
          break;
        }
        await page.waitForTimeout(400);
      }
    }
    if (cachesOk) {
      if (cachesOk.hasOfflineDoc) passes.push("offline_doc_cache_present");
      else failures.push({ test: "offline_doc_cache_present", detail: cachesOk });
    }
  } finally {
    await browser.close();
    if (serverProc && !serverProc.killed) serverProc.kill("SIGTERM");
  }

  const pass = failures.length === 0;
  console.log(
    JSON.stringify(
      {
        pass,
        origin: ORIGIN,
        passes,
        failures,
        cacheVersion: "2026-08-09-heavy-feed-shell-first-v1",
      },
      null,
      2
    )
  );
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
