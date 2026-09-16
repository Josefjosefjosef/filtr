#!/usr/bin/env node
/**
 * Calendar "📍 Spustit navigaci" must use shared external-open (iuNetwork), not raw window.open.
 *
 * Root cause class (2026-09-16):
 *   bindDayTimelineUi used window.open(mapy.cz/z?..., "_blank", "noopener") —
 *   on mobile/PWA that left about:blank / system "Hotovo" webview while UL still
 *   opened the map app (blink + orphan context). Shared iuNetwork.openExternalUrl
 *   already enforces single <a target=_blank> + return arming.
 *
 * Contract:
 *   - openCalendarAddressNavigation → iuNetwork.openExternalUrl / openExternalSync
 *   - No window.open on data-iu-cal-pin path
 *   - Stable HTTPS web fallback (mapy.cz/zakladni?q=), not legacy /z? redirect chain
 *   - Calendar overlay is intentional on external return (no shell strip / MindMenu remount)
 *   - Runtime: one click → exactly one openExternalSync (no about:blank)
 *
 * Run: npm run iu-calendar-nav-external-open-guard
 */
import fs from "fs";
import path from "path";
import http from "http";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8953", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?section=media&iuInfoSystem=cutover&nosw=1`;
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function staticGate() {
  const cal = read("assets/iu-calendar-overlay-v1.js");
  const net = read("assets/iu-network-connectivity-v1.js");
  const app = read("assets/app.js");

  must(/function openCalendarAddressNavigation\s*\(/.test(cal), "static:open_nav_fn");
  must(
    /openCalendarAddressNavigation\(q\)/.test(cal) && /data-iu-cal-pin/.test(cal),
    "static:pin_calls_open_nav"
  );
  must(
    /iuNetwork\.openExternalUrl/.test(cal) && /mapy\.cz\/zakladni\?q=/.test(cal),
    "static:uses_iuNetwork_and_zakladni"
  );
  must(!/mapy\.cz\/z\?q=/.test(cal), "static:no_legacy_z_redirect_url");
  must(
    !/data-iu-cal-pin[\s\S]{0,500}window\.open\s*\(\s*["']https:\/\/mapy/.test(cal) &&
      !/getAttribute\(\s*["']data-iu-cal-pin["'][\s\S]{0,200}window\.open\s*\(/.test(cal),
    "static:no_window_open_on_pin_handler"
  );
  must(
    /"iu-calendarOverlay-open"/.test(net) && /getElementById\("iuCalendarOverlay"\)/.test(net),
    "static:calendar_intentional_overlay"
  );
  must(/calendar-nav-external-open-v1-20260916/.test(app), "static:app_cal_cache_bust");
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

async function runPlaywright() {
  const server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
    cwd: REPO,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });
  try {
    await waitForPort("127.0.0.1", PORT, 30000);
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await bootstrapGuardContext(browser, {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      });
      await context.addInitScript(() => {
        try {
          Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true });
        } catch (_) {}
        try {
          const orig = window.matchMedia.bind(window);
          window.matchMedia = (q) => {
            if (String(q).includes("display-mode: standalone")) {
              return {
                matches: true,
                media: q,
                onchange: null,
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
      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 45000 });
      await page.waitForFunction(
        () => window.iuNetwork && typeof window.iuNetwork.openExternalSync === "function",
        { timeout: 60000 }
      );

      const result = await page.evaluate(async () => {
        const results = [];
        const blankHrefs = [];
        const origUrl = window.iuNetwork.openExternalUrl.bind(window.iuNetwork);
        window.iuNetwork.openExternalUrl = function (url, opts) {
          const p = Promise.resolve(origUrl(url, opts));
          return p.then(function (r) {
            results.push({ url: String(url || ""), reason: r && r.reason, ok: !!(r && r.ok) });
            return r;
          });
        };
        const origOpen = window.open.bind(window);
        window.open = function (url, target, features) {
          const u = String(url || "");
          if (!u || u === "about:blank" || u.indexOf("about:blank") === 0) blankHrefs.push(u || "about:blank");
          return origOpen(url, target, features);
        };

        document.body.classList.add("iu-calendarOverlay-open");
        let ov = document.getElementById("iuCalendarOverlay");
        if (!ov) {
          ov = document.createElement("div");
          ov.id = "iuCalendarOverlay";
          ov.className = "iu-calendarOverlay";
          document.body.appendChild(ov);
        }
        ov.hidden = false;
        ov.removeAttribute("hidden");

        const addr = "Praha, Václavské náměstí 1";
        const url = "https://mapy.cz/zakladni?q=" + encodeURIComponent(addr);
        await window.iuNetwork.openExternalUrl(url);
        await window.iuNetwork.openExternalUrl(url);
        await new Promise((r) => setTimeout(r, 50));

        const intentional =
          typeof window.iuNetwork.hasIntentionalToolOverlayOpen === "function" &&
          window.iuNetwork.hasIntentionalToolOverlayOpen() === true;

        try {
          sessionStorage.setItem("iu_external_nav_armed", "1");
        } catch (_) {}
        if (typeof window.iuNetwork.restoreAppShellAfterReturn === "function") {
          window.iuNetwork.restoreAppShellAfterReturn();
        }
        const stillOpen = document.body.classList.contains("iu-calendarOverlay-open");
        const calEl = document.getElementById("iuCalendarOverlay");
        const calVisible = !!(calEl && !calEl.hidden);

        window.iuNetwork.openExternalUrl = origUrl;
        window.open = origOpen;

        return {
          results,
          blankHrefs,
          intentional,
          stillOpen,
          calVisible,
          urlsOk: results.every((c) => /mapy\.cz\/zakladni\?q=/.test(c.url)),
          firstOk: !!(results[0] && results[0].ok),
          secondDeduped: !!(results[1] && results[1].reason === "deduped"),
        };
      });

      must(result.results.length === 2, "runtime:two_api_calls:" + result.results.length);
      must(result.firstOk, "runtime:first_open_ok:" + JSON.stringify(result.results[0]));
      must(result.secondDeduped, "runtime:second_deduped:" + JSON.stringify(result.results[1]));
      must(result.urlsOk, "runtime:zakladni_urls:" + JSON.stringify(result.results));
      must(result.blankHrefs.length === 0, "runtime:no_about_blank:" + JSON.stringify(result.blankHrefs));
      must(result.intentional === true, "runtime:calendar_intentional");
      must(result.stillOpen && result.calVisible, "runtime:calendar_preserved_after_return");
    } finally {
      await browser.close();
    }
  } finally {
    try {
      server.kill("SIGTERM");
    } catch (_) {}
  }
}

async function main() {
  staticGate();
  if (fails.length) {
    console.log("FAIL " + fails.join(" | "));
    process.exit(1);
  }
  await runPlaywright();
  if (fails.length) {
    console.log("FAIL " + fails.join(" | "));
    process.exit(1);
  }
  console.log("PASS iu-calendar-nav-external-open-guard");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
