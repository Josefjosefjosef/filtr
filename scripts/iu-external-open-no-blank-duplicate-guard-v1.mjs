#!/usr/bin/env node
/**
 * Guard: external open must not create duplicate browsing contexts.
 * Root cause: window.open(..., "noopener") returns null → false "blocked"
 * → second open via <a target=_blank> → about:blank / PWA "Hotovo" sheet.
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
must(/anchor_mobile_pwa|preferSingleAnchorExternalOpen\(\)/.test(net), "net:mobile_pwa_anchor_path");

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

const PORT = parseInt(process.env.IU_GUARD_PORT || "8947", 10);
const ALLOW_PROD = String(process.env.IU_GUARD_ALLOW_PROD || "") === "1";
const BASE = ALLOW_PROD && process.env.IU_GUARD_BASE_URL
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
      const origCreate = document.createElement.bind(document);
      document.createElement = function (tag) {
        const el = origCreate(tag);
        if (String(tag).toLowerCase() === "a") {
          el.click = function () {
            clicks.push({ href: String(el.href || ""), target: String(el.target || "") });
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
      }
      return { res, opens, clicks };
    });
    await mobile.close();

    must(mobileRes.res && mobileRes.res.ok === true, "runtime_mobile:ok");
    must(mobileRes.opens.length === 0, "runtime_mobile:no_window_open=" + mobileRes.opens.length);
    must(mobileRes.clicks.length === 1, "runtime_mobile:exactly_one_anchor=" + mobileRes.clicks.length);
    must(
      mobileRes.clicks[0] &&
        /google\.com\/maps/.test(mobileRes.clicks[0].href) &&
        mobileRes.clicks[0].target === "_blank",
      "runtime_mobile:maps_anchor"
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
console.log(JSON.stringify({ EXTERNAL_OPEN_NO_BLANK_DUPLICATE: "PASS", failCount: 0, REAL_IOS: "NOT_TESTED" }));
