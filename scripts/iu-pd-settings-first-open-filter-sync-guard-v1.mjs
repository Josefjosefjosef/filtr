#!/usr/bin/env node
/**
 * Freeze guard: Můj přehled / Nastavení
 * A) First open must not await traffic overview / datasets before overlay mount.
 * B) Clean prefs: Settings UI mirrors feed filter defaults (empty roads/events = all).
 *
 * Run: npm run iu-pd-settings-first-open-filter-sync-guard
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";
import { swHasAllowedCacheVersion } from "./guards/iu-sw-cache-version-allowlist.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const UI = path.join(REPO, "assets", "iu-prehled-dne-ui-v1.js");
const FEED_SETTINGS = path.join(REPO, "assets", "iu-prehled-dne-feed-settings-v1.js");
const FEED_FILTER = path.join(REPO, "assets", "iu-feed-filter-v1.js");
const INDEX = path.join(REPO, "projects", "index.html");
const SW = path.join(REPO, "sw.js");
const REPORT = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  "iu_pd_settings_first_open_filter_sync_guard.json"
);
const CACHE_TOKEN = "2026-09-16-pd-settings-first-open-sync-v1";
const UI_BUST = "pd-settings-first-open-sync-v1-20260916";
const PORT = parseInt(process.env.IU_GUARD_PORT || "8847", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?section=media`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const VIEWPORTS = [
  { id: "mobile", width: 390, height: 844, isMobile: true, pwa: false },
  { id: "tablet", width: 820, height: 1180, isMobile: false, pwa: false },
  { id: "pwa", width: 390, height: 844, isMobile: true, pwa: true },
];

function staticGate() {
  const ui = fs.readFileSync(UI, "utf8");
  const fsSettings = fs.readFileSync(FEED_SETTINGS, "utf8");
  const feedFilter = fs.readFileSync(FEED_FILTER, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const sw = fs.readFileSync(SW, "utf8");
  const fails = [];
  const ok = (id, cond) => {
    if (!cond) fails.push(id);
  };

  ok("index_ui_bust", index.includes(UI_BUST) && /iu-prehled-dne-ui-v1\.js\?v=/.test(index));
  // Historical PD-settings SW token must stay allowlisted; CURRENT may advance on later freezes.
  const allowlistSrc = fs.readFileSync(
    path.join(REPO, "scripts", "guards", "iu-sw-cache-version-allowlist.cjs"),
    "utf8"
  );
  ok("sw_cache_token", allowlistSrc.includes(`"${CACHE_TOKEN}"`));
  ok("sw_allowlist", swHasAllowedCacheVersion(sw));
  ok("feed_settings_mod_bust", /pd-settings-first-open-sync-v1-20260916/.test(ui));

  // A) First-open lifecycle: mount before traffic; no Promise.all with traffic on open.
  const openAt = ui.indexOf("function openSettings");
  const openSlice = openAt >= 0 ? ui.slice(openAt, openAt + 1800) : "";
  ok("open_has_mount", /mountSettingsOverlay\(\)/.test(openSlice));
  ok(
    "open_no_promise_all_traffic",
    !/Promise\.all\(\[\s*loadFeedSettings\(\)\s*,\s*loadTrafficOverview\(\)\s*\]\)/.test(openSlice)
  );
  ok(
    "open_no_traffic_kick",
    !/loadTrafficOverview\(\)/.test(openSlice)
  );
  ok(
    "open_mount_sync_not_only_in_then",
    /mountSettingsOverlay\(\);\s*\r?\n\s*setBodyScrollLock\(true\)/.test(openSlice)
  );

  // B) Filter UI mirrors feed empty=all for roads; events already; parking when enabled.
  ok("roads_empty_is_all_ui", /isAllRoads/.test(fsSettings) && /isAllRoads \|\| selected\.has/.test(fsSettings));
  ok("parking_empty_is_all_ui", /isAllLots/.test(fsSettings) && /isAllLots \|\| selected\.has/.test(fsSettings));
  ok("toggle_road_materialize", /empty = all: first uncheck materializes/.test(fsSettings));
  ok(
    "feed_empty_roads_all",
    /roads:\s*\[\]/.test(feedFilter) && /if \(!selectedRoads\.length\) return true/.test(feedFilter)
  );
  ok(
    "events_empty_all_ui",
    /isAll \|\| \(!isNone && selected\.has\(c\.id\)\)/.test(fsSettings)
  );

  return { pass: fails.length === 0, fails };
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
        res.writeHead(200, {
          "content-type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream",
        });
        res.end(fs.readFileSync(fp));
      } catch (_) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function clearUserFilterState(page) {
  await page.evaluate(() => {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) keys.push(k);
      }
      for (const k of keys) {
        if (/pref|feed|iu-|vault|prehled|filter/i.test(k)) localStorage.removeItem(k);
      }
    } catch (_) {}
    try {
      sessionStorage.clear();
    } catch (_) {}
  });
}

async function ensureShell(page) {
  await page.evaluate(() => {
    try {
      window.__IU_INFO_SYSTEM_CUTOVER__ = true;
    } catch (_) {}
    try {
      document.documentElement.classList.add("iu-info-system-cutover");
    } catch (_) {}
    const root = document.getElementById("iuPrehledDneRoot");
    if (root) {
      root.style.display = "block";
      root.hidden = false;
    }
    if (window.IUInfoSystem && typeof window.IUInfoSystem.applyCutoverDom === "function") {
      window.IUInfoSystem.applyCutoverDom();
    }
  });
  await page.waitForFunction(() => !!document.querySelector('[data-act="open-settings"]'), {
    timeout: 60000,
  });
  await page.waitForFunction(
    () => {
      const root = document.getElementById("iuPrehledDneRoot");
      return !!(root && root.getAttribute("data-iu-pd-shell-ready") === "1");
    },
    { timeout: 60000 }
  );
}

async function runViewport(browser, vp) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    isMobile: !!vp.isMobile,
    hasTouch: !!vp.isMobile,
  });
  if (vp.pwa) {
    await context.addInitScript(() => {
      try {
        Object.defineProperty(window.navigator, "standalone", { get: () => true });
      } catch (_) {}
      try {
        window.matchMedia = new Proxy(window.matchMedia.bind(window), {
          apply(target, thisArg, args) {
            if (String(args[0] || "").includes("display-mode")) {
              return { matches: true, media: args[0], addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent() { return false; } };
            }
            return Reflect.apply(target, thisArg, args);
          },
        });
      } catch (_) {}
    });
  }
  const page = await bootstrapGuardPage(context);
  const trafficBlocked = { count: 0 };
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (/iu-traffic-overview-v1\.js/i.test(url) || /ndic|traffic.*snapshot|doprava/i.test(url)) {
      // Delay traffic module heavily — Settings must still open without it.
      trafficBlocked.count += 1;
      await new Promise((r) => setTimeout(r, 8000));
    }
    return route.continue();
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await clearUserFilterState(page);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await ensureShell(page);

  // Force feedSettings available but keep traffic delayed — open must still mount.
  const openTiming = await page.evaluate(async () => {
    const btn = document.querySelector('[data-act="open-settings"]');
    if (!btn) return { ok: false, reason: "no_btn" };
    const t0 = performance.now();
    btn.click();
    const appeared = await new Promise((resolve) => {
      const deadline = performance.now() + 2500;
      const tick = () => {
        const el = document.getElementById("iuPdSettings");
        if (el) return resolve({ ok: true, ms: performance.now() - t0 });
        if (performance.now() > deadline) return resolve({ ok: false, ms: performance.now() - t0 });
        requestAnimationFrame(tick);
      };
      tick();
    });
    return appeared;
  });

  if (!openTiming.ok) {
    await context.close();
    return { id: vp.id, pass: false, fails: ["first_open_overlay_missing"], openTiming };
  }
  // Must open well under the artificial 8s traffic delay.
  if (!(openTiming.ms < 3000)) {
    await context.close();
    return { id: vp.id, pass: false, fails: ["first_open_too_slow_ms_" + Math.round(openTiming.ms)], openTiming };
  }

  // Wait for main settings content (feed-settings module), still without needing traffic.
  await page.waitForFunction(
    () => !!document.querySelector('[data-iu-pd-settings-main="1"], [data-iu-feed-kind], .iuPdFeedMainRow'),
    { timeout: 15000 }
  );

  // Consistency: clean defaults — event categories empty (=all) → all event checkboxes checked when detail opens.
  // Open traffic detail if possible; roads may be empty catalog without traffic — events always present.
  const sync = await page.evaluate(async () => {
    const fails = [];
    const trafficBtn = document.querySelector('[data-act="feed-open-detail"][data-kind="traffic"]');
    if (!trafficBtn) {
      fails.push("no_traffic_detail_btn");
      return { fails, prefs: null };
    }
    trafficBtn.click();
    await new Promise((r) => setTimeout(r, 200));
    const eventsAcc = document.querySelector('[data-act="feed-acc-toggle"][data-id="events"]');
    if (eventsAcc) eventsAcc.click();
    await new Promise((r) => setTimeout(r, 150));
    const eventBoxes = Array.from(document.querySelectorAll('input[data-act="feed-event-toggle"]'));
    if (!eventBoxes.length) fails.push("no_event_checkboxes");
    else if (!eventBoxes.every((el) => el.checked)) fails.push("events_not_all_checked_on_default");

    // Read live prefs feedFilter (source of truth used by feed)
    let ff = null;
    try {
      const raw = localStorage.getItem("iu-info-system-prefs-v1") || localStorage.getItem("iuPrefs") || "";
      // Prefer in-memory via IU if exposed
      if (window.IUInfoSystem && typeof window.IUInfoSystem.getPrefs === "function") {
        ff = (window.IUInfoSystem.getPrefs() || {}).feedFilter || null;
      }
    } catch (_) {}
    try {
      if (!ff && window.__IU_PD_STATE__ && window.__IU_PD_STATE__.prefs) {
        ff = window.__IU_PD_STATE__.prefs.feedFilter;
      }
    } catch (_) {}

    // roads UI: if any road checkboxes rendered, default empty must show checked
    const roadBoxes = Array.from(document.querySelectorAll('input[data-act="feed-road-toggle"]'));
    if (roadBoxes.length) {
      if (!roadBoxes.every((el) => el.checked)) fails.push("roads_not_all_checked_on_default_empty");
    }

    return { fails, eventCount: eventBoxes.length, roadCount: roadBoxes.length, ff };
  });

  // Mutate one event category, reload, confirm persistence still mirrored.
  await page.evaluate(() => {
    const box = document.querySelector('input[data-act="feed-event-toggle"]');
    if (box && box.checked) {
      box.click();
    }
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const close = document.querySelector('#iuPdSettings [data-act="settings-close"]');
    if (close) close.click();
  });
  await page.waitForTimeout(200);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await ensureShell(page);
  await page.evaluate(() => {
    const btn = document.querySelector('[data-act="open-settings"]');
    if (btn) btn.click();
  });
  await page.waitForSelector("#iuPdSettings", { timeout: 10000 });
  await page.waitForFunction(
    () => !!document.querySelector('[data-iu-pd-settings-main="1"], .iuPdFeedMainRow'),
    { timeout: 15000 }
  );
  const afterReload = await page.evaluate(async () => {
    const fails = [];
    const trafficBtn = document.querySelector('[data-act="feed-open-detail"][data-kind="traffic"]');
    if (trafficBtn) trafficBtn.click();
    await new Promise((r) => setTimeout(r, 250));
    const eventsAcc = document.querySelector('[data-act="feed-acc-toggle"][data-id="events"]');
    if (eventsAcc) eventsAcc.click();
    await new Promise((r) => setTimeout(r, 150));
    const eventBoxes = Array.from(document.querySelectorAll('input[data-act="feed-event-toggle"]'));
    const checked = eventBoxes.filter((el) => el.checked).length;
    // After unchecking one from all, not all should be checked (unless materialize failed)
    if (eventBoxes.length && checked === eventBoxes.length) fails.push("user_event_filter_not_persisted");
    if (eventBoxes.length && checked === 0) {
      // __none__ or all unchecked — OK if not all-on
    }
    return { fails, checked, total: eventBoxes.length };
  });

  await context.close();
  const fails = []
    .concat(sync.fails || [])
    .concat(afterReload.fails || []);
  return {
    id: vp.id,
    pass: fails.length === 0,
    fails,
    openTiming,
    sync,
    afterReload,
  };
}

async function main() {
  const staticResult = staticGate();
  const report = { static: staticResult, viewports: [], pass: false };
  if (!staticResult.pass) {
    report.pass = false;
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    console.error("[iu-pd-settings-first-open-filter-sync-guard] FAIL static");
    for (const f of staticResult.fails) console.error(" - " + f);
    process.exit(1);
  }

  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const vp of VIEWPORTS) {
      const result = await runViewport(browser, vp);
      report.viewports.push(result);
      if (!result.pass) {
        report.pass = false;
        fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
        console.error("[iu-pd-settings-first-open-filter-sync-guard] FAIL " + vp.id);
        for (const f of result.fails) console.error(" - " + f);
        process.exit(1);
      }
      console.log(
        "[iu-pd-settings-first-open-filter-sync-guard] OK " +
          vp.id +
          " openMs=" +
          Math.round(result.openTiming.ms)
      );
    }
  } finally {
    try {
      await browser.close();
    } catch (_) {}
    try {
      server.close();
    } catch (_) {}
  }

  report.pass = true;
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log("[iu-pd-settings-first-open-filter-sync-guard] PASS");
  console.log("RESULT=PASS");
}

main().catch((err) => {
  console.error("[iu-pd-settings-first-open-filter-sync-guard] FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
