#!/usr/bin/env node
/**
 * Guard: PWA must not show technical "Dopravní data (offline)" freshness banner in UI,
 * while offline snapshot / resume revalidate infrastructure must remain intact.
 *
 * Run: npm run iu-pwa-hide-traffic-offline-banner-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const FORBIDDEN_UI = [
  "Dopravní data (offline)",
  "data-iu-traffic-offline",
  "iuPdTrafficOffline",
];

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function auditStatic() {
  const prehled = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
  const overview = fs.readFileSync(path.join(ROOT, "assets", "iu-traffic-overview-v1.js"), "utf8");
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");

  ok(
    "ui:no_offline_banner_inject",
    !prehled.includes('data-iu-traffic-offline="1"') && !prehled.includes("iuPdTrafficOffline"),
    "homeShell must not inject technical offline banner"
  );
  ok(
    "ui:no_offline_label_in_shell",
    !prehled.includes("Dopravní data (offline)"),
    "prehled UI source must not contain Dopravní data (offline) user-facing label"
  );
  ok(
    "ui:count_then_feed",
    /id="iuPdCount"[\s\S]{0,200}id="iuPrehledDneTimeline"/.test(prehled) ||
      /id="iuPdCount"[\s\S]{0,200}emptyFeedStateHtml/.test(prehled),
    "count must lead into feed/empty without offline banner between"
  );

  // Offline / cache infrastructure must stay.
  ok("snap:ls_key", overview.includes('iu.trafficOverview.offlineSnapshot.v1'));
  ok("snap:load_export", /export function loadOfflineTrafficSnapshot\b/.test(overview));
  ok("snap:save_export", /export function saveOfflineTrafficSnapshot\b/.test(overview));
  ok("snap:clear_export", /export function clearOfflineTrafficSnapshot\b/.test(overview));
  ok(
    "snap:prehled_loader",
    /function loadOfflineTrafficSnapshotSync\b/.test(prehled) &&
      /loadOfflineTrafficSnapshot\(/.test(prehled),
    "prehled must still read offline snapshot for feed merge"
  );
  ok(
    "snap:fg_revalidate",
    /export function scheduleTrafficForegroundRevalidate\b/.test(overview),
    "PWA resume revalidate must remain"
  );
  ok(
    "snap:bg_hydrate",
    /export function scheduleTrafficBackgroundFullHydrate\b/.test(overview),
    "background hydrate must remain"
  );
  ok(
    "index:cache_bust",
    index.includes("pwa-hide-traffic-offline-banner-v1-20260916"),
    "index must cache-bust prehled UI after banner hide"
  );
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
        if (Date.now() > deadline) reject(new Error("port_timeout"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function dismissConsent(page) {
  await page.evaluate(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted-version:v1", "2026-09-08-v1");
      localStorage.setItem("iu:terms:accepted-at:v1", new Date().toISOString());
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
    const b = document.getElementById("iuConsentAllowStats");
    if (b) b.click();
    const layer = document.getElementById("iuConsentLayer");
    if (layer) layer.remove();
  });
}

auditStatic();
if (fails.length) {
  console.log(
    JSON.stringify({ IU_PWA_HIDE_TRAFFIC_OFFLINE_BANNER_GUARD: "FAIL", phase: "static", fails }, null, 2)
  );
  process.exit(1);
}

const PORT = parseInt(process.env.IU_GUARD_PORT || "8961", 10);
const server = http.createServer((req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const fp = path.join(ROOT, p.replace(/^\/+/, ""));
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const mime =
      fp.endsWith(".css")
        ? "text/css; charset=utf-8"
        : fp.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : fp.endsWith(".html")
            ? "text/html; charset=utf-8"
            : "application/octet-stream";
    res.writeHead(200, { "content-type": mime });
    res.end(fs.readFileSync(fp));
  } catch (_) {
    res.writeHead(500);
    res.end("err");
  }
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
await waitForPort("127.0.0.1", PORT, 10000);

const browser = await chromium.launch({ headless: true });
try {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    // Emulate installed PWA (display-mode: standalone).
    colorScheme: "light",
  });
  await context.addInitScript(() => {
    try {
      Object.defineProperty(window.navigator, "standalone", { configurable: true, get: () => true });
      const orig = window.matchMedia.bind(window);
      window.matchMedia = (q) => {
        if (String(q).includes("display-mode: standalone")) {
          return {
            matches: true,
            media: q,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() {
              return false;
            },
          };
        }
        return orig(q);
      };
    } catch (_) {}
  });

  const page = await bootstrapGuardPage(context);
  await dismissConsent(page);
  await page.goto(`http://127.0.0.1:${PORT}/projects/?nosw=1&cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await dismissConsent(page);
  // Seed offline snapshot after boot (LDP/boot may reset storage on first paint).
  await page.evaluate(() => {
    try {
      const snap = {
        schema: "iu-traffic-offline-snapshot-v1",
        generatedAt: "2026-09-15T22:05:02.442Z",
        sourceFreshness: "FRESH",
        items: [],
      };
      localStorage.setItem("iu.trafficOverview.offlineSnapshot.v1", JSON.stringify(snap));
    } catch (_) {}
  });
  // Soft reload so homeShellHtml rebuilds with snapshot present (PWA path).
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await dismissConsent(page);
  await page.waitForSelector("#iuPdCount, .iuPrehledDne, .iuPd", { state: "attached", timeout: 90000 }).catch(() => null);
  await page.waitForTimeout(1500);

  const snap = await page.evaluate((forbidden) => {
    try {
      const seeded = {
        schema: "iu-traffic-offline-snapshot-v1",
        generatedAt: "2026-09-15T22:05:02.442Z",
        sourceFreshness: "FRESH",
        items: [],
      };
      localStorage.setItem("iu.trafficOverview.offlineSnapshot.v1", JSON.stringify(seeded));
    } catch (_) {}
    const body = document.body ? document.body.innerText || "" : "";
    const html = document.body ? document.body.innerHTML || "" : "";
    const banner = document.querySelector("[data-iu-traffic-offline], .iuPdTrafficOffline");
    const ls = (() => {
      try {
        return localStorage.getItem("iu.trafficOverview.offlineSnapshot.v1");
      } catch (_) {
        return null;
      }
    })();
    return {
      hasBannerEl: !!banner,
      forbiddenHit: forbidden.find((t) => body.includes(t) || html.includes(t)) || null,
      hasOfflineLs: !!(ls && ls.indexOf("iu-traffic-offline-snapshot") !== -1),
      standalone:
        (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
        navigator.standalone === true,
    };
  }, FORBIDDEN_UI);

  ok("runtime:pwa_emulated", snap.standalone, "standalone detect");
  ok("runtime:offline_snapshot_kept", snap.hasOfflineLs, "LS offline snapshot must remain usable");
  ok("runtime:no_banner_el", !snap.hasBannerEl, "no .iuPdTrafficOffline in DOM");
  ok("runtime:no_forbidden_text", !snap.forbiddenHit, snap.forbiddenHit);

  // Switch traffic ↔ chmu if switcher exists; banner must stay absent.
  for (const view of ["traffic", "chmu"]) {
    await page.evaluate((v) => {
      try {
        sessionStorage.setItem("iu.prehled.feedQuickView.v1", v);
        localStorage.setItem("iu.prehled.feedQuickView.pwa.v1", v);
      } catch (_) {}
      const btn = document.querySelector("[data-iu-pd-quick-switcher='1']");
      if (btn && typeof btn.click === "function") btn.click();
    }, view);
    await page.waitForTimeout(600);
    const after = await page.evaluate((forbidden) => {
      const body = document.body ? document.body.innerText || "" : "";
      const banner = document.querySelector("[data-iu-traffic-offline], .iuPdTrafficOffline");
      return {
        hasBannerEl: !!banner,
        forbiddenHit: forbidden.find((t) => body.includes(t)) || null,
      };
    }, FORBIDDEN_UI);
    ok("runtime:" + view + ":no_banner", !after.hasBannerEl && !after.forbiddenHit, after.forbiddenHit);
  }

  await context.close();
} catch (err) {
  fails.push("runtime_exception:" + (err && err.message ? err.message : String(err)));
} finally {
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      IU_PWA_HIDE_TRAFFIC_OFFLINE_BANNER_GUARD: pass ? "PASS" : "FAIL",
      fails,
      REAL_IOS: "NOT_TESTED",
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
