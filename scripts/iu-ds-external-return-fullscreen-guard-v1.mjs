#!/usr/bin/env node
/**
 * Datové schránky — after external login tab return, keep mobile/tablet fullscreen shell.
 * Root cause class: restoreAppShellAfterReturn must not strip iu-modal-open while
 * iu-ds-overlay-open (intentional tool overlay) is active.
 *
 * Run: npm run iu-ds-external-return-fullscreen-guard
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8937", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;

const VIEWPORTS = [
  { name: "MOBILE", width: 390, height: 844 },
  { name: "TABLET", width: 768, height: 1024 },
];

function auditStatic() {
  const fails = [];
  const net = fs.readFileSync(path.join(REPO, "assets", "iu-network-connectivity-v1.js"), "utf8");
  const app = fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8");
  const feed = fs.readFileSync(path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js"), "utf8");
  const index = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(REPO, "sw.js"), "utf8");

  if (!net.includes("hasIntentionalToolOverlayOpen")) fails.push("net:missing hasIntentionalToolOverlayOpen");
  if (!net.includes("INTENTIONAL_TOOL_OVERLAY_BODY_CLASSES")) fails.push("net:missing INTENTIONAL_TOOL_OVERLAY_BODY_CLASSES");
  if (!net.includes('"iu-ds-overlay-open"')) fails.push("net:missing iu-ds-overlay-open in intentional list");
  if (!net.includes("reassertIntentionalOverlayShell")) fails.push("net:missing reassertIntentionalOverlayShell");
  if (!/!hasIntentionalToolOverlayOpen\(\)/.test(net)) fails.push("net:shouldRestoreShell missing intentional guard");
  if (!/preserveModal\s*=\s*hasIntentionalToolOverlayOpen\(\)/.test(net)) {
    fails.push("net:clearShellErrorUiOnly missing preserveModal");
  }
  if (!/function iuDsOpenLoginInNewTab[\s\S]{0,700}openExternalUrl/.test(app)) {
    fails.push("app:iuDsOpenLoginInNewTab not routed via iuNetwork");
  }
  if (!feed.includes("hasIntentionalToolOverlayOpen")) fails.push("feed:MindMenu restore missing intentional overlay guard");
  if (
    !index.includes("ds-external-return-fullscreen-v1-20260903") &&
    !index.includes("silver-cal-save-enable-v1-20260904") &&
    !index.includes("wx-offline-online-reconnect-v1-20260904") &&
    !index.includes("silver-quick-notes-focus-v1-20260904") &&
    !index.includes("Reload visual stability: hold viewport height") &&
    !index.includes("cal-sheet-nav-stable-v1-20260904") &&
    !index.includes("cal-sheet-nav-stable-v2-20260904")
  ) {
    fails.push("index:missing cache bust token");
  }
  if (
    !sw.includes('CACHE_VERSION = "2026-09-06-traffic-first-batch-v1"') &&
    !sw.includes('CACHE_VERSION = "2026-09-05-chmi-first-paint-blue-v1"') &&
    !sw.includes('CACHE_VERSION = "2026-09-05-external-open-no-blank-v1"') &&
    !sw.includes('CACHE_VERSION = "2026-09-05-pd-filter-layout-save-no-window-v1"') &&
    !sw.includes('CACHE_VERSION = "2026-09-05-gdpr-vop-legal-v1"') &&
    !sw.includes('CACHE_VERSION = "2026-09-04-cal-sheet-nav-stable-v2"') &&
    !sw.includes('CACHE_VERSION = "2026-09-04-cal-sheet-nav-stable-v1"') &&
    !sw.includes('CACHE_VERSION = "2026-09-04-reload-visual-stability-v1"') &&
    !sw.includes('CACHE_VERSION = "2026-09-04-silver-quick-notes-focus-v1"') &&
    !sw.includes('CACHE_VERSION = "2026-09-04-wx-offline-online-reconnect-v1"') &&
    !sw.includes('CACHE_VERSION = "2026-09-04-silver-cal-save-enable-v1"') &&
    !sw.includes('CACHE_VERSION = "2026-09-03-ds-external-return-fullscreen-v1"')
  ) {
    fails.push("sw:missing CACHE_VERSION bump");
  }
  return fails;
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

async function openDatovkaViaGate(page) {
  await page.evaluate(() => {
    const gateTab = document.getElementById("iuMobileGateTabTools");
    if (gateTab) gateTab.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const btn = document.querySelector('[data-iuq="datovka"]');
    if (btn) btn.click();
    else if (typeof window.iuOpenOverlay === "function") window.iuOpenOverlay("datovka");
    else if (typeof window.iuDatovkaOpenSurface === "function") window.iuDatovkaOpenSurface();
  });
  await page.waitForFunction(() => {
    const p = document.getElementById("iuDsPanel");
    return !!(p && String(p.dataset.open || "") === "1" && !p.hasAttribute("hidden"));
  }, null, { timeout: 20000 });
}

async function snapshotLayout(page) {
  return page.evaluate(() => {
    const panel = document.getElementById("iuDsPanel");
    const r = panel ? panel.getBoundingClientRect() : null;
    return {
      modalOpen: document.body.classList.contains("iu-modal-open"),
      dsOpen: document.body.classList.contains("iu-ds-overlay-open"),
      panelOpen: !!(panel && String(panel.dataset.open || "") === "1"),
      panelParentIsBody: !!(panel && panel.parentElement === document.body),
      top: r ? Math.round(r.top) : null,
      left: r ? Math.round(r.left) : null,
      width: r ? Math.round(r.width) : null,
      height: r ? Math.round(r.height) : null,
      formUser: (() => {
        const el = document.querySelector("#iuDsPanel .iu-ds-f-user");
        return el ? String(el.value || "") : "";
      })(),
    };
  });
}

async function simulateExternalReturn(page, { armExternal, armMindMenu }) {
  await page.evaluate(
    ({ armExternal, armMindMenu }) => {
      try {
        if (armExternal) sessionStorage.setItem("iu_external_nav_armed", "1");
        else sessionStorage.removeItem("iu_external_nav_armed");
      } catch (_) {}
      try {
        if (armMindMenu) sessionStorage.setItem("iuMindMenuReturnArmed", "1");
        else sessionStorage.removeItem("iuMindMenuReturnArmed");
      } catch (_) {}
      if (window.iuNetwork && typeof window.iuNetwork.restoreAppShellAfterReturn === "function") {
        window.iuNetwork.restoreAppShellAfterReturn();
      }
      window.dispatchEvent(new Event("pageshow"));
      window.dispatchEvent(new Event("focus"));
      if (typeof window.iuMindMenuRestoreIfArmed === "function") window.iuMindMenuRestoreIfArmed();
      if (typeof window.iuMindMenuSyncGateFromHistory === "function") window.iuMindMenuSyncGateFromHistory();
    },
    { armExternal, armMindMenu }
  );
  await page.waitForTimeout(200);
}

async function runViewport(browser, vp) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const fails = [];
  try {
    await page.goto(BASE + "?nosw=1", { waitUntil: "load", timeout: 90000 });
    await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 });
    await page.waitForFunction(
      () => !!(window.iuNetwork && typeof window.iuNetwork.restoreAppShellAfterReturn === "function"),
      null,
      { timeout: 60000 }
    );
    await page.waitForTimeout(800);

    await openDatovkaViaGate(page);
    await page.evaluate(() => {
      const user = document.querySelector("#iuDsPanel .iu-ds-f-user");
      if (user) {
        user.value = "IU_DS_RETURN_MARKER";
        user.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    const before = await snapshotLayout(page);
    if (!before.modalOpen || !before.dsOpen || !before.panelOpen) {
      fails.push(`${vp.name}:before_missing_fullscreen_classes`);
    }
    if (!before.panelParentIsBody) fails.push(`${vp.name}:before_panel_not_in_body`);
    if (!(before.width >= Math.floor(vp.width * 0.9))) fails.push(`${vp.name}:before_width_too_narrow`);
    if (!(before.top <= 8)) fails.push(`${vp.name}:before_not_flush_top`);

    await simulateExternalReturn(page, { armExternal: false, armMindMenu: false });
    const afterA = await snapshotLayout(page);
    if (!afterA.modalOpen) fails.push(`${vp.name}:A_modal_stripped`);
    if (!afterA.dsOpen) fails.push(`${vp.name}:A_ds_stripped`);
    if (afterA.formUser !== "IU_DS_RETURN_MARKER") fails.push(`${vp.name}:A_form_reset`);
    if (Math.abs((afterA.width || 0) - (before.width || 0)) > 4) fails.push(`${vp.name}:A_width_changed`);
    if (Math.abs((afterA.top || 0) - (before.top || 0)) > 4) fails.push(`${vp.name}:A_top_changed`);

    await simulateExternalReturn(page, { armExternal: true, armMindMenu: true });
    const afterB = await snapshotLayout(page);
    if (!afterB.modalOpen) fails.push(`${vp.name}:B_modal_stripped`);
    if (!afterB.dsOpen) fails.push(`${vp.name}:B_ds_stripped`);
    if (afterB.formUser !== "IU_DS_RETURN_MARKER") fails.push(`${vp.name}:B_form_reset`);
    if (Math.abs((afterB.width || 0) - (before.width || 0)) > 4) fails.push(`${vp.name}:B_width_changed`);
    if (Math.abs((afterB.height || 0) - (before.height || 0)) > 24) fails.push(`${vp.name}:B_height_changed`);

    for (let i = 0; i < 3; i++) {
      await simulateExternalReturn(page, { armExternal: true, armMindMenu: true });
    }
    const afterLoop = await snapshotLayout(page);
    if (!afterLoop.modalOpen || !afterLoop.dsOpen) fails.push(`${vp.name}:loop_classes_lost`);
    if (Math.abs((afterLoop.width || 0) - (before.width || 0)) > 4) fails.push(`${vp.name}:loop_width_degraded`);
    if (afterLoop.formUser !== "IU_DS_RETURN_MARKER") fails.push(`${vp.name}:loop_form_reset`);

    return {
      viewport: vp.name,
      pass: fails.length === 0,
      fails,
      before,
      afterA,
      afterB,
      afterLoop,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const staticFails = auditStatic();
  if (staticFails.length) {
    console.log(JSON.stringify({ pass: false, phase: "static", staticFails }, null, 2));
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const fp = path.join(REPO, p.replace(/^\/+/, ""));
      if (!fp.startsWith(REPO) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const mime =
        fp.endsWith(".css") ? "text/css; charset=utf-8" :
        fp.endsWith(".js") ? "text/javascript; charset=utf-8" :
        fp.endsWith(".html") ? "text/html; charset=utf-8" :
        "application/octet-stream";
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
  const results = [];
  const failures = [];
  try {
    for (const vp of VIEWPORTS) {
      const r = await runViewport(browser, vp);
      results.push(r);
      for (const f of r.fails) failures.push(f);
    }
  } finally {
    await browser.close();
    server.close();
  }

  const pass = failures.length === 0;
  console.log(JSON.stringify({ pass, failures, results }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
