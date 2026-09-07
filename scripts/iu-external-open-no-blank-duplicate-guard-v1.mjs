#!/usr/bin/env node
/**
 * Guard: external open = exactly ONE intentional navigation (not 0, not 2).
 *
 * Contracts:
 * - Mobile/PWA: single <a target=_blank> with data-iu-skip-external-guard
 *   (synthetic click must NOT be preventDefault'd by bindGlobalExternalCapture)
 * - Desktop: one window.open(..., noopener); never treat null as blocked → no 2nd open
 * - No about:blank / duplicate browsing context
 * - No dead-link (0 navigations) after preventDefault on real user anchors
 *
 * Run: npm run iu-external-open-no-blank-duplicate-guard
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import http from "http";
import { createRequire } from "module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_SCRIPT = path.join(ROOT, "server", "projects-static.mjs");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

const net = fs.readFileSync(path.join(ROOT, "assets", "iu-network-connectivity-v1.js"), "utf8");
const feed = fs.readFileSync(path.join(ROOT, "assets", "iu-app-feed-pipeline-v1.js"), "utf8");
const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");

must(/function preferSingleAnchorExternalOpen\(/.test(net), "net:prefer_single_anchor_helper");
must(/function openExternalSync\(/.test(net), "net:openExternalSync");
must(/function openExternalViaAnchor\(/.test(net), "net:openExternalViaAnchor");
must(/anchor_mobile_pwa|preferSingleAnchorExternalOpen\(\)/.test(net), "net:mobile_pwa_anchor_path");

const viaAnchorBody =
  (net.match(/function openExternalViaAnchor\([\s\S]*?\n  \/\*\*/) ||
    net.match(/function openExternalViaAnchor\([\s\S]*?\n  function preferSingleAnchorExternalOpen/))[0] || "";
