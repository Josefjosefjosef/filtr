#!/usr/bin/env node
/**
 * Cross-browser feature detection + fallback markers (pre-aggregator stable).
 * Static checks always; Chromium runtime when Playwright available.
 * Firefox/WebKit: SKIP if browser binary missing (reported, not FAIL).
 *
 * Run: npm run iu-pre-aggregator-cross-browser-feature-guard
 */
import fs from "fs";
import http from "http";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const PORT = parseInt(process.env.IU_GUARD_PORT || "8944", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;

function staticChecks() {
  const app = fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8");
  const sw = fs.readFileSync(path.join(REPO, "sw.js"), "utf8");
  const net = fs.readFileSync(path.join(REPO, "assets", "iu-network-connectivity-v1.js"), "utf8");
  const checks = [
    { id: "sw_feature_detect", pass: /"serviceWorker"\s+in\s+navigator/.test(app) },
    { id: "caches_feature_detect", pass: /"caches"\s+in\s+window/.test(app) },
    { id: "sw_v4_version", pass: /pwa-offline-menu-articles-v4|prehled-settings-sw-network-first-v1|app-root-url-drop-projects-v1|app-root-pwa-assets-redirects-v1|pwa-offline-nav-fallback-v1|media-sources-removed-v1|banner-homecard-fouc-v1|chmi-cap-concrete-url-chrono-v1|chmi-cap-temporal-status-v1|chmi-cap-open-ended-public-url-v1|chmi-cap-unified-public-click-v1|chmi-cap-no-segment-dedupe-v1|chmi-multibrowser-console-v1|chmi-title-locality-v1|chmi-validfrom-timeline-v1|chmi-info-events-passthrough-v2|chmi-smog-onset-split-v1|homecard-cta-square-v1|kb-hide-v2|kb-nav-instant-restore-v1|date-time-fit-v2|date-time-right-edge-v3|date-time-value-column-v4|exit-ramp-tokenize-v1|d4-km-range-maintenance-v1|accident-dod-moto-investigation-v1|obstruction-stationary-vehicle-v1|accident-participants-may-block-v1|velky-ujezd-locality-sanitize-v1|hradec-accident-i57-v1|karlovy-vary-closure-access-v1|decin-narrowed-lanes-reason-v1|beroun-multi-street-work-reason-v1|direction-abbrev-rich-situation-v1|km-range-roadwork-detail-v1|municipality-parenthetical-multi-road-v1|traffic-fact-preservation-v1|urban-numbered-road-parse-v1|chmi-filter-vse-v1|bottom-nav-unify-stable-v1|root-hub-no-projects-v1|traffic-ui-activation-v1|traffic-ui-boot-nonblocking-v1|traffic-ui-ls-mem-guard-v1|traffic-ui-hero-cta-early-v1|traffic-ui-cls-stable-shell-v1|traffic-ui-defer-feed-hydrate-v1|heavy-feed-shell-first-v1/.test(sw) },
    { id: "durable_feed_cache", pass: /iu-feed-offline-v2|iu-feed-offline-v1/.test(sw) },
    { id: "durable_img_cache", pass: /iu-img-offline-v1/.test(sw) },
    { id: "network_module_present", pass: /online|offline|connectivity/i.test(net) },
  ];
  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, fails, checks };
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function probeBrowser(browserType, name) {
  try {
    const browser = await browserType.launch({ headless: true });
    const page = await browser.newPage();
    // Local static server is HTTP-only. Some documents trigger upgrade-insecure-requests
    // which rewrites asset URLs to https://127.0.0.1 and hangs WebKit on SSL connect.
    await page.route(`https://127.0.0.1:${PORT}/**`, async (route) => {
      const httpUrl = route.request().url().replace(/^https:\/\//i, "http://");
      try {
        const res = await route.fetch({ url: httpUrl });
        await route.fulfill({ response: res });
      } catch (_) {
        await route.abort();
      }
    });
    await page.goto(BASE + "?iuRobust=1", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      () => !!(document.body && document.body.innerText && document.body.innerText.length > 40),
      null,
      { timeout: 30000 }
    );
    const feat = await page.evaluate(() => ({
      serviceWorker: "serviceWorker" in navigator,
      caches: "caches" in window,
      indexedDB: typeof indexedDB !== "undefined",
      localStorage: (() => {
        try {
          localStorage.setItem("__iu_feat", "1");
          localStorage.removeItem("__iu_feat");
          return true;
        } catch (_) {
          return false;
        }
      })(),
    }));
    await browser.close();
    const ok = feat.serviceWorker && feat.caches && feat.indexedDB && feat.localStorage;
    console.log(`[xbrowser] ${name} features=${JSON.stringify(feat)} pass=${ok ? "YES" : "NO"}`);
    return { name, ok, feat, skip: false };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (/Executable doesn't exist|browserType\.launch|Firefox|WebKit/i.test(msg) && /Executable doesn't exist/i.test(msg)) {
      console.log(`[xbrowser] ${name} SKIP=${msg.slice(0, 120)}`);
      return { name, ok: true, skip: true, reason: msg.slice(0, 200) };
    }
    console.error(`[xbrowser] ${name} ERROR=${msg.slice(0, 200)}`);
    return { name, ok: false, skip: false, reason: msg.slice(0, 200) };
  }
}

async function main() {
  const st = staticChecks();
  for (const c of st.checks) {
    console.log(`[xbrowser] static ${c.id}=${c.pass ? "PASS" : "FAIL"}`);
  }
  if (!st.pass) {
    console.error("[xbrowser] RESULT=FAIL static=" + st.fails.join(","));
    process.exit(1);
  }

  let playwright;
  try {
    playwright = require("playwright");
  } catch (e) {
    console.log("[xbrowser] playwright missing — static-only PASS");
    console.log("[xbrowser] RESULT=PASS");
    process.exit(0);
  }

  const server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  try {
    await waitForPort("127.0.0.1", PORT, 30000);
    const results = [];
    results.push(await probeBrowser(playwright.chromium, "chromium"));
    results.push(await probeBrowser(playwright.firefox, "firefox"));
    results.push(await probeBrowser(playwright.webkit, "webkit"));
    const hardFail = results.filter((r) => !r.skip && !r.ok);
    if (hardFail.length) {
      console.error("[xbrowser] RESULT=FAIL browsers=" + hardFail.map((r) => r.name).join(","));
      process.exit(1);
    }
    console.log("[xbrowser] RESULT=PASS");
  } finally {
    try {
      server.kill("SIGTERM");
    } catch (_) {}
  }
}

main().catch((e) => {
  console.error("[xbrowser] RESULT=FAIL", e);
  process.exit(1);
});
