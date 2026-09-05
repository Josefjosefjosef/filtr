#!/usr/bin/env node
"use strict";
/**
 * Reload visual stability contract (FOUC / stale shell / blank flash).
 * Static: SW HTML + layout-critical CSS network-first; critical shell CSS; no boot root wipe.
 * Runtime (optional): local reload CLS + #app not emptied during boot.
 */
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const { createRequire } = require("module");

const REPO = path.resolve(__dirname, "..");
const req = createRequire(path.join(REPO, "package.json"));
const { chromium } = req("playwright");
const OUT = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "iu_reload_visual_stability_contract_guard.json");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8897", 10);
const CLS_CAP = 0.15;
const SKIP_RUNTIME = process.env.IU_RELOAD_VISUAL_SKIP_RUNTIME === "1";

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function sliceBetween(src, startNeedle, endNeedle) {
  const a = src.indexOf(startNeedle);
  if (a < 0) return "";
  const b = endNeedle ? src.indexOf(endNeedle, a) : src.length;
  if (b < 0) return src.slice(a);
  return src.slice(a, b);
}

function staticContract() {
  const fails = [];
  const sw = read("sw.js");
  const index = read("projects/index.html");
  const appJs = read("assets/app.js");
  const smoke = read(path.join(".github", "workflows", "smoke.yml"));
  const pkg = read("package.json");

  if (sw.indexOf("networkFirstNoStore") < 0) fails.push("sw_missing_networkFirstNoStore");
  if (sw.indexOf('event.request.mode === "navigate"') < 0 && sw.indexOf("destination === \"document\"") < 0) {
    fails.push("sw_missing_navigate_document_gate");
  }

  const layoutBlock = sliceBetween(sw, "Layout-critical CSS: network-first", "// CSS/JS assets: stale-while-revalidate");
  if (!layoutBlock) fails.push("sw_missing_layout_critical_css_network_first_block");
  else {
    const need = [
      "/assets/app.css",
      "/assets/iu-prehled-dne-v1.css",
      "/assets/iu-mindmenu-bottom-nav-restore-v1.css",
      "/assets/iu-overlay-mobile-tablet-unified-v1.css",
      "/assets/iu-silver-premium-draft.css",
      "/assets/iu-desktop-home-premium.css",
      "/assets/iu-tasks-premium.css",
    ];
    for (const p of need) {
      if (layoutBlock.indexOf(p) < 0) fails.push("sw_layout_css_missing:" + p);
    }
    if (layoutBlock.indexOf('cache: "no-store"') < 0) fails.push("sw_layout_css_missing_no_store");
  }

  const swrIdx = sw.indexOf("// CSS/JS assets: stale-while-revalidate");
  const layoutIdx = sw.indexOf("Layout-critical CSS: network-first");
  if (layoutIdx < 0 || swrIdx < 0 || layoutIdx >= swrIdx) {
    fails.push("sw_layout_css_must_precede_generic_swr");
  }

  const appJsIdx = sw.indexOf('path.includes("/assets/app.js")');
  if (appJsIdx < 0 || appJsIdx >= layoutIdx) fails.push("sw_app_js_network_first_order");

  if (index.indexOf("Reload visual stability: hold viewport height") < 0) {
    fails.push("index_missing_reload_visual_stability_marker");
  }
  if (!/html,\s*body\s*\{[^}]*min-height:\s*100svh/s.test(index)) {
    fails.push("index_missing_html_body_min_height_svh");
  }
  if (!/#app\s*\{[^}]*min-height:\s*100svh/s.test(index)) {
    fails.push("index_missing_app_min_height_svh");
  }

  if (/document\.body\.innerHTML\s*=\s*["']\s*["']/.test(appJs)) {
    fails.push("appjs_body_innerhtml_wipe");
  }
  if (/getElementById\(\s*["']app["']\s*\)\.innerHTML\s*=\s*["']\s*["']/.test(appJs)) {
    fails.push("appjs_app_innerhtml_wipe");
  }

  if (pkg.indexOf("iu-reload-visual-stability-contract-guard") < 0) {
    fails.push("package_json_missing_script");
  }
  if (smoke.indexOf("iu-reload-visual-stability-contract-guard") < 0) {
    fails.push("smoke_yml_missing_guard");
  }

  const {
    swHasAllowedCacheVersion,
  } = require("./guards/iu-sw-cache-version-allowlist.cjs");
  if (!swHasAllowedCacheVersion(sw)) {
    fails.push("sw_cache_version_token_missing");
  }

  return fails;
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const reqHttp = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      reqHttp.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      reqHttp.end();
    };
    tryOnce();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runtimeContract() {
  const server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
    cwd: REPO,
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverErr = "";
  server.stderr.on("data", (d) => {
    serverErr += String(d);
  });
  try {
    await waitForPort("127.0.0.1", PORT, 20000);
  } catch (e) {
    try {
      server.kill();
    } catch (_) {}
    return { ok: false, fails: ["runtime_server_not_up:" + String(e && e.message || e), serverErr.slice(0, 200)] };
  }

  const browser = await chromium.launch({ headless: true });
  const fails = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await context.addInitScript(() => {
      try {
        localStorage.setItem("iu_local_data_protection_accepted", "1");
      } catch (_) {}
      try {
        window.__iuReloadVisProbe = { emptied: false, emptyHits: 0 };
        const arm = () => {
          const app = document.getElementById("app");
          if (!app || app.__iuReloadVisArmed) return;
          app.__iuReloadVisArmed = true;
          const mo = new MutationObserver(() => {
            if (app.childNodes.length === 0) {
              window.__iuReloadVisProbe.emptied = true;
              window.__iuReloadVisProbe.emptyHits += 1;
            }
          });
          mo.observe(app, { childList: true, subtree: false });
        };
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", arm, { once: true });
        } else {
          arm();
        }
        try {
          new PerformanceObserver((list) => {
            window.__iuReloadVisProbe = window.__iuReloadVisProbe || {};
            window.__iuReloadVisProbe.cls = window.__iuReloadVisProbe.cls || 0;
            for (const e of list.getEntries()) {
              if (e && e.hadRecentInput) continue;
              window.__iuReloadVisProbe.cls += e.value || 0;
            }
          }).observe({ type: "layout-shift", buffered: true });
        } catch (_) {}
      } catch (_) {}
    });

    const page = await context.newPage();
    const url = "http://127.0.0.1:" + PORT + "/projects/";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#app", { timeout: 30000 });
    await sleep(600);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#app", { timeout: 30000 });
    await sleep(2500);

    const probe = await page.evaluate(() => {
      const app = document.getElementById("app");
      const p = window.__iuReloadVisProbe || {};
      let cls = typeof p.cls === "number" ? p.cls : 0;
      try {
        const entries = performance.getEntriesByType("layout-shift");
        for (const e of entries) {
          if (e && e.hadRecentInput) continue;
          cls += e.value || 0;
        }
      } catch (_) {}
      return {
        emptied: !!p.emptied,
        emptyHits: p.emptyHits || 0,
        cls,
        appPresent: !!app,
        appChildren: app ? app.childNodes.length : 0,
        htmlMinH: getComputedStyle(document.documentElement).minHeight,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        vaultInit: document.documentElement.classList.contains("iu-vault-app-init"),
      };
    });

    if (probe.emptied) fails.push("runtime_app_emptied_during_reload");
    if (!probe.appPresent) fails.push("runtime_app_missing_after_reload");
    if (probe.appChildren < 1) fails.push("runtime_app_no_children_after_reload");
    if (probe.cls > CLS_CAP) fails.push("runtime_cls_over_cap:" + String(probe.cls));
    return { ok: fails.length === 0, fails, probe };
  } finally {
    try {
      await browser.close();
    } catch (_) {}
    try {
      server.kill();
    } catch (_) {}
  }
}

async function main() {
  const staticFails = staticContract();
  let runtime = { ok: true, fails: [], skipped: true };
  if (!SKIP_RUNTIME && staticFails.length === 0) {
    runtime = await runtimeContract();
    runtime.skipped = false;
  } else if (SKIP_RUNTIME) {
    runtime = { ok: true, fails: [], skipped: true };
  }

  const allFails = staticFails.concat(runtime.fails || []);
  const report = {
    ok: allFails.length === 0,
    staticFails,
    runtime,
    REAL_IOS_RELOAD_TEST: "NOT_TESTED",
  };
  try {
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
  } catch (_) {}

  if (allFails.length) {
    console.error("[iu-reload-visual-stability-contract-guard-v1] FAIL");
    for (const f of allFails) console.error(" - " + f);
    process.exit(1);
  }
  console.log("[iu-reload-visual-stability-contract-guard-v1] PASS");
  console.log("REAL_IOS_RELOAD_TEST: NOT_TESTED");
}

main().catch((err) => {
  console.error("[iu-reload-visual-stability-contract-guard-v1] FAIL");
  console.error(String(err && err.stack || err));
  process.exit(1);
});