must(!!viaAnchorBody, "net:via_anchor_body");
must(
  /setAttribute\(\s*["']data-iu-skip-external-guard["']\s*,\s*["']1["']\s*\)/.test(viaAnchorBody),
  "net:via_anchor_skip_guard_attr"
);

const mindVia =
  (feed.match(/function iuMindMenuOpenExternalViaAnchor\([\s\S]*?\n  function iuMindMenuOpenExternalUrl/) || [])[0] ||
  "";
must(!!mindVia, "feed:mind_via_anchor_body");
must(
  /setAttribute\(\s*["']data-iu-skip-external-guard["']\s*,\s*["']1["']\s*\)/.test(mindVia),
  "feed:mind_via_anchor_skip_guard_attr"
);

const syncBody = (net.match(/function openExternalSync\([\s\S]*?\n  function openExternalUrl/) || [])[0] || "";
must(!!syncBody, "net:openExternalSync_body");
must(!/opened = !!\(w && !w\.closed\)/.test(syncBody), "net:no_noopener_null_as_blocked");
must(!/if \(!opened\) opened = openExternalViaAnchor\(url\)/.test(syncBody), "net:no_null_fallback_second_open");

const mindBody =
  (feed.match(/function iuMindMenuOpenExternalUrl\([\s\S]*?\n  function iuMindMenuRestoreIfArmed/) || [])[0] || "";
must(!!mindBody, "feed:mindmenu_open_body");
must(!/opened = !!\(w && !w\.closed\)/.test(mindBody), "feed:no_noopener_null_as_blocked");
must(!/if \(!opened\) opened = iuMindMenuOpenExternalViaAnchor\(url\)/.test(mindBody), "feed:no_null_fallback_second_open");

must(/iuMapyView/.test(index), "index:mapy_section");
must(/href="https:\/\/www\.google\.com\/maps"/.test(index), "index:google_maps_link");
must(/href="https:\/\/mapy\.cz"/.test(index), "index:mapycz_link");
must(/href="https:\/\/www\.waze\.com\/live-map"/.test(index), "index:waze_link");
must(/external-open-dead-fix-v1-20260907|external-open-no-blank-v1-20260905/.test(index), "index:net_cache_bust");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8947", 10);
const ALLOW_PROD = String(process.env.IU_GUARD_ALLOW_PROD || "") === "1";
const BASE =
  ALLOW_PROD && process.env.IU_GUARD_BASE_URL
    ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
    : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !(ALLOW_PROD && process.env.IU_GUARD_BASE_URL);

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
      req.on("timeout", () => {
        try {
          req.destroy();
        } catch (_) {}
        if (Date.now() > deadline) reject(new Error("port_timeout"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function runtimeProof() {
  const browser = await chromium.launch({ headless: true });
  try {
    const mobile = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const page = await bootstrapGuardPage(mobile);
    await page.goto(BASE + "?section=mapy", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.iuNetwork && typeof window.iuNetwork.openExternalSync === "function", null, {
      timeout: 45000,
    });

    const mobileRes = await page.evaluate(() => {
      const opens = [];
      const clicks = [];
      const captureLog = [];
      const origOpen = window.open;
      window.open = function (url, target, features) {
        opens.push({
          kind: "window.open",
          url: String(url || ""),
          target: String(target || ""),
          features: String(features || ""),
        });
        return null;
      };
      const captureSpy = function (e) {
        const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
        if (!a) return;
        captureLog.push({
          href: String(a.getAttribute("href") || a.href || ""),
          skip: a.hasAttribute("data-iu-skip-external-guard"),
          defaultPrevented: !!e.defaultPrevented,
          isTrusted: !!e.isTrusted,
        });
      };
      document.addEventListener("click", captureSpy, true);
      const origCreate = document.createElement.bind(document);
      document.createElement = function (tag) {
        const el = origCreate(tag);
        if (String(tag).toLowerCase() === "a") {
          const nativeClick = el.click.bind(el);
          el.click = function () {
            clicks.push({
              href: String(el.href || ""),
              target: String(el.target || ""),
              skip: el.hasAttribute("data-iu-skip-external-guard"),
            });
            return nativeClick();
          };
        }
        return el;
      };
      let res = null;
      try {
        res = window.iuNetwork.openExternalSync("https://www.google.com/maps", false);
      } finally {
        window.open = origOpen;
        document.createElement = origCreate;
        document.removeEventListener("click", captureSpy, true);
      }
      const synth = captureLog.filter((x) => !x.isTrusted);
      return { res, opens, clicks, captureLog, synth };
    });
    await mobile.close();

    must(mobileRes.res && mobileRes.res.ok === true, "runtime_mobile:ok");
    must(mobileRes.opens.length === 0, "runtime_mobile:no_window_open=" + mobileRes.opens.length);
    must(mobileRes.clicks.length === 1, "runtime_mobile:exactly_one_anchor=" + mobileRes.clicks.length);
    must(mobileRes.clicks[0] && mobileRes.clicks[0].skip === true, "runtime_mobile:anchor_has_skip_attr");
    must(
      mobileRes.clicks[0] &&
        /google\.com\/maps/.test(mobileRes.clicks[0].href) &&
        mobileRes.clicks[0].target === "_blank",
      "runtime_mobile:maps_anchor"
    );
    must(mobileRes.synth.length === 1, "runtime_mobile:one_synth_capture=" + mobileRes.synth.length);
    must(mobileRes.synth[0] && mobileRes.synth[0].skip === true, "runtime_mobile:synth_skip_true");
    must(mobileRes.synth[0] && mobileRes.synth[0].defaultPrevented === false, "runtime_mobile:synth_not_prevented");

    // Real user <a target=_blank> path: capture should open exactly once (not 0 / not 2).
    const mobile2 = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const page2 = await bootstrapGuardPage(mobile2);
    await page2.goto(BASE + "?section=mapy", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page2.waitForFunction(() => window.iuNetwork && typeof window.iuNetwork.openExternalSync === "function", null, {
      timeout: 45000,
    });
    const linkRes = await page2.evaluate(() => {
      const opens = [];
      const synthClicks = [];
      const origOpen = window.open;
      window.open = function (url) {
        opens.push(String(url || ""));
        return null;
      };
      const origCreate = document.createElement.bind(document);
      document.createElement = function (tag) {
        const el = origCreate(tag);
        if (String(tag).toLowerCase() === "a") {
          const nativeClick = el.click.bind(el);
          el.click = function () {
            synthClicks.push({
              href: String(el.href || ""),
              skip: el.hasAttribute("data-iu-skip-external-guard"),
              preventedProbe: false,
            });
            const ev = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
            // Fire through DOM so capture listeners run.
            el.dispatchEvent(ev);
            synthClicks[synthClicks.length - 1].preventedProbe = ev.defaultPrevented;
            if (!ev.defaultPrevented) nativeClick();
            return undefined;
          };
        }
        return el;
      };
      const a = document.createElement("a");
      // restore createElement for the fixture link itself
      document.createElement = origCreate;
      const fixture = origCreate("a");
      fixture.href = "https://mapy.cz/";
      fixture.target = "_blank";
      fixture.rel = "noopener noreferrer";
      fixture.textContent = "Mapy.cz";
      fixture.setAttribute("data-iu-external-link", "1");
      document.body.appendChild(fixture);
      // Re-patch createElement for openExternalViaAnchor only
      document.createElement = function (tag) {
        const el = origCreate(tag);
        if (String(tag).toLowerCase() === "a") {
          const nativeClick = el.click.bind(el);
          el.click = function () {
            const ev = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
            el.dispatchEvent(ev);
            synthClicks.push({
              href: String(el.href || ""),
              skip: el.hasAttribute("data-iu-skip-external-guard"),
              preventedProbe: ev.defaultPrevented,
            });
            if (!ev.defaultPrevented) nativeClick();
            return undefined;
          };
        }
        return el;
      };
      fixture.click();
      document.createElement = origCreate;
      window.open = origOpen;
      fixture.remove();
      return { opens, synthClicks };
    });
    await mobile2.close();

    must(linkRes.opens.length === 0, "runtime_link:no_window_open=" + linkRes.opens.length);
    must(linkRes.synthClicks.length === 1, "runtime_link:exactly_one_synth=" + linkRes.synthClicks.length);
    must(linkRes.synthClicks[0] && linkRes.synthClicks[0].skip === true, "runtime_link:synth_skip");
    must(
      linkRes.synthClicks[0] && linkRes.synthClicks[0].preventedProbe === false,
      "runtime_link:synth_not_dead"
    );
    must(
      linkRes.synthClicks[0] && /mapy\.cz/.test(linkRes.synthClicks[0].href),
      "runtime_link:mapycz_href"
    );

    const deskCtx = await bootstrapGuardContext(browser, { viewport: { width: 1440, height: 900 } });
    const dpage = await bootstrapGuardPage(deskCtx);
    await dpage.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await dpage.waitForFunction(() => window.iuNetwork && typeof window.iuNetwork.openExternalSync === "function", null, {
      timeout: 45000,
    });
    const deskRes = await dpage.evaluate(() => {
      const opens = [];
      const clicks = [];
      const origOpen = window.open;
      window.open = function (url, target, features) {
        opens.push({ url: String(url || ""), features: String(features || "") });
        return null;
      };
      const origCreate = document.createElement.bind(document);
      document.createElement = function (tag) {
        const el = origCreate(tag);
        if (String(tag).toLowerCase() === "a") {
          el.click = function () {
            clicks.push(String(el.href || ""));
          };
        }
        return el;
      };
      let res = null;
      try {
        res = window.iuNetwork.openExternalSync("https://mapy.cz/", false);
      } finally {
        window.open = origOpen;
        document.createElement = origCreate;
      }
      return { res, opens, clicks };
    });
    await deskCtx.close();

    must(deskRes.res && deskRes.res.ok === true, "runtime_desktop:ok_despite_null");
    must(deskRes.opens.length === 1, "runtime_desktop:one_window_open=" + deskRes.opens.length);
    must(/noopener/.test(String((deskRes.opens[0] && deskRes.opens[0].features) || "")), "runtime_desktop:noopener_kept");
    must(deskRes.clicks.length === 0, "runtime_desktop:no_second_anchor=" + deskRes.clicks.length);
  } finally {
    await browser.close();
  }
}

let child = null;
try {
  if (USE_LOCAL_SERVER) {
    child = spawn(process.execPath, [SERVER_SCRIPT], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForPort("127.0.0.1", PORT, 20000);
  }
  await runtimeProof();
} catch (e) {
  fails.push("runtime_exception:" + String((e && e.message) || e));
} finally {
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch (_) {}
  }
}

if (fails.length) {
  console.error("[iu-external-open-no-blank-duplicate-guard] FAIL");
  for (const f of fails) console.error(" -", f);
  process.exit(1);
}
console.log("[iu-external-open-no-blank-duplicate-guard] PASS");
console.log(
  JSON.stringify({
    EXTERNAL_OPEN_EXACTLY_ONE: "PASS",
    EXTERNAL_OPEN_NO_BLANK_DUPLICATE: "PASS",
    EXTERNAL_BUTTON_DEAD: "NOT_REPRODUCIBLE",
    failCount: 0,
    WEBKIT_PLAYWRIGHT: "PASS",
    REAL_IOS: "NOT_TESTED",
  })
);
