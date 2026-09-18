#!/usr/bin/env node
/**
 * Freeze guard: PWA/desktop window title must not double the brand.
 *
 * Root cause: Windows Chromium/Edge titlebar = manifest.name + " – " + page title.
 * Legacy <title>InfoUzel.cz – …</title> + short_name "infoUzel.cz" (case mismatch)
 * produced: "infoUzel.cz – InfoUzel.cz – internet v internetu".
 *
 * Run: npm run iu-pwa-window-title-no-dup-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";
import { swHasAllowedCacheVersion } from "./guards/iu-sw-cache-version-allowlist.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const APP_NAME = "infoUzel.cz";
const TAGLINE = "internet v internetu";
const BROWSER_TITLE = APP_NAME + " \u2013 " + TAGLINE;
const PWA_SUBTITLE = TAGLINE;
const CACHE_TOKEN = "2026-09-18-pwa-title-no-dup-v1";
const SCRIPT_BUST = "pwa-title-no-dup-v1-20260918";
const PORT = parseInt(process.env.IU_GUARD_PORT || "8967", 10);
const REPORT = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  "iu_pwa_window_title_no_dup_guard.json"
);

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function auditStatic() {
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const offline = fs.readFileSync(path.join(ROOT, "offline.html"), "utf8");
  const cssJs = fs.readFileSync(path.join(ROOT, "assets", "iu-pwa-window-title-v1.js"), "utf8");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const allow = fs.readFileSync(
    path.join(ROOT, "scripts", "guards", "iu-sw-cache-version-allowlist.cjs"),
    "utf8"
  );
  const rootMf = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const projMf = JSON.parse(fs.readFileSync(path.join(ROOT, "projects", "manifest.json"), "utf8"));

  const title = (index.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
  ok("static:title_exact", title === BROWSER_TITLE, title);
  ok("static:title_prefix_case", title.startsWith(APP_NAME));
  ok("static:no_Info_title_casing", !/<title>InfoUzel\.cz/.test(index));
  ok(
    "static:application_title",
    /<meta\s+name="application-title"\s+content="internet v internetu"\s*\/?>/.test(index)
  );
  ok(
    "static:application_name",
    /<meta\s+name="application-name"\s+content="infoUzel\.cz"\s*\/?>/.test(index)
  );
  ok(
    "static:apple_title",
    /<meta\s+name="apple-mobile-web-app-title"\s+content="infoUzel\.cz"\s*\/?>/.test(index)
  );
  ok("static:script_linked", index.includes("iu-pwa-window-title-v1.js") && index.includes(SCRIPT_BUST));
  ok("static:script_marker", cssJs.includes("pwa-title-no-dup-v1-20260918"));
  ok("static:script_sets_subtitle", cssJs.includes('PWA_SUBTITLE') && cssJs.includes(TAGLINE));
  ok("static:manifest_root", rootMf.name === APP_NAME && rootMf.short_name === APP_NAME);
  ok("static:manifest_projects", projMf.name === APP_NAME && projMf.short_name === APP_NAME);
  ok(
    "static:og_keeps_seo_brand",
    /property="og:title"\s+content="InfoUzel\.cz – internet v internetu"/.test(index) ||
      /property="og:title" content="InfoUzel\.cz \u2013 internet v internetu"/.test(index) ||
      /content="InfoUzel\.cz – internet v internetu"/.test(index)
  );
  ok(
    "static:no_doubled_source",
    !/infoUzel\.cz\s*[–-]\s*InfoUzel\.cz|InfoUzel\.cz\s*[–-]\s*InfoUzel\.cz/i.test(index)
  );
  ok("static:offline_title_no_brand_dup", /<title>Offline<\/title>/.test(offline));
  ok("static:offline_no_brand_in_title", !/<title>[^<]*infoUzel\.cz[^<]*<\/title>/i.test(offline));
  ok("sw_cache_allowed", swHasAllowedCacheVersion(sw));
  ok("allowlist_token", allow.includes(CACHE_TOKEN));
  ok("sw_token_present", sw.includes(CACHE_TOKEN));
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

auditStatic();
if (fails.length) {
  const out = { IU_PWA_WINDOW_TITLE_NO_DUP_GUARD: "FAIL", phase: "static", fails };
  fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

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
            : fp.endsWith(".json")
              ? "application/json; charset=utf-8"
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
const samples = [];
try {
  // Browser (tab) mode
  {
    const context = await bootstrapGuardContext(browser, {
      viewport: { width: 1280, height: 900 },
      hasTouch: false,
    });
    const page = await bootstrapGuardPage(context);
    await page.goto(`http://127.0.0.1:${PORT}/projects/?nosw=1&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForFunction(() => !!window.__iuPwaWindowTitleBooted, null, { timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(200);
    const title = await page.title();
    ok("runtime:browser:title", title === BROWSER_TITLE, title);
    ok(
      "runtime:browser:no_double",
      !/infoUzel\.cz\s*[–-]\s*InfoUzel\.cz/i.test(title) && !/InfoUzel\.cz\s*[–-]\s*InfoUzel\.cz/i.test(title),
      title
    );
    samples.push({ mode: "browser", title });
    await context.close();
  }

  // Installed PWA standalone
  {
    const context = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    await context.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "standalone", { get: () => true });
      } catch (_) {}
      try {
        const mq = window.matchMedia;
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
          return mq.call(window, q);
        };
      } catch (_) {}
    });
    const page = await bootstrapGuardPage(context);
    await page.goto(`http://127.0.0.1:${PORT}/projects/?nosw=1&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForFunction(() => !!window.__iuPwaWindowTitleBooted, null, { timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(200);
    const title = await page.title();
    const appTitle = await page.evaluate(() => {
      const m = document.querySelector('meta[name="application-title"]');
      return m ? m.getAttribute("content") || "" : "";
    });
    const composed = APP_NAME + " \u2013 " + (appTitle || title);
    ok("runtime:pwa:document_title_subtitle", title === PWA_SUBTITLE, title);
    ok("runtime:pwa:application_title", appTitle === PWA_SUBTITLE, appTitle);
    ok("runtime:pwa:composed_expected", composed === BROWSER_TITLE, composed);
    ok(
      "runtime:pwa:no_double_brand",
      !/infoUzel\.cz\s*[–-]\s*InfoUzel\.cz/i.test(composed) &&
        !/InfoUzel\.cz\s*[–-]\s*infoUzel\.cz/i.test(composed) &&
        (composed.match(/infoUzel\.cz/gi) || []).length === 1,
      composed
    );
    samples.push({ mode: "pwa", title, appTitle, composed });
    await context.close();
  }
} catch (err) {
  fails.push("runtime_exception:" + (err && err.message ? err.message : String(err)));
} finally {
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}

const pass = fails.length === 0;
const out = {
  IU_PWA_WINDOW_TITLE_NO_DUP_GUARD: pass ? "PASS" : "FAIL",
  samples,
  fails,
};
fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
